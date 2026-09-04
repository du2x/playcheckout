# Phase 4.2 Environment Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/environment-4-2/design.md`
**Spec**: `.specs/features/environment-4-2/spec.md`
**Status**: Ready for Execute (spec gate green, design user-approved incl. AD-050)

**Precondition (uncommitted worktree)**: AD-046 (7 rooms, elevator box 2.5,
stair-mouth split) + the front-facing elevator-door swap + the Phase-4
roadmap rescope are in the worktree uncommitted. T1 commits nothing but SHALL
verify those files are present (`roomSegmentEndMilli(7) === 24_750`,
`elevator-door.png` 160×96 exists); if absent, STOP — 4.2 builds on that
geometry.

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Art assets (PNG sheets, manifest) | build gate | `asset_report.py` palette/alpha/denylist per new sheet; dims/anchors vs manifest | `apps/client/public/art/**`, `scripts/art/generate-wall-sconce.py` | generator exit 0 + `asset_report.py` |
| Client scene (WorldScene, BootScene) | e2e (Playwright harness) | Every visual AC: wall coverage, sconce set + state-independence, pediment keys, no `deco-*` fills | `apps/client/harness/art_environment.spec.ts`, `corridorDepth.spec.ts` (amended) | `pnpm test:client` (targeted specs) |
| Sim / protocol / server | none (rendering-only) | `test:sim` must be changeless — proves zero core churn | `packages/sim`, `packages/shared`, `apps/server` (untouched) | `pnpm test:sim` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After unit-only or asset-only tasks | `pnpm test:sim` |
| Build | After scene/config/asset tasks | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Full | After harness tasks | `pnpm test:sim && pnpm test:client` (targeted specs first, suite on T6) |

---

## Execution Plan

Phases run sequentially; tasks within a phase run in order.

### Phase 1: Contract + authoring

Manifest-first entries and AD-050, then the two sheets with QA + native mock.

```
T1 → T2
```

### Phase 2: Renderer + cleanup

BootScene loads and the WorldScene swap, then dead-file retirement + stale mock widening.

```
T2 → T3 → T4
```

### Phase 3: Harness + gates

Amended + new Gate-3 scenarios, then full gates with evidence for the Verifier.

```
T4 → T5 → T6
```

---

## Task Breakdown

### T1: Manifest-first entries + AD-050 ✅ DONE

**What**: Append `wall-field` (32×302 opaque tile) and `sconce` (48×52,
origin 0.5/1) entries to `docs/art/asset-manifest.json` with dims, anchor,
source (`scripts/art/generate-wall-sconce.py`, Pillow, project-internal),
and empty `verification` blocks; record AD-050 in `.specs/STATE.md`
(budget ≤20 sheets / <2 MB + `staff-walk-8f.png` retirement); verify the
AD-046 + elevator-door precondition files exist.
**Where**: `docs/art/asset-manifest.json`, `.specs/STATE.md`
**Depends on**: None
**Requirement**: ENV-10, ENV-11

**Done when**:

- [ ] Manifest parses (`python3 -c json.load`) and carries the two new entries with dims/anchor/source before any sheet bytes exist
- [ ] AD-050 entry present in STATE.md (decision, budget count, retirement, date 2026-09-04)
- [ ] Precondition verified: `layout.ts` pins 7 rooms / `roomSegmentEndMilli(7) === 24_750`, `elevator-door.png` is 160×96
- [ ] Gate check passes: `pnpm typecheck && pnpm lint` (proves manifest/STATE edits broke nothing)

**Tests**: build gate (manifest JSON parse + precondition asserts, no unit tests — docs-only task)
**Gate**: build

---

### T2: Author wall-field + sconce sheets with QA + native mock ✅ DONE

**What**: New `scripts/art/generate-wall-sconce.py` (Pillow, deterministic,
palette-locked to brief §80 swatches only) authoring both sheets + a
960-native corridor mock `/tmp/opencode/wall-sconce-corridor-mock.png`
(full guest-floor wall + 9 sconces + room door + elevator door + ivory
character sample for the grayscale read); run `asset_report.py` per sheet.
**Where**: `scripts/art/generate-wall-sconce.py`, `apps/client/public/art/rooms/wall-field.png`, `apps/client/public/art/props/sconce.png`
**Depends on**: T1
**Reuses**: `scripts/art/generate-corridor-band.py:35-61` palette constants + `rect()` pattern, `generate-doors-elevator.py:60-70` pediment language, `.opencode/skills/create-game-assets/scripts/asset_report.py` QA
**Requirement**: ENV-01, ENV-03, ENV-05, ENV-06, ENV-10, ENV-12

**Done when**:

- [ ] Generator exits 0 and writes both sheets at exact contract dims (32×302 opaque; 48×52 transparent, prop x12..36/y0..40, pool ellipse center (24,44) rx24 ry8)
- [ ] `asset_report` PASS per sheet: palette count, full/expected alpha, no new colors beyond brief swatches
- [ ] Mock exists at 960×576 showing frieze pitch 16, quiet between-door stretches, sconce rhythm, pediment family (room + elevator doors adjacent)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim` (changeless sim proves zero core churn)

**Tests**: build gate (generator exit 0 + asset QA + mock exists; no unit tests — art bytes)
**Gate**: build

---

### T3: BootScene loads + WorldScene swap

**What**: `BootScene.preload` loads `wall-field` (image 32×302) + `sconce`
(image 48×52); `WorldScene.create` mounts the 960×302 `wallField` TileSprite
at (0,48) depth −3 (`visible = !spectator`, `textures.exists` guard with
today's fills as fallback); new `buildSconces()` mounts `sconce:<floor>:<i>`
Images (origin 0.5/1, depth −1) at the D-3 layout-derived set; sconce
visibility joins the existing floor-change sync (visible iff `!spectator
&& floor === viewFloor`); delete `wallFill`, `corridorDeco`,
`buildCorridorDeco()` and their call/applyViewMode lines; keep `hallLines`,
`corridorBand`, spectator plain lanes.
**Where**: `apps/client/src/scenes/BootScene.ts`, `apps/client/src/scenes/WorldScene.ts`
**Depends on**: T2
**Reuses**: `WorldScene.ts:359-368` TileSprite guard pattern, `:1863-1874` door-image mount + `syncDoors` visibility pattern, `roomCenterPx` for all sconce x
**Requirement**: ENV-01, ENV-02, ENV-05, ENV-07, ENV-09

**Done when**:

- [ ] No `wallFill`, `corridorDeco`, `buildCorridorDeco`, `deco-frieze`, or `deco-pools` remains in `WorldScene.ts` (grep clean; `hallLines` + juice dust exempt)
- [ ] Every sconce x derives from `roomCenterPx` / layout constants — no hand-pinned px literal in the sconce set (ENV-07 structural)
- [ ] Lobby/mezzanine mount 3 sconces, guest floors 9, all hidden when `spectator`
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: build gate (no unit tests — renderer; covered by T5 harness)
**Gate**: build

---

### T4: Retire dead sheet + widen stale mocks to 960

**What**: Delete `apps/client/public/art/chars/staff-walk-8f.png` + remove
its manifest entry (AD-050); widen the two stale 832 mocks to 960
(`generate-corridor-band.py:87` canvas, `generate-doors-elevator.py:246`
canvas); re-run both generators to prove byte-stable art (only mock width
changes) and record the new loaded-texture count in the manifest notes.
**Where**: `apps/client/public/art/chars/staff-walk-8f.png` (delete), `docs/art/asset-manifest.json`, `scripts/art/generate-corridor-band.py`, `scripts/art/generate-doors-elevator.py`
**Depends on**: T3
**Requirement**: ENV-11

**Done when**:

- [ ] `staff-walk-8f` has zero references repo-wide (grep clean incl. manifest) and the file is gone
- [ ] Both widened mocks regenerate at 960 width with unchanged art bytes (generators exit 0)
- [ ] Manifest notes record the loaded-texture count ≤20 budget headroom
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim`

**Tests**: build gate (grep-clean + generator exits; no unit tests)
**Gate**: build

---

### T5: Harness — amend corridor_depth, add art_environment

**What**: Amend `corridorDepth.spec.ts` (frieze/pool `Graphics` asserts →
`wall-field` TileSprite + `sconce:` count asserts; keep
spectator-hidden + door-rhythm asserts); new `art_environment.spec.ts`
(`client:art_environment`): wall coverage y48..350, sconce counts (9 guest /
3 lobby), state-independence (trash rooms → identical sconce set),
pediment texture keys, absence of `wallFill`/`deco-*` fills.
**Where**: `apps/client/harness/corridorDepth.spec.ts`, `apps/client/harness/art_environment.spec.ts`
**Depends on**: T4
**Reuses**: `corridorDepth.spec.ts:45-81` `__TURNOVER__` scene-list read pattern + four-player-round setup
**Requirement**: ENV-02, ENV-05, ENV-07, ENV-08, ENV-09

**Done when**:

- [ ] `client:art_environment` passes (wall tile bounds, sconce counts per floor class, state-independence, keys, no fills)
- [ ] Amended `client:corridor_depth` passes (no `Graphics`-name asserts remain)
- [ ] Gate check passes: targeted `pnpm test:client` runs for both specs (2× for flake margin, per 4.1 precedent)

**Tests**: e2e (Playwright harness — 1:1 to ENV-02,05,07,08,09)
**Gate**: full (targeted)

---

### T6: Full gates + Verifier evidence

**What**: Run gates 1–3 fully green, fill the spec traceability statuses,
attach the native mock + Gate-4 notes, update the STATE handoff for the
Verifier pass.
**Where**: `.specs/features/environment-4-2/spec.md` (traceability),
`.specs/STATE.md` (handoff), `/tmp/opencode/wall-sconce-corridor-mock.png`
**Depends on**: T5
**Requirement**: ENV-12, ENV-13

**Done when**:

- [ ] `pnpm typecheck` + `pnpm lint` exit 0; `pnpm test:sim` green and changeless vs T1 baseline (no sim file touched — `git status` proves)
- [ ] `pnpm test:client` targeted specs green; full-suite result recorded (pre-existing flakes noted, not owned)
- [ ] Traceability table statuses filled; handoff updated; mock + hidden-info re-check notes attached
- [ ] Gate check passes: full

**Tests**: full gates (evidence, not new tests)
**Gate**: full
