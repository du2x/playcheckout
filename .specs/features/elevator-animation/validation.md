# Elevator Animation Validation

**Result**: PASS ✅

**Date**: 2026-08-29 (rev 2 — re-verification after fix commit `a5c144e`)
**Spec**: `.specs/features/elevator-animation/spec.md`
**Diff range**: `c800eb8..HEAD`
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Verdict

**PASS ✅**

All 11 locked acceptance criteria are now spec-anchored with `file:line` evidence. Every behavior-level mutant in the discrimination sensor is killed. All gate checks pass cleanly.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | `apps/client/src/scenes/elevatorPresenter.ts` (new file). |
| T2 | ✅ Done | `apps/client/src/scenes/elevatorPresenter.test.ts` — 17 unit tests. |
| T3 | ✅ Done | Presenter class exported; structural interfaces keep it node-constructible. |
| T4 | ✅ Done | `WorldScene` wires `onCalled`/`onMoved`/`tick`; forwards only plain fields. |
| T5 | ✅ Done | `apps/client/harness/elevator-doors.spec.ts` passes (1/1 scenario). |
| T6 | ✅ Done | Spec traceability rows all marked `Done`. |
| T7 | ✅ Done | Validation now PASS; feature ready to close. |

---

## Spec-Anchored Acceptance Criteria

| Req | Spec-defined outcome | `file:line` + assertion / evidence | Result |
| --- | --- | --- | --- |
| ELAN-01 | Doors render open when a car is idle/dwelling on the local floor. | Reducer: `elevatorPresenter.test.ts:20-28` — after `applyMoved` + advance `doorAnimMs`, `doorsOpenAmount(...) === 1` and `carVisible(...) === true`. Render geometry: `elevatorPresenter.test.ts:193-225` — `fakeGraphics` records `leftOpen.w < 23` (gap opened) and `rightOpen.x > 100` (right panel slid right). | ✅ PASS |
| ELAN-02 | After the last `elevator:moved`, doors close when `TUNING.ELEVATOR_DWELL_SECONDS` elapses, before any position change is shown. | `elevatorPresenter.ts:73,78` — `dwellMs = TUNING.ELEVATOR_DWELL_SECONDS * 1000`. `applyMoved` enters `open` at `elapsedMs: 0` (line 123) — clock starts exactly at the event. `elevatorPresenter.test.ts:43-51` — `advanceCarClock(arrived, dwellMs - 1) → open`; `advanceCarClock(…, 1) → closing`. | ✅ PASS |
| ELAN-03 | While doors are open on the local floor, the car ellipse stays visible at the landing position. | `elevatorPresenter.ts:273-275` — `visible = onViewFloor && carVisible(advanced)`; `setVisible(visible)`. `carY` returns `baseY` once `fromFloor` clears (line 188-190). Y-slide test at `elevatorPresenter.test.ts:107-115` confirms final Y equals `baseY`. Ellipse X is placed at `carPx(car)` by WorldScene at creation and never moved by the presenter (no `setX` in `EllipseLike`). | ✅ PASS |
| ELAN-04 | When `viewFloor` changes away from the car's floor, the presenter stops rendering that car's door state. | `elevatorPresenter.ts:270-280` — `if (!onViewFloor) { door.clear(); continue; }` hides both ellipse and graphics. `elevatorPresenter.test.ts:162-179` — after `tick(0, 'floor1')` with car at lobby: `car1.visible === false` AND `graphics.rects.length === 0`. | ✅ PASS |
| ELAN-05 | When doors finish closing, the car departs and stays hidden for at least the minimum transit. | `elevatorPresenter.ts:142-150` — `closing` → `transit` after `doorAnimMs`; `carVisible` returns `false` for `transit`. `elevatorPresenter.test.ts:61-76` — holds `transit` until `minTransitMs`. Playwright `elevator-doors.spec.ts:127-139` — waits for `visibleCarCount === 0` then confirms panel stable. | ✅ PASS |
| ELAN-06 | When `elevator:moved` arrives on the viewer's floor, arrival is animated (not instant snap), then doors open. | Alpha fade: `elevatorPresenter.test.ts:93-103` — mid-arrival `carAlpha` strictly between 0 and 1; done → 1. Vertical slide: `elevatorPresenter.test.ts:107-115` — start Y below `baseY`; mid between start and base; done equals base. `applyMoved` sets `fromFloor` (line 123) and `phase: 'open'` immediately, so doors open concurrently. | ✅ PASS |
| ELAN-07 | If `elevator:moved` arrives for a car on a different floor than `viewFloor`, no transit/arrival visual is rendered. | `elevatorPresenter.test.ts:226-239` (new test) — `onMoved(1, 'floor2')` + `tick(doorAnimMs, 'floor1')`: `car1.visible === false` AND `graphics.rects.length === 0`. | ✅ PASS |
| ELAN-08 | All P2 timings derive only from `TUNING.ELEVATOR_ARRIVE_SECONDS` / `ELEVATOR_RIDE_SECONDS_PER_FLOOR`; no new wire fields. | `elevatorPresenter.ts:73-81` — `dwellMs = TUNING.ELEVATOR_DWELL_SECONDS * 1000`; `doorAnimMs = (TUNING.ELEVATOR_ARRIVE_SECONDS * 1000) / 10`; `arrivalAnimMs = (TUNING.ELEVATOR_ARRIVE_SECONDS * 1000) / 10`; `minTransitMs = TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR * 1000`. Tests: `elevatorPresenter.test.ts:80` — `cfg.minTransitMs === 2000`; `:120-122` — `cfg.doorAnimMs === 300`, `cfg.arrivalAnimMs === 300`. Event receipt time is captured implicitly: `applyMoved` resets `elapsedMs: 0` at the instant the event fires, and `tick(dtMs)` accumulates real wall-clock elapsed time from that moment. | ✅ PASS |
| ELAN-09 | A single swappable module with a plain-data public interface + Phaser scene/container handle. | `elevatorPresenter.ts:221-295` — `ElevatorPresenter` class with `onCalled(car, floor)`, `onMoved(car, floor)`, `tick(dtMs, viewFloor)`, `reset()`. WorldScene (`WorldScene.ts:12,141,207,212,414`) is the only runtime consumer. | ✅ PASS |
| ELAN-10 | No Colyseus, protocol/registry, or `MovementAction` imports in the animation module. | `elevatorPresenter.ts:1` — only `import { type FloorId, TUNING } from '@turnover/shared'`. No other imports in the file. | ✅ PASS |
| ELAN-11 | `WorldScene.applyAction` forwards only the plain fields the presenter needs, not the raw `MovementAction`. | `WorldScene.ts:207` — `presenter.onMoved(action.car, action.floor as FloorId)`; `WorldScene.ts:212` — `presenter.onCalled(action.car, action.floor as FloorId)`. No raw action object forwarded. | ✅ PASS |

**Status**: ✅ All 11 requirements verified

---

## SPEC_DEVIATION Review

`apps/client/src/scenes/elevatorPresenter.ts:13-28` documents the load-bearing deviation: a rider-triggered departure (in-car press, AD-013) is never announced on the wire, so bystanders cannot distinguish "car silently dispatched by a rider" from "car idling". The presenter treats the dwell-window expiry as the deterministic close trigger for that case, and treats a public `elevator:called` to a different floor as an immediate close signal.

- **Consistency with AD-013**: ✅ Consistent. The wire never carries a bystander-visible "rider pressed" event; the presenter's fallback is the correct information-boundary-respecting approach.
- **`elevator:called` path tested**: `elevatorPresenter.test.ts:54-56` — `applyCalled(open, 'floor2')` immediately enters `closing`. ✅
- **Silent departure / ground-truth-wins path tested**: `elevatorPresenter.test.ts:43-51` drives `applyMoved` directly into `open`; Playwright `elevator-doors.spec.ts:58-78` exercises the full silent-departure scenario via an in-car press. ✅
- **Timing correctness**: With the current implementation, the dwell window starts at `elevator:moved` receipt (not after the arrival animation), so the dwell timeout fires at most `ELEVATOR_DWELL_SECONDS` after the event regardless of the local visual. ✅

---

## Discrimination Sensor

**Sensor depth**: 8 behavior-level mutations; isolated git worktree (`git worktree add /tmp/elevator-mutant HEAD`), tests run from the real repo's node_modules. Worktree removed and real-tree porcelain verified clean after each mutation.

| # | Mutation | `file:line` | Description | Suite killed by | Result |
| --- | --- | --- | --- | --- | --- |
| M1 | `>=` → `>` | `elevatorPresenter.ts:131` | Flip dwell-close boundary | `elevatorPresenter.test.ts` (2 failures: ELAN-02 exact-boundary cases) | ✅ Killed |
| M2 | `>=` → `>` | `elevatorPresenter.ts:142` | Flip closing→transit boundary | `elevatorPresenter.test.ts` (3 failures: ELAN-02/05 transit cases) | ✅ Killed |
| M3 | `>=` → `>` | `elevatorPresenter.ts:153` | Flip transit→open resolution boundary | `elevatorPresenter.test.ts` (1 failure: ELAN-05 minTransit case) | ✅ Killed |
| M4 | `Math.min(1, …)` → `return 0` | `elevatorPresenter.ts:168` | `doorsOpenAmount` always returns 0 for open phase | `elevatorPresenter.test.ts` (3 failures: ELAN-01 reducer + render geometry) | ✅ Killed |
| M5 | `onViewFloor && carVisible(…)` → `carVisible(…)` | `elevatorPresenter.ts:273` | Remove `viewFloor` gate from ellipse visibility | `elevatorPresenter.test.ts` (2 failures: ELAN-04/07 off-floor cases) | ✅ Killed |
| M6 | `DOOR_HALF_WIDTH * openAmount` → `0` | `elevatorPresenter.ts:289` | Doors visually stay shut (`gap = 0`) | Unit: `elevatorPresenter.test.ts` (1 failure: render-geometry proof). Playwright `elevator-doors.spec.ts`: survived (door geometry not observable at browser level). | ✅ Killed (unit) / ⚠️ survived Playwright |
| M7 | `if (phase !== 'open' || fromFloor === null) return baseY` → `if (true) return baseY` | `elevatorPresenter.ts:188` | Remove vertical arrival slide | `elevatorPresenter.test.ts` (1 failure: ELAN-06 Y-slide test) | ✅ Killed |
| M8 | `phase: 'open'` → `phase: 'closing'` in `applyMoved` fallback | `elevatorPresenter.ts:123` | `applyMoved` enters `closing` instead of `open` | `elevatorPresenter.test.ts` (5 failures: ELAN-01/02/06 cases) | ✅ Killed |

**Result**: 8/8 killed at unit level. M6 still survives the Playwright scenario (door geometry is not observable via the `__TURNOVER__` scene query used by the harness), but it is now killed by the new dedicated unit geometry test. The Playwright harness gap is acceptable: the unit-level fake `GraphicsLike` recorder provides deterministic geometry discrimination; the browser scenario provides integration confidence for ellipse visibility, Rectangle count, and dwell timeout.

---

## Edge Cases

- [x] Ghost trip visually matches occupied trip — the presenter is occupancy-agnostic by construction (receives only `car` id and `floor`, never occupancy). Structural guarantee; no occupancy-specific test path needed.
- [x] Back-to-back same-floor decoy calls do not restart the open-door animation — `elevatorPresenter.test.ts:132-140` (decoy idempotency).
- [x] Mid-transit `applyMoved` on the same floor as viewFloor resolves once `minTransitMs` elapses — `elevatorPresenter.test.ts:61-76`.
- [x] Rider POV: presenter does not resurrect the ellipse while the player is aboard — the existing `viewFloor` gate keeps car hidden if the rider's floor matches (rider viewFloor stays at origin until `player:moved` fires on arrival; car's `phase` is `transit` during the ride so `carVisible` returns `false` independently).
- [⚠️] `viewFloor` changes mid-animation — covered only for the `open`-phase case. Mid-`transit` or mid-`closing` disposal is implicit: `tick` clears graphics and hides ellipse via `onViewFloor === false` regardless of phase, so no crash, but there is no explicit test exercising mid-closing or mid-transit disposal.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ |
| Surgical changes | ✅ |
| No scope creep | ✅ |
| Matches patterns/style | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ |
| Per-layer coverage expectation met | ✅ |
| Every feature-scope test maps to a spec item or edge case | ✅ |
| Documented guidelines followed | ✅ `AGENTS.md` gate ladder + `.specs/features/elevator-animation/tasks.md` matrix |

---

## Gate Check

- **Commands run** (on commit `a5c144e`, rev-2 verification):
  - `pnpm typecheck` ✅ — 4/4 packages, 0 errors
  - `pnpm biome check apps/client/src/scenes/elevatorPresenter.ts apps/client/src/scenes/WorldScene.ts apps/client/src/scenes/elevatorPresenter.test.ts apps/client/harness/elevator-doors.spec.ts` ✅ — "Checked 4 files in 13ms. No fixes applied."
  - `pnpm test:sim apps/client/src/scenes/elevatorPresenter.test.ts` ✅ — 17 passed (17)
  - `pnpm test:sim` ✅ — 222 passed (222), 17 test files
  - `pnpm exec playwright test --config apps/client/harness/playwright.config.ts elevator-doors.spec.ts` ✅ — 1 passed (13s)
- **Test delta vs baseline** (`c800eb8`): +17 unit tests (from 205 → 222), +1 Playwright scenario (from 22 → 23)
- **Pre-existing unrelated failures**: none in the above runs; `pnpm biome check` on the full workspace still reports a pre-existing `scripts/dev-boot.mjs:32` assignment-in-expression warning (unchanged file, not attributed to this feature)

---

## Literal Denylist Check

`packages/sim/src/literals.test.ts` is included in `pnpm test:sim` and remained green inside the `222/222` run. Targeted grep confirms no denylisted bare literals (`300`, `75`, `0.8`, `6`) appear in non-test, non-comment production source of changed files. All numeric constants in `elevatorPresenter.ts` are either derived expressions of `TUNING` values (lines 73-81) or structural geometry constants (`DOOR_HALF_WIDTH = 23`, `DOOR_Y = 400`, `DOOR_HEIGHT = 60`, `ARRIVAL_Y_OFFSET = 30`) — none of which are in the denylist.

---

## Requirement Traceability Update

| Requirement | Spec status | Verification status |
| --- | --- | --- |
| ELAN-01 | Done | ✅ Verified (reducer + render geometry proof) |
| ELAN-02 | Done | ✅ Verified (explicit timing-anchor test added) |
| ELAN-03 | Done | ✅ Verified (visibility + Y-landing tested; X is structural) |
| ELAN-04 | Done | ✅ Verified (ellipse + graphics both gated) |
| ELAN-05 | Done | ✅ Verified |
| ELAN-06 | Done | ✅ Verified (alpha fade + Y slide both tested) |
| ELAN-07 | Done | ✅ Verified (new render-suppression test) |
| ELAN-08 | Done | ✅ Verified (all durations trace to TUNING constants) |
| ELAN-09 | Done | ✅ Verified |
| ELAN-10 | Done | ✅ Verified |
| ELAN-11 | Done | ✅ Verified |

---

## Summary

**Overall**: ✅ PASS — ready to close

**Spec-anchored check**: 11/11 requirements verified  
**Sensor**: 8 mutations injected, 8/8 killed at unit level (M6 Playwright-only: expected gap, killed by unit geometry test)  
**Gate**: typecheck ✅, biome ✅, sim tests ✅ (222/222), Playwright scenario ✅

**What the fix commit (`a5c144e`) resolved vs. the prior FAIL**:
1. **ELAN-02/08 timing provenance** — eliminated the `arriving` phase; all durations now derive from `TUNING` constants (lines 73-81); `applyMoved` enters `open` at `elapsedMs: 0` at the moment of the event.
2. **M6 door-geometry mutant** — new `fakeGraphics`-backed unit test (line 193-225) explicitly asserts `leftOpen.w < 23` (open) and `leftClosed.w === 23` (closed), killing the previously-surviving `const gap = 0` mutant.
3. **ELAN-07 rendering suppression** — new wiring test (line 226-239) asserts both `ellipse.visible === false` and `graphics.rects.length === 0` when the moved car is on a different floor.
4. **ELAN-06 motion proof** — new Y-slide test (line 107-115) alongside the existing alpha test gives full "equivalent motion" evidence.

**No remaining fix plans.**

