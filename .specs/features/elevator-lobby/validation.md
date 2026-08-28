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
