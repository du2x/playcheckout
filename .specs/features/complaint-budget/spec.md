# Complaint Budget Specification (cycle 3.3)

## Problem Statement

The guest economy (3.1–3.E) ships every trigger surface except the loss loop: guests
still settle silently into trashed rooms, no complaint ever fires from a discovery,
and the §7 complaint budget (8) has no sim or client existence. Cycle 3.3 lands the
evidence + loss loop — FR-29(b) trash-discovery complaints, FR-30 guests-never-convict,
FR-31 budget with instant loss — shrunk by v1.5 (AD-039) to trash-discovery complaints
only, and pins the 3.E ambush kill check (an ambush never creates a complaint).

## Goals

- [ ] A guest who arrives at their assigned room and finds trash storms out (in-world
      anger cue at the room), walks to the desk, delivers a fuzzy-timestamp report,
      and leaves the hotel — one complaint, no retry.
- [ ] Only trash-discovery complaints count toward the budget; the 8th is an instant
      staff loss wired into the §6.6 win checks, results view, and recap/resume.
- [ ] Guests never convict: entering mid-un-prep flees and complains, never fires the
      saboteur (FR-15 stays staff-only).
- [ ] The pinned ambush kill check: an ambush never creates a complaint — it only
      enables one already set up.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Tenancy signs (FR-33), recap complaint provenance (FR-22 as amended), trash authorship display (FR-32) | Cycle 3.4 `provenance-signs`; 3.3 ships the complaint **count** on recap/resume only |
| Telemetry complaint events with source + provenance (FR-23/24) | Cycle 3.6 `telemetry` |
| Coverage % HUD element (FR-14's third slot) | Coverage is telemetry/KPI since v1.5 (AD-039); no client work exists for it — not 3.3's surface |
| Guest expressiveness art (storm-out sheets) | AD-020 art workstream; gray-box anger cue + DOM cues only |
| §7 dial changes (budget 8, cadence, dwell) | Budget row unchanged; the shrunken budget's reachability is re-examined at the 3.5 gate (AD-039/AD-040) |
| prd amendments | 3.3 implements the v1.6 contract as written (FR-29/30/31 unchanged since v1.5); like 3.1/3.2, no prd bump |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Do guests complain about pristine (`fresh`) rooms — never prepped, no trash? | **No.** Complaints track trash only (`trashed` fresh-tier sabotage, `settled` aged/churn); `fresh` and `prepped` rooms settle silently | FR-29(b)'s trigger is "trash inside"; the 3.1 §8 preview reads "complaints then track the trashed-vacant pool"; the alternative re-widens the budget the v1.5 decoupling deliberately shrank — a tuning-shaped change that needs the 3.5 gate, not this cycle | n (assumed — flagged for 3.5) |
| Does the flee-during-un-prep complaint (FR-30) count toward the budget? | **Yes** — it follows the FR-29(b) complaint path, budget effect included | FR-30: "flees and follows the FR-29 complaint path"; the budget means "caught sabotaging" and a witnessed un-prep is the strongest form | n (assumed) |
| What happens to the complaining guest's resting suitcase? | It is **absorbed** (leaves play silently) at the discovery tick | The guest is gone and the assignment void — an orphaned suitcase has no game consequence; the dropCarry desk-absorb precedent (`guests.ts` SPEC_DEVIATION) already established "luggage is issued afresh, dead objects are removed" | n (assumed) |
| What is the "fuzzy-timestamp" of the desk report concretely? | The freshness tier the guest observed inside: fresh-tier trash or a witnessed un-prep → `fresh: true` ("maybe a minute ago"); aged/churn trash → `fresh: false` ("a while ago") | The guest legitimately saw the interior (FR-10/FR-12); FR-29(b)'s example line ("someone hit 305, maybe a minute ago") is exactly a freshness-tier testimony; the payload never names an actor | n (assumed) |
| Who sees the anger cue? | Same-floor recipients only (`sameFloor` policy) | In-world cue at the room — the GUEST-12 guest-visibility rule (guest presence is sameFloor-public); "room-number level, no detail" fits the payload `{guestId, floor, room}` | n (assumed) |
| Sim event/message naming for the two new rows | `guest:angered` (anger cue, sameFloor) and `guest:discovered` (desk report, all); `guest:complained` keeps its FR-29(a) wrong-delivery meaning | Past-tense domain events; the discovery and the door complaint are different domain beats with different payloads and budget effects — two rows beat an overloaded payload | n (assumed) |
| Does the 8th-complaint tie with the buzzer resolve to the budget? | Yes — budget loss wins the tie | Win checks precede the buzzer verdict in the tick (REND ordering); same-flush guarantee like every other win check | n (assumed) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Trash-discovery complaint loop ⭐ MVP

**User Story**: As the sim, I want a guest who walks into their assigned room and
finds trash to storm out, report at the desk, and leave the hotel so that sabotage
and neglected churn both leave a testimony-shaped footprint.

**Why P1**: The loss loop is the cycle's core — every other piece (budget, HUD,
pins) consumes this trigger.

**Acceptance Criteria** (EARS):

1. WHEN a guest arrives at the room where their assignment rests THEN the sim SHALL
   resolve the arrival against that room's interior: `trashed` or `settled` state, or
   an active un-prep channel in the room, triggers the complaint path; `prepped` and
   pristine `fresh` rooms settle exactly as before. <!-- event-driven -->
2. WHEN the discovery triggers THEN the sim SHALL emit the anger cue —
   `guest:angered` naming the guest, floor, and room, room-number level, no interior
   detail, no actor — delivered to same-floor recipients only. <!-- event-driven -->
3. WHEN the discovery triggers THEN the guest SHALL leave the room's interior and
   re-enter hall view at the room door, any reservation on the room SHALL release,
   and the guest's resting suitcase SHALL leave play — the room is vacant but
   trashed from the discovery tick. <!-- event-driven -->
4. WHEN the angered guest reaches the desk THEN the sim SHALL emit the
   trash-discovery complaint — `guest:discovered` naming the guest, floor, room, and
   the observed freshness tier (`fresh: true` for fresh-tier trash or a witnessed
   un-prep, `fresh: false` for aged/churn trash) — building-wide, and the guest
   SHALL leave the hotel in the same flush (despawn at the desk). <!-- event-driven -->
5. The system SHALL fire exactly one trash-discovery complaint per discovery: the
   guest never re-targets, re-enters a room path, or retries. <!-- ubiquitous -->
6. IF a guest's assigned room is `prepped` or pristine `fresh` at arrival THEN the
   guest SHALL settle exactly as before (+1 settle score, tenancy commits, seeded
   dwell). <!-- unwanted-behavior -->
7. IF a guest enters their assigned room while an un-prep channel is active in it
   THEN the guest SHALL flee along the complaint path with `fresh: true` testimony,
   and the channel's completion SHALL still land normally afterward. <!-- unwanted-behavior -->
8. IF a guest arrives at a room whose trash has aged past the freshness window or
   was spawned by checkout churn (`settled`) THEN the complaint SHALL carry
   `fresh: false` — churn bleeds the budget exactly like sabotage. <!-- unwanted-behavior -->
9. IF the discovery fires for a checked-in guest THEN the wrong-delivery path
   (FR-29(a): re-target to the dining area) SHALL NOT run — discovery leaves the
   hotel, it never re-queues. <!-- unwanted-behavior -->

**Independent Test**: Scripted sim scenarios — stage a prepped room, sabotage it,
route a suitcase guest there; assert the anger cue, the desk report with the right
freshness tier, the departure, the released reservation, the absorbed suitcase, and
that the settle score did not move (`sim:complaint`).

---

### P2: Complaint budget + instant loss

**User Story**: As a player, I want trash-discovery complaints to feed a visible
building-wide budget whose 8th complaint ends the round instantly, so that getting
caught sabotaging is the saboteur's clock.

**Why P2**: The budget is the §6.6 loss leg — without it the sim has no third loss
path and the HUD counter has no truth to count.

**Acceptance Criteria**:

1. The sim SHALL count only trash-discovery complaints (`guest:discovered`) toward
   the complaint budget (§7: 8) — wrong-delivery door complaints count toward
   nothing. <!-- ubiquitous -->
2. WHEN the 8th trash-discovery complaint fires THEN the sim SHALL end the round in
   the same flush: winner `saboteur`, reason `budget-exhausted`. <!-- event-driven -->
3. IF fewer than 8 trash-discovery complaints have fired THEN the round SHALL
   continue — no early end from the budget leg. <!-- unwanted-behavior -->
4. WHEN the round ends by budget exhaustion THEN `round:recap` SHALL carry the final
   complaint count alongside the settle verdict inputs. <!-- event-driven -->
5. WHEN a client reconnects mid-round THEN `round:resumed` SHALL carry the current
   complaint count so the HUD re-seeds. <!-- event-driven -->
6. IF the 8th complaint and the buzzer land in the same tick THEN the budget loss
   SHALL win the tie (win checks precede the buzzer verdict). <!-- unwanted-behavior -->
7. IF the round ends by any path while a guest is angered-walking THEN the guest
   SHALL die with the round (GUEST-11) and the count SHALL freeze at its final
   value. <!-- unwanted-behavior -->

**Independent Test**: Scripted sim scenarios — drive 7 discoveries (assert the round
continues), then the 8th (assert `round:ended` saboteur/`budget-exhausted` in the
same flush); assert wrong-delivery complaints never move the count
(`sim:budget_instant_loss`).

---

### P3: Guests never convict + ambush kill check

**User Story**: As the saboteur, I want guest encounters to stay testimony — never
justice — so that a guest walking in on my un-prep costs me one complaint, not the
round; and as the balance gate, I want the pinned property that an ambush never
*creates* a complaint.

**Why P3**: FR-30 and the AD-040 kill check are the cycle's safety rails; both are
spec-pinned properties the 3.5 balance gate stands on.

**Acceptance Criteria**:

1. The system SHALL NEVER fire a player from a guest encounter: a guest entering a
   room during an active un-prep never triggers walk-in conviction — FR-15 stays
   staff-only. <!-- ubiquitous -->
2. The system SHALL ensure an ambush never creates a complaint: an ambush with no
   pre-existing trash fires no complaint event and moves the budget by zero.
   <!-- ubiquitous -->
3. WHEN an ambush stuns the responders while a guest walks into already-laid trash
   THEN the complaint SHALL fire from the pre-existing trash — the stun enables, it
   never causes. <!-- event-driven -->

**Independent Test**: Scripted sim scenarios — a guest enters mid-un-prep (assert
the saboteur is not fired and the complaint path runs); a scripted ambush with no
trash (assert zero complaint events); an ambush plus pre-laid trash (assert the
complaint fires with the budget moving) (`sim:guest_never_convicts`, kill check
folded into `sim:complaint`).

---

### P4: Client complaint cues + HUD counter

**User Story**: As a player, I want the anger cue at the room, the desk-report line
in the walkie, and a complaint counter that pulses when the budget is close, so
that complaints read as story and clock, not just a number.

**Why P4**: The human gate — FR-14's complaint counter and the FR-29(b) two-stage
evidence beat need a visible surface; gray-box per the phase rules.

**Acceptance Criteria**:

1. WHEN a trash-discovery complaint arrives THEN the client SHALL increment the HUD
   counter (rendered `Complaints N / 8`) and render the walkie desk-report line with
   the fuzzy-timestamp flavor (fresh → "maybe a minute ago"; aged → "a while ago").
   <!-- event-driven -->
2. WHEN a wrong-delivery complaint arrives THEN the client SHALL render its walkie
   line and the counter SHALL NOT move. <!-- event-driven -->
3. WHEN the anger cue arrives (same-floor only — the transport gates delivery) THEN
   the client SHALL render the anger cue at the room's door for a short window.
   <!-- event-driven -->
4. WHILE the complaint count is ≥6 THEN the HUD counter SHALL pulse red (FR-14).
   <!-- state-driven -->
5. WHEN `round:resumed` arrives THEN the counter SHALL re-seed to the server's
   truth; WHEN `round:recap` arrives it SHALL freeze at the final value.
   <!-- event-driven -->
6. WHEN the results view renders a `budget-exhausted` loss THEN it SHALL name the
   budget exhaustion as the loss reason. <!-- event-driven -->

**Independent Test**: Node presenter tests (count/pulse/seed/freeze) + Playwright
harness — staged discovery via the sabotage path, assert counter, walkie line, anger
cue floor-gating, and that a staged wrong-delivery does not move the counter
(`client:complaint_cues`).

---

## Edge Cases

- IF a guest arrives while a staff prep channel is actively cleaning their assigned
  room THEN the state is still `trashed`/`settled` (states flip at channel
  completion only) → the discovery complaint fires; the staff member is never named.
- IF a guest arrives on the very tick the un-prep completes THEN work processing
  precedes guest processing in the tick, so the room reads `trashed` → discovery
  (fresh), not flee — same complaint either way.
- IF the angered guest is mid-walk when the buzzer fires THEN they die with the
  round; no complaint emits from a dead round.
- IF a self-assigned guest (no suitcase, no reservation) discovers trash THEN the
  path runs without the reservation/suitcase teardown.
- IF the discovery fires for a guest whose room was reserved at check-in THEN the
  reservation releases at the discovery tick — the room re-enters the vacancy pool.
- IF the guest's room is trashed AFTER their suitcase rests but BEFORE arrival THEN
  the arrival-tick state decides (discovery); interception realism is preserved.
- IF the saboteur's un-prep is cancelled (walk-out) after a guest fled it THEN the
  complaint stands — testimony, not retroactive justice.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| COMP-01 | P1 | Design | Pending |
| COMP-02 | P1 | Design | Pending |
| COMP-03 | P1 | Design | Pending |
| COMP-04 | P1 | Design | Pending |
| COMP-05 | P1 | Design | Pending |
| COMP-06 | P1 | Design | Pending |
| COMP-07 | P1 | Design | Pending |
| COMP-08 | P1 | Design | Pending |
| COMP-09 | P1 | Design | Pending |
| COMP-10 | P2 | Design | Pending |
| COMP-11 | P2 | Design | Pending |
| COMP-12 | P2 | Design | Pending |
| COMP-13 | P2 | Design | Pending |
| COMP-14 | P2 | Design | Pending |
| COMP-15 | P2 | Design | Pending |
| COMP-16 | P2 | Design | Pending |
| COMP-17 | P3 | Design | Pending |
| COMP-18 | P3 | Design | Pending |
| COMP-19 | P3 | Design | Pending |
| COMP-20 | P4 | Design | Pending |
| COMP-21 | P4 | Design | Pending |
| COMP-22 | P4 | Design | Pending |
| COMP-23 | P4 | Design | Pending |
| COMP-24 | P4 | Design | Pending |
| COMP-25 | P4 | Design | Pending |

**Coverage:** 25 total, 25 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] `sim:complaint`, `sim:guest_never_convicts`, `sim:budget_instant_loss` suites
      green; the ambush kill check pinned inside `sim:complaint`
- [ ] `client:complaint_cues` green twice consecutively at `--workers=2`
- [ ] Full ladder green: `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client`
- [ ] A 5-minute human round: a trashed assigned room produces cue → report →
      counter tick, and no conviction ever fires from a guest encounter
