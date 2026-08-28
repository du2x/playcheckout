# Elevator Riders Design

**Spec**: `.specs/features/elevator-riders/spec.md`
**Status**: Approved

---

## Architecture Overview

All elevator semantics stay inside the pure `MovementSim` (AD-005: the sim owns
elevators); the protocol gains one new recipient policy and two rider-exclusive
messages; the Router applies the new policy generically; the client renders
rider knowledge as DOM chips only. The car becomes a four-phase state machine
(`idle` → `arriving` → `dwelling` → `riding`, idle/dwelling = doors open) with
a per-car FIFO press queue replacing the single pending destination.

```mermaid
graph TD
    P[Player intents<br/>elevator:call {} / elevator:press {floor} / move:start] --> R[TurnoverRoom zod validate]
    R --> MS[MovementSim<br/>car phase machine + press queue<br/>emits MovementEvent]
    MS -->|elevator:pressed / elevator:riders /<br/>elevator:called / elevator:moved /<br/>player:moved / player:left-floor| REG[PROTOCOL_REGISTRY<br/>+ riders policy]
    REG --> RT[Router<br/>viewContext: floor, roomKey, car]
    RT --> C[Client mappers → App<br/>DOM chip: occupants + last press]
    MS -.->|viewOf: car field| RT
    MS -.->|snapshotForRider| R
```

### Approach chosen (and rejected alternatives)

| Approach | Verdict |
| --- | --- |
| **A (chosen)**: press queue + occupancy events in `MovementSim`; new `riders` policy in registry/Router; HUD chip | Only approach that keeps elevator truth in the deterministic sim (AD-005), keeps the registry the single audit surface (turnover-protocol rule 5, AD-006), and keeps occupancy gate-testable by replay |
| B: room/server computes co-riders and sends bespoke occupancy messages | Splits elevator truth across sim and room; room-originated sends would bypass the sim-event → registry pipeline; replay tests lose occupancy coverage |
| C: scene-level car interior (riders rendered in-car) | Rejected in grilling — HUD chip is semantically identical, avoids touching the WorldScene rider-invisibility model (AD-009) |

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --- | --- | --- |
| Car state machine + tick loop | `packages/sim/src/movement.ts:298` | Extend phases (`dwelling`), replace `target` with `queue: FloorId[]`, add dwell countdown; boarding predicate unchanged |
| `board()` capacity/predicate | `packages/sim/src/movement.ts:350` | Reused as-is, invoked on arrival AND every open-door tick |
| Pending-announce pattern | `packages/sim/src/movement.ts:66,186` | Same next-tick emission for `elevator:pressed` and `elevator:riders` (deterministic ordering, no intent-time sends) |
| Registry row + `KeysWith` policy gate | `packages/shared/src/protocol/registry.ts:132,273` | Add `riders` policy + two rows; Router gate picks them up structurally |
| Router `dispatch` policy ladder | `apps/server/src/rooms/router.ts:95` | One new `riders` branch matching `viewContext.car` |
| ViewContext provider | `apps/server/src/rooms/TurnoverRoom.ts:76` + `movement.ts:257` | `viewOf` gains `car: 1 \| 2 \| null`; room supplies it unchanged |
| `player:left-floor` at boarding | `movement.ts:315` | Unchanged — boarding still removes riders from pickup-floor viewers |
| Panel DOM + mapper pipeline | `apps/client/src/ui/lobbyView.ts:52`, `roundHud.ts:35`, `net/mappers.ts:22`, `app.ts` | Chip elements sit beside `#elevator-panel`; two new mappers + App DOM writes |
| Intent schema pattern | `packages/shared/src/protocol/intents.ts:31` | `elevator:call` schema drops `target`; new `elevator:press` schema |

### Integration Points

| System | Integration Method |
| --- | --- |
| Work channels | Unchanged: boarding still cancels an active channel (`work.ts:121`); dwell walking is ordinary walking |
| Buzzer (`lock()`) | Unchanged: queue survives across the buzzer (AD-011); riders persist |
| Disconnect (`leave()`) | Removes the rider from `car.riders` and marks the car's occupancy dirty → `elevator:riders` update next tick |
| Harness scenarios | `movement.spec.ts` + `elevatorLobby.spec.ts` ride choreography rewritten for the press model |

---

## Components

### MovementSim elevator rework

- **Purpose**: Own the new car lifecycle and press queue deterministically.
- **Location**: `packages/sim/src/movement.ts`
- **Interfaces**:
  - `callElevator(playerId): 'dispatched' | 'ignored' | 'rejected'` — destination-free; duplicate = pickup floor only
  - `pressFloor(playerId, floor: FloorId): 'accepted' | 'ignored' | 'rejected'` — rider-only; queue or silently ignore
  - `startMove(playerId, dir)` — extended: a rider holding a direction while doors are open exits the car this intent (placed at the car's landing, `inCar = null`, walk proceeds next tick); still rejected while the car is `arriving`/`riding`. Exit ignores lobby-phase confinement (MOVE-08) — an in-car rider can always leave a car with open doors, in any phase; confinement applies to hallway walking after exit (AD-011: standing at a guest-floor landing pre-round is the status quo).
- **Dependencies**: `TUNING`, `FLOOR_IDS`, `TICK_HZ`
- **Reuses**: `dispatch`, `announce`, `board`, `rideTicks`, millitile integration

Car state machine (per car):

```
idle        doors OPEN   board checks every tick; answers calls (dispatch → arriving)
arriving    doors shut   60 ticks → dwell at pickup (board on entry, emit elevator:moved)
dwelling    doors OPEN   20 ticks (ELEVATOR_DWELL_SECONDS); board + walk-off every tick;
                         presses queue; on expiry → riding if queue non-empty, else idle
riding      doors shut   |Δfloors| × 40 ticks to queue[0] → arrive: floor = queue.shift(),
                         emit elevator:moved, enter dwelling (riders stay aboard)
```

Rules pinned in design:

- **Press acceptance**: rejected for non-riders; ignored silently when the floor is already queued, is being served (queue head while riding, OR the pickup floor while `arriving` — the pickup is the car's destination even though the queue is empty), or equals `car.floor` while doors are open. WHILE riding, a press of the car's origin floor is queueable (a return trip — the car is no longer "there"); the spec's "current floor" rejection reads as "the floor the car is stopped at with doors open", matching the grilling rationale ("you're already there; doors are open — walk"). Belt-and-braces: the departure transition asserts `rideTicks > 0` and pins it by test — a zero-tick ride is unreachable once the arriving-pickup rejection exists.
- **Exit re-capture guard (door-open episode)**: a player who exits a car is added to that car's `exitedThisStop` set; the board candidate filter excludes them until the car next DEPARTS (enters `arriving`/`riding`), which clears the set. Same-tick guards are insufficient — a walker needs ~4 ticks to clear the 1-tile boarding radius at 0.3 tiles/tick, and a pre-round exiter at a guest floor cannot walk at all (MOVE-08 confinement), so presence-based re-boarding would oscillate them board/exit forever. With the episode guard, exiting is final for the stop; the exiter walks away (lobby/round phase) or stands at the landing until the car departs or the round unlocks. Tick order unchanged: announced flashes → player movement → car ticks (dwell countdown, board checks, departures). Both the guard and no-oscillation are pinned by test.
- **Dispatch preference among idle cars**: empty idle cars first (closest landing, tie → car 1), then occupied-idle cars (same rule), then the call waits in the FIFO queue. An occupied-idle car is only drafted when no empty idle car exists — the rare residual "carried while deliberating" case, visible to the carried rider (they see the flash and the panel) and redirectable by press after the pickup dwell.
- **Ghost trips**: the queue belongs to the car; walk-offs never clear it. An empty car departs and serves.
- **Occupancy + queue events**: `elevator:riders` emitted whenever a car's rider list changes (board, walk-off, disconnect-dirty flush), payload = the car's full current list (cap 2) AND its current press queue. The queue rides in the rider-exclusive payloads so occupants always know it (late boarders, rejoiners via the seq-gap snapshot path) — the real-elevator "lit buttons are visible from inside" model, and the anchor for the no-uninformed-carry claim.

### Protocol registry + Router

- **Purpose**: Declare the two new rider-exclusive messages once; route them structurally.
- **Location**: `packages/shared/src/protocol/registry.ts`, `apps/server/src/rooms/router.ts`
- **Interfaces**:
  - `RecipientPolicy` += `'riders'` (deliver to viewers whose `viewContext.car === event.car`)
  - `EventVisibility` += `car?: 1 | 2`
  - `ViewContext` += `car: 1 | 2 | null` (`viewOf` supplies it; riders keep `floor: null`)
- **Reuses**: `KeysWith` policy gate, `dispatch` ladder, envelope stamping

New rows (turnover-protocol audit: occupancy and presses are legitimate
knowledge of the people inside the box — and only of them; FR-6 panels and
`elevator:called`/`elevator:moved` payloads stay `{floor, car}`/`{car, floor}`):

| Key | Payload | Policy | Visibility |
| --- | --- | --- | --- |
| `elevator:pressed` | `ElevatorPressed { playerId, floor }` | `riders` | `{ car }` |
| `elevator:riders` | `ElevatorRiders { car, riders, queue }` | `riders` | `{ car }` |

### Snapshots

- **Purpose**: Rider-branch personal snapshot; fix the AD-009 rider leak.
- **Location**: `packages/sim/src/movement.ts` (`snapshotForRider`), `apps/server/src/rooms/TurnoverRoom.ts:285`
- **Shape**: `MovementSnapshot` gains optional `carOccupants?: { car: 1 | 2; riders: string[]; queue: FloorId[] }` — present only when the viewer is a rider; a rider's snapshot carries an empty `players` list (no floor stream in a car, AD-009), both cars' public floors, and their car's occupants + queue. Non-rider snapshots are byte-identical to today (no occupancy field).

### Client

- **Purpose**: Consume the two new messages; in-car floor pressing; occupants chip.
- **Location**: `apps/client/src/net/connection.ts`, `net/mappers.ts`, `app.ts`, `scenes/WorldScene.ts`, `ui/lobbyView.ts`, `ui/roundHud.ts`
- **Interfaces**:
  - `Connection.sendElevatorCall()` (target dropped), `Connection.sendElevatorPress(floor)`
  - Mappers `elevator:pressed` → press action, `elevator:riders` → occupants action; App writes them to a `#elevator-riders` chip beside the existing `#elevator-panel` (lobby view and round HUD): occupant names, the car's press queue as four lit floor indicators (lobby/1/2/3 — lit = queued or being served), and a `#elevator-press` last-press line. Surgical `textContent`/class writes only; the indicators make "already lit" real and give press feedback without a keyboard UI change
- **Keymap**: not in car — existing call keys send destination-free `elevator:call`; in car — `1`/`2`/`3` press `floor1..floor3`, `0` presses `lobby`
- **Reuses**: mapper/reducer pattern, self-healing panel update in `WorldScene.update()`

---

## Data Models

```typescript
interface CarState {
  floor: FloorId
  riders: string[]
  phase: 'idle' | 'arriving' | 'dwelling' | 'riding'
  ticksLeft: number            // per-phase countdown
  pickup: FloorId | null       // set while arriving
  queue: FloorId[]             // press queue, FIFO, unowned (ghost trips allowed)
}
```

```typescript
// messages.ts additions
interface ElevatorPressed { playerId: string; floor: FloorId }
interface ElevatorRiders { car: 1 | 2; riders: string[]; queue: FloorId[] }
// MovementSnapshot gains: carOccupants?: { car: 1 | 2; riders: string[]; queue: FloorId[] }
```

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| --- | --- | --- |
| `elevator:press` from non-rider | Sim returns `'rejected'`; room maps to intent error | Nothing appears; no event |
| Duplicate / current-floor press | Sim returns `'ignored'` silently — no `elevator:pressed` | Nothing new on the wire; the chip's floor indicator is already lit |
| Same-floor re-call at an open-door car | `'ignored'` + decoy flash | Panel pulses; car stays |
| Walk held while car departs | Move intent rejected while `arriving`/`riding` (existing in-car rule); the rider stays aboard | Rectangle keeps riding |
| Rider disconnects mid-trip | `leave()` + dirty flush → remaining riders get an updated `elevator:riders` | Chip updates |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| --- | --- | --- | --- |
| Riders currently receive a lobby-floor snapshot (AD-009 leak) | `apps/server/src/rooms/TurnoverRoom.ts:285` | Rider mid-car sees lobby positions their view cannot legitimately contain | Fixed by `snapshotForRider` this cycle; pinned by a router-level test |
| Large pinned tick-math rewrite (~640 lines of movement tests assert arrival→auto-exit) | `packages/sim/src/movement.test.ts` | Mass test churn risks silently dropping MOVE coverage | Keep every MOVE id, rewrite assertions in place; MOVE-16/17 payload purity carries over verbatim; new ELR ids for new behavior |
| Exit re-capture (presence-based re-boarding) | `movement.ts` board filter + exit path | A just-exited player stands within the 1-tile boarding radius for ~4 ticks (or indefinitely pre-round under MOVE-08 confinement) — per-tick boarding would oscillate them and spam `elevator:riders`/`player:moved` | Door-open-episode `exitedThisStop` guard, cleared on departure; guard + no-oscillation pinned by tests (ELR edge) |
| Occupied-idle car drafted for a distant call carries a deliberating rider | `movement.ts` dispatch | Surprise carry in the rare no-empty-idle-car case | Dispatch prefers empty idle cars first; the carried rider sees the flash, rides visibly, and may press to redirect after the pickup dwell; residual case accepted, playtest revisit via new AD only |
| Harness ride choreography depends on the old call semantics | `apps/client/harness/movement.spec.ts`, `elevatorLobby.spec.ts` | Gate-3 scenarios break wholesale | Rewritten as part of the client task; press-driven ride helper shared by both specs |

---

## Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Press/occupancy event emission | Next-tick via pending queues (same as call flashes) | Single event path, deterministic replay, no intent-time sends |
| "Current floor" press rejection | Rejected only while doors are open at that floor; origin-floor press while riding queues a return trip; the pickup floor counts as being-served while `arriving` | Matches confirmed rationale ("you're already there; doors are open — walk"); literal reading would forbid return trips; arriving-pickup rejection closes the zero-tick-ride corner (design review 2026-08-28) |
| Exit re-capture guard | Door-open-episode set, cleared on departure — not a same-tick guard | Same-tick is provably insufficient (walk-off takes ~4 ticks; pre-round exiters can't walk at all); design review 2026-08-28 |
| Queue knowledge | Queue rides in `elevator:riders` + rider snapshots — occupants always see it | Real-elevator lit buttons; closes blind inheritance for late boarders/rejoiners; anchors the no-uninformed-carry claim (design review 2026-08-28) |
| Dispatch among idle cars | Empty idle first (closest landing, tie → 1), then occupied idle, then FIFO | Resolves the spec's "no surprise carries" rationale vs occupied-idle dispatch contradiction (design review 2026-08-28) |
| Boarding during open doors | Auto-board every open-door tick (arrival tick rule generalized), capacity + sort unchanged | One boarding rule everywhere; keeps instant-boarding semantics from the assumption log |
| Project-level: AD-013 / AD-014 | Recorded in STATE.md during Execute; AD-012's duplicate predicate + wrong-way-carry note amended; movement design.md "call semantics" interpretation marked AD-014-superseded | Tuning/decision rule; roadmap table shifts 2.6→2.10 inside AD-014's scope |
