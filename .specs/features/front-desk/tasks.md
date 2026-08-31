# Front Desk Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/front-desk/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (verification ladder), `.opencode/skills/turnover-sim-harness/SKILL.md` (Gate 2 rules), `.opencode/skills/turnover-client-harness/SKILL.md` (Gate 3), `vitest.config.ts` (project contract).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Sim domain (GuestSim/RoundSim desk logic) | unit (seeded scenarios) | All branches; 1:1 to spec ACs (DESK-01..10); every listed edge case | `packages/sim/src/guests.test.ts`, `packages/sim/src/roundSim.test.ts` | `pnpm vitest run packages/sim/src/guests.test.ts packages/sim/src/roundSim.test.ts` |
| Protocol / registry / tuning | unit | Compile-exhaustive rows + tuning pin | `packages/shared/src/protocol/registry.test.ts`, `packages/shared/src/tuning.test.ts` | `pnpm vitest run packages/shared` |
| Transport shell (room handlers) | integration (@colyseus/testing) | Silent-rejection + routing per policy, happy + edge | `apps/server/src/rooms/TurnoverRoom.test.ts` | `pnpm vitest run apps/server` |
| Client desk slice (Gate 3) | e2e (Playwright) | `client:desk_walkie`: receive, lying send, walkie line building-wide, walk ground truth | `apps/client/harness/deskWalkie.spec.ts` | `pnpm test:client` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After sim/shared tasks | `pnpm typecheck && pnpm vitest run packages/sim packages/shared` |
| Full | After server task | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Build | After client task (feature complete) | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

### Phase 1: Shared protocol + tuning

```
T1 → T2
  \
```

### Phase 2: Sim desk economy

```
T1 → T3 → T4
```

### Phase 3: Server wiring

```
T4 → T5
```

### Phase 4: Client desk slice

```
T2 → T6 → T7
T5 → T6
```

---

## Task Breakdown

### T1: Desk tuning constant + protocol messages ✅

**What**: Add `TUNING.DESK_RANGE_TILES = 1`; declare `GuestRouted` + `WalkieBroadcast` payloads, `guest:routed`/`walkie:broadcast` sim events, registry rows ('all' + projections).
**Where**: `packages/shared/src/tuning.ts`, `packages/shared/src/protocol/messages.ts`, `packages/shared/src/protocol/simEvents.ts`, `packages/shared/src/protocol/registry.ts`
**Depends on**: None
**Reuses**: registry `Entry` row shape, 3.1 guest-event projections
**Requirement**: DESK-06, DESK-07, DESK-10

**Tools**: MCP: NONE; Skill: `turnover-protocol`

**Done when**:

- [x] `DESK_RANGE_TILES = 1` pinned in `tuning.test.ts` citing the AD (AD-031; renumbered — AD-030 was taken by the 960x576 viewport merge)
- [x] Registry rows compile (sim-event exhaustiveness holds); literal-policies test pins both 'all'
- [x] Compile-coupled client mapping folded in per the 3.1 precedent: mappers, ViewActions, WorldScene cases
- [x] Gate check passes: quick (typecheck 4/4, 198 tests)

**Tests**: unit
**Gate**: quick

---

### T2: Desk intents ✅

**What**: Add `deskInteractIntentSchema` and `deskSendIntentSchema` (destination + announce, guest floors × rooms 1–8, strict zod).
**Where**: `packages/shared/src/protocol/intents.ts`
**Depends on**: T1
**Reuses**: `GUEST_FLOOR_ENUM`, `workStartIntentSchema` shape
**Requirement**: DESK-06

**Done when**:

- [x] Schemas exported, strict, typed (desk:interact empty; desk:send two independent guest-floor choices)
- [x] Schema tests in registry.test.ts (accept + reject paths)
- [x] Gate check passes: quick (typecheck 4/4, 201 tests)

**Tests**: unit
**Gate**: quick

---

### T3: GuestSim hold/route ✅

**What**: Implement `receiveAtDesk`/`releaseHeld`/`releaseAll`/`routeHeld` with hold map, impatience freeze/resume, queue front re-place, walk-out tick check, pending-event flush; tenancy commit on route.
**Where**: `packages/sim/src/guests.ts` (modify)
**Depends on**: T1
**Reuses**: queue array, `slotX`, `removeFromQueue` re-place loop, `toRoom` driver
**Requirement**: DESK-01..05, DESK-06..09

**Done when**:

- [x] Seeded scenarios pass: sim:desk_receive (AC1–4 + walk-out, fired release, empty-queue/one-hold silence, first-intent-wins, queue-no-shift), sim:walkie_broadcast (honest), sim:walkie_lie (AC6–8), occupied-destination silence (AC9), non-holder send ignored
- [x] Lie-scenario claim surface never names the destination (AC10 leak assert on routed/broadcast/arrived/impatient payloads)
- [x] Gate check passes: quick (typecheck 4/4, 212 tests)

**Tests**: unit
**Gate**: quick

---

### T4: RoundSim desk APIs + teardown

**What**: Add `deskInteract`/`deskSend` (round-active, live, range-via-`work.positionOf`, receive-or-release derivation) and `releaseAll` hooks in `leave`/`ghost`/`drainPending`; flush pending guest events at tick start.
**Where**: `packages/sim/src/roundSim.ts` (modify)
**Depends on**: T3
**Reuses**: `accuse` validation pattern, announce pattern
**Requirement**: DESK-01..10

**Done when**:

- [ ] Out-of-zone/non-live/lobby-phase rejections covered by tests
- [ ] All prior sim tests still pass (no regressions)
- [ ] Gate check passes: quick

**Tests**: unit
**Gate**: quick

---

### T5: Room intent handlers

**What**: Wire `desk:interact` + `desk:send` zod handlers; every rejection silent (no error route); fired/ghost/leave paths release holds via the sim.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` (modify)
**Depends on**: T4
**Reuses**: `ensureLive`, phase guard, handler shape
**Requirement**: DESK-01, DESK-06, DESK-09

**Done when**:

- [ ] @colyseus/testing shell tests: receive routes `guest:routed` 'all', send routes claim 'all' with announced room only, occupied send is silent, out-of-zone E silent
- [ ] Gate check passes: full

**Tests**: integration
**Gate**: full

---

### T6: Client desk slice

**What**: Mapper rows + ViewActions (`guest-routed`, `walkie-broadcast`); contextual E (desk zone → `desk:interact`, accuse suppressed); `#desk-hint`; `#desk-menu` (destination list → announce list → confirm sends `desk:send`, closes on own routed/release, stays open on silent rejection).
**Where**: `apps/client/src/net/mappers.ts`, `apps/client/src/state.ts`, `apps/client/src/scenes/WorldScene.ts`, `apps/client/src/net/connection.ts` (send helper)
**Depends on**: T2, T5
**Reuses**: `buildGuestLayer` DOM pattern, prediction map, `MAPPERS` exhaustiveness
**Requirement**: DESK-11, DESK-13

**Done when**:

- [ ] Mappers compile exhaustively; reducer no-ops scene kinds
- [ ] Gate check passes: full

**Tests**: unit (mappers/reducer if touched)
**Gate**: full

---

### T7: Walkie log + gate-3 scenario

**What**: Building-wide `#walkie-log` rendering `«Name»: guest going to F:R` (roster names, last 5); new `apps/client/harness/deskWalkie.spec.ts` — `client:desk_walkie` walks the full lie: receive at desk, announce floor1:8 while routing to floor2:4, assert the claim line on all pages and the guest marker's walk to floor2:4, and no client surface naming the destination pre-settle.
**Where**: `apps/client/src/scenes/WorldScene.ts` (modify), `apps/client/harness/deskWalkie.spec.ts` (new)
**Depends on**: T6
**Reuses**: `guestFlow.spec.ts` four-player-round helpers, `TURNOVER_TEST_GUEST_SCALE` harness seam
**Requirement**: DESK-11, DESK-12, DESK-13

**Done when**:

- [ ] `pnpm test:client` green incl. `client:desk_walkie`
- [ ] Gate check passes: build

**Tests**: e2e
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ------→ T2
Phase 2:  T1 ------→ T3 ------→ T4
Phase 3:  T4 ----------------------------→ T5
Phase 4:  T2 ----------------→ T6 ------→ T7
          T5 ----------------→ T6
```

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: tuning + protocol rows | 4 files, one concept (protocol declaration) | ✅ Granular (compile-coupled unit) |
| T2: intents | 1 file | ✅ Granular |
| T3: GuestSim hold/route | 1 file | ✅ Granular |
| T4: RoundSim APIs | 1 file | ✅ Granular |
| T5: room handlers | 1 file | ✅ Granular |
| T6: client desk slice | mapper/state/scene, one feature slice | ✅ Granular (compile-coupled unit) |
| T7: walkie log + gate 3 | scene edit + new spec file | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T2, T5 | T2 → T6, T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | protocol/tuning | unit | unit | ✅ OK |
| T2 | intents | unit | unit | ✅ OK |
| T3 | sim domain | unit | unit | ✅ OK |
| T4 | sim domain | unit | unit | ✅ OK |
| T5 | transport shell | integration | integration | ✅ OK |
| T6 | client net/state | unit | unit | ✅ OK |
| T7 | client e2e | e2e | e2e | ✅ OK |
