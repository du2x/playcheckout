# Suitcase Transport Design (cycle 3.B)

## Architecture overview

The suitcase is **guest state**, not a new top-level system: one suitcase per
checked-in guest, owned by `GuestSim` (which already owns queue, hold,
assignment, tenancy, and teardown). `RoundSim` validates intents and forwards;
the room wires transport; the registry carries the wire. No new movement
authority — a carried suitcase is derived from the carrier's position stream.

```
desk:interact ──► RoundSim.deskInteract ──► GuestSim.checkIn
                       │  (assignment seeded + reserved, carrier set,
                       │   first carry leg starts, guest → holding area)
                       ▼
              guest events (pending → next-tick flush, existing pattern)
                       │
suitcase:place ──► RoundSim.suitcasePlace ──► GuestSim.placeSuitcase
suitcase:pickup ─► RoundSim.suitcasePickup ─► GuestSim.pickupSuitcase
                       │  (rest room tracked; guest re-targets on rest)
                       ▼
              GuestSim.tick: carry clock → arrival outcome (settle | complain)
                       │
              carry-clock expiry → RoundSim fire pipeline (justice teardown)
```

## Components

### 1. `packages/sim/src/guests.ts` — suitcase store + guest-following

- **Suitcase record** per checked-in guest: `{ carrier: playerId | null,
  rest: { floor, room } | 'desk' | null, legStartTick: number | null }`.
  Invariant: exactly one of carrier/rest is set; `rest: 'desk'` is the
  teardown rest position (pickupable near `DESK_X_TILES`).
- **Reservation set** `reserved: Set<roomKey>` — vacancy for assignment and
  self-assign rolls excludes tenanted **and** reserved rooms. Assignment adds;
  settle converts reservation → tenancy (commit moves from route-time to
  settle-time for the desk path; self-assign keeps its 3.1 commit-at-roll);
  void/leave releases.
- **Phases**: `held` (3.2 guest-at-desk hold) is **deleted**; new `waiting`
  phase (holding-area stub). `held`/`heldBy`/`releaseHeld`/`releaseAll`
  replaced by carry teardown `dropCarry(playerId)` (fired/ghost/disconnect):
  suitcase → `rest: 'desk'`, guest → queue front with impatience resumed from
  its frozen clock, assignment void + reservation released.
- **Check-in** `checkIn(playerId, tick)`: replaces `receiveAtDesk` — same
  eligibility (round active, live, lobby, `DESK_RANGE_TILES`); player must not
  already carry. Seeds the assignment (uniform random vacant, guest Rng
  stream), reserves, sets carrier + `legStartTick`, moves guest to `waiting`
  (holding slot i = `GUEST_HOLD_START_TILES + i × GUEST_QUEUE_SPACING_TILES`),
  emits `assignment:overheard` + `suitcase:carried` (+ lifecycle facts) into
  the pending flush.
- **Place/pickup** `placeSuitcase(playerId, room, tick)` /
  `pickupSuitcase(playerId, tick)`: server-side range validation against
  `roomDoorXMilli(room)` (place) / nearest resting suitcase on the player's
  floor (pickup, tie → lowest guestId). Pickup starts a fresh leg. Rest emits
  `suitcase:placed` (no walkie line) and re-targets the guest.
- **Guest-following drivers**: on every rest event the guest (if `waiting` or
  `toRoom`/door-waiting) re-targets `driveToRoom(restRoom)`. On reaching the
  door (existing `ARRIVAL_TOLERANCE_TILES`): if the suitcase still rests at
  that room → resolve outcome; else stand at the door (door-waiting) until the
  next rest event. Outcome: room == assignment → settle (existing path;
  tenancy commits here); room != assignment → emit `guest:complained`, return
  the guest to its holding slot, re-target on next rest.
- **Carry clock**: in `tick`, for each carried suitcase with
  `tick − legStartTick ≥ CARRY_CLOCK_SECONDS × TICK_HZ` → raise
  `carryExpired(carrierId)` on a new internal drain list consumed by
  `RoundSim` (fires via the justice teardown path, then `dropCarry`).
- **Work block query**: `isCarrying(playerId)` consumed by
  `RoundSim.startWork` (rejects silently before `WorkChannels.startWork`).

### 2. `packages/shared/src/protocol/` — registry-first wire changes

simEvents additions:

| Event | Payload |
| --- | --- |
| `assignment:overheard` | `{ guestId, room }` |
| `suitcase:carried` | `{ guestId, carrierId }` |
| `suitcase:placed` | `{ guestId, floor, room }` |
| `suitcase:picked_up` | `{ guestId, carrierId }` |
| `guest:complained` | `{ guestId, room }` |

Registry rows: `assignment:overheard` → **new policy `'deskEarshot'**';
`suitcase:*` → `sameFloor` (visibility `{floor}`); `guest:complained` →
`'all'`. `EventVisibility` gains optional `x` (millitiles) for the desk
earshot selector. Registry entry `walkie:broadcast` **deleted** (T4).

Router (`apps/server/src/rooms/router.ts`): `deskEarshot` branch — deliver to
live non-spectator viewers with `vc.floor === 'lobby'` and
`|vc.x − visibility.x| ≤ DESK_EARSHOT_TILES × 1000`. Note this deliberately
**excludes** spectators (unlike the `earshot` rustle branch, which
over-delivers them) — a fired player must not learn later assignments.

Intents (`intents.ts`): `suitcase:place { room: number }` (floor derived from
the carrier's position server-side), `suitcase:pickup {}` (no args). Deleted
in T4: `desk:send`.

### 3. `apps/server` — room wiring

- `TurnoverRoom`: register `suitcase:place` / `suitcase:pickup` (zod, silent
  rejections — existing desk pattern); `desk:interact` handler unchanged
  (now check-in). Remove `desk:send` in T4.
- **Snapshot**: resting suitcases ride `movement:snapshot`'s guest extension
  (sameFloor-filtered like guests, following the 3.1 mechanism); carried
  suitcases are derived by the client from the carrier's position stream.
- Fired teardown: the existing fired/ghost/disconnect paths swap
  `guests.releaseAll(...)` → `guests.dropCarry(...)`.

### 4. `apps/client` — suitcase slice

- **State** (`state.ts`): `heardAssignments: Map<guestId, room>` (player-local
  knowledge, fed only by `assignment:overheard`), `suitcases: Map<guestId,
  {carrierId? | rest:{floor,room} | desk}>` (scene reducer).
- **Mappers**: one registry-keyed mapper per new event (the exhaustive
  `Record` forces them); `walkie-broadcast` mapper/menu deleted in T4.
- **WorldScene**:
  - Suitcase marker: small DOM-layer tag riding the carrier x or pinned at
    `roomCenterPx(room)` when resting; sameFloor view filter like guests.
  - E ladder (`keydown-E` resolution, replaces the 3.2 desk-menu branch):
    desk zone receive → landing elevator call (carrying or not) → place
    (carrying + within `ROOM_DOOR_RANGE_TILES` of a door) → pickup (not
    carrying + near a resting suitcase) → otherwise elevator call / accuse
    hold. Desk zone suppresses the accuse hold (unchanged).
  - Blind-place confirm: `#place-confirm` DOM (message + Confirm/Cancel);
    shown only when the target room ∉ local player's `heardAssignments`;
    Confirm sends `suitcase:place`. One click, not a refusal.
  - Assignment surface: the local player's own carried suitcase marker names
    the room when `heardAssignments` has it; no other pre-settle surface
    names it.
  - Walkie log (T4): `appendWalkieLine` becomes the generic lifecycle feed —
    lines composed client-side from event payloads + roster names:
    check-in "«Carrier» takes a guest's suitcase", pickup "«Carrier» picks up
    a suitcase", settle "a guest settles into F:R", complaint "the guest of
    F:R complained about the suitcase", checkout "a guest checks out of F:R",
    arrival/impatience lines kept from 3.1. Last-5 contract unchanged.
- **connection.ts**: `sendSuitcasePlace(room)`, `sendSuitcasePickup()`;
  `sendDeskSend` deleted in T4.

### 5. Teardown map (v1.4 replaces 3.2's hold teardown everywhere)

| Trigger | Suitcase | Guest | Assignment |
| --- | --- | --- | --- |
| Carry-clock expiry | rest at desk | re-queue front, impatience resumes | void + unreserve |
| Fired (accusation) while carrying | rest at desk | re-queue front, impatience resumes | void + unreserve |
| Ghost / disconnect mid-carry | rest at desk | re-queue front, impatience resumes | void + unreserve |
| Buzzer / round end | dies with round | dies with round (GUEST-11) | dies with round |

## Determinism notes

- All new sampling (assignment roll) goes through the existing guest `Rng`
  stream — no `Math.random`.
- Same-tick intent races resolve in intent-arrival order (existing room
  dispatch order); pickup tie-break is lowest guestId.
- Tick order inside `GuestSim.tick`: flush pending → carry-clock expiry drain
  → arrival/backlog → teardown checks → movement drivers → arrival outcomes.

## Risks

- **`held` deletion ripples** into 3.2's `desk_receive` suites — those tests
  are amended (receive = check-in; walk-out release no longer exists; the
  impatience freeze moves to check-in + teardown paths). The walkie-lie
  suites are deleted with the feature in T4.
- **Registry exhaustiveness** forces client mapper stubs in T1 — accepted;
  they are the real mappers' state fields from the start.
- **Earshot over-delivery to riders**: a viewer riding a car has
  `floor: null` (AD-013) — the `deskEarshot` floor check naturally excludes
  them; pinned by test.
