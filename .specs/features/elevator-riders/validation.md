# Elevator Riders Validation

**Date**: 2026-08-28 (re-validation iteration 1)
**Spec**: `.specs/features/elevator-riders/spec.md`
**Diff range**: `c7d79c8..0799fc3` (HEAD) — 21 commits: 12 task commits `38293af..0b752ff`, prior-round fixes `2621683`/`c488ba8`/`8faf406`/`1601141`, and the 5 fix-round commits under review: `ac25268` (disconnect wiring + room test), `dee2f55` (AD-012 #3 pin), `e583285` (MOVE-13 boarding pins), `841644c` (dwell literal pin), `0799fc3` (queued non-head press pin)
**Verifier**: independent sub-agent (author ≠ verifier; this verifier authored nothing in the range)
**Verdict**: ✅ **PASS** — all 5 prior gaps closed with value-matched evidence; 7/7 sensor mutants killed; gates green

---

## Gap-Closure Check (5 prior gaps → new evidence)

### Gap 1 [Blocker] — room-level disconnect flush (ELR-01/02, design.md Integration Points)
**CLOSED** by `ac25268`.
- Wiring: `apps/server/src/rooms/TurnoverRoom.ts:184` — `this.movement.leave(client.sessionId)` in `onLeave` (before `sim.leave`), with the dirty-flush comment. Verified present at HEAD by grep and by the passing test below.
- Room-level test: `apps/server/src/rooms/TurnoverRoom.test.ts:949-1019` — a rider disconnects MID-TRIP (doors shut). Assertion verbatim (line 976-981): `expect(flushes).toHaveLength(1)` and `expect(flushes[0]?.payload).toEqual({ car: 1, riders: [host.sessionId], queue: ['floor1'] })` — remaining-rider update with surviving queue. `player:left` unchanged (line 984-985): `expect(left?.payload).toEqual({ playerId: a.sessionId })`. Freed slot boardable (lines 987-1011): a third player boards car 1 (which already carries host — impossible with a ghost leaver blocking capacity 2), asserting `(boardFlush?.riders as string[]).sort()).toEqual([host.sessionId, b.sessionId].sort())`.
- Matches the spec outcome on all three requested legs (rider list update to remaining riders + freed slot boardable + `player:left` unchanged). Sim-side flush pin also present (`movement.test.ts:936-949` — exactly one riders event next tick, none after).

### Gap 2 [Major] — AD-012 #3 boarding queued-call drop (spec Edge Cases)
**CLOSED** by `dee2f55`. Test: `packages/sim/src/movement.test.ts:556-598` ("drops a boarding player queued call (AD-012 #3: no car to an abandoned floor)"). Both cars busy → call queues in the sim FIFO → the caller auto-boards the other car → assertions verbatim (lines 590-593): `expect(tail.filter((e) => e.type === 'elevator:called')).toEqual([])` and `expect(tail.some((e) => e.type === 'elevator:moved' && e.car === 1 && e.floor === 'lobby')).toBe(false)` — no car is ever dispatched to the abandoned floor even after 150 tail ticks spanning car 1's arrival, dwell, and idle transition.

### Gap 3 [Major] — boarding capacity 2 / closest-first / playerId tie / overflow (ELR P2 AC8, MOVE-13)
**CLOSED** by `e583285`. Test: `packages/sim/src/movement.test.ts:654-711`. Three candidates in range (p4 at 0.0 tiles, p2/p3 tied at 0.3). Verbatim (line 696): `expect(boarded).toEqual(['p4', 'p2'])` — distance beats the tied pair, playerId breaks the tie, capacity 2 holds; `expect(sim.viewOf('p3').car).toBeNull()` (line 699) — overflow queues; lines 706-709 — after p4 exits during the dwell, `sim.tick()` → `expect(sim.viewOf('p3').car).toBe(1)` — the overflow boards on the next open-door tick, with the episode guard verified in the same breath (line 710: `expect(sim.viewOf('p4').car).toBeNull()`).

### Gap 4 [Minor] — DWELL_TICKS === 20 literal pin (ELR-14 / P3 AC1)
**CLOSED** by `841644c`. Test: `packages/sim/src/movement.test.ts:304-311`. Verbatim (308-310): `expect(TUNING.ELEVATOR_DWELL_SECONDS).toBe(1)`, `expect(DWELL_TICKS).toBe(TUNING.ELEVATOR_DWELL_SECONDS * TICK_HZ)`, `expect(DWELL_TICKS).toBe(20)`. Sensor-confirmed: mutant M1 (`ELEVATOR_DWELL_SECONDS: 0.95`) — the exact prior-round survivor — now fails this pin.

### Gap 5 [Minor] — queued non-head press rejection, exactly one `elevator:pressed` per accepted press (ELR P2 AC2)
**CLOSED** by `0799fc3`. Test: `packages/sim/src/movement.test.ts:467-488`. Queue `['floor3','floor2']` while riding; re-press of queued non-head floor2. Verbatim (475): `expect(sim.pressFloor('p1', 'floor2')).toBe('ignored')`; lines 479-482 — the next tick carries exactly the two accepted presses and never one for the duplicate: `expect(sim.tick().filter((e) => e.type === 'elevator:pressed')).toEqual([{…floor3…}, {…floor2…}])`; lines 483-487 — `snapshotForRider` queue stays `['floor3','floor2']` (no double-queue → no zero-ride throw). Sensor-confirmed: mutant M7 (delete the `car.queue.includes(floor)` check at `movement.ts:269`) is killed by exactly this test (1 failure: this test only).

**Gap closure: 5/5 closed.**

---

## Spec-Anchored Acceptance Criteria (re-derived from scratch — no evidence inherited)

Numbering follows the spec traceability (P1 AC1–5 = ELR-01..05; P2 AC1–9 = ELR-06..14; P3 AC1–6 = ELR-14..19; ELR-14 is dual-mapped per the prior round's convention).

### P1: Riders know their car

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| ELR-01 board → occupant list to every rider incl. boarder | full `{car, riders, queue}` list, riders-only | `movement.test.ts:906` — `expect(ridersEvent).toEqual({ type: 'elevator:riders', car: 1, riders: ['p1'], queue: [] })`; room `TurnoverRoom.test.ts:819` — sorted riders `[host, a]`; registry `registry.test.ts:191-193` — payload exactly `{car, riders, queue}`, policy `riders` | ✅ PASS |
| ELR-02 walk-off → remaining riders updated | updated list + surviving queue; disconnect variant room-level | `movement.test.ts:928-933` — `toEqual({ type: 'elevator:riders', car: 1, riders: ['p2'], queue: ['floor2'] })`; disconnect `TurnoverRoom.test.ts:976-981` (Gap 1); client chip drops bruno `movement.spec.ts:350-354` | ✅ PASS |
| ELR-03 no occupancy to non-riders / panels | no riders delivery to non-riders; public payloads key-clean | `router.test.ts:209-210` — `expect(rider2.sent).toEqual([]); expect(floorViewer.sent).toEqual([])`; `registry.test.ts:158-163` — keys `not.toContain('queue'/'occupants'/'riders')`; room every-message sweep `TurnoverRoom.test.ts:858-862` — `not.toHaveProperty('carOccupants'/'riders'/'queue')`; harness `movement.spec.ts:339` — `expect(audit.occupancyCount).toBe(0)` | ✅ PASS |
| ELR-04 rider snapshot has occupants; non-rider has none | rider: `players:[]` + `carOccupants {car, riders, queue}`; non-rider byte-identical floor snapshot | `movement.test.ts:958` — `expect(riderSnap.players).toEqual([])`; `:963` — `expect(riderSnap.carOccupants).toEqual({ car: 1, riders: ['p1'], queue: ['floor2'] })`; `:974` — `expect('carOccupants' in floorSnap).toBe(false)`; `:980` — non-rider `snapshotForRider` falls back, no field; room `TurnoverRoom.test.ts:836-842, 851` | ✅ PASS |
| ELR-05 chip + lit indicators rider-only, invisibility kept | names visible on riders only; watcher chip hidden; panel position-only | `movement.spec.ts:298-309` — both riders' chips contain ada AND bruno; `:311` — `expect((await readChip(watcher)).hidden).toBe(true)`; `:316-326` — lit `floor1` indicator on both riders + last-press line; `:196-197` panel no names; `:203` own rectangle invisible while aboard; `elevatorLobby.spec.ts:126-129` chip hides on exit | ✅ PASS |

### P2: In-car floor press queue

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| ELR-06 accepted press → queue + `elevator:pressed {playerId, floor}` riders-only | payload exactly `{playerId, floor}`, car as visibility only | `registry.test.ts:176-178` — `expect(projected.payload).toEqual({ playerId: 'p1', floor: 'floor2' })`, keys exactly, `expect(projected.visibility).toEqual({ car: 2 })`; `router.test.ts:220-226` — rider-only delivery; `movement.test.ts:457-459` exact event; room `TurnoverRoom.test.ts:813-814` | ✅ PASS |
| ELR-07 duplicate / being-served / current-floor rejected silently | `'ignored'`, no event, no queue change — incl. the queued non-head leg | `movement.test.ts:452-461` — 3× `toBe('ignored')` + exactly ONE pressed event (457); **new** `movement.test.ts:467-488` — queued non-head `toBe('ignored')`, exactly the 2 accepted presses, queue intact (Gap 5) | ✅ PASS |
| ELR-08 non-rider press rejected silently | `'rejected'`, nothing on wire, no error | `movement.test.ts:455` — `expect(sim.pressFloor('p2', 'floor3')).toBe('rejected')`; `TurnoverRoom.test.ts:873-895` — no `elevator:pressed`, no `error` on any of 4 feeds | ✅ PASS |
| ELR-09 dwell end + queue → depart FIFO oldest at 2 s/floor; arrival dwells; floor removed | exact tick math, press order | `movement.test.ts:429-436` — floor3 at `3 * RIDE_TICKS_PER_FLOOR`, then after `DWELL_TICKS` silent ticks floor1 at `2 * RIDE_TICKS_PER_FLOOR` | ✅ PASS |
| ELR-10 queue empties → idle open doors until press/dispatch | open-doors idle; press departs immediately | `movement.test.ts:440-444` — after dwell `expect(sim.viewOf('p1').car).toBe(1)`, press accepted → moved in `RIDE_TICKS_PER_FLOOR` | ✅ PASS |
| ELR-11 dispatch as today; empty-idle preferred first; no destination on call | empty idle over closer occupied; closest empty; occupied only if none; schema rejects target | `movement.test.ts:347-376` — empty car 1 (30 tiles) drafted over occupied car 2 (0 tiles), flash `car: 1`; `:378-397` — closest empty (car 2 at 0); `:399-414` — occupied drafted only when no empty, tie → car 1; `registry.test.ts:59-65` — `expect(() => elevatorCallIntentSchema.parse({ type: 'elevator:call', target: 'floor1' })).toThrow()` | ✅ PASS |
| ELR-12 duplicate pickup call → flash without dispatch (pickup-floor-only predicate) | 2 flashes, no second `elevator:moved`; cross-floor calls NOT swallowed | `movement.test.ts:514-520` — two `called`, `expect(events.filter((e) => e.type === 'elevator:moved')).toEqual([])`; narrowing `:791-824` (floor1 call dispatches while car 1 arrives at lobby); room `TurnoverRoom.test.ts:933-941` — 2 called, `expect(moved).toHaveLength(1)` | ✅ PASS |
| ELR-13 walk rejected while moving; open doors → exit + board (capacity 2, closest first, tie playerId, overflow queues) | phase-gated intent; deterministic boarding | `movement.test.ts:770-789` — doors-shut intent ignored (x unchanged), open-door exit at served floor; **new** `:654-711` — `expect(boarded).toEqual(['p4', 'p2'])`, overflow waits then boards (Gap 3) | ✅ PASS |
| ELR-14 (P2 AC9) payloads exactly `{floor,car}`/`{car,floor}` | keys exact, never queue/occupancy/targets | `registry.test.ts:148,154` — `expect(Object.keys(carMoved.payload).sort()).toEqual(['car', 'floor'])` (+ `called`); harness `movement.spec.ts:340` — every panel shape `['car', 'floor']`; room `TurnoverRoom.test.ts:701,718,935-936` exact payloads | ✅ PASS |

### P3: Open-door stops, stays, ghosts, abandoned pickups

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| ELR-14 dwell exactly 1 s = 20 ticks at every stop | literal pin, not constant-relative | **new** `movement.test.ts:304-311` — `expect(TUNING.ELEVATOR_DWELL_SECONDS).toBe(1)`, `expect(DWELL_TICKS).toBe(20)` (Gap 4); constant-relative dwells remain at `:336, 435, 440, 646` | ✅ PASS |
| ELR-15 stay-in-car: press another floor, keep riding | no forced exit; re-press works | `movement.test.ts:437` — `expect(sim.viewOf('p1').car).toBe(1)` at a served floor + press accepted; carried rider `:422`; press during dwell `:919` | ✅ PASS |
| ELR-16 ghost trip: all riders off, queue persists, car serves | empty car departs and serves | `movement.test.ts:640-651` — riders event `{ riders: [], queue: ['floor2'] }` + pressed flush together, then arrival at floor2 (`snapshot().cars`) | ✅ PASS |
| ELR-17 caller-never-boards → pickup completes, idle open-doors | no auto-proceed, car stays | `movement.test.ts:330-344` — dispatched → arrived at 60 → exactly `DWELL_TICKS` silent ticks → car 1 still at `lobby` | ✅ PASS |
| ELR-18 same-floor re-call at open-doors car = duplicate decoy, no dispatch | flash only | `movement.test.ts:512-520` — 2 callers `'ignored'`, 2 flashes, no moved; room `TurnoverRoom.test.ts:897-947`; harness `elevatorLobby.spec.ts:44-61` (panel pulses, car still at lobby) | ✅ PASS |
| ELR-19 exit resumes `player:moved` at landing; boarding silent | exit event on same-floor stream; no board announcement | `movement.test.ts:184-190` — exit tick carries `player:moved`, walk proceeds from landing; `:879-885` — `expect(leftFloor).toEqual({ type: 'player:left-floor', playerId: 'p1', floor: 'lobby' })`, `expect(JSON.stringify(leftFloor)).not.toContain('floor1')`, no further left-floor; no `elevator:boarded` key exists (exhaustive registry list `registry.test.ts:111-113`) | ✅ PASS |

**Status**: ✅ 19/19 ACs with direct, value-matched evidence; 0 spec-precision gaps.

---

## Edge Cases

| Edge case (spec) | Evidence | Result |
| ---------------- | -------- | ------ |
| Door-open-episode guard: no re-board until departure; exit in any phase; no oscillation | `movement.test.ts:713-739` (30 ticks at the landing, no re-board; guard cleared by departure; p1 re-boards next episode); `:741-768` (pre-round exiter stands 25 ticks, walks after unlock); harness `movement.spec.ts:361-366`; sensor M3 killed | ✅ Covered |
| Carried rider presses pickup floor while arriving → silent rejection (no zero-tick rides) | `movement.test.ts:417-420` — `toBe('ignored')` + no `elevator:pressed` for 58 ticks; zero-ride guard: `departRiding` throws on empty rideTicks (`movement.ts:295-299`), design-pinned | ✅ Covered |
| Press during dwell queues; car departs to it at dwell end | `movement.test.ts:915-933` (press during dwell, ride completes at `DWELL_TICKS + RIDE`); ghost-trip press during dwell `:634-647` | ✅ Covered |
| Both cars busy → sim-level FIFO, first car to free (MOVE-15) | `movement.test.ts:523-554` — queued call flashes at dispatch, car 2 serves | ✅ Covered |
| Queued call dropped when a rider boards another car (AD-012 #3) | **new** `movement.test.ts:556-598` (Gap 2, see above) | ✅ Covered |
| Buzzer `lock()` while trips in flight: service continues, queue not cleared (AD-011) | `movement.test.ts:600-624` — exactly 1 post-buzzer flash, both trips complete | ✅ Covered |
| Same-tick boarding/exiting resolution deterministic | Exit resolves in intent, boarding in `tickCars` after movement; ordering pinned by the ghost-trip flush (`movement.test.ts:640-645`, riders flush before pressed). No literal same-tick pair scenario — accepted as design-equivalent (unchanged from prior round) | ✅ Covered |
| Fresh joiner mid-trip: car position public, no occupancy/queue | `movement.test.ts:264-273, 967-974` (floor snapshots carry cars' floors, never `carOccupants`); room join/resync path `TurnoverRoom.ts:296-300` routes through `snapshotForRider`/`snapshotForFloor` branch; every-message sweep `TurnoverRoom.test.ts:858-862` | ✅ Covered |
| **Rider disconnect → dirty flush** (design.md Integration Points) | **new** room-level `TurnoverRoom.test.ts:949-1019` + wiring `TurnoverRoom.ts:184` (Gap 1); sim flush `movement.test.ts:936-949` — exactly one riders event next tick, none after | ✅ Covered |

---

## Discrimination Sensor

Isolated scratch: full repo copy at `/tmp/opencode/elr-sensor2` (rsync `-a`, `.git`/`.playwright-mcp`/`scripts` excluded; workspace-relative node_modules symlinks resolve inside the copy — no worktree). Scratch baseline: **188/188 pass**. Each mutation applied → full `pnpm test:sim` → file restored via rsync from the real tree. Scratches discarded; real-tree porcelain re-checked byte-identical to the pre-sensor baseline (`M package.json`, `?? .playwright-mcp/`, `?? .specs/…/validation.md`, `?? scripts/`) — the only dirty file is the pre-existing `package.json` boot-script line from before this verification (present in the prior round's baseline too).

| # | Mutation | File:line | Killed? |
| - | -------- | --------- | ------- |
| 1 | Dwell 1 s → 0.95 s (`ELEVATOR_DWELL_SECONDS: 0.95`) — **prior-round survivor, must-try** | `packages/shared/src/tuning.ts:24` | ✅ Killed (new dwell literal pin, `movement.test.ts:310`) |
| 2 | FIFO → LIFO queue service (`queue[0]` → last; `shift()` → `pop()`) — must-try | `packages/sim/src/movement.ts:297,519` | ✅ Killed (FIFO tick-math tests fail) |
| 3 | Door-open-episode guard removed (`car.exitedThisStop.add(playerId)` deleted) | `packages/sim/src/movement.ts:173` | ✅ Killed (re-board/oscillation tests fail) |
| 4 | Queue leaked into non-rider snapshot (`snapshotForFloor` gains `carOccupants`) — must-try | `packages/sim/src/movement.ts:355-363` | ✅ Killed (`'carOccupants' in floorSnap` assertions fail) |
| 5 | Empty-idle dispatch preference dropped (`closest(idle)` directly) — must-try | `packages/sim/src/movement.ts:238` | ✅ Killed (dispatch-preference test fails) |
| 6 | Disconnect wiring removed (`this.movement.leave(...)` deleted from `onLeave`) — validates Gap 1 fix | `apps/server/src/rooms/TurnoverRoom.ts:184` | ✅ Killed (room-level disconnect test fails) |
| 7 | Duplicate-press rejection removed (`if (car.queue.includes(floor)) return 'ignored'` deleted in `pressFloor`) — validates Gap 5 fix; mutation site verified in a second scratch (line 269 only; the call-duplicate predicate at line 217 untouched) | `packages/sim/src/movement.ts:269` | ✅ Killed (exactly the new `movement.test.ts:467` test fails, 1 failed / 187 passed) |

**Sensor depth**: lightweight+ (7 targeted behavior-level mutations per Verifier dispatch instruction)
**Result**: **7/7 killed, 0 survived** — PASS ✅

---

## Gate Check

| Gate | Command | Result |
| ---- | ------- | ------ |
| 1 | `pnpm typecheck` | ✅ exit 0 (4 projects) |
| 1 | `pnpm lint` (biome) | ✅ exit 0 (77 files) |
| 2 | `pnpm test:sim` | ✅ exit 0 — 15 files, **188 tests passed**, 0 failed, 0 skipped |
| 3 | `pnpm test:client` | ✅ exit 0 — **22 passed**, 0 failed (incl. `client:elevator_riders`, rewritten `client:movement`, `client:elevator_lobby`) |

Environment note: the first `pnpm test:client` invocation failed at webServer startup — a stale dev server (PID 177130/177132) already held :2567/:5173. This is the known pre-existing environment hazard (the prior round hit it too), not a test failure; the stale processes were killed per standing instruction and the full suite then passed in one clean run. The known `client:work_channels` load flake did **not** occur — no retry was needed.

Test integrity: sim 183 → 188 (+5 — exactly the five fix tests; no test deleted or weakened), client 22 → 22. No skips anywhere.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / surgical changes | ✅ — fix round is 1 wiring line + comment, 5 test-only commits |
| No scope creep | ✅ |
| Matches existing patterns | ✅ — new tests use the established helpers (`boardParkedCar`, `runUntilCarMoved`, `feed`) |
| Spec-anchored outcome check | ✅ — every asserted value matches the spec-defined outcome (table above) |
| Per-layer coverage expectation | ✅ — sim 1:1 ELR mapping; room happy + edge + disconnect; harness rider-exclusive client half |
| Every test maps to a spec requirement | ✅ — 5 new tests cite ELR/AD/MOVE ids in their titles |
| Guidelines followed | ✅ — gate ladder per AGENTS.md; message-only protocol respected (all rider knowledge via `riders` policy rows) |

---

## Requirement Traceability

| Requirement | Status |
| ----------- | ------ |
| ELR-01..19 (all) | ✅ Verified (evidence above) |
| All spec edge cases incl. disconnect flush | ✅ Verified |

(Spec.md status column intentionally left untouched — verifier is read-only except this report and lessons.)

---

## Summary

**Overall**: ✅ Ready — PASS

**Spec-anchored check**: 19/19 ACs matched spec outcome; 0 spec-precision gaps
**Gap closure**: 5/5 prior gaps closed (1 blocker, 2 coverage regressions, 2 spec-precision)
**Sensor**: 7 mutations injected, 7 killed, 0 survived
**Gate**: sim 188/188, client 22/22, typecheck + lint exit 0; no retries needed (work flake did not fire)

**Diff range**: `c7d79c8..0799fc3` (HEAD)

**Next steps**: none for this feature — feature is done. Human 5-minute round (two players riding together, recalling co-rider and press attribution from the HUD alone) remains the standing Gate 4 for player-facing cycles, outside this report's scope.
