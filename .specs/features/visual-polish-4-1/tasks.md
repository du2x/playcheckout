# Phase 4.1 Visual Polish Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/visual-polish-4-1/design.md`
**Spec**: `.specs/features/visual-polish-4-1/spec.md`
**Status**: Done (pending Verifier)

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (gate ladder §Verification ladder), `package.json` (scripts `typecheck`/`lint`/`test:sim`/`test:client`), `vitest.config.ts` (sim suite), `apps/client/harness/playwright.config.ts` (client harness).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Sim domain (RoundSim, GuestSim, CosmeticSeed, Rng) | unit | All branches; 1:1 to VPOL-01,04,05; every listed edge case (missing seed fallback, bucket clamp, decorrelation) | `packages/sim/src/**/*.test.ts` | `pnpm test:sim` (`vitest run`) |
| Protocol/shared (messages, simEvents, registry) | unit | Payload shape + recipient policy per new row; compile-time `SimProjection` exhaustiveness | `packages/shared/src/protocol/**/*.test.ts`, `packages/shared/src/**/*.test.ts` | `pnpm test:sim` |
| Server router/room (policy apply, snapshot) | unit | `'all'` broadcast + `'self'` snapshot wiring + reconnect re-send | `apps/server/src/**/*.test.ts` | `pnpm test:sim` |
| Client presenter (juice durations/eases pure) | unit | Tween durations/eases pure function mapping to VPOL-13..17 | `apps/client/src/**/*.test.ts` | `pnpm test:sim` |
| Client scene (WorldScene, BootScene) | e2e (Playwright harness) | Every visual AC: `char_variants` ⊥ role, guest palette, corridor deco, anger/impatience tweens, camera shake | `apps/client/harness/**/*.spec.ts` | `pnpm test:client` (`playwright test --config apps/client/harness/playwright.config.ts`) |
| Art assets (PNG sheets, manifest) | none | Build gate only: `asset_report.py --max-colors 24`, `build_preview_sheet.py`, manifest `approved` | `apps/client/public/art/**` | `pnpm typecheck` + `biome check` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only (sim/protocol/server/presenter) | `pnpm test:sim` |
| Full | After tasks with e2e/harness tests (client scene) | `pnpm test:sim && pnpm test:client` |
| Build | After phase completion or config/asset-only tasks | `pnpm typecheck && pnpm lint && pnpm test:sim` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Foundation — decorrelated seeds + registry

Public `cosmeticSeed` assignment and its public registry rows — the anti-leak invariant everything else composes on.

```
T1 → T2
```

### Phase 2: Server wiring

Rooms emit the new `'all'` payloads and re-send on FR-25 reconnect; snapshots carry seeds for late joiners.

```
T2 → T3
```

### Phase 3: Art — Deco Noir sheets

Deterministic Pillow authoring of `34×64` sheets inside the `≤24` palette and `pixelArt` locks.

```
T3 → T4
```

### Phase 4: Client rendering — cast + corridor

Replace `Arc`/`Rectangle` gray-box with `Sprite` cast and `Graphics` corridor, preserving `FR-9`/`FR-10`/`FR-20`.

```
T4 → T5 → T6
```

### Phase 5: Juice — eased motion + camera

Transient `Tween`/`Camera.shake` tiered by importance, never hiding information.

```
T6 → T7
```

---

## Task Breakdown

### T1: CosmeticSeed pure module (decorrelated Rng fork + variantIndex) ✅ DONE (4b95b3c)

**What**: Pure `cosmetic.ts` with `COSMETIC_FORK = 0x9e3779b9`, `variantIndex(seed, buckets)`, `assignPlayerSeeds(seed, playerIds)` and `assignGuestSeed(cosmeticRng)` — the dedicated stream that never touches the guest timing `Rng`.
**Where**: `packages/sim/src/cosmetic.ts` + `packages/sim/src/cosmetic.test.ts`
**Depends on**: None
**Reuses**: `packages/sim/src/rng.ts:11` `Rng`, `packages/sim/src/deal.ts:7` `mulberry32` Fisher-Yates isolation `AD-028`
**Requirement**: VPOL-01, VPOL-04

**Tools**:

- MCP: `filesystem` (none)
- Skill: NONE

**Done when**:

- [ ] `assignPlayerSeeds` draws one `rng.int(0xFFFFFFFF)` per sorted `playerId` from `new Rng(seed ^ COSMETIC_FORK)` and is deterministic for a fixed seed
- [ ] `variantIndex` is `((seed>>>0) % buckets)` pure, never reads `isSaboteur`
- [ ] `guestExit`-style determinism test: same seed → same player map and same guest draw sequence; different seed → different map with high probability
- [ ] Gate check passes: `pnpm test:sim` (covers `cosmetic.test.ts` `sim:variant_decorrelation` pure-function + decorrelation `20 seeds ×6` variant ⊥ role assertion)

**Tests**: unit (sim domain — 1:1 to VPOL-01,04 + missing-seed fallback edge case)
**Gate**: quick

---

### T2: Protocol cosmetic payloads + registry rows ✅ DONE (2a6556c)

**What**: New payloads `CosmeticPlayer {playerId, seed}` + `CosmeticGuest {guestId, seed}` (or widen `RoleDealt`/`GuestArrived` with `seed` — implement as new rows `cosmetic:player` + `cosmetic:guest` to keep `'all'` vs `'self'` orthogonal per Design) and `PROTOCOL_REGISTRY` `'all'` entries with `SimProjection` typed projections.
**Where**: `packages/shared/src/protocol/messages.ts`, `packages/shared/src/protocol/simEvents.ts`, `packages/shared/src/protocol/registry.ts`, `packages/shared/src/protocol/registry.test.ts`
**Depends on**: T1
**Reuses**: `registry.ts:72` `RecipientPolicy 'all'`, `registry.ts:215` `SimProjection<K>` typing, `GuestAssigned 'all'` `131` precedent
**Requirement**: VPOL-01, VPOL-06

**Tools**:

- MCP: `filesystem`
- Skill: `turnover-protocol`

**Done when**:

- [ ] `SimEvent` gains `cosmetic:player` / `cosmetic:guest` (or equivalent) with `seed: number` and registry rows declare `recipients: 'all'` with typed `fromSim`
- [ ] `registry.test.ts` policy map asserts the new rows are `'all'` and `satisfies Record<SimEvent['type'], …>` still compiles (undeclared sim event fails compilation per `AD-006`)
- [ ] Gate check passes: `pnpm test:sim` (protocol unit)

**Tests**: unit (protocol/shared)
**Gate**: quick

---

### T3: Server emit + snapshot + reconnect wiring ✅ DONE (bb9a074)

**What**: `RoundSim` wires `CosmeticSeeds` at `deal` (`roundSim.ts:114`) and at each `guest:arrived` (`guests.ts:640` dwell analog); `TurnoverRoom` routes `'all'` cosmetic events generically and appends seed maps to `movement:snapshot` and `spectator:snapshot`, re-sends on `FR-25` `allowReconnection` `round:resumed`.
**Where**: `packages/sim/src/roundSim.ts`, `packages/sim/src/guests.ts`, `packages/sim/src/roundSim.test.ts`, `apps/server/src/rooms/TurnoverRoom.ts`, `apps/server/src/rooms/router.test.ts` or `TurnoverRoom.test.ts`
**Depends on**: T2
**Reuses**: `roundSim.ts:163` tick `emitResult` pattern, `AD-002` room/sim seam, `MovementSnapshot` wiring `messages.ts:365`
**Requirement**: VPOL-01, VPOL-05, VPOL-09 (guest leave keeps map consistent)

**Tools**:

- MCP: `filesystem`
- Skill: `turnover-protocol`

**Done when**:

- [ ] `movement:snapshot` carries `cosmeticSeeds` (player map + guest map) present only when non-empty, filtered per `sameFloor` for guest seeds
- [ ] `spectator:snapshot` carries every floor's player+guest seeds for FR-20 lanes `SPECTATOR_LANE_Y:68`
- [ ] Reconnected client receives same `playerId→seed` (FR-25) and harness asserts `variant` recomputes identically
- [ ] Gate check passes: `pnpm test:sim` (server unit covers `'all'` broadcast + self snapshot)

**Tests**: unit (server router)
**Gate**: quick

---

### T4: Author 34×64 Deco Noir sheets + manifest ✅ DONE (2c33b25)

**What**: Deterministic Pillow sheets `staff-body 34×64 6f+idle`, `staff-variant 8 variants` (head/accent overlay `34×64` or `34×20`), `guest-{suite,tourist,clerk,elder} 34×64`, plus `Graphics` chevron not a sheet; update `docs/art/asset-manifest.json` + `docs/art/alternative/asset-manifest.json` statuses to `approved` with `asset_report` QA.
**Where**: `scripts/art/generate-staff-variants.py` (new) or extend `generate-staff-walk.py`, `apps/client/public/art/chars/staff-body-34x64-6f.png`, `apps/client/public/art/chars/staff-variant-*.png`, `apps/client/public/art/chars/guest-*.png`, `docs/art/asset-manifest.json`
**Depends on**: T3
**Reuses**: `scripts/art/generate-staff-walk.py` deterministic Pillow `AD-020` pattern, `asset_report.py --max-colors 24 --require-alpha`, `build_preview_sheet.py`, palette `brief.md:80` `0x33505a/0x5c2430/0xb3873a/0x0f1b21`
**Requirement**: VPOL-02, VPOL-06, VPOL-07, VPOL-12

**Tools**:

- MCP: `filesystem`
- Skill: `create-game-assets`

**Done when**:

- [ ] `asset_report.py` PASS: `≤24` colors, `34×64` exact, alpha `0-255`, no `staff ivory/brass` in guest sheets (denylist sample), `pixelArt:true` `nearest` check
- [ ] Manifest entries for `staff-body`, `staff-variant`, `guest-*` marked `approved` with `in_engine_reviewed: false` (flips to `true` after T5/T6 harness pass)
- [ ] Gate check passes: `pnpm typecheck && pnpm lint` (asset-only)

**Tests**: none (build gate only)
**Gate**: build

---

### T5: Staff variant renderer (two-Sprite + walk/facing) ✅ DONE (4576e6e)

**What**: `WorldScene.ts:112` `PlayerDisplay` → `{body: Sprite, variant: Sprite, label}`; `BootScene` preloads `staff-body`+`staff-variant`; `addPlayerDisplay(id,name,seed)` composites `bottom-center` `GROUND_Y 430`, same `flipX`, walk `6f @12fps`, idle `frame 0`; `State` mapper derives `variantIndex(seed%8)` pure and decorrelated; `room:observed` path unchanged (FR-9 work frames identical).
**Where**: `apps/client/src/scenes/BootScene.ts`, `apps/client/src/scenes/WorldScene.ts`, `apps/client/src/state.ts`, `apps/client/src/net/mappers.ts`, `apps/client/harness/char-variants.spec.ts`
**Depends on**: T4
**Reuses**: `WorldScene.ts:322` `anims.create staff-walk` pattern, `WorldScene.ts:690` `laneY`, `AD-029` palette locks, `cosmetic.ts: variantIndex` client mirror
**Requirement**: VPOL-02, VPOL-03, VPOL-04, VPOL-05

**Tools**:

- MCP: `filesystem`
- Skill: `phaser-core`, `sprites-and-images`

**Done when**:

- [ ] No `Rectangle` player primitive remains — one `body`+`variant` `Sprite` pair per player (harness texture filter `staff-body`+`staff-variant`, not `type===Rectangle`)
- [ ] Walk tint/timing identical across roles (saboteur vs staff byte-identical frames `VPOL-03`)
- [ ] `client:char_variants` PASS — variant `⊥` role `20 seeds ×6` Gate, `flipX` parity `body.flipX===variant.flipX`, reconnect same variant `VPOL-05`
- [ ] Gate check passes: `pnpm test:sim && pnpm test:client`

**Tests**: e2e (client scene) + unit for `variantIndex` pure mirror
**Gate**: full

---

### T6: Guest archetype + corridor Deco rendering ✅ DONE

**What**: Replace `guests Map<Arc>` `WorldScene.ts:206` with `Map<Sprite>` `guest-*` `34×64` `setTint` `GUEST_PALETTES`, dining tint `mezzanine` vs `lobby`; `corridorBand` + `wallFill` upgrade to `Graphics` chevron `16px` + sconce pool `Graphics ellipse alpha 0.15` `WorldScene.ts:311` `721`; preserve `FR-10` door interior & `FR-20` lanes (no per-lane band).
**Where**: `apps/client/src/scenes/WorldScene.ts`, `apps/client/harness/guest-sprites.spec.ts`, `apps/client/harness/corridor-depth.spec.ts`
**Depends on**: T5
**Reuses**: `WorldScene.ts:205` `GUEST_FILL 0xbfe3ff` tint lineage `AD-029`, `TileSprite 960x146 depth -2` precedent, `SPECTATOR_LANE_Y:68`
**Requirement**: VPOL-06, VPOL-07, VPOL-08, VPOL-09, VPOL-10, VPOL-11, VPOL-12

**Tools**:

- MCP: `filesystem`
- Skill: `phaser-core`, `graphics-and-shapes`

**Done when**:

- [ ] `client:guest_sprites` PASS — `texture.key =~ guest-*`, palette `NOT ivory/brass` dominant, `mezzanine` dining tint differs, `guest:left` destroys
- [ ] `client:corridor_depth` PASS — wall `0x33505a` `Graphics` + chevron `0x8a6a2f` + carpet `TileSprite` + pool `Graphics ellipse` exist at native `960×576`, `pixelArt` locks hold, no `Rectangle` corridor
- [ ] `room-observed` interior still `prepped→room-prepped` etc. `WorldScene.ts:108` and spectator baseline `736` `seedFromSpectatorSnapshot` per lane
- [ ] Gate check passes: `pnpm test:sim && pnpm test:client`

**Tests**: e2e
**Gate**: full

---

### T7: Juice — foot-tap, anger pop, walk settle, camera shake ✅ DONE

**What**: Pure `apps/client/src/scenes/juice.ts` presenter (durations/eases testable) + `WorldScene` `Tween` wiring: `VPOL-13` walk settle `Cubic.easeOut 180ms`, `VPOL-14` foot-tap `Sine.easeInOut 400ms yoyo`, `VPOL-15` anger `Back.Out 220ms TTL 1800` + dust `Graphics 4× 300ms`, `VPOL-16` `Cameras.main.shake(140,0.008)` decaying `trauma^2` only for `player:fired`/`stairs:ambushed`.
**Where**: `apps/client/src/scenes/juice.ts`, `apps/client/src/scenes/juice.test.ts`, `apps/client/src/scenes/WorldScene.ts`, `apps/client/harness/juice.spec.ts`, `apps/client/harness/camera-juice.spec.ts`
**Depends on**: T6
**Reuses**: `WorldScene.ts:1497` `playRustleFx` sprite precedent, `game-feel` trauma^2 `Cameras.main.shake` `cameras` skill, `elevatorPresenter` tick `AD-038` — juice never owns elevator ticks
**Requirement**: VPOL-13, VPOL-14, VPOL-15, VPOL-16, VPOL-17

**Tools**:

- MCP: `filesystem`
- Skill: `game-feel`, `cameras`

**Done when**:

- [ ] `juice.test.ts` pins durations/eases `Back.Out 220ms`, `Sine yoyo 400ms`, `shake 140ms 0.008` (unit)
- [ ] `client:juice_small` PASS — walk settles to `frame 0` via `Cubic.easeOut`, impatience `yoyo` exists and clears on `guest:settled`/`left`, anger `Back.Out` scale pop + dust (the `!` glyph stays as the visual, tweened — never a static fallback)
- [ ] `client:camera_juice` PASS — `shake` on `player:fired`/`stairs:ambushed`, `notCalled` on routine `player:moved`/`elevator:moved`, `input.enabled` during shake (`VPOL-17`)
- [ ] Gate check passes: `pnpm test:sim && pnpm test:client`

**Tests**: unit (presenter) + e2e (scene)
**Gate**: full

---

## Phase Execution Map

```
Phase 1 (Foundation) → Phase 2 (Server) → Phase 3 (Art) → Phase 4 (Client) → Phase 5 (Juice)

Phase 1:  T1 ──→ T2
Phase 2:  T2 ──→ T3
Phase 3:  T3 ──→ T4
Phase 4:  T4 ──→ T5 ──→ T6
Phase 5:  T6 ──→ T7
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

---

## Task Granularity Check

| Task | Scope | Status |
|---|---|---|
| T1: CosmeticSeed pure module | 1 module `cosmetic.ts` + 1 test | ✅ Granular |
| T2: Protocol cosmetic payloads | 3 files `messages/simEvents/registry` + 1 test | ✅ Granular (cohesive registry) |
| T3: Server emit + snapshot | 2 files `roundSim/guests` + 1 room file + test | ✅ Granular |
| T4: Author 34×64 sheets + manifest | art generation + manifest JSON | ✅ Granular |
| T5: Staff variant renderer | 2 scene files + harness spec | ✅ Granular |
| T6: Guest + corridor rendering | 1 scene file + 2 harness specs | ✅ Granular |
| T7: Juice + camera | 1 presenter + 1 scene file + 2 harness specs | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
|---|---|---|---|
| T1 | None | None (Phase 1 start) | ✅ Match |
| T2 | T1 | T1 → T2 (Phase 1) | ✅ Match |
| T3 | T2 | Phase 1 → Phase 2 (T2 → T3) | ✅ Match |
| T4 | T3 | Phase 2 → Phase 3 (T3 → T4) | ✅ Match |
| T5 | T4 | Phase 3 → Phase 4 (T4 → T5) | ✅ Match |
| T6 | T5 | T5 → T6 (Phase 4) | ✅ Match |
| T7 | T6 | Phase 4 → Phase 5 (T6 → T7) | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
|---|---|---|---|---|
| T1: CosmeticSeed pure module | Sim domain | unit | unit | ✅ OK |
| T2: Protocol cosmetic payloads | Protocol/shared | unit | unit | ✅ OK |
| T3: Server emit + snapshot | Server router/room | unit | unit | ✅ OK |
| T4: Author 34×64 sheets + manifest | Art assets | none | none | ✅ OK |
| T5: Staff variant renderer | Client scene + presenter | e2e + unit | e2e (+unit mirror) | ✅ OK |
| T6: Guest + corridor rendering | Client scene | e2e | e2e | ✅ OK |
| T7: Juice + camera | Client presenter + scene | unit + e2e | unit + e2e | ✅ OK |

---

## Tips

- **Phases are ordered** - Each phase completes before the next; tasks run in order within a phase
- **Reuses = Token saver** - Always reference existing code
- **Tools per task** - MCPs and Skills prevent wrong approaches
- **Dependencies are gates** - Clear what blocks what
- **Done when = Testable** - If you can't verify it, rewrite it
- **Requirement ID = Traceable** - Every task traces back to a spec requirement
- **One commit per task** - Plan the commit message format in advance
