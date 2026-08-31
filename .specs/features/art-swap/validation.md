# Art-Swap (cycle 2.10) — Validation Report

**Verifier**: independent (author ≠ verifier; all evidence re-derived from the tree).
**Diff range**: `477dec2..389c949` (7 commits: c42ec52 T1 player sprites, 5e7df7e T2 car
sprites, 29b89ec T3 door Images, 993e607 T4 interiors, 85abb9a T5 panel sprites,
389c949 T6 bookkeeping, plus a647faf skills chore). Builds on the additive art slice
9e80b72 (unchanged in range).
**Date**: 2026-08-30.

## Verdict: **FAIL** (commit integrity — the committed range does not compile; behavior is green only after two scratch repairs)

**Result**: FAIL

The feature's *rendering behavior* is correct and its harness coverage killed 5/8
sensor mutants, but the **committed tip `389c949` cannot build or typecheck** —
`apps/client/src/scenes/WorldScene.ts` was corrupted by an unresolved cross-team
merge (T3–T6), and the committed `art-players.spec.ts` has a type error present since
T1. Every "full gate green" claim in tasks.md T1/T3/T5/T6 is inconsistent with the
committed bytes; the gates evidently ran against a *working tree* that included the
behavior team's (then-uncommitted) repairs. The same corruption is fixed on the
current shared tree only by that team's still-uncommitted WIP.

### Blocking findings (the FAIL)

1. **HIGH — committed `WorldScene.ts` fails `vite build` at `29b89ec`, `993e607`,
   `85abb9a`, `389c949`.** Two merge artifacts:
   - the comment head `/** Per-car hall-call lights (AD-024): lit from the car's
     accepted call` was clobbered, leaving orphaned comment fragments at
     `WorldScene.ts:172-174` (rolldown: "Expected `;` but found `Identifier`" at 173:13);
   - `updatePanel()` at committed lines 975-976 contains `if (lightW instanceof
     HTMLElement)` / `if (lightE instanceof HTMLElement)` **without their `const`
     declarations** (the colleague's AD-024 lines were half-dropped) — a hard
     compile error.
2. **HIGH — `pnpm typecheck` red across the whole committed range.** Committed
   `art-players.spec.ts:11` declares `frame: string` while line 70 assigns
   `frame: Number(c.frame.name)`; `tsc --noEmit -p apps/client` fails (harness is in
   the tsconfig `include`). Present from c42ec52 onward.

**Scratch repair (verifier-applied, /tmp only, behavior-neutral)**: deleted the three
orphan comment lines and the two orphan `if (lightW/E…)` lines; changed the spec's
`frame: string` → `frame: number` (byte-identical to the fix the behavior team has
since applied uncommitted on the shared tree). After repair the committed feature is
fully green (below). The **real tree must not rely on a neighbor's uncommitted WIP to
compile** — a one-commit fix (`fix(art-swap): repair merge-mangled WorldScene.ts and
harness type`) landing the two repairs is the required remediation.

---

## Gate evidence (re-run by verifier in the repaired scratch worktree at 389c949)

Scratch: `git worktree add /tmp/opencode/artswap-verify 389c949` + `pnpm install
--frozen-lockfile` + the three repairs above; Playwright config on PORT=2569
(mirrors `apps/client/harness/playwright.config.ts`; 2567 is owned by a colleague's
dev server, per tasks.md's port note).

| Check | Command | Result |
|---|---|---|
| Unit (presenter) | `pnpm vitest run apps/client/src/scenes/elevatorPresenter.test.ts` | **17/17 pass** (263 ms) |
| Harness, new art scenarios | `pnpm exec playwright test --config=… art-players art-doors art-elevator doors elevator-doors` | **5/5 pass** (18.3 s) |
| Harness, amended behavioral scenarios | `… spectator movement work round` | **10/10 pass** (1.3 min; includes round_start, no flake) |
| Typecheck (scratch, post-repair) | `pnpm --filter @turnover/client typecheck` | exit 0 |
| Build (scratch, post-repair) | `pnpm --filter @turnover/client build` | exit 0 |
| Typecheck/build (**committed bytes, unrepaired**) | same | **exit 2 / build fails** (findings 1–2) |
| Real tree, current working state | `pnpm vitest run …elevatorPresenter.test.ts`; harness `art-players` via `/tmp/opencode/harness-port.config.ts` (PORT=2568) | 17/17 pass; art-players pass. Remaining elevator specs on the real tree are currently blocked by the behavior team's uncommitted AD-025/026 WIP (`packages/sim/src/movement.test.ts` red 17/47 in their file; boarding chip never appears) — **pre-existing, not an art-swap regression** |

Real-tree porcelain captured before the sensor and re-checked after scratch teardown:
identical (29 modified + 3 untracked, all the colleague's in-flight work; verifier
wrote nothing outside `/tmp` and this report).

---

## Per-AC evidence (ART-01..20) — file:line + assertion (scratch = committed bytes + repairs)

| AC | Spec outcome | Evidence (file:line, assertion) |
|---|---|---|
| ART-01 | One `staff-walk` Sprite per player at their position + one name Text; NO player Rectangle | `apps/client/harness/art-players.spec.ts:90-92` `expect(started).toHaveLength(4)` + `every(s => s.visible)`; `:101-103` Rectangle count `expect(rectCount).toBe(0)`; per-player position via 1:1 mapping + label x-follow in `movement.spec.ts:38-46` (`labels … {text, x, visible}`) and `round.spec.ts:56-62` (`players === 4`, labels `['ada','bruno','caro','dina']`); sprite position code `WorldScene.ts:1114-1116` (read-verified) |
| ART-02 | Moving → 8-frame walk plays; settled → frame 0 idle | `art-players.spec.ts:107-134` wait for `anims.isPlaying === true` while ArrowRight held; `:136-139` after keyup `expect(idle[0]?.playing).toBe(false)` + `expect(idle[0]?.frame).toBe(0)`; 8-frame anim creation `WorldScene.ts:244-250` (`generateFrameNumbers('staff-walk', { start: 0, end: 7 })`); settle code `WorldScene.ts:1130-1132` (`anims.stop()` + `setFrame(0)`); sensor M1 killed here |
| ART-03 | Left → flipX; right → face right | `art-players.spec.ts:142-145` after ArrowLeft `expect(left[0]?.flipX).toBe(true)`; right-facing is the unflipped default (flipX asserted only for left — the "face right" leg is not explicitly asserted → INFO note 5) |
| ART-04 | Identical texture/anim-set/timing for every role (FR-9) | `art-players.spec.ts:151-153` `expect(new Set(all.map(s => s.texture))).toEqual(new Set(['staff-walk']))` across 4 players; single shared anim key `WorldScene.ts:244-250` (structurally role-blind — the scene never receives a role). **Timing identicality is unasserted → sensor M8 survivor → Gap 4 (LOW)** |
| ART-05 | Fired player's sprite+label removed (justice semantics) | `apps/client/harness/spectator.spec.ts:147-148` after firing `expect(rects).toHaveLength(3)` on the fired page ("the fired one is gone"); `:198-199` live page also 3 — removal everywhere; filter is the staff-walk texture (`:58`) |
| ART-06 | `door-closed` Image per room segment per guest floor, phase-free, replaces DOM frames | `apps/client/harness/doors.spec.ts:70-71` lobby view `expect(doorImageCount(page)).toBe(24)` + 0 visible; `:111-119` pre-round floor1: 8 `door:floor1:*` Images all visible; round phase unchanged `art-doors.spec.ts:89` (`total === 24`); `#doors-layer` removal — no references remain (rg, repo-wide) |
| ART-07 | Live `room:entered` cue → that room renders `door-open` at every position receiving the cue (hallway included) | **NOT COVERED → sensor M7 survivor → Gap 2 (MEDIUM).** The only `door-open` texture assertion is `art-doors.spec.ts:166,181` (`openDoors === 1`) which fires via the own-room branch (ownRoom === room); a cue-only hallway opening + its expiry is unpinned. `evidence.spec.ts` asserts the DOM cue markers, never the door texture |
| ART-08 | Own-room doorway open with interior mapped `prepped\|fresh` → `room-prepped`, `trashed` → `room-trash-fresh`, `settled` → `room-trash-settled` | `art-doors.spec.ts:178-181` inside: `expect(inside.visible).toBe(1)`; `expect(inside.textures).toEqual(['room-prepped'])`; `expect(inside.openDoors).toBe(1)`. Mapping code `WorldScene.ts:791-800`. **Trash-state legs unasserted → sensor M3 survivor → Gap 3 (LOW)** |
| ART-09 | Non-observer (non-spectator) has NO interior Image for the room; doorway shows nothing beyond the frame | `art-doors.spec.ts:195-196` after stepping out `expect(outside.visible).toBe(0)`; `spectator.spec.ts:220-233` live hallway page `expect(liveInteriors).toBe(0)`; sensor M4 killed here |
| ART-10 | No gray-box state tints: door texture set is exactly `door-closed` for unobserved rooms | `art-doors.spec.ts:91` `expect(summary.textures).toEqual(['door-closed'])`; tint plumbing removed from `syncDoors` (`WorldScene.ts:810-848` — no color/tint on door Images, read-verified) |
| ART-11 | Door Images persist phase-free across round end / lobby return | `doors.spec.ts` (pre-round leg, `:59-121`) + `art-doors.spec.ts:83-95` (round leg, same 24-Image set) — same map, no phase gate (code `buildDoorImages` runs at mount, `WorldScene.ts:775-786`) |
| ART-12 | Spectator baseline → interior Image per known room behind its lane door | `spectator.spec.ts:206-219` `expect(firedInteriors).toBe(24)` on the fired page; baseline snapshot pin `:141` (`snapshot.rooms` 24); render code `WorldScene.ts:877-899` |
| ART-13 | Stacked lanes keep plain backdrop (no per-lane band) + ART-01..04 rules per lane | Per-lane sprite rules: `spectator.spec.ts:58,147-148` (staff-walk per lane) and `:170-188` visible door lanes `toEqual(['floor1','floor2','floor3'])`. **Band absence unasserted in harness** (implementation `WorldScene.ts:242` `setVisible(!this.spectator)`, read-verified) → INFO note 6 |
| ART-14 | Live scene holds interior Images for at most the one room stood inside | `art-doors.spec.ts:178-179` exactly 1 while inside; `spectator.spec.ts:233` `expect(liveInteriors).toBe(0)` from the hallway; single-slot implementation `WorldScene.ts:856-874` |
| ART-15 | Parked/dwelling → `elevator-car` open-cage frame (0); closed state → closed frame (1) or hide, per ELAN | `art-elevator.spec.ts:56-58` parked: `every(c => c.visible && c.frame === 0)`; `:75-101` wait for frame 1 after the call closes doors; `:118-148` frame 0 visible at the arrival dwell; unit `elevatorPresenter.test.ts:217-235` (`car1.frames.at(-1)` `toBe(0)` open / `toBe(1)` closed); transit hide `elevator-doors.spec.ts:104-113,146-157` |
| ART-16 | Swap changes no boarding predicate / dwell timing / reveal rule | Presenter clock untouched (unit suite 17/17: dwell-from-moved `:55-64`, minTransit 2000 ms `:92-94`, no-distance-duration `:96-105`, arrival fade/slide `:108-136`); `elevator-doors.spec.ts` ELAN visibility/alpha/y assertions preserved and green |
| ART-17 | Call → `elevator-panel` flash frame for the window, then idle; decoys flash identically; no occupants rendered | `elevatorLobby.spec.ts:75-87` no-intent → idle `expect(idleFrame).toBe(0)`; `:184-213` decoy call: panel `frame.name === 1` then back to `0` (AD-012); real-call flash pinned by the same frame contract; panel sprites carry no occupant data (code `WorldScene.ts:1002-1013` — frame only); sensor M5 killed here |
| ART-18 | Texture-based filters in round/movement/work/spectator/elevator-doors/doors; no Rectangle/Ellipse counts for swapped primitives | `round.spec.ts:56-58`, `movement.spec.ts:44-46` + `:276-283`, `work.spec.ts:40-42`, `spectator.spec.ts:58`, `elevator-doors.spec.ts:34-38,109-113,148-153`, `doors.spec.ts:35,53` — all filter `texture.key === 'staff-walk'/'elevator-car'` or `name.startsWith('door:')`; repo-wide rg: the only remaining `Rectangle` reference is `art-players.spec.ts:101`'s negative ART-01 assertion (`toBe(0)`), and no `Ellipse` reference remains in any spec |
| ART-19 | Amended scenarios preserve original behavioral assertions | All amended scenarios pass in the scratch: round 2/2, movement 3/3, work 1/1, spectator 1/1, elevator-doors 1/1, doors 1/1, elevatorLobby 1/1 (12 tests) — labels, counts, visibility, timing semantics re-asserted unchanged (spot-checks: `round.spec.ts:62-63` labels, `movement.spec.ts` chip/press assertions, `elevator-doors.spec.ts:157,159` panel text) |
| ART-20 | Swapped manifest assets `approved` + `in_engine_reviewed`; AD-020 visual-target approval recorded in STATE.md | Manifest ✅: `docs/art/asset-manifest.json` — all wired swapped assets (staff-walk, door-closed, door-open, 3 interiors, corridor-band, elevator-car, elevator-panel, fx-rustle) `status: "approved"`, `verification.in_engine_reviewed: true`; door-card `in-review` (unwired, out of scope); staff-work `deferred` (Phase 3, FR-9 audit — matches spec assumption). **STATE.md ❌: no visual-target approval record exists** — the Handoff section is still round-end's, AD-021 status line still reads "cycle specified, not started", and the AD-020 entry was not updated. T6's "handoff written" note deferred it to a behavior-team commit that does not contain it → Gap 5 (MEDIUM, bookkeeping) |

**Sensor note on ART-04/FR-9**: the harness is role-blind by construction (the client
never receives a role), so FR-9's "no tell may exist" is mostly a *protocol* property;
the presentation-side residual risk is exactly the timing/anims axis that M8 showed
unpinned.

---

## Discrimination sensor (8 mutants, scratch worktree, restored to pristine baseline after each)

| # | Mutant (behavior-level) | Target file | Outcome | Killed by |
|---|---|---|---|---|
| M1 | Walk anim never settles (idle branch removed) | `WorldScene.ts:1130-1132` | **KILLED** | `art-players.spec.ts:136-139` (idle `playing === false`, `frame === 0`) |
| M2 | flipX inverted (`'left'` → `'right'`) | `WorldScene.ts:1127` | **KILLED** | `art-players.spec.ts:142-145` (`flipX === true` on ArrowLeft) |
| M3 | Interior mapping swaps trashed/settled | `WorldScene.ts:791-800` | **SURVIVED** | — (Gap 3) |
| M4 | Interior Image persists after leaving the own-room segment | `WorldScene.ts:856-861` | **KILLED** | `art-doors.spec.ts:195-196` (`outside.visible === 0`) |
| M5 | Panel never returns to idle after first flash | `WorldScene.ts:1011` | **KILLED** | `elevatorLobby.spec.ts:204-213` (frame back to `0` after the decoy flash) |
| M6 | Car frame stuck at open (never frame 1) | `elevatorPresenter.ts:268` | **KILLED ×2** | `elevatorPresenter.test.ts:234` (`frames.at(-1)` `toBe(1)`) AND `art-elevator.spec.ts:75-101` (frame-1 wait) |
| M7 | Cue-driven `door-open` removed (only own-room opens) | `WorldScene.ts:833-838` | **SURVIVED** | — (Gap 2; mutant verified live during the run, baseline re-green after restore) |
| M8 | FR-9 break: per-player `anims.timeScale` offset by name length | `WorldScene.ts` (addPlayerDisplay) | **SURVIVED** | — (Gap 4) |

**Score: 5/8 killed.** Each mutant was applied alone to the repaired scratch; the
baseline was re-verified green after the last mutant; the real tree was never touched.

---

## Spec-precision gaps (ranked)

1. **HIGH — committed range does not compile** (WorldScene.ts merge mangling at
   29b89ec..389c949; vite build fails). Remediation: one `fix(art-swap)` commit with
   the three scratch repairs (comment orphans, orphan `if (lightW/E…)`, spec type).
2. **HIGH — `pnpm typecheck` red on the committed range** (`art-players.spec.ts`
   `frame: string` vs `Number(...)` since c42ec52). Same remediation commit.
3. **MEDIUM — ART-07 cue-driven door-open is unasserted** (M7 survivor): no scenario
   flips a door to `door-open` from a live `room:entered` cue observed from the
   hallway, and none asserts the door closing at cue expiry. Fix: extend
   `client:art_doors` (or `client:evidence_cues`) — watcher on the floor while another
   player enters: `door:<floor>:<room>` texture becomes `door-open`, then reverts.
4. **MEDIUM — ART-20 STATE.md half missing**: manifest approved ✓, but the AD-020
   visual-target approval is not recorded in `.specs/STATE.md` (handoff/AD-021 status
   never updated). Fix: add the handoff + approval note (T6's deferred write).
5. **LOW — ART-08 trash mapping unasserted** (M3 survivor): `room-trash-fresh` /
   `room-trash-settled` are never read by any test. Fix: a scenario that un-preps
   (saboteur or post-settle) and reads the interior texture while inside.
6. **LOW — ART-04 frame-timing identicality unasserted** (M8 survivor): add a
   timeScale/framerate read across all four sprites (e.g. `anims.timeScale === 1`
   for every sprite) to `client:art_players`.
7. **INFO — ART-13 "no per-lane band" is read-verified only**; a one-line
   TileSprite-visibility check in `client:spectator_view` would pin it.
8. **INFO — ART-03 "face right" leg** (flipX false after moving right) is implicit;
   ART-01 "at that player's position" is asserted via the label-x contract rather
   than sprite x directly.

---

## Reproduction notes

- Scratch config: `/tmp/opencode/artswap-verify.port.config.mjs` (PORT=2569,
  `reuseExistingServer: false`, worktree cwd); deleted with the worktree after the
  sensor. The disposable real-tree config `/tmp/opencode/harness-port.config.ts`
  (PORT=2568) was used for the real-tree spot checks and is the same one tasks.md
  prescribes while 2567 is occupied.
- On the *real tree as-is*, only the presenter unit tests and `art-players` run green;
  every boarding-dependent spec is blocked by the colleague's uncommitted AD-025/026
  sim WIP (17 failing tests confined to `packages/sim/src/movement.test.ts`, chip
  never appears after the call press). This is recorded as pre-existing and outside
  this cycle's surface — do not "fix" it as part of art-swap.
