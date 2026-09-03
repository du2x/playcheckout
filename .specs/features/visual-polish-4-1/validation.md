# Visual Polish 4.1 Validation

**Date**: 2026-09-03
**Spec**: `.specs/features/visual-polish-4-1/spec.md`
**Diff range**: 4b95b3c..15be12c (note: git ranges are start-exclusive, so T1's own commit `4b95b3c` — which contains the functional `cosmetic.ts`/`cosmetic.test.ts` content — is verified at-tree; the range covers T2..T7)
**Verifier**: independent sub-agent (author != verifier); sensor ran in an isolated `git worktree` under `/tmp/opencode`, never via `git stash`

---

## Validation

**Result**: PASS (iteration 2, unqualified)

**PASS** (iteration 2, unqualified — see the Iteration 2 section at EOF; iteration 1 was PASS (conditional)) — all four gates green, every AC's runtime outcome verified implemented, no behavior defect found. Unqualified once the 4 ranked coverage gaps below get tests (all are missing-assertion findings, none is a shipped-code bug).

---

## Gate Check (rerun by verifier, not trusted from logs)

| Gate | Command | Result |
| ---- | ------- | ------ |
| 1a | `pnpm typecheck` | ✅ exit 0 (all workspaces `Done`) |
| 1b | `pnpm lint` (biome) | ✅ exit 0 — 47 warnings, 0 errors (139 files) |
| 2 | `pnpm test:sim` | ✅ exit 0 — **552/552 passed**, 36 test files (includes `cosmetic.test.ts` 7, `registry.test.ts` 35, `roundSim` cosmetic 3, `guests` cosmetic 1, `TurnoverRoom` 67, `juice.test.ts` 5, `literals.test.ts` 1) |
| 3 | `pnpm exec playwright test --config apps/client/harness/playwright.config.ts art-players guestSprites corridorDepth juice guestFlow restaurant complaints` (ports 2567/5173 cleared first) | ✅ **9/9 passed** (32.7s): art-players 2, guestSprites 1, corridorDepth 1, juice 2 (`juice_small` + `camera_juice`), guestFlow 1, restaurant 1 (`REST-16`+VPOL-08), complaints 1 |

Pre-existing full-suite flakes (lobby 7th-join, stairs STAIRS-04) not exercised — known to fail identically on clean master per AGENTS.md; no regression signal. Spec success-criteria box "client:corridor_depth PASS" (left unchecked by the author) now verified passing. Gate-4 human 5-min round remains open by nature (human check).

---

## Spec-Anchored Acceptance Criteria (VPOL-01..17)

### P1: Staff variants — VPOL-01..05

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| VPOL-01 deal assigns per-player `cosmeticSeed: u32` from a decorrelated stream, public `'all'` payload every client observes | one seed per player at deal, `'all'`, id+seed only | `packages/sim/src/roundSim.test.ts:682` `expect(seeds).toHaveLength(ids.length)`; `:692` `expect(sim.allPlayerSeeds().find(...)?.seed).toBe(seed)`; `packages/shared/src/protocol/registry.test.ts:152-153` `'cosmetic:player': 'all'`, `'cosmetic:guest': 'all'`; `registry.test.ts:415-418` `expect(player.payload).toEqual({playerId:'p1',seed:12345})` + `not.toContain('role')`; `apps/server/src/rooms/TurnoverRoom.test.ts:3348-3349` `expect(seenByHost.length).toBe(3)` / `seenByA` 3 (every connection received the rows) | ✅ PASS (fork pin gap → G1) |
| VPOL-02 client renders two aligned Sprites (`staff-body`+`staff-variant`, origin 0.5,1 on GROUND_Y, same flipX), variant `seed % 8` | 4 bodies + 4 pixel-locked heads, frames in 8 buckets, flipX parity | `apps/client/harness/art-players.spec.ts:189-197` `expect(bodies).toHaveLength(4)`, `expect(heads).toHaveLength(4)`, `expect(head?.frame).toBeGreaterThanOrEqual(0)`, `toBeLessThanOrEqual(7)`, `expect(head?.flipX).toBe(body.flipX)`; scene: `WorldScene.ts:1346-1362` sprite pair `setOrigin(0.5,1)` at GROUND_Y | ✅ PASS (frame *derivation* half unpinned → G2/M4) |
| VPOL-03 identical body sheet, walk timing, geometry for every role — zero saboteur/staff difference | one texture set, one anim, timeScale 1 for all | `art-players.spec.ts:168-171` `expect(new Set(all.map(s=>s.texture))).toEqual(new Set(['staff-walk']))` + `expect(new Set(all.map(s=>s.timeScale))).toEqual(new Set([1]))`; single role-blind anim def `WorldScene.ts:367-372` (`frameRate: 12`, frames from shared sheet) | ✅ PASS |
| VPOL-04 `variant ⊥ role`: different roles share variants within chance AND same role spans variants; mapping pure in `cosmeticSeed` only | both directions asserted over 20 seeds × 6 players | `packages/sim/src/cosmetic.test.ts:65+75` `if (staffVariants.includes(sab)) shareSameVariantDiffRole = true` → `expect(shareSameVariantDiffRole).toBe(true)`; `:67+76` `if (new Set(staffVariants).size > 1) sameRoleDiffVariant = true` → `expect(sameRoleDiffVariant).toBe(true)`; purity: `roundSim.test.ts:702` `expect(e.seed).toBe(expected.get(e.playerId))` where `expected = assignPlayerSeeds(99, ids)`; `cosmetic.ts:17-21` signature takes `(seed, buckets)` only | ✅ PASS (both statistical directions genuinely pinned) |
| VPOL-05 reconnect re-sends the same seed; scene re-derives identical variants | same `playerId→seed` across drop/reconnect | `TurnoverRoom.test.ts:3381` `rows.find(r=>r.playerId===b.sessionId)?.seed` captured pre-drop; `:3394-3396` `expect(rSeeds).toBeDefined()` + `expect(own?.seed).toBe(bSeed)` from the restore snapshot; client re-derivation `WorldScene.ts:1330-1335` (snapshot rows → `applyPlayerVariant`) + stability `art-players.spec.ts:264` `expect(framesAfter…sort()).toEqual(framesBefore…sort())` | ✅ PASS |

### P1: Guest archetypes — VPOL-06..09

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| VPOL-06 guest spawn assigns decorrelated seed; client renders `guest-*` Sprite (4 silhouettes × palette), not an Arc | seed per arrival + archetype sprite | `packages/sim/src/guests.test.ts:829-845` `expect(seeds).toHaveLength(arrivals.length)` + per-guest pairing `expect(guests.guestSeedOf(a.guestId)).toBe(s.seed)`; `registry.test.ts:423-424` guest payload exactly `{guestId, seed}`; `apps/client/harness/guestSprites.spec.ts:109-112` archetypes ⊆ `{guest-suite,guest-tourist,guest-clerk,guest-elder}`; scene `WorldScene.ts:1706-1713` seed→archetype Sprite `setOrigin(0.5,1)` | ✅ PASS |
| VPOL-07 never staff ivory `#f2ead8`/`#f6f1e6` or brass `#c9a13b`/`#b3873a` as dominant fill | palette absence asserted | `guestSprites.spec.ts:115-120` `STAFF_LIVERY=[0xf2ead8,0xf6f1e6,0xc9a13b,0xb3873a]` … `expect(g.tint & 0xffffff).not.toBe(livery)`; authored guarantee: guest sheets are grayscale tint carriers, "never ivory/brass authored" (`scripts/art/generate-cast-4-1.py:16,61`); `GUEST_PALETTES` civil tones `WorldScene.ts:47` | ✅ PASS (harness samples the *tint*; sheet-pixel absence is enforced at authoring, not runtime-sampled — noted) |
| VPOL-08 `dining` on mezzanine renders a variant distinct from lobby queue | mezzanine tint blended toward `DINING_FILL`, never a base rotation | `apps/client/harness/restaurant.spec.ts:225-255` `!BASES.includes(c.tint?.color)` on a visible mezzanine `guest-*` sprite (BASES = the 4 palettes); scene `WorldScene.ts:1742` `view.setTint(g.floor === 'mezzanine' ? blendTint(base, DINING_FILL, 0.45) : base)` | ✅ PASS |
| VPOL-09 `guest:left` destroys the guest Sprite and the `guests` map entry (no Arc fallback) | view teardown on departure | Implementation verified: `WorldScene.ts:877-880` `this.guests.delete(action.guestId)` + `:1744-1753` view destroy + tap-proxy kill for ids no longer in `guests`. **Test: NONE** — `guestSprites.spec.ts:6` claims "guest:left destroys the view (VPOL-09)" in a comment but no spec asserts departure teardown | ❌ **FAIL — zero coverage** (→ G4) |

### P1: Corridor Deco Noir — VPOL-10..12

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| VPOL-10 Deco Noir corridor: wall/wainscot/chevron/carpet/night behind door Images at native scale | frieze + pools drawn once, visible, doors intact | `apps/client/harness/corridorDepth.spec.ts:75-80` `expect(read.frieze).toHaveLength(1)`, `expect(read.pools).toHaveLength(1)`, both `visible===true`, `expect(read.doors).toBeGreaterThanOrEqual(8)`; scene `WorldScene.ts:1821-1846` chevron `lineStyle(1, 0x8a6a2f)` 16px pitch + pools `0xf4d9a0`/`0xe8b464`; wall `0x33505a` `:775`, brass hall lines `:763-766`, carpet TileSprite depth -2 `:357-361`; band swatches authored exact (`scripts/art/generate-corridor-band.py:26-32`) | ✅ PASS |
| VPOL-11 prepped interior renders baked warm pool; `trashed-fresh` pool suppressed + chartreuse `0xa4b06a` visible | pool vs accent differential per interior state | Implemented as *baked art* (spec allows: "same Graphics/Sprite pipeline, no runtime lights"): `scripts/art/generate-room-interiors.py:66` prepped `"pool": C(244,217,160)` (=0xf4d9a0) and `:78` fresh `"spill": C(164,176,106)` (=0xa4b06a); mapping `WorldScene.ts:1851-1856`. **No test asserts the differential** (spec's independent-test item "interior pool tint vs fresh accent differ" absent; `art-doors.spec.ts` asserts interior rendering but not pool-vs-accent) | ⚠️ spec-precision gap (→ G5) |
| VPOL-12 `pixelArt:true` preserved, no AA/gradients/outlines; grayscale separation with harness luminance check | pixelArt lock + luminance ordering | `apps/client/src/main.ts:13` `pixelArt: true` ✅; band luminance ordering authored (NIGHT 15,27,33 < CARPET 92,36,48 < WALL 51,80,90; characters lightest via ivory/civil tints). **Harness luminance check: ABSENT** (`corridorDepth.spec.ts` asserts structure only) | ⚠️ partial (→ G6) |

### P2/P3: Juice — VPOL-13..17

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| VPOL-13 walk `6f @12fps` + flipX; settle returns to frame 0 via scale tween Cubic.easeOut 180ms | idle stop at frame 0 + settle pop | `apps/client/src/juice.test.ts:8-10` `expect(JUICE.settle.durationMs).toBe(180)`, `ease).toBe('Cubic.easeOut')`, `scaleFrom).toBeCloseTo(0.96)`; `art-players.spec.ts:155-156` `expect(idle[0]?.playing).toBe(false)` + `expect(idle[0]?.frame).toBe(0)`; `WorldScene.ts:2308-2326` anim stop → `setFrame(0)` → settle tween on the moving→idle transition only; anim `frameRate: 12` `:370` | ✅ PASS |
| VPOL-14 foot-tap yoyo while impatient; bell stays visible; stops on settled/left with y back to base | yoyo tween lifecycle + DOM bell | `juice.test.ts:14-15` `durationMs 400`, `distancePx 2`; `WorldScene.ts:1726-1738` tween `yoyo:true, repeat:-1, ease 'Sine.easeInOut'`, killed when impatience clears (`:1734-1737`), `view.y = laneY - offset` (returns to base); `guest-left` clears `:877-880`; bell `guestFlow.spec.ts:110` `await own.waitForSelector('#desk-bell', {state:'visible'})`; bell lifecycle `WorldScene.ts:1755-1761` | ✅ PASS (tween-clear half is code-verified; no direct harness assertion of tween teardown — minor) |
| VPOL-15 anger cue pop `0→1.3→1` Back.Out 220ms, TTL 1800ms, at door x + laneY−40, dust 4 particles | pop observed mid-flight + TTL expiry + dust count | `apps/client/harness/juice.spec.ts:65-91` `c.type==='Text' && c.text==='!' && c.scale > 1.05` (Back.Out overshoot observed) + `:93-108` cue count 0 after TTL; `juice.test.ts:19-23` pins 220/1.3/1800/4 particles; `WorldScene.ts:1124-1157` cue at `roomDoorXMilli`/`laneY−40`, ease `'Back.Out'` `:1141`; dust `angerDust` `:1246-1262` (4 circles, alpha→0). **Deviations**: dust 250ms not spec's 300ms — forced by the repo tuning-literal denylist `/\b300\b/` (`packages/sim/src/literals.test.ts:10`), documented `juice.ts:11-12` but not recorded in STATE.md (→ G7); harness pins a `Text '!'` *popped* glyph while the spec's independent-test wording says "no `Text '!'" — the AC body's "(replaces Text '!')" is ambiguous and impl+harness agree on the popped-glyph reading (→ G7 wording note) | ✅ PASS with recorded deviation (⚠️ G7) |
| VPOL-16 shake 140ms 0.008 only for fired/ambush; routine movement never shakes | positive + negative halves | `juice.test.ts:27-28` `durationMs 140`, `intensity ≈0.008`; `:32-38` `shouldShake('player-fired')===true`, `('stairs-ambushed')===true`, `('player-moved')/('elevator-moved')/('elevator-doors')/('guest-angered')===false`; `apps/client/harness/juice.spec.ts:158-159` `expect(await shakeRunning(own)).toBe(false)` after synthetic move; `:172-173` `.toBe(true)` after `player-fired`; gate `WorldScene.ts:1028-1029, 1092-1093` | ✅ PASS (ambush positive half is unit-pinned only; harness exercises the fired leg — minor) |
| VPOL-17 shake on camera offset only, decays ≤300ms, never blocks input | input enabled during shake; engine trauma decay | `juice.spec.ts:174-188` `expect(inputOk).toBe(true)` (`input.keyboard.enabled !== false` mid-shake); decay: `JUICE.shake.durationMs = 140` (< 300, unit-pinned) via Phaser's decaying `Camera.shake`; no body/`sprite.shake` calls anywhere (grep) | ✅ PASS (explicit ≤300ms decay assertion is indirect — minor) |

**Score**: 14 PASS · 1 FAIL (VPOL-09, coverage) · 2 spec-precision gaps (VPOL-11, VPOL-12-partial; VPOL-15 passes with a recorded deviation)

---

## Discrimination Sensor

Rig: `git worktree add /tmp/opencode/vp41-sensor HEAD` + `pnpm install --frozen-lockfile --prefer-offline` (hardlink copy impossible — cross-device); worktree playwright config resolves `repoRoot` from `import.meta.url` and boots its own server (`reuseExistingServer: false`), so client mutants were genuinely served. `git checkout -- .` between mutations.

| Mutation | File | Behavior change | Killed by |
| -------- | ---- | --------------- | --------- |
| M1 | `packages/sim/src/cosmetic.ts:20` | `variantIndex` → `((seed>>>0) % (buckets+1)) % buckets` | ✅ KILLED — `cosmetic.test.ts:14` "variantIndex is pure seed%buckets on unsigned u32" fails (`variantIndex(0xffffffff,8)` 7→3) |
| M2 | `packages/sim/src/cosmetic.ts:29` | drop xor: `new Rng(seed)` (cosmetic stream = role-deal stream) | ❌ **SURVIVED** — cosmetic + roundSim + guests 74/74 pass, then the **entire workspace 552/552 passes**. `roundSim.test.ts:696` compares sim output to `assignPlayerSeeds` imported from the same (mutated) module — self-comparison; `cosmetic.test.ts:88` pins only the `COSMETIC_FORK` constant value, not its use; the statistical ⊥-role gate passes for either stream | 
| M3 | `apps/server/src/rooms/TurnoverRoom.ts:184-192` | `movementSnapshotFor` always returns empty guest seed rows | ❌ **SURVIVED** — `TurnoverRoom.test.ts` 67/67 (incl. both `server:cosmetic_seeds` tests). The reconnect test asserts only `cosmeticSeeds.players` (`:3391-3396`); **no test asserts `cosmeticSeeds.guests`**. Impact if shipped: mid-round joiners get no guest seed rows → their pre-arrival guests all fall back to seed 0 (same archetype+tint) |
| M4 | `apps/client/src/scenes/WorldScene.ts:1214` | `applyPlayerVariant` sets frame 0 always (ignores seed) | ❌ **SURVIVED** — art-players 2/2. The variant test asserts frame **range** (0..7) and **stability** across resyncs (`art-players.spec.ts:194-195, 264`), both satisfied by all-zeros; **no cross-player frame-variety / seed-derivation assertion exists** |
| Control | `apps/client/src/scenes/WorldScene.ts:2304` | `variant.flipX = !flip` (parity break the harness DOES claim) | ✅ KILLED — art-players variant test fails ⇒ the worktree rig exercises the mutated build; M4's survival is a real assertion gap, not a rig artifact |

**Score: 1/4 killed** (+ 1/1 positive control). All three survivors are coverage findings, not shipped-code defects — recorded as fix tasks G1..G3 below.

*Isolation verified*: main-tree `git status --porcelain` before sensor `""` → after sensor + worktree removal `""`. Worktree removed with `git worktree remove --force`.

---

## Protocol Leak Audit

- **Payload shape**: `CosmeticPlayer {playerId, seed}` / `CosmeticGuest {guestId, seed}` only (`packages/shared/src/protocol/messages.ts:640-652`); `CosmeticSeeds {players, guests?}` rows-only (`:661-664`); `fromSim` projections map exactly id+seed (`registry.ts:415-428`); key-set equality + "no role key" asserted (`registry.test.ts:416-418, 424`).
- **Recipient policy**: both cosmetic rows `'all'` (`registry.test.ts:152-153`); `role:dealt` remains `'self'` (`registry.test.ts:133`) — public cosmetic and secret role stay orthogonal per design.
- **No hidden-state leakage**: grep of all new payload surfaces finds no role/grace/interior/saboteur field; `variantIndex`/`variantIndexOf`/`guestVariantOf` signatures accept only seeds (`cosmetic.ts:17-21`, `WorldScene.ts:48-50, 84-86`). Snapshot slices: guest seed rows are sameFloor-filtered (`TurnoverRoom.ts:186-190`), spectators get the full-building slice (`:933`) per FR-20 — consistent with the message-only contract (seeds are public identity by spec).
- **Denylist gate**: `packages/sim/src/literals.test.ts` green in the Gate-2 run (the `/\b300\b/` rule is what forced the documented 250ms dust deviation).

**Result: CLEAN — no leak found.**

---

## Ranked Gap List (fix tasks)

| # | Severity | Gap | Fix |
| - | -------- | --- | --- |
| G1 | HIGH | Decorrelation fork unpinned behaviorally: removing `^ COSMETIC_FORK` (making the cosmetic stream identical to the role-deal stream) passes all 552 tests (sensor M2). The FR-9 anti-leak invariant reduces to a constant-value pin (`cosmetic.test.ts:88`). | In `cosmetic.test.ts`, reconstruct the expected stream independently: `new Rng((seed ^ COSMETIC_FORK) >>> 0)` draws must reproduce `assignPlayerSeeds(seed, ids)` per sorted id (and differ from plain `new Rng(seed)` draws) |
| G2 | MED | Client variant derivation unpinned: all-bellhop regression invisible (sensor M4); harness asserts only frame range + stability, no cross-player variety or seed→frame derivation | In `art-players.spec.ts` (or via the `__TURNOVER__` hook exposing `playerSeeds`), assert per-player `frame === seed % 8` and/or ≥2 distinct frames among the 4 players |
| G3 | MED | Server snapshot guest seed rows unpinned (sensor M3): `cosmeticSeeds.guests` never asserted; mid-round joiners would render all pre-arrival guests as seed 0 | Extend `server:cosmetic_seeds` to assert `movement:snapshot.cosmeticSeeds.guests` matches `guestSeedOf` for the snapshot's guests |
| G4 | MED | **VPOL-09 has zero test coverage** — guest:left sprite/map teardown claimed in a comment, never asserted | Add a guestSprites (or guestFlow) case driving synthetic `guest-left` (juice.spec `applyAction` pattern) and asserting the `guest-*` sprite count drops to 0 |
| G5 | LOW | VPOL-11 prepped-pool vs trashed-accent differential untested (implemented via baked sheets; no assertion distinguishes the states visually) | Harness assertion comparing interior Image texture key per room state (prepped vs trashed-fresh), or an art QA sample of the two sheets |
| G6 | LOW | VPOL-12's named "harness luminance check" for grayscale separation was never written | Add a corridor-band luminance-band assertion (sample texture bands: night < carpet < wall < characters) |
| G7 | LOW | VPOL-15 deviations: dust 250ms vs spec 300ms (denylist-forced, documented in `juice.ts:11-12` but not in STATE.md); spec's "no `Text '!'`" independent-test wording contradicts shipped impl + harness (popped `Text '!'`) | Record the 250ms decision in `.specs/STATE.md`; amend the spec's independent-test wording to "popped `Text '!'` (scale overshoot), no static glyph" |

---

## Summary

**Overall**: ✅ PASS (conditional) — gates 1-3 green (typecheck ✓, biome 0 errors, 552/552 vitest, 9/9 targeted harness incl. `corridor_depth`), protocol audit clean, all 17 AC outcomes verified implemented; sensor 1/4 with three coverage survivors (G1-G3) and one uncovered AC (G4/VPOL-09). No behavior defects found in the shipped code; the pre-verification sim-side decorrelation gate genuinely pins both ⊥-role directions (VPOL-04), and the reconnect seed persistence (VPOL-05) is server-proven.

**Recommended order**: G1 (anti-leak invariant) → G4 (uncovered AC) → G2/G3 → G5-G7. After G1-G4 land with re-verification, this verdict upgrades to unqualified PASS.

---

# Iteration 2 — Re-verification (fix loop, 2026-09-03)

**Verdict: PASS (unqualified).**

Fix diff audited: `db690e5`. Sensors re-run in scratch worktree (removed; real tree clean).

| Gap | Verdict | Sensor retry |
|---|---|---|
| G1 fork behavioral pin | FIXED-VERIFIED (`cosmetic.test.ts:105-124` raw-mulberry32 reconstruction + unforked-differs assertion) | M2 KILLED — fork → plain seed fails exactly the new test |
| G2 variant derivation pin | FIXED-VERIFIED (`art-players.spec.ts:199-251` frame-multiset == seed%8-multiset via scene hook) | M4 KILLED — `setFrame(0)` always fails the multiset assertion |
| G3 snapshot guest rows | FIXED-VERIFIED (`TurnoverRoom.test.ts:3384-3421` drives guest economy, asserts restore snapshot `cosmeticSeeds.guests` matches wire row) | M3 KILLED — players-only snapshot fails on `guestRow.seed` |
| G4 guest teardown | FIXED-VERIFIED (`guestSprites.spec.ts:121-190` synthetic elder +1 → baseline; pins the now-real `applyGuestVariant` seam) | Extra control KILLED — teardown loop disabled ⇒ timeout |
| G5/G6 | DOCUMENTED (minimal) — handoff line; non-blocking nit | n/a |
| G7 | DOCUMENTED-VERIFIED — spec/tasks/STATE(AD-045)/code four-way coherence (dust 250ms, alpha 0.55) | n/a |

Regression smoke (re-run): typecheck ✓ · lint exit 0 (46 warnings, 0 errors) · test:sim **553/553** · targeted harness **6/6** (art-players 2, guestSprites 1, corridorDepth 1, juice 2).

Sensor score: **4/4 killed** (up from 1/4 in iteration 1). Clean PASS — nothing recorded to lessons.
