# Validation — elevator-lobby (AD-011)

**Verdict: PASS**

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
