import { type FloorId, TUNING } from '@turnover/shared'

/**
 * Elevator door/ride animation (client-only, `elevator-animation` cycle):
 * renders door-open/close and ride motion for the two cars, derived purely
 * from `elevator:called`/`elevator:moved` receipt and fixed timings — no new
 * wire messages, no protocol/Colyseus types (spec ELAN-09/10). Structural
 * interfaces below (not `Phaser.Scene`/`Phaser.GameObjects.*` value imports)
 * keep this module importable under plain node (Phaser requires a `window`
 * global and cannot load in the vitest `client` project's node environment),
 * so the pure clock logic AND the Phaser-facing wiring both stay unit-testable.
 *
 * SPEC_DEVIATION: a rider-triggered departure (in-car press, AD-013) is never
 * announced on the wire — bystanders have no ground-truth signal for it by
 * design. This presenter treats the fixed open-door dwell window elapsing as
 * the deterministic close-and-depart trigger for that case (real elevators
 * also close their doors on an idle timeout, so the visual reads naturally
 * either way and leaks nothing new). A car dispatched elsewhere via a public
 * `elevator:called` closes immediately instead of waiting for the dwell.
 */

export type CarId = 1 | 2

type CarPhase = 'open' | 'closing' | 'transit' | 'arriving'

export interface CarClock {
  readonly phase: CarPhase
  readonly floor: FloorId
  /** ms elapsed since entering the current phase. */
  readonly elapsedMs: number
  /** Set while `phase === 'transit'` once a real `elevator:moved` names the
   *  arrival floor, but the fixed minimum transit duration (P2 AC1) has not
   *  yet elapsed — resolved into `arriving` by `advanceCarClock`. */
  readonly pendingFloor: FloorId | null
}

export interface AnimationConfig {
  /** Open-door dwell before an idle-timeout auto-close (mirrors the sim's
   *  own dwell window — TUNING.ELEVATOR_DWELL_SECONDS, not a new value). */
  readonly dwellMs: number
  /** Local, rendering-only door-close animation length (not a game timing). */
  readonly doorAnimMs: number
  /** Local, rendering-only arrival slide/fade-in length. */
  readonly arrivalAnimMs: number
  /** Local, rendering-only floor on how long a departed car stays hidden,
   *  independent of the real (bystander-unknown) ride distance — spec P2 AC1. */
  readonly minTransitMs: number
}

export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  dwellMs: TUNING.ELEVATOR_DWELL_SECONDS * 1000,
  doorAnimMs: 320,
  arrivalAnimMs: 400,
  minTransitMs: 500,
}

export function initialCarClock(floor: FloorId): CarClock {
  return { phase: 'open', floor, elapsedMs: 0, pendingFloor: null }
}

/**
 * A car has just been dispatched to pick up at `calledFloor` (public
 * `elevator:called`, broadcast to everyone). If it was parked open at a
 * DIFFERENT floor, that is a definite, immediate departure signal — start
 * closing now rather than waiting for the dwell timeout. A call for the
 * floor it is already parked at (decoy/duplicate, MOVE-12/AD-012) or any
 * call while already mid-transit is a no-op — never restart the animation.
 */
export function applyCalled(clock: CarClock, calledFloor: FloorId): CarClock {
  if (clock.phase === 'open' && calledFloor !== clock.floor) {
    return { phase: 'closing', floor: clock.floor, elapsedMs: 0, pendingFloor: null }
  }
  return clock
}

/**
 * A car has just arrived at `floor` (public `elevator:moved` — ground
 * truth). If we already knew it was in transit, defer to the fixed minimum
 * transit duration (P2 AC1) via `pendingFloor`; otherwise (a silent
 * rider-press departure we never saw close its doors, SPEC_DEVIATION above)
 * ground truth wins immediately — jump straight to the arrival animation.
 */
export function applyMoved(clock: CarClock, floor: FloorId): CarClock {
  if (clock.phase === 'open' && clock.floor === floor) return clock
  if (clock.phase === 'transit') return { ...clock, pendingFloor: floor }
  return { phase: 'arriving', floor, elapsedMs: 0, pendingFloor: null }
}

/** Advances one car's clock by `dtMs`, resolving phase transitions. */
export function advanceCarClock(clock: CarClock, dtMs: number, cfg: AnimationConfig): CarClock {
  const elapsedMs = clock.elapsedMs + dtMs
  switch (clock.phase) {
    case 'open':
      if (elapsedMs >= cfg.dwellMs) {
        return { phase: 'closing', floor: clock.floor, elapsedMs: 0, pendingFloor: null }
      }
      return { ...clock, elapsedMs }
    case 'closing':
      if (elapsedMs >= cfg.doorAnimMs) {
        return { phase: 'transit', floor: clock.floor, elapsedMs: 0, pendingFloor: null }
      }
      return { ...clock, elapsedMs }
    case 'transit':
      if (clock.pendingFloor !== null && elapsedMs >= cfg.minTransitMs) {
        return { phase: 'arriving', floor: clock.pendingFloor, elapsedMs: 0, pendingFloor: null }
      }
      return { ...clock, elapsedMs }
    case 'arriving':
      if (elapsedMs >= cfg.arrivalAnimMs) {
        return { phase: 'open', floor: clock.floor, elapsedMs: 0, pendingFloor: null }
      }
      return { ...clock, elapsedMs }
  }
}

/** 1 = doors fully open, 0 = fully closed. */
export function doorsOpenAmount(clock: CarClock, cfg: AnimationConfig): number {
  switch (clock.phase) {
    case 'open':
      return 1
    case 'closing':
      return Math.max(0, 1 - clock.elapsedMs / cfg.doorAnimMs)
    case 'transit':
    case 'arriving':
      return 0
  }
}

/** The car is rendered at all (its floor is known and it is not mid-transit). */
export function carVisible(clock: CarClock): boolean {
  return clock.phase !== 'transit'
}

/** Fade-in amount while arriving; 1 (opaque) in every other phase. */
export function carAlpha(clock: CarClock, cfg: AnimationConfig): number {
  if (clock.phase === 'arriving') return Math.min(1, clock.elapsedMs / cfg.arrivalAnimMs)
  return 1
}

// --- Phaser-facing wiring ---------------------------------------------------
// Structural interfaces only (see module doc) — no `phaser` import, so this
// class stays constructible with a fake scene/car pair in plain node tests.

export interface GraphicsLike {
  clear(): void
  fillStyle(color: number, alpha?: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  destroy(): void
}

export interface EllipseLike {
  x: number
  setVisible(visible: boolean): void
  setAlpha(alpha: number): void
}

export interface SceneLike {
  add: { graphics(): GraphicsLike }
}

const DOOR_HALF_WIDTH = 23
const DOOR_Y = 400
const DOOR_HEIGHT = 60

/**
 * Owns door/motion visuals for the building's two elevator cars. Consumes
 * only plain facts (car id, floor, elapsed time via `tick`) — never a
 * `MovementAction`, never a protocol/registry type (spec ELAN-09/10).
 */
export class ElevatorPresenter {
  private readonly clocks = new Map<CarId, CarClock>()
  private readonly doors = new Map<CarId, GraphicsLike>()

  constructor(
    private readonly scene: SceneLike,
    private readonly cars: ReadonlyMap<CarId, { readonly ellipse: EllipseLike }>,
    private readonly carPx: (car: CarId) => number,
    private readonly cfg: AnimationConfig = DEFAULT_ANIMATION_CONFIG,
  ) {
    this.reset()
  }

  /** Resets both cars to a fresh idle-open-at-lobby clock (scene restart). */
  reset(): void {
    for (const g of this.doors.values()) g.destroy()
    this.doors.clear()
    this.clocks.clear()
    for (const car of [1, 2] as const) {
      this.clocks.set(car, initialCarClock('lobby'))
      this.doors.set(car, this.scene.add.graphics())
    }
  }

  onCalled(car: CarId, floor: FloorId): void {
    const clock = this.clocks.get(car)
    if (clock === undefined) return
    this.clocks.set(car, applyCalled(clock, floor))
  }

  onMoved(car: CarId, floor: FloorId): void {
    const clock = this.clocks.get(car)
    if (clock === undefined) return
    this.clocks.set(car, applyMoved(clock, floor))
  }

  /** Advances every car's clock and redraws door/car visuals for `viewFloor`. */
  tick(dtMs: number, viewFloor: FloorId): void {
    for (const carId of [1, 2] as const) {
      const clock = this.clocks.get(carId)
      const door = this.doors.get(carId)
      const entry = this.cars.get(carId)
      if (clock === undefined || door === undefined || entry === undefined) continue
      const advanced = advanceCarClock(clock, dtMs, this.cfg)
      this.clocks.set(carId, advanced)

      const onViewFloor = advanced.floor === viewFloor
      const visible = onViewFloor && carVisible(advanced)
      entry.ellipse.setVisible(visible)
      entry.ellipse.setAlpha(carAlpha(advanced, this.cfg))

      if (!onViewFloor) {
        door.clear()
        continue
      }
      this.drawDoors(door, carId, doorsOpenAmount(advanced, this.cfg))
    }
  }

  private drawDoors(door: GraphicsLike, car: CarId, openAmount: number): void {
    const x = this.carPx(car)
    door.clear()
    const gap = DOOR_HALF_WIDTH * openAmount
    door.fillStyle(0x333333, 1)
    door.fillRect(x - DOOR_HALF_WIDTH, DOOR_Y, DOOR_HALF_WIDTH - gap, DOOR_HEIGHT)
    door.fillRect(x + gap, DOOR_Y, DOOR_HALF_WIDTH - gap, DOOR_HEIGHT)
  }
}
