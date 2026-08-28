# Protocol Registry Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/protocol-registry/design.md`
**Status**: Approved

**Wire-flip note (big-bang, user-accepted in spec grilling Q5a):** the migration is
behavior-atomic but the flip spans T2 (server half: server starts sending envelopes)
and T4 (client half: client starts unwrapping them). Gate 3 is green at T1, red
during T2–T3 (old client cannot decode enveloped payloads; CI runs on push only, no
push happens), and green again from T4 onward. This is recorded here so the Verifier
does not misread the T2/T3 gate evidence as a regression.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (gate ladder), `roadmap.md` (gate scenarios), root `vitest.config.ts` (project list), `apps/client/harness/playwright.config.ts` (gate 3 harness), `.github/workflows/ci.yml` (CI contract).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Shared protocol catalog (`packages/shared/src/protocol`) | unit (vitest) | 1:1 to spec REG-01..04; payload-shape asserts like existing `messages.test.ts` | `packages/shared/src/**/*.test.ts` | `pnpm test:sim` (root vitest projects) |
| Server transport (`apps/server/src`) | integration (vitest, real server + SDK clients) | Every gate scenario in the spec: registry walk, per-connection seq, self-policy privacy, buzzer continuity, bypass denylist | `apps/server/src/**/*.test.ts` | `pnpm test:sim` |
| Client view/net modules (`apps/client/src`) | unit (vitest) for pure reducer/mappers; e2e for connection+app wiring (headless Chromium, existing scenarios serve unmodified) | Reducer/mapper branches 1:1 to spec; wiring proven by `client:lobby_join` + `client:round_start` unmodified | `apps/client/src/**/*.test.ts`, `apps/client/harness/*.spec.ts` | `pnpm test:sim` / `pnpm test:client` |
| Client gap recovery | e2e (new harness scenario) | `client:envelope_gap`: gap → recorded → leave → rejoin → fresh snapshot, seq restart | `apps/client/harness/envelope.spec.ts` | `pnpm test:client` |
| Docs / agent skills | none | Build gate only (lint) | `.opencode/skills/**`, `CONTEXT.md` | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks touching only pure/shared/client-unit layers | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Full | After tasks touching the live wire or harness | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |
| Build | After docs-only tasks | `pnpm typecheck && pnpm lint` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Shared catalog + server router

```
T1 → T2
```

### Phase 2: Client dispatch + harness + audit docs

```
T3 → T4 → T5 → T6
```

---

## Task Breakdown

### T1: Shared protocol registry + SimEvent relocation ✅ Done

**What**: Create `PROTOCOL_REGISTRY` (five rows: payload type token + recipient policy + `fromSim` projections for the three sim events), move the `SimEvent` union to `packages/shared/src/protocol/simEvents.ts` (sim re-exports), strip in-payload `type` literals from `RoundStarted`/`RoleDealt`/`RoundBuzzer`/`IntentError`, delete `envelope.ts`, `BroadcastGameEvent`/`PrivateGameEvent`, and update `messages.test.ts` to the type-less payload shapes. Add the registry unit walk test (five expected keys, valid policies, room-originated rows have `fromSim: undefined`).
**Where**: `packages/shared/src/protocol/registry.ts` (new; edits in `messages.ts`, `protocol/index.ts`, `simEvents.ts`, `packages/sim/src/events.ts`, `messages.test.ts`)
**Depends on**: None
**Reuses**: payload interfaces in `packages/shared/src/protocol/messages.ts`; denylist-test file-walk pattern from `packages/sim/src/literals.test.ts` (for the walk test's structure)
**Requirement**: REG-01, REG-02, REG-03, REG-04

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol` (before touching any message type)

**Done when**:

- [ ] `PROTOCOL_REGISTRY` typed `as const satisfies { [K in RegistryKey]: Entry<K> } & { [K in SimEvent['type']]: unknown }` per design; deleting a sim event key from the rows is a compile error
- [ ] `packages/shared/src/protocol/envelope.ts` and the two unions are gone; nothing imports them
- [ ] `packages/sim` compiles unchanged via re-export; wire behavior is untouched (old server sends still work)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim` (all pre-existing tests green)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): single protocol registry with recipient policies`

---

### T2: Per-room Router with envelope stamping (server wire flip) ✅ Done

**What**: Implement the Router (`route`, policy-typed `toSelf`/`toAll`, `forget`) as the only module allowed to call `client.send`; rewire `TurnoverRoom` (join/leave snapshots, intent errors, `advance()` routing, `router.forget` on leave) and delete `route()`/`sendTo`. Add the `server:protocol_registry` describe: live-room envelope assertions (shape `{seq,time,payload}`, no in-payload `type`, per-connection monotonic seq from 1, own seq per recipient on broadcast, `role:dealt` reaches only the named player, seq continuity across buzzer + re-deal), a Router unit test with fake clients, and the bypass denylist test (no raw `.send(`/`.broadcast(` outside `router.ts` in `apps/server/src`). Mechanically update `TurnoverRoom.test.ts` wire decoding (unwrap envelopes; drop the `type`-key assertions) - scenario names and semantics unmodified.
**Where**: `apps/server/src/rooms/router.ts` (new; edits in `TurnoverRoom.ts`, `TurnoverRoom.test.ts`, new `router.test.ts`)
**Depends on**: T1
**Reuses**: `collectAll`/`collect` helpers in `TurnoverRoom.test.ts`; denylist pattern from `packages/sim/src/literals.test.ts`
**Requirement**: REG-05, REG-06, REG-07, REG-08, REG-09, REG-10, REG-18, REG-20

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`, `turnover-sim-harness`

**Done when**:

- [ ] No per-type switch in the routing path; `role:dealt` delivery is by declared policy, not a hand-written case
- [ ] Every server→client message carries `{ seq, time, payload }`; first envelope of a connection has `seq: 1`; broadcast stamps each connection's own next seq
- [ ] Bypass denylist test passes (only `router.ts` sends)
- [ ] `server:protocol_registry` passes; pre-existing `server:lobby_join` and `sim:role_deal` (server half) pass with updated wire decoding only
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim` (gate 3 is red until T4 by design - see wire-flip note)

**Tests**: integration
**Gate**: quick

**Commit**: `feat(server): generic router stamps seq/time envelopes per registry policy`

---

### T3: Client reducer + mapper table ✅ Done

**What**: Extend the view reducer (`roundPlayerIds` in `ViewState`; `round-started` action carries `playerIds`, reducer stamps `roundStartedAt: Date.now()` itself; `buzzer` clears them) and create the exhaustive mapper table `MAPPERS: { [K in RegistryKey]: (payload: RegistryPayload<K>) => ViewAction[] }` in `apps/client/src/net/mappers.ts`. Update `state.test.ts` to the new action shape.
**Where**: `apps/client/src/net/mappers.ts` (new; edits in `state.ts`, `state.test.ts`)
**Depends on**: T1
**Reuses**: existing reducer structure and test idioms in `apps/client/src/state.test.ts`
**Requirement**: REG-11, REG-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Every registry key has a mapper; a key without one fails `pnpm typecheck`
- [ ] Mappers are pure `payload → ViewAction[]`; no DOM/Phaser/network access
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(client): exhaustive payload-to-action mapper table and round state`

---

### T4: Generic client dispatch + seq guardian (client wire flip)

**What**: Rewrite `connection.ts` around one `onMessage('*')` handler: unwrap the envelope, verify seq continuity (per-connection, expected from 0), record every message with `seq`/`time` in the dev hook, on gap record it and `room.leave()` (existing connection-loss path), else dispatch `MAPPERS[wireName]` actions via new `onActions` callback; delete the `ServerMessage` union and per-type handlers. Extend `debug.ts` (events carry `seq`/`time`; `gaps` array; `registerGapProbe`; dev-only `forceGap()`; prod paths stay no-op). Rewrite `app.ts`: dispatch actions from `onActions`, replace the message switch with view-transition scene sync (`syncScenes`: entering round view starts `Round` with roster-derived players, leaving stops it).
**Where**: `apps/client/src/net/connection.ts` (edits in `app.ts`, `debug.ts`)
**Depends on**: T2, T3
**Reuses**: existing `Connection.create/open/sendStart/leave` API; connection-loss reducer path; `check-prod-strip.mjs` invariant
**Requirement**: REG-11, REG-13, REG-14, REG-15

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] No per-type `onMessage` handlers or `ServerMessage` union remain; dispatch is generic over the registry
- [ ] `client:lobby_join` and `client:round_start` pass unmodified against the new dispatcher (hook events still expose `type` + `payload` with payload = unwrapped message)
- [ ] Prod strip check still passes (no `__TURNOVER__` literal in the production bundle)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client`

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): generic envelope dispatch with per-connection seq guard`

---

### T5: Harness scenario `client:envelope_gap`

**What**: Add `apps/client/harness/envelope.spec.ts`: force a gap via `__TURNOVER__.forceGap()` on a joined guest page, trigger a server message (third player joins), assert the gap is recorded in the hook and the page reaches the connection-lost view; then rejoin fresh and assert the first snapshot of the new connection arrives with `seq: 1`.
**Where**: `apps/client/harness/envelope.spec.ts` (new)
**Depends on**: T4
**Reuses**: `join`/`createRoom` helpers and context lifecycle idioms from `lobby.spec.ts`
**Requirement**: REG-16, REG-17

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Gap recorded in `__TURNOVER__.gaps` with expected/actual
- [ ] Leave happens automatically (no manual interaction) and the lost view appears
- [ ] After rejoin, `seq` tracking restarts (first envelope `seq: 1`) and a fresh lobby snapshot renders
- [ ] Gate check passes: `pnpm test:client` (all scenarios incl. the new one)

**Tests**: e2e
**Gate**: full

**Commit**: `test(client): envelope gap forces rejoin through the connection-loss path`

---

### T6: Retire the grep audit — protocol skill rule 5

**What**: Update the `turnover-protocol` skill: rule 5 now names `PROTOCOL_REGISTRY.recipients` in `packages/shared/src/protocol/registry.ts` as the audit surface and retires the grep convention (grep survives only as the Router bypass denylist test); conventions section notes the envelope `{ seq, time, payload }` and wire-name-as-type-tag.
**Where**: `.opencode/skills/turnover-protocol/SKILL.md`
**Depends on**: T2, T4, T5
**Reuses**: existing skill structure
**Requirement**: REG-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Rule 5 cites the registry as the audit surface; no instruction tells reviewers to grep sends against comments
- [ ] Gate check passes: `pnpm typecheck && pnpm lint`

**Tests**: none
**Gate**: build

**Commit**: `docs(protocol): audit recipient rules via the registry, not grep`

---

## Phase Execution Map

```
T1 → T2 → T6
T1 → T3 → T4 → T5 → T6
     T2 → T4
     T4 → T6
```

Edges: T1→T2, T2→T6, T1→T3, T3→T4, T2→T4, T4→T5, T5→T6, T4→T6. Phase 2 execution order: T3, T4, T5, T6.

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order. Six tasks fit one batch → inline execution, no sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: shared registry + sim relocation | one module (cohesive catalog) | ✅ Granular |
| T2: router + room rewiring + tests | one module + its consumer | ✅ Granular |
| T3: reducer + mapper table | two pure modules, one concept (view inputs) | ✅ Granular |
| T4: connection + app + debug rewrite | one cohesive wire-consumer change | ✅ Granular |
| T5: gap harness scenario | one file | ✅ Granular |
| T6: skill rule 5 | one file | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T3 (Phase 2 head, follows Phase 1) | ✅ Match |
| T4 | T2, T3 | Phase 1 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T2, T4, T5 | T2→T6, T4→T6, T5→T6 edges | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | shared protocol catalog | unit | unit | ✅ OK |
| T2 | server transport | integration | integration | ✅ OK |
| T3 | client view/net pure modules | unit | unit | ✅ OK |
| T4 | client connection+app wiring | e2e | e2e | ✅ OK |
| T5 | client gap recovery | e2e | e2e | ✅ OK |
| T6 | docs/skills | none | none | ✅ OK |
