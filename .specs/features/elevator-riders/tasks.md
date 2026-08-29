# Elevator Riders Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/elevator-riders/design.md`
**Status**: In Progress (batch 1: T1–T7)

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (gate ladder), `roadmap.md` (gate scenarios `sim:motion`, `sim:elevator`, `client:movement`), `vitest.config.ts` (projects: packages/*, apps/*), `package.json` (scripts: typecheck, lint, test:sim, test:client), `apps/client/harness/playwright.config.ts`, `.github/workflows/ci.yml`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Shared tuning & payload types (`packages/shared/src/tuning.ts`, `messages.ts`, `simEvents.ts`) | none | Build gate only (types compile; registry row pins cover payloads) | `packages/shared/src/**/*.ts` | `pnpm typecheck` |
| Shared intents (`packages/shared/src/protocol/intents.ts`) | unit | Strict zod schemas; 1:1 to intent contracts (call without target, press) | `packages/shared/src/protocol/*.test.ts` | `pnpm test:sim` |
| Protocol registry (`packages/shared/src/protocol/registry.ts`) | unit | Every row declares payload + policy once; `riders` policy membership; RegistryKeys exhaustive | `packages/shared/src/protocol/*.test.ts` | `pnpm test:sim` |
| Router & ViewContext (`apps/server/src/rooms/router.ts`, `movement.ts:viewOf`) | unit | `riders` branch delivers to car-viewers only; `sameFloor`/`occupants` unchanged; ViewContext car field | `apps/server/src/rooms/*.test.ts`, `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Pure sim MovementSim (`packages/sim/src/movement.ts`) | unit (vitest scripted-intent) | Every ELR sim half + edge cases: exact tick math (60 arrive / 40 per floor / 20 dwell), dispatch preference, queue FIFO, episode guard, zero-ride guard, ghost trips, replay | `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Server room (`apps/server/src/rooms/TurnoverRoom.ts`) | integration (vitest + @colyseus/testing) | Intent handlers (call/press), snapshot branching (rider vs non-rider), envelope/policy, leave fan-out | `apps/server/src/rooms/*.test.ts` | `pnpm test:sim` |
| Client mappers/app (`apps/client/src/net/mappers.ts`, `app.ts`) | unit | Mapper pins for new actions; reducer no-ops preserved | `apps/client/src/**/*.test.ts` | `pnpm test:sim` |
| Client world & UI (`apps/client/src/scenes/WorldScene.ts`, `ui/lobbyView.ts`, `ui/roundHud.ts`) | e2e (harness) + unit where applicable | Chip + lit indicators, keymap, panel position-only | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Harness scenarios | e2e | `client:elevator_riders` + updated `client:movement`/`client:elevator_lobby` | `apps/client/harness/*.spec.ts` | `pnpm test:client` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only (shared/sim/server/mappers) | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Full | After tasks with e2e/integration (client/harness) | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |
| Build | After docs/config-only tasks | `pnpm typecheck && pnpm lint` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Shared protocol foundation

```
T1 -> T2 -> T3 -> T4 -> T5
```

### Phase 2: Pure sim rework

```
T6 -> T7
```

### Phase 3: Server, client, harness, docs

```
T8 -> T9 -> T10 -> T11 -> T12
```

---

## Task Breakdown

### Phase 1: Shared protocol foundation

#### T1: Dwell tuning constant — ✅ Done

**What**: Add `TUNING.ELEVATOR_DWELL_SECONDS = 1` (derived `ELEVATOR_DWELL_TICKS = 20` in sim) as the only new §7-external tuning constant for this cycle.
**Where**: `packages/shared/src/tuning.ts`
**Depends on**: None
**Reuses**: `TICK_HZ` derivation pattern (`ARRIVE_TICKS`, `RIDE_TICKS_PER_FLOOR`)
**Requirement**: ELR-14 (P3 1s dwell)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `TUNING.ELEVATOR_DWELL_SECONDS` is `1` and exported; sim derives `DWELL_TICKS = ELEVATOR_DWELL_SECONDS * TICK_HZ` (20)
- [x] No other §7 constant changed
- [x] `pnpm typecheck` passes

**Tests**: none
**Gate**: build

**Commit**: `feat(shared): add elevator dwell tuning`

---

#### T2: Elevator event and payload types — ✅ Done

**What**: Extend the shared wire types: `ElevatorPressed {playerId, floor}`, `ElevatorRiders {car, riders, queue}`, `MovementSnapshot.carOccupants?: {car, riders, queue}`, and `MovementEvent` union cases `elevator:pressed` and `elevator:riders`.
**Where**: `packages/shared/src/protocol/messages.ts`
**Depends on**: T1
**Reuses**: `FloorId`, `CarId` types; `MovementSnapshot` shape
**Requirement**: ELR-01, ELR-04, ELR-06, ELR-09

**Tools**:
- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:
- [x] `ElevatorPressed`/`ElevatorRiders` payloads exported with correct keys; `MovementEvent` includes the two new cases and compiles
- [x] `MovementSnapshot` gains optional `carOccupants` with `queue: FloorId[]`
- [x] Gate check passes: `pnpm typecheck && pnpm lint`

**Tests**: none
**Gate**: build

**Commit**: `feat(shared): wire types for pressed and riders payloads`

---

#### T3: Elevator intent schemas — ✅ Done

**What**: Make `elevator:call` destination-free (`{type:'elevator:call'}` strict, no `target`) and add `elevator:press {floor}` (strict, `FLOOR_ENUM`).
**Where**: `packages/shared/src/protocol/intents.ts`
**Depends on**: T2
**Reuses**: `FLOOR_ENUM`/`z.enum` strict pattern from `moveStartIntentSchema`
**Requirement**: ELR-06, ELR-07, ELR-08, ELR-11, ELR-12

**Tools**:
- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:
- [x] `elevatorCallIntentSchema` accepts only `type` and rejects `target`/extra keys; `elevatorPressIntentSchema` accepts `floor` in `FLOOR_IDS`
- [x] Intent tests pin strict rejection
- [x] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): destination-free call and in-car press intents`

---

#### T4: Registry riders policy and rows — ✅ Done

**What**: Extend `RecipientPolicy` with `'riders'`, extend `EventVisibility` with `car?: 1|2`, and add registry rows `elevator:pressed` (payload `ElevatorPressed`, `riders`, visibility `{car}`) and `elevator:riders` (payload `ElevatorRiders`, `riders`, visibility `{car}`). Update registry walk test to pin the new keys and policies.
**Where**: `packages/shared/src/protocol/registry.ts`
**Depends on**: T3
**Reuses**: `PROTOCOL_REGISTRY` satisfies typing, `SimProjection` per-key pattern, `KeysWith` gate
**Requirement**: ELR-01, ELR-02, ELR-03, ELR-06, ELR-09

**Tools**:
- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:
- [x] `RecipientPolicy` includes `'riders'`; `EventVisibility` includes `car`
- [x] Two new rows declared once with `riders` policy and `fromSim` projections; adding an undeclared sim event is still a compile error
- [x] `registry.test.ts` pins payload keys not to include `queue`/`occupants` on `elevator:called`/`elevator:moved` and pins `riders` rows' policies
- [x] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): riders policy and pressed/riders registry rows`

---

#### T5: Router riders branch and ViewContext car field — ✅ Done

**What**: Add the `riders` dispatch branch (deliver to clients whose `viewContext.car === visibility.car`), extend `ViewContext` with `car: 1|2|null`, and keep existing `sameFloor`/`occupants`/`all`/`self` semantics byte-identical.
**Where**: `apps/server/src/rooms/router.ts`
**Depends on**: T4
**Reuses**: `dispatch` ladder, `deliver` envelope stamping, `NO_VIEW` default
**Requirement**: ELR-01, ELR-02, ELR-03, ELR-06

**Tools**:
- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:
- [x] `ViewContext` has `car`; `dispatch` handles `riders` by `car` match; other policies unchanged
- [x] `router.test.ts` asserts rider-exclusive delivery and non-rider exclusion for a synthetic riders event; `sameFloor` tests stay green
- [x] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): riders dispatch branch and car view context`

---

### Phase 2: Pure sim rework

#### T6: MovementSim car state machine rework — ✅ Done

**What**: Rework `MovementSim` car state: `CarState {floor, riders, phase: idle|arriving|dwelling|riding, ticksLeft, pickup: FloorId|null, queue: FloorId[], exitedThisStop: Set<string>}`. Replace `target` with FIFO `queue`; add `DWELL_TICKS`; implement `callElevator(playerId)` destination-free (duplicate = pickup floor only, narrowing AD-012; dispatch prefers empty idle cars — closest landing, tie → car 1 — then occupied idle, then FIFO queue), `pressFloor(playerId, floor)` (rider-only, ignore duplicate/being-served — including `pickup` while `arriving` — and current-floor-while-doors-open; enqueue + announce, zero-ride guard asserts `rideTicks>0` on departure), `startMove` door-open exit (in-car rider holding direction exits this intent; ignored lobby-phase confinement; walk proceeds next tick), auto-board every open-door tick (arrival + every `dwelling`/`idle` tick; capacity 2, distance-then-playerId, `exitedThisStop` guard until departure), tick order `announced → player movement → tickCars (dwell countdown, board, departures/arrivals)`, ghost trips, caller-never-boards idle, `arriving`→`dwelling`→`riding`→arrival flow. Rewrite affected `movement.test.ts` suites (MOVE-10..15 tick math now includes dwell; arrival no longer auto-exits).
**Where**: `packages/sim/src/movement.ts`
**Depends on**: T5
**Reuses**: `ARRIVE_TICKS`/`RIDE_TICKS_PER_FLOOR`/`CAR_LANDING_MILLI`/`SPEED_MILLI_PER_TICK`, pending-announce pattern, `board()` sort
**Requirement**: ELR-06, ELR-07, ELR-08, ELR-09, ELR-10, ELR-11, ELR-12, ELR-13, ELR-14, ELR-15, ELR-17, ELR-18

**Tools**:
- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:
- [x] `callElevator` is destination-free; same-floor duplicate flashes without dispatch; empty-idle preferred
- [x] `pressFloor` queues FIFO; duplicate/current-floor-while-open and pickup-while-arriving are silently ignored; non-rider rejected
- [x] Dwell is exactly 20 ticks at every stop; riding is `|Δfloors|*40`; departure asserts `rideTicks>0`
- [x] Episode guard prevents re-boarding until departure; exit works in any phase; ghost trips serve
- [x] Bit-for-bit replay across two runs for a 100+ tick scripted dwell+queue scenario
- [x] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): destination-free calls, press queue, dwell, and episode guard`

---

#### T7: Occupancy/queue events and rider snapshot

**What**: Emit `elevator:pressed` (next tick, rider-exclusive via `riders` policy) on accepted presses and `elevator:riders {car, riders, queue}` on every rider-list change (board, walk-off exit, disconnect) plus dirty-flush in `leave()` and at tick start; extend `viewOf(playerId)` to return `{floor, roomKey, car}` (riders keep `floor:null, car:N`) and add `snapshotForRider(playerId)` / `snapshotForFloor` branching so rider snapshots carry `players:[]`, both cars' public floors, and `carOccupants {car, riders, queue}` while non-rider snapshots are byte-identical to today.
**Where**: `packages/sim/src/movement.ts`
**Depends on**: T6
**Reuses**: pending-announce queue, `viewOf`/`snapshotForFloor` AD-008/AD-009 contracts, `leave()` filter
**Requirement**: ELR-01, ELR-02, ELR-03, ELR-04, ELR-15, ELR-16

**Tools**:
- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:
- [ ] `elevator:pressed` payload is exactly `{playerId, floor}` (car in visibility only); `elevator:riders` payload is exactly `{car, riders, queue}`; neither appears for non-riders
- [ ] `viewOf` riders returns `car`; non-riders return `car:null`; `snapshotForRider` vs `snapshotForFloor` contracts hold
- [ ] Disconnect-dirty flush emits a single `elevator:riders` next tick; episode guard tests cover pre-round exit oscillation (no spam)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): rider-exclusive pressed and occupancy events plus rider snapshot`

---

### Phase 3: Server, client, harness, docs

#### T8: TurnoverRoom wiring

**What**: Wire the room: `setViewContext` provides `{floor, roomKey, car}` from `movement.viewOf`; `onMessage('elevator:call', elevatorCallIntentSchema, ...)` calls `movement.callElevator(clientId)` (duplicate flashes via sim event; no room-level re-validation of target); `onMessage('elevator:press', elevatorPressIntentSchema, ...)` calls `movement.pressFloor`; use `router.route` for `elevator:pressed`/`elevator:riders` (no new `toSelf`/`toAll` bypasses); on `join` and buzzer (`lock()`) send the viewer-branch snapshot (`snapshotForRider` for riders, `snapshotForFloor` otherwise — fixing the `TurnoverRoom.ts:285` lobby-fallback leak for mid-car riders); `leave` forgets router seq and movement dirty-flush applies.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts`
**Depends on**: T7
**Reuses**: `router.setViewContext`, `router.route`, `envelope` stamping, `@colyseus/testing` collectors, `validator: validate()` handlers
**Requirement**: ELR-01, ELR-03, ELR-04, ELR-06, ELR-11, ELR-18

**Tools**:
- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:
- [ ] `elevator:call` without target dispatches once; duplicate same-floor call flashes via sim; `elevator:press` from non-rider rejected silently
- [ ] `movement:snapshot` to a rider contains `carOccupants` with `queue`; to a non-rider contains no occupancy field; no occupant/queue field leaks to non-riders on any message
- [ ] Bypass denylist test still passes (no raw `client.send` outside Router)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: integration
**Gate**: quick

**Commit**: `feat(server): destination-free call and press wiring with rider-branch snapshots`

---

#### T9: Client connection and mappers

**What**: Update `Connection.sendElevatorCall()` to send destination-free `{type:'elevator:call'}` and add `sendElevatorPress(floor)`; add `MAPPERS` entries `elevator:pressed`→`elevator-pressed` and `elevator:riders`→`elevator-riders`; keep reducer no-ops for the high-frequency movement kinds. Add mapper pin tests.
**Where**: `apps/client/src/net/connection.ts`
**Depends on**: T8
**Reuses**: `room.send` pattern, `MAPPERS` pure-function shape, existing mapper test idioms
**Requirement**: ELR-05, ELR-06, ELR-09

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `sendElevatorCall` sends no `target`; `sendElevatorPress` sends `{type:'elevator:press', floor}`
- [ ] `mappers.test.ts` pins both new mappers' payload keys (pressed `{playerId,floor}`, riders `{car,riders,queue}`)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(client): destination-free call and press connection plus mappers`

---

#### T10: Client world scene and panel chip

**What**: In `WorldScene`, route not-in-car keys (`ArrowUp`/`ArrowDown`/`KeyE`) to `sendElevatorCall()` and in-car keys (`Digit1`/`Digit2`/`Digit3`→floor1..3, `Digit0`→lobby) to `sendElevatorPress(floor)`; apply server `elevator:pressed`/`elevator:riders` actions in `App` as surgical DOM writes to a new `#elevator-riders` chip (occupant names, visible only while the local player is a rider) plus four floor indicators (lobby/1/2/3, lit = queued or being served) and a `#elevator-press` last-press line beside the existing `#elevator-panel`. Add the chip/indicator elements to `lobbyView.ts` and `roundHud.ts`; keep `WorldScene` rider-invisibility (no car-interior rectangles) and panel position-only guarantee.
**Where**: `apps/client/src/scenes/WorldScene.ts`
**Depends on**: T9
**Reuses**: `applyServerEvents` dispatch, `syncScenes` lifecycle, `textContent` surgical updates from `app.ts`, `__TURNOVER__.scene('Round')` contract
**Requirement**: ELR-05, ELR-14, ELR-19

**Tools**:
- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:
- [ ] Keymap sends destination-free calls outside cars and floor presses inside cars
- [ ] Chip shows co-riders + lit indicators to riders only; non-riders' DOM has empty/hidden chip; `#elevator-panel` never contains names or queue data (MOVE-17 preserved)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(client): in-car press keymap and rider chip with lit indicators`

---

#### T11: Harness scenarios for elevator riders

**What**: Rewrite `movement.spec.ts` and `elevatorLobby.spec.ts` ride choreography for the press model (call → board → press → ride; 20-tick dwell expectations) and add a `client:elevator_riders` harness scenario: two tabs share a car — each shows the other's name and matching lit indicators while riding (press changes the car's path visibly), a third tab on the floor shows no occupancy anywhere and no queue, and a rider who exits does not re-board the same open-door stop.
**Where**: `apps/client/harness/movement.spec.ts`
**Depends on**: T10
**Reuses**: harness boot helper, `TURNOVER_TEST_SHIFT_SECONDS`, `waitForNextTimestep`, existing `movement.spec.ts` tab helpers
**Requirement**: ELR-05 (client), ELR-06..ELR-19 (harness half)

**Tools**:
- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:
- [ ] `pnpm test:client` passes: `client:movement` (updated), `client:elevator_lobby` (updated, zero host starts still exercises pre-round riding via press), and new `client:elevator_riders` assertions (chip exclusive to riders, press redirects, no re-board same stop)
- [ ] No panel payload leaks to non-riders on the wire (harness inspects `elevator:called`/`elevator:moved` keys still only `car`/`floor`)
- [ ] Gate check passes: `pnpm test:client` (full)

**Tests**: e2e
**Gate**: full

**Commit**: `test(client): elevator riders e2e and updated movement harness`

---

#### T12: Decisions, roadmap, and spec amendments

**What**: Record **AD-013** (rider-exclusive occupancy + queue/press knowledge — `riders` policy) and **AD-014** (call-model rework: destination-free calls, FIFO press queue, 1s dwell, open-door episode guard, stay-in-car, ghost trips, caller-never-boards, empty-idle dispatch preference, zero-ride guard) in `.specs/STATE.md`; shift the roadmap cycle table (insert 2.6 `elevator-riders`, `evidence`→2.7, `justice`→2.8, `round-end`→2.9, `telemetry`→2.10); annotate the movement design's "call semantics" interpretation as AD-014-superseded and note the AD-012 duplicate predicate narrowing.
**Where**: `.specs/STATE.md`
**Depends on**: T11
**Reuses**: AD numbering and supersession pattern from AD-011/AD-012 entries
**Requirement**: ELR-10, ELR-11 (dispatch preference), ELR-04 (snapshot), ELR-14 (dwell tuning) — docs trace

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `STATE.md` decisions section contains AD-013 and AD-014 with scope/date/status active; old duplicate/wrong-way-carry notes amended
- [ ] `roadmap.md` cycle table shows 2.6 `elevator-riders` and shifted successors (2.10 exit)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint`

**Tests**: none
**Gate**: build

**Commit**: `docs(state): AD-013/AD-014 and roadmap shift for elevator riders`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 -> T2 -> T3 -> T4 -> T5
Phase 2:  T6 -> T7
Phase 3:  T8 -> T9 -> T10 -> T11 -> T12
```

Execution is strictly sequential - no intra-phase parallelism. Packing into task-budgeted batches: Phase 1 (5) + Phase 2 (2) = 7 → batch 1; Phase 3 (5) → batch 2. Two batches → offer sub-agents at Execute.

**How phase-based execution works:** at Execute the agent packs phases into ~7-task batches — whole phases only. Offer batch sub-agents if that yields more than one batch and the user accepts. See `tlc-spec-driven/references/sub-agents.md`.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: dwell tuning | 1 constant | ✅ Granular |
| T2: payload types | 1 payload layer | ✅ Granular |
| T3: intent schemas | 1 intent file | ✅ Granular |
| T4: registry rows | 1 registry file | ✅ Granular |
| T5: router riders branch | 1 router file | ✅ Granular |
| T6: sim car state machine | 1 sim file core | ✅ Granular |
| T7: occupancy & snapshot | 1 sim file extension | ✅ Granular |
| T8: room wiring | 1 room file | ✅ Granular |
| T9: connection + mappers | 1 client net layer | ✅ Granular |
| T10: world scene + chip | 1 scene + panel DOM | ✅ Granular |
| T11: harness | 1 harness layer | ✅ Granular |
| T12: docs | docs only | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 -> T2 | ✅ Match |
| T3 | T2 | T2 -> T3 | ✅ Match |
| T4 | T3 | T3 -> T4 | ✅ Match |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T5 | T5 -> T6 (cross-phase, not diagram-scoped) | ✅ Match |
| T7 | T6 | T6 -> T7 | ✅ Match |
| T8 | T7 | T7 -> T8 (cross-phase) | ✅ Match |
| T9 | T8 | T8 -> T9 | ✅ Match |
| T10 | T9 | T9 -> T10 | ✅ Match |
| T11 | T10 | T10 -> T11 | ✅ Match |
| T12 | T11 | T11 -> T12 | ✅ Match |

Cross-phase deps (T6→T5, T8→T7) are validated by the forward-phase check; intra-phase arrows are the parity scope.

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | shared tuning | none | none | ✅ OK |
| T2 | shared payload types | none | none | ✅ OK (registry pins in T4) |
| T3 | shared intents | unit | unit | ✅ OK |
| T4 | registry | unit | unit | ✅ OK |
| T5 | router | unit | unit | ✅ OK |
| T6 | pure sim | unit | unit | ✅ OK |
| T7 | pure sim | unit | unit | ✅ OK |
| T8 | server room | integration | integration | ✅ OK |
| T9 | client mappers | unit | unit | ✅ OK |
| T10 | client world/UI | unit | unit | ✅ OK (e2e in T11) |
| T11 | harness | e2e | e2e | ✅ OK |
| T12 | docs | none | none | ✅ OK |
