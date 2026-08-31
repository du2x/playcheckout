# Guest Flow Validation

**Result**: PASS ✅

**Date**: 2026-08-31
**Spec**: `.specs/features/guest-flow/spec.md`
**Diff range**: `5faab4f^..HEAD` (7 commits: 5faab4f, abb4f1f, 0db1d65, c53e9cf, 47ad8e4, e96444a, 1b788bf)
**Verifier**: independent sub-agent (author ≠ verifier; everything re-derived from the spec)

---

## Verdict

**PASS ✅**

All 14 acceptance criteria are spec-anchored with `file:line` evidence; asserted values match the spec-defined outcomes (churn verified against the T3 amendment: `WorkChannels.churnTrash` setting the `settled` state, no origin map). 7/8 sensor mutants killed; the one survivor is the task-prescribed test-strength probe (d) — noted as a gap, not a feature defect. All gates pass (two known-flake re-runs used, per the REG-18/client-flake note).

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | `packages/sim/src/rng.ts` + `rng.test.ts` (5 tests: same-seed identity, int/uniform range, replay). |
| T2 | ✅ Done | `tuning.ts` guest rows + `DESK_X_TILES`/`GUEST_QUEUE_SPACING_TILES` pinned (`tuning.test.ts:45-55`); `roomDoorXMilli` pinned against AD-010 (`layout.test.ts`). |
| T3 | ✅ Done | `work.ts:81-83` `churnTrash` → `settled` (amended design honored — no origin side-map); 5 `sim:checkout_churn` tests. |
| T4 | ✅ Done | Mover-kind split in `movement.ts`; `sim:guest_movers` describe (7 tests). |
| T5 (+T6) | ✅ Done | `guests.ts` GuestSim + driver; 9 tests incl. the 3000-tick replay pin; registry rows in `registry.ts:106-119,249-304` + `simEvents.ts` guest events. |
| T7 | ✅ Done | `TurnoverRoom.ts` guestPort (line 487), intent application, round-end purge (line 573-576); `server:guest_flow` e2e test. |
| T8 | ✅ Done | Client markers/queue/bell (`state.ts`, `WorldScene.ts`, mappers); `client:guest_flow` Playwright scenario. |

---

## Spec-Anchored Acceptance Criteria

| Req | Spec-defined outcome | `file:line` + assertion / evidence | Result |
| --- | --- | --- | --- |
| GUEST-01 | Arrivals at fixed §7 cadence per lobby size; first arrival one full interval after round start. | `guests.test.ts:79-88` — over `CADENCE_5P + 10` ticks: `expect(arrivals).toHaveLength(1)` and `expect(arrivals[0]).toEqual({ type: 'guest:arrived', guestId: 'guest:1' })`; the next `CADENCE_5P` ticks yield exactly `['guest:2']` (no jitter). Cadence values 30/24/18 pinned at `tuning.test.ts:45-47`. Constructor `guests.ts:119` seeds `nextScheduleTick = cadenceTicks`. | ✅ PASS |
| GUEST-02 | No vacant room at arrival-due → arrival held; FIFO release one per tick when a room frees. | `guests.test.ts:114-122` — with all 24 rooms white-box tenanted: `expect(of(held, 'guest:arrived')).toHaveLength(0)` across 2× cadence; after `tenanted.delete('floor1:1')` one tick yields `expect(...).toEqual(['guest:2'])`. Implementation `guests.ts:147-154` (backlog banked per cadence tick, one spawn per tick gated on `hasVacancy()`). | ✅ PASS (gap G2: only a single backlog unit exercised — see Ranked Gaps) |
| GUEST-03 | Guest spawns at the desk queue behind waiting guests in FIFO order; arrival announced to all. | `guests.test.ts:95-97` — `expect(p1?.floor).toBe('lobby')`; `expect(p1?.x).toBe(TUNING.DESK_X_TILES)` (slot 0 at the desk). Announcement: `guests.test.ts:83` — `toEqual({ type: 'guest:arrived', guestId: 'guest:1' })`, registry `'guest:arrived': 'all'` (`registry.test.ts:104`). | ✅ PASS (gap G4: slot-x for slot > 0 not asserted) |
| GUEST-04 | After 20 s the impatience cue fires — foot-tap + bell, no complaint/budget/loss — and self-assigns a seeded uniform random vacant room. | `guests.test.ts:134-144` — `expect(impatient...).toEqual(['guest:1'])`; `self_assigned` length 1 with a valid room (`1 <= room <= ROOMS_PER_FLOOR`); `for (const e of events) expect(e.type).not.toMatch(/complaint\|fired\|ended/)`. Impatience = 20 s pinned (`tuning.test.ts:50`); seeded choice proven by the different-seed replay divergence (`guests.test.ts:252-253`). | ✅ PASS |
| GUEST-05 | No vacancy at impatience → stays queued, re-checks every tick, never force-assigned, never despawned. | `guests.test.ts:158-169` — `expect(of(held, 'guest:self_assigned')).toHaveLength(0)`, `expect(of(held, 'guest:left')).toHaveLength(0)`, then the freed room is picked: `expect(assigned...room).toEqual([ROOMS_PER_FLOOR])`. | ✅ PASS |
| GUEST-06 | Walks at 6 tiles/s via halls/elevators as a full citizen — consumes car capacity, same door/landing/press semantics. | `movement.test.ts:1587-1598` — guest walk emits `guest:moved`, `expect(events.some((e) => e.type === 'player:moved')).toBe(false)`; `guests.test.ts:232-246` — `expect(pressObserved).toBe(true)` (car 1 carried the guest to a guest floor via the landing call press, AD-025). 6 tiles/s is the shared walk machinery pinned for players (`movement.test.ts:77-93`) — structurally inherited, not re-asserted for guests. | ✅ PASS (minor note: guest speed by shared-code inheritance) |
| GUEST-07 | While a guest rides, the rider-exclusive occupancy knowledge includes that guest (capacity counts them). | `movement.test.ts:1616-1661` — guest boards, p2 boards (1 guest + 1 player = full), then `expect(sim.viewOf('p3')).toEqual(before)` (third press declines); `expect(riders?.guests).toEqual(['guest:1'])` on `elevator:riders`; `expect(snap.carOccupants?.guests).toEqual(['guest:1'])` on the rider snapshot. | ✅ PASS |
| GUEST-08 | At the room door the guest enters (leaves hall view) and dwells a seeded uniform 45–90 s, the room tenanted while dwelling. | `guests.test.ts:191` — `expect(movement.viewOf(s.guestId).floor).toBeNull()` (interiors hidden); `guests.test.ts:205-230` — white-box `dwellEndsAt` gives `(deadline - t) / TICK_HS` per settle, each `expect(seconds).toBeGreaterThanOrEqual(45)` / `toBeLessThanOrEqual(90)`. Tenancy: checkout re-frees the same room (`c.room === s.room`, line 197-198). | ✅ PASS (gap G1: uniformity unasserted — bounds only, sensor survivor d) |
| GUEST-09 | Dwell elapses → room becomes trashed with the **settled** mark, room becomes vacant, guest walks to the desk and despawns. | `work.test.ts:687-688` — `sim.churnTrash('floor2', 3); expect(sim.stateOf('floor2', 3)).toBe('settled')` with the following tick emitting `[]` (no sabotage-shaped `room:trashed`); round integration `roundSim.test.ts:400-401` — `expect(sim.roomState(...)).toBe('settled')` after a real `guest:checked_out`; despawn `guests.test.ts:200-202` — `left` contains the guest and `expect(movement.positionOf(s.guestId)).toBeUndefined()`. | ✅ PASS |
| GUEST-10 | Every guest sample derives from the round seed; no `Math.random` in the deterministic core; bit-for-bit replay. | `rng.test.ts:5-19` — same-seed sequences `toEqual`, different-seed `not.toEqual`; `guests.test.ts:248-253` — `expect(JSON.stringify(run1)).toBe(JSON.stringify(run2))` over 3000 ticks; `expect(JSON.stringify(other)).not.toBe(JSON.stringify(run1))`. Grep: no `Math.random` in non-test sim source. | ✅ PASS |
| GUEST-11 | Round end (buzzer/abort/conviction) → all guests cease; no guest state or events survive into results/lobby. | `roundSim.test.ts:422-423` — `expect(guestEventsAfterEnd).toBe(0)` (guest events counted strictly after `round:ended`); `TurnoverRoom.test.ts:2664-2681` — `expect(state.positions.some((p) => p.playerId.startsWith('guest'))).toBe(false)` and `guestAfterEnd` `toEqual([])` on every collector after the buzzer's `round:ended`. | ✅ PASS |
| GUEST-12 | One distinct guest marker per guest on the viewer's floor plus the desk queue; no cross-floor guest delivery. | `guestFlow.spec.ts:78-94` — waits for `c.type === 'Arc' && c.visible`, `expect(markers.length).toBeGreaterThan(0)` (Arc ≠ player Sprite); `guestFlow.spec.ts:102-117` — `expect(crossFloor).toBe(0)` (every received `guest:moved` has `floor === 'lobby'`). | ✅ PASS (gap G5: per-guest marker count unasserted, only > 0) |
| GUEST-13 | Impatient queued guest → foot-tap cue + desk-bell line; no complaint-counter element. | `guestFlow.spec.ts:98` — `waitForSelector('#desk-bell', { state: 'visible' })`; `guestFlow.spec.ts:120-123` — `expect(complaintCounter).toBe(false)`. | ✅ PASS (gap G5: the foot-tap *bounce* motion is not asserted — only the bell line) |
| GUEST-14 | A scripted ≥200-tick guest scenario run twice with the same seed is identical tick-for-tick (positions, tenancy, trash spawns). | `guests.test.ts:248-254` — two 3000-tick `fullLifecycle(2026)` runs: `expect(JSON.stringify(run1)).toBe(JSON.stringify(run2))`; seed 2027 diverges. Replay foundation also pinned at `rng.test.ts:44-50`. | ✅ PASS |

**Status**: ✅ 14/14 requirements evidenced

---

## Edge Cases

- [x] **Buzzer mid-walk/ride/dwell → guest vanishes, no checkout trash**: `roundSim.test.ts:404-424` (zero guest events after `round:ended`) + `TurnoverRoom.test.ts:2664-2681` (movers purged, no guest messages post-end). Churn can only follow a `guest:checked_out`, which the dead sim can never emit. Note: the "room NOT settled from an interrupted stay" is covered by composition, not by a direct room-state assertion.
- [⚠️] **Two arrivals due the same tick → one per tick, FIFO (GUEST-02)**: only a single held backlog unit is exercised (`guests.test.ts:100-123`); multi-unit FIFO release (guest A tick N, guest B tick N+1) is untested — implementation banks backlog per cadence tick and spawns one per tick, but the multi-guest ordering is unasserted.
- [⚠️] **Room tenanted between choice and arrival → nothing happens**: no explicit test; structural (assignment commits at choice time, `guests.ts:175-177`; the driver never re-checks the pick). Recorded as gap G3.
- [x] **Self-assign the room they stand in**: N/A per spec — guests queue in the lobby; structure prevents it.
- [⚠️] **Saboteur fired mid-round → guest behavior unchanged**: no test exercises firing against guest traffic. Guests are pure weather in the implementation (no justice coupling in `guests.ts`/`roundSim.ts` beyond event mapping), but this is an unasserted spec claim — recorded as gap G3.

---

## Discrimination Sensor

**Sensor depth**: 8 behavior-level mutations, one at a time in a scratch git worktree (`git worktree add /tmp/opencode/verifier-guest HEAD --detach`); node_modules symlinked from the real repo; source reverted via `git checkout` between mutants. Worktree removed afterwards and the real tree verified porcelain-clean.

| # | Mutation | `file:line` | Description | Suite killed by | Result |
| --- | --- | --- | --- | --- | --- |
| M-a | `nextScheduleTick = cadenceTicks` → `= 0` | `guests.ts:119` | First arrival spawns at tick 0 instead of one full cadence | `guests.test.ts` — 5 failures (GUEST-01 exact first-interval, GUEST-02/03/04/05 cascades) | ✅ Killed |
| M-b | `vacantRooms()` → `allRoomKeys()` in self-assign | `guests.ts:172` | Impatience self-assign accepts occupied rooms | `guests.test.ts` — 1 failure (GUEST-05: `self_assigned` while full) | ✅ Killed |
| M-c | `backlog > 0 && hasVacancy()` → `backlog > 0` | `guests.ts:151` | Arrivals spawn into a full hotel | `guests.test.ts` — 1 failure (GUEST-02: held arrivals ≠ 0) | ✅ Killed |
| M-d | `rng.uniform(45, 90)` → constant `GUEST_DWELL_MIN_SECONDS` | `guests.ts:283-286` | Dwell fixed at 45 s (test-strength probe) | none — 34/34 sim tests pass | ⚠️ SURVIVED (expected; test-strength note → gap G1) |
| M-e | `boardPlayer` capacity gate counts only players | `movement.ts:836` | Guest boarding no longer consumes car capacity | `movement.test.ts` — 1 failure (GUEST-07: p3 boards a guest-full car) | ✅ Killed |
| M-f | `moved()` guest branch removed | `movement.ts:862-865` | Guest movers emit `player:moved` | `movement.test.ts` — 1 failure (GUEST-06: `guest:moved` never emitted, `player:moved` present) | ✅ Killed |
| M-g | `if (car.riders.length >= CAPACITY) return false` deleted | `movement.ts:836` | Boarding skips the capacity check entirely | `movement.test.ts` — 2 failures (MOVE-13 capacity + GUEST-07) | ✅ Killed |
| M-h | `churnTrash` sets `'trashed'` | `work.ts:82` | Checkout churn produces sabotage-shaped trash | `work.test.ts` + `roundSim.test.ts` — 5 failures (4 `sim:checkout_churn` + round integration `settled` pin) | ✅ Killed |

**Result**: 7/8 killed; M-d survived by design of the probe — the dwell tests bound-check `[45, 90]` but never assert uniformity/variance, so a constant-dwell implementation is indistinguishable. This is a test-strength finding (gap G1), not a feature defect: the shipped implementation does draw `uniform(45, 90)` from the seeded stream.

---

## Spec-Precision Gaps (conjunction/payload rule applied)

1. **G1 — dwell uniformity (GUEST-08)**: `guests.test.ts:226-229` asserts only `[45, 90]` bounds per sample. A constant dwell passes. No statistical/variance pin exists (sensor M-d). The RNG layer's bucket coverage (`rng.test.ts:31-41`) pins uniformity of the *stream*, not the *usage*.
2. **G2 — GUEST-02 multi-backlog FIFO**: single held arrival only; "releasing held arrivals one per tick in FIFO order" beyond one unit unasserted.
3. **G3 — two spec edge cases untested**: room-tenanted-between-choice-and-arrival; saboteur-fired-mid-round (both structurally safe in the implementation, but no evidence).
4. **G4 — GUEST-03 queue-slot placement**: only slot 0 (x = `DESK_X_TILES`) is asserted; the "behind already-waiting guests in FIFO order" slot-x for a later queued guest is unasserted.
5. **G5 — client precision (GUEST-12/13)**: marker count is `> 0` rather than one-per-guest; the foot-tap bounce animation is unasserted (only `#desk-bell` visibility + absence of `#complaint-counter`).

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ |
| Surgical changes | ✅ (+2,646/−59 across 33 files, all feature-scoped) |
| No scope creep | ✅ (no routing/complaints/provenance machinery present) |
| Matches patterns/style | ✅ (registry-first rows, AD-004 test seams, describe-per-scenario naming) |
| Spec-anchored outcome check | ✅ with gaps G1–G5 above |
| Per-layer coverage expectation met | ✅ (unit: sim/shared/room; e2e: client) |
| Every feature-scope test maps to a spec item | ✅ |
| Design amendment honored (T3) | ✅ `churnTrash` sets `settled`; no origin side-map exists; no `room:trashed` from churn (`work.test.ts:679-695`) |

---

## Gate Check

- **Commands run** (on commit `1b788bf`, real tree):
  - `pnpm typecheck` ✅ — 4/4 workspace projects, 0 errors
  - `pnpm lint` (biome check .) ✅ — 109 files, no issues
  - `pnpm test:sim` — 356 passed / 1 failed of 357 (23 files). The 1 failure is the known flake `REG-18` (`TurnoverRoom.test.ts:522` seq-count assertion, envelope-count race under parallel load); re-run of the suite in isolation: **57/57 passed** — majority result PASS.
  - `pnpm test:client` — 32 passed / 2 failed of 34. Both failures (`client:accuse_ui` in `justice.spec.ts`, 7th-join edge in `lobby.spec.ts`) are non-guest specs timing out under full-suite parallel load — the documented flake mode. Re-run of both suites in isolation: **14/14 passed** — majority result PASS. `client:guest_flow` passed in the full run.
- **Sensor scratch worktree**: created at `/tmp/opencode/verifier-guest`, removed after use; `git status --porcelain` on the real tree is empty.

---

## Requirement Traceability Update

| Requirement | Spec status | Verification status |
| --- | --- | --- |
| GUEST-01 | Implementing | ✅ Verified (exact first-interval + cadence) |
| GUEST-02 | Implementing | ✅ Verified (hold + release; multi-backlog FIFO gap G2) |
| GUEST-03 | Implementing | ✅ Verified (desk slot + announcement; slot>0 gap G4) |
| GUEST-04 | Implementing | ✅ Verified (cue timing, freeness, vacant self-assign) |
| GUEST-05 | Implementing | ✅ Verified (re-check, never forced/despawned) |
| GUEST-06 | Implementing | ✅ Verified (guest:moved surface, boarding citizenship) |
| GUEST-07 | Implementing | ✅ Verified (capacity + rider knowledge) |
| GUEST-08 | Implementing | ✅ Verified (hidden interior, dwell bounds; uniformity gap G1) |
| GUEST-09 | Implementing | ✅ Verified (settled mark via churnTrash, vacancy, despawn) |
| GUEST-10 | Implementing | ✅ Verified (seeded replay + no Math.random) |
| GUEST-11 | Implementing | ✅ Verified (sim + room purge) |
| GUEST-12 | Implementing | ✅ Verified (Arc marker, own-floor; count gap G5) |
| GUEST-13 | Implementing | ✅ Verified (bell line, no counter; bounce gap G5) |
| GUEST-14 | Implementing | ✅ Verified (3000-tick bit-for-bit replay) |

---

## Summary

**Overall**: ✅ PASS — ready to close

**Spec-anchored check**: 14/14 requirements evidenced
**Sensor**: 8 mutations injected, 7/8 killed; M-d (constant dwell) survives as a test-strength finding, not a defect
**Gate**: typecheck ✅, lint ✅, sim 357 tests (REG-18 flake → isolated 57/57 ✅), client 34 tests (2 load flakes → isolated ✅; `client:guest_flow` passed)

**Ranked gaps** (none block the verdict):

1. **G1** — dwell uniformity unasserted (bounds only); pin a min<max/coverage check across sampled settles.
2. **G3** — edge cases "room tenanted between choice and arrival" and "saboteur fired mid-round" have no test.
3. **G2** — GUEST-02 FIFO release pinned for one backlog unit only.
4. **G4** — GUEST-03 queue-slot x for slot > 0 unasserted.
5. **G5** — client: per-guest marker count and foot-tap bounce motion unasserted.

**No fix plan required to close; gaps G1–G5 are recommended hardening for the 3.2/3.3 cycles that build on this lifecycle.**
