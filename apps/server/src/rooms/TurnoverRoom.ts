import { randomInt } from 'node:crypto'
import type { FloorId, RoomIndex } from '@turnover/shared'
import {
  elevatorCallIntentSchema,
  elevatorPressIntentSchema,
  type LobbySnapshot,
  lobbyStartIntentSchema,
  moveStartIntentSchema,
  moveStopIntentSchema,
  TUNING,
  workStartIntentSchema,
} from '@turnover/shared'
import { MovementSim, RoundSim, TICK_HZ } from '@turnover/sim'
import { type Client, Room } from 'colyseus'
import { Router } from './router'

/**
 * The round container (cycle 2.1). Lobby half: join by 4-letter code with
 * validated display names, roster snapshots, host tracking. Round half: guards
 * the host start intent, owns the RoundSim lifecycle, and forwards every sim
 * event to the per-room Router (cycle 2.3, AD-006), which applies recipient
 * policies and stamps envelopes — role:dealt reaches ONLY the dealt player by
 * declared policy.
 *
 * Cycle 2.4 (AD-005): the room also owns a phase-free MovementSim that ticks
 * in BOTH phases — players walk anywhere from the moment they join and keep
 * their positions across lobby→round→lobby (AD-015). Message-only —
 * patchRate null, no Schema state.
 */

/** 24-letter read-aloud alphabet — no I/O (codes are spoken aloud, FR-1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Process-local set of live room codes (AD-001: single-process deploy). */
const activeCodes = new Set<string>()

/**
 * AD-004 test seam: outside production, TURNOVER_TEST_SHIFT_SECONDS shortens the
 * shift so gate-3 harness rounds reach a real buzzer. Production ignores the
 * variable entirely and always runs the prd §7 shift (TUNING.SHIFT_SECONDS).
 */
function testShiftTicks(): number | undefined {
  if (process.env.NODE_ENV === 'production') return undefined
  const raw = process.env.TURNOVER_TEST_SHIFT_SECONDS
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.round(seconds * TICK_HZ)
}

interface LobbyPlayer {
  sessionId: string
  name: string
  joinedAt: number
}

export class TurnoverRoom extends Room {
  /** Test hook: tracks created instances so tests can assert message-only config. */
  static instances: TurnoverRoom[] = []

  /** Production: 50 ms = 20 Hz (prd §11). Tests set 0 and drive ticks directly. */
  static tickMs = 50

  private phase: 'lobby' | 'round' = 'lobby'
  private players = new Map<string, LobbyPlayer>()
  private joinedCounter = 0
  private sim: RoundSim | null = null
  private router!: Router
  private movement!: MovementSim

  override onCreate() {
    this.patchRate = null
    this.router = new Router(this)
    this.movement = new MovementSim()
    // AD-008: the Router resolves positional policies (sameFloor/occupants)
    // against each viewer's legitimate view, derived from the movement sim.
    this.router.setViewContext((sessionId) => this.movement.viewOf(sessionId))
    // Custom roomId = the shareable code (settable only during onCreate, verified
    // against installed 0.18.8 sources). Codes die with the room (FR-1: fresh
    // codes only for new groups).
    let code = this.drawCode()
    while (activeCodes.has(code)) code = this.drawCode()
    this.roomId = code
    activeCodes.add(code)
    TurnoverRoom.instances.push(this)

    // Overload 3 of onMessage (verified in installed 0.18.8 sources) takes a
    // StandardSchema validator — zod 4 implements Standard Schema V1.
    this.onMessage('lobby:start', lobbyStartIntentSchema, (client) => {
      this.handleStartIntent(client.sessionId)
    })
    // Movement intents (zod-validated, outside the registry — protocol rules).
    this.onMessage('move:start', moveStartIntentSchema, (client, intent) => {
      this.movement.startMove(client.sessionId, intent.dir)
    })
    this.onMessage('move:stop', moveStopIntentSchema, (client) => {
      this.movement.stopMove(client.sessionId)
    })
    // Destination-free call (ELR-06/AD-014): the target lives in the in-car
    // press intent; a duplicate call flashes via the sim event only.
    this.onMessage('elevator:call', elevatorCallIntentSchema, (client) => {
      if (this.movement.callElevator(client.sessionId) === 'rejected') {
        this.router.toSelf('error', client.sessionId, {
          code: 'elevator-locked',
          message: 'you are already riding an elevator',
        })
      }
    })
    // In-car floor press (ELR-08/AD-014): rider-only. A non-rider press is
    // rejected silently — nothing on the wire, no error message (ELR P2 AC3).
    this.onMessage('elevator:press', elevatorPressIntentSchema, (client, intent) => {
      this.movement.pressFloor(client.sessionId, intent.floor)
    })
    // Work intents (cycle 2.5, FR-7/8/9): the action matrix lives in the sim —
    // the room validates the phase and maps rejection reasons 1:1 to errors.
    this.onMessage('work:start', workStartIntentSchema, (client, intent) => {
      const sim = this.sim
      if (this.phase !== 'round' || sim === null) {
        this.router.toSelf('error', client.sessionId, {
          code: 'round-not-active',
          message: 'work is only possible during a round',
        })
        return
      }
      const result = sim.startWork(client.sessionId, intent.floor, intent.room as RoomIndex)
      if (result !== 'accepted') {
        const messages: Record<typeof result, string> = {
          'not-in-room': 'you are not inside that room',
          'room-not-workable': 'that room offers you no work',
          'channel-active': 'you are already working',
        }
        this.router.toSelf('error', client.sessionId, { code: result, message: messages[result] })
      }
    })

    if (TurnoverRoom.tickMs > 0) {
      this.setSimulationInterval(() => this.advance(), TurnoverRoom.tickMs)
    }
  }

  override onDispose() {
    activeCodes.delete(this.roomId)
  }

  override onJoin(client: Client, options: { name?: unknown }) {
    if (this.phase !== 'lobby') {
      throw new Error('round in progress')
    }
    if (this.players.size >= TUNING.PLAYERS_MAX) {
      throw new Error('room full')
    }
    const name = typeof options?.name === 'string' ? options.name.trim() : ''
    if (name.length < 1 || name.length > 16) {
      throw new Error('invalid name')
    }
    for (const player of this.players.values()) {
      if (player.name === name) throw new Error('name taken')
    }
    this.players.set(client.sessionId, {
      sessionId: client.sessionId,
      name,
      joinedAt: this.joinedCounter++,
    })
    // Fresh-joiner placement (FR-2 spawn): lobby center (MOVE-18 snapshot ride-along).
    this.movement.join(client.sessionId)
    // Fresh snapshot to everyone so rosters stay consistent without a feed.
    for (const sessionId of this.players.keys()) {
      this.router.toSelf('lobby:snapshot', sessionId, this.buildSnapshot(sessionId))
    }
    // Personal movement snapshot (viewer-branch, AD-013): fresh joiners always
    // stand in the lobby, so this resolves to the own-floor view — but the
    // branch keeps join and buzzer on one rider-aware path.
    this.router.toSelf(
      'movement:snapshot',
      client.sessionId,
      this.movement.snapshotForRider(client.sessionId),
    )
  }

  override onLeave(client: Client) {
    this.players.delete(client.sessionId)
    // Remove from movement sim first: clears car.riders, marks dirty so the
    // next tick emits elevator:riders (disconnect row, design.md / ELR P1 AC2).
    this.movement.leave(client.sessionId)
    // A leaver's channel dies silently — no work:ended, no trace (WORK-12).
    this.sim?.leave(client.sessionId)
    // Public knowledge: the rectangle disappears everywhere (MOVE-19).
    this.router.toAll('player:left', { playerId: client.sessionId })
    // Counters are per-connection: a departed connection's counter dies with it.
    this.router.forget(client.sessionId)
    if (this.phase !== 'lobby') {
      // Mid-round: the leaver's sim slot idles until the buzzer (full FR-25 ghost
      // machinery is a later cycle). No lobby snapshot — rosters are a lobby concept.
      return
    }
    // Host is whoever joined earliest among the remaining players, so migration
    // is implicit: the next snapshot simply flips isHost (CHURN-02).
    for (const sessionId of this.players.keys()) {
      this.router.toSelf('lobby:snapshot', sessionId, this.buildSnapshot(sessionId))
    }
  }

  private drawCode(): string {
    let code = ''
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    return code
  }

  private buildSnapshot(ownId: string): LobbySnapshot {
    const roster = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.sessionId, name: p.name }))
    const hostId = roster[0]?.id
    const own = this.players.get(ownId)
    return {
      ownId,
      ownName: own?.name ?? '',
      isHost: ownId === hostId,
      roster,
    }
  }

  private handleStartIntent(sessionId: string) {
    if (this.phase !== 'lobby') {
      this.router.toSelf('error', sessionId, {
        code: 'round-already-active',
        message: 'a round is already running',
      })
      return
    }
    const hostId = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]?.sessionId
    if (sessionId !== hostId) {
      this.router.toSelf('error', sessionId, {
        code: 'not-host',
        message: 'only the host can start the round',
      })
      return
    }
    if (this.players.size < TUNING.PLAYERS_MIN) {
      this.router.toSelf('error', sessionId, {
        code: 'need-more-players',
        message: `need at least ${TUNING.PLAYERS_MIN} players`,
      })
      return
    }
    this.startRound()
  }

  private startRound() {
    this.phase = 'round'
    // Positions persist across start/buzzer (MOVE-07): the movement layer is
    // phase-free and simply keeps running.
    const playerIds = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => p.sessionId)
    // Seed never leaves the server: it appears in no event and no payload.
    const shiftTicks = testShiftTicks()
    this.sim = new RoundSim({
      seed: randomInt(2 ** 31),
      playerIds,
      ...(shiftTicks === undefined ? {} : { totalTicks: shiftTicks }),
    })
  }

  /** One fixed 0.05 s step; the production interval and the test hook share this path. */
  private advance() {
    // Movement runs in BOTH phases (AD-005); the round sim only in round.
    for (const event of this.movement.tick()) this.router.route(event)
    const sim = this.sim
    if (sim === null || this.phase !== 'round') return
    // AD-005 seam: the work channels consume the movement layer's positions
    // (integer millitiles) — inside-segment validation, walk-out cancels,
    // and room observation all derive from them.
    const positions = new Map<string, { floor: FloorId; x: number }>()
    for (const sessionId of this.players.keys()) {
      const p = this.movement.positionOf(sessionId)
      if (p !== undefined) {
        positions.set(sessionId, { floor: p.floor, x: Math.round(p.x * 1000) })
      }
    }
    for (const event of sim.tick(positions)) this.router.route(event)
    if (sim.clockTicksRemaining <= 0) {
      // Buzzer: roles were the sim's alone — dropping it wipes the deal (AD-002).
      this.sim = null
      this.phase = 'lobby'
      // Refresh everyone's view of where players and cars now stand
      // (MOVE-18). Viewer-branch snapshot (AD-013): a mid-car rider gets
      // their car's occupants + queue with an EMPTY players list (AD-009
      // leak fix — a floor snapshot is not a legitimate rider view); every
      // non-rider gets the byte-identical own-floor snapshot.
      for (const sessionId of this.players.keys()) {
        const view = this.movement.viewOf(sessionId)
        this.router.toSelf(
          'movement:snapshot',
          sessionId,
          view.car !== null
            ? this.movement.snapshotForRider(sessionId)
            : this.movement.snapshotForFloor(view.floor ?? 'lobby'),
        )
      }
    }
  }

  /** Test hook: drive the sim deterministically without wall-clock waits. */
  __driveTicks(count: number) {
    for (let i = 0; i < count; i++) this.advance()
  }

  /** Test hook: read the phase without poking private state from tests. */
  __phase(): 'lobby' | 'round' {
    return this.phase
  }
}
