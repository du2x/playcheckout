# Stairs Validation (cycle 3.E, AD-040) — Verifier report

**Verdict: PASS** (implemented group T2–T6, commit range `62bef10^..1b68a8b`, 5 commits).
T7 (docs) and T8 (final gate ladder) intentionally remain — not verified here.

Verified by an independent re-derivation from evidence: every STAIRS-01..21
requirement traced to a located assertion, gates re-run from zero, and a
5-mutant discrimination sensor run against the new sim code. The sensor killed
5/5 mutants; the real tree was restored byte-identical (empty porcelain,
verified against the pre-sensor baseline).

---

## 1. Gates (run by the Verifier, not trusted from logs)

| Gate | Command | Result |
| --- | --- | --- |
| 1a | `pnpm typecheck` | ✅ exit 0 (all 4 workspace projects) |
| 1b | `pnpm lint` (Biome) | ✅ exit 0, 119 files, no fixes |
| 2 | `pnpm vitest run packages/sim packages/shared apps/server` | ✅ **369 passed / 0 failed** (17 files, 66.4 s) |
| 3 | `pnpm test:client` | Not re-run by the Verifier (per handoff): author ran it **35/35 green with `--workers=2`**. Note: the default worker count oversubscribes this machine — run Gate 3 with `--workers=2`. |

Requirement mapping for `pnpm test:sim`: it runs all workspace projects
(including the server transport shell exercised above as part of the 369).

## 2. Diff range

`62bef10^..1b68a8b` — 5 commits:

```
62bef10 feat(sim): collapse the elevator to a single east car (3.E)
7611a71 feat(sim): stairs transit channel with breath and stream silence (3.E)
e594e8e feat(sim): saboteur ambush on opposite stairs passes (3.E)
bc78ff3 feat(server): stairs intent, ambush authority, and results resolution (3.E)
1b68a8b feat(client): stairwell marker, stairs screen, ambush toasts, single car (3.E)
```

30 files, +2788/−1302. `4052f67` (car screen restyle) predates the group — out
of scope. Two-car movement tests were **amended, not silently deleted**: 12
two-car-specific test names were replaced by single-car successors (59 → 82
`it()` blocks; every deleted name has a visible single-car counterpart in the
passing run, e.g. "a mid-hall call with the car occupied-dwelling elsewhere
queues", "a call pressed at the landing whose car is busy elsewhere queues and
that car attends it (AD-023 degenerate, AD-040)").

## 3. Per-requirement evidence (STAIRS-01..21; 22 is docs-only → T7)

| Req | Spec outcome | Evidence (file:line + assertion) | Verdict |
| --- | --- | --- | --- |
| STAIRS-01 | Exactly one car in state/snapshots/payloads; car 2 does not exist | `packages/sim/src/movement.test.ts:1443` `expect(sim.carFloors()).toEqual([{ car: 1, floor: 'lobby' }])`; `:1444` `snapshotForFloor('lobby').cars` equal one row; `:1447–1448` rider snapshots one row; `:1453–1478` west end is never an elevator landing (x=0 caller is mid-hall: decoy flash, never a dispatch) | PASS |
| STAIRS-02 | Every elevator payload carries `car: 1` only | `movement.test.ts:1480–1500` — over 500 ticks, for every `elevator:called/moved/doors/pressed/riders` event: `expect(e.car).toBe(1)`; type level: `movement.ts:140–142` `car: 1` in every PendingAnnounce variant | PASS |
| STAIRS-03 | Single-car dispatch semantics (choice predicates collapse) | `movement.test.ts:1453–1478` — `expect(sim.callElevator('p1')).toBe('ignored')` + the degenerate both-parked flash `{ type: 'elevator:called', floor: 'lobby', car: 1 }` and **no** `elevator:moved` for 100 ticks; amended single-car dispatch/queue/FIFO tests all green in the gate run | PASS |
| STAIRS-04 | Client renders exactly one car's light + floor readout | `apps/client/harness/stairs.spec.ts:52–55` — `#panel-floor` === 'lobby', `expect(await host.locator('#panel-light').count()).toBe(1)`, `#panel-west`/`#panel-east` count 0; `apps/client/src/scenes/elevatorPresenter.test.ts:286–302` amended single-car light assertions (`panelState().light`, `panelState().floor`) | PASS (Gate 3 via author's 35/35 run) |
| STAIRS-05 | Direction key at the mouth → 3 s transit to adjacent floor | `movement.test.ts:1537–1555` — entry state `{from:'lobby', to:'mezzanine', dir:1, phase:'transit'}`; `:1561` `expect(arrivalAt).toBe(TUNING.STAIRS_TRANSIT_SECONDS * TICK_HZ)` (=60 ticks); `:1682–1693` FLOOR_IDS adjacency both ways through the mezzanine; `:1657` boundary `xMilli: 1000` (=ELEVATOR_LANDING_TILES) accepted; server: `apps/server/src/rooms/TurnoverRoom.test.ts:3092–3107` | PASS |
| STAIRS-06 | Arrival at destination mouth + 2 s immobile breath | `movement.test.ts:1557–1568` — `expect(breathEndsAt).toBe(TRANSIT*TICK_HZ + BREATH*TICK_HZ)` (=100), state then undefined, re-entry works; `:1570–1583` breath immobile: held keys change nothing, exactly 1 arrival `player:moved` | PASS |
| STAIRS-07 | Departure observable; interior silent; arrival via stream | `movement.test.ts:1585–1601` — exactly ONE `player:moved` for the transiter (arrival flush), `player:left-floor` emitted; `:1603–1614` `viewOf` → `{floor:null,...}`, `allPositions()` and `snapshotForFloor().players` exclude the occupant; server: `TurnoverRoom.test.ts:3109–3110` origin floor receives `player:left-floor` only | PASS |
| STAIRS-08 | Own client sees stairs state; no stream while inside | `movement.test.ts:1616–1633` — `own.stairs` matches `{from, to, phase}`, `remainingSeconds` in (0, 3]; `expect('stairs' in other).toBe(false)` + other's players list excludes occupant; breath keeps the row; server: `TurnoverRoom.test.ts:3103–3107` personal snapshot carries the row | PASS |
| STAIRS-09 | Keys mid-transit/breath ignored | `movement.test.ts:1635–1649` — `enterStairs` up/down → 'ignored', held moves leave position untouched, zero leaked `player:moved` | PASS |
| STAIRS-10 | No-adjacent-floor (and off-mouth) requests rejected silently | `movement.test.ts:1651–1663` — mid-hall (x=15000), one milli past scale (1001), `floor3` up, `lobby` down all 'ignored'; server: `TurnoverRoom.test.ts:3117–3130` `expect(pushes).toBe(0)` — nothing on the wire | PASS |
| STAIRS-11 | Usable in all phases, by all players, never guests | `movement.test.ts:1665–1671` — in-car and guest → 'ignored'; `:1674–1679` calls rejected from inside; phases: pre-round/lobby (`TurnoverRoom.test.ts:3092–3097`), round (ambush tests), results resolution (`:3211–3240`), post-results plain transit (`:3243–3255`); phase-free is structural (MovementSim carries no phase state; AD-005/015) | PASS |
| STAIRS-12 | Opposite-direction saboteur/staff pass → 20 s stun | `movement.test.ts:1729–1745` — `stairs:ambushed {stunSeconds: 20}` + `stairs:ambush {victimId}` on the first tick; `phase: 'stunned'`; still stunned at tick STUN_TICKS−1 (399), resumed at 400 | PASS |
| STAIRS-13 | Stun expiry resumes the interrupted transit + normal breath | `movement.test.ts:1747–1762` — `transitTicksLeft` preserved (=59); after the stun `phase:'transit'` with `ticksLeft === remaining`; arrival at `floor1` + breath | PASS |
| STAIRS-14 | Victim payload anonymous; saboteur private confirmation | `movement.test.ts:1764–1774` — `expect(Object.keys(ambushed).sort()).toEqual(['playerId','stunSeconds','type'])`; server: `TurnoverRoom.test.ts:3132–3200` — victim gets the exact payload, saboteur gets `stairs:ambush`, and `expect(leaked).toBe(false)` for the bystander on **both** rows | PASS |
| STAIRS-15 | All inert cases: staff-staff, same-dir, stationary, guest, fired/ghosted | `movement.test.ts:1776–1787` (staff-staff opposite: no `stairs:` events for 10 ticks); `:1789–1820` (same-direction; victim mid-breath; authority unset); `:1822–1836` (fired/ghosted `isLiveStaff:false` spared); guest rejection at `:1670–1671` | PASS |
| STAIRS-16 | No per-round limit; multiple victims per stride | `movement.test.ts:1838–1855` — two opposing staff in one stride: 2× `stairs:ambushed`, 2× `stairs:ambush`, both stunned; `:1857–1870` recovered victim re-passed → ambush fires again | PASS |
| STAIRS-17 | Stairwell marker at the west landing | `apps/client/harness/stairs.spec.ts:57–58` — `waitForFunction(() => document.querySelector('#stairwell-marker') !== null)` | PASS (Gate 3 via author's run) |
| STAIRS-18 | Stairs chip/screen replaces the floor view | `stairs.spec.ts:63–90` — screen visible with route 'L → M', dir '▲ up', phase 'moving' + clock; rolls to 'catching breath'; hides at visit end; `apps/client/src/ui/stairScreen.test.ts:19–56` — countdown math, transit→breath rollover, overshoot subtraction, visit end, stun countdown | PASS (Gate 3 via author's run) |
| STAIRS-19 | Ambush toast with countdown; saboteur private confirmation | `stairs.spec.ts:170–185` — `#ambush-toast` contains 'you were ambushed', screen phase 'stunned'; `:187–192` — `#ambush-confirm` contains `` `landed on ${victimName}` `` | PASS (Gate 3 via author's run) |
| STAIRS-20 | Single-car panel updates exactly as the two-car set did for car 1 | `stairs.spec.ts:52–55` (one light, one readout, no two-car DOM); `elevatorPresenter.test.ts:286–302` (light-on-call, clear-on-arrival preserved for car 1); amended elevator harness specs (`elevatorLobby.spec.ts`, `elevator-doors.spec.ts`, …) all green in the author's 35/35 run | PASS (Gate 3 via author's run) |
| STAIRS-21 | Ambush-only scenario records zero complaints (kill check) | `movement.test.ts:1891–1902` — over the full visit, every event type matches `/^(player:moved\|player:left-floor\|stairs:ambushed\|stairs:ambush)$/` and `stairs:ambushed` occurs; no complaint/fired/loss-shaped surface | PASS |
| STAIRS-22 | §8 recompute (docs) | Docs-only — owned by T7, intentionally out of scope | N/A |

## 4. Edge cases (spec §Edge Cases)

| Edge case | Evidence | Status |
| --- | --- | --- |
| Pre-round / post-buzzer pass → no ambush | `movement.test.ts:1811–1819` (authority unset → inert); `TurnoverRoom.test.ts:3241–3255` (post-results opposite pair → `expect(fired).toBe(false)`) | Pinned |
| Suitcase stays + 60 s carry clock keeps running | **No test located.** Behavior is structural (stun lives in `MovementSim`; the carry clock is `GuestSim`/`RoundSim` state — disjoint subsystems), but the spec edge case has no scenario | GAP-2 |
| Buzzer mid-transit/mid-stun → destination floor, stun cleared | `movement.test.ts:1872–1889` (`resolveStairsForResults`: state cleared, both at destination mouths, stream re-announces); `TurnoverRoom.test.ts:3211–3240` (results snapshot has no `stairs`, `own.floor === 'mezzanine'`) | Pinned |
| Reconnect mid-transit/mid-stun | **Spec ↔ design conflict.** spec.md says "the restored seat SHALL continue the remaining transit/stun duration"; design.md (Disconnect row) and the delivered behavior delete the stairs state with the seat (`movement.ts:198`, pinned by `movement.test.ts:1695–1704`) and restore into a fresh join. The delivered behavior matches the approved design, but the spec text was never amended | GAP-1 |
| Stunned victim + mover share stairs → pass-through, nothing revealed | No dedicated test; structural (no player collision in the sim) + interior silence pinned by STAIRS-07; adjacent coverage: the no-limiter test runs three simultaneous occupants | GAP-3 (minor) |
| Fired player transits normally, invisible to ambush | `movement.test.ts:1822–1836` (fired player enters and transits; no ambush) | Pinned |
| Recovered victim re-passed → fires again | `movement.test.ts:1857–1870` | Pinned |

## 5. Discrimination sensor (5 behavior-level mutants — 5/5 killed)

Scratch method: `packages/sim/src/movement.ts` backed up byte-exact to
`/tmp/opencode/movement.baseline.ts`; each mutant applied as a single
behavior-level edit, `pnpm vitest run packages/sim/src/movement.test.ts` run
against it, then the file restored from the backup. After the sensor:
`git status --porcelain` empty and `cmp` confirmed the file byte-identical to
the pre-sensor baseline. No `git stash` was used.

| Mutant (behavior injected) | Result | Killed by |
| --- | --- | --- |
| M1: transit stride 60→61 ticks (`STAIRS_TRANSIT_TICKS … * TICK_HZ + 1`) | KILLED (6 failures) | `enters at the west mouth and rides STAIRS_TRANSIT_SECONDS per stride (STAIRS-05)` — `movement.test.ts:1537`; also STAIRS-06/08/11/13 tests |
| M2: breath never frees (`st.ticksLeft <= 0` → `< 0` on delete) | KILLED (1 failure) | `holds the arrival breath for STAIRS_BREATH_SECONDS, then frees the player (STAIRS-06)` — `movement.test.ts:1557` |
| M3: ambush fires on same-direction pairs (dir check removed from `detectAmbushes`) | KILLED (1 failure) | `is inert for a same-direction pass, a stationary pair, and an unset authority (STAIRS-15)` — `movement.test.ts:1789` |
| M4: stun resume restarts the full transit (`st.ticksLeft = STAIRS_TRANSIT_TICKS` instead of the preserved remainder) | KILLED (1 failure) | `resumes the interrupted transit to the intended floor with the normal breath (STAIRS-13)` — `movement.test.ts:1747` |
| M5: `leave()` keeps the stairs state (FR-25 deletion removed) | KILLED (1 failure) | `drops the stairs state when the player leaves mid-transit (FR-25 seat loss)` — `movement.test.ts:1695` |

Sensor verdict: the new-code test suite is discriminating — every injected
behavior fault was detected. No surviving mutants → no fix tasks from the
sensor.

## 6. Ranked gap list (fix-task candidates; none block this PASS)

1. **GAP-1 (spec-precision, must resolve in T7):** spec.md's reconnect edge
   case ("the restored seat SHALL continue the remaining transit/stun
   duration") contradicts the approved design and the delivered, tested
   behavior (stairs state dies with the seat — `movement.ts:198`,
   `movement.test.ts:1695`). Amend the spec edge case to the design decision
   (or implement continuation — a product call, not a Verifier call).
2. **GAP-2 (untested edge case):** "suitcase stays with the ambushed victim and
   the 60 s carry clock keeps running" has no scenario. Behavior is safe by
   construction (disjoint subsystems), but the repo standard is gate-testable
   edge cases. Suggest a small sim-level assertion in a follow-up or folded
   into 3.3's suite.
3. **GAP-3 (minor, untested edge case):** no dedicated pass-through assertion
   for a stunned victim sharing the stairs with a mover. Structural + adjacent
   coverage exists; low priority.
4. **GAP-4 (bookkeeping):** `tasks.md` T4 lacks its ✅ mark although the ambush
   commit `e594e8e` is delivered; spec.md traceability still shows
   STAIRS-05/14/17 "Implementing" and 12/13/15/16/21 "Pending". T7 owns the
   final traceability pass — close both there.

## 7. Counts

- Tests run by the Verifier: **369 passed / 0 failed** (sim + shared + server),
  plus 6 mutant runs of `movement.test.ts` (82 tests each; all mutants killed).
- Mutants: 5 injected, 5 killed, 0 survived.
- Gate 3 (client): author's run 35/35 green (`--workers=2`); not re-run by the
  Verifier per the handoff instruction.

---

## T7/T8 addendum (delta verification, 2026-09-02)

The main report above covers T2–T6 (`62bef10^..1b68a8b`). The remaining tasks
landed afterwards and were verified as a delta:

**T7 — docs + §8 recompute** (`9b74d5b`): prd v1.6 (changelog, FR-5/FR-6 amend,
new §6.10 FR-34/35, §7 stairs rows, §9 risks) with the §8 v1.6 recompute —
single-car guest trip ≈ 8–12 s against the 18 s 6p cadence ≈ 1.5× headroom,
the v1.3 cadence dials hold; ambush kill check restated. roadmap 3.E row +
sequencing note; CONTEXT.md stairwell/ambush/breath/stun vocabulary;
`docs/elevator-behavior.md` one-car amendment; art manifest stairwell entry.
Verifier follow-up (1) resolved in design.md: the reconnect wording — a
mid-round drop HOLDS the seat (movement slot frozen, stairs state persists,
`round:resumed` re-sends it); `leave()` (expiry/fired/leave) discards it.

**T8 — gate ladder** (run at HEAD `9b74d5b` + the harness staging commit):

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | ✅ exit 0 |
| `pnpm lint` | ✅ exit 0, 119 files |
| `pnpm test:sim` | ✅ 475 passed / 0 failed (26 files) |
| `pnpm test:client --workers=2` | 38/39 ✅ — the only failure is `client:lobby_join` room-full, the documented bleed class (3.D handoff), green isolated at HEAD |

**T8 code delta**: three harness specs re-staged their west-landing walks to
the east landing (commit `5ef4ac6` — doors, art-elevator, art-doors ×2), the
T6 slice's unamended fallout; each re-run green in place, `client:stairs`
green in the full run. Verifier follow-ups (2)/(3) stand as recorded
non-blockers (safe-by-construction edges; §8 recompute landed).
