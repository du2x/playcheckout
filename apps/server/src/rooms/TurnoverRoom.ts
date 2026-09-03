import { randomInt } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import * as path from 'node:path'
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
  deskInteractIntentSchema,
  elevatorCallIntentSchema,
  elevatorPressIntentSchema,
  type LobbySnapshot,
  lobbyStartIntentSchema,
  type MovementSnapshot,
  moveStartIntentSchema,
  moveStopIntentSchema,
  settleTargetFor,
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
  RoundSim,
  TelemetrySink,
  TICK_HZ,
} from '@turnover/sim'
import { type Client, CloseCode, Room } from 'colyseus'
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
  // --- Telemetry (cycle, FR-23/24): server-authoritative JSONL per round.
  private telemetrySink: TelemetrySink | null = null
  private telemetryStream: import('node:fs').WriteStream | null = null
  private telemetryPath: string | null = null
  private telemetryRoundIdx = 0

  /**
   * Personal movement snapshot enriched with the resting suitcases of the
   * viewer's floor (cycle 3.B, SUI-24 late joiners) — sameFloor-filtered like
   * the guests; a spectator (fired, no position) sees every floor's resting
   * suitcases. Carried suitcases are derived client-side from the carrier's
   * position stream.
   */
  private movementSnapshotFor(
    sessionId: string,
    cardedRooms?: readonly RoomIndex[],
  ): MovementSnapshot {
    let snap: MovementSnapshot =
      cardedRooms === undefined
        ? this.movement.snapshotFor(sessionId)
        : this.movement.snapshotFor(sessionId, cardedRooms)
    const sim = this.sim
    if (sim === null) return snap
    // Resting suitcases (cycle 3.B) — sameFloor-filtered
    const allSuit = sim.restingSuitcases()
    if (allSuit.length !== 0) {
      const view = this.movement.viewOf(sessionId)
      const spectator =
        view.floor === null && view.roomKey === null && view.car === null && view.x === null
      const visible = spectator ? allSuit : allSuit.filter((r) => r.floor === view.floor)
      if (visible.length !== 0) snap = { ...snap, suitcases: visible }
    }
    // Tenancy signs (cycle 3.4, FR-33) — sameFloor-filtered like suitcases
    const view2 = this.movement.viewOf(sessionId)
    const spectator2 =
      view2.floor === null && view2.roomKey === null && view2.car === null && view2.x === null
    const tenancies = spectator2 ? sim.allTenancies() : sim.tenanciesOn(view2.floor as FloorId)
    if (tenancies.length !== 0) snap = { ...snap, tenancies }
    return snap
  }

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
        this.sendExitSnapshot(client.sessionId)
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
          this.movementSnapshotFor(client.sessionId),
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
      this.setSimulationInterval(() => this.advance(), TurnoverRoom.tickMs)
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
      connected: true,
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

  override onLeave(client: Client, code?: number) {
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
    for (const sessionId of this.players.keys()) {
      this.router.toSelf('lobby:snapshot', sessionId, this.buildSnapshot(sessionId))
    }
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
      this.router.toSelf('movement:snapshot', sessionId, this.movementSnapshotFor(sessionId))
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
    const ownFired = this.fired.has(sessionId)
    this.router.toSelf('round:resumed', sessionId, {
      remainingTicks: sim.clockTicksRemaining,
      playerIds: sim.playerIds,
      ownFired,
      settleScore: sim.settledCount,
      complaints: sim.complaintCount,
    })
    if (ownFired) {
      this.router.toSelf('spectator:snapshot', sessionId, this.spectatorSnapshot())
    } else {
      this.router.toSelf('movement:snapshot', sessionId, this.movementSnapshotFor(sessionId))
    }
  }

  /** The window closed without reconnection — FR-25 resolution (REND-19/20). */
  private expireSeat(sessionId: string): void {
    const sim = this.sim
    const seat = this.players.get(sessionId)
    if (this.phase !== 'round' || sim === null) {
      // The round ended during the window: release the seat like a lobby leave.
      this.movement.leave(sessionId)
      if (seat !== undefined) this.players.delete(sessionId)
      for (const id of this.players.keys()) {
        this.router.toSelf('lobby:snapshot', id, this.buildSnapshot(id))
      }
      return
    }
    if (sim.saboteurId === sessionId) {
      // REND-20: the saboteur is gone for good — the round aborts. No traitor
      // reveal on an aborted round; the result is excluded from KPIs (FR-25).
      if (this.telemetrySink !== null) {
        this.telemetrySink.recordRoundEnded(
          'aborted',
          'saboteur-disconnected',
          null,
          this.roundTick,
        )
        this.flushTelemetry()
      }
      this.movement.leave(sessionId)
      this.router.toAll('round:ended', {
        winner: 'aborted',
        reason: 'saboteur-disconnected',
        saboteurId: null,
      })
      this.finishRound()
      return
    }
    // REND-19: an idle ghost — out of live play (win checks count them out),
    // silently; the roster entry stays so the recap still resolves the name.
    sim.ghost(sessionId)
    this.movement.leave(sessionId)
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
    // FR-25 (cycle 2.9): expired seats' roster entries are purged at the next
    // round start — ghosts free their slot exactly when a new deal begins.
    for (const [sessionId, seat] of this.players) {
      if (!seat.connected) this.players.delete(sessionId)
    }
    // Round-end journal reset (cycle 2.9): a fresh deal starts a fresh recap.
    this.roundTick = 0
    this.rideJournal = []
    this.lastRiders.clear()
    // Seed the cars' known floors so the first ride leg has a real `from`.
    for (const car of this.movement.carFloors()) this.carFloor.set(car.car, car.floor)
    // Positions persist across start/buzzer (MOVE-07): the movement layer is
    // phase-free and simply keeps running.
    const playerIds = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => p.sessionId)
    // Seed never leaves the server: it appears in no event and no payload.
    const shiftTicks = testShiftTicks()
    const seed = randomInt(2 ** 31)
    this.sim = new RoundSim({
      seed,
      playerIds,
      // Guest-traffic economy (cycle 3.1, AD-028): the sim drives NPC guests
      // through the room's movement layer via the NPC-only port.
      movement: this.guestPort(),
      ...(testGuestTiming() === undefined ? {} : { guestTiming: testGuestTiming() }),
      ...(shiftTicks === undefined ? {} : { totalTicks: shiftTicks }),
    })
    this.openTelemetry(seed, this.sim.saboteurId)
    // AD-040 ambush authority (design: the AD-028 adapter inverted): the room
    // pushes its role/liveness view INTO the movement layer at round start.
    // The sim's own REND-02 liveness rule is the single home of "live staff".
    this.movement.setAmbushAuthority({
      isSaboteur: (id) => this.sim?.saboteurId === id,
      isLiveStaff: (id) => this.sim?.isLiveStaff(id) ?? false,
    })
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

  /** One fixed 0.05 s step; the production interval and the test hook share this path. */
  private advance() {
    // Movement runs in BOTH phases (AD-005); the round sim only in round.
    // AD-026: riders before the tick — a PENDING exit (a direction held
    // through the opening swing) applies inside the sim, so the rider→floor
    // transition is detected here and the exit snapshot still goes out.
    const ridersBefore: string[] = []
    for (const sessionId of this.players.keys()) {
      if (this.movement.viewOf(sessionId).car !== null) ridersBefore.push(sessionId)
    }
    for (const event of this.movement.tick()) {
      this.router.route(event)
      this.journalMovement(event)
      if (this.telemetrySink !== null) {
        if (event.type === 'elevator:called')
          this.telemetrySink.recordElevatorCall(event.floor, event.car, undefined, this.roundTick)
        else if (event.type === 'elevator:moved')
          this.telemetrySink.recordElevatorRide(event.car, event.floor, this.roundTick)
        else if (event.type === 'elevator:doors')
          this.telemetrySink.recordElevatorDoors(event.car, event.floor, event.open, this.roundTick)
      }
    }
    for (const sessionId of ridersBefore) {
      if (!this.players.has(sessionId)) continue
      if (this.movement.viewOf(sessionId).car === null) this.sendExitSnapshot(sessionId)
    }
    const sim = this.sim
    if (sim === null || this.phase !== 'round') {
      // No round — still flush any movement telemetry that was just recorded.
      if (this.telemetrySink !== null) this.flushTelemetry()
      return
    }
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
      if (this.telemetrySink !== null) {
        if (event.type === 'room:prepped' || event.type === 'room:trashed') {
          const prov = event.type === 'room:trashed' ? ('sabotage' as const) : ('none' as const)
          const state = event.type === 'room:prepped' ? ('prepped' as const) : ('trashed' as const)
          this.telemetrySink.recordRoomTransition(
            event.floor as any,
            event.room as any,
            undefined,
            state,
            prov,
            this.roundTick,
          )
        } else if (event.type === 'guest:arrived')
          this.telemetrySink.recordGuestArrived(event.guestId, this.roundTick)
        else if (event.type === 'guest:assigned')
          this.telemetrySink.recordGuestAssigned(
            event.guestId,
            event.floor as any,
            event.room as any,
            this.roundTick,
          )
        else if (event.type === 'guest:self_assigned')
          this.telemetrySink.recordGuestSelfAssigned(
            event.guestId,
            event.floor as any,
            event.room as any,
            this.roundTick,
          )
        else if (event.type === 'suitcase:carried')
          this.telemetrySink.recordSuitcaseCarried(event.guestId, event.carrierId, this.roundTick)
        else if (event.type === 'suitcase:placed')
          this.telemetrySink.recordSuitcasePlaced(
            event.guestId,
            event.floor as any,
            event.room as any,
            this.roundTick,
          )
        else if (event.type === 'suitcase:picked_up')
          this.telemetrySink.recordSuitcasePickedUp(event.guestId, event.carrierId, this.roundTick)
        else if (event.type === 'guest:settled')
          this.telemetrySink.recordGuestSettled(
            event.guestId,
            event.floor as any,
            event.room as any,
            this.roundTick,
          )
        else if (event.type === 'guest:checked_out')
          this.telemetrySink.recordGuestCheckedOut(
            event.guestId,
            event.floor as any,
            event.room as any,
            this.roundTick,
          )
        else if (event.type === 'guest:left')
          this.telemetrySink.recordGuestLeft(event.guestId, this.roundTick)
        else if (event.type === 'guest:angered')
          this.telemetrySink.recordGuestAngered(
            event.guestId,
            event.floor as any,
            event.room as any,
            this.roundTick,
          )
        else if (event.type === 'guest:discovered') {
          const prov = event.fresh ? ('sabotage' as const) : ('churn' as const)
          this.telemetrySink.recordGuestDiscovered(
            event.guestId,
            event.floor as any,
            event.room as any,
            event.fresh,
            prov,
            prov === 'sabotage' ? sim.saboteurId : undefined,
            this.roundTick,
          )
        } else if (event.type === 'guest:complained')
          this.telemetrySink.recordGuestComplained(
            event.guestId,
            event.floor as any,
            event.room as any,
            this.roundTick,
          )
        else if (event.type === 'room:tenancy')
          this.telemetrySink.recordTenancy(
            event.floor as any,
            event.room as any,
            event.occupied,
            this.roundTick,
          )
        else if (event.type === 'player:fired' && event.reason === 'carry-clock')
          this.telemetrySink.recordCarryClockExpiry(event.playerId, this.roundTick)
        else if (event.type === 'round:ended')
          this.telemetrySink.recordRoundEnded(
            event.winner as any,
            event.reason as any,
            event.saboteurId as any,
            this.roundTick,
          )
      }
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
    if (this.telemetrySink !== null) {
      let preppedCount = 0
      try {
        const rs = sim.roomStates()
        for (const r of rs) if (r.state === 'prepped') preppedCount++
      } catch {}
      this.telemetrySink.sampleCoverage(this.roundTick, preppedCount)
      this.flushTelemetry()
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
    // The verdict's inputs ride the recap (cycle 3.D, AD-039): final settle
    // score vs the §7 target for the lobby size.
    const lobbySize = sim?.playerIds.length ?? this.players.size
    this.router.toAll('round:recap', {
      entries,
      settleScore: sim?.settledCount ?? 0,
      settleTarget: settleTargetFor(lobbySize),
      complaints: sim?.complaintCount ?? 0,
    })
    this.flushTelemetry()
    this.closeTelemetry()
    this.phase = 'results'
    // Roles were the sim's alone — dropping it wipes the deal (AD-002); the
    // reveal already happened on the wire, so nothing is lost.
    this.sim = null
    this.fired.clear()
    // AD-040: the ambush authority dies with the round (no ambush pre-round or
    // at results), and every stairs occupant resolves to their destination so
    // the results snapshots show honest positions (stun cleared, no breath).
    this.movement.setAmbushAuthority(null)
    this.movement.resolveStairsForResults()
    // Guests are round-scoped weather (cycle 3.1, GUEST-11): the sim is dead,
    // so their movers leave the phase-free movement layer — no guest state or
    // position streams survive into results/lobby.
    for (const guestId of this.movement.guestIds()) this.movement.leave(guestId)
    for (const sessionId of this.players.keys()) {
      this.router.toSelf('movement:snapshot', sessionId, this.movementSnapshotFor(sessionId))
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
    const base: SpectatorSnapshot = {
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
    if (sim !== null) {
      const ten = sim.allTenancies()
      if (ten.length !== 0) return { ...base, tenancies: ten }
    }
    return base
  }

  /** Test hook: drive the sim deterministically without wall-clock waits. */
  __driveTicks(count: number) {
    for (let i = 0; i < count; i++) this.advance()
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
  /**
   * Door-open exit = floor change (protocol rule: personal snapshots on
   * visibility change). The exiter's picture of the arrival floor is stale —
   * standing occupants emit no stream, so without this refresh they stay
   * invisible until they move. Same-floor occupants learn the arrival from
   * the exiter's own resumed player:moved stream. EVID-04: the arrival
   * floor's carded rooms ride along — cards are floor-public (FR-11) and the
   * round sim owns them (empty pre-round; cards die with the sim at the
   * buzzer, evidence is round-scoped). AD-026: also fired by the tick for a
   * PENDING exit (a direction held through the opening swing) — the sim
   * applies that hop-off itself, one intent-less tick later.
   */
  private sendExitSnapshot(sessionId: string): void {
    const arrivalFloor = this.movement.viewOf(sessionId).floor
    const cards =
      arrivalFloor !== null && arrivalFloor !== 'lobby' && arrivalFloor !== 'mezzanine'
        ? (this.sim?.cardedOn(arrivalFloor) ?? [])
        : []
    this.router.toSelf('movement:snapshot', sessionId, {
      ...this.movementSnapshotFor(sessionId, cards),
    })
  }

  private ensureLive(sessionId: string): boolean {
    if (!this.fired.has(sessionId)) return true
    this.router.toSelf('error', sessionId, {
      code: 'justice-rejected',
      message: 'you were fired — spectators cannot act',
    })
    return false
  }
}
