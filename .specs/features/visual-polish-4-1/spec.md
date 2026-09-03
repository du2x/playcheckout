# Phase 4.1 Visual Polish — Cast & Corridor (improved 3.A)

## Problem Statement

`3.A char-variants` shipped as a promise, not a product: no `cosmeticSeed` exists on the wire, staff render as a single `28×60 8f` sheet (`apps/client/public/art/chars/staff-walk-8f.png`), guests are `Phaser.GameObjects.Arc` circles (`WorldScene.ts:205` `GUEST_FILL 0xbfe3ff`), suitcases are `Rectangle`s, anger is `Text '!'`, and the corridor is a flat `TileSprite` + `Graphics` fill. The Deco Noir direction (`docs/art/alternative/art-direction-brief.md`, `AD-029` adopted) and `960×576 / 32px/tile` (`AD-030`, `main.ts:11`) are landed but the cast never used the `34×64` elongated frames the brief unlocks. The hotel reads as a test harness, not a grand hotel after dark — and `cosmeticSeed` decorrelation (the `FR-9` anti-leak gate) was never proven.

This cycle closes `3.A` properly, with Phaser 4 as the medium: layered staff variants, guest archetypes, a readable corridor, and proportioned game-feel — all rendering-only besides the public `cosmeticSeed` field.

## Goals

- [ ] Every player has a distinct, stable cosmetic variant (body + head/accent) that is decorrelated from role and never leaks the saboteur — proven by `variant ⊥ role` gate.
- [ ] Guests render as `3–4` archetype sprites × palette rotations, never staff ivory/brass, replacing the `Arc` markers — hallway-readable at `34×64` scale.
- [ ] The corridor reads as Deco Noir: wall, wainscot, carpet geometry + sconce pools are authored art + `Phaser.Graphics` ornament, at native scale, with grayscale separation.
- [ ] Motion reads as `hotel`, not `test`: walk/idle `Tween` ease, foot-tap `yoyo`, anger pop `BACK` overshoot — all via Phaser `Tween`/`Graphics`/`Particles`, decaying `Camera.shake` only for firing/ambush tiers.

## Out of Scope

| Feature | Reason |
|---|---|
| Any sim rule, tuning, or win-condition change | Rendering-only; `packages/sim` deterministic core untouched except `cosmeticSeed` assignment |
| Work-channel anim variant per role | `FR-9` forbids it — channel frames stay byte-identical for every role (deferred `staff-work` sheet) |
| Audio/sfx design | Visual half only; audio is `Phase 4.3` |
| New floors, rooms, or elevator dispatch logic | Layout `AD-010/AD-036` + single-car `AD-040` are locked |
| Server file I/O or telemetry schema change | `data/telemetry` + `kpis.ts` are `AD-044` frozen |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| `cosmeticSeed` scope | One `u32` per player (at role deal) and per guest (at spawn), drawn from a **role-decorrelated Rng stream** (dedicated `Rng` fork, not the role-deal stream); `guest` seeds live alongside the `AD-028` seeded dwell/arrival stream | `roadmap.md:116` `3.A` requires decorrelation; forking avoids tying variant distribution to saboteur selection | n (agent default, matches guest seeded pattern) |
| Recipient policy for `cosmeticSeed` | Public — registry `cosmetic:assigned` / piggy-backed on `player:joined` + `guest:arrived` payloads with `'all'` policy | `CONTEXT.md:55` `cosmetic variety is identity, never role` — public info, never hidden | n |
| Variant taxonomy | Staff: `8` variants = `2 skin × 2 hair × 2 accessory` (cap band / glasses / moustache) composited as **two `Sprite`s per player** (shared body `34×64` + variant head/accent `34×64` aligned `bottom-center`, same `flipX`) | Keeps body sheet invariant, head layer cheap, `FR-9` safe (walk/idle only) | n |
| Guest archetypes | `4` silhouettes (`suite` tall, `tourist` broad, `clerk` slim, `elder` stooped) × `4` civil palettes (teal / burgundy / ochre / slate) = `16` combos, none using staff ivory `0xf2ead8`/`0xf6f1e6` or brass `0xc9a13b`/`0xb3873a` | `roadmap.md:116` `3–4 silhouettes × 4 rotations` + Deco Noir palette gate `brief.md:80` | n |
| Staff frame geometry | `34×64` elongated (brief `34×64`, `AD-030` unlocked), walk `6f` + idle `1f`, `anchor bottom-center` on `GROUND_Y 430`, `pixelArt:true nearest`, `sRGB` | Brief `art-direction-brief.md:121` — integer `32px/tile` grid demands it | n |
| Sheet authoring path | Deterministic Pillow scripts (`scripts/art/generate-*.py`) as in `art-swap` (`asset-manifest.json:24` `staff-walk`), not model generation | Provenance `project-internal`, reproducible, palette-locked `≤24` colors | n |
| Harness contract delta | Old: `type === 'Rectangle'/'Arc'` + player label; New: `texture.key === 'staff-body'/'staff-variant'` + `guest-*` + `bottom-center` anchor + `flipX` parity; variant determinism via `seed→variantIndex` | Same pattern as `art-swap ART-18`, leak-safe | n |
| Corridor palette locks | Wall `0x33505a`, carpet `0x5c2430`+`0xb3873a` diamond, night `0x0f1b21` (`brief.md:80` exact swatches), sconce halo `0xe8b464` core `0xf4d9a0` | Deco Noir brief is locked (`AD-029`) — not invented here | n |

**Open questions:** none — all resolved or logged above; `validate_spec.py` structural gate must pass before confirmation.

---

## User Stories

### P1: Staff have stable, decorrelated variants ⭐ MVP

**User Story**: As a player, I want every bellhop to look slightly different (skin/hair/accessory) so that the hotel feels inhabited, without any variant hinting at who the saboteur is.

**Why P1**: Core of `3.A` — identity variety is load-bearing, role leak is the product to protect.

**Acceptance Criteria** (each line is one EARS pattern):

1. **VPOL-01** — WHEN a round is dealt THEN the server SHALL assign each player a `cosmeticSeed: u32` drawn from a dedicated `Rng` stream that is decorrelated from the role-deal stream, and SHALL include it in a public `'all'` registry payload observable by every client.
2. **VPOL-02** — WHEN a client receives a player's `cosmeticSeed` THEN the scene SHALL render that player as **two aligned Sprites** (`staff-body 34×64` + `staff-variant 34×64` overlay, `origin 0.5,1` on `GROUND_Y`, same `flipX`), with variant index `seed % 8` selecting `skin×hair×accessory`.
3. **VPOL-03** — The system SHALL render the identical body sheet, walk timing (`6f @12fps`), and frame geometry for every player regardless of role — no variant, palette, or timing difference may exist between saboteur and staff.
4. **VPOL-04** — The system SHALL guarantee `variant ⊥ role`: for any two players with different roles, the probability their `cosmeticSeed%8` collide is within chance (harness asserts: seeded deal `20` seeds × `6` players — at least one seed has different roles sharing the same variant, and at least one seed has same role with different variants), and the mapping SHALL be a pure function of `cosmeticSeed` only (never `isSaboteur`).
5. **VPOL-05** — IF a client re-joins mid-round (FR-25 `allowReconnection`) THEN the server SHALL re-send the same `cosmeticSeed` for that `playerId` and the scene SHALL re-derive the identical variant Sprites.

**Independent Test**: `sim:variant_decorrelation` (seed→variant pure function) + `client:char_variants` — join `6` players, observe `staff-body+variant` sprites, assert `flipX` parity, `8`-bucket distribution, and cross-seed `variant ⊥ role`; reconnect one client and assert same variant.

---

### P1: Guests are archetype sprites, never staff livery

**User Story**: As a player, I want guests to look like guests (distinct silhouettes/palettes) so that at a glance I never confuse a guest for staff.

**Why P1**: Replaces the `Arc` gray-box (`WorldScene.ts:205`), closes the class-read gate.

**Acceptance Criteria**:

6. **VPOL-06** — WHEN a guest spawns (`guest:arrived`) THEN the server SHALL assign a guest `cosmeticSeed: u32` (same decorrelated stream) and the client SHALL render a `guest-*` Sprite `34×64` (4 silhouettes × palette tint) at `guest.x,tile`, not an `Arc`.
7. **VPOL-07** — The system SHALL never render a guest with staff ivory `#f2ead8`/`#f6f1e6` or brass `#c9a13b`/`#b3873a` as a dominant fill — harness samples guest sprite palette and asserts absence.
8. **VPOL-08** — WHILE a guest is `dining` on `mezzanine` THEN the scene SHALL render the dining variant (amber fill `DINING_FILL 0xffd27a` tint or sprite frame) distinct from `lobby` queue `GUEST_FILL 0xbfe3ff` (legacy constant for reference only).
9. **VPOL-09** — WHEN a guest leaves (`guest:left` / `guest-checked-out`) THEN the scene SHALL destroy that guest's `Sprite` (no `Arc` fallback) and the `guests` map entry.

**Independent Test**: `client:guest_sprites` — spawn `4` guests, assert `texture.key =~ guest-*`, `palette NOT ivory/brass`, `mezzanine` dining tint differs, `guest:left` destroys.

---

### P1: The corridor reads as Deco Noir

**User Story**: As a player, I want the hallway to feel like a 1930s grand hotel after dark — not a flat band — so that damage (`room-trash`) reads as a wound.

**Why P1**: The `art-direction-brief.md:64` visual system — door rhythm + light pools — is the hotel's identity.

**Acceptance Criteria**:

10. **VPOL-10** — WHEN the world mounts on any guest floor THEN the scene SHALL render the Deco Noir corridor: `Graphics` franked wall `0x33505a`, wainscot `0x24333b`/`0x42636e` with `0x8a6a2f` chevron (`Graphics.lineStyle`, `16px` pitch), `TileSprite` carpet `0x5c2430` + `0xb3873a` diamond chain, and night backdrop `0x0f1b21` outside the strip — all behind `door` Images (`depth -3` wall, `-2` band, as `WorldScene.ts:312` precedent).
11. **VPOL-11** — WHEN a room is `prepped` and the own player stands inside THEN the interior SHALL render with baked warm pool (`core 0xf4d9a0 halo 0xe8b464`) spilling `one tile` past the threshold (`Graphics ellipse alpha 0.15`); WHEN `trashed-fresh` THEN the pool SHALL be suppressed and chartreuse accents `0xa4b06a` shall be visible (same `Graphics`/`Sprite` pipeline, no runtime lights).
12. **VPOL-12** — The system SHALL preserve hard `pixelArt:true` (`main.ts:12`), no anti-alias, no gradients, no outlines (`brief.md:99`), and SHALL pass grayscale separation: lightest band = characters/pools, mid = walls, mid-dark = carpet, darkest = night (harness luminance check).

**Independent Test**: `client:corridor_depth` — capture guest floor at native `960×576`, assert `Graphics` wall/carpet exists, `door-closed` still renders, interior pool tint vs fresh accent differ, no `Rectangle` corridor.

---

### P2: Motion is eased and legible (small juice)

**User Story**: As a player, I want walking, foot-tap, and anger to feel weighty and transient so that the ship's movement is readable on voice.

**Why P2**: Game-feel is transient exaggeration, not simulation — `game-feel` skill tier `small` only.

**Acceptance Criteria**:

13. **VPOL-13** — WHILE a player display is moving THEN the sprite pair SHALL play `staff-walk 6f @12fps` with `flipX` on left; WHEN it settles THEN the pair SHALL return to `frame 0` via `Tween {scale: Vector2.ONE, ease: Cubic.easeOut 180ms}` (the `pop` is the settle, not the stride).
14. **VPOL-14** — WHEN a guest is flagged `impatient` (`guest:impatient` same-floor) THEN that guest's Sprite SHALL run a foot-tap loop `Tween {y: base±1px, yoyo:true, repeat:-1, ease: Sine.easeInOut 400ms}` and the DOM bell SHALL remain visible — WHEN `guest:settled` or `guest:left` THEN the tween SHALL stop and `y` SHALL return to base.
15. **VPOL-15** — WHEN `guest:angered` fires for a room on the viewed floor THEN the scene SHALL spawn a short-lived anger cue `Tween {scale: 0→1.3→1, ease: Back.Out 220ms, TTL 1800ms}` at `roomDoorXMilli` + `laneY -40` (replaces `Text '!'` `WorldScene.ts:1058` scale `1→1`), with emitting `Graphics` dust `4` particles `alpha 0→0` over `300ms`.

**Independent Test**: `client:juice_small` — drive `player:moved` sequence, assert `anims.isPlaying`; flag guest `impatient`, assert `yoyo` exists and clears; fire `guest:angered`, assert `Back.Out` scale, no `Text '!'`.

---

### P3: Firing and ambush shake proportionally (medium tier — no hit-stop)

**User Story**: As a player, I want a firing/ambush to land with a small camera punch so that the justice beat is felt without hiding information.

**Why P3**: `game-feel` trauma `small` vs `medium` — never on routine steps.

**Acceptance Criteria**:

16. **VPOL-16** — WHEN `player:fired` or `stairs-ambushed` is reduced THEN the scene's `Cameras.main` SHALL call `shake(140ms, 0.008)` (medium tier) decaying via `trauma^2` (no body shake), while routine `player:moved` / `elevator:moved` SHALL NOT shake.
17. **VPOL-17** — The shake SHALL be on the **camera offset only**, SHALL decay to `0` within `300ms`, and SHALL never block input (`move:E` still routes during shake).

**Independent Test**: `client:camera_juice` — assert `camera.shake` on fired/ambush, `notCalled` on walk, `input.enabled` during shake.

---

## Edge Cases

- IF a `cosmeticSeed` payload is missing (old client / malformed) THEN the client SHALL fallback to `seed=0 → variant 0` and SHALL NOT throw.
- IF a guest `cosmeticSeed` collides with a player's variant THEN the system SHALL keep both Sprites (variant collision is expected — not a role hint).
- IF a `roomDoorXMilli` maps to `0` (`mezzanine` has no rooms) THEN anger/pool `Graphics` SHALL NOT spawn.
- IF `pixelArt` textures fail to load (`textures.exists` false) THEN the scene SHALL keep the `Graphics` corridor + `Text` label fallback and SHALL remain interactive (graceful degrade, `WorldScene.ts:317` precedent).
- WHEN a fired spectator's overview renders THEN variant Sprites SHALL render per lane (`SPECTATOR_LANE_Y:68`) with same body+variant pairing, and corridor `Graphics` SHALL stay single-strip (no per-lane band, `AD-020` lane rule).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
|---|---|---|---|
| VPOL-01 | P1: Staff variants | Implementing | In progress (T1 done, T2 done) |
| VPOL-02 | P1: Staff variants | Design | Pending |
| VPOL-03 | P1: Staff variants | Design | Pending |
| VPOL-04 | P1: Staff variants | Implementing | In progress (T1 done) |
| VPOL-05 | P1: Staff variants | Design | Pending |
| VPOL-06 | P1: Guests archetypes | Implementing | In progress (T2 done) |
| VPOL-07 | P1: Guests archetypes | Design | Pending |
| VPOL-08 | P1: Guests archetypes | Design | Pending |
| VPOL-09 | P1: Guests archetypes | Design | Pending |
| VPOL-10 | P1: Corridor Deco Noir | Design | Pending |
| VPOL-11 | P1: Corridor Deco Noir | Design | Pending |
| VPOL-12 | P1: Corridor Deco Noir | Design | Pending |
| VPOL-13 | P2: Motion eased | Design | Pending |
| VPOL-14 | P2: Motion eased | Design | Pending |
| VPOL-15 | P2: Motion eased | Design | Pending |
| VPOL-16 | P3: Camera shake | Design | Pending |
| VPOL-17 | P3: Camera shake | Design | Pending |

**Coverage:** 17 total, 0 mapped to tasks, 17 unmapped

---

## Success Criteria

- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test:sim` green (new `sim:variant_decorrelation` + guest seed sim cases).
- [ ] `pnpm test:client` `client:char_variants` PASS — variant `⊥` role, `body+variant` Sprites, `flipX` parity, no staff palette on guests, work frames identical, reconnect stable.
- [ ] `client:corridor_depth` PASS — corridor `Graphics`+`TileSprite` at native `960×576`, `pixelArt` locks hold, grayscale separation holds.
- [ ] Gate-4 5-min round: a human sees `8` distinguishable bellhops, `4` guest archetypes, and the hotel reads as Deco Noir — no role tell.
