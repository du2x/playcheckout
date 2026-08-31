# Suitcase Transport Specification (cycle 3.B)

## Problem Statement

Cycle 3.2 made the desk a two-choice lie machine: the holder picks a silent
destination and a broadcast claim. Grilling (AD-032, prd v1.4) rejected the
model — it parks one staff member at the desk and gives the lie no
verification surface. The suitcase redesign makes the receiver a mobile
**carrier**, the assignment a server-seeded fact announced **building-wide**
at the check-in tick (AD-034 amendment — the contested gameplay is physical
interception of the suitcase, not information), and the suitcase a
**re-grabbable physical object** whose last resting room is the ground truth
the guest walks to. The walkie becomes the building's automatic, lie-free
lifecycle log; the announce lie is deleted with its framing surface.

## Goals

- [ ] Check-in hands the guest's suitcase to the receiver (one per player);
      carrying blocks work channels; accusation stays available.
- [ ] E places the suitcase at a room door / picks up a resting one — by
      anyone, saboteur included, self-regrab allowed.
- [ ] The guest waits in a lobby holding area (restaurant stub, 3.C) and
      follows the suitcase's last resting room; arrival is the tribunal:
      correct room → settle, wrong room → door complaint (no personal
      penalty, no entry).
- [ ] The 60s carry clock (fresh per pickup) fires the current carrier —
      the only personal foul.
- [ ] The assignment is announced building-wide exactly once — every player
      at the check-in tick (AD-034) — and never repeated.
- [ ] The walkie becomes a server-generated truthful lifecycle log;
      `walkie:broadcast` and the desk send flow are deleted.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Complaint counter, HUD pulse, 8-complaint instant loss, budget plumbing | Cycle 3.3 — 3.B ships the wrong-delivery complaint *trigger event* only; a guest settling into a trashed room still settles silently |
| Trash discovery inside a room (anger cue, fuzzy desk report, guest leaves) | Cycle 3.3 (FR-29(b) path) — untouched from 3.2's scope note |
| Mezzanine restaurant floor, `dining` phase, 15–30s dwell | Cycle 3.C — this cycle stubs the wait as a lobby holding area with no timer |
| Tenancy signs (FR-33), trash provenance (FR-32) | Cycle 3.4 |
| v1.4 §7 balance gate (interception-pace bot proof) | Cycle 3.5 — carry-clock dials stay provisional |
| Telemetry, guest-exit bots | Cycle 3.6 |
| Guest/suitcase art | 3.A workstream / art manifest |

---

## §7/AD deltas

From prd §7 v1.4 rows (locked values, provisional pending 3.5):
`CARRY_CLOCK_SECONDS = 60`. Restaurant dwell is 3.C. The v1.4
`DESK_EARSHOT_TILES` row was removed by AD-034 (building-wide notice — no
earshot dial exists).

New §7-external constants (recorded as AD-033 at design close):
`ROOM_DOOR_RANGE_TILES = 1` (E place/pickup range of a room door x),
`GUEST_HOLD_START_TILES = 18` (holding-area slots start 3 tiles east of the
desk — outside the desk zone), spacing reuses `GUEST_QUEUE_SPACING_TILES = 1`.

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Assignment rule | Uniform random **vacant** room via the guest Rng stream at check-in; the assignment **reserves** the room (vacancy excludes assigned-or-tenanted rooms) until settle or void | Same selection rule as self-assign; two checked-in guests must never share a room | n (assumed) |
| Tenancy commit | Tenancy commits at guest **settle** (arrival at the assigned room), not at check-in | The suitcase is the claim; settle is the fact — mirrors "the outcome triggers at guest arrival" | y (proposal §9) |
| Wrong-delivery aftermath | The guest complains at the door and **returns to the holding area**, re-targeting on the suitcase's next rest event | A guest who left the hotel would make every mis-placement terminal and starve the dwell economy; correction-after-arrival stays possible, the complaint is the cost | n (autonomous-run default; neither prd FR-29(a) nor proposal §9 says the guest leaves) |
| Complaint dedup | One complaint per wrong **arrival**; no dedup across arrivals | Re-placing at the same wrong room re-walks the guest and re-complains — the intended pressure (trash race) | n (assumed) |
| Carry clock scope | Runs only during a carry leg (check-in → first placement; fresh on every pickup); a resting suitcase's clock is stopped; expiry fires the **current carrier** | Literal §7 row reading ("60s per leg") | y (prd §7) |
| Carry-clock expiry path | Justice teardown (`player:fired`), then suitcase rests at the desk, guest re-queued to the front, assignment void + reservation released, impatience resumes | Roadmap 3.B row; reuses the fired teardown machinery | y (roadmap) |
| Receiver already carrying | A player carrying a suitcase cannot check in another guest (one suitcase per player) | "One suitcase per player" is literal | y (roadmap) |
| Receive while working | A player with an active work channel MAY check in; the channel completes; carrying blocks **starting** work only (FR-9a letter: "cannot start a work channel") | Narrowest reading of FR-9a; no mid-channel teardown | n (assumed) |
| Assignment notice reach | EVERY connected player receives `guest:assigned` at the check-in tick ('all' policy, AD-034); announced exactly once, never repeated | "O aviso é para todos players" — the saboteur learns the assignment for free; interception of the suitcase is the counterplay (user-confirmed consequence) | y (AD-034) |
| Placement surface | `suitcase:placed {guestId, floor, roomIndex}` — sameFloor policy; **no walkie line, no building-wide event**; cross-floor staff learn a placement only via later lifecycle facts | Proposal "placement is silent" | y (proposal) |
| Place target validation | Server validates carrier's floor + |x − roomDoorX(room)| ≤ `ROOM_DOOR_RANGE_TILES`; mismatches ignored silently | Mirrors the desk-zone server-side validation pattern | n (assumed) |
| Pickup selection | No-arg intent; server picks the nearest resting suitcase on the player's floor within `ROOM_DOOR_RANGE_TILES`; ties → lowest guest id (deterministic) | Two resting suitcases at adjacent doors are possible; intent-arrival determinism needs a rule | n (assumed) |
| Guest waiting position | Holding-area slot i = `GUEST_HOLD_START_TILES + i × GUEST_QUEUE_SPACING_TILES` on the lobby floor (east of the desk); slots recomputed on membership change only | Stub for 3.C's restaurant; deterministic and off the desk zone | n (assumed) |
| Guest mid-walk pickup | Guest continues to the old room and waits at its door; on the next rest event they (re)target the resting room | Proposal step 8 letter | y (proposal) |
| Self-assign path | Unchanged from 3.1: impatience times only the check-in wait; self-assigned guests never get suitcases | FR-28 v1.4 re-scope | y (prd) |
| Buzzer | Suitcases die with the round (no post-buzzer carries); teardown reuses existing round-end paths | Consistent with GUEST-11 guest death at buzzer | n (assumed) |
| Snapshot for late joiners | Resting suitcases ride the movement snapshot (sameFloor filtered like guests); carried suitcases are derived from the carrier position stream | Joiners must see resting suitcases without history | n (assumed) |

**Open questions:** none — all resolved or logged above (autonomous run;
gray areas pre-answered by AD-032 + proposal v2, remainder recorded as
assumed defaults).

---

## User Stories

### P1: Check-in hands off the suitcase ⭐ MVP

**User Story**: As a staff member, I want to check in the queued guest at the
desk and take their suitcase, so that routing becomes a delivery I perform —
not a broadcast I dictate.

**Why P1**: The handoff is the cycle's foundation; every other mechanic
(carrier, notice, clock, guest-following) hangs off it.

**Acceptance Criteria** (EARS):

1. WHEN a player presses E within `DESK_RANGE_TILES` of the desk AND at least
   one guest is queued AND the player carries no suitcase THEN the sim SHALL
   check the guest in: seed the assignment (uniform random vacant room, guest
   Rng stream; the assignment reserves the room), make the player the
   suitcase's carrier (start the first carry leg), and move the guest to the
   holding area (patient — the impatience clock no longer applies). <!-- event-driven -->
2. IF the player already carries a suitcase THEN a desk E press SHALL be
   ignored silently. <!-- unwanted-behavior -->
3. WHEN check-in completes THEN the sim SHALL emit the assignment notice
   (`guest:assigned`, 'all' policy — AD-034) exactly once, at the check-in
   tick, to every connected player — never repeated. <!-- event-driven -->
4. The system SHALL NOT transmit the assignment at any later time via any
   surface (announced once at check-in; message-only rule). <!-- ubiquitous -->
5. The system SHALL NOT derive any outcome from anything but the assignment's
   server truth (there is no claim input left to lie with). <!-- ubiquitous -->
6. Self-assignment of unchecked guests SHALL remain exactly the 3.1 behavior
   (uniform random vacant room, direct walk, no suitcase). <!-- ubiquitous -->

**Independent Test**: Scripted sim scenario — guest queues, player checks in;
assert the assignment notice reaches every recipient page exactly once, and
the reservation excludes the assigned room from a later self-assign roll
(`sim:assignment_announce`).

---

### P1: Carry, place, pick up ⭐ MVP

**User Story**: As any player, I want to place a carried suitcase at a room
door or pick up a resting one — whoever I am — so that delivery is contested
physical play, not a desk monopoly.

**Why P1**: The re-grabbable object is the redesign's core; interception is
the only defense against mis-placement.

**Acceptance Criteria**:

7. WHEN a carrier presses E within `ROOM_DOOR_RANGE_TILES` of a room's door x
   on their floor THEN the sim SHALL rest the suitcase at that doorway (emit
   `suitcase:placed`, sameFloor; stop the carry clock; emit **no walkie
   line**). <!-- event-driven -->
8. WHEN a player who carries no suitcase presses E within
   `ROOM_DOOR_RANGE_TILES` of a resting suitcase on their floor THEN the sim
   SHALL make them the carrier with a fresh carry leg (emit
   `suitcase:picked_up` + its walkie line) — regardless of role; self-regrab
   is allowed. <!-- event-driven -->
9. IF the acting player already carries a suitcase THEN place and pickup
   intents SHALL be ignored silently. <!-- unwanted-behavior -->
10. IF a place intent names a room whose door x is out of range on the
    carrier's floor THEN the sim SHALL ignore it silently. <!-- unwanted-behavior -->
11. WHILE a player carries a suitcase THEN the sim SHALL reject their
    work-channel starts (FR-9a) while accusation and elevator calls remain
    available; an already-active channel SHALL run to completion. <!-- state-driven -->
12. The suitcase SHALL ride the carrier's position (presentation-level; no
    new movement authority) and be visible under the sameFloor positional
    rules. <!-- ubiquitous -->

**Independent Test**: Scripted sim scenario — check in, walk to a room door,
place (assert rest state + silence on the walkie surface), second player
picks up (assert fresh leg + carrier change), carrier tries `work:start` and
is rejected, accuses fine (`sim:suitcase_carry`).

---

### P1: The guest follows the suitcase ⭐ MVP

**User Story**: As the hotel, I want the guest to walk to wherever their
suitcase actually rests, so that the delivery — not anyone's word — decides
the outcome.

**Why P1**: The arrival outcome is the tribunal that replaced the walkie lie.

**Acceptance Criteria**:

13. WHEN a suitcase rests at a room THEN the guest SHALL walk toward that
    room, tracking its last resting room; IF the suitcase is picked up
    mid-walk THEN the guest SHALL continue to the previously resting room and
    wait at its door until the next rest event (then re-target). <!-- event-driven -->
14. WHEN the guest arrives at the door of the room where their suitcase
    currently rests THEN IF the room equals the assignment THEN the guest
    SHALL settle (tenancy commits; dwell → checkout churn unchanged) ELSE the
    guest SHALL complain at the door — a building-wide event naming the room
    and the guest, never the assignment — and return to the holding area,
    re-targeting on the suitcase's next rest event. <!-- event-driven -->
15. The system SHALL NOT attach any personal penalty to a placement: no
    firing, no marker, no event distinguishing the placer. <!-- unwanted-behavior -->
16. IF the settling room is trashed THEN the guest SHALL settle silently in
    3.B (the discovery cost lands in cycle 3.3). <!-- unwanted-behavior -->
17. IF the guest is walking when the buzzer fires THEN they SHALL die with
    the round (GUEST-11, unchanged). <!-- unwanted-behavior -->

**Independent Test**: Scripted sim scenario — check in, place at a wrong
room, let the guest arrive: assert the complaint names the room, the guest
returns to the holding area, then re-place correctly and assert settle +
tenancy (`sim:wrong_delivery`).

---

### P2: The carry clock

**User Story**: As the hotel, I want a suitcase held too long to fire its
carrier, so that stalls and hoarding have a personal cost — and only then.

**Why P2**: The clock is the only personal foul in v1.4; everything else
(mis-placement included) is free.

**Acceptance Criteria**:

18. WHEN `CARRY_CLOCK_SECONDS` (60s) elapse on a suitcase's current carry leg
    THEN the sim SHALL fire the current carrier through the justice teardown
    path (`player:fired`; reason internal), rest the suitcase at the desk,
    re-queue the guest at the front (impatience resumes), and void the
    assignment (reservation released; re-assigned at re-check-in). <!-- event-driven -->
19. The carry clock SHALL run only while the suitcase is carried; resting
    stops the leg; every pickup starts a fresh leg. <!-- state-driven -->
20. IF the carrier is fired (carry clock or accusation), ghosted, or
    disconnects mid-carry THEN the sim SHALL rest the suitcase at the desk,
    re-queue the guest at the front, and void the assignment — identical to
    AC18's aftermath. <!-- unwanted-behavior -->

**Independent Test**: Scripted sim scenario — check in with a test-scaled
clock, hold past expiry: assert the carrier fires, the suitcase rests at the
desk, and the guest re-queues with impatience running (`sim:carry_clock`).

---

### P2: The walkie becomes the lifecycle log

**User Story**: As a player, I want the walkie to read out true
guest-lifecycle facts automatically, so that the radio is trustworthy and
placement stays off the air.

**Why P2**: Deleting the authorable broadcast is what makes the overhear the
only assignment source and the log a verification surface.

**Acceptance Criteria**:

21. WHEN a guest-lifecycle fact fires (arrival, impatience, check-in, pickup,
    settle, complaint, checkout) THEN every client SHALL render the
    corresponding server-generated walkie line — placement SHALL emit none. <!-- event-driven -->
22. The `walkie:broadcast` message, the `desk:send` intent, and every client
    send-menu surface SHALL be deleted — no client can author a line. <!-- unwanted-behavior -->
23. The walkie log SHALL keep its last-5-lines DOM contract. <!-- ubiquitous -->

**Independent Test**: Scripted sim scenario — run a guest through
check-in → pickup → settle and assert the emitted lifecycle event set and the
absence of any placement/broadcast event (`sim:suitcase_carry` extensions).

---

### P2: Client suitcase slice

**User Story**: As a player, I want readable suitcase affordances — markers,
an E priority ladder, and the building-wide assignment notice — so that
carrying feels physical and placements are direct (AD-034).

**Why P2**: The interaction matrix is the client-heavy half of the redesign;
gray-box DOM per the phase rules.

**Acceptance Criteria**:

24. The client SHALL render a suitcase marker riding the carrier, or resting
    at the doorway — sameFloor visibility only; a rest position is the room
    segment center, i.e. IN FRONT OF THE DOOR (AD-034(c) pin). <!-- state-driven -->
25. The client SHALL resolve E by the priority ladder: desk zone receive →
    elevator call (at a landing, carrying or not) → place (carrying, at a
    room door) → pickup (not carrying, near a resting suitcase) → otherwise
    elevator call / accuse hold; room doors and landings are spatially
    disjoint so the order only breaks ties. A carrier at a door ALWAYS places
    directly — the blind-place confirm was removed with the earshot model
    (AD-034(b), SUI-26 dropped). <!-- state-driven -->
26. DROPPED (AD-034): the blind-place confirm cannot trigger once
    assignments are building-wide — every client has heard every guest's
    room. <!-- unwanted-behavior -->
27. The assignment surface is the building-wide announce walkie line ("a
    guest announces: I'm in F:R") rendered by every client at the check-in
    tick (AD-034); the owned suitcase marker naming the room is a
    convenience surface for the carrier. No other surface SHALL name a
    suitcase's room before a settle or complaint. <!-- ubiquitous -->

**Independent Test**: Playwright scenario — real server + client; check in,
see the announce line on EVERY page, the owned marker name the room for the
carrier, place directly at a door (no confirm exists); assert the walkie
lines render on all pages and no placement line ever appears
(`client:suitcase`).

---

## Edge Cases

- IF two players press E the same tick (any suitcase/desk intent) THEN the
  sim resolves deterministically in intent-arrival order; losers are ignored
  silently.
- IF a guest's suitcase is picked up while the guest is settling (same tick
  race) THEN the settle outcome resolves first (arrival precedes the rest
  change in tick order).
- IF the assigned room's reservation is voided (carrier fired) THEN a later
  check-in may re-assign that room to another guest.
- IF every room is tenanted or reserved at check-in THEN the assignment roll
  falls back to the self-assign rule's "no vacant room" behavior (3.1 path).
- IF a resting suitcase's room is the guest's current wait-at door THEN the
  next rest event there triggers immediate arrival resolution.
- IF a guest self-assigns while another guest's suitcase rests at the same
  room THEN both proceed independently (reservation only blocks assignment
  rolls, not rest positions).
- IF a spectator (fired) player is connected at a check-in THEN they receive
  the building-wide assignment notice like everyone else (AD-034(e) — the
  saboteur-gets-it-free consequence, user-confirmed).
- IF a guest self-assigns while another guest's suitcase rests at the same
  room THEN both proceed independently (reservation only blocks assignment
  rolls, not rest positions).

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SUI-01 | P1 check-in | Design | Implemented (T2) |
| SUI-02 | P1 check-in | Design | Implemented (T2) |
| SUI-03 | P1 check-in | Design | Implemented (T1/T2) |
| SUI-04 | P1 check-in | Design | Implemented (T1/T2) |
| SUI-05 | P1 check-in | Design | Implemented (T2–T5) |
| SUI-06 | P1 check-in | Design | Implemented (T2) |
| SUI-07 | P1 carry/place | Design | Implemented (T2) |
| SUI-08 | P1 carry/place | Design | Implemented (T2) |
| SUI-09 | P1 carry/place | Design | Implemented (T2) |
| SUI-10 | P1 carry/place | Design | Implemented (T2) |
| SUI-11 | P1 carry/place | Design | Implemented (T2) |
| SUI-12 | P1 carry/place | Design | Implemented (T2) |
| SUI-13 | P1 guest-follows | Design | Implemented (T3) |
| SUI-14 | P1 guest-follows | Design | Implemented (T3) |
| SUI-15 | P1 guest-follows | Design | Implemented (T3) |
| SUI-16 | P1 guest-follows | Design | Implemented (T3) |
| SUI-17 | P1 guest-follows | Design | Implemented (T3) |
| SUI-18 | P2 carry clock | Design | Implemented (T3) |
| SUI-19 | P2 carry clock | Design | Implemented (T3) |
| SUI-20 | P2 carry clock | Design | Implemented (T2) |
| SUI-21 | P2 walkie log | Design | Implemented (T2/T4) |
| SUI-22 | P2 walkie log | Design | Implemented (T2/T4) |
| SUI-23 | P2 walkie log | Design | Implemented (T2/T4) |
| SUI-24 | P2 client | Design | Implemented (T5) |
| SUI-25 | P2 client | Design | Implemented (T5) |
| SUI-26 | P2 client | Design | Dropped (AD-034 — confirm removed) |
| SUI-27 | P2 client | Design | Implemented (T5, amended AD-034) |

**Coverage:** 27 total, 26 implemented + 1 dropped by AD-034 (SUI-26).

## Success Criteria

- [ ] Gates 1–3 green: `pnpm typecheck` + `pnpm lint`; `pnpm test:sim` incl.
      `sim:suitcase_carry` / `sim:assignment_announce` / `sim:carry_clock` /
      `sim:wrong_delivery`; `pnpm test:client` incl. `client:suitcase`.
- [ ] Leak audit: the assignment rides the wire exactly once per guest (the
      building-wide `guest:assigned` notice, AD-034), and no payload ever
      names a resting suitcase's room to players off its floor before a
      settle/complaint line.
- [ ] New constants (`ROOM_DOOR_RANGE_TILES`, `GUEST_HOLD_START_TILES`)
      recorded as AD-033; §7 v1.4 rows consumed, none edited — the
      `DESK_EARSHOT_TILES` row removed by AD-034.
