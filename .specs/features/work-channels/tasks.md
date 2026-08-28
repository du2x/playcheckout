# Work Channels Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/work-channels/design.md`
**Status**: Ready

**No wire-flip window this cycle:** all five new message types are additive and the
one amended type (`player:moved`) only narrows delivery for cross-floor viewers —
same-floor harness scenarios (the majority of gate 3) stay green at every commit.
T2 amends the exact tests that pinned global delivery before gate 3 runs.

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Shared layout + protocol (`packages/shared/src`) | unit (vitest) | Segment math (AD-010), payload/intent contracts, literal per-key registry policy walk | `packages/shared/src/**/*.test.ts` | `pnpm test:sim` |
| Pure work sim (`packages/sim/src/work.ts`, `roundSim.ts`) | unit (vitest, scripted-position scenarios) | Every WORK-01..15 sim half: exact tick durations, transitions, cancels, re-trash, fake indistinguishability, bit-for-bit replay | `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Server transport (`apps/server/src`) | integration (vitest, real server + SDK clients) | sameFloor/occupants delivery, work intent rejections, snapshot filtering, buzzer/leave legs, room-shell folds | `apps/server/src/**/*.test.ts` | `pnpm test:sim` |
| Client world/input (`apps/client/src`) | unit (vitest) for mappers/reducer; scene wiring via e2e | Mapper pins 1:1; reducer identity for scene-kind actions | `apps/client/src/**/*.test.ts` | `pnpm test:sim` |
| Client work e2e | e2e (new harness scenario) | `client:work_channels`: walk-in, Space channel, progress bar, room label, outsiders see nothing | `apps/client/harness/work.spec.ts` | `pnpm test:client` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After shared/sim/server tasks | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Full | After client/harness tasks | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

### Phase 1: Protocol + routing + sim

```
T1 → T2
T1 → T4 → T5 (Phase 2 continues)
T3 (independent)
```

### Phase 2: Server + client + harness

```
T5 → T6 → T7
```

---

## Task Breakdown

### T1: Shared layout segments + work protocol ✅ Done

**What**: AD-010 geometry in `layout.ts` (`ROOM_DEPTH_TILES` 4 → 3.5, `ROOM_HALL_START_TILES = 1`, millitile segment helpers, `roomIndexAtMilli`) with updated literal tests. Extend the `SimEvent` union with the five work events (`work:started`, `work:ended`, `room:observed`, `room:prepped`, `room:trashed`); add payloads to `messages.ts`; add `workStartIntentSchema` (`work:start {floor, room}`) to `intents.ts`; extend `IntentError` codes (`round-not-active`, `not-in-room`, `room-not-workable`, `channel-active`); extend `RecipientPolicy` to `'sameFloor' | 'occupants'` and `SimProjection` with optional `visibility`; add the five registry rows (`self` ×3, `occupants` ×2 with `roomKey` visibility) and flip `player:moved` to `'sameFloor'` with `visibility.floor` (AD-009). Fold in protocol-registry N2: a literal per-key policy walk in `registry.test.ts`.
**Where**: `packages/shared/src/layout.ts`, `layout.test.ts`, `protocol/simEvents.ts`, `messages.ts`, `intents.ts`, `registry.ts`, `registry.test.ts`, plus the compile-forced client plumbing (`apps/client/src/state.ts` ViewAction variants + reducer no-ops, `net/mappers.ts` entries — MAPPERS is exhaustive over RegistryKey, so the gate-1 typecheck requires them in the same commit as the rows; scene wiring stays in T6)
**Depends on**: None
**Reuses**: `Entry<K>`/`SimProjection<K>` typing; zod strict intent pattern; FLOOR_IDS
**Requirement**: WORK-01..19 (protocol foundation), AD-009/AD-010

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [ ] `roomIndexAtMilli` exact at boundaries (1_000 in room 1, 999/29_000 outside, last room inclusive end); 8 segments tile [1_000, 29_000]
- [ ] Five rows declared once with correct policies; an undeclared work event is a compile error; literal policy walk asserts every key's exact policy
- [ ] Intent schema strict; wrong floor/room types rejected
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): room segments and work-channel events in the registry`

---

### T2: Router positional policies + sameFloor routing (AD-009 lands) ✅ Done

**What**: Extend `Router` with `setViewContext` (per-connection `{floor, roomKey}` provider) and the `sameFloor`/`occupants` dispatch branches; keep the Router type-agnostic (policy + visibility come from registry rows). Add `MovementSim.snapshotForFloor(floor)` (WORK-18) and switch the room's join/buzzer snapshot sends to it. Wire `TurnoverRoom.setViewContext` from the movement sim (riders ⇒ floor null). Amend the 2.4 tests that pinned global delivery (server `player:moved` broadcast assertions; `registry.test.ts` policy pins) to the AD-009 contract; add Router tests: cross-floor `player:moved` not delivered, rider receives none while in car, snapshot filtered to own floor, occupants-only room events. Fold in protocol-registry N1 (fix the TurnoverRoom.test.ts:412-415 comment misattribution) and N3 (remove unused `RegistryEntry` export).
**Where**: `apps/server/src/rooms/router.ts`, `router.test.ts`, `TurnoverRoom.ts`, `TurnoverRoom.test.ts`, `packages/sim/src/movement.ts` + `movement.test.ts` (snapshotForFloor), `packages/shared/src/protocol/registry.ts` (N3)
**Depends on**: T1
**Reuses**: `liveClients()`/`deliver()`; registry `visibility`
**Requirement**: WORK-17, WORK-18, WORK-19

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [ ] Cross-floor `player:moved` reaches no live viewer; rider gets none in-car; same-floor delivery unchanged
- [ ] `movement:snapshot` for a viewer contains only own-floor players + both cars
- [ ] Bypass denylist test still passes — no send path outside the Router
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: integration + unit
**Gate**: quick

**Commit**: `feat(server): positional recipient policies with own-floor routing`

---

### T3: Movement verifier gap hardening (Gaps 2–4) ✅ Done

**What**: Three direct assertions in the movement suites: (Gap 2 / WORK-20) the decoy-flash `elevator:called` payload equals `{floor, car}` with the targeting car literally asserted; (Gap 3 / WORK-21) a player pinned at a wall with the intent still held emits `[]` until the position can change; (Gap 4 / WORK-22) a player walks on floor1 during an active round and displaces x (MOVE-06 positive half). Re-derives the M3/M5b sensor mutants as killed.
**Where**: `packages/sim/src/movement.test.ts` (edits only)
**Depends on**: None
**Reuses**: existing scripted-intent scenario idioms
**Requirement**: WORK-20, WORK-21, WORK-22

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [ ] All three assertions green; no production code change in this task
- [ ] Gate check passes: `pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `test(sim): pin decoy flash car, pinned-intent silence, and round-phase walking`

---

### T4: WorkChannels — pure work sim inside RoundSim

**What**: Implement `packages/sim/src/work.ts`: 24 rooms init fresh (AD-010 segments), channel start matrix (staff prep 100 ticks on fresh|trashed; saboteur unprep 60 on prepped / fake 100 on fresh|trashed), rejection reasons, walk-out cancel detection against the per-tick positions map (exactly one `work:ended`), completion transitions in channel-start order, fake prep with no transition, silent `leave`, segment-crossing `room:observed`, idle ticks silent, bit-for-bit replay. Integrate into `RoundSim` (own a WorkChannels from the deal; `tick(positions?)` optional map; delegate `startWork`/`leave`; work events join the tick array; buzzer-tick completions allowed, post-buzzer silence). Write `sim:prep`, `sim:unprep`, `sim:fake_prep` describes: exact 100/60-tick durations, transitions + occupant-addressed events, fresh→ and trashed→prepped, re-trash loop, every rejection, concurrent same-room channels, walk-out/leave/buzzer cancel legs, fake indistinguishability (event shape identical to prep minus the transition), ≥100-tick deterministic replay.
**Where**: `packages/sim/src/work.ts` (new), `work.test.ts` (new), `roundSim.ts` + `roundSim.test.ts` (edits), `packages/sim/src/index.ts` (export)
**Depends on**: T1
**Reuses**: `roomIndexAtMilli`/segment millitile helpers; deal map; TICK_HZ/TUNING; scripted-scenario idioms
**Requirement**: WORK-01, 02, 04, 05, 06, 08, 09, 11, 13, 14, 15 (sim halves)

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`

**Done when**:

- [ ] Exact tick math asserted (100/60/100); fake prep changes no state and emits no room transition
- [ ] Walk-out cancels on the exit tick with exactly one `work:ended`; leave and buzzer legs assert silence
- [ ] Scripted sequences replay bit-for-bit across two runs
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): pure work channels with walk-out cancel and fake prep`

---

### T5: Room wiring — work intents, position feed, occupants in vivo

**What**: Wire `TurnoverRoom`: `work:start` zod handler (phase guard → `round-not-active`; `sim.startWork` rejections → error codes 1:1); `advance()` builds the positions map from `movement.positionOf` and passes it to `sim.tick(positions)`; `onLeave` calls `sim?.leave()` mid-round. Add the `server:work_channels` describe: envelope/policy assertions for the five types (work:started/ended/room:observed self; room:prepped/room:trashed occupants-only), staff prep end-to-end over the test seam, rejection payloads, buzzer leg. Fold in room-shell verifier notes in `TurnoverRoom.test.ts`: reject-then-start re-assertion and roster-unchanged-after-name-rejection (LOBBY-05).
**Where**: `apps/server/src/rooms/TurnoverRoom.ts` + `TurnoverRoom.test.ts` (edits)
**Depends on**: T4
**Reuses**: `roomWithFour`, `collectAll`; Router policy-typed sends; AD-004 test seam
**Requirement**: WORK-01..03, 07, 10, 12, 16 (server halves)

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [ ] Occupants-only delivery proven with a player in a different segment of the same floor receiving nothing
- [ ] No new send paths outside the Router (denylist green)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: integration
**Gate**: quick

**Commit**: `feat(server): room feeds positions to the round sim and routes work events`

---

### T6: Client — Space-to-work, progress bar, room label

**What**: Extend `MAPPERS` with the five new messages as scene-kind actions (reducer identity — documented render-state decision) routed to `WorldScene`; add `Connection.sendWorkStart(floor, room)`. `WorldScene`: Space keydown derives the own segment via `roomIndexAtMilli` from predicted x + floor and sends `work:start`; `work:started` shows the DOM progress bar (`#work-progress`) filling over `seconds`; `work:ended` clears it; `room:observed`/`room:prepped`/`room:trashed` update the `#room-state` label while the own rectangle is inside that segment, hidden on segment exit — identical visuals for every channel kind (FR-9). Mapper/reducer unit tests pin the new actions.
**Where**: `apps/client/src/scenes/WorldScene.ts`, `net/mappers.ts`, `net/connection.ts`, `app.ts`, `state.ts` (edits) + `state.test.ts`/mappers tests
**Depends on**: T5
**Reuses**: scene-kind action routing (2.4 movement pipeline); `roomIndexAtMilli`; DOM surgical textContent pattern
**Requirement**: WORK-10 (client indistinguishability), WORK-14/15/16 (label half)

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Scene children unchanged (player Rectangles + car Ellipses; LIGHT-09 stays green)
- [ ] Progress bar and label are DOM; no role/kind ever rendered
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(client): space-to-work channels with progress bar and room label`

---

### T7: Harness scenario `client:work_channels` + first-light folds

**What**: Raise the harness webServer env to `TURNOVER_TEST_SHIFT_SECONDS=30` (AD-004 seam; buzzer scenarios poll, so only wall time grows) and add `apps/client/harness/work.spec.ts`: tabs join, host starts, one tab rides an elevator to a guest floor, walks into a room segment, presses Space — progress bar appears and completes within `seconds` + margin, room label shows the observed state; a tab still in the lobby receives no room-state DOM updates. Fold in first-light client notes: LIGHT-02 unknown-code message, LIGHT-08 "round already active", LIGHT-04 1-char name minimum assertions in the lobby/first-light specs.
**Where**: `apps/client/harness/playwright.config.ts`, `work.spec.ts` (new), `lobby.spec.ts`/`round.spec.ts` (folds)
**Depends on**: T6
**Reuses**: harness helpers, `__TURNOVER__.scene('Round')` reads, elevator-ride choreography from `movement.spec.ts`
**Requirement**: WORK-01..16 (end-to-end player slice), WORK-17 (cross-floor silence in vivo)

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] `client:work_channels` green against the real server; no interior events reach non-occupant tabs
- [ ] Full suite green including the buzzer scenarios at the 30 s seam
- [ ] Gate check passes: `pnpm test:client` (full suite)

**Tests**: e2e
**Gate**: full

**Commit**: `test(client): end-to-end work channels with first-light gap folds`

---

## Phase Execution Map

```
T1 → T2
T1 → T4 → T5 → T6 → T7
T3 (independent)
```

---

## Task Granularity Check

Seven tasks fit one batch → inline execution, no sub-agents.

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: shared layout + protocol | two modules (layout, protocol) | ✅ Granular |
| T2: router policies | one module + its consumers | ✅ Granular |
| T3: gap hardening | tests only, one file | ✅ Granular |
| T4: work sim | one pure module + RoundSim seam | ✅ Granular |
| T5: room wiring | one consumer file + tests | ✅ Granular |
| T6: client scene/input | scene + feeders | ✅ Granular |
| T7: harness scenario | config + one spec | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | None (independent) | side node | ✅ Match |
| T4 | T1 | T1 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | shared layout + protocol | unit | unit | ✅ OK |
| T2 | router + movement snapshot | integration + unit | integration + unit | ✅ OK |
| T3 | movement sim tests | unit | unit | ✅ OK |
| T4 | pure work sim | unit | unit | ✅ OK |
| T5 | server transport | integration | integration | ✅ OK |
| T6 | client scene/wiring | unit | unit | ✅ OK |
| T7 | client work e2e | e2e | e2e | ✅ OK |
