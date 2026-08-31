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
 * Phase model (ELAN-02, AD-026): `opening` begins at `elapsedMs === 0`
 * exactly when a real `elevator:moved` is processed by `applyMoved` — every
 * stop plays the 0.5 s opening swing, holds open for the 1 s dwell (the
 * hop window), then closes over 0.5 s before the car renders hidden. The
 * arrival fade (`carAlpha`), the door-open swing (`doorsOpenAmount`), and
 * the arrival slide (`carY`) are all readouts of the *same* `elapsedMs`
 * counter for the first slice of `opening` — cosmetic overlays, never a
 * second clock and never a delay added on top of the dwell window.
 *
 * Timing provenance (ELAN-08): every duration in `AnimationConfig` derives
 * from locked `TUNING` values — `ELEVATOR_DWELL_SECONDS`,
 * `ELEVATOR_ARRIVE_SECONDS`, and `ELEVATOR_RIDE_SECONDS_PER_FLOOR` — not from
 * bare invented literals.
 */

export type CarId = 1 | 2

/** Mirrors the sim's door state (AD-026/027), driven by the public
 *  `elevator:doors` events: `closed` (parked, boot), `opening` (0.5 s
 *  swing), `open` (the ≥ 3 s dwell — and beyond, while the car has no call
 *  to attend), `closing` (0.5 s, only ever into a departure), and `transit`
 *  (hidden — the car is on a ride). */
type CarPhase = 'closed' | 'opening' | 'open' | 'closing' | 'transit'

export interface CarClock {
  readonly phase: CarPhase
  readonly floor: FloorId
  /** ms elapsed since entering the current phase. */
  readonly elapsedMs: number
  /** Floor the car is arriving from, for the arrival slide (ELAN-06). */
  readonly fromFloor: FloorId | null
}

export interface AnimationConfig {
  /** Door swing duration, both directions — the sim's opening/closing stages
   *  (TUNING.ELEVATOR_DOOR_SECONDS, AD-026). */
  readonly doorAnimMs: number
  /** Arrival fade/slide length — derived from TUNING.ELEVATOR_ARRIVE_SECONDS
   *  (ELAN-08). Read from the first slice of `opening`'s own `elapsedMs`. */
  readonly arrivalAnimMs: number
}

const DOOR_MS = TUNING.ELEVATOR_DOOR_SECONDS * 1000
const ARRIVE_MS = TUNING.ELEVATOR_ARRIVE_SECONDS * 1000

export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  doorAnimMs: DOOR_MS,
  arrivalAnimMs: ARRIVE_MS / 10,
}

export function initialCarClock(floor: FloorId): CarClock {
  // Boot: the sim's cars sit parked with the doors SHUT until a call or an
  // in-car press opens them.
  return { phase: 'closed', floor, elapsedMs: 0, fromFloor: null }
}

/**
 * A car has just been dispatched to pick up at `calledFloor` (public
 * `elevator:called`, broadcast to everyone). AD-027: the sim closes the
 * dispatched car's doors itself and the `elevator:doors` event drives this
 * presenter — a call for the floor the car stands at (decoy/duplicate,
 * MOVE-12/AD-012) or any call while mid-transit is a no-op.
 */
export function applyCalled(clock: CarClock, _calledFloor: FloorId): CarClock {
  return clock
}

/**
 * A car has been seen at `floor` (public `elevator:moved` — ground truth).
 * AD-027: this event carries POSITION only — the door swings are driven by
 * `elevator:doors` — so it updates the floor bookkeeping without touching
 * the door phase. A floor CHANGE remembers the origin floor for the next
 * doors-open event's arrival slide.
 */
export function applyMoved(clock: CarClock, floor: FloorId): CarClock {
  if (clock.floor === floor) return clock
  return { ...clock, floor, fromFloor: clock.floor }
}

/**
 * Public door state (AD-026/027): the doors began their opening swing
 * (`open: true` — an arrival, a boarding press at a parked car, or an
 * in-car current-floor press) or began closing (`open: false` — always into
 * a departure or a dispatch). These events are the presenter's only door
 * truth: a car with no call to attend keeps its doors open indefinitely.
 */
export function applyDoors(clock: CarClock, floor: FloorId, open: boolean): CarClock {
  if (open) {
    // The arrival slide only plays when the open event landed on a floor
    // CHANGE (recorded by applyMoved) — a reopen at the car's own floor
    // swings without any slide or fade.
    return { phase: 'opening', floor, elapsedMs: 0, fromFloor: clock.fromFloor }
  }
  if (clock.phase === 'transit') return clock // stale close for a car already hidden
  return { phase: 'closing', floor, elapsedMs: 0, fromFloor: null }
}

/** Advances one car's clock by `dtMs`, resolving phase transitions. */
export function advanceCarClock(clock: CarClock, dtMs: number, cfg: AnimationConfig): CarClock {
  const elapsedMs = clock.elapsedMs + dtMs
  switch (clock.phase) {
    case 'opening':
      if (elapsedMs >= cfg.doorAnimMs) {
        return { phase: 'open', floor: clock.floor, elapsedMs: 0, fromFloor: null }
      }
      return { ...clock, elapsedMs }
    case 'closed':
    case 'open':
    case 'transit':
      // `open` holds indefinitely: AD-027 keeps the doors open while the car
      // has no call to attend — only a real `elevator:doors` close event
      // moves it on.
      return { ...clock, elapsedMs }
    case 'closing':
      if (elapsedMs >= cfg.doorAnimMs) {
        // AD-027: a close is always into a departure or a dispatch — the car
        // is on the move, so it renders hidden until its next door event.
        return { phase: 'transit', floor: clock.floor, elapsedMs: 0, fromFloor: null }
      }
      return { ...clock, elapsedMs }
  }
}

/** 1 = doors fully open, 0 = fully closed. */
export function doorsOpenAmount(clock: CarClock, cfg: AnimationConfig): number {
  if (clock.phase === 'opening') return Math.min(1, clock.elapsedMs / cfg.doorAnimMs)
  if (clock.phase === 'open') return 1
  if (clock.phase === 'closing') return Math.max(0, 1 - clock.elapsedMs / cfg.doorAnimMs)
  return 0
}

/** The car is rendered at all (its floor is known and it is not mid-ride). */
export function carVisible(clock: CarClock): boolean {
  return clock.phase !== 'transit'
}

/** Fade-in amount during the arrival slice of `opening`; 1 (opaque) otherwise. */
export function carAlpha(clock: CarClock, cfg: AnimationConfig): number {
  if (clock.phase !== 'opening' || clock.fromFloor === null) return 1
  return Math.min(1, clock.elapsedMs / cfg.arrivalAnimMs)
}

const ARRIVAL_Y_OFFSET = 30

/** Vertical position during the arrival slice of `open`; baseY otherwise. */
export function carY(clock: CarClock, cfg: AnimationConfig, baseY: number): number {
  if (clock.phase !== 'opening' || clock.fromFloor === null) return baseY
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

  /** Public door state (AD-026/027): the only driver of the door phases. */
  onDoors(car: CarId, floor: FloorId, open: boolean): void {
    const clock = this.clocks.get(car)
    if (clock === undefined) return
    this.clocks.set(car, applyDoors(clock, floor, open))
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
