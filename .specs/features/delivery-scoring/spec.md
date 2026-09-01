# delivery-scoring Specification (cycle 3.D, prd v1.5)

## Problem Statement

v1.4's wrong-delivery door complaint feeds the 8-complaint instant-loss
budget, coupling a logistics mistake to the loss loop and blurring the
budget's purpose. The redesign separates the concerns: the budget means
"caught sabotaging" (trash discovery only), the score means "did the job"
(guests settled), and the buzzer verdict is a settle-point target instead
of a coverage percentage. Proposal: `.specs/proposals/delivery-scoring.md`.

## Goals

- [ ] Settle score is server-authoritative, publicly displayed, and decides the buzzer verdict (settle score ≥ `SETTLE_TARGET` → staff win)
- [ ] The wrong-delivery line keeps its evidence role with zero budget/score effect — decoupled before 3.3 specs the budget
- [ ] Docs and roadmap amended so 3.3 and 3.5 build against the final contract

## Out of Scope

| Feature | Reason |
|---|---|
| 3.3 budget wiring (8-complaint instant loss, HUD pulse, desk report) | Separate cycle; 3.D only shrinks its trigger scope |
| Final `SETTLE_TARGET` calibration | 3.5 exit-bot balance gate (§7 precedent: provisional until proven) |
| Removing coverage telemetry (FR-23 sampling) | Coverage stays as KPI/telemetry; only its win-check role dies |
| Any suitcase carry/placement/interception change | 3.B mechanics are explicitly untouched |
| Walkie line text changes | The manager line stays verbatim; only its coupling changes |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| Budget fate | Counts trash-discovery complaints only | User decision — wrong deliveries stop damaging; budget keeps meaning "caught sabotaging" | y |
| Scoring role | Points decide the winner (replaces coverage% in §6.6) | User decision — staff win = saboteur fired or score ≥ target | y |
| Wrong-delivery signal | Building-wide line fires at guest arrival, text unchanged | User decision — keeps the evidence beat and honest-mistake feedback without the penalty | y |
| `SETTLE_TARGET` values | 4p 5 / 5p 7 / 6p 9 (~60% of cadence-expected arrivals), provisional | §7 precedent: dials lock only after the 3.5 bot gate | n |
| Win-reason strings | `coverage-met`/`coverage-failed` renamed `settle-target-met`/`settle-target-failed` | The old names would lie; rename is reviewed against the message registry in Design | n |
| Self-assigned settles count | Impatient guests who self-assign and settle count toward the score | Server-truth settle of a real guest; indistinguishable in spirit from a delivered one | n |
| Score visibility | Public counter (saboteur sees the HUD too) | Settle lines are already building-wide walkie facts; no hidden state | n |
| Score scope | One team score, not per-player points | "Points decide winner" decided; per-player competition was rejected as incentive-changing | y |

**Open questions:** none — all resolved or logged above (provisional rows are
defaults with recorded rationale; the 3.5 gate owns the final values).

## User Stories

### P1: Settle score drives the buzzer verdict ⭐ MVP

**User Story**: As a player, I want correct deliveries to build a visible
team score that decides the round, so that delivery work has direct win
pressure and wrong deliveries cost time instead of loss budget.

**Why P1**: This is the contract swap everything else (3.3, 3.5) builds on.

**Acceptance Criteria**:

1. The system SHALL maintain a per-round staff settle score equal to the count of settled guests, reset to 0 at round start and non-decreasing within the round. <!-- ubiquitous -->
2. WHEN a guest settles into their assigned room via the suitcase path THEN the sim SHALL emit `guest:settled` and increment the settle score by exactly 1. <!-- event-driven -->
3. WHEN an impatient guest self-assigns a vacant room and settles THEN the settle SHALL count toward the score identically. <!-- event-driven -->
4. IF a wrong-delivery door complaint fires (arrival at a non-assigned resting room) THEN the sim SHALL keep the existing behavior (building-wide line, guest returns to dining, re-targets on next rest) and SHALL apply no score change and no loss effect. <!-- unwanted-behavior -->
5. WHEN the buzzer fires with the settle score ≥ `SETTLE_TARGET` THEN the sim SHALL end the round with winner `staff`, reason `settle-target-met`, in the same flush as the buzzer. <!-- event-driven -->
6. WHEN the buzzer fires with the settle score < `SETTLE_TARGET` THEN the sim SHALL end the round with winner `saboteur`, reason `settle-target-failed`. <!-- event-driven -->
7. The saboteur-fired and staff-attrition win legs SHALL remain unchanged. <!-- ubiquitous -->
8. IF the round is aborted THEN the sim SHALL emit no settle-target verdict (aborted result semantics unchanged). <!-- unwanted-behavior -->

**Independent Test**: `sim:win_checks` scenarios re-proven: buzzer with score
at/below target yields the two new verdicts; fired/attrition legs unchanged;
the `sim:wrong_delivery` free-misplacement pin (no complaint/loss/score-shaped
events) stays green.

### P2: Score HUD and recap

**User Story**: As a player, I want a live settle counter so that I can see
delivery progress against the target during the shift.

**Why P2**: The score only pressures behavior if it is legible mid-round;
the recap entry makes the verdict auditable after the fact.

**Acceptance Criteria**:

1. WHEN a settle event routes to a connected client THEN the client's score HUD SHALL display the updated count. <!-- event-driven -->
2. WHILE a round is running the score HUD SHALL render the count as `Settled N / T` (N = current score, T = `SETTLE_TARGET`). <!-- state-driven -->
3. WHEN a round ends with a settle-target verdict THEN the recap SHALL include the final settle score and the target. <!-- event-driven -->
4. Coverage telemetry sampling (FR-23) SHALL remain in place unchanged. <!-- ubiquitous -->

**Independent Test**: `client:score_hud` harness scenario — settle events
drive the counter; recap shows the final numbers.

### P3: Contract & docs amendment

**User Story**: As a maintainer, I want prd/roadmap/STATE to reflect v1.5 so
that cycles 3.3 and 3.5 spec against the final contract.

**Why P3**: Repo rule — product-contract changes are recorded decisions.

**Acceptance Criteria**:

1. The repository SHALL carry the prd v1.5 amendments (§6.6 win table, FR-29a budget note, FR-31 scope, §7 `SETTLE_TARGET` row replacing the coverage-target win dial, §8 KPI wording), the roadmap 3.D insert with the amended 3.3 scope, and AD-039 in `.specs/STATE.md`. <!-- ubiquitous -->

**Independent Test**: Docs diff review — every named section amended, AD
recorded with the proposal link.

## Edge Cases

- IF the buzzer fires while a guest is mid-walk (carrying or dining) THEN the guest SHALL not count toward the score (settles only).
- IF a guest settles into a trashed room THEN the settle SHALL count toward the score (SUI-16 silent settle stands; any trash complaint arrives via 3.3 independently).
- IF a carrier is fired by the carry clock THEN the re-queued guest SHALL produce no score change.
- IF a guest walk-out/disconnect re-queues the assignment THEN the void assignment SHALL produce no score change.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
|---|---|---|---|
| DLVR-01 | P1: Settle score | Design | Verified |
| DLVR-02 | P1: Settle score | Design | Verified |
| DLVR-03 | P1: Settle score | Design | Verified |
| DLVR-04 | P1: Settle score | Design | Verified |
| DLVR-05 | P1: Win verdict | Design | Verified |
| DLVR-06 | P1: Win verdict | Design | Verified |
| DLVR-07 | P1: Win verdict | Design | Verified |
| DLVR-08 | P1: Win verdict | Design | Verified |
| DLVR-09 | P2: Score HUD | - | Verified |
| DLVR-10 | P2: Score HUD | - | Verified |
| DLVR-11 | P2: Recap | - | Verified |
| DLVR-12 | P2: Recap | - | Verified |
| DLVR-13 | P3: Docs | - | Verified |

**Coverage:** 13 total, 13 mapped to tasks, 0 unmapped.

## Success Criteria

- [ ] `pnpm typecheck` + `pnpm lint` green
- [ ] `pnpm test:sim` green — amended `sim:win_checks` verdicts, `sim:wrong_delivery` regression intact
- [ ] `pnpm test:client` green — `client:score_hud` scenario passes
- [ ] Docs amended (prd v1.5, roadmap, AD-039) and recorded in `.specs/STATE.md`
- [ ] Human 5-minute round check: score ticks on correct deliveries and the results screen reads score vs. target
