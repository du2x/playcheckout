# Evidence Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/evidence/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (gate ladder), root `package.json` scripts, `packages/sim/vitest.config.ts`, `apps/server/vitest.config.ts`, existing suite style in `work.test.ts` / `router.test.ts` / `TurnoverRoom.test.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Sim domain (work channels, evidence state) | unit | All branches; 1:1 to spec ACs; every listed edge case (window math, cancel/restart legs, emission exclusivity) | `packages/sim/src/*.test.ts` | `pnpm test:sim` |
| Shared protocol (registry, payloads, policies) | unit | Every new registry row: payload projection + policy membership; pinned maps updated | `packages/shared/src/**/*.test.ts` | `pnpm test:sim` |
| Server routing (Router policies, ViewContext, room e2e) | unit + integration | Earshot delivery set per boundary; snapshot cards e2e via room harness | `apps/server/src/**/*.test.ts` | `pnpm test:sim` |
| Client view reducer (evidenceSession) | unit | Reducer transitions 1:1 to new messages | `apps/client/src/*.test.ts` | `pnpm test:sim` |
| Client harness (browser slice) | e2e | `client:evidence_cues`: card glyph + door-open + rustle cue in a real browser | `apps/client/harness/*.spec.ts` | `pnpm test:client` |
| Docs / state artifacts | none | - (build gate only) | `.specs/`, `roadmap.md` | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Full | After tasks with e2e/harness tests | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Protocol + sim core

```
T1 → T2 → T3
```

### Phase 2: Server routing + snapshots

```
T4 → T5
```

### Phase 3: Client slice + closeout

```
T6 → T7 → T8
```

### Full dependency edges (canonical)

```
T1 → T2 → T3
T1 → T4 → T5
T1 → T6
T2 → T5
T5 → T7
T6 → T7 → T8
```

---

## Task Breakdown

### T1: Protocol — evidence events, payloads, registry rows, earshot policy — ✅ done

**What**: Add the four `SimEvent` variants (`room:carded`, `room:settled`, `room:rustle`, `room:entered`) with payload interfaces in `messages.ts`; add 4 registry rows (`carded`/`entered` → `'sameFloor'`, `settled` → `'occupants'`, `rustle` → new `'earshot'` policy member); add optional `room?: RoomIndex` to `EventVisibility`; update the pinned policy map in `registry.test.ts` and add projection tests for each new row.
**Where**: `packages/shared/src/protocol/simEvents.ts`, `messages.ts`, `registry.ts`, `registry.test.ts`
**Depends on**: None
**Reuses**: Existing row shapes (`room:prepped`/`room:trashed` projections, `sameFloor`/`occupants` entries)
**Requirement**: EVID-05, EVID-15

**Done when**:

- [ ] `RecipientPolicy` includes `'earshot'`; the registry compiles `satisfies` (an undeclared sim event still fails compilation)
- [ ] Each new row's `fromSim` projection asserted (payload exactly per design; `self`/`visibility` correct)
- [ ] Pinned policy map updated; `pnpm test:sim` green

**Tests**: unit
**Gate**: quick

---

### T2: Sim — cards + freshness state machine — ✅ done

**What**: Extend `WorkChannels` with `elapsedTicks`, `carded: Set<string>`, `settleAt: Map<string, number>`; hang a card + emit `room:carded` on every `room:prepped` transition (idempotent, fake touches nothing); on `room:trashed` set `settleAt = T + FRESHNESS_WINDOW_SECONDS × TICK_HZ`; prep completion deletes the deadline; settle-check (after completions, before observation) emits `room:settled` (occupants routing) on the exact boundary tick; re-trash overwrites the deadline. Add `cardedOn(floor)` + `RoundSim.cardedOn` delegate.
**Where**: `packages/sim/src/work.ts`, `roundSim.ts`, `work.test.ts`
**Depends on**: T1
**Reuses**: Completion loop `work.ts:140-165`, `roomKey` helper, WORK-13 buzzer precedent
**Requirement**: EVID-01, EVID-02, EVID-03, EVID-06, EVID-07, EVID-08, EVID-09, EVID-10, EVID-11

**Done when**:

- [ ] `sim:door_card` describe: prep hangs card (event + query), fake hangs nothing, re-trash keeps card, payload is exactly `{floor, room}`
- [ ] `sim:freshness` describe: exact 1500-tick window (`trashed` throughout, `settled` at boundary), prep-cancel leg, re-trash restart leg, buzzer silence leg
- [ ] `pnpm test:sim` green, no existing assertions weakened

**Tests**: unit
**Gate**: quick

---

### T3: Sim — rustle + door-open emissions — ✅ done

**What**: Emit `room:rustle {floor, room}` exactly when a `room:trashed` transition completes (never for fake/cancelled/prep completions); emit `room:entered {playerId, floor, room}` in the observation loop on every segment ENTRY (key change to a non-null room key, pass-through included) alongside the existing `room:observed`. Write `sim:rustle` (emission exclusivity legs) and `sim:door_open_cue` (entry/exit/stillness legs, two entrants same tick, entrant also gets `room:observed`) describes.
**Where**: `packages/sim/src/work.ts`, `work.test.ts`
**Depends on**: T2
**Reuses**: Transition points from T2; observation loop `work.ts:167-187`
**Requirement**: EVID-12 (emission half), EVID-14, EVID-16, EVID-17, EVID-18

**Done when**:

- [ ] Rustle fires once per trash transition; zero for fake/cancel/prep legs
- [ ] `room:entered` fires per entry incl. pass-through; silent on exit/stop; stable same-tick order
- [ ] `pnpm test:sim` green

**Tests**: unit
**Gate**: quick

---

### T4: Server — ViewContext.x + earshot delivery — ✅ done

**What**: Add `x: number | null` (integer millitiles) to `ViewContext` and to every `movement.viewOf` return shape (riders → null); add the `'earshot'` dispatch branch to the Router: deliver iff same floor AND `dist(vc.x, room segment) ≤ TUNING.RUSTLE_RANGE_TILES × 1000` (nearer edge, inside = 0, inclusive boundary). Update the `toEqual` viewOf assertions in `movement.test.ts` and add router tests: inside room, 2 tiles, exactly 3000 milli (in), 3001 milli (out), other floor, rider, lobby.
**Where**: `apps/server/src/rooms/router.ts`, `packages/sim/src/movement.ts`, `router.test.ts`, `movement.test.ts`
**Depends on**: T1
**Reuses**: `sameFloor` branch shape; `roomSegmentStartMilli`/`EndMilli`
**Requirement**: EVID-12 (delivery half), EVID-13

**Done when**:

- [ ] Earshot delivery set exact at every boundary listed above
- [ ] Riders and other-floor viewers receive nothing
- [ ] `pnpm test:sim` green

**Tests**: unit
**Gate**: quick

---

### T5: Server — snapshot cards + room wiring — ✅ done

**What**: Add `cardedRooms: RoomIndex[]` to `MovementSnapshot`; optional `cardedRooms` param on `snapshotForFloor`/`snapshotFor` (default `[]`); pass `sim.cardedOn(arrivalFloor)` at the AD-017 door-open-exit handler in `TurnoverRoom`. E2E room test: round active, staff preps a room, another player rides the elevator to that floor and exits — their exit snapshot carries that floor's carded rooms and no other floor's.
**Where**: `packages/sim/src/movement.ts`, `roundSim.ts` (query delegate if not in T2), `apps/server/src/rooms/TurnoverRoom.ts`, `TurnoverRoom.test.ts`, `movement.test.ts`
**Depends on**: T2, T4
**Reuses**: AD-017 exit handler `TurnoverRoom.ts:93-108`; snapshot shapes
**Requirement**: EVID-04

**Done when**:

- [ ] Exit snapshot carries the arrival floor's cards only; join/buzzer snapshots unchanged (empty cards)
- [ ] Non-rider snapshot bytes unchanged when param omitted (AD-013 precedent)
- [ ] `pnpm test:sim` green

**Tests**: unit + integration
**Gate**: quick

---

### T6: Client — evidence reducer + gray-box rendering — ✅ done

**What**: Add `evidenceSession.ts` (reduces `room:carded` into an own-floor carded set — idempotent; buffers `room:entered`/`room:rustle` as timestamped cues; `round:started` clears) + its unit tests; wire the four new mapper rows into the generic dispatcher; render in `WorldScene`: card glyph at each carded room's hallway front (own floor), door-open flash + short beep, rustle low-tone beep + front pulse, drained per frame.
**Where**: `apps/client/src/evidenceSession.ts` (new), `evidenceSession.test.ts` (new), `apps/client/src/scenes/WorldScene.ts`, dispatcher mappers
**Depends on**: T1
**Reuses**: AD-006 dispatcher `Record<RegistryKey, Mapper>`; WorldScene own-floor room rendering
**Requirement**: EVID-19 (client half), EVID-16

**Done when**:

- [ ] Reducer unit tests: card add/idempotent, cue buffering, round reset
- [ ] `pnpm test:sim` + `pnpm typecheck` green; no role/interior leak into the client bundle

**Tests**: unit
**Gate**: quick

---

### T7: Harness — client:evidence_cues scenario — ✅ done

**What**: Add `apps/client/harness/evidence.spec.ts`: two clients join a real server (test shift), host starts, one walks in and preps a room; assert via `window.__TURNOVER__` that the OTHER client's hallway view shows the card glyph, receives the door-open cue when the preparer enters, and (second round leg with a saboteur deal) hears/receives the rustle cue on trash. Run the full `pnpm test:client`.
**Where**: `apps/client/harness/evidence.spec.ts`
**Depends on**: T6 (and T5 for snapshot cards)
**Reuses**: Harness conventions (`turnover-client-harness` skill), existing spec patterns
**Requirement**: EVID-19

**Done when**:

- [ ] `client:evidence_cues` passes in `pnpm test:client`
- [ ] No pre-existing scenario regressed (known flakes noted separately)

**Tests**: e2e
**Gate**: full

---

### T8: Closeout — spec traceability + STATE.md handoff — ✅ done (traceability 19/19; handoff written; validate_state pending Verifier)

**What**: Flip all EVID-NN rows to Done in `spec.md`, mark tasks complete, write the STATE.md Handoff section (feature, commits, gates, next step), verify `validate_state.py evidence` passes after the Verifier report lands.
**Where**: `.specs/features/evidence/{spec,tasks}.md`, `.specs/STATE.md`
**Depends on**: T7 (+ Verifier PASS)
**Reuses**: STATE.md handoff format from prior cycles
**Requirement**: all

**Done when**:

- [ ] Traceability 19/19 Done; handoff committed

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 → T2 → T3
Phase 2:  T4 → T5
Phase 3:  T6 → T7 → T8
```

8 tasks total → single batch → executed inline (no sub-agent offer needed).

---

## Task Granularity Check

| Task | Scope | Status |
|---|---|---|
| T1: protocol additions | 1 concern across shared protocol files | ✅ Granular |
| T2: cards + freshness | 1 state machine + its tests | ✅ Granular |
| T3: rustle + entered | 2 emission points, 1 file, cohesive | ✅ Granular |
| T4: ViewContext.x + earshot | 1 policy + its context field | ✅ Granular |
| T5: snapshot cards + wiring | 1 payload extension + 1 caller | ✅ Granular |
| T6: client reducer + render | reducer + scene renderer (cohesive view slice) | ✅ Granular |
| T7: harness scenario | 1 spec file | ✅ Granular |
| T8: closeout | docs only | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
|---|---|---|---|
| T1 | None | phase 1 head | ✅ |
| T2 | T1 | T1 → T2 | ✅ |
| T3 | T2 | T2 → T3 | ✅ |
| T4 | T1 | T4 (phase head) | ✅ |
| T5 | T2, T4 | T4 → T5 (T2 is prior-phase; noted in body) | ✅ |
| T6 | T1 | T6 (phase head; T1 prior-phase) | ✅ |
| T7 | T6 | T6 → T7 | ✅ |
| T8 | T7 | T7 → T8 | ✅ |

No forward-phase dependencies.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
|---|---|---|---|---|
| T1 | shared protocol | unit | unit | ✅ |
| T2 | sim domain | unit | unit | ✅ |
| T3 | sim domain | unit | unit | ✅ |
| T4 | server routing | unit + integration | unit | ✅ (delivery is Router-unit-testable) |
| T5 | server routing + snapshots | unit + integration | unit + integration | ✅ |
| T6 | client reducer | unit | unit | ✅ |
| T7 | client harness | e2e | e2e | ✅ |
| T8 | docs | none | none | ✅ |
