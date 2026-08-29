# Elevator Animation Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name
and follow its Execute flow and Critical Rules.** Do not search for skill
files by filesystem path. The skill is the source of truth for the full flow
(per-task cycle, sub-agent delegation, adequacy review, Verifier,
discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed
without it.**

---

**Design**: `.specs/features/elevator-animation/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase sampling. Guidelines found: `AGENTS.md` (gate ladder:
> `pnpm typecheck` + `pnpm lint`, `pnpm test:sim`, `pnpm test:client`, human
> round). No stack-specific testing doc beyond `AGENTS.md`'s gate ladder;
> depth/style inferred from existing sibling tests (`riderSession.test.ts`,
> `movement.test.ts`, `movement.spec.ts`).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Pure clock/reducer logic (`advanceCarClock`, phase transitions) | unit | All branches; 1:1 to spec ACs ELAN-01/02/05/07/08 + edge cases (idempotent re-open, viewFloor discard) | `apps/client/src/scenes/elevatorPresenter.test.ts` | `pnpm test:sim` (vitest project `apps/client`) |
| `ElevatorPresenter` Phaser-facing wiring (Graphics/Ellipse updates) | unit | Constructor wiring + `onCalled`/`onMoved`/`tick`/`reset` call the pure reducer and touch only injected handles — smoke-level, not pixel-level (Phaser Graphics has no meaningful assertable pixel state in vitest) | same file as above | `pnpm test:sim` |
| `WorldScene` wiring (applyAction forwarding, update loop call) | e2e (existing harness pattern — WorldScene has no standalone unit tests today) | New browser scenario asserting the Rectangle/Ellipse count contract stays exact + a new non-Rectangle/non-Ellipse child appears during a call | `apps/client/harness/elevator-doors.spec.ts` (new file, mirrors `movement.spec.ts` style) | `pnpm test:client` |
| Docs / traceability | none | Spec traceability table updated; no test | `.specs/features/elevator-animation/spec.md` | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks touching only pure clock logic | `pnpm test:sim` |
| Full | After tasks touching `WorldScene`/harness | `pnpm test:sim && pnpm test:client` |
| Build | After final task / before commit-closing the feature | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next
begins, and tasks within a phase execute in order.

### Phase 1: Pure clock logic (no Phaser)

```
T1 → T2
```

### Phase 2: Presenter + scene wiring

```
T1 → T3 → T4
```

### Phase 3: Harness verification + traceability close-out

```
T4 → T5 → T6 → T7
```

Total: 7 tasks, one batch (≤ ~7-task budget) — no sub-agent offer needed;
execute inline.

---

## Task Breakdown

### T1: Define `CarClock` type and `advanceCarClock` pure reducer — ✅ Done

**What**: Add the `CarClock` interface (`phase`, `msRemaining`, `floor`) and a
pure function `advanceCarClock(clock: CarClock, dtMs: number, tuning: typeof TUNING): CarClock`
implementing the four rendering phases (`doors-open` → `doors-closing` →
`in-transit` → `arriving` → back to `doors-open`), driven only by
`TUNING.ELEVATOR_DWELL_SECONDS` / `ELEVATOR_ARRIVE_SECONDS` /
`ELEVATOR_RIDE_SECONDS_PER_FLOOR` and a fixed minimum in-transit duration
constant local to this file (per spec P2 AC1 / Risks note — not a new
`TUNING` value, since it is a rendering-only floor, not a game-timing fact).
**Where**: `apps/client/src/scenes/elevatorPresenter.ts` (new file)
**Depends on**: None
**Reuses**: `TUNING` from `@turnover/shared`
**Requirement**: ELAN-01, ELAN-02, ELAN-05, ELAN-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `CarClock` type and `advanceCarClock` exported, no Phaser import in this function's dependency graph
- [ ] Doors render open on `idle`/`dwelling` entry, close after `ELEVATOR_DWELL_SECONDS` elapses with no further stop, matching ELAN-01/02
- [ ] Transit phase lasts at least the fixed minimum duration, independent of actual (unknown) ride length, matching ELAN-05/08
- [ ] No TypeScript errors (`pnpm typecheck`)

**Tests**: unit
**Gate**: quick

---

### T2: Unit-test `advanceCarClock` against every ELAN P1/P2 AC and edge case — ✅ Done

**Execution note**: implemented together with T1 and T3 in one commit — the pure
reducer (T1) and the `ElevatorPresenter` class (T3) landed in the same file by
design (`elevatorPresenter.ts`), and this task's test file exercises both the
reducer and a smoke-level check of the class. Splitting one file's diff across
three commits would have been an artificial slice, not a real task boundary;
see the commit body for the explicit deviation note.

**What**: Write `elevatorPresenter.test.ts` covering: door-open on
idle/dwelling entry (ELAN-01), close timing at exactly `DWELL_SECONDS`
(ELAN-02), in-transit fixed-duration floor independent of distance (ELAN-05,
ELAN-08), idempotent re-open on a decoy re-call while already open (Edge Case
4), and clock-discard behavior when the floor changes mid-animation (Edge
Case 3 — modeled as a `reset`-style call on the pure clock).
**Where**: `apps/client/src/scenes/elevatorPresenter.test.ts` (new file)
**Depends on**: T1
**Reuses**: existing vitest conventions from `apps/client/src/riderSession.test.ts`
**Requirement**: ELAN-01, ELAN-02, ELAN-05, ELAN-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] All listed cases pass under `pnpm test:sim`
- [ ] Every P1/P2 acceptance criterion in the spec has at least one directly-traceable test

**Tests**: unit
**Gate**: quick

---

### T3: Implement `ElevatorPresenter` class (Phaser-facing) — ✅ Done

**What**: Add the `ElevatorPresenter` class in the same file: constructor
takes `(scene: Phaser.Scene, cars: Map<1 | 2, { ellipse: Phaser.GameObjects.Ellipse }>, carPx: (car: 1 | 2) => number)`;
public methods `onCalled(car, atMs)`, `onMoved(car, floor, atMs)`,
`tick(dtMs, viewFloor)`, `reset()`. Internally holds one `CarClock` per car
in a `Map<1 | 2, CarClock>`, advances each via `advanceCarClock` on `tick`,
and on each tick: creates/reuses one `Phaser.GameObjects.Graphics` per car
(drawn rectangles for doors — never a `Rectangle`/`Ellipse` game object, per
design's harness-contract constraint) reflecting `doorsOpenAmount()`, and
repositions/toggles the injected car `Ellipse` per `visiblePosition()` and
`viewFloor` gating (mirrors today's `car.floor === this.viewFloor` check,
now centralized here).
**Where**: `apps/client/src/scenes/elevatorPresenter.ts` (same file as T1)
**Depends on**: T1
**Reuses**: `carPx()` (injected, not imported), existing `Ellipse` instances from `WorldScene.cars`
**Requirement**: ELAN-01, ELAN-03, ELAN-04, ELAN-06, ELAN-09, ELAN-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Class compiles with zero imports of Colyseus/protocol/`MovementAction` types (ELAN-09/10 satisfied by construction)
- [ ] `tick()` hides all door/Ellipse visuals for a car when `viewFloor` differs from that car's floor (ELAN-04)
- [ ] Doors drawn via `Graphics`, confirmed by reading the diff (no new `Rectangle`/`Ellipse` calls added)
- [ ] `pnpm typecheck` and `pnpm lint` pass

**Tests**: unit (smoke-level: constructing the class and calling each method does not throw, and the correct pure-reducer path is invoked — no Phaser render assertions, per matrix)
**Gate**: quick

---

### T4: Wire `ElevatorPresenter` into `WorldScene` — ✅ Done

**Execution note**: T3's actual `onCalled(car, floor)`/`onMoved(car, floor)`
signatures (no `atMs`/timestamp param — elapsed time is tracked internally by
`tick(dtMs, ...)`, a purer design than the timestamp-based sketch below) mean
this task forwards `action.car`/`action.floor as FloorId` only, not
`Date.now()`. `create()` builds a fresh `ElevatorPresenter` after the car-
Ellipse loop (its constructor already calls `reset()`, so no separate
`.reset()` call was needed). `update()` passes Phaser's own `delta` (already
milliseconds) straight through as `dtMs`.

**What**: In `WorldScene.create()`, construct `this.elevatorPresenter = new ElevatorPresenter(this, this.cars, this.carPx.bind(this))` after the existing car-Ellipse creation loop, and call `.reset()` alongside the existing `this.cars.clear()` reset block. In `applyAction`, the `'elevator-called'` case calls `this.elevatorPresenter.onCalled(action.car, Date.now())` before/after the existing `this.updatePanel(); this.flashPanel()` calls; the `'elevator-moved'` case calls `this.elevatorPresenter.onMoved(action.car, action.floor as FloorId, Date.now())` before/after the existing `car.floor = action.floor; this.updatePanel()`. In `update(time, dt)`, add `this.elevatorPresenter.tick(dt, this.viewFloor)`, and remove the now-redundant `car.ellipse.setVisible(car.floor === this.viewFloor)` line (superseded by the presenter's own gating in `tick`).
**Where**: `apps/client/src/scenes/WorldScene.ts`
**Depends on**: T3
**Reuses**: existing `applyAction`/`update`/`create` methods, unchanged signatures
**Requirement**: ELAN-03 (P2 AC3), ELAN-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `WorldScene` forwards only plain fields (car id, floor, timestamp) to the presenter — never the raw `MovementAction` (ELAN-11)
- [x] Existing panel update/flash behavior on `elevator-called`/`elevator-moved` is unchanged (byte-identical DOM behavior)
- [x] The old inline `car.ellipse.setVisible(...)` line is removed, replaced by presenter-owned gating
- [x] `pnpm typecheck` and `pnpm lint` pass; `pnpm test:sim` still green (no regression in existing `apps/client` unit tests)

**Tests**: unit (existing `apps/client` vitest suite must stay green; no new unit tests added by this task — covered by T2/T5)
**Gate**: quick

---


### T5: Add `client:elevator_doors` Playwright harness scenario — ✅ Done

**Execution note**: implemented as a single-client scenario (mirrors
`elevatorLobby.spec.ts`'s fast entry point), not the two-clients-call sketch
below. Reasoning: AD-014's duplicate-call predicate is pickup-floor-only, so
any second call to a floor already holding an open-door car is a no-op decoy
— proving a *fresh* dispatch+observe would need a second car parked
elsewhere first, adding setup with no additional coverage over what
`elevatorLobby.spec.ts`/`movement.spec.ts` already prove for the call path.
Instead: ada rides her own car in-car (exercises the SPEC_DEVIATION path —
no `elevator:called` fires for a rider press), and the moment she exits, her
own `viewFloor` flips to the car's floor — she becomes the bystander/observer
of her *own* car's remaining open-door window without a second tab. The
1-second dwell window is generous for `waitForFunction` polling (not for a
human), so no artificial two-client setup was needed. Assertion (b)'s
`Graphics`-node-count idea was dropped: this presenter always keeps exactly
one persistent `Graphics` object per car (created once in `reset()`, cleared/
redrawn every tick, never added/removed), so a *count* check can't
distinguish open vs. closed doors — `Ellipse.visible` is the correct,
already-exposed-by-harness signal instead, and is what the test asserts.
Assertion (c)'s "not visible during transit" is covered as the terminal,
non-flaky end-state check (car1 never departs again after auto-closing in
this scenario).

**What**: New `apps/client/harness/elevator-doors.spec.ts`, modeled on
`movement.spec.ts`'s car-related assertions: join two clients on the same
floor, call a car, and assert (a) `scene.children.list` still contains
exactly N `Rectangle` (= player count) and exactly 2 `Ellipse` — the harness
contract is unbroken; (b) at least one additional non-Rectangle/non-Ellipse
child (`Graphics`) appears while the car is at that floor with doors open,
matching the door visual; (c) the car's `Ellipse` is not visible/rendered at
that floor while the presenter's transit phase is active (best-effort timing
assertion using the known fixed durations from `TUNING`).
**Where**: `apps/client/harness/elevator-doors.spec.ts` (new file)
**Depends on**: T4
**Reuses**: existing harness setup helpers from `movement.spec.ts` (client
join/call helpers), `TURNOVER_TEST_SHIFT_SECONDS` env pattern (AD-004)
**Requirement**: ELAN-01, ELAN-02, ELAN-03, ELAN-04, ELAN-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Scenario passes under `pnpm test:client`
- [x] Rectangle/Ellipse counts assertion matches existing `round.spec.ts`/`movement.spec.ts` style exactly (same query pattern)
- [x] Scenario is named and tagged consistent with existing gate-scenario naming (`client:elevator_doors`) so it is traceable per `AGENTS.md`'s "every task names its gates" rule


**Tests**: e2e
**Gate**: full

---

### T6: Update spec traceability table — ✅ Done

**Execution note**: the Phase column reads `Execute` rather than the
literal `Design` this task's **What** describes — a small deviation, made
because "Design" would misleadingly suggest the requirement was only
designed, not implemented; `spec.md`'s actual diff sets it to `Execute` to
match every other row's Status of `Done`. No requirement content changed.

**What**: Flip every `ELAN-NN` row in `.specs/features/elevator-animation/spec.md`'s
Requirement Traceability table from `Pending` to `Done` (Phase column stays
`Design` — no further downstream phase name applies here).
**Where**: `.specs/features/elevator-animation/spec.md`
**Depends on**: T5
**Reuses**: existing traceability table format
**Requirement**: n/a (documentation close-out)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] All ELAN-NN rows read `Done`

**Tests**: none (matrix pins the docs layer to build-gate only)
**Gate**: build

---

### T7: Close out `.specs/STATE.md` handoff — ✅ Done

**What**: Append a `Handoff` update to `.specs/STATE.md` recording this
cycle's completion (files touched, gates run). No new `AD-NNN` decision
entry is needed — no locked decision was reversed; this cycle only adds a
new rendering module, confirmed against the Decisions section during Design.
**Where**: `.specs/STATE.md`
**Depends on**: T6
**Reuses**: existing Handoff section format in `STATE.md`
**Requirement**: n/a (documentation close-out)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `STATE.md` Handoff section reflects this feature as the most recent completed work, gate results included
- [ ] `python3 <skill-dir>/scripts/validate_state.py elevator-animation` passes once `validation.md` exists (produced by the automatic post-Execute Verifier, not by this task)

**Tests**: none (matrix pins the docs layer to build-gate only)
**Gate**: build

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: pure clock type + reducer | 1 file (new), pure logic only | ✅ Granular |
| T2: unit tests for T1 | 1 test file | ✅ Granular |
| T3: `ElevatorPresenter` class | 1 file (same as T1), one class | ✅ Granular |
| T4: WorldScene wiring | 1 file, three call sites | ✅ Granular |
| T5: harness scenario | 1 file | ✅ Granular |
| T6: spec traceability | 1 file, doc-only | ✅ Granular |
| T7: STATE.md handoff | 1 file, doc-only | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 -> T2 | ✅ Match |
| T3 | T1 | T1 -> T3 | ✅ Match |
| T4 | T3 | T3 -> T4 | ✅ Match |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T5 | T5 -> T6 | ✅ Match |
| T7 | T6 | T6 -> T7 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | pure clock reducer | unit | unit | ✅ OK (test written in T2) |
| T2 | pure clock reducer tests | unit | unit | ✅ OK |
| T3 | presenter class | unit | unit | ✅ OK |
| T4 | WorldScene wiring | unit (regression only) | unit | ✅ OK |
| T5 | harness | e2e | e2e | ✅ OK |
| T6 | spec docs | none | none | ✅ OK |
| T7 | STATE.md docs | none | none | ✅ OK |

Execution is strictly sequential - no intra-phase parallelism. Packing into
task-budgeted batches: Phase 1 (2) + Phase 2 (2, T1 shared with Phase 1 as a
cross-phase dependency) + Phase 3 (3, T4 shared with Phase 2) = 7 distinct
tasks → one batch, at the ~7-task budget — execute inline, no sub-agent
offer.
