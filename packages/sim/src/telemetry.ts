import type { FloorId, GuestFloorId, RoomIndex, RoomState, TelemetryLine } from '@turnover/shared'

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
  recordGuestCheckedOut(guestId: string, floor: GuestFloorId, room: RoomIndex, tick: number): void {
    this.push({
      kind: 'guest-checked-out',
      tick,
      time: tick * TICK_MS,
      guestId,
      floor,
      roomIdx: room,
      room: `${floor}:${room}` as string,
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
