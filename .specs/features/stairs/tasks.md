# Stairs Tasks (cycle 3.E)

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/stairs/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (verification ladder), `vitest.config.ts` (workspace project contract), `.opencode/skills/turnover-sim-harness/SKILL.md` (Gate 2 scenario format), `.opencode/skills/turnover-client-harness/SKILL.md` (Gate 3 harness contract), `.opencode/skills/turnover-gates/SKILL.md`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Sim domain (movement/stairs/ambush) | unit (scenario-style, named `sim:<name>`) | All branches; 1:1 to spec ACs; every listed edge case has a scenario | `packages/sim/src/*.test.ts` | `pnpm vitest run packages/sim/src/movement.test.ts` |
| Shared domain (affordances/tuning) | unit | All branches of new predicates | `packages/shared/src/*.test.ts` | `pnpm vitest run packages/shared` |
| Server transport shell | integration | Intent paths + routing of new rows + buzzer/reconnect stairs resolution | `apps/server/src/rooms/*.test.ts` | `pnpm vitest run apps/server` |
| Client harness | e2e (headless Chromium) | Named scenario `client:stairs`: marker, chip, toasts, single panel | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Docs / config | none | - (reviewed at Design, gate at Verify) | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After shared/sim-only tasks | `pnpm typecheck && pnpm lint && pnpm vitest run packages/sim packages/shared` |
| Full | After server/client-touching tasks | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Shared foundation

```
T1
```

### Phase 2: Sim core

### Phase 3: Integration

### Phase 4: Docs + verification

One dependency chain across the phase boundaries (each phase's first task
depends on the previous phase's last task):

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8
```

---

## Task Breakdown

### T1: Shared stairs foundation ✅

**What**: Add the three tuning constants, the stairwell mouth affordances (`atStairwellMouth`, `stairsDirections`), the `stairs:enter` zod intent schema, the `MovementSnapshot.stairs?` optional field, and the two MovementEvents + registry rows (`stairs:ambushed` self, `stairs:ambush` self) — all additive.
**Where**: `packages/shared/src/{tuning,affordances,layout,intents,protocol/messages,protocol/simEvents,protocol/registry}.ts`
**Depends on**: None
**Reuses**: `affordances.ts` AD-037 predicate style; `elevatorCallIntentSchema` pattern; registry row style of `work:started` (self policy)
**Requirement**: STAIRS-05, STAIRS-14, STAIRS-17 (types only)

**Tools**:

- MCP: NONE
- Skill: turnover-protocol (registry audit before writing rows)

**Done when**:

- [ ] `STAIRS_TRANSIT_SECONDS=3`, `STAIRS_BREATH_SECONDS=2`, `STAIRS_STUN_SECONDS=20` in TUNING
- [ ] `atStairwellMouth(xTiles)` and `stairsDirections(floor)` exported + unit-tested
- [ ] Registry rows compile (satisfies gate) with `'self'` projections; snapshot field optional
- [ ] Gate: quick — `pnpm typecheck && pnpm lint && pnpm vitest run packages/shared`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): stairs tuning, stairwell affordances, and ambush protocol rows (3.E)`

---

### T2: Single-car collapse ✅

**What**: Replace the two-car `Record<1 | 2, CarState>` with one car whose landing is the east end (x=30); collapse dispatch (no pinned-choice, no empty-idle draft, no both-parked predicate — parked-at-pickup mid-hall call flashes); `carFloors()`/snapshots return exactly one row; guest riding unchanged. Keep `CarId` as the wire alias (`1` at runtime). If client compile requires it, fold minimal client compatibility into this commit.
**Where**: `packages/sim/src/movement.ts` (+ `packages/sim/src/movement.test.ts`; minimal `apps/client` compile fixes only if needed)
**Depends on**: T1
**Reuses**: existing phase machine (AD-014/026/027) unchanged for the one car
**Requirement**: STAIRS-01, STAIRS-02, STAIRS-03

**Tools**:

- MCP: NONE
- Skill: turnover-sim-harness

**Done when**:

- [ ] `sim:stairs_one_car` scenarios green: single car in state/snapshots/payloads; dispatch/flash/FIFO semantics hold for one car
- [ ] All pre-existing movement tests pass amended (no silent deletions — two-car assertions become single-car)
- [ ] Gate: quick

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): collapse the elevator to a single east car (3.E)`

---

### T3: Stairs transit channel ✅

**What**: Implement `enterStairs` + the per-player `StairsState` machine (transit 3 s → arrival at stairwell mouth → breath 2 s), tick integration, floorless `viewOf`, stream silence (no `player:moved` in stairs), `allPositions` exclusion, snapshot `stairs` field for occupants, rejections (mid-hall, in-car, guest, terminal direction, mid-transit/breath keys).
**Where**: `packages/sim/src/movement.ts` (+ `movement.test.ts`)
**Depends on**: T2
**Reuses**: `pendingEvents` flush (MOVE-10), `exitCar` facingDirty arrival pattern, floorless rider policy (AD-009/013)
**Requirement**: STAIRS-05, STAIRS-06, STAIRS-07, STAIRS-08, STAIRS-09, STAIRS-10, STAIRS-11

**Tools**:

- MCP: NONE
- Skill: turnover-sim-harness

**Done when**:

- [ ] `sim:stairs_transit` scenarios green: timing 3 s + 2 s, departure/arrival visibility, interior silence, all five rejection branches
- [ ] Snapshot for a stairs occupant carries `stairs` state; non-occupant snapshots byte-identical
- [ ] Gate: quick

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): stairs transit channel with breath and stream silence (3.E)`

---

### T4: Saboteur ambush ✅

**What**: Implement the ambush authority (`setAmbushAuthority`), per-tick opposite-transit pair detection, the 20 s stun state (pause + resume with preserved `transitTicksLeft`), the `stairs:ambushed`/`stairs:ambush` event emissions, and the ambush-only zero-complaint kill-check scenario.
**Where**: `packages/sim/src/movement.ts` (+ `movement.test.ts`)
**Depends on**: T3
**Reuses**: T3's StairsState machine; phase gating for single-fire-per-pair
**Requirement**: STAIRS-12, STAIRS-13, STAIRS-14, STAIRS-15, STAIRS-16, STAIRS-21

**Tools**:

- MCP: NONE
- Skill: turnover-sim-harness

**Done when**:

- [ ] `sim:stairs_ambush` scenarios green: trigger, 20 s stun, resume-to-destination, victim payload anonymity, all inert cases (staff-staff, same-dir, stationary, guest, fired), no limiter, two victims in one stride
- [ ] Kill check: ambush-only scenario records zero complaints (`GuestSim` complaint counters untouched)
- [ ] Gate: quick

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): saboteur ambush on opposite stairs passes (3.E)`

---

### T5: Server wiring ✅

**What**: Register the `stairs:enter` zod intent handler, wire the ambush authority adapter at round start (cleared at results), push personal `movement:snapshot` on stairs entry, call `resolveStairsForResults()` on the results transition (destination floor, stun cleared), and cover the routing of both new rows.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` (+ `TurnoverRoom.test.ts`, `router.test.ts` if needed)
**Depends on**: T4
**Reuses**: AD-017 exit-snapshot mechanism, AD-028 adapter wiring, `move:start` handler shape
**Requirement**: STAIRS-02, STAIRS-05, STAIRS-12, STAIRS-13

**Tools**:

- MCP: NONE
- Skill: turnover-protocol (recipient-policy audit)

**Done when**:

- [ ] Server transport-shell tests green: intent → sim, authority set/cleared across phases, entry snapshot, results resolution
- [ ] No raw `.send(`/`.broadcast(` outside the Router (denylist test stays green)
- [ ] Gate: full

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): stairs intent, ambush authority, and results resolution (3.E)`

---

### T6: Client slice ✅

**What**: Single-car presentation (presenter/panels/lights shrink to one car), DOM stairwell marker at the west landing, stairs chip (transit/breath/stun states from the own snapshot + local countdown), ambush toast + saboteur confirmation line, ArrowUp/Down (E alias) input gated by the shared affordances, prediction mirror for stairs state, and the `client:stairs` harness scenario.
**Where**: `apps/client/src/scenes/{WorldScene,elevatorPresenter}.ts`, `apps/client/src/ui/*`, `apps/client/src/state/*`, `apps/client/harness/stairs.spec.ts`
**Depends on**: T5
**Reuses**: AD-018 doors-layer DOM pattern, AD-013 rider chip pattern, AD-024 light pattern (one light), press-retry harness pattern (AD-028)
**Requirement**: STAIRS-04, STAIRS-17, STAIRS-18, STAIRS-19, STAIRS-20

**Tools**:

- MCP: NONE
- Skill: turnover-client-harness

**Done when**:

- [ ] `client:stairs` green: stairwell marker, stairs chip through transit→breath, ambush toast with countdown, saboteur confirmation, single panel/light
- [ ] No two-car DOM remnants; existing client suites green
- [ ] Gate: full

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): stairwell marker, stairs chip, ambush toasts, single car (3.E)`

---

### T7: Docs + §8 recompute ✅

**What**: prd v1.6 (FR-5 amend, new stairs/ambush FRs, §7 constants rows, §8 one-car+stairs throughput recompute, §9 risks), roadmap 3.E row before 3.3, `CONTEXT.md` stairwell/ambush/stun vocabulary, `docs/elevator-behavior.md` one-car note, art manifest stairwell entry, spec traceability statuses → Implemented.
**Where**: `prd.md`, `roadmap.md`, `CONTEXT.md`, `docs/elevator-behavior.md`, `docs/art/alternative/asset-manifest.json`, `.specs/features/stairs/spec.md`
**Depends on**: T6
**Reuses**: AD-022's §8 recompute precedent (3.1 entry task)
**Requirement**: STAIRS-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] prd v1.6 records the stairs contract + recompute verdict; roadmap carries 3.E; vocabulary lands
- [ ] Traceability table shows all 22 requirements Implemented
- [ ] Gate: quick (typecheck/lint unaffected docs — run lint for markdown-adjacent files)

**Tests**: none
**Gate**: quick

**Commit**: `docs(prd): v1.6 stairs contract, §8 recompute, roadmap 3.E (3.E)`

---

### T8: Gate ladder + verification handoff

**What**: Run the full verification ladder (typecheck, lint, test:sim, test:client), fix anything found, and record gate evidence in the feature dir for the Verifier.
**Where**: repo-wide; evidence in `.specs/features/stairs/`
**Depends on**: T7
**Reuses**: turnover-gates skill ladder
**Requirement**: all

**Tools**:

- MCP: NONE
- Skill: turnover-gates

**Done when**:

- [ ] `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` all green
- [ ] Gate evidence recorded with counts (no silent deletions)
- [ ] Gate: full

**Tests**: unit
**Gate**: full

**Commit**: `chore(gates): run the full ladder for the stairs cycle (3.E)`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1
Phase 2:  T2 → T3 → T4
Phase 3:  T5 → T6
Phase 4:  T7 → T8
```

Execution is strictly sequential - there is no intra-phase parallelism. Total: 8 tasks → single batch → executed inline (no sub-agents), per the ≤ ~8-task rule.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: shared foundation | one package, additive rows | ✅ Granular (cohesive shared-surface unit) |
| T2: single-car collapse | one file + tests | ✅ Granular |
| T3: stairs channel | one file + tests | ✅ Granular |
| T4: ambush | one file + tests | ✅ Granular |
| T5: server wiring | room + tests | ✅ Granular |
| T6: client slice | client scenes/ui + harness | ✅ Granular (one layer: rendering/input) |
| T7: docs | docs only | ✅ Granular |
| T8: gates | verification only | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | (phase 1 root) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |

No forward-phase dependencies.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Shared domain | unit | unit | ✅ OK |
| T2 | Sim domain | unit | unit | ✅ OK |
| T3 | Sim domain | unit | unit | ✅ OK |
| T4 | Sim domain | unit | unit | ✅ OK |
| T5 | Server transport | integration | integration | ✅ OK |
| T6 | Client harness | e2e | e2e | ✅ OK |
| T7 | Docs | none | none | ✅ OK |
| T8 | Verification run | unit (ladder) | unit | ✅ OK |
