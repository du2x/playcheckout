import type {
  FloorId,
  GuestFloorId,
  RoomIndex,
  RoomState,
  SimEvent,
  TelemetryLine,
} from '@turnover/shared'

const TICK_MS = 50
const COVERAGE_PERIOD_TICKS = 20 // 1s at 20 Hz

export class TelemetrySink {
  private readonly lines: TelemetryLine[] = []
  private ended = false

  constructor(
    readonly _saboteurId: string | null,
    readonly _seed: number,
  ) {}

  private push(line: TelemetryLine): void {
    if (this.ended) return
    this.lines.push(line)
  }

  recordRoomTransition(
    floor: GuestFloorId,
    room: RoomIndex,
    actor: string | undefined,
    state: RoomState,
    provenance: 'sabotage' | 'churn' | 'none',
    tick: number,
  ): void {
    const line: TelemetryLine = {
      kind: 'room-transition',
      tick,
      time: tick * TICK_MS,
      room: `${floor}:${room}`,
      floor,
      roomIdx: room,
      state,
      provenance,
      ...(actor !== undefined ? { actor } : {}),
    }
    this.push(line)
  }

  /** Convenience from SimEvent room:prepped/trashed (actor omitted for churn). */
  recordSimRoom(
    event: { type: 'room:prepped' | 'room:trashed'; floor: GuestFloorId; room: RoomIndex },
    tick: number,
    actor: string | undefined,
    provenance: 'sabotage' | 'churn' | 'none' = event.type === 'room:trashed' ? 'sabotage' : 'none',
  ): void {
    const state: RoomState = event.type === 'room:prepped' ? 'prepped' : 'trashed'
    this.recordRoomTransition(event.floor, event.room, actor, state, provenance, tick)
  }

  recordElevatorCall(floor: FloorId, car: number, actor: string | undefined, tick: number): void {
    this.push({
      kind: 'elevator-call',
      tick,
      time: tick * TICK_MS,
      floor,
      car: car as 1 | 2,
      ...(actor !== undefined ? { actor } : {}),
    })
  }

  recordElevatorRide(car: number, floor: FloorId, tick: number): void {
    this.push({
      kind: 'elevator-ride',
      tick,
      time: tick * TICK_MS,
      car: car as 1 | 2,
      floor,
    })
  }

  recordElevatorDoors(car: number, floor: FloorId, open: boolean, tick: number): void {
    this.push({
      kind: 'elevator-doors',
      tick,
      time: tick * TICK_MS,
      car: car as 1 | 2,
      floor,
      open,
    })
  }

  recordWalkIn(entrantId: string, saboteurId: string, tick: number): void {
    this.push({
      kind: 'walk-in-catch',
      tick,
      time: tick * TICK_MS,
      actor: entrantId,
      caughtPlayer: saboteurId,
    })
  }

  recordAccusation(
    accuserId: string,
    targetId: string,
    wasTargetSaboteur: boolean,
    crimeOccurred: boolean,
    tick: number,
  ): void {
    this.push({
      kind: 'accusation',
      tick,
      time: tick * TICK_MS,
      actor: accuserId,
      targetId,
      wasTargetSaboteur,
      crimeOccurred,
    })
  }

  recordCarryClockExpiry(carrierId: string, tick: number): void {
    this.push({
      kind: 'carry-clock-expiry',
      tick,
      time: tick * TICK_MS,
      actor: carrierId,
    })
  }

  // --- Guest extension (T3) stubs kept here for single class; T3 fills them ---

  recordGuestArrived(guestId: string, tick: number): void {
    this.push({ kind: 'guest-arrived', tick, time: tick * TICK_MS, guestId })
  }
  recordGuestAssigned(guestId: string, floor: GuestFloorId, room: RoomIndex, tick: number): void {
    this.push({
      kind: 'guest-assigned',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
    })
  }
  recordGuestSelfAssigned(
    guestId: string,
    floor: GuestFloorId,
    room: RoomIndex,
    tick: number,
  ): void {
    this.push({
      kind: 'guest-self-assigned',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
    })
  }
  recordSuitcaseCarried(guestId: string, carrierId: string, tick: number): void {
    this.push({ kind: 'suitcase-carried', tick, time: tick * TICK_MS, guestId, carrierId })
  }
  recordSuitcasePlaced(guestId: string, floor: GuestFloorId, room: RoomIndex, tick: number): void {
    this.push({
      kind: 'suitcase-placed',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
    })
  }
  recordSuitcasePickedUp(guestId: string, carrierId: string, tick: number): void {
    this.push({ kind: 'suitcase-picked-up', tick, time: tick * TICK_MS, guestId, carrierId })
  }
  recordGuestSettled(guestId: string, floor: GuestFloorId, room: RoomIndex, tick: number): void {
    this.push({
      kind: 'guest-settled',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
    })
  }
  recordGuestCheckedOut(
    guestId: string,
    floor: GuestFloorId,
    room: RoomIndex,
    tick: number,
    preRound = false,
  ): void {
    this.push({
      kind: 'guest-checked-out',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
      ...(preRound ? { preRound: true } : {}),
    })
  }
  recordGuestLeft(guestId: string, tick: number): void {
    this.push({ kind: 'guest-left', tick, time: tick * TICK_MS, guestId })
  }
  recordGuestAngered(guestId: string, floor: GuestFloorId, room: RoomIndex, tick: number): void {
    this.push({
      kind: 'guest-angered',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
    })
  }
  recordGuestDiscovered(
    guestId: string,
    floor: GuestFloorId,
    room: RoomIndex,
    fresh: boolean,
    provenance: 'sabotage' | 'churn',
    actorId: string | undefined,
    tick: number,
  ): void {
    this.push({
      kind: 'guest-discovered',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
      fresh,
      provenance,
      ...(actorId !== undefined ? { actorId } : {}),
    })
  }
  recordGuestComplained(guestId: string, floor: GuestFloorId, room: RoomIndex, tick: number): void {
    this.push({
      kind: 'guest-complained',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
    })
  }
  recordTenancy(floor: GuestFloorId, room: RoomIndex, occupied: boolean, tick: number): void {
    this.push({
      kind: 'tenancy',
      tick,
      time: tick * TICK_MS,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
      occupied,
    })
  }

  sampleCoverage(tick: number, preppedCount: number): void {
    if (tick % COVERAGE_PERIOD_TICKS !== 0) return
    this.push({
      kind: 'coverage-sample',
      tick,
      time: tick * TICK_MS,
      coverage: preppedCount / 24,
    })
  }

  recordRoundEnded(
    winner: 'staff' | 'saboteur' | 'aborted',
    reason: string,
    saboteurId: string | null,
    tick: number,
  ): void {
    this.push({
      kind: 'round-ended',
      tick,
      time: tick * TICK_MS,
      winner,
      reason,
      saboteurId,
    })
    this.ended = true
  }

  markEnded(_tick: number): void {
    if (!this.ended) this.ended = true
  }

  getLines(): readonly TelemetryLine[] {
    return this.lines
  }

  drain(): TelemetryLine[] {
    return this.lines.splice(0)
  }

  toJSONL(): string[] {
    return this.getLines().map((l) => JSON.stringify(l))
  }

  /** For aborted rounds — still close marker so KPI can exclude. */
  isEnded(): boolean {
    return this.ended
  }
}

export type { Kpis, TelemetryLine } from '@turnover/shared'

// --- Sim event → telemetry projection table (2026-09-10): ONE row per
// tracked sim event kind. This is the internal-stream sibling of the
// registry's `fromSim` projections — the registry stays the WIRE audit
// surface (telemetry never touches the wire, FR-23), so the table lives
// here beside the sink, not in `shared/protocol`. A new sim event kind is
// one compile error away from a conscious tracking decision:
// `ALL_SIM_EVENT_TYPES` is type-checked exhaustive against the SimEvent
// union, and the completeness test requires every kind to sit in exactly
// one of the table or `UNTRACKED_SIM_EVENTS`. Before this table the same
// mapping was an if/else in the tick loop that drifted silently (a new
// event simply was not logged).
//
// Known-honest gap, surfaced by the 2026-09-10 audit and left open on
// purpose: `recordAccusation` / `recordWalkIn` have no production caller —
// the accuse intent and justice walk-in catches are not recorded, so the
// `correctAccusationRate` / `catchesPerHour` / `meanTimeToFirstCrime` /
// `decoyCallRate` KPI fields read from nothing in real rounds. Wiring them
// changes what rounds record and is a deliberate follow-up, not drift.

/** Extra round facts a row may need (the event stream does not carry them). */
export interface TelemetryProjectionCtx {
  /** The round's saboteur — `guest:discovered` sabotage rows name the actor. */
  readonly saboteurId: string
}

type ProjectionRow<K extends SimEvent['type']> = (
  event: Extract<SimEvent, { type: K }>,
  sink: TelemetrySink,
  tick: number,
  ctx: TelemetryProjectionCtx,
) => void

export const TELEMETRY_PROJECTIONS: { readonly [K in SimEvent['type']]?: ProjectionRow<K> } = {
  'room:prepped': (e, sink, tick) =>
    sink.recordRoomTransition(
      e.floor as GuestFloorId,
      e.room as RoomIndex,
      undefined,
      'prepped',
      'none',
      tick,
    ),
  'room:trashed': (e, sink, tick) =>
    sink.recordRoomTransition(
      e.floor as GuestFloorId,
      e.room as RoomIndex,
      undefined,
      'trashed',
      'sabotage',
      tick,
    ),
  'guest:arrived': (e, sink, tick) => sink.recordGuestArrived(e.guestId, tick),
  'guest:assigned': (e, sink, tick) =>
    sink.recordGuestAssigned(e.guestId, e.floor as GuestFloorId, e.room as RoomIndex, tick),
  'guest:self_assigned': (e, sink, tick) =>
    sink.recordGuestSelfAssigned(e.guestId, e.floor as GuestFloorId, e.room as RoomIndex, tick),
  'suitcase:carried': (e, sink, tick) => sink.recordSuitcaseCarried(e.guestId, e.carrierId, tick),
  'suitcase:placed': (e, sink, tick) =>
    sink.recordSuitcasePlaced(e.guestId, e.floor as GuestFloorId, e.room as RoomIndex, tick),
  'suitcase:picked_up': (e, sink, tick) =>
    sink.recordSuitcasePickedUp(e.guestId, e.carrierId, tick),
  'guest:settled': (e, sink, tick) =>
    sink.recordGuestSettled(e.guestId, e.floor as GuestFloorId, e.room as RoomIndex, tick),
  'guest:checked_out': (e, sink, tick) =>
    sink.recordGuestCheckedOut(
      e.guestId,
      e.floor as GuestFloorId,
      e.room as RoomIndex,
      tick,
      e.preRound === true,
    ),
  'guest:left': (e, sink, tick) => sink.recordGuestLeft(e.guestId, tick),
  'guest:angered': (e, sink, tick) =>
    sink.recordGuestAngered(e.guestId, e.floor as GuestFloorId, e.room as RoomIndex, tick),
  'guest:discovered': (e, sink, tick, ctx) => {
    const prov = e.fresh ? ('sabotage' as const) : ('churn' as const)
    sink.recordGuestDiscovered(
      e.guestId,
      e.floor as GuestFloorId,
      e.room as RoomIndex,
      e.fresh,
      prov,
      prov === 'sabotage' ? ctx.saboteurId : undefined,
      tick,
    )
  },
  'guest:complained': (e, sink, tick) =>
    sink.recordGuestComplained(e.guestId, e.floor as GuestFloorId, e.room as RoomIndex, tick),
  'room:tenancy': (e, sink, tick) =>
    sink.recordTenancy(e.floor as GuestFloorId, e.room as RoomIndex, e.occupied, tick),
  'player:fired': (e, sink, tick) => {
    if (e.reason === 'carry-clock') sink.recordCarryClockExpiry(e.playerId, tick)
  },
  'round:ended': (e, sink, tick) =>
    sink.recordRoundEnded(e.winner as 'staff' | 'saboteur', e.reason, e.saboteurId, tick),
}

/** Sim event kinds with no telemetry row — named so the completeness audit
 *  can tell "deliberately untracked" from "drifted away". */
export const UNTRACKED_SIM_EVENTS = [
  'round:started',
  'role:dealt',
  'round:buzzer',
  'work:started',
  'work:ended',
  'room:observed',
  'room:carded',
  'room:settled',
  'room:rustle',
  'room:entered',
  'guest:impatient',
  'cosmetic:player',
  'cosmetic:guest',
] as const satisfies readonly SimEvent['type'][]

/** Every SimEvent kind, spelled out for the runtime completeness audit; the
 *  assertion under the list fails the build when the union grows without
 *  this list growing with it. */
export const ALL_SIM_EVENT_TYPES = [
  'round:started',
  'role:dealt',
  'round:buzzer',
  'work:started',
  'work:ended',
  'room:observed',
  'room:prepped',
  'room:trashed',
  'room:carded',
  'room:settled',
  'room:rustle',
  'room:entered',
  'player:fired',
  'round:ended',
  'guest:arrived',
  'guest:impatient',
  'guest:self_assigned',
  'guest:settled',
  'guest:checked_out',
  'guest:left',
  'guest:assigned',
  'suitcase:carried',
  'suitcase:placed',
  'suitcase:picked_up',
  'guest:complained',
  'guest:angered',
  'guest:discovered',
  'room:tenancy',
  'cosmetic:player',
  'cosmetic:guest',
] as const satisfies readonly SimEvent['type'][]

type AllSimEventTypesCovered = [
  Exclude<SimEvent['type'], (typeof ALL_SIM_EVENT_TYPES)[number]>,
] extends [never]
  ? true
  : ['UNCOVERED', Exclude<SimEvent['type'], (typeof ALL_SIM_EVENT_TYPES)[number]>]
const ALL_SIM_EVENT_TYPES_ARE_EXHAUSTIVE: AllSimEventTypesCovered = true

/** Route one sim event into the sink through its table row (a no-op for the
 *  deliberately untracked kinds). The caller owns flushing. */
export function projectSimEventToTelemetry(
  sink: TelemetrySink,
  event: SimEvent,
  tick: number,
  ctx: TelemetryProjectionCtx,
): void {
  const row = TELEMETRY_PROJECTIONS[event.type] as ProjectionRow<SimEvent['type']> | undefined
  row?.(event, sink, tick, ctx)
}
