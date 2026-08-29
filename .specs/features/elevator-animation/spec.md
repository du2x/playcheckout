# Elevator Animation Specification

Client-only presentation cycle (no protocol/sim changes; inserted ad hoc,
outside the numbered 2.x cycle table — pure rendering work layered on the
elevator state machine `elevator-riders` (AD-013/AD-014) already shipped).

## Problem Statement

Elevator cars are mechanically real (four-phase state machine: idle → arriving
→ dwelling → riding, cycle `elevator-riders`) but visually mute: `WorldScene`
snaps a car's Ellipse straight to its new floor on every `elevator:moved`, with
no door animation and no riding motion. The elevator is the game's strongest
shared-knowledge moment (AD-013's own rationale) and today it looks like
nothing is happening. This spec adds door-open/close and ride-motion animation
without changing any wire message, sim tick, or visibility policy — and does
it through a rendering module decoupled enough that a later restyle (different
easing, sprites, timings) never touches scene/state-consuming code.

## Goals

- [ ] Doors visibly open at every stop (idle + dwelling phases) and close before departure, timed off `TUNING.ELEVATOR_DWELL_SECONDS` — no new protocol messages
- [ ] A car visibly moves between floors while riding, instead of snapping, timed off `TUNING.ELEVATOR_ARRIVE_SECONDS` / `ELEVATOR_RIDE_SECONDS_PER_FLOOR`
- [ ] Animation logic lives in one presentation module with no dependency on Colyseus/protocol types; `WorldScene` feeds it plain phase/floor facts and owns no easing/tween details itself
- [ ] The existing harness rendering contract is preserved: `scene.children.list` still contains exactly one `Rectangle` per player and exactly one `Ellipse` per elevator car (`round.spec.ts`, `movement.spec.ts`, `work.spec.ts` all count on this) — new visuals use non-`Rectangle`/non-`Ellipse` Phaser types or DOM

## Out of Scope

| Feature | Reason |
| --- | --- |
| New or changed wire messages (`elevator:*`) | Client-only cycle; the sim's phase machine and event set (`elevator-riders`, AD-013/AD-014) are locked and already carry everything this cycle consumes |
| Rider-POV in-scene animation (seeing the car interior while riding) | AD-009 stands: riders render on no floor; the existing DOM rider chip is the only rider-POV surface, untouched here |
| Bystander knowledge of a departed car's destination or exact ride duration | The destination lives in the rider-exclusive press queue (AD-013); a bystander legitimately cannot know it — this cycle animates only what a bystander/panel can already infer (doors closed = car departed, in indeterminate transit, until the next public `elevator:moved`) |
| Sound/audio cues | prd's "Art/audio polish... comes later" explicit exclusion (prd.md line 49); this cycle is visual-only |
| Spectator full-building elevator rendering | Separate, not-yet-specified feature (FR-20); this cycle only touches the existing single-floor `viewFloor` render path |
| New tuning values | All timings reuse existing `TUNING.ELEVATOR_ARRIVE_SECONDS` / `RIDE_SECONDS_PER_FLOOR` / `DWELL_SECONDS`; changing any of them is a separate AD, out of this cycle's scope |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Bystander ride-in-transit visual, exact duration unknown | Car Ellipse hides (or renders a generic "in transit" state) once doors are shown closed after dwell elapses, and reappears/tweens to its new floor position only when the next `elevator:moved` arrives for that car | Matches the real information boundary: bystanders/panels only ever learn a car's position at a stop (FR-6), never its destination or ETA (AD-013 keeps the press queue rider-exclusive) — inventing a fake duration would leak information the wire doesn't carry | y (derived from AD-013's locked information boundary; no user input needed — this is a fact about the existing protocol, not a product decision) |
| Door visual asset | Two simple `Phaser.GameObjects.Rectangle`-shaped panels are NOT used (would corrupt the harness's Rectangle-per-player count); use `Phaser.GameObjects.Graphics` (drawn rects) or `Phaser.GameObjects.Image`/procedural texture instead | Preserves the LIGHT-09/MOVE/WORK harness contracts verbatim — they assert `type === 'Rectangle'` counts equal to player count and `type === 'Ellipse'` counts equal to 2 | y (hard constraint from existing harness code, not a judgment call) |
| Own-floor-only rendering unchanged | Doors/motion animate only for the car(s) on the local player's current `viewFloor`, exactly like today's Ellipse visibility gating | No new cross-floor information; keeps AD-008/AD-009 visibility boundaries untouched | y |
| Animation module boundary | New module (e.g. `apps/client/src/scenes/elevatorPresenter.ts`) takes only plain data (car id, floor, phase-derived timing anchors) and Phaser scene/graphics handles — no import of `@colyseus/*`, no protocol/registry types beyond what's already plain (`FloorId`) | Explicit user request for low coupling — this is the concrete shape of "low coupling" for this codebase's existing module boundaries (WorldScene already isolates protocol dispatch from rendering; this extends the same discipline to the new visual) | y |
| Trigger source for phase timing | The presenter derives phase timing locally from `elevator:called` (arrival begins) / `elevator:moved` (dwell begins) receipt times plus the fixed `TUNING` durations — it does not require a new phase field on the wire | These two existing events already bound every phase transition a bystander needs (dispatch instant, stop instant); reusing them keeps this a zero-protocol-change cycle | y |
| Multiple concurrent riders/cars | Each of the 2 cars gets its own independent presenter timer/door state; no shared animation clock | Cars already have fully independent phase machines (AD-014); one clock could not represent both, and this is nothing new to derive since `this.cars` is already keyed per car | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Doors open and close at every stop ⭐ MVP

**User Story**: As a player watching an elevator, I want to see its doors open
when it arrives and close before it leaves, so the car reads as a real
elevator instead of a silently-relocating icon.

**Why P1**: This is the core visible gap — today there is no door state at
all, and the sim already exposes an open-door dwell (`ELEVATOR_DWELL_SECONDS`)
that nothing renders.

**Acceptance Criteria**:

1. WHEN a car's phase becomes `idle` or `dwelling` on the local player's current floor THEN the presenter SHALL render that car's doors as open <!-- event-driven -->
2. WHEN an open-door car's dwell timer (from the last `elevator:moved` for that car) reaches `TUNING.ELEVATOR_DWELL_SECONDS` with no further stop at that floor THEN the presenter SHALL render that car's doors as closed before any position change is shown <!-- event-driven -->
3. WHILE a car's doors are rendered open on the local player's floor THE presenter SHALL keep the car Ellipse (or equivalent) visible at that floor's landing position <!-- state-driven -->
4. IF the local player's `viewFloor` changes away from a car's floor THEN the presenter SHALL stop rendering that car's door state (no cross-floor leakage — same boundary as today's Ellipse visibility) <!-- unwanted-behavior -->

**Independent Test**: Load two clients on the same floor, call a car with one,
watch: Ellipse appears with an open-door visual, then closes ~1s later before
any move; can demo without the ride-motion story existing yet.

---

### P2: Car visibly rides between floors

**User Story**: As a player, I want to see the elevator icon move (or
convincingly leave/arrive) rather than teleport between floor views, so a ride
feels like transit instead of a state flip.

**Why P2**: Builds on P1's door state; without doors already working there is
nothing to animate a transition *out of*.

**Acceptance Criteria**:

1. WHEN a car's doors finish closing (P1 AC2) THEN the presenter SHALL render that car as departed from the local player's floor (hidden or an "in transit" visual) for at least the shorter of the remaining known travel bound or a fixed minimum transit duration <!-- event-driven -->
2. WHEN `elevator:moved` arrives for a car whose floor now equals the local player's `viewFloor` THEN the presenter SHALL render that car arriving at its landing position (tween or equivalent motion, not an instant snap) and then render its doors opening per P1 AC1 <!-- event-driven -->
3. IF `elevator:moved` arrives for a car while the local player's `viewFloor` differs from that car's new floor THEN the presenter SHALL NOT render any transit/arrival visual for that car (no information beyond the existing floor-gated Ellipse visibility) <!-- unwanted-behavior -->
4. The presenter SHALL derive all P2 timings only from `TUNING.ELEVATOR_ARRIVE_SECONDS` / `ELEVATOR_RIDE_SECONDS_PER_FLOOR` and existing event receipt times — no new wire fields <!-- ubiquitous -->

**Independent Test**: Call a car away from the local floor, observe it depart
(P1), then return to the same floor and watch it visibly arrive rather than
pop into existence.

---

### P3: Presenter module is swappable without touching scene/state code

**User Story**: As the developer, I want to change door timing, easing, or
visual style later by editing one file, so animation changes never risk
re-breaking movement/protocol logic or the harness contract.

**Why P3**: Explicit user request ("low level coupling... change easily") —
not required for the animation to work, but required for the stated goal of
this cycle.

**Acceptance Criteria**:

1. The system SHALL expose the animation behavior through a single module whose public interface accepts only plain data (car id, floor id, phase-transition timestamps) and a Phaser scene/container handle <!-- ubiquitous -->
2. The system SHALL NOT import Colyseus, protocol/registry, or `MovementAction` types inside the animation module <!-- ubiquitous -->
3. WHEN `WorldScene.applyAction` receives an `elevator-called` or `elevator-moved` action THEN it SHALL forward only the plain fields the presenter needs (car id, floor, event timestamp) rather than the raw `MovementAction` <!-- event-driven -->

**Independent Test**: Change a timing constant or swap the easing function
inside the presenter module alone and confirm no other file needs to change
for the visual to update (grep for imports of the module — WorldScene is the
only consumer).

---

## Edge Cases

- IF a car is drafted for a ghost trip (no riders, pressed floor served empty — AD-014) THEN the presenter SHALL still animate doors/motion identically to an occupied car (bystanders cannot and must not distinguish occupancy from the wire, AD-013) <!-- unwanted-behavior -->
- IF the local player boards a car (rider POV, AD-009) THEN the presenter SHALL NOT render that car's Ellipse or door state on the boarder's own view while riding (existing rider-hides-own-rect rule is unchanged; presenter must not resurrect it) <!-- unwanted-behavior -->
- IF the local player's `viewFloor` changes mid-animation (e.g., they ride their own elevator away and the view switches) THEN the presenter SHALL discard in-flight tweens for the old floor's cars without error <!-- unwanted-behavior -->
- WHEN two calls arrive back-to-back for the same car (decoy flash, MOVE-12/AD-012) with the car already at that floor with doors open THEN the presenter SHALL NOT restart the door-open animation (idempotent: already-open stays open, no visual flicker) <!-- unwanted-behavior -->

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ELAN-01 | P1: Doors open/close at every stop | Execute | Done |
| ELAN-02 | P1: Doors open/close at every stop | Execute | Done |
| ELAN-03 | P1: Doors open/close at every stop | Execute | Done |
| ELAN-04 | P1: Doors open/close at every stop | Execute | Done |
| ELAN-05 | P2: Car visibly rides between floors | Execute | Done |
| ELAN-06 | P2: Car visibly rides between floors | Execute | Done |
| ELAN-07 | P2: Car visibly rides between floors | Execute | Done |
| ELAN-08 | P2: Car visibly rides between floors | Execute | Done |
| ELAN-09 | P3: Presenter module is swappable | Execute | Done |
| ELAN-10 | P3: Presenter module is swappable | Execute | Done |
| ELAN-11 | P3: Presenter module is swappable | Execute | Done |
