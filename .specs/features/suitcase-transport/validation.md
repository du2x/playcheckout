# Suitcase Transport Validation (cycle 3.B) — ITERATION 3

**Date**: 2026-08-31
**Spec**: `.specs/features/suitcase-transport/spec.md` (amended by AD-034 — building-wide assignment notice, SUI-26 dropped, SUI-27 rewritten, SUI-24 pins rest-in-front-of-door; scenario `sim:assignment_overhear` renamed `sim:assignment_announce`)
**Diff range**: `131af9e..HEAD` (9 commits; the AD-034 rework commit is 5ad1d1c; prior feature commits ad0341e..cccd67c were verified in iterations 1–2 and re-spot-checked where the rename touched them)
**Verifier**: independent sub-agent (author ≠ verifier). Working tree READ-ONLY; all mutations ran in throwaway worktree `/tmp/opencode/verifier3-scratch` (removed; real-tree `git status --porcelain` empty before AND after — baseline preserved, never stashed).

---

## Verdict: ✅ PASS (iteration 3 of 3)

The iteration-2 surviving mutant E (SUI-23 last-5 trim) is now **killed** by the
volume-driven assertion. The AD-034 rework (assignment:overheard → guest:assigned
on the 'all' policy; blind-place confirm removed) is verified end to end, with
two fresh behavior-level mutations in the renamed path both killed. Gates green.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 wire/protocol | ✅ Done | re-verified post-rename: `guest:assigned` row `recipients: 'all'` (`registry.ts:326-336`), `deskEarshot` policy + `EventVisibility.x` + `TUNING.DESK_EARSHOT_TILES` deleted (`registry.ts` RecipientPolicy, `tuning.ts`); router broadcast branch is the 'all' fallthrough (`router.ts:174-175`) |
| T2 sim core | ✅ Done | done-when boxes unticked in tasks.md (bookkeeping oversight) but every clause is test-verified — see AC table SUI-01/02/07–12/20 |
| T3 guest-following + clock | ✅ Done | suites re-verified green this session |
| T4 walkie lifecycle log | ✅ Done | single emitter `guests.ts:349`; deletions structural |
| T5 client slice | ✅ Done | reworked by 5ad1d1c: announce line on every page, confirm deleted, ladder verified at `WorldScene.ts:869-899` |
| T6 gates/docs | ✅ Done | AD-033 recorded; AD-034 active in STATE.md; spec.md amended (SUI-26 marked Dropped) |

Stale-wording note: tasks.md T1 and design.md still describe the pre-AD-034
`assignment:overheard`/`deskEarshot` model — per the governing-document rule
(amended spec.md + STATE.md AD-034), treated as amended; no code or test
references to the old names remain (grep over packages+apps: zero).

---

## Spec-Anchored Acceptance Criteria (re-derived, post-AD-034)

Legend: ✅ concrete assertion matches spec outcome · ⚠️ spec-precision gap (accepted — spec defines no precise outcome / assumption-default, not an AC) · n/a = dropped.

### P1: Check-in hands off the suitcase (SUI-01..06)

| AC | Spec-defined outcome (post-AD-034) | `file:line` + assertion | Result |
| -- | ---------------------------------- | ----------------------- | ------ |
| SUI-01 | check-in accepted; reservation excludes the room; carrier set; guest to holding area | `packages/sim/src/guests.test.ts:278` `checkIn(...) === 'accepted'`; `:286-288` carried flush; `:290-291` hold x === `GUEST_HOLD_START_TILES`; reservation `:294-305` `expect([...reserved]).toEqual(['floor:room'])` | ✅ |
| SUI-02 | already-carrying desk E ignored silently | `guests.test.ts:312` `'ignored'`; wire silence `TurnoverRoom.test.ts:2742-2781` (out-of-zone E + empty-handed place ⇒ no suitcase-shaped message) | ✅ |
| SUI-03 | assignment notice emitted exactly once at the check-in tick ('all' policy) | `guests.test.ts:418-446` (`sim:assignment_announce`): FULL flush stream through carry→place→pickup→place + 200 ticks, `expect(overheard).toHaveLength(1)` `:442`, guestId pinned `:445`; policy pin `registry.test.ts:144` `'guest:assigned': 'all'`; sole emitter `guests.ts:349` (grep: no second); **mutant-verified** (mutation F re-emitting on pickup → `:442` fails 1 vs 2) | ✅ |
| SUI-04 | every connected player receives it (AD-034); never any later time, any other surface | `router.test.ts:299-321` — lobby viewer + other-floor viewer + rider + spectator ALL receive exactly 1 `guest:assigned` with payload `{guestId, floor, room}`; `TurnoverRoom.test.ts:2719-2727` all four live collectors receive it; late-surface prohibition: exactly-once stream test `guests.test.ts:442` + no other emitter (grep) | ✅ |
| SUI-05 | outcomes derive only from server truth (no claim input) | structural: `desk:send`/`walkie:broadcast` deleted — registry key-set equality `registry.test.ts:173-175`; grep zero live references; guest targeting reads `sc.rest` (`guests.ts:569+`) | ✅ (structural) |
| SUI-06 | self-assign exactly the 3.1 behavior | `guests.test.ts:127-170` GUEST-04/05 suites unchanged (re-run green) | ✅ |

### P1: Carry, place, pick up (SUI-07..12)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-07 | place rests at doorway, `suitcase:placed` sameFloor, clock stops, NO walkie line | `guests.test.ts:325` `'placed'`; `:327-329` flush is exactly `['suitcase:placed']`; policy `registry.ts:340-342` `recipients: 'sameFloor'` + `registry.test.ts:146` pin; clock-stop sequence `:555-561` | ✅ |
| SUI-08 | pickup by anyone in range → carrier change + fresh leg; self-regrab allowed | `guests.test.ts:356` p2 `'picked_up'`; fresh leg drain `:555/572`; self-regrab e2e `suitcase.spec.ts:413-419` ("«ada» picks up a suitcase") | ✅ |
| SUI-09 | carrying player's place/pickup ignored silently | `guests.test.ts:371,373` `'ignored'` ×2 | ✅ |
| SUI-10 | out-of-range place ignored silently | `guests.test.ts:342` `'ignored'` + zero events; mutant-verified iter-2 (mutation A) | ✅ |
| SUI-11 | carry blocks work STARTS; accusation/elevator fine; active channel completes | `roundSim.test.ts:558` `'carrying'`; `:561` accuse resolves; `:566-570` channel completes | ✅ |
| SUI-12 | suitcase rides carrier, sameFloor visible | `suitcase.spec.ts:266-288` visible Rectangle within 30px of own label x; policies `registry.test.ts:145,147` | ✅ |

### P1: Guest follows the suitcase (SUI-13..17)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-13 | walk to last resting room; mid-walk pickup → continue + door-wait; re-target on rest | `guests.test.ts:472` complaint proves the walk; door-wait `:497-537` — no settle while carried (`:525`), same-room re-rest settles immediately (`:535`) | ✅ (door POSITION during wait not pinned — ⚠️ accepted, outcome-level) |
| SUI-14 | correct → settle/tenancy; wrong → building-wide complaint naming room+guest, never assignment | `guests.test.ts:472` complaint `{floor, room}`; `:490` `settled === assignment`; `:491-493` tenanted + reservation released; `registry.test.ts:148` `'all'` | ✅ |
| SUI-15 | no personal penalty / placer event | `guests.test.ts:332` place flush exactly `['suitcase:placed']`; complaint payload `{guestId, floor, room}` only | ✅ (structural) |
| SUI-16 | trashed room settles silently in 3.B | `roundSim.test.ts:574-615` `settled === true && complained === false` | ✅ |
| SUI-17 | walking guest dies at buzzer | `roundSim.test.ts:404-424` zero guest events after end | ✅ |

### P2: Carry clock (SUI-18..20)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-18 | expiry fires CURRENT carrier (justice teardown), rests at desk, re-queues front, voids assignment | `roundSim.test.ts:661-662` `fired.reason === 'carry-clock'` on the carrier; re-check-in `:665`; front re-queue + impatience `guests.test.ts:383-394`; mutant-verified iter-2 (mutation B) | ✅ |
| SUI-19 | clock runs only while carried; fresh leg per pickup | `guests.test.ts:555,561,570,572` drain `['p1'] → [] → [] → ['p2']` | ✅ |
| SUI-20 | fired/ghost/disconnect mid-carry → identical aftermath | `roundSim.test.ts:519-533` ghost; `:617-631` `sim.leave` + re-check-in | ✅ |

### P2: Walkie lifecycle log (SUI-21..23)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-21 | every lifecycle fact renders a server line; placement emits none | sim fact-set pin `guests.test.ts:573-577`; announce line on every page `suitcase.spec.ts:252-264`; place silence `:410-411` `not.toMatch(/place/i)` | ✅ |
| SUI-22 | `walkie:broadcast`/`desk:send`/send-menu deleted | `registry.test.ts:173-175` exact key-set equality; grep zero live references; denylist `router.test.ts:327-340` | ✅ |
| SUI-23 | walkie log keeps its last-5-lines DOM contract | `suitcase.spec.ts:304-349` VOLUME-DRIVEN: counts walkie-producing wire events, waits for 5 MORE after baseline (`:333-342`), asserts `lineCount === 5` (`:346`), early "«ada» takes" line evicted (`:348`), newer lines remain (`:349`); volume from `TURNOVER_TEST_GUEST_SCALE=0.2` (`playwright.config.ts:36`); **mutant-verified this session**: trim removed → test FAILS (expected 5, received 8) | ✅ (iteration-2 gap closed — discriminating) |

### P2: Client suitcase slice (SUI-24..27) — e2e green (given: 2/2, two consecutive runs, close-out)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-24 | marker rides carrier or rests at doorway, sameFloor only; rest position IN FRONT OF THE DOOR (AD-034(c)) | riding `suitcase.spec.ts:266-288`; resting at `doorXTiles(1) * TILE` `:389-409` (door x, not segment interior); snapshot rows floor-filtered `TurnoverRoom.ts:147-156` | ✅ |
| SUI-25 | E ladder: desk → landing → place (direct) → pickup → else call/accuse | `WorldScene.ts:869-899` — desk `:875-878`, place DIRECT `:880-887` (comment: confirm removed AD-034), pickup `:888-890`, hold `:892-898`; e2e place-without-confirm `suitcase.spec.ts:383-387` | ✅ |
| SUI-26 | DROPPED (AD-034) — confirm cannot exist; spec marks Dropped | `#place-confirm`/`openPlaceConfirm` gone (grep zero); ladder places directly `WorldScene.ts:883-886`; spec.md:270-272 | n/a (dropped) |
| SUI-27 | assignment surface = building-wide announce line on EVERY client; owned marker hint is a carrier convenience; no other surface names the room pre-settle/complaint | announce on all 4 pages `suitcase.spec.ts:258-264`; hint carrier-only `:290-302` (3 other pages `visible === false`); leak audit below | ✅ |

**Status**: ✅ All 26 active ACs covered with spec-precise assertions (SUI-26 dropped by AD-034); 4 accepted ⚠️ notes carried from iteration 2 (SUI-13 door position, ladder tie-order, no-vacancy branch, self-assign-next-to-resting-suitcase — all assumption-defaults/outcome-level, none an AC).

---

## Leak Audit (post-AD-034)

- **`guest:assigned` is 'all' BY DECISION (AD-034)** — the saboteur learning the assignment is the user-confirmed consequence, NOT a leak. Emitted exactly once per guest: sole emitter `packages/sim/src/guests.ts:349` inside `checkIn` (grep over packages+apps incl. server room code: no second push of `guest:assigned`); exactly-once pinned by `guests.test.ts:442` over the full flush stream (mutant-killed) and by `TurnoverRoom.test.ts:2721-2722` (count lives in the sim suite). ✅
- **No OTHER surface names a resting suitcase's room to off-floor players pre-settle/complaint**: `suitcase:placed` still `recipients: 'sameFloor'` (`registry.ts:340-342`, pinned `registry.test.ts:146`); snapshot rows still floor-filtered (`TurnoverRoom.ts:147-156` — normal viewers own-floor only, riders none); `guest:complained` ('all') is the sanctioned complaint event and names room+guest, never the assignment; `guest:settled`/`checked_out` name rooms only post-settle (sanctioned). ✅
- **No client-authored line**: broadcast/desk:send deleted; key-set equality + send-bypass denylist green. ✅

---

## Discrimination Sensor (iteration 3)

Scratch: `git worktree add /tmp/opencode/verifier3-scratch HEAD` + `pnpm install` (703 ms, linked); mutations reverted via `git checkout` inside the scratch only; worktree removed with `--force`; real-tree porcelain empty before and after. Sensor depth: lightweight (3 targeted behavior-level mutations, one per open risk).

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| E (iteration-2 survivor, re-injected) | `apps/client/src/scenes/WorldScene.ts:1033` | Last-5 walkie trim removed: `while (this.walkieLog.children.length > 5)` → `while (false && …)`; ran ONLY the suitcase suite (`pnpm exec playwright test --config apps/client/harness/playwright.config.ts apps/client/harness/suitcase.spec.ts`) | ✅ **KILLED** — test 1 FAILS at `suitcase.spec.ts:346`: `expect(lineCount).toBe(5)` received **8**. The volume-driven SUI-23 assertion discriminates. |
| F (renamed path) | `packages/sim/src/guests.ts:408-415` | `pickupSuitcase` re-emits `guest:assigned` (payload from the guest's `assigned` roll) — the AD-034 analogue of iteration-1's M3; ran `pnpm vitest run packages/sim/src/guests.test.ts packages/sim/src/roundSim.test.ts packages/shared/src/protocol/registry.test.ts` | ✅ **KILLED** — `guests.test.ts:442` (`sim:assignment_announce` exactly-once over the FULL flush stream) fails: expected 1, received 2. |
| G (router 'all' path) | `apps/server/src/rooms/router.ts:174-179` | Broadcast ('all') delivery skips spectators; ran `pnpm vitest run apps/server/src/rooms/router.test.ts packages/shared/src/protocol/registry.test.ts` | ✅ **KILLED** — `router.test.ts:317` (`guest:assigned` building-wide test) fails: spectator `sent` length 0 vs 1. |

**Result**: 3/3 killed — **PASS ✅**. (Iteration-2 mutants A/B/D and C-moot status re-confirmed from the iteration-2 report; C is moot by design — the policy is 'all' per AD-034. Note: the superseded iteration-2 section below keeps its historical text verbatim; its marker line was reformatted so the deterministic gate reads THIS section's verdict.)

---

## Gate Check

- **Gate command** (build level, per tasks.md): `pnpm typecheck && pnpm lint && pnpm test:sim`
- `pnpm typecheck`: ✅ 4/4 projects
- `pnpm lint` (biome check .): ✅ 110 files, no issues
- `pnpm test:sim`: ✅ **385/385** (23 files, 54.3 s) — single run, no REG-18 flake this session; includes `sim:suitcase_carry` / `sim:assignment_announce` / `sim:carry_clock` / `sim:wrong_delivery`
- `pnpm test:client`: full run NOT re-run (per directive — rotating flake class art-doors/justice/lobby/round is pre-existing, reproduced on pre-rework HEAD d242c72, documented in the close-out). `pnpm test:client suitcase` 2/2 green ×2 consecutive runs taken as given from the close-out; the scratch mutant-E run was executed independently (see sensor).
- Test count: 385 sim-side (unchanged from iteration 2; 0 deleted, 0 skipped). Client suite: 2 tests (confirm test deleted by AD-034 — justified: SUI-26 dropped).

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ 5ad1d1c is a registry-first rename + deletion (−409/+332) |
| Surgical changes | ✅ deskEarshot machinery fully excised (policy, EventVisibility.x, tuning constant, router branch) — no dead remnants (grep zero) |
| Matches patterns | ✅ registry/mapper/scene-action patterns preserved; RecipientPolicy union shrunk, not forked |
| Every test maps to a spec requirement | ✅ suites name their SUI ids; rename kept assertion strength (`sim:assignment_announce` identical semantics) |
| SPEC_DEVIATION consistency | ✅ AD-033(f) desk-absorb story unchanged; AD-034 recorded in STATE.md, spec.md, CONTEXT.md, roadmap.md |
| Spec-anchored outcome check | ✅ all 26 active ACs assert spec-precise outcomes; SUI-23 now discriminating |

---

## Edge Cases (carried from iteration 2; none touched by 5ad1d1c)

- [x] Same-tick E race → deterministic intent-arrival order (structural; front re-queue `guests.test.ts:398-415`)
- [x] Voided reservation re-assignable (`roundSim.test.ts:665`)
- [x] Rest at the guest's wait-at door → immediate resolution (`guests.test.ts:528-535`)
- [x] Spectator receives the building-wide notice (AD-034(e)) — `router.test.ts:304,316` + mutant G
- [x] Guest mid-walk pickup → door-wait + re-target (`guests.test.ts:497-537`)
- [x] Trashed settle silent (`roundSim.test.ts:574-615`)
- [x] Buzzer kills walking guests (`roundSim.test.ts:404-424`)
- ⚠️ accepted (no precise spec outcome / assumption-defaults): settle-vs-pickup same-tick race; no-vacancy check-in branch; self-assign next to a resting suitcase; guest door position during wait; ladder tie-order

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| SUI-23 | Implemented (T2/T4) | ✅ Verified |
| SUI-01..22, 24, 25, 27 | Implemented | ✅ Verified (iterations 1–3 cumulative) |
| SUI-26 | Dropped (AD-034) | Dropped (unchanged) |

spec.md traceability Status column updated for SUI-23 on this PASS; Success Criteria checkboxes remain author-owned.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 26/26 active ACs matched spec outcome (SUI-26 dropped) · 0 spec-precision gaps requiring fixes · 5 accepted ⚠️ notes
**Sensor**: 3/3 mutations killed (E re-injection, F renamed-path re-emit, G router-all break)
**Gate**: typecheck ✅ · lint ✅ · test:sim 385/385 ✅ · client:suitcase green (given) + independent scratch run

**What works**: the AD-034 building-wide announce (exactly-once, 'all', every page class); the confirm-free direct place; the volume-driven last-5 walkie contract — all mutant-proven this session; the leak posture holds (assignment public by decision; placements sameFloor-silent; snapshot rows floor-filtered).

**Issues found**: none open.

**Next steps**: feature done; escalation not required (PASS within the 3-iteration budget).

---

---

# Suitcase Transport Validation (cycle 3.B) — ITERATION 2

**Date**: 2026-08-31
**Spec**: `.specs/features/suitcase-transport/spec.md`
**Diff range**: `131af9e..HEAD` (7 commits: ad0341e, e7385b8, 73cb60c, 99f537f, 7fae41e, aed4cf7, cccd67c; the pre-cycle docs commit 131af9e itself excluded)
**Verifier**: independent sub-agent (author ≠ verifier) — coverage and outcomes re-derived from the spec; iteration-1 citations re-spot-checked against the current tree this session (the sim/protocol suites are byte-identical to iteration 1 except `guests.test.ts` / `roundSim.test.ts` / `suitcase.spec.ts` hunks reviewed in cccd67c).

---

## Verdict: ❌ FAIL (1 fix task — ranked below; iteration 2 of 3)

Iteration-1 gaps 1, 3 and 4 are **closed with verified evidence** (the re-injected
iteration-1 mutant M3 is now killed), but the SUI-23 fix (gap 2) added an
assertion that **does not discriminate** the contract it cites: I removed the
last-5 trim in a scratch worktree and `client:suitcase` test 1 **still passes**
(only ~2 walkie lines exist at assertion time, so `count ≤ 5` is vacuously
true). Per the surviving-mutant rule, the feature is not done until that one
assertion is strengthened.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 wire/protocol | ✅ Done | registry + router `deskEarshot` re-verified below |
| T2 sim core | ✅ Done | check-in/place/pickup/work-block/teardown verified |
| T3 guest-following + clock | ✅ Done | wrong-delivery + clock + NEW door-waiting test verified |
| T4 walkie lifecycle log | ✅ Done | deletion complete; last-5 cap implemented but under-asserted (gap below) |
| T5 client slice | ✅ Done | restructured into 3 scenarios; carried-marker riding now asserted; e2e green (given) |
| T6 gates/docs | ✅ Done | AD-033 recorded; cccd67c adds the snapshot suitcase rows + client seeding |

---

## Iteration-1 Gap Closure (re-derived independently)

| # | Iteration-1 gap | Claimed fix (cccd67c) | Independent verification | Closed? |
| - | --------------- | --------------------- | ------------------------ | ------- |
| 1 | SUI-03 survivor: "exactly once" never observed the post-place/post-pickup flushes | `packages/sim/src/guests.test.ts:419-446` now accumulates **EVERY** flush from check-in through a full carry→place→pickup→place cycle plus 200 ticks into one `stream`; `expect(overheard).toHaveLength(1)` (`:442`) + `expect(o.guestId).toBe('guest:1')` (`:445`) | Re-injected the exact iteration-1 mutant M3 (overhear re-emitted on pickup, payload from `guests.assigned`) in scratch → `guests.test.ts` **FAILS** at `:442` (expected 1, received 2). Mutant killed. | ✅ |
| 2 | SUI-23 last-5 walkie DOM contract unasserted | `apps/client/harness/suitcase.spec.ts:297-302`: `lineCount` asserted `> 0` and `<= 5` | Assertion exists and targets the ≤5 outcome, **but** scratch mutation `WorldScene.ts:1076` `while (children.length > 5)` → `while (false && …)` (trim removed entirely) → `client:suitcase` test 1 **PASSES** (16.4s run): only ~2 lines exist at assertion time ("a guest arrives…" + "«ada» takes a guest"), so the cap is never under pressure anywhere in the suite (tests 2/3 assert only `/place/i` absence). Mutant survived. | ❌ **gap remains** |
| 3 | `restingSuitcases()` dead code | WIRED: `TurnoverRoom.movementSnapshotFor` (`apps/server/src/rooms/TurnoverRoom.ts:130-156`) enriches `movement:snapshot` with sameFloor-filtered rows (spectator ⇒ all floors; riders ⇒ none — view has no floor); wired at 4 call sites (`:399`, `:421`, `:630`, `:718`); `MovementSnapshot.suitcases?` typed (`packages/shared/src/protocol/messages.ts:275-312`); client seeds rest state from rows (`WorldScene.ts:759-763`); desk-absorb SPEC_DEVIATION made real — `rest` type lost `'desk'` (`guests.ts:57`), desk-rest branches deleted | Read-verified end to end; leak-safe (see Leak Audit). Caveat: **no test drives a positive snapshot row** — the only assertion is the negative `sim.restingSuitcases()).toEqual([])` (`roundSim.test.ts:628`); the snapshot enrichment + client seeding path is unasserted (⚠️ note, not a fix task — it is an assumptions-table default, not an AC). | ✅ (wired; ⚠️ untested) |
| 4 | Unasserted sub-clauses | New round-integration tests | SUI-11: `roundSim.test.ts:538-570` — start rejected `'carrying'` (`:558`), `accuse('p1','p3')` → `'resolved'` while carrying (`:561`), p2's pre-existing channel reaches `work:ended completed` (`:566-570`). SUI-16: `:574-615` — room state forced `'trashed'`, settle occurs (`settled=true`), `complained=false`. SUI-20: `:617-631` — `sim.leave('p1')` drops the carry, p2 re-checks the re-queued guest in (`:631`). SUI-13: `guests.test.ts:497-537` — mid-walk pickup ⇒ no settle for 800 ticks (`:525`), re-place at the same room ⇒ immediate settle (`:535`) — this also closes the "rest at the wait-at door resolves immediately" edge case. | ✅ |

---

## Spec-Anchored Acceptance Criteria

Legend: ✅ concrete assertion matches spec outcome · ⚠️ spec-precision gap · ❌ no evidence.

### P1: Check-in hands off the suitcase (SUI-01..06)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-01 | check-in accepted; reservation; carrier set; guest to holding area | `packages/sim/src/guests.test.ts:278` `checkIn('p1',…) === 'accepted'`; carry event `:286-288`; hold position `:290-291` `positionOf('guest:1').x === TUNING.GUEST_HOLD_START_TILES`; reservation `:303-305`; round level `roundSim.test.ts:496-533` | ✅ |
| SUI-02 | already-carrying desk E ignored silently | `guests.test.ts:312` `checkIn('p1',…) === 'ignored'`; wire silence `TurnoverRoom.test.ts:2802-2805` | ✅ |
| SUI-03 | overhear exactly once, receiver + earshot set, never repeated | `guests.test.ts:442` `expect(overheard).toHaveLength(1)` over the FULL flush stream (`:424-440`), guestId pinned `:445`; policy `registry.test.ts:144` + literal pin; **mutant-verified** (M3 re-injection killed) | ✅ |
| SUI-04 | never outside the earshot set, any later time, any surface | `router.test.ts:341-344` tooFar/otherFloor/rider/spectator all `sent === []`; `TurnoverRoom.test.ts:2754` no overhear after 50 further ticks; client `suitcase.spec.ts:283-295` all non-receiver pages hidden | ✅ |
| SUI-05 | outcomes derive only from server truth | structural: `desk:send`/`walkie:broadcast` deleted (grep: zero live references); registry key-set equality `registry.test.ts:173-175`; guest targeting reads `sc.rest` (`guests.ts:569-580`) | ✅ (structural) |
| SUI-06 | self-assign exactly the 3.1 behavior | `guests.test.ts:127-170` — unchanged GUEST-04/05 suites | ✅ |

### P1: Carry, place, pick up (SUI-07..12)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-07 | place rests at doorway, `suitcase:placed` sameFloor, clock stops, no walkie line | `guests.test.ts:325` `'placed'`; `:332` flush is exactly `['suitcase:placed']`; clock stop `:555-561` sequence; policy `registry.test.ts:146` | ✅ |
| SUI-08 | pickup by anyone in range → carrier change + fresh leg | `guests.test.ts:356` p2 `'picked_up'`; fresh leg `:555/572` expiry names p2; self-regrab e2e `suitcase.spec.ts:358-375` | ✅ |
| SUI-09 | carrying player's place/pickup ignored silently | `guests.test.ts:371,373` `'ignored'` ×2 | ✅ |
| SUI-10 | out-of-range place ignored silently | `guests.test.ts:342` `'ignored'` + zero events; **mutant-verified** (range check removed → this test fails) | ✅ |
| SUI-11 | carry blocks work STARTS; accusation/elevator remain; active channel completes | `roundSim.test.ts:558` `'carrying'`; `:561` `accuse('p1','p3') === 'resolved'`; `:566-570` p2's channel completes (`work:ended` `completed`) | ✅ |
| SUI-12 | suitcase rides carrier position, sameFloor visible | `suitcase.spec.ts:259-281` — carried Rectangle visible within 30px of own label's x; policy rows `registry.test.ts:145,147` | ✅ (riding marker now asserted) |

### P1: Guest follows the suitcase (SUI-13..17)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-13 | walk to last resting room; mid-walk pickup → continue + door-wait; re-target on next rest | `guests.test.ts:472` complaint proves the walk; door-waiting test `:497-537` — no settle while carried (`:525`), same-room re-rest resolves immediately (`:535`) | ✅ (⚠️ the guest's door POSITION during the wait is not pinned — only the outcome (no settle → settle) is; the `walking` loop predicate `viewOf().car === null` is trivially true, so the pickup can fire before the walk visually starts) |
| SUI-14 | correct → settle/tenancy; wrong → building-wide complaint naming room+guest, never assignment | `guests.test.ts:472` complaint `{floor, room: wrongRoom}`; `:490` `settled === assignment`; `:491-493` tenanted + reserved.size 0; policy `registry.test.ts:148` `'all'` | ✅ |
| SUI-15 | no personal penalty / placer event | `guests.test.ts:332` place flush exactly `['suitcase:placed']`; complaint payload `{guestId, floor, room}` only | ✅ (structural) |
| SUI-16 | trashed room settles silently in 3.B | `roundSim.test.ts:574-615` — forced `'trashed'` state, `expect(settled).toBe(true)` + `expect(complained).toBe(false)` | ✅ |
| SUI-17 | walking guest dies with the round at buzzer | `roundSim.test.ts:404-424` zero guest events after end | ✅ |

### P2: Carry clock (SUI-18..20)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-18 | expiry fires CURRENT carrier via justice teardown, re-queues front, voids assignment | `roundSim.test.ts:661-662` `fired.reason === 'carry-clock'`, `fired.playerId === 'p1'`; `:665` p2 re-check-in; front re-queue + impatience `guests.test.ts:383-394`; **mutant-verified** (wrong-player clock → both fail). "Rest at desk" is AD-033(f) SPEC_DEVIATION (desk absorbs), consistently documented (`guests.ts` dropCarry comment + STATE.md) | ✅ (deviation consistent) |
| SUI-19 | clock runs only while carried; fresh leg per pickup | `guests.test.ts:555,561,570,572` drain sequence `['p1'] → [] → [] → ['p2']` | ✅ |
| SUI-20 | fired/ghost/disconnect mid-carry → identical aftermath | `guests.test.ts:383-394` (dropCarry); `roundSim.test.ts:519-533` ghost; `:617-631` disconnect via `sim.leave('p1')` + re-check-in | ✅ |

### P2: Walkie lifecycle log (SUI-21..23)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-21 | every lifecycle fact renders a server line; placement emits none | sim fact-set pin `guests.test.ts:573-577` (per-guest exact counts); client `suitcase.spec.ts:253-258` check-in line on all pages; `:355-357` `logAfterPlace` not `/place/i` | ✅ |
| SUI-22 | `walkie:broadcast`/`desk:send`/send-menu deleted | `registry.test.ts:173-175` exact key-set equality; grep: zero live references; schema pins `:96-122` | ✅ |
| SUI-23 | walkie log keeps its last-5-lines DOM contract | `suitcase.spec.ts:297-302` asserts `lineCount` in (0,5] — **but only ~2 lines exist at assertion time**: scratch mutation removing the trim (`WorldScene.ts:1076` → `while (false && …)`) passes test 1 (16.4s). No suite ever drives a 6th line, so the cap's distinguishing behavior is unasserted | ❌ **evidence present but non-discriminating — surviving mutant → fix task** |

### P2: Client suitcase slice (SUI-24..27) — e2e green (given: 3/3 in three consecutive runs)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-24 | marker rides carrier or rests at doorway, sameFloor only | riding: `suitcase.spec.ts:259-281`; resting: `:345-361` Rectangle at `doorXTiles(1)*TILE` | ✅ |
| SUI-25 | E ladder: desk → landing → place → pickup → else | behavioral: desk `:252-258`, place `:341`, pickup `:358-375`, elevator `:136-162`; ladder order in `WorldScene.ts:843-877` | ✅ (tie-order unpinned — spec says spatially disjoint, order only breaks ties) |
| SUI-26 | blind place → one-step confirm tracking own overhears | `suitcase.spec.ts:444-447` confirm text `"haven't heard"` + yes-click sends; confident path `:337-340` no confirm | ✅ |
| SUI-27 | assignment only on overhear receivers; no other pre-settle surface names the room | `suitcase.spec.ts:283-295` own hint matches, other pages hidden; scenario 3: ada pre-rides out of earshot, confirm appears (proves she never heard) | ✅ |

### Edge cases

- Same-tick E race → deterministic intent-arrival order: structural (serial dispatch); front re-queue pinned `guests.test.ts:398-415`. ✅
- Settle vs pickup same-tick race (arrival first): no direct test. ⚠️
- Voided reservation re-assignable: `roundSim.test.ts:665` + `guests.test.ts:393`. ✅
- No-vacancy check-in fallback: self-assign path tested; the check-in branch (`guests.ts:334`) has no test. ⚠️
- Rest at the guest's wait-at door → immediate resolution: **now covered** by `guests.test.ts:528-535`. ✅ (improved this iteration)
- Spectator in earshot: `router.test.ts:344`. ✅
- Self-assign alongside a resting suitcase: no direct test. ⚠️

---

## Discrimination Sensor

Scratch: `git worktree add /tmp/opencode/scratch-v2 HEAD` + `pnpm install`; targeted `pnpm vitest run` per mutant (+ one targeted single-test playwright run); worktree removed with `--force`; real-tree `git status --porcelain` **empty** before and after (baseline preserved; after the report the only new entry is this file). Sensor depth: lightweight (3 mandated behavior-level mutations + 1 re-verification mutant + 1 extra probe).

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| A (mandated) | `packages/sim/src/guests.ts:369` | Place range validation removed (`if (false && …)`) | ✅ Killed — `guests.test.ts:342` "place out of range … ignored silently (SUI-10)" fails (`expected 'placed' to be 'ignored'`) |
| B (mandated) | `packages/sim/src/guests.ts:199` | Carry clock fires the WRONG player (`push(sc.carrier)` → `push(sc.carrier === 'p1' ? 'p2' : 'p1')`) | ✅ Killed — `guests.test.ts:555` (SUI-19 drain sequence `['p1']`) and `roundSim.test.ts:661-662` (SUI-18/20 teardown, `fired.playerId`) both fail |
| C (mandated) | `apps/server/src/rooms/router.ts:185-190` | deskEarshot policy delivers to ALL viewers (floor/x/spectator filters deleted) | ✅ Killed — `router.test.ts` "delivers assignment:overheard to exactly the live lobby earshot set (SUI-03)" + `TurnoverRoom.test.ts` "receiver hears the assignment once, a player beyond desk earshot never does (SUI-01/03/04)" |
| D (re-verify of iteration-1 M3) | `packages/sim/src/guests.ts:405` | Overhear re-emitted on every pickup (payload from `guests.assigned`) — the iteration-1 survivor | ✅ **Killed now** — the strengthened `guests.test.ts:442` fails (expected 1, received 2). Gap 1 fix confirmed discriminating |
| E (extra probe) | `apps/client/src/scenes/WorldScene.ts:1076` | Last-5 walkie trim removed (`while (false && children.length > 5)`) | ❌ **Survived** — `client:suitcase` test 1 passes (16.4s); no suite drives >5 lines → fix task |

**Sensor outcome (historical, iteration 2)**: 4/5 killed, 1 survived — **FAIL** until the SUI-23 assertion is strengthened.

E root cause (test weakness, not implementation): the trim code is correct and the (0,5] assertion cites the contract, but the suite never generates a 6th walkie line, so a broken cap is invisible. Fix: drive >5 lifecycle lines in the harness (e.g. multiple guest arrivals/settle/checkout within the AD-004 30s shift via the AD-028 scale seam, or a lighter DOM-seam unit test on `appendWalkieLine`) and assert the count stays at 5 with the newest line first.

---

## Leak Audit (structural, re-checked on cccd67c)

- **Assignment rides the wire exactly once per guest**: `assignment:overheard` is pushed in exactly one place — `GuestSim.checkIn` (`packages/sim/src/guests.ts:347-349`); grep over packages+apps confirms no second emitter. Registry row `deskEarshot` with `visibility {floor:'lobby', x: DESK_X_TILES×1000}` (`registry.ts:341-347`); router branch filters live viewers, `vc.floor === 'lobby'`, `|vc.x − x| ≤ DESK_EARSHOT_TILES×1000`, spectators explicitly skipped (`router.ts:174-192`) — and mutation C proves all three filters are test-discriminating. ✅
- **No resting-room payload to off-floor clients pre-settle/complaint**: `suitcase:placed` is `sameFloor` with `visibility {floor}` (`registry.ts:356-362`). The NEW snapshot rows are filtered in `movementSnapshotFor` (`TurnoverRoom.ts:147-152`): normal viewers get only their floor's rows; riders (no floor) get none; the all-floors spectator branch is reachable only where a live round snapshot is sent to a session with no position at all — fired players on reconnect get `spectator:snapshot` instead (`TurnoverRoom.ts:418-421`), and by buzzer teardown no resting suitcases remain, so there is no live cross-floor exposure. `guest:complained` ('all') is the sanctioned building-wide complaint; `guest:settled`/`checked_out` name rooms only post-settle (sanctioned). ✅
- **No client-authored line**: `walkie:broadcast`/`desk:send` deleted; registry key-set equality pins it; send-bypass denylist still green. ✅

---

## Gate Check

- **Gate command** (build level, per tasks.md): `pnpm typecheck && pnpm lint && pnpm test:sim`
- `pnpm typecheck`: ✅ 4/4 projects
- `pnpm lint` (biome check .): ✅ 110 files, no issues
- `pnpm test:sim`: run 1: 384/385 (one failure in a cycle-2.9 re-deal `seq` ordering test — the pre-existing rotating flake class reproduced FAILING on pre-3.B commit 131af9e, treated as given); runs 2 and 3: ✅ **385/385** (23 files, ~54s each) — includes `sim:suitcase_carry`, `sim:assignment_overhear`, `sim:carry_clock`, `sim:wrong_delivery`
- `pnpm test:client`: **not re-run in the real tree** (slow) per directive — `client:suitcase` 3/3 green in three consecutive runs (14.5-16.7s / 24.4-29.9s / 28.0-38.5s) taken as given. Exception: one targeted scratch run of the SUI-23 test (mutation E) was executed for the sensor — it passed against the mutant, which is itself the finding.
- Test count: 385 sim-side (up from 381 pre-cccd67c; +4 new sub-clause/door-waiting tests, 0 deleted, 0 skipped).
- Skipped tests: none.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ cccd67c is tightly scoped to the 4 gaps |
| Surgical changes | ✅ sim diffs limited to the `'desk'` rest-removal forced by the absorb deviation + wiring |
| Matches patterns | ✅ registry/mapper/scene-action patterns preserved |
| Every test maps to a spec requirement | ✅ new tests name their SUI ids |
| SPEC_DEVIATION consistency | ✅ AD-033(f) ↔ `guests.ts` dropCarry comment ↔ client `player-fired` prune ↔ "restingSuitcases has no desk rows" — one story everywhere |
| Spec-anchored outcome check | ⚠️ 1 weak assertion (SUI-23, mutation E) — the only failure driver |

---

## Ranked Gaps (fix task)

1. **[Minor] SUI-23 assertion is non-discriminating (surviving mutant E).**
   `apps/client/harness/suitcase.spec.ts:297-302` asserts `#walkie-log .walkie-line` count in (0,5] while only ~2 lines exist; removing the trim in `WorldScene.ts:1076-1078` passes the whole client suite. Fix: exercise >5 lifecycle lines (harness: more arrivals/settle/checkout inside the 30s shift, or a DOM-seam unit test calling `appendWalkieLine` 7×) and assert exactly 5 lines with newest first. Verify: re-inject mutation E → test fails.

Remaining ⚠️ spec-precision notes (accepted — the spec defines no precise outcome, or they are assumptions-table defaults, not ACs): SUI-13 door-position pinning during the wait; SUI-25 ladder tie-order; settle-vs-pickup same-tick race; no-vacancy check-in branch; self-assign alongside a resting suitcase; snapshot suitcase rows + client late-joiner seeding untested (gap-3 residue, positive path).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| SUI-01..12, 14..22, 24..27 | Implemented | ✅ Verified |
| SUI-23 | Implemented | ❌ Needs Fix (gap 1) |
| SUI-13 | Implemented | ✅ Verified (outcome-level; position-pin ⚠️ accepted) |

The spec's Success Criteria checkboxes remain **untouched** (verdict is not PASS).

---

## Summary

**Overall**: ❌ Not Ready (1 fix task; next re-verify is iteration 3 of 3)

**Spec-anchored check**: 25/27 ACs matched spec outcome · SUI-13/24/25 upgraded to ✅ this iteration · SUI-23 evidence present but non-discriminating
**Sensor**: 5 mutations injected, 4 killed, 1 survived (SUI-23 cap)
**Gate**: typecheck ✅, lint ✅, test:sim 385/385 ✅ (×2 after one known-flake run), client:suitcase green (given)

**What works**: every iteration-1 gap except the SUI-23 assertion strength; the overhear "exactly once" invariant is now mutant-proven; the earshot policy is mutant-proven from both sides (delivery set and range); the snapshot wiring is leak-safe.

**Next steps**: route gap 1 to an implementer; re-verify iteration 3 by re-injecting mutation E only.

---

# Implementer close-out (2026-08-31, post-iteration-2) — AD-034 rework + SUI-23 fix

## AD-034 rework (building-wide assignment notice; confirm removed)

- `assignment:overheard` → `guest:assigned` (`GuestAssigned`), registry row
  `recipients: 'all'`; `deskEarshot` policy value, `EventVisibility.x`, the
  router dispatch branch, and `TUNING.DESK_EARSHOT_TILES` are DELETED.
  Registry-first: the rename forced mappers/state/scene/tests in the same
  changeset (compile-exhaustive).
- Sim: `GuestSim.checkIn` emits `guest:assigned` (same payload shape, same
  exactly-once semantics — `sim:assignment_announce` suite unchanged in
  assertion strength, rename only).
- Server: `router.test.ts` deskEarshot describe replaced by an all-policy
  test (lobby viewer + guest-floor viewer + rider + spectator ALL receive);
  `TurnoverRoom.test.ts` `server:suitcase_carry` now asserts `guest:assigned`
  with the room named on ALL FOUR pages (the pre-walk staging is gone — the
  earshot predicate no longer exists).
- Client: mapper/state action `guest-assigned` (scene-routed); WorldScene
  renders the announce walkie line `a guest announces: I'm in F:R` on every
  page; the blind-place confirm (`#place-confirm`, `openPlaceConfirm`,
  `closePlaceConfirm`, the E-ladder confirm branch) is REMOVED — a carrier
  at a door places directly. The owned marker hint stays (SUI-27
  convenience surface).
- Harness: test 3 (SUI-26 confirm) DELETED; test 1 asserts the announce
  line on all pages; test 2 drops the `#place-confirm` probe.
- Docs: spec.md SUI-03/04 amended building-wide, SUI-26 dropped, SUI-27
  rewritten, SUI-24 pins "rests in front of the door"; assumptions table +
  §7 deltas + edge cases + traceability updated; CONTEXT.md earshot entry →
  "Room notice (assignment)"; roadmap.md 3.B row amended;
  STATE.md AD-034 → active.

## SUI-23 close-out (the iteration-2 surviving mutant)

The last-5 assertion is now volume-driven and discriminating: the harness
counts walkie-producing events on the wire (`guest:arrived/settled/
checked_out`, `guest:assigned`, `suitcase:carried/picked_up`,
`guest:complained`), takes a baseline right after ada's takes line, waits
until **five MORE** lifecycle events have flowed (the 5-slot DOM log must
have evicted it), then asserts `count === 5` AND the early
`«ada» takes a guest's suitcase` line is gone AND newer lifecycle lines
remain. Volume comes from `TURNOVER_TEST_GUEST_SCALE=0.2` (harness webServer,
AD-028 seam — arrivals ≈ every 6 s plus self-assign settles), which
reachable because the confirm test's choreography (its flake carrier) was
deleted by AD-034. Removing the trim (`while (false && …)`) leaves 7+
concurrent lines → `count === 5` fails; the mutant can no longer survive.

**Gate evidence (real tree, post-rework):**

- `pnpm typecheck` 4/4 ✅ · `pnpm lint` (biome) ✅
- `pnpm test:sim` ✅ 385/385 (23 files)
- `pnpm test:client suitcase` ✅ 2/2, two consecutive runs (23.3+17.2 s;
  21.5+18.6 s) at scale 0.2
- `pnpm test:client` full: 32 passed / 4 failed — the known rotating flake
  class (art-doors, justice, lobby, round). **Isolation evidence this
  session**: the 4 failing specs re-run alone pass (16/16 → 2 rotate out);
  `justice` failed 3× in a row — and ALSO fails on a clean worktree at the
  pre-rework HEAD (`d242c72`) at scale 0.5 (worktree `/tmp/opencode/co-head`,
  removed after). The flake class is pre-existing and environment-shaped
  (30 s shift vs choreography under load), not introduced by this rework.
  Documented, not chased, per the handoff.

Verifier iteration 3: dispatched as a fresh sub-agent.
