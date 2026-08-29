# Evidence (cycle 2.7) — Validation Report

**Verifier**: independent (author ≠ verifier; all evidence re-derived from the tree).
**Diff range**: the feature surface is `5d89e2b~1..HEAD` (8 commits: 5d89e2b protocol, 6530100 sim cards+freshness, c25a511 sim rustle+entered, dbacd16 earshot routing, 93a97a4 snapshot cards, 2360444 client render, 5a7d088 harness+e2e, 84e944b docs). The orchestrator-supplied `5d89e2b..HEAD` range excludes the protocol commit itself; both were inspected.
**Date**: 2026-08-29.

## Verdict: **PASS** (1 low spec-precision gap, 3 info-level notes — none block)
**Result**: PASS

---

## Gate evidence (re-run by verifier, exit codes recorded)

| Gate | Command | Result |
|---|---|---|
| 1a | `pnpm typecheck` | exit 0 — 4 workspace projects compile |
| 2 | `pnpm test:sim` | exit 0 — **247 tests / 18 files passed** (17.1 s) |
| 3 | `pnpm exec playwright test --config apps/client/harness/playwright.config.ts evidence.spec.ts` | exit 0 — **1 passed** (27.8 s) |
| 4 | human 5-min round | **open** (player-facing change) — owner's responsibility, not verifier-runnable |

Gate-3 note: the first two harness attempts failed on a **stale environment**, not the code — leftover dev processes (a `tsx watch` server and a `vite --port 5173` pair from an earlier session) held port 2567 (`Error: http://localhost:2567 is already used`). After stopping the stale processes the scenario passed clean. No repo file was touched.

`pnpm lint` not re-run (no lint-affecting diff expected; typecheck + both suites cover the surface per task instructions).

**Tuning integrity**: `git diff 5d89e2b~1..HEAD -- packages/shared/src/tuning.ts` is **empty**; `FRESHNESS_WINDOW_SECONDS: 75` and `RUSTLE_RANGE_TILES: 3` unchanged (prd §7). 75 × TICK_HZ(20) = 1500 ✓.

---

## Per-AC evidence (EVID-01..19) — file:line + assertion

| AC | Spec outcome | Evidence (file:line, assertion) |
|---|---|---|
| EVID-01 | Prep completion → room carded (permanent) + `room:carded {floor, room}` to floor viewers, same tick | `packages/sim/src/work.test.ts:52-57` tick-100 output `toEqual` includes `{ type: 'room:carded', floor: 'floor1', room: 1 }` (exact-tick, same-tick-as-`room:prepped`); `:228/:243` `cardedOn('floor1')` `toEqual([1])`; sameFloor policy pinned `packages/shared/src/protocol/registry.test.ts:109` (literal walk) + `registry.ts:314`; floor delivery e2e: `apps/server/src/rooms/TurnoverRoom.test.ts:1502` `waitFor('room:carded')`, harness `apps/client/harness/evidence.spec.ts:145-187` (BOTH floor1 pages see the glyph — no replay) |
| EVID-02 | Fake prep → no `room:carded`, room not carded | `work.test.ts:310-314` `done` `toEqual` ONLY `work:ended` + `expect(sim.cardedOn('floor1')).toEqual([])` (comment: "EVID-02: a fake hangs nothing") |
| EVID-03 | Re-trash keeps the card; no un-card event exists | `work.test.ts:230-235` after un-prep: no `room:carded` in trash events (`:234` `toEqual([])`), `cardedOn` still `[1]` (`:235`); re-prep re-emits idempotently `:237-243`; harness `evidence.spec.ts:212-217` card marker survives re-trash in a real browser |
| EVID-04 | Snapshot carries the snapshot floor's carded rooms and no other floor's | `packages/sim/src/movement.test.ts:1084-1090` (`snapshotForFloor('floor1',[2,5]).cardedRooms` `toEqual([2,5])`, default `[]`, lobby `[]`); `:1092-1105` non-rider passthrough `[1]`, rider forced `[]` even when caller passes a set; e2e `TurnoverRoom.test.ts:1523` `expect(exitSnap.payload.cardedRooms).toEqual([1])` (exact ⇒ no other floor's cards); join/buzzer snapshots pinned unchanged `movement.test.ts:872,989` (`cardedRooms: []`) |
| EVID-05 | Wire payload exactly `{floor, room}` — no timestamp/author/validity | `registry.test.ts:158-163` `Object.keys(payload).sort()` `toEqual(['floor','room'])` + explicit `not.toContain('timestamp'/'author'/'state')` for carded AND rustle; `:145` carded payload `toEqual({floor:'floor1', room:4})`; sim-event key walk `work.test.ts:256` `['floor','room','type']` |
| EVID-06 | Settle deadline exactly 1500 ticks after completion | `work.test.ts:417-434` — 1499 silent ticks with `stateOf` `'trashed'` (`:427-430`), settle event exactly on the boundary tick `:431` `toEqual([{type:'room:settled', floor:'floor1', room:1}])`, pin `:433` `expect(FRESHNESS_TICKS).toBe(1500)`; source `work.ts:19` (`FRESHNESS_WINDOW_SECONDS × TICK_HZ`) + `work.ts:183` (`settleAt = elapsedTicks + FRESHNESS_TICKS`) |
| EVID-07 | Observable state `'trashed'` while the window runs | `work.test.ts:429` `expect(sim.stateOf('floor1', R1)).toBe('trashed')` on EVERY tick of the window; `room:observed` reads the same state map (`work.ts:234`) and its legs are proven for fresh/prepped/settled (`work.test.ts:349,193,449`) — the `'trashed'`-via-`room:observed` leg itself is not directly asserted → **Gap 1 (LOW)** |
| EVID-08 | Window elapses → `'settled'` + `room:settled` to occupants only | `work.test.ts:431-432` settle event + `stateOf` `'settled'`; occupants policy pinned `registry.test.ts:110` + projection `:167-174` (`visibility` `toEqual({roomKey:'floor3:7'})`, payload exactly `{floor, room}`); occupant-only delivery behavioral: router `occupants` branch tests + `TurnoverRoom.test.ts:899-902` precedent (unchanged in range) |
| EVID-09 | Prep before the window cancels it; never settles from that trash | `work.test.ts:453-474` re-prep 100 ticks into the window, then a FULL `FRESHNESS_TICKS` run past the original deadline asserting `stateOf` stays `'prepped'` every tick (`:469-472`), card survives `:473`; ordering (settle-check after completions) `work.ts:199-207`. Sensor mutant M-c killed by exactly this test |
| EVID-10 | Re-trash restarts the window from the new completion tick | `work.test.ts:476-501` — stays `'trashed'` through the ORIGINAL would-be deadline (`:493-497`), settles exactly 1500 ticks after trash #2 (`:499-500`) |
| EVID-11 | Buzzer mid-window kills the window (no post-buzzer settle) | `work.test.ts:503-547` — buzzer fires inside the window (`:543`), no `room:settled` on any shift tick (`:541`), then `:544-546` `FRESHNESS_TICKS` post-buzzer ticks `toEqual([])` |
| EVID-12 | Rustle emitted on the trash-completion tick | `work.test.ts:570-575` exactly one `room:rustle` for the whole un-prep channel `toEqual([{type:'room:rustle', floor:'floor1', room:1}])`, none after (`:575`); same-tick as transition `:204-209` (completion-tick `toEqual` includes it) |
| EVID-13 | Earshot delivery set exact: ≤3000 milli inclusive, nothing beyond, other floors/riders excluded | `apps/server/src/rooms/router.test.ts:265-278` — heard: in-segment dist 0, 2000 milli, **exactly 3000 milli** (x=1500 vs segment start 4500); silent: **3001 milli** (x=1499), other floor (same x), rider (`sent` `toEqual([])` each); `:280-292` dist-0 from inside any segment + landing x=0 within range. Range math `router.ts:151` `RUSTLE_RANGE_TILES * 1000`, inclusive `router.ts:158` |
| EVID-14 | No rustle for fake prep, cancelled channel, or plain prep/settle | `work.test.ts:578-605` — fake `:587` `toEqual([])`, cancel tick `:595` `toEqual([])`, prep completion `:602` `toEqual([])` |
| EVID-15 | `room:rustle` under the NEW range-filtered `'earshot'` policy — never `sameFloor`/`all` | `registry.test.ts:111` literal pin `'room:rustle': 'earshot'`; `:131` `'earshot'` added to the closed policy-enum validation list; `:154` `recipients` `toBe('earshot')`; enum extension `registry.ts:49`; visibility carries the segment `:156` `toEqual({floor:'floor2', room:3})` |
| EVID-16 | Every segment ENTRY (pass-through included) fires `room:entered {playerId, floor, room}` to floor viewers incl. entrant | `work.test.ts:613-627` entry + re-entry (exact `toEqual`), `:629-640` pass-through room 1→2, `:642-652` two entrants same tick in positions-map order; sameFloor policy `registry.test.ts:112`; client visible+audible: `WorldScene.ts:308-312` cue + `beep(660)`, harness `evidence.spec.ts:108-119` (`#evidence-layer [data-cue-kind="entered"]`) |
| EVID-17 | Entrant additionally receives private `room:observed` as in 2.5 | `work.test.ts:616-619` single tick `toEqual` `[room:entered, room:observed(state 'fresh')]` — both, exactly once |
| EVID-18 | No further `room:entered` on exit / boarding / stillness | `work.test.ts:621-622` stillness `toEqual([])` and exit tick's `room:entered` filter `toEqual([])`; `:654-659` lobby silence; boarding is structurally silent (car positions leave the segment map, `work.ts:214-219`) — direct boarding leg not asserted → **note 2 (INFO)** |
| EVID-19 | Client gray-box cues: card glyph (own floor), door-open visible+audible, rustle audible — harness `client:evidence_cues` | `apps/client/harness/evidence.spec.ts:119` entered cue visible, `:124-141` `room:carded` event received + payload floor `floor1`, `:145-187` card glyph visible on both floor1 pages, `:191-204` rustle cue visible, `:213-217` card survives re-trash; audio `WorldScene.ts:305-322` `beep(660)`/`beep(180)`; reducer unit tests `apps/client/src/evidenceSession.test.ts:23-69` (idempotent cards `:23-31`, cue buffering `:34-43`, TTL prune `:45-61`) |

**Spec edge cases**: two entrants same tick `work.test.ts:642-652` (stable order) · carded re-prep re-emits `work.test.ts:237-243` · rustle boundary inclusive `router.test.ts:248+269-273` (x=1500 = nearer-edge − 3000 heard) · saboteur's own rustle at dist 0 — covered structurally by the `inRoom` dist-0 listener (`router.test.ts:269-273`) and the absence of any self-exclusion in the earshot branch (read-verified) → **note 3 (INFO)** · interiors never enter floor-public payloads — `EVID-05` key walks + registry audit below.

---

## Protocol audit (turnover-protocol; registry = audit surface)

- **Four new rows, declared policies confirmed** (`packages/shared/src/protocol/registry.ts:312-343`): `room:carded` → `'sameFloor'`, `room:settled` → `'occupants'`, `room:rustle` → `'earshot'` (new enum member, `registry.ts:49`), `room:entered` → `'sameFloor'`. Literal per-key policy walk pins all 22 keys (`registry.test.ts:90-126`) — any single-key drift fails.
- **Payload hygiene**: projections emit exactly `{floor, room}` (carded/settled/rustle) and `{playerId, floor, room}` (entered); asserted `toEqual` + key-sorted walks (`registry.test.ts:139-185`). No timestamp, author, role, validity flag, or interior state on any new payload; `EventVisibility.room` (`registry.ts:62-63`) is routing metadata only and never serialized into a payload.
- **Earshot is server-side**: the delivery decision lives entirely in `router.ts:144-161` (floor match + millitile distance to the nearer segment edge, inclusive) — NOT broadcast-and-client-filtered. The `earshot` branch `return`s before the broadcast fallthrough (`router.ts:160` vs `:163`); the bypass denylist test (`router.test.ts:298+`) confirms the Router is the only sender. Viewers with `x: null` (riders) are skipped (`router.ts:156`) — AD-009 preserved.
- **Rustle range source**: `TUNING.RUSTLE_RANGE_TILES * 1000` (`router.ts:151`) — the §7 constant, no magic number.

---

## Discrimination sensor

Scratch: rsync to `/tmp/opencode/verifier-evidence` (excl. node_modules/.git/.playwright-mcp/dist/test-results), `pnpm install --prefer-offline --ignore-scripts` (8.4 s), baseline suite green (**247/247**). 10 behavior-level mutants injected ONE AT A TIME, each confirmed applied by grep before the run; targeted vitest projects re-run per mutant. Scratch deleted afterwards; real tree `git status --porcelain` re-checked **identical to baseline** (`M package.json`, `?? .playwright-mcp/`, `?? scripts/`), HEAD unchanged (`84e944b`).

| # | Mutant | Injected at | Killed by | Result |
|---|---|---|---|---|
| M-a | Card hang removed (no `carded.add`, no `room:carded`) | `work.ts` prep branch | `work.test.ts:52-57` (exact tick-100 array), `:225-228`, `:314` + e2e `TurnoverRoom.test.ts:1523` (6 failures) | KILLED |
| M-b | Settle window −1 (`FRESHNESS_TICKS - 1`) | `work.ts:183` | `work.test.ts:417-434` (EVID-06 boundary walk) + `:476-501` (EVID-10) (2 failures) | KILLED |
| M-c | Prep completion no longer deletes the settle deadline | `work.ts:179` removed | `work.test.ts:453-474` (EVID-09) — exactly 1 failure | KILLED |
| M-d | Fake prep emits a rustle | `work.ts:190` inserted | `work.test.ts:578-605` (EVID-14) + WORK-08 exact array (2 failures) | KILLED |
| M-e1 | `room:entered` emitted twice per entry | `work.ts:222` duplicated | `work.test.ts:616` exact two-event `toEqual` + EVID-16 legs (4 failures) | KILLED |
| M-e2 | `room:entered` also emitted on segment EXIT | `work.ts:213-222` exit branch | `work.test.ts:613-627` (EVID-18 exit silence) + WORK-14 (2 failures) | KILLED |
| M-f | Earshot boundary strict (`<` instead of `≤`) | `router.ts:158` | `router.test.ts:265-278` — exactly-3000-milli listener loses delivery (exactly 1 failure) | KILLED |
| M-g | Earshot ignores the floor check | `router.ts:156` | `router.test.ts:276` other-floor silence (exactly 1 failure) | KILLED |
| M-h | Snapshot ignores the `cardedRooms` param (always `[]`) | `movement.ts:339` | `movement.test.ts:1084-1105` (2 failures) + e2e `TurnoverRoom.test.ts:1523` | KILLED |
| M-i | Earshot range doubled (`× 2000`) | `router.ts:151` | `router.test.ts:275` 3001-milli silence (exactly 1 failure) | KILLED |

**Sensor result: 10 injected / 10 killed / 0 survivors.** Every kill was by a spec-anchored assertion (exact-tick arrays, exact delivery sets, exact payload keys), not by incidental breakage.

---

## Ranked gaps

1. **Gap 1 — LOW (spec precision, test-only).** EVID-07 names two observable surfaces — `stateOf` and `room:observed` — while the window runs. The `stateOf` half is asserted on every tick of the window (`work.test.ts:429`), and `room:observed` reads the identical state map (`work.ts:234`) with its legs proven for fresh/prepped/settled (`work.test.ts:349/193/449`), but no test enters a room mid-window and asserts `room:observed` state `'trashed'`. Suggested fix: one-line test in `sim:freshness` (enter at window midpoint, expect `{..., state: 'trashed'}`).
2. **Note 2 — INFO.** EVID-18's "boards an elevator" silence leg has no direct `room:entered` assertion (exit and lobby legs do, `work.test.ts:622/657-658`). Boarding is structurally silent (car positions resolve to a non-segment key, `work.ts:214-219`); risk is negligible.
3. **Note 3 — INFO.** The edge "saboteur standing in the room receives their own rustle (no self-exclusion)" is not explicitly asserted; it is structurally covered by the dist-0 `inRoom` listener (`router.test.ts:269-273`) and the verified absence of any self-exclusion in the earshot branch.
4. **Note 4 — INFO (task-level, not spec-level).** T6's done-when lists a "round reset" reducer test; the reset is implemented as a scene re-init (`app.ts:123` → `WorldScene.resetEvidence`, `WorldScene.ts:472-477`), not a reducer action, and has no unit test (the harness covers a single round). The spec's EVID ACs do not require it.

## Code-quality observations

- No new sim class, no new intent, no tuning change — evidence hangs off the two existing detection points in `WorkChannels` (transitions `work.ts:157-197`, segment entries `work.ts:213-237`), exactly per design.
- The Router still never names a message type; `earshot` is one more policy branch driven entirely by the registry row. Undeclared sim events remain compile errors (`registry.ts:344-346`).
- Settle bookkeeping is absolute-tick-based (`settleAt` map), never wall time — deterministic; the bit-for-bit replay test still passes (in baseline 247/247).
- Client adds four mapper rows only; card/cue visuals are DOM over the canvas so the scene contract (rects+ellipses) is untouched.

## Re-verification of Gap 1 (2026-08-29, orchestrator fix)

Gap 1 (LOW): the `room:observed`-while-`'trashed'` leg now has a direct
assertion — `packages/sim/src/work.test.ts` `sim:freshness` "reads trash as
trashed through room:observed while the window runs (EVID-07)": exact-array
`{ type: 'room:observed', …, state: 'trashed' }` after a mid-window re-entry.
Suite: 248/248. Verdict stands: PASS.
