# Round-End Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/round-end/design.md`
**Status**: In progress

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Guidelines found: `AGENTS.md` (verification ladder), root `package.json` scripts, `vitest` workspace config, `apps/client/harness/playwright.config.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Shared protocol (round:ended, round:recap, spectator:snapshot, round:resumed) | unit | Compile-exhaustive registry; policy membership + payload-shape assertions; leak rule: no pre-round saboteurId anywhere | `packages/shared/src/protocol/*.test.ts` | `pnpm test:sim` |
| Sim win checks + journal | unit (deterministic bot scenarios) | All three §6.6 paths + exactly-once; journal entries per design; every listed edge case has a test; named gate scenario | `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Server room integration (results phase, recap, spectators, reconnection) | integration | Win-end transition, recap contents, abort, seat hold/restore/ghost, spectator over-delivery width | `apps/server/src/rooms/*.test.ts` | `pnpm test:sim` |
| Client presentation (reducer, mappers, results view, spectator scene, reconnect loop) | unit (reducer/mapper) + e2e (harness) | Reducer: all new actions/branches; harness: `client:round_end` + `client:spectator_view` named scenarios | `apps/client/src/**/*.test.ts`, `apps/client/harness/*.spec.ts` | `pnpm test:sim` / `pnpm test:client` |

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

### Phase 1: Protocol + sim

```
T1 → T2
T1 → T3
```

### Phase 2: Server

```
T1 → T4
T2 → T4
T4 → T5
```

### Phase 3: Client

```
T3 → T6
T4 → T6
T3 → T7
T4 → T7
T5 → T8
T7 → T8
```

---

## Task Breakdown

### T1: Protocol — round-end, recap, spectator, resumed payloads ✅

**What**: Add the `round:ended` SimEvent (winner staff/saboteur + reason + saboteurId), the `RecapEntry` union, and the four wire payloads (`RoundEnded`, `RoundRecap`, `SpectatorSnapshot`, `RoundResumed`) with registry rows — `round:ended` `'all'` (sim projection), `round:recap` `'all'` (room-originated), `spectator:snapshot` `'self'`, `round:resumed` `'self'`. Includes the compile-forced client plumbing (ViewAction members, ACTION_ROUTES rows, MAPPERS keys) because the exhaustive tables on both sides of the wire fail compilation until consistent — folded here from T3, which keeps reducer behavior + tests.
**Where**: `packages/shared/src/protocol/simEvents.ts`, `packages/shared/src/protocol/messages.ts`, `packages/shared/src/protocol/registry.ts`, `apps/client/src/state.ts`, `apps/client/src/net/mappers.ts`
**Depends on**: None
**Reuses**: registry row pattern (`player:fired` projection, room-originated row `movement:snapshot`)
**Requirement**: REND-06, REND-07, REND-12, REND-13 (payload half), REND-18 (payload half)

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol` (round:ended is the only saboteur-naming message; declared post-round only)

**Done when**:

- [x] Registry compiles exhaustively (the `satisfies` block forces the `round:ended` row in the same commit)
- [x] Registry tests assert each new row's policy and payload shape; the `round:ended` projection carries `saboteurId` verbatim (reveal is post-round by construction)
- [x] `pnpm typecheck` + biome clean; sim suite green (event union extended, no emit sites yet)

**Tests**: unit (registry)
**Gate**: quick

**Commit**: `feat(protocol): declare round-end, recap, spectator, and resumed messages`

---

### T2: Sim — win checks, ghost, round journal ✅

**What**: RoundSim win checks (saboteur-fired same-tick, staff-reduced incl. ghosts, buzzer coverage via `WorkChannels.preppedCount`), `ended` guard on intents, `ghost()`, the round journal (crimes/catches/accusations) with `recapEntries()`/`saboteurId` queries, and the `sim:win_checks` scenarios.
**Where**: `packages/sim/src/roundSim.ts`, `packages/sim/src/justice.ts`, `packages/sim/src/work.ts`, `packages/sim/src/roundSim.test.ts`
**Depends on**: T1
**Reuses**: announce-pending pattern (justice.drainPending), fired-position filter (roundSim live map), freshness state (EVID-06)
**Requirement**: REND-01, REND-02, REND-03, REND-04, REND-05, REND-08 (sim half)

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness` (deterministic scripted inputs, event assertions)

**Done when**:

- [x] `sim:win_checks` passes: walk-in → staff win same tick (fired event precedes round:ended); wrong-accusation cascade to 1 staff → saboteur win; zero-prep short shift → buzzer then coverage-failed saboteur win (same tick, buzzer first); full-coverage run → coverage-met staff win; staff ghosted to 1 → saboteur win on the next tick flush
- [x] Exactly one `round:ended` per round on every path; intents after `ended` return `round-not-active`; no events after `ended`
- [x] Journal: crime (with fresh flag at journal time), catch (entrant+saboteur), accusation (accuser+target+correct) entries in tick order; `recapEntries()` returns them; ghost leaves no journal entry
- [x] `pnpm test:sim` green, no existing test weakened

**Tests**: unit (sim)
**Gate**: quick

**Commit**: `feat(sim): end the round per the win conditions and journal crimes, catches, and accusations`

---

### T3: Client state — results view, resumed clock, new actions ✅

**What**: `ViewAction` grows `round-ended`/`round-recap`/`round-resumed`/`spectator-snapshot`; `ACTION_ROUTES` rows (spectator-snapshot → scene, rest → view); `MAPPERS` keys; reducer: `results` view state (winner/reason/saboteurId/entries), `round-resumed` (view round + `roundEndsAtMs` from remainingTicks), `clockRemainingMs` prefers the resumed deadline, buzzer keeps its transient behavior. (The compile-forced plumbing half landed with T1; this task is the reducer behavior + tests.)
**Where**: `apps/client/src/state.ts`, `apps/client/src/state.test.ts`, `apps/client/src/net/mappers.ts`, `apps/client/src/net/mappers.test.ts`
**Depends on**: T1
**Reuses**: reducer switch + `ACTION_ROUTES` satisfies table (state.ts), mapper table pattern
**Requirement**: REND-06, REND-07, REND-18 (client half, reducer level)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Reducer unit tests: round-ended → results (winner + saboteurId stored), round-recap merges entries, round-resumed → round view with honest clock override, aborted payload yields results with saboteurId null
- [x] Mapper tests: the four payloads map 1:1; `satisfies Record<RegistryKey, …>` exhaustiveness compiles
- [x] `pnpm typecheck` + biome clean; client unit suite green

**Tests**: unit (reducer + mappers)
**Gate**: quick

**Commit**: `feat(client): reduce round-end, recap, and resumed messages into a results view state`

---

### T4: Server — results phase, recap assembly, spectator routing ✅

**What**: `results` phase (lobby-like joins, `lobby:start` accepted, round-end transition with MOVE-18 snapshots), ride journal from routed movement events + recap broadcast after `round:ended`, abort-path construction, spectator `ViewContext` + Router over-delivery (sameFloor/occupants/earshot), `spectator:snapshot` on firing, `round:resumed` restore payload builder, movement queries needed (`announce`, all-floors positions, riders-of tracking), `WorkChannels.roomStates` sim query.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts`, `apps/server/src/rooms/router.ts`, `packages/sim/src/movement.ts`, `packages/sim/src/work.ts`, `packages/sim/src/roundSim.ts` (queries), `apps/server/src/rooms/TurnoverRoom.test.ts`
**Depends on**: T1, T2
**Reuses**: router dispatch branches (router.ts), movement snapshot paths (MOVE-18/AD-017), `viewOf` context plumbing
**Requirement**: REND-04, REND-06, REND-08, REND-09, REND-12, REND-13, REND-14 (server half)

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol` (spectator over-delivery is FR-20-sanctioned; audit the width in tests)

**Done when**:

- [x] Room tests: sim-driven staff win → phase results, `round:recap` follows `round:ended` in the same flush with crime/catch/accusation/ride entries (name-free ids), lobby-like join + host start in results begins a fresh round
- [x] Spectator routing: a fired session receives sameFloor/occupants events from ALL floors; a live session's message log is byte-identical to 2.8 (no spectator:snapshot, no cross-floor player:moved) — positive control
- [x] `spectator:snapshot` arrives on firing with all-floors players, cars, room states, all carded rooms
- [x] `pnpm test:sim` green (server suite), no existing test weakened

**Tests**: integration (room)
**Gate**: quick

**Commit**: `feat(server): add the results phase, recap timeline, and FR-20 spectator routing`

---

### T5: Server — reconnection seat, ghost, abort (FR-25)

**What**: `RECONNECT_SECONDS` seam (60 production), unconsented mid-round leave keeps roster + frozen movement slot with exactly one `player:left`, `allowReconnection` await; restore on resolve (forget seq, `movement.announce` re-add, `role:dealt`, snapshot or spectator snapshot, `round:resumed`); on expiry ghost staff (`sim.ghost` + movement.leave) or abort the saboteur's round; lobby/results-phase leaves unchanged.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts`, `apps/server/src/rooms/TurnoverRoom.test.ts`
**Depends on**: T4
**Reuses**: `onLeave` structure, `player:left` broadcast (MOVE-19), snapshot paths from T4
**Requirement**: REND-17, REND-18, REND-19, REND-20, REND-21, REND-22

**Done when**:

- [ ] `server:reconnect` room tests pass with a real SDK client: raw ws close mid-round → exactly one `player:left`, seat held (no roster snapshot churn); `client.reconnect(token)` restores role card (saboteur card included), `round:resumed` remainingTicks, and the re-announced position reaches other clients
- [ ] Staff expiry → ghost: intents rejected, win checks count them out (staff-to-1 → saboteur win via queued check); saboteur expiry → aborted `round:ended` + recap, no traitor identity
- [ ] Lobby-phase drop behavior byte-identical to 2.8 (no seat held)
- [ ] `pnpm test:sim` green, no existing test weakened

**Tests**: integration (room)
**Gate**: quick

**Commit**: `feat(server): hold 60s reconnection seats with role restore, ghosts, and saboteur aborts`

---

### T6: Client — results view + recap + client:round_end

**What**: `resultsView.ts` (winner banner, traitor line, `#recap-list` timeline with roster names, roster, host start control), app render/syncScenes wiring, roundHud clock reads the resumed deadline, harness scenario `client:round_end` (zero-prep short round → buzzer → saboteur-win banner + saboteur name + recap rows on every page; host start begins a new round).
**Where**: `apps/client/src/ui/resultsView.ts` (new), `apps/client/src/app.ts`, `apps/client/src/ui/roundHud.ts`, `apps/client/harness/roundEnd.spec.ts` (new)
**Depends on**: T3, T4
**Reuses**: lobbyView/roundHud DOM patterns, `el()` helper, harness choreography from justice.spec.ts
**Requirement**: REND-06, REND-07, REND-08, REND-09, REND-10, REND-11

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness` (gate-3 scenario format, __TURNOVER__ contract)

**Done when**:

- [ ] `client:round_end` passes: all four pages show the banner, the saboteur's roster name, and recap rows; host start control yields a fresh `round:started`
- [ ] Unit: results view renders aborted state with no traitor line and no banner side (reducer-level covered in T3; DOM-level smoke here or via harness assertions)
- [ ] `pnpm typecheck` + biome clean; `pnpm test:client` green including the new scenario

**Tests**: unit + e2e (harness)
**Gate**: build

**Commit**: `feat(client): show the winner banner, traitor reveal, and recap timeline at round end`

---

### T7: Client — spectator overview + client:spectator_view

**What**: WorldScene spectator mode on `selfFired`: four stacked floor lanes (lobby + 3), all players' rectangles at lane positions, door frames/cards/interior tints on every guest lane, car ellipses per lane; `spectator-snapshot` seeds the full-building baseline; `player-moved` re-adds displays for unknown ids; harness scenario `client:spectator_view` (wrong accusation fires the accuser → overview visible on the fired page, live page unchanged).
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/harness/spectator.spec.ts` (new)
**Depends on**: T3, T4
**Reuses**: evidence/card DOM layers (AD-018 doors), elevator presenter, harness hold-E choreography (justice.spec.ts)
**Requirement**: REND-12, REND-13, REND-14, REND-15, REND-16

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] `client:spectator_view` passes: fired page renders rectangles on multiple floor lanes (a player on another floor visible), all door lanes present; live page's scene children remain exactly one rectangle per player on the own floor; both pages still receive firing toasts
- [ ] Scene-children contract holds in spectator mode (one labeled Rectangle per player, one Ellipse per car — lanes are Graphics/DOM)
- [ ] `pnpm typecheck` + biome clean; `pnpm test:client` green

**Tests**: e2e (harness)
**Gate**: build

**Commit**: `feat(client): give fired players the full-building spectator overview`

---

### T8: Client reconnect retry + close-out

**What**: `Connection` exposes `reconnectionToken` + `static reconnect(token, cb)`; sessionStorage persistence (refresh after each reconnect); App reconnect retry loop (1 s interval within the window) with a reconnecting lost view; on success swap connection and restore via `round-resumed`. Then: AD-021 (results phase) + handoff in STATE.md, spec traceability to Done, roadmap gate column check.
**Where**: `apps/client/src/net/connection.ts`, `apps/client/src/app.ts`, `apps/client/src/state.ts` (lost view text), `.specs/STATE.md`, `.specs/features/round-end/spec.md`, `roadmap.md`
**Depends on**: T5, T7
**Reuses**: Connection.create/open wiring, debug.ts dev-only conventions (no new prod hooks)
**Requirement**: REND-23, REND-19 (client half)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Unit: token stored on connect, retried on disconnect, cleared/refreshed appropriately; the retry loop is time-bounded (no infinite retry)
- [ ] Lost view shows the reconnecting state; production path with no seat fails cleanly to the lost view
- [ ] Full ladder green: `pnpm typecheck && pnpm biome check . && pnpm test:sim && pnpm test:client`
- [ ] STATE.md carries the cycle handoff + AD-021; spec traceability updated to Done

**Tests**: unit (connection/retry) + full gates
**Gate**: build

**Commit**: `feat(client): auto-reconnect into a held seat with the resumed round clock`
