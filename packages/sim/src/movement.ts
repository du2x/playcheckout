import type { MovementEvent, RoomIndex } from '@turnover/shared'
import {
  FLOOR_IDS,
  type FloorId,
  HALL_LENGTH_TILES,
  roomIndexAtMilli,
  TUNING,
} from '@turnover/shared'
import { TICK_HZ } from './tick.js'

/**
 * Pure movement sim (cycle 2.4, AD-005): the room's always-running spatial
 * substrate. Inputs + time in, events out — no I/O, no clocks, no randomness.
 * The room drives one `tick()` per 50 ms interval in BOTH phases; the buzzer
 * and host-start never clear it, so positions persist across lobby→round→lobby.
 *
 * Positions are integer MILLITILES (×1000) so integration is bit-for-bit
 * reproducible: per-tick displacement is the §7 speed expressed in millitiles
 * divided by TICK_HZ (an exact integer). Wire values are tiles (millit / 1000).
 */

const MILLI = 1000
/** Millitiles per tick at the §7 speed (exact integer, no float drift). */
export const SPEED_MILLI_PER_TICK = (TUNING.PLAYER_SPEED_TILES_PER_SEC * MILLI) / TICK_HZ
export const HALL_MAX_MILLI = HALL_LENGTH_TILES * MILLI
/** Elevator cycle in ticks, derived from §7 (3 s arrival, 2 s per floor). */
export const ARRIVE_TICKS = TUNING.ELEVATOR_ARRIVE_SECONDS * TICK_HZ
export const RIDE_TICKS_PER_FLOOR = TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR * TICK_HZ
/** Open-door dwell at every stop, derived from §7-external ELEVATOR_DWELL_SECONDS. */
export const DWELL_TICKS = TUNING.ELEVATOR_DWELL_SECONDS * TICK_HZ
/** West (car 1) and east (car 2) landings, same x on every level (FR-5). */
export const CAR_LANDING_MILLI: Record<1 | 2, number> = { 1: 0, 2: HALL_MAX_MILLI }

export type MoveDir = 'left' | 'right'

interface PlayerMoveState {
  floor: FloorId
  x: number
  facing: MoveDir
  moving: MoveDir | null
  inCar: 1 | 2 | null
  /** Event owed without an x change: facing flip, or move end (one terminal
   *  rest-x event so clients reconcile prediction overshoot — MOVE-02/03
   *  amendment). */
  facingDirty: boolean
}

type CarPhase = 'idle' | 'arriving' | 'dwelling' | 'riding'

/**
 * Per-car elevator state (AD-014 rider rework): a four-phase machine —
 * idle/arriving/dwelling/riding; idle and dwelling are the open-door phases.
 * The FIFO press `queue` belongs to the CAR, not the presser: walk-offs never
 * clear it (ghost trips). `exitedThisStop` is the door-open-episode guard —
 * a player who exits cannot re-board until the car next DEPARTS.
 */
interface CarState {
  floor: FloorId
  riders: string[]
  phase: CarPhase
  ticksLeft: number
  pickup: FloorId | null
  queue: FloorId[]
  exitedThisStop: Set<string>
}

/**
 * Queued call (sim-level FIFO): dispatched when a car next frees. Calls carry
 * NO destination (AD-014) — the pickup floor is the whole request.
 */
interface QueuedCall {
  playerId: string
  pickup: FloorId
}

/**
 * Pending announce for the next tick (MOVE-10 pattern): call flashes (public)
 * and accepted in-car presses (rider-exclusive — routed by the `riders`
 * policy, AD-013).
 */
type PendingAnnounce =
  | { kind: 'called'; floor: FloorId; car: 1 | 2 }
  | { kind: 'pressed'; playerId: string; floor: FloorId; car: 1 | 2 }
  | { kind: 'riders'; car: 1 | 2 }

export class MovementSim {
  private phase: 'lobby' | 'round' = 'lobby'
  private readonly players = new Map<string, PlayerMoveState>()
  private readonly cars: Record<1 | 2, CarState> = {
    1: {
      floor: 'lobby',
      riders: [],
      phase: 'idle',
      ticksLeft: 0,
      pickup: null,
      queue: [],
      exitedThisStop: new Set(),
    },
    2: {
      floor: 'lobby',
      riders: [],
      phase: 'idle',
      ticksLeft: 0,
      pickup: null,
      queue: [],
      exitedThisStop: new Set(),
    },
  }
  private callQueue: QueuedCall[] = []
  private announced: PendingAnnounce[] = []
  /** Cars whose rider list changed since the last tick — one coalesced
   * `elevator:riders` per dirty car at tick start (AD-013). */
  private ridersDirty: (1 | 2)[] = []

  // --- roster / lifecycle -------------------------------------------------

  /** Fresh-joiner placement (FR-2 "spawn"): lobby center, facing right. */
  join(playerId: string): void {
    this.players.set(playerId, {
      floor: 'lobby',
      x: HALL_MAX_MILLI / 2,
      facing: 'right',
      moving: null,
      inCar: null,
      facingDirty: false,
    })
  }

  leave(playerId: string): void {
    this.players.delete(playerId)
    for (const id of [1, 2] as const) {
      const car = this.cars[id]
      if (car.riders.includes(playerId)) {
        car.riders = car.riders.filter((r) => r !== playerId)
        this.markRidersDirty(id) // disconnect-dirty flush: one update next tick
      }
    }
  }

  /** Queue a rider-list update for the next tick — one per car, coalesced. */
  private markRidersDirty(carId: 1 | 2): void {
    if (!this.ridersDirty.includes(carId)) this.ridersDirty.push(carId)
  }

  // --- intents ------------------------------------------------------------

  /**
   * Hold-to-walk. Idempotent while held; in lobby phase confined to the grand
   * lobby floor (MOVE-08). A direction change flips facing immediately.
   *
   * AD-014 door-open exit: a rider holding a direction while their car's doors
   * are open (idle or dwelling) exits the car THIS intent — placed at the
   * car's landing in any phase (MOVE-08 confinement applies only to hallway
   * walking AFTER exit). While the doors are shut (arriving/riding) the intent
   * is still ignored (MOVE-09): positions change only via the car.
   */
  startMove(playerId: string, dir: MoveDir): void {
    const p = this.players.get(playerId)
    if (p === undefined) return
    if (p.inCar !== null) {
      const carId = p.inCar
      const car = this.cars[carId]
      if (car.phase === 'arriving' || car.phase === 'riding') return
      p.inCar = null
      p.floor = car.floor
      p.x = CAR_LANDING_MILLI[carId]
      car.riders = car.riders.filter((r) => r !== playerId)
      this.markRidersDirty(carId) // walk-off: remaining riders get the update
      // Door-open-episode guard: exiting is final for this stop — the board
      // filter excludes the exiter until the car next departs (no oscillation:
      // clearing the boarding radius takes ~4 ticks, and a pre-round exiter at
      // a guest floor cannot walk at all).
      car.exitedThisStop.add(playerId)
      p.facing = dir
      p.facingDirty = true // the same-floor player:moved stream resumes next tick
      p.moving = this.phase === 'round' || p.floor === 'lobby' ? dir : null
      return
    }
    if (this.phase === 'lobby' && p.floor !== 'lobby') return
    p.facing = dir
    if (p.moving === dir) return
    p.facingDirty = true
    p.moving = dir
  }

  /** Release-to-stop; a no-op when no move is active (spec edge). Emits one
   *  terminal `player:moved` on the next tick so clients reconcile the own
   *  rectangle to the authoritative rest x (prediction overshoot is never
   *  corrected otherwise — stop ends the move-stream). */
  stopMove(playerId: string): void {
    const p = this.players.get(playerId)
    if (p === undefined) return
    if (p.moving !== null) p.facingDirty = true
    p.moving = null
  }

  // --- elevator calls and in-car presses ------------------------------------

  /**
   * Call a car to the caller's floor — destination-free (AD-014): the call
   * carries no target; the destination is chosen inside the car via
   * `elevator:press`. Returns why the call ended as it did:
   * - 'dispatched': a car was dispatched (60-tick arrival begins now) or the
   *   call was queued sim-level FIFO (both cars busy)
   * - 'ignored': duplicate call — duplicate predicate = pickup floor ONLY
   *   (AD-012 narrowed): a car already en route to (or queued for) the pickup,
   *   or standing there with open doors. The panel still flashes (MOVE-12).
   * - 'rejected': caller in a car (AD-011: elevators run in BOTH phases)
   */
  callElevator(playerId: string): 'dispatched' | 'ignored' | 'rejected' {
    const caller = this.players.get(playerId)
    if (caller === undefined || caller.inCar !== null) return 'rejected'
    const pickup = caller.floor
    const duplicating = ([1, 2] as const).find((id) => {
      const car = this.cars[id]
      if (car.phase === 'arriving') return car.pickup === pickup
      if (car.phase === 'riding') return car.queue.includes(pickup)
      return car.floor === pickup // idle | dwelling: doors open there
    })
    if (duplicating !== undefined) {
      this.announce({ kind: 'called', floor: pickup, car: duplicating })
      return 'ignored'
    }
    if (this.callQueue.some((q) => q.pickup === pickup)) {
      this.announce({ kind: 'called', floor: pickup, car: 1 })
      return 'ignored'
    }
    // AD-014 (design review): among idle cars, EMPTY ones are drafted first —
    // an occupied-idle car carries a deliberating rider and is used only when
    // no empty idle car exists. Within each pool: closest landing, tie → car 1.
    const idle = ([1, 2] as const).filter((id) => this.cars[id].phase === 'idle')
    const closest = (pool: (1 | 2)[]): 1 | 2 | undefined =>
      [...pool].sort(
        (a, b) =>
          Math.abs(caller.x - CAR_LANDING_MILLI[a]) - Math.abs(caller.x - CAR_LANDING_MILLI[b]) ||
          a - b,
      )[0]
    const carId = closest(idle.filter((id) => this.cars[id].riders.length === 0)) ?? closest(idle)
    if (carId === undefined) {
      // Both cars busy: the call waits in the FIFO and is served by the first
      // car to free. Its panel flash happens at dispatch time, not now.
      this.callQueue.push({ playerId, pickup })
      return 'dispatched'
    }
    this.dispatch(carId, pickup)
    this.announce({ kind: 'called', floor: pickup, car: carId })
    return 'dispatched'
  }

  /**
   * Press a floor inside the car the sender is riding (ELR P2). The press
   * appends to the car's FIFO queue — riders-only; duplicates, the floor
   * being served, and the stopped-at floor while doors are open are rejected
   * SILENTLY (no event, no queue change). Returns:
   * - 'accepted': queued (and announced rider-exclusive on the next tick)
   * - 'ignored': silently rejected (duplicate / being served / current floor)
   * - 'rejected': the sender is not a rider of any car
   */
  pressFloor(playerId: string, floor: FloorId): 'accepted' | 'ignored' | 'rejected' {
    const p = this.players.get(playerId)
    if (p === undefined || p.inCar === null) return 'rejected'
    const carId = p.inCar
    const car = this.cars[carId]
    // Being served: the pickup floor while arriving (the pickup is the car's
    // destination even though the queue is empty — no zero-tick rides), or
    // the queue head while riding.
    if (car.phase === 'arriving' && car.pickup === floor) return 'ignored'
    if (car.phase === 'riding' && car.queue[0] === floor) return 'ignored'
    if (car.queue.includes(floor)) return 'ignored'
    // "Current floor" = the floor the car is stopped at with doors open;
    // while riding, the origin floor is queueable (a return trip).
    if ((car.phase === 'idle' || car.phase === 'dwelling') && car.floor === floor) return 'ignored'
    car.queue.push(floor)
    this.announce({ kind: 'pressed', playerId, floor, car: carId })
    // A press into an idling car departs it immediately (ELR P2 AC5: the
    // open-doors idle lasts "until a new press or dispatch occurs").
    if (car.phase === 'idle') this.departRiding(carId)
    return 'accepted'
  }

  /** Queue the panel flash for the next tick, naming the serving car (MOVE-10). */
  private announce(entry: PendingAnnounce): void {
    this.announced.push(entry)
  }

  private dispatch(carId: 1 | 2, pickup: FloorId): void {
    const car = this.cars[carId]
    car.phase = 'arriving'
    car.ticksLeft = ARRIVE_TICKS
    car.pickup = pickup
    car.exitedThisStop.clear() // departure opens a new door-open episode
  }

  /** Depart toward the oldest queued floor (queue non-empty at every call site). */
  private departRiding(carId: 1 | 2): void {
    const car = this.cars[carId]
    const target = car.queue[0]
    if (target === undefined) throw new Error(`depart with empty queue: car ${carId}`)
    const ticks = this.rideTicks(car.floor, target)
    // Belt-and-braces zero-ride guard (AD-014): unreachable — the
    // pickup-while-arriving and open-door current-floor press rejections keep
    // every queued floor distinct from the car's stopped-at floor. Pinned by
    // those rejection tests.
    if (ticks <= 0) throw new Error(`zero-tick ride: ${car.floor} -> ${String(target)}`)
    car.phase = 'riding'
    car.ticksLeft = ticks
    car.exitedThisStop.clear() // departure opens a new door-open episode
  }

  // --- phase transitions (positions never change here: MOVE-07/08) ---------

  unlock(): void {
    this.phase = 'round'
  }

  lock(): void {
    this.phase = 'lobby'
    // AD-011: elevators run in both phases, so a call queued at the buzzer is
    // NOT dropped — the next car to go idle serves it, pre-round included.
    // In-flight trips still complete.
  }

  // --- queries --------------------------------------------------------------

  positionOf(playerId: string): { floor: FloorId; x: number; facing: MoveDir } | undefined {
    const p = this.players.get(playerId)
    if (p === undefined) return undefined
    return { floor: p.floor, x: p.x / MILLI, facing: p.facing }
  }

  snapshot(): {
    players: { playerId: string; floor: FloorId; x: number }[]
    cars: { car: 1 | 2; floor: FloorId }[]
  } {
    return {
      players: [...this.players.entries()].map(([playerId, p]) => ({
        playerId,
        floor: p.floor,
        x: p.x / MILLI,
      })),
      cars: [
        { car: 1 as const, floor: this.cars[1].floor },
        { car: 2 as const, floor: this.cars[2].floor },
      ],
    }
  }

  /**
   * AD-008 snapshot contract: a live viewer sees the players on their own
   * floor only (the viewer included), plus both cars' public floors — the
   * panels requirement keeps car positions public everywhere. Riders are on
   * NO floor (AD-009): a player inside a car never appears in a floor
   * snapshot (with no auto-exit they can be aboard indefinitely).
   */
  snapshotForFloor(floor: FloorId): {
    players: { playerId: string; floor: FloorId; x: number }[]
    cars: { car: 1 | 2; floor: FloorId }[]
  } {
    return {
      players: [...this.players.entries()]
        .filter(([, p]) => p.floor === floor && p.inCar === null)
        .map(([playerId, p]) => ({ playerId, floor: p.floor, x: p.x / MILLI })),
      cars: [
        { car: 1 as const, floor: this.cars[1].floor },
        { car: 2 as const, floor: this.cars[2].floor },
      ],
    }
  }

  /**
   * AD-013 rider snapshot (join and buzzer resync for mid-car viewers): a
   * rider's snapshot carries an EMPTY players list (no floor stream in a car,
   * AD-009 — this also fixes the AD-009 rider leak), both cars' public floors
   * (panels stay public), and their car's occupants + press queue. A non-rider
   * falls back to the byte-identical floor snapshot — occupancy never appears.
   */
  snapshotForRider(playerId: string): {
    players: { playerId: string; floor: FloorId; x: number }[]
    cars: { car: 1 | 2; floor: FloorId }[]
    carOccupants?: { car: 1 | 2; riders: string[]; queue: FloorId[] }
  } {
    const p = this.players.get(playerId)
    if (p === undefined || p.inCar === null) {
      return this.snapshotForFloor(p?.floor ?? 'lobby')
    }
    const car = this.cars[p.inCar]
    return {
      players: [],
      cars: [
        { car: 1 as const, floor: this.cars[1].floor },
        { car: 2 as const, floor: this.cars[2].floor },
      ],
      carOccupants: { car: p.inCar, riders: [...car.riders], queue: [...car.queue] },
    }
  }

  /**
   * AD-008 view context for the Router: a live player's own floor (riders get
   * none — no floor stream while in a car) plus the room-segment key they
   * currently stand in (null outside every segment; AD-010 segments), and the
   * car they are riding — the riders-policy routing key (AD-013).
   */
  viewOf(playerId: string): {
    floor: FloorId | null
    roomKey: string | null
    car: 1 | 2 | null
  } {
    const p = this.players.get(playerId)
    if (p === undefined) return { floor: null, roomKey: null, car: null }
    if (p.inCar !== null) return { floor: null, roomKey: null, car: p.inCar }
    if (p.floor === 'lobby') return { floor: p.floor, roomKey: null, car: null }
    const room = roomIndexAtMilli(p.x)
    return {
      floor: p.floor,
      roomKey: room === 0 ? null : `${p.floor}:${room as RoomIndex}`,
      car: null,
    }
  }

  // --- tick -----------------------------------------------------------------

  /** Advance one 0.05 s step; returns the events emitted this tick (may be []). */
  tick(): readonly MovementEvent[] {
    const events: MovementEvent[] = []
    // AD-013: every rider-list change (board, walk-off, disconnect) reaches the
    // car's riders next tick as ONE elevator:riders carrying the car's current
    // occupants AND press queue — the "lit buttons visible from inside" model.
    for (const id of this.ridersDirty.splice(0)) {
      const car = this.cars[id]
      events.push({
        type: 'elevator:riders',
        car: id,
        riders: [...car.riders],
        queue: [...car.queue],
      })
    }
    for (const a of this.announced.splice(0)) {
      if (a.kind === 'called') {
        events.push({ type: 'elevator:called', floor: a.floor, car: a.car })
      } else if (a.kind === 'pressed') {
        events.push({
          type: 'elevator:pressed',
          playerId: a.playerId,
          floor: a.floor,
          car: a.car,
        })
      }
    }

    for (const [playerId, p] of this.players) {
      if (p.inCar !== null || p.moving === null) {
        if (p.facingDirty) {
          p.facingDirty = false
          events.push(moved(playerId, p))
        }
        continue
      }
      const before = p.x
      p.x += p.moving === 'left' ? -SPEED_MILLI_PER_TICK : SPEED_MILLI_PER_TICK
      p.x = Math.min(HALL_MAX_MILLI, Math.max(0, p.x))
      if (p.x !== before || p.facingDirty) {
        p.facingDirty = false
        events.push(moved(playerId, p))
      }
    }

    this.tickCars(events)
    return events
  }

  private tickCars(events: MovementEvent[]): void {
    for (const id of [1, 2] as const) {
      const car = this.cars[id]
      if (car.phase === 'idle') {
        // Doors open: auto-board every tick (AD-014 — one boarding rule
        // everywhere; parked cars pick up candidates standing in range).
        this.board(id, car, events)
        continue
      }
      if (car.phase === 'arriving') {
        car.ticksLeft--
        if (car.ticksLeft > 0) continue
        // Arrived at the pickup floor: doors open, the dwell begins; board on
        // entry (the generalized arrival-tick rule). Riders stay aboard —
        // arrival no longer auto-exits anyone (AD-014).
        car.floor = car.pickup as FloorId
        car.pickup = null
        car.phase = 'dwelling'
        car.ticksLeft = DWELL_TICKS
        events.push({ type: 'elevator:moved', car: id, floor: car.floor })
        this.syncRiderFloors(id)
        this.board(id, car, events)
        continue
      }
      if (car.phase === 'dwelling') {
        // Dwell countdown, then board, then departure (pinned tick order).
        car.ticksLeft--
        this.board(id, car, events)
        if (car.ticksLeft > 0) continue
        if (car.queue.length > 0) {
          // The queue belongs to the car: an empty car still departs and
          // serves (ghost trips, ELR P3 AC3).
          this.departRiding(id)
        } else {
          car.phase = 'idle'
          car.ticksLeft = 0
          // A waiting call is served the moment a car frees (MOVE-15 queue).
          const next = this.callQueue.shift()
          if (next !== undefined) {
            this.dispatch(id, next.pickup)
            this.announce({ kind: 'called', floor: next.pickup, car: id })
          }
        }
        continue
      }
      // riding: |Δfloors| × 40 ticks to the oldest queued floor.
      car.ticksLeft--
      if (car.ticksLeft > 0) continue
      const served = car.queue.shift() as FloorId
      car.floor = served
      car.phase = 'dwelling'
      car.ticksLeft = DWELL_TICKS
      events.push({ type: 'elevator:moved', car: id, floor: served })
      this.syncRiderFloors(id)
      this.board(id, car, events)
    }
  }

  /** Rider floor tracking: a rider's floor follows the car (never evented —
   * riders have no floor stream, AD-008; positionOf bookkeeping only). */
  private syncRiderFloors(carId: 1 | 2): void {
    const car = this.cars[carId]
    for (const rid of car.riders) {
      const p = this.players.get(rid)
      if (p !== undefined) p.floor = car.floor
    }
  }

  private rideTicks(from: FloorId, to: FloorId): number {
    const a = FLOOR_IDS.indexOf(from)
    const b = FLOOR_IDS.indexOf(to)
    return Math.abs(b - a) * RIDE_TICKS_PER_FLOOR
  }

  /**
   * MOVE-13: board the closest candidates, capacity 2, deterministic order —
   * distance to the landing, then playerId. Runs on EVERY open-door tick
   * (arrival, dwelling, idle — AD-014). The door-open-episode guard excludes
   * players who exited this car since its last departure. Boarding removes
   * the player from the floor stream (player:left-floor names the floor
   * BOARDed — never any destination, WORK-19/MOVE-16) and drops their own
   * queued call (AD-012 #3: no car to an abandoned floor).
   */
  private board(carId: 1 | 2, car: CarState, events: MovementEvent[]): void {
    const landing = CAR_LANDING_MILLI[carId]
    const candidates = [...this.players.entries()]
      .filter(
        ([pid, p]) => p.inCar === null && p.floor === car.floor && !car.exitedThisStop.has(pid),
      )
      .filter(([, p]) => Math.abs(p.x - landing) <= TUNING.ELEVATOR_LANDING_TILES * MILLI)
      .sort(([a, pa], [b, pb]) => {
        const da = Math.abs(pa.x - landing)
        const db = Math.abs(pb.x - landing)
        return da !== db ? da - db : a < b ? -1 : a > b ? 1 : 0
      })
    for (const [pid, p] of candidates) {
      if (car.riders.length >= TUNING.ELEVATOR_CAPACITY) break
      p.inCar = carId
      if (p.x !== landing) {
        p.x = landing
        events.push(moved(pid, p))
      }
      car.riders.push(pid)
      this.callQueue = this.callQueue.filter((q) => q.playerId !== pid)
      events.push({ type: 'player:left-floor', playerId: pid, floor: car.floor })
      this.markRidersDirty(carId) // AD-013: riders learn the new occupant list
    }
  }
}

function moved(playerId: string, p: PlayerMoveState): MovementEvent {
  return {
    type: 'player:moved',
    playerId,
    floor: p.floor,
    x: p.x / MILLI,
    facing: p.facing,
  }
}
