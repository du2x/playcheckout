# Movement Specification (Phase 2 cycle 2.4)

## Problem Statement

After first-light the client shows characters but they cannot move — the game has no
body. Cycle 2.4 builds the persistent movement layer (AD-005): players walk the grand
lobby the moment the room exists, the full building (3 floors, elevators) unlocks at
round start, and positions persist across lobby→round→lobby. This is the spatial
substrate every later cycle (work channels, evidence, justice) stands on, and it
amends AD-002: movement lives in the room's always-running movement sim, round
mechanics stay in the round-scoped RoundSim.

## Goals

- [ ] A player can walk left/right in the grand lobby immediately after joining (pre-round), and across all 3 floors via two deterministic elevators once the round starts, verified by the `sim:motion`, `sim:elevator`, and `client:movement` gate scenarios.
- [ ] All clients see every player's position with ≤1 tick (50 ms) of server latency; positions, door-hallway visibility, and elevator panels remain protocol-clean (positions are public per turnover-protocol rule 2).

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Work channels, prep/un-prep/fake prep (FR-7–FR-9, FR-16) | Cycle 2.5 |
| Room interiors, door cards, auto-open cues (FR-10–FR-13) | Cycle 2.5 — 2.4 only establishes rooms as x-segments ("inside" = x within segment) |
| Walk-in conviction, accusation ranges (FR-14–FR-19) | Cycle 2.7 — needs positions from this cycle |
| Reconnection / ghost restore (FR-25) | Cycle 2.8 — a disconnected player's rectangle disappears; slot idles as in 2.1 |
| Client-side prediction polish (dead reckoning, interpolation tuning) | Own-player input renders immediately; others lerp — refinement deferred until playtests show jitter |
| Mobile/touch controls, cosmetics (§10 non-goals) | Non-goal |
| Elevator occupants in panels (FR-6) | Never — position only, by protocol rule |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Round start repositioning | Positions persist — no teleport at host start | User left the question open; agent default. Continuity, less machinery; FR-2 "spawn" reads as initial placement for fresh joiners | n (agent default, flagged) |
| Room geometry | A room is an x-segment on its floor's hall line; "inside" = x within the segment; depth (ROOM_DEPTH_TILES = 4) is the segment width | prd mandates strictly linear left/right movement (FR-4); nothing else is representable. Door/entry cues arrive in 2.5 | y (default) |
| Pre-round walking area | Grand lobby floor only; x clamped to lobby bounds, floor fixed to `lobby` until round start | User-confirmed | y (user) |
| Elevator pre-round | Elevators idle in lobby phase; calls accepted only while a round is active | Nobody can leave the lobby pre-round; a call would be a no-op | y (default) |
| Car selection on call | Call targets a floor; the car that would serve it sooner is dispatched; exact tie → car 1 (west). A call for a floor a car already heads to is ignored, but the panel still flashes (FR-5 decoy rule) | Deterministic and testable; prd leaves the assignment rule open | y (default) |
| Boarding when full | Capacity 2 per car (TUNING.ELEVATOR_CAPACITY): a 3rd player at the landing waits for the car's next arrival; the car departs on schedule | FR-5 locks capacity but not overflow behavior; waiting is the least-machinery option | y (default) |
| Input model | Client sends `move:start {dir}` / `move:stop` intents; server integrates at 6 tiles/s (20 Hz) and broadcasts `player:moved` while positions change | Continuous key-hold maps to one intent; server-authoritative (protocol conventions); no per-tick client spam | y (default) |
| Own-player latency | Client renders its own rectangle immediately on intent (local prediction); others interpolate from `player:moved` | Tutorial-reference pattern (linear interpolation + predicted input); keeps playtests from feeling laggy | y (default) |
| Broadcast rate | `player:moved` broadcast at 20 Hz while any connected player is moving; silent ticks emit nothing | 6 players × 20 Hz is trivial load; deterministic sim events mirror telemetry 1:1 | y (default) |

**Open questions:** none — all resolved or logged above (round-start repositioning flagged for user review).

---

## User Stories

### P1: Walk the grand lobby immediately after joining ⭐ MVP

**User Story**: As a player, I want to walk my character around the grand lobby as
soon as I join, so that the room feels alive before anyone starts the round.

**Why P1**: AD-005's core request — the game is playable from room creation, not from
host start.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a connected player holds a move direction THEN the client SHALL send a `move:start` intent, and the server SHALL integrate that player's x position at TUNING.PLAYER_SPEED_TILES_PER_SEC (6 tiles/s) at 20 Hz while the intent persists.
2. WHEN the player releases the direction THEN the client SHALL send `move:stop` and the server SHALL stop that player's x at its current value.
3. WHEN a player's position changes THEN the server SHALL broadcast a `player:moved` event (playerId, floor, x, facing) to all players; WHEN no position changed during a tick THEN the server SHALL broadcast nothing.
4. WHILE the room is in lobby state THEN every player's floor SHALL remain `lobby` and x SHALL be clamped to the grand lobby bounds (0 to HALL_LENGTH_TILES).
5. WHEN a player's move intent would move them through another player THEN both SHALL pass through each other (no collision) and both positions SHALL be broadcast.

**Independent Test**: `sim:motion` — scripted intents over the pure movement sim
assert integration at exactly 6 tiles/s, stop-on-release, facing flips, and no
events on idle ticks; `client:movement` — harness drives ArrowLeft/ArrowRight and
asserts own rectangle displacement ≈ speed × elapsed and other tabs' rectangles
following within 2 ticks.

---

### P1: Full-building movement unlocks at round start ⭐ MVP

**User Story**: As a player, I want to reach all 3 guest floors once the round
starts, so that the 24 rooms become part of the game.

**Why P1**: The round is spatially meaningless without floor access; the lobby
confinement must lift exactly at the host-start transition.

**Acceptance Criteria**:

1. WHILE the room is in round state THEN a player's x SHALL be unclamped to each floor's hall bounds and the player SHALL be able to change floors ONLY by riding an elevator.
2. WHEN the round starts THEN every player SHALL keep their current x and floor (no repositioning; AD-005 assumption — flagged for user review).
3. WHEN the buzzer fires and the room returns to lobby state THEN players SHALL remain at their current positions, their floor if not `lobby` included, and walkability SHALL re-confine to the grand lobby (their next move intent can only change x on the `lobby` floor) — full building re-locks until the next start.
4. IF a move intent arrives for a player inside an elevator car THEN the server SHALL ignore it (positions change only via the car's motion).

**Independent Test**: `sim:motion` extension — round-state floor/x freedom, buzzer
re-confinement, in-car move rejection; `client:movement` extension — post-buzzer
attempt to move off `lobby` floor is refused by the server (rectangle stays).

---

### P1: Deterministic elevators with position-only panels ⭐ MVP

**User Story**: As a player, I want to call an elevator to my floor and ride it, so
that floors are reachable; as an observer I want panels to show only where the cars
are, so that "who rode when" stays voice testimony.

**Why P1**: FR-5/FR-6 are the traversal backbone and a deliberate social-deduction
constraint (occupants never visible).

**Acceptance Criteria**:

1. WHEN a player sends an `elevator:call` intent for a floor WHILE a round is active THEN the server SHALL dispatch the car that would serve the call sooner (tie → car 1) and broadcast an `elevator:called` event (floor, car).
2. WHEN a call is dispatched THEN the car SHALL arrive at the calling floor after TUNING.ELEVATOR_ARRIVE_SECONDS (3 s) and ride at TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR (2 s per floor traveled).
3. IF a call arrives for a floor a car is already heading to THEN the server SHALL ignore the call for dispatch purposes and the panel SHALL still flash (FR-5 decoy rule).
4. WHEN a car arrives at a landing THEN players on that floor and queued there SHALL board up to TUNING.ELEVATOR_CAPACITY (2); players beyond capacity SHALL remain queued for the car's next arrival.
5. WHEN a car's destination is reached and boarding window closes THEN the car SHALL become idle at that floor until the next call.
6. Each car SHALL hold at most one pending destination (FR-5); a new call while the car is busy SHALL queue on the other car or wait.
7. All elevator events and panel state SHALL include car floor/position ONLY — never occupant ids (FR-6, protocol rule 2).
8. The elevator cycle SHALL be deterministic: for a fixed call sequence and tick schedule, car positions and events are identical across runs.

**Independent Test**: `sim:elevator` — scripted call sequences over the pure sim
assert arrive at exactly tick 60 (3 s), ride at exactly 2 s/floor, capacity
queuing, ignored-duplicate-call with panel flash, one-pending-destination, and
cross-run determinism; `client:movement` extension — two visible cars whose panel
positions update and never show occupants.

---

### P2: Movement snapshot for late joiners ⭐ MVP

**User Story**: As a player joining an active room, I want to see where everyone
currently stands, so that I am not staring at an empty lobby.

**Why P2**: Without it, mid-room joiners (the normal case for players 2–6) render
nothing until someone moves.

**Acceptance Criteria**:

1. WHEN a player joins (or the room returns to lobby at the buzzer) THEN the server SHALL send them a `movement:snapshot` containing every connected player's (playerId, floor, x) and each car's (carId, floor) — all public data (protocol rule 2).
2. WHEN a player leaves THEN the server SHALL broadcast a `player:left` movement event and all clients SHALL remove that rectangle.

**Independent Test**: `sim:motion` extension — snapshot content equals the sim's
current public movement state; `client:movement` extension — a late-joining tab
renders all prior rectangles immediately, and a leaver's rectangle disappears on
all tabs.

---

## Edge Cases

- IF a move intent names a direction the player already has THEN the server SHALL treat it as a no-op (idempotent start).
- IF `move:stop` arrives with no active move THEN the server SHALL ignore it.
- WHEN two players occupy the same x on the same floor THEN both SHALL render (pass-through); render order is client-local and may overlap.
- WHEN a player joins WHILE a round is active THEN the join is rejected (2.1 rule unchanged) — no movement snapshot is sent to them.
- WHEN the host starts the round WHILE players are mid-walk THEN their `move` intents SHALL continue uninterrupted (transition does not reset movement state).
- IF an `elevator:call` arrives in lobby state THEN the server SHALL reject it with an intent error and the panel SHALL NOT flash.

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MOVE-01 | P1: Lobby movement | T2/T5 | Implemented |
| MOVE-02 | P1: Lobby movement | T2/T5 | Implemented |
| MOVE-03 | P1: Lobby movement | T2/T5 | Implemented |
| MOVE-04 | P1: Lobby movement | T2/T5 | Implemented |
| MOVE-05 | P1: Lobby movement | T2/T5 | Implemented |
| MOVE-06 | P1: Building unlock | T2/T5 | Implemented |
| MOVE-07 | P1: Building unlock | T2/T5 | Implemented |
| MOVE-08 | P1: Building unlock | T2/T5 | Implemented |
| MOVE-09 | P1: Building unlock | T2/T5 | Implemented |
| MOVE-10 | P1: Elevators | T3 | Implemented |
| MOVE-11 | P1: Elevators | T3 | Implemented |
| MOVE-12 | P1: Elevators | T3 | Implemented |
| MOVE-13 | P1: Elevators | T3 | Implemented |
| MOVE-14 | P1: Elevators | T3 | Implemented |
| MOVE-15 | P1: Elevators | T3 | Implemented |
| MOVE-16 | P1: Elevators | T3/T5 | Implemented |
| MOVE-17 | P1: Elevators | T3/T5 | Implemented |
| MOVE-18 | P2: Movement snapshot | T3/T4 | Implemented |
| MOVE-19 | P2: Movement snapshot | T4 | Implemented |

**Gate mapping:** MOVE-01..05, 06..09 → `sim:motion` · MOVE-10..17 → `sim:elevator` · MOVE-18..19 → `sim:motion` + `client:movement` · all stories additionally exercised end-to-end by `client:movement` (gate 3).

**Coverage:** 19 total, 19 mapped to tasks (at Tasks phase), 0 unmapped.

---

## Success Criteria

How we know the feature is successful:

- [ ] `pnpm test:sim` runs `sim:motion` and `sim:elevator`: exact speed integration, clamp/confinement transitions, deterministic elevator cycles across ≥100-tick scripted sequences with bit-for-bit replay.
- [ ] `pnpm test:client` runs `client:movement`: keyboard-driven movement visible on 4 tabs within 2 ticks, lobby bounds pre-round, building unlock at start, panels position-only.
- [ ] A human can join a room, walk the grand lobby immediately, and ride both elevators to all 3 floors after host start.
- [ ] Protocol audit: no message contains roles, room interiors, elevator occupants, or grace state; all new types carry recipient comments (turnover-protocol rule 5).
