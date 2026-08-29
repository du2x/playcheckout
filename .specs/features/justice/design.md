# Justice Design

**Spec**: `.specs/features/justice/spec.md`
**Status**: Approved (autonomous run — agent design per STATE precedent)

---

## Architecture Overview

Justice splits along the AD-002 seam exactly like every Phase 2 cycle: the pure
sim owns verdicts (walk-in detection, accusation validity, grace, the fired
set), the room owns transport (intent validation, fired-player teardown, error
replies), and the client owns presentation (hold-E menu, name-only toast,
rectangle removal). One new sim event (`player:fired`, internal `reason`
stripped at the registry projection), one new intent (`accuse`), no new
recipient policy — firing is public-but-name-only, so the existing `'all'`
policy is exactly the right width.

```mermaid
graph TD
    A[hold-E menu / confirm] -->|accuse intent| B[TurnoverRoom validate+guards]
    B -->|sim.accuse| C[RoundSim]
    C --> D[Justice verdicts + fired set]
    C -->|positions each tick| E[WorkChannels]
    E -->|active unprep channels| C
    D -->|player:fired event| F[Router]
    F -->|{playerId} to ALL| G[toast + rectangle removal]
    F -->|teardown hook| H[movement.leave + fired guard]
```

Grace is derived, not stored: RoundSim watches its own event stream — a
`room:trashed` event can only come from a completed un-prep, so the first one
closes the grace window. No new state home for "who un-prepped" is created
beyond the deal map the sim already holds.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --------- | -------- | ---------- |
| Registry + Router policy pipeline | `packages/shared/src/protocol/registry.ts`, `apps/server/src/rooms/router.ts` | Add one `'player:fired'` row (`'all'`); Router needs zero changes |
| `viewOf` null-context fallback | `packages/sim/src/movement.ts:399` | A `movement.leave`d player automatically drops out of every positional policy — fired players route like disconnected-but-connected viewers |
| `WORK-12` silent channel cancel | `packages/sim/src/work.ts:121` (`leave`) | Firing teardown reuses it verbatim |
| Segment-entry detection pattern | `packages/sim/src/work.ts:213` (`lastSegment` diffing) | RoundSim keeps its own 10-line copy for walk-in detection — decoupled from WorkChannels' interior-observation state |
| Intent zod + error plumbing | `packages/shared/src/protocol/intents.ts`, `IntentError` in `messages.ts` | `accuse` intent schema + two new error codes |
| AD-004 test shift seam | `RoundSimConfig.totalTicks` | Harness round reaches the buzzer fast; justice assertions run inside a real shortened round |
| Hold-E/tap-E keymap + riderSession pattern | `apps/client/src/app.ts`, `apps/client/src/riderSession.ts` | One session-shaped reducer for the accusation surface (menu + toast state), same one-state-home discipline |

### Integration Points

| System | Integration Method |
| ------ | ------------------ |
| Colyseus message handlers | `accuse` gets a `validate()` handler like every intent |
| Router teardown | Room routes `player:fired` → `movement.leave(firedId)` (channels already cancelled sim-side) |
| Client reducer registry | `player:fired` mapper added to the exhaustive `Record<RegistryKey, Mapper>` dispatch (AD-006) |

---

## Components

### `packages/shared` — protocol rows

- **Purpose**: Declare the firing event and accusation intent exactly once.
- **Interfaces**:
  - `SimEvent` gains `player:fired { playerId, reason: 'walkin' | 'wrong-accusation' | 'correct-accusation' }` — `reason` is server-internal, stripped by the projection (telemetry consumes it in 2.10 without protocol churn).
  - Registry row `'player:fired'`: payload `PlayerFired { playerId }`, `recipients: 'all'`.
  - `accuseIntentSchema = { type: 'accuse', targetId: string(min 1) }` (strict).
  - `IntentError.code` gains `'justice-rejected'` (covers every rejection edge with a human message; one code, message differentiates — the wire never distinguishes validity).

### `packages/sim/src/justice.ts` (new)

- **Purpose**: Verdicts and the fired set — the game's entire two-tier justice, inputs in, events out.
- **Interfaces**:
  - `constructor(deal: ReadonlyMap<string, Role>)`
  - `get fired(): ReadonlySet<string>`
  - `noteSabotage(saboteurId: string): void` — grace end (called by RoundSim on `room:trashed`)
  - `walkIn(entrantId: string, floor: GuestFloorId, room: RoomIndex, channelOwnerId: string | null): void` — fires the owner per JUST-01..03
  - `accuse(accuserId: string, targetId: string, inRange: boolean, roundActive: boolean): 'resolved' | RejectReason` — validity check + fire
  - `pendingEvents(): SimEvent[]` — drained by the next `RoundSim.tick()` (the `work:started` announce pattern)
- **Dependencies**: role deal only; never sees the wire.
- **Reuses**: nothing — deliberately standalone so WorkChannels stays channel-shaped.

### `packages/sim/src/roundSim.ts` — composition

- **Purpose**: Own walk-in detection and route verdicts.
- **Interfaces**:
  - `accuse(accuserId, targetId): 'resolved' | RejectReason` — public; return value is coarse (`resolved` vs rejection reason), never validity. Range check via a new `WorkChannels.positionOf(id)` query against `TUNING.ACCUSATION_RANGE_TILES`.
  - `tick()` gains: own `lastSegment` diffing → `justice.walkIn(...)` (before completions? No — before the WorkChannels tick's completions, see ordering below) → drain `justice.pendingEvents()`.
- **Tick order (deterministic)**: round-start deal → walk-in conviction check (segment diff against `work.activeUnprepOwner(floor, room)`) → `work.tick(positions)` (cancels → completions → settle → observation, unchanged) → justice pending flush → buzzer. A same-tick entry-then-completion convicts (channel active at entry tick, spec edge); a saboteur's own walk-out cancels their channel inside `work.tick` on the exit tick, so a later re-entry never self-convicts.
- **Reuses**: `deal`, `WorkChannels` queries.

### `packages/sim/src/work.ts` — two narrow queries

- **Purpose**: Expose what justice needs without leaking channel internals.
- **Interfaces**: `activeUnprepOwner(floor, room): string | null`; `positionOf(playerId): PositionSample | undefined`.

### `apps/server/src/rooms/TurnoverRoom.ts` — transport guards

- **Purpose**: Validate `accuse`, enforce live-ness, tear fired players down.
- **Behavior**:
  - `accuse` handler: round-active guard → sim.accuse → rejection sends `error { code: 'justice-rejected' }`; resolution sends nothing (event flushes next tick).
  - A room-level `fired: Set<string>` fed by the `player:fired` projection path: fired sessions get `movement.leave` + a live-ness guard on EVERY intent handler (`move:start`, `move:stop`, `elevator:call`, `elevator:press`, `work:start`, `accuse`) → error reply.
  - Router needs zero changes: `viewOf(fired)` is the null context, so positional policies exclude them; `'all'` rows still reach them.
- **Reuses**: existing handler/dispatch skeleton.

### `apps/client/src` — accusation surface + toast

- **Purpose**: Hold-E menu, name-only toast, fired self-state.
- **Interfaces**:
  - `accuseSession.ts` (new pure reducer, riderSession pattern): state = `{ menu: { targetId, targetName } | null, toasts: [...], selfFired: boolean }`; actions: holdEStart/holdEExpire/release, menuConfirm/menuCancel, playerFired.
  - `app.ts`: E keydown starts a 400 ms timer; expiry opens the menu (nearest live same-floor candidate within `TUNING.ACCUSATION_RANGE_TILES`, mirror of the server rule); keyup before expiry sends `elevator:call` (P4-2). Confirm sends `accuse`; cancel sends nothing.
  - `WorldScene`: remove a player's rectangle on `player:fired`; self-fired stops prediction intents and shows the fired state (full spectator camera is 2.9).
  - Toast DOM node in the HUD layer ("X was fired"), auto-expiring.
- **Reuses**: roster name map, DOM-over-canvas pattern, `sendElevatorPress`-style connection senders.

---

## Data Models

### Firing (wire)

```typescript
interface PlayerFired {
  readonly playerId: string
}
```

### Firing (sim-internal only — never projected)

```typescript
type FireReason = 'walkin' | 'wrong-accusation' | 'correct-accusation'
// SimEvent: { type: 'player:fired', playerId: string, reason: FireReason }
```

**Relationships**: the projection maps the internal event to the wire payload by
dropping `reason`; 2.10's telemetry reads the sim event stream 1:1 (FR-23) and
gets the reason for free.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| -------------- | -------- | ----------- |
| Accuse in lobby / after buzzer | `error 'justice-rejected'` | Toast-style error, nothing fires |
| Saboteur accuses | Same rejection | Menu closes with error |
| Target out of range / other floor / not live / self | Same rejection (server re-check) | Menu closes with error |
| Fired player sends any intent | Live-ness guard rejects | "You were fired" state; no intents |
| Double accusation same tick | First resolves, second rejected (target/accuser fired) | One toast |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| ------- | -------------------- | ------ | ---------- |
| Router assumes every connected client is movement-live (join/buzzer snapshots, exit handler) | `apps/server/src/rooms/TurnoverRoom.ts:94-105` | A fired player triggering the AD-017 exit path or snapshot logic with a null view could produce a broken snapshot | Fired set guard runs before any movement-intent handling; snapshot paths are only reachable via intents/movement events a fired player cannot emit. Pinned by a room test (fired player's intents all reject, no snapshot emitted) |
| `room:trashed` as the grace-end signal is indirect | `packages/sim/src/work.ts:166-171` | A future non-sabotage `room:trashed` source would silently end grace | Justice module comments pin the invariant ("room:trashed ⇒ saboteur un-prep completed"); the deal map has exactly one saboteur, so RoundSim attributes the event to them directly — no inference over actors |
| Client hold-E changes elevator-call timing (keydown → keyup for taps) | `apps/client/src/app.ts` | A held-too-long tap drops a call the old keydown path would have sent | The 400 ms window vastly exceeds deliberate taps; `client:accuse_ui` pins tap-still-calls; playtest (Gate 4) revisits via AD if it feels laggy |
| WorkChannels grows into a grab-bag (work + evidence + now queries) | `packages/sim/src/work.ts` | Deep-module erosion | Justice lives in its own module; WorkChannels only gains two read-only queries. Flagged for the architecture review cadence |

---

## Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Firing event flush timing | Intent-resolution events queue and flush on the next tick (the `work:started` announce pattern) | Intent handlers run between ticks; a tick-bounded flush keeps the sim's "events come from tick()" invariant intact. ≤50 ms delay is imperceptible; spec's "on that tick" reads as the resolution tick = the next simulated tick |
| One error code for all justice rejections | `'justice-rejected'` + message | The code set stays small; validity is never machine-readable on the wire anyway |
| Walk-in detection in RoundSim, not WorkChannels | Own 10-line segment diff | Keeps interior-observation state (WorkChannels) decoupled from verdicts (Justice); duplication is trivial and stateless |
| Grace derived from `room:trashed` events | No stored grace flag | One state home (the event stream); telemetry-compatible; no chance of drift between a flag and the actual sabotage history |

> Project-level decision to record: none beyond the spec's assumption table —
> no new recipient policy, no tuning change, no seam amendment. AD-002/AD-006/
> AD-008/AD-009 all hold as-is.
