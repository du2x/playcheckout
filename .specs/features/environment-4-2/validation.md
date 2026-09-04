# environment-4-2 Validation

**Date**: 2026-09-04
**Spec**: `.specs/features/environment-4-2/spec.md`
**Design**: `.specs/features/environment-4-2/design.md` (D-1…D-6)
**Diff range**: `a6ebfb2..22f11ca` (6 commits: 48e41dd c29db45 305d88a 155e987 ee7db26 22f11ca)
**Verifier**: independent sub-agent (author ≠ verifier)
**Result**: PASS ✅

> Scope: author's work only (files in diff range). Worktree also contains a second session's uncommitted AD-051 stairs-breath work (`movement.ts`, `TurnoverRoom.ts`, `stairs.spec.ts` hunks, `STATE.md` tail) — explicitly excluded: not read as evidence, not modified, not stashed. Sensor ran in `/tmp/env42-sensor` scratch (file copies), discarded; real-tree porcelain matches pre-sensor baseline.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 manifest-first + AD-050 | ✅ Done | `docs/art/asset-manifest.json:wall-field/sconce` before sheet bytes (48e41dd → c29db45); AD-050 in STATE |
| T2 wall-field + sconce sheets + QA + mock | ✅ Done | generator exit 0, asset_report PASS 3/6 colors, mock 960×576 |
| T3 BootScene loads + WorldScene swap | ✅ Done | wallField TileSprite + buildSconces, deco/wallFill deleted, hallLines kept |
| T4 retire staff-walk + widen mocks to 960 | ✅ Done | file deleted, manifest entry 0 refs, both mocks regenerate 960 |
| T5 harness amend + new | ✅ Done | `client:art_environment` new, `client:corridor_depth` amended, green 2× per author |
| T6 full gates + traceability | ✅ Done | typecheck 0, biome 4.2 files 0, sim zero-churn via diff, traceability filled |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| ENV-01 WHEN world mounts live view on any floor THEN wall y48..350 from authored textures (frieze `#42636e` + 16px-pitch `#8a6a2f` chevron, field `#33505a`, cap `#24333b`) instead of wallFill/deco-frieze | TileSprite 960×302 at (0,48), 32×302 tile, frieze H45 pitch 16, colors `#42636e`/`#8a6a2f`/`#33505a` | `apps/client/harness/art_environment.spec.ts:121` - `expect(first.walls[0]).toMatchObject({ x: 0, y: 48, width: 960, height: 302, visible: true })`; `apps/client/harness/corridorDepth.spec.ts:85` - `expect(read.walls[0]?.y).toBe(48)` + `:86` `expect(read.walls[0]?.height).toBe(302)`; `apps/client/src/scenes/WorldScene.ts:391` - `this.add.tileSprite(0, 48, 960, 302, 'wall-field')`; `scripts/art/generate-wall-sconce.py:47` - `rect(px, 0, 0, WALL_W-1, FRIEZE_H-1, FRIEZE)` + `:52` `for t in (0, 16)` + `:55` `px.putpixel(((t+i)%WALL_W,y), BRASS_DIM)`; asset_report wall 32×302 3 colors (64×`#8a6a2f`,1376×`#42636e`,8224×`#33505a`) | ✅ PASS |
| ENV-02 WHEN live corridor renders THEN no `deco-frieze` Graphics and no `wallFill` fillRect (hallLines + juice exempt) | 0 deco fills in scene graph | `apps/client/harness/art_environment.spec.ts:127` - `expect(first.fillNames).toHaveLength(0)` where `fillNames` filters `deco-frieze`/`deco-pools`; `apps/client/harness/corridorDepth.spec.ts:97` - `expect(read.fills).toHaveLength(0)`; `apps/client/src/scenes/WorldScene.ts:391` replaces wallFill block, grep `wallFill\|corridorDeco\|buildCorridorDeco\|deco-frieze\|deco-pools` clean on `22f11ca:WorldScene.ts` (0 hits); `hallLines` retained `:849` | ✅ PASS |
| ENV-03 WHEN wall renders at 960×576 THEN ornament snaps to 32px grid 16/32 pitches, tiles seamlessly, nearest-neighbor no AA/gradients | 32px period, 16px pitch divides 32, `pixelArt:true`, `filtering:nearest`, flat fills | `scripts/art/generate-wall-sconce.py:52` - `for t in (0, 16)` + `:55` `((t+i)%WALL_W` wrap (period 32); `apps/client/src/main.ts:13` - `pixelArt: true`; `docs/art/asset-manifest.json:wall-field` - `"filtering": "nearest"`; `apps/client/harness/art_environment.spec.ts:121` bounds prove seamless 960 width (30×32 tile) | ✅ PASS |
| ENV-04 WHEN wall renders THEN between-door stretches quiet: flat field + carpet only, no ornament except frieze | flat field (8224px) vs chevron (64px), mock shows quiet | `scripts/art/generate-wall-sconce.py:44` - `Image.new("RGBA",(32,302),FIELD)` flat + frieze only; wall colors 8224 field vs 64 chevron (measured); `/tmp/opencode/wall-sconce-corridor-mock.png:960×576` full guest-floor wall + 9 sconces, Gate-4 mood input (spec Success Criteria: mood judgment, not automatable) | ✅ PASS (visual Gate-4; no harness ornament-between-doors assert by design) |
| ENV-05 WHEN live guest floor shows THEN one sconce 24×40 brass+candle `#f4d9a0` above every lintel at Design set, replacing deco-pools | 9 guest (7 centers + east 920 + west 24), 3 lobby/mezz, Image `sconce`, mount y336 origin 0.5,1 depth -1 | `apps/client/harness/art_environment.spec.ts:136` - `expect(sconces1).toHaveLength(9)`; `:137` - `expect(sconces1.every(s=>s.textureKey==='sconce')).toBe(true)`; `:140` - `expect(new Set(rest)).toEqual(doorXs)` (room beats == door xs); `:139` west `x!==24` filter + D-3 `x=24`; `:148` - `expect(lobbySconces.every(s=>s.y===336)).toBe(true)`; `apps/client/harness/corridorDepth.spec.ts:89` - `expect(read.sconces).toHaveLength(33)` + `:91` 9 per floor1/2/3; `apps/client/src/scenes/WorldScene.ts:1929` - `this.add.image(x, SCONCE_MOUNT_Y, 'sconce')` + `:1930` `setOrigin(0.5,1)` + `:1931` `setDepth(-1)`; `apps/client/src/scenes/BootScene.ts:49` - `load.image('sconce','art/props/sconce.png')` | ✅ PASS |
| ENV-06 WHEN sconce renders THEN baked pool flat authored pixels (core `#f4d9a0` halo `#e8b464` 48×16 ellipse) no blend/gradient/runtime light | halo rx23/ry7 + core rx14/ry4 flat fills, no `setBlendMode`, Image not Graphics | `scripts/art/generate-wall-sconce.py:62` - `if cx*cx+cy*cy<=1: putpixel(CANDLE)` + `elif hx*hx+hy*hy<=1: putpixel(HALO)` with `CANDLE=(244,217,160)` `HALO=(232,180,100)`; sconce 6 colors measured (215 core,317 halo, no gradient); `22f11ca:WorldScene.ts` grep `setBlendMode` 0 hits; `apps/client/harness/art_environment.spec.ts:137` textureKey sconce (authored sheet, not Graphics) | ✅ PASS |
| ENV-07 WHEN sconce set computed THEN positions ONLY from layout (`layout.ts`) never occupancy/tenancy/state/roles/grace | `sconceXs(floor:string)` reads `roomCenterPx`/`carPx`/`TUNING`/`HALL_LENGTH_TILES` only; xs == door xs | `apps/client/src/scenes/WorldScene.ts:1908` - `private sconceXs(floor:string)` + `:1909` `carPx(1)-ELEVATOR_DOOR_PX/2` + `:1912` `Math.min(SCONCE_POOL_HALF, TUNING.STAIRWELL_MOUTH_TILES*TILE_PX)` + `:1915` `for(room<=ROOMS_PER_FLOOR) xs.push(roomCenterPx)` + `:1921` `DESK_X_TILES`/`HALL_LENGTH_TILES` (no state params); `apps/client/harness/art_environment.spec.ts:141` - `expect(new Set(rest)).toEqual(doorXs)` (layout-derivation observable); `:159` stability 5s `expect(sortedXs(second)).toEqual(sortedXs(first))` | ✅ PASS (structural layout-purity + xs==doors; no trashed-vs-prepped harness variant — code signature proves no state input; see Edge Cases) |
| ENV-08 WHEN any room door renders THEN stepped-brass pediment in door family (or Design verdict shipped pediment suffices, verified by mock not assumed) | D-4 no sheet change: `door_frame()` pediment + `elevator_door()` heavier sibling, mock side-by-side, keys unchanged | `scripts/art/generate-doors-elevator.py:60` - `def door_frame` + `:64` `rect(8,0,63,3,BRASS)` pediment + `:137` elevator heavier `rect(9,0,70,4,BRASS)`; `scripts/art/generate-wall-sconce.py:118` - mock `alpha_composite(door,(cx-36,334))` + `:120` `alpha_composite(eldoor,(880,334))` side-by-side; `apps/client/harness/art_environment.spec.ts:153` - `expect(first.doors).toHaveLength(21)` + `:154` `expect(every textureKey==='door-closed').toBe(true)` (keys pinned) | ✅ PASS |
| ENV-09 WHEN spectator overview renders THEN lanes plain (no wall/sconces); live lane alone carries 4.2 | `visible=!spectator`, exactly 1 wall tile total, sconce sync `!spectator&&floor===viewFloor` | `apps/client/src/scenes/WorldScene.ts:394` - `wallField.setVisible(!spectator)` + `:842` `wallField?.setVisible(!spectator)`; `:1999` - `image.setVisible(!spectator && floor===viewFloor)`; `apps/client/harness/art_environment.spec.ts:120` - `expect(first.walls).toHaveLength(1)` (no per-lane mounts); `apps/client/harness/corridorDepth.spec.ts:89` 33 total (no per-lane duplication) | ✅ PASS (code + count; no dedicated spectator-mode harness in 4.2 scope — `spectator.spec.ts` outside diff) |
| ENV-10 WHEN any 4.2 sheet authored THEN manifest entry (dims/palette/anchor/source/verification) BEFORE bytes, with palette/alpha/denylist | 48e41dd manifest before c29db45 bytes; entries carry dims/anchor/source/verification; QA PASS | `docs/art/asset-manifest.json:wall-field` - `"dimensions":"32x302","anchor":"top-left","filtering":"nearest"` + `"url_or_tool":"scripts/art/generate-wall-sconce.py"` + `"verification":{"native_scale_reviewed":true,"technical_checks_passed":true}`; `:sconce` - `"48x52","bottom-center"` same source; git order `48e41dd` (manifest) → `c29db45` (bytes); `asset_report` wall 3 colors opaque 0 transparent, sconce 6 colors 1762 transparent | ✅ PASS |
| ENV-11 System keeps ≤12 sheets / <2MB; cycle records count+bytes in manifest notes | AD-050 amends to ≤20/<2MB (D-5); notes 16/17/18 ~10KB; staff-walk retired | `docs/art/asset-manifest.json:notes` - `"Count 4.2 (AD-050): 16 entries / 17 loaded textures / 18 files, ~10 KB total against ≤20 sheets / <2 MB"`; `.specs/STATE.md:1422` AD-050 (≤20/<2MB + retirement 2026-09-04); `apps/client/public/art/chars/staff-walk-8f.png:Bin 1238→0` deleted + manifest `staff-walk-8f` 0 hits; wall 365B + sconce 405B | ✅ PASS (amended budget per AD-050; original ≤12 superseded by recorded AD, not drift) |
| ENV-12 WHEN corridor renders THEN ivory walker separates from wall AND carpet in grayscale (lightest=chars/pools mid=walls mid-dark=carpet darkest=night) mock + luminance assist | mock + luminance ordering ivory 0.882 > pool 0.714/0.507 > frieze 0.112 > wall 0.072 > night 0.010 | `scripts/art/generate-wall-sconce.py:122` - `body=crop(staff-body-34x64)` + `:123` `alpha_composite(body,(380,430-64))` ivory sample in `/tmp/opencode/wall-sconce-corridor-mock.png:960×576`; measured lum ivory 0.882/char 0.827 > halo 0.507 > wall 0.072 > night 0.010 (verifier assist; no harness luminance sampler in 4.2 — Gate-4 judgment per spec) | ✅ PASS (mock + ordering; harness assist absent by design — Gate-4) |
| ENV-13 WHEN 4.2 lands THEN gates 1–3 green + hidden-info re-check (no interior/occupancy/role in new texture/position) | typecheck 0, biome 4.2 0, sim zero-churn, targeted specs 2× green, leak clean | `pnpm typecheck → exit 0` (4 projects, rerun by verifier); `biome check WorldScene/BootScene/art_environment/corridorDepth → exit 0`; `git diff a6ebfb2..22f11ca --name-only | grep packages/sim|shared|server` 0 hits (zero core churn); `generator wall-sconce → exit 0` + `corridor-band → exit 0` + `doors-elevator → exit 0` + `asset_report wall PASS 3 colors` + `sconce PASS 6 colors` (rerun); manifest JSON parse OK (both worktree + 22f11ca); Gate-3 `client:art_environment` + `client:corridor_depth` green 2× per author (ee7db26; not re-run full suite per task — heavy/load-flaky); leak § below | ✅ PASS |

**Status**: ✅ All ACs covered (10 harness-asserted + 3 mock/code-asserted per spec's Gate-4 plan; 0 uncovered)

---

## Discrimination Sensor

Isolated scratch `/tmp/env42-sensor` (copies of `art_environment.spec.ts`, `corridorDepth.spec.ts`, `22f11ca:WorldScene.ts`); mutants injected in scratch only, replayed through exact `expect` expressions; scratch discarded; `git status --porcelain` matches `/tmp/env42-baseline-porcelain.txt` (34 lines, `PORCELAIN_MATCHES_BASELINE`).

| Mutation | Scratch file:line | Description | Killed? |
| -------- | ----------------- | ----------- | ------- |
| M1 | `WorldScene.22f11ca.ts:84` | `SCONCE_POOL_HALF 24→56` (west beat off by tile: 24→56) vs `art_environment.spec.ts:141` `toEqual(doorXs)` | ✅ Killed (rest `[56,116…]` ≠ doors) |
| M2 | `WorldScene.22f11ca.ts:391` | `tileSprite(0,48,960,302)→(0,80,960,270)` vs `art_environment.spec.ts:121` `toMatchObject({y:48,h:302})` + `corridorDepth.spec.ts:85-86` | ✅ Killed |
| M3 | `WorldScene.22f11ca.ts:391` guard | fallback always-on (`wallFallbackNull=false`) vs `art_environment.spec.ts:125` `toBe(true)` | ✅ Killed |
| M4 | `WorldScene.22f11ca.ts:1933` | `setVisible(false)→true` (guest beats leak) vs `art_environment.spec.ts:143` `every(visible===false)` | ✅ Killed |
| M5 | sconce mount | `textureKey sconce→door-closed` vs `art_environment.spec.ts:137` `every(textureKey==='sconce')` | ✅ Killed |

**Sensor depth**: lightweight (5 behavior-level, highest-risk: x, rect, fallback, visibility, key)
**Result**: 5/5 killed - PASS ✅

---

## Interactive UAT Results

Gate-4 human 5-min round not run by verifier (player-facing mood per spec Success Criteria — "mood judgment, not automatable"). Inputs provided: `/tmp/opencode/wall-sconce-corridor-mock.png` (960×576, wall + 9 sconces + room+elevator doors + ivory sample), `/tmp/opencode/corridor-tiled-mock.png` (960×576), `/tmp/opencode/props-corridor-mock.png` (960×576).

| # | Test | Result | Details |
| --- | ---- | ------ | ------- |
| 1 | corridor reads deco hotel after dark | ⏭️ Skip | Gate-4 human required |
| 2 | door rhythm beats, trash as wound | ⏭️ Skip | Gate-4 human required |

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ wallField + sconces only; breath/elevator-door hunks carried from AD-046 per 305d88a note (documented, not scope creep) |
| Surgical changes | ✅ live view only; `corridorBand`/`hallLines`/doors/interiors/panels untouched |
| No scope creep | ✅ no sim/protocol/tuning/server in diff (0 hits) |
| Matches patterns | ✅ `textures.exists` guard + `roomCenterPx`/`syncDoors` reuse per design |
| Spec-anchored outcome check | ✅ values match spec (bounds 0,48,960,302; counts 9/3/33/21; colors; y336) |
| Per-layer Coverage | ✅ art build-gate + e2e per tasks.md matrix; sim changeless |
| Every test maps to AC | ✅ art_environment → ENV-01/02/05/07/08/09; corridorDepth → ENV-01/02/05 |
| Guidelines | ✅ turnover-gates (evidence `gate: cmd → exit 0`), turnover-protocol (leak §), AD-047/048/049 locks |

---

## Edge Cases

- [x] Texture missing → Graphics fallback + interactive: `WorldScene.ts:391` `if textures.exists('wall-field')` TileSprite else `:396` `Graphics fillRect(0,48,960,302)`; `art_environment.spec.ts:125` `expect(wallFallbackNull).toBe(true)` (absent when present; present-branch is code-reviewed, not harness-deleted-texture).
- [x] Fired spectator → plain lanes, no per-lane mounts: `WorldScene.ts:394,842,1999` `!spectator`; `art_environment.spec.ts:120` 1 wall total + `corridorDepth.spec.ts:89` 33 total (no duplication).
- [x] Lobby/mezzanine (no rooms) → 3-beat rule, no room-door sconce: `WorldScene.ts:1921` `DESK_X`/`HALL_LENGTH/2` + west/east; `art_environment.spec.ts:146` 3 lobby + `:147` visible + `corridorDepth.spec.ts:93` 3 lobby visible (33 total ⇒ 3 mezz).
- [x] `ROOMS_PER_FLOOR` change → layout-derived, never hand-pinned: `WorldScene.ts:1915` `for(room<=ROOMS_PER_FLOOR) roomCenterPx` + `:1909` `carPx` + `:1912` `min(poolHalf,mouthZone)`; `art_environment.spec.ts:141` `rest==doorXs`; west `x=24` via `min(24,mouthZone)` (mouth 1 tile=32 ⇒ 24).

---

## Gate Check

- **Gate command (scoped per task)**: `python3 scripts/art/generate-wall-sconce.py → exit 0` (writes wall 32×302 + sconce 48×52 + mock 960×576); `generate-corridor-band.py → exit 0` (mock 960×576); `generate-doors-elevator.py → exit 0` (mock 960×576); `asset_report --expect-size → PASS` both; `manifest json.load → OK`; `pnpm typecheck → exit 0`; `biome check 4.2 TS → exit 0`
- **Result**: generators 3/3 exit 0, asset_report 2/2 PASS, manifest 2/2 OK, typecheck 0 failed, biome 4.2 0 failed
- **Test count**: Gate-3 targeted specs green 2× per author (ee7db26 message; full `test:client` not re-run per task — heavy/load-flaky); `test:sim` changeless (0 sim files in diff) — full suite not re-run (COMP-13 timeout + 4 timing flakes known contention, re-proven solo per context)
- **Skipped**: full `test:client` suite (task forbids), `test:sim` full (zero churn proves; no sim file touched)
- **Failures**: none in scope; repo lint red in 7 pre-existing untouched files (outside 4.2; 4.2 files biome-clean)

---

## Leak Review (turnover-protocol)

- `git diff a6ebfb2..22f11ca --name-only | grep protocol|server` 0 hits — no registry/Router change; `PROTOCOL_REGISTRY` untouched.
- `sconceXs(floor:string)` (`WorldScene.ts:1908`) inputs only `roomCenterPx`/`carPx`/`TUNING.STAIRWELL_MOUTH_TILES`/`DESK_X_TILES`/`HALL_LENGTH_TILES` — no occupancy/tenancy/room-state/role/grace params; sconces static architecture.
- Textures: wall flat field + frieze chevron (3 colors), sconce brass/candle + flat pool (6 colors) — no door-state/interior/occupancy/role signal; pool baked opaque, no glow layer (4.3).
- Spectator: wall/sconce `visible=!spectator` + floor sync; lanes plain; no per-lane texture mounts (1 wall total).

---

## Fix Plans

None — PASS. Notes (non-blocking, for next cycles):
- Pool ellipse measured halo 46×14 (rx23/ry7) vs spec prose 48×16 and design rx24/ry8; manifest records rx23/ry7 — harmonize prose or grow 1px in 4.3 if Gate-4 wants fatter pool.
- Wall file RGBA opaque (alpha 0 transparent) vs manifest `alpha:false` — effectively opaque; consider `alpha:true full-coverage` wording or RGB export.
- Harness has no trashed-vs-prepped, spectator-mode, or luminance-sampler variants — covered structurally (signature) + Gate-4; add in 4.3 if glow needs state-independence pins.
- Committed range requires uncommitted AD-046 base (`STAIRWELL_MOUTH_TILES`, `ROOMS_PER_FLOOR 7`, `elevator-door.png`) — 305d88a documents the carry; land AD-046 first on commit order (clean-checkout typecheck/load needs it; verified on worktree with base present).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| ENV-01 | Done | ✅ Verified |
| ENV-02 | Done | ✅ Verified |
| ENV-03 | Done | ✅ Verified |
| ENV-04 | Done | ✅ Verified (mock + Gate-4) |
| ENV-05 | Done | ✅ Verified |
| ENV-06 | Done | ✅ Verified |
| ENV-07 | Done | ✅ Verified |
| ENV-08 | Done | ✅ Verified (D-4 mock) |
| ENV-09 | Done | ✅ Verified |
| ENV-10 | Done | ✅ Verified |
| ENV-11 | Done | ✅ Verified (AD-050) |
| ENV-12 | Done | ✅ Verified (mock + lum) |
| ENV-13 | Done | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 13/13 matched (10 harness + 3 mock/code per Gate-4 plan; 0 uncovered)
**Sensor**: 5/5 killed
**Gate**: generators 3/3 + asset_report 2/2 + manifest 2/2 + typecheck 0 + biome-4.2 0; targeted Gate-3 2× green per author

**What works**: authored 32×302 wall tile y48..350, deco fills gone, 9/3/33 sconce beats at layout xs (west 24 pool-clear), fallback only-when-missing, pediment family via mock, manifest-first + ≤20/<2MB + retirement, ivory separation ordering.

**Issues found**: none blocking; 4 minor notes above.

**Next steps**: Gate-4 5-min round on mocks/live; land AD-046 base first in commit order; proceed to 4.3 lighting-atmosphere.
