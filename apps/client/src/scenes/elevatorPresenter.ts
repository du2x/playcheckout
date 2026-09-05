import { type FloorId, TUNING } from '@turnover/shared'
import { floorLabel, transitFloorReadout } from '../ui/carScreen'

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

// --- Car-scene presentation (AD-054): pure readouts for the scenic in-car
// interior. Presentation-only constants in a named table (JUICE/CLIMB
// precedent); timings stay TUNING-derived everywhere else.

export const CAR_SCENE = {
  /** Vertical micro-sway while the car rides (px amplitude). */
  swayAmplitudePx: 2.5,
  /** Sway period (ms) — roughly the rumble's pulse. */
  swayPeriodMs: 480,
  /** The arrival light-burst fade length (ms) after the doors begin opening. */
  burstFadeMs: 420,
  /** Beyond-door glow alpha at rest / at the burst peak. */
  burstRestAlpha: 0.32,
  burstPeakAlpha: 0.55,
} as const

/** Ride sway: the whole car interior's y offset (px) at `nowMs`. A constant
 *  gentle motion only while the caller drives it during transit. */
export function carSwayY(nowMs: number): number {
  return (
    Math.sin((2 * Math.PI * (nowMs % CAR_SCENE.swayPeriodMs)) / CAR_SCENE.swayPeriodMs) *
    CAR_SCENE.swayAmplitudePx
  )
}

/**
 * The beyond-door glow: at rest it reads as the hallway's light spill; the
 * moment the doors begin opening it bursts brighter and settles back (the
 * in-car answer to the arrival ding).
 */
export function arrivalBurstAlpha(elapsedOpeningMs: number): number {
  if (elapsedOpeningMs < 0 || elapsedOpeningMs >= CAR_SCENE.burstFadeMs) {
    return CAR_SCENE.burstRestAlpha
  }
  const t = elapsedOpeningMs / CAR_SCENE.burstFadeMs
  return (
    CAR_SCENE.burstRestAlpha +
    (CAR_SCENE.burstPeakAlpha - CAR_SCENE.burstRestAlpha) * Math.sin(Math.PI * t)
  )
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

/** ART-17: how long a landing panel flash reads as "call registered". */
const PANEL_FLASH_MS = 700

/** The read-only rider facts the car screen needs (RiderUpdate's shape). */
export interface RiderFacts {
  readonly car: CarId
  readonly queue: readonly FloorId[]
}

/** The in-car screen readout the scene applies to the DOM each frame. */
export interface CarScreenReadout {
  readonly floor: FloorId | null
  readonly state: string | null
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
  /** Hall-call lights (AD-024): amber while the car owes the called floor a
   *  stop — lit on a call the car is NOT already standing at, cleared on that
   *  car's next arrival (`elevator:moved`). */
  private readonly calledLights: Record<CarId, boolean> = { 1: false, 2: false }
  /** ART-17: the landing panels of the called floor flash for a fixed window. */
  private panelFlash: { floor: FloorId; until: number } | null = null
  /** The rider's current transit leg, re-anchored from the own car's press
   *  queue; `elapsedMs` advances with tick so the floor sweep steps per ride
   *  stride from the known departure. */
  private carScreenLeg: { from: FloorId; to: FloorId; elapsedMs: number } | null = null
  private carScreenReadout: CarScreenReadout = { floor: null, state: null }

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
    this.calledLights[1] = false
    this.calledLights[2] = false
    this.panelFlash = null
    this.carScreenLeg = null
    this.carScreenReadout = { floor: null, state: null }
    for (const car of [1, 2] as const) {
      this.clocks.set(car, initialCarClock('lobby'))
    }
  }

  onCalled(car: CarId, floor: FloorId): void {
    const clock = this.clocks.get(car)
    if (clock === undefined) return
    this.clocks.set(car, applyCalled(clock, floor))
    // Hall-call light (AD-024): the AD-019/023 decoy summons nothing — a call
    // for the floor the car stands at lights nothing.
    if (clock.floor !== floor) this.calledLights[car] = true
    this.panelFlash = { floor, until: Date.now() + PANEL_FLASH_MS }
  }

  onMoved(car: CarId, floor: FloorId): void {
    const clock = this.clocks.get(car)
    if (clock === undefined) return
    this.clocks.set(car, applyMoved(clock, floor))
    this.calledLights[car] = false // arrival: the hall call is served
  }

  /** Public door state (AD-026/027): the only driver of the door phases. */
  onDoors(car: CarId, floor: FloorId, open: boolean): void {
    const clock = this.clocks.get(car)
    if (clock === undefined) return
    this.clocks.set(car, applyDoors(clock, floor, open))
  }

  /** Public per-car floor — the building panel and lane math read this. */
  floorOf(car: CarId): FloorId | null {
    return this.clocks.get(car)?.floor ?? null
  }

  /** The building panel's state (cycle 3.E, AD-040): the single car's floor
   *  and its hall-call light — position-only. */
  panelState(): { floor: FloorId | null; light: boolean } {
    return {
      floor: this.floorOf(1),
      light: this.calledLights[1],
    }
  }

  /** True inside the ART-17 flash window for the viewed floor's panels. */
  isFlashing(viewFloor: FloorId, now: number = Date.now()): boolean {
    return (
      this.panelFlash !== null && now < this.panelFlash.until && this.panelFlash.floor === viewFloor
    )
  }

  /** Read-only view of one car's animation clock. */
  clockOf(car: CarId): CarClock | undefined {
    return this.clocks.get(car)
  }

  /** The in-car screen readout, computed during tick. Cleared when not
   *  riding (`rider === null`) — the scene applies it to the DOM verbatim. */
  carScreen(): CarScreenReadout {
    return this.carScreenReadout
  }

  /** Advances every car's clock, drives car sprite visuals for `viewFloor`,
   *  and derives the rider's in-car screen readout (AD-038: one clock
   *  authority — the hall-call lights, the panel flash, and the transit
   *  sweep live here, not in the scene). */
  tick(dtMs: number, viewFloor: FloorId, rider: RiderFacts | null = null): void {
    for (const carId of [1, 2] as const) {
      const clock = this.clocks.get(carId)
      const entry = this.cars.get(carId)
      if (clock === undefined || entry === undefined) continue
      const advanced = advanceCarClock(clock, dtMs, this.cfg)
      this.clocks.set(carId, advanced)

      const onViewFloor = advanced.floor === viewFloor
      const present = onViewFloor && carVisible(advanced)
      // Every landing shows its shaft door: off-floor (and in-transit)
      // landings render the closed slab (ART-15 frame 1) — the car is simply
      // not there — while the on-floor landing swings per the clock below.
      entry.view.setVisible(true)
      if (present) {
        entry.view.setAlpha(carAlpha(advanced, this.cfg))
        entry.view.setY(carY(advanced, this.cfg, this.carY(carId)))
        // Frame follows the same open amount the gray-box doors used: any
        // openness renders the doors-open cage, full closure the closed slab.
        entry.view.setFrame(doorsOpenAmount(advanced, this.cfg) > 0 ? 0 : 1)
      } else {
        entry.view.setAlpha(1)
        entry.view.setY(this.carY(carId))
        entry.view.setFrame(1)
      }
    }
    this.deriveCarScreen(dtMs, rider)
  }

  /** Riders know the current leg's destination from the own car's press
   *  queue (rider-exclusive, already on their screen); bystander ground
   *  truth is the arrival event, which lands as the door-open event at the
   *  destination floor. The sweep re-anchors when the leg starts or
   *  retargets, so transition floors step per ride stride from the known
   *  departure. */
  private deriveCarScreen(dtMs: number, rider: RiderFacts | null): void {
    const clock = rider === null ? undefined : this.clocks.get(rider.car)
    if (rider === null || clock === undefined) {
      this.carScreenLeg = null
      this.carScreenReadout = { floor: null, state: null }
      return
    }
    if (clock.phase !== 'transit') {
      this.carScreenLeg = null
      this.carScreenReadout = {
        floor: clock.floor,
        state:
          clock.phase === 'opening'
            ? 'doors opening'
            : clock.phase === 'open'
              ? 'doors open'
              : clock.phase === 'closing'
                ? 'doors closing'
                : 'doors closed',
      }
      return
    }
    const dest = rider.queue[0] ?? null
    if (dest === null) {
      this.carScreenLeg = null
      this.carScreenReadout = { floor: clock.floor, state: 'doors closed' }
      return
    }
    if (
      this.carScreenLeg === null ||
      this.carScreenLeg.from !== clock.floor ||
      this.carScreenLeg.to !== dest
    ) {
      this.carScreenLeg = { from: clock.floor, to: dest, elapsedMs: 0 }
    } else {
      this.carScreenLeg = { ...this.carScreenLeg, elapsedMs: this.carScreenLeg.elapsedMs + dtMs }
    }
    this.carScreenReadout = {
      floor: transitFloorReadout(this.carScreenLeg.from, dest, this.carScreenLeg.elapsedMs),
      state: `moving to ${floorLabel(dest)}`,
    }
  }
}
