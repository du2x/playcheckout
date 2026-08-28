# Elevator Riders Specification

Cycle 2.6 (inserted; `evidence` → 2.7, `justice` → 2.8, `round-end` → 2.9,
`telemetry` → 2.10 — AD-003/AD-006 precedent). Records **AD-013** (rider-exclusive
occupancy/press knowledge) and **AD-014** (call-model rework) in `.specs/STATE.md`.

## Problem Statement

Elevators work mechanically (2.4 + elevator-lobby) but are socially mute: a
co-rider learns nothing from sharing a 2-capacity box, and the call model couples
pickup and destination in one intent (`elevator:call {target}`), which produces
the wrong-way carry (AD-012 trade-off) and pre-commits trips nobody in the car
chose. The elevator is the strongest shared-knowledge moment in a hidden-
information game and it currently transmits nothing.

## Goals

- [ ] Riders learn who is in the car with them and who pressed which floor — and nobody else learns either from the wire (FR-6 panels stay position-only)
- [ ] Destinations are chosen inside the car via a press queue (FIFO, no cancel), not at call time; the uninformed wrong-way carry ceases to exist — calls carry no destination and the car's queue is always visible to its occupants (lit indicators)
- [ ] Stops are observable: doors open at every arrival (1s dwell), riders may stay in or walk off, empty cars serve pressed floors (ghost trips), a caller may summon a car and never board it
- [ ] All movement/elevator timing that exists today is preserved except where this spec explicitly changes it (dwell, open-door idle, press queue)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Door cards, rustle, room interiors | Cycle 2.7 `evidence` (FR-10–FR-13); this cycle's knowledge is positions, panels, occupancy, presses only |
| Recorded/surfaced ride evidence (recap, telemetry UI) | "In the moment only" — recap surfacing stays with `telemetry` (2.10); this cycle fixes event semantics, ships no evidence UI |
| Boarding/exiting announcements to bystanders | Exit is visible via the normal same-floor `player:moved` stream; boarding stays inferable (stream-stop). No new bystander-facing message |
| Press cancel / un-press | Ever-lit buttons; mispresses are livable and keep the queue rider-knowable |
| Directional collective service order | FIFO press order for v1; realism refinement only if playtests demand |
| In-car redirect intent | Superseded by the press queue — the press IS the redirect |
| Door-open cues pre-round decision | Belongs to 2.7 `evidence` (work channels are round-scoped) |
| Fired-player/spectator streams | Arrive in 2.8 `justice` |
| Any tuning change to arrive (3s), ride (2s/floor), capacity (2), landing tiles (1) | Locked §7 values; only `ELEVATOR_DWELL_SECONDS` is new |

---

## Assumptions & Open Questions

Every ambiguity was resolved by grilling (2026-08-28, user-confirmed) or is a
derived consequence of a confirmed answer; all rows below were explicitly
confirmed unless marked otherwise.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Concurrent presses | FIFO service queue (all presses served, in press order) — not last-press-wins, not directional | Real-elevator feel; zigzag is publicly trackable via panels | y |
| Nobody presses after pickup | Car idles with doors open at that floor; no auto-proceed, no timeout | No soft-lock (riders walk off, others board); a car never moves spontaneously — occupied-idle cars may still be drafted for calls when no empty idle car exists (dispatch prefers empty idle first; confirmed design review 2026-08-28) | y |
| Queue knowledge for late boarders / rejoiners | The press queue rides in the rider-exclusive payloads (`elevator:riders`, snapshot `carOccupants`) — car occupants always see it (lit indicators) | Real elevators show lit buttons from inside; closes blind inheritance; anchors the no-uninformed-carry goal (design review 2026-08-28) | y |
| Press visibility | `elevator:pressed {playerId, floor}` to that car's riders only; panels never show queue/targets | Attribution testimony ("it wasn't me"); public target would make tailing trivial | y |
| Rider at a served floor | Stay-in-car allowed; they may press another floor | User directive; requires open-door dwell to exit through | y |
| Call model change folded into this cycle | Yes — one cycle owns elevator semantics end-to-end | Press message and riders policy are the same protocol surface | y |
| Ghost trips (presser walks off, empty car serves) | Presses persist; the queue belongs to the car, not the presser | Visible empty car going somewhere is prime evidence; a free sabotage move | y |
| Duplicate press (floor already queued/being served) | Rejected silently — no `elevator:pressed` event | Keeps press testimony honest | y |
| Pressing the car's current floor | Rejected silently | Doors are already open — walk | y |
| Caller never boards | Car arrives, opens doors, dwell, nobody boards → idles open-doors there; same-floor re-call = decoy flash (duplicate pickup), calls from other floors dispatch normally | Only coherent reading now that calls carry no destination | y |
| Rider knowledge during movement snapshot | A rider-viewer's snapshot includes their car's occupants; non-rider snapshots never carry occupancy | Same knowledge as the live message, delivered at join/buzzer resync | y (derived, user confirmed) |
| Dwell length | `TUNING.ELEVATOR_DWELL_SECONDS = 1` (20 ticks) | Long enough to step off, short enough to feel like an elevator | y |
| Boarding stays silent to bystanders | No `elevator:boarded` message; inference from stream-stop suffices | FR-6 purity; a new message buys nothing | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Riders know their car ⭐ MVP

**User Story**: As a rider, I want to see who is in the elevator with me so that
sharing a car is a shared-knowledge event I can testify about later.

**Why P1**: The core product gap — the car is the game's strongest co-presence
moment and currently transmits nothing.

**Acceptance Criteria**:

1. WHEN a player boards a car THEN the system SHALL send every rider of that car (including the boarder) the car's current occupant list via the rider-exclusive policy <!-- event-driven -->
2. WHEN a rider walks off a car with open doors THEN the system SHALL send the remaining riders that car's updated occupant list <!-- event-driven -->
3. The system SHALL NOT include any car's occupant identities in any message sent to a player who is not a rider of that car, nor in any panel payload (FR-6, MOVE-16 preserved) <!-- ubiquitous -->
4. IF a viewer requests a movement snapshot while riding a car THEN the snapshot SHALL include that car's occupants for that viewer, and the system SHALL NOT include occupancy in any non-rider's snapshot <!-- unwanted-behavior -->
5. WHEN the occupant list is rendered THEN the client SHALL show it to the local player as a DOM chip near the elevator panel (1–2 names, visible only while riding) together with the car's press queue rendered as lit floor indicators, without changing the WorldScene rider-invisibility model <!-- event-driven -->

**Independent Test**: Two tabs board the same car — each shows both names' chip;
a third tab on the floor shows no occupancy anywhere (sim: exact `elevator:riders`
event arrays and snapshot branches; client: chip presence/absence across a ride).

---

### P2: In-car floor press queue ⭐ MVP

**User Story**: As a rider, I want to press a floor number inside the car so
that the car goes where its occupants decide, when they decide.

**Why P1 (ships with the cycle, separate story for traceability)**: The
destination-model rework — removes the wrong-way carry and makes the car's path
a product of in-car negotiation.

**Acceptance Criteria**:

1. WHEN a rider presses a floor that is neither queued nor being served and is not the car's current floor THEN the system SHALL append it to that car's press queue and emit `elevator:pressed {playerId, floor}` to that car's riders only <!-- event-driven -->
2. IF a rider presses a floor already queued, being served, or equal to the car's current floor THEN the system SHALL reject it silently (no event, no queue change) <!-- unwanted-behavior -->
3. IF a non-rider sends `elevator:press` THEN the system SHALL reject it silently <!-- unwanted-behavior -->
4. WHEN a car's dwell ends and its queue is non-empty THEN the car SHALL depart to the oldest queued floor at 2 s per floor traveled, and on arrival open doors, dwell, and remove that floor from the queue <!-- event-driven -->
5. WHEN the queue empties after a served floor THEN the car SHALL idle with doors open at that floor until a new press or dispatch occurs <!-- event-driven -->
6. WHEN a player calls an elevator THEN the system SHALL dispatch exactly as today (sooner car; among idle cars, empty ones are preferred first — closest landing, tie → car 1, occupied idle only when no empty idle car exists; overflow FIFO) except that the call SHALL NOT carry or imply a destination <!-- event-driven -->
7. IF a call arrives for a pickup floor a car is already en route to (or queued for) THEN the system SHALL emit the `elevator:called` flash without a new dispatch (duplicate predicate = pickup floor only, narrowing AD-012) <!-- unwanted-behavior -->
8. WHILE a car is moving THEN the system SHALL reject walk intents from its riders; WHILE doors are open (dwell or idle) THEN riders SHALL be able to walk off and candidates within `ELEVATOR_LANDING_TILES` of the car's landing SHALL be able to board up to capacity 2 (closest first, ties by playerId, overflow queues) <!-- state-driven -->
9. The system SHALL keep `elevator:called`/`elevator:moved` payloads exactly `{floor, car}`/`{car, floor}` — never queue contents, never occupancy, never press targets <!-- ubiquitous -->

**Independent Test**: Scripted sim scenario: two riders press different floors —
car serves both in press order at exact tick math; a decoy/duplicate press emits
nothing; a non-rider press is rejected; panels stay payload-clean.

---

### P3: Open-door stops, stays, ghosts, and abandoned pickups

**User Story**: As a player, I want elevator stops to be observable and
consequential — who stays, who bailed, whether anyone boarded at all — so that
the hallway tells stories.

**Why P1**: These are the sabotage/evidence surfaces this cycle exists to create;
they fall out of the open-door model the other stories require.

**Acceptance Criteria**:

1. WHEN a car arrives at a pickup floor or a served floor THEN it SHALL open doors and hold a dwell of exactly `ELEVATOR_DWELL_SECONDS` (1 s, 20 ticks) before departing or idling <!-- event-driven -->
2. WHEN a rider remains in the car at a served floor THEN they SHALL be able to press another floor and continue riding (stay-in-car; no forced exit) <!-- event-driven -->
3. WHEN every rider of a car walks off (dwell or idle) while presses remain queued THEN the car SHALL still depart and serve the queue (ghost trip) <!-- event-driven -->
4. WHEN a car arrives at a pickup floor and no candidate is within boarding range at boarding resolution THEN the pickup SHALL complete without riders and the car SHALL idle with doors open at that floor (caller-never-boards) <!-- event-driven -->
5. IF a call is made from the floor where a car is idling with open doors THEN the system SHALL treat it as a duplicate (decoy flash, no dispatch) — boarding and pressing is the way to move it <!-- unwanted-behavior -->
6. WHEN a rider exits through open doors THEN their position SHALL resume on the same-floor `player:moved` stream at the car's landing (exit is visible; boarding remains silent) <!-- event-driven -->

**Independent Test**: Sim scenario per behavior — stay-in-car rider presses a
second floor and rides on; presser walks off and the empty car serves; pickup
with nobody at the landing idles the car; same-floor re-call flashes without
dispatch; exit resumes the movement stream.

---

## Edge Cases

- IF a rider exits a car with open doors THEN they SHALL NOT re-board that car until the car next departs (door-open-episode guard) — exiting is final for the stop; exit itself is available in any phase (confinement applies to hallway walking after exit)
- IF a carried rider presses the car's pickup floor while the car is arriving THEN the press SHALL be rejected silently (the pickup floor is being served even though the queue is empty — no zero-tick rides)
- IF a rider presses during the dwell before departure THEN the press SHALL queue and the car SHALL depart to it when the dwell ends (pressing is never rejected for a rider by car state)
- IF both cars are busy when a call arrives THEN the system SHALL queue it sim-level FIFO and serve it with the first car to free (MOVE-15, unchanged)
- IF a queued call exists when a rider boards another car THEN that rider's own queued call SHALL be dropped (AD-012 #3, unchanged)
- IF the round buzzer (`lock()`) fires while trips are in flight or presses queued THEN service SHALL continue across the buzzer exactly as AD-011 established for calls (queue not cleared)
- IF a rider is boarding-resolved during a dwell while another rider walks off in the same tick THEN boarding/exiting resolution SHALL be deterministic (design fixes the order; tests pin it)
- IF a fresh player joins while a car is mid-trip THEN their snapshot SHALL show the car's position (panels are public) and SHALL NOT show its occupancy or queue

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ELR-01 | P1 | Design | Pending |
| ELR-02 | P1 | Design | Pending |
| ELR-03 | P1 | Design | Pending |
| ELR-04 | P1 | Design | Pending |
| ELR-05 | P1 | Design | Pending |
| ELR-06 | P2 | Design | Pending |
| ELR-07 | P2 | Design | Pending |
| ELR-08 | P2 | Design | Pending |
| ELR-09 | P2 | Design | Pending |
| ELR-10 | P2 | Design | Pending |
| ELR-11 | P2 | Design | Pending |
| ELR-12 | P2 | Design | Pending |
| ELR-13 | P2 | Design | Pending |
| ELR-14 | P3 | Design | Pending |
| ELR-15 | P3 | Design | Pending |
| ELR-16 | P3 | Design | Pending |
| ELR-17 | P3 | Design | Pending |
| ELR-18 | P3 | Design | Pending |
| ELR-19 | P3 | Design | Pending |

**Coverage:** 19 total, mapped in Tasks phase, 0 unmapped at spec time.

**Gate scenarios:** every P1–P3 AC maps to `sim:elevator_riders` (sim half) or
`client:elevator_riders` (client half); rewritten tick math stays in the existing
`sim:elevator`/`sim:motion` suites. P1 AC5, P2 AC9 and P3 AC6 additionally map to
`client:elevator_riders`/`client:elevator_lobby` (updated ride choreography).

## Success Criteria

- [ ] Gates 1–3 exit 0: `pnpm typecheck` + `pnpm lint`, `pnpm test:sim` (incl. `sim:elevator_riders`), `pnpm test:client` (incl. `client:elevator_riders`)
- [ ] A two-tab client scenario demonstrates: shared ride shows both names to riders only; press-by-rider changes the car's path; non-riders' wire traffic contains no occupancy, queue, or press-target data
- [ ] Roadmap cycle table updated (2.6 insert, shifts through 2.10) in the same cycle
- [ ] Human 5-minute round: two players ride together; each can afterward state who was in the car and who pressed what, from memory of the HUD chip and press flash alone
