# Evidence Specification (cycle 2.7)

## Problem Statement

Round 2.5 shipped room interiors readable only from inside (`room:observed`), but the
hotel itself leaks nothing: the hallway is informationally dead. The game's core
deduction loop — patrol, notice, catch — needs the physical evidence layer: door
cards that certify "was ever prepped", trash that visibly ages, the sabotage rustle,
and the door-open cue that warns an occupant someone is coming (and tells a passerby
who entered which room).

## Goals

- [ ] A staff player can patrol a hallway, read door cards from the hallway, and
      see/hear door-open and rustle cues, verified by the `sim:door_card`,
      `sim:freshness`, `sim:rustle`, and `sim:door_open_cue` gate scenarios.
- [ ] A sabotaged room's trash visibly ages: `trashed` for exactly
      TUNING.FRESHNESS_WINDOW_SECONDS, then `settled`.

## Out of Scope

| Feature | Reason |
|---|---|
| Walk-in conviction, grace, accusations, firing (FR-15–FR-19) | Cycle 2.8 `justice` |
| Spectator overview incl. interiors (FR-20) | Cycle 2.9 `round-end` (fired players arrive there) |
| Recap timeline freshness timestamps (FR-22) | Cycle 2.9 |
| Any art/audio polish — cues are gray-box (simple shapes/tone/flash) | Phase 3 non-goal |
| Work-channel durations and the action matrix | Locked in cycle 2.5; untouched |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| `'fresh'` room state meaning | Unchanged: clean/never-prepped room (cycle 2.5 init). `'trashed'` = trash whose 75 s window is running; `'settled'` = trash older than the window | FR-12 ties fresh/settled to trash age, but 2.5 pinned `'fresh'` as the clean init state; the four-state union then reads: prepped / trashed (fresh trash) / fresh (clean) / settled (old trash) | n (agent default, autonomous run) |
| Freshness window start | The tick the `room:trashed` transition completes (un-prep completion); re-trashing a trashed-or-settled room restarts the window | FR-12: "≤75 s **since sabotage**" | n (agent default) |
| Settle cancellation | IF the room becomes `'prepped'` before the window elapses THEN the pending settle is cancelled (no transition from a prepped room); a later re-trash starts a new window | A prepped room has no trash to settle; FR-7 allows prep from any non-prepped state | n (agent default) |
| Rustle range geometry | Pure x-distance on the same floor, measured to the NEARER edge of the room's segment (inside the segment = 0); no occlusion — "through walls" | AD-010 rooms are x-segments; walls are abstract; RUSTLE_RANGE_TILES = 3 → 3000 millitiles | n (agent default) |
| Rustle delivery is server-side | New registry recipient policy (range-filtered, same floor) — never broadcast-and-client-filtered | Message-only hard rule: who heard the rustle is exactly as wide as earshot; AD-008 precedent | y (protocol rule) |
| Elevator riders hear nothing | Riders have no floor while in a car (AD-009); rustle/door-open routing is floor+x based, so riders receive no evidence cues | Car interiors are sealed; arrival switches them onto the arrival floor's streams | n (agent default, AD-009-consistent) |
| Card hang trigger | The `room:prepped` transition (real prep completion only) — a fake prep hangs nothing; re-prep of an already-carded room re-emits `room:carded` (idempotent on the client) | FR-11: "auto-hung on prep completion"; re-emission keeps clients consistent without new machinery | n (agent default) |
| Cards are floor-public | `room:carded` routes to all viewers on the room's floor (hallway AND other rooms' occupants) — one new `'sameFloor'`-policy row, no new policy | FR-11: "readable from the hallway" — card state is per-floor public, unlike interiors (FR-10) | n (agent default) |
| Card snapshots | `movement:snapshot` (own-floor filtered, AD-009) gains the snapshot floor's carded-room list | AD-017 exiters and buzzer rejoiners need the card picture without replaying events | n (agent default) |
| Evidence cues are round-scoped | All four cues (card, settle, rustle, door-open) exist only while the sim is alive (round phase), matching the existing `room:observed` behavior; pre-round walking emits no cues | `WorkChannels` ticks only during the round (AD-002 seam); pre-round interiors are uniformly fresh | n (agent default) |
| Door-open cue on pass-through | Every segment ENTRY fires the cue — including walk-through crossings — identical to `room:observed`'s letter (FR-10 "inside ⇒ readable" precedent) | FR-10's cue half exists so a passerby "sees who entered which room"; pass-through is still entry | n (agent default) |
| Entrant receives their own door-open cue | Yes — `room:entered` routes to all same-floor viewers including the entrant; the entrant additionally gets `room:observed` (interior) as today | One policy, no exclusions; duplicate is harmless | n (agent default) |

**Open questions:** none — all resolved or logged above (autonomous run: agent
defaults stand unless a playtest/AD amends them).

---

## User Stories

### P1: Door cards — the patrol treadmill ⭐ MVP

**User Story**: As a staff player, I want every room that was ever prepped to wear a
permanent hallway-readable card so that I know which rooms may need a walk-in verify.

**Why P1**: FR-11 is the core patrol treadmill — cards certify "was ever prepped",
not "is prepped".

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a room's prep channel completes and the room transitions to `'prepped'`
   THEN the server SHALL mark that room carded (permanent) and emit
   `room:carded {floor, room}` to all viewers on that floor.
2. WHEN a saboteur's fake prep completes THEN the server SHALL emit no
   `room:carded` and the room SHALL NOT become carded.
3. WHEN a carded room is re-trashed THEN the card SHALL remain hung (no un-card
   event exists in the protocol) and the room SHALL NOT lose its carded mark.
4. IF a player joins, exits an elevator onto a guest floor, or is refreshed at the
   buzzer THEN their `movement:snapshot` SHALL include the carded rooms of the
   snapshot's floor and SHALL NOT include any other floor's cards.
5. The system SHALL carry no timestamp, author, or validity flag on a card — the
   wire payload is `{floor, room}` exactly.

**Independent Test**: `sim:door_card` — staff prep hangs a card (same-floor
delivery), fake prep hangs nothing, re-trash keeps the card, snapshot carries the
own-floor card set only, payload is exactly `{floor, room}`.

---

### P2: Trash freshness — the 75-second tell

**User Story**: As a staff player, I want recently sabotaged trash to look fresh for
75 s and then settle so that fresh trash tells me the saboteur is nearby.

**Why P2**: FR-12's two visual tiers are the rustle's companion tell; the window
turns "trashed" into time-sensitive evidence.

**Acceptance Criteria**:

1. WHEN a room transitions to `'trashed'` THEN a settle deadline SHALL start at
   exactly TUNING.FRESHNESS_WINDOW_SECONDS × TICK_HZ ticks (1500) after that
   completion tick.
2. WHILE the window has not elapsed THEN the room's observable state (`stateOf`,
   `room:observed`) SHALL be `'trashed'`.
3. WHEN the window elapses THEN the room SHALL transition to `'settled'` and the
   server SHALL emit `room:settled {floor, room}` to the room's occupants only.
4. IF the room transitions to `'prepped'` before the window elapses THEN the
   pending settle SHALL be cancelled and the room SHALL NEVER transition to
   `'settled'` from that trash.
5. WHEN a trashed-or-settled room is re-trashed THEN the window SHALL restart from
   the new completion tick.
6. IF the buzzer fires mid-window THEN the window dies with the round (no
   post-buzzer `room:settled`), consistent with WORK-13.

**Independent Test**: `sim:freshness` — exact 1500-tick window, `trashed` throughout,
`settled` + occupant-only `room:settled` at the boundary tick, prep-cancel leg,
re-trash restart leg, buzzer-silence leg.

---

### P3: Sabotage rustle — the creep-to-door tell

**User Story**: As a player in the hallway, I want to hear a rustle when a room is
sabotaged within ~3 tiles through the walls so that I can creep to the door and
catch the saboteur.

**Why P3**: FR-13 is the cue that enables walk-in catches (FR-15 lands in 2.8); it
must be delivered server-side exactly as wide as earshot.

**Acceptance Criteria**:

1. WHEN a room transitions to `'trashed'` (sabotage completes) THEN the server
   SHALL emit `room:rustle {floor, room}` for that room on that tick.
2. The server SHALL deliver `room:rustle` ONLY to viewers on the same floor whose
   x is within TUNING.RUSTLE_RANGE_TILES × 1000 millitiles of the room's segment
   (distance to the nearer segment edge; inside the segment = 0) — viewers beyond
   range, on other floors, or riding a car SHALL receive nothing.
3. `room:rustle` SHALL NOT be emitted for a fake prep, a cancelled channel, or a
   plain prep completion.
4. The registry SHALL declare `room:rustle` under a new range-filtered recipient
   policy (enum extended deliberately, per AD-008's extension rule) — never under
   `'sameFloor'` or `'all'`.

**Independent Test**: `sim:rustle` — sabotage at a known x: viewer 1 tile inside the
room, 2 tiles down the hall, 3 tiles away, 3.0001 tiles away, other floor, elevator
rider; exact delivery set asserted for each.

---

### P4: Door-open cue — who entered which room

**User Story**: As a passerby in the hallway, I want to see and hear a room's door
auto-open when someone enters so that I know who went where.

**Why P4**: FR-10's cue half is the occupant's only warning (FR-15) and the
hallway's co-presence signal.

**Acceptance Criteria**:

1. WHEN a player enters a room's segment (segment-change detection, including
   pass-through crossings, while the round is active) THEN the server SHALL emit
   `room:entered {playerId, floor, room}` to all viewers on that floor (including
   the entrant).
2. The entrant SHALL additionally receive their private `room:observed` exactly as
   in cycle 2.5 — the cue does not replace the interior read.
3. WHEN a player exits a room's segment, boards an elevator, or stands still THEN
   the server SHALL emit no further `room:entered` for that room.
4. `room:entered` SHALL be observable in the client as a visible + audible
   gray-box cue anchored to the room's hallway front, and `room:rustle` as an
   audible cue (harness `client:evidence_cues`).

**Independent Test**: `sim:door_open_cue` — entry fires once per entry for all
same-floor viewers (entrant included), pass-through fires, exit/stop stays silent;
`client:evidence_cues` renders card + door-open + rustle cues.

---

## Edge Cases

- IF two players enter the same room segment on the same tick THEN the server SHALL
  emit one `room:entered` per entrant (stable iteration order = positions-map
  order).
- IF a prep completes on a carded room (card already hung) THEN `room:carded` SHALL
  be re-emitted (idempotent on the client) — no separate "already carded" branch.
- IF a rustle's range spans the segment boundary exactly (viewer x at nearer-edge −
  3000) THEN the viewer SHALL receive the cue (inclusive range).
- IF the saboteur sabotages a room they are standing in THEN they SHALL receive
  their own `room:rustle` (distance 0) — no self-exclusion exists in FR-13.
- IF a player's only segment knowledge is a stale snapshot THEN snapshots remain
  the only interior source: no interior state ever enters a floor-public payload.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| EVID-01 | P1: Door cards | Execute | Done |
| EVID-02 | P1: Door cards | Execute | Done |
| EVID-03 | P1: Door cards | Execute | Done |
| EVID-04 | P1: Door cards | Design | Pending |
| {rid} | P1: Door cards | Design | Pending |
| EVID-06 | P2: Freshness | Execute | Done |
| EVID-07 | P2: Freshness | Execute | Done |
| EVID-08 | P2: Freshness | Execute | Done |
| EVID-09 | P2: Freshness | Execute | Done |
| EVID-10 | P2: Freshness | Execute | Done |
| EVID-11 | P2: Freshness | Execute | Done |
| EVID-12 | P3: Rustle | Execute | Done |
| EVID-13 | P3: Rustle | Execute | Done |
| EVID-14 | P3: Rustle | Execute | Done |
| {rid} | P3: Rustle | Design | Pending |
| {rid} | P4: Door-open cue | Design | Pending |
| EVID-17 | P4: Door-open cue | Execute | Done |
| EVID-18 | P4: Door-open cue | Execute | Done |
| EVID-19 | P4: Door-open cue | Design | Pending |

**Coverage:** 19 total, mapped in tasks.md, 0 unmapped.

---

## Success Criteria

- [ ] `sim:door_card`, `sim:freshness`, `sim:rustle`, `sim:door_open_cue` pass
      under `pnpm test:sim`; `client:evidence_cues` passes under `pnpm test:client`.
- [ ] No interior state, card list, or rustle for a non-visible floor reaches any
      live client (protocol registry audit clean).
- [ ] No tuning constant changed; the only §7-external additions are protocol
      machinery, not gameplay values.
