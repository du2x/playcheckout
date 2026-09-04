# Phase 4.2 Environment — Design

## Context

Spec: `.specs/features/environment-4-2/spec.md` (ENV-01…13, gate green).
Decisions in force: AD-029 (Deco Noir), AD-030 (960×576, 32 px/tile), AD-036
(front-facing landing doors), AD-046 (7 rooms tiling `[2, 24.75]`, 2.5-tile
elevator box, decoupled stair mouth), AD-047 (render-layer amendment — 4.2
bakes, 4.3 glows), AD-048 (Pillow for architecture), AD-049 (author at
960×576, integer-zoom lands in 4.7).

Current renderer (all `apps/client/src/scenes/WorldScene.ts`):
wall `wallFill.fillRect(0, 48, 960, 302)` (`:830-831`, depth −3) · frieze +
pools per-mount `Graphics` (`buildCorridorDeco`, `:1884-1908`, names
`deco-frieze`/`deco-pools`) · `corridor-band` TileSprite 960×146 at y350
(`:363-368`, depth −2, wainscot rows 0..77 + carpet 78..145 per
`generate-corridor-band.py:41-61`) · brass lane line `hallLines` (`:815-839`,
stays — harness shape contract) · `BootScene.ts` preloads (no wall/sconce
yet) · `corridorDepth.spec.ts` asserts the `Graphics` names (must be amended).

## Decisions

| # | Decision | Rationale | Rejects |
|---|---|---|---|
| D-1 | Wall = one opaque **32×302 tile** (`wall-field`), frieze baked into its top ~45 px (upper 15% per brief: `#42636e` band + 16 px-pitch dim-brass chevron), field `#33505a` below; rendered as a 960×302 TileSprite at (0, 48), depth −3 | Frieze is position-independent pure repeat — baking it into the tile costs nothing and kills the per-mount `Graphics` loop; 32 px period matches the corridor-band seam discipline and the 16 px ornament pitch | Full-bleed 960×302 panel (brittle to layout change, 30× the bytes for flat fills); separate frieze strip sprite (extra texture + seam risk for zero gain) |
| D-2 | Sconce + pool = one transparent **48×52 sprite** (`sconce`): 24×40 prop centered + 48×16 baked pool ellipse below it; origin (0.5, 1), mounted at lintel top; depth −1 (doors stay crisp in front) | Pool positions must derive from layout at runtime (spec edge case: a `ROOMS_PER_FLOOR` change cannot strand baked px) — sprites positioned from `roomCenterPx` satisfy ENV-07 structurally; one texture keeps the budget; flat baked pixels obey AD-047 (no blend modes — 4.3 attaches glow to these exact mounts) | Baking pools into the wall tile (couples art bytes to room count); separate prop + pool textures (doubles mounts for one beat) |
| D-3 | Sconce set, all floors, layout-derived: guest floors = 7 room centers + east landing + west mouth (9); lobby = mezzanine = west mouth + center + east landing (3) | Door rhythm on guest floors (brief); landings always beat (arrival legibility); room-less floors get the minimal symmetric set — quiet discipline between (ENV-04) | Per-dining-slot sconces on the mezzanine (visual noise over a wait buffer); sconce-free lobby (deadest wall in the game) |
| D-4 | **No door-sheet change** (ENV-08 second arm): `door_frame()` already authors the stepped-brass pediment, `elevator_door()` its heavier sibling — verified by reading `generate-doors-elevator.py:60-70,137-144`; the cycle proves family by native-scale mock, not new bytes | Avoids re-authoring working sheets; the mock either confirms or reopens this decision with evidence | Pre-emptive pediment redraw (churn without a diagnosed gap) |
| D-5 | Retire dead `staff-walk-8f.png` (legacy 28×60, unloaded since 4.1 — `BootScene` loads `staff-body-34x64-7f` under the `staff-walk` key) and **amend the sheet budget to ≤20 sheets / <2 MB** (recorded as AD-050 in this cycle) | Honest count: 14 textures load today against a ≤12 number from the smaller AD-020 family — 4.1 already outgrew it silently; bytes total ~12 KB so <2 MB was never at risk; the count guards sprawl, and 16 small textures is not sprawl | Silent breach (the drift AD-047 was written to prevent); consolidating guest sheets to fund 4.2 (4.4's business — walk cycles may re-cut those sheets) |
| D-6 | New generator `scripts/art/generate-wall-sconce.py` authors both 4.2 sheets + the 960-native corridor mock; the two stale 832-wide mocks (`generate-corridor-band.py:87`, `generate-doors-elevator.py:246`) are widened to 960 in the same cycle | One authoring home per cycle (cast-4-1 precedent); mocks must match the AD-030 canvas or Gate-4 judges the wrong frame | Extending `generate-corridor-band.py` (wrong seam — the band is done and frozen) |

## Geometry (derived, not chosen)

`TILE_PX` 32 · `GROUND_Y` 430 · doors 72×96 (top y=334) · room width 104 px,
centers px = 116, 220, 324, 428, 532, 636, 740 (room 1…7) · east landing door
80 px spanning 880–960 (center 920, top y=334 — same mount as room doors) ·
west mouth zone tiles [0, 1], sconce x=16 · room-7 art ends 776 → 104 px
clear to the elevator · sconce sprite 48×52 at origin (0, 5, 1): prop pixels
x12..36 / y0..40, pool ellipse center (24, 44) rx24 ry8 (48×16)

## Sheet contracts (manifest-first, phase rule)

| Sheet | File | Dims | Alpha | Anchor | Palette (new colors: none — all from brief §80) |
|---|---|---|---|---|---|
| `wall-field` | `apps/client/public/art/rooms/wall-field.png` | 32×302 tile | opaque | top-left (TileSprite) | `#42636e` frieze band + `#8a6a2f` chevron (16 px pitch) + `#33505a` field; bottom row = field (band tile's chair-rail rows own the joint) |
| `sconce` | `apps/client/public/art/props/sconce.png` | 48×52 | transparent | (0.5, 1) @ lintel top | brass `#c9a13b`/`#9c782c` arm + candle `#f4d9a0` + baked pool core `#f4d9a0` / halo `#e8b464` flat fills |

Retired: `staff-walk-8f.png` + its manifest entry (AD-050 records the deletion).

## Renderer swap (`WorldScene.ts`, live view only)

- **Delete**: `wallFill` field + its block in `drawHallLines` (`:822-831` —
  keep `hallLines` lane lines); `corridorDeco` array + `buildCorridorDeco()`
  (`:1884-1909`) + its `create()` call (`:352`) + its `applyViewMode` line
  (`:809`).
- **Add**: `wallField` TileSprite in `create()` beside `corridorBand`
  (same guard pattern: `textures.exists('wall-field')`, origin (0,0),
  depth −3, `visible = !spectator`, fallback = today's fills when missing —
  spec graceful-degrade edge case); `buildSconces()` mounting
  `Image('sconce')` per floor per D-3 set, name `sconce:<floor>:<i>`,
  depth −1; sconce visibility follows the door pattern (`syncDoors`:
  visible iff `!spectator && floor === viewFloor`) — extend the existing
  floor-change sync point, no new subscription.
- **Untouched**: `corridorBand`, `hallLines`, doors, interiors, panels,
  stair/elevator screens, spectator lanes (plain backdrop — ENV-09),
  `BootScene` gains two loads (`wall-field` image 32×302, `sconce` image
  48×52) and nothing else. Zero protocol/sim/tuning/server changes.

## Harness (`apps/client/harness/`)

- **Amend** `corridorDepth.spec.ts`: `deco-frieze`/`deco-pools` presence
  assertions → `wall-field` TileSprite present + `sconce:` image count ==
  D-3 set for the viewed floor; keep spectator-hidden + door-rhythm asserts.
- **New** `art_environment.spec.ts` (`client:art_environment`): wall
  coverage (tile key, rect y48..350 via bounds), sconce count per floor
  class (9 guest / 3 lobby), state-independence (trash rooms → same sconce
  set/positions), pediment keys present, no `wallFill`/`deco-*` fills.
- Texture-key contract: `wall-field`, `sconce` join the harness vocabulary;
  all other keys unchanged.

## Verification

1. Manifest-first: both entries (dims/palette/anchor/source/verification)
   + AD-050 retirement note before any sheet bytes (ENV-10).
2. `asset_report.py` per sheet: palette count, alpha coverage, denylist
   (sconce brass is prop trim — allowed; guest ivory/brass rule untouched).
3. Native-scale 960 mock `/tmp/opencode/wall-sconce-corridor-mock.png`:
   full guest-floor wall + 9 sconces + room door + elevator door side by
   side (pediment family judgment, ENV-08) + ivory character sample
   (grayscale separation, ENV-12) — Gate-4 input.
4. Gates 1–3: typecheck/lint, `test:sim` (must be changeless — proves zero
   core churn), targeted `client:art_environment` + amended
   `client:corridor_depth` (ENV-13); hidden-info re-check (sconce set is
   layout-pure — no occupancy/tenancy/state input).
5. Gate 4: human 5-minute round (mood).

## Risks

- Sconce-behind-door depth (−1): prop tops never overlap doors except the
  pediment cap rows — mock judges; fallback is depth 0 (documented, not silent).
- Stale 832 mocks fixed in-cycle (D-6); any other 832 literal found during
  Execute is fixed, not recorded.
- If the pediment mock fails the family read, D-4 reopens as a sheet task —
  the contingency is bounded (one `door_frame` tweak, same contracts).
