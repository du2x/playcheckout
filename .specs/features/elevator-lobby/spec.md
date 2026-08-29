# Elevator in Lobby (AD-011, post-cycle 2.5 user change)

## Problem Statement

Elevators currently idle until the round starts: a pre-round `elevator:call` is
rejected with `elevator-locked` (movement spec's flagged default assumption
"Elevators idle in lobby phase"). The user rules otherwise: elevators run from
the moment the room exists — the full machine is testable with Playwright
without a host start, and the lobby feels alive (AD-005's intent, completed).
Recorded as **AD-011**; amends the movement spec assumption and its lobby-phase
rejection edge.

## Goals

- [ ] A player can call and ride an elevator before the round starts, with the exact mid-round event/visibility semantics, verified by amended `sim:elevator`/`sim:motion` legs, a server test, and the `client:elevator_lobby` harness scenario.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Pre-round walking on guest floors | Now in scope — AD-015 removed lobby-phase confinement; riders who stay on a guest floor pre-round may walk there immediately |
| Client UI changes | None needed — the client never gated calls on phase |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Queued calls across the buzzer | The FIFO is no longer cleared at `lock()` — elevators never idle, so a queued call is served by the next car to free, pre-round included | The clearing existed only because elevators idled in lobby phase | y (AD-011) |
| Round start with players off-lobby | Positions persist (MOVE-07 unchanged) — a player who rode pre-round starts the round on that floor | Gather-up semantics trade-off accepted by the user's directive; recorded in AD-011 | y (AD-011) |

**Open questions:** none.

---

## User Stories

### P1: Elevators run in both phases ⭐ MVP

**User Story**: As a player waiting in the lobby, I want to call and ride an
elevator before the round starts, so that the building is explorable (and
testable) from the moment I join.

**Acceptance Criteria**:

1. WHEN an `elevator:call` intent arrives from a player not inside a car — in either phase — THEN the server SHALL dispatch exactly as during a round: the sooner car (tie → car 1), the fixed 60-tick arrival, decoy flash on an already-targeted floor, FIFO queue when both cars are busy, and the same events (`elevator:called`, `elevator:moved`, rider `player:moved`, departure `player:left-floor`).
2. WHEN the buzzer fires with a call queued THEN the in-flight trips SHALL complete AND the queued call SHALL be dispatched by the next car to go idle (no drop).
3. IF the caller is inside a car THEN the server SHALL reject the intent with an `elevator-locked` error — the only remaining rejection reason.
4. WHEN a player rides pre-round THEN the lobby-phase move confinement (MOVE-08) SHALL NOT apply on guest floors: a rider who arrives on floor1 pre-round MAY walk there immediately (AD-015).

**Independent Test**: amended `sim:elevator`/`sim:motion` legs (pre-round ride
and walk-off on a guest floor, post-buzzer queued dispatch, in-car rejection),
server `elevator:call` pre-round dispatch test, and the `client:elevator_lobby`
harness scenario (ride up and back before any round starts).

## Requirement Traceability

| Requirement ID | Story | Status |
| --- | --- | --- |
| EL-01 | Both-phase dispatch | Implemented |
| EL-02 | Queue survives the buzzer | Implemented |
| EL-03 | In-car rejection only | Implemented |
| EL-04 | Confinement interplay | Implemented |

## Success Criteria

- [ ] `pnpm test:sim` and `pnpm test:client` green with the amended/new elevator legs.
- [ ] The pre-round Playwright scenario rides floor1 and back without any host start.
