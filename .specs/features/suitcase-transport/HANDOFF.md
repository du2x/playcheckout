# HANDOFF — Cycle 3.B `suitcase-transport` → next session

Status when written: 2026-08-31, master @ `cccd67c`. All six tasks implemented and
committed; independent Verifier iteration 2 = FAIL on a single minor gap
(SUI-23 assertion non-discriminating). The user then issued new design rulings
(AD-034 below) that rework part of the shipped scope. Next session implements
AD-034, closes SUI-23, and re-runs the Verifier (iteration 3).

## Read first

1. `AGENTS.md` (repo rules, verification ladder, hard constraints)
2. `.specs/STATE.md` — Decisions AD-028…AD-034 (034 = this handoff's ruling)
3. `.specs/features/suitcase-transport/spec.md` + `design.md` + `tasks.md`
4. `.specs/proposals/guest-transport-economy.md` (v1.4 proposal)
5. `.specs/features/suitcase-transport/validation.md` (Verifier iteration-2 FAIL report)

## Current state (verified)

- Gates: typecheck 4/4 ✅ · lint (biome) ✅ · `pnpm test:sim` 385 ✅
- `pnpm test:client suitcase` 3/3 green in consecutive runs at scale 0.5
- Feature commits: `ad0341e` (protocol), `e7385b8` (sim core + deletions),
  `73cb60c` (guest-following + carry clock), `99f537f` (walkie lifecycle feed),
  `7fae41e` (client slice — NOTE: partially lost and rebuilt, see Gotchas),
  `aed4cf7` (docs/T6), `cccd67c` (restored slice + simplified spec)
- Pre-cycle docs commit `131af9e` (prd v1.4/AD-032) is NOT part of the feature.
- Verifier iteration 1 (4 gaps) → fixed in `cccd67c`; iteration 2 verdict FAIL
  with ONE remaining gap: **SUI-23 non-discriminating** — the last-5 walkie
  assertion (`suitcase.spec.ts` test 1, count ≤5) passes even with the trim
  removed, because only ~3 lines exist per round at scale 0.5.
- Leak audit (iteration 2): clean. SPEC_DEVIATION `dropCarry` (desk absorbs the
  suitcase) consistently documented (guests.ts + AD-033(f)).

## AD-034 — user rulings (2026-08-31, given while watching a headed run)

Verbatim decisions from the user; to be implemented and then recorded as an AD
in `.specs/STATE.md` (status: active) with the spec amended:

1. **The room assignment is a building-wide notice.** "Não existe isso de 'até
   3 tiles da recepção' — o aviso é para todos players." Every player learns
   the assignment at check-in. Consequence accepted by the user: the saboteur
   gets the room for free — the contested gameplay is physical interception of
   the suitcase, not information.
2. **The blind-place confirm is removed.** With public assignments, "you
   haven't heard this guest's room" can never trigger — SUI-26 is dropped and
   the confirm UI/logic deleted.
3. **The suitcase rests in front of the door** ("em frente a porta ou quase em
   frente"). Already the shipped behavior (rest position = room segment center
   = the door visual); pin it explicitly in the spec (SUI-24 note). No code
   change expected.
4. **The restaurant (~30 s guest dwell) is deferred** to cycle 3.C, as planned.
   The 3.B holding-area stub stays. No code change.
5. The buzzer ending ("SABOTEUR WINS" when coverage fails at 30 s) is normal
   game behavior — the headed run simply surfaced it.

## Implementation checklist (AD-034 rework)

Registry-first (compile forces consumers — do shared first):

1. **`packages/shared`**:
   - `simEvents.ts`: rename `assignment:overheard` → `guest:assigned`
     (`{guestId, floor, room}`); update the comment block (building-wide
     notice; the earshot model is gone).
   - `messages.ts`: rename `AssignmentOverheard` → `GuestAssigned`.
   - `registry.ts`: row `guest:assigned` with `recipients: 'all'`; DELETE the
     `deskEarshot` policy value, the `EventVisibility.x` field, and the
     `TUNING` import if now unused.
   - `tuning.ts`: DELETE `DESK_EARSHOT_TILES` (recorded removal in AD-034).
   - `registry.test.ts`: literal-policy catalog (`guest:assigned: 'all'`,
     drop `assignment:overheard`), valid-policy list without `deskEarshot`.
2. **`apps/server`**:
   - `router.ts`: DELETE the `deskEarshot` dispatch branch.
   - `router.test.ts`: DELETE the `deskEarshot` describe; add a test that
     `guest:assigned` rides `'all'` (every connected page receives it).
   - `TurnoverRoom.test.ts` `server:suitcase_carry`: invert the earshot
     assertions — ALL four pages receive `guest:assigned`; the pre-walk of
     player `a` out of earshot is now irrelevant (remove or keep harmlessly).
3. **`packages/sim`**:
   - `guests.ts` `checkIn`: emit `guest:assigned` (same payload shape) instead
     of `assignment:overheard`. Reservation model, exactly-once semantics and
     everything else unchanged.
   - `guests.test.ts` / `roundSim.test.ts`: rename the event type in the
     suites (`sim:assignment_overhear` → `sim:assignment_announce`); keep the
     exactly-once count assertion (it still kills the re-emit mutant).
4. **`apps/client`**:
   - `mappers.ts` / `state.ts`: action `assignment-overheard` →
     `guest-assigned` (route stays `scene`).
   - `WorldScene.ts`: feed `heardAssignments` from the renamed action (every
     client now receives every assignment); add the walkie line
     `a guest announces: I'm in ${floor}:${room}` (building-wide notice);
     REMOVE the place-confirm (`placeConfirm`, `openPlaceConfirm`,
     `closePlaceConfirm`, `#place-confirm` DOM) and the confirm branch in the
     E ladder — a carrier at a door always places directly. Keep the owned
     marker assignment hint (convenience surface).
5. **Harness** (`apps/client/harness/suitcase.spec.ts`):
   - DELETE test 3 (blind-place confirm) — the feature is gone.
   - Test 1: assert the announce line ("I'm in floor") on ALL pages.
   - Test 2 unchanged except: `#place-confirm` no longer exists (drop the
     `confirmBefore` assertion).
6. **Docs**: spec.md — amend SUI-03/04 (building-wide), drop SUI-26, rewrite
   SUI-27 (the notice is the building-wide surface; the marker hint is
   convenience), pin "rests in front of the door" in SUI-24; update the
   assumptions table + traceability. `CONTEXT.md`: replace the earshot entry
   with the room-notice vocabulary. `roadmap.md` 3.B row: append
   "(amended by AD-034: assignment announced building-wide; confirm dropped)".
   `.specs/STATE.md`: AD-034 already drafted in Decisions — flip status to
   active once implementation lands.

## SUI-23 (the one open Verifier gap)

The last-5 walkie assertion must discriminate: drive >5 lifecycle lines and
assert `count === 5` AND that the early "takes" line was evicted (newest-first
kept). Attempted via `TURNOVER_TEST_GUEST_SCALE=0.2` (arrivals every 6 s → 6+
lines) — works for line volume BUT test 3 flaked at 56 s under it (more
ambient guests racing the choreography). With test 3 deleted (AD-034), retry
scale 0.2 and run the suitcase suite ≥2× consecutively; if it still flakes,
fall back to scale 0.5 and instead drive lines in test 2 (arrival + takes +
pickup + a second guest's arrival + …) and assert `≤5` + newest-first order —
flag it as spec-precision-accepted in validation.md.

## Verification ladder for closing the cycle

1. `pnpm typecheck && pnpm lint`
2. `pnpm test:sim` (expect ~385 green; the apps/server REG-18 seq-continuity
   test is a known pre-3.B load flake — reproduced failing on commit `131af9e`)
3. `pnpm test:client suitcase` ≥2 consecutive green runs
4. `pnpm test:client` once, full — the rotating single-spec flakes
   (justice/lobby/round/spectator) are pre-existing (reproduced on `131af9e`
   in an isolated worktree); document, don't chase.
5. Dispatch a FRESH Verifier sub-agent (iteration 3) with
   `/tmp/opencode/validate-ref.md` does NOT exist in a new session — use the
   skill's `references/validate.md` from the `tlc-spec-driven` skill instead.
   Then `python3 <skill-dir>/scripts/validate_state.py suitcase-transport`
   must exit 0.

## Gotchas learned the hard way (do not rediscover)

- **Never `git checkout <file>` over uncommitted work** — that is how the T5
  client slice was lost and had to be rebuilt (the current `cccd67c` contains
  the rebuild; diff-verify `WorldScene.ts` contains `syncSuitcases`,
  `ownCarriedGuest`, `ownDoorRoom`, `ownNearRestingSuitcase`,
  `openPlaceConfirm` after AD-034 removes the confirm).
- Registry exhaustiveness: adding/removing a sim event or registry row forces
  client mappers + the literal-policy test to move in the SAME commit.
- `s.replace` in scripted edits silently no-ops on no match — verify each edit
  landed (`grep`) before running gates.
- Commit convention: Conventional Commits, verified by the skill's
  `check_commit.py` (≤72-char subject preferred).
- Elevator interplay in harness specs: use the press-retry pattern (AD-028)
  for boarding and floor presses; detect arrival via `elevator:doors` events,
  NOT the own label (riders have no floor stream until exit, AD-008).
- The walkie "takes"/"picks up" lines are the client feed's — placement emits
  NOTHING (SUI-21/22); the leak audit asserts the assignment notice and no
  pre-settle room surfaces.
