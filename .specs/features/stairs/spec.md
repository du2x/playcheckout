# Stairs Specification (cycle 3.E, AD-040, prd v1.6)

## Problem Statement

The saboteur has no unobserved channel: same-floor position streams (AD-009),
position-only panels (FR-6), and car co-presence testimony (AD-013) make their
movement fully reconstructable, and they have no counter-tool to FR-15's
walk-in catch. Replacing the W elevator with a camera-free stairwell gives the
saboteur a private transit and a first direct pressure tool — an automatic,
anonymous stun — while making the building's transport economy asymmetric:
fast-but-observed (elevator) vs. slow-but-invisible (stairs).

## Goals

- [ ] One-elevator building: car 2 and its dispatch/presentation machinery are
      gone; guests ride the single E car.
- [ ] Stairs as a staff-side transit: 3 s per floor + 2 s breath, entry and
      arrival observable, interior publishing nothing.
- [ ] Ambush: saboteur-only, automatic on an opposite-direction pass,
      anonymous 20 s stun, victim finishes their walk.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Changing E elevator semantics (dispatch, doors, dwell) | Only the car-count collapse touches them; behavior stays per AD-014…027 |
| Guests using stairs | User ruling: staff-side only; guests ride E (3.1) |
| Complaint-budget changes | 3.3 owns the loss loop; 3.E only pins the kill-check property |
| Capture/drag aftermath mechanics | Rejected in design discussion (timed stun chosen) |
| Stairwell production art | Manifest entry + gray-box rendering here; art workstream authors sprites later (phase rule) |
| Saboteur acting during stun window / stairs camping | Stationary players are mechanically inert on stairs (pinned edge case) |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Stairwell location | West landing (x=0) on all five floors; E remains the east landing | Replaces the W landing 1:1; landing-zone scale reused (`ELEVATOR_LANDING_TILES`) | y (user: "replacing the W elevator") |
| Entry input | ArrowUp/ArrowDown at the stairwell mouth (directional); E accepted as an alias for the only valid direction on terminal floors | Mirrors elevator landing input (AD-025 uses E/ArrowUp/ArrowDown); no direction menu UI | n |
| Trip granularity | One floor stride per activation; multi-floor trips re-press after each breath | Matches the user's "3 s… take air for 2 s" per-floor shape; no chained-transit state | y (user described per-floor timing) |
| Wire car field | Elevator payloads keep `car`, always 1 | Registry-shape stability; clients/presenters change count, not shape | n |
| Phase availability | Stairs usable in all phases (movement is phase-free, AD-005/015); ambush requires an active round with roles dealt | Pre-round there are no roles; matches movement phase-free precedent | n |
| Fired/ghosted players | Fired players may use stairs but cannot be ambushed; ghosted players cannot act | Stun has no round meaning for a spectator; avoids pointless states | n |
| Suitcase during stun | Stun does not drop a carried suitcase; the 60 s carry clock keeps running | Stun is a pause, not a personal foul; avoids new rest-position states | n |
| Buzzer mid-transit / mid-stun | Resolves to arrival at the destination floor, stun cleared (positions persist per MOVE-07) | Mirrors buzzer handling of riders | n |
| Reconnect mid-transit / mid-stun | Seat restore re-sends remaining transit/stun duration (FR-25 machinery) | Disconnect must not teleport or skip the stun | n |
| Multiple victims per stride | Each opposing live staff member triggers independently (a saboteur can stun two staff in one stride) | No limiter (user ruling) implies per-pair triggering | n |
| Departure/arrival visibility | Stairs entry emits `player:left-floor` (origin floor sees the departure); arrival is visible only via the arrival floor's stream | Symmetric with elevator boarding visibility; interior stays black-box | n |
| Stairs message names | Provisional: victim `stairs:ambushed {stunSeconds}` (`self`), saboteur `stairs:ambush {victimId}` (`self`) | Names finalized at Design per the turnover-protocol skill (registry-first) | n |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: One-elevator building ⭐ MVP

**User Story**: As a player, I want the building to run on a single elevator
so that the west end of every floor belongs to the stairwell and panels show
one car.

**Why P1**: The stairwell physically replaces W; every downstream story
(transit, ambush, client) builds on the collapsed car model, and 3.3's budget
must be tuned against the one-car guest economy.

**Acceptance Criteria**:

1. WHEN the movement sim ticks THEN the building SHALL operate exactly one
   elevator car (car 1) serving all five floors, and car 2 SHALL not exist in
   sim state, snapshots, or payloads.
2. WHEN any player calls, boards, rides, or presses THEN every elevator
   payload SHALL carry `car: 1` only.
3. WHEN a call is made from a landing or mid-hall THEN dispatch SHALL apply
   single-car semantics (no closest-landing choice, no empty-idle draft, no
   both-cars-parked decoy; AD-019/AD-023 predicates collapse).
4. WHEN the client renders panels or hall-call lights THEN it SHALL render
   exactly one car's light and floor readout.

**Independent Test**: `sim:stairs_one_car` — drive a call/ride cycle and
assert one car in state and payloads; `client:stairs` asserts a single panel.

---

### P1: Stairs transit ⭐ MVP

**User Story**: As a staff member, I want to move between floors via the
west stairwell so that I can travel unobserved, at the cost of speed.

**Why P1**: The stairwell is the feature's physical premise — without the
transit channel there is no ambush and no one-car asymmetry.

**Acceptance Criteria**:

1. WHEN a player presses a direction key within `ELEVATOR_LANDING_TILES` of
   the stairwell mouth on any floor THEN the player SHALL enter a
   `STAIRS_TRANSIT_SECONDS` (3 s) transit to the adjacent floor in that
   direction.
2. WHEN the transit completes THEN the player SHALL be placed at the
   stairwell mouth of the adjacent floor and SHALL be immobile for
   `STAIRS_BREATH_SECONDS` (2 s), unable to move or act.
3. WHEN a player enters the stairs THEN viewers of the origin floor SHALL
   receive the player's departure (`player:left-floor`) and no player other
   than the transiting one SHALL receive any position, direction, or
   identity information until arrival.
4. WHILE a player is in stairs transit or breath THEN their own client SHALL
   show their stairs state (transit progress / breath) and they SHALL emit no
   floor position stream.
5. IF a direction key is pressed mid-transit or during breath THEN it SHALL
   be ignored.
6. IF a direction with no adjacent floor is requested (lobby down, floor3 up)
   THEN the request SHALL be rejected silently.
7. The stairs SHALL be usable in all phases (pre-round, mid-round, results),
   by all players, and never by guests.

**Independent Test**: `sim:stairs_transit` — scripted transits assert
timing (3 s + 2 s), departure/arrival visibility, stream silence inside, and
rejections.

---

### P1: Ambush ⭐ MVP

**User Story**: As the saboteur, I want to neutralize a staff member I pass
on the stairs so that a floor loses its coverage without me being named.

**Why P1**: The ambush is the feature's core mechanic — the saboteur's first
direct pressure tool and the reason the stairs exist.

**Acceptance Criteria**:

1. WHEN the saboteur and a live staff member are both in stairs transit in
   opposite directions during the same stride THEN the staff member SHALL be
   stunned for `STAIRS_STUN_SECONDS` (20 s), pausing their transit at the
   meeting point.
2. WHEN the stun expires THEN the victim SHALL resume the interrupted transit
   and arrive at their intended floor with the normal breath catch.
3. WHEN an ambush fires THEN the victim SHALL receive only "you were
   ambushed" + the stun duration (no saboteur identity, floor, or direction
   beyond their own knowledge), and the saboteur SHALL receive a private
   confirmation.
4. IF the two transiting players are both staff, moving in the same
   direction, either is stationary (in breath or waiting), either is a guest,
   or the potential victim is fired or ghosted THEN no ambush SHALL occur.
5. The ambush SHALL have no per-round limit, and a saboteur passing multiple
   opposing staff in one stride SHALL stun each of them.

**Independent Test**: `sim:stairs_ambush` — scripted opposite/same-direction
pairs assert trigger, stun duration, resume-to-destination, anonymity of the
victim payload, and all four inert cases.

---

### P2: Client presentation

**User Story**: As a player, I want legible stairs cues so that I can tell
someone left via the stairs, and so that an ambush is felt, not confusing.

**Why P2**: Mechanics are P1; this is the Gate-3-renderable slice that makes
them playable and testable in a browser.

**Acceptance Criteria**:

1. WHEN a floor view renders THEN it SHALL show a stairwell marker at the
   west landing (art manifest entry exists before sprite authoring).
2. WHEN the own player is in stairs transit or breath THEN the client SHALL
   render a stairs chip (progress) in place of the floor view, analogous to
   the rider chip (AD-013).
3. WHEN the own player is ambushed THEN the client SHALL render a
   "you were ambushed" toast with a stun countdown; WHEN the own saboteur's
   ambush succeeds THEN the client SHALL render a private confirmation line.
4. WHEN any elevator event arrives THEN the single-car panel/light set SHALL
   update exactly as the two-car set did for car 1.

**Independent Test**: `client:stairs` — headless Chromium asserts the
stairwell marker, chip, toasts, and single panel over the harness server.

---

### P2: Balance properties (kill checks)

**User Story**: As a designer, I want the ambush's pressure to be bounded so
that the 3.5 balance gate calibrates against honest dials.

**Why P2**: These properties guard the 3.3/3.5 tuning work that immediately
follows; they are spec-assertable now.

**Acceptance Criteria**:

1. IF an ambush is the only saboteur action in a scenario THEN no complaint
   SHALL be recorded (the ambush never creates a complaint; it only enables
   one already set up).
2. WHEN the Specify-phase §8 recompute runs THEN it SHALL re-derive guest
   throughput, complaint pressure, and sweep math for one elevator + stairs
   (entry task; verdict recorded in prd §8).

**Independent Test**: `sim:stairs_ambush` variant — ambush-only scenario
asserts zero complaints; §8 recompute lands as a prd edit reviewed at Design.

---

## Edge Cases

- IF the saboteur and a staff member pass mid-stairs pre-round or
  post-buzzer THEN no ambush SHALL occur (roles are not active).
- IF the victim is carrying a suitcase when ambushed THEN the suitcase SHALL
  stay with them and the 60 s carry clock SHALL keep running.
- IF the buzzer fires mid-transit or mid-stun THEN the player SHALL be
  resolved to the destination floor with the stun cleared.
- IF a player reconnects mid-transit or mid-stun THEN the restored seat SHALL
  continue the remaining transit/stun duration.
- IF a stunned victim and another mover share the stairs THEN the mover SHALL
  pass through (bodies are pass-through) and nothing SHALL be revealed about
  the collapsed player.
- IF a fired player transits the stairs THEN they SHALL move normally and
  SHALL be invisible to the ambush trigger.
- IF the victim recovers and the saboteur passes them again in the opposite
  direction THEN the ambush SHALL fire again (no limiter).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| STAIRS-01 | P1: One-elevator building | Design | Pending |
| STAIRS-02 | P1: One-elevator building | Design | Pending |
| STAIRS-03 | P1: One-elevator building | Design | Pending |
| STAIRS-04 | P1: One-elevator building | Design | Pending |
| STAIRS-05 | P1: Stairs transit | Execute | Implementing |
| STAIRS-06 | P1: Stairs transit | Design | Pending |
| STAIRS-07 | P1: Stairs transit | Design | Pending |
| STAIRS-08 | P1: Stairs transit | Design | Pending |
| STAIRS-09 | P1: Stairs transit | Design | Pending |
| STAIRS-10 | P1: Stairs transit | Design | Pending |
| STAIRS-11 | P1: Stairs transit | Design | Pending |
| STAIRS-12 | P1: Ambush | Design | Pending |
| STAIRS-13 | P1: Ambush | Design | Pending |
| STAIRS-14 | P1: Ambush | Execute | Implementing |
| STAIRS-15 | P1: Ambush | Design | Pending |
| STAIRS-16 | P1: Ambush | Design | Pending |
| STAIRS-17 | P2: Client presentation | Execute | Implementing |
| STAIRS-18 | P2: Client presentation | Design | Pending |
| STAIRS-19 | P2: Client presentation | Design | Pending |
| STAIRS-20 | P2: Client presentation | Design | Pending |
| STAIRS-21 | P2: Balance properties | Design | Pending |
| STAIRS-22 | P2: Balance properties | Design | Pending |

**Coverage:** 22 total, 0 mapped to tasks yet (Tasks phase pending), 22 unmapped ⚠️

---

## Success Criteria

- [ ] `sim:stairs_one_car`, `sim:stairs_transit`, `sim:stairs_ambush` and
      `client:stairs` green; gates 1–3 green repo-wide.
- [ ] §8 throughput recompute recorded in prd v1.6 (one elevator + stairs).
- [ ] Kill checks pinned: ambush-only scenarios record zero complaints;
      single-car guest cadence math lands before 3.3 Specify consumes it.
- [ ] Human 5-minute round check: stairs read as slower-but-anonymous; an
      ambush is legible to the victim and invisible to everyone else.
