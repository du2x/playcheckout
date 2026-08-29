# Elevator Behavior — Accumulated Statements

A single document collecting every recorded statement about how elevators
behave, drawn from the authoritative sources. This doc **accumulates, it does
not arbitrate**: where a statement was amended by a later decision, the
amendment is noted and the original is struck through but kept for history.
[prd.md](../prd.md), [roadmap.md](../roadmap.md), and [.specs/STATE.md](../.specs/STATE.md)
remain the sources of truth; tuning changes still require a recorded decision
there (see [AGENTS.md](../AGENTS.md)).

---

## 1. Product requirements (prd.md)

- **FR-5** (prd.md:87): Two elevators at opposite ends of each floor. Capacity
  2 per car. Deterministic cycle: call → car arrives 3s → ride 2s **per floor
  traveled**. One pending destination per car; a call for the floor a car is
  already heading to is ignored, but the panel still flashes (decoys look
  registered).
- **FR-6** (prd.md:91): Public elevator panels show both cars' current
  positions only — never occupants (decoy calls emerge naturally; "who rode
  when" stays voice testimony).
- **§7 tuning** (prd.md:166): Elevator — arrive 3s / ride 2s per floor / cap 2.
- **Saboteur move** (prd.md:61): "decoy elevator calls" is a listed saboteur
  tool.
- **Evidence surface** (prd.md:14, prd.md:145): the hotel leaks traces via
  elevator panels; telemetry logs elevator calls/rides per round.
- **Art note** (prd.md:49): Elevator Action pixel style is explicitly out of
  scope (gray-box only for now).

## 2. Tuning values (current, `packages/shared/src/tuning.ts:21-28`)

| Constant | Value | Source |
| --- | --- | --- |
| `ELEVATOR_ARRIVE_SECONDS` | 3 | prd §7 (MOVE-11) |
| `ELEVATOR_RIDE_SECONDS_PER_FLOOR` | 2 | prd §7 |
| `ELEVATOR_DWELL_SECONDS` | 1 | **not in §7** — added by AD-014 |
| `ELEVATOR_CAPACITY` | 2 | prd §7 / FR-5 |
| `ELEVATOR_LANDING_TILES` | 1 | **not in §7** — added by AD-007 |

## 3. Locked decisions (`.specs/STATE.md`)

- **AD-005**: elevators are part of the persistent movement layer, ticked by
  the room in BOTH phases via the pure `MovementSim` (amends AD-002).
- **AD-007**: `ELEVATOR_LANDING_TILES = 1` — the boarding predicate ("a 3rd
  player at the landing waits").
- **AD-011** (STATE.md:215): elevators operate in **both phases** — from the
  moment the room exists, not from round start. Pre-round calls dispatch
  exactly as mid-round; the only rejection is a call from inside a car; the
  call FIFO is **not cleared at `lock()`** (queued calls are served across the
  buzzer by the next car to free). Amends the original "elevators idle in
  lobby phase" assumption.
- **AD-012** (STATE.md:236): dispatch responsiveness fix — idle-car choice
  prefers the car whose **landing** is closest to the caller's x (tie → car 1);
  boarding a car drops that player's queued calls; client pulses the panel on
  `elevator:called`. *Amended by AD-014*: duplicate predicate narrows to pickup
  floor only; wrong-way carry eliminated.
- **AD-013** (STATE.md:267): **rider-exclusive** occupancy and press knowledge.
  `elevator:pressed {playerId, floor}` and `elevator:riders {car, riders,
  queue}` go only to viewers riding that car; the queue rides in rider
  snapshots (`carOccupants`); non-rider snapshots are byte-identical to
  before. FR-6 panels and `elevator:called`/`elevator:moved` payloads stay
  `{floor, car}`/`{car, floor}` — never occupancy, never queue, never press
  targets.
- **AD-014** (STATE.md:292): **call-model rework** — `elevator:call` is
  destination-free; destination chosen inside the car via `elevator:press
  {floor}` (rider-only, no cancel) appended to a per-car FIFO press queue. The
  car becomes a four-phase machine (`idle`/`arriving`/`dwelling`/`riding`;
  doors open in idle + dwelling) with a 1 s dwell at every stop. Pins: (a)
  door-open-episode exit guard (`exitedThisStop`, cleared on next departure);
  (b) arriving-pickup press rejection (no zero-tick rides); (c) empty-idle
  dispatch preference; (d) queue-in-payload; (e) lit floor indicators on the
  rider chip.
- **AD-015** (STATE.md:337): lobby-phase movement confinement removed — a
  pre-round rider may walk immediately upon elevator arrival on any floor
  (amends AD-011's rider-confinement trade-off).
- **AD-019** (STATE.md): **duplicate predicate narrowed again** — a car parked
  open-doors (`idle`/`dwelling`) at the pickup floor no longer makes a call a
  duplicate: the parked car is excluded from dispatch and the **other** car is
  summoned to that floor (dispatched if idle, FIFO-queued if busy). The decoy
  flash remains only for: a car arriving at the pickup, a car riding with the
  pickup queued, an already-queued call, and **both** cars parked at the
  pickup. Narrows AD-012/AD-014; completes the AD-016 stranded-player fix.

## 4. Car state machine & mechanics

From `.specs/features/movement/{spec,design}.md` (cycle 2.4, as amended):

- Car machine: `idle(floor)` → `arriving` (fixed **60 ticks** = 3 s from call,
  regardless of distance) → board (instant, same tick) → `dwelling` (open-door
  stop, 20 ticks) → `riding` (**40 ticks per floor** traveled) → `idle(target)`.
- **Dispatch**: idle car whose landing is closest to the caller's x; tie →
  car 1; among idle cars **empty ones are drafted first**; occupied-idle only
  when no empty idle car exists; overflow calls queue sim-level FIFO and are
  served by the first car to free (MOVE-15).
- **Duplicate call** (decoy flash): a call for a pickup floor the car is
  already en route to (or queued for) emits `elevator:called` but **no new
  dispatch** (AD-014 narrows the predicate to pickup floor only; AD-019
  narrows it further — a car parked open-doors at the pickup is not a
  duplicate, the other car is summoned; the flash remains when **both** cars
  are parked at the pickup).
- **Boarding** (MOVE-13 + AD-014): on arrival/dwell, candidates are connected
  players on the car's floor within `ELEVATOR_LANDING_TILES` (1 tile) of the
  car's landing x, sorted by (distance, then playerId); first 2 board, rest
  wait for the next arrival. Boarded players: floor tracks the car, x pinned
  to the landing, move intents ignored.
- **Riding**: riders keep riding while the queue is non-empty even if the
  caller walked away; boarding drops the boarding player's own queued calls
  (AD-012); walk intents from riders are rejected while the car moves.
- **Stops**: doors open at every stop (1 s dwell, `ELEVATOR_DWELL_SECONDS`);
  riders may stay in (and press another floor) or walk off; on queue-empty the
  car **idles with doors open** at that floor — a car never moves
  spontaneously.
- **Ghost trips**: presses belong to the car, not the presser — walk-offs
  never clear the queue; an empty car still departs and serves pressed floors.
- **Caller-never-boards**: a pickup with nobody in boarding range completes
  without riders; the car idles open-doors at that floor; a re-call there
  summons the other car (AD-019) — with both cars parked, the re-call is the
  decoy flash and boarding/pressing is the only way to move a car.
- **Determinism**: for a fixed call sequence and tick schedule, car positions
  and events are identical across runs (bit-for-bit replay over ≥100-tick
  scripted sequences, `sim:elevator`).

## 5. Press queue (in-car destination model)

From `.specs/features/elevator-riders/spec.md`:

- Presses append to a per-car **FIFO** service queue (not last-press-wins, not
  directional); **no cancel/un-press** — ever-lit buttons; mispresses are
  livable.
- Valid press: floor not queued, not being served, not the car's current floor.
  Otherwise **rejected silently** (no event, no queue change) — keeps press
  testimony honest.
- Pressing the pickup floor while the car is `arriving` is rejected silently
  (no zero-tick rides).
- Pressing during dwell queues the floor; the car departs to it when the dwell
  ends.
- Non-rider `elevator:press` is rejected silently.
- Presses emit `elevator:pressed {playerId, floor}` to that car's riders only.
- Served riders may stay in the car and press another floor.

## 6. Information & visibility rules

- **Public** (FR-6, protocol rule 2): panels and `elevator:called`/
  `elevator:moved` carry car/floor position only — never occupants, queue
  contents, or press targets. Panels never show queue/targets; a public target
  would make tailing trivial.
- **Rider-exclusive** (AD-13/AD-014): occupancy and press queue are visible
  only from inside the car (`elevator:riders` payloads + rider snapshot
  `carOccupants`; late boarders and buzzer rejoiners see the queue — "lit
  buttons from inside").
- **Boarding is silent to bystanders** — no `elevator:boarded` message;
  inference from stream-stop suffices. **Exit is visible** via the normal
  same-floor `player:moved` stream (rider resumes at the car's landing).
- A fresh player joining mid-trip sees the car's position (public) but never
  its occupancy or queue.
- Non-riders (including a rider who just walked off) learn nothing beyond what
  public position streams already show.

## 7. Phase behavior

- Elevators run from the moment the room exists (AD-011) — pre-round calls
  dispatch exactly as mid-round; the FIFO is not cleared at `lock()`; in-flight
  trips and queued calls complete across the buzzer.
- The only `elevator:call` rejection is a call from **inside a car**
  (`elevator-locked` error).
- Players off the lobby floor at round start keep their positions (MOVE-07);
  no gather-up semantics (AD-011 trade-off, reinforced by AD-015).

## 8. Presentation & animation (client)

From `.specs/features/elevator-animation/spec.md` (client-only; no protocol/
sim changes):

- Doors visibly open on `idle`/`dwelling` cars on the local player's floor and
  close before any position change, timed off `TUNING.ELEVATOR_DWELL_SECONDS`.
- Cars tween between floors instead of snapping, timed off
  `ELEVATOR_ARRIVE_SECONDS`/`ELEVATOR_RIDE_SECONDS_PER_FLOOR`; between known
  stops the car renders as departed/in-transit — bystanders can never know
  destination or ETA (AD-013 boundary).
- Bystanders cannot distinguish occupancy from the wire: ghost trips animate
  identically to occupied cars.
- Riders render on no floor (AD-009); the DOM rider chip is the only rider-POV
  surface; the boarder's own car shows no Ellipse/door state while riding.
- Door/motion animation renders only for cars on the local `viewFloor` (no
  cross-floor leakage).
- Duplicate back-to-back calls (decoy flash) on an already-open car do not
  restart the door animation (idempotent).
- Harness contract preserved: exactly one `Rectangle` per player, one `Ellipse`
  per car in `scene.children.list`.
- Spectator full-building elevator rendering is a separate, unspecified
  feature (FR-20) — out of scope so far.

## 9. Edge cases (`.specs/features/elevator-riders/spec.md:141-150`)

- Exiting a car is final for that stop (door-open-episode guard): an exiter
  cannot re-board until the car next departs; exit is available in any phase.
- A rider pressed during dwell before departure queues normally — pressing is
  never rejected for a rider by car state.
- Both cars busy → call queues FIFO, served by the first car to free.
- A queued call is dropped when its caller boards another car (AD-012 #3).
- Buzzer with calls queued → in-flight trips complete, queued call dispatched
  by the next car to go idle (no drop).
- Simultaneous board/walk-off in the same tick is resolved deterministically
  (order fixed in design, pinned by test).

## 10. Explicit non-behaviors / out of scope

- Press cancel / un-press (ever-lit buttons).
- Directional collective service order (FIFO only for v1).
- In-car redirect intent (superseded by the press queue — the press IS the
  redirect).
- New bystander-facing boarding/exiting messages (exit stays on the public
  `player:moved` stream).
- Sound/audio cues (prd.md:49; the animation cycle is visual-only).
- Rider-POV in-scene car interior (AD-009 stands).
- Any tuning change to arrive (3 s), ride (2 s/floor), capacity (2), landing
  tiles (1) — locked §7 values.

---

## Source index

| Document | Role |
| --- | --- |
| `prd.md` (§6.2 FR-5/FR-6, §7, §6.8) | Original product statements |
| `roadmap.md` (2.4, 2.6) | Cycle commitments |
| `.specs/STATE.md` (AD-005/007/011/012/013/014/015) | Recorded decisions & amendments |
| `.specs/features/movement/{spec,design}.md` | Base elevator model (MOVE-10..17) |
| `.specs/features/elevator-lobby/{spec,validation}.md` | Both-phase operation (AD-011) |
| `.specs/features/elevator-riders/{spec,validation}.md` | Rider knowledge & press queue (AD-013/AD-014) |
| `.specs/features/elevator-animation/{spec,validation}.md` | Client presentation rules |
| `packages/shared/src/tuning.ts` | Live constant values |
