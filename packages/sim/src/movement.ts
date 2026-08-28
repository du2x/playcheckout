import type { MovementEvent } from '@turnover/shared'
import { type FloorId, HALL_LENGTH_TILES, TUNING } from '@turnover/shared'
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
  /** Set when facing changed without an x change this tick — still broadcast. */
  facingDirty: boolean
}

interface CarState {
  floor: FloorId
  riders: string[]
}

export class MovementSim {
  private phase: 'lobby' | 'round' = 'lobby'
  private readonly players = new Map<string, PlayerMoveState>()
  private readonly cars: Record<1 | 2, CarState> = {
    1: { floor: 'lobby', riders: [] },
    2: { floor: 'lobby', riders: [] },
  }

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

  /** Release-to-stop; a no-op when no move is active (spec edge). */
  stopMove(playerId: string): void {
    const p = this.players.get(playerId)
    if (p === undefined) return
    p.moving = null
  }

  // --- phase transitions (positions never change here: MOVE-07/08) ---------

  unlock(): void {
    this.phase = 'round'
  }

  lock(): void {
    this.phase = 'lobby'
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

  // --- tick -----------------------------------------------------------------

  /** Advance one 0.05 s step; returns the events emitted this tick (may be []). */
  tick(): readonly MovementEvent[] {
    const events: MovementEvent[] = []

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

    return events
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
