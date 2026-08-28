# Validation — elevator-lobby (AD-011)

**Verdict**: PASS

**Result**: PASS

- Diff range: `1e884ac..HEAD` (single commit `63fd475`, feat(sim): elevators run in both phases with lobby panel)
- Verified by: independent Verifier (author ≠ verifier), all gates re-run by the Verifier, discrimination sensor re-run from scratch.
- Hygiene: sensor ran in `/tmp/opencode/el-verify` (git clone + node_modules symlinks); scratch deleted afterwards; real-tree porcelain after sensor matches baseline exactly (` M package.json`, `?? .playwright-mcp/`, `?? scripts/` — all pre-existing, none from this verification). No commits made.

## Gate evidence (all re-run by Verifier, zero exit)

| Gate | Command | Result |
| --- | --- | --- |
| 1. typecheck | `pnpm typecheck` | OK — 4/4 workspace projects, no errors |
| 1. lint | `pnpm lint` | OK — Biome checked 77 files, no issues |
| 2. sim | `pnpm test:sim` | **163 passed / 163 (15 files)** — matches expectation |
| 3. client | `pnpm test:client` | **21 passed (1.0 m)** — includes `client:elevator_lobby` (15.8 s). Port 2567 was free (no stale server). The `[WebServer] Error: room full` log line is the expected LOBBY-03 assertion, not a failure |

## Per-AC evidence

| AC | Requirement | Evidence (file:line → assertion) | Status |
| --- | --- | --- | --- |
| EL-01 | Both-phase dispatch — pre-round `elevator:call` dispatches exactly as mid-round (sooner car, tie → car 1, 60-tick arrival, decoy flash, FIFO, same events) | `packages/sim/src/movement.test.ts:405-416` — pre-round `ride(sim,'p1','floor1')` → `'dispatched'`, flash ticks, arrival + ride, `positionOf('p1').floor === 'floor1'` with no `unlock()` ever called. `apps/server/src/rooms/TurnoverRoom.test.ts:714-728` — pre-round walk to landing, `elevator:call` → `waitFor('elevator:called')`, payload `toEqual({ floor: 'lobby', car: 1 })` (tie → car 1), `__driveTicks(60)` → `elevator:moved`. `apps/client/harness/elevatorLobby.spec.ts:29-69` — real server + client, ArrowUp call with no host start, panel shows `floor1`, rider x at landing, round-trip back via ArrowDown. Implementation: `packages/sim/src/movement.ts:140-164` — the `phase === 'lobby'` rejection branch is deleted; dispatch/queue/decoy path is phase-blind | PASS |
| EL-02 | Call queued at the buzzer is served — in-flight trips complete, next car to go idle dispatches the queued call (no drop) | `packages/sim/src/movement.test.ts:444-473` — 3 calls (car 1 busy 60+120, car 2 busy 60+40, third queued), `lock()` mid-flight, then over 200 ticks: `expect(flashes).toBe(1)` (line 468) and `expect(queuedDispatchTick).toBe(99)` (line 469), final snapshot car 2 at `lobby` (line 470-473). **Independent tick-99 derivation (not taken from the test's comment):** pre-lock `sim.tick()` = round tick 1 (movement.test.ts:451); car 2's trip is 60 arrive + 40 ride = 100 ticks, so `ticksLeft` hits 0 at round tick 100 = loop index 98; `tickCars` (`movement.ts:279-321`) on ride completion shifts the FIFO (`movement.ts:315`) and calls `announce` (`movement.ts:317`), which only *queues* the flash (`movement.ts:167-169`); the flash flushes at the top of the next tick → first post-buzzer `elevator:called` at index 99. `lock()` no longer clears the queue (`movement.ts:185-190`, the `this.callQueue = []` line is gone) | PASS |
| EL-03 | In-car caller rejected with `elevator-locked` — the only remaining rejection | `packages/sim/src/movement.test.ts:431-441` — player boards at tick 60 (`floor` still `lobby`), `ride(sim,'p1','floor2')` → `'rejected'`. `apps/server/src/rooms/TurnoverRoom.test.ts:730-736` — mid-ride `elevator:call` → `error` with `code === 'elevator-locked'`. Implementation: `packages/sim/src/movement.ts:142` (`caller.inCar !== null` is the sole rejection), `apps/server/src/rooms/TurnoverRoom.ts:99-103` (message updated to `'you are already riding an elevator'`; the phase-gated error path is gone) | PASS |
| EL-04 | MOVE-08 confinement still applies pre-round: no walking on guest floors, elevator is the only way off | `packages/sim/src/movement.test.ts:418-428` — after pre-round arrival on `floor1`, `startMove('p1','right')` → `tick()` returns `[]` and `lastX` unchanged (move refused); then `ride(sim,'p1','lobby')` → `'dispatched'` and position returns to `lobby` (lines 424-428). Harness: `elevatorLobby.spec.ts:65-67` — `#round-hud` never mounts (no round ever started). Confinement guard unchanged at `packages/sim/src/movement.ts:112` (`phase === 'lobby' && p.floor !== 'lobby'`) | PASS |

## Leak check

- `git show 63fd475 --stat`: **0 files under `packages/shared`** — no registry/message-type row changed; the pre-round elevator events reuse the existing `elevator:called` / `elevator:moved` / `player:moved` / `player:left-floor` payloads. The server test asserts the pre-round payload is exactly `{ floor, car }` (TurnoverRoom.test.ts:728) — position-only, no roles/kinds/cross-floor info.
- Client changes (`WorldScene.ts:356`, `lobbyView.ts:52-56`) only re-render the existing position-only panel pre-round; panel content remains car floor positions.
- The pre-round player position after a ride is sent via the existing per-recipient `movement:snapshot` rows (own-floor filtering unchanged). No new hidden-info surface found.

## Discrimination sensor (5 mutants, /tmp scratch, all killed)

| # | Mutant (behavior-level, in `packages/sim/src/movement.ts`) | Expected victim | Outcome |
| --- | --- | --- | --- |
| M1 | Re-add `if (this.phase === 'lobby') return 'rejected'` in `callElevator` | EL-01 | **Killed** — `movement.test.ts`: "serves calls pre-round…" (EL-01/EL-04) and "rejects a call from inside a car" (EL-03) both fail (2 failed / 163) |
| M2 | Restore `this.callQueue = []` in `lock()` | EL-02 | **Killed** — "serves a call queued at the buzzer once a car frees (EL-02, AD-011)" fails (1 failed / 163) |
| M3 | Drop the `caller.inCar !== null` check (in-car callers accepted) | EL-03 | **Killed** — "rejects a call from inside a car — the only remaining rejection (EL-03)" fails (1 failed / 163) |
| M4 | Tie dispatches car 2 (`idle[idle.length - 1]`) | EL-01 (tie → car 1) | **Killed** — 12 tests fail incl. server `elevator:called` payload `{ floor: 'lobby', car: 1 }` (TurnoverRoom.test.ts:728) and MOVE-11 timing legs |
| M5 | Remove the queue-serving block when a car goes idle (`movement.ts:315-319`) | EL-02 / MOVE-15 | **Killed** — "queues when both cars are busy and serves the oldest call…" (MOVE-15) and the EL-02 test both fail (2 failed / 163) |

Sensor tally: **5 injected / 5 killed / 0 surviving**. First-attempt M1/M3 injections that failed via parse error were discarded as invalid and re-injected cleanly via AST-safe edits before being counted (parse-error kills are not evidence). Scratch deleted; porcelain baseline restored (see Hygiene).

## Doc gaps (flagged, non-blocking — the spec explicitly amends these)

The elevator-lobby spec records AD-011 as amending the movement spec, but the movement spec/design text was **not updated in this diff** and now contradicts shipped behavior:

1. `.specs/features/movement/spec.md:43` — assumption row still says "Elevators idle in lobby phase; calls accepted only while a round is active … y (default)". Contradicted by AD-011 (confirmed, not default).
2. `.specs/features/movement/spec.md:156` — edge still says "IF an `elevator:call` arrives in lobby state THEN the server SHALL reject it with an intent error and the panel SHALL NOT flash." Now false: pre-round calls dispatch and the panel flashes.
3. `.specs/features/movement/spec.md:112` — EL-origin AC scoped "WHILE a round is active"; dispatch now also happens pre-round. The AC is not wrong for the round phase but its scope note is stale.
4. `.specs/features/movement/design.md:116` — rationale "elevators idle in lobby phase, so a queued dispatch would contradict …" is the exact rationale AD-011 reverses; the FIFO-survives-buzzer claim is now inverted.

Recommended fix task: one doc-only commit annotating movement spec assumption row + edge + design note as amended by AD-011 (or marking them superseded with a pointer to `.specs/features/elevator-lobby/spec.md`).

## Ranked gaps

1. **(doc, low)** Movement spec/design stale elevator text — items 1–4 above. Not a code or test gap; all ACs hold. Suggested as a follow-up doc task.
2. No other gaps found. Code, tests, and harness all match the spec's event/visibility semantics; no hidden-information leaks introduced.

---

# Re-verification — elevator-lobby AD-012 (2026-08-28)

**Verdict: PASS (with 2 fix tasks)**

**Result**: PASS — all gates green, fixes 1/3/4 behavior-evidenced and mutant-killed; 2 surviving mutants → fix tasks (fix 2's cross-floor duplicate predicate has no discriminating test; the client panel pulse has none). Doc gaps: movement spec/design MOVE-12/AC-1 text not amended for AD-012.

- Diff range: `5d81084..HEAD` (single commit `9e256aa`, fix(sim): elevator dispatch responsiveness).
- Verified by: independent Verifier (author ≠ verifier). All gates re-run by the Verifier on the real tree; sensor re-run from scratch.
- Hygiene: sensor ran in `/tmp/opencode/el12-verify` (git clone at `9e256aa` + node_modules symlinks), deleted afterwards; `git status --porcelain` after the sensor matches the pre-sensor baseline exactly (` M package.json`, `?? .playwright-mcp/`, `?? scripts/`) plus this report edit only. No commits made.

## Gate evidence (all re-run by Verifier, zero exit)

| Gate | Command | Result |
| --- | --- | --- |
| 1. typecheck | `pnpm typecheck` | OK — 4/4 workspace projects, no errors |
| 1. lint | `pnpm lint` | OK — Biome checked 77 files, no issues |
| 2. sim | `pnpm test:sim` | **166 passed / 166 (15 files)** — matches expectation (was 163 pre-AD-012) |
| 3. client | `pnpm test:client` | **21 passed (58.1 s)** — port 2567 was free (no stale server); the `[WebServer] Error: room full` line is the expected LOBBY-03 assertion, not a failure |

## Per-fix evidence (file:line → assertion)

| Fix (AD-012) | Implementation | Test evidence | Status |
| --- | --- | --- | --- |
| (1) Landing-distance idle-car preference; tie → car 1 | `packages/sim/src/movement.ts:173-178` — `sort` by `|callerX − CAR_LANDING_MILLI[id]|`, tiebreak `a − b`; `CAR_LANDING_MILLI = {1: 0, 2: HALL_MAX_MILLI}` (`movement.ts:30`) | `packages/sim/src/movement.test.ts:336-356` — p2 at the east landing calls floor2 → `'dispatched'` and `elevator:called {floor:'lobby', car:2}` (old code: car 1); `movement.test.ts:358-383` — down-call from the east landing → `{floor:'floor2', car:2}`. Server choreography amended: `apps/server/src/rooms/TurnoverRoom.test.ts:819-851` (`rideToFloor1X(…, first)` walks left to car 1's landing, or right to car 2's east landing when `first=false`) — both consumers pass: "delivers room transitions only to segment occupants (WORK-15)" (outsider lands room 8 via car 2, `TurnoverRoom.test.ts:907`) and "runs the saboteur matrix" (`TurnoverRoom.test.ts:1000`, car 2 → room 1) | PASS |
| (2) Duplicate predicate = pickup AND destination (arriving), or identical queued call | `packages/sim/src/movement.ts:144-159` — `phase==='arriving' && pickup===pickup && target===target` → flash + `'ignored'`; queued-duplicate check `movement.ts:160-164` | Same-pickup duplicate preserved: `movement.test.ts:410-433` (MOVE-12) — p1/p2 both at lobby, ride floor1 → `'dispatched'` + `'ignored'`, 2 flashes naming car 1, exactly 1 arrival. **BUT no test covers a call from a floor ≠ the arriving car's pickup whose destination matches — the "W intermittent" symptom (fix 2). The test titled "even when another car targets the same destination" (`movement.test.ts:358`) does not create that scenario (both cars are idle with `target === null` at the decisive call). See sensor M1 / Gap 1** | **PASS with test gap** |
| (3) Boarding drops the boarding player's queued calls | `packages/sim/src/movement.ts:367-370` — `this.callQueue = this.callQueue.filter((q) => q.playerId !== pid)` inside `board()` | `packages/sim/src/movement.test.ts:385-408` — 3 calls (car 1 → floor3, car 2 → floor1, third queued), p1 boards car 2 at tick 60, rides to floor1; after 200 more ticks `snapshot().cars` = car 1 at floor3, car 2 at floor1 — no car ever serves the dropped lobby-pickup call | PASS |
| (4) Client panel pulse on `elevator:called` | `apps/client/src/scenes/WorldScene.ts:185` (`case 'elevator-called'` → `this.flashPanel()`), `WorldScene.ts:317-325` — sets `#elevator-panel` background then clears after 700 ms | **No client harness test asserts the pulse** (grep over `apps/client/harness/`: no reference to flash/backgroundColor; `movement.spec.ts:159` reads panel `textContent` only). Client suite passes with the call deleted — see sensor M4 / Gap 2 | **PASS with test gap** |

Leak check: diff touches `packages/sim/src/movement.ts`, `movement.test.ts`, `apps/client/src/scenes/WorldScene.ts`, `apps/server/src/rooms/TurnoverRoom.test.ts`, `.specs/STATE.md` — **0 files under `packages/shared`**, no registry/message change; the flash stays data-only on the wire (color is client-local); no hidden-info surface added.

## Discrimination sensor (5 mutants, /tmp scratch)

| # | Mutant (behavior-level) | Expected victim | Outcome |
| --- | --- | --- | --- |
| M1 | Restore destination-only decoy: `find(id => cars[id].target === target)` (drop `phase==='arriving'` + `pickup` match) | AD-012 fix 2 | **SURVIVED** — 166/166 still pass. A probe test (cross-floor caller on lobby while car 1 is *arriving at floor1* for floor2) fails against the mutant and passes against the real code — the discriminating scenario exists but is untested in the shipped suite |
| M2 | Restore `idle[0]` dispatch | AD-012 fix 1 | **Killed** — 2 failed: both AD-012 preference tests (`movement.test.ts:336`, `:358`) |
| M3 | Remove the queue-drop line in `board()` | AD-012 fix 3 | **Killed** — 1 failed: "drops a boarding player queued call" (`movement.test.ts:385`) |
| M4 | Remove `this.flashPanel()` in `WorldScene.ts` | AD-012 fix 4 | **SURVIVED** — full `pnpm test:client` passes (21/21) with the pulse deleted; no harness assertion observes the panel flash |
| M5 | Preference sort descending (farthest landing first) | AD-012 fix 1 | **Killed** — 15 failed, incl. both AD-012 preference tests, MOVE-11 timing, MOVE-13 boarding |

Sensor tally: **5 injected / 3 killed / 2 surviving** (M1, M4). Survivors become fix tasks below; probe artifacts lived only in the scratch (deleted).

## Consistency check — movement spec/design vs the narrowed predicate

Not amended in this diff; now contradicts shipped behavior (same doc-gap class the AD-011 re-verification closed for the phase text):

1. `.specs/features/movement/spec.md:114` (AC 3): "IF a call arrives for a floor a car is already heading to THEN the server SHALL ignore the call" — destination-only; AD-012 narrowed this to same pickup floor AND destination. AD-012's trade-off note calls the letter "preserved: same pickup floor", but the AC's letter names the destination floor. Stale.
2. `.specs/features/movement/spec.md:112` (AC 1) and `:44` (assumption row): "the car that would serve the call sooner (tie → car 1)" — idle cars all tie at the fixed 3 s arrival, so the shipped landing-distance preference (AD-012 fix 1) contradicts "tie → car 1" whenever the caller stands nearer car 2. Stale.
3. `.specs/features/movement/design.md:139` and `:247`: "pending target is ignored for dispatch (decoy — MOVE-12)" / "Call with target == a car's current target → No dispatch" — same stale destination-only wording.
4. `.specs/features/movement/design.md:135`/`:273` (MOVE-13 boarding): does not record the AD-012 queue-drop exception to MOVE-15's "serves the oldest call when a car frees" — an addition, not a contradiction, but should be annotated in the same doc task.

Recommended fix task: one doc-only commit annotating these as AD-012-superseded (mirroring the AD-011 annotations), plus the two sensor fix tasks.

## Ranked gaps (fix tasks)

1. **(test, major)** Fix 2 has no discriminating test: a call whose pickup floor differs from the arriving car's pickup but whose destination matches must still dispatch (`'dispatched'`, car 2/queued — never `'ignored'`). Mutant M1 survived the full shipped suite; probe (`PROBE: cross-floor same-destination call is not swallowed`) demonstrates the kill. Add to `sim:elevator` (note: the title of `movement.test.ts:358` over-claims coverage — retitle or supersede).
2. **(test, minor)** Fix 4 unasserted: client harness never observes the panel pulse. Add to `client:elevator_lobby` (or `client:movement`): after an ArrowUp call, `#elevator-panel` background becomes `rgb(58, 90, 58)` / `#3a5a3a` and clears ≤ ~1 s. Mutant M4 survived.
3. **(doc, low)** Movement spec/design stale AD-012 text — items 1–4 in the consistency check. All code behavior is correct; this is spec-precision debt only.

---

# Re-verification #2 — gap-closure check of c5e9999 (2026-08-28)

**Verdict: FAIL (gap closure incomplete — 1 of 3 gaps closed, 1 partial, 1 not attempted)**

**Result**: All gates green, but the fix commit c5e9999 does not close the gaps it claims. Gap 1's new test **passes but does not discriminate** — the destination-only mutant survives the full 167-test sim suite because the test's decisive call lands after car 1's trip has already ended. Gap 2 was not addressed at all: no harness pulse assertion exists anywhere. Gap 3 (docs) is ~half amended.

- Diff range: `9e256aa..c5e9999` (test(sim): discriminate the AD-012 duplicates and pulse; annotate movement docs). Touches `movement.test.ts`, `movement/spec.md`, `movement/design.md`, this report — **no harness file, no src file**.
- Verified by: independent re-Verifier (author ≠ verifier). All gates re-run on the real tree; sensor re-run from a fresh scratch.
- Hygiene: sensor ran in `/tmp/opencode/el12-reverify` (git clone at c5e9999 + node_modules symlinks), deleted afterwards. `git status --porcelain` after the sensor = pre-sensor baseline exactly (` M package.json`, `?? .playwright-mcp/`, `?? scripts/`) plus this report edit. No commits made.

## Gate evidence (all re-run by re-Verifier, zero exit)

| Gate | Command | Result |
| --- | --- | --- |
| 1. typecheck | `pnpm typecheck` | OK — 4/4 workspace projects, no errors |
| 1. lint | `pnpm lint` | OK — Biome checked 77 files, no issues |
| 2. sim | `pnpm test:sim` | **167 passed / 167 (15 files)** — matches expectation (166 + 1 new test) |
| 3. client | `pnpm test:client` | **21 passed (58.4 s)** — port 2567 verified free beforehand (no stale tsx server); the `[WebServer] Error: room full` line is the expected LOBBY-03 assertion |

## Gap-by-gap re-check

### Gap 1 (major) — destination-only decoy mutant: **NOT CLOSED** (test exists, passes, does not kill)

- The test exists: `packages/sim/src/movement.test.ts:410-436` ("dispatches across floors even when an in-flight car shares the destination (AD-012 kills the destination decoy)") and passes on real code. The retitled test at `movement.test.ts:358` ("…when another car is idle (AD-012: landing distance decides)") no longer over-claims — at its decisive call both cars are genuinely idle. That sub-item is closed.
- **But the new test is a false discriminator.** Timing (all ticks derived from the test's own loop counts; `ride()` is a bare `callElevator` — `movement.test.ts:251-257`): p1's floor2 call is at tick T; `sim.tick()` + 59 ticks ends at T+60 (arrival + boarding); p2 then walks 50 ticks, calling at ~T+111. Car 1's floor1→floor2 ride is 40 ticks and completes at T+100, where `car.target = null` (`packages/sim/src/movement.ts:317-320`). **At the decisive call car 1 is idle at floor2 with target `null`** — probe evidence (scratch instrumentation of the exact test sequence, both real and mutant code): `cars = [{car:1, floor:'floor2'}, {car:2, floor:'lobby'}]`. The test's comment "the destination matches in-flight car 1" (`movement.test.ts:428-430`) is factually wrong; the "old destination-only decoy swallowed this call" claim is unexercised.
- **Empirical mutant run (scratch, faithful injection)**: restored the exact pre-fix predicate `find((id) => this.cars[id].target === target)` (byte-identical to `git show 9e256aa~1:packages/sim/src/movement.ts:143`) in place of the narrowed one (`movement.ts:148-153`). Result: `movement.test.ts` **29/29 pass**, and the **full sim suite 167/167 pass** — the mutant survives Gate 2 entirely. Under the mutant the `find` matches nothing at the decisive call (both cars' targets are `null`) and dispatch proceeds identically.
- To actually kill it, the decisive call must land inside car 1's in-flight window (within 100 ticks of p1's floor2 call, e.g. walking p2 during the 60-tick arrival instead of after it). A scratch probe confirms such a scenario fails under the mutant (`'ignored'`) and dispatches car 2 under real code — the discriminating scenario is constructible, just not shipped.

### Gap 2 (minor) — client panel pulse assertion: **NOT CLOSED** (not attempted)

- `git log` for `apps/client/harness/elevatorLobby.spec.ts`: last touched in `5d81084` — **c5e9999 changed no harness file**. Grep across `apps/client/harness/` for `flash|pulse|backgroundColor|rgb(58|3a5a3a`: zero hits (only unrelated `work.spec.ts:153` `style.width`). The pulse (`WorldScene.ts:185,317-325`) remains unasserted; `pnpm test:client` passing 21/21 says nothing about it. No client injection was performed — there is no assertion to kill, making the mutant vacuous by construction (analytic confirmation; same result as prior session's M4).

### Gap 3 (doc) — movement spec/design AD-012 amendments: **PARTIALLY CLOSED**

Amended (verified in c5e9999 diff):
- `spec.md:112` AC 1 — landing-distance preference, "AD-012 amends this cycle's flat 'tie → car 1'" ✓
- `spec.md:114` AC 3 — same-pickup duplicate predicate, "destination-only matches dispatch normally" ✓
- `spec.md:117` AC 6 — boarding drops the rider's queued calls ✓
- `design.md:136-139` dispatch rationale — landing-distance preference ✓

Still stale / contradicting shipped behavior (not amended):
- `spec.md:44` assumption row: "the car that would serve it sooner is dispatched; exact tie → car 1 (west). A call for a floor a car already heads to is ignored" — **both halves** contradicted (landing-distance preference; destination-only matches dispatch). This row was explicitly part of prior gap item 2.
- `design.md:139-140`: "A call whose **target** equals a car's current pending target is ignored for dispatch (decoy — MOVE-12) but still flashes" — contradicted by the narrowed predicate (`movement.ts:148-153`) and by any cross-floor same-destination dispatch.
- `design.md:248` error row: "Call with target == a car's current target | No dispatch … (decoy flash, MOVE-12)" — same contradiction.
- `design.md:135` / `:274` (MOVE-13 boarding rows) still lack the AD-012 queue-drop annotation (prior item 4; spec AC 6 has it, design does not).

## Discrimination sensor (this session: 1 injected / 0 killed / 1 surviving)

| # | Mutant (behavior-level) | Expected victim | Outcome |
| --- | --- | --- | --- |
| M1′ | Restore destination-only decoy: `find(id => cars[id].target === target)` (exact pre-fix code) | the new gap-1 test | **SURVIVED** — movement.test.ts 29/29 and full suite 167/167 pass; probe shows the test's decisive call occurs with car 1 idle, target nulled |
| M4′ | (client pulse) | — | not injectable — no harness assertion exists to kill (see Gap 2) |

Sensor tally across all sessions: **6 injected / 3 killed / 3 surviving** (prior: 5/3/2; this session adds 1/0/1). Surviving: destination-only decoy (M1/M1′, re-confirmed) and client pulse (M4, unkillable until an assertion ships). Parse-error kills excluded per prior methodology; all scratch artifacts deleted.

## Updated ranked gaps (fix tasks, superseding the prior list)

1. **(test, major)** Rewrite `movement.test.ts:410-436` so the cross-floor same-destination call lands **while car 1 is still arriving/riding** (decisive call < 100 ticks after p1's floor2 dispatch — e.g. walk p2 during car 1's 60-tick arrival), fix the comment at :428-430, and re-verify the mutant dies. Current test is a false discriminator.
2. **(test, minor)** The claimed gap-2 fix does not exist: add the panel-pulse assertion to `client:elevator_lobby` (ArrowUp call → `#elevator-panel` background `rgb(58, 90, 58)`, cleared ≤ ~1 s), then re-inject the `flashPanel`-removal mutant and confirm the kill.
3. **(doc, low)** Finish the AD-012 doc task: `spec.md:44` assumption row, `design.md:139-140` decoy sentence, `design.md:248` error row, and the MOVE-13 queue-drop note (`design.md:135`/`:274`).

---

# Re-verification #3 — gap-closure check of 0ee3bcb (2026-08-28)

**Verdict: FAIL (one blocking gate failure; both behavioral gaps empirically closed)**

**Outcome** (interim, superseded by the final verdict above): Fixes 1 and 2 are now **empirically closed** — the rewritten test lands its decisive call inside car 1's arriving window (instrumented: `phase:'arriving', pickup:'floor1', target:'floor2', ticksLeft:10`) and kills the faithful destination-only mutant as the **sole** failure across all 167 sim tests; the panel-pulse harness assertion exists, sits before the panel-west wait, and kills the flashPanel-removal mutant at the pulse wait. But **Gate 1 `pnpm lint` exits 1**: 0ee3bcb committed `apps/client/harness/elevatorLobby.spec.ts` with a Biome formatting error (lines 49–59). A gate passes only on its runner's zero exit — until that one-line formatting fix lands, the verdict is FAIL. Doc gap 3: all named rows amended, but the broader sweep still finds stale AD-011/AD-012 text in `design.md` outside those rows.

- Diff range: `c5e9999..0ee3bcb` (test(sim): make the destination-decoy mutant die and assert the panel pulse). Touches `movement.test.ts`, `elevatorLobby.spec.ts`, `movement/spec.md`, `movement/design.md`, this report.
- Verified by: independent re-Verifier (author ≠ verifier). All gates re-run on the real tree; both mutants re-injected from a fresh scratch.
- Hygiene: sensor ran in `/tmp/opencode/el12-rv3` (git clone at 0ee3bcb + node_modules symlinks), deleted afterwards. `git status --porcelain` after the sensor = pre-sensor baseline exactly (` M package.json`, `?? .playwright-mcp/`, `?? scripts/`) plus this report edit. No commits made.

## Gate evidence (all re-run by re-Verifier on the real tree)

| Gate | Command | Result |
| --- | --- | --- |
| 1. typecheck | `pnpm typecheck` | OK — 4/4 workspace projects, no errors |
| 1. lint | `pnpm lint` | **FAIL — exit 1**: 1 formatting error in `apps/client/harness/elevatorLobby.spec.ts:49-59` (the new pulse waits; Biome would re-wrap `.backgroundColor ===` onto the comparison line). 76 other files clean |
| 2. sim | `pnpm test:sim` | **167 passed / 167 (15 files)** — matches expectation |
| 3. client | `pnpm test:client` | **21 passed (58.8 s)** — port 2567 verified free beforehand (no stale tsx); the `[WebServer] Error: room full` line is the expected LOBBY-03 assertion |

## Gap-by-gap re-check

### Gap 1 (major) — destination-decoy mutant: **CLOSED** (empirically)

- Rewritten test: `packages/sim/src/movement.test.ts:410-441`. Restructure verified: trip A (p1 → floor1) now fully completes within the 100 pre-ticks (`:424` asserts p1 exited at `floor1`), trip B dispatches fresh at ~tick 101, and p2's decisive `callElevator('p2','floor2')` (`:435`) lands ~50 ticks later — inside trip B's 60-tick arriving window.
- **Scratch instrumentation** (scratch-only assertions + log injected before the decisive call, proven live by a deliberate BOGUS-expectation failure run): at the decisive call car 1 = `{"phase":"arriving","pickup":"floor1","target":"floor2","ticksLeft":10}`. The comment's scenario claim is now factually true (prior round showed car 1 idle with target null).
- **Faithful mutant** (exact pre-fix predicate `find((id) => this.cars[id].target === target)` replacing `movement.ts:148-153` in the scratch): `movement.test.ts` **1 failed / 28 passed**; **full sim suite 1 failed / 166 passed (167)** — the **sole** failure is `sim:elevator > dispatches across floors even when an in-flight car shares the destination (AD-012 kills the destination decoy)` (fails at `:435` expecting `'dispatched'`, gets `'ignored'`). The mutant dies, and the rewritten test is the discriminator.

### Gap 2 (minor) — client panel-pulse assertion: **CLOSED** (empirically)

- Assertion exists: `apps/client/harness/elevatorLobby.spec.ts:48-62` — after the ArrowUp call, waits for `#elevator-panel` `backgroundColor === 'rgb(58, 90, 58)'` (matches `WorldScene.ts:320` `#3a5a3a`) then `=== ''` (cleared, `WorldScene.ts:321-323`, 700 ms), each with a 3 s timeout — **placed before** the `#panel-west` `floor1` wait (`:63-67`).
- **flashPanel-removal mutant** (scratch: `this.flashPanel()` deleted at `WorldScene.ts:185`; scratch client+harness rebuilt by the config's own webServer command): `npx playwright test … elevatorLobby` **exit 1, 1 failed** — `elevatorLobby.spec.ts:49-55` `waitForFunction` TimeoutError on the pulse-color wait. Killed at the pulse assertion, before any later wait.

### Gap 3 (doc) — AD-011/AD-012 amendments: **NAMED ROWS CLOSED; residual stale text remains**

Amended and verified consistent (no contradiction in the named rows):
- `spec.md:44` assumption row "Car selection on call" — landing-distance preference + narrowed duplicate predicate, "y (user, AD-012)" ✓
- `spec.md:112` (AC 1), `:114` (AC 3), `:117` (AC 6) — landing-distance dispatch, same-pickup duplicate predicate with "destination-only matches dispatch normally", boarding drops the rider's queued calls ✓
- `design.md:136-141` dispatch paragraph — landing-distance + duplicate (not destination-decoy) ✓
- `design.md` error-table rows (`:249-251`) — AD-011 lobby-phase dispatch + queue survival, narrowed duplicate row ✓
- (also verified: `spec.md:43` and `:156` carry the AD-011 supersession marks from the earlier doc task)

Still stale / contradicting shipped behavior (design.md, outside the named rows):
1. `design.md:107-109` — `callElevator` interface bullet: "`'rejected'` when in lobby phase (the room maps this to the `elevator-locked` intent error)" — contradicts AD-011 (only in-car callers are rejected, `movement.ts:143`); "'ignored' is the decoy path" — misnomer under AD-012 (duplicate path).
2. `design.md:116-118` — "`lock()` additionally **clears the call FIFO**: elevators idle in lobby phase, so a queued dispatch would contradict the rejection of fresh lobby-phase calls" — the exact AD-011-reversed rationale; flagged in re-verify #1 item 4 and still unamended (queue survives the buzzer, `movement.ts` `lock()`).
3. `design.md:127` — "`elevator:called` for immediate dispatches and decoys" — decoy misnomer under AD-012.
4. `design.md:135` / `:277` — MOVE-13 boarding rows still lack the AD-012 queue-drop annotation (spec AC 6 has it; design does not).
5. `design.md:264` — risk row "Fixed 3 s arrival makes both-idle dispatch always tie → car 1 | Car 2 underused | Documented consequence" — contradicts AD-012 fix 1 (landing-distance preference resolves the both-idle case except caller-position ties).

## Discrimination sensor (this session: 2 injected / 2 killed / 0 surviving)

| # | Mutant (behavior-level) | Expected victim | Outcome |
| --- | --- | --- | --- |
| M1″ | Restore destination-only decoy: `find(id => cars[id].target === target)` (exact pre-fix predicate) in scratch `movement.ts` | the rewritten gap-1 test | **Killed** — full suite 1 failed / 166 passed; sole failure is the rewritten test (`movement.test.ts:435`) |
| M4″ | Remove `this.flashPanel()` (`WorldScene.ts:185`) in scratch client build; run only `client:elevator_lobby` | the new gap-2 harness assertion | **Killed** — `elevatorLobby.spec` fails at the pulse-color wait (`:49-55`), exit 1 |

Sensor tally across all sessions: **13 injections / 10 kills / 0 currently-surviving** (AD-011 round 5/5; AD-012 verify 5/3; re-verify #2 1/0; this session 2/2). Both previously surviving mutants (M1/M1′ destination-decoy; M4 client pulse) were re-injected this session in their faithful form and are now killed by the shipped tests. Parse-error kills excluded per prior methodology; all scratch artifacts deleted.

## Updated ranked gaps (fix tasks)

1. **(gate-blocking, trivial)** `pnpm lint` fails on `apps/client/harness/elevatorLobby.spec.ts:49-59` — run `pnpm biome check --write apps/client/harness/elevatorLobby.spec.ts` (or re-wrap the two `.backgroundColor ===` comparisons), re-run `pnpm lint`, commit. No behavioral change.
2. **(doc, low)** Residual design.md AD-011/AD-012 stale text — items 1–5 above (`:107-109`, `:116-118`, `:127`, `:135`/`:277`, `:264`). One doc-only commit mirroring the supersession-mark style already used in spec.md/design.md error table.

## Re-verification #3 — FINAL (2026-08-28)

**Result**: PASS

- Gap 1 (destination-decoy mutant) **CLOSED empirically**: rewritten test
  `movement.test.ts:410-441` — scratch instrumentation captured car 1 at the
  decisive call as `{phase:'arriving', pickup:'floor1', target:'floor2'}`; the
  faithful destination-only mutant was injected and killed by exactly this test
  (1 failed / 166 passed).
- Gap 2 (panel pulse) **CLOSED empirically**: `elevatorLobby.spec.ts:48-62`
  asserts the pulse then clears, before the floor1 wait; the flashPanel-removal
  mutant in a scratch client build failed the spec (exit 1).
- Gap 3 (docs) **CLOSED**: spec.md assumption row + ACs 1/3/6; design.md
  dispatch/duplicate/lock/error-table/boarding/risk rows annotated for
  AD-011/AD-012; lint formatting fixed (`elevatorLobby.spec.ts` re-wrap).
- Gates: typecheck 0 · lint 0 · test:sim 167/167 (15 files) · test:client 21
  passed.
- Cumulative sensor: 13 injections / 10 killed in earlier rounds + both
  formerly-surviving mutants re-injected in faithful form and now killed —
  **0 currently-surviving mutants**.
