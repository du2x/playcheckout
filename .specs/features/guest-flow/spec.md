# Guest Flow Specification (cycle 3.1)

## Problem Statement

PRD v1.3 (AD-022) turns the static task checklist into a guest-traffic economy, but
no guest exists in the sim yet. Cycle 3.1 lands the guest **lifecycle as weather** —
NPCs arrive, queue, self-assign, settle, check out, and their checkout re-trashes
the room — the renewable workload every later Phase 3 cycle (routing, complaints,
provenance) stands on. Routing/desk interaction is deliberately NOT here (3.2): in
this cycle every guest's only assignment path is impatience self-assign, which is
exactly the fallback behavior the full design specifies.

## Goals

- [ ] Guests run as deterministic round-scoped weather: arrival → queue → 20s
      impatience → self-assign → walk/elevator to the room → settle 45–90s →
      checkout re-trashes the room with **settled** trash.
- [ ] Guests are full elevator citizens (capacity 2 counts them; panels stay
      position-only, FR-6).
- [ ] Phase entry task: prd §8 throughput math recomputed with churn as the third
      mess source; verdict recorded below and mirrored into prd §8.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Desk receive / walkie broadcast / routed guests (FR-27) | Cycle 3.2 `front-desk`; self-assign is the only assignment path here |
| Complaints, budget, instant loss, anger cue, flee-during-un-prep (FR-29/30/31) | Cycle 3.3 `complaint-budget`; guests entering trashed rooms settle silently this cycle |
| Provenance display, re-trash-resets-fresh rule, tenancy signs (FR-32 display, FR-33) | Cycle 3.4 `provenance-signs`; only the *spawn* half of FR-32 (checkout → settled) lands here |
| Telemetry / KPIs (FR-23/24) | Cycle 3.6 `telemetry` (postponed from 2.11) |
| Guest production sprites (foot-tap/storm-out art) | AD-020 art workstream; gray-box markers + DOM cues only |
| Saboteur–guest interactions | None exist in the design; walkie lies need 3.2's broadcast |

---

## §8 Recompute (phase entry task, AD-022 trade-off 4)

Churn as a third mess source, at §7 dials (cadence 30s/24s/18s, dwell 45–90s
uniform ⇒ mean 67.5s):

| Lobby | Guests/shift | Churn mess rate | Saboteur (§7 max) | Combined | Staff cleaning capacity |
|---|---|---|---|---|---|
| 4p | ~10 | 2.0 rooms/min | ~7/min | ~9/min | 9.5/min/person ⇒ 4 staff = 38/min |
| 5p | ~12–13 | ~2.5/min | ~7/min | ~9.5/min | 5 staff = 47.5/min |
| 6p | ~16–17 | ~3.3/min | ~7/min | ~10.3/min | 6 staff = 57/min |

- **Raw throughput verdict: churn is affordable.** One staff member cleaning
  full-time absorbs the entire combined mess at every lobby size; 3–5 staff remain
  for patrol, desk, and evidence. The travel-budget conclusion (step 0) survives —
  the tension moves from *coverage math* to *time-sharing* (desk manning, elevator
  contention, response time).
- **Occupancy:** steady-state tenanted rooms ≈ dwell/cadence ≈ 2.3 (4p) / 2.8 (5p)
  / 3.75 (6p), well under the ~10 peak row and far under 24 — the no-vacant branch
  is unreachable at §7 dials (pinned as a safety net, GUEST-05/02).
- **Budget preview (3.3):** an unmanned desk self-assigns every guest after 20s;
  complaints then track the trashed-vacant pool. With any cleaning at all, the
  8-complaint budget is not threatened by churn alone within 5:00 — the budget
  binds only when sabotage *plus* neglected churn pile up. Confirms the §7 v1.3
  rows: **no dial changes.**
- **Buzzer interaction:** guests arriving in the last ~90s may still be dwelling at
  the buzzer — their checkout (and its trash) never fires. Effective churn is
  slightly below the table figures at every lobby size; accepted.

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Desk + queue location | Grand lobby center (x=15 of the 30-tile hall); queue offsets beside the desk, FIFO toward the nearest end | User decision; center minimizes worst-case walk from both landings | y |
| No-vacant behavior | Waiting guest re-checks every tick; **arrivals are held while no vacant room exists** (guests never spawn into a full hotel) | User decision: "wait and retry, but avoid spawning into that situation" | y |
| Elevator citizenship | Guests are full citizens in 3.1: walk 6 tiles/s, consume car capacity 2, same door/landing/press semantics | User decision; no stairs exist, and churn becomes panel-visible | y |
| Guests in rider knowledge | A guest riding a car appears in the rider-exclusive occupancy payload; guests are public NPCs so this leaks nothing | Capacity counts them, so omitting them would make rider knowledge lie about the car | n (assumed) |
| Guest settles in a trashed room | Silently settles; the complaint beat (FR-29) arrives in 3.3 | Staging pinned by roadmap; discovering trash inside is 3.3's mechanism | y (roadmap) |
| Guest entry vs work channels | Guest entry ignores prep/un-prep state entirely this cycle; FR-30's flee lands in 3.3 | Staging; no complaint machinery exists yet | y (roadmap) |
| Arrival schedule shape | Fixed interval per lobby size, no jitter, first arrival one full interval after round start; all sampling seeded from the round seed | §7 rows specify a cadence, not a distribution; determinism rule (AD-022 trade-off 5) | n (assumed) |
| Guests are round-scoped | Guests spawn from the seed at round start, cease at buzzer/abort; none exist in lobby/results phases | The RoundSim is round-scoped (AD-002); guests are its workload | n (assumed) |
| Spawn/exit point | Guests spawn at the desk position and despawn there on hotel exit (the lobby "door" is the desk) | Cheapest deterministic model; a separate entrance visual is art-scope | n (assumed) |
| Checkout trash timing | Settled trash spawns the moment dwell elapses; the guest then walks out visibly | Trash-while-leaving is the coherent physical story; mismatch window is the tell the design wants | n (assumed) |
| Desk/queue tuning constants | New constants (desk x, queue spacing) beyond §7 — recorded as an AD at design time | Tuning rule: §7-external constants need a recorded decision (AD-007 precedent) | n (assumed) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Guest lifecycle as weather ⭐ MVP

**User Story**: As the sim, I want NPC guests to arrive, queue, self-assign,
settle, and check out on seeded schedules so that the round carries a renewable
workload the staff must service forever.

**Why P1**: Every later Phase 3 cycle (routing, complaints, provenance, exit
proofs) consumes this lifecycle; nothing else in Phase 3 can be specified
without it.

**Acceptance Criteria** (EARS):

1. WHEN a round starts THEN the sim SHALL schedule guest arrivals at the fixed
   §7 cadence for the lobby size — one guest every 30s at 4p, 24s at 5p, 18s at
   6p — the first arrival one full interval after round start. <!-- event-driven -->
2. IF the hotel has no vacant room when an arrival is due THEN the sim SHALL
   hold that arrival (no guest spawns) until a room frees, releasing held
   arrivals one per tick in FIFO order. <!-- unwanted-behavior -->
3. WHEN a guest spawns THEN the sim SHALL place them at the desk queue (lobby
   center) behind already-waiting guests in FIFO order and announce the arrival
   to all players. <!-- event-driven -->
4. WHEN a guest has waited 20s (§7 impatience) THEN the sim SHALL fire the
   impatience cue — visible foot-tap state + desk bell, no complaint, no budget
   or loss effect of any kind — and self-assign a uniform random **vacant** room
   (seeded). <!-- event-driven -->
5. IF no vacant room exists at impatience THEN the guest SHALL remain queued and
   re-check on every tick until a room frees (never force-assigned, never
   despawned). <!-- unwanted-behavior -->
6. WHEN a guest self-assigns THEN the guest SHALL walk from the desk to the
   assigned room's doorway at 6 tiles/s using halls and elevators as a full
   elevator citizen — consuming car capacity 2, subject to the same
   door/landing/press semantics as players. <!-- event-driven -->
7. WHILE a guest rides a car THEN the rider-exclusive occupancy knowledge SHALL
   include that guest (capacity counts them; panels themselves stay
   position-only, FR-6). <!-- state-driven -->
8. WHEN the guest reaches the assigned room's door THEN the guest SHALL enter
   (leaving hall view — interiors stay hidden, FR-10) and settle: dwell a seeded
   uniform 45–90s, the room counting as tenanted while they dwell.
   <!-- event-driven -->
9. WHEN a settled guest's dwell elapses THEN the guest SHALL check out: the
   room becomes trashed with the **settled** mark (checkout churn — spawn half
   of FR-32), the room becomes vacant, and the guest walks back to the desk and
   leaves the hotel (despawn). <!-- event-driven -->
10. The sim SHALL derive every guest sample — arrival schedule, dwell length,
    self-assign choice — from the round seed with no `Math.random` in the
    deterministic core (bit-for-bit replay of scripted guest scenarios).
    <!-- ubiquitous -->
11. IF the round ends (buzzer, abort, or conviction) THEN all guests SHALL cease
    to exist — no guest state or events survive into results/lobby phases.
    <!-- unwanted-behavior -->

**Independent Test**: Scripted sim scenario — seed a 5p round, fast-forward
through ≥2 full guest lifecycles (arrive → queue 20s → self-assign → ride →
settle → checkout), assert room states flip tenanted→trashed(settled)→vacant and
a same-seed replay is bit-for-bit identical (`sim:guest_arrival`,
`sim:guest_impatience`, `sim:checkout_churn`).

---

### P2: Client guest slice

**User Story**: As a player, I want to see guests as distinct markers queueing at
the desk and tapping their feet so that hotel traffic is readable at a glance.

**Why P2**: The sim's guest lifecycle needs a visible surface for the human gate;
gray-box only, per the phase rules.

**Acceptance Criteria**:

1. WHEN a guest is present on the viewer's floor THEN the client SHALL render one
   distinct guest marker per guest (visually not a player sprite) plus the desk
   queue of waiting guests; live players never see cross-floor guests
   (sameFloor policy). <!-- state-driven -->
2. WHEN a queued guest is impatient THEN the client SHALL render the foot-tap cue
   and the desk-bell line, with no complaint-counter element (that UI is 3.3's).
   <!-- event-driven -->

**Independent Test**: Playwright scenario — real server + client, seeded round
with `TURNOVER_TEST_SHIFT_SECONDS`; assert a guest marker appears in the lobby
queue, the impatience cue fires, and no guest markers render on other floors
(`client:guest_flow`).

---

### P3: Determinism replay pin

**User Story**: As the exit-proof author (3.5/3.6), I want a pinned bit-for-bit
guest replay scenario so that rate-based bot sims can trust seeded churn.

**Why P3**: The exit bots compare rates across seeded runs; an explicit replay
pin makes determinism regressions loud before those cycles.

**Acceptance Criteria**:

1. WHEN a scripted ≥200-tick guest scenario runs twice with the same seed THEN
   guest positions, room tenancy, and trash spawns SHALL be identical
   tick-for-tick. <!-- event-driven -->

**Independent Test**: One vitest scenario running the replay assertion
(folded into the P1 suites if it lands there naturally).

---

## Edge Cases

- IF the buzzer fires while a guest walks, rides, or dwells THEN the guest SHALL
  vanish with the round (GUEST-11) — no checkout trash from an interrupted stay.
- IF two arrivals are due the same tick (held backlog releasing) THEN the sim
  SHALL spawn them one per tick in FIFO order (GUEST-02).
- IF a guest's chosen room becomes tenanted between choice and arrival THEN
  nothing happens — assignment commits at choice time; no re-routing exists in
  3.1 (routing is 3.2).
- IF a guest self-assigns the room they are standing in (impossible: guests
  queue in the lobby) — N/A, structure prevents it.
- IF the saboteur is fired mid-round THEN guest behavior SHALL be unchanged
  (guests are weather, not justice participants; FR-30 arrives in 3.3).

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| GUEST-01 | P1 | Design | Pending |
| GUEST-02 | P1 | Design | Pending |
| GUEST-03 | P1 | Design | Pending |
| GUEST-04 | P1 | Design | Pending |
| GUEST-05 | P1 | Design | Pending |
| GUEST-06 | P1 | Design | Pending |
| GUEST-07 | P1 | Design | Pending |
| GUEST-08 | P1 | Design | Pending |
| GUEST-09 | P1 | Design | Pending |
| GUEST-10 | P1 / P3 | Execute | Implementing |
| GUEST-11 | P1 | Design | Pending |
| GUEST-12 | P2 | Design | Pending |
| GUEST-13 | P2 | Design | Pending |
| GUEST-14 | P3 | Execute | Implementing |

**Coverage:** 14 total, 0 unmapped.

## Success Criteria

- [ ] Gates 1–3 green: `pnpm typecheck` + `pnpm lint`, `pnpm test:sim` incl.
      `sim:guest_arrival` / `sim:guest_impatience` / `sim:checkout_churn`,
      `pnpm test:client` incl. `client:guest_flow`.
- [ ] A same-seed guest replay is bit-for-bit identical (GUEST-10/14).
- [ ] §8 recompute verdict recorded (this spec) and no §7 dial changed.
- [ ] New §7-external constants (desk position, queue spacing) recorded as an AD.
