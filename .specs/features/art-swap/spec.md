# Art-Swap Specification (cycle 2.10)

## Problem Statement

The world plays correctly but renders as gray-box primitives: labeled player
rectangles, DOM door frames, car ellipses, and a DOM panel flash. The AD-020 art
workstream has authored and in-engine-verified the production sheets (staff walk,
doors, door card, elevator car, elevator panel, corridor band, room-interior
triptych, rustle FX) plus a safe additive slice (band, wall fill, rustle FX).
The gray-box primitives must now be replaced by the production art — the swap the
PRD named ("Elevator Action pixel style comes later") — without changing any
behavior, protocol message, or tuning value, and without ever widening what a
client can see (FR-9 identical work presentation, FR-10 hallway opacity,
FR-20 spectator-only interiors).

This cycle rewrites the harness count contract (the `type === 'Rectangle'` /
`'Ellipse'` filters the LIGHT/MOVE/WORK/ELEVATOR scenarios assert on), which is
why it is a spec'd cycle of its own rather than an art-side edit.

## Goals

- [ ] Players render as animated staff sprites (walk cycle, facing, idle) instead
      of rectangles, verified by the `client:art_players` gate scenario.
- [ ] Doors render as production door sprites with interiors visible only through
      an open own-room doorway or the spectator overview, verified by
      `client:art_doors`.
- [ ] Elevator cars render as open/closed cage sprites with the position-only
      panel flash, verified by `client:art_elevator`.

## Out of Scope

| Feature | Reason |
|---|---|
| Any protocol, sim, server, or tuning change | Rendering-only cycle; grep-clean message catalog unchanged |
| DOM overlay art (join, lobby, HUD, toasts, results/recap) | Separate Phase 3 surface; stays plain DOM |
| New art assets | The 12-asset manifest set is already authored (AD-020) |
| 960×576 viewport change (AD-020 open decision) | Deferred to Phase 3; assets are size-agnostic at the current frame |
| Audio polish, uniforms/cosmetics, room themes | PRD §10 parking lot |
| Corridor band, wall fill, rustle FX | Already landed additively (AD-020 slice); this cycle only amends assertions that touch them |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| New scene-children contract | Per live view: one `Sprite` (texture `staff-walk`) + one `Text` label per player; one `Sprite` per elevator car (texture `elevator-car`); one `Image` per room-segment door (texture `door-closed`/`door-open`); interior `Image` only where ART-05/07 allow; TileSprite band, wall Graphics, rustle FX Sprites as landed in the AD-020 slice | Replaces the AD-005 "Rectangle-per-player + Ellipse-per-car" contract; every swapped primitive keeps a 1:1 object mapping so position/lerp/ownership logic is untouched | n (agent default, autonomous run) |
| Harness count migration | The count assertions in `round`, `movement`, `work`, `spectator`, `elevator-doors` specs move from `type === 'Rectangle'/'Ellipse'` filters to texture-based filters (`texture.key === 'staff-walk'`, `'elevator-car'`) via the existing `window.__TURNOVER__` children listing | Deterministic, grep-auditable, and role-blind — the filters cannot leak a role they cannot see | n (agent default) |
| Facing convention | Sheet faces right; left = `flipX` | Sheet is authored right-facing (AD-020) | n (agent default) |
| Idle presentation | Frame 0 of the walk sheet, no animation, while not moving | No separate idle sheet exists in the manifest; a dedicated idle pose is Phase 3 polish | n (agent default) |
| Walk anim drive | Play while the display's movement is live (own predicted movement or non-settled lerp target); stop back to frame 0 when settled | Matches the existing prediction/reconciliation model; no server signal needed | n (agent default) |
| Work animation (FR-9) | The work channel keeps its DOM progress bar; the character sprite keeps the idle pose during a channel (no special work animation exists in the manifest) | FR-9 requires identical presentation across roles — the safest identical presentation is *no* role-specific animation; a shared work loop is a Phase 3 addition with its own FR-9 audit | n (agent default) |
| Door-open trigger | The existing `room:entered` cue window renders `door-open` (plus interior per ART-05) for the cue's duration, exactly where the DOM cue marker renders today | FR-10: the opening is the visible cue; pass-through entries fire `room:entered` (cycle 2.7), so pass-through also shows the opening | n (agent default) |
| Interior render source | Only (a) the own `room:observed` interior while the own player stands inside its segment, and (b) the FR-20 spectator baseline's room states | FR-10: room state readable only while inside; spectator is the explicit privilege exception | n (agent default, protocol rule) |
| State→texture mapping | `prepped` → `room-prepped`, `trashed` → `room-trash-fresh`, `settled` → `room-trash-settled`; the protocol's `'fresh'` (clean init state) renders as `room-prepped` (a never-prepped room is tidy) | Cycle 2.7 pinned the union prepped/trashed/fresh/settled; the art triptych covers the three *visual* states | n (agent default) |
| Door tints | The gray-box door state tints (own-room `roomStates` + spectator baseline) are removed with the DOM frames; state now reads through the interior texture only | FR-10: the hallway sees nothing of interiors except door cards; a tinted frame is a state oracle the brief forbids | n (agent default) |
| Elevator car frames | Frame 0 (doors open, cage bars) during the presenter's open-door episodes; frame 1 (closed slab) otherwise — the presenter already drives open/hide/transit states (ELAN) | Presenter owns the door episode clock; the sprite swap is a texture change under it | n (agent default) |
| Panel flash | The DOM panel flash (call-registered green flash) becomes the `elevator-panel` sprite's idle/flash frames at each landing; occupants are never rendered (FR-6) | Same data-only pulse as AD-019; decoy flashes are server-driven and art-blind | n (agent default) |
| Spectator overview | Stacked lanes keep the plain backdrop (no per-lane band) but DO render interior Images per the baseline states | Band-per-lane doesn't fit the 130px lane pitch; interiors are FR-20 privilege and are the point of the overview | n (agent default) |

**Open questions:** none — all resolved or logged above (autonomous run: agent
defaults stand unless a playtest/AD amends them).

---

## User Stories

### P1: Players are staff sprites ⭐ MVP

**User Story**: As a player, I want everyone in the hotel to appear as an animated
bellhop so that the world reads as a hotel shift instead of a physics test.

**Why P1**: The character is the hero asset (AD-020 visual target); everything
else composes around its scale.

**Acceptance Criteria** (each line is one EARS pattern):

1. **ART-01** — WHEN the world mounts THEN the scene SHALL render one `staff-walk` Sprite per
   player at that player's position and one name Text label, and SHALL NOT render
   any player Rectangle.
2. **ART-02** — WHEN a player's display is moving THEN the sprite SHALL play the 8-frame walk
   cycle; WHEN the display settles THEN the sprite SHALL return to frame 0 (idle).
3. **ART-03** — WHEN a player moves left THEN the sprite SHALL face left (`flipX` of the
   right-facing sheet); WHEN they move right THEN the sprite SHALL face right.
4. **ART-04** — The system SHALL render the identical texture, animation set, and frame
   timing for every player regardless of role — no visual, timing, or anim-set
   difference may exist between the saboteur and staff (FR-9).
5. **ART-05** — WHEN a player is fired THEN their sprite and label SHALL be removed exactly as
   the rectangle was (justice removal, cycle 2.8 semantics unchanged).

### P1: Doors, doorways, and the interior read

**User Story**: As a player, I want doors to look like hotel doors and a room's
interior to appear in its open doorway — but only when I am the one inside
(or watching as a fired spectator).

**Why P1**: This is the FR-10/FR-12 evidence read wearing its production skin;
the anti-leak half is the product.

**Acceptance Criteria** (each line is one EARS pattern):

6. **ART-06** — WHEN the world mounts on any guest floor THEN each room segment SHALL render
   a `door-closed` Image, phase-free (pre-round and round alike), replacing the
   DOM `#doors-layer` frames.
7. **ART-07** — WHEN a `room:entered` cue is live for a room on the viewed floor THEN that
   room's doorway SHALL render `door-open` for the cue's duration, at every
   viewing position that receives the cue (same-floor hallway included).
8. **ART-08** — WHEN the own player stands inside a room's segment THEN that doorway SHALL
   render the open door with the interior Image behind it, mapped
   `prepped|fresh` → `room-prepped`, `trashed` → `room-trash-fresh`,
   `settled` → `room-trash-settled`.
9. **ART-09** — IF a viewer is not inside the room (and is not a fired spectator with the
   FR-20 baseline) THEN no interior Image for that room SHALL exist in their
   scene, and the doorway SHALL show nothing beyond the open door frame.
10. **ART-10** — The gray-box door state tints SHALL be removed: no door frame, doorway, or
    hallway element may encode a room state for a room the viewer has not
    observed (FR-10; the door card remains the only hallway state leak).
11. **ART-11** — WHEN the round ends and the lobby returns THEN door Images SHALL persist
    phase-free as the DOM frames did (AD-015 pre-round contract).

### P1: Spectator overview keeps its privilege

**User Story**: As a fired player, I want the full-building overview to show
every room's interior so that I can follow the argument after firing (FR-20).

**Why P1**: The overview is the explicit FR-20 exception; losing it would gut
the post-firing experience.

**Acceptance Criteria** (each line is one EARS pattern):

12. **ART-12** — WHEN a fired player's spectator baseline names a room's state THEN the
    overview SHALL render that room's interior Image (per the ART mapping)
    behind its door on the room's lane.
13. **ART-13** — WHEN the fired view renders THEN stacked lanes SHALL keep the plain
    backdrop (no corridor band per lane) and all ART-01..04 presentation
    rules SHALL apply per lane.
14. **ART-14** — WHEN a live (non-fired) player's client runs THEN their scene SHALL contain
    interior Images for at most the one room they stand inside, regardless of
    how many rooms are trashed building-wide.

### P1: Elevator cars and the position-only panel

**User Story**: As a player, I want elevator cars that look like brass cages and
landing panels that flash on calls so that the vertical read matches the hotel.

**Why P1**: Cars and panels are load-bearing evidence surfaces (FR-5/FR-6);
they must not gain or lose information in the swap.

**Acceptance Criteria** (each line is one EARS pattern):

15. **ART-15** — WHEN a car is parked or dwelling THEN the scene SHALL render its
    `elevator-car` Sprite with the doors-open frame; WHEN the presenter enters
    transit or a closed-door state THEN the Sprite SHALL show the closed frame
    or hide, per the ELAN contract (cycles 2.6/2.9 semantics unchanged).
16. **ART-16** — WHEN a boarding or exit episode renders THEN the Sprite swap SHALL NOT
    change any boarding predicate, dwell timing, or reveal rule (ELR/AD-017
    behavior preserved verbatim).
17. **ART-17** — WHEN a call registers at a landing THEN the panel SHALL render the
    `elevator-panel` flash frame for the flash window and SHALL return to idle,
    including decoy flashes (FR-5; panel content is car positions only —
    occupants are never rendered, FR-6).

### P2: Gate-contract migration and visual-target approval

**User Story**: As the team, I want the harness count contract rewritten
deterministically and the visual target formally approved so that later cycles
build on a stable, signed-off visual base.

**Why P2**: Bookkeeping that unblocks every future client cycle.

**Acceptance Criteria** (each line is one EARS pattern):

18. **ART-18** — The harness specs (`round`, `movement`, `work`, `spectator`,
    `elevator-doors`, `boot`) SHALL assert the ART children contract via
    texture-based filters, and SHALL NOT reference `type === 'Rectangle'` or
    `'Ellipse'` counts for swapped primitives.
19. **ART-19** — The amended scenarios SHALL preserve their original behavioral assertions
    (labels, positions, counts, visibility semantics) — the swap changes only
    what kind of object is counted.
20. **ART-20** — WHEN the cycle closes THEN the manifest's swapped assets SHALL be marked
    `approved` with `in_engine_reviewed` evidence and the AD-020 visual-target
    approval recorded in STATE.md.

---

## Gate Mapping

| ACs | Gate scenario | Runner |
| --- | --- | --- |
| 1–5, 18–19 | `client:art_players` (new) + amended `client:round_start`, `client:movement`, `client:work_channels` | Gate 3 harness |
| 6–11, 18–19 | `client:art_doors` (new) + amended `client:doors_pre_round`, `client:evidence_cues` | Gate 3 harness |
| 12–14 | amended `client:spectator_overview` | Gate 3 harness |
| 15–17, 18–19 | `client:art_elevator` (new) + amended `client:elevator_doors`, `client:elevator_riders` | Gate 3 harness |
| 20 | STATE.md + manifest bookkeeping | Gate 4 human review |

Gates 1 (`pnpm typecheck`, `pnpm biome check`) and 2 (`pnpm test:sim`) stay green
unchanged — no sim or server code is touched. Human 5-minute round check (Gate 4)
covers the visual-target approval before the manifest flips to `approved`.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| ART-01 | P1: Players are staff sprites | Execute | Done |
| ART-02 | P1: Players are staff sprites | Execute | Done |
| ART-03 | P1: Players are staff sprites | Execute | Done |
| ART-04 | P1: Players are staff sprites | Execute | Done |
| ART-05 | P1: Players are staff sprites | Execute | Done |
| ART-06 | P1: Doors, doorways, and the interior read | Specify | Planned |
| ART-07 | P1: Doors, doorways, and the interior read | Specify | Planned |
| ART-08 | P1: Doors, doorways, and the interior read | Specify | Planned |
| ART-09 | P1: Doors, doorways, and the interior read | Specify | Planned |
| ART-10 | P1: Doors, doorways, and the interior read | Specify | Planned |
| ART-11 | P1: Doors, doorways, and the interior read | Specify | Planned |
| ART-12 | P1: Spectator overview keeps its privilege | Specify | Planned |
| ART-13 | P1: Spectator overview keeps its privilege | Specify | Planned |
| ART-14 | P1: Spectator overview keeps its privilege | Specify | Planned |
| ART-15 | P1: Elevator cars and the position-only panel | Specify | Planned |
| ART-16 | P1: Elevator cars and the position-only panel | Specify | Planned |
| ART-17 | P1: Elevator cars and the position-only panel | Specify | Planned |
| ART-18 | P2: Gate-contract migration and visual-target approval | Specify | Planned |
| ART-19 | P2: Gate-contract migration and visual-target approval | Specify | Planned |
| ART-20 | P2: Gate-contract migration and visual-target approval | Specify | Planned |
