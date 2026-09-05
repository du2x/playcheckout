# Art roadmap — Turnover

Status: Draft v1 (D1–D3 rulings pending before cycle 4.2 starts) · Owner: art workstream

Companion to `prd.md` (product contract), `roadmap.md` (build plan — Phase 4 points
here for the visual cycles), the adopted Deco Noir brief
([alternative/art-direction-brief.md](alternative/art-direction-brief.md), AD-029),
and [asset-manifest.json](asset-manifest.json) (per-asset contract). This roadmap
sequences the push from the current simple look to a finished one. It changes no FR,
no tuning value, and no protocol surface — every cycle here is client rendering
unless its row says otherwise.

## Where the look stands (2026-09-04 baseline)

The direction is adopted but roughly one-third realized:

- **Authored** (deterministic Pillow scripts in `scripts/art/generate-*.py`, every
  sheet under ~1.3 KB): staff body + variant overlay sheets (34×64, AD-045), guest
  archetype silhouettes (grayscale tint carriers), room doors + elevator landing
  door/panel, the corridor band tile, three room interiors, the rustle FX.
- **Still code-drawn in `WorldScene`**: the wall field (Graphics fill), the chevron
  frieze + pool ellipses (drawn once per mount), elevator/stairs interior screens
  (rectangles + text), tenancy markers, name labels.
- **Juice v1** (`juice.ts`, AD-045): settle pop, foot-tap, anger pop + dust puffs,
  camera shake (reserved to fired/ambushed).
- **Unused engine capability**: Phaser 4.2.1 ships GameObject FX (glow, shadow, blur,
  vignette, gradient map, pixelate, displacement) and a particle system — the client
  uses none of it. No runtime lighting, no atmosphere layer.

The corridor is the majority of the frame and is a flat fill today. That gap — not
the direction — is why the game reads "simple". Most of the perceived-quality gain
is finishing what the brief already specifies, then a rendering/atmosphere pass the
current brief deliberately excludes.

## Decisions required before production (each lands as an AD)

| ID | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Contract scope: finish Deco Noir inside the current locks (≤24 colors, no gradients, baked light only, ≤12 sheets / <2 MB) or amend the visual contract for a rendering/FX layer? | (a) stay inside the locks · (b) amend narrowly: palette locks stay on authored art, soft FX (additive glows, vignette, particles) allowed as a render layer on top · (c) full re-contract | **(b)** — the amendment pattern is AD-029 superseding AD-020; soft glow over nearest-neighbor pixels is the standard "stunning pixel art" recipe but fights the brief's "no gradients" letter, so it must be a recorded amendment, not a drift |
| D2 | Authoring method for the visual leap past programmatic rectangles | (a) deterministic Pillow only (today) · (b) hand-authored pixel art (Aseprite) · (c) AI-assisted generation · (d) commissioned | **hybrid**: architecture/geometry stays scripted (determinism + palette enforcement are free there); focal/organic art (characters, clutter, interiors) may go (b)/(c). The manifest `source` block already records kind/tool/license/provenance per asset — "no generation model" is today's recorded state, not a rule |
| D3 | Presentation/scale strategy: integer zoom, `roundPixels`, high-DPI crispness at fullscreen | (a) keep 960×576 letterboxed · (b) integer camera zoom + pixel snapping at fullscreen | **(b)**, landing in 4.7; decide the contract before 4.2 authors full-screen-filling art |

Deciding D1/D2 before cycle 4.2 starts avoids authoring sheets twice (the AD-030
lesson: geometry decisions land before the family, not after).

## Phase 4 visual cycles

Art cycles are rendering-only client work and interleave freely with gameplay cycles
(the AD-020 parallel-workstream precedent). Phase 4 numbering continues from the
shipped 4.1; no locked table exists yet, so plain numbers stand (the 3.A letter
precedent applies only if gameplay cycles later claim 4.x slots).

Cycle rules (inherited from the roadmap phase rules):

- Manifest entries land BEFORE authoring (phase rule); sheet-contract changes ride an
  AD; texture keys are the harness contract — sheet changes update the affected
  `client:*` specs in the same cycle.
- Every cycle ends with gates 1–3 green (typecheck/lint, test:sim, targeted harness)
  plus the human 5-minute round — mood is a Gate-4 judgment, not automatable.
- Hidden-info gates re-checked every cycle (list below).

| Cycle | Feature | Scope | New gates |
|---|---|---|---|
| 4.1 | `visual-polish` | **SHIPPED (AD-045)** — 34×64 cast, variant overlay, guest archetypes, corridor Deco ornament, juice v1 | see AD-045 |
| 4.2 | `environment` | Author the corridor for real — the single biggest lever (~80% of the frame). Wall field with frieze band, wainscot, door pediments, quiet-corridor discipline between doors. Replaces the code-drawn Graphics fills/wall fill in `WorldScene`; live view only (spectator overview inherits). No sconce/candle props — removed by user ruling 2026-09-04. Needs D1+D2 decided. | `client:art_environment` (+ corridorDepth amendments) |
| 4.3 | `lighting-atmosphere` | The mood pass — needs D1(b). Additive-blend glow on prepped-room light pools, lit door cards, prepped-room spill one tile past the threshold (brief-sanctioned); scene-wide vignette; dust motes (particles); cooler read on trashed-fresh rooms. Phaser 4.2.1 FX/particle surface verified present — exact per-object vs camera API confirmed in the cycle's Design phase. | `client:atmosphere` |
| 4.4 | `cast-motion` | Finish the deferred sheets: `staff-work-channel` (requires its own FR-9 audit — frames byte-identical for every role), guest walk cycles (guests are static single frames today), idle micro-variants; motion polish stays inside the brief's "unhurried gliding" character (≤1 px bob, 1-frame turns). | `client:cast_motion` (asserts the FR-9 byte-identical pin) |
| 4.5 | `juice-systematic` | Extend `juice.ts` from one-off cues to systems: elevator door swing + arrival settle, complaint-counter escalation, buzzer sequence, round-start establishing shot. Camera shake stays reserved to fired/ambushed (the `shouldShake` gate — routine motion never shakes). | `client:juice_systems` |
| 4.6 | `overlay-restyle` | The DOM overlay inherits Deco Noir: deco display typography, ivory/brass/ink panels, animated transitions, consistent iconography (lobby, HUD, door cards, walkie log, results/recap). Half the screen is DOM — cheap relative to impact. No HUD art oracle (FR-14 stays). | `client:overlay_style` |
| 4.7 | `presentation` | D3 lands: integer zoom + pixel snapping at fullscreen/high-DPI, perf pin for the FX + particle budget over the 960×576 canvas, final native-scale review of the whole set. | `client:presentation` |

Dependency notes: 4.2 → 4.3 (glow needs authored pools/props to attach to);
4.4 is independent of 4.2/4.3 and can interleave; 4.5 wants 4.3's arrival/settle
beats but can start on elevator timing alone; 4.6/4.7 are fully independent.
4.2–4.7 may compress into fewer passes if D2 chooses fast authoring — the order,
not the count, is the contract.

## Constraints that never bend (re-checked every cycle)

- **No visual saboteur tell anywhere.** Work animation identical for every role
  (FR-9) — pinned by byte-comparison, not eyeball. Uniforms identical; guest
  archetypes never carry staff ivory/brass (VPOL-07).
- **Atmosphere is not a leak channel.** Light pools, glows, and particles may only
  visualize state the wire already publishes (door cards, tenancy signs,
  `elevator:doors`) — never room occupancy, grace state, roles, or anything a
  hallway player cannot legitimately know (FR-6/FR-10/FR-11).
- **HUD stays DOM** — coverage/timer/complaints only (FR-14); the overlay restyle
  adds style, never oracle surface.
- **Production builds ship no debug hooks** (`window.__TURNOVER__` stays
  test-only).
- **Tuning untouched.** Any number an FX idea needs (shake intensity, glow strength,
  particle rates) is client-cosmetic in `juice.ts`-style modules, never a `TUNING`
  row; a gameplay-relevant constant requires an AD per the tuning rule.
- **Texture budget** stays ≤12 sheets / <2 MB unless D1 amends it.

## Verification per cycle

1. **Asset QA** — per-sheet palette count, alpha coverage, guest ivory/brass
   denylist, dimensions/anchors against the manifest; results recorded in the
   manifest `verification` block (the cast/door precedent).
2. **Native-scale mock** — corridor mock composited at 960×576 before in-engine
   wiring (the `/tmp/opencode/*-corridor-mock.png` pattern from AD-045).
3. **Gate 3** — named `client:*` scenarios over the real server+client harness;
   grayscale-separation and silhouette checks from the brief where the cycle touches
   characters/rooms.
4. **Gate 4** — human 5-minute round; the brief's value-structure gates (character
   separates from wall AND carpet in grayscale, trash reads as shape before color)
   judged over the real game, not mockups.

## Adjacent, deliberately out of scope here

- **Audio-visual sync** (elevator chime with the door swing, desk bell with the
  anger cue) — a large perceived-polish multiplier that rides the same beats 4.3/4.5
  build; schedule as its own cycle if wanted.
- **Spectator overview restyle** (FR-20 full-building view) — inherits 4.2/4.6
  output; no dedicated cycle planned.
- **Seeds/style boards** for a future direction change — the
  `generate-alternative-styleboard.py` pattern; not needed while Deco Noir holds.
