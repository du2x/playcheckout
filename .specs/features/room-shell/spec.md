# Room Shell Specification (Phase 2 cycle 2.1)

## Problem Statement

Phase 1 proved a Fastify-hosted, message-only Colyseus transport with a join-only
placeholder room. Cycle 2.1 replaces that placeholder with the real round container:
a persistent room reachable by code, a lobby that gates host-start at ≥4 players, a
deterministic role deal (exactly one secret saboteur), and the 5:00 round clock. Every
later Phase 2 cycle (movement, work channels, evidence, justice, round-end, telemetry)
extends this room's sim state machine, so its lobby/round lifecycle and its
visibility rules are the foundation the rest of the phase stacks on.

## Goals

- [ ] 4–6 players can gather in one persistent room via a 4-letter code and start a round with exactly one secret saboteur, verified by the `server:lobby_join` and `sim:role_deal` gate scenarios.
- [ ] The round clock runs deterministically in the sim (20 Hz fixed-step, 300 s shift) and returns the room to a re-dealable lobby at the buzzer.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Movement, elevators (FR-4–FR-6) | Cycle 2.2 |
| Work channels, prep/un-prep/fake prep (FR-7–FR-9, FR-16) | Cycle 2.3 |
| Evidence layer: door cards, freshness, rustle (FR-10–FR-13) | Cycle 2.4 |
| Justice: walk-in, accusation, firing (FR-14–FR-19) | Cycle 2.5 |
| Win checks, results screen, recap (FR-20–FR-22); reconnect/ghosts (FR-25) | Cycle 2.6 |
| Telemetry JSONL (FR-23), exit-criteria bot sims | Cycle 2.7 |
| Lobby/HUD client UI (DOM overlay) | Phase 3; this cycle is headless + server tests, existing client gate scenarios must merely stay green |
| Round restart mid-clock, pausing, extending the shift | Not in prd; shift length is a locked §7 value |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Room/lobby shape | One persistent Colyseus room with `lobby`/`round` states; the room code is stable across rounds | Matches FR-1's "results screen → same room code, host re-deals"; no handoff machinery needed in 2.6 | y (user) |
| Behavior at buzzer | Room returns to `lobby` state, players retained, roles wiped, host may re-deal immediately | Minimal FR-1 re-deal mechanism without the 2.6 results screen | y (user) |
| Join after round start | Rejected with a "round in progress" error | Spectator/ghost work belongs to 2.6 (FR-25) | y (user) |
| Room code format | Server-generated 4 uppercase letters, used as the Colyseus roomId | Readable aloud; "fresh codes only for new groups" is free since codes die with rooms | y (user) |
| Display names | 1–16 chars after trim; duplicates rejected at join with a "name taken" error | FR-18 firing toasts are name-only, so names must be unambiguous | y (default) |
| Role deal ownership | Sim owns the deal: pure `deal(seed, playerIds) → roles`; server picks a fresh random seed each start | Keeps sim deterministic and gate-testable; room never stores roles outside per-player delivery | y (default) |
| Disconnect in lobby / mid-round | Host leaves in lobby → earliest remaining player becomes host. Mid-round leaver's player slot idles (no reconnection) until 2.6 | Full ghost/restore machinery is FR-25 (2.6); lobby needs a host to start | y (default) |
| Clock domain | Sim time: fixed-step 20 Hz ticks, 300 s = 6000 ticks; not wall-clock | Determinism is the sim's contract; buzzer timing must be bot-scenario-testable | y (default) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Join by code with display names ⭐ MVP

**User Story**: As a player, I want to join my friends' room with a 4-letter code and
a display name so that we gather in one persistent lobby.

**Why P1**: Nothing else in the game exists without a gathering point (FR-1).

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a client joins with a valid room code and unused display name THEN the server SHALL add the player to the lobby and send that player a personal snapshot containing their own player id, display name, and the lobby roster (ids + names only).
2. IF the room code matches no active room THEN the join attempt SHALL fail with a "room not found" error and create no room.
3. IF a player attempts to join WHILE the lobby already holds 6 players (TUNING.PLAYERS_MAX) THEN the join SHALL be rejected with a "room full" error.
4. IF a player attempts to join WHILE the room is in `round` state THEN the join SHALL be rejected with a "round in progress" error.
5. IF a player attempts to join with a display name that is empty after trim, longer than 16 chars, or already taken in the room THEN the server SHALL reject the join with the corresponding error and the roster SHALL be unchanged.

**Independent Test**: `server:lobby_join` — boot the real server on an ephemeral port, join by generated code, assert roster snapshots; then assert each rejection path (bad code, 7th player, mid-round join, duplicate/bad name).

---

### P1: Host starts the round with a secret role deal ⭐ MVP

**User Story**: As the host, I want to start the round once ≥4 players are gathered so
that everyone is secretly dealt a role with exactly one saboteur.

**Why P1**: The hidden saboteur is the product (FR-2); the start gate enforces the §7
attrition math (PLAYERS_MIN = 4).

**Acceptance Criteria**:

1. WHEN the host sends the start intent WHILE the room is in `lobby` state with ≥4 players (TUNING.PLAYERS_MIN) THEN the server SHALL enter `round` state and the sim SHALL deal roles such that exactly one player is the saboteur.
2. WHEN the deal completes THEN the server SHALL send each player a private payload containing only that player's own role, and SHALL include no player's role in any broadcast or any other player's personal payload.
3. IF the host sends the start intent WHILE fewer than 4 players are present THEN the server SHALL reject the intent with a "need more players" error and the room SHALL remain in `lobby` state.
4. IF a non-host player sends the start intent THEN the server SHALL reject the intent with a "not host" error.
5. IF the host sends the start intent WHILE the room is already in `round` state THEN the server SHALL reject the intent with a "round already active" error.
6. The sim SHALL be deterministic: for a fixed seed and player-id list, the deal and all subsequent sim behavior are identical across runs.

**Independent Test**: `sim:role_deal` — scripted bot scenarios over the pure sim assert one-saboteur-per-deal across many seeds and bit-for-bit determinism for a fixed seed; server-side, a 4-player room's start delivers per-player private roles (roles differ in count across players' received payloads only in own-role field).

---

### P1: Round clock and buzzer ⭐ MVP

**User Story**: As a player, I want the round to run on the 5:00 shift clock so that
the round ends at the buzzer and we can play again with the same group.

**Why P1**: The clock bounds every later mechanic; §7 locks SHIFT_SECONDS = 300.

**Acceptance Criteria**:

1. WHEN the round starts THEN the sim SHALL run at a 20 Hz fixed step and the round clock SHALL read 300 s (TUNING.SHIFT_SECONDS) remaining.
2. WHILE the room is in `round` state THEN the clock SHALL decrease by exactly 0.05 s per sim tick.
3. WHEN the clock reaches 0 THEN the server SHALL emit a buzzer event to all players and the room SHALL transition to `lobby` state with players retained and dealt roles wiped.
4. WHEN the host sends the start intent again in the lobby after a buzzer THEN the server SHALL deal fresh roles from a new seed with no memory of the previous deal.

**Independent Test**: `sim:role_deal` scenario extension — deal, advance 6000 ticks, assert buzzer event at exactly tick 6000 and clock values at sampled ticks; server-side, re-deal after buzzer starts a new round.

---

### P2: Lobby membership churn ⭐ MVP

**User Story**: As a player, I want the lobby to stay coherent when people leave, so
that the group can keep playing without stale hosts.

**Why P2**: Not needed to demo a round, but without host migration the first leaver
bricks the room.

**Acceptance Criteria**:

1. WHEN a player leaves WHILE the room is in `lobby` state THEN the server SHALL remove them from the roster and broadcast the roster change (ids + names only).
2. IF the host leaves WHILE the room is in `lobby` state THEN the server SHALL promote the earliest-joined remaining player to host.
3. IF a player disconnects WHILE the room is in `round` state THEN the sim SHALL keep the round running with that player's slot idle until the buzzer (full ghost/restore handling is cycle 2.6).

**Independent Test**: `server:lobby_join` extension — host leave promotes next player; leave in lobby updates rosters on remaining connections.

---

## Edge Cases

- IF a join intent arrives with a room code in lowercase THEN the server SHALL normalize to uppercase before lookup (codes are letters only).
- WHEN exactly 4 players are present THEN the start gate SHALL pass (boundary at PLAYERS_MIN); with 3 it SHALL reject.
- IF the host sends start in the same tick as a player leave that drops the count below 4 THEN the server SHALL process leaves first and reject the start.
- IF two joins with the same name race THEN the server SHALL accept exactly one and reject the other (join handling is serialized per room).
- WHEN the room returns to lobby at the buzzer THEN a subsequent join SHALL be accepted again (the room is in `lobby` state), subject to roster and name rules.

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| LOBBY-01 | P1: Join by code | T4 | Verified |
| LOBBY-02 | P1: Join by code | T4 | Verified |
| LOBBY-03 | P1: Join by code | T4 | Verified |
| LOBBY-04 | P1: Join by code | T5 | Verified |
| LOBBY-05 | P1: Join by code | T4 | Verified |
| DEAL-01 | P1: Role deal | T1 | Verified |
| DEAL-02 | P1: Role deal | T5 | Verified |
| DEAL-03 | P1: Role deal | T5 | Verified |
| DEAL-04 | P1: Role deal | T5 | Verified |
| DEAL-05 | P1: Role deal | T5 | Verified |
| DEAL-06 | P1: Role deal | T1 | Verified |
| CLK-01 | P1: Round clock | T2 | Verified |
| CLK-02 | P1: Round clock | T2 | Verified |
| CLK-03 | P1: Round clock | T2 | Verified |
| CLK-04 | P1: Round clock | T2 | Verified |
| CHURN-01 | P2: Membership churn | Design | Pending |
| CHURN-02 | P2: Membership churn | Design | Pending |
| CHURN-03 | P2: Membership churn | Design | Pending |

**Gate mapping:** LOBBY-01..05, CHURN-01..02 → `server:lobby_join` · DEAL-01..06, CLK-01..04, CHURN-03 → `sim:role_deal` · CHURN-03 server-side idle-slot behavior → `server:lobby_join`.

**Coverage:** 18 total, 18 mapped to tasks, 0 unmapped.

---

## Success Criteria

How we know the feature is successful:

- [ ] `pnpm test:sim` runs `sim:role_deal`: one saboteur across ≥1000 seeds, fixed-seed determinism, buzzer at exactly tick 6000.
- [ ] `pnpm test:client` stays green (existing boot scenarios unbroken; production strip check still passes).
- [ ] A headless 4-player integration round: join by code → host start → 4 private role payloads (exactly one saboteur, roles never in any broadcast) → 300 s sim clock → buzzer → lobby → re-deal.
- [ ] No role, seed-after-deal, or grace-like state appears in any client-bound message (protocol rule audit clean).
