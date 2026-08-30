# Round-End Design (cycle 2.9)

## Shape of the change

Three layers move together:

1. **Sim** (`packages/sim`) — win checks + the round journal, both pure.
2. **Server** (`apps/server`) — the `results` phase, recap assembly, the
   reconnection seat, spectator routing.
3. **Client** (`apps/client`) — results view, spectator overview, reconnect
   retry; protocol/state plumbing for four new messages.

The AD-002 seam is preserved: the sim owns win checks and the round journal
(round-scoped, pure); the room owns the results phase, rides (movement-layer
facts), reconnection, and abort. No tuning value changes.

## Sim: win checks + journal

### RoundSim

- New state: `ended: boolean`, `ghosted: Set<string>`,
  `journal: RecapEntry[]`, `pending: SimEvent[]` (announce pattern, drained at
  the top of `tick()`).
- `end(winner, reason)` — idempotent guard on `ended`; pushes
  `round:ended {winner, reason, saboteurId}` into `pending`.
- Win checks:
  - **Saboteur fired** — in `tick()`, after `justice.drainPending()`: if
    `justice.isFired(saboteurId)` → `end('staff', 'saboteur-fired')`. The
    `round:ended` follows its `player:fired` in the same flush (REND-01).
  - **Staff reduced** — same checkpoint (and after any ghost): live staff =
    `playerIds − fired − ghosted − saboteur`; if `=== 1` →
    `end('saboteur', 'staff-reduced')` (REND-02).
  - **Buzzer** — at `ticksLeft == 0`: push `round:buzzer` first, then evaluate
    coverage → `end('staff', 'coverage-met')` / `end('saboteur',
    'coverage-failed')` (REND-03). Coverage via the new WorkChannels query.
- `ghost(playerId)` — marks `ghosted`, silently. Any staff-reduced win queues
  into `pending` and flushes next tick. Ghosts cannot be accused (dead target)
  and their stale positions are filtered exactly like fired players' — the
  existing `live` filter grows a `ghosted` clause.
- Intents after `ended`: `accuse`/`startWork` return `round-not-active` (the
  existing `ticksLeft <= 0` guard gains `|| this.ended`).
- Journal (in-tick, deterministic order):
  - `room:trashed` → `{kind:'crime', tick, floor, room, fresh}` — `fresh` is
    captured at journal time via the existing freshness state (EVID-06 window:
    still `trashed` = fresh; `settled` = aged). Recorded from the work events
    the sim already emits.
  - `player:fired reason:'walkin'` → `{kind:'catch', tick, entrantId,
    saboteurId}` — Justice.walkIn already knows the entrant; the journal
    entry is built there.
  - `Justice.accuse` → `{kind:'accusation', tick, accuserId, targetId,
    correct}` — the sim stamps the tick.
  - Queries: `saboteurId` getter (room needs it for abort), `recapEntries()`
    (room appends rides), `preppedCount` on WorkChannels (count of states ===
    'prepped'; ROOMS_TOTAL already derivable from layout).
- Tick numbering: `tickIndex = totalTicks − ticksLeft` after decrement — the
  buzzer tick reads 0-based consistently across `totalTicks` overrides.

### New sim event

`round:ended` joins `SimEvent`:
`{ type:'round:ended', winner:'staff'|'saboteur', reason:'saboteur-fired'|'staff-reduced'|'coverage-met'|'coverage-failed', saboteurId }`
— the payload type (see protocol below) widens with `'aborted'` for the
room-originated path. The registry's exhaustive
`satisfies { [K in SimEvent['type']]: unknown }` forces the registry row in the
same commit.

## Protocol (`packages/shared`)

Four new registry rows (AD-006: one declaration each; client mappers are
exhaustive over `Payloads`, so compile fails until they exist):

| Key | Policy | Payload | Origin |
|---|---|---|---|
| `round:ended` | `'all'` | `{winner:'staff'\|'saboteur'\|'aborted', reason:string, saboteurId:string\|null}` | sim (projection widens winner) |
| `round:recap` | `'all'` | `{entries: RecapEntry[]}` | room |
| `spectator:snapshot` | `'self'` | `{players:[{playerId,floor,x}], cars:[{car,floor}], rooms:[{floor,room,state}], cardedRooms:[{floor,rooms}]}` | room |
| `round:resumed` | `'self'` | `{remainingTicks, playerIds, ownFired}` | room |

```ts
type RecapEntry =
  | { kind:'crime'; tick:number; floor:FloorId; room:RoomIndex; fresh:boolean }
  | { kind:'catch'; tick:number; entrantId:string; saboteurId:string }
  | { kind:'accusation'; tick:number; accuserId:string; targetId:string; correct:boolean }
  | { kind:'ride'; tick:number; car:CarId; riderIds:string[]; from:FloorId; to:FloorId }
```

Leak posture: `round:ended` is the ONLY message that ever names the saboteur,
and it exists only because the round is over (FR-21). `round:recap` reveals
accusation validity and ride occupancy for the same reason. The projection
for `round:ended` maps the sim's two-winner union into the wire payload
verbatim; the room's abort path constructs the payload directly (never routed
through a sim event — AD-002: disconnects are transport-shaped).

Client plumbing: `ViewAction` grows `round-ended` / `round-recap` /
`round-resumed` / `spectator-snapshot`; `ACTION_ROUTES` gains rows
(`round-ended`/`round-recap`/`round-resumed` → `view`; `spectator-snapshot` →
`scene`). `MAPPERS` gains the four keys.

## Server: results phase, recap, spectators, reconnection

### Phase machine

`lobby → round → results → (lobby:start) → round …`, joins allowed in lobby
AND results. Changes in `TurnoverRoom`:

- `advance()`: on routed `round:ended` → `phase = 'results'`, `sim = null`,
  broadcast the recap (below), send movement snapshots (the old buzzer block
  moves here verbatim — MOVE-18 snapshots fire on round end, not on buzzer
  alone). The `round:buzzer` event still routes (client clock/UI), but the
  room no longer flips to lobby at `clockTicksRemaining <= 0` — the ended
  event is the transition.
- `handleStartIntent`: accepts `lobby` or `results` (host check unchanged;
  `round-already-active` still guards the `round` phase).
- `onJoin`: accepts `lobby` or `results`; movement join + snapshots unchanged.
- Aborted path: room constructs
  `round:ended {winner:'aborted', reason:'saboteur-disconnected', saboteurId:null}`
  + `round:recap` via `router.toAll`, then the same teardown.

### Recap assembly

The room journals rides while `phase === 'round'`: it observes every event it
routes (it already does — the `advance()`/intent loops), so:

- `elevator:riders {car, riders}` → remember `lastRiders[car]`.
- `elevator:moved {car, floor}` → push
  `{kind:'ride', tick, car, riderIds:lastRiders[car] ?? [], from, to}`; `from`
  is the car's previous floor (tracked alongside). Tick here is the room's
  round-tick counter (incremented per `advance()` while the sim runs).
- On round end: `entries = [...sim.recapEntries(), ...rideJournal]` sorted by
  tick (stable), broadcast once as `round:recap`. Crime `fresh` is captured by
  the sim at journal time (see above) — the room does not re-derive states.

### Spectators (FR-20)

- `ViewContext` grows `spectator: boolean` (default false). The room's
  `setViewContext` callback returns `SPECTATOR_VIEW` (`floor/roomKey/car/x`
  null + `spectator: true`) for sessions in its `fired` set; everyone else
  gets `movement.viewOf` as today.
- Router `sameFloor` / `occupants` / `earshot` branches deliver additionally
  when `viewContext.spectator && visibility` names a target (the privilege is
  a view-context fact; the registry policy declarations are unchanged).
  `riders` is untouched — fired sessions never ride.
- On routed `player:fired`: after the movement teardown, the room sends the
  fired session `spectator:snapshot` (self) built from `movement` (all
  positions via a new all-floors query, car floors) + `sim` (all room states
  via a new `roomStates()` query, `cardedOn` for all three floors).
- Buzzer-end: the results phase clears the `fired` set's effect implicitly —
  snapshots at round end are the plain movement snapshots for everyone.

### Reconnection (FR-25)

- `TurnoverRoom.RECONNECT_SECONDS = 60` static (test/harness seam, same
  pattern as `tickMs`; harness/room tests set e.g. `0.3`).
- `onLeave(client, consented)`:
  - `consented`, or phase `lobby`/`results` → current behavior unchanged
    (delete, movement.leave, sim.leave, `player:left`, snapshots; REND-22).
  - Unconsented during `round`: keep the roster entry (mark `connected:
    false`) and the movement slot (frozen — no leave, no sim.leave);
    broadcast `player:left` once; then
    `await this.allowReconnection(client, RECONNECT_SECONDS)`.
    - **Resolved** (reconnect): `router.forget(sessionId)` (fresh per-
      connection seq), re-announce via a new `movement.announce(id)` (marks
      position dirty → one `player:moved` next tick; clients re-add displays
      for unknown ids), then restore: `role:dealt` (sim still alive), lobby
      snapshot (roster unchanged, but the fresh connection needs it), the
      movement snapshot path (spectator snapshot instead if they were fired —
      `ownFired`), and `round:resumed {remainingTicks, playerIds, ownFired}`.
    - **Rejected** (window expired):
      - Saboteur (sim still alive) → abort path above; then the FR-25
        teardown (`movement.leave`, roster entry removed, `player:left`
        already sent).
      - Staff → `sim.ghost(sessionId)` (queues any win check),
        `movement.leave(sessionId)`; roster entry kept so the recap still
        resolves their name. On the later round-end transition, disconnected
        roster entries are purged (they can rejoin fresh in results).
      - Round already over meanwhile → plain removal + roster snapshots.
- Colyseus 0.18 details verified against installed sources: `allowReconnection(client, seconds)` returns a Promise resolving with the reconnected
  client and rejecting on timeout; unconsented drops (raw ws close) pass
  `consented = false`. SDK: `client.reconnect(room.reconnectionToken)`.

## Client

### State (`state.ts`)

- `ViewName` grows `'results'`. `ViewState` grows:
  - `results: { winner, reason, saboteurId, entries } | null`
  - `roundEndsAtMs: number | null` — receipt-stamped deadline; when set,
    `clockRemainingMs` prefers it over `roundStartedAt + SHIFT_SECONDS`
    (the resumed clock is honest; fresh rounds keep the existing math).
  - `resumedPlayerIds` — folded into `roundPlayerIds` by the reducer.
- Reducer:
  - `round-ended` → `view:'results'`, store winner/reason/saboteurId (+ entries
    if the recap already arrived — entries merge on `round-recap`).
  - `round-recap` → store entries (works in `results` and, for safety, any
    view).
  - `round-resumed` → `view:'round'`, `roundPlayerIds`, `roundEndsAtMs = now +
    remainingTicks × 50`, `role` untouched (role:dealt re-arrives separately).
  - `buzzer` unchanged (transient lobby flip; `round-ended` in the same flush
    overrides to results). The buzzer no longer clears `role` — the results
    view needs nothing, and a resumed client may still be holding its card;
    the next `round-started` resets state as today.
  - `connection-lost` unchanged (`lost` view).

### Views (`ui/`)

- `resultsView.ts` (new): winner banner (`STAFF WINS` / `SABOTEUR WINS` /
  `ROUND ABORTED`), traitor line ("The saboteur was <name>", absent on
  abort), the recap timeline (`#recap-list`, one row per entry: tick, kind,
  named participants), roster, and the host start control reusing
  `lobby:start` semantics.
- `renderRoundHud` clock reads the resumed deadline when present.
- `render()` gains the `results` case; `syncScenes` keeps the world mounted
  through results (movement persists; rectangles keep moving behind the
  overlay).

### Spectator overview (`WorldScene.ts`)

- `selfFired` (accuse session) is already scene state — it becomes the
  spectator-mode switch. In spectator mode the scene renders the full
  building: four stacked lanes (lobby + 3 floors), each lane a hall line, all
  players' rectangles at `laneY(floor)`, door frames + card markers + interior
  tints on every guest lane, car ellipses at their lane. The scene-children
  contract holds: exactly one labeled Rectangle per player, one Ellipse per
  car — lanes are Graphics/DOM.
- `applyAction` re-adds a display when `player-moved` names an unknown id
  (reconnect re-announce; name falls back to the raw id until the roster
  syncs).
- The spectator baseline arrives as `spectator:snapshot` (scene-routed):
  seeds all-floors positions, car floors, card markers, and interior tints.
  Live deltas then arrive through the over-delivered stream.
- Live players' rendering is untouched (REND-15 asserted by the harness
  comparing a live page's rectangle set).

### Reconnect retry (`connection.ts`, `app.ts`)

- `Connection` exposes `reconnectionToken`; static `reconnect(token, cb)`
  wraps `client.reconnect`. The token is stored in `sessionStorage`
  (`turnover:reconnect`) at join/create time and replaced after each
  reconnect.
- `App.onDisconnect`: if a stored token exists → dispatch `connection-lost`
  and start a bounded retry loop (1 s interval, until the window closes);
  on success, swap `this.connection` and rewire callbacks; the resumed
  round flows through the normal action path (`round-resumed` flips
  `lost → round`). On final failure the lost view states the room code for
  manual rejoin. `render()` lost view gains the reconnecting state.
- Prod behavior: `sessionStorage` token with no server seat → `reconnect`
  rejects once → lost view. No debug hooks added (strip check untouched).

## Test map

| Gate | Layer | File |
|---|---|---|
| `sim:win_checks` | sim | `packages/sim/src/roundSim.test.ts` |
| `server:reconnect` + results/abort/recap | server | `apps/server/src/rooms/TurnoverRoom.test.ts` |
| `client:round_end` | harness | `apps/client/harness/roundEnd.spec.ts` |
| `client:spectator_view` | harness | `apps/client/harness/spectator.spec.ts` |
| reducer/mapper units | client | `state.test.ts`, `mappers.test.ts` |

Protocol/leak audit: a room test asserts a live player's message log contains
no `spectator:snapshot`, no `round:ended` before the round ends, and that
`round:ended` is the only event ever carrying `saboteurId`.
