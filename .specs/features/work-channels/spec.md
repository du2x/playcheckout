# Work Channels Specification (Phase 2 cycle 2.5)

## Problem Statement

After movement the hotel is walkable but inert: rooms are x-segments with no
interior, nothing to prepare, nothing to ruin. Cycle 2.5 adds the work layer —
the core loop's verbs (prd §5): staff prep rooms (5 s), the saboteur un-preps
(3 s) and fake-preps, and walking out cancels cleanly. Room interiors become
real state, readable only from inside (FR-10's read half), and AD-008's
own-floor position routing lands with its first positional recipient policy.
Door cards, freshness, rustle, and door-open cues stay in cycle 2.6 (roadmap
cycle table is authoritative).

## Goals

- [ ] A staff player can walk into a room, hold a 5 s prep channel, and turn a fresh or trashed room prepped; the saboteur can un-prep prepped rooms in 3 s and fake-prep otherwise, verified by the `sim:prep`, `sim:unprep`, and `sim:fake_prep` gate scenarios.
- [ ] Walking out mid-channel cancels with no trace (FR-16), verified by `sim:prep`/`sim:unprep` cancel legs and the `client:work_channels` harness scenario.
- [ ] Room interiors (state) reach only players inside the room's segment; `player:moved` reaches only same-floor viewers (AD-008/AD-009) — protocol-clean per turnover-protocol rule 2, audited in the registry.
- [ ] Movement verifier Gaps 2–4 (decoy-flash car value, pinned-with-intent silence, MOVE-06 positive half) are closed with direct assertions.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Door cards (FR-11), freshness tiers (FR-12), rustle (FR-13), door-open cues (FR-10's cue half) | Cycle 2.6 (roadmap cycle table; movement spec's out-of-scope table pointed at 2.5 — superseded) |
| `settled` state transitions (freshness window) | Cycle 2.6 — rooms move among fresh/prepped/trashed only this cycle |
| Walk-in conviction, accusation (FR-15, FR-17–FR-19) | Cycle 2.7 justice |
| Coverage % HUD (FR-14) | Phase 3 HUD; roadmap 2.5 scope is FR-7–FR-9 + FR-16 only |
| Spectator full-building stream (FR-20 half of AD-008) | No fired players exist until 2.7 — the `spectators` policy lands then |
| Telemetry (FR-23) | Cycle 2.9 |
| Explicit cancel-work intent | FR-16 defines walk-out as the cancel; no other cancel is spec'd |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Role gating | Staff prep only; saboteur un-prep + fake-prep only; neither can do the other's action | FR-7/FR-8 name the actor role; prd grants the saboteur no real prep (§5 core loop) | y (default) |
| Saboteur action by room state | prepped room → un-prep (3 s); fresh/trashed room → fake-prep (5 s) | Un-prep is only defined prepped→trashed (FR-8); fake prep is "animation only" and must be available somewhere — the non-prepped states | y (default) |
| Staff prep on prepped room | Rejected with an intent error (already prepped) | FR-7: "any non-prepped state → prepped"; a prepped room offers no action | y (default) |
| Concurrent channels | Two players may channel in the same room independently; transitions validate at start and apply at completion | prd defines no exclusivity; first-mover conflicts resolve by completion order deterministically | y (default) |
| Cancel paths | Walk-out only (FR-16); leaving the game mid-channel also cancels silently | No explicit cancel intent exists in prd | y (default) |
| Channeling and movement | Walking within the segment keeps the channel; any exit (x out of segment, floor change, elevator boarding) cancels | FR-16 makes walk-out the cancel mechanic | y (default) |
| Room state reset | Every round starts with all 24 rooms fresh | A new RoundSim is a new deal (FR-1: host re-deals on start) | y (default) |
| Work input | Space (client binding) sends `work:start {floor, room}`; the room index derives from the player's own x via the shared layout (AD-010) | Keyboard-only (§3); the client knows geometry from `@turnover/shared` | y (default) |
| Geometry | 8 rooms/floor, contiguous 3.5-tile segments tiling [1, 29] of each guest-floor hall | AD-010 — first geometry consumer forces the predicate exact | y (AD-010) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Staff prep ⭐ MVP

**User Story**: As a staff player, I want to walk into a messy or fresh room and
hold a 5-second prep, so that coverage climbs toward the 80% target.

**Why P1**: FR-7 is the staff side of the core loop; without it no round can be won.

**Acceptance Criteria**:

1. WHEN a staff player inside a room's segment sends `work:start {floor, room}` for that room WHILE the round is active and the room is fresh or trashed THEN the server SHALL start a channel of exactly TUNING.PREP_SECONDS × TICK_HZ ticks (100) and send `work:started` (floor, room, seconds) to that player only.
2. WHEN the channel's final tick arrives with the player still inside the segment THEN the room SHALL become prepped and the server SHALL emit `room:prepped` (floor, room) delivered only to players inside that room's segment, plus `work:ended` (floor, room, outcome 'completed') to the actor only.
3. IF a `work:start` arrives from a player outside the named room's segment, or on the lobby floor, or while a channel is already active, or for a prepped room, or while the room is in lobby phase THEN the server SHALL reject it with an intent error and emit no channel events.

**Independent Test**: `sim:prep` — scripted positions + start intent over the sim
assert the exact 100-tick channel, `room:prepped` at the completion tick, fresh→
and trashed→prepped transitions, every rejection reason, and concurrent channels
in one room.

---

### P1: Saboteur un-prep ⭐ MVP

**User Story**: As the saboteur, I want to quietly ruin a prepped room in 3
seconds, so that coverage drops without being caught.

**Why P1**: FR-8 is the saboteur's primary verb and the walk-in conviction
target (2.7 builds on this exact channel).

**Acceptance Criteria**:

1. WHEN the saboteur inside a prepped room sends `work:start` THEN the server SHALL start a channel of exactly TUNING.UNPREP_SECONDS × TICK_HZ ticks (60) and send `work:started` to that player only.
2. WHEN the channel completes with the saboteur still inside THEN the room SHALL become trashed and the server SHALL emit `room:trashed` (floor, room) to that room's occupants only, plus `work:ended` (outcome 'completed') to the actor.
3. WHEN the room is re-prepped after a sabotage THEN the saboteur SHALL be able to un-prep it again — re-trashing is unlimited (TUNING.RE_TRASH_LIMIT) and no counter exists anywhere.
4. IF a non-saboteur sends `work:start` for a prepped room THEN the server SHALL reject it with an intent error (role gating is server-side; the client learns only its own role).

**Independent Test**: `sim:unprep` — exact 60-tick channel, prepped→trashed,
`room:trashed` to occupants, prep→unprep→prep→unprep re-trash loop, staff
rejection on a prepped room.

---

### P1: Fake prep ⭐ MVP

**User Story**: As the saboteur, I want to pretend to prep a room — same
animation, same duration, no effect — so that my presence near rooms stays
innocent-looking.

**Why P1**: FR-9 is the saboteur's cover mechanic; its indistinguishability is
the point (protocol rule: nothing may hint the fake).

**Acceptance Criteria**:

1. WHEN the saboteur inside a fresh or trashed room sends `work:start` THEN the server SHALL start a channel of exactly TUNING.PREP_SECONDS × TICK_HZ ticks (100) — identical duration and events to a staff prep except that completion changes NO room state and emits no `room:prepped`.
2. WHEN the fake channel completes THEN the actor SHALL receive `work:ended` (floor, room, outcome 'completed') and the room's state SHALL be unchanged.
3. All work channels SHALL be indistinguishable to any client-bound observer: no payload names a role, a fake, or a channel kind beyond the actor's own private view; the channel surface visible to others is exactly the actor's (public) position standing in the segment.

**Independent Test**: `sim:fake_prep` — fake on fresh and on trashed rooms,
state unchanged at completion, no `room:prepped`/`room:trashed` emitted, event
stream shape identical to a real prep except the transition.

---

### P1: Walk-out cancels cleanly ⭐ MVP

**User Story**: As a channeling player, I want walking out of the room to cancel
my work instantly and tracelessly, so that aborting a saboteur's channel (or my
own mistake) leaves nothing behind.

**Why P1**: FR-16 is the mechanic that makes 2.7's walk-in conviction fair
(cancel is instant, no lockout).

**Acceptance Criteria**:

1. WHEN a channeling player's position leaves the room's segment — x out of the segment, a floor change, or elevator boarding — THEN the channel SHALL end on that tick: the actor receives `work:ended` (floor, room, outcome 'cancelled'), the room state is unchanged, and no room transition event is emitted.
2. WHEN a channeling player leaves the game THEN the channel SHALL be dropped silently: no `work:ended`, no room transition.
3. WHEN the buzzer fires mid-channel THEN the channel dies with the round: no `work:ended` is emitted (the round-scope snapshot refresh replaces it).

**Independent Test**: `sim:prep`/`sim:unprep` cancel legs — mid-channel exit
cancels on the exit tick with exactly one `work:ended`, state unchanged; leave
and buzzer legs assert silence.

---

### P1: Interiors readable only from inside ⭐ MVP

**User Story**: As a player, I want to see a room's state only while standing
inside it, so that checking rooms costs the walk (design pillar 2).

**Why P1**: FR-10's read half; also the first exercise of a positional
recipient policy beyond `all`/`self`.

**Acceptance Criteria**:

1. WHEN a player's position enters a room segment on a guest floor THEN the server SHALL send `room:observed` (floor, room, state) to that player only; WHEN they are outside all segments THEN no interior information about any room SHALL be sent to them.
2. WHEN a room transition fires THEN `room:prepped`/`room:trashed` SHALL be delivered only to players inside that room's segment at the transition tick (the `occupants` recipient policy).
3. No client-bound payload SHALL contain a room state for a room the recipient is not inside, a role, or a cross-floor position for a live viewer (protocol rules 2 and 5; AD-008/AD-009).

**Independent Test**: `sim:prep` observation legs + server Router tests —
`room:observed` on entry (self), none outside, `occupants` routing excludes
players in other rooms/segments; registry policy walk.

---

### P2: Own-floor position routing (AD-008 lands) ⭐ MVP

**User Story**: As a player, I should not be able to learn where players on
other floors stand, even with a modded client — the server must not send it.

**Why P2**: Resolves movement verifier Gap 1 (AD-009): the shipped 2.4 `'all'`
broadcast of `player:moved` is amended to the `sameFloor` policy with cycle 2.5's
first positional consumers.

**Acceptance Criteria**:

1. WHEN a player's position changes THEN `player:moved` SHALL be delivered only to connected live players on the same floor; a player inside an elevator car SHALL receive no `player:moved` while in the car (their arrival event arrives once they stand on the arrival floor).
2. WHEN a movement snapshot is built for a player THEN it SHALL contain only players on the recipient's floor (the recipient included) plus both cars' public floors.
3. WHEN an elevator call or car movement occurs THEN `elevator:called`/`elevator:moved` SHALL remain broadcast to all (FR-6 panels are public), and `player:left` SHALL remain broadcast to all (roster/disconnect facts are not floor-hidden).

**Independent Test**: server Router tests — cross-floor `player:moved` not
delivered, rider silence in-car, snapshot filtering; the amended 2.4
`TurnoverRoom`/harness tests.

---

### P3: Movement verifier gap hardening

**User Story**: As a maintainer, I want the two surviving sensor mutants killed
and the MOVE-06 positive half asserted, so that the movement suite discriminates.

**Acceptance Criteria**:

1. The decoy-flash `elevator:called` payload's `car` value SHALL be asserted literally (the flash names the targeting car).
2. A player pinned at a wall with an active move intent SHALL emit no `player:moved` while the position cannot change.
3. A player walking on floor1..floor3 during an active round SHALL be asserted to displace x (MOVE-06 positive half).

**Independent Test**: `sim:motion`/`sim:elevator` extensions — three direct
assertions; re-run of the movement discrimination mutants M3/M5b kills both.

---

## Edge Cases

- IF `work:start` names a room whose segment the player is inside but on the wrong floor THEN the server SHALL reject it (segment matching includes floor).
- IF `work:start` arrives while the player is inside an elevator car THEN the server SHALL reject it (riders are not inside any segment).
- WHEN a player walks through a room segment without stopping THEN they SHALL receive `room:observed` for it (they were inside — FR-10's letter) and no channel is affected.
- WHEN two channels in the same room complete on the same tick THEN transitions apply in intent-start order and both actors receive their `work:ended` (deterministic).
- WHEN a player channels while standing at a segment boundary THEN the segment predicate `[start, end)` decides inside/outside identically for start, cancel, and observation.
- IF a channel is active when the player boards an elevator (landing x is outside every segment) THEN the boarding cancel (walk-out rule) applies on the boarding tick.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| WORK-01 | Staff prep | T4/T5 | Planned |
| WORK-02 | Staff prep | T4/T5 | Planned |
| WORK-03 | Staff prep | T5 | Planned |
| WORK-04 | Saboteur un-prep | T4/T5 | Planned |
| WORK-05 | Saboteur un-prep | T4/T5 | Planned |
| WORK-06 | Saboteur un-prep | T4 | Planned |
| WORK-07 | Saboteur un-prep | T4/T5 | Planned |
| WORK-08 | Fake prep | T4/T5 | Planned |
| WORK-09 | Fake prep | T4/T5 | Planned |
| WORK-10 | Fake prep | T4/T6 | Planned |
| WORK-11 | Walk-out cancel | T4/T5 | Planned |
| WORK-12 | Walk-out cancel | T5 | Planned |
| WORK-13 | Walk-out cancel | T4 | Planned |
| WORK-14 | Interiors inside-only | T4/T5 | Planned |
| WORK-15 | Interiors inside-only | T4/T5 | Planned |
| WORK-16 | Interiors inside-only | T5/T6 | Planned |
| WORK-17 | Own-floor routing | T2/T5 | Planned |
| WORK-18 | Own-floor routing | T2/T5 | Planned |
| WORK-19 | Own-floor routing | T2 | Planned |
| WORK-20 | Gap hardening | T3 | Planned |
| WORK-21 | Gap hardening | T3 | Planned |
| WORK-22 | Gap hardening | T3 | Planned |

**Gate mapping:** WORK-01..06, 08..09, 11, 13..15 → `sim:prep` + `sim:unprep` +
`sim:fake_prep` · WORK-03, 07, 10, 12, 16 → server Router/room legs of the same
scenarios + `server:work_channels` assertions · WORK-17..19 → server Router tests +
amended `client:movement` · WORK-20..22 → `sim:motion`/`sim:elevator` extensions ·
player-facing slice exercised end-to-end by `client:work_channels` (gate 3).

**Coverage:** 22 total, 22 mapped to tasks (at Tasks phase), 0 unmapped.

---

## Success Criteria

- [ ] `pnpm test:sim` runs `sim:prep`, `sim:unprep`, `sim:fake_prep`: exact tick durations (100/60/100), transition events to occupants-only, cancel-on-exit with single `work:ended`, re-trash loop, fake indistinguishability, and bit-for-bit replay determinism.
- [ ] `pnpm test:client` runs `client:work_channels`: a tab walks into a room segment, presses Space, its progress bar appears and completes, and the room label reflects the observed state — while other tabs outside the segment receive no interior events.
- [ ] Protocol audit via the registry: `room:observed`/`room:prepped`/`room:trashed` carry the `occupants` policy, `player:moved` carries `sameFloor`, work events are `self`; no payload contains roles, fakes, cross-floor positions, or non-occupied interiors.
- [ ] Movement verifier Gaps 2–4 closed: mutants M3 and M5b die; MOVE-06 positive half asserted.
