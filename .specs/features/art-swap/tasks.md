# Art-Swap Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/art-swap/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (gate ladder: typecheck → test:sim → test:client → human round check; "Do not treat compile output as proof"; `pnpm test:sim` runs vitest over ALL workspace projects incl. client unit tests).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Client scene rendering (WorldScene, ElevatorPresenter) | unit (pure logic) + e2e (Gate 3 harness) | Presenter: unit-test frame/visibility derivation per clock state; Harness: every spec AC 1:1 via `client:art_*` scenarios + amended behavioral scenarios; no scenario loses an assertion | `apps/client/src/scenes/*.test.ts`, `apps/client/harness/*.spec.ts` | `pnpm test:sim` (unit) · `pnpm test:client` (e2e) |
| Protocol/sim/server | none | Untouched by design (rendering-only cycle); existing suites must stay green | — | `pnpm test:sim` (regression only) |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After presenter unit-test changes | `pnpm test:sim && pnpm biome check apps/client/src` |
| Full | After every client swap task | `pnpm typecheck && pnpm test:sim && pnpm test:client` |
| Build | After the last task | Full gate + `pnpm exec biome check apps/client` + manifest/STATE bookkeeping review |

**Port note (session-local, not a repo change)**: `pnpm test:client` binds :2567.
While a colleague's dev server owns that port, run the identical harness via the
disposable config `/tmp/opencode/harness-port.config.ts` (PORT=2568) — same
specs, same assertions. Canonical gate remains `pnpm test:client`.

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Presentation swaps (gate-green at every boundary)

Each task swaps one primitive AND amends exactly the harness specs that count it, in the same commit.

```
T1 → T2 → T3 → T4 → T5
```

### Phase 2: Closure

```
T6
```

---

## Task Breakdown

### T1: Player sprite swap (rectangles → staff-walk sprites)

**What**: Replace player Rectangles with `staff-walk` Sprites (origin bottom-center on the lane), 8-frame walk anim while moving / frame 0 idle, `flipX` facing from own prediction + `player-moved.facing`; delete no behavior; amend `round`/`movement`/`work`/`spectator` count filters to texture keys; add `client:art_players` (sprites render per player, walk plays, idle settles, facing flips, identical texture/anim set for ALL players — role-blind, FR-9; fired removal still removes).
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/src/scenes/BootScene.ts` (walk anim), `apps/client/harness/{round,movement,work,spectator}.spec.ts`, `apps/client/harness/art-players.spec.ts` (new)
**Depends on**: None
**Reuses**: `PlayerDisplay` shape, `update()` lane/visibility logic, `__TURNOVER__.scene()` access
**Requirement**: ART-01, ART-02, ART-03, ART-05, ART-18, ART-19

**Tools**: MCP: filesystem · Skill: NONE

**Done when**:
- [ ] Zero `type === 'Rectangle'` player counts remain in the five harness specs; labels still asserted
- [ ] `client:art_players` green: ≥1 player count, walk/idle/facing/FR-9 assertions
- [ ] Full gate green; `pnpm test:client` count ≥ 29 (amended, none deleted)

**Tests**: e2e (Gate 3) + unit regression
**Gate**: full

---

### T2: Elevator car sprite swap (ellipse → elevator-car, presenter frames)

**What**: Car map value `{ellipse}` → `{sprite}` (48×64 spritesheet, origin center at `laneY+30`); presenter `EllipseLike` → `CarViewLike` with `setFrame` (frame = `doorsOpenAmount > 0 ? 0 : 1`), delete gray-box door Graphics plumbing; BootScene loads `elevator-car` as spritesheet; update `elevatorPresenter.test.ts` (fake car records frames; door-draw assertions → frame assertions); amend `elevator-doors`/`movement` car filters; assert car half of `client:art_elevator` (open frame in dwell, closed before transit, hidden in transit — ELAN semantics unchanged).
**Where**: `apps/client/src/scenes/elevatorPresenter.ts`, `apps/client/src/scenes/elevatorPresenter.test.ts`, `apps/client/src/scenes/WorldScene.ts`, `apps/client/src/scenes/BootScene.ts`, `apps/client/harness/{elevator-doors,movement}.spec.ts`, `apps/client/harness/art-elevator.spec.ts` (new)
**Depends on**: T1
**Reuses**: Presenter phase model/clocks (unchanged), `__TURNOVER__` children filters from T1
**Requirement**: ART-15, ART-16, ART-18, ART-19

**Tools**: MCP: filesystem · Skill: NONE

**Done when**:
- [x] No `Ellipse` car objects remain; presenter unit tests pass with frame assertions (17/17)
- [x] ELAN assertions in `elevator-doors.spec` keep their behavioral semantics (visibility/alpha/y timing)
- [x] Full gate green; Gate 3 31/31

**Tests**: unit (presenter) + e2e (Gate 3)
**Gate**: full

---

### T3: Door sprite swap (DOM frames → door Images, phase-free)

**What**: Delete `#doors-layer` DOM; create `door-closed` Images per room segment per guest floor (Map `floor:room`, origin (0.5,1) at `(roomCenterPx, laneY)`), visibility per `viewFloor`/spectator exactly as DOM frames; remove gray-box state tints (`syncDoors` stops reading `roomStates` for borders); migrate `doors.spec` (`client:doors_pre_round`) to door-Image counts via `__TURNOVER__`; assert the phase-free half of `client:art_doors` (frames render pre-round AND round, lobby floor has none, own-floor-only in live play).
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/harness/doors.spec.ts`, `apps/client/harness/art-doors.spec.ts` (new)
**Depends on**: T2
**Reuses**: door segment geometry (`roomSegmentStartMilli`/`EndMilli`), `syncDoors()` visibility rules
**Requirement**: ART-06, ART-10, ART-11, ART-18, ART-19

**Tools**: MCP: filesystem · Skill: NONE

**Done when**:
- [x] No `#doors-layer` element exists; `doors_pre_round` asserts Image counts (24 total, 0 visible in lobby, 8 visible on floor1)
- [x] No door element encodes room state for an unobserved room (ART-10: texture set is exactly door-closed)
- [x] Full gate green; Gate 3 32/32 incl. new client:art_doors phase-free half; `client:evidence_cues` still green

**Tests**: e2e (Gate 3)
**Gate**: full

---

### T4: Interior rendering (own room + spectator baseline)

**What**: One interior Image slot: while the own player stands inside the observed segment, render the interior (state-mapped texture) behind the open doorway; live `entered` cues flip that room's door to `door-open` for the cue window with NO interior; spectator overview renders `door-open` + interior per baseline `roomStates` on each lane; assert interior half of `client:art_doors` (inside → interior visible + state-mapped, hallway → open door without interior, spectator → building-wide interiors) and amend `spectator.spec` interior expectations (ART-12..14).
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/harness/art-doors.spec.ts`, `apps/client/harness/spectator.spec.ts`
**Depends on**: T3
**Reuses**: `updateRoomLabel()` inside-predicate, `roomStates` seeding, T3 door Image map
**Requirement**: ART-07, ART-08, ART-09, ART-12, ART-13, ART-14

**Tools**: MCP: filesystem · Skill: NONE

**Done when**:
- [x] Live scene holds interior Images for at most the one observed room (ART-14: single named slot, asserted 1 inside / 0 outside / 0 live in spectator scenario)
- [x] State mapping asserted in harness (fresh → room-prepped; textures pinned in art_doors)
- [x] Full gate green; Gate 3 32/32 (1 pre-existing-flaky round_start retry pass); spectator overview asserts 24 interiors vs live 0

**Tests**: e2e (Gate 3)
**Gate**: full

---

### T5: Landing panel flash sprites

**What**: Two `elevator-panel` Images (west/east landings, any viewed floor incl. lobby), frame 1 during a call's flash window on that floor, frame 0 otherwise (decoys flash identically — AD-012/AD-019 data-only semantics); remove the DOM background pulse on `#elevator-panel` (text readouts + hall-call lights stay); amend `elevatorLobby.spec` flash waits (real + decoy) from `backgroundColor` to panel-sprite frame; assert panel half of `client:art_elevator`.
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/harness/elevatorLobby.spec.ts`, `apps/client/harness/art-elevator.spec.ts`
**Depends on**: T4
**Reuses**: `flashPanel()` call site + flash window, T1 texture-filter pattern
**Requirement**: ART-17, ART-18

**Tools**: MCP: filesystem · Skill: NONE

**Done when**:
- [x] No DOM panel background pulse remains; decoy call flips the west panel sprite to frame 1 then back (elevatorLobby, the AD-012 decoy gate)
- [x] `client:elevator_riders`/`elevatorLobby` behavioral assertions (lights, readouts, no-intent-no-flash via idle frame 0) unchanged and green
- [x] Gate: typecheck/biome/Gate-3 32/32 green. NOTE: `pnpm test:sim`'s server project is red from the behavior team's UNCOMMITTED movement.ts/movement.test.ts WIP (facing feature, in-flight) — 37 failures all confined to that file; client/sim/shared projects minus that file pass. Not touched by this cycle (rendering-only).

**Tests**: e2e (Gate 3)
**Gate**: full

---

### T6: Visual-target approval + bookkeeping closure

**What**: In-engine native-scale capture of the swapped presentation (solo ride + 4-player round via harness boot); manifest: swapped assets → `approved` with `in_engine_reviewed: true` and approval owner; STATE.md handoff + AD-020 visual-target approval note; update `spec.md` traceability to Done.
**Where**: `docs/art/asset-manifest.json`, `.specs/STATE.md`, `.specs/features/art-swap/spec.md`, `/tmp` capture only
**Depends on**: T5
**Reuses**: `/tmp/opencode/art-visual.spec.ts` pattern for the capture
**Requirement**: ART-20

**Tools**: MCP: filesystem · Skill: NONE

**Done when**:
- [ ] Manifest swapped entries marked `approved` with evidence; traceability table Done
- [ ] STATE.md handoff written; capture artifact referenced
- [ ] Build gate: `pnpm typecheck && pnpm biome check . && pnpm test:sim && pnpm test:client`

**Tests**: none (bookkeeping)
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2

Phase 1:  T1 → T2 → T3 → T4 → T5
Phase 2:  T5 → T6
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order. 6 tasks total → single batch → inline execution, no sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: player sprite swap + its count filters | 1 primitive + the specs that count it | ✅ Granular (cohesive; migration cannot precede the swap without red gates) |
| T2: car sprite swap + presenter frames | 1 primitive | ✅ Granular |
| T3: door sprite swap | 1 primitive | ✅ Granular |
| T4: interiors | 1 render rule (two sources) | ✅ Granular |
| T5: panel flash | 1 primitive | ✅ Granular |
| T6: bookkeeping | docs only | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | phase-1 head | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |

No forward-phase dependencies.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | client scene + harness | unit + e2e | e2e + unit regression | ✅ OK |
| T2 | presenter + scene + harness | unit + e2e | unit + e2e | ✅ OK |
| T3 | scene + harness | e2e | e2e | ✅ OK |
| T4 | scene + harness | e2e | e2e | ✅ OK |
| T5 | scene + harness | e2e | e2e | ✅ OK |
| T6 | docs only | none | none | ✅ OK |
