# Room Shell Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: activate it by name and follow its Execute flow and Critical Rules. Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/room-shell/design.md`
**Status**: In Progress

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirmed before Execute. Guidelines found: `AGENTS.md` (gate ladder), root `vitest.config.ts` (projects: packages/* + apps/*, run via `pnpm test:sim`), `packages/sim/src/*.test.ts` (co-located unit style), `apps/server/src/index.test.ts` (integration via `@colyseus/testing`), `apps/client/harness/` (Playwright gate 3).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Sim domain (`packages/sim/src`) | unit (deterministic scenarios) | All branches; 1:1 to spec ACs; every listed edge case; seeds pinned; tuning values cited | `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Shared protocol (`packages/shared/src/protocol`) | unit (type-level + payload shape) | Every message type's recipient rule + payload shape asserted | `packages/shared/src/**/*.test.ts` | `pnpm test:sim` |
| Server room (`apps/server/src/rooms`) | integration (real Colyseus via `@colyseus/testing`) | Every join/intent path: happy + each error reason + churn paths | `apps/server/src/**/*.test.ts` | `pnpm test:sim` |
| Client harness | e2e (unchanged this cycle) | Existing boot scenarios stay green; production strip check passes | `apps/client/harness/*.spec.ts` | `pnpm test:client` |

## Gate Check Commands

> Generated from codebase — confirmed before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Full | After tasks with integration tests | `pnpm typecheck && pnpm lint && pnpm test:sim` (test:sim includes the server integration project) |
| Build | After the last task in a phase / final task | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

### Phase 1: Sim core (headless)

```
T1 → T2
T1 → T3
T2 → T5
```

### Phase 2: Transport shell

```
T3 → T4 → T5 → T6 → T7
```

---

## Task Breakdown

### T1: Seeded role deal

**What**: Pure `dealRoles(seed, playerIds)` + `mulberry32` PRNG with unit tests.
**Where**: `packages/sim/src/deal.ts`, `packages/shared/src/roles.ts` (new), `packages/sim/src/deal.test.ts`
**Depends on**: None
**Reuses**: `packages/shared/src/tuning.ts` conventions (pure, no deps)
**Requirement**: DEAL-01, DEAL-06 (partial)

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [x] `Role` exported from shared; `dealRoles` returns a Map with exactly one `'saboteur'` for any seed and any 4–6 player ids
- [x] Fixed seed + fixed player-id list returns bit-identical deals across runs; different seeds vary assignments
- [x] Quick gate passes; test count: 6+ cases (6 added, 22 total)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): seeded role deal with one saboteur`

---

### T2: RoundSim state machine + sim:role_deal scenarios

**What**: `RoundSim` — `createRoundSim({ seed, playerIds })`, `tick(): readonly SimEvent[]`, 6000-tick clock, buzzer; named `sim:role_deal` scenario file covering one-saboteur-across-seeds, determinism, clock, buzzer.
**Where**: `packages/sim/src/roundSim.ts`, `packages/sim/src/events.ts`, `packages/sim/src/index.ts` (exports), `packages/sim/src/roundSim.test.ts`
**Depends on**: T1
**Reuses**: `dealRoles` (T1), `TUNING.SHIFT_SECONDS`, envelope event shape (`packages/shared/src/protocol/envelope.ts`)
**Requirement**: DEAL-06, CLK-01, CLK-02, CLK-03, CLK-04

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [x] `tick()` returns events; first tick emits `round:started` + one private `role:dealt` per player; tick 6000 emits `round:buzzer` and no ticks remain meaningful after
- [x] Clock starts at 6000 (300 s at 20 Hz — cite `TUNING.SHIFT_SECONDS`) and decrements exactly 1 per tick
- [x] Named scenario `sim:role_deal`: ≥1000 seeds each yield exactly one saboteur; fixed seed reproduces identical event sequences
- [x] Quick gate passes; test count: 8+ cases (8 added, 30 total)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): roundsim clock and buzzer with role_deal scenarios`

---

### T3: Shared message catalog

**What**: Concrete message types with recipient comments + zod schema for the `lobby:start` intent.
**Where**: `packages/shared/src/protocol/messages.ts`, `packages/shared/src/protocol/index.ts` (exports), `packages/shared/src/protocol/messages.test.ts`
**Depends on**: T1 (needs `Role`)
**Reuses**: envelope shapes (`PersonalSnapshot`, `GameEventEnvelope`, `BroadcastEventEnvelope`, `PlayerIntent`)
**Requirement**: LOBBY-01 (payload shape), DEAL-02 (payload types)

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [x] `LobbySnapshot`, `round:started`, `role:dealt`, `round:buzzer`, `error`, `lobby:start` types exported; every type carries its recipient comment (protocol rule 5)
- [x] No type exposes any player's role except the recipient's own in `role:dealt`; seed appears nowhere
- [x] zod schema rejects any `lobby:start` payload with extra fields (`.strict()`)
- [x] Quick gate passes; test count: 4+ cases (5 added, 35 total)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): room-shell message catalog with recipient rules`

---

### T4: TurnoverRoom lobby — join by code

**What**: `TurnoverRoom` lobby half: 4-letter `roomId` generation, join validations (capacity/phase/name), roster, `LobbySnapshot` routing, join-error paths.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` (new), `apps/server/src/rooms/TurnoverRoom.test.ts` (new)
**Depends on**: T3
**Reuses**: `PlaceholderRoom` message-only pattern (patchRate null), `@colyseus/testing` boot pattern from `apps/server/src/index.test.ts`
**Requirement**: LOBBY-01, LOBBY-02, LOBBY-03, LOBBY-04, LOBBY-05

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`, `turnover-gates`

**Done when**:

- [x] Room registers as `'turnover'`; `roomId` matches `/^[A-HJ-NP-Z]{4}$/` (24-letter alphabet, no O/I); join by generated code succeeds via real Colyseus client
- [x] `LobbySnapshot` (own id, name, isHost, roster ids+names) received by each joiner; roster updates broadcast on change
- [x] All rejection paths return specific errors: unknown code, 7th player (`TUNING.PLAYERS_MAX`), empty/16+-char/duplicate name (mid-round join lands with the round phase in T5)
- [x] Lowercase code normalized (matchmake hook); joins serialized (same-name race accepts exactly one)
- [x] Full gate passes; test count: 10+ cases (10 added, 45 total)

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): turnover room lobby with join-by-code validations`

---

### T5: Host start → sim lifecycle → event routing

**What**: zod-validated `lobby:start` intent with guards; `RoundSim` creation, `setSimulationInterval(50)` drive, sim-event routing (`round:started` broadcast, `role:dealt` private, `round:buzzer` → back to lobby, re-deal fresh).
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` (modify), `apps/server/src/rooms/TurnoverRoom.test.ts` (extend)
**Depends on**: T2, T4
**Reuses**: `RoundSim` (T2), message catalog (T3), seed source `node:crypto.randomInt`
**Requirement**: DEAL-01, DEAL-02, DEAL-03, DEAL-04, DEAL-05, CLK-03 (server side), CLK-04

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`, `turnover-gates`

**Done when**:

- [ ] Host start with ≥4 (`TUNING.PLAYERS_MIN`) enters round phase; each client receives exactly one private `role:dealt`; collected across 4 clients, exactly one saboteur; broadcasts contain no role fields
- [ ] Rejections: <4 players → `need-more-players`; non-host → `not-host`; double start → `round-already-active`
- [ ] Sim ticks only during round phase (clock assertions via room's tick driver hook); buzzer transitions room to lobby, roles wiped, second start deals fresh roles
- [ ] Full gate passes; test count: 6+ new cases

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): host start with sim lifecycle and private role routing`

---

### T6: Lobby churn — leaves, host migration, idle slots

**What**: `onLeave` handling — roster removal + broadcast in lobby, host migration to earliest `joinedAt`, mid-round idle slot to buzzer.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` (modify), `apps/server/src/rooms/TurnoverRoom.test.ts` (extend)
**Depends on**: T5
**Reuses**: roster/join-order state from T4, sim lifecycle from T5
**Requirement**: CHURN-01, CHURN-02, CHURN-03

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [ ] Lobby leave: roster broadcast without the leaver; remaining snapshots consistent
- [ ] Host leave: earliest-joined remaining player becomes host (isHost flips in snapshots); start still works after migration
- [ ] Mid-round leave: sim keeps ticking, buzzer still fires at tick 6000, room returns to lobby
- [ ] Full gate passes; test count: 3+ new cases

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): lobby churn with host migration and idle round slots`

---

### T7: Registration swap + full round integration

**What**: Register `'turnover'` in the server bootstrap, delete `PlaceholderRoom`, migrate `index.test.ts` static+join smoke, end-to-end headless round test (join ×4 → start → roles → 300 s clock → buzzer → lobby → re-deal).
**Where**: `apps/server/src/index.ts` (modify), `apps/server/src/index.test.ts` (modify), `apps/server/src/rooms/PlaceholderRoom.ts` (delete)
**Depends on**: T6
**Reuses**: all prior room tests; existing static-asset smoke
**Requirement**: LOBBY-01..05 (final wiring), DEAL-01..06, CLK-01..04 (integration sweep)

**Tools**:

- MCP: NONE
- Skill: `turnover-gates`, `turnover-client-harness`

**Done when**:

- [ ] No `'placeholder'` room remains; static asset smoke still passes on the same port (AD-001 unchanged)
- [ ] End-to-end headless round passes: 4 joiners, host start, exactly one saboteur across private payloads, buzzer at 300 s sim time, re-deal works
- [ ] Build gate passes (`pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client`); existing client boot scenarios unbroken; no test silently deleted

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): register turnover room, retire placeholder, full round smoke`

---

## Phase Execution Map

```
Phase 1 → Phase 2

Phase 1:  T1 ------→ T2
Phase 2:  T3 ------→ T4 ------→ T5 ------→ T6 ------→ T7
```

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: dealRoles + mulberry32 | 2 functions, 1 concept | ✅ Granular |
| T2: RoundSim + scenarios | 1 component | ✅ Granular |
| T3: message catalog | 1 file, 1 concept | ✅ Granular |
| T4: lobby join half | 1 component (room, join half) | ✅ Granular |
| T5: start/sim/routing half | 1 component (room, round half) | ✅ Granular |
| T6: leave/churn | 1 method group | ✅ Granular |
| T7: registration swap + smoke | wiring + 1 integration test | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | — (first) | ✅ Match |
| T2 | T1 | T1→T2 | ✅ Match |
| T3 | T1 | T3 first in Phase 2 (cross-phase from T1 — T1 is the immediately preceding phase's last task) | ✅ Match |
| T4 | T3 | T3→T4 | ✅ Match |
| T5 | T2, T4 | T4→T5 (T2 is Phase 1, backward) | ✅ Match |
| T6 | T5 | T5→T6 | ✅ Match |
| T7 | T6 | T6→T7 | ✅ Match |

No forward-phase dependencies: T3→T1, T5→T2 both point backward into Phase 1.

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Sim domain | unit | unit | ✅ OK |
| T2 | Sim domain | unit | unit | ✅ OK |
| T3 | Shared protocol | unit | unit | ✅ OK |
| T4 | Server room | integration | integration | ✅ OK |
| T5 | Server room | integration | integration | ✅ OK |
| T6 | Server room | integration | integration | ✅ OK |
| T7 | Server room + wiring | integration | integration | ✅ OK |
