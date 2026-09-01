# delivery-scoring Validation (cycle 3.D)

**Verdict: PASS** (all 13 ACs have spec-matched assertions; all gates re-run green;
all 5 sensor mutants killed — M1/M2/M4 at unit level, M3/M5 at server-integration
level after re-verification iteration 1). Remaining: one optional-hardening item
(G3) — see **Gaps** below.

**Re-verification iterations**: 1 of 3 — iteration 1 (2026-09-01) closed G1/G2
via commits `e363e15` (test(server): pin the live settle score in recap and
resume) + `3e8fff5` (formatting only); both sensor mutants M3 and M5 are now
killed by the server suite alone (evidence below).

**Verifier**: independent (not the author). All evidence re-derived; gates re-run
by the verifier on 2026-09-01.

## Diff range reviewed

Feature range: `b385fec..HEAD` — 11 commits (b058dc9 tuning dial → 3e8fff5
re-verification formatting follow-up). This includes the two iteration-1 fix
commits `e363e15` + `3e8fff5` (both touch only
`apps/server/src/rooms/TurnoverRoom.test.ts`). The two commits below `b058dc9`
(`9e2ea9b` AD-037 affordances, `b385fec` AD-037/038 decision docs) are prior
work and were excluded from the spec review (they are present in the working
tree as stated).

## Gates re-run (evidence, not logs)

| Gate | Command | Result |
|---|---|---|
| 1 | `pnpm typecheck` | green (all 4 workspace projects) |
| 1 | `pnpm lint` (biome) | green — 116 files, no issues |
| 2 | `pnpm test:sim` (all workspaces) | **436 passed / 25 files** |
| 3 | single scenario `client:score_hud` (Playwright, clean scratch tree) | **1 passed** |

**Iteration 1 re-verification runs:**

| Run | Result |
|---|---|
| `pnpm vitest run apps/server/src/rooms/TurnoverRoom.test.ts` | **60 passed / 60** |
| Targeted re-check of the other touched suites (`tuning`, `guests`, `roundSim`, `scoreHud`, `state`, `mappers`) | **119 passed / 119** |

Full `pnpm test:client` was not re-run per instructions (author ran it twice;
the discriminating scenario was re-run once by the verifier).

## Per-requirement evidence table

| Req | Spec outcome | Evidence (`file:line` + assertion) | Verdict |
|---|---|---|---|
| DLVR-01 | Score = settled-guest count; 0 at start; monotonic | `packages/sim/src/guests.test.ts:508` `expect(guests.settledCount).toBe(0)`; `:514` `expect(guests.settledCount).toBe(settled.length)`; source increment is a single site (`packages/sim/src/guests.ts:600`, inside `settleAt` only) | PASS |
| DLVR-02 | Suitcase-path settle emits `guest:settled` and +1 exactly | `packages/sim/src/guests.test.ts:547-548` `expect(settled).toBe(true)` / `expect(guests.settledCount).toBe(1)` after complaint → corrected placement | PASS |
| DLVR-03 | Self-assign settle counts identically | `packages/sim/src/guests.test.ts:511-514` — `expect(of(events,'guest:assigned')).toHaveLength(0)` (proves zero check-ins) then `expect(guests.settledCount).toBe(settled.length)` | PASS |
| DLVR-04 | Wrong-delivery complaint → line fires, **no score change** | `packages/sim/src/guests.test.ts:535` `expect(guests.settledCount).toBe(0)` after `guest:complained` fires; corrected settle then yields exactly 1 (`:548`) | PASS |
| DLVR-05 | Buzzer with score ≥ target → `staff`/`settle-target-met`, **same flush as buzzer** | `packages/sim/src/roundSim.test.ts:310-314` — `expect(events.map((e)=>e.type).at(-2)).toBe('round:buzzer')` and `expect(events.at(-1)).toMatchObject({ winner:'staff', reason:'settle-target-met' })` | PASS |
| DLVR-06 | Buzzer with score < target → `saboteur`/`settle-target-failed` | `packages/sim/src/roundSim.test.ts:270-276` — `expect(events.at(-1)).toEqual({ type:'round:ended', winner:'saboteur', reason:'settle-target-failed', ... })` + `expect(events.filter((e)=>e.type==='round:ended')).toHaveLength(1)`; same-flush pin at `:76-85` (`expect(last).toEqual([{type:'round:buzzer'}, {type:'round:ended', reason:'settle-target-failed', …}])`); server pin `apps/server/src/rooms/TurnoverRoom.test.ts:2239-2240` | PASS |
| DLVR-07 | Saboteur-fired / staff-reduced legs unchanged | `packages/sim/src/roundSim.test.ts:203` `reason: 'saboteur-fired'` (REND-01); `:231` and `:258` `reason: 'staff-reduced'` (REND-02) | PASS |
| DLVR-08 | Abort emits no settle-target verdict | `apps/server/src/rooms/TurnoverRoom.test.ts:2614-2617` — `expect(ended.payload).toEqual({ winner:'aborted', reason:'saboteur-disconnected', saboteurId:null })` (exact-equality: no settle-target shape possible) | PASS |
| DLVR-09 | Settle event → HUD count updates; freeze after end | `apps/client/src/ui/scoreHud.test.ts:13-14` `expect(hud.render()).toBe('Settled 2 / 5')` / `expect(hud.score).toBe(2)`; freeze `:32`; live e2e `apps/client/harness/scoreHud.spec.ts:47-51` (`/^Settled [1-9]/`) | PASS |
| DLVR-10 | HUD renders exactly `Settled N / T`; target per lobby | `apps/client/src/ui/scoreHud.test.ts:10,13,22` `expect(hud.render()).toBe('Settled 0 / 5')` etc.; harness `apps/client/harness/scoreHud.spec.ts:45` `expect(await page.textContent('#score-hud')).toBe('Settled 0 / 5')`; target values `packages/shared/src/tuning.test.ts:68-70` `expect(settleTargetFor(4)).toBe(5)` (5p→7, 6p→9) | PASS |
| DLVR-11 | Recap carries final settle score AND target | server `apps/server/src/rooms/TurnoverRoom.test.ts:2246-2247` `expect(recap.payload.settleScore).toBe(0)` / `expect(recap.payload.settleTarget).toBe(5)`; **live-score pins (iteration 1)** `:2533-2535` `expect(recap.payload.settleScore).toBe(settledFinal)` / `.toBeGreaterThan(0)` / `settleTarget).toBe(5)`; client reducer `apps/client/src/state.test.ts:210-211` `expect(s.results?.settleScore).toBe(4)` / `…settleTarget).toBe(7)`; mapper `apps/client/src/net/mappers.test.ts:230-231`; live e2e `apps/client/harness/scoreHud.spec.ts:63` (`settled (\d+) of 5 guests`) | PASS |
| DLVR-12 | FR-23 coverage telemetry stays in place | `packages/shared/src/protocol/telemetry.ts` untouched in the range (`git diff b385fec..HEAD` = 0 lines); `preppedCount` kept with its test `packages/sim/src/work.test.ts:698` ('counts a churned room as un-prepped for coverage (preppedCount)') | PASS |
| DLVR-13 | prd v1.5 / roadmap 3.D / AD-039 recorded, consistent | `prd.md:165-169` (§6.6 win table), `:218-241` (FR-29 v1.5 decoupling + FR-31 trash-discovery-only scope), `:269-270` (§7 SETTLE_TARGET row, coverage demoted to telemetry/KPI), `:307-310` (§8 v1.5 note); `roadmap.md:83,115` (3.D insert between 3.C and 3.3 with amended 3.3 scope); `.specs/STATE.md:1138` AD-039 with proposal link, consistent with all three | PASS |

## Edge-case coverage

| Edge case | Evidence | Verdict |
|---|---|---|
| Buzzer fires while a guest is mid-walk → not counted | Chain-covered: the counter's only increment site is `settleAt` (`packages/sim/src/guests.ts:600`), the zero-settles buzzer pin (`roundSim.test.ts:265-276`) and the DLVR-05 test assert the verdict reads only committed settles. No direct "mid-walk at buzzer" counter assertion. | PASS (chain) |
| Settle into a trashed room → counts | Chain-covered: `packages/sim/src/roundSim.test.ts:575-609` pins `guest:settled` firing (and no complaint) for a trashed assigned room; DLVR-01's `:514` proves every `guest:settled` counts. No direct `settledCount` assertion in a trashed-room scenario. | PASS (chain) |
| Carrier fired by carry clock → no score change | Direct: `packages/sim/src/guests.test.ts:551-568` — `expect(guests.settledCount).toBe(0)` twice around the re-queue + zero `guest:settled` events | PASS |
| Walk-out/disconnect re-queue → no score change | Chain-covered: `packages/sim/src/roundSim.test.ts:611+` pins the disconnect re-queue (SUI-20) but does not assert the counter; the carry-clock re-queue shape is counter-pinned at `guests.test.ts:551-568`. No direct counter assertion on the disconnect path. | PASS (chain) |

## Discrimination sensor (isolated scratch `/tmp/opencode/verify-ds`, one mutant at a time)

| Mutant | Fault | Result |
|---|---|---|
| M1 | `guests.ts:600` — dropped `this.settledTotal += 1` | **KILLED** — 3 failures across `guests.test.ts` + `roundSim.test.ts` (DLVR-01/02/04/05 pins) |
| M2 | `roundSim.ts:270` — `>=` inverted to `<` | **KILLED** — 3 failures (buzzer-flush pin `:76-85`, REND-03 zero-settles, REND-03 at-target) |
| M4 | `scoreHud.ts` — `onSettled()` increments by 2 (this variant chosen) | **KILLED** — 3 failures in `scoreHud.test.ts` (`Settled 2 / 5` / `score===2` pins) |

### Iteration-1 sensor re-run (scratch `/tmp/opencode/verify-ds2`, server suite only)

| Mutant | Fault | Result (before iteration 1) | Result (after iteration 1) |
|---|---|---|---|
| M3 | `TurnoverRoom.ts:627` — recap `settleScore` hardcoded to 0 | SURVIVED the server vitest suite (60/60 pass); killed only by `client:score_hud` (frozen HUD `Settled 3 / 5` vs recap `settled 0 of 5`) | **KILLED by the server suite alone** — hardened REND-17/18 test fails with `AssertionError: expected +0 to be 5` (recap 0 vs live final count 5) |
| M5 (verifier-added) | `TurnoverRoom.ts:419` — resume `settleScore` hardcoded to 0 | SURVIVED — typeof-only assertion | **KILLED by the server suite alone** — same test fails with `AssertionError: expected +0 to be 1` (resume 0 vs live count 1 at drop time) |

Scratch tree restored between mutants; both scratch copies deleted after.
**Real tree untouched**: `git status --porcelain` shows only this sanctioned
`validation.md` before and after both sensor passes.

## Gaps (ranked fix tasks)

1. ~~**G1 (M5 survivor) — resume `settleScore` value unpinned.**~~
   **CLOSED (iteration 1).** `e363e15` hardens the REND-17/18 reconnect test:
   it stubs `TURNOVER_TEST_GUEST_SCALE=0.1`
   (`apps/server/src/rooms/TurnoverRoom.test.ts:2459`), drives the guest
   economy until ≥1 real settle is on the wire (`:2478-2484`,
   `expect(settledBeforeDrop).toBeGreaterThanOrEqual(1)`), then asserts exact
   equality against the live server truth:
   `expect(resumed.payload.settleScore).toBe(settledBeforeDrop)`
   (`:2515`) — the DLVR-10 reconnect re-seed outcome, now value-pinned. M5
   verified killed (see sensor table).
2. ~~**G2 (M3 unit-level blind spot) — the server recap pin cannot
   discriminate a wrong `settleScore`.**~~ **CLOSED (iteration 1).** The same
   hardened test drives    the shift to the buzzer and asserts the live recap:
   `expect(recap.payload.settleScore).toBe(settledFinal)` (`:2533`),
   `expect(recap.payload.settleScore).toBeGreaterThan(0)` (`:2534`), and
   `expect(recap.payload.settleTarget).toBe(5)` (`:2535`; the original
   zero-score recap pin remains at `:2247`) — the DLVR-11 outcome with a
   nonzero score. M3 verified killed (see sensor table).
3. **G3 (minor, chain-coverage only — remains open, optional hardening)** —
   the three spec edge cases marked "chain" (mid-walk buzzer, trashed-room
   settle count, disconnect re-queue) hold structurally but have no direct
   `settledCount` assertions. Optional: one counter assertion each in
   `sim:settle_score`. Not blocking: every AC has a discriminating assertion
   and all five sensor mutants are killed.

## Leak audit (message-only protocol)

- **No new messages, no new sim events.** The rename is value-only inside the
  existing `RoundEndReason` union (`packages/shared/src/protocol/simEvents.ts:148-152`);
  the `round:ended` registry projection is unchanged and still carries only
  `winner/reason/saboteurId` (`packages/shared/src/protocol/registry.test.ts:452-470`).
- **Recap/resume payloads carry public facts only.** `RoundRecap.settleScore/settleTarget`
  and `RoundResumed.settleScore` are counts of the already building-wide
  `guest:settled` walkie line — saboteur-visible by design (spec assumption
  "score visibility: public"). `round:recap` stays `'all'`-policy
  (`registry.test.ts:473`); `round:resumed` stays self-policy with its exact key
  set pinned (`registry.test.ts:484-493`). No role, saboteur-identity, grace, or
  room-interior field rides either payload.
- **No `coverage-met`/`coverage-failed` string remains** anywhere in `packages/`
  or `apps/` (grep-verified; remaining `coverage` hits are FR-23 telemetry
  schema fields and prose comments — sanctioned by DLVR-12). No debug-hook
  changes; the harness webServer's prod-strip check ran green during the
  verifier's e2e execution.

## Verifier notes

- The spec's requirement traceability table still reads "Pending" (written in
  the Specify phase); this file supersedes it with the mapped evidence above.
- `.specs/STATE.md` Handoff already points at this file; no STATE edits were
  made by the verifier.
- **Re-verification loop**: iteration 1 of 3 consumed. The fix commits touch
  only test code (`apps/server/src/rooms/TurnoverRoom.test.ts`), confirmed by
  `git show --stat`; no production code changed, so the leak audit and all
  original DLVR evidence remain valid. G3 (edge-case counter assertions) is
  the only open item and is optional hardening.
