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

interface CarState {
  floor: FloorId
  riders: string[]
  phase: 'idle' | 'arriving' | 'riding'
  ticksLeft: number
  pickup: FloorId | null
  target: FloorId | null
}

/**
 * Queued call (sim-level FIFO): dispatched when a car next goes idle. A car
 * never holds more than one pending destination (FR-5), so overflow calls wait.
 */
interface QueuedCall {
  playerId: string
  pickup: FloorId
  target: FloorId
}

/** A call accepted since the last tick — announced on the next tick (MOVE-10). */
interface PendingAnnounce {
  floor: FloorId
  car: 1 | 2
}

export class MovementSim {
  private phase: 'lobby' | 'round' = 'lobby'
  private readonly players = new Map<string, PlayerMoveState>()
  private readonly cars: Record<1 | 2, CarState> = {
    1: { floor: 'lobby', riders: [], phase: 'idle', ticksLeft: 0, pickup: null, target: null },
    2: { floor: 'lobby', riders: [], phase: 'idle', ticksLeft: 0, pickup: null, target: null },
  }
  private callQueue: QueuedCall[] = []
  private announced: PendingAnnounce[] = []

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
    for (const car of [this.cars[1], this.cars[2]]) {
      car.riders = car.riders.filter((r) => r !== playerId)
    }
  }

  // --- intents ------------------------------------------------------------

  /**
   * Hold-to-walk. Idempotent while held; ignored inside a car (MOVE-09) and,
   * in lobby phase, on any floor other than the grand lobby (MOVE-08).
   * A direction change flips facing immediately.
   */
  startMove(playerId: string, dir: MoveDir): void {
    const p = this.players.get(playerId)
    if (p === undefined || p.inCar !== null) return
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

  // --- elevator calls -------------------------------------------------------

  /**
   * Call a car to the caller's floor and ride to `target` (FR-5). Returns why
   * the call ended as it did:
   * - 'dispatched': a car was dispatched (60-tick arrival begins now)
   * - 'ignored': decoy — some car already targets `target`; the panel still
   *   flashes (`elevator:called` is emitted either way, MOVE-12)
   * - 'rejected': caller in a car (AD-011: elevators run in BOTH phases)
   */
  callElevator(playerId: string, target: FloorId): 'dispatched' | 'ignored' | 'rejected' {
    const caller = this.players.get(playerId)
    if (caller === undefined || caller.inCar !== null) return 'rejected'
    const targeting = ([1, 2] as const).find((id) => this.cars[id].target === target)
    if (targeting !== undefined) {
      // Decoy: no dispatch, but the panel still flashes (FR-5 / MOVE-12).
      this.announce(caller.floor, targeting)
      return 'ignored'
    }
    const pickup = caller.floor
    const idle = ([1, 2] as const).filter((id) => this.cars[id].phase === 'idle')
    if (idle.length === 0) {
      // Both cars busy: the call waits in the FIFO and is served by the next
      // car to go idle. Its panel flash happens at dispatch time, not now —
      // only immediate dispatches and decoys flash on the tick after the call.
      this.callQueue.push({ playerId, pickup, target })
      return 'dispatched'
    }
    // Fixed 3 s arrival makes idle cars tie → car 1 (west) by rule (design note).
    const carId = idle[0]
    if (carId === undefined) return 'ignored'
    this.dispatch(carId, pickup, target)
    this.announce(pickup, carId)
    return 'dispatched'
  }

  /** Queue the panel flash for the next tick, naming the serving car. */
  private announce(floor: FloorId, car: 1 | 2): void {
    this.announced.push({ floor, car })
  }

  private dispatch(carId: 1 | 2, pickup: FloorId, target: FloorId): void {
    const car = this.cars[carId]
    car.phase = 'arriving'
    car.ticksLeft = ARRIVE_TICKS
    car.pickup = pickup
    car.target = target
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
   * panels requirement keeps car positions public everywhere.
   */
  snapshotForFloor(floor: FloorId): {
    players: { playerId: string; floor: FloorId; x: number }[]
    cars: { car: 1 | 2; floor: FloorId }[]
  } {
    const full = this.snapshot()
    return {
      players: full.players.filter((p) => p.floor === floor),
      cars: full.cars,
    }
  }

  /**
   * AD-008 view context for the Router: a live player's own floor (riders get
   * none — no floor stream while in a car) plus the room-segment key they
   * currently stand in (null outside every segment; AD-010 segments).
   */
  viewOf(playerId: string): { floor: FloorId | null; roomKey: string | null } {
    const p = this.players.get(playerId)
    if (p === undefined || p.inCar !== null) return { floor: null, roomKey: null }
    if (p.floor === 'lobby') return { floor: p.floor, roomKey: null }
    const room = roomIndexAtMilli(p.x)
    return {
      floor: p.floor,
      roomKey: room === 0 ? null : `${p.floor}:${room as RoomIndex}`,
    }
  }

  // --- tick -----------------------------------------------------------------

  /** Advance one 0.05 s step; returns the events emitted this tick (may be []). */
  tick(): readonly MovementEvent[] {
    const events: MovementEvent[] = []
    for (const a of this.announced.splice(0)) {
      events.push({ type: 'elevator:called', floor: a.floor, car: a.car })
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
      if (car.phase === 'idle') continue
      car.ticksLeft--
      if (car.ticksLeft > 0) continue

      if (car.phase === 'arriving') {
        // Arrived at the pickup floor: board up to capacity, then the trip
        // always completes — even empty (decoy rides are physical, FR-5).
        car.floor = car.pickup as FloorId
        car.phase = 'riding'
        car.ticksLeft = this.rideTicks(car.pickup as FloorId, car.target as FloorId)
        events.push({ type: 'elevator:moved', car: id, floor: car.pickup as FloorId })
        this.board(id, car, events)
        // Departure: the pickup floor's viewers lose the riders' rectangles —
        // AD-009 coherence, destination not conveyed (WORK-17).
        for (const rider of car.riders) {
          events.push({ type: 'player:left-floor', playerId: rider, floor: car.pickup as FloorId })
        }
      } else {
        car.floor = car.target as FloorId
        car.phase = 'idle'
        car.pickup = null
        car.target = null
        events.push({ type: 'elevator:moved', car: id, floor: car.floor })
        for (const rider of car.riders) {
          const p = this.players.get(rider)
          if (p === undefined) continue
          p.floor = car.floor
          p.inCar = null
          p.x = CAR_LANDING_MILLI[id]
          events.push(moved(rider, p))
        }
        car.riders = []
        // A waiting call is served the moment a car frees up (MOVE-15 queue).
        const next = this.callQueue.shift()
        if (next !== undefined) {
          this.dispatch(id, next.pickup, next.target)
          this.announce(next.pickup, id)
        }
      }
    }
  }

  private rideTicks(pickup: FloorId, target: FloorId): number {
    const a = FLOOR_IDS.indexOf(pickup)
    const b = FLOOR_IDS.indexOf(target)
    return Math.abs(b - a) * RIDE_TICKS_PER_FLOOR
  }

  /** MOVE-13: board the waiting closest players, capacity 2, deterministic order. */
  private board(carId: 1 | 2, car: CarState, events: MovementEvent[]): void {
    const landing = CAR_LANDING_MILLI[carId]
    const candidates = [...this.players.entries()]
      .filter(
        ([pid, p]) =>
          p.inCar === null && p.floor === car.floor && car.riders.includes(pid) === false,
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
      car.riders.push(pid)
      if (p.x !== landing) {
        p.x = landing
        events.push(moved(pid, p))
      }
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
