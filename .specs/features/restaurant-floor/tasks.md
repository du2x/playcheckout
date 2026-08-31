# Restaurant Floor Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/restaurant-floor/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (gate ladder), `vitest.config.ts` (project order = CI contract), `.opencode/skills/turnover-gates/SKILL.md`, `.opencode/skills/turnover-sim-harness/SKILL.md`, `.opencode/skills/turnover-client-harness/SKILL.md`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| shared layout/tuning | unit | Re-pinned floors + constants; room predicates floor-agnostic | `packages/shared/src/layout.test.ts` | `pnpm vitest run packages/shared` |
| sim guests (dining) | unit (scenario) | 1:1 to REST-07..13 + listed edge cases | `packages/sim/src/guests.test.ts` | `pnpm vitest run packages/sim/src/guests.test.ts` |
| sim movement (5 floors) | unit | Re-pinned ride timing; mezzanine call/press/ride paths | `packages/sim/src/movement.test.ts` | `pnpm vitest run packages/sim/src/movement.test.ts` |
| server room routing | unit | Spectator/mezzanine floor enumeration | `apps/server/src/rooms/*.test.ts` | `pnpm vitest run apps/server` |
| client view + harness | e2e (playwright) | `client:restaurant` scenario + re-pinned floor constants | `apps/client/harness/*.spec.ts` | `pnpm test:client` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After shared/sim tasks | `pnpm typecheck && pnpm lint && pnpm vitest run packages/shared packages/sim` |
| Full | After client/server tasks | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

### Phase 1: Shared contract + sim core

```
T1 → T2 → T3
```

### Phase 2: Server + client

```
T3 → T4
T3 → T5
T5 → T6
```

### Phase 3: Docs + close-out

```
T6 → T8
T7 → T8
```

---

## Task Breakdown

### T1: Mezzanine floor in the shared layout — ✅ DONE

**What**: Add `'mezzanine'` between `lobby` and `floor1` in `FLOOR_IDS`; re-pin `layout.test.ts` to the 5-floor building; verify room predicates stay guest-floor bound. ALSO (pulled forward from T3): the mechanical movement.test ride-timing re-pins — the layout widening shifts every lobby↔floorN leg by one stride, so T1's quick gate cannot pass without them.
**Where**: `packages/shared/src/layout.ts`, `packages/shared/src/layout.test.ts`
**Depends on**: None
**Reuses**: existing `FLOOR_IDS`-derived types/enums
**Requirement**: REST-01, REST-06

**Done when**:

- [ ] `FLOOR_IDS = ['lobby', 'mezzanine', 'floor1', 'floor2', 'floor3']`
- [ ] `layout.test.ts` pins 5 floors and `FLOOR_IDS.length` ordering
- [ ] Quick gate passes

**Tests**: unit (layout.test re-pin)
**Gate**: quick

**Commit**: `feat(shared): add the mezzanine floor to the building layout`

---

### T2: Dining tuning constants + test seam — ✅ DONE

**What**: Rename `GUEST_HOLD_START_TILES` → `GUEST_RESTAURANT_START_TILES` (value 18); add `GUEST_DINING_MIN_SECONDS = 15` / `GUEST_DINING_MAX_SECONDS = 30`; extend `GuestTiming` with `diningScale`.
**Where**: `packages/shared/src/tuning.ts`, `packages/sim/src/guests.ts` (type only), `apps/server/src/rooms/TurnoverRoom.ts` (`testGuestTiming` wiring)
**Depends on**: T1
**Reuses**: AD-004 `GuestTiming` seam pattern
**Requirement**: REST-07, REST-08

**Done when**:

- [ ] Constants exist; no `GUEST_HOLD_START_TILES` references remain
- [ ] `GuestTiming.diningScale` compiled and wired through the room env seam
- [ ] Quick gate passes

**Tests**: unit (existing suites still green — compile-level here)
**Gate**: quick

**Commit**: `feat(shared): add the restaurant dining dials (3.C, AD-035)`

---

### T3: Guest dining phase in the sim — ✅ DONE

**What**: Rename phase `'waiting'`→`'dining'` (internal), `holding`→dining slots on the mezzanine, seeded dwell drawn at each dining placement (`diningDwellOf` query), wrong-delivery return to dining, check-in placement on the mezzanine; update `guests.test.ts` + `movement.test.ts` pins.
**Where**: `packages/sim/src/guests.ts`, `packages/sim/src/guests.test.ts` (movement.test re-pins pulled forward into T1)
**Depends on**: T2
**Reuses**: re-place pattern, Rng stream, `retargetOnRest`
**Requirement**: REST-02, REST-04, REST-05, REST-07..13

**Done when**:

- [ ] `sim:dining` scenarios pass: check-in→mezzanine slot; rest→immediate departure; dwell-elapsed→stays (deterministic draw via `diningDwellOf`); wrong-delivery→returns to dining; mezzanine `place` ignored; carrier-loss→front re-queue
- [ ] Full sim suite green (no deletions; ride-timing pins re-pinned to 2 strides)
- [ ] Quick gate passes

**Tests**: unit (scenario) — coverage matrix row "sim guests (dining)"
**Gate**: quick

**Commit**: `feat(sim): guests dine on the mezzanine with a seeded dwell (3.C)`

---

### T4: Server mezzanine routing seams — ✅ DONE

**What**: Add `mezzanine` to the spectator overview floor enumeration; audit snapshot routing stays per-floor generic; server room tests cover a mezzanine snapshot/overview row.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts`, `apps/server/src/rooms/TurnoverRoom.test.ts`
**Depends on**: T3
**Reuses**: AD-009 per-floor routing (already generic)
**Requirement**: REST-03, REST-17 (server half)

**Done when**:

- [ ] Spectator overview lists 5 floors
- [ ] Room tests assert a guest/player position on the mezzanine routes correctly
- [ ] Full gate (`test:sim` incl. server shell) passes

**Tests**: unit (server)
**Gate**: full

**Commit**: `feat(server): serve the mezzanine in snapshots and the spectator overview`

---

### T5: Client mezzanine view + rider affordances — ✅ DONE

**What**: `SPECTATOR_LANE_Y.mezzanine`, panels + hall-call lights on the mezzanine view, `KeyM` in-car press + view switch, car screen `M` button/label/order, HUD+lobby `M` indicators, `floorLabel('mezzanine') = 'M'`; update `carScreen.test.ts` + harness floor constants.
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/src/ui/{carScreen,roundHud,lobbyView}.ts`, `apps/client/harness/{justice.spec.ts,playwright.config.ts}` (3.C re-pins: deterministic approach walk replacing a drift-prone fixed sleep; the missing keyup after cancel; shift seam 30→60 s for the doubled lobby ride legs)
**Depends on**: T3
**Reuses**: existing lane/panel/chip paths
**Requirement**: REST-14, REST-15, REST-17 (client half)

**Done when**:

- [ ] Mezzanine view renders lane + panels + lights, no door frames
- [ ] `M` press sends `elevator:press {floor:'mezzanine'}` and lights in chip/car screen
- [ ] Client unit tests + existing harness specs green

**Tests**: e2e constants re-pin + client unit (`carScreen.test.ts`)
**Gate**: full

**Commit**: `feat(client): mezzanine floor view with M-key rider affordances`

---

### T6: Dining cue + client:restaurant harness scenario

**What**: Gray-box dining chip on mezzanine guest markers; new `apps/client/harness/restaurant.spec.ts` with `client:restaurant` (ride to mezzanine, view asserts, checked-in guest dining chip).
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/harness/restaurant.spec.ts`
**Depends on**: T5
**Reuses**: harness press-retry + guest-scale patterns
**Requirement**: REST-16

**Done when**:

- [ ] `client:restaurant` passes twice consecutively
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

**Commit**: `feat(client): dining cue and the client:restaurant gate scenario`

---

### T7: Art manifest entries

**What**: Add mezzanine floor band, restaurant furniture and suitcase sheet entries to `docs/art/alternative/asset-manifest.json` (AD-029 production contract).
**Where**: `docs/art/alternative/asset-manifest.json`
**Depends on**: None (independent; slotted here so it merges with the client slice)
**Reuses**: manifest schema from 3.A entries
**Requirement**: REST-18

**Done when**:

- [ ] Three entries present with sizes/pivots consistent with the AD-029 brief
- [ ] Build gate (no code) — lint passes

**Tests**: none (config/manifest layer — matrix row n/a)
**Gate**: build

**Commit**: `docs(art): add mezzanine, restaurant and suitcase manifest entries (3.C)`

---

### T8: Docs + STATE.md handoff

**What**: Update `CONTEXT.md` (mezzanine/restaurant vocabulary), `docs/elevator-behavior.md` (5 stops), record AD-035 (layout widening, dining dials, autonomous defaults), close the cycle handoff.
**Where**: `CONTEXT.md`, `docs/elevator-behavior.md`, `.specs/STATE.md`, roadmap untouched
**Depends on**: T6, T7
**Reuses**: handoff format from 3.B
**Requirement**: traceability close-out

**Done when**:

- [ ] AD-035 recorded; handoff updated
- [ ] Full gate green

**Tests**: none (docs)
**Gate**: build

**Commit**: `docs(specs): record AD-035 and close the restaurant-floor cycle`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 → T2 → T3
Phase 2:  T3 → T4
          T3 → T5
          T5 → T6
Phase 3:  T6 → T8
          T7 → T8
```

Execution is strictly sequential. Total: 8 tasks → single-batch inline execution is NOT used (8 > 8? no — 8 ≤ ~8, borderline); per the sub-agent rule the phase structure is a tight dependency chain and each task gate-runs, so execution stays inline in the main window for coherence with the gate evidence requirements.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | 1 file + its test | ✅ Granular |
| T2 | 3 files, one contract | ✅ Granular (cohesive type+seam) |
| T3 | sim dining core + its suites | ✅ Granular (one component) |
| T4 | server routing seam | ✅ Granular |
| T5 | client view affordances | ✅ Granular (cohesive floor-view slice) |
| T6 | cue + harness scenario | ✅ Granular |
| T7 | manifest entries | ✅ Granular |
| T8 | docs + handoff | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (body) | Diagram Shows | Status |
| ---- | ----------------- | ------------- | ------ |
| T1 | None | — | ✅ |
| T2 | T1 | T1→T2 | ✅ |
| T3 | T2 | T2→T3 | ✅ |
| T4 | T3 | T3→T4 | ✅ |
| T5 | T3 | T3→T5 | ✅ |
| T6 | T5 | T5→T6 | ✅ |
| T7 | None | — | ✅ |
| T8 | T6, T7 | T6→T8, T7→T8 | ✅ |

## Test Co-location Validation

| Task | Code Layer | Matrix Requires | Task Says | Status |
| ---- | ---------- | --------------- | --------- | ------ |
| T1 | shared layout | unit | unit re-pin | ✅ |
| T2 | tuning + seam | unit (compile) | unit | ✅ |
| T3 | sim guests | unit scenario | unit | ✅ |
| T4 | server room | unit | unit | ✅ |
| T5 | client view | e2e + unit | e2e constants + unit | ✅ |
| T6 | harness | e2e | e2e | ✅ |
| T7 | manifest | none | none | ✅ |
| T8 | docs | none | none | ✅ |
