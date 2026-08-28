# Movement Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/movement/design.md`
**Status**: Approved

**No wire-flip window this cycle:** all five new message types are additive — the old
client ignores unknown wire names (defensive `mapper === undefined` return, cycle 2.3),
so gate 3 stays green at every commit.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (gate ladder), `roadmap.md` (gate scenarios `sim:motion`, `sim:elevator`, `client:movement`), root `vitest.config.ts`, `apps/client/harness/playwright.config.ts`, `.github/workflows/ci.yml`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Shared protocol additions (`packages/shared/src/protocol`) | unit (vitest) | 1:1 to MOVE payload/intent contracts; registry walk extended | `packages/shared/src/**/*.test.ts` | `pnpm test:sim` |
| Pure movement/elevator sim (`packages/sim/src/movement.ts`) | unit (vitest, scripted-intent scenarios) | Every MOVE-01..17 sim half: exact tick math, phase transitions, elevator cycle, cross-run bit-for-bit replay | `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Server transport (`apps/server/src`) | integration (vitest, real server + SDK clients) | New-type envelope/policy/phase assertions + snapshot/leave fan-out | `apps/server/src/**/*.test.ts` | `pnpm test:sim` |
| Client world/input (`apps/client/src`) | unit (vitest) for reducer/mappers; e2e for scene/input wiring | Mapper pins 1:1; scene behavior via `client:movement` e2e | `apps/client/src/**/*.test.ts`, `apps/client/harness/*.spec.ts` | `pnpm test:sim` / `pnpm test:client` |
| Client movement e2e | e2e (new harness scenario) | `client:movement`: 4-tab keyboard movement, bounds, unlock, panels position-only, late joiner, leaver | `apps/client/harness/movement.spec.ts` | `pnpm test:client` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After shared/sim/server tasks | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Full | After client/harness tasks | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Protocol + pure sim

```
T1 → T2 → T3
```

### Phase 2: Server + client + harness

```
T4 → T5 → T6
```

---

## Task Breakdown

### T1: Shared movement protocol + landing tuning ✅ Done

**What**: Add the `MovementEvent` union (`player:moved`, `elevator:called`, `elevator:moved`) and payloads (`PlayerMoved`, `ElevatorCalled`, `ElevatorMoved`, `PlayerLeft`, `MovementSnapshot`; `FloorId`, `Facing`, `CarId`) to shared; add strict zod intent schemas (`move:start {dir}`, `move:stop`, `elevator:call {target}`) in a new `intents.ts`; extend `PROTOCOL_REGISTRY` with the five rows (all `all`, snapshot `self`) and the satisfies to `{ [K in SimEvent['type'] | MovementEvent['type']]: unknown }`; add `TUNING.ELEVATOR_LANDING_TILES = 1` and record **AD-007** in `.specs/STATE.md`. Extend the registry walk test (now ten keys) and add payload/intent tests.
**Where**: `packages/shared/src/protocol/registry.ts` (edits in `simEvents.ts`, `messages.ts`, new `intents.ts`, `tuning.ts`, `registry.test.ts`, `.specs/STATE.md`)
**Depends on**: None
**Reuses**: `Entry<K>`/`SimProjection<K>` typing and zod intent pattern from `lobbyStartIntentSchema`
**Requirement**: MOVE-01..19 (protocol foundation; every movement message is born in the registry per AD-006)

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [ ] All five rows declared once with correct policies; adding an undeclared movement event to the sim union is a compile error
- [ ] `ELEVATOR_LANDING_TILES` recorded as AD-007 (new tuning constant beyond prd §7)
- [ ] Intent schemas strict; reject extra fields/wrong types
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): movement events, intents, and landing tuning in the registry`

---

### T2: MovementSim core — players, integration, confinement ✅ Done

**What**: Implement the pure `MovementSim` in `packages/sim/src/movement.ts`: integer-millitile positions, `join`/`leave`, `startMove`/`stopMove` (idempotent, in-car and post-buzzer non-lobby-floor ignored), 20 Hz integration at exactly 300 millitiles/tick, pass-through bodies, facing flips, lobby clamping (0..HALL_LENGTH_TILES) and phase confinement (`unlock`/`lock` persist positions and re-confine future movement), `player:moved` emission on x/floor/facing change only, idle ticks silent. Write the `sim:motion` describe: scripted intents assert exact integration (20 ticks = 6.0 tiles), stop-on-release, facing, clamp bounds, pass-through, no idle events, lock/unlock transitions.
**Where**: `packages/sim/src/movement.ts` (new) + `movement.test.ts` (new)
**Depends on**: T1
**Reuses**: `TICK_HZ`, `TUNING`, `FLOOR_IDS`/`HALL_LENGTH_TILES`; test idioms from `roundSim.test.ts`
**Requirement**: MOVE-01, MOVE-02, MOVE-03, MOVE-04, MOVE-05, MOVE-06, MOVE-07, MOVE-08, MOVE-09

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [ ] 20 moving ticks displace exactly 6.000 tiles (integer millitiles; bit-for-bit across two runs)
- [ ] Lobby phase: floor stays `lobby`, x clamped; post-buzzer move intent on a non-lobby floor is ignored; round start keeps positions and continues active intents
- [ ] In-car move intents ignored; duplicate start / stray stop are no-ops
- [ ] No events on idle ticks
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): deterministic movement sim with phase confinement`

---

### T3: MovementSim elevators — dispatch, cycle, snapshot ✅ Done

**What**: Extend `MovementSim` with the two cars: call dispatch (score = busy-delay + ride; tie → car 1; no-idle → sim-level FIFO served on idle), decoy-ignore when target equals a car's pending target (event still emitted), fixed 60-tick arrival, instant boarding (candidates on floor within `ELEVATOR_LANDING_TILES`, sorted by distance then playerId, capacity 2, rest queued), ride at 40 ticks/floor with rider floor tracking, in-car intent rejection, idle-at-destination, one pending destination per car, lobby-phase call rejection, `elevator:moved` on floor changes, and `snapshot()`/`callElevator` phase guard. Write `sim:elevator`: arrive at exactly tick 60, 2 s/floor rides, capacity queuing, decoy flash with no dispatch, one-pending-destination, ≥100-tick cross-run bit-for-bit replay; extend `sim:motion` with snapshot content (MOVE-18).
**Where**: `packages/sim/src/movement.ts` (edits) + `movement.test.ts` (edits)
**Depends on**: T2
**Reuses**: car constants derived from `TUNING`/`TICK_HZ`; `ELEVATOR_LANDING_TILES`
**Requirement**: MOVE-10, MOVE-11, MOVE-12, MOVE-13, MOVE-14, MOVE-15, MOVE-16, MOVE-17, MOVE-18

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [ ] Scripted 100+ tick sequences replay bit-for-bit across two runs
- [ ] Riders' move intents ignored; riders' `player:moved` fires on floor hops; car events carry floor only (no occupant ids anywhere in event payloads)
- [ ] Lobby-phase call → rejection path (error intent), no event, no flash
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): deterministic two-car elevator cycle with decoy calls`

---

### T4: Room wiring — movement in both phases ✅ Done

**What**: Wire `MovementSim` into `TurnoverRoom`: create in `onCreate`, join/leave fan-out (`movement:snapshot` to joiner, `player:left` broadcast), intent handlers (`move:start`/`move:stop`/`elevator:call` zod; lobby-phase call → intent error), `advance()` ticks movement every interval in both phases (round sim unchanged), `unlock()` at start, `lock()` + fresh `movement:snapshot` to every connection at the buzzer. Add the `server:movement` describe: live envelope/policy assertions for the new types (snapshot self, moved/called/moved/left to all), snapshot contents on join and buzzer, in-car/pass-through behavior end-to-end, late-join rejection unchanged.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` (edits) + `TurnoverRoom.test.ts` (new describe)
**Depends on**: T3
**Reuses**: `roomWithFour`, `collectAll`; Router policy-typed `toSelf`/`toAll`
**Requirement**: MOVE-03 (server broadcast path), MOVE-07, MOVE-08 (server half), MOVE-18, MOVE-19

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [ ] No new send paths outside the Router (denylist test still passes)
- [ ] `movement:snapshot` is self-policy (only joiner receives it); `player:left`/`player:moved` broadcast
- [ ] Positions persist across start and buzzer (server test asserts x/floor survive)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim` (gate 3 unaffected — old client ignores unknown types)

**Tests**: integration
**Gate**: quick

**Commit**: `feat(server): room-owned movement layer ticks in both phases`

---

### T5: Client world — persistent scene, prediction, panels

**What**: Add `WorldScene` (scene key `'Round'`, replacing `RoundScene`): one labeled Rectangle per player, one Ellipse per car, hall/panel visuals in DOM; cursor-key input sending `move:start`/`move:stop` with local prediction and server reconcile; `applyServerEvents` applying `player:moved` (self reconcile, others lerp) and `elevator:*`; floor view follows the local player. Extend `MAPPERS` (five new actions; reducer no-ops the four high-frequency ones — documented render-state decision), `Connection` (`sendMoveStart/sendMoveStop/sendElevatorCall`), and `App` (movement-kind actions → scene + surgical `#elevator-panel` textContent updates; `syncScenes` starts the world at first lobby entry and keeps it across the buzzer). Unit tests: mapper pins for the new actions + reducer no-op identity.
**Where**: `apps/client/src/scenes/WorldScene.ts` (new; edits in `mappers.ts`, `state.ts`, `app.ts`, `connection.ts`, `main.ts`; delete `RoundScene.ts`)
**Depends on**: T4
**Reuses**: harness scene-read contract (`scene('Round')`); mappers/reducer idioms; `roundPlayers` for labels
**Requirement**: MOVE-01..05, MOVE-06..09 (client half), MOVE-16, MOVE-17

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Scene children = player Rectangles + labels + car Ellipses only (LIGHT-09 stays green unmodified)
- [ ] Own rectangle renders immediately on keydown; others follow within 2 ticks
- [ ] Panel never shows occupant ids; car positions update
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client`

**Tests**: unit + e2e (existing suites as the wire proof)
**Gate**: full

**Commit**: `feat(client): persistent world scene with predicted movement and panels`

---

### T6: Harness scenario `client:movement`

**What**: Add `apps/client/harness/movement.spec.ts`: 4 tabs join, ArrowRight hold displaces the own rectangle ≈ speed × elapsed and other tabs follow within 2 ticks; pre-round x clamps to lobby bounds; after host start, tabs ride an elevator between floors (panels show car floors, never occupants); post-buzzer a move intent on a non-lobby floor leaves the rectangle; a late tab cannot join mid-round (2.1 rule); a leaver's rectangle disappears on all tabs.
**Where**: `apps/client/harness/movement.spec.ts` (new)
**Depends on**: T5
**Reuses**: harness helpers + `__TURNOVER__.scene('Round')` reads; 8 s test shift (AD-004) for the buzzer leg
**Requirement**: MOVE-01..19 (end-to-end), MOVE-16, MOVE-17

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] All `client:movement` assertions pass against the real server
- [ ] Pre-existing harness scenarios (incl. LIGHT-09's exact 4-rectangle/4-label contract) stay green
- [ ] Gate check passes: `pnpm test:client` (full suite)

**Tests**: e2e
**Gate**: full

**Commit**: `test(client): end-to-end movement across lobby, floors, and elevators`

---

## Phase Execution Map

```
T1 → T2 → T3 → T4 → T5 → T6
```

Six tasks fit one batch → inline execution, no sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: shared protocol + tuning | one module | ✅ Granular |
| T2: movement core | one pure module + tests | ✅ Granular |
| T3: elevator cycle | one concept inside that module | ✅ Granular |
| T4: room wiring | one consumer file + tests | ✅ Granular |
| T5: client world | one scene + its feeders | ✅ Granular |
| T6: harness scenario | one file | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | shared protocol | unit | unit | ✅ OK |
| T2 | pure movement sim | unit | unit | ✅ OK |
| T3 | pure elevator sim | unit | unit | ✅ OK |
| T4 | server transport | integration | integration | ✅ OK |
| T5 | client scene/wiring | unit + e2e | unit + e2e | ✅ OK |
| T6 | client movement e2e | e2e | e2e | ✅ OK |
