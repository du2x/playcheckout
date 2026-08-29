# Elevator Animation Design

**Spec**: `.specs/features/elevator-animation/spec.md`
**Status**: Approved

---

## Architecture Overview

One new client module, `ElevatorPresenter`, owns every visual for the two
cars (doors + ride motion). `WorldScene` keeps doing exactly what it does
today — dispatch protocol-shaped `MovementAction`s and hold the authoritative
`floor`/`viewFloor` facts — but instead of mutating `Ellipse.setVisible`
inline, it forwards two plain facts to the presenter: car id and car's current
floor. The presenter records the receipt of each fact as time-zero for that
car's internal clock and advances it via `tick(dtMs)` from `WorldScene.update`.
It derives door/motion state purely from those facts plus `TUNING` constants;
it never sees a `MovementAction`, a Colyseus type, or the registry.

```mermaid
graph TD
    A[Server elevator:called / elevator:moved] --> B[WorldScene.applyAction]
    B -->|plain facts: car, floor| C[ElevatorPresenter.onCalled / onMoved]
    C --> D[per-car CarClock: open, closing, transit]
    D -->|tick dtMs| E[Phaser Graphics: doors + car Ellipse position]
    F[WorldScene.update loop] -->|dtMs, viewFloor| D
```

**Approach chosen vs. alternatives considered:**

1. **(Chosen) Standalone presenter module, scene forwards plain facts.**
   Presenter has zero imports beyond `TUNING` + `FloorId`. WorldScene's
   `applyAction` cases for `elevator-called`/`elevator-moved` shrink to one
   line each (call the presenter) plus the existing panel update.
2. **(Rejected) Animate inline inside `WorldScene.update()`.** Cheapest to
   write, but repeats the exact coupling problem the user flagged — timing
   constants, easing, and door-state logic would live interleaved with
   protocol dispatch and player-position code, exactly what a later "change
   the animation" edit should not have to wade through.
3. **(Rejected) Drive animation off a new sim-emitted phase field.** Would
   need a new wire message/field for phase transitions client-side; rejected
   because P2/P3 of the spec is explicit — zero protocol changes, and the two
   existing events (`elevator:called`, `elevator:moved`) plus fixed `TUNING`
   durations are already sufficient to derive every phase transition a
   bystander is allowed to know (see spec Assumptions).

Chosen approach costs one new file and a ~10-line change to two existing
methods; it is the only option that satisfies the spec's ELAN-09/10/11 (P3)
requirements directly.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --- | --- | --- |
| `TUNING.ELEVATOR_ARRIVE_SECONDS` / `RIDE_SECONDS_PER_FLOOR` / `DWELL_SECONDS` | `packages/shared/src/tuning.ts` | Presenter imports `TUNING` directly (already a dependency-free shared package) — single source of truth for every animation duration, unchanged by this cycle |
| `this.cars` map (`{ ellipse, floor }` per car) | `apps/client/src/scenes/WorldScene.ts:93` | Presenter takes the `Ellipse` handle at construction; WorldScene keeps owning creation/destruction of the Ellipse (harness contract — presenter never creates/destroys Ellipses, only repositions/toggles them) |
| `carPx(car)` landing-x helper | `WorldScene.ts:317-319` | Reused as-is to compute tween target x; presenter receives it via constructor injection (a plain function), not by importing WorldScene |
| `MovementAction` cases `'elevator-called'` / `'elevator-moved'` | `WorldScene.applyAction` | Stay the dispatch entry point; each case now also forwards plain fields to the presenter (no new action types) |
| Update loop (`WorldScene.update(dt)`) | `WorldScene.ts:~380-410` | Gains one line calling `this.elevatorPresenter.tick(dt, this.viewFloor)` — presenter owns its own internal per-car clocks |

### Integration Points

| System | Integration Method |
| --- | --- |
| `WorldScene.create()` | Constructs `new ElevatorPresenter(scene, this.cars, this.carPx.bind(this), this.carY.bind(this))` once, alongside existing car Ellipse creation |
| `WorldScene.applyAction` | `elevator-called` → `presenter.onCalled(action.car, action.floor as FloorId)`; `elevator-moved` → `presenter.onMoved(action.car, action.floor as FloorId)` (existing panel-update calls unchanged, run alongside) |
| `WorldScene.update(dt)` | One added call: `this.elevatorPresenter.tick(dt, this.viewFloor)` — presenter reads `viewFloor` only to decide what's visible, mirroring the existing `car.floor === this.viewFloor` gate |
| Harness (`round.spec.ts`, `movement.spec.ts`, `work.spec.ts`) | Untouched — doors are drawn via `Phaser.GameObjects.Graphics` (a `Graphics` child, not `Rectangle`/`Ellipse`), so existing `type === 'Rectangle'`/`type === 'Ellipse'` counts stay exact |

---

## Components

### `ElevatorPresenter`

- **Purpose**: Own all door/motion visual state for the building's two
  elevator cars, driven only by plain facts and fixed tuning constants — no
  protocol, no Colyseus, no scene-internal state beyond what's injected.
- **Location**: `apps/client/src/scenes/elevatorPresenter.ts` (new file)
- **Interfaces**:
  - `onCalled(car: 1 | 2, floor: FloorId): void` — marks the car's phase-clock
    entering `closing` if it was parked open at a different floor (a public
    dispatch is definite departure evidence)
  - `onMoved(car: 1 | 2, floor: FloorId): void` — marks a stop: the car is now
    at `floor`, the clock enters `open` immediately so the dwell window is
    measured from this exact event (ELAN-02)
  - `tick(dtMs: number, viewFloor: FloorId): void` — advances every car's
    internal clock, updates door Graphics and Ellipse visibility/position for
    cars on `viewFloor` only; hides everything for cars not on `viewFloor`
    (mirrors existing gate, now centralized here)
  - `reset(): void` — called from `WorldScene.create()` on every scene
    restart (lobby→round→lobby), matching the existing `this.cars.clear()`
    reset discipline
- **Dependencies**: `TUNING` from `@turnover/shared`, `FloorId` type, and
  constructor-injected scene/car handles plus `carPx`/`carY` functions — no
  `Colyseus`, no `MovementAction`, no registry types, no `Phaser.*` value
  imports (structural interfaces keep the module testable under node)
- **Reuses**: `TUNING` constants (no new tuning values), the existing
  `carPx()`/`carY()` landing math, the existing `Ellipse` instances
  (repositions them, never re-creates them)

### Per-car `CarClock` (exported type, pure-data)

- **Purpose**: Local rendering-only state machine with three phases
  (`open`, `closing`, `transit`). Arrival motion is not a separate phase — it
  is a cosmetic overlay read from the first slice of `open` (`carAlpha`,
  `carY`, `doorsOpenAmount`), so the dwell deadline is never delayed by local
  animation (ELAN-02). Intentionally NOT a 1:1 mirror of the sim's
  authoritative phases (the sim's `riding` phase duration is rider-exclusive
  information; see spec Assumptions).
- **Location**: Same file, `CarClock` interface is exported for unit tests.
- **Interfaces**: `advanceCarClock`, `doorsOpenAmount`, `carAlpha`, `carY`,
  `carVisible` — pure functions over `CarClock` + `AnimationConfig`.
- **Dependencies**: none beyond `TUNING`
- **Reuses**: n/a (new, minimal)

---

## Data Models

No persistent data. Presenter-internal, ephemeral, per-scene-lifetime state:

```typescript
interface CarClock {
  /** Rendering-only phase name — distinct from the sim's phase enum; see
   *  spec Assumptions on the bystander information boundary. */
  phase: 'open' | 'closing' | 'transit'
  /** ms elapsed since entering the current phase. */
  elapsedMs: number
  /** The floor this car is currently rendered at (last known via onMoved). */
  floor: FloorId
  /** While in `transit`, the floor named by a real `elevator:moved` that
   *  arrived before the fixed minimum transit duration elapsed. */
  pendingFloor: FloorId | null
  /** Floor the car is arriving from, for the arrival slide (ELAN-06). */
  fromFloor: FloorId | null
}
```

**Relationships**: One `CarClock` per car id (`1 | 2`), held in a
`Map<1 | 2, CarClock>` inside `ElevatorPresenter`. No relationship to any
persisted/server model — purely a rendering derivative of `elevator:called`
and `elevator:moved` receipt timing plus fixed `TUNING` durations.

---

## Risks & Concerns

- **Fragile-code flag**: `WorldScene.update()` is already a single 40-line
  method mixing several concerns (own-player prediction, other-player lerp,
  car visibility, panel refresh, work-bar DOM). Mitigation: this design adds
  exactly one line to that method (`presenter.tick(...)`) and moves zero
  existing lines into the presenter — it does not attempt to refactor
  `update()` beyond that, keeping this cycle's diff minimal and reviewable.
  A follow-up cycle could extract the other concerns similarly if desired;
  out of scope here.
- **Test-coverage gap**: no existing gate scenario asserts *visual* animation
  state (door alpha, tween position) — `round.spec.ts`/`movement.spec.ts`
  assert object *counts* and `floor`/`x` data fields only. Mitigation:
  `sim`-free unit coverage for `CarClock`/`ElevatorPresenter` timing logic
  directly (pure functions, no Phaser needed for the clock math) plus a fake
  `GraphicsLike` recorder that asserts real door geometry, plus one new
  `client:elevator_doors` Playwright scenario asserting the new `Graphics`
  child appears/disappears and the Rectangle/Ellipse counts stay unchanged
  (ELAN-04 direct check).
- **Bystander-information risk**: getting the "in-transit, unknown duration"
  rendering wrong (e.g., picking a duration that leaks whether a ride is long
  or short) would violate the message-only hard rule in spirit even without a
  new wire message. Mitigation: P2 AC1 pins a fixed minimum transit duration
  independent of actual ride length — the visual never varies with the real
  (unknown-to-bystander) distance.
