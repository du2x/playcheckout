# Guest Exit Specification (cycle 3.5, prd v1.5 + v1.6)

## Problem Statement

The §7 dials for the guest-traffic economy (cadence 30/24/18 s, dwell 45–90 s, restaurant 15–30 s, one-car + stairs at 3.1 m/s) and the `SETTLE_TARGET` 5/7/9 provisional table were pinned before any rate proof. The shrunken complaint budget (trash-discovery only, 8, AD-039) and the one-car + stairs trough (AD-040) must hold under realistic transport pressure, and the free mis-placement economy (3.B–3.D) must be defensible: if interception cannot keep pace, the §7 dials lock on a lie.

## Goals

- [ ] Rate-based bot sims prove settle throughput against pure churn at the 6p cadence and the mis-placement saboteur against interception-shaped staff at plausible rates — the v1.4/v1.5/v1.6 §7 balance gate before §7 locks.
- [ ] `SETTLE_TARGET` calibrated to a value the bots actually hit under interception pressure; the shrunken complaint budget's reachability re-checked and recorded.
- [ ] Docs reconciled: prd §7/§8 and roadmap locked or amended by a recorded AD, no incidental edits.

## Out of Scope

| Feature | Reason |
|---|---|
| Production bot AI or matchmaking bots | This cycle is a headless sim harness, not shipped AI |
| Full telemetry JSONL/KPI (FR-23/24) | Cycle 3.6 `telemetry`; 3.5 only reads settled/complaint counts the sim already exposes |
| Client HUD or rendering changes | No client change — `SETTLE_TARGET` is a tuning constant consumed by the existing `ScoreHud` and `settleTargetFor` |
| Changing cadence, dwell, elevator or stairs timings | Reserve dials per §7; 3.5 only spends `SETTLE_TARGET` (and, if the budget proves unreachable, `COMPLAINT_BUDGET`) — other dials move only via a new AD if the bots force it |
| New protocol messages | Guest/suitcase/complaint/tenancy messages already exist; bot sims run inside `packages/sim` |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| Lobby sizes exercised | 4p / 5p / 6p (the §7 table) — the gate asserts 6p, the harness runs all three | §7 locks per lobby size; 6p is the worst-case cadence (18 s) | y |
| Pure-churn baseline (`exit_a`) | Staff bots only, no saboteur sabotage, no mis-placement; guest dormancy is pure churn (settled churn trash remains `settled`) | Isolates delivery throughput from sabotage; mirrors the §8 v1.6 throughput headroom claim | y |
| Staff bot model (rate-based) | Deterministic headless bots that drive the real `MovementSim` (walk 6 tiles/s, stairs 3 s + 2 s breath, single elevator airtime 2 s/floor) and the real `GuestSim`/`RoundSim` tick — no teleports, no `Math.random` in the core, seeded guest Rng only | Reuses AD-028 movement port; travel costs are honest, not estimated | n (assumed — reuses probe3 harness) |
| Staff relief valve | Staff bots prefer the stairwell (west, `STAIR_X=0`, 3 s + 2 s per stride) for inter-floor moves; elevator is fallback when stairs rejected or for guests (guest citizens ride E only, AD-040) | §8 v1.6 names stairs as the staff relief valve; guest throughput holds 1.5× headroom even on one car | n (assumed) |
| Mis-placement saboteur (`exit_b`) | Saboteur bot competes for the desk (`deskInteract`), and for every guest it carriers it places the suitcase at a wrong room (same floor, `room+1 mod 8` — free, no personal foul beyond the carry clock) — the simplest free-misplacement model that guarantees a distinct resting room | v1.4 "free wrong placements" (AD-032) — no personal penalty; `room+1` is deterministic and never equals the assignment | n (assumed) |
| Staff interception model | Idle staff (not carrying) that see a resting suitcase whose `rest` ≠ `guest:assigned` treat it as misplaced: they walk to its door (stairs), `suitcasePickup` within `ROOM_DOOR_RANGE_TILES`, then carry to the correct assignment and `suitcasePlace` — correction before the guest arrives at the wrong door prevents the `guest:complained` line, correction after still salvages the later settle | The only defense the economy grants (AD-032 trash race + 3.D silent mis-placement); building-wide assignment makes the comparison possible | n (assumed) |
| Success band for `exit_a` | Staff bots reach `SETTLE_TARGET` in ≥80% of 20 seeded full-shift runs at 6p (and ≥80% at 5p, ≥75% at 4p) — the bar the bots actually clear in the probe harness | 80% is the `sim:win_checks` coverage precedent; 4p slack is wider (30 s cadence) but fewer hands, so a softer bar | n (assumed) |
| Success band for `exit_b` | Against the mis-placement saboteur at 6p, staff win rate (buzzer `settle-target-met`) lies in 30–70% over 20 seeds — not 0% (interception hopeless) and not 100% (saboteur irrelevant) — and the correction count is > misplace count (interception keeps pace) | §8 healthy sab win 35–65% widened by bot variance; the band is the balance gate's pass/fail | n (assumed) |
| SETTLE_TARGET table | Provisional 4p 5 / 5p 7 / 6p 9; the bots calibrate it — if `exit_a` fails, lower by 1 at the failing size and re-prove; if `exit_b` is 0% staff wins, lower by 1; if `exit_b` is 100% staff wins, the sab is toothless — raise `SETTLE_TARGET` or tighten cadence via a new AD | AD-039 precedent: provisional until the exit-bot balance gate | n (assumed) |
| Complaint-budget re-check | The shrunken budget (trash-discovery only, 8) is re-checked as a property, not a win: pure-churn runs stay <8 (mode ≤2) and a 60 s trash-blitz saboteur (prep→un-prep loop in the last 60 s) can reach 8 via churn+sabotage in ≥1 of 20 seeds — proving reachability without making the budget the main loss leg | 3.D shrank the budget; 3.5 must show it is still reachable | n (assumed) |
| Seeded determinism | Every run is `seed = 1..20`, one `RoundSim` per run, `GuestSim` Rng seeded from the round seed — no `Math.random` in `packages/sim` (AD-022 trade-off) | Bit-for-bit replay (GUEST-14) required for the gate | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Staff throughput vs pure churn (`exit_a`) — the settle proof ⭐ MVP

**User Story**: As a staff team, I want to reach `SETTLE_TARGET` against pure churn at the 6p cadence so that the provisional win dial (5/7/9) is proven honest under the one-car + stairs economy.

**Why P1**: The §6.6 buzzer leg is the only staff win path that survives to the buzzer; if the dial is too high, every honest shift loses.

**Acceptance Criteria** (EARS):

1. The system SHALL run 20 deterministic full-shift sims (300 s at 20 Hz, `MovementSim` + `RoundSim` + seeded `GuestSim`) per lobby size with staff bots only (no saboteur sabotage, no mis-placement) and SHALL count `guest:settled` settles — the per-round settle score. <!-- ubiquitous -->
2. WHEN the bots are the stairs-preferring delivery bots (walk to `STAIR_X` for inter-floor moves, 3 s transit + 2 s breath, elevator fallback; guests ride E as citizens, single car `car:1` on `HALL_LENGTH_TILES` east) THEN the 6p runs SHALL reach `SETTLE_TARGET[6]` in ≥80% of seeds and the 5p/4p runs SHALL reach their targets in ≥80%/≥75% of seeds. <!-- event-driven -->
3. IF the 6p hit rate falls below 80% THEN the system SHALL lower `SETTLE_TARGET[6]` by 1 (and 5p/4p analogously) and re-prove until the band passes — the calibrated table replaces the provisional one in `packages/shared/src/tuning.ts` and is read only through `settleTargetFor`. <!-- unwanted-behavior -->
4. WHILE the pure-churn runs execute THEN the complaint count (`guest:discovered` trash-discovery complaints only, `COMPLAINT_BUDGET=8`) SHALL stay <8 in ≥95% of runs and the mode SHALL be ≤2 — the shrunken budget is not leaking via churn. <!-- state-driven -->
5. The system SHALL record the final `SETTLE_TARGET` table, the 6p/5p/4p hit rates, and the complaint mode in the `exit_a` gate artifact. <!-- ubiquitous -->

**Independent Test**: `sim:guest_exit_a` — 20-seed headless runs per lobby size, assert hit rates above; a determinism pin (same seed → same event trace) and a zero-misplacement pin.

---

### P2: Mis-placement saboteur vs interception (`exit_b`) — the balance gate ⭐ MVP

**User Story**: As the saboteur, I want free wrong placements to force staff into an interception race so that delivery skill decides the buzzer, not free sabotage.

**Why P1**: The v1.4 suitcase economy's core bet is that physical interception before guest arrival can keep pace; if it cannot, §7 locks on an unbalanced game.

**Acceptance Criteria**:

1. WHEN the saboteur bot competes for the desk and, for every guest it carriers, it places the resting suitcase at a wrong room (`room+1 mod 8` on the assigned floor, `ROOM_DOOR_RANGE_TILES`-validated, silent `suitcase:placed` — no walkie line) THEN the staff bots (same stairs-preferring model, plus the idle-scan pickup correction) SHALL attempt correction: idle staff that see a resting suitcase whose `rest` ≠ `guest:assigned` SHALL `suitcasePickup` within `ROOM_DOOR_RANGE_TILES` and re-place at the correct assignment. <!-- event-driven -->
2. WHILE the mis-placement economy runs at 6p (the worst cadence) over 20 seeds THEN the staff win rate (`round:ended` `settle-target-met` vs `settle-target-failed` at the buzzer, `COMPLAINT_BUDGET` and fired/attrition legs unchanged) SHALL lie in 30–70% — interception-shaped play beats the saboteur at plausible rates but does not trivialize him. <!-- state-driven -->
3. IF the staff win rate is 0% (saboteur undefeated) THEN the system SHALL lower `SETTLE_TARGET[6]` by 1 or reduce `GUEST_CADENCE_SECONDS[6]` pressure via a recorded AD and SHALL re-prove `exit_a` and `exit_b`; IF the staff win rate is 100% THEN the system SHALL raise the target or tighten the economy via a recorded AD — the gate, not the bots, moves the dial. <!-- unwanted-behavior -->
4. The system SHALL count misplaces per round and corrections per round and SHALL assert `corrections ≥ misplaces × 0.5` on average (interception keeps pace) and `guest:complained` (wrong-delivery door lines, FR-29a) SHALL fire at least once across the 20 seeds and SHALL never count toward the complaint budget. <!-- ubiquitous -->
5. The system SHALL assert the two spec-pinned kill checks inside the same runs: an ambush with no pre-existing trash SHALL move no complaint (`guest:discovered` count unchanged by the ambush) and a wrong-delivery line SHALL move no complaint and no score — the shrunken-budget semantics survive the economy. <!-- ubiquitous -->

**Independent Test**: `sim:guest_exit_b` — 20-seed headless runs at 6p with the sab bot + intercepting staff, assert win band, correction keep-up, wrong-delivery inertness, and the ambush kill check; determinism pin.

---

### P3: Docs & AD — §7 locks ⭐

**User Story**: As a maintainer, I want the calibrated `SETTLE_TARGET`, the 6p cadence headroom proof (single car + stairs §8), and the shrunken-budget reachability verdict recorded so that Phase 3 can lock §7 without revisiting churn.

**Why P2**: Repo rule — tuning values come from prd §7 only, any change needs a recorded AD in `.specs/STATE.md`; the Phase 3 exit rule says the cadence dials hold until this gate.

**Acceptance Criteria**:

1. The repository SHALL carry the calibrated `SETTLE_TARGET` values in `packages/shared/src/tuning.ts` (3-tuple `4→n,5→n,6→n`) and the §8 v1.6 recompute (single-car 8–12 s per trip, 1.5× headroom at 6p, stairs as relief, ambush ≈ one cadence slot) remains in `prd.md` or gains an amended `SETTLE_TARGET` row and a one-line `SETTLE_TARGET` calibration note, and `roadmap.md` Phase 3 exit notes the 3.5 verdict. <!-- ubiquitous -->
2. The system SHALL record the decision as AD-NNN in `.specs/STATE.md` (the 3.5 balance gate): the bot design (stairs-preferring delivery, `room+1` mis-place, idle-scan correction), the measured hit rates (exit_a per-size, exit_b 6p win band, correction keep-up, complaint mode/reachability), the dial decision (keep or move `SETTLE_TARGET`/`COMPLAINT_BUDGET`/cadence with rationale), and the handoff to 3.6 `telemetry`. <!-- ubiquitous -->
3. The system SHALL expose the tuned value only through `settleTargetFor` (the AD-039 API) and `TUNING.SETTLE_TARGET` — no raw read. <!-- ubiquitous -->

**Independent Test**: Docs diff review — `tuning.ts`, `prd.md`, `roadmap.md`, `.specs/STATE.md` AD entry, all green.

---

## Edge Cases

- IF the buzzer fires while a guest is mid-walk (carrying or dining) THEN the guest SHALL NOT count toward `settledCount` — settles only.
- IF a carry-clock expiry fires a carrier (`carry-clock` reason) THEN the guest re-queues, score does not move, and the win check counts the reduced live staff.
- IF an ambush stuns a staff member mid-stairs THEN the stun pauses the transit (20 s), preserves `transitTicksLeft`, and the victim resumes on recovery — never creating a complaint.
- IF a resting suitcase is picked up mid-guest-walk THEN the guest SHALL strand at the old door and re-target on the next `suitcase:placed` (SUI-13), extending the settle time.
- IF the saboteur's wrong placement and a staff correction land on the same tick THEN the last `suitcase:placed` wins — the guest's `target` re-targets to the newest rest.
- IF `settleTargetFor` is called with a count outside 4–6 THEN it SHALL clamp to the nearest supported size (3→4p, 7→6p).
- IF the bots run outside an active round (pre-round or results) THEN elevator and carry semantics SHALL be inert — no ambush, no carry-clock expiry.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
|---|---|---|---|
| EXIT-01 | P1: Staff throughput vs pure churn | Design | Pending |
| EXIT-02 | P1: Staff throughput vs pure churn | Design | Pending |
| EXIT-03 | P1: Staff throughput vs pure churn | Design | Pending |
| EXIT-04 | P1: Staff throughput vs pure churn | Design | Pending |
| EXIT-05 | P1: Staff throughput vs pure churn | Design | Pending |
| EXIT-06 | P2: Mis-placement saboteur vs interception | Design | Pending |
| EXIT-07 | P2: Mis-placement saboteur vs interception | Design | Pending |
| EXIT-08 | P2: Mis-placement saboteur vs interception | Design | Pending |
| EXIT-09 | P2: Mis-placement saboteur vs interception | Design | Pending |
| EXIT-10 | P2: Mis-placement saboteur vs interception | Design | Pending |
| EXIT-11 | P3: Docs & AD | - | Pending |
| EXIT-12 | P3: Docs & AD | - | Pending |
| EXIT-13 | P3: Docs & AD | - | Pending |

**Coverage:** 13 total, 13 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] `sim:guest_exit_a` green: 6p ≥80% hit, 5p ≥80%, 4p ≥75%; complaint mode ≤2, <8 in ≥95% runs
- [ ] `sim:guest_exit_b` green: 6p staff win 30–70% vs `room+1` mis-placer, corrections keep pace (≥0.5× misplaces), wrong-delivery inert (0 budget, 0 score), ambush kill check pinned
- [ ] `pnpm typecheck && pnpm lint && pnpm test:sim` green repo-wide
- [ ] `TUNING.SETTLE_TARGET` calibrated (kept or moved by a recorded AD) and exposed only via `settleTargetFor`; prd §8/§7 and roadmap reflect the verdict; `.specs/STATE.md` handoff names 3.6 `telemetry`
