import { randomInt } from 'node:crypto'
import type {
  CarId,
  FloorId,
  MovementEvent,
  RecapEntry,
  RoomIndex,
  SpectatorSnapshot,
} from '@turnover/shared'
import {
  accuseIntentSchema,
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

  private phase: 'lobby' | 'round' | 'results' = 'lobby'
  private players = new Map<string, LobbyPlayer>()
  private joinedCounter = 0
  private sim: RoundSim | null = null
  private router!: Router
  private movement!: MovementSim
  /** Justice (cycle 2.8): sessions fired this round — out of live play, still connected. */
  private fired = new Set<string>()
  // --- Round end (cycle 2.9): the results phase + the FR-22 ride journal.
  /** 0-based round tick stamp for room-journaled entries (matches the sim's). */
  private roundTick = 0
  /** Ride legs observed during the round — the recap's movement half. */
  private rideJournal: RecapEntry[] = []
  /** Last known rider list per car (elevator:riders events the room routes). */
  private lastRiders = new Map<CarId, string[]>()
  /** Last known floor per car — the `from` half of a ride leg. */
  private carFloor = new Map<CarId, FloorId>()

  override onCreate() {
    this.patchRate = null
    this.router = new Router(this)
    this.movement = new MovementSim()
    // AD-008: the Router resolves positional policies (sameFloor/occupants)
    // against each viewer's legitimate view, derived from the movement sim.
    // FR-20 (cycle 2.9): a session with NO position — a fired player (their
    // slot was torn down) — is a spectator: they receive every floor's stream
    // and interiors until the round ends and through the results phase.
    this.router.setViewContext((sessionId) => {
      const view = this.movement.viewOf(sessionId)
      const slotless =
        view.floor === null && view.roomKey === null && view.car === null && view.x === null
      return { ...view, spectator: slotless }
    })
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
      if (!this.ensureLive(client.sessionId)) return
      const carBefore = this.movement.viewOf(client.sessionId).car
      this.movement.startMove(client.sessionId, intent.dir)
      if (carBefore !== null && this.movement.viewOf(client.sessionId).car === null) {
        // Door-open exit = floor change (protocol rule: personal snapshots on
        // visibility change). The exiter's picture of the arrival floor is
        // stale — standing occupants emit no stream, so without this refresh
        // they stay invisible until they move. Same-floor occupants learn the
        // arrival from the exiter's own resumed player:moved stream.
        // EVID-04: the arrival floor's carded rooms ride along — cards are
        // floor-public (FR-11) and the round sim owns them (empty pre-round;
        // cards die with the sim at the buzzer, evidence is round-scoped).
        const arrivalFloor = this.movement.viewOf(client.sessionId).floor
        const cards =
          arrivalFloor !== null && arrivalFloor !== 'lobby'
            ? (this.sim?.cardedOn(arrivalFloor) ?? [])
            : []
        this.router.toSelf('movement:snapshot', client.sessionId, {
          ...this.movement.snapshotFor(client.sessionId, cards),
        })
      }
    })
    this.onMessage('move:stop', moveStopIntentSchema, (client) => {
      if (!this.ensureLive(client.sessionId)) return
      this.movement.stopMove(client.sessionId)
    })
    // Destination-free call (ELR-06/AD-014): the target lives in the in-car
    // press intent; a duplicate call flashes via the sim event only.
    this.onMessage('elevator:call', elevatorCallIntentSchema, (client) => {
      if (!this.ensureLive(client.sessionId)) return
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
      if (!this.ensureLive(client.sessionId)) return
      this.movement.pressFloor(client.sessionId, intent.floor)
    })
    // Accusation (cycle 2.8, FR-17): eligibility lives in the sim — staff-only,
    // live players, same floor within TUNING.ACCUSATION_RANGE_TILES. The room
    // maps rejections 1:1 to coarse errors; validity never becomes machine-
    // readable on the wire (the fired event is name-only, FR-18).
    this.onMessage('accuse', accuseIntentSchema, (client, intent) => {
      const sim = this.sim
      if (this.phase !== 'round' || sim === null) {
        this.router.toSelf('error', client.sessionId, {
          code: 'justice-rejected',
          message: 'accusations are only possible during a round',
        })
        return
      }
      const result = sim.accuse(client.sessionId, intent.targetId)
      if (result !== 'resolved') {
        const messages: Record<typeof result, string> = {
          'round-not-active': 'accusations are only possible during a round',
          'accuser-not-live': 'you were fired — spectators cannot accuse',
          'accuser-is-saboteur': 'you cannot accuse',
          'self-target': 'you cannot accuse yourself',
          'target-not-live': 'that player cannot be accused',
          'out-of-range': 'get closer to accuse',
        }
        this.router.toSelf('error', client.sessionId, {
          code: 'justice-rejected',
          message: messages[result],
        })
      }
    })
    // Work intents (cycle 2.5, FR-7/8/9): the action matrix lives in the sim —
    // the room validates the phase and maps rejection reasons 1:1 to errors.
    this.onMessage('work:start', workStartIntentSchema, (client, intent) => {
      if (!this.ensureLive(client.sessionId)) return
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
    // Results (cycle 2.9) is lobby-like: a new player may join between rounds.
    if (this.phase === 'round') {
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
    // Personal movement snapshot (snapshotFor resolves the rider-vs-floor
    // policy internally — join and buzzer share one path).
    this.router.toSelf(
      'movement:snapshot',
      client.sessionId,
      this.movement.snapshotFor(client.sessionId),
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
    if (this.phase === 'round') {
      // Mid-round: the leaver's sim slot idles until the buzzer (full FR-25 ghost
      // machinery is cycle 2.9's T5). No lobby snapshot — rosters are a lobby concept.
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
    if (this.phase === 'round') {
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
    this.fired.clear()
    // Round-end journal reset (cycle 2.9): a fresh deal starts a fresh recap.
    this.roundTick = 0
    this.rideJournal = []
    this.lastRiders.clear()
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
    for (const event of this.movement.tick()) {
      this.router.route(event)
      this.journalMovement(event)
    }
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
    let roundEnded = false
    for (const event of sim.tick(positions)) {
      this.router.route(event)
      // Justice teardown (JUST-04/06/11): a fired session loses their movement
      // slot (no further position streams) — their sim-side channels were
      // already cancelled by the sim. No player:left: the fired event itself
      // removes the rectangle client-side. Cycle 2.9: the fired session also
      // receives their FR-20 spectator baseline.
      if (event.type === 'player:fired') {
        this.fired.add(event.playerId)
        this.movement.leave(event.playerId)
        this.router.toSelf('spectator:snapshot', event.playerId, this.spectatorSnapshot())
      }
      if (event.type === 'round:ended') roundEnded = true
    }
    this.roundTick++
    if (roundEnded) this.finishRound()
  }

  /**
   * The results transition (REND-04/06, FR-21/22): the sim's verdict routed,
   * so the roles die with the sim (AD-002) and everyone gets the recap + a
   * fresh view of where players and cars stand (MOVE-18). The results phase
   * is lobby-like — joins and the host's next `lobby:start` flow through.
   */
  private finishRound() {
    const sim = this.sim
    const entries: RecapEntry[] = sim
      ? [...sim.recapEntries(), ...this.rideJournal]
      : [...this.rideJournal]
    entries.sort((a, b) => a.tick - b.tick)
    this.rideJournal = []
    this.router.toAll('round:recap', { entries })
    this.phase = 'results'
    // Roles were the sim's alone — dropping it wipes the deal (AD-002); the
    // reveal already happened on the wire, so nothing is lost.
    this.sim = null
    this.fired.clear()
    for (const sessionId of this.players.keys()) {
      this.router.toSelf('movement:snapshot', sessionId, this.movement.snapshotFor(sessionId))
    }
  }

  /**
   * FR-22 ride journal (cycle 2.9): the room observes the movement events it
   * routes — `elevator:riders` refreshes the known occupant set, and every
   * real floor change is one ride leg carrying the riders at that moment.
   * Occupancy/validity on the recap is legal because the round is over.
   */
  private journalMovement(event: MovementEvent): void {
    if (this.phase !== 'round') return
    if (event.type === 'elevator:riders') {
      this.lastRiders.set(event.car, [...event.riders])
    } else if (event.type === 'elevator:moved') {
      const from = this.carFloor.get(event.car) ?? event.floor
      this.carFloor.set(event.car, event.floor)
      if (from === event.floor) return
      this.rideJournal.push({
        kind: 'ride',
        tick: this.roundTick,
        car: event.car,
        riderIds: this.lastRiders.get(event.car) ?? [],
        from,
        to: event.floor,
      })
    }
  }

  /** The FR-20 spectator baseline (fired sessions only): the whole world. */
  private spectatorSnapshot(): SpectatorSnapshot {
    const sim = this.sim
    return {
      players: this.movement.allPositions(),
      cars: this.movement.carFloors(),
      rooms: sim ? sim.roomStates() : [],
      cardedRooms: sim
        ? (['floor1', 'floor2', 'floor3'] as const).map((floor) => ({
            floor,
            rooms: sim.cardedOn(floor),
          }))
        : [],
    }
  }

  /** Test hook: drive the sim deterministically without wall-clock waits. */
  __driveTicks(count: number) {
    for (let i = 0; i < count; i++) this.advance()
  }

  /** Test hook: read the phase without poking private state from tests. */
  __phase(): 'lobby' | 'round' | 'results' {
    return this.phase
  }

  /**
   * Justice live-ness guard (cycle 2.8): a fired session cannot act — every
   * intent handler rejects with a coarse justice error. One message, no
   * validity or role information (FR-18).
   */
  private ensureLive(sessionId: string): boolean {
    if (!this.fired.has(sessionId)) return true
    this.router.toSelf('error', sessionId, {
      code: 'justice-rejected',
      message: 'you were fired — spectators cannot act',
    })
    return false
  }
}
