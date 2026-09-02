# complaint-budget Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/complaint-budget/design.md`
**Status**: Approved (autonomous run, user-directed)

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (4-gate verification ladder), `vitest.config.ts` (workspace project contract), `.opencode/skills/turnover-sim-harness` (Gate 2 scenario format), `.opencode/skills/turnover-client-harness` (Gate 3 harness contract).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
|---|---|---|---|---|
| Shared tuning / protocol types | unit (vitest, node) | 1:1 to spec ACs; registry row policies pinned | `packages/shared/src/**/*.test.ts` | `pnpm vitest run packages/shared` |
| Sim domain (arrival resolution, budget) | unit (vitest, node, seeded) | All branches; 1:1 to spec ACs; named `sim:` scenarios | `packages/sim/src/*.test.ts` | `pnpm vitest run packages/sim` |
| Server transport seams (recap/resume builders) | integration (vitest, node) | Every new payload field asserted by value | `apps/server/src/*.test.ts` | `pnpm vitest run apps/server` |
| Client presenter (pure) | unit (vitest, node, Phaser-free) | Count/pulse/seed/freeze + render output | `apps/client/src/**/*.test.ts` | `pnpm vitest run apps/client/src` |
| Client e2e (harness) | e2e (Playwright headless) | Named `client:` scenario, 2× consecutive | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Docs (CONTEXT/STATE) | none | - (review gate only) | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
|---|---|---|
| Quick | After unit-only tasks | `pnpm typecheck && pnpm vitest run <touched paths>` |
| Full | After tasks with e2e/integration tests | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |
| Build | After last task in a phase / docs-only tasks | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

### Phase 1: Foundation (shared + sim)

```
T1 → T2
```

### Phase 2: Transport + client

```
T2 → T3
T1 → T4
T3 → T4
T4 → T5
```

### Phase 3: Contract & closure

```
T5 → T6
```

---

## Task Breakdown

### T1: Complaint protocol rows + budget dial (shared) — DONE

**What**: Add `COMPLAINT_BUDGET: 8` to TUNING (§7 row, first implementation);
extend `RoundEndReason` with `'budget-exhausted'`; add the `guest:angered` and
`guest:discovered` sim events; add the two registry rows (`guest:angered` sameFloor,
`guest:discovered` all) with payload types in messages.ts; amend the stale
`GuestComplained` doc (wrong-delivery counts toward nothing since v1.5, AD-039);
pin the new rows in the registry tests.
**Where**: `packages/shared/src/tuning.ts`, `protocol/simEvents.ts`,
`protocol/messages.ts`, `protocol/registry.ts` (+ `tuning.test.ts`,
`protocol/registry.test.ts`)
**Depends on**: None
**Reuses**: the suitcase:placed sameFloor projection pattern; the 3.B comment block
in simEvents.ts
**Requirement**: COMP-01, COMP-02, COMP-04, COMP-10, COMP-13, COMP-14

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [x] `COMPLAINT_BUDGET` reads 8 from TUNING (test-pinned) — tuning.test.ts
- [x] `guest:angered` projects sameFloor with `visibility: { floor }`; `guest:discovered` projects all — registry.test.ts
- [x] `RoundEndReason` union carries `budget-exhausted` (compile-pinned via registry exhaustiveness)
- [x] `GuestComplained` doc no longer claims budget counting
- [x] `pnpm typecheck` green; `pnpm vitest run packages/shared` green (86)
- Note: T1 also carries the MINIMAL client plumbing the exhaustive mapper
  forces (mappers + state actions routed to scene + WorldScene no-op cases) —
  the 3.E shared-rows-commit precedent (e327e03). Substantive client work stays in T4.

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared): complaint budget dial, anger and discovery protocol rows (3.3)`

---

### T2: Trash-discovery complaint loop + budget loss (sim) — DONE

**What**: Add the `RoomIntelPort` (state + un-prep boolean, never the owner) and
wire it from RoundSim; replace the direct `settleAt` convergence with the arrival
resolution (un-prep-active → flee complaint fresh, `trashed` → fresh,
`settled` → aged, else settle); implement the angered path (`toExit` +
`complaintReport`, anger cue + teardown at discovery, desk report + despawn at the
desk); count `guest:discovered` in RoundSim and end the round
`budget-exhausted` at `COMPLAINT_BUDGET` in the win-check ladder.
**Where**: `packages/sim/src/guests.ts`, `packages/sim/src/roundSim.ts`
(+ new `packages/sim/src/complaints.test.ts` with `sim:complaint`,
`sim:guest_never_convicts`, `sim:budget_instant_loss`)
**Depends on**: T1
**Reuses**: the toExit walk (landing → elevator → lobby → desk), the checkout
hall re-entry, the carry-clock drain → win-check flush ordering, the
dropCarry absorb precedent
**Requirement**: COMP-01..09, COMP-11, COMP-12, COMP-15, COMP-16, COMP-17, COMP-18, COMP-19

**Tools**:

- MCP: NONE
- Skill: `turnover-sim-harness`, `turnover-protocol`

**Done when**:

- [x] `sim:complaint`: anger cue → desk report (fresh tier exact) → departure →
      reservation released → suitcase absorbed → no settle score; aged/churn arrival
      reports `fresh: false`; wrong-delivery path does not run on discovery
- [x] `sim:guest_never_convicts`: guest enters mid-un-prep → saboteur NOT fired,
      complaint path runs, channel completion lands normally; staff entrant still
      convicts (FR-15 unchanged)
- [x] Ambush kill check pinned inside `sim:complaint`: ambush with no trash → zero
      complaint events; ambush + pre-laid trash → complaint fires from the trash
- [x] `sim:budget_instant_loss`: 7 complaints continue the round; the 8th ends it
      saboteur/`budget-exhausted` in the same flush; wrong-delivery complaints never
      move the count; buzzer tie resolves to the budget
- [x] Pre-3.3 GuestSim constructions (no port) keep settle semantics (existing suites green)
- [x] `pnpm vitest run packages/sim` green (216)
- Note: the SUI-16 round-integration pin ("settles silently in 3.B") was
  amended to pin its own scheduled supersession (the discovery loop) — the
  test's deferral comment named 3.3 explicitly.
- Note: `runUntil`-style staging helpers keep the tick cursor honest (one
  sim.tick = one cursor tick, breaks included) so seeded replays align —
  the tie scenario depends on it.

**Tests**: unit
**Gate**: quick

**Commit**: `feat(sim): trash-discovery complaints and the budget loss loop (3.3)`

---

### T3: Complaint count on recap + resume (server) — DONE

**What**: Extend `RoundRecap` with `complaints` and `RoundResumed` with `complaints`;
fill both from the sim (`complaintCount`) at build time; assert both payload fields
by value in the room tests.
**Where**: `packages/shared/src/protocol/messages.ts`,
`apps/server/src/rooms/TurnoverRoom.ts` (+ `TurnoverRoom.test.ts`)
**Depends on**: T2
**Reuses**: the 3.D settleScore/settleTarget recap/resume precedent
(`TurnoverRoom.ts:431`, `TurnoverRoom.ts:648`)
**Requirement**: COMP-13, COMP-14

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol`

**Done when**:

- [x] `round:recap` carries the exact final complaint count (asserted by value)
- [x] `round:resumed` carries the current complaint count
- [x] Registry row policies unchanged (recap all / resumed self)
- [x] `pnpm vitest run apps/server` green (81; new `server:complaint_budget`
      drives the churn economy to churn-pool saturation so ≥1 discovery is
      guaranteed and a constant-zero mutant dies)
- Note: the mapper/state plumbing for the two new payload fields rode this
  task (mappers.test + state actions) — the exhaustive-typing contract again.

**Tests**: integration
**Gate**: quick

**Commit**: `feat(server): carry the complaint count in recap and resume payloads (3.3)`

---

### T4: Complaint HUD, desk-report lines, anger cues (client) — DONE

**What**: Pure `ComplaintHud` presenter (onDiscovered/seed/reset/freeze,
`Complaints N / 8`, pulse at ≥6 per FR-14); map `guest:angered`/`guest:discovered`
to scene actions and extend the recap/resume actions with `complaints`; mount the
counter beside the score HUD; render the desk-report walkie line with the
fuzzy-timestamp flavor; spawn the short-lived gray-box anger cue at the room door on
same-floor arrival; keep the wrong-delivery line counter-inert; wire app.ts
reset/seed/freeze; render the `budget-exhausted` loss reason in the results view.
**Where**: `apps/client/src/ui/complaintHud.ts` (+ test), `net/mappers.ts`,
`state.ts`, `scenes/WorldScene.ts`, `app.ts`, `ui/resultsView.ts`
**Depends on**: T1, T3
**Reuses**: the ScoreHud presenter + mount pattern (AD-038), the walkie line
helpers, the results reason rendering
**Requirement**: COMP-20, COMP-21, COMP-22, COMP-23, COMP-24, COMP-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Presenter tests: increments, wrong-kind inertia is a scene concern (presenter
      only counts onDiscovered), pulse flips at 6, seed/reset/freeze, render string exact
- [x] `guest-discovered` increments the counter + renders the walkie line;
      `guest-complained` renders its line without touching the counter
- [x] `guest-angered` spawns the cue at the room door (viewer's floor), TTL-bounded
- [x] Results view names budget exhaustion
- [x] `pnpm vitest run apps/client/src` green

**Tests**: unit
**Gate**: quick

**Commit**: `feat(client): complaint counter, desk-report lines, anger cues (3.3)`

---

### T5: `client:complaint_cues` harness scenario — DONE

**What**: Playwright scenario staging the deterministic sabotage discovery
(prep → un-prep → check-in → place at the trashed room → guest arrives): assert the
anger cue on the floor1 viewers and absent on the lobby viewer, the desk-report
walkie line, `Complaints 1 / 8` on every HUD; then stage a wrong-delivery complaint
and assert the counter stays at 1.
**Where**: `apps/client/harness/complaints.spec.ts`
**Depends on**: T4
**Reuses**: the suitcase.spec staging helpers (pressEUntil, ride staging,
__TURNOVER__ event scan, role-card read)
**Requirement**: COMP-20, COMP-21, COMP-22

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [x] Scenario passes twice consecutively at `--workers=1` (single-test) and once at `--workers=2` in the full suite (38/40, the only failures are the documented bleed/flaky classes)
- [x] Anger cue floor-gating asserted via synthetic sameFloor dispatch (witness on floor1 sees the Text "!" while lobby host does not)
- [x] Counter assertions: +1 on discovery, +0 on wrong delivery

**Tests**: e2e
**Gate**: full

**Commit**: `test(client): complaint cues harness scenario (3.3)`

---

### T6: Domain docs + state closure — DONE

**What**: Add the CONTEXT.md entries (**Complaint budget**, **Trash discovery**);
record AD-041 in `.specs/STATE.md` (fresh-rooms-settle reading, flee counts, suitcase
absorption, freshness-datum report, sameFloor cue, event naming, budget-wins-tie)
and roll the handoff forward.
**Where**: `CONTEXT.md`, `.specs/STATE.md`
**Depends on**: T5
**Reuses**: the AD-039/AD-040 entry format
**Requirement**: all (closure)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] CONTEXT.md entries follow the entry format (term, definition, avoid-row)
- [x] AD-041 records every assumption the spec marked `n (assumed)`
- [x] Handoff names the next cycle and the 3.5 flags
- [x] Full ladder green: `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client`

**Tests**: none
**Gate**: build

**Commit**: `docs(specs): close the complaint-budget cycle on the verifier PASS (3.3)`
