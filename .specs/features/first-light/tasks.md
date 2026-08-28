# First-Light Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/first-light/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (gate ladder: typecheck+lint, `pnpm test:sim`, `pnpm test:client`), root `package.json` scripts, existing suites (`packages/sim/src/roundSim.test.ts`, `apps/server/src/rooms/TurnoverRoom.test.ts`, `apps/client/harness/boot.spec.ts`).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Sim shift override (packages/sim) | unit | 1:1 to T1 done-when: override honored, §7 default unchanged | `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Room env seam (apps/server) | unit (integration via vitest) | Non-prod override plumbs to sim; existing room tests stay green | `apps/server/src/**/*.test.ts` | `pnpm test:sim` |
| Client view reducer | unit | All branches; 1:1 to spec ACs; listed edge cases (connection-lost, error clearing) | `apps/client/src/state.test.ts` | `pnpm test:sim` |
| Client join / lobby / round / buzzer (DOM + net + scene) | e2e | Every gate scenario: happy path + each listed edge case + error paths, via `window.__TURNOVER__` | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Protocol / shared | none | Untouched this cycle (AD-003) — existing suites must stay green | `packages/shared/src/*.test.ts` | `pnpm test:sim` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Full | After tasks with e2e tests | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |
| Build | After the last task of the feature | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client && pnpm build` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Seam + reducer foundation

```
T1 → T2
```

### Phase 2: Join + lobby vertical slice

```
T2 → T3
T3 → T4
```

### Phase 3: Round view, buzzer, close-out

```
T4 → T5
T5 → T6
T1 → T6
T6 → T7
```

---

## Task Breakdown

### T1: Sim shift-length override + server test seam (AD-004) — ✅ done

**What**: Give `RoundSim` an optional `totalTicks` constructor override (default stays `TUNING.SHIFT_SECONDS × TICK_HZ`); TurnoverRoom passes `TURNOVER_TEST_SHIFT_SECONDS` to the sim only when `NODE_ENV !== 'production'`.
**Where**: `packages/sim/src/roundSim.ts`, `packages/sim/src/roundSim.test.ts`, `apps/server/src/rooms/TurnoverRoom.ts`, `apps/server/src/rooms/TurnoverRoom.test.ts`
**Depends on**: None
**Reuses**: `RoundSim` options-object constructor (`roundSim.ts:32`), existing clock tests
**Requirement**: LIGHT-13, LIGHT-14 (enabling infrastructure; spec Assumption "shortened shift test build")

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness` (for sim test style)

**Done when**:

- [ ] `new RoundSim({ seed, playerIds, totalTicks: 100 })` emits `round:buzzer` at exactly tick 100 and not before; no other behavior changes
- [ ] Default constructor still buzzer at tick 6000 (all existing clock tests pass unchanged)
- [ ] TurnoverRoom with `NODE_ENV=test` + `TURNOVER_TEST_SHIFT_SECONDS=5` delivers a `round:buzzer` broadcast after ~5 s of ticks; with the env var absent the room behaves exactly as before
- [ ] In `NODE_ENV=production` the env var is ignored (room uses the §7 default)
- [ ] Gate check passes: quick gate

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): add test-only shift-length seam for fast gate-3 rounds`

---

### T2: Client view reducer — ✅ done

**What**: Pure `ViewState` reducer translating server messages and UI actions into view state (join / lobby / round / lost), with role card, error banner, and round-started timestamp.
**Where**: `apps/client/src/state.ts` (new), `apps/client/src/state.test.ts` (new)
**Depends on**: T1 (not logically, but keeps vitest suite stable while T1 touches it)
**Reuses**: shared protocol types (`packages/shared/src/protocol/messages.ts`), `TUNING.SHIFT_SECONDS`
**Requirement**: LIGHT-01, LIGHT-02, LIGHT-05, LIGHT-07, LIGHT-08, LIGHT-09, LIGHT-11, LIGHT-13, LIGHT-14 (transition logic)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Reducer actions cover: `submit-join`, `join-failed(reason)`, `snapshot`, `round-started(atMs)`, `role-dealt`, `buzzer`, `intent-error`, `connection-lost`, `clear-error`
- [ ] Unit tests assert every transition the spec defines: join→lobby on snapshot, lobby→round on round-started (deadline = atMs + 300 000), round→lobby on buzzer with role cleared, error banner set/cleared, connection-lost → 'lost'
- [ ] No DOM, Phaser, or network imports (pure module)
- [ ] Gate check passes: quick gate

**Tests**: unit
**Gate**: quick

**Commit**: `feat(client): add pure view-state reducer for first-light views`

---

### T3: Join vertical slice — connection wrapper, join view, harness `client:lobby_join`

**What**: Add `@colyseus/sdk` dep; implement the connection wrapper (join by code+name, typed message dispatch, start intent, disconnect callback, dev-only `__TURNOVER__` record/setLocal); render the join screen; wire `main.ts` to reducer+overlay; Playwright spec `lobby.spec.ts` covering the join story.
**Where**: `apps/client/package.json`, `apps/client/vite.config.ts` (dev proxy: `/matchmake` + ws upgrade → :2567 so `pnpm boot` works for the human check), `apps/client/src/net/connection.ts` (new), `apps/client/src/ui/joinView.ts` (new), `apps/client/src/ui/dom.ts` (new), `apps/client/src/debug.ts` (modify), `apps/client/src/main.ts` (modify), `apps/client/harness/lobby.spec.ts` (new)
**Depends on**: T2
**Reuses**: `debug.ts` hook pattern + `check-prod-strip.mjs`, `boot.spec.ts` evaluation style, `playwright.config.ts` webServer
**Requirement**: LIGHT-01, LIGHT-02, LIGHT-03, LIGHT-04; edge cases: duplicate submit guard, join rejections

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Verify `@colyseus/sdk` 0.18 join/message API against docs before writing `connection.ts` (design risk #1)
- [ ] Harness: submit valid code+name → lobby view renders own name + roster from personal snapshot; `__TURNOVER__.local.playerId/roomId` set; events recorded
- [ ] Harness: room-not-found and name-taken joins each stay on join screen with the server's reason visible
- [ ] Harness: lowercase code input joins the same room as uppercase
- [ ] Harness: name field enforces 1–16 chars; code field letters-only max 4; rapid double submit connects exactly once (lobby shows one entry, no error)
- [ ] Production strip check still passes (webServer command runs it)
- [ ] Gate check passes: full gate

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): join by code from the browser with harness coverage`

---

### T4: Lobby view — roster, host-only start, rejection banner

**What**: Render the lobby view (roster names, own-name highlight, host marker, start control for host only, error banner for rejected intents); dispatch `lobby:start` on click; extend `lobby.spec.ts` with the multi-tab lobby story.
**Where**: `apps/client/src/ui/lobbyView.ts` (new), `apps/client/harness/lobby.spec.ts` (extend)
**Depends on**: T3
**Reuses**: reducer from T2, connection wrapper from T3, `renderRoundHud`-style dom helpers
**Requirement**: LIGHT-05, LIGHT-06, LIGHT-07, LIGHT-08

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Harness: 4 pages join one room; every page's roster updates to 4 names after each join; host marker on the first joiner only
- [ ] Harness: start control visible only on the host page
- [ ] Harness: with only 3 players, host click sends the intent, the "need more players" error renders, and all pages stay in lobby
- [ ] Harness: with 4 players, host click lands all pages in round view (round:started received) — smoke for T5 entry
- [ ] Gate check passes: full gate

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): lobby roster and host-start with harness coverage`

---

### T5: Round view — Phaser rectangles, round HUD, own role card

**What**: Add `RoundScene` (one labeled rectangle per playerId from the last snapshot, id fallback); render round HUD (own role card from private `role:dealt`, countdown from `roundStartedAt` deadline, clamped at 00:00); start/sleep the scene on round entry/exit; Playwright spec `round.spec.ts` for the round story.
**Where**: `apps/client/src/scenes/RoundScene.ts` (new), `apps/client/src/ui/roundHud.ts` (new), `apps/client/src/main.ts` (modify), `apps/client/harness/round.spec.ts` (new)
**Depends on**: T4
**Reuses**: BootScene registration pattern, reducer deadline from T2, dom helpers
**Requirement**: LIGHT-09, LIGHT-10, LIGHT-11, LIGHT-12

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Harness: 4 players start; each page shows 4 rectangles labeled with roster names; scene registered and reachable via `__TURNOVER__.scene('Round')`
- [ ] Harness: role card content equals that page's own `role:dealt` payload; cross-tab check confirms no page renders another player's role
- [ ] Harness: countdown starts at 05:00 and decreases across a 1.5 s sampled interval (delta within [1.0, 2.0] s); display clamps at 00:00 (unit-asserted in T2 via deadline math; e2e asserts live countdown)
- [ ] Harness: a round playerId absent from the roster renders with the raw id as label (drive via a second room where a player leaves mid-round... server keeps slot idle — verified by labeling logic unit test in `RoundScene` if e2e is not reachable without movement; mark which was used)
- [ ] Gate check passes: full gate

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): round view with player rectangles, clock, and own role card`

---

### T6: Buzzer — return to lobby and fresh re-start

**What**: Wire `round:buzzer` → lobby view (role card and clock cleared, scene slept); verify the post-buzzer re-start renders a fresh round view; extend `round.spec.ts` using the T1 5-second test shift.
**Where**: `apps/client/src/main.ts` (modify), `apps/client/harness/round.spec.ts` (extend), `apps/client/harness/playwright.config.ts` (add `TURNOVER_TEST_SHIFT_SECONDS=5` to webServer command)
**Depends on**: T5 (and T1)
**Reuses**: reducer buzzer action from T2, RoundScene sleep path from T5
**Requirement**: LIGHT-13, LIGHT-14

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Harness (5 s shift): after ~5 s every page shows the lobby view again, role card and clock gone
- [ ] Harness: host re-starts; pages re-enter round view with a fresh 05:00 clock and a new own-role deal
- [ ] Gate check passes: full gate

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): buzzer returns clients to lobby for re-deal`

---

### T7: Close-out — lost-connection notice, edge-case wiring, feature gates

**What**: Wire `connection-lost` (leave/close) to the static "connection lost" notice; sweep remaining edge cases (mid-lobby join/leave updates all pages, 7th-player room-full surfacing); run the full build gate; update STATE.md handoff.
**Where**: `apps/client/src/main.ts` (modify), `apps/client/src/ui/dom.ts` (extend), `apps/client/harness/lobby.spec.ts` (extend), `.specs/STATE.md`
**Depends on**: T6
**Reuses**: reducer `connection-lost` action from T2, all existing specs
**Requirement**: edge cases (spec Edge Cases list); LIGHT traceability completion

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`, `turnover-gates`

**Done when**:

- [ ] Harness: mid-lobby join/leave updates rosters on all pages without reload (extends T4 if already covered — dedupe, don't duplicate)
- [ ] Harness: 7th join attempt surfaces the room-full rejection on the join screen (server rule; client surfaces it)
- [ ] Lost-connection notice renders (reducer-level unit from T2 + wiring evidence in code; browser-level kill is explicitly not e2e-asserted — noted as Gate-4 human territory)
- [ ] Full gate ladder green: typecheck, lint, test:sim, test:client, build
- [ ] STATE.md handoff updated
- [ ] Gate check passes: build gate

**Tests**: e2e
**Gate**: build

**Commit**: `feat(client): close out first-light with connection-loss notice and edge coverage`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 → T2
Phase 2:  T3 → T4
Phase 3:  T5 → T6 → T7
```

Execution is strictly sequential. Total tasks: 7 → fits a single batch → executed inline (no sub-agent offer needed).

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | One seam (sim param + room env lines + tests) | ✅ Granular (cohesive) |
| T2 | One pure module + tests | ✅ Granular |
| T3 | Join vertical slice (dep + wrapper + view + spec) | ⚠️ Cohesive bundle — one user-visible capability, self-testable only as a unit |
| T4 | One view + spec extension | ✅ Granular |
| T5 | One scene + one HUD + spec | ⚠️ Cohesive bundle — round entry capability |
| T6 | One transition + spec extension | ✅ Granular |
| T7 | Close-out sweep + handoff | ⚠️ Accepted final task |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 (and T1) | T5 → T6 | ✅ Match (T1 already an ancestor) |
| T7 | T6 | T6 → T7 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Sim + room seam | unit | unit | ✅ OK |
| T2 | Client reducer | unit | unit | ✅ OK |
| T3 | Client net + join view | e2e | e2e | ✅ OK |
| T4 | Client lobby view | e2e | e2e | ✅ OK |
| T5 | Client scene + HUD | e2e | e2e | ✅ OK |
| T6 | Client buzzer wiring | e2e | e2e | ✅ OK |
| T7 | Client lost-view wiring + sweep | e2e | e2e | ✅ OK |
