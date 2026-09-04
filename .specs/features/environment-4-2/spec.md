# Phase 4.2 Environment — author the corridor for real

## Problem Statement

The corridor is ~80% of the frame and is still mostly code-drawn: the wall
field is a `Graphics.fillRect(0, 48, 960, 302)` (`WorldScene.ts:830-831`), the
chevron frieze and sconce pools are per-mount `Graphics`
(`buildCorridorDeco`, `WorldScene.ts:1884-1908`). Only the wainscot + carpet
strip is authored (`corridor-band` `TileSprite`, `WorldScene.ts:363-368`). The
direction is settled (Deco Noir, AD-029; render-layer amendment AD-047;
hybrid authoring AD-048; integer-zoom contract AD-049) — the game reads
"simple" because the brief's corridor is one-third built, not because the
brief is wrong.

This cycle authors the corridor wall for real and deletes the code-drawn
wall/frieze/pool `Graphics` from the live view. Rendering-only client work:
no sim, protocol, tuning, or server changes.

## Goals

- [ ] The live corridor wall (y48..350) is authored sheets — frieze band,
      wall field, wainscot cap — on the 32 px tile grid, replacing `wallFill`
      and the `deco-frieze` `Graphics`.
- [ ] Sconce props (brief 24×40) with baked pools (brief 48×16) sit above
      every door lintel as authored sprites, replacing the `deco-pools`
      `Graphics` ellipses.
- [ ] Door pediments complete the door rhythm; the wall between doors stays
      quiet (flat field + carpet geometry only).
- [ ] Spectator overview, HUD, and all wire behavior are untouched; texture
      budget holds (≤12 sheets / <2 MB, AD-047).

## Out of Scope

| Feature | Reason |
|---|---|
| Runtime glow, vignette, dust motes, cooler trashed-fresh read | Cycle 4.3 `lighting-atmosphere` (AD-047 render layer); 4.2 bakes pools only |
| Work-channel frames, guest walk cycles, idle micro-variants | Cycle 4.4 `cast-motion` (FR-9 audit) |
| Elevator/stairs interior screens, tenancy markers, name labels | Still code-drawn after this cycle; own cycles (4.5 / later passes) |
| DOM overlay restyle, integer-zoom implementation | Cycles 4.6 / 4.7 (AD-049 contract decided, implementation deferred) |
| Any sim, protocol, tuning, or server change | Rendering-only; `packages/sim` + registry untouched |
| Room interiors, cast, elevator door/panel sheets | Shipped (AD-029/AD-036/AD-045/AD-046 worktree); consumed, not re-authored |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| Base geometry | AD-046 (7 rooms/floor tiling `[2, 24.75]`, 80 px elevator door, `ELEVATOR_LANDING_TILES 2.5`, decoupled stair mouth) + the front-facing elevator-door swap land first — 4.2 builds on that worktree | 4.2 sconce/door-pediment x-positions derive from the 7-room layout; authoring against 8 rooms repeats AD-030's lesson | n (agent default; uncommitted worktree dependency, commit order noted in Design) |
| Sheet decomposition | Design phase decides: wall-field tile vs full-bleed panel, frieze as separate strip vs baked into wall, sconces as one spritesheet vs per-prop images | Tileable 32 px-period discipline (corridor-band precedent) vs draw-call count — a Design trade, not a requirement | n |
| Sconce placement | One sconce above every room-door lintel + landings/stair mouth treated as door-grade beats (exact set pinned in Design from `roomCenterPx` + landing x) | Brief anchors pools to door rhythm; the ~5.25-tile open east hall (AD-046) and room-less lobby need an explicit rule | n |
| Lobby + mezzanine walls | Same authored wall family as guest floors (no rooms → sconce pitch rule from Design, e.g. even spacing or landing-only) | Lobby/mezzanine share the live lane renderer; a second wall family doubles sheets for no read gain | n |
| Lane line | The brass lane line (`hallLines`, `WorldScene.ts:815-839`) stays code-drawn `Graphics` — it is a lane marker under the harness shape contract, not wall art | Comment at `WorldScene.ts:355`: Graphics-deliberately; 4.2 replaces wall/frieze/pool fills only | n (agent default) |
| Authoring tool | Deterministic Pillow scripts (`scripts/art/generate-*.py`), per AD-048 (4.2 is architecture/geometry — the scripted half of hybrid) | Determinism + palette enforcement are free for geometry; focal/organic stays out of 4.2 | y (AD-048) |
| Pool look | Baked flat 2-tone ellipses (core `#f4d9a0`, halo `#e8b464`, today's alpha ~0.1 shapes become opaque authored pixels); NO additive blend — that is 4.3's render layer | AD-047: authored art stays inside the locks; glow arrives as a layer on top | y (AD-047) |

**Open questions:** none — sheet decomposition and sconce set are Design-phase outputs, not spec blockers.

---

## User Stories

### P1: The wall is authored, the Graphics fills are gone ⭐ MVP

**User Story**: As a player, I want the hallway wall to look like a deco hotel
— frieze, field, wainscot — so that the corridor stops reading as a flat fill.

**Why P1**: The single biggest lever (~80% of the frame); the roadmap's 4.2 core.

**Acceptance Criteria** (each line is one EARS pattern):

1. **ENV-01** — WHEN the world mounts the live view on any floor THEN the
   scene SHALL render the corridor wall y48..350 from authored textures
   (frieze band with 16 px-pitch dim-brass `#8a6a2f` chevron on `#42636e`,
   slate-teal `#33505a` field, `#24333b` wainscot cap) instead of the
   `wallFill.fillRect` + `deco-frieze` `Graphics`.
2. **ENV-02** — WHEN the live corridor renders THEN no `Graphics` object named
   `deco-frieze` and no `wallFill` fillRect SHALL exist in the scene graph
   (the brass lane line `hallLines` and transient juice puffs are exempt).
3. **ENV-03** — WHEN the wall renders at 960×576 THEN all ornament SHALL snap
   to the 32 px tile grid with 16/32 px pitches (AD-030), tile seamlessly
   across the full width, and stay nearest-neighbor (`pixelArt: true`, no
   anti-alias, no gradients — AD-047 authored-art locks).
4. **ENV-04** — WHEN the wall renders THEN the stretches between doors SHALL
   stay quiet: flat field + carpet geometry only, no ornament except the
   frieze band (brief focal hierarchy — the door rhythm reads as beats).

**Independent Test**: `client:art_environment` — mount a guest floor, assert
authored wall textures cover y48..350, `deco-frieze`/`wallFill` fills absent,
screenshot at native scale for Gate-4 eyeball; `client:corridor_depth`
amended (frieze/pool `Graphics` assertions become authored-texture assertions).

---

### P1: Sconces with baked pools mark every door beat

**User Story**: As a player, I want a sconce glowing above each doorway so
that doors read as a rhythm down the hall and damage later reads as a wound
against a beautiful wall.

**Why P1**: Brief's light architecture (sconce 24×40 + pool 48×16); the pools
are what 4.3's glow layer will attach to (dependency 4.2 → 4.3).

**Acceptance Criteria**:

5. **ENV-05** — WHEN the live view shows a guest floor THEN the scene SHALL
   render one authored sconce prop (24×40, brass + candle core `#f4d9a0`)
   above every room-door lintel, at the Design-pinned x set (room centers +
   landing rule), replacing the `deco-pools` `Graphics` ellipses.
6. **ENV-06** — WHEN a sconce renders THEN its baked pool SHALL be flat
   authored pixels (core `#f4d9a0`, halo `#e8b464`, 48×16 ground ellipse
   strip per the brief) with no blend-mode, no alpha-gradient glow, and no
   runtime light — glow arrives in 4.3.
7. **ENV-07** — WHEN the sconce set is computed THEN positions SHALL derive
   ONLY from public layout geometry (room centers, landings — `layout.ts`)
   and never from occupancy, tenancy, room state, roles, or grace — sconces
   are static architecture, not a leak channel (FR-6/FR-10/FR-11).

**Independent Test**: `client:art_environment` sconce beat — count sconce
sprites == Design-pinned set on a guest floor; assert positions identical
with rooms trashed vs prepped (no state linkage); assert texture keys are
authored sheets, not `Graphics`.

---

### P1: Pediments complete the door rhythm

**User Story**: As a player, I want every doorway to carry its stepped deco
pediment so that the hall reads as one architectural family with the elevator
landing door.

**Why P1**: Roadmap 4.2 scope names door pediments; the elevator door
(AD-036 worktree) already speaks stepped-brass — room doors must match.

**Acceptance Criteria**:

8. **ENV-08** — WHEN any room door renders (open or closed frame) THEN it
   SHALL carry the stepped-brass pediment in the door family's lintel
   language (sibling to the elevator landing door's heavier lintel), either
   by sheet update or by a pinned Design verdict that the shipped pediment
   already satisfies the brief (verified by native-scale mock, not assumed).
9. **ENV-09** — WHEN the spectator overview renders THEN lanes SHALL keep
   their plain backdrop (no wall sheets, no sconces — AD-020 lane rule);
   the live lane alone carries 4.2 output.

**Independent Test**: `client:art_environment` pediment check — native-scale
mock composites room door + elevator door side by side for Gate-4 family
judgment; harness asserts door texture keys unchanged or re-pinned by Design.

---

### P2: Contract discipline (manifest, budget, grayscale)

**User Story**: As the art workstream, I want every 4.2 sheet contracted
before it is authored so that palette, budget, and harness keys never drift.

**Why P2**: Roadmap cycle rules + AD-048 provenance discipline.

**Acceptance Criteria**:

10. **ENV-10** — WHEN any 4.2 sheet is authored THEN its manifest entry
    (dimensions, palette count, anchor, `source`, `verification` block) SHALL
    land in `docs/art/asset-manifest.json` BEFORE the sheet bytes (phase
    rule), with per-sheet palette count, alpha coverage, and guest
    ivory/brass denylist where applicable.
11. **ENV-11** — The system SHALL keep the texture budget at ≤12 sheets total
    and the whole set <2 MB (AD-047); the cycle SHALL record the sheet count
    + byte total in the manifest notes.
12. **ENV-12** — WHEN the corridor renders THEN a walking ivory-uniformed
    character SHALL separate from wall AND carpet in grayscale (brief value
    structure — lightest = characters/pools, mid = walls, mid-dark = carpet,
    darkest = night), judged on the native-scale mock (Gate 4) with a harness
    luminance sampling assist.
13. **ENV-13** — WHEN 4.2 lands THEN gates 1–3 SHALL be green (typecheck/lint,
    `test:sim`, targeted `client:art_environment` + amended
    `client:corridor_depth`) and the hidden-info gates SHALL be re-checked
    (no interior/occupancy/role signal in any new texture or position rule).

**Independent Test**: manifest QA (`asset_report` palette/alpha/denylist per
sheet) + `client:art_environment` + amended `client:corridor_depth`; Gate 4
human 5-minute round for mood.

---

## Edge Cases

- IF an authored wall/sconce texture fails to load (`textures.exists` false)
  THEN the scene SHALL keep the current `Graphics` corridor fallback and SHALL
  remain interactive (graceful degrade, `WorldScene.ts:317` precedent) — never
  a missing-texture hole in the wall.
- IF the viewer is a fired spectator THEN lanes SHALL keep the plain backdrop
  (ENV-09); authored wall/sconce textures SHALL NOT mount per lane.
- IF the viewed floor is the lobby or mezzanine (no rooms) THEN the sconce
  rule from Design SHALL apply (even pitch or landing-only) and no room-door
  sconce SHALL render.
- IF `ROOMS_PER_FLOOR` changes again THEN sconce x-positions SHALL derive from
  `roomCenterPx` / shared layout (never hand-pinned px) so geometry edits
  cannot strand sconces mid-wall.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
|---|---|---|---|
| ENV-01 | P1: Authored wall | Execute | Pending |
| ENV-02 | P1: Authored wall | Execute | Pending |
| ENV-03 | P1: Authored wall | Execute | Pending |
| ENV-04 | P1: Authored wall | Execute | Pending |
| ENV-05 | P1: Sconce beats | Execute | Pending |
| ENV-06 | P1: Sconce beats | Execute | Pending |
| ENV-07 | P1: Sconce beats | Execute | Pending |
| ENV-08 | P1: Pediments | Execute | Pending |
| ENV-09 | P1: Pediments | Execute | Pending |
| ENV-10 | P2: Contract discipline | Execute | Pending |
| ENV-11 | P2: Contract discipline | Execute | Pending |
| ENV-12 | P2: Contract discipline | Execute | Pending |
| ENV-13 | P2: Contract discipline | Execute | Pending |

**Coverage:** 13 total, 0 mapped to tasks (Tasks phase pending), 13 unmapped

---

## Success Criteria

- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test:sim` green (no sim changes —
      proves zero churn in the deterministic core).
- [ ] `pnpm test:client` `client:art_environment` PASS — authored wall covers
      y48..350, `deco-frieze`/`wallFill`/`deco-pools` `Graphics` gone, sconce
      count == Design set, positions state-independent; amended
      `client:corridor_depth` PASS.
- [ ] Gate-4 5-min round: the corridor reads as a deco hotel after dark, the
      door rhythm beats down the hall, trash reads as a wound — mood judgment,
      not automatable.
