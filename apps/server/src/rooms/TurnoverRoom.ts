import { randomInt } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import * as path from 'node:path'
import type { FloorId, RoomIndex } from '@turnover/shared'
import {
  accuseIntentSchema,
  deskInteractIntentSchema,
  elevatorCallIntentSchema,
  elevatorPressIntentSchema,
  type LobbySnapshot,
  lobbyStartIntentSchema,
  type MovementSnapshot,
  moveStartIntentSchema,
  moveStopIntentSchema,
  stairsEnterIntentSchema,
  suitcasePickupIntentSchema,
  suitcasePlaceIntentSchema,
  TUNING,
  workStartIntentSchema,
} from '@turnover/shared'
import {
  type GuestTiming,
  type MovementPort,
  MovementSim,
  playerSpawnXMilli,
  RoundSim,
  TelemetrySink,
  TICK_HZ,
} from '@turnover/sim'
import { type Client, CloseCode, Room } from 'colyseus'
import { RoundPresenter } from './roundPresenter'
import { Router } from './router'

/** Colyseus 0.18 close code for a deliberate `room.leave()` (verified in installed sources). */
const CONSENTED_CLOSE_CODE: number = CloseCode.CONSENTED

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

/**
 * AD-028 test seam (the AD-004 pattern): outside production,
 * TURNOVER_TEST_GUEST_SCALE scales the guest cadence, impatience, and dwell so
 * gate-3 harness rounds observe FULL guest lifecycles inside the shortened
 * shift. Production ignores the variable entirely and always runs §7 v1.3
 * guest timing.
 */
function testGuestTiming(): GuestTiming | undefined {
  if (process.env.NODE_ENV === 'production') return undefined
  const raw = process.env.TURNOVER_TEST_GUEST_SCALE
  if (raw === undefined) return undefined
  const scale = Number(raw)
  if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) return undefined
  return {
    cadenceTicks: Math.max(1, Math.round(TUNING.GUEST_CADENCE_SECONDS[5] * scale * TICK_HZ)),
    impatienceTicks: Math.max(1, Math.round(TUNING.GUEST_IMPATIENCE_SECONDS * scale * TICK_HZ)),
    dwellScale: scale,
    diningScale: scale,
  }
}

interface LobbyPlayer {
  sessionId: string
  name: string
  joinedAt: number
  /**
   * FR-25 seat state: false while a mid-round disconnection holds a
   * reconnection seat. A seat that expires ghosts (staff) or aborts
   * (saboteur); the roster entry is purged at the next round start.
   */
  connected: boolean
}

export class TurnoverRoom extends Room {
  /** Test hook: tracks created instances so tests can assert message-only config. */
  static instances: TurnoverRoom[] = []

  /** Production: 50 ms = 20 Hz (prd §11). Tests set 0 and drive ticks directly. */
  static tickMs = 50

  /**
   * Reconnection seat window (prd §11: 60 s `allowReconnection`, exact role
   * restore). Static test seam — the same pattern as `tickMs` (AD-004
   * precedent); production never overrides it.
   */
  static reconnectSeconds = 60

  private players = new Map<string, LobbyPlayer>()
  /**
   * Dev-only building-wide watchers (join `{ spectator: true }`): no movement
   * slot, no roster entry, no role — the FR-20 fired-spectator view from t=0.
   * The Router marks any session without a position as a spectator, so the
   * every-floor stream delivery is the existing machinery, not new routing.
   */
  private spectators = new Map<string, string>()
  private joinedCounter = 0
  private router!: Router
  private movement!: MovementSim
  /** The round-scoped presentation layer (rooms/roundPresenter.ts): snapshot
   *  assembly, ride journal, fired policy, tick routing + telemetry
   *  projection, seat-expiry resolution, results transition. Built in
   *  onCreate once the movement sim and router exist. */
  private presenter!: RoundPresenter
  // --- Telemetry (cycle, FR-23/24): server-authoritative JSONL per round.
  private telemetrySink: TelemetrySink | null = null
  private telemetryStream: import('node:fs').WriteStream | null = null
  private telemetryPath: string | null = null
  private telemetryRoundIdx = 0

  /** The round sim lives in the presenter; these delegations keep the
   *  transport shell's reads one-hop (intents, restore, guest port). */
  private get sim(): RoundSim | null {
    return this.presenter.simOf()
  }

  private get phase(): 'lobby' | 'round' | 'results' {
    return this.presenter.phase
  }

  override onCreate() {
    this.patchRate = null
    this.router = new Router(this)
    this.movement = new MovementSim()
    // The round-scoped presentation layer: the router stays the only sender
    // (bypass-denylist invariant) and the telemetry file I/O stays here —
    // the presenter routes and projects, this shell reads and writes disk.
    this.presenter = new RoundPresenter(this.movement, this.router, {
      sink: () => this.telemetrySink,
      flush: () => this.flushTelemetry(),
      close: () => this.closeTelemetry(),
    })
    // AD-008: the Router resolves positional policies (sameFloor/occupants)
    // against each viewer's legitimate view, derived from the movement sim.
    // FR-20 (cycle 2.9): a session with NO position — a fired player (their
    // slot was torn down) — is a spectator: they receive every floor's stream
    // and interiors until the round ends and through the results phase. One
    // home: the presenter's viewContextOf.
    this.router.setViewContext((sessionId) => this.presenter.viewContextOf(sessionId))
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
        this.presenter.sendExitSnapshot(client.sessionId)
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
    // Stairwell entry (cycle 3.E, AD-040): the sim guards every branch (mouth,
    // direction, in-car, guest) and rejects silently — nothing on the wire. An
    // entry is a visibility change (the enterer lost their floor), so the room
    // answers with a personal snapshot (AD-017 exit-snapshot mechanism) that
    // carries their own stairs row.
    this.onMessage('stairs:enter', stairsEnterIntentSchema, (client, intent) => {
      if (!this.ensureLive(client.sessionId)) return
      if (this.movement.enterStairs(client.sessionId, intent.dir) === 'entered') {
        this.router.toSelf(
          'movement:snapshot',
          client.sessionId,
          this.presenter.movementSnapshotFor(client.sessionId),
        )
      }
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
          // FR-9a (cycle 3.B): carrying is hands-full — deliver before working.
          carrying: 'you are carrying a suitcase',
        }
        this.router.toSelf('error', client.sessionId, { code: result, message: messages[result] })
      }
    })

    // Front desk + suitcase intents (cycle 3.B, AD-032): E at the desk checks
    // the front guest in (the caller takes the suitcase); place/pickup are
    // the carry intents. Every rejection is SILENT (SUI-02/09/10).
    this.onMessage('desk:interact', deskInteractIntentSchema, (client) => {
      if (!this.ensureLive(client.sessionId)) return
      if (this.phase !== 'round' || this.sim === null) return
      this.sim.deskInteract(client.sessionId)
    })
    this.onMessage('suitcase:place', suitcasePlaceIntentSchema, (client, intent) => {
      if (!this.ensureLive(client.sessionId)) return
      if (this.phase !== 'round' || this.sim === null) return
      this.sim.suitcasePlace(client.sessionId, intent.room as RoomIndex)
    })
    this.onMessage('suitcase:pickup', suitcasePickupIntentSchema, (client) => {
      if (!this.ensureLive(client.sessionId)) return
      if (this.phase !== 'round' || this.sim === null) return
      this.sim.suitcasePickup(client.sessionId)
    })

    if (TurnoverRoom.tickMs > 0) {
      this.setSimulationInterval(() => this.presenter.tick(), TurnoverRoom.tickMs)
    }
  }

  override onDispose() {
    activeCodes.delete(this.roomId)
    this.closeTelemetry()
  }

  /** Test hook: last telemetry file path (null outside a finished round). */
  __telemetryPath(): string | null {
    return this.telemetryPath
  }

  /** Test hook: whether the telemetry stream is closed after round:ended. */
  __telemetryClosed(): boolean {
    return this.telemetryStream === null
  }

  override onJoin(client: Client, options: { name?: unknown; spectator?: unknown }) {
    // Results (cycle 2.9) is lobby-like: a new player may join between rounds.
    if (this.phase === 'round') {
      throw new Error('round in progress')
    }
    const name = typeof options?.name === 'string' ? options.name.trim() : ''
    if (name.length < 1 || name.length > 16) {
      throw new Error('invalid name')
    }
    if (options?.spectator === true) {
      // A dev-only watching tool, never a live-game seat: the omniscient view
      // is legitimate for a fired player (FR-20) but would leak the building
      // to a non-participant in a real match — production refuses the join.
      if (process.env.NODE_ENV === 'production') {
        throw new Error('spectator joins are dev-only')
      }
      this.spectators.set(client.sessionId, name)
      this.sendLobbySnapshots()
      return
    }
    if (this.players.size >= TUNING.PLAYERS_MAX) {
      throw new Error('room full')
    }
    for (const player of this.players.values()) {
      if (player.name === name) throw new Error('name taken')
    }
    this.players.set(client.sessionId, {
      sessionId: client.sessionId,
      name,
      joinedAt: this.joinedCounter++,
      connected: true,
    })
    // Fresh-joiner placement (FR-2 spawn): the staff row west of the desk —
    // join order fills westward slots so awaiting players never stack on the
    // desk (MOVE-18 snapshot ride-along; positions persist into the round).
    this.movement.join(client.sessionId, {
      xMilli: playerSpawnXMilli(this.players.size - 1),
    })
    // Fresh snapshot to everyone so rosters stay consistent without a feed.
    this.sendLobbySnapshots()
    // Personal movement snapshot (snapshotFor resolves the rider-vs-floor
    // policy internally — join and buzzer share one path).
    this.router.toSelf(
      'movement:snapshot',
      client.sessionId,
      this.movement.snapshotFor(client.sessionId),
    )
  }

  override onLeave(client: Client, code?: number) {
    // Spectators hold no seat and no roster entry — their departure is silent
    // (no seat hold mid-round, no player:left for an id no client renders).
    if (this.spectators.delete(client.sessionId)) {
      this.router.forget(client.sessionId)
      return
    }
    // Colyseus 0.18 delivers the numeric close code (CloseCode.CONSENTED =
    // 4000); anything else is an unconsented drop. A drop DURING a round
    // holds a reconnection seat (FR-25): roster entry + frozen movement slot
    // kept, one player:left broadcast, and the round continues with or
    // without them.
    if (code !== CONSENTED_CLOSE_CODE && this.phase === 'round') {
      const seat = this.players.get(client.sessionId)
      if (seat !== undefined) seat.connected = false
      // Public knowledge: the rectangle disappears everywhere (MOVE-19). The
      // movement slot stays (frozen — a dead connection sends no intents), so
      // a reconnect resumes at the exact position.
      this.router.toAll('player:left', { playerId: client.sessionId })
      this.router.forget(client.sessionId)
      void this.holdSeat(client)
      return
    }
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
      // Mid-round: the leaver's sim slot idles until the buzzer. No lobby
      // snapshot — rosters are a lobby concept.
      return
    }
    // Host is whoever joined earliest among the remaining players, so migration
    // is implicit: the next snapshot simply flips isHost (CHURN-02).
    this.sendLobbySnapshots()
  }

  /**
   * Hold the leaver's seat for the reconnection window (REND-17). On
   * reconnection the seat is restored exactly (REND-18); on expiry the FR-25
   * resolution applies — ghost (staff, REND-19) or aborted round (saboteur,
   * REND-20).
   */
  private async holdSeat(client: Client): Promise<void> {
    try {
      const reconnected = await this.allowReconnection(client, TurnoverRoom.reconnectSeconds)
      this.restoreSeat(reconnected)
    } catch {
      this.expireSeat(client.sessionId)
    }
  }

  /** Seat restored: exact role, honest resumed clock, re-announced position. */
  private restoreSeat(client: Client): void {
    const sessionId = client.sessionId
    const sim = this.sim
    const seat = this.players.get(sessionId)
    // The round may have ended during the window — a fresh results-phase
    // client re-enters like everyone else (join-shaped restore).
    this.router.forget(sessionId) // fresh per-connection seq (REG-17)
    if (seat !== undefined) seat.connected = true
    if (this.phase !== 'round' || sim === null) {
      this.router.toSelf('lobby:snapshot', sessionId, this.buildSnapshot(sessionId))
      this.router.toSelf(
        'movement:snapshot',
        sessionId,
        this.presenter.movementSnapshotFor(sessionId),
      )
      return
    }
    // Re-add the rectangle everywhere: one player:moved re-announces the
    // preserved position (clients re-create displays for unknown ids).
    this.movement.announcePosition(sessionId)
    this.router.toSelf('lobby:snapshot', sessionId, this.buildSnapshot(sessionId))
    const role = sim.roleOf(sessionId)
    if (role !== undefined) {
      // Rule 3: the role card travels to its owner only — re-sent verbatim,
      // saboteur card included (prd reconnection contract).
      this.router.toSelf('role:dealt', sessionId, { role })
    }
    const ownFired = this.presenter.isFired(sessionId)
    this.router.toSelf('round:resumed', sessionId, {
      remainingTicks: sim.clockTicksRemaining,
      playerIds: sim.playerIds,
      ownFired,
      settleScore: sim.settledCount,
      complaints: sim.complaintCount,
    })
    if (ownFired) {
      this.router.toSelf('spectator:snapshot', sessionId, this.presenter.spectatorSnapshot())
    } else {
      this.router.toSelf(
        'movement:snapshot',
        sessionId,
        this.presenter.movementSnapshotFor(sessionId),
      )
    }
  }

  /** The window closed without reconnection — FR-25 resolution (REND-19/20).
   *  The room owns WHEN (this 60 s window); the presenter owns WHAT the
   *  expiry means (ghost vs aborted round). */
  private expireSeat(sessionId: string): void {
    const seat = this.players.get(sessionId)
    if (!this.presenter.roundLive) {
      // The round ended during the window: release the seat like a lobby leave.
      this.movement.leave(sessionId)
      if (seat !== undefined) this.players.delete(sessionId)
      this.sendLobbySnapshots()
      return
    }
    this.presenter.expireSeat(sessionId)
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
      ownName: own?.name ?? this.spectators.get(ownId) ?? '',
      isHost: ownId === hostId,
      roster,
    }
  }

  /** Roster refresh to players and spectators alike (lobby + results phases). */
  private sendLobbySnapshots(): void {
    for (const sessionId of [...this.players.keys(), ...this.spectators.keys()]) {
      this.router.toSelf('lobby:snapshot', sessionId, this.buildSnapshot(sessionId))
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
    // FR-25 (cycle 2.9): expired seats' roster entries are purged at the next
    // round start — ghosts free their slot exactly when a new deal begins.
    for (const [sessionId, seat] of this.players) {
      if (!seat.connected) this.players.delete(sessionId)
    }
    // Positions persist across start/buzzer (MOVE-07): the movement layer is
    // phase-free and simply keeps running.
    const playerIds = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => p.sessionId)
    // Seed never leaves the server: it appears in no event and no payload.
    const shiftTicks = testShiftTicks()
    const seed = randomInt(2 ** 31)
    const sim = new RoundSim({
      seed,
      playerIds,
      // Guest-traffic economy (cycle 3.1, AD-028): the sim drives NPC guests
      // through the room's movement layer via the NPC-only port.
      movement: this.guestPort(),
      ...(testGuestTiming() === undefined ? {} : { guestTiming: testGuestTiming() }),
      ...(shiftTicks === undefined ? {} : { totalTicks: shiftTicks }),
    })
    this.openTelemetry(seed, sim.saboteurId)
    // The presenter takes the deal + the roster: phase → round, journal and
    // fired state reset, car floors seeded for the first ride leg's `from`.
    this.presenter.startRound(sim, playerIds)
    // AD-040 ambush authority (design: the AD-028 adapter inverted): the room
    // pushes its role/liveness view INTO the movement layer at round start.
    // The sim's own REND-02 liveness rule is the single home of "live staff".
    this.movement.setAmbushAuthority({
      isSaboteur: (id) => sim.saboteurId === id,
      isLiveStaff: (id) => sim.isLiveStaff(id),
    })
    // The FR-20 baseline reaches the dev spectators too — the round:started
    // broadcast follows on the first tick; the baseline must precede it so
    // the overview seeds before the HUD mounts.
    for (const sessionId of this.spectators.keys()) {
      this.router.toSelf('spectator:snapshot', sessionId, this.presenter.spectatorSnapshot())
    }
  }

  /**
   * The NPC-only seam into the movement layer (AD-028): guests issue the same
   * intents players do, but through this narrow adapter and never through the
   * network. Player intents still enter only via message handlers.
   */
  private guestPort(): MovementPort {
    return {
      joinGuest: (id, floor, xTiles) =>
        this.movement.join(id, { kind: 'guest', floor, xMilli: Math.round(xTiles * 1000) }),
      removeGuest: (id) => this.movement.leave(id),
      announceGuest: (id) => this.movement.announcePosition(id),
      positionOf: (id) => {
        const p = this.movement.positionOf(id)
        return p === undefined ? undefined : { floor: p.floor, x: p.x }
      },
      viewOf: (id) => this.movement.viewOf(id),
      startMove: (id, dir) => this.movement.startMove(id, dir),
      stopMove: (id) => this.movement.stopMove(id),
      callElevator: (id) => this.movement.callElevator(id),
      pressFloor: (id, floor) => this.movement.pressFloor(id, floor),
    }
  }

  private openTelemetry(seed: number, saboteurId: string): void {
    try {
      const dir = path.join(process.cwd(), 'data', 'telemetry')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${this.roomId}-${this.telemetryRoundIdx++}.jsonl`)
      this.telemetryPath = file
      this.telemetrySink = new TelemetrySink(saboteurId, seed)
      this.telemetryStream = createWriteStream(file, { flags: 'a' })
      this.telemetryStream.on('error', (err) =>
        console.error('[telemetry] write failed', file, err),
      )
    } catch (err) {
      console.error('[telemetry] open failed', err)
    }
  }

  private flushTelemetry(): void {
    if (this.telemetrySink === null || this.telemetryStream === null) return
    const lines = this.telemetrySink.drain()
    for (const line of lines) {
      try {
        this.telemetryStream.write(`${JSON.stringify(line)}\n`)
      } catch (err) {
        console.error('[telemetry] write failed', err)
      }
    }
  }

  private closeTelemetry(): void {
    if (this.telemetryStream !== null) {
      try {
        this.telemetryStream.end()
      } catch {}
      this.telemetryStream = null
    }
    this.telemetrySink = null
  }

  /** Test hook: drive the sim deterministically without wall-clock waits. */
  __driveTicks(count: number) {
    for (let i = 0; i < count; i++) this.presenter.tick()
  }

  /** Test hook: read the phase without poking private state from tests. */
  /** Test seam: the round sim's remaining ticks (null outside a round). */
  __clockTicksRemaining(): number | null {
    return this.sim?.clockTicksRemaining ?? null
  }

  __phase(): 'lobby' | 'round' | 'results' {
    return this.phase
  }

  /** Test hook: public movement state (positions + car floors) for tests. */
  __movementDebug(): unknown {
    return {
      positions: this.movement.allPositions(),
      cars: this.movement.carFloors(),
      guestIds: this.movement.guestIds(),
    }
  }

  /** Test hook: one player's stairs state (cycle 3.E staging + asserts). */
  __stairsStateOf(sessionId: string): unknown {
    return this.movement.stairsStateOf(sessionId) ?? null
  }

  /**
   * Justice live-ness guard (cycle 2.8): a fired session cannot act — every
   * intent handler rejects with a coarse justice error. One message, no
   * validity or role information (FR-18).
   */
  private ensureLive(sessionId: string): boolean {
    if (this.spectators.has(sessionId)) {
      this.router.toSelf('error', sessionId, {
        code: 'justice-rejected',
        message: 'spectators cannot act',
      })
      return false
    }
    if (!this.presenter.isFired(sessionId)) return true
    this.router.toSelf('error', sessionId, {
      code: 'justice-rejected',
      message: 'you were fired — spectators cannot act',
    })
    return false
  }
}
