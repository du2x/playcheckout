# Breath sprites — own pant-puff cue

## Problem Statement

The arrival breath (2 s, AD-051) shows only as a top-left text chip
(`breathChip`: "catching breath" + countdown) while the own body stands at
the destination mouth. The state's most readable moment — the breather
gasping at the stair mouth — has no in-world visual. This cycle adds an
authored pant-puff sprite over the own body for the breath window. Chip
stays (it carries the exact countdown).

## Goals

- [ ] During the own breath phase, a looping breath-puff sprite floats above
      the own body; it appears when the breath starts and is gone when it ends.
- [ ] Zero protocol/sim/tuning/server changes (own stairs row is already
      self-legitimate knowledge); chip + countdown untouched.

## Out of Scope

| Feature | Reason |
|---|---|
| Breath sprites for OTHER breathers | Requires a new sameFloor breath-state registry row — see Future intent |
| Breath chip removal/restyle | User kept the chip; countdown stays |
| Stunned/transit sprites | Different states, own future cycles |
| Any sim, protocol, tuning, or server change | Rendering-only |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| Sheet | `fx-breath-4f.png`, 32×32 × 4f, pale cool-white puffs (distinct from warm rustle dust `#e8b464` and anger chartreuse `#a4b06a`), Pillow deterministic | fx-rustle pattern (AD-020 slice); AD-048 scripted half | n (agent default, brief palette family) |
| Wiring | Looped `breath` anim on one managed Sprite in `syncStairCanvas` (create on breath start, destroy on end, follows own x) — mirrors `playRustleFx` create/play/destroy | Own readout already computed there per-frame; no new subscription | n (agent default) |
| Position | Above own head (own x, laneY − 70), depth 1 (over characters, under chip) | Reads as exhalation, never covers door cards/markers | n (agent default) |
| Harness | New `breath.spec.ts` (`client:breath_sprite`): 4 joins, no round start (stairs phase-free), walk west + ArrowUp, assert sprite during breath, gone after | Isolated from the 150 s ambush choreography in stairs.spec.ts | n (agent default) |

**Open questions:** none.

---

## User Stories

### P1: Own breath puffs ⭐ MVP

**User Story**: As a player catching my breath at a stair mouth, I want to see
pant-puffs over my own body so the 2 s window reads in-world, not just in
the corner chip.

**Acceptance Criteria**:

1. **BR-01** — WHEN the own stairs readout rolls into `breath` THEN the scene
   SHALL show one looping `fx-breath` sprite above the own body; WHEN the
   readout leaves `breath` (expiry or new transit) THEN the sprite SHALL be
   destroyed (never lingering, never duplicated — at most one).
2. **BR-02** — WHEN the breath sprite shows THEN the breathChip countdown
   SHALL keep working unchanged (chip visible, seconds ticking).
3. **BR-03** — The system SHALL mount the sprite from the own readout only
   (`stairsAnchor` + `stairPhaseReadout`, self-legitimate) and SHALL NOT
   render breath sprites for any other player (their breath phase is not on
   the wire — messages.ts:398).
4. **BR-04** — WHEN 4.2-style QA runs THEN the sheet SHALL pass palette count
   (brief family only), alpha coverage, and dims 32×32×4f; its manifest entry
   SHALL land before the bytes with texture key `fx-breath` joining the
   harness vocabulary.

**Independent Test**: `client:breath_sprite` — lobby, walk west to mouth,
ArrowUp (3 s transit), assert `fx-breath` visible during the 2 s breath and
absent 1 s after; chip countdown ticks meanwhile.

---

## Edge Cases

- IF the `fx-breath` texture is missing THEN no sprite mounts and the chip
  still counts down (graceful degrade, wall-field fallback precedent).
- IF a new transit/stun starts mid-breath THEN the breath sprite is destroyed
  with the chip (same branch that hides the chip).
- IF the viewer is a spectator THEN no breath sprite mounts (spectators have
  no stairsAnchor).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
|---|---|---|---|
| BR-01 | P1: Own breath puffs | Execute | Done (sprite + destroy branch, harness 3× green) |
| BR-02 | P1: Own breath puffs | Execute | Done (chip untouched, clock asserted) |
| BR-03 | P1: Own breath puffs | Execute | Done (own readout only + caro negative) |
| BR-04 | P1: Own breath puffs | Execute | Done (manifest-first, QA PASS) |

**Coverage:** 4 total, 4 covered (small scope — inline execution)

---

## Future intent (user-recorded, NOT this cycle)

Floor-visible breath sprites for every breather: all viewers on the
destination floor would see who is catching breath. Requires a new
`sameFloor` registry row publishing breath phase (cosmetic crowd knowledge,
like the anger cue's room-number level — never identity beyond the already
public position stream). Needs its own Design (payload, router policy,
snapshot seeding for late joiners) + FR-34/35 audit (breath vs stun must
stay visually distinct — a stunned player is invisible mid-transit, a
breather is a standing occupant). Do not implement here.

---

## Success Criteria

- [ ] `pnpm typecheck` + biome on touched files + `pnpm test:sim` green
- [ ] `client:breath_sprite` PASS 2× (sprite during breath, gone after, chip ticking)
- [ ] No sim/protocol/server file touched (`git status` proves)
