# delivery-scoring Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/delivery-scoring/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (4-gate verification ladder), `vitest.config.ts` (workspace project contract), `.opencode/skills/turnover-sim-harness` (Gate 2 scenario format), `.opencode/skills/turnover-client-harness` (Gate 3 harness contract).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
|---|---|---|---|---|
| Shared tuning / protocol types | unit (vitest, node) | 1:1 to spec ACs; every listed edge case | `packages/shared/src/*.test.ts` | `pnpm vitest run packages/shared` |
| Sim domain (win checks, guest lifecycle) | unit (vitest, node, seeded) | All branches; 1:1 to spec ACs; named `sim:` scenarios | `packages/sim/src/*.test.ts` | `pnpm vitest run packages/sim` |
| Server transport seams (recap/resume builders) | integration (vitest, node) | Every payload field asserted; projection pins | `apps/server/src/*.test.ts` | `pnpm vitest run apps/server` |
| Client presenter (pure) | unit (vitest, node, Phaser-free) | State transitions + render output | `apps/client/src/**/*.test.ts` | `pnpm vitest run apps/client/src` |
| Client e2e (harness) | e2e (Playwright headless) | Named `client:` scenario, 2× consecutive | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Docs (prd/roadmap/STATE) | none | - (review gate only) | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
|---|---|---|
| Quick | After unit-only tasks | `pnpm typecheck && pnpm vitest run <touched paths>` |
| Full | After tasks with e2e/integration tests | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |
| Build | After last task in a phase / docs-only tasks | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

### Phase 1: Foundation (shared + sim core)

```
T1 → T3
T2 → T3
```

### Phase 2: Transport + client

```
T2 → T4
T1 → T5
T3 → T6
T4 → T6
T5 → T6
T5 → T7
T6 → T7
```

### Phase 3: Contract & closure

```
T3 → T8
T7 → T8
```

---

## Task Breakdown

### T1: `settleTargetFor` dial in shared tuning

**What**: Add the §7 `SETTLE_TARGET` table (4p→5, 5p→7, 6p→9) as a pure `settleTargetFor(playerCount)` helper in the tuning module, clamped for out-of-range counts.
**Where**: `packages/shared/src/tuning.ts` (+ its test file)
**Depends on**: None
**Reuses**: existing TUNING constant module conventions
**Requirement**: DLVR-05, DLVR-06, DLVR-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `settleTargetFor` returns 5/7/9 for player counts 4/5/6
- [x] Out-of-range counts clamp deterministically (never NaN/undefined)
- [x] `pnpm typecheck` green; targeted vitest green

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): add settleTargetFor dial (3.D)`

---

### T2: `GuestSim.settledCount` query

**What**: Expose a monotonic per-round settle counter incremented once per committed `settleAt` (suitcase-match and self-assign paths alike).
**Where**: `packages/sim/src/guests.ts` (+ `guests.test.ts`)
**Depends on**: None
**Reuses**: `settleAt` as the only increment call site; `preppedCount` getter pattern (`work.ts:109`)
**Requirement**: DLVR-01, DLVR-02, DLVR-03

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [x] Counter starts at 0, +1 per settle event, on BOTH the suitcase-match and self-assign paths
- [x] Wrong-delivery complaints, carry-clock firings, and re-queued assignments produce no change (edge cases pinned)
- [x] New describe block `sim:settle_score` passes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): expose GuestSim.settledCount (3.D)`

---

### T3: Buzzer verdict swap + reason rename

**What**: Replace the coverage comparison at the buzzer with `settledCount >= settleTargetFor(playerCount)`; rename `RoundEndReason` values `coverage-met`/`coverage-failed` → `settle-target-met`/`settle-target-failed`; update every pinned reason string in tests.
**Where**: `packages/sim/src/roundSim.ts`, `packages/shared/src/protocol/simEvents.ts` (+ `roundSim.test.ts`, `packages/shared/src/protocol/registry.test.ts` pins)
**Depends on**: T1, T2
**Reuses**: existing buzzer flush ordering (buzzer event → `round:ended`); `round:ended` registry projection unchanged
**Requirement**: DLVR-05, DLVR-06, DLVR-07, DLVR-08, DLVR-04

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`, `turnover-sim-harness`

**Done when**:

- [x] `sim:win_checks` REND-03 scenarios assert the two new verdicts in the same flush as the buzzer
- [x] Saboteur-fired and staff-reduced legs unchanged (existing scenarios stay green)
- [x] Abort path emits no settle-target verdict
- [x] `sim:wrong_delivery` free-misplacement pin still green (no score/loss-shaped events)
- [x] No `coverage-met|coverage-failed` string remains in `packages/`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim)!: swap buzzer verdict to settle target (3.D)`

---

### T4: Server payload extensions (recap + resume)

**What**: Extend `RoundRecap` with `settleScore`/`settleTarget`; add the current settle score to the `round:resumed` restore payload; fill both from the sim at build time.
**Where**: `packages/shared/src/protocol/messages.ts`, `apps/server` recap/restore builders (+ their tests)
**Depends on**: T2
**Reuses**: existing server-side recap assembly path (`round:recap.fromSim` undefined by design)
**Requirement**: DLVR-11, DLVR-10 (reconnect re-seed)

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [x] Recap payload carries the exact `settledCount` and target at build time (both fields asserted by value)
- [x] `round:resumed` payload carries the current settle score
- [x] Registry row policies unchanged (`round:recap`/`round:resumed` stay `'all'`/self)

**Tests**: integration
**Gate**: quick

**Commit**: `feat(server): carry settle score in recap and resume payloads (3.D)`

---

### T5: `scoreHud` presenter + mount

**What**: Pure, Phaser-free `scoreHud` presenter (onSettled/reset/render → `Settled N / T`) mounted in `WorldScene`, fed by the existing `guest:settled` dispatch; ignores settles after `round:ended`.
**Where**: `apps/client/src/ui/scoreHud.ts` (+ test), `apps/client/src/scenes/WorldScene.ts`
**Depends on**: T1
**Reuses**: AD-038 pure presenter pattern (`elevatorPresenter.ts`); shared `settleTargetFor`
**Requirement**: DLVR-09, DLVR-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Presenter state tests: count increments, reset on round start, freeze after end, target from roster size
- [x] Render string is exactly `Settled N / T` form
- [x] WorldScene dispatch wires `guest:settled` → presenter; HUD visible in-scene

**Tests**: unit
**Gate**: quick

**Commit**: `feat(client): settle-score HUD (3.D)`

---

### T6: Results screen + client wiring sweep

**What**: Results/recap rendering shows the final score vs target; sweep any client `coverage` wording; re-seed the HUD counter from the `round:resumed` payload.
**Where**: `apps/client/src` results/recap render path, `WorldScene.ts` resume handler
**Depends on**: T3, T4, T5
**Reuses**: existing results screen and resume-restore plumbing (2.9)
**Requirement**: DLVR-11, DLVR-09 (reconnect), DLVR-06 (reason strings)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Results screen renders `reason` without stale `coverage` text anywhere in `apps/client/src`
- [x] Recap view shows final score and target
- [x] Reconnect mid-round re-seeds the counter to the resumed payload's score
- [x] `pnpm test:client` green (existing 37 scenarios unaffected)

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): results + resume show settle score (3.D)`

---

### T7: `client:score_hud` harness scenario

**What**: Gate 3 scenario: settles drive the counter live, and at round end the HUD count equals the recap's `settleScore`.
**Where**: `apps/client/harness/` (new scenario file)
**Depends on**: T5, T6
**Reuses**: `turnover-client-harness` contract (`window.__TURNOVER__` hook, `TURNOVER_TEST_SHIFT_SECONDS=8`)
**Requirement**: DLVR-09, DLVR-10, DLVR-11

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`, `turnover-gates`

**Done when**:

- [x] Scenario `client:score_hud` passes 2× consecutively
- [x] Counter equality with recap score asserted
- [x] Full gate green (typecheck, lint, sim 436, client e2e — `client:lobby_join` room-full re-flaked in-suite, green isolated; known bleed class, predates 3.D)

**Tests**: e2e
**Gate**: full

**Commit**: `test(client): add client:score_hud scenario (3.D)`

---

### T8: Contract & docs amendment

**What**: prd v1.5 (§6.6 win table, FR-29a budget note, FR-31 scope, §7 `SETTLE_TARGET` row, §8 KPI wording), roadmap 3.D insert + 3.3 scope amendment, AD-039 in `.specs/STATE.md`.
**Where**: `prd.md`, `roadmap.md`, `.specs/STATE.md`
**Depends on**: T3, T7
**Reuses**: proposal doc as the amendment source (`.specs/proposals/delivery-scoring.md`)
**Requirement**: DLVR-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Every named prd section amended; changelog notes v1.5
- [x] Roadmap carries 3.D between 3.C and 3.3 with amended 3.3 scope
- [x] AD-039 recorded with proposal link; Handoff updated
- [x] Build gate green

**Tests**: none
**Gate**: build

**Commit**: `docs(prd): record v1.5 delivery-scoring contract (3.D)`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:
  T1 → T3
  T2 → T3

Phase 2:
  T2 → T4
  T1 → T5
  T3 → T6
  T4 → T6
  T5 → T6
  T5 → T7
  T6 → T7

Phase 3:
  T3 → T8
  T7 → T8
```

Execution is strictly sequential - there is no intra-phase parallelism. 8 tasks total → fits a single inline batch (≤ ~8); no sub-agents needed.

---

## Task Granularity Check

| Task | Scope | Status |
|---|---|---|
| T1: settleTargetFor helper | 1 function | ✅ Granular |
| T2: settledCount query | 1 getter | ✅ Granular |
| T3: verdict swap + rename | 1 function + 1 type union (+ pinned tests) | ✅ Granular |
| T4: recap/resume payloads | 2 payload extensions, one seam | ✅ Granular |
| T5: scoreHud presenter | 1 module + mount | ✅ Granular |
| T6: results + resume wiring | 2 related render/wire points | ⚠️ OK - cohesive same-seam pair |
| T7: harness scenario | 1 scenario file | ✅ Granular |
| T8: docs | 3 docs, one contract | ⚠️ OK - one deliverable (the v1.5 contract) |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
|---|---|---|---|
| T1 | None | Phase 1 head | ✅ Match |
| T2 | None | Parallel head in Phase 1 | ✅ Match |
| T3 | T1, T2 | T1→T3, T2→T3 | ✅ Match |
| T4 | T2 | Phase 2 head (T2 → T4 cross-phase) | ✅ Match |
| T5 | T1 | T1 → T5 cross-phase | ✅ Match |
| T6 | T3, T4, T5 | T3→T6, T4→T6, T5→T6 | ✅ Match |
| T7 | T5, T6 | T5→T7, T6→T7 | ✅ Match |
| T8 | T3, T7 | T3→T8, T7→T8 | ✅ Match |

No forward-phase dependencies (T4/T5 depend backward into Phase 1 only).

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
|---|---|---|---|---|
| T1 | shared tuning | unit | unit | ✅ OK |
| T2 | sim domain | unit | unit | ✅ OK |
| T3 | sim domain + protocol types | unit | unit | ✅ OK |
| T4 | server transport | integration | integration | ✅ OK |
| T5 | client presenter | unit | unit | ✅ OK |
| T6 | client e2e | e2e | e2e | ✅ OK |
| T7 | client e2e | e2e | e2e | ✅ OK |
| T8 | docs | none | none | ✅ OK |
