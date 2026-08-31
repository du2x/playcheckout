# Turnover — Art direction brief (ALTERNATIVE: "Deco Noir")

Status: Proposal v1 (awaiting visual-target approval) · Owner: art workstream
This is an **alternative** to `docs/art/art-direction-brief.md`, not a replacement.
That brief anchors on an era of chunky arcade corridor action; this project drops
that anchor entirely and rebuilds the visual system around a different reference
mood: **a 1930s grand-hotel travel poster after dark** — elegant, geometric, quiet,
and a little sinister. Gameplay frame (prd.md) is untouched; only the look changes.

## Why this direction (recorded choice)

Three candidates were weighed:

1. **Deco Noir** (chosen) — 1930s poster geometry, teal-night + brass palette,
   tall ivory-uniformed staff against dark architecture. Maximal fit with the
   "cozy grand hotel vs quiet paranoia" fantasy; hardest possible departure from
   arcade chunkiness; flat 2-tone shapes stay cheap to author deterministically.
2. Ink & wash storybook — softer, but soft edges fight pixel-art rendering and
   blur the trash-state shape reads the game depends on.
3. Chalk/pastel liminal hotel — strong mood, but low contrast between character
   and environment fails the silhouette gate at 64 px tall.

Decision: candidate 1. The elevator (the old reference's signature prop) is
deliberately NOT a visual anchor here — the corridor door rhythm and light pools
are. Elevator sprites, if/when produced under this direction, simply inherit the
deco language below; no shaft spectacle.

## Game frame

- **Player fantasy:** the same prd.md fantasy, restaged — you are staff in a
  grand deco hotel at night, and the building itself is beautiful enough that
  everyone assumes nobody would dare mar it. Damage reads as a wound.
- **Core verbs:** unchanged (walk, enter/exit rooms, prep, read door cards,
  accuse). Visual anchor shifts from transit machinery to the door zone.
- **Engine and renderer:** Phaser 4 canvas world + DOM overlay (unchanged).
- **Target platforms:** desktop browsers, keyboard (unchanged).
- **Camera/view/facing:** side-on orthographic, one floor strip at a time,
  strict profile with flip (unchanged).
- **Native viewport:** 832×576 today; the 960×576 (=32 px/tile) recommendation
  from the main brief is carried over unchanged — it matters MORE here, since
  deco geometry loves clean tile multiples.
- **Typical asset size on screen:** characters 34×64 px (taller, thinner than
  the current 28×60 — elongation is the style's spine). Doors 72×96 incl.
  stepped pediment. Sconce + light pool ≈ 24×40 px prop + baked glow.

## Visual system

- **Shape language:** vertical rectangles, stepped/ziggurat lintels, arch tops,
  chevron and sunburst motifs, elongated figures. Everything architectural
  composes from stacked clean rectangles; the only curves are arches and light
  pools. Furniture is rectangular with one chamfered corner max.
- **Silhouette priorities:** character reads as a tall light figure against dark
  wall — an inverted relationship vs the current brief (dark figure on cream
  wall). Room state must read through the open doorway as a *shape* before
  color: prepped = clean floor plane + aligned furniture inside a warm light
  pool; trashed = clutter breaking the floor line into jagged silhouette.
  Door cards read as a small ivory rectangle with brass seal at eye height.
- **Value structure (grayscale gate):** lightest band = characters (ivory) +
  light pools; mid = walls; mid-dark = carpet; darkest = night backdrop,
  interiors in shadow. A walking character must separate from wall AND carpet
  in grayscale, in motion, at native scale.
- **Palette roles and exact swatches** (≤ 24 colors total):
  - Night backdrop (outside the floor strip): ink teal `#0f1b21`.
  - Wall field: slate teal `#33505a`; deco frieze band (upper 15%): `#42636e`
    with repeating chevron in dim brass `#8a6a2f`; wainscot `#24333b`.
  - Carpet: deep burgundy `#5c2430` with brass diamond chain `#b3873a` on the
    center line and edge borders (geometry does the "expensive hotel" work).
  - Uniform (identical for ALL players — no saboteur tell): ivory mess jacket
    `#f2ead8`, jacket shade `#cfc3a8`, charcoal trousers + cap `#23232b`,
    brass cap band + buttons `#c9a13b`, white gloves `#f6f1e6`.
  - Skin: `#d9a878`, shade `#b3835c`.
  - Doors: dark walnut `#3a2620`, panel line `#2b1b17`, brass trim `#c9a13b`.
  - Door card: ivory `#f6f1e6` + brass seal `#c9a13b`.
  - Light (sconces, prepped rooms): candle core `#f4d9a0`, halo `#e8b464`.
  - Trash cues (FR-12): fresh = sickly chartreuse accents `#a4b06a`; settled =
    dust gray-brown `#5a5148`. Clutter = jagged dark clusters, never gore.
- **Materials and surface cues:** flat 2-tone fills (base + one darker-self
  shade), no gradients, no dithering. Brass = base + 1px dark seam on the lower
  edge only. Marble/wall = single flat tone; the frieze pattern carries all
  ornament. Trash = scattered small polygons + paper scraps.
- **Edge/line treatment:** hard edges, zero anti-aliasing (pixelArt: true), no
  outlines anywhere — separation comes from value contrast, not line. Characters
  get NO outline even against light pools; the ivory/pool overlap is resolved by
  the pool never sitting at walking height on the carpet strip.
- **Lighting direction and contrast:** sconce pools above door lintels, warm;
  prepped rooms emit a light pool that spills one tile past the threshold.
  Trashed-fresh rooms read cooler (chartreuse accents, pool suppressed). Baked
  shading only; no runtime lights in MVP.
- **Detail density and focal hierarchy:** (1) door zone — pediment, card, frame;
  (2) characters; (3) room interior near the doorway. Corridor between doors is
  quiet: flat wall + carpet geometry only, so the door rhythm reads as beats.
- **Motion character:** unhurried and gliding rather than bouncy. 6-frame walk,
  long strides, minimal vertical bob (≤ 1 px), 1-frame turns, work channel =
  a repeating "bend + wipe" loop. **FR-9 hard rule: work animation identical
  for every role — no variant may hint at sabotage.**
- **Explicit exclusions:** no arcade-style chunky masonry or coin-op aesthetics;
  no blood/violence (property crime only, PRD §2); no visual saboteur tell; no
  room interior visible from the hall except door cards (FR-10/11); elevator
  panels position-only, never occupants (FR-6); HUD stays coverage % + timer in
  DOM (FR-14); no living-artist style names; no gradients or soft shadows
  (rendering is nearest-neighbor).

## Technical contract

- **Asset dimensions/aspect:** characters 34×64 px (sheet of 6 walk frames +
  1 idle + 4 work frames, uniform frame size). Doors 72×96 px incl. pediment.
  Room interiors one opaque canvas per room-size class (unchanged from main
  brief). Sconce prop 24×40; light pool baked into a 48×16 ground ellipse strip.
- **Alpha/background:** transparent PNG for characters, props, doors, sconces.
  Room interiors opaque.
- **Grid/tile/frame size:** single global pixel grid; the 4 px master grid rule
  from the main brief is carried over until the 960-wide viewport decision
  lands. All architecture snaps to tile columns; chevrons repeat on a 16 px pitch.
- **Anchor/pivot/baseline:** characters anchor bottom-center on the ground line
  (y=430 today); doors bottom-center on threshold; sconces bottom-center on the
  wall at lintel height. Pivots never move between frames.
- **Filtering/mipmaps/compression:** Phaser `pixelArt: true` (nearest, no
  mipmaps), PNG-24, palette-locked before export.
- **Color space:** sRGB.
- **Texture budget:** ≤ 12 sheets total, whole set < 2 MB (same envelope as the
  current direction; the taller frames fit the same sheets).
- **Naming and folders:** if approved, production art lives in the existing
  `apps/client/public/art/{chars,rooms,props,doors,elevator}` with kebab-case
  names (`staff-walk-6f.png`); proposal-phase seeds live in
  `docs/art/alternative/seeds/` and are NOT referenced by the client build.

## Visual target (approval gate before production)

- **Hero target:** one staff character (idle + 6-frame walk, both facings) +
  one open-door triptych (prepped / trashed-fresh / settled) + two sconce pools,
  composited into a native-scale corridor mock — exactly what
  `scripts/art/generate-alternative-styleboard.py` emits as its seed board.
- **Required do/don't:** do — identical uniforms, silhouette-first trash
  clutter, card readable from the hall, quiet corridor between doors; don't —
  any role tell, interior bleed past the doorframe, arcade chunk, gradients,
  palette growth past 24.
- **Approval owner/date:** art workstream + design owner, before any family
  production. Judge at native resolution over the seed board's corridor.
