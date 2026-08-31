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
 *
 * Phase model (ELAN-02): `open` begins at `elapsedMs === 0` exactly when a
 * real `elevator:moved` is processed by `applyMoved` — the dwell deadline
 * (`dwellMs`) is therefore always measured "from the last `elevator:moved`
 * for that car", matching the spec's literal wording, never from the end of
 * any local visual flourish. The arrival fade (`carAlpha`), the door-open
 * swing (`doorsOpenAmount`), and the arrival slide (`carY`) are all readouts
 * of the *same* `elapsedMs` counter for the first slice of `open` — cosmetic
 * overlays, never a second clock and never a delay added on top of the dwell
 * window.
 *
 * Timing provenance (ELAN-08): every duration in `AnimationConfig` derives
 * from locked `TUNING` values — `ELEVATOR_DWELL_SECONDS`,
 * `ELEVATOR_ARRIVE_SECONDS`, and `ELEVATOR_RIDE_SECONDS_PER_FLOOR` — not from
 * bare invented literals.
 */

export type CarId = 1 | 2

type CarPhase = 'open' | 'closing' | 'transit'

export interface CarClock {
  readonly phase: CarPhase
  readonly floor: FloorId
  /** ms elapsed since entering the current phase. */
  readonly elapsedMs: number
  /** Set while `phase === 'transit'` once a real `elevator:moved` names the
   *  arrival floor, but the fixed minimum transit duration (P2 AC1) has not
   *  yet elapsed — resolved back into `open` (elapsedMs reset to 0, so the
   *  dwell deadline is measured from this real event) by `advanceCarClock`. */
  readonly pendingFloor: FloorId | null
  /** Floor the car is arriving from, for the arrival slide (ELAN-06). */
  readonly fromFloor: FloorId | null
}

export interface AnimationConfig {
  /** Open-door dwell before an idle-timeout auto-close (mirrors the sim's
   *  own dwell window — TUNING.ELEVATOR_DWELL_SECONDS, not a new value). */
  readonly dwellMs: number
  /** Door swing duration, both directions — derived from
   *  TUNING.ELEVATOR_ARRIVE_SECONDS (ELAN-08). */
  readonly doorAnimMs: number
  /** Arrival fade/slide length — derived from TUNING.ELEVATOR_ARRIVE_SECONDS
   *  (ELAN-08). Read from the first slice of `open`'s own `elapsedMs`, so it
   *  can never push the dwell deadline later (ELAN-02). */
  readonly arrivalAnimMs: number
  /** Floor on how long a departed car stays hidden, independent of the real
   *  (bystander-unknown) ride distance — spec P2 AC1. Derived from
   *  TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR: no real ride can resolve
   *  faster than a single floor's travel time (ELAN-08). */
  readonly minTransitMs: number
}

const DWELL_MS = TUNING.ELEVATOR_DWELL_SECONDS * 1000
const ARRIVE_MS = TUNING.ELEVATOR_ARRIVE_SECONDS * 1000
const RIDE_MS_PER_FLOOR = TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR * 1000

export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  dwellMs: DWELL_MS,
  doorAnimMs: ARRIVE_MS / 10,
  arrivalAnimMs: ARRIVE_MS / 10,
  minTransitMs: RIDE_MS_PER_FLOOR,
}

export function initialCarClock(floor: FloorId): CarClock {
  return { phase: 'open', floor, elapsedMs: 0, pendingFloor: null, fromFloor: null }
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
    return {
      phase: 'closing',
      floor: clock.floor,
      elapsedMs: 0,
      pendingFloor: null,
      fromFloor: null,
    }
  }
  return clock
}

/**
 * A car has just arrived at `floor` (public `elevator:moved` — ground
 * truth). The clock enters `open` immediately so the dwell deadline is
 * measured from this exact event (ELAN-02). If we already knew it was in
 * transit, defer to the fixed minimum transit duration (P2 AC1) via
 * `pendingFloor`; otherwise (a silent rider-press departure we never saw
 * close its doors, SPEC_DEVIATION above) ground truth wins immediately.
 */
export function applyMoved(clock: CarClock, floor: FloorId): CarClock {
  if (clock.phase === 'open' && clock.floor === floor) {
    // Refresh the dwell window on a repeated stop at the same floor.
    return { ...clock, elapsedMs: 0, fromFloor: null }
  }
  if (clock.phase === 'transit') return { ...clock, pendingFloor: floor }
  return { phase: 'open', floor, elapsedMs: 0, pendingFloor: null, fromFloor: clock.floor }
}

/** Advances one car's clock by `dtMs`, resolving phase transitions. */
export function advanceCarClock(clock: CarClock, dtMs: number, cfg: AnimationConfig): CarClock {
  const elapsedMs = clock.elapsedMs + dtMs
  switch (clock.phase) {
    case 'open':
      if (elapsedMs >= cfg.dwellMs) {
        return {
          phase: 'closing',
          floor: clock.floor,
          elapsedMs: 0,
          pendingFloor: null,
          fromFloor: null,
        }
      }
      return { ...clock, elapsedMs }
    case 'closing':
      if (elapsedMs >= cfg.doorAnimMs) {
        return {
          phase: 'transit',
          floor: clock.floor,
          elapsedMs: 0,
          pendingFloor: null,
          fromFloor: null,
        }
      }
      return { ...clock, elapsedMs }
    case 'transit':
      if (clock.pendingFloor !== null && elapsedMs >= cfg.minTransitMs) {
        return {
          phase: 'open',
          floor: clock.pendingFloor,
          elapsedMs: 0,
          pendingFloor: null,
          fromFloor: clock.floor,
        }
      }
      return { ...clock, elapsedMs }
  }
}

/** 1 = doors fully open, 0 = fully closed. */
export function doorsOpenAmount(clock: CarClock, cfg: AnimationConfig): number {
  if (clock.phase === 'open') return Math.min(1, clock.elapsedMs / cfg.doorAnimMs)
  if (clock.phase === 'closing') return Math.max(0, 1 - clock.elapsedMs / cfg.doorAnimMs)
  return 0
}

/** The car is rendered at all (its floor is known and it is not mid-transit). */
export function carVisible(clock: CarClock): boolean {
  return clock.phase !== 'transit'
}

/** Fade-in amount during the arrival slice of `open`; 1 (opaque) otherwise. */
export function carAlpha(clock: CarClock, cfg: AnimationConfig): number {
  if (clock.phase !== 'open' || clock.fromFloor === null) return 1
  return Math.min(1, clock.elapsedMs / cfg.arrivalAnimMs)
}

const ARRIVAL_Y_OFFSET = 30

/** Vertical position during the arrival slice of `open`; baseY otherwise. */
export function carY(clock: CarClock, cfg: AnimationConfig, baseY: number): number {
  if (clock.phase !== 'open' || clock.fromFloor === null) return baseY
  const t = Math.min(1, clock.elapsedMs / cfg.arrivalAnimMs)
  return baseY - ARRIVAL_Y_OFFSET * (1 - t)
}

// --- Phaser-facing wiring ---------------------------------------------------
// Structural interfaces only (see module doc) — no `phaser` import, so this
// class stays constructible with a fake scene/car pair in plain node tests.

export interface CarViewLike {
  x: number
  y: number
  setVisible(visible: boolean): void
  setAlpha(alpha: number): void
  setY(y: number): void
  /** ART-15: frame 0 = doors-open cage, frame 1 = closed slab. */
  setFrame(frame: number): void
}

/**
 * Owns car/motion visuals for the building's two elevator cars. Consumes
 * only plain facts (car id, floor, elapsed time via `tick`) — never a
 * `ViewAction`, never a protocol/registry type (spec ELAN-09/10).
 * ART-15 (cycle 2.10): the sprite's own artwork carries the doors — the
 * presenter drives the open/closed FRAME from the same clock that drove the
 * gray-box door rectangles; no separate door objects exist.
 */
export class ElevatorPresenter {
  private readonly clocks = new Map<CarId, CarClock>()

  constructor(
    private readonly cars: ReadonlyMap<CarId, { readonly view: CarViewLike }>,
    private readonly carPx: (car: CarId) => number,
    private readonly carY: (car: CarId) => number,
    private readonly cfg: AnimationConfig = DEFAULT_ANIMATION_CONFIG,
  ) {
    this.reset()
  }

  /** Resets both cars to a fresh idle-open-at-lobby clock (scene restart). */
  reset(): void {
    this.clocks.clear()
    for (const car of [1, 2] as const) {
      this.clocks.set(car, initialCarClock('lobby'))
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

  /** Read-only view of one car's animation clock (in-car screen readouts). */
  clockOf(car: CarId): CarClock | undefined {
    return this.clocks.get(car)
  }

  /** Advances every car's clock and drives car sprite visuals for `viewFloor`. */
  tick(dtMs: number, viewFloor: FloorId): void {
    for (const carId of [1, 2] as const) {
      const clock = this.clocks.get(carId)
      const entry = this.cars.get(carId)
      if (clock === undefined || entry === undefined) continue
      const advanced = advanceCarClock(clock, dtMs, this.cfg)
      this.clocks.set(carId, advanced)

      const onViewFloor = advanced.floor === viewFloor
      const visible = onViewFloor && carVisible(advanced)
      entry.view.setVisible(visible)
      entry.view.setAlpha(carAlpha(advanced, this.cfg))
      entry.view.setY(carY(advanced, this.cfg, this.carY(carId)))
      // Frame follows the same open amount the gray-box doors used: any
      // openness renders the doors-open cage, full closure the closed slab.
      entry.view.setFrame(doorsOpenAmount(advanced, this.cfg) > 0 ? 0 : 1)
    }
  }
}
