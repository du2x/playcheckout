# First-Light Specification (Phase 2 cycle 2.2)

## Problem Statement

After cycle 2.1 the game is invisible: the room, role deal, and round clock all work
headless, but no human can see anything and Gate 3 has no honest client scenarios to
run. Cycle 2.2 builds the minimal browser slice — join by code, lobby, host start,
players as rectangles, round clock, own role card — proving the AD-001
Fastify+Colyseus wiring in a real browser and giving every later Phase 2 cycle real
`client:*` gate scenarios. It consumes only the existing T3 message catalog; the
protocol does not change (AD-003).

## Goals

- [ ] A human can open N browser tabs, join a room by code + name, watch the roster, start a round as host, and see labeled rectangles, a 05:00 countdown, and their own role card.
- [ ] `pnpm test:client` gains `client:lobby_join` and `client:round_start` scenarios driving a real server through headless Chromium via `window.__TURNOVER__`.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Movement, elevators, world layout (FR-4–FR-6) | Cycle 2.3; rectangles are static |
| Work channels, prep UI (FR-7–FR-9) | Cycle 2.4 |
| Evidence cues, door cards (FR-10–FR-13) | Cycle 2.5 |
| Justice UI: firing toasts, accusation (FR-14–FR-19) | Cycle 2.6 |
| Results screen, recap, reconnect UI (FR-20–FR-22, FR-25) | Cycles 2.7–2.8 |
| Any change to the message catalog | AD-003: consume existing T3 messages only |
| Roles other than one's own rendered anywhere | Hard protocol rule; production strip check must stay green |
| Auto-reconnect / connection-loss recovery | FR-25 belongs to the round-end cycle; first-light shows a static "connection lost" notice only |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Clock source | Client-side countdown: on `round:started`, display TUNING.SHIFT_SECONDS (300 s) counting down locally | Zero protocol change; no position/time sync exists yet to drift against. Revisit when cycle 2.3 introduces timed position data | y (user) |
| Own role display | `role:dealt` (private payload) is rendered as the player's own role card | It is the recipient's own legitimate knowledge and visually proves private-message routing end-to-end in a browser | y (user) |
| UI stack split | Join screen, lobby, role card, error banners as DOM overlay; round rectangles + clock in the Phaser scene | Matches the locked Phase 3 pattern (DOM overlay for lobby/HUD, Phaser renders the game world) — establishing it now is part of the de-risking | y (default) |
| Player id → name mapping in round view | Round view labels rectangles using the roster from the last `lobby:snapshot`, keyed by `round:started` playerIds | Client already holds the roster; ids alone are not human-readable | y (default) |
| Disconnect handling | Static "connection lost" notice; no retry, no reconnection | FR-25 reconnection machinery is the round-end cycle; first-light is a visibility slice | y (default) |
| Room code input | Client uppercases the entered code before joining | Server already normalizes; doing it client-side keeps join failures message-accurate | y (default) |
| Room creation UI (spec deviation, added during T3) | The join screen also offers "Create room" for the first player | The approved spec covered joining only — join-by-code alone leaves the human flow unreachable (nobody could ever create a room). Uses the existing server matchmaking (`client.create`), zero server/protocol changes | y (agent, flagged for review) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Join a room from the browser ⭐ MVP

**User Story**: As a player, I want to enter a room code and display name in the
browser so that I join my friends' lobby without any tooling.

**Why P1**: The whole point of first-light is that the existing lobby is reachable
by a human, not only by tests.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN the player submits a 4-letter room code and a display name on the join screen THEN the client SHALL connect to that room and display the lobby view with the player's own name and the roster from their personal `lobby:snapshot`.
2. IF the join is rejected (room not found, room full, round in progress, invalid or taken name) THEN the client SHALL display the server's rejection reason on the join screen and SHALL NOT enter the lobby view.
3. WHEN the player submits a room code containing lowercase letters THEN the client SHALL uppercase it before attempting the join.
4. WHILE the join screen is shown THEN the code field SHALL accept only letters (max 4) and the name field SHALL enforce the 1–16 character rule client-side before submit.

**Independent Test**: `client:lobby_join` — harness opens headless Chromium, drives
the join form against a real server, asserts lobby view content via
`window.__TURNOVER__`; a second scenario asserts each rejection path leaves the
player on the join screen with the server's reason visible.

---

### P1: Lobby view and host start ⭐ MVP

**User Story**: As the host, I want to see the roster fill up and press a start
button so that I can begin the round from the browser.

**Why P1**: Host-start is the only transition into a round; without it nothing else
in the slice is reachable.

**Acceptance Criteria**:

1. WHILE the room is in lobby state THEN the client SHALL render the roster (names only), the player's own name, and a host marker on the host's entry, updating on every `lobby:snapshot`.
2. WHILE the player is the host THEN the client SHALL render a start control that sends the `lobby:start` intent; WHILE the player is not the host THEN the client SHALL render no start control.
3. WHEN the client receives `round:started` THEN the client SHALL replace the lobby view with the round view.
4. IF the host's start intent is rejected ("need more players", "round already active") THEN the client SHALL display the error and SHALL remain in the lobby view.

**Independent Test**: `client:lobby_join` extension — multiple harness tabs join,
roster updates assert on every tab, only the host tab shows the start control;
starting with 3 players shows the rejection and stays in lobby.

---

### P1: Round view — rectangles, clock, own role ⭐ MVP

**User Story**: As a player, I want to see everyone as a labeled rectangle with the
shift clock and my own role so that I can confirm the round actually started.

**Why P1**: This is the "see things working" payload of the cycle, and the clock +
role card exercise both broadcast and private message paths in a real browser.

**Acceptance Criteria**:

1. WHEN `round:started` arrives THEN the client SHALL render one labeled rectangle per playerId (labeled with the roster name for that id) and a clock reading 05:00.
2. WHILE the round view is shown THEN the clock SHALL decrease by 1 second per elapsed wall-clock second and SHALL display 00:00 at zero without going negative.
3. WHEN the client receives `role:dealt` THEN the client SHALL display the player's own role card in the round view and SHALL NOT render any role information for any other player.
4. IF a roster name is missing for a `round:started` playerId THEN the client SHALL label that rectangle with the raw player id (defensive fallback).

**Independent Test**: `client:round_start` — 4 harness tabs join and the host
starts; each tab asserts 4 rectangles, correct labels, clock counting down across a
sampled interval, own role card present; a cross-tab assert confirms no tab can see
another's role.

---

### P2: Buzzer returns to lobby ⭐ MVP

**User Story**: As a player, I want the client to return to the lobby at the buzzer
so that the group can immediately play again.

**Why P2**: The room already re-deals after the buzzer (cycle 2.1); the client must
follow, or the group is stuck on a dead round view.

**Acceptance Criteria**:

1. WHEN `round:buzzer` arrives THEN the client SHALL replace the round view with the lobby view, clearing the role card and clock.
2. WHEN the host sends `lobby:start` after the buzzer THEN the client SHALL re-enter the round view with fresh rectangles and a clock reset to 05:00.

**Independent Test**: `client:round_start` extension — the harness fast-forwards by
driving a room whose TUNING shift is short in the test build (or asserts on the
second `round:started`), verifying the lobby view returns at the buzzer and the
second start renders a fresh round view.

---

## Edge Cases

- IF the WebSocket connection drops THEN the client SHALL display a static "connection lost" notice and SHALL NOT attempt reconnection (FR-25 belongs to the round-end cycle).
- IF a 7th player attempts to join via the browser THEN the join screen SHALL show the server's "room full" rejection (already enforced server-side; the client surfaces it).
- WHEN a player joins or leaves mid-lobby THEN all connected clients SHALL update their roster on the next `lobby:snapshot` without a page reload.
- IF the join form is submitted while a connection attempt is in flight THEN the client SHALL ignore the duplicate submission.

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| LIGHT-01 | P1: Join from browser | T1-T7 | Verified |
| LIGHT-02 | P1: Join from browser | T1-T7 | Verified |
| LIGHT-03 | P1: Join from browser | T1-T7 | Verified |
| LIGHT-04 | P1: Join from browser | T1-T7 | Verified |
| LIGHT-05 | P1: Lobby view and host start | T1-T7 | Verified |
| LIGHT-06 | P1: Lobby view and host start | T1-T7 | Verified |
| LIGHT-07 | P1: Lobby view and host start | T1-T7 | Verified |
| LIGHT-08 | P1: Lobby view and host start | T1-T7 | Verified |
| LIGHT-09 | P1: Round view | T1-T7 | Verified |
| LIGHT-10 | P1: Round view | T1-T7 | Verified |
| LIGHT-11 | P1: Round view | T1-T7 | Verified |
| LIGHT-12 | P1: Round view | T1-T7 | Verified |
| LIGHT-13 | P2: Buzzer returns to lobby | T1-T7 | Verified |
| LIGHT-14 | P2: Buzzer returns to lobby | T1-T7 | Verified |

**Gate mapping:** LIGHT-01..04, LIGHT-05..08 → `client:lobby_join` · LIGHT-09..14 → `client:round_start`. All scenarios run Gate 3 (real server + headless Chromium via `window.__TURNOVER__`); Gates 1–2 stay green throughout.

**Coverage:** 14 total, 14 mapped to tasks, 0 unmapped.

---

## Success Criteria

How we know the feature is successful:

- [ ] `pnpm test:client` runs `client:lobby_join` and `client:round_start` green: real server, real headless Chromium, assertions via `window.__TURNOVER__`; production debug-hook strip check still passes.
- [ ] A human 5-minute check: 4+ browser tabs join, host starts, rectangles + countdown + own role card are visible, buzzer returns everyone to lobby.
- [ ] Zero changes to `packages/shared/src/protocol/` (AD-003); no role other than the viewer's own ever appears in any rendered view.
- [ ] Gates 1–2 (`pnpm typecheck`, `pnpm lint`, `pnpm test:sim`) remain green — this cycle touches the client only.
