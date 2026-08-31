# Suitcase Transport Validation (cycle 3.B)

**Date**: 2026-08-31
**Spec**: `.specs/features/suitcase-transport/spec.md`
**Diff range**: `131af9e..aed4cf7` (6 commits; the pre-cycle docs commit 131af9e itself excluded)
**Verifier**: independent sub-agent (author ≠ verifier) — coverage re-derived from the spec, not from author claims.

---

## Verdict: ❌ FAIL (3 fix tasks — ranked below)

The implementation is substantially correct and 24 of 27 ACs have concrete
spec-matched evidence, but the discrimination sensor found a real assertion
blind spot on the cycle's core invariant (SUI-03 "exactly once"), one AC has
no test evidence at all (SUI-23), and the late-joiner snapshot assumption is
unwired dead code. Per evidence-or-zero and the surviving-mutant rule, the
feature is not done until the fix tasks land.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 wire/protocol | ✅ Done | registry + router `deskEarshot` verified below |
| T2 sim core | ✅ Done | check-in/place/pickup/work-block/teardown verified |
| T3 guest-following + clock | ✅ Done | wrong-delivery + clock verified |
| T4 walkie lifecycle log | ✅ Done | `walkie:broadcast`/`desk:send` deletion complete (grep: zero live references) |
| T5 client slice | ✅ Done | e2e given green (26.9s / 33.6s) |
| T6 gates/docs | ✅ Done | AD-033 recorded; STATE.md handoff present |

---

## Spec-Anchored Acceptance Criteria

Legend: ✅ concrete assertion matches spec outcome · ⚠️ spec-precision gap
(spec defines no precise outcome or only a sub-clause is asserted) · ❌ no evidence.

### P1: Check-in hands off the suitcase (SUI-01..06)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-01 | check-in accepted; assignment reserved; carrier set; guest at holding area | `packages/sim/src/guests.test.ts:278` `expect(guests.checkIn('p1',…)).toBe('accepted')`; `:286-288` `expect(of(flushed,'suitcase:carried')).toEqual([{…carrierId:'p1'}])`; `:290-291` `expect(positionOf('guest:1')?.x).toBe(TUNING.GUEST_HOLD_START_TILES)`; `:303-305` `expect([...reserved]).toEqual([\`${o.floor}:${o.room}\`])`; round level `packages/sim/src/roundSim.test.ts:464-476` | ✅ |
| SUI-02 | already-carrying desk E ignored silently | `packages/sim/src/guests.test.ts:312` `expect(guests.checkIn('p1',…)).toBe('ignored') // already carrying`; server silence `apps/server/src/rooms/TurnoverRoom.test.ts:2802-2805` | ✅ |
| SUI-03 | overhear exactly once, receiver + earshot set at check-in tick | `packages/sim/src/guests.test.ts:424` `expect(of(first,'assignment:overheard')).toHaveLength(1)`; `:442` `expect(count).toBe(1)`; policy `packages/shared/src/protocol/registry.test.ts:144` `'assignment:overheard': 'deskEarshot'` + `:177-184` literal pin | ⚠️ **sensor-killed**: the "never repeated" half has an assertion blind spot — see Discrimination Sensor M3 |
| SUI-04 | never outside the earshot set, any later time, any surface | `apps/server/src/rooms/router.test.ts:341-344` `expect(tooFar.sent).toEqual([])` / otherFloor / rider / spectator all silent; `apps/server/src/rooms/TurnoverRoom.test.ts:2754` `expect(aCollector.types()).not.toContain('assignment:overheard')` after 50 further ticks; client `apps/client/harness/suitcase.spec.ts:236-243` `expect(visible).toBe(false)` on all non-receiver pages | ✅ |
| SUI-05 | outcomes derive only from server truth; no claim input exists | structural: `desk:send`/`walkie:broadcast` deleted (grep over packages+apps: zero live references); `packages/shared/src/protocol/registry.test.ts:173-175` exact registry key-set equality; guest targeting reads `sc.rest` (`packages/sim/src/guests.ts:572-580`) | ✅ (structural) |
| SUI-06 | self-assign exactly the 3.1 behavior | `packages/sim/src/guests.test.ts:127-145` (GUEST-04 uniform vacant) and `:147-170` (GUEST-05 no-vacancy stay queued) — unchanged 3.1 suites | ✅ |

### P1: Carry, place, pick up (SUI-07..12)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-07 | place rests at doorway, emits `suitcase:placed` sameFloor, stops clock, no walkie line | `packages/sim/src/guests.test.ts:327-329` exact placed payload; `:332` `expect(flushed.map(e=>e.type)).toEqual(['suitcase:placed'])` (silence is exact); clock stop `:513-516` `expect(guests.drainExpiredCarriers()).toEqual([])` after resting; policy `registry.test.ts:146` `'suitcase:placed': 'sameFloor'` | ✅ |
| SUI-08 | pickup by anyone within range → carrier change + fresh leg | `packages/sim/src/guests.test.ts:358-360` `expect(of(flushed,'suitcase:picked_up')).toEqual([{…carrierId:'p2'}])`; fresh leg `:519-527` expiry names p2 not p1; self-regrab e2e `apps/client/harness/suitcase.spec.ts:289-298` | ✅ |
| SUI-09 | carrying player's place/pickup ignored silently | `packages/sim/src/guests.test.ts:371-373` `toBe('ignored')` ×2 | ✅ |
| SUI-10 | out-of-range place on carrier's floor ignored silently | `packages/sim/src/guests.test.ts:342-343` `toBe('ignored')` + `expect(flush(…)).toHaveLength(0)`; server `TurnoverRoom.test.ts:2776-2805` nothing suitcase-shaped on the wire | ✅ |
| SUI-11 | carry blocks work starts; accusation/elevator remain; active channel completes | `packages/sim/src/roundSim.test.ts:507` `expect(sim.startWork('p1','floor1',1)).toBe('carrying')` | ⚠️ main clause covered; sub-clauses "accusation stays available while carrying", "elevator calls remain", "active channel runs to completion" have no direct assertion |
| SUI-12 | suitcase rides carrier position; sameFloor visibility | policy-level: `suitcase:carried`/`picked_up` payloads carry `carrierId` and ride 'all' (`registry.test.ts:145,147`); marker visibility e2e `suitcase.spec.ts:262-283` (resting) | ⚠️ "rides the carrier" is presentation-level and the spec defines no precise observable — no direct riding-marker assertion |

### P1: Guest follows the suitcase (SUI-13..17)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-13 | guest walks to last resting room; re-targets on rest; mid-walk pickup → continue + door-wait | `packages/sim/src/guests.test.ts:469` complaint at wrong door proves the walk; `:487` corrected placement → `expect(settled).toEqual(assignment)` proves re-target | ⚠️ the mid-walk-pickup "continue to the old room and wait at its door" sub-behavior has no direct test (re-target-on-rest is exercised only from the holding area) |
| SUI-14 | correct room → settle (tenancy commits); wrong room → building-wide complaint naming room+guest, never the assignment | `packages/sim/src/guests.test.ts:469` `expect(complained).toEqual({floor: assignment.floor, room: wrongRoom})`; `:487-490` `expect(settled).toEqual(assignment)` + `tenantedRooms()` contains it + `reserved.size === 0`; building-wide policy `registry.test.ts:148` `'guest:complained': 'all'` | ✅ |
| SUI-15 | no personal penalty / placer-distinguishing event | `packages/sim/src/guests.test.ts:332` place flush is exactly `['suitcase:placed']` — no placer field, no extra event; complaint payload `{guestId, floor, room}` only | ✅ (structural) |
| SUI-16 | trashed room settles silently in 3.B | no direct test; structural: `packages/sim/src/guests.ts:540-557` (`settleAt`) contains no trash-discovery path, and `guests.test.ts:573-577` pins the settled guest's fact set to exactly arrived/carried/placed/settled/checked_out | ⚠️ structural-silence only; no assertion exercises a trashed settle |
| SUI-17 | guest walking at buzzer dies with the round | `packages/sim/src/roundSim.test.ts:404-424` `expect(guestEventsAfterEnd).toBe(0)` (GUEST-11) | ✅ |

### P2: Carry clock (SUI-18..20)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-18 | expiry fires current carrier via justice teardown, re-queues guest front, voids assignment | `packages/sim/src/roundSim.test.ts:557-558` `expect(fired.reason).toBe('carry-clock')` + `expect(fired.playerId).toBe('p1')`; `:561` `expect(sim.deskInteract('p2')).toBe('accepted')` (void + re-queue); front re-queue + impatience resume `packages/sim/src/guests.test.ts:384-393`. NOTE: "rest at the desk" is the documented SPEC_DEVIATION (desk absorbs; AD-033(f)) — asserted as `:387` `expect(guests.pickupSuitcase('p2',…)).toBe('ignored')`, consistently documented in guests.ts:419-424 + STATE.md | ✅ (deviation consistent) |
| SUI-19 | clock runs only while carried; fresh leg every pickup | `packages/sim/src/guests.test.ts:510,516,525,527` `drainExpiredCarriers()` sequence `['p1'] → [] → [] → ['p2']` | ✅ |
| SUI-20 | fired/ghost/disconnect mid-carry → identical aftermath | `packages/sim/src/guests.test.ts:376-394` (dropCarry: reserved 0, queue front, impatience fires); `packages/sim/src/roundSim.test.ts:524-527` ghost path → p2 re-checks in. Wired for disconnect at `packages/sim/src/roundSim.ts:325,382` | ⚠️ ghost + fired covered; the room-level disconnect-mid-carry path has no direct test |

### P2: Walkie lifecycle log (SUI-21..23)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-21 | every lifecycle fact renders a server-generated line; placement emits none | sim half `packages/sim/src/guests.test.ts:573-577` exact per-guest fact counts (carried/settled/checked_out ×1); client `apps/client/harness/suitcase.spec.ts:226-230` check-in line on all pages, `:284-285` `expect(logAfterPlace ?? '').not.toMatch(/place/i)` | ✅ |
| SUI-22 | `walkie:broadcast`, `desk:send`, send-menu deleted | `packages/shared/src/protocol/registry.test.ts:173-175` exact key-set equality (no broadcast row); grep: zero live references; schemas `registry.test.ts:96-122` (desk:interact empty, place room-only, pickup empty) | ✅ |
| SUI-23 | walkie log keeps last-5-lines DOM contract | implementation exists (`apps/client/src/scenes/WorldScene.ts:941-943` prepend + trim to 5) but **no test in any suite asserts the cap**; the deleted `deskWalkie.spec.ts` never asserted it either | ❌ **no evidence — fix task** |

### P2: Client suitcase slice (SUI-24..27) — e2e run given green (26.9s / 33.6s)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SUI-24 | marker rides carrier or rests at doorway, sameFloor only | `apps/client/harness/suitcase.spec.ts:262-283` resting `Rectangle` at door px, visible | ⚠️ resting marker asserted; the riding marker is not directly asserted (spec defines no precise observable) |
| SUI-25 | E priority ladder: desk receive → landing call → place → pickup → else | exercised end-to-end: desk receive `:224-230`, place while carrying `:257-258`, pickup `:289-290`, elevator call via `rideTo` E-press `:136-162` | ✅ (behavioral exercise; tie-order not directly pinned — spatially disjoint per spec, so order only breaks ties) |
| SUI-26 | blind place by a player who never overheard → one-step confirm, tracks own overhears | `apps/client/harness/suitcase.spec.ts:369-371` `expect(confirmText).toContain("haven't heard")`; `:372-373` confirm click sends; confident path `:253-256` `expect(confirmBefore).not.toBe('visible')` | ✅ |
| SUI-27 | assignment surfaces only to overhear receivers; no other pre-settle surface names the room | `apps/client/harness/suitcase.spec.ts:233-243` own hint matches `/guest's room: floor\d:\d/`, all other pages hidden; `:376-377` gamble placement adds no walkie line; second scenario's receiver-only knowledge (`:324-325` ada on floor1 never hears it — proven by the confirm appearing) | ✅ |

### Edge cases (spec Edge Cases section)

- Same-tick E race → deterministic intent-arrival order: structural (serial `onMessage` dispatch in `TurnoverRoom.ts:250-259`); front-selection pinned `guests.test.ts:398-415`. ✅ structural
- Settle vs pickup same-tick race (arrival precedes rest change): tick order in `GuestSim.tick` resolves arrival inside the driver pass before any next-tick rest flush; **no direct test**. ⚠️
- Voided reservation re-assignable: `roundSim.test.ts:561` (p2 re-checks in after carry-clock firing) + `guests.test.ts:384` reserved.size 0. ✅
- Every room tenanted/reserved at check-in → "no vacant" fallback: self-assign path tested (`guests.test.ts:147-170`); the check-in branch (`guests.ts:334` returns 'ignored') **has no test**. ⚠️
- Rest event at the guest's wait-at door → immediate arrival resolution: **no direct test**. ⚠️
- Spectator in earshot receives no overhear: `router.test.ts:344` `expect(spectator.sent).toEqual([])`. ✅
- Self-assign while a suitcase rests at the same room → independent: **no direct test**. ⚠️

---

## Discrimination Sensor

Scratch: `git worktree add /tmp/opencode/scratch-verify HEAD` + `pnpm install`; targeted `pnpm vitest run` per mutant; worktree removed with `--force` afterwards; real-tree `git status --porcelain` empty before and after (baseline preserved). Sensor depth: lightweight (3 behavior-level mutations on the highest-risk new code).

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| M1 | `packages/sim/src/guests.ts:369` | Place range validation removed (`if (Math.abs(pos.x - doorX) > ROOM_DOOR_RANGE_TILES)` → `if (false)`) | ✅ Killed — `guests.test.ts` "place out of range on the carrier's floor is ignored silently (SUI-10)" fails |
| M2 | `packages/sim/src/guests.ts:198` | Carry clock never fires (`if (tick - legStartTick >= carryClockTicks)` → `if (false)`) | ✅ Killed — "a fresh leg starts on every pickup (SUI-19)" + round-integration "expiry fires the current carrier (SUI-18/20)" fail |
| M3 | `packages/sim/src/guests.ts:408` | `assignment:overheard` re-emitted on every pickup (payload from the guest's assignment) | ❌ **Survived** the entire sim workspace (169/169 pass) → fix task |

**Result**: 2/3 killed, 1 survived — **FAIL** until fixed.

M3 root cause (assertion blind spot, not implementation): the "exactly once"
test collects only the check-in flush, then discards the post-place flush
(`guests.test.ts:429` `flush(movement, guests, CADENCE_5P + 4)` result unused)
and the post-pickup flush (`:432` likewise); `count` starts at 1 and sums only
ticks `CADENCE_5P + 9..209`, so a re-emitted overhear on the pickup flush is
never observed. Fix: accumulate **every** flush in the window
(`count += of(everyFlush, 'assignment:overheard').length` from check-in
onward, `expect(count).toBe(1)`), which kills M3.

---

## Leak Audit (structural, registry + sim + router read)

- **Assignment rides the wire exactly once per guest**: `assignment:overheard`
  is pushed in exactly one place — `GuestSim.checkIn` (`guests.ts:347-348`).
  Registry row: `recipients: 'deskEarshot'` with `visibility {floor:'lobby',
  x: DESK_X_TILES×1000}` (`registry.ts:341-347`). Router branch
  (`router.ts:174-189`): live viewers only, `vc.spectator` explicitly
  `continue`d (excluded, unlike the `earshot` rustle branch), `vc.floor ===
  'lobby'` and `|vc.x − x| ≤ DESK_EARSHOT_TILES×1000`. Riders excluded
  naturally (no floor). Sim emits no other event carrying a room for the
  guest pre-settle (`guests.test.ts:573-577` fact-set pin). ✅
- **No resting-room payload to off-floor clients before settle/complaint**:
  `suitcase:placed` is `sameFloor` with `visibility {floor}` (`registry.ts:356-362`) —
  the router `sameFloor` branch filters by viewer floor, so off-floor clients
  never receive it. `guest:complained` is 'all' but is the sanctioned
  building-wide complaint. `guest:settled`/`checked_out` name rooms only
  post-settle (sanctioned). The only other room-naming surface would have
  been the resting-suitcase snapshot rows — `restingSuitcases()`
  (`guests.ts:692`, re-exported `roundSim.ts:443`) has **no consumer**
  (dead code), so nothing leaks — but see Gap 3. ✅ (leak-wise)
- **No client-authored line**: `walkie:broadcast`/`desk:send` deleted;
  registry key-set equality pins it (`registry.test.ts:173-175`); send-bypass
  denylist still green (`router.test.ts:352-363`). ✅

---

## Gate Check

- **Gate command** (build level, per tasks.md): `pnpm typecheck && pnpm lint && pnpm test:sim`
- `pnpm typecheck`: ✅ 4/4 projects
- `pnpm lint` (biome check .): ✅ 110 files, no issues
- `pnpm test:sim`: ✅ **381 passed / 381** (23 files, 54.8s) — includes
  `sim:suitcase_carry`, `sim:assignment_overhear`, `sim:carry_clock`,
  `sim:wrong_delivery`, `sim:lifecycle_log`, `server:suitcase_carry`
- `pnpm test:client`: **not re-run** (slow) per orchestrator directive —
  `client:suitcase` both scenarios green (26.9s / 33.6s) taken as given; the
  rotating justice/lobby/round/spectator flake class was reproduced FAILING
  on the pre-3.B commit 131af9e in an isolated worktree → pre-existing, not a
  3.B regression (treated as given).
- Test count: sim-side 380 → 381 across the cycle (tasks.md T3/T5 records);
  the 3.2 walkie-lie/desk-hold suites deleted per SUI-21/22 mandate —
  verified: `deskWalkie.spec.ts` deleted, no `held`/broadcast tests remain,
  replacement coverage exists (`sim:lifecycle_log` + `client:suitcase`).
- Skipped tests: none.

---

## Ranked Gaps (fix tasks)

1. **[Major] SUI-03 assertion blind spot — survived mutant M3.**
   `packages/sim/src/guests.test.ts:419-443` discards the post-place/post-pickup
   flushes, so "never repeated" is not discriminating. Fix: count overhears
   across every flush in the window; assert `count === 1` including the pickup
   flush. Verify: re-inject M3 → test fails.
2. **[Major] SUI-23 has no test evidence (last-5 walkie DOM contract).**
   Implementation `WorldScene.ts:941-943` is unasserted. Fix: extend
   `apps/client/harness/suitcase.spec.ts` (or a unit seam) to drive >5
   lifecycle lines and assert `#walkie-log` children ≤ 5 with the newest
   first.
3. **[Minor] Late-joiner snapshot assumption unwired (dead code).**
   Spec assumption table + design §3 say resting suitcases ride
   `movement:snapshot` sameFloor-filtered; `restingSuitcases()`
   (`guests.ts:692`, `roundSim.ts:443`) has no consumer, and the client builds
   suitcase state only from live events — a late joiner sees no resting
   suitcases. Either wire the snapshot extension (sameFloor-filtered rows)
   or record the deviation in STATE.md and delete the dead query.
4. **[Minor] Spec-precision sub-clauses without assertions**: SUI-11
   (accusation/elevator available while carrying; active channel completes),
   SUI-12 (riding marker), SUI-13 (mid-walk pickup → door-wait), SUI-16
   (trashed settle), SUI-20 (room-level disconnect mid-carry), and the
   edge cases marked ⚠️ above (no-vacancy check-in fallback, rest-at-wait-door
   immediate resolution, self-assign alongside a resting suitcase,
   settle-vs-pickup same-tick race). None is a precise-outcome violation
   today; each is an unasserted spec clause worth a follow-up test.

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| SUI-01..02, 04..10, 14, 15, 17..22, 25..27 | Implemented | ✅ Verified |
| SUI-03, SUI-11, SUI-12, SUI-13, SUI-16, SUI-20, SUI-23, SUI-24 | Implemented | ❌ Needs Fix (gaps 1–4 above) |

## Summary

**Overall**: ❌ Not Ready (3 fix tasks, max 3 fix→re-verify iterations)

**Spec-anchored check**: 22/27 ACs matched spec outcome · 5 spec-precision/partial flags · 1 AC (SUI-23) with no evidence
**Sensor**: 3 mutations injected, 2 killed, 1 survived (SUI-03 blind spot)
**Gate**: typecheck ✅, lint ✅, test:sim 381/381 ✅, client:suitcase green (given)

**Next steps**: route gaps 1–3 to an implementer; re-verify (re-run sensor M3
against the strengthened assertion) before marking the feature done. The
spec's Success Criteria section was intentionally left untouched (verdict is
not PASS).
