# Front Desk — Independent Validation (cycle 3.2)

- **Result**: PASS (final verdict, after fix iteration 2 — see §8; the superseded round-1 verdict is preserved in §7)
- **Date**: 2026-08-31
- **Spec**: `.specs/features/front-desk/spec.md` (source of truth) · Design: `design.md` · Tasks: `tasks.md`
- **Diff range**: `d466edf..HEAD` (8 commits; `d466edf` = pre-feature merge)
- **Verifier**: independent sub-agent (author ≠ verifier; all evidence re-derived from test files, diff, and gate runs; baseline re-established in a scratch worktree at `d466edf`)

---

## 1. Task Completion

| Task | Claimed | Evidence found | Verdict |
| --- | --- | --- | --- |
| T1 tuning + protocol rows | ✅ | `tuning.ts:58` `DESK_RANGE_TILES: 1`; `tuning.test.ts:57` pins it; `registry.ts:124/127` rows; `messages.ts:189/199` payloads; `simEvents.ts:106/108`; literal policy test `registry.test.ts:166–167` | Done |
| T2 desk intents | ✅ | `intents.ts` schemas; accept/reject tests `registry.test.ts:95–144` | Done |
| T3 GuestSim hold/route | ✅ | `guests.ts:292–459` receive/release/releaseAll/routeHeld; scenarios `guests.test.ts:268–466` | Done |
| T4 RoundSim desk APIs | ✅ | `roundSim.ts` `deskInteract`/`deskSend` + `releaseAll` in `drainPending`/`leave`/`ghost`; tests `roundSim.test.ts:436–549` | Done |
| T5 room handlers | ✅ | `TurnoverRoom.ts:239–256` two silent zod handlers; `server:front_desk` tests `TurnoverRoom.test.ts:2699–2818` | Done |
| T6 client desk slice | ✅ | `WorldScene.ts` contextual E, `#desk-hint`, `#desk-menu`; `mappers.ts`, `state.ts` ViewActions | Done |
| T7 walkie log + gate 3 | ✅ | `WorldScene.ts:920–929` `#walkie-log` (last 5); `deskWalkie.spec.ts` (passes, 28.1 s) | Done |

**7/7 tasks implemented as claimed.**

---

## 2. Spec-Anchored AC Table (evidence-or-zero)

### P1 Receive, hold, release

| AC | Spec-defined outcome | Evidence (file:line → assertion) | Verdict |
| --- | --- | --- | --- |
| AC1 | E in zone, ≥1 unheld guest → front queued guest handed over, holder ≤1, impatience paused | `guests.test.ts:272` `expect(guests.receiveAtDesk('p1', CADENCE_5P + 1)).toBe('accepted')`; freeze: `:275–276` `expect(of(held,'guest:impatient')).toHaveLength(0)` / `self_assigned` 0; holder ≤1: `:348` `expect(guests.receiveAtDesk('p1', …)).toBe('ignored')`. **Front** semantics: no test distinguishes front from any queued guest → see sensor M1 | **SPEC-PRECISION-GAP** (front-of-queue selection unpinned; see §4) |
| AC2 | Empty queue / all held → E ignored silently | `guests.test.ts:345` `expect(guests.receiveAtDesk('p1', 0)).toBe('ignored')`; `:348` (holds one); round level `roundSim.test.ts:488–491` `'rejected'` ×3; wire silence `TurnoverRoom.test.ts:2807–2809` `expect(collector.types()).not.toContain('guest:routed'/'walkie:broadcast'/'error')` | PASS |
| AC3 | Walk-out or E-again → queue front, impatience resumes **exactly** | `guests.test.ts:295` `expect(firedAt).toBe(881)` (resume = releaseTick + frozen remaining, exact); walk-out `:298–323` `expect(outOfZone).toBe(true)` + `expect(firedAt).not.toBeNull()`; round level `roundSim.test.ts:511–521` E-again → `selfAssigned` true | PASS |
| AC4 | Held guest stands at desk, never self-assigns | `guests.test.ts:274–276` impatient/self_assigned 0 over 600 ticks past deadline; `:278–279` `expect(positionOf('guest:1')?.x).toBe(TUNING.DESK_X_TILES)`; queue-no-shift `:358–378` | PASS |
| AC5 | Fired/disconnected holder → release to front, impatience resumes | `guests.test.ts:325–341` `releaseAll` → `expect(fired).toBe(true)` + position at desk; ghost path `roundSim.test.ts:524–548` (`sim.ghost('p1')` → `deskSend` rejected, guest re-queued); wiring `roundSim.ts:238/315/372` (fire/leave/ghost → `releaseAll`). Room-level disconnect-mid-hold test absent (covered structurally via `sim.leave`) | PASS (sim-level; room disconnect path untested — minor) |

### P1 Send with a claim that can lie

| AC | Spec-defined outcome | Evidence | Verdict |
| --- | --- | --- | --- |
| AC6 | Completed send → route + building-wide claim + slot released | `guests.test.ts:386–396` `routeHeld(...)==='routed'`, routed+claim events `toEqual([...])` exact; round `roundSim.test.ts:457–477` `'routed'`, claim `{floor1, room2}`, settled `{floor1, room1}`; server `TurnoverRoom.test.ts:2731–2743` `waitFor('guest:routed')` + `waitFor('walkie:broadcast')` on ALL four collectors ('all' policy) | PASS |
| AC7 | Walk NOT derived from claim; destination/announce independent | `guests.test.ts:405` lie `routeHeld('p1', floor2:4, floor1:8)` accepted; `:435–440` settled `toEqual({floor:'floor2', room:4})` while claim = floor1:8; round `roundSim.test.ts:476–477` claim room2 vs settled room1; server `:2754` `expect(settled).toMatchObject({floor:'floor2', room:4})` | PASS |
| AC8 | No validation announce==dest; lie accepted, no distinguishing event | `guests.test.ts:405` `.toBe('routed')` for mismatched pair; `:441–444` surface-event sweep contains only claim/routed/arrived/impatient — no error/extra event | PASS |
| AC9 | Tenanted destination → silent reject, holder keeps guest | `guests.test.ts:452–458` tenanted.set('floor2:4') → `.toBe('ignored')`, `expect(guests.tick(...)).toHaveLength(0)` (nothing flushed), guest still at desk | PASS (sim-level; server-level occupied-dest silence is structural — room maps `'ignored'`→nothing, untested end-to-end) |
| AC10 | Claim attributable; destination NEVER on the wire | `guests.test.ts:412–417` routed payload `toEqual({type,guestId,playerId})` exact; `:441–444` `expect(JSON.stringify(e)).not.toContain('floor2')` over all surface events; server `:2732` `expect(Object.keys(routed.payload).sort()).toEqual(['guestId','playerId'])`, `:2742` `expect(JSON.stringify(claim.payload)).not.toContain('floor2')`; client `deskWalkie.spec.ts:131–135` claim payload assertions; structural: `messages.ts:189–203` `GuestRouted{guestId,playerId}` only, `WalkieBroadcast{playerId,floor,room}` (announced); `simEvents.ts:102–108` | **PASS** (leak audit clean at sim, server, client, and type level) |

### P2 Client desk slice

| AC | Spec-defined outcome | Evidence | Verdict |
| --- | --- | --- | --- |
| P2-1 | In zone + queued → hint; receive opens menu (dest→announce); E-again/leave releases and closes | `deskWalkie.spec.ts:54–58` `#desk-hint` visible; `:61–68` E → `#desk-menu` visible, step title 'send the guest to which room?'; two-step `:72–78`; close on own routed `:87` `waitForSelector('#desk-menu', {state:'hidden'})`. **E-again/walk-out menu close is NOT asserted client-side** (release itself pinned at sim level, `roundSim.test.ts:511–521`) | **SPEC-PRECISION-GAP** (close-on-E-again/walk-out unasserted in the client harness) |
| P2-2 | Walkie claim fires → named line rendered on every client | `deskWalkie.spec.ts:88–94` loop over all 4 pages `waitForFunction('#walkie-log' … includes '«ada»: guest going to floor1:8')` | PASS |
| P2-3 | No client surface names the destination | `deskWalkie.spec.ts:98–101` `expect(bodyHasDestination).toBe(false)` (body innerText pre-settle); payload-level `:131–135` | PASS |

**Score: 11 PASS, 2 SPEC-PRECISION-GAP (AC1 front-selection, P2-1 close-on-release), 0 hard GAP.**

### Edge Cases checklist

| Edge case | Evidence | Verdict |
| --- | --- | --- |
| Same-tick send by one holder + release by another (per-holder independence) | No test holds two guests via two players simultaneously (`guests.test.ts` uses only p1 as holder; p2's only role is a rejected receiver `:355`) | **GAP** |
| Announce == destination (honest case) | `guests.test.ts:382–397` `sim:walkie_broadcast` honest send routes + claims same room | PASS |
| Buzzer kills a routed guest mid-walk (GUEST-11 unchanged) | `roundSim.test.ts:404–423` 'guest events never survive the round end (GUEST-11)' (pre-existing, covers round-scoped guests incl. routed) | PASS |
| Routed to the room they would have self-assigned → same outcome minus gamble | No direct assertion found | **GAP** (minor) |
| Two players E same tick → first intent wins, loser ignored | `guests.test.ts:351–356` p1 accepted, p2 ignored; sequential handler dispatch in room | PASS |
| Saboteur holds → identical behavior (role-blind) | Structural: `deskInteract`/`deskSend` take only `playerId` — no role input exists in the sim | PASS (structural) |

---

## 3. Gate Check

| Gate | Command | Result | Counts vs baseline (STATE.md: sim+shared 198 / server 57 / client 34) |
| --- | --- | --- | --- |
| 1 | `pnpm typecheck` | ✅ 4/4 projects | — |
| 1 | `pnpm lint` (Biome) | ✅ clean (110 files) | — |
| 2 | `pnpm vitest run packages/shared packages/sim` | ❌ **1 failed** | 216 tests (was 198, +18): 215 pass, **1 FAIL** — `packages/sim/src/literals.test.ts` "finds no prd §7 tuning literals outside packages/shared": `apps/client/src/scenes/WorldScene.ts:883` `[1, 2, 3, 4, 5, 6, 7, 8] as const` matches the `/\b6\b/` denylist (SKEL-04). **Deterministic regression introduced by this diff** (line added in T6/T7 desk-menu room list). Reproduced on every run |
| 2 | `pnpm vitest run apps/server` | ⚠️ flaky | 74 tests (was 57, +17): `REG-18` seq-continuity failed 3/3 full-suite runs, but also fails **at baseline** in isolation and passes 3/5 isolated at HEAD → pre-existing timing flake, elevated under load; **not conclusively attributable to the feature** (room diff adds only two `onMessage` handlers, no seq-affecting path). Flagged for follow-up |
| 2 (full workspace) | `pnpm exec vitest run` | ❌ 1 failed | 377 tests: 376 pass, 1 fail (literals — same root cause). Author's claimed "test:sim 377/377" does **not** reproduce |
| 3 | `pnpm exec playwright test …deskWalkie.spec.ts` (only; full suite known-flaky, skipped per instructions) | ✅ 1 passed (28.1 s) | 35 Playwright tests total (was 34, +1) |

---

## 4. Discrimination Sensor

Method: per instructions, `git status --porcelain` captured **empty** before start; each mutation applied to the real-tree `packages/sim/src/guests.ts`, `pnpm vitest run packages/sim/src/guests.test.ts` from repo root, then `git checkout --` restore; final porcelain verified **empty** (equals baseline). Apparent survivors re-run in a scratch worktree + direct debug harness to rule out cache.

| Mutation | Change | Expected kill target | Result | Evidence |
| --- | --- | --- | --- | --- |
| M1 | `receiveAtDesk`: `this.queue[0]` → `this.queue[this.queue.length - 1]` (wrong guest received) | sim:desk_receive queue-front assertions | **SURVIVED** (20/20 pass) | Debug harness shows queue becomes `["guest:3","guest:2","guest:3"]` (guest:1 orphaned from the queue!) yet all assertions pass: the 1-guest scenario can't distinguish front/back, and the queue-no-shift test (`guests.test.ts:358–378`) asserts only positions, which are invariant here. **No test pins queue-front selection** |
| M2 | `routeHeld`: claim `{announce.floor, announce.room}` → `{destination.floor, destination.room}` (lie impossible) | sim:walkie_lie | **KILLED** | `guests.test.ts:415–417` claim `toEqual({playerId, floor:'floor1', room:8})` fails (payload now floor2:4); 1 failed / 19 passed |
| M3 | `releaseHeld`: `tick + (g.impatienceRemaining ?? 0)` → `tick + this.impatienceTicks` (resume→reset) | resume-exactly assertion | **KILLED** | `guests.test.ts:295` `expect(firedAt).toBe(881)` fails; also `:325–341` fired-release test fails; 2 failed / 18 passed |

**Sensor: 2/3 killed.** M1's survival is a genuine coverage hole: AC1's "front queued guest" and the queue-integrity invariant are unpinned (the mutation even orphans a queued guest and no assertion notices).

---

## 5. Code Quality

| Check | Finding | Verdict |
| --- | --- | --- |
| Scope creep | Diff touches only the feature surface: shared protocol/tuning/intents, sim guests/roundSim, room handlers, client mappers/state/scene/connection, tests, `.specs/` docs, one proposal doc. `spectator.spec.ts` +9 is a justified spec-decision amendment (accuse-hold suppressed in desk zone) | ✅ Clean |
| Tests non-shallow | Assertions are value-level throughout: exact event payloads (`toEqual`), exact tick math (`firedAt === 881`), payload key sets (`Object.keys(...).sort()`), negative wire sweeps (`not.toContain('floor2')`), client DOM text + `__TURNOVER__` payload checks. No call-count-only tests | ✅ Good |
| Leak rule (structural) | `messages.ts:189–203`: `GuestRouted = {guestId, playerId}` — no destination field; `WalkieBroadcast = {playerId, floor, room}` = announced room only. `registry.ts:315–330` projections strip to these; `simEvents.ts:102–108` matches. Grep of registry payloads for `guest:routed`/`walkie:broadcast`: no destination anywhere. Additionally asserted dynamically at sim (`guests.test.ts:441–444`), server (`TurnoverRoom.test.ts:2732, 2742`), and client (`deskWalkie.spec.ts:98–101, 131–135`) | ✅ Leak rule holds at type + event + all three gate levels |
| Gate discipline | Two gate failures above contradict the tasks.md "377/377" and "all green" claims | ❌ See §3 |

---

## 6. Requirement Traceability Update

| Requirement | Status | Basis |
| --- | --- | --- |
| DESK-01 (receive in zone) | **Verified** | AC1 evidence + roundSim zone test; front-selection caveat **closed in iteration 2** (§8: new front-selection test + sensor M1 now killed) |
| DESK-02 (silent ignore) | **Verified** | AC2 evidence, sim + round + server wire silence |
| DESK-03 (release/E-again/walk-out, exact resume) | **Verified** | AC3 evidence (`firedAt === 881`) |
| DESK-04 (held stands, no self-assign) | **Verified** | AC4 evidence |
| DESK-05 (fired/ghost/disconnect release) | **Verified** | AC5 evidence (room-level disconnect untested — minor) |
| DESK-06 (send flow → route) | **Verified** | AC6 evidence at all levels |
| DESK-07 (claim independent of walk) | **Verified** | AC7 evidence (lie tests) |
| DESK-08 (no announce validation) | **Verified** | AC8 evidence |
| DESK-09 (occupied destination silent) | **Verified** | AC9 evidence (sim; server mapping structural) |
| DESK-10 (attributable claim, no destination on wire) | **Verified** | AC10 leak audit |
| DESK-11 (hint/menu/receive UX) | **Verified** | P2-1 evidence; close-on-E-again/walk-out client caveat **closed in iteration 2** (§8: `deskWalkie.spec.ts:70–83` asserts E-again close, walk-out close, re-receive) |
| DESK-12 (building-wide walkie line) | **Verified** | P2-2 evidence (all 4 pages) |
| DESK-13 (no client destination surface) | **Verified** | P2-3 evidence + payload audit |

---

## 7. Summary Verdict: **FAIL** (round 1 — SUPERSEDED by §8 re-verification verdict: **PASS**)

> Round-1 verdict preserved below for the record. Fix commit `3f1d45e` closed the gaps; see §8.

The feature logic is solidly implemented and the leak rule holds at every level (10/13 requirements fully verified, 2 with precision caveats, client gate green). However:

1. **Deterministic gate failure (blocking)**: `packages/sim/src/literals.test.ts` fails because `apps/client/src/scenes/WorldScene.ts:883` hardcodes `[1,2,3,4,5,6,7,8]` (matches the `/\b6\b/` §7 denylist). Introduced by this diff; contradicts the author's "377/377" claim. Fix: use `ROOMS_PER_FLOOR`/shared constant.
2. **Discrimination sensor 2/3**: M1 survived — no test pins that `receiveAtDesk` hands over the **front** queued guest (AC1's "front" is SPEC-PRECISION-GAP); the mutation even orphans a queued guest undetected.
3. **Pre-existing flake flagged**: `REG-18` (server seq continuity) fails under load both at baseline and HEAD; recommend triage separately.
4. **Edge-case gaps (minor)**: per-holder same-tick independence and "routed to self-assign room" unpinned; client menu close-on-E-again/walk-out unasserted.

---

## 8. Re-verification (iteration 2) — Verdict: **PASS**

- **Date**: 2026-08-31 (same day, after fix commit `3f1d45e` on top of the feature range `d466edf..HEAD`)
- **Verifier**: same independent protocol (author ≠ verifier); baseline `git status --porcelain` captured **empty** before start; no source modified beyond sensor apply/restore.

### 8.1 Gap → fix → evidence

| Gap (round 1) | Fix claimed in `3f1d45e` | Evidence re-derived | Status |
| --- | --- | --- | --- |
| G1 (BLOCKING): literal `[1,2,3,4,5,6,7,8]` in `WorldScene.ts` tripped the §7-numeric denylist in `literals.test.ts` | Use shared `ROOM_INDEXES` | `apps/client/src/scenes/WorldScene.ts:5` (import) and `:889` `for (const room of ROOM_INDEXES)` — no numeric literal remains; `pnpm vitest run packages/shared packages/sim` passes `literals.test.ts` on every run this round | ✅ CLOSED |
| G2: no test pinned queue-FRONT receive (sensor M1 survived) | New describe `sim:desk_receive (selection + per-holder independence)` | `packages/sim/src/guests.test.ts:469` describe; front-selection test `:471` routes `guest:1` while `guest:2` stays queued (`:483–487` routed payload names `guest:1`; `:489` `positionOf('guest:2')` still at `DESK_X_TILES + 1`; `:491` `p2` receives next) | ✅ CLOSED |
| G3: menu close-on-E-again/walk-out unasserted client-side | Harness now exercises E-again close, walk-out close, re-receive before the lie flow; **real bug found**: key auto-repeat toggled the desk menu → `event.repeat` guard on keydown-E | `apps/client/harness/deskWalkie.spec.ts:70–83` (E-again → `#desk-menu` hidden; ArrowRight/Left walk-out → hidden; re-receive → visible); fix `apps/client/src/scenes/WorldScene.ts:310–312` `if (event.repeat) return` with comment; client gate passes end-to-end | ✅ CLOSED |
| G4 (partial): per-holder same-tick edge case uncovered | Covered at sim level | `packages/sim/src/guests.test.ts:508–524`: p1 `routeHeld` + p2 `releaseHeld` same tick → both resolve (`:518–524` routed `guest:1`, released `guest:2` at queue front, `guest:1` begins walk) | ✅ CLOSED |
| G5: REG-18 seq-continuity load flake (apps/server), pre-existing at baseline `d466edf` | Out of scope — document only | This round: `pnpm vitest run apps/server` passed **74/74 first try** (flake did not trigger; no retry needed). Remains a known pre-existing flake elevated under load — tracked separately, not attributable to this feature | 📋 DOCUMENTED |

### 8.2 Fresh gate results

| Gate | Command | Result | Counts |
| --- | --- | --- | --- |
| 1 | `pnpm typecheck` | ✅ 4/4 projects (shared, sim, server, client) | — |
| 1 | `pnpm lint` (Biome) | ✅ clean (110 files, no fixes applied) | — |
| 2 | `pnpm vitest run packages/shared packages/sim` | ✅ **218 passed / 218** (13 files) | Note: instructions said "expect 219". Arithmetic reconciles to 218: round 1 counted **216 total** (215 pass + 1 literals FAIL), and `3f1d45e` added exactly **2** vitest tests (verified via `git show 3f1d45e` — no tests removed). All pass; the "219" expectation is off by one against round 1's own count. Substantive gate (0 failures) met |
| 2 | `pnpm vitest run apps/server` | ✅ **74 passed / 74** first try — REG-18 did not trigger this run | 74 (was 57 baseline) |
| 3 | `pnpm exec playwright test …deskWalkie.spec.ts` | ✅ **1 passed** (30.8 s), no retry needed | Includes new E-again/walk-out/re-receive section |

### 8.3 Sensor re-run (3/3 killed)

Method identical to round 1: baseline porcelain **empty** → mutate `packages/sim/src/guests.ts` → `pnpm vitest run packages/sim/src/guests.test.ts` from repo root → `git checkout -- packages/sim/src/guests.ts` after each.

| Mutation | Change | Result | Evidence |
| --- | --- | --- | --- |
| M1 | `receiveAtDesk`: `this.queue[0]` → `this.queue[this.queue.length - 1]` | **KILLED** (was SURVIVED) | 2 failed / 20 passed: front-selection test `guests.test.ts:471` fails (`guest:2` routed instead of `guest:1`) and the per-holder test `:508` also fails |
| M2 | `routeHeld`: `{announce.floor, announce.room}` → `{destination.floor, destination.room}` | **KILLED** | 1 failed / 21 passed: `sim:walkie_lie` "routes to floor2:4 while claiming floor1:8" fails (claim payload now equals destination) |
| M3 | `releaseHeld`: `tick + (g.impatienceRemaining ?? 0)` → `tick + this.impatienceTicks` | **KILLED** | 2 failed / 20 passed: "impatience resumes EXACTLY where it paused" (`guests.test.ts:295` `firedAt === 881`) and "a fired or disconnected holder releases" (`:325–341`) |

**Sensor: 3/3 killed.**

### 8.4 Tree hygiene

- Sensor files restored byte-identical after each mutation; final `git status --porcelain` for all feature/sensor files clean.
- One **external, concurrent edit** appeared during verification: `.specs/proposals/guest-transport-economy.md` (mtime 09:44:30, 137+/113− rewrite to "v2" of the suitcase proposal). **Not produced by the verifier and outside this feature's scope** — left untouched rather than reverted to avoid destroying in-flight work. Excluded from the verdict.

### 8.5 Overall verdict: **PASS**

- **ACs: 13/13 evidenced** (11 PASS + AC1 front-selection and P2-1 close-on-release both closed in iteration 2; 0 hard gaps remain; the "routed to self-assign room" edge case remains a minor, non-blocking observation).
- Gates green (typecheck 4/4, lint clean, shared+sim 218/218, server 74/74, client gate 1/1), modulo the documented pre-existing REG-18 flake (G5, did not trigger this round).
- Discrimination sensor **3/3 killed**.
- DESK-01..13 all **Verified** (§6 updated).
