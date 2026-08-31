# Front Desk Specification (cycle 3.2)

## Problem Statement

Cycle 3.1 delivered guests as weather, but the desk is decorative: every guest
self-assigns after 20s. FR-27 makes the desk the social-information core — the
place where guests are received and sent off with a **mandatory walkie
broadcast** whose room claim is the broadcaster's *statement*, not server
truth. The saboteur's walkie lie (announce 305, send them to trashed 204)
needs a ground truth to lie against: the guest's observable walk.

## Goals

- [ ] The desk receives and releases guests (E, contextual); holding pauses
      impatience — manning the desk is the way to stop self-assignment.
- [ ] Sending requires two independent choices: the guest's real destination
      (server-truth, never on the wire) and the announced room (the walkie
      claim, building-wide). The lie is structurally possible.
- [ ] The routed guest walks to the destination as a 3.1 elevator citizen —
      the observable ground truth.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Complaints, budget, anger cue, flee (FR-29/30/31) | Cycle 3.3; a guest routed into a trashed room still settles silently |
| Tenancy signs, walkie verification at a distance (FR-33) | Cycle 3.4; the lie is checkable only by eyes-on in 3.2 |
| Trash provenance display (FR-32) | Cycle 3.4 |
| Pure-noise broadcasts (claim without a guest) | User decision: send-only — the walkie exists only as part of sending a held guest |
| Guest expressiveness art | AD-020 workstream |
| Telemetry | Cycle 3.6 |

---

## §7/AD deltas

New §7-external constant `DESK_RANGE_TILES = 1` (the E receive/release zone;
AD-029 at design close). No §7 rows change.

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Lie mechanic | Two independent choices: destination (silent, server-truth) + announced room (the claim). Guest walks to the destination | User decision; the only reading under which FR-27's lie sentence is literally true | y |
| Receive control | E at the desk (±1 tile) with a queued guest receives; E again or walking out releases. Contextual E: inside the desk zone E never accuses | User decisions | y |
| Send flow UX | Receiving opens the gray-box send menu (destination list → announce list); completing it sends; E again / walking out releases and closes it | Synthesizes "E again releases" with the two-choice send; client staging is gray-box | n (assumed) |
| Send-only broadcasts | No guest, no broadcast | User decision | y |
| Destination into an occupied room | Rejected silently; the holder keeps the guest (tenancy map stays 1 guest/room) | Two guests in one room is physical nonsense; staff never need it | n (assumed) |
| Holder lost mid-hold | Fired or disconnected holder → the guest returns to the queue front (impatience resumes) | Mirrors the walk-out release; no orphaned guests | n (assumed) |
| Multiple holders | Each holder holds at most one guest; distinct guests may be held by distinct players simultaneously | From the receive/release decision | y |
| Impatience pause | The timer freezes while held and resumes where it paused on release (never resets) | From the receive/release decision | y |
| Held guest position | The held guest stands at their current desk slot; the queue does not shift while a guest is held | Cheapest deterministic model; slots only recompute on queue membership change | n (assumed) |
| Routing event surface | `guest:routed {guestId, playerId}` ('all') marks the departure and names the sender; the DESTINATION never rides the wire (leak rule — the lie must be client-invisible) | FR-27: the walk is the only ground truth | n (assumed) |
| Walkie claim surface | `walkie:broadcast {playerId, room}` ('all', building-wide, prd-locked text format «Name»: guest going to R) | prd FR-27 letter | y (prd) |
| E tap vs hold at the desk | The tap receives/releases; the hold window (accuse) is suppressed inside the desk zone entirely | Contextual-E decision taken to its conclusion; accusing someone at the desk requires stepping out of the zone | n (assumed) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Receive, hold, release ⭐ MVP

**User Story**: As a staff member, I want to receive the queued guest at the
desk and hold them there so that nobody gets gambled into a random room while
the desk is manned.

**Why P1**: Receiving is the precondition for routing and the counter to the
impatience gamble; without it the desk is decorative.

**Acceptance Criteria** (EARS):

1. WHEN a player presses E within `DESK_RANGE_TILES` (1 tile) of the desk AND
   at least one unheld guest is queued THEN the sim SHALL hand them the front
   queued guest (the guest leaves the queue; a holder holds at most one
   guest) and pause that guest's impatience timer. <!-- event-driven -->
2. IF the queue is empty or every queued guest is already held THEN an E press
   in the desk zone SHALL be ignored silently. <!-- unwanted-behavior -->
3. WHEN a holder walks out of the desk zone or presses E again THEN the sim
   SHALL return their held guest to the queue front, resuming the guest's
   impatience timer exactly where it paused. <!-- event-driven -->
4. WHILE a guest is held THEN the guest SHALL stand at the desk and SHALL NOT
   self-assign (the 3.1 impatience fallback applies only to unheld guests).
   <!-- state-driven -->
5. IF the holder is fired or disconnects mid-hold THEN the sim SHALL release
   their held guest to the queue front (impatience resumes). <!-- unwanted-behavior -->

**Independent Test**: Scripted sim scenario — guest queues, player walks to
the desk, E receives (impatience timer frozen past the 20s mark), walk out →
guest back at the queue front, impatience fires shortly after (`sim:desk_receive`).

---

### P1: Send with a claim that can lie ⭐ MVP

**User Story**: As the saboteur, I want to send a received guest to any room
while announcing a different one on the walkie, so that the hotel blames churn
on empty rooms while I look helpful.

**Why P1**: The walkie lie is FR-27's core — the desk becomes the
social-information core only if the claim is untrustworthy.

**Acceptance Criteria**:

6. WHEN a holder completes the send flow (destination room + announced room,
   one intent) THEN the sim SHALL route the guest — they walk to the
   destination as a 3.1 elevator citizen — and broadcast the claim
   `«Name»: guest going to R` to every player (building-wide), releasing the
   queue slot. <!-- event-driven -->
7. The system SHALL NOT derive the guest's walk from the broadcast claim —
   destination and announcement are independent inputs, and the walk is the
   only server truth (FR-27). <!-- ubiquitous -->
8. The system SHALL NOT validate that the announced room equals the
   destination: a claim naming one room while the guest walks to another SHALL
   be accepted (the lie; no error, no event distinguishing it). <!-- unwanted-behavior -->
9. IF the destination room is currently tenanted (occupied by a settled
   guest) THEN the sim SHALL reject the send silently — the holder keeps the
   guest and the menu stays open. <!-- unwanted-behavior -->
10. The walkie claim SHALL be attributable — it names the broadcaster — and
    the routing itself SHALL NOT carry the destination anywhere on the wire
    (only the guest's observable walk reveals it). <!-- ubiquitous -->

**Independent Test**: Scripted sim scenario — receive a guest, send with
destination floor2:4 while announcing floor1:8; assert the claim event names
floor1:8, the guest's walk ends at floor2:4's door, and no wire payload names
floor2:4 (`sim:walkie_broadcast`, `sim:walkie_lie`).

---

### P2: Client desk slice

**User Story**: As a player, I want a readable desk flow — a receive hint, a
two-step send menu, and walkie traffic as a named line — so that routing feels
like operating the hotel radio.

**Why P2**: The desk is a UI-heavy surface; gray-box DOM per the phase rules.

**Acceptance Criteria**:

1. WHILE the local player stands in the desk zone AND a guest is queued THEN
   the client SHALL show the receive hint; receiving opens the send menu
   (destination list → announce list) and E again or leaving the zone releases
   and closes it. <!-- state-driven -->
2. WHEN a walkie claim fires THEN every client SHALL render the named walkie
   line (DOM, building-wide). <!-- event-driven -->
3. The client SHALL offer no surface naming a routed guest's destination —
   only the walkie claim text exists (the lie must be client-invisible).
   <!-- ubiquitous -->

**Independent Test**: Playwright scenario — real server + client; receive a
guest at the desk, send with a lying announce; assert the walkie line shows
the claimed room on all pages while the guest marker walks to the other floor
(`client:desk_walkie`).

---

## Edge Cases

- IF the holder completes the send in the same tick another player releases
  their guest THEN both intents resolve independently (per-holder state; no
  shared queue mutation order hazard — holders map is per-player).
- IF the announced room equals the destination THEN nothing special happens —
  that is the honest case (majority traffic).
- IF a routed guest's walk is interrupted by the buzzer THEN they die with the
  round (GUEST-11, unchanged).
- IF a guest is routed to the room they would have self-assigned THEN the
  outcome matches the 3.1 path minus the impatience gamble.
- IF two players press E in the desk zone the same tick for one queued guest
  THEN the sim SHALL resolve deterministically in intent-arrival order (first
  intent wins; the second E press is an E-again release for a non-holder —
  ignored silently).
- IF the saboteur holds the guest THEN everything behaves identically (the
  desk is role-blind; the lie is the saboteur's tool, not a role check).

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| DESK-01 | P1 receive | Design | Pending |
| DESK-02 | P1 receive | Design | Pending |
| DESK-03 | P1 receive | Design | Pending |
| DESK-04 | P1 receive | Design | Pending |
| DESK-05 | P1 receive | Design | Pending |
| DESK-06 | P1 send | Design | Implemented (T2) |
| DESK-07 | P1 send | Design | Implemented |
| DESK-08 | P1 send | Design | Pending |
| DESK-09 | P1 send | Design | Pending |
| DESK-10 | P1 send | Design | Implemented |
| DESK-11 | P2 client | Design | Pending |
| DESK-12 | P2 client | Design | Pending |
| DESK-13 | P2 client | Design | Pending |

**Coverage:** 13 total, 0 unmapped.

## Success Criteria

- [ ] Gates 1–3 green: `pnpm typecheck` + `pnpm lint`, `pnpm test:sim` incl.
      `sim:desk_receive` / `sim:walkie_broadcast` / `sim:walkie_lie`,
      `pnpm test:client` incl. `client:desk_walkie`.
- [ ] No wire payload ever names a routed guest's destination (leak-rule audit).
- [ ] New constant `DESK_RANGE_TILES` recorded as an AD; no §7 row changed.
