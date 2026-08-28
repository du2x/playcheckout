# Protocol Registry Specification (Phase 2 cycle 2.3)

## Problem Statement

One protocol fact — "sim event X reaches recipients Y and transitions the view to Z" —
is hand-maintained across six stations: the sim event union, the shared message
interfaces + recipient comments, the `TurnoverRoom.route()` switch, the per-type
`connection.ts` handlers + `ServerMessage` union, the `app.ts` message switch, and the
reducer actions. The recipient policy — the security core of the game (hidden
information is the product) — is enforced by a grep audit (turnover-protocol rule 5),
not by structure, and the hand-maintained `BroadcastGameEvent`/`PrivateGameEvent`
unions can drift from `route()`. Meanwhile `envelope.ts` is a dead parallel catalog
(zero code references) holding exactly the fields the live protocol needs: per-connection
`seq` and server `time` (AD-004 accepts clock divergence only until server time fields
exist). Cycles 2.4+ add ~15 message types; per-type pass-throughs and audit-by-grep do
not scale. This cycle (AD-006) deepens the pipeline into one module per side: a
protocol registry in `packages/shared`, a generic per-room Router in `apps/server`, a
generated dispatcher with exhaustive view mappers in `apps/client`. Behavior is
preserved; every existing gate stays green.

## Goals

- [ ] Every server→client message type is declared exactly once in the protocol registry (payload type + recipient policy), verified by compile-time exhaustiveness and the `server:protocol_registry` gate scenario.
- [ ] Every server→client message arrives wrapped in an envelope `{ seq, time, payload }` with a per-connection monotonic `seq`; a client that observes a gap rejoins via the existing connection-loss path, verified by `client:envelope_gap`.
- [ ] All pre-existing gate scenarios (`server:lobby_join`, `sim:role_deal`, `client:lobby_join`, `client:round_start`) pass unmodified — the migration is behavior-preserving.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Reducer consuming server time (clock re-derivation, review candidate C4) | Envelope stamps `time` this cycle; consuming it is a later cycle — keeps this cycle behavior-preserving; AD-004 divergence note extended by AD-006 |
| New recipient policies (`roomOccupants`, `nearby`) | Land with their first consumer (2.4 movement / 2.6 evidence) — the enum extends deliberately, never speculatively |
| Client→server intents | Unchanged: zod `validate()` handlers, no registry involvement (review Q1) |
| Telemetry emission (FR-23) | Cycle 2.9; this cycle only keeps the registry telemetry-shaped (one declaration per event, seq/time on the wire) |
| Freshness-as-derivation (C5), view-logic concentration (C6), room clock adapter (C3) | Separate deepening candidates from the architecture review |
| Runtime (zod) validation of server→client payloads | The server is the trusted author; intents stay zod-validated (review Q6) |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Registry scope | Every server→client type, including room-originated (`lobby:snapshot`, `error`); one catalog, one audit surface | Grilling Q1(b), user-accepted | y (user) |
| Recipient policy form | Closed enum `'all' \| 'self'`; policy data (room id, radius) rides in the event payload; router implements each policy once | Grilling Q2(a)/Q7(a), user-accepted — auditable by structure, extension is deliberate | y (user) |
| View transitions | Not in the shared registry; client keeps its own table keyed by wire name, exhaustive via `Record<RegistryKey, Mapper>` | Grilling Q3(b)/Q9(a), user-accepted — UI iteration must not touch the security surface | y (user) |
| Wire shape | Nested envelope `{ seq, time, payload }`; in-payload `type` literal dropped (wire name is the only type tag) | Grilling Q8, user-accepted | y (user) |
| Gap handling | Client detects non-consecutive seq → records gap in dev hook → rejoins via existing connection-loss path → fresh snapshot on join | Grilling Q4(a)/Q12(a), user-accepted — rejoin-via-snapshot is the only resync mechanism that exists | y (user) |
| Router placement | Per-room Router module in `apps/server`, owns seq counters and policy implementations; room-originated sends go through Router helpers | Grilling Q11(a), user-accepted | y (user) |
| Migration | Big-bang, one cycle: old switch/handlers/unions/envelope.ts deleted in the same cycle | Grilling Q5(a), user-accepted — five types; a strangler outlives the migration | y (user) |
| Server time consumption | Envelope stamps `time`; the reducer's tuning-derived clock is unchanged this cycle | Scope cut (AD-006 trade-off) | y (default) |
| Cycle placement | Inserted as 2.3, before movement (AD-006) | Movement's messages are born in the registry instead of migrating later | y (user) |

**Open questions:** none — all resolved in the grilling rounds.

---

## User Stories

### P1: One declaration per message ⭐ MVP

**User Story**: As a developer adding a protocol message, I want to declare it exactly
once, so that recipients, payload shape, and audit surface can never drift apart.

**Why P1**: The registry is the deepened module everything else hangs off; without it
the router and dispatcher have nothing to be generic over.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a developer adds a server→client message type THEN they SHALL declare it exactly once in the protocol registry: wire name, payload type, and recipient policy.
2. IF a `SimEvent` type lacks a registry entry THEN the workspace SHALL fail to compile (the registry is typed `satisfies Record<SimEvent['type'], RegistryEntry>`).
3. WHEN this cycle ships THEN the registry SHALL contain exactly the five pre-existing types — `lobby:snapshot` (self), `round:started` (all), `role:dealt` (self), `round:buzzer` (all), `error` (self) — and no new message types.
4. The `BroadcastGameEvent`/`PrivateGameEvent` unions and `packages/shared/src/protocol/envelope.ts` SHALL be deleted; the registry SHALL be the only catalog of server→client messages.

**Independent Test**: `server:protocol_registry` — walks the registry asserting every
entry declares a valid policy and the five expected keys exist; `pnpm typecheck` proves
exhaustiveness (gate 1).

---

### P1: Generic router with envelope stamping ⭐ MVP

**User Story**: As the server, I want to route sim events and stamp envelopes
generically, so that no per-type routing code exists and every message carries
ordering and timing.

**Why P1**: The router is where the recipient policy becomes structural — the security
invariant stops depending on each future author writing the right `sendTo`.

**Acceptance Criteria**:

1. WHEN the sim emits events THEN a per-room Router SHALL route each one per its declared recipient policy through a single generic code path with no per-type switch.
2. WHEN the server sends any server→client message (sim-routed or room-originated) THEN the Router SHALL wrap it as `{ seq, time, payload }` with a per-connection monotonically increasing `seq` and server `time` in milliseconds.
3. WHEN the same payload is broadcast to N connections THEN each connection SHALL receive its own next `seq` value.
4. Server→client payloads SHALL NOT carry an in-payload `type` literal; the Colyseus wire name SHALL be the only type tag.
5. WHEN `role:dealt` is routed THEN it SHALL reach only the named player's connection — by declared policy, not by a hand-written case.
6. IF a send or broadcast bypasses the Router THEN it SHALL be caught by a denylist test (no raw `.send(`/`.broadcast(` outside the Router module — same pattern as `packages/sim/src/literals.test.ts`).

**Independent Test**: `server:protocol_registry` — scripted rooms assert per-connection
seq sequences, per-recipient stamping on broadcast, self-policy privacy (role:dealt
reaches only the named player), and the bypass denylist; existing `sim:role_deal` and
`server:lobby_join` scenarios pass unmodified.

---

### P1: Generated client dispatch ⭐ MVP

**User Story**: As the client, I want one generated dispatch path from wire name to
reducer action, so that a new message type requires exactly one pure mapper.

**Why P1**: Deletes the shallow pass-through layer (per-type handlers, re-tagging
union, message switch) and keeps the reducer the single view machine.

**Acceptance Criteria**:

1. WHEN any registered message arrives THEN the client SHALL unwrap the envelope, verify `seq` continuity, and dispatch the payload through a pure `payload → ViewAction` mapper keyed by wire name.
2. IF a registry key lacks a client mapper THEN the client SHALL fail to compile (`Record<RegistryKey, Mapper>` exhaustiveness).
3. The hand-written `ServerMessage` union, the per-type `onMessage` handlers in `connection.ts`, and the message switch in `app.ts` SHALL be deleted.
4. The dev-only debug hook SHALL still record every server message, now including the envelope fields (`seq`, `time`).
5. WHILE running a production build THEN no `window.__TURNOVER__` hook SHALL exist (existing invariant, re-asserted against the new dispatch path).

**Independent Test**: `pnpm typecheck` (exhaustiveness); `client:lobby_join` and
`client:round_start` pass unmodified against the generated dispatcher (gate 3).

---

### P2: Seq-gap recovery ⭐ MVP

**User Story**: As a player, I want my client to recover cleanly if the message stream
breaks, so that I never act on a silently incomplete view.

**Why P2**: At 20 Hz personal streams (2.4+) a lost message is when, not if; the
recovery path must exist before the traffic does.

**Acceptance Criteria**:

1. WHEN a client observes a non-consecutive `seq` on a connection THEN it SHALL record the gap in the dev-only debug hook and rejoin through the existing connection-loss path (leave → connection-loss notice → fresh join → fresh lobby snapshot).
2. WHEN a client rejoins THEN its `seq` tracking SHALL restart with the new connection (counters are per-connection).
3. WHEN the buzzer returns the room to lobby THEN envelope stamping and seq continuity SHALL be unaffected (counters survive phase transitions).

**Independent Test**: `client:envelope_gap` — the harness forces a gap via the dev-only
hook, asserts the gap is recorded and the client rejoins to a fresh snapshot; phase
transition coverage rides the existing buzzer scenarios.

---

### P2: Audit becomes structural

**User Story**: As a reviewer, I want recipient rules declared in one registry, so
that the protocol audit is a walk, not a grep.

**Why P2**: Rule 5's grep audit dies the moment the catalog outgrows one file; the
registry makes the audit surface exhaustive by construction.

**Acceptance Criteria**:

1. WHEN a reviewer audits recipient rules THEN the registry's `recipients` fields SHALL be the audit surface — the `turnover-protocol` skill's rule 5 SHALL be updated to name the registry and retire the grep convention.
2. WHEN the `server:protocol_registry` walk runs THEN every registry entry SHALL declare a valid recipient policy and every policy in use SHALL have a Router implementation.

**Independent Test**: `server:protocol_registry` walk assertions; skill file diff
reviewed at design review.

---

## Edge Cases

- IF a reconnecting client's old and new connections overlap THEN seq tracking SHALL be per-connection — the old connection's counter is discarded with it.
- IF the sim emits an event while a recipient is mid-disconnect THEN the send to that client SHALL drop silently (existing Colyseus behavior, unchanged).
- WHEN a room-originated send (`lobby:snapshot`, `error`) is made THEN it SHALL go through the same Router helpers and carry the same envelope as sim-routed events.
- IF a developer declares a registry entry whose payload still contains a `type` literal THEN review SHALL reject it (wire name is the only tag; asserted by convention, not types).

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| REG-01 | P1: One declaration | T1 | Implemented |
| REG-02 | P1: One declaration | T1 | Implemented |
| REG-03 | P1: One declaration | T1 | Implemented |
| REG-04 | P1: One declaration | T1 | Implemented |
| REG-05 | P1: Router + envelope | - | Pending |
| REG-06 | P1: Router + envelope | - | Pending |
| REG-07 | P1: Router + envelope | - | Pending |
| REG-08 | P1: Router + envelope | - | Pending |
| REG-09 | P1: Router + envelope | - | Pending |
| REG-10 | P1: Router + envelope | - | Pending |
| REG-11 | P1: Client dispatch | - | Pending |
| REG-12 | P1: Client dispatch | - | Pending |
| REG-13 | P1: Client dispatch | - | Pending |
| REG-14 | P1: Client dispatch | - | Pending |
| REG-15 | P1: Client dispatch | - | Pending |
| REG-16 | P2: Seq-gap recovery | - | Pending |
| REG-17 | P2: Seq-gap recovery | - | Pending |
| REG-18 | P2: Seq-gap recovery | - | Pending |
| REG-19 | P2: Structural audit | - | Pending |
| REG-20 | P2: Structural audit | - | Pending |

**Gate mapping:** REG-01..04 → `server:protocol_registry` + gate 1 typecheck ·
REG-05..10 → `server:protocol_registry` (+ unmodified `sim:role_deal`, `server:lobby_join`) ·
REG-11..15 → `client:lobby_join`, `client:round_start` unmodified + gate 1 ·
REG-16..18 → `client:envelope_gap` · REG-19..20 → `server:protocol_registry` + design review.

**Coverage:** 20 total, 20 mapped to tasks (at Tasks phase), 0 unmapped.

---

## Success Criteria

How we know the feature is successful:

- [ ] `pnpm typecheck` + `pnpm lint` green with the exhaustiveness types in place (undeclared sim event = compile error; unmapped registry key = compile error).
- [ ] `pnpm test:sim` green: all pre-existing scenarios unmodified, plus `server:protocol_registry` (registry walk, per-connection seq, self-policy privacy, bypass denylist).
- [ ] `pnpm test:client` green: `client:lobby_join` and `client:round_start` unmodified against the generic dispatcher, plus `client:envelope_gap` (gap → recorded → rejoin → fresh snapshot).
- [ ] Protocol audit: every server→client type declared once with a recipient policy; no raw `.send(`/`.broadcast(` outside the Router; `envelope.ts` and the drift-prone unions gone; `turnover-protocol` rule 5 names the registry.
