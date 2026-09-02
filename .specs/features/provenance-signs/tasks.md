# provenance-signs Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/provenance-signs/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (4-gate verification ladder), `vitest.config.ts` (workspace project contract), `.opencode/skills/turnover-sim-harness` (Gate 2 scenario format), `.opencode/skills/turnover-client-harness` (Gate 3 harness contract).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
|---|---|---|---|---|
| Shared tuning / protocol types | unit (vitest, node) | 1:1 to spec ACs; registry row policies pinned | `packages/shared/src/**/*.test.ts` | `pnpm vitest run packages/shared` |
| Sim domain (provenance, tenancy) | unit (vitest, node, seeded) | All branches; 1:1 to spec ACs; named `sim:` scenarios | `packages/sim/src/*.test.ts` | `pnpm vitest run packages/sim` |
| Server transport seams (snapshot/recap) | integration (vitest, node) | Every new payload field asserted by value | `apps/server/src/*.test.ts` | `pnpm vitest run apps/server` |
| Client presenter (pure) | unit (vitest, node, Phaser-free) | Tenancy seed/update/render + recap provenance line | `apps/client/src/**/*.test.ts` | `pnpm vitest run apps/client/src` |
| Client e2e (harness) | e2e (Playwright headless) | Named `client:` scenario, 2× consecutive | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Docs (CONTEXT/STATE) | none | - (review gate only) | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
|---|---|---|
| Quick | After unit-only tasks | `pnpm typecheck && pnpm vitest run <touched paths>` |
| Full | After tasks with e2e/integration tests | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |
| Build | After last task in a phase / docs-only tasks | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Foundation (shared + sim)

```
T1 → T2
```

### Phase 2: Transport + client

```
T2 → T3
T1 → T4
T3 → T4
T4 → T5
```

### Phase 3: Contract & closure

```
T5 → T6
```

---

## Task Breakdown

### T1: Tenancy and recap provenance protocol rows (shared)

**What**: Add `TrashProvenance` (`sabotage`|`churn`|`none`) type + `RoomTenancy` payload (`floor,room,occupied`) and the `room:tenancy` registry row (`sameFloor`, `visibility:{floor}`) with simEvent `room:tenancy`; add `MovementSnapshot.tenancies` + `SpectatorSnapshot.tenancies` fields; add new `RecapEntry.kind='complaint'` with `provenance`+`actorId`+`fresh`+`guestId` and the `RoundRecap` mapping for it.
**Where**: `packages/shared/src/protocol/messages.ts`, `protocol/simEvents.ts`, `protocol/registry.ts` (+ `protocol/registry.test.ts`, `protocol/messages.test.ts` if present)
**Depends on**: None
**Reuses**: `room:carded` sameFloor projection pattern; `MovementSnapshot.cardedRooms/suitcases` scoping
**Requirement**: PROV-09..15, PROV-16..21

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [x] `room:tenancy` projects `sameFloor` with `visibility: {floor}` — registry.test pinned
- [x] `MovementSnapshot.tenancies` + `SpectatorSnapshot.tenancies` types compile and are optional (present only when non-empty)
- [x] `RecapEntry` carries `complaint` kind with `provenance` required, `actorId` present iff sabotage, `fresh` required, `guestId` required
- [x] `pnpm typecheck` green; `pnpm vitest run packages/shared` green

**Tests**: unit
**Gate**: quick

---

### T2: Trash provenance + tenancy lifecycle (sim)

**What**: Extend `WorkChannels` with a parallel `provenance` map (init `fresh`→`none`, seed 7 t=0 `trashed`+`sabotage` low-Rooms, `provenanceOf`, `churnTrash`→`settled`+`churn`, un-prep→`trashed`+`sabotage` overwriting churn, prep→`prepped`+`none`, settle-aging preserves sabotage provenance); extend `GuestSim` to emit `room:tenancy` at settle (`occupied:true`), at checkout (`occupied:false`), and at `beginDiscovery` (`occupied:false`, room stays trashed); expose `tenanciesOn(floor)` for snapshot queries; extend `RoundSim` journal to record per-`guest:discovered` provenance (from `work.provenanceOf`+fresh) and emit `complaint` recap entries with `actorId` on sabotage.
**Where**: `packages/sim/src/work.ts`, `packages/sim/src/guests.ts`, `packages/sim/src/roundSim.ts` (+ new `packages/sim/src/provenance.test.ts` with `sim:trash_provenance` covering P1+P2 footprints)
**Depends on**: T1
**Reuses**: `settleAt`/`driveToExit`/`beginDiscovery` emits, `roomIntelPort`, `recapEntries()` freshness read
**Requirement**: PROV-01..08, PROV-09..15, PROV-16..21

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`, `turnover-protocol`

**Done when**:

- [ ] `sim:trash_provenance`: churn→`settled`+`churn` → re-trash→`trashed`+`sabotage`; sabotage re-trash keeps `sabotage`+fresh window; initial 7 are sabotage; prep clears to `none`
- [ ] Tenancy emits: settle flips Occupied sameFloor, checkout flips Vacant, discovery flips Vacant with room still `trashed`/`settled` (vacant-but-trashed footprint)
- [ ] Recap complaint entries carry `provenance`+`actorId` on sabotage, `churn` with no actor, `fresh` exact, and wrong-delivery complaints absent
- [ ] `pnpm vitest run packages/sim` green (new suite + existing suites green)

**Tests**: unit
**Gate**: quick

---

### T3: Tenancy + complaint recap on snapshot and recap transport (server)

**What**: Extend `TurnoverRoom` movement snapshot builder to include `tenancies` filtered to viewer's floor (spectator snapshot includes all floors) and `round:recap` builder to carry complaint entries with provenance; assert both payload fields by value.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` (+ `TurnoverRoom.test.ts` with `server:recap_provenance` slice)
**Depends on**: T2
**Reuses**: `cardedOn`+`restingSuitcases` snapshot pattern; `finishRound` already maps `sim.recapEntries()` 1:1
**Requirement**: PROV-15, PROV-16..21

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [ ] `movement:snapshot` carries `tenancies` for the viewer's floor (present only when non-empty) — asserted by value
- [ ] `spectator:snapshot` carries `tenancies` for all floors
- [ ] `round:recap` carries `complaint` entries with `provenance`+`actorId` on sabotage each asserted by value; zero complaints → zero entries; wrong-delivery complaints absent
- [ ] Registry policies unchanged (`room:tenancy` sameFloor, `movement:snapshot` self, `round:recap` all)
- [ ] `pnpm vitest run apps/server` green

**Tests**: integration
**Gate**: quick

---

### T4: Door sign overlay + recap complaint lines (client)

**What**: Add per-door tenancy sign DOM (Occupied/Vacant) seeded from `movement:snapshot.tenancies` and updated on `room:tenancy` sameFloor delivery; keep last floor's signs while riding/in-stairs; seed all 24 from spectator baseline. Render complaint provenance lines in `resultsView` (sabotage entry names actor, churn entry says checkout churn) via `state.ts`+`mappers.ts` plumbing.
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/src/state.ts`, `apps/client/src/net/mappers.ts`, `apps/client/src/ui/resultsView.ts` (+ pure `tenancySign` presenter if needed, `apps/client/src/**/*.test.ts`)
**Depends on**: T1, T3
**Reuses**: `carded`+`suitcase` DOM lanes; `ScoreHud` mount pattern; `complaintHud` walkie pattern not reused (tenancy is sign, not walkie)
**Requirement**: PROV-22..26, PROV-16, PROV-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Snapshot tenancies seed the viewer's floor lane signs; `room:tenancy` updates the correct door's sign
- [ ] Spectator snapshot seeds all 24 doors
- [ ] Sign shows no provenance/freshness — tenancy only (pure render test)
- [ ] `round:recap` complaint entries render one line per complaint with actor named on sabotage
- [ ] `pnpm vitest run apps/client/src` green; `pnpm typecheck` green

**Tests**: unit
**Gate**: quick

---

### T5: `client:tenancy_sign` harness scenario

**What**: Playwright scenario staging a settle on floor1 (assert floor1 viewers show Occupied, lobby viewer shows none), a checkout (assert Vacant), and a discovery complaint path (assert Vacant with room still trashed footprint via `roomState` scan), then end the round and assert the results view renders both a sabotage and a churn complaint line with provenance.
**Where**: `apps/client/harness/tenancy.spec.ts` (or `tenancy-sign.spec.ts`) — named `client:tenancy_sign`
**Depends on**: T4
**Reuses**: `suitcase.spec`/`complaints.spec` staging helpers (pressEUntil, ride staging, role-card read, `__TURNOVER__` event scan)
**Requirement**: PROV-22..26, PROV-16, PROV-21

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Scenario passes twice consecutively at `--workers=1` and once in the full suite at `--workers=2`
- [ ] Floor-gating asserted (floor1 viewers see sign, lobby viewer does not)
- [ ] Results view carries provenance lines (sabotage names actor)

**Tests**: e2e
**Gate**: full

---

### T6: Domain docs + state closure

**What**: Add `CONTEXT.md` entries for **Trash provenance** and **Tenancy sign**; record AD-042 in `.specs/STATE.md` (initial-7 sabotage seed, churn-laundering one-way promotion, tenancy `sameFloor` policy, sameFloor `room:tenancy` + snapshot tenancies, new `complaint` recap kind, post-reveal-only provenance reveal) and roll handoff forward to 3.5 `guest-exit`.
**Where**: `CONTEXT.md`, `.specs/STATE.md`
**Depends on**: T5
**Reuses**: AD-041 format
**Requirement**: all (closure)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] CONTEXT.md entries follow term/definition/avoid-row format
- [ ] AD-042 records every assumption the spec marked `n (assumed)` + the initial-7 seeding choice
- [ ] Handoff names the next cycle and flags the 3.5 balance gate carryovers
- [ ] Full ladder green: `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client`

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ------→ T2
Phase 2:  T3 ------→ T4 ------→ T5
Phase 3:  T6
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

**How phase-based execution works:**

At Execute, the agent counts total tasks and packs phases into task-budgeted batches (~7 tasks per worker, whole phases - the benchmarked sweet spot is ~20 tasks → ~3 workers). A **phase** is the semantic/dependency unit; a **batch** is one or more *consecutive whole phases* assigned to one worker. The cut only ever lands on a phase boundary - a phase is never split across workers. When packing yields more than one batch (> ~8 tasks), the agent offers to dispatch batch sub-agents. Batches run sequentially: each worker executes ALL its tasks in order, then reports a compact summary before the next batch starts. This right-sizes the worker count by workload instead of by phase count (one-per-phase is too fragmented; expensive and slow). See [sub-agents.md](references/sub-agents.md) for the full model - packing algorithm, offer-then-confirm, worker payload, compact summary contract, failure handling, and context sizing guidance.

When the whole feature fits a single batch (≤ ~8 tasks), execution happens inline in the main window with no sub-agents spawned.

**The orchestrating agent's role during Execute:**
1. Count total tasks and pack phases into ~7-task batches - offer batch sub-agents if that yields more than one batch and the user accepts
2. Dispatch the next batch (to a worker, or execute inline)
3. Receive the compact batch summary
4. Update tasks.md with results
5. If the batch summary shows all tasks complete: proceed to the next batch
6. If a task failed: decide fix/escalate before dispatching the next batch

---

## Task Granularity Check

| Task | Scope | Status |
|---|---|---|
| T1: Tenancy and recap provenance protocol rows (shared) | 1 layer (shared) | ✅ Granular |
| T2: Trash provenance + tenancy lifecycle (sim) | 1 layer (sim) | ✅ Granular |
| T3: Tenancy + complaint recap transport (server) | 1 layer (server) | ✅ Granular |
| T4: Door sign overlay + recap lines (client) | 1 layer (client) | ✅ Granular |
| T5: harness scenario | 1 harness file | ✅ Granular |
| T6: Domain docs + state closure | 2 docs files | ✅ Granular |

**Granularity check**:

- ✅ 1 component / 1 function / 1 endpoint = Good
- ⚠️ 2-3 related things in same file = OK if cohesive
- ❌ Multiple components or files = MUST split

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
|---|---|---|---|
| T1 | None | None | ✅ Match |
| T2 | T1 | T1→T2 | ✅ Match |
| T3 | T2 | T2→T3 | ✅ Match |
| T4 | T1, T3 | T1→T4, T3→T4 | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | T5 | T5→T6 | ✅ Match |

**Rules:**

- Every `Depends on` in a task body must have a corresponding arrow in the diagram.
- Every arrow in the diagram must correspond to a `Depends on` in the target task's body.
- A task must never depend on a task in a later phase - dependencies point backward or within the same phase only.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
|---|---|---|---|---|
| T1: shared protocol rows | Shared tuning / protocol types | unit | unit | ✅ OK |
| T2: sim provenance + tenancy | Sim domain | unit | unit | ✅ OK |
| T3: server snapshot/recap | Server transport seams | integration | integration | ✅ OK |
| T4: client overlay | Client presenter | unit | unit | ✅ OK |
| T5: harness scenario | Client e2e | e2e | e2e | ✅ OK |
| T6: docs | Docs | none | none | ✅ OK |

**Rules:**

- "Tested in another task" is NOT a valid justification for `Tests: none`. That is test deferral - the exact anti-pattern this validation prevents.
- `Tests: none` is only valid when the coverage matrix says "none" for that code layer.
- If a task creates MULTIPLE code layers (e.g., service + controller), use the HIGHEST test type required by any of them.
- Any ❌ VIOLATION → restructure the task to include its required tests before proceeding.

