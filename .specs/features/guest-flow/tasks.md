# Guest Flow Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name
and follow its Execute flow and Critical Rules.** Do not search for skill
files by filesystem path. The skill is the source of truth for the full flow
(per-task cycle, sub-agent delegation, adequacy review, Verifier,
discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed
without it.**

---

**Design**: `.specs/features/guest-flow/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling. Guidelines found: `AGENTS.md` (gate ladder
> `pnpm typecheck` + `pnpm lint`, `pnpm test:sim`, `pnpm test:client`, human
> round). Depth/style inferred from sibling tests (`work.test.ts`,
> `movement.test.ts`, `TurnoverRoom.test.ts`, `registry.test.ts`, Playwright
> harness specs).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Pure sim logic (rng, work origins, GuestSim, movement movers) | unit | All branches; 1:1 to spec ACs GUEST-01…11,14; every listed edge case | `packages/sim/src/*.test.ts` | `pnpm vitest run packages/sim` (inside `pnpm test:sim`) |
| Shared protocol registry + tuning | unit | Every new message: payload type, recipient policy, projection; tuning constants pinned | `packages/shared/src/**/*.test.ts` | `pnpm test:sim` |
| Room wiring (`TurnoverRoom`) | unit | Intent application per tick, round-end purge, routing through registry; happy + edge | `apps/server/src/rooms/*.test.ts` | `pnpm test:sim` |
| Client slice | e2e | `client:guest_flow`: markers, queue, impatience cue, own-floor visibility | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Docs / traceability | none | Spec traceability + STATE.md; no test | `.specs/`, `prd.md` | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks touching only pure sim/shared logic | `pnpm test:sim` |
| Full | After tasks touching room/client/harness | `pnpm test:sim && pnpm test:client` |
| Build | After final task / before closing the cycle | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next
begins, and tasks within a phase execute in order.

### Phase 1: Foundation (shared + work + rng)

```
T1 → T2 → T3
```

### Phase 2: Movement layer

```
T3 → T4
```

### Phase 3: Guest lifecycle + wiring

```
T4 → T5 → T6 → T7
```

### Phase 4: Client slice

```
T7 → T8
```

---

## Task Breakdown

### T1: Seeded RNG ✅

**What**: Deterministic mulberry32 RNG class with a dedicated guest stream.
**Where**: `packages/sim/src/rng.ts` (new), `packages/sim/src/rng.test.ts` (new)
**Depends on**: None
**Reuses**: round seed from `RoundSimConfig.seed`
**Requirement**: GUEST-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `Rng` class: `new Rng(seed)`, `int(maxInclusive)`, `uniform(min, max)`; same seed → same sequence (pinned by test)
- [ ] No `Math.random` introduced anywhere in `packages/sim`
- [ ] `pnpm vitest run packages/sim/src/rng.test.ts` green; `pnpm typecheck` clean

**Tests**: unit
**Gate**: quick

---

### T2: Tuning + layout guest constants ✅

**What**: Guest tuning rows (cadence per lobby size, dwell min/max, impatience) + desk/queue geometry constants; room door-x helper.
**Where**: `packages/shared/src/tuning.ts` (+ `tuning.test.ts`), `packages/shared/src/layout.ts` (+ door-x helper)
**Depends on**: T1
**Reuses**: AD-010 room segment geometry (`ROOM_HALL_START_TILES`, 3.5-tile segments)
**Requirement**: GUEST-01, GUEST-04, GUEST-08 (constants backing them)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `TUNING.GUEST_CADENCE_SECONDS = {4:30, 5:24, 6:18}`, `GUEST_DWELL_MIN_SECONDS = 45`, `GUEST_DWELL_MAX_SECONDS = 90`, `GUEST_IMPATIENCE_SECONDS = 20`, `DESK_X_TILES = 15`, `GUEST_QUEUE_SPACING_TILES = 1`
- [ ] `roomDoorX(floor, room)` helper returns the segment-center door x (pinned by test against AD-010 geometry)
- [ ] `pnpm test:sim` green with tuning pins added; constants logged for AD-028

**Tests**: unit
**Gate**: quick

---

### T3: WorkSim trash origin mark

**What**: `trash(origin: 'sabotage' | 'churn')` side-map so checkout churn spawns *settled* trash; existing sabotage path unchanged.
**Where**: `packages/sim/src/work.ts` (+ `work.test.ts`)
**Depends on**: T2
**Reuses**: existing `trash()` path + `states` map (work.ts)
**Requirement**: GUEST-09 (spawn half of FR-32)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `originOf(floor, room)` accessor; every existing `trash()` call site passes `'sabotage'` (behavior unchanged, pinned)
- [ ] `trash('churn')` leaves state `trashed` with origin `churn` (pinned)
- [ ] `pnpm test:sim` green, existing work tests untouched (323 baseline holds)

**Tests**: unit
**Gate**: quick

---

### T4: MovementSim guest movers

**What**: Mover-kind split (`'player' | 'guest'`): guest join with optional spawn placement, `guest-moved` movement events, capacity counting guests, rider payload gains `guests`, non-rider snapshots stay byte-identical.
**Where**: `packages/sim/src/movement.ts` (+ `movement.test.ts`)
**Depends on**: T3
**Reuses**: all elevator/walk machinery (AD-012…027 untouched)
**Requirement**: GUEST-06, GUEST-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `join(id, {kind?: 'guest', floor?, xMilli?})`; default `'player'` keeps every existing path byte-identical (323 baseline + existing movement assertions unchanged)
- [ ] Guest movers emit `{kind: 'guest-moved', guestId, floor, x}` (never `player-moved`); same-floor visibility rules apply
- [ ] A guest riding a car appears in rider occupancy; capacity 2 counts guests (player+guest = full, pinned); non-rider snapshots byte-identical (pinned)
- [ ] `pnpm test:sim` green with new guest-mover scenarios

**Tests**: unit
**Gate**: quick

---

### T5: GuestSim lifecycle

**What**: `GuestSim` state machine + pure guest driver: arrival schedule, held arrivals, queue slots, impatience (foot-tap/bell event, no cost), seeded self-assign, drive-to-room via intents, settle dwell, checkout churn, hotel exit; round-scoped teardown; ≥200-tick bit-for-bit replay pin.
**Where**: `packages/sim/src/guests.ts` (new), `packages/sim/src/guests.test.ts` (new)
**Depends on**: T4
**Reuses**: `Rng` (T1), layout door-x (T2), movement view/intents (T4), `trash('churn')` (T3)
**Requirement**: GUEST-01…05, GUEST-08…11, GUEST-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] AC-mapped scenarios: cadence schedule (GUEST-01), held arrivals + FIFO release (GUEST-02), queue announce (GUEST-03), 20s impatience with no complaint/loss effect + seeded uniform vacant self-assign (GUEST-04), no-vacant re-check (GUEST-05), walk/elevator citizenship incl. press-as-board (GUEST-06), settle dwell 45–90s (GUEST-08), checkout → `trash('churn')` + vacant + walk-out despawn (GUEST-09), no `Math.random` (GUEST-10), round-end cease (GUEST-11), replay pin (GUEST-14)
- [ ] Determinism: same-seed replay identical tick-for-tick (pinned)
- [ ] `pnpm test:sim` green; test count grows by ≥12

**Tests**: unit
**Gate**: quick

---

### T6: Protocol registry entries

**What**: Registry-first declarations for all guest messages + `elevator:riders` payload amendment + sim events; exhaustive client mapper types compile.
**Where**: `packages/shared/src/protocol/{simEvents,messages,registry}.ts` (+ `registry.test.ts`)
**Depends on**: T5
**Reuses**: registry `fromSim` projection pattern, `sameFloor` policy (AD-009), `riders` policy (AD-013)
**Requirement**: GUEST-03, GUEST-07, GUEST-12 (wire surface)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `guest:arrived/impatient/self_assigned/settled/checked_out/left` → `'all'`; `guest:moved` → `'sameFloor'`; `elevator:riders` payload gains `guests` (non-rider snapshots unchanged, pinned)
- [ ] Registry typed `satisfies Record<SimEvent['type'], …>` compiles (undeclared event fails build)
- [ ] `pnpm test:sim` green with registry pins

**Tests**: unit
**Gate**: quick

---

### T7: Room wiring

**What**: `TurnoverRoom` applies guest intents to `MovementSim` each tick (MOVE-10 flush), passes guest positions into `RoundSim.tick`, purges `guest:*` movers at round end (buzzer/abort/conviction), routing flows via registry.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` (+ `TurnoverRoom.test.ts`)
**Depends on**: T6
**Reuses**: intent handler patterns, `snapshotFor`, round-end teardown paths (AD-021)
**Requirement**: GUEST-01…11 (end-to-end server behavior)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A full scripted round (real room, simulated clock) runs ≥2 guest lifecycles end-to-end: arrive → impatience → self-assign → settle → checkout churn visible as `room:trashed` with churn origin
- [ ] No guest events/state survive round end; movers purged (pinned)
- [ ] `pnpm typecheck` + `pnpm test:sim` green; test count grows by ≥4

**Tests**: unit
**Gate**: quick

---

### T8: Client guest slice

**What**: Guest state + exhaustive mappers; distinct guest markers (own-floor only), desk queue rendering, foot-tap cue + `#desk-bell` line, no complaint counter; Playwright `client:guest_flow` scenario.
**Where**: `apps/client/src/{state.ts,net/mappers.ts,scenes/WorldScene.ts,ui/lobbyView.ts,ui/roundHud.ts}` (+ `apps/client/harness/guestFlow.spec.ts`)
**Depends on**: T7
**Reuses**: `player:moved` marker pipeline, DOM-over-canvas pattern (AD-018), harness boot + `TURNOVER_TEST_SHIFT_SECONDS`
**Requirement**: GUEST-12, GUEST-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `client:guest_flow`: guest marker (visually distinct from players) appears in the lobby desk queue; impatience cue (bounce + bell line) fires; no guest markers on other floors; no complaint-counter element exists
- [ ] Mappers exhaustive over registry (compile fails on unhandled guest message)
- [ ] `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` all green (build gate)

**Tests**: e2e
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 → T2 → T3
Phase 2:  T3 → T4
Phase 3:  T4 → T5 → T6 → T7
Phase 4:  T7 → T8
```

Execution is strictly sequential - no intra-phase parallelism. 8 tasks → one
task-budgeted batch → execute inline, no sub-agent offer.

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 rng | 1 file + tests | ✅ Granular |
| T2 tuning/layout | 2 cohesive shared files | ✅ Granular |
| T3 work origin | 1 function | ✅ Granular |
| T4 movement movers | 1 file (core) | ✅ Granular |
| T5 GuestSim | 1 component + driver | ✅ Granular (cohesive) |
| T6 registry | 1 protocol layer | ✅ Granular |
| T7 room wiring | 1 file | ✅ Granular |
| T8 client slice | 1 vertical slice | ✅ Granular (cohesive) |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | pure sim (rng) | unit | unit | ✅ OK |
| T2 | shared tuning/layout | unit | unit | ✅ OK |
| T3 | pure sim (work) | unit | unit | ✅ OK |
| T4 | pure sim (movement) | unit | unit | ✅ OK |
| T5 | pure sim (guests) | unit | unit | ✅ OK |
| T6 | shared protocol | unit | unit | ✅ OK |
| T7 | server room | unit | unit | ✅ OK |
| T8 | client | e2e | e2e | ✅ OK |

**Commit plan**: `feat(sim): ...` T1/T3/T4/T5, `feat(shared): ...` T2/T6,
`feat(server): ...` T7, `feat(client): ...` T8 — one atomic commit per task,
tasks.md traceability updated in the same commit.
