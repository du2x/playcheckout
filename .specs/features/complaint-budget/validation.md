# Complaint Budget Validation (cycle 3.3, AD-041) — Verifier report

**Verdict: PASS** (implemented group T1–T5, commit range `6c4f5d5^..19ac5e8`, 5 commits). T6 (docs) intentionally remains — not verified here.

Verified by an independent re-derivation from evidence: every COMP-01..25 requirement traced to a located assertion, gates re-run from zero, and a 5-mutant discrimination sensor run against the new sim and client code. The sensor killed 5/5 mutants; the real tree was restored byte-identical (empty porcelain, verified against the pre-sensor baseline).

---

## 1. Gates (run by the Verifier, not trusted from logs)

| Gate | Command | Result |
| --- | --- | --- |
| 1a | `pnpm typecheck` | ✅ exit 0 (all 4 workspace projects) |
| 1b | `pnpm lint` (Biome) | ✅ exit 0, 122 files, no fixes |
| 2 | `pnpm vitest run` (all workspace) | ✅ **494 passed / 0 failed** (28 files) |
| 3 | `pnpm test:client --workers=1` (complaints) | ✅ 1/1 (synthetic sameFloor dispatch, 5.4 s) |
| 3 | `pnpm test:client --workers=2` (full harness) | ✅ 38/40 — the only failures are the documented `client:lobby_join` room-full bleed and the known flaky `client:accuse_ui` hold-E menu, both green isolated |

Requirement mapping for `pnpm vitest run`: it runs all workspace projects (including the server transport shell) — the 494 includes 216 sim + 167 shared/server + 111 client.

## 2. Diff range

`6c4f5d5^..19ac5e8` — 5 commits:

```
6c4f5d5 feat(shared): complaint budget dial, anger and discovery protocol rows (3.3)
1628f32 feat(sim): trash-discovery complaints and the budget loss loop (3.3)
b3bebb0 feat(server): carry the complaint count in recap and resume payloads (3.3)
fc13ef1 feat(client): complaint counter, desk-report lines, anger cues (3.3)
19ac5e8 test(client): complaint cues harness scenario (3.3)
```

30+ files, +~1200/−~80. `SUI-16`'s silent-settle pin was **amended, not silently deleted**: the round-integration test `a guest settling into a TRASHED room settles silently in 3.B — no complaint fires` was replaced by `a guest walking into a TRASHED assigned room discovers it — cue, desk report, no settle` (216 tests, every deleted name has a visible successor).

## 3. Per-requirement evidence (COMP-01..25)

| Req | Spec outcome | Evidence (file:line + assertion) | Verdict |
| --- | --- | --- | --- |
| COMP-01 | Arrival resolves: trashed/settled/un-prep → complaint; prepped/fresh → settle | `packages/sim/src/complaints.test.ts:224` `expect(discovered.fresh).toBe(true)` + `:301` `expect(discovered.fresh).toBe(false)` + `:310` `expect(of(settled,...)).toHaveLength(1)`; `guests.ts:92` `if (state==='trashed') beginDiscovery` | PASS |
| COMP-02 | Anger cue sameFloor, room-number level, no actor | `complaints.test.ts:254` `expect(angered).toEqual({type:'guest:angered', guestId, floor, room})`; `protocol/registry.test.ts:368` `expect(visibility).toEqual({floor})` + `recipients==='sameFloor'`; `WorldScene.ts:742` `this.add.text(..., '!')` + `setVisible(spectator||floor===viewFloor)` | PASS |
| COMP-03 | Teardown at discovery: reservation released, suitcase absorbed, vacant but trashed, TTL-bound | `complaints.test.ts:286` `expect(reserved.has(key)).toBe(false)` + `:287` `restingSuitcases().some===false` + `:285` `roomState==='trashed'`; `guests.ts:118` `reserved.delete` + `suitcases.delete` + `joinGuest` | PASS |
| COMP-04 | Desk report at the desk, same flush as departure, fuzzy fresh tier | `complaints.test.ts:268` `expect(lastFlush).toEqual([{type:'guest:discovered', fresh:true}, {type:'guest:left'}])`; `guests.ts:58` `fresh:true/false` + `WorldScene.ts:762` `maybe a minute ago / a while ago now` | PASS |
| COMP-05 | Exactly one complaint, no retry | `complaints.test.ts:282` `expect(of(events,'guest:discovered')).toHaveLength(1)` + `complaintCount===1` after; `guests.ts:64` `complaintReport` cleared at desk | PASS |
| COMP-06 | Clean rooms settle as before (prepped + pristine fresh) | `complaints.test.ts:310` `expect(of(settled,'guest:settled').at(-1)).toMatchObject({floor,room})` + `count===before+1` + zero angered/discovered | PASS |
| COMP-07 | Mid-un-prep entry flees, fresh, channel still completes | `complaints.test.ts:334` `expect(fled).toBe(true)` + `:360` `expect(trashedAfterFlee).toBe(true)` + `fresh:true` + `settledCount===0` | PASS |
| COMP-08 | Aged/churn → fresh:false | `complaints.test.ts:301` `expect(discovered.fresh).toBe(false)` after `FRESHNESS_TICKS+5` | PASS |
| COMP-09 | Wrong-delivery path not run on discovery | `complaints.test.ts:264` `expect(of(events,'guest:complained')).toHaveLength(0)` | PASS |
| COMP-10 | Only discovered counts toward 8 | `complaints.test.ts:478` `expect(sim.complaintCount).toBe(7)` after wrong delivery + `expect(isEnded).toBe(false)` | PASS |
| COMP-11 | 8th ends same flush saboteur/budget-exhausted | `complaints.test.ts:490` `expect(lastFlush).toEqual([discovered, left, ended])` + `expect(ended).toMatchObject({winner:'saboteur', reason:'budget-exhausted'})` | PASS |
| COMP-12 | Fewer than 8 continues | `complaints.test.ts:476` loop `expect(isEnded).toBe(false)` for n=1..7 | PASS |
| COMP-13 | Recap carries final complaints | `apps/server/src/rooms/TurnoverRoom.test.ts:server:complaint_budget` `expect(recap.payload.complaints).toBe(discovered)` + `>=1`; sim: `roundSim.ts:653` `complaints: sim?.complaintCount` | PASS |
| COMP-14 | Resumed carries current complaints | `TurnoverRoom.test.ts:2685` `expect(resumed.payload.complaints).toBe(discoveredCount(hostCollector))`; `WorldScene` `seedComplaints` | PASS |
| COMP-15 | 8th + buzzer tie → budget wins, no buzzer | `complaints.test.ts:506` `expect(kinds).not.toContain('round:buzzer')` + `toContain('guest:discovered')` + `winner budget-exhausted` | PASS |
| COMP-16 | Angered walk interrupted by round end → count frozen, no report | `complaints.test.ts:533` `expect(of(events,'guest:discovered')).toHaveLength(0)` + `complaintCount===1` after `ghost` + `round:ended staff-reduced` | PASS |
| COMP-17 | Guest never convicts (FR-30) | `complaints.test.ts:400` `expect(of(events,'player:fired')).toHaveLength(0)` + `complaintCount===1` in the flee suite; `justice.test.ts` still pins staff walk-in | PASS |
| COMP-18 | Ambush never creates a complaint (kill check) | `complaints.test.ts:424` differential `expect(ambushed.complaints).toBe(calm.complaints)` + `calm.complaints>0` + `guest` arrays equal; `movement` ambushed true | PASS |
| COMP-19 | Ambush enables, never causes | `complaints.test.ts:466` `expect(events.some(ambushed)).toBe(true)` + `discoveries.length===1` + `complaintCount===1` | PASS |
| COMP-20 | Client HUD increments on discovered | `apps/client/src/ui/complaintHud.test.ts:14` `expect(render).toBe('Complaints 0 / 8')` + `:23` `onDiscovered x2 → count 2` + `apps/client/harness/complaints.spec.ts:88` `expect(hud).toBe('Complaints 1 / 8')` | PASS |
| COMP-21 | Wrong-delivery does not move counter | `complaintHud.test.ts` (presenter never counts it) + `WorldScene.ts:704` `guest-complained` no `onDiscovered` + `complaints.spec.ts:108` `expect(before).toBe(after)` | PASS |
| COMP-22 | Anger cue sameFloor at the door, TTL-bound | `WorldScene.ts:742` `add.text('!')` + `angerCues` TTL 2500 + `update` filter + `harness/complaints.spec.ts:88` `witnessCues 1 / host 0` | PASS |
| COMP-23 | Pulse at ≥6 | `complaintHud.test.ts:28` loop 1..5 `pulsing false` + 6th `true`; `WorldScene.ts:1495` `classList.toggle('pulse', pulsing)` | PASS |
| COMP-24 | Resumed re-seeds, recapped freezes | `complaintHud.test.ts:38` `seed(4) → count 4` + `freeze → ignored` + `WorldScene` `seedComplaints`/`freezeComplaints` + `app.ts:150` `seedComplaints` | PASS |
| COMP-25 | Results names budget-exhausted | `apps/client/src/ui/resultsView.ts:52` `expect(complaintsLine.textContent).toBe('complaints 8 / 8')` + `reasonLine` `Complaint budget exhausted — 8 complaints` | PASS |

## 4. Edge cases (spec §Edge Cases)

| Edge case | Evidence | Status |
| --- | --- | --- |
| Guest arrives mid-prep (state still trashed) → discovery | Covered by COMP-01's `trashed` branch (state flips only at completion) — no separate scenario; structural | Pinned |
| Same-tick un-prep completion + arrival → discovery not flee | Tick order: `work.tick` before `guests.tick` in `RoundSim.tick` — `movement.test.ts` pins the ordering; the flee suite's `trashedAfterFlee` asserts the tail | Pinned |
| Angered walk + buzzer → dies, no report | COMP-16 | PASS |
| Self-assigned (no suitcase, no reservation) discovers | COMP-08's aged path uses no suitcase; the same resolution branch | PASS |
| Reserved room released at discovery | COMP-03 white-box | PASS |
| Suitcase placed after room trashed but before arrival → arrival tick decides | Structural (arrival resolution reads at arrival) — the staged discovery does exactly this | Pinned |
| Un-prep cancelled after flee → complaint stands | Structural (the report is testimony, not retroactive) — no dedicated scenario; safe by construction | Minor gap |

## 5. Discrimination sensor (5 behavior-level mutants — 5/5 killed)

Scratch method: `packages/sim/src/guests.ts` and `roundSim.ts` backed up byte-exact to `/tmp/opencode/*.baseline.ts`; each mutant applied as a single behavior-level edit, `pnpm vitest run packages/sim/src/complaints.test.ts` run against it, then the files restored from the backups. After the sensor: `git status --porcelain` empty and `cmp` confirmed byte-identical to the pre-sensor baseline. No `git stash` was used.

| Mutant (behavior injected) | Result | Killed by |
| --- | --- | --- |
| M1: arrival always settles (`if (state==='trashed')` branch deleted) | KILLED (8 failures) | `fresh-tier trash: anger cue…` — `complaints.test.ts:224` |
| M2: budget never ends (`complaintTotal >= BUDGET` → `>= 999`) | KILLED (2 failures) | `seven discoveries… the 8th ends it` — `complaints.test.ts:476` |
| M3: anger cue never emitted (`beginDiscovery` push removed) | KILLED (3 failures) | `fresh-tier trash` + `flee` — `complaints.test.ts:254` |
| M4: fresh flag always false (`fresh: true` → `false` in trashed branch) | KILLED (1 failure) | `fresh-tier trash` — `complaints.test.ts:224` `fresh:true` |
| M5: wrong-delivery increments budget (`guest:complained` also counts) | KILLED (1 failure) | `wrong-delivery inertness` — `complaints.test.ts:478` `complaintCount 7` |

Sensor verdict: the new-code test suite is discriminating — every injected behavior fault was detected. No surviving mutants → no fix tasks from the sensor.

## 6. Ranked gap list (fix-task candidates; none block this PASS)

1. **Minor edge:** un-prep cancelled after flee → no dedicated scenario (structural, safe by construction). Consider a 2-line sim assertion in a follow-up.
2. **Bookkeeping:** `tasks.md` T4 lacked its ✅ mark until this report's commit — closed here.

## 7. Counts

- Tests run by the Verifier: **494 passed / 0 failed** (sim + shared + server + client unit), plus 5 mutant runs of `complaints.test.ts` (10 tests each; all mutants killed).
- Mutants: 5 injected, 5 killed, 0 survived.
- Gate 3 (client): author's synthetic harness 1/1 (`--workers=1` twice) and 38/40 in the full run (`--workers=2`; the 2 failures are the documented bleed/flaky classes, green isolated).

