# Room zoom (work-channel camera focus inside room segments)

Status: IMPLEMENTED (2026-09-05) — see AD-055 (amended: trigger is
channel-gated per user ruling, superseding the ambient variant). Gates:
typecheck ✓ · biome clean on touched files · `pnpm test:sim` green ·
`client:room_zoom` green · neighbor scenarios (stairs/evidence/movement/
doors/work) green against the DOM layer split.
Feature size: Small — presentation-only, `apps/client` only.

## Goal

While the own player runs a work channel inside a room segment — staff prep,
saboteur un-prep, or fake prep (FR-7/8/9) — the camera eases to an integer 2×
zoom centered on their position, framing the room interior plus the adjacent
corridor; when the channel ends (completion or the FR-16 walk-out cancel) it
eases back to the exact identity view. The corridor stays visible and
populated (FR-10/FR-15/FR-16 unchanged) — the far ends of the floor simply
fall out of frame while the character works, reading as "heads-down at work".

## Decisions (2026-09-04/05)

- **Trigger**: a running work channel of the own player — the self
  `work:started` → `work:ended` window. The user first chose ambient
  (whenever inside a segment), then ruled post-implementation for
  channel-gated ("the zoom must go only when char begins the work");
  AD-055 records the amendment. Walking out mid-channel cancels (FR-16) and
  restores the view.
- **Zoom level**: integer 2× target per the AD-049 presentation contract
  (pixelArt + roundPixels: non-integer scales shimmer). Eased, not snapped.
- **Scope guards**: spectator (fired) viewers never zoom (FR-20 overview is
  the fired player's privilege and contract). Floorless states — riding a
  car, stairs transit/stun — never zoom (their interiors are full-screen
  canvases/scrollFactor(0) surfaces; zooming under them is undefined visuals).
  The breath stands at the west mouth, outside every segment, and is excluded
  naturally.

## Requirements (EARS)

- R1: WHILE the own live player runs a work channel inside a room segment on
  a guest floor THE CLIENT SHALL ease the camera to zoom 2, centered on the
  player x and the floor lane, scroll clamped to world bounds.
- R2: WHEN the channel ends (completion, cancel, firing) or the player walks
  out of the segment, or is floorless, or is a spectator THE CLIENT SHALL
  ease the camera back to exactly zoom 1 and scroll (0, 0).
- R3: AT REST (no zoom active) THE CLIENT camera state SHALL be byte-identical
  to the identity view — zoom 1, scroll (0, 0) — preserving the DOM
  overlay alignment contract for every world-anchored marker.
- R4: WHILE zoom ≠ 1 THE CLIENT SHALL render the world-anchored DOM marker
  layer (`#evidence-layer`: card markers, tenancy signs, cue nodes, the
  stairs glyph) through one shared world→screen transform, so no marker
  desyncs from its world position. Screen-space DOM (sfx toggle, ambush
  toast/confirm) lives in an untransformed `#ui-layer` sibling; the work bar
  and room label are `#round-hud` HUD and were never world-anchored.
- R5: THE zoom trigger evaluation SHALL consume the shared layout predicates
  (`roomIndexAtMilli` over the own position) — no mirrored segment-membership
  expression (AD-037 pinch rule). The channeling fact is the own player's
  `work` channel state; the segment/floor predicates stay as the one-home
  guarantee that the zoom never fires outside a room.
- R6: THE feature SHALL change no sim, protocol, tuning, or server behavior —
  client rendering only (AD-053/AD-054 precedent).

## Acceptance criteria → gates

| AC | Scenario | Gate |
|----|----------|------|
| Zoom engages on channel start | `client:room_zoom` — staff (or saboteur fake) Space channel inside room 7; dev-hook camera state reports zoom → 2 | Gate 3 |
| Zoom restores on walk-out cancel | same scenario — FR-16 walk-out mid-channel; camera returns to exactly 1 / scroll 0 | Gate 3 |
| Spectator never zooms | unit `roomZoomActive` policy rows (spectator/riding/stair-box/lobby/outside-segment/no-channel) | Gate 1 |
| Pure math pinned | `zoomPresenter.test.ts` — targets, clamps, exact landing, transform mapping | Gate 1 (`pnpm test:sim` runs workspace vitest) |
| No hidden-state leak | scenario asserts camera state only; hook unchanged, dev-only | Gate 3 + protocol review |
| Typecheck + lint | — | Gate 1 |

## Assumptions

- The harness reads camera state through the EXISTING dev hook scene accessor
  (`__TURNOVER__.scene('Round').cameras.main`) — no hook surface change, and
  the production strip check (SKEL-08) is untouched.
- Camera easing passes through non-integer zooms transiently; the AD-049
  integer contract governs target/rest states, not animation frames.
- The world→screen transform from R4 ships as ONE CSS transform on the marker
  layer (`translate(-scrollX, -scrollY) scale(zoom)`, origin `0 0`) — mount-time
  marker positions and per-frame lane tops stay untouched.

## Out of scope

- Ambient standing zoom (superseded by the user ruling), full-screen room
  interiors (rejected — FR-15/16 corridor visibility is load-bearing),
  spectator zoom, elevator/stairwell interiors (full-screen already).
