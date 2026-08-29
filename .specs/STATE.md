# STATE

## Decisions

### AD-001
- **Decision**: The server is a single Fastify process that hosts Colyseus on one port — static client and WebSocket endpoint share `app.server` via the `colyseus/vite` wiring: `new WebSocketTransport({ noServer: true })` + `transport.attachToServer(app.server)` + `createNodeMatchmakingMiddleware()` mounted on Fastify's request chain.
- **Reason**: prd §11 locks single-container deploy (Railway). The `{ server: fastify.server }` transport option would register its express app as a competing `request` listener; the noServer+attachToServer pattern is Colyseus' own documented shared-HTTP-server mechanism (verified in 0.18.3 sources), with upgrade-only overlap and no request-flow conflict.
- **Trade-off**: We own an integration no public Fastify reference covers (first to publish it); separate-port dev setups would be simpler to debug but break the deploy contract.
- **Scope**: `apps/server`, all future rooms, CI smoke/boot tests.
- **Date**: 2026-08-27
- **Status**: active

### AD-002
- **Decision**: Room owns the lobby, sim owns the round. The Colyseus room (`TurnoverRoom`) manages roster, names, host, join/reject rules, and phase transitions; the pure sim (`RoundSim`) is created fresh at host-start with `(seed, playerIds)`, ticks 20 Hz, and dies at the buzzer. Lobby churn never enters the sim.
- **Reason**: Join/leave/name validation is transport-shaped; keeping it out of `packages/sim` keeps the deterministic core minimal, and every later Phase 2 cycle (2.2–2.6) extends only `RoundSim`.
- **Trade-off**: Two state homes (room phase + sim clock) with a sync point at start/buzzer — accepted; the seam is exactly two transitions, both gate-tested.
- **Scope**: All Phase 2 cycles, `packages/sim`, `apps/server/src/rooms`.
- **Date**: 2026-08-27
- **Status**: active

### AD-003
- **Decision**: Insert cycle 2.2 `first-light` before `movement`: a minimal client
  slice (join-by-code screen, roster, host-start, labeled rectangles + round clock
  once the sim starts) consuming only messages already in the T3 catalog. Cycles
  shift: movement → 2.3, work-channels → 2.4, evidence → 2.5, justice → 2.6,
  round-end → 2.7, telemetry → 2.8.
- **Reason**: Nothing is visually verifiable until Phase 3, so Gate 3 has nothing
  honest to assert; more importantly the Fastify+Colyseus wiring (AD-001) has no
  public reference and was only proven by a boot smoke test. A thin browser slice
  proves the riskiest integration before six cycles pile onto it, and gives later
  cycles real `client:*` gate scenarios.
- **Trade-off**: Pulls ~15% of Phase 3 forward; Phase 3 proper (movement rendering,
  work channels, evidence cues) stays put. Protocol risk is nil — only existing
  catalog messages are consumed, roles never render (protocol rule enforced early).
- **Scope**: `apps/client`, `.specs/features/first-light/`, roadmap.md cycle table.
- **Date**: 2026-08-28
- **Status**: active

### AD-004
- **Decision**: Test-only shift-length seam. `RoundSim` accepts an optional
  `totalTicks` config (default unchanged: `TUNING.SHIFT_SECONDS × TICK_HZ`); the
  TurnoverRoom passes `TURNOVER_TEST_SHIFT_SECONDS` (seconds → ticks at 20 Hz)
  only when `NODE_ENV !== 'production'`. The gate-3 webServer boots the real
  server with `TURNOVER_TEST_SHIFT_SECONDS=8` so client scenarios reach a real
  buzzer in seconds (8 s leaves margin for the LIGHT-09 clock sampling that
  must finish before the buzzer; originally 5 s, widened for flake margin).
- **Reason**: LIGHT-13/14 (buzzer → lobby, re-deal) are untestable in a real
  browser against a 300 s wall-clock shift; every later Phase 2 cycle's
  `client:*` scenarios need fast rounds too.
- **Trade-off**: One optional sim parameter and two env reads — production code
  path is byte-identical to the §7 default; harness DOM clock (300 s) disagrees
  with the shortened server round, accepted as display-only until cycle 2.3
  introduces server time fields.
- **Scope**: `packages/sim/src/roundSim.ts`, `apps/server/src/rooms/TurnoverRoom.ts`,
  `apps/client/harness/playwright.config.ts`.
- **Date**: 2026-08-28
- **Status**: active

### AD-005
- **Decision**: Cycle 2.3 `movement` builds a persistent movement layer owned by the
  room that runs in BOTH phases: players can walk (linear, 6 tiles/s, pass-through)
  from the moment they join, pre-round confined to the grand lobby; the full building
  unlocks at round start. Positions persist across the lobby→round→lobby transitions
  (no re-spawn on host start; FR-2's "spawn" = initial placement for fresh joiners).
  This amends AD-002: the RoundSim stays round-scoped (roles, work channels, evidence,
  justice, clock) and consumes positions from the room's movement layer; movement
  itself is no longer gated on sim existence.
- **Reason**: User request — something visible/playable immediately after room
  creation, not only after host-start; also makes the pre-round gather-up tangible.
- **Trade-off**: Two state homes for movement vs round logic with a defined seam
  (movement layer in the room, round mechanics in the sim); prd §6.1 flow wording
  "Lobby gather-up → secret roles → SHIFT" gains movement during gather-up — recorded
  here rather than editing the locked prd.
- **Scope**: cycle 2.3 `movement` and all later cycles; `apps/server`, `packages/sim`,
  `packages/shared`, `apps/client`.
- **Date**: 2026-08-28
- **Status**: active — **Amendment (2026-08-29)**: with AD-015 there is no
  movement-side behavior left to unlock; the movement layer is phase-free.
  `MovementSim.unlock`/`lock` and the write-only `phase` field are deleted
  (the room keeps its own phase — that is the AD-002/AD-005 seam).

### AD-006
- **Decision**: Insert cycle 2.3 `protocol-registry` before `movement` (cycles shift:
  movement → 2.4, …, telemetry → 2.9; precedent AD-003). One protocol registry in
  `packages/shared` declares every server→client message exactly once: payload type +
  recipient policy from a closed enum (`'all' | 'self'`; extended deliberately per
  cycle). A per-room `Router` in `apps/server` applies policies generically and stamps
  every send with an envelope `{ seq, time, payload }` — per-connection monotonic
  `seq`, server `time` in ms. A client observing a seq gap rejoins via the existing
  connection-loss path. The client dispatches generically over registry keys to pure
  `payload → ViewAction` mappers, exhaustive via `Record<RegistryKey, Mapper>`.
  Deleted in the same cycle: `route()` switch, per-type `connection.ts` handlers,
  `ServerMessage` union, `app.ts` message switch, `BroadcastGameEvent`/
  `PrivateGameEvent` unions, and the dead `envelope.ts`. Registry is typed
  `satisfies Record<SimEvent['type'], …>` — an undeclared sim event fails compilation.
- **Reason**: Architecture review (`/improve-codebase-architecture`, three grilling
  rounds, all recommendations user-accepted): one protocol fact was hand-maintained
  across six stations and the recipient policy — the security core of the game — was
  enforced by a grep audit, not structure. Migrating at five message types is the
  cheap moment; cycles 2.4+ add ~15 more, and 2.4's 20 Hz position streams need the
  envelope's seq/time fields that only the dead `envelope.ts` draft had.
- **Trade-off**: Delays movement by one cycle; movement spec's rule-5 success
  criterion ("recipient comments") is reinterpreted as registry declarations when its
  Design phase runs. The reducer still derives the round clock from tuning this cycle
  (envelope `time` is stamped, not yet consumed) — AD-004's divergence note extends
  until a later cycle consumes server time. Client→server intents untouched.
- **Scope**: `packages/shared`, `apps/server`, `apps/client`,
  `.opencode/skills/turnover-protocol`, `CONTEXT.md`, roadmap.md cycle table.
- **Date**: 2026-08-28
- **Status**: active

### AD-007
- **Decision**: Add `TUNING.ELEVATOR_LANDING_TILES = 1` — the boarding predicate for
  elevators ("a 3rd player at the landing waits", cycle 2.4 MOVE-13). Candidates board
  when on the car's floor within 1 tile of the car's landing x.
- **Reason**: prd §7 does not define a boarding range; FR-5 locks capacity and timing but
  not the "at the landing" predicate. The spec's assumptions table leaves boarding
  behavior to the design. 1 tile keeps a single landing snap deterministic and fair.
- **Trade-off**: First tuning constant beyond the locked prd §7 list — recorded here
  rather than silently added; playtests (Gate 4) may revisit via a new AD, never an
  incidental edit.
- **Scope**: `packages/shared/src/tuning.ts`, `packages/sim/src/movement.ts`, all future
  elevator interactions (2.5+ door cues reference landing positions).
- **Date**: 2026-08-28
- **Status**: active

### AD-008
- **Decision**: Live players see their current floor only; the full-building view is
  spectator-exclusive (FR-20 made explicit for live play). Enforced **server-side**:
  `PlayerMoved` (and all later position/visibility streams) route per recipient —
  a live player receives positions for their own floor only. Elevator riders receive
  no floor stream while in a car (car interior; arrival switches them to the arrival
  floor). Fired players switch to the unfiltered full-building stream (FR-20).
  Message shapes unchanged — only routing policy changes; the registry's
  recipient-policy enum (AD-006) extends deliberately (e.g. `sameFloor`, `spectators`)
  when cycle 2.4's Design phase declares the position streams.
- **Reason**: FR-20 grants the overview camera including room interiors to fired
  spectators only — the privilege implies live players lack it, but no FR says so
  explicitly; recorded here rather than editing the locked prd. Client-side-only
  filtering would violate the message-only hard rule (never send anything a player
  cannot legitimately know): today `PlayerMoved` broadcasts `server → all players`
  with floor included, so a modded or zoomed-out live client could render
  cross-floor positions — in a hidden-information game that leak is the product.
- **Trade-off**: Server needs per-recipient routing by floor plus two broadcast
  modes (live per-floor vs spectator full-building) instead of one broadcast
  pipeline — built as visibility-class channels, not a special case. Cross-floor
  elevator-exit sightings stay impossible for live players (FR-6: "who rode when"
  stays voice testimony); changing that requires a new AD.
- **Scope**: server-side routing lands with the first cycle that must hide
  positions on the wire (room interiors / evidence) — `apps/server` Router,
  `packages/shared/src/protocol/registry.ts`, spectator/camera cycles.
- **Amendment (2026-08-28, post-2.4 verifier Gap 1 ruling)**: cycle 2.4 shipped
  global `'all'` position broadcasts; the client-visible half of this decision
  (live players see their current floor only) is delivered by the WorldScene
  view filter instead. The server-side per-recipient routing above is deferred
  per the amended Scope — until it lands, a modded client could read cross-floor
  positions from the wire; accepted for 2.4, not for any cycle that hides room
  interiors.
- **Landed (2026-08-28, cycle 2.5)**: 2.5 became the first cycle that hides
  content on the wire (`room:prepped`/`room:trashed` carry the `occupants`
  policy; `room:observed`/work events are `self`), so the deferred routing
  landed there per AD-009: `sameFloor` policy for `player:moved` +
  `player:left-floor`, `occupants` for room transitions, floor-filtered
  `movement:snapshot`. The WorldScene view filter remains as defense in depth.
- **Date**: 2026-08-28
- **Status**: active

### AD-009
- **Decision**: Movement verifier Gap 1 resolved in favor of AD-008 — the shipped
  2.4 `'all'` routing of `player:moved` is amended, not descoped. Cycle 2.5
  declares the `sameFloor` recipient policy: a live player receives position
  streams for their own floor only; elevator riders receive no floor stream while
  in a car (their arrival event arrives once they are on the arrival floor);
  `movement:snapshot` content is filtered to the recipient's floor (cars stay
  public — FR-6 panels). `elevator:called`/`elevator:moved` remain `'all'`.
  The movement spec Goal 2 wording ("positions are public") is amended to
  "positions are public within the viewer's floor" — recorded here rather than
  left as two contradictory locked artifacts.
- **Reason**: Verifier ruling requested in `.specs/features/movement/validation.md`
  Gap 1; user directed autonomous run. AD-008's reasoning stands on the message-only
  hard rule (cross-floor position streams are information a live player cannot
  legitimately know); the registry/Router extension is exactly what cycle 2.5's
  Design phase was scoped to declare, and no spectator class exists yet (fired
  players arrive in 2.7 — the unfiltered spectator stream lands then).
- **Trade-off**: Two 2.4 tests asserted global routing and are amended with the
  registry change; client WorldScene already renders own-floor only, so no visual
  behavior change for same-floor play.
- **Scope**: `packages/shared/src/protocol/registry.ts`, `apps/server/src/rooms/router.ts`,
  `TurnoverRoom.ts`, movement spec/design amendments, cycle 2.5 tasks.
- **Date**: 2026-08-28
- **Status**: active

### AD-010
- **Decision**: Room geometry concretized for cycle 2.5: the 8 rooms on each guest
  floor are contiguous x-segments of width 3.5 tiles tiling `[1, 29]` of the
  30-tile hall (1-tile open hall at each end, outside the elevator landings at
  x=0/x=30). `ROOM_DEPTH_TILES` is re-derived 4 → 3.5 and gains placement
  constants (`ROOM_HALL_START_TILES = 1`, rooms tile to `HALL_LENGTH_TILES − 1`).
  Room index predicate: `x ∈ [start_i, end_i)`, last room inclusive. The grand
  lobby floor has no rooms.
- **Reason**: 2.4 recorded rooms-as-x-segments as an assumption default
  (`ROOM_DEPTH_TILES = 4`) but 8×4 = 32 > 30 never fit the hall — the constant
  was pinned by a literal test and never consumed by geometry. Cycle 2.5's
  work channels are the first consumer, so the predicate must be exact. 8
  rooms/floor (24 total) and "room ~4 tiles" (§7, approximate) are preserved as
  closely as the locked 30-tile hall allows.
- **Trade-off**: Room width 3.5 instead of 4 — travel-budget math (roadmap step 0)
  used 8 rooms/floor which is kept; sweep-time estimates shift negligibly. A
  new geometry predicate is a recorded decision per the tuning rule.
- **Scope**: `packages/shared/src/layout.ts`, `packages/sim` (room-at predicate
  consumers), cycle 2.5.
- **Date**: 2026-08-28
- **Status**: active

### AD-011
- **Decision**: Elevators operate in BOTH phases — from the moment the room
  exists, not from round start. Pre-round `elevator:call` dispatches exactly as
  mid-round (sooner car, tie → car 1, decoy flash, FIFO); the only remaining
  rejection is a call from inside a car; the call FIFO is no longer cleared at
  `lock()` (queued calls are served by the next car to free, across the buzzer).
  The movement-spec assumption "elevators idle in lobby phase" and its
  rejection edge case are amended accordingly.
- **Reason**: User directive — the locked pre-round elevator made the machine
  untestable with Playwright without a host start and dulled the AD-005
  "alive from join" intent.
- **Trade-off**: Players may stand on guest floors pre-round (positions persist
  at round start, MOVE-07); pre-round lobby-phase walking confinement (MOVE-08)
  is unchanged, so a pre-round rider off the lobby floor cannot walk until the
  round starts and leaves only by elevator. Gather-up purity yields to
  testability + liveliness; revisit via a new AD if playtests object.
- **Scope**: `packages/sim/src/movement.ts`, `apps/server/src/rooms/TurnoverRoom.ts`,
  movement spec/design amendments, `.specs/features/elevator-lobby/`.
- **Date**: 2026-08-28
- **Status**: active

### AD-012
- **Decision**: Elevator dispatch responsiveness fix (user playtest: "E doesn't
  respond, W intermittent, got stuck riding W"). Three changes in
  `MovementSim.callElevator`/`board` + one client: (1) the duplicate-call
  predicate compares pickup floor AND destination — a car *arriving* to pick up
  at the caller's floor for the same destination (or the identical queued call)
  is ignored with a flash; destination-only matches no longer swallow calls
  from other floors. (2) Idle-car choice prefers the car whose LANDING is
  closest to the caller's x (boarding happens at the car's own landing), tie →
  car 1 — both cars now get used; a caller at the east landing summons car 2.
  (3) Boarding a car drops that player's queued calls (no car is later
  summoned to a floor the rider has left). (4) The client pulses the elevator
  panel on `elevator:called` so every accepted call is visible (the wire flash
  is data-only).
- **Reason**: Playtest reports; the old tie→car-1 rule starved car 2, the
  destination-only decoy check silently ate valid calls, and nothing visibly
  acknowledged a call until a trip completed.
- **Trade-off**: MOVE-12's decoy narrows to true duplicates (its letter — "a
  call for the floor a car is already heading to" — is preserved: same pickup
  floor); the wrong-way carry remains possible when a rider changes intention
  mid-wait (riders ride the car's target; deeper changes touch the locked
  boarding model — revisit via playtests).
- **Scope**: `packages/sim/src/movement.ts`, `apps/client/src/scenes/WorldScene.ts`,
  movement tests, future elevator-touching cycles.
- **Date**: 2026-08-28
- **Status**: active — **Amended by AD-014**: the duplicate predicate narrows to
  pickup floor ONLY (calls carry no destination anymore, so the destination half
  of the predicate ceases to exist), and the wrong-way carry is eliminated: the
  car's path is chosen in-car and its press queue is always visible to its
  occupants.

### AD-013
- **Decision**: Rider-exclusive occupancy and press knowledge. A new `riders`
  recipient policy delivers `elevator:pressed {playerId, floor}` and
  `elevator:riders {car, riders, queue}` ONLY to viewers riding that car
  (`ViewContext` gains `car: 1 | 2 | null`; riders keep `floor: null`). The
  press queue rides in the rider-exclusive payloads and in the rider's personal
  snapshot (`carOccupants {car, riders, queue}`; non-rider snapshots are
  byte-identical to before) — the real-elevator "lit buttons are visible from
  inside" model, closing blind inheritance for late boarders and buzzer
  rejoiners (design review 2026-08-28). FR-6 panels and
  `elevator:called`/`elevator:moved` payloads stay `{floor, car}`/`{car, floor}`
  — never occupancy, never queue, never press targets.
- **Reason**: The elevator is the game's strongest co-presence moment and
  transmitted nothing: co-riders could not testify who shared the car or who
  pressed what. Broadcasting occupancy would make tailing trivial, so the
  knowledge must be exactly as wide as the car's interior.
- **Trade-off**: Non-riders (including a rider who just walked off) learn
  nothing beyond what the public position streams already show; boarding stays
  inferable only via stream-stop. Client renders the knowledge as a DOM chip
  visible only while riding (no scene-level car interior — AD-009 preserved).
- **Scope**: `packages/shared/src/protocol/*`, `apps/server/src/rooms/*`,
  `packages/sim/src/movement.ts`, `apps/client/src/*`, cycle 2.6 tasks.
- **Date**: 2026-08-28
- **Status**: active

### AD-014
- **Decision**: Call-model rework, one cycle owning elevator semantics
  end-to-end. `elevator:call` is destination-free (the pickup floor is the whole
  request; duplicate predicate = pickup floor ONLY, narrowing AD-012); the
  destination is chosen inside the car via `elevator:press {floor}` (rider-only,
  strict zod, no cancel) appended to a per-car FIFO press queue. The car becomes
  a four-phase machine (`idle`/`arriving`/`dwelling`/`riding`; doors open in
  idle + dwelling) that opens doors at every stop for a 1 s dwell
  (`ELEVATOR_DWELL_SECONDS = 1` — the only §7-external tuning constant this
  cycle). Design-review pins (2026-08-28): (a) **door-open-episode exit guard** —
  a player who exits joins `exitedThisStop`, cleared only on the car's next
  DEPARTURE; not a same-tick guard, which is provably insufficient (walking off
  takes ~4 ticks and a pre-round exiter at a guest floor cannot walk at all);
  (b) **arriving-pickup press rejection** — the pickup floor counts as
  being-served while `arriving` (no zero-tick rides; departure asserts
  `rideTicks > 0`, pinned by test); (c) **empty-idle dispatch preference** —
  among idle cars, empty ones are drafted first (closest landing, tie → car 1),
  occupied-idle cars only when no empty idle car exists; (d) **queue-in-payload**
  — the queue rides in `elevator:riders` and rider snapshots so occupants always
  see it; (e) **lit floor indicators** on the rider chip (lit = queued or being
  served) give press feedback without a keyboard UI change. Stay-in-car is
  allowed (a served rider may press again); ghost trips serve an abandoned queue
  (the queue belongs to the car, walk-offs never clear it); a pickup with nobody
  in boarding range idles the car open-doors (caller-never-boards); a re-call at
  an open-door car is the decoy flash.
- **Reason**: The coupled call `{target}` produced the uninformed wrong-way
  carry and pre-committed trips nobody in the car chose. Destinations become a
  product of in-car negotiation, and every stop is observable (who stayed, who
  bailed, whether anyone boarded).
- **Trade-off**: All existing timing preserved except where the spec changes it
  (dwell, open-door idle, press queue): 3 s arrival, 2 s/floor ride, capacity 2,
  1-tile landings unchanged. Press cancel/un-press does not exist (ever-lit
  buttons; mispresses are livable and keep the queue rider-knowable); service
  order is FIFO, not directional (the zigzag is publicly trackable via panels);
  the rare occupied-idle draft still carries a deliberating rider, visible and
  redirectable by press after the pickup dwell — playtest revisit via a new AD.
- **Scope**: `packages/shared/src/*`, `packages/sim/src/movement.ts`,
  `apps/server/src/rooms/*`, `apps/client/src/*`, `apps/client/harness/*`,
  `roadmap.md` cycle table (2.6 insert, successors shift to 2.10), movement
  design.md "call semantics" interpretation marked AD-014-superseded.
- **Date**: 2026-08-28
- **Status**: active — **Amended by AD-016**: design pin (a)'s episode guard
  narrows to landing-zone hysteresis (an exiter may re-board once observed
  outside the boarding zone; the walk-off stays guarded).

### AD-015
- **Decision**: Remove lobby-phase movement confinement (MOVE-08). Players may
  walk on any floor from the moment they join, including pre-round and
  post-buzzer lobby phases. The `MovementSim.startMove` guard
  `phase === 'lobby' && floor !== 'lobby'` is deleted; the client's prediction
  mirror no longer gates movement by phase.
- **Reason**: User-reported friction: riders who explored the building pre-round
  via elevators were stuck at guest-floor landings with no clear affordance.
  The confinement rule was a user-confirmed design in AD-011/EL-04 but proved
  confusing in play-feel; removing it makes the lobby a true free-roam space
  and eliminates a mismatch between "can ride anywhere" and "can't walk there".
- **Trade-off**: The gather-up phase loses its sharp confinement boundary —
  players can scatter across the building before roles are dealt, which mildly
  weakens the pre-round lobby-as-lobby identity. Positions still persist across
  start/buzzer (MOVE-07), and work channels remain round-scoped, so mechanical
  consequences are limited. Specs and tests that asserted confinement are
  amended.
- **Scope**: `packages/sim/src/movement.ts`, `packages/sim/src/movement.test.ts`,
  `apps/client/src/scenes/WorldScene.ts`, `apps/client/harness/movement.spec.ts`,
  `.specs/features/movement/{spec,design,validation}.md`,
  `.specs/features/elevator-lobby/{spec,validation}.md`.
- **Date**: 2026-08-29
- **Status**: active

### AD-016
- **Decision**: Landing-zone hysteresis on the door-open-episode guard. The
  `exitedThisStop` exclusion (AD-014 design pin (a)) is lifted per-player once
  the exiter is observed OUTSIDE the car's boarding zone
  (`|x − landing| > TUNING.ELEVATOR_LANDING_TILES`) on the car's floor, checked
  on every open-door tick in `board()`. The walk-off itself stays guarded: exit
  places the player at the landing, and clearing the 1-tile radius takes ~4
  ticks, so instant re-board remains impossible.
- **Reason**: Playtest lock-out (2026-08-29): a player who hopped off an idle
  car could never re-board — the episode guard clears only on the car's next
  DEPARTURE, but an idle car with an empty queue never departs — and pressing
  E could not summon the car (a car already on the caller's floor is the
  duplicate/flash case, AD-012/AD-014). Combined: stranded until another
  player moved that car.
- **Trade-off**: The guard's guarantee narrows from "final for the episode" to
  "final while inside the zone" — deliberate walk-away-and-return now re-boards
  (the intended affordance); no board/exit oscillation is possible because
  re-boarding still requires leaving the zone first. Pinned by three sim
  scenarios (re-board after leaving the zone; guard holds inside the zone; a
  re-boarded rider presses and rides).
- **Scope**: `packages/sim/src/movement.ts` (exit comment, board() hysteresis,
  CarState doc), `packages/sim/src/movement.test.ts`, future cycles touching
  elevator exit/boarding.
- **Date**: 2026-08-29
- **Status**: active — amends AD-014 design pin (a) (which amended AD-012).

### AD-017
- **Decision**: Send the exiting rider a personal movement snapshot on door-open
  exit. The `move:start` handler detects a rider→walker transition
  (`viewOf(sessionId).car` non-null before the intent, null after) and routes
  `movement:snapshot` via `snapshotFor` to the exiter (`self` policy — no
  registry change). Same-floor occupants need nothing new: the exit places the
  player at the landing and the facing-dirty rule emits their own `player:moved`
  next tick, so the arrival is visible on their stream immediately.
- **Reason**: Playtest report (2026-08-29): a player arriving on a floor could
  not see standing occupants until they moved — snapshots existed only for
  join and buzzer, so the exiter's last picture of the floor predated their
  ride, and standing players emit no stream to correct it. This closes a
  documented-but-unimplemented protocol rule: "per-player snapshots are sent on
  join and on visibility change (…floor change)".
- **Trade-off**: One extra snapshot (~dozens of bytes) per exit; no new message
  type, no sim change (the room orchestrates over existing sim queries). The
  snapshot carries only the exiter's own legitimate view (their new floor's
  occupants + public car floors), per the message-only rule.
- **Scope**: `apps/server/src/rooms/TurnoverRoom.ts` (move:start handler),
  `apps/client/harness/movement.spec.ts` (arrival-floor-reveal scenario).
- **Date**: 2026-08-29
- **Status**: active

## Handoff

- **Feature**: `evidence` (cycle 2.7) — door cards (permanent, floor-public,
  no timestamp, FR-11), the 75 s trash freshness window (FR-12), the sabotage
  rustle delivered through a new server-side `earshot` recipient policy
  (FR-13), and the door-open cue on segment entry (FR-10 cue half). No tuning
  changes; the two §7 constants (FRESHNESS_WINDOW_SECONDS=75,
  RUSTLE_RANGE_TILES=3) are consumed for the first time.
- **Phase / Task**: Execute → T1–T8 complete; independent Verifier PASS
  (10/10 mutants killed, 0 survivors, protocol audit clean). Gap 1 (LOW)
  fixed post-verdict with a direct EVID-07 assertion; suite 248/248.
- **Completed**:
  - T1 (commit `5d89e2b`): protocol — four `SimEvent` variants + payload
    interfaces + registry rows (`room:carded`/`room:entered` → `sameFloor`,
    `room:settled` → `occupants`, `room:rustle` → new `'earshot'` policy);
    `EventVisibility.room`; client mapper/action plumbing (compile-exhaustive).
  - T2 (commit `6530100`): sim — `carded` set hung on every prep transition
    (idempotent re-emission, fake touches nothing), `settleAt` deadlines with
    exact 1500-tick window, prep-cancel + re-trash-restart + buzzer-silence
    legs, `cardedOn` query + `RoundSim.cardedOn` delegate.
  - T3 (commit `c25a511`): sim — `room:rustle` on trash transitions only;
    `room:entered` on every segment entry (pass-through included) alongside
    the private `room:observed`.
  - T4 (commit `dbacd16`): server — `ViewContext.x` (millitiles, null for
    riders) + `movement.viewOf` x + the Router `earshot` branch (same floor,
    within RUSTLE_RANGE_TILES of the room's nearer segment edge, inclusive).
  - T5 (commit `93a97a4`): server — `movement:snapshot.cardedRooms` (own
    floor), AD-017 exit handler passes `sim.cardedOn(arrivalFloor)`, e2e
    carded-exit-snapshot test.
  - T6 (commit `2360444`): client — pure `evidenceSession` reducer
    (idempotent cards, TTL'd cue buffer) + DOM evidence layer in WorldScene
    (card glyphs per carded room, door-open/rustle cue markers, WebAudio
    beeps, round-start reset via the App).
  - T7 (commit `5a7d088`): harness — `client:evidence_cues` (role-adaptive:
    reads private role cards, staff preps, saboteur un-preps; asserts carded
    glyph on both floor1 pages, door-open + rustle cue nodes, card survives
    re-trash, exactly one role:dealt on the saboteur's stream).
- **Verification**: `.specs/features/evidence/validation.md` — PASS. Sensor:
  10 behavior-level mutants in a /tmp scratch, all killed, scratch deleted,
  real-tree porcelain identical to baseline. `validate_state.py evidence`
  exit 0.
- **Gates** (at T7 commit `5a7d088`):
  - `pnpm typecheck` ✅ 0 errors
  - `pnpm biome check` on changed paths ✅ (remaining root-lint errors are the
    pre-existing untracked `scripts/dev-boot.mjs`, untouched this cycle)
  - `pnpm test:sim` ✅ 248/248 (was 222 pre-cycle)
  - `pnpm test:client` ✅ 25/25 incl. new `client:evidence_cues`
- **Next step**: feature complete. Gate 4 (human 5-minute round,
  player-facing) recommended before the next cycle. NOTE: commit `84e944b`
  inadvertently included the pre-existing untracked
  `.specs/features/elevator-riders/validation.md` (scope deviation, left in —
  a legitimate prior-cycle artifact). Deferred notes (1)-(3) from the previous
  handoff remain open.
- **Blockers**: none.
- **Uncommitted files**: none from this feature; pre-existing unrelated
  working-tree changes remain untouched (`.specs/LESSONS.md`,
  `.specs/lessons.json`, `package.json` `boot` script, `scripts/`,
  `.playwright-mcp/`, `.specs/features/elevator-riders/validation.md`).
- **Branch**: master

Deferred notes carried forward (still open, not yet folded into any cycle):
(1) room-shell PASS gaps — LOBBY-02 "create no room" clause unasserted;
rejected start intent lacks a lobby-phase re-assertion (reject-then-start
mutant); LOBBY-05 "roster unchanged" after name rejection unasserted — fold
into the next cycle touching `TurnoverRoom`.
(2) first-light PASS gaps — LIGHT-02 unknown-code message, LIGHT-08 "round
already active", LIGHT-04 1-char name minimum — fold into the next
client-touching cycle.
(3) protocol-registry PASS, low severity — `TurnoverRoom.test.ts:412-415`
comment misattributes the collector-added `type` key to Colyseus transport;
`registry.test.ts:66-70` pins policy membership, not literal per-key values.
