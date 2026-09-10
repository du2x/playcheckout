import type {
  CarId,
  CosmeticSeeds,
  FloorId,
  GuestFloorId,
  RecapEntry,
  RoomIndex,
  SpectatorSnapshot,
} from '@turnover/shared'
import { type MovementEvent, type MovementSnapshot, settleTargetFor } from '@turnover/shared'
import {
  type MovementSim,
  projectSimEventToTelemetry,
  type RoundSim,
  type TelemetrySink,
} from '@turnover/sim'
import type { Router, ViewContext } from './router'

/**
 * RoundPresenter (server-side, non-network): the round-scoped presentation
 * layer that used to live inside TurnoverRoom — snapshot assembly with its
 * sameFloor filters, the FR-22 ride journal, the fired/spectator policy, the
 * tick loop's routing + telemetry projection, seat-expiry resolution
 * (REND-19/20), and the results transition. The room remains the transport
 * shell: Colyseus lifecycle, zod intents, lobby roster, and the telemetry
 * file I/O; it feeds this module the movement sim, the router (the only
 * sender — bypass-denylist invariant intact), and a telemetry I/O bridge.
 *
 * The hidden-information rule is unchanged: everything here routes through
 * the registry's recipient policies; the presenter only decides WHAT the
 * room's view of the round is, never who receives it.
 *
 * One `viewContextOf` is the single home of the slotless-implies-spectator
 * predicate (a session with no position — fired teardown, or a dev spectator
 * who never joined movement — sees every floor's stream, FR-20); snapshots
 * reuse the same predicate instead of re-deriving it per section.
 */
export class RoundPresenter {
  constructor(
    private readonly movement: MovementSim,
    private readonly router: Router,
    private readonly io: {
      /** The room's live telemetry sink (null outside a round's file window). */
      readonly sink: () => TelemetrySink | null
      /** Drain the sink into the room's file stream. */
      readonly flush: () => void
      /** End the round's file stream (results transition). */
      readonly close: () => void
    },
  ) {}

  private sim: RoundSim | null = null
  private _phase: 'lobby' | 'round' | 'results' = 'lobby'
  private readonly fired = new Set<string>()
  private roundTick = 0
  private rideJournal: RecapEntry[] = []
  private readonly lastRiders = new Map<CarId, string[]>()
  private readonly carFloor = new Map<CarId, FloorId>()
  /** The round's stable participant ids (no joins mid-round; ghosts stay). */
  private participants: readonly string[] = []

  get phase(): 'lobby' | 'round' | 'results' {
    return this._phase
  }

  /** True while a round's tick loop and sim are live (round phase + sim). */
  get roundLive(): boolean {
    return this._phase === 'round' && this.sim !== null
  }

  /** The round sim, while it lives (roles die with it — AD-002). */
  simOf(): RoundSim | null {
    return this.sim
  }

  isFired(sessionId: string): boolean {
    return this.fired.has(sessionId)
  }

  /** Record one resolved accusation (telemetry FR-23): the room calls this
   *  from the accuse intent with the sim's verdict facts; the tick stamp is
   *  the presenter's (the room no longer keeps a round clock). Flushed by
   *  the next tick like every other line. */
  recordAccusation(
    accuserId: string,
    targetId: string,
    wasTargetSaboteur: boolean,
    crimeOccurred: boolean,
  ): void {
    this.io
      .sink()
      ?.recordAccusation(accuserId, targetId, wasTargetSaboteur, crimeOccurred, this.roundTick)
  }

  /** A fresh deal: the presenter resets its round-scoped state around the
   *  new sim and takes the participant roster (already purged by the room). */
  startRound(sim: RoundSim, participants: readonly string[]): void {
    this.sim = sim
    this._phase = 'round'
    this.fired.clear()
    this.roundTick = 0
    this.rideJournal = []
    this.lastRiders.clear()
    // Seed the cars' known floors so the first ride leg has a real `from`.
    for (const car of this.movement.carFloors()) this.carFloor.set(car.car, car.floor)
    this.participants = participants
  }

  /** The Router's per-connection view: positions plus the spectator flag —
   *  the ONE home of the slotless predicate (see class doc). */
  viewContextOf(sessionId: string): ViewContext {
    const view = this.movement.viewOf(sessionId)
    const slotless =
      view.floor === null && view.roomKey === null && view.car === null && view.x === null
    return { ...view, spectator: slotless }
  }

  /**
   * The personal movement snapshot, enriched with the round-scoped facts the
   * movement layer cannot see: resting suitcases (cycle 3.B) and tenancy
   * signs (cycle 3.4) sameFloor-filtered, spectators seeing every floor's;
   * cosmetic seeds (Phase 4.1, VPOL-05) with every player's public seed and
   * the sameFloor guest rows.
   */
  movementSnapshotFor(sessionId: string, cardedRooms?: readonly RoomIndex[]): MovementSnapshot {
    let snap: MovementSnapshot =
      cardedRooms === undefined
        ? this.movement.snapshotFor(sessionId)
        : this.movement.snapshotFor(sessionId, cardedRooms)
    const sim = this.sim
    if (sim === null) return snap
    const view = this.movement.viewOf(sessionId)
    const spectator =
      view.floor === null && view.roomKey === null && view.car === null && view.x === null
    // Resting suitcases — sameFloor-filtered
    const allSuit = sim.restingSuitcases()
    if (allSuit.length !== 0) {
      const visible = spectator ? allSuit : allSuit.filter((r) => r.floor === view.floor)
      if (visible.length !== 0) snap = { ...snap, suitcases: visible }
    }
    // Tenancy signs — sameFloor-filtered like suitcases
    const tenancies = spectator ? sim.allTenancies() : sim.tenanciesOn(view.floor as FloorId)
    if (tenancies.length !== 0) snap = { ...snap, tenancies }
    // Cosmetic seeds: every player's seed is public identity; guest seeds ride
    // the sameFloor guest rows this snapshot already carries. Spectators (fired
    // overview) receive every guest seed.
    const seedRows: CosmeticSeeds = (() => {
      const players = sim.allPlayerSeeds()
      const guestRows = spectator
        ? sim.allGuestSeeds()
        : (snap.guests ?? [])
            .map((g) => ({ guestId: g.guestId, seed: sim.guestSeedOf(g.guestId) }))
            .filter((r): r is { guestId: string; seed: number } => r.seed !== undefined)
      return guestRows.length !== 0 ? { players, guests: guestRows } : { players }
    })()
    return { ...snap, cosmeticSeeds: seedRows }
  }

  /** The FR-20 spectator baseline (fired sessions + dev spectators): the
   *  whole world. */
  spectatorSnapshot(): SpectatorSnapshot {
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
      // Cosmetic seeds (Phase 4.1, VPOL-05): the spectator baseline carries
      // every player and guest seed (full-building overview, FR-20).
      const cosmeticSeeds = { players: sim.allPlayerSeeds(), guests: sim.allGuestSeeds() }
      return ten.length !== 0
        ? { ...base, tenancies: ten, cosmeticSeeds }
        : { ...base, cosmeticSeeds }
    }
    return base
  }

  /**
   * The window closed without reconnection, round live — FR-25 resolution:
   * the saboteur's expiry aborts the round (REND-20, no traitor reveal, the
   * result is excluded from KPIs); a staff expiry ghosts them silently
   * (REND-19, the roster entry stays so the recap still resolves the name).
   * The room owns WHEN (the 60 s seat timer); this owns WHAT the expiry means.
   */
  expireSeat(sessionId: string): void {
    const sim = this.sim
    if (sim === null) return
    if (sim.saboteurId === sessionId) {
      const sink = this.io.sink()
      if (sink !== null) {
        sink.recordRoundEnded('aborted', 'saboteur-disconnected', null, this.roundTick)
        this.io.flush()
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
    sim.ghost(sessionId)
    this.movement.leave(sessionId)
  }

  /** One fixed 0.05 s step; the production interval and the test hook share this path. */
  tick() {
    // Movement runs in BOTH phases (AD-005); the round sim only in round.
    // AD-026: riders before the tick — a PENDING exit (a direction held
    // through the opening swing) applies inside the sim, so the rider→floor
    // transition is detected here and the exit snapshot still goes out.
    const ridersBefore: string[] = []
    for (const sessionId of this.participants) {
      if (this.movement.viewOf(sessionId).car !== null) ridersBefore.push(sessionId)
    }
    const movementSink = this.io.sink()
    for (const event of this.movement.tick()) {
      this.router.route(event)
      this.journalMovement(event)
      // Stairs arrival (AD-040): the transit→breath flip is a visibility
      // change — the arrival flush player:moved is the breather's only event,
      // so it doubles as the trigger for their exit-style personal snapshot
      // (the destination floor's standing occupants emit no stream; without
      // this refresh the breather cannot see them until they move).
      if (event.type === 'player:moved') {
        if (this.movement.stairsStateOf(event.playerId)?.phase === 'breath') {
          this.sendExitSnapshot(event.playerId)
        }
      }
      if (movementSink !== null) {
        if (event.type === 'elevator:called')
          movementSink.recordElevatorCall(event.floor, event.car, undefined, this.roundTick)
        else if (event.type === 'elevator:moved')
          movementSink.recordElevatorRide(event.car, event.floor, this.roundTick)
        else if (event.type === 'elevator:doors')
          movementSink.recordElevatorDoors(event.car, event.floor, event.open, this.roundTick)
      }
    }
    for (const sessionId of ridersBefore) {
      if (!this.participants.includes(sessionId)) continue
      if (this.movement.viewOf(sessionId).car === null) this.sendExitSnapshot(sessionId)
    }
    const sim = this.sim
    if (sim === null || this._phase !== 'round') {
      // No round — still flush any movement telemetry that was just recorded.
      if (movementSink !== null) this.io.flush()
      return
    }
    // AD-005 seam: the work channels consume the movement layer's positions
    // (integer millitiles) — inside-segment validation, walk-out cancels,
    // and room observation all derive from them.
    const positions = new Map<string, { floor: FloorId; x: number }>()
    for (const sessionId of this.participants) {
      const p = this.movement.positionOf(sessionId)
      if (p !== undefined) {
        positions.set(sessionId, { floor: p.floor, x: Math.round(p.x * 1000) })
      }
    }
    let roundEnded = false
    const sink = this.io.sink()
    const projectionCtx = { saboteurId: sim.saboteurId }
    for (const event of sim.tick(positions)) {
      this.router.route(event)
      // The telemetry projection is a table row per event kind
      // (packages/sim/src/telemetry.ts) — the tick loop never names one.
      if (sink !== null) projectSimEventToTelemetry(sink, event, this.roundTick, projectionCtx)
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
    if (sink !== null) {
      let preppedCount = 0
      try {
        const rs = sim.roomStates()
        for (const r of rs) if (r.state === 'prepped') preppedCount++
      } catch {}
      sink.sampleCoverage(this.roundTick, preppedCount)
      this.io.flush()
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
    const lobbySize = sim?.playerIds.length ?? this.participants.length
    this.router.toAll('round:recap', {
      entries,
      settleScore: sim?.settledCount ?? 0,
      settleTarget: settleTargetFor(lobbySize),
      complaints: sim?.complaintCount ?? 0,
    })
    this.io.flush()
    this.io.close()
    this._phase = 'results'
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
    for (const sessionId of this.participants) {
      this.router.toSelf('movement:snapshot', sessionId, this.movementSnapshotFor(sessionId))
    }
  }

  /**
   * FR-22 ride journal (cycle 2.9): the presenter observes the movement
   * events it routes — `elevator:riders` refreshes the known occupant set,
   * and every real floor change is one ride leg carrying the riders at that
   * moment. Occupancy/validity on the recap is legal because the round is
   * over.
   */
  private journalMovement(event: MovementEvent): void {
    if (this._phase !== 'round') return
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
  sendExitSnapshot(sessionId: string): void {
    const arrivalFloor = this.movement.viewOf(sessionId).floor
    const cards =
      arrivalFloor !== null && arrivalFloor !== 'lobby' && arrivalFloor !== 'mezzanine'
        ? (this.sim?.cardedOn(arrivalFloor) ?? [])
        : []
    this.router.toSelf('movement:snapshot', sessionId, {
      ...this.movementSnapshotFor(sessionId, cards),
    })
  }
}
