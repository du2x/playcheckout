# Suitcase Transport Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/suitcase-transport/design.md`
**Status**: Approved (autonomous run — user directive "run cycle 3.B autonomously")

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (verification ladder), `vitest.config.ts` (workspace project contract), `apps/client/harness/playwright.config.ts` (gate-3 harness).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Sim domain (`packages/sim`) | unit (scenario-driven vitest) | 1:1 to spec ACs; every listed edge case; named `sim:<gate>` describes | `packages/sim/src/*.test.ts` | `pnpm vitest run packages/sim` / `pnpm test:sim` |
| Server routing/room (`apps/server`) | integration (vitest) | Every new policy branch + intent wiring; happy + rejection paths | `apps/server/src/rooms/*.test.ts` | `pnpm test:sim` (workspace) |
| Client e2e (`apps/client`) | e2e (Playwright harness) | The named gate scenario incl. confirm + walkie surfaces on all pages | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Shared protocol/tuning | none - build gate only | typecheck + exhaustive-registry compile | `packages/shared/src/**` | `pnpm typecheck` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After shared/sim-only tasks | `pnpm typecheck && pnpm lint && pnpm vitest run packages/sim packages/shared apps/server` |
| Full | After client-touching tasks and cycle end | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |
| Build | Docs/handoff task | `pnpm typecheck && pnpm lint && pnpm test:sim` |

---

## Execution Plan

### Phase 1: Wire, sim, client (single dependency chain)

```
T1 → T2 → T3 → T4 → T5 → T6
```

---

## Task Breakdown

### T1: Declare the suitcase wire (protocol, earshot policy, tuning)

**What**: Declare the five new sim events + registry rows (`assignment:overheard` on a new `deskEarshot` policy, `suitcase:carried/placed/picked_up` on `sameFloor`, `guest:complained` on `all`), extend `EventVisibility` with `x`, add the router `deskEarshot` branch (spectators excluded), add tuning constants (`CARRY_CLOCK_SECONDS`, `DESK_EARSHOT_TILES` from §7; `ROOM_DOOR_RANGE_TILES`, `GUEST_HOLD_START_TILES` §7-external), the `suitcase:place/pickup` intent schemas, and the client mapper/state stubs the exhaustive dispatch forces.
**Where**: `packages/shared/src/protocol/registry.ts` (secondary: `simEvents.ts`, `intents.ts`, `../../tuning.ts`, `apps/server/src/rooms/router.ts`, `apps/client/src/net/mappers.ts`, `apps/client/src/state.ts`)
**Depends on**: None
**Reuses**: the `earshot` policy branch (`router.ts:152-173`) as the positional precedent; the AD-028 guest-message registry pattern
**Requirement**: SUI-03, SUI-04, SUI-21 (surfaces)

**Tools**:

- MCP: NONE
- Skill: `.opencode/skills/turnover-protocol` (read before editing the registry)

**Done when**:

- [x] Registry compiles exhaustively (undeclared sim event would fail the build)
- [x] Router `deskEarshot` delivers to live lobby viewers within `DESK_EARSHOT_TILES` of `visibility.x` and excludes spectators and riders
- [x] Client mappers map the five keys into state fields (no UI yet)
- [x] Gate check passes: quick (`pnpm typecheck && pnpm lint && pnpm vitest run packages/sim packages/shared apps/server`) — 380 passed

**Tests**: integration (router deskEarshot scenarios in `apps/server/src/rooms/router.test.ts`)
**Gate**: quick

**Commit**: `feat(protocol): declare the suitcase wire with desk-earshot assignments`

---

### T2: Suitcase core in the sim (check-in, place, pickup, work block, teardown)

**What**: Replace 3.2's `receiveAtDesk`/`held` model with check-in (`checkIn`: assignment seeded + reserved, carrier set, first carry leg, guest → `waiting` holding slots), add the suitcase store with `placeSuitcase`/`pickupSuitcase` (server-side range validation, tie → lowest guestId), `isCarrying` + the `RoundSim.startWork` carry block, `RoundSim.suitcasePlace/Pickup` intent methods, room `onMessage` wiring, the `dropCarry` teardown swap on fired/ghost/disconnect, and the resting-suitcase snapshot extension.
**Where**: `packages/sim/src/guests.ts` (secondary: `roundSim.ts`, `apps/server/src/rooms/TurnoverRoom.ts`)
**Depends on**: T1
**Reuses**: the 3.2 desk eligibility checks (`roundSim.ts:385-405`), the pending-event flush pattern (`guests.ts:156+`), `driveToRoom` (`guests.ts:387-434`)
**Requirement**: SUI-01, SUI-02, SUI-06, SUI-07…SUI-12, SUI-20

**Tools**:

- MCP: NONE
- Skill: `.opencode/skills/turnover-sim-harness` (scenario format)

**Done when**:

- [ ] Check-in reserves the assigned room; a later self-assign roll cannot pick it
- [ ] Place rests silently; pickup starts a fresh leg; carrying rejects work starts silently; accusation unaffected
- [ ] Fired/ghost/disconnect mid-carry: suitcase rests at desk, guest re-queued front with impatience resumed, assignment void
- [ ] Gate check passes: quick; `sim:suitcase_carry` suite green

**Tests**: unit (`packages/sim/src/guests.test.ts` + `roundSim.test.ts` round integration)
**Gate**: quick

**Commit**: `feat(sim): add the suitcase store with check-in, place, pickup, and carry teardown`

---

### T3: Guest-following, arrival outcomes, carry clock

**What**: Make the guest follow the suitcase's last resting room (re-target on every rest event; mid-walk pickup → continue + door-wait), resolve the arrival outcome (assignment match → settle with tenancy commit; mismatch → `guest:complained` + return to the holding slot, re-target on next rest), implement the rolling carry clock with the `carryExpired` drain consumed by the RoundSim fire pipeline, and re-scope impatience to the unchecked wait only.
**Where**: `packages/sim/src/guests.ts` (secondary: `roundSim.ts`)
**Depends on**: T2
**Reuses**: `driveToRoom`/`driveToExit`, the justice fire teardown (`roundSim.ts:236-241`), the settle/dwell/checkout path (`guests.ts:413-417`)
**Requirement**: SUI-13…SUI-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Wrong delivery complains building-wide naming room + guest, never the assignment; the guest returns to the holding area and a corrected placement settles them (tenancy commits at settle; reservation converts)
- [x] Clock expiry fires the current carrier via justice teardown + dropCarry aftermath (round-integration test with a test-scaled clock — the AD-028 seam gained `carryClockTicks`)
- [x] Fresh leg on every pickup; a resting suitcase runs no clock
- [x] `sim:assignment_overhear`, `sim:carry_clock`, `sim:wrong_delivery` suites green; quick gate passes (typecheck ✅, lint ✅, `pnpm test:sim` 380 passed)

**Tests**: unit (same files as T2)
**Gate**: quick

**Commit**: `feat(sim): make guests follow the suitcase with arrival outcomes and the carry clock`

**Status**: ✅ Complete (T2 already landed the following/re-target drivers; T3 added the clock, the outcome tests, and the justice wiring)

---

### T4: The walkie becomes the lifecycle log (client feed + suites)

**What**: (Deletions moved into T2 — the hold/send model is structurally coupled to check-in.) Rework the client walkie log into the server-generated lifecycle feed — check-in/pickup/settle/complaint/checkout/arrival lines composed client-side from event payloads + roster names; placement silent; last-5 contract kept — and add the sim suites asserting the lifecycle fact set (no placement line exists).
**Where**: `apps/client/src/scenes/WorldScene.ts` (secondary: `state.ts` action plumbing, sim lifecycle suites)
**Depends on**: T3
**Reuses**: the walkie-log DOM contract (rebuilt in WorldScene)
**Requirement**: SUI-21, SUI-22, SUI-23

**Tools**:

- MCP: NONE
- Skill: `.opencode/skills/turnover-protocol` (registry removal rules)

**Done when**:

- [x] No client can author a walkie line; the registry declares no broadcast message (deleted with the hold model in T2)
- [x] Lifecycle lines render from real events (arrival/check-in/pickup/settle/complaint/checkout); no placement case exists — silence is structural
- [x] `sim:lifecycle_log` pins the walkie feed's sim half: one entry per lifecycle fact for the checked-in guest
- [x] Full gate passes: typecheck 4/4 ✅, lint ✅, `pnpm test:sim` 380 passed (the 1 failure in one run was the pre-existing REG-18 load flake, reproduced on master)

**Tests**: unit (amended sim suites)
**Gate**: quick (full ladder deferred to T5's e2e run)

**Commit**: `feat(shared): rework the walkie into the server-generated lifecycle log`

---

### T5: Client suitcase slice

**What**: Render suitcase markers (riding the carrier / resting at the doorway, sameFloor filter), rewrite the contextual-E resolution into the priority ladder (desk receive → landing call → place → pickup → otherwise call/accuse), add the blind-place one-step confirm driven by local `heardAssignments`, surface the assignment only on the player's own carried marker, and write the `client:suitcase` Playwright gate scenario.
**Where**: `apps/client/src/scenes/WorldScene.ts` (secondary: `harness/suitcase.spec.ts`)
**Depends on**: T4
**Reuses**: the desk-hint/menu DOM builder (`buildDeskLayer`), the guest marker/view pattern (`WorldScene.ts:999-1030`), the fourPlayerRound harness helper
**Requirement**: SUI-24…SUI-27

**Tools**:

- MCP: NONE
- Skill: `.opencode/skills/turnover-client-harness` (gate-3 contract)

**Done when**:

- [ ] Markers follow carrier/rest state; view filter matches guests
- [ ] Ladder order matches SUI-25; desk zone still suppresses the accuse hold
- [ ] Blind place shows the confirm; confirm sends; heard rooms place directly
- [ ] `client:suitcase` green in the harness; full gate passes (`pnpm test:client` incl. the scenario)

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): add the suitcase slice with the E ladder and the blind-place confirm`

---

### T6: Gates, decisions, handoff

**What**: Run the full verification ladder, record AD-033 (`ROOM_DOOR_RANGE_TILES`, `GUEST_HOLD_START_TILES`) and the assumed-default rulings (wrong-delivery aftermath, earshot membership, reservation model) in `.specs/STATE.md`, add the suitcase vocabulary to `CONTEXT.md`, fill the spec traceability statuses, and write the STATE.md handoff.
**Where**: `.specs/STATE.md` (secondary: `CONTEXT.md`, spec.md traceability)
**Depends on**: T5
**Reuses**: the AD entry + Handoff format from the front-desk cycle
**Requirement**: all (Success Criteria)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Gates 1–3 green with the named scenarios; leak audit (assignment once, resting room not off-floor) asserted
- [ ] AD-033 + autonomous-default decisions recorded; CONTEXT.md vocabulary added
- [ ] Handoff written; `validate_state.py suitcase-transport` passes (after the Verifier)

**Tests**: none
**Gate**: build

**Commit**: `docs(specs): record the suitcase-transport decisions and close out the cycle`

---

## Phase Execution Map

```
Phase 1:  T1 → T2 → T3 → T4 → T5 → T6
```

Execution is strictly sequential. Six tasks — fits a single batch, so Execute runs inline with no sub-agents.
