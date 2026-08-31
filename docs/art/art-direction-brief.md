# Turnover — Art direction brief

> **SUPERSEDED (AD-029, 2026-08-30)**: the "Deco Noir" alternative direction
> in [docs/art/alternative/art-direction-brief.md](alternative/art-direction-brief.md)
> was approved and adopted as the production visual contract. The technical
> contract below (sheet sizes, anchors, folders, budgets) still holds; the
> visual system above (palette, shape language, outline rule) does not. Kept
> for provenance.

Status: Draft v1 (awaiting visual-target approval) · Owner: art workstream
Source of truth for gameplay/design: `prd.md`. This brief translates it into
visual constraints. Tuning values referenced here come from `prd.md` §7.

## Game frame

- **Player fantasy:** cozy grand hotel night shift vs quiet paranoia — you are either
  honestly restoring rooms or faking it while everyone watches the hallways.
- **Core verbs:** walk (left/right), enter/exit rooms, prep (5s channel), read door
  cards, call/ride elevators, accuse (hold E).
- **Engine and renderer:** Phaser 4 canvas renders the world only; lobby, HUD,
  door cards, progress bar, toasts, results/recap are the DOM overlay.
- **Target platforms:** desktop browsers (Chrome/Firefox/Edge), keyboard. No touch.
- **Camera/view/facing:** side-on orthographic, one floor visible at a time, linear
  left/right travel (FR-4). Characters drawn in strict profile with a simple
  flip for facing; no 3/4 turn convention needed.
- **Native viewport:** 832×576 canvas (`apps/client/src/main.ts`). One floor strip:
  ground line at y=430, hall = 30 tiles across 832 px (TILE_PX ≈ 27.73,
  `WorldScene.ts:42`).
- **Typical asset size on screen:** characters ≈ 26×60 px today (≈1 tile wide,
  ~2 tiles tall). Doors ≈ 72 px tall. Elevator cars ≈ 46×60 px footprint.
- **Open decision (code change, needs sign-off):** TILE_PX = 832/30 is non-integer,
  which fights pixel-art grids. Recommended: widen canvas to 960×576 → exactly
  32 px/tile (PRD hall length 30 tiles unchanged; player speed in tiles/s unchanged).
  Alternative: keep 832 and author all art on a 4 px grid, snapping scenery to
  rounded tile positions. Decide before the first production sprite.

## Visual system

Reference named by PRD §4: "Elevator Action pixel style comes later". That
reference is translated below into properties (it is an era/mood anchor, not a
license to copy assets).

- **Shape language:** chunky rectangles and modular architecture. Corridor = long
  horizontal band (carpet strip + wall + repeating door rhythm). Rooms read as
  shallow interiors behind doorframes. Characters: boxy torso, stubby legs, simple
  cap/hat; props are blocky (luggage, carts, TV, bed).
- **Silhouette priorities:** the character body must read against mid-value walls
  at 60 px tall. Door-card plaques must read from the hallway at a glance. Room
  state (prepped/trashed) must read through the open doorway as a *shape*, before
  color: tidy = clear floor plane + aligned furniture; trashed = scattered clutter
  breaking the floor line.
- **Value structure:** 4 bands. Characters darkest + highest contrast; walls mid;
  carpet mid-dark; ceiling/light band lightest. Grayscale test: a walking character
  must separate from both wall and carpet.
- **Palette roles and exact swatches** (draft, ≤24 colors total):
  - Environment neutral: warm cream wall `#e8dcc0`, wainscot tan `#c9b28a`,
    carpet crimson `#8c3b3b`, carpet trim gold `#d9a441`.
  - Night/tension: deep blue-violet shadow `#2b2440`, dim ambient `#4a4664`.
  - Uniform (identical for ALL players — no saboteur tell): bellhop navy `#2f4f6f`
    (current gray-box color, keep), brass buttons `#d9a441`, white gloves `#f2ede2`.
  - Evidence/positive: door card ivory `#f2ede2` + gold seal `#d9a441`.
  - Danger/freshness (trash tiers, FR-12): fresh = sickly green spill accents
    `#9db84a` + scattered debris; settled = desaturated brown-gray `#6e6154`.
  - Prepped room cue: warm lit interior `#f0d9a8` light pool.
  - UI (DOM overlay inherits): ink `#1d1a2e` on ivory panels, brass accent.
- **Materials and surface cues:** flat color clusters, no gradients. Wood = 2-tone
  planks; brass = gold + dark seam line; fabric = flat with 1px fold accents;
  glass = light blue with white glint pixels. Trash = small dark clusters +
  paper scraps, never gore (family/streamer-safe per PRD §2).
- **Edge/line treatment:** hard pixel clusters; optional 1px darker-self outline on
  characters only (never on architecture). No black outlines, no anti-aliasing.
- **Lighting direction and contrast:** top-down ceiling sconces, warm; light pools
  under sconces and inside prepped rooms. Trashed-fresh rooms flicker slightly
  cooler. Baked shading only; no runtime lights in MVP.
- **Detail density and focal hierarchy:** detail concentrates on (1) characters,
  (2) door zone (card + door + frame), (3) room interior near the door. Corridor
  between doors stays quiet so the door rhythm reads. Anything invisible at 60 px
  tall is cut.
- **Motion character:** snappy, weighty, small. 4–8 frame walk cycle, 1-frame
  turns, work channel = a repeating "bend + wipe/tidy" loop. **FR-9 hard rule:
  work animation is identical for every role — no variant may hint at sabotage.**
- **Explicit exclusions:** no blood/violence/corpses (PRD: property crime only);
  no visual saboteur tell anywhere; no room interior visible from the hallway
  except door cards (FR-10/11); elevator panels show car positions only, never
  occupants (FR-6); HUD stays coverage % + timer, DOM, no art oracle (FR-14);
  no living-artist style names.

## Technical contract

- **Asset dimensions/aspect:** characters 28×60 px (pending viewport decision:
  28×64 at 32 px/tile). Doors 72×96 px incl. frame. Elevator car 48×64 px.
  Room interiors one canvas per room-size class, 30 tiles wide hall → interior
  ≈ 4 tiles deep per PRD §7.
- **Alpha/background:** transparent PNG for characters, props, doors, cars.
  Room interiors opaque (they are the background when inside).
- **Grid/tile/frame size:** single global pixel grid (4 px master grid if 832
  viewport stays). All furniture snaps to tile columns. Walk cycle = uniform
  frame size, characters share one sheet per anim.
- **Anchor/pivot/baseline:** characters anchor bottom-center on the ground line
  (y=430 today); doors anchor bottom-center on the door threshold; cars anchor
  center. Pivots never move between frames.
- **Filtering/mipmaps/compression:** Phaser `pixelArt: true` (nearest-neighbor,
  no mipmaps). PNG-24, no interlacing; palette-locked before export.
- **Color space:** sRGB.
- **Texture budget:** MVP set ≤ 12 sheets total (see manifest). Whole game is
  < 2 MB of art; single-floor view means no atlas pressure.
- **Naming and folders:** `apps/client/public/art/{chars,rooms,props,doors,elevator}`
  — kebab-case, `staff-walk-4f.png` style (subject-action-frames). Manifest:
  `docs/art/asset-manifest.json`.

## Visual target (approval gate before production)

- **Hero target:** one staff character walk cycle (4 frames, both facings) +
  one open-door triptych (prepped / trashed-fresh / settled) from the hallway
  view, composited into an 832×576 (or 960×576) gameplay mock at native scale.
- **Required do/don't:** do — identical uniforms, silhouette-first trash clutter,
  card readable from hall; don't — any role tell, interior bleed past the
  doorframe, outline drift, palette growth.
- **Approval owner/date:** art workstream + design owner, before any family
  production. Judge at native resolution over the real corridor background.
