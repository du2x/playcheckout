# Justice Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/justice/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Guidelines found: `AGENTS.md` (verification ladder), root `package.json` scripts, `vitest` workspace config, `apps/client/harness/playwright.config.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Sim domain logic (justice verdicts, grace, walk-in, accuse) | unit (deterministic bot scenarios) | All branches; 1:1 to spec ACs; every listed edge case has a test; named gate scenarios | `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Shared protocol (registry rows, payload shapes, intent schemas) | unit | Compile-exhaustive registry; policy membership + payload-shape assertions | `packages/shared/src/protocol/*.test.ts` | `pnpm test:sim` |
| Server room integration (intent guards, teardown, routing) | integration | Happy + every rejection edge + teardown + routing width | `apps/server/src/rooms/*.test.ts` | `pnpm test:sim` |
| Client presentation (accusation session, menu, toast) | unit (reducer) + e2e (harness) | Reducer: all actions/branches; harness: one named `client:*` scenario covering the P4 ACs | `apps/client/src/**/*.test.ts`, `apps/client/harness/*.spec.ts` | `pnpm test:sim` / `pnpm test:client` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After protocol/sim-only tasks | `pnpm typecheck && pnpm biome check packages/shared packages/sim && pnpm test:sim` |
| Full | After server/client tasks | `pnpm typecheck && pnpm biome check <changed paths> && pnpm test:sim` |
| Build | After harness tasks and at cycle close | `pnpm typecheck && pnpm biome check . && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Protocol + sim core

```
T1 → T2 → T3
T1 → T5
```

### Phase 2: Server

```
T3 → T4
T4 → T8
```

### Phase 3: Client

```
T5 → T6
```

### Phase 4: Harness + deferred gaps

```
T6 → T7
```

(T8 runs after T7 by phase order only — its dependency edge is T4 → T8.)

---

## Task Breakdown

### T1: Protocol — declare the firing event and accusation intent ✅

**What**: Add the `player:fired` SimEvent (internal `reason`), the `PlayerFired` wire payload + `'all'` registry row, the `accuse` intent schema, and the `'justice-rejected'` IntentError code.
**Where**: `packages/shared/src/protocol/simEvents.ts`, `packages/shared/src/protocol/messages.ts`, `packages/shared/src/protocol/registry.ts`, `packages/shared/src/protocol/intents.ts`
**Depends on**: None
**Reuses**: existing registry row pattern (`room:entered`), intent schema pattern (`workStartIntentSchema`)
**Requirement**: JUST-12, JUST-13, JUST-14

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol` (already loaded — payloads carry no type literal, registry is the audit surface)

**Done when**:

- [ ] Registry compiles exhaustively (`satisfies` block unchanged); projection strips `reason`
- [ ] `accuseIntentSchema` is strict zod, `targetId: string().min(1)`
- [ ] Registry tests assert the new row's policy membership (`'all'`) and payload shape `{playerId}`
- [ ] `pnpm typecheck` + biome clean; sim suite still green (event union extended)

**Tests**: unit (registry)
**Gate**: quick

**Commit**: `feat(protocol): declare player:fired with an all-policy name-only row and the accuse intent`

---

### T2: Sim — justice module, walk-in conviction, grace ✅

**What**: Create `packages/sim/src/justice.ts` (fired set, verdicts, pending event queue, grace end via `noteSabotage`), add `WorkChannels.activeUnprepOwner`/`positionOf` queries, wire walk-in detection into `RoundSim.tick` (own segment diff, deterministic order per design).
**Where**: `packages/sim/src/justice.ts` (new), `packages/sim/src/work.ts`, `packages/sim/src/roundSim.ts`
**Depends on**: T1
**Reuses**: segment-diff pattern (`work.ts:213`), `work.leave` (WORK-12), announce-pending pattern (`work.ts:107`)
**Requirement**: JUST-01, JUST-02, JUST-03, JUST-04, JUST-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `sim:walkin_conviction` passes: staff enters mid-un-prep → saboteur fired same resolution tick with name-only event; walk-out cancel fires nobody; entry after completion fires nobody; pass-through entry fires; channel-owner's own entry fires nothing; same-tick entry-then-completion convicts
- [ ] Fired players are excluded from further justice processing (fired set guards)
- [ ] Grace ends exactly on the first `room:trashed` (pinned by test: accusation validity covered in T3; here pin that `noteSabotage` is invoked by the tick loop exactly once per trash transition)
- [ ] `pnpm test:sim` green, no existing test weakened

**Tests**: unit (sim)
**Gate**: quick

**Commit**: `feat(sim): add the justice module and instant walk-in conviction behind an active un-prep`

---

### T3: Sim — accusation resolution and verdicts

**What**: Implement `RoundSim.accuse` (eligibility guards, range check via `positionOf`, grace-aware validity, fire either party) with the coarse `resolved | rejection` return; cover the named `sim:accuse` and `sim:firing_toast` gate scenarios.
**Where**: `packages/sim/src/roundSim.ts`, `packages/sim/src/justice.ts`, `packages/sim/src/justice.test.ts` (or roundSim.test.ts per house layout)
**Depends on**: T2
**Reuses**: `TUNING.ACCUSATION_RANGE_TILES`, justice pending queue from T2
**Requirement**: JUST-06, JUST-07, JUST-08, JUST-09, JUST-10, JUST-11, JUST-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `sim:accuse` passes: correct post-grace accusation fires the saboteur; innocent target fires the accuser; in-grace saboteur accusation fires the accuser; every rejection edge (saboteur accuser, out-of-range, other floor, lobby phase, fired target, self-target) fires nobody and returns a rejection
- [ ] `sim:firing_toast` passes: each firing path (walk-in, wrong, correct) emits exactly one `player:fired` whose projection payload is `{playerId}` exactly — shape audit over all paths
- [ ] Return value never distinguishes verdicts (coarse `resolved`); the internal event's `reason` carries validity for 2.10
- [ ] `pnpm test:sim` green

**Tests**: unit (sim)
**Gate**: quick

**Commit**: `feat(sim): resolve accusations with hidden grace and coarse rejections`

---

### T4: Server — accuse handler, fired teardown, live-ness guards

**What**: Add the `accuse` validate handler with round-active + live-ness guards, the room-level fired set fed by `player:fired` routing (`movement.leave` teardown), live-ness rejection on every existing intent handler, and error replies for rejections.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts`, `apps/server/src/rooms/TurnoverRoom.test.ts`
**Depends on**: T3
**Reuses**: intent handler skeleton, `IntentError` plumbing, `movement.viewOf` null-context routing
**Requirement**: JUST-06, JUST-09, JUST-12, JUST-13 (server half)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Room integration tests: valid accusation routes one all-policy `{playerId}` message to every connection; fired player receives no positional-policy traffic afterwards; every intent from a fired session rejects with `justice-rejected`; no snapshot/exit-path misbehavior for a fired session (design Risk 1 pinned)
- [ ] Rejections map to `error { code: 'justice-rejected' }` with distinct human messages, no validity leak
- [ ] `pnpm test:sim` green (room suite included)

**Tests**: integration (room)
**Gate**: full

**Commit**: `feat(server): validate accusations, tear down fired players, and guard intents on live-ness`

---

### T5: Client — accusation session reducer, toast, rectangle removal

**What**: Create `apps/client/src/accuseSession.ts` (pure reducer: menu target, toasts, self-fired), register the `player:fired` mapper in the exhaustive client dispatch, remove the fired player's rectangle in WorldScene, and render the name-only toast + self-fired state.
**Where**: `apps/client/src/accuseSession.ts` (new), `apps/client/src/accuseSession.test.ts` (new), `apps/client/src/app.ts`, `apps/client/src/scenes/WorldScene.ts`
**Depends on**: T1
**Reuses**: `riderSession.ts` one-state-home pattern, `carScreen.test.ts` reducer-test pattern, DOM toast placement in the HUD layer
**Requirement**: JUST-04 (client half), JUST-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Reducer unit tests: fired event → toast + (self) fired state; menu open/close/confirm transitions; toast auto-expiry behavior
- [ ] WorldScene removes the rectangle of any fired playerId; self-fired stops movement intents
- [ ] Toast text is exactly "<name> was fired" — no role/reason/validity anywhere
- [ ] `pnpm typecheck` + `pnpm test:sim` green

**Tests**: unit (reducer)
**Gate**: full

**Commit**: `feat(client): add the accusation session — name-only firing toast, self-fired state, rectangle removal`

---

### T6: Client — hold-E confirm menu and accuse sending

**What**: Wire the E key: keydown starts a 400 ms timer, expiry opens the confirm menu for the nearest live same-floor candidate within `TUNING.ACCUSATION_RANGE_TILES`, keyup before expiry sends `elevator:call`; confirm sends `accuse {targetId}`, cancel sends nothing; errors close the menu.
**Where**: `apps/client/src/app.ts`, `apps/client/src/ui/` (menu DOM), `apps/client/src/connection` senders
**Depends on**: T5
**Reuses**: keymap handling in `app.ts`, `sendElevatorPress`-style sender pattern, accuseSession from T5
**Requirement**: JUST-16, JUST-17, JUST-18, JUST-19, JUST-20

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Menu shows the candidate's name; confirm sends the intent; cancel and dismissal send nothing
- [ ] Tap E (<400 ms) still calls the elevator exactly as today; no menu
- [ ] Error replies surface and close the menu without firing
- [ ] `pnpm typecheck` + `pnpm test:sim` green

**Tests**: unit (reducer paths extended in T5's suite)
**Gate**: full

**Commit**: `feat(client): open the hold-E accusation confirm menu and send the accuse intent`

---

### T7: Harness — client:accuse_ui gate scenario

**What**: Add the Playwright scenario: two pages, host start (AD-004 short shift), tap-E elevator call unchanged, hold-E menu naming the nearby player, cancel sends nothing, confirm fires and both pages show the name-only toast while the round continues.
**Where**: `apps/client/harness/justice.spec.ts` (new)
**Depends on**: T6
**Reuses**: harness helpers (`createRoom`, page driving) from `lobby.spec.ts`/`movement.spec.ts`, AD-004 short-shift boot
**Requirement**: JUST-16, JUST-18, JUST-20

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] `client:accuse_ui` passes under `pnpm test:client`; suite count grows, none skipped
- [ ] Scenario asserts toast text, rectangle removal, and that the round continues (no results screen — 2.9 scope)

**Tests**: e2e (harness)
**Gate**: build

**Commit**: `test(justice): add the client:accuse_ui harness scenario`

---

### T8: Deferred gap assertions — room-shell + first-light PASS gaps

**What**: Add the six assertions STATE deferred to the next TurnoverRoom/client-touching cycle: LOBBY-02 "create no room" clause, reject-then-start mutant (rejected start intent then a valid start works), LOBBY-05 roster unchanged after name rejection, LIGHT-02 unknown-code message, LIGHT-04 1-char name minimum, LIGHT-08 "round already active" message.
**Where**: `apps/server/src/rooms/TurnoverRoom.test.ts`
**Depends on**: T4
**Reuses**: existing room-shell/first-light test scaffolding
**Requirement**: JUST-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] All six assertions exist and pass; none of the existing tests weakened
- [ ] `pnpm test:sim` green

**Tests**: integration (room)
**Gate**: full

**Commit**: `test(room): close the deferred room-shell and first-light PASS gaps`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ------→ T2 ------→ T3
Phase 2:  T4
Phase 3:  T5 ------→ T6
Phase 4:  T7, T8 (T7 then T8 by phase order)
```

8 tasks total → single task-budgeted batch → inline execution in the main window, no sub-agents. The Verifier runs automatically after T8.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: protocol rows | 1 concept (4 files, one declaration set) | ✅ Granular |
| T2: justice + walk-in | 1 module + 2 query additions | ✅ Granular |
| T3: accusation resolution | 1 method + tests | ✅ Granular |
| T4: server guards/teardown | 1 file + tests | ✅ Granular |
| T5: accusation session reducer | 1 module + wiring | ✅ Granular |
| T6: hold-E menu | 1 interaction surface | ✅ Granular |
| T7: harness scenario | 1 spec file | ✅ Granular |
| T8: deferred assertions | 1 test file | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | Phase 1 head | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 (phase boundary) | ✅ Match |
| T5 | T1 | T4 → T5 (phase boundary; T5 needs only the protocol) | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 (phase boundary) | ✅ Match |
| T8 | T4 | T4 → T8 (cross-phase edge; after T7 by phase order) | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Shared protocol | unit | unit | ✅ OK |
| T2 | Sim domain | unit | unit | ✅ OK |
| T3 | Sim domain | unit | unit | ✅ OK |
| T4 | Server integration | integration | integration | ✅ OK |
| T5 | Client presentation | unit | unit | ✅ OK |
| T6 | Client presentation | unit | unit | ✅ OK |
| T7 | Client e2e | e2e | e2e | ✅ OK |
| T8 | Server integration | integration | integration | ✅ OK |
