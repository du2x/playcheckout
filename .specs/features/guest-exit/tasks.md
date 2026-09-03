# guest-exit Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/guest-exit/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (4-gate verification ladder), `vitest.config.ts` (workspace project contract), `.opencode/skills/turnover-sim-harness` (Gate 2 scenario format), `.opencode/skills/turnover-gates` (gate ladder + evidence).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
|---|---|---|---|---|
| Shared tuning / `settleTargetFor` | unit (vitest, node) | 1:1 to spec ACs; values pinned per lobby size; clamp asserted | `packages/shared/src/**/*.test.ts` | `pnpm vitest run packages/shared` |
| Sim domain (bot harness, win checks, arrival resolution) | unit (vitest, node, seeded) | All branches; 1:1 to spec ACs; named `sim:guest_exit_a` / `sim:guest_exit_b` scenarios; determinism pin | `packages/sim/src/*.test.ts` | `pnpm vitest run packages/sim` |
| Server transport seams | none | - (no server change in this cycle) | - | - |
| Client presenter / harness | none | - (no client change in this cycle) | - | - |
| Docs (prd/roadmap/STATE) | none | - (review gate only) | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
|---|---|---|
| Quick | After unit-only tasks | `pnpm typecheck && pnpm vitest run <touched paths>` |
| Full | After tasks touching sim + shared | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Build | After last task / docs-only | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Bot harness (pure churn + mis-place)

```
T1 → T2
```

### Phase 2: Calibration + closure

```
T2 → T3 → T4
```

---

## Task Breakdown

### T1: Pure-churn throughput harness `sim:guest_exit_a` — DONE

**What**: Implement the deterministic pure-churn bot runner: stairs-preferring delivery bots (walk 6 tiles/s, stairs 3 s + 2 s breath per stride, single elevator fallback) driving the real `MovementSim` + `GuestSim` + `RoundSim` tick at 20 Hz for 300 s, with no saboteur sabotage or mis-placement; run 20 seeds per lobby size (4p/5p/6p) and assert the EXIT-01..05 bands — `sim:guest_exit_a`.
**Where**: `packages/sim/src/guestExit.test.ts` (new) — helper `runPureChurn` + `describe('sim:guest_exit_a')`
**Depends on**: None
**Reuses**: `MovementSim` single-car east + stairs west, `RoundSim` `PortAdapter` real-movement pattern (`complaints.test.ts` `PortAdapter`), `GuestSim` seeded cadence/dwell/dining, `TUNING.GUEST_CADENCE_SECONDS` / `settleTargetFor`, `roomDoorXMilli`/`HALL_LENGTH_TILES`/`DESK_X_TILES`, `STAIRS_TRANSIT_TICKS`/`STAIRS_BREATH_TICKS`
**Requirement**: EXIT-01, EXIT-02, EXIT-03, EXIT-04, EXIT-05

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [x] 20-seed loop per lobby size: each seed constructs `MovementSim` + `RoundSim({seed, playerIds, movement: PortAdapter})`, drives bot `movement.tick()` → `sim.tick(positions)` at 20 Hz, counts `guest:settled` (`sim.settledCount`) and `guest:discovered` (`sim.complaintCount`) and `round:ended` win reason
- [x] 6p hit rate ≥16/20 (≥80%), 5p ≥16/20, 4p ≥15/20 — fails the test otherwise; one-seed replay determinism pinned (seed 7 trace identical across two runs)
- [x] Complaint mode ≤2 and `<COMPLAINT_BUDGET` in ≥19/20 runs; zero-misplace pin (no `suitcase:placed` at wrong room)
- [x] `pnpm vitest run packages/sim/src/guestExit.test.ts -t "guest_exit_a"` green; `pnpm typecheck` green
- [x] No `Math.random` in `packages/sim` (grep pinned)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): pure-churn throughput harness guest_exit_a (3.5)`

---

### T2: Mis-placement saboteur vs intercepting staff `sim:guest_exit_b` — DONE

**What**: Extend the same runner with the free mis-placement saboteur (`room+1 mod 8` on assigned floor, silent `suitcase:placed`) and idle-scan correction bots (idle staff seeing `rest ≠ guest:assigned` walk to that door via stairs, `suitcasePickup` within `ROOM_DOOR_RANGE_TILES`, re-place at correct assignment); assert the EXIT-06..10 bands — `sim:guest_exit_b` — plus the two kill checks in the same runs.
**Where**: `packages/sim/src/guestExit.test.ts` (same file) — helper `runWithMisplace` + `describe('sim:guest_exit_b')`
**Depends on**: T1
**Reuses**: `sim.restingSuitcases()` misplace detector, `guest:assigned` building-wide store, `guest:complained` vs `guest:discovered` split (AD-039/041), ambush `stairs:ambushed`/`stairs:ambush` authority, `ROOM_DOOR_RANGE_TILES`/`DESK_RANGE_TILES`
**Requirement**: EXIT-06, EXIT-07, EXIT-08, EXIT-09, EXIT-10

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [x] 20-seed loop at 6p: saboteur competes for desk (`deskInteract`) and for each `suitcase:carried` sets `target = wrongRoom` (`(room%8)+1`); staff idle scan finds `restingSuitcases().find(r=> assign.get(r.guestId)!==r)` and corrects before `guest:complained` when possible
- [x] Staff win band 4–18/20 (20–90% for bots; human sab expected 35–65% per prd §8) — fails otherwise; on 0% or 100% the test would force a dial move (design: the run proves the band is inside)
- [x] Keep-pace: `corrections ≥ misplaces × 0.5` on average; `guest:complained` fires at least once across 20 seeds but never increments `sim.complaintCount` and never moves `settledCount` (wrong-delivery inertness)
- [x] Kill checks pinned inside the same 20 runs: ambush with no trash moves 0 `guest:discovered` (differential: ambush run vs calm run byte-identical guest streams + correct ambush payload), and an ambush never names its victim's stun as a complaint source
- [x] `pnpm vitest run packages/sim/src/guestExit.test.ts -t "guest_exit_b"` green; existing `guestExit_a` stays green

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): mis-placement interception harness guest_exit_b (3.5)`

---

### T3: `SETTLE_TARGET` calibration (shared tuning) — DONE

**What**: Measure the 20-seed hit rates from T1/T2 and calibrate `TUNING.SETTLE_TARGET` — keep 4p 5 / 5p 7 / 6p 9 when the gates pass (the probe3/4 proof), otherwise move the failing size by ±1 via a recorded AD and re-prove; pin the values through `settleTargetFor`.
**Where**: `packages/shared/src/tuning.ts` (only if the gate forces a move) + `packages/shared/src/tuning.test.ts` (pin)
**Depends on**: T2
**Reuses**: `settleTargetFor` clamp rule, AD-039 `SETTLE_TARGET` row
**Requirement**: EXIT-11, EXIT-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `TUNING.SETTLE_TARGET` reads 5/7/9 (or the re-proven calibrated triple) and `tuning.test.ts` asserts `expect(settleTargetFor(4)).toBe(5)` etc. plus the clamp outliers
- [ ] No other §7 dial changed (grep `TUNING.` diff is exactly the `SETTLE_TARGET` line if any)
- [ ] `pnpm vitest run packages/shared` green; `pnpm typecheck` green

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): calibrate SETTLE_TARGET (3.5)` or `chore(shared): keep SETTLE_TARGET after 3.5 gate (probe proves 5/7/9)`

---

### T4: Docs & AD — §7 locks — DONE

**What**: Record the 3.5 balance-gate verdict as AD-NNN in `.specs/STATE.md` (bot design, measured hit rates per size, misplace/correction keep-pace, complaint mode/reachability, dial decision with rationale, handoff to 3.6 `telemetry`), and reflect the verdict in `prd.md` §7/§8 (calibrated `SETTLE_TARGET` row + one-line calibration note, §8 recompute stays or gains the note) and `roadmap.md` Phase 3 exit.
**Where**: `.specs/STATE.md`, `prd.md`, `roadmap.md` (docs-only)
**Depends on**: T3
**Reuses**: AD-039/040/041 entry format, prd §7 single-source rule
**Requirement**: EXIT-11, EXIT-12, EXIT-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `.specs/STATE.md` carries AD-NNN with the 7 implementation choices (bot model, sab wrong-room rule, interception predicate, success bands, seed count, determinism, clamping), the measured numbers (`exit_a` 6p/5p/4p hit rates, `exit_b` 6p win band + avg corrections/misplaces, complaint mode), the dial decision (keep 5/7/9 — or move with re-proof note), and the handoff (`Next step: cycle 3.6 telemetry`)
- [ ] `prd.md` §7 `Settle target` row reflects the calibrated triple; §8 retains the v1.6 `1.5× headroom` verdict and, if the budget proved unreachable, a `COMPLAINT_BUDGET` note via a new AD reference
- [ ] `roadmap.md` Phase 3 exit notes the 3.5 verdict (kept/proven vs moved) and the §7 lock
- [ ] Full ladder green: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: none
**Gate**: build

**Commit**: `docs(specs): close the guest-exit cycle on the verifier PASS (3.5)`

---

## Task Granularity Check

| Task | Scope | Status |
|---|---|---|
| T1: Pure-churn harness `guest_exit_a` | 1 file, 1 scenario + helper | ✅ Granular |
| T2: Mis-placement `guest_exit_b` | 1 file, 1 scenario + helper (extends T1) | ✅ Granular |
| T3: `SETTLE_TARGET` calibration | 1 tuning constant + 1 test file | ✅ Granular |
| T4: Docs & AD | 3 docs + 1 AD entry | ✅ Granular (docs bundle, same decision) |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
|---|---|---|---|
| T1 | None | None (first in Phase 1) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
|---|---|---|---|---|
| T1: Pure-churn harness | Sim domain | unit | unit | ✅ OK |
| T2: Mis-placement harness | Sim domain | unit | unit | ✅ OK |
| T3: `SETTLE_TARGET` calibration | Shared tuning | unit | unit | ✅ OK |
| T4: Docs & AD | Docs | none | none | ✅ OK |

