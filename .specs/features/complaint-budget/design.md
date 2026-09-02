# Complaint Budget Design (cycle 3.3)

## Components

The cycle crosses all four packages. One new seam (the room-intel port), one new
GuestSim phase path, one new RoundSim win leg, two new protocol rows, one new pure
client presenter.

### 1. `packages/shared`

- **`tuning.ts`**: `COMPLAINT_BUDGET: 8` — the first implementation of the existing
  §7 row ("Complaint budget | 8 (instant loss; trash-discovery complaints only since
  v1.5)"). No §7 value changes.
- **`protocol/simEvents.ts`**:
  - `RoundEndReason` gains `'budget-exhausted'` (prd §6.6: "Complaint budget
    exhausted — 8th guest complaint").
  - New guest-lifecycle events, extending the 3.B comment block:
    - `guest:angered { guestId, floor, room }` — the FR-29(b) stage-1 anger cue at
      the room; room-number level, no interior detail, no actor.
    - `guest:discovered { guestId, floor, room, fresh }` — the FR-29(b) stage-2 desk
      report; `fresh` is the freshness tier the guest observed (witnessed un-prep or
      fresh-tier trash → true; aged/churn → false).
  - `guest:complained` keeps its FR-29(a) wrong-delivery meaning unchanged.
- **`protocol/messages.ts` + `registry.ts`**: two new rows — `guest:angered`
  (`sameFloor`, `visibility: { floor }`, the suitcase:placed pattern) and
  `guest:discovered` (`all`). Amend the stale `GuestComplained` doc: wrong-delivery
  counts toward nothing since v1.5 (AD-039); the trash-discovery complaint is
  `guest:discovered`. Extend `RoundRecap` with `complaints: number` and
  `RoundResumed` with `complaints: number` (the 3.D settleScore precedent).
- **Leak audit**: `guest:discovered.fresh` is the entering guest's own interior
  observation — testimony, legitimate knowledge; no payload names an actor or a role;
  the budget count is public team state (HUD, FR-14).

### 2. `packages/sim`

- **`RoomIntelPort`** (guests.ts): the narrow read-only port the GuestSim consumes at
  arrival —
  ```ts
  export interface RoomIntelPort {
    roomStateOf(floor: GuestFloorId, room: RoomIndex): RoomState
    unprepActiveIn(floor: GuestFloorId, room: RoomIndex): boolean
  }
  ```
  Optional constructor-injected like `MovementPort`; **the owner identity never
  crosses** — RoundSim implements `unprepActiveIn` as
  `work.activeUnprepOwner(...) !== null`, so GuestSim learns only the boolean.
  Absent port (pre-3.3 direct GuestSim constructions and their tests) ⇒ arrival
  resolves to settle — the pre-3.3 semantics preserved as a test affordance;
  production RoundSim always supplies the port.
- **Arrival resolution** (guests.ts): the two door-arrival sites (self-assign
  `driveToRoom`, suitcase `driveToResting`) currently converge on `settleAt`.
  Replace the direct call with:
  ```ts
  if (port?.unprepActiveIn(floor, room)) → complain(fresh: true)   // witnessed the act
  else if (state === 'trashed')            → complain(fresh: true)   // fresh-tier sabotage
  else if (state === 'settled')            → complain(fresh: false)  // aged / churn
  else                                     → settleAt(...)           // prepped | fresh
  ```
  Tick ordering guarantees determinism: RoundSim.tick runs work.tick (completions,
  state flips) BEFORE guests.tick, so a same-tick un-prep completion reads as
  discovery, not flee.
- **The complaint path** (guests.ts): reuse `phase = 'toExit'` with a new
  `complaintReport: { floor, room, fresh } | null` field instead of a new phase —
  the angered guest walks home exactly like a checkout (landing → elevator → lobby →
  desk) and `driveToExit`'s desk-arrival branch branches on the report:
  report set → emit `guest:discovered` + `guest:left` in the same flush and despawn;
  report null → `guest:left` as today. At the discovery tick (same flush):
  `guest:angered`, reservation release, suitcase delete (absorbed — the dropCarry
  precedent), `joinGuest` back at the room door x (mirroring the checkout
  re-entry), tenancy untouched. No re-target exists — one complaint, no retry.
- **Budget + loss** (roundSim.ts): `complaintCount` increments in the guest-event
  loop on `guest:discovered`; the win-check ladder gains the third leg after the
  saboteur-fired and staff-reduced checks: `complaints >= TUNING.COMPLAINT_BUDGET`
  → `end('saboteur', 'budget-exhausted')` — same flush as the triggering event, and
  ahead of the buzzer verdict (the tie resolves to the budget). New getter
  `complaintCount` mirrors `settledCount`.

### 3. `apps/server`

- `TurnoverRoom.finishRound`: `round:recap` gains `complaints: sim?.complaintCount ?? 0`.
- The reconnect restore: `round:resumed` gains `complaints: sim.complaintCount`.
- No routing work — the registry projects the two new sim events; the Router is the
  only sender (bypass denylist unchanged).

### 4. `apps/client`

- **`ui/complaintHud.ts`**: pure presenter mirroring `ScoreHud` (AD-038 pattern):
  `onDiscovered()`, `seed(n)`, `reset()`, `freeze()`, `render() → "Complaints N / 8"`,
  plus a `pulsing` flag (count ≥ 6, the FR-14 threshold, presenter-local constant).
  Phaser-free, node-tested.
- **`net/mappers.ts` + `state.ts`**: map the two wire rows to scene-routed actions
  `guest-angered` / `guest-discovered`; extend the `round-recap`/`round-resumed`
  actions with `complaints`.
- **`WorldScene.ts`**: mount `<div id="complaint-hud">` beside the score HUD (pulse
  via a class toggle on the element); `guest-discovered` → walkie line
  (`a guest reports: someone hit F:R — maybe a minute ago` / `— a while ago now`) +
  presenter increment; `guest-angered` → a short-lived gray-box anger cue node at the
  room door x on the viewer's floor lane (TTL ≈ 2.5 s, pruned per-frame, harness-
  inspectable via the scene-children scan); `guest-complained` (wrong-delivery)
  keeps its walkie line and never touches the counter.
- **`app.ts`**: round-started → `reset(TUNING.COMPLAINT_BUDGET)`; round-resumed →
  `seed(action.complaints)`; round-ended → `freeze()` (the 3.D wiring pattern).
- **`resultsView.ts`**: render `budget-exhausted` as the loss reason line.

### 5. Harness (`apps/client/harness/complaints.spec.ts`)

`client:complaint_cues`, staged on the deterministic sabotage path (the churn path
is seeded-random over ~22 rooms — not harness-safe):
1. Four-player round (`TURNOVER_TEST_SHIFT_SECONDS=60`, guest scale 0.2); read each
   page's role card to find the saboteur page.
2. Staff A rides to floor1 and preps room 1 (5 s). The saboteur rides to floor1 and
   un-preps it (3 s) — fresh trash.
3. Staff B checks in the queued guest at the desk (assignment announced), rides to
   floor1, places the suitcase at room 1's door.
4. The guest walks to room 1 → discovery: assert the anger cue node on the floor1
   viewers' scenes and ABSENT on the lobby viewer's scene, the walkie desk-report
   line, `Complaints 1 / 8` on every HUD.
5. Wrong-delivery beat: check in the next queued guest and place at a room that is
   not the announced assignment → the door-complaint walkie line fires and the
   counter stays at 1.

### 6. Docs

- **`CONTEXT.md`**: two entries — **Complaint budget** (FR-31: 8 trash-discovery
  complaints = instant staff loss; wrong-delivery counts toward nothing) and
  **Trash discovery** (FR-29(b): two-stage — anger cue at the room, desk report at
  the desk, guest leaves; testimony, never justice). Avoid-rows for the rejected
  synonyms (fine, penalty points, conviction-by-guest).
- **`.specs/STATE.md`**: AD-041 (the cycle's recorded decisions: fresh-rooms-settle
  reading, flee counts, suitcase absorption, freshness-datum report, sameFloor cue,
  event naming, budget tie) + handoff update.

## Sequencing

T1 shared → T2 sim → T3 server/recap → T4 client → T5 harness → T6 docs + closure.
The verifier runs after T6 (standalone fresh-eyes pass per the repo's single-batch
size).

## Risks

- **Harness choreography length** (three rides inside a 60 s shift with guest
  elevator contention) — mitigated by the existing press-retry/doors-event patterns
  in suitcase.spec; the scenario reuses its staging helpers.
- **`guest:discovered` vs `guest:complained` confusion** — the registry docs and
  CONTEXT.md entries pin the boundary; `guest:complained` stays byte-identical.
- **Anger-cue poll timing** (short TTL vs harness polling) — 2.5 s TTL is ≥ 5× the
  poll interval used by the existing marker scans.
