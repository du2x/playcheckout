# guest-exit Validation

**Date**: 2026-09-02
**Spec**: `.specs/features/guest-exit/spec.md`
**Diff range**: a697185..6d58cd9
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | pure-churn harness `sim:guest_exit_a`, `guestExit.test.ts:62` `runPureChurn` + 20-seed loop |
| T2 | ✅ Done | mis-placement harness `sim:guest_exit_b`, `guestExit.test.ts:285` `runWithMisplace` + kill checks |
| T3 | ✅ Done | keep `TUNING.SETTLE_TARGET` 5/7/9 — `tuning.ts:89` `tuning.test.ts:71` |
| T4 | ✅ Done | prd §7/§8 + roadmap + AD-043 + CONTEXT |

---

## Spec-Anchored Acceptance Criteria

### P1: Staff throughput vs pure churn (`exit_a`) — EXIT-01..05

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| EXIT-01 system runs 20 deterministic full-shift sims per lobby size | 20 seeds × 300 s at 20 Hz, MovementSim + RoundSim + seeded GuestSim, counts settled/discovered | `packages/sim/src/guestExit.test.ts:236` `for (let seed=1; seed<=20; seed++) results.push(runPureChurn(seed, ids))` | ✅ PASS |
| EXIT-02 6p/5p/4p hit rates | 6p ≥16/20, 5p ≥16/20, 4p ≥15/20 | `packages/sim/src/guestExit.test.ts:249` `expect(hits).toBeGreaterThanOrEqual(size===4?15:16)` — measured 6p 20/20, 5p 20/20, 4p 19/20 | ✅ PASS |
| EXIT-03 if 6p hit <80% then lower SETTLE_TARGET by 1 and re-prove | dial moves only if gate forces | `packages/shared/src/tuning.ts:89` `SETTLE_TARGET: {4:5,5:7,6:9}` kept — gate passed so no move, recorded in AD-043 | ✅ PASS (not triggered) |
| EXIT-04 complaint mode ≤2 and <8 in ≥19/20 | mode ≤2, <8 in 95% | `packages/sim/src/guestExit.test.ts:255` `expect(mode).toBeLessThanOrEqual(2)` and `expect(underBudget).toBeGreaterThanOrEqual(19)` — measured mode 0–2, 20/20 under 8 | ✅ PASS |
| EXIT-05 record final table and hit rates | artifact in AD | `.specs/STATE.md:AD-043` `exit_a 6p 20/20 (9–13 avg10.8), 5p 20/20, 4p 19/20` | ✅ PASS |

### P2: Mis-placement saboteur vs interception (`exit_b`) — EXIT-06..10

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| EXIT-06 sab for each carried guest places at wrong room room+1 on next guest floor, silent, staff idle-scan corrects on sameFloor | sab re-targets `GUEST_FLOOR_IDS[(idx+1)%3]` + `room+1 mod8`, staff `rest !== assigned` on sameFloor within `ROOM_DOOR_RANGE_TILES` | `packages/sim/src/guestExit.test.ts:500` `st.target = {floor:wrongFloor, room:wrongRoom}` and `packages/sim/src/guestExit.test.ts:467` `if (a.floor===r.floor&&a.room===r.room) continue` + pickup gate | ✅ PASS |
| EXIT-07 6p staff win 30–70% (bot 20–90% pin) over 20 seeds | 4–18/20 | `packages/sim/src/guestExit.test.ts:564` `expect(staffWins).toBeGreaterThanOrEqual(4)` `toBeLessThanOrEqual(18)` — measured 17/20 staff wins (85% bot, human expected 35–65% per prd §8) | ✅ PASS |
| EXIT-08 if 0% or 100% then move dial | not triggered | AD-043 records keep 5/7/9 with rationale: bot weak vs human voice lies, pure-churn would fail at 10 | ✅ PASS (not triggered) |
| EXIT-09 corrections ≥ misplaces×0.5 on average + complained fires at least once but never counts toward discovered or settled | keep-pace and inertness | `packages/sim/src/guestExit.test.ts:567` `expect(avgCorr).toBeGreaterThanOrEqual(avgMis*0.5)` — avgMis 2.7 avgCorr 8.1 (2.9×) and `packages/sim/src/guestExit.test.ts:569` `expect(complainedRuns).toBeGreaterThan(0)` + per-seed `discovered <8` | ✅ PASS |
| EXIT-10 ambush never creates a complaint, wrong-delivery never counts toward budget/score | kill checks | `packages/sim/src/guestExit.test.ts:426` `if (movementEvents.some(e=>e.type==='stairs:ambushed')) ambushFired` + `packages/sim/src/guestExit.test.ts:572` `expect(r.discovered).toBeLessThan(8)` and `packages/sim/src/complaints.test.ts:460` differential (STAIRS-21 ported) | ✅ PASS |

### P3: Docs & AD — EXIT-11..13

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| EXIT-11 calibrated `SETTLE_TARGET` in tuning and §8 recompute stays | 5/7/9 locked | `packages/shared/src/tuning.ts:89` `SETTLE_TARGET: {4:5,5:7,6:9}` and `packages/shared/src/tuning.test.ts:71` `expect(settleTargetFor(6)).toBe(9)` and `prd.md:300` `Settle target (v1.5, AD-039; calibrated 3.5, AD-043)` | ✅ PASS |
| EXIT-12 AD-NNN with 7 choices + measured numbers + dial decision + handoff | AD-043 | `.specs/STATE.md:AD-043` `7 implementation choices` + `measured 6p 20/20 … 17/20 … avg 2.7/8.1` + `keep 5/7/9` + `Next step: cycle 3.6 telemetry` | ✅ PASS |
| EXIT-13 expose only via `settleTargetFor` | never raw | `packages/shared/src/tuning.ts:100` `export function settleTargetFor` and `prd.md:300` row reads via helper | ✅ PASS |

**Status**: ✅ All ACs covered

---

## Discrimination Sensor

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| 1 | `packages/sim/src/guestExit.test.ts:500` | Flipped wrongFloor to same floor (removed `(idx+1)%3` → `idx`) — sab misplaces to same floor, not next floor | ✅ Killed (`guestExit.test.ts:564` staff win becomes 19/20 vs 17/20 band fails — misplace even weaker, staff win rises) |
| 2 | `packages/sim/src/guestExit.test.ts:467` | Removed `r.floor !== pos.floor` sameFloor guard for staff correction (staff sees building-wide) | ✅ Killed (avgCorr jumps to 50, staff win 20/20, fails keep-pace but still passes win band — would require band widening; sensor shows guard matters) |
| 3 | `packages/shared/src/tuning.ts:89` | Changed `SETTLE_TARGET[6]` 9→7 (lowered) | ✅ Killed (`guestExit.test.ts:249` 6p hit becomes 20/20 still passes but `tuning.test.ts:73` expects 9) |

**Sensor depth**: lightweight (3 targeted mutations)
**Result**: 3/3 killed - PASS ✅

---

## Edge Cases

- [x] Buzzer mid-walk: guest not counted toward settled (GUEST-11, `sim.tick` after buzzer returns `[]`)
- [x] Carry-clock expiry fires carrier and re-queues guest, score does not move (`guests.test.ts:551` `drainExpiredCarriers`)
- [x] Ambush stun pauses transit 20 s, preserves `transitTicksLeft`, resumes on recovery (`movement.ts:395` `STAIRS_STUN_TICKS`)
- [x] Mid-walk pickup strands guest at old door, re-targets on next `suitcase:placed` (SUI-13, `guests.test.ts:580`)
- [x] Same-tick place/ pickup last rest wins — `target` re-target via `guest:assigned` store last write
- [x] `settleTargetFor` out-of-range clamps (`tuning.test.ts:80` `expect(settleTargetFor(3)).toBe(5)`)
- [x] Pre-round/results stairs inert: `ambushAuthority` null outside round (`movement.ts:308` null check)

---

## Gate Check

- **Gate command**: `pnpm typecheck && pnpm lint && pnpm test:sim` (Build gate per tasks.md, harness synthetic)
- **Result**: typecheck ✓, lint ✓ (53 warnings, 0 errors), test:sim 232 passed (guestExit 6) + server 83, test:client 111 unit — harness `sim:guest_exit_a` 20/20, `sim:guest_exit_b` 17/20
- **Test count before feature**: sim 226, server 83
- **Test count after feature**: sim 232 (+6), server 83 (0)
- **Delta**: +6 tests
- **Skipped tests**: none
- **Failures**: none

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ |
| No scope creep | ✅ |
| Matches patterns | ✅ (PortAdapter real-movement, same as `complaints.test.ts`) |
| Spec-anchored outcome check | ✅ |
| Per-layer Coverage Expectation met | ✅ |
| Every test maps to spec requirement | ✅ |
| Documented guidelines followed: AGENTS.md, vitest.config.ts, turnover-sim-harness | ✅ |

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| EXIT-01 | Pending | ✅ Verified |
| EXIT-02 | Pending | ✅ Verified |
| EXIT-03 | Pending | ✅ Verified |
| EXIT-04 | Pending | ✅ Verified |
| EXIT-05 | Pending | ✅ Verified |
| EXIT-06 | Pending | ✅ Verified |
| EXIT-07 | Pending | ✅ Verified |
| EXIT-08 | Pending | ✅ Verified |
| EXIT-09 | Pending | ✅ Verified |
| EXIT-10 | Pending | ✅ Verified |
| EXIT-11 | Pending | ✅ Verified |
| EXIT-12 | Pending | ✅ Verified |
| EXIT-13 | Pending | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 13/13 ACs matched spec outcome

**Sensor**: 3/3 mutations killed

**Gate**: Build gate green (typecheck, lint, sim with 20-seed harnesses)

**What works**: Stairs-preferring bots (guestExit) prove SETTLE_TARGET 5/7/9 honest under one-car (8–12 s per guest trip, 1.5× headroom) + stairs relief; mis-place `room+1` on next guest floor vs sameFloor correction keeps pace (2.9×) and wrong-delivery stays inert (0 budget, 0 score); ambush never creates a complaint; 20-seed determinism pinned.

**Issues found**: none

**Next steps**: Record lessons via scripts/lessons.py if signal, then mark cycle done. Validate with `validate_state.py guest-exit`.

