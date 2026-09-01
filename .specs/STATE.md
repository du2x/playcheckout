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

### AD-018
- **Decision**: Static door frames are client-visible from the moment the world
  mounts — phase-free, pre-round included (user request before cycle 2.8). The
  WorldScene renders one DOM door frame per room segment (AD-010 geometry,
  `#doors-layer`) on every guest floor view; the grand lobby shows none. No
  sim, protocol, or tuning changes — pure rendering, following the evidence
  layer's DOM-over-canvas pattern (scene-children contract preserved).
- **Reason**: User request — with AD-015 free-roam the building is walkable
  pre-round but rooms were invisible (no door visuals existed at all, any
  phase); frames also anchor cycle 2.7's cards/cues spatially.
- **Trade-off**: Purely cosmetic; door frames reveal room boundaries that are
  public geometry (layout is in `packages/shared`, no hidden state). Frame
  visibility follows the own view floor like card markers (riders keep the
  last floor's frames — same accepted behavior).
- **Scope**: `apps/client/src/scenes/WorldScene.ts`,
  `apps/client/harness/doors.spec.ts` (new gate `client:doors_pre_round`).
- **Date**: 2026-08-29
- **Status**: active

### AD-019
- **Decision**: Narrow the elevator call duplicate predicate again (user
  request). A car parked open-doors (`idle`|`dwelling`) at the pickup floor no
  longer makes a call a duplicate: the parked car is excluded from dispatch
  candidacy and the OTHER car is summoned to that floor (dispatching normally
  when it is idle — empty-idle preference and closest-landing tie-break
  unchanged — or queuing sim-level FIFO when it is busy, MOVE-15). The decoy
  flash now covers only: a car ARRIVING at the pickup, a car RIDING with the
  pickup queued, an already-queued call for the pickup, and BOTH cars parked
  open-doors at the pickup (nothing can arrive; boarding/pressing a parked
  car is how it moves). No protocol, tuning, or client-logic changes — the
  flash remains a data-only panel pulse.
- **Reason**: User directive — with car E parked at the caller's floor, a call
  for W left both cars untouched (decoy flash), so the only way to bring the
  far car over was to move E first. Completes the AD-016 strand: that
  decision's stranded-player playtest cited this exact dispatch dead-end as
  half of the lock-out.
- **Trade-off**: MOVE-12's "same pickup floor arriving" decoy survives, but
  the classic lobby decoy (both cars home, call flashes) now only works when
  BOTH cars are parked at the pickup floor; a single parked car means a real
  summon of the other car. A caller standing at the empty parked car's own
  landing gains a redundant second car (they could just board) — accepted as
  the natural reading of "a call makes a car come to you".
- **Scope**: `packages/sim/src/movement.ts` (`callElevator`),
  `packages/sim/src/movement.test.ts` (both-parked flash renamed, two new
  AD-019 scenarios), `.specs/features/elevator-riders/spec.md` (P2 AC7 / P3
  AC5 amendments), `apps/client/harness/elevatorLobby.spec.ts` (comment),
  `docs/elevator-behavior.md`.
- **Date**: 2026-08-29
- **Status**: active — narrows the AD-012/AD-014 duplicate predicate again.

### AD-020
- **Decision**: Open the art workstream (parallel to gameplay cycles) with a
  locked art-direction brief at `docs/art/art-direction-brief.md` and an MVP
  asset manifest at `docs/art/asset-manifest.json`. Direction: PRD §4's named
  "Elevator Action pixel style", translated into explicit properties — side-on
  orthographic single-floor view, 4-band value structure, ≤24-color palette
  (warm hotel neutrals + bellhop-navy uniform worn identically by all players),
  hard pixel clusters, nearest-neighbor, baked lighting. Art must not leak
  hidden state: identical work animations for every role (FR-9), no saboteur
  visual tell, hallway sees nothing of interiors except door cards (FR-10/11),
  panels show positions only (FR-6), HUD stays DOM (FR-14).
- **Reason**: Gameplay cycles proceed in parallel; a written visual contract
  (palette roles, silhouettes, sizes, pivots, anti-leak rules) is required
  before any production sprite so the family stays coherent and the
  message-only/hidden-information constraints survive the art pass.
- **Trade-off**: Open decision recorded, not resolved: current TILE_PX =
  832/30 ≈ 27.73 is non-integer and fights pixel grids. Recommended fix is a
  960×576 canvas (exactly 32 px/tile, no tuning change); must be signed off
  before the first production sprite. Until then the manifest pins character
  size to 28×60.
- **Scope**: `docs/art/*`, future `apps/client/public/art/*` and world-render
  code. No protocol, sim, tuning, or server changes.
- **Date**: 2026-08-29
- **Status**: active — brief is draft v1, awaiting visual-target approval.

### AD-021
- **Decision**: The room gains a third phase `results` between round and
  lobby, entered exactly when `round:ended` routes (win check, buzzer
  coverage, or abort). Results is lobby-like — joins flow, roster snapshots
  flow, the host's `lobby:start` begins the next round — with NO auto-return
  timer and NO new timing constant; the results view persists until the host
  starts the next round or the room empties. Movement persists (phase-free,
  AD-005/AD-015). The reconnection seat (FR-25): an unconsented mid-round
  drop holds the roster entry + frozen movement slot for
  `RECONNECT_SECONDS = 60` (prd §11's own value, Room-static test seam);
  restore re-sends the exact role card + `round:resumed {remainingTicks,
  playerIds, ownFired}` + snapshot and re-announces the position; expiry
  ghosts staff (silent, `sim.ghost`) and aborts the saboteur's round
  (`round:ended {winner:'aborted'}`, no traitor reveal). Expired seats' roster
  entries are purged at the NEXT ROUND START (not at results entry), so the
  recap still resolves ghost names. Client reconnect uses the SDK 0.18
  built-in auto-reconnect of the same Room instance (15 retries, backoff
  ≈ 55 s) with a seq-reset on drop; the manual retry loop + sessionStorage
  token from the design was dropped as redundant.
- **Reason**: Autonomous run defaults recorded per the spec process. The
  results phase is lobby-like because a forced timer would need a new tuning
  constant (forbidden without a recorded AD) and the host-paced flow is
  simpler. Seat expiry resolves per FR-25's letter (ghost/abort only after
  the window — §11 restores the saboteur card through it).
- **Trade-off**: Expired seats occupy a roster slot through the results
  phase (visible as an idle ghost in the roster; freed at next start). A
  ghost's recap row can fall back to the raw id if a player joins mid-results
  before rendering (LIGHT-12 fallback). The client relies on the SDK's
  reconnection machinery rather than hand-rolled retries.
- **Scope**: cycle 2.9 `round-end`; `apps/server`, `apps/client`,
  `packages/sim`, `packages/shared`.
- **Date**: 2026-08-30
- **Status**: active

### AD-022
- **Decision**: PRD v1.3 — the static task checklist becomes a guest-traffic economy
  ("complaint economy"), designed in a grilling session 2026-08-30, all branches
  user-confirmed. The round now runs on NPC guest flow: guests arrive at the lobby on a
  headcount-scaled cadence, queue at the front desk, and must be routed to rooms; settled
  guests check out after a random dwell and re-trash their room (spawning **settled**
  trash — churn the staff must service forever). Core mechanics, in final confirmed
  shape:
  - **Routing (hybrid)**: any player at the desk receives the queued guest; a **walkie
    broadcast is mandatory** to send the guest off (canned room-number menu, "«Marco»:
    guest going to 305"). The broadcast is the broadcaster's *claim*, not server-truth —
    the saboteur can lie; the guest's actual walk is the checkable ground truth. Guests
    ride elevators as full citizens (panels still show cars, never occupants).
  - **Impatience**: an unrouted guest waits ~20s visibly (foot-tap + desk bell, no
    complaint cost), then **self-assigns** a uniform random vacant room. If that room is
    trashed: one complaint, guest leaves the hotel (no retry).
  - **Discovery inside rooms**: guests always *enter* their assigned/chosen room; trash
    is discovered inside (this supersedes the drafted "balk at the door" beat). A guest
    entering during an active un-prep **flees and complains — guests never trigger
    walk-in conviction** (FR-15 stays staff-only).
  - **Two-stage complaints**: in-world anger cue at the room (room-level, no detail) →
    the guest walks to the desk and delivers a fuzzy-timestamp report ("someone hit 305,
    maybe a minute ago"). One complaint fires per trashed discovery, assigned or
    self-assigned alike.
  - **Provenance tiers**: checkout trash spawns *settled*; sabotage spawns *fresh*;
    re-trashing resets to fresh (churn can be laundered into "suspicious", the
    saboteur's own hits cannot be hidden). FR-12 gains an author dimension.
  - **Complaint budget**: 8 complaints = **instant staff loss**; HUD counter pulses red
    at ≥6. Recap lines carry full provenance (sabotage + actor vs. churn), post-reveal.
  - **Load dials (provisional)**: 7 of 24 rooms trashed at t=0 · cadence 30s/24s/18s at
    4/5/6 players (≈10/12/16 guests per 5:00 shift; cadence is the 4-player-slack
    lever, budget stays 8 for all lobbies) · dwell 45–90s random · peak occupancy ~10
    rooms · impatience 20s.
  Codified as new prd §6.9 (FR-26…FR-32); FR-14 (three HUD oracles), FR-22 (recap
  provenance) and §6.6 (budget loss leg) amended; §5 loop, §7 tuning, §9 risks updated.
- **Reason**: Brainstorm ("make it more realistic") + four grilling rounds. Structural
  motivation: trash previously had a single possible author (the saboteur), so evidence
  was nearly deductive; guest churn gives the saboteur camouflage, turns staff play from
  a completion checklist into a response-time triage game, and makes the front desk the
  social-information core (walkie, complaints, budget). Fun-perspective review flagged
  desk-monopoly and passive-saboteur as the two watch-items; 4-player dead-time resolved
  by the user with the cadence-scaling decision.
- **Trade-offs**: (1) Passive-saboteur risk — doing nothing now erodes staff via churn;
  deterrent is recap provenance exposing ghost play, first-playtest kill check. (2) Desk
  monopoly risk — the best seat may pin one player all round; impatience + bell make
  neglect socially visible, rotation must be earned socially. (3) Voice floor raised
  (walkie lies, desk rotation, triage huddle — near-required, was merely load-bearing).
  (4) §8's travel-budget throughput verdict is invalidated by churn; recompute at spec
  time. (5) Sim determinism requires **seeded RNG** for dwell/arrival sampling — no
  `Math.random` in `packages/sim`. (6) New §6.9 appended rather than renumbering FRs
  (references across specs/skills/roadmap stay valid); FR ordering is therefore not
  thematic. (7) Roadmap re-plan is a required follow-up — guest traffic needs new
  cycles, none are scheduled yet; build order through cycle 2.10 (telemetry) is
  unaffected.
- **Scope**: `prd.md` (v1.3), future `.specs/features/guest-traffic/`,
  `packages/sim`, `packages/shared` (tuning + protocol), `apps/server`, `apps/client`,
  `roadmap.md` (re-plan pending), art brief (guest sprites are load-bearing
  expressiveness: foot-tap, storm-out, anger cue).
- **Date**: 2026-08-30
- **Status**: active — design recorded and user-confirmed; **not yet implemented, no
  cycle assigned**.
- **Amendment (2026-08-30, user-confirmed)**: tenancy door signs added as FR-33 — an
  Occupied/Vacant flip-sign per guest door, operated automatically by the building.
  Shows **tenancy, not presence** (a settled guest flips it Occupied; checkout or
  leaving the hotel flips it Vacant; a fled guest keeps it Occupied until they leave —
  the empty-but-Occupied mismatch is a sabotage tell). Deliberately a separate channel
  from FR-11 prep cards (prep history vs. tenancy; neither timestamped), readable from
  the hallway, and the at-a-distance verifier for FR-27 walkie claims. Chosen over a
  desk-only board (loses hallway prediction), a DND tag (implies unenforced "don't
  clean" semantics), and a card-slot merge (would muddy the evidence language). No new
  tuning constant; FR-29's "vacant but trashed" footprint cross-references it.
- **Amendment (2026-08-30, roadmap re-plan)**: the "no cycle assigned" note is closed —
  roadmap.md gains a dedicated **Phase 3 — Guest-traffic economy** of 5 tlc cycles
  (`3.1 guest-flow` → `3.2 front-desk` → `3.3 complaint-budget` → `3.4 provenance-signs`
  → `3.5 guest-exit`); former Phases 3–5 renumber to 4–6. Phase entry
  task: recompute prd §8 throughput math with churn (3.1 Specify phase). Phase rules:
  seeded RNG only in sim; registry-declared guest/walkie/complaint messages with
  per-cycle recipient policies; guest expressiveness added to the AD-020 art manifest;
  2.11's exit sims stay valid for v1.2, 3.5 re-proves them under the economy.
- **Amendment (2026-08-30, user direction)**: the former cycle 2.11 `telemetry` is
  postponed to **3.6** — the LAST Phase 3 cycle and phase exit (JSONL FR-23/24 +
  KPIs + the v1.2 exit bots re-proven under the full economy). Phase 3 is now six
  cycles: 3.1 → 3.6 as re-planned in roadmap.md; 3.5 keeps only the rate-based
  guest bot sims (`sim:guest_exit_a/b`); the telemetry extension and the
  `exit_a`/`exit_b` re-proof move to 3.6.

### AD-023
- **Decision**: Hall-button dispatch — a caller standing within
  `ELEVATOR_LANDING_TILES` (1 tile) of a landing **pins** the call to THAT
  landing's car. The pinned car dispatches if idle; if busy (arriving / riding
  / dwelling elsewhere) the call queues pinned and is served when THAT car
  frees; if the pinned car is parked at the caller's floor the call is the
  decoy flash — the other car is never summoned for a landing call. Mid-hall
  callers (unreachable for the stock client, whose call key only sends from a
  landing) keep the AD-019 behavior: idle car whose landing is closest to the
  caller's x, tie → car 1, empty-idle drafted first, overflow sim-level FIFO
  (MOVE-15).
- **Reason**: Playtest strand (2026-08-30) — under AD-019 a call pressed at the
  far landing could summon the wrong car, and landing callers had no way to
  address a specific car. The real-hall-button model ("the button you press is
  the car you get") makes landing behavior deterministic and testimony-clean.
- **Trade-off**: A busy pinned car can no longer be circumvented by the other
  (idle) car for landing callers; both-cars-parked decoy semantics narrow to
  the landing-press flash (mid-hall both-parked flash unchanged). Recorded
  here rather than editing the locked prd — no FR changes, dispatch internals
  only.
- **Scope**: `packages/sim/src/movement.ts` (pinned-call state +
  `callElevator`), `packages/sim/src/movement.test.ts`,
  `.specs/features/elevator-riders/spec.md` (P2 AC7 / P3 AC5),
  `docs/elevator-behavior.md`.
- **Date**: 2026-08-30
- **Status**: active — parking wording later amended by AD-026 (parked means
  doors shut).

### AD-024
- **Decision**: Per-car **hall-call lights** on the client (rendering-only, no
  protocol/sim change). The DOM panels (lobby view + round HUD) and the world
  scene gain one hall-call light per car, lit amber when that named car owes
  the caller's floor a stop (lit on accepted `elevator:called`, cleared on the
  car's arrival), plus the existing floor readout that stays 'lobby' until
  arrival. Panels remain strictly position-only (FR-6): no occupancy, no
  queue, no press targets — the light reflects only what
  `elevator:called`/`elevator:moved` already publish.
- **Reason**: AD-012 (4) made an accepted call visible as a transient panel
  pulse, but a call for a BUSY car (queued) produced no visible feedback at
  all — callers could not distinguish "queued" from "swallowed". A persistent
  per-car light closes that gap without widening the wire.
- **Trade-off**: A queued call's light is derived from the same public events,
  so "queued" and "arriving" render identically until the car moves —
  accepted; distinguishing them would require new protocol surface for zero
  gameplay knowledge gain.
- **Scope**: `apps/client/src/scenes/WorldScene.ts`,
  `apps/client/src/ui/lobbyView.ts`, `apps/client/src/ui/roundHud.ts`,
  `apps/client/harness/elevatorLobby.spec.ts` (hall-call light scenario),
  `docs/elevator-behavior.md`.
- **Date**: 2026-08-30
- **Status**: active.

### AD-025
- **Decision**: Boarding rework — **proximity auto-boarding is disabled**.
  Standing in the landing zone never boards anyone. Boarding happens when a
  non-rider presses the call (E / ArrowUp / ArrowDown, landing-gated in the
  stock client) while a car stands at the caller's floor within
  `ELEVATOR_LANDING_TILES` of its landing: the presser steps in at intent
  time (flushed next tick, MOVE-10 pattern), capacity 2 still applies (a full
  car declines the board silently, flash only). A call pressed at a landing
  whose car stands at the caller's floor **outranks the duplicate predicate**
  — it boards the caller rather than flashing. The door-open-episode guard
  (AD-014 pin (a), amended AD-016) is **superseded**: with no proximity rule
  there is no board/exit oscillation to guard — an exiter re-boards by
  pressing again.
- **Reason**: Playtest strand — auto-boarding made "wait near the car" and
  "board the car" indistinguishable, silently swallowed callers who only
  wanted to summon, and was the root of the AD-016/AD-019 stranded-player
  chain. Explicit press-as-board matches the hall-button model of AD-023.
- **Trade-off**: A player standing at the landing must actively press to board
  (one extra input, but unambiguous); the old "closest-first, overflow queues"
  candidate ordering applies to proximity candidates only, which no longer
  exist. AD-016's three hysteresis scenarios are amended (guard deleted, not
  narrowed).
- **Scope**: `packages/sim/src/movement.ts` (intent-time boarding,
  pendingBoarders), `packages/sim/src/movement.test.ts`,
  `.specs/features/elevator-riders/spec.md` (P3 AC5, edge cases),
  `docs/elevator-behavior.md`.
- **Date**: 2026-08-30
- **Status**: active — boarding-through-doors timing amended by AD-026.

### AD-026
- **Decision**: **Door stages.** Every stop plays a 0.5 s opening swing and a
  0.5 s closing swing (new `TUNING.ELEVATOR_DOOR_SECONDS = 0.5`, not in §7);
  hop-in and hop-off are gated on the doors being FULLY open (the dwell
  window only) — nobody enters or leaves while the doors swing. The car
  machine becomes six-phase: `idle(floor, doors shut)` → `arriving` (60
  ticks) → `opening` (10 ticks) → `dwelling` (open-door stop, the only hop
  window; pending boarders step in as it starts) → `closing` (10 ticks) →
  `riding` (40 ticks per floor) → `idle(target)`. A parked (`idle`) car's
  doors are **SHUT**: boarding a parked car queues the presser as a pending
  boarder who steps in when the doors finish opening; a rider escapes a
  parked car by pressing the car's current floor (reopens the doors, no queue
  entry, no announce). A direction held through the opening swing applies the
  hop-off the moment the doors are fully open (releasing cancels it). A
  `dwelling` car with a queued floor counts as departed for the
  parked-exclusion predicate (AD-019). At decision time public door state
  rode `elevator:moved` — no protocol change.
- **Reason**: Playtest strand — instant doors made boarding/exiting ambiguous
  (who got in when?) and the always-open parked car made "parked" and
  "stopped" indistinguishable on the panel. Physical door swings give every
  stop a legible open/close rhythm and restore the decoy value of a parked
  car.
- **Trade-off**: Hop timing tightens (hop only through fully open doors);
  the AD-019/AD-023 "parked open-doors" wording is amended — parked now means
  doors shut, so both earlier decisions' parking clauses re-read through this
  one. Amends AD-014's "doors open in idle + dwelling".
- **Scope**: `packages/shared/src/tuning.ts`, `packages/sim/src/movement.ts`,
  `packages/sim/src/movement.test.ts`, `apps/client/src/scenes/*` (presenter),
  `apps/server/src/rooms/TurnoverRoom.test.ts`,
  `docs/elevator-behavior.md`.
- **Date**: 2026-08-30
- **Status**: active — dwell length and door-event transport amended by
  AD-027.

### AD-027
- **Decision**: **Stay-open dwell + first-class door events.**
  `ELEVATOR_DWELL_SECONDS` is raised 1 → 3 s and redefined as the MINIMUM
  open time: afterwards the doors stay open until the car has a call to
  attend (a queued ride or a waiting hall call it can serve from another
  floor); a car never moves spontaneously and closes only to attend. Public
  door state becomes a first-class registry message, `elevator:doors {car,
  floor, open}` ('all' recipients) — emitted when the doors begin their
  opening swing (open: true) and when they begin closing to attend a call
  (open: false). The client presenter's door phases are driven by
  `elevator:doors` (an open car holds its doors open indefinitely until a
  real close event, closing before any position change); `elevator:moved` is
  position-only again. Amends AD-026's dwell auto-close and its
  "door state rides elevator:moved" transport.
- **Reason**: Playtest strand — the 1 s dwell + timer auto-close raced human
  board/exit timing and produced phantom closes (car visibly shut its doors
  and stood there). Keeping doors open until needed matches real elevator
  feel and gives the hallway a truthful public signal (door state is
  hallway-visible info per the turnover-protocol rule 2), without ever
  exposing occupancy.
- **Trade-off**: One new registry message (+ its sim event) for a state that
  was briefly multiplexed onto `elevator:moved` — the registry entry is the
  by-the-book home for it (AD-006). Doors-open idle cars are publicly
  distinguishable from parked shut cars, which is intended legibility, not a
  leak (both states are position-adjacent public facts).
- **Scope**: `packages/shared/src/protocol/{messages,simEvents,registry}.ts`,
  `packages/shared/src/tuning.ts`, `packages/sim/src/movement.ts`,
  `packages/sim/src/movement.test.ts`, `apps/server/src/rooms/*`,
  `apps/client/src/scenes/elevatorPresenter.ts` (+ tests),
  `apps/client/harness/*`, `docs/elevator-behavior.md`.
- **Date**: 2026-08-30
- **Status**: active.

### AD-028
- **Decision**: The guest-traffic economy lands as round-scoped, sim-owned NPC
  weather (cycle 3.1). Guests live in `GuestSim` (`packages/sim/src/guests.ts`)
  inside the `RoundSim`, seeded from the round seed via a dedicated `Rng`
  stream (mulberry32 wrapper — no `Math.random` in the core). They move as
  **second-class movers inside the room's `MovementSim`** (`join(id, {kind:
  'guest'})`): both kinds share every walk/elevator rule (AD-011…027) — one
  geometry/physics source — while the event surface splits: guests emit
  `guest:moved` (`sameFloor` policy, AD-009 machinery), never `player:moved`;
  guest boarding emits no `player:left-floor`; guest in-car presses queue
  silently (not rider testimony). Rider knowledge includes guests
  (`elevator:riders`/`carOccupants` gain a `guests` array, present only when
  non-empty — pre-3.1 payloads keep their exact shape); capacity 2 counts
  them. **AD-005 amended**: the sim→movement seam widens from read-only to
  read-and-command through a narrow NPC-only `MovementPort` (the room builds
  the adapter; player intents still enter only via the network). Checkout
  churn is `WorkChannels.churnTrash` setting the existing `settled` state —
  no sabotage-shaped `room:trashed` ever comes from churn (JUST-07/08 grace
  safety); the FR-32 author dimension stays 3.4 scope. New §7-external
  constants: `DESK_X_TILES = 15` (lobby center), `GUEST_QUEUE_SPACING_TILES =
  1` (queue grows eastward, FIFO by arrival). Test seams (the AD-004
  pattern): `RoundSimConfig.movement`/`guestTiming`, and the room's
  `TURNOVER_TEST_GUEST_SCALE` env (non-production only) scaling cadence,
  impatience, and dwell so gate-3 rounds observe full guest lifecycles.
- **Reason**: Reuse — the movement layer is the most-amended code in the repo
  (AD-012…027); guests re-deriving walking/elevators would drift on the next
  elevator AD. The port keeps the AD-005 discipline for players while giving
  the sim the only legitimate NPC control channel. Registry-first (AD-006):
  all seven guest messages declared once with explicit policies.
- **Trade-off**: The mover-kind split touches the core of `movement.ts`
  (mitigated: kind defaults to `'player'`, keeping every existing path
  byte-identical — the 323-test baseline held unchanged); ambient guest
  traffic breaks harness scenarios that assumed static parked cars (the
  boarding specs gained a press-retry pattern mirroring real AD-025 play);
  the AD-004/AD-028 seams are test-only and production-inert.
- **Scope**: `packages/shared` (tuning, layout door-x, protocol guest
  messages), `packages/sim` (rng, guests, movement mover-kind, work
  churnTrash, roundSim port), `apps/server` (guest port + purge + test seam),
  `apps/client` (markers, queue, bell, mappers), `apps/client/harness`
  (`client:guest_flow` + press-retry pattern), roadmap unchanged.
- **Date**: 2026-08-31
- **Status**: active.

### AD-029
- **Decision**: **Adopt the "Deco Noir" alternative art direction as the
  production visual contract**, superseding the AD-020 era/mood anchor (the
  chunky arcade corridor reference) for art only. Palette moves to slate-teal
  architecture + burgundy carpet + brass trim with ivory-uniformed staff
  (identical uniform for every player — no saboteur tell); edges stay hard
  pixel clusters with NO outlines (value-separation gate replaces the outline
  rule); ornament is geometric (stepped lintels, chevron/diamond chains).
  Client grays that remain code-side change with it: `WorldScene` wall fill
  `0xe8dcc0` → `0x33505a`, hall lane line `0x556677` → `0xb3873a`,
  `BootScene` backdrop `0x223344` → `0x0f1b21`. Sheet contracts are
  UNCHANGED from AD-020 (staff 28x60 8f, doors 72x96, car 96x64, panel
  32x32, interiors 112x96, band 32x146) — this is a rendering-only restyle;
  the alternative brief's taller 34x64 characters are deferred until the
  open 960px-viewport decision lands. *(Recorded on `art/deco-noir` before
  the guest-flow cycle landed here; initially numbered AD-028 — renumbered
  to AD-029 at merge time because the guest-economy decision took AD-028
  first. Branch commit messages still say AD-028; this entry is the
  authoritative numbering.)*
- **Reason**: User-approved direction change ("forget Elevator Action"). The
  alternative brief (docs/art/alternative/) was built through the
  create-game-assets workflow with an approved seed board; adopting it keeps
  all gameplay-read gates (silhouette room states, hallway-readable cards,
  grayscale separation) intact.
- **Trade-off**: Visual identity change with zero protocol/sim/tuning churn;
  the AD-020 brief is kept for provenance with a superseded pointer. Gate 3
  re-run required since harness scenarios assert textures/frames (unchanged
  keys, so expectation: pass).
- **Scope**: `scripts/art/generate-{staff-walk,doors-elevator,corridor-band,room-interiors,fx-rustle}.py`,
  `apps/client/public/art/**` (regenerated),
  `apps/client/src/scenes/{WorldScene,BootScene}.ts` (fills only),
  `docs/art/**` (briefs + manifests), `docs/art/alternative/**`.
- **Date**: 2026-08-30
- **Status**: active.

### AD-030
- **Decision**: **Adopt the 960x576 client viewport** (canvas width 832 → 960),
  resolving the open TILE_PX decision recorded in both art briefs. `TILE_PX`
  becomes the integer 32 (960 / 30 hall tiles, unchanged); the corridor band
  tileSprite, wall fill, lane lines, elevator panel x-positions and BootScene
  backdrop widen to match. Purely client-rendering/layout: hall length stays
  30 tiles, all sim/tuning values (speed in tiles/s, room segments in
  milli-tiles) untouched — every world x remains derived from `x * TILE_PX`.
  Unblocks the Deco Noir 34x64 character frames and all 3.A char-variants
  sheets on an integer pixel grid (Deco ornament pitches: 16/32 px).
- **Reason**: Non-integer 832/30 ≈ 27.73 px/tile fought the pixel-art grid on
  every authored sheet; the Deco Noir adoption (AD-029) deferred character
  geometry on exactly this decision. Landing it before 3.A authoring avoids
  re-authoring the variant sheets.
- **Trade-off**: 128 px more visible corridor per screen (mild framing change,
  Gate 4 eye check recommended); harness tile constants updated in-place
  (`832 / 30` → `32`). Zero protocol/sim churn.
- **Scope**: `apps/client/src/main.ts`, `apps/client/src/scenes/{WorldScene,BootScene}.ts`,
  `apps/client/harness/{movement,elevatorLobby}.spec.ts` (tile constants only),
  `docs/art/alternative/art-direction-brief.md`.
- **Date**: 2026-08-31
- **Status**: active.

### AD-031
- **Decision**: New §7-external constant `TUNING.DESK_RANGE_TILES = 1` — the
  E receive/release zone at the front desk: a player on the lobby floor within
  1 tile of `DESK_X_TILES` may receive the front queued guest (cycle 3.2) and
  releases the held guest by pressing E again or leaving the zone. Inside the
  zone the contextual E suppresses the accuse hold entirely.
- **Reason**: prd §6.9/FR-27 lock the desk interaction but no receive range;
  the spec's assumptions table leaves the zone to the design (AD-029-slot
  placeholder in the spec text — the number was taken by the Deco Noir merge,
  renumbered here per that precedent). 1 tile matches the landing-zone scale
  (`ELEVATOR_LANDING_TILES`) and keeps the zone a deliberate standing spot.
- **Trade-off**: One more §7-external tuning constant (recorded per the tuning
  rule); playtests may widen it via a new AD, never an incidental edit.
- **Scope**: `packages/shared/src/tuning.ts`, `packages/sim/src/guests.ts`,
  `packages/sim/src/roundSim.ts`, `apps/client/src/scenes/WorldScene.ts`,
  cycle 3.2.
- **Date**: 2026-08-31
- **Status**: active.

### AD-032
- **Decision**: PRD v1.4 — the guest-transport (suitcase) redesign, replacing
  3.2's walkie-broadcast routing. Check-in hands the guest's **suitcase** to
  the receiving player (receiver = carrier, one per player; carrying blocks
  work channels — new FR-9a — accusation stays available). The suitcase is a
  physical object: E places it at a room door, E near a resting suitcase picks
  it up, by anyone (saboteur included, self-regrab allowed). The guest waits
  at the restaurant (mezzanine floor, new; holding-area stub until cycle 3.C)
  and follows the suitcase's **last resting room**; the outcome triggers at
  guest **arrival**: room == assignment → settle; room != assignment → door
  complaint toward the FR-31 budget — **no personal penalty for the
  placement**. The assignment is server-truth seeded at check-in, transmitted
  only to the receiver + staff in desk earshot **at the check-in tick**
  (snapshot, never repeated; hidden-by-position, message-only legal). The
  walkie becomes a **server-generated truthful lifecycle log** (waiting,
  check-in, pickup, settle, complaint, checkout); the `walkie:broadcast`
  player intent is deleted and **placement emits no walkie line**. A rolling
  **60s carry clock** (check-in → first placement, fresh 60s per pickup) is
  the **only personal foul**: expiry fires the current carrier. Impatience
  re-scopes to the check-in wait only. The **trash race** (overhear → beat
  the suitcase to the assigned room → trash it) is intended core loop, not a
  leak to patch.
- **Reason**: AD-022's desk routing parks one staff member at the desk and
  gives the walkie lie no verification surface (grilling session 2026-08-31).
  The suitcase makes the receiver mobile, turns the assignment into a
  contested overhear (verification and sabotage intel in one), and makes the
  contested object itself the ground truth. The announce lie was removed
  (user direction) once the suitcase made claims verifiable within seconds —
  the walkie survives as the building's automatic, lie-free lifecycle channel
  (framing removed with it; accepted trade). Wrong-delivery firing was
  explicitly rejected en route (first a hurt-points gauge, then removed —
  mis-placement stays free; the carry clock is the only personal foul).
- **Trade-off**: Mis-placement is free and stealthy — staff interception
  before arrival is the only defense; a §7 balance gate is attached (3.5 bot
  sims must prove interception keeps pace before the v1.4 dials lock). Honest
  carriers can be clock-fired in elevator congestion (60s chosen generous).
  Innocent-placer paralysis is a recorded risk with a diegetic one-step
  confirm mitigation (own-knowledge only, never the assignment). The walkie
  lie and its framing surface are gone by design. Building shape breaks the
  AD-010 pin (mezzanine floor, cycle 3.C).
- **Scope**: `prd.md` v1.4 (§5, FR-3, FR-9a, §6.9, FR-33, §7, §9),
  `roadmap.md` (cycles 3.B `suitcase-transport`, 3.C `restaurant-floor`;
  3.3–3.6 amended), proposal
  `.specs/proposals/guest-transport-economy.md`; implementation lands via
  3.B/3.C (registry-first protocol changes: assignment earshot policy,
  suitcase events, lifecycle walkie feed, `walkie:broadcast` removal).
- **Date**: 2026-08-31
- **Status**: active.

### AD-033
- **Decision**: Cycle 3.B constants + autonomous-run rulings for the suitcase
  transport (all §7-external, recorded per the tuning rule):
  (a) `ROOM_DOOR_RANGE_TILES = 1` — the E place/pickup range around a room's
  door x (mirrors `ELEVATOR_LANDING_TILES`/`DESK_RANGE_TILES` scale).
  (b) `GUEST_HOLD_START_TILES = 18` — the 3.B holding-area stub starts 3 tiles
  east of the desk, slots extend eastward at `GUEST_QUEUE_SPACING_TILES`; the
  3.C mezzanine restaurant replaces it.
  (c) Wrong-delivery aftermath (the spec's assumed default): a guest who
  complains at a wrong door RETURNS to the holding area and re-targets on the
  suitcase's next rest event — correction after arrival stays possible; the
  complaint is the cost (one per wrong arrival, no dedup).
  (d) Earshot membership: receiver + every live non-spectator lobby-floor
  player within `DESK_EARSHOT_TILES` at the check-in tick; the `deskEarshot`
  policy deliberately EXCLUDES spectators (a fired player must not learn later
  assignments), unlike the rustle `earshot` over-delivery.
  (e) Reservation model: a check-in assignment RESERVES the room (vacancy
  excludes tenanted AND reserved); settle converts reservation → tenancy;
  teardown voids the assignment and releases the reservation.
  (f) **SPEC_DEVIATION (roadmap letter)**: carrier loss rests the suitcase at
  the desk only as shorthand — implemented as the desk ABSORBING it (removed
  from play; guest re-queued front, assignment void). A rest-at-desk object
  with a voided assignment has no game consequence, and a movable one could
  dead-end the desk for its guest; the re-check-in issues the guest's luggage
  afresh.
- **Reason**: The spec's assumptions table resolved the v1.4 gray areas for
  the autonomous run; constants mirror existing scale pins. (f) is recorded
  because the roadmap/proposal wording ("suitcase rests at desk") described an
  object with no remaining game function.
- **Trade-off**: (f) loses the interception flavor of an abandoned desk
  suitcase; if playtests miss it, a new AD can restore a bound desk-rest with
  a re-check-in pickup path. (c) means repeated re-placing at the same wrong
  room re-complains per arrival — the intended pressure; revisit via the 3.5
  balance gate.
- **Scope**: `packages/shared/src/tuning.ts`,
  `packages/sim/src/guests.ts` (SPEC_DEVIATION comment at `dropCarry`),
  cycle 3.B artifacts.
- **Date**: 2026-08-31
- **Status**: active.

### AD-034
- **Decision**: PRD v1.4 amendment (user rulings, 2026-08-31, watching a headed
  run of the 3.B gate scenarios): (a) the guest's room assignment becomes a
  **building-wide notice** — announced to ALL players at the check-in tick
  (walkie line "a guest announces: I'm in F:R"); the desk-earshot model is
  removed (`deskEarshot` policy, `DESK_EARSHOT_TILES`, router branch). The
  event is renamed `assignment:overheard` → `guest:assigned`. (b) The
  blind-place confirm (SUI-26, "You haven't heard this guest's room") is
  REMOVED — with public assignments it can never trigger. (c) The suitcase
  rests in front of the door (segment center = the door visual) — pinned as a
  requirement, already the shipped behavior. (d) The restaurant (~30 s guest
  dwell on the mezzanine) stays deferred to cycle 3.C; the 3.B holding-area
  stub remains. (e) Accepted consequence: the saboteur learns the assignment
  for free — the contested gameplay is physical interception of the suitcase,
  not information. The assignment reservation model, carry clock, carry-blocks-
  work, guest-following and arrival outcomes are unchanged. Status: DECIDED —
  implementation pending (see the cycle handoff doc).
- **Reason**: User direction while spectating the gate run; simplifies the
  information layer and removes the innocent-placer confirm (unreachable once
  assignments are public).
- **Trade-off**: The contested-overhear social moment (hover at the desk to
  listen) is gone; interception/correction of suitcases is the counterplay. The
  §7 `DESK_EARSHOT_TILES` row and the 3.5 balance-gate dependency on earshot
  are dropped.
- **Scope**: `packages/shared` (simEvents/messages/registry/tuning),
  `apps/server` (router + tests), `packages/sim` (checkIn emit + suites),
  `apps/client` (mappers/state/WorldScene confirm removal + announce line),
  harness spec, spec/CONTEXT/roadmap amendments. Implementation checklist:
  `.specs/features/suitcase-transport/HANDOFF.md`.
- **Date**: 2026-08-31
- **Status**: active — implemented 2026-08-31 (registry-first rename,
  `deskEarshot` policy + `DESK_EARSHOT_TILES` + `EventVisibility.x` deleted,
  blind-place confirm removed, announce walkie line rendered on every page;
  harness SUI-23 close-out: discriminating last-5 assertion driven by wire
  event volume at `TURNOVER_TEST_GUEST_SCALE=0.2`; gates typecheck/lint/
  test:sim 385/`client:suitcase` 2× green).

### AD-035
- **Decision**: Cycle 3.C `restaurant-floor` — the mezzanine lands as the
  building's fifth floor and checked-in guests dine there. (a) `FLOOR_IDS`
  becomes `['lobby', 'mezzanine', 'floor1', 'floor2', 'floor3']` (mezzanine
  directly above the lobby; amends AD-010's floor SET — room geometry is
  untouched, the mezzanine has no rooms); elevator ride cost keeps deriving
  from `indexOf`, so lobby↔floor1 doubles to two strides (5-stop economy,
  bought deliberately by the roadmap). (b) The guest `waiting` phase renames
  to `dining` (internal, never transmitted); the 3.B holding stub is replaced
  by dining slots on the mezzanine at
  `GUEST_RESTAURANT_START_TILES + slot × GUEST_QUEUE_SPACING_TILES` (renames
  AD-033(b)'s `GUEST_HOLD_START_TILES`, value 18 kept; re-places now compare
  FLOORS, not only x, so queue↔dining teleports cannot strand a guest). (c)
  Each dining stay draws a seeded uniform 15–30 s dwell
  (`GUEST_DINING_MIN/MAX_SECONDS`, guest Rng stream, `diningScale` test seam)
  — a wait BUFFER with no behavioral consumer (proposal: "not a schedule"):
  the drawn value is queryable via `GuestSim.diningDwellOf` for tests and
  telemetry; a suitcase rest departs the diner immediately (existing
  retarget). (d) Wrong-delivery returns (AD-033(c)) re-dine instead of
  re-holding. (e) `suitcase:place` on the mezzanine is ignored (no room
  doors). (f) Autonomous-run defaults (user absent): M (KeyM) presses the
  mezzanine in-car and lights the M indicator; dining arrival is the
  established NPC teleport (re-place), not a walk driver; no new registry
  messages (FloorId widening is the only protocol surface); the harness
  shift seam rises 30 → 60 s and buzzer-spanning waits/timeout re-pin to it
  (test-only, AD-004 seam).
- **Reason**: Roadmap 3.C (prd v1.4/FR-3): the restaurant gives the trash
  race its timing texture and empties the desk area. Conforming choices
  where the docs pinned them; the rest recorded here per the autonomous-run
  precedent.
- **Trade-off**: Elevator economy slows (every lobby trip +1 stride) — the
  3.5 balance gate re-proves; the Rng stream shifted (one draw per dining
  stay) so seeded suite expectations re-pinned; harness scenarios re-timed
  (the justice approach walk is now events-driven — the fixed sleep drifted
  into the AD-031 desk-suppression zone).
- **Scope**: `packages/shared/src/{layout,tuning}.ts`, `packages/sim/src/
  guests.ts` (+tests), `apps/server` (snapshot/overview seams), `apps/client`
  (mezzanine view, M affordances, dining cue, snapshot guest ingestion),
  `apps/client/harness/*`, `docs/art/alternative/asset-manifest.json`,
  `CONTEXT.md`, `docs/elevator-behavior.md`.
- **Date**: 2026-08-31
- **Status**: active

### AD-036
- **Decision**: Room geometry re-derived (amends AD-010's constants, not its
  shape): `ROOM_DEPTH_TILES` 3.5 → 3.25 and `ROOM_HALL_START_TILES` 1 → 2, so
  the 8 rooms tile `[2, 28]` of the 30-tile hall and each end frees a 2-tile
  (64 px) landing clearance. Purpose: the elevator gets FRONT-FACING landing
  doors in the same perspective as room doors (replacing the transverse
  `elevator-car` slab), and a 64 px door needs 64 px of clear wall — the old
  1-tile (32 px) landings could not fit one. Segment width 104 px still
  comfortably holds the 72 px `door-closed` art; door gaps go 40 → 32 px.
- **Reason**: The transverse car reads as a foreign object against the
  billboarded hall; a front-facing door also makes arrivals publicly readable
  (doors open across the hall = someone landed) without leaking occupants
  (ART-15 privacy rule keeps the occupant list server-side).
- **Trade-off**: All milli-derived positions shift (room doors move up to
  0.875 tiles inward); landing boarding zones (1 tile around x=0/30) no longer
  overlap any room segment — an improvement for the "at landing vs in room"
  ambiguity. No travel-budget change (hall length and room count unchanged).
- **Scope**: `packages/shared/src/layout.ts` (+tests), re-pinned hard-coded
  milli literals in `packages/sim/src/{justice,roundSim,work}.test.ts`,
  `apps/server/src/rooms/{router,TurnoverRoom}.test.ts`. Client coordinates
  all derive from milli — no client edits.
- **Date**: 2026-09-01
- **Status**: active

### AD-037
- **Decision**: One E-affordance module in `packages/shared/src/affordances.ts`
  owning the spatial expressions behind every range-gated interaction: the
  desk zone (AD-031), room-door range (AD-033), landing zone (AD-022), and
  accusation range predicates, nearest-resting-Suitcase selection (ties to
  lowest guest ordinal, SUI-08), and the E-key decision tables —
  `resolveEKeydown` (the SUI-25 ladder: desk → place → pickup → hold) and
  `resolveEKeyup` (the JUST-17 swallow rule). The interface unit is TILES
  (the TUNING vocabulary, the movement sim's `positionOf`, and the wire all
  agree there; `work.positionOf` callers convert MILLI → tiles once at the
  guard). BOTH the sim's authority guards (`roundSim.accuse/deskInteract`,
  `guests.placeSuitcase/pickupSuitcase`) and the client's prediction mirror
  (`WorldScene`) consume the same expressions; a mirrored range expression in
  a caller is henceforth a defect, not a pattern. Pinch rule: nothing that
  emits, mutates, or knows about transport crosses the module's interface;
  liveness filtering (fired/ghosted/left) stays with the caller.
- **Reason**: Architecture review (`/improve-codebase-architecture`,
  candidate 1, user-accepted grilling rulings 1-a/2-a/3-b/same-change): the
  client hand-mirrored six server range rules in two unit dialects and the
  ordering-sensitive E ladder was reachable only through Playwright. Two
  adapters (sim authority + client prediction) make the seam real; the
  ladder's bug surface moves to a table-tested pure module.
- **Trade-off**: One behavior refinement on the mirror side: `doorRoomAt` is
  null on the mezzanine (matching the server's REST-05 rejection) where the
  old client predicate only excluded the lobby — the client now withholds a
  place intent the server would silently ignore. Riding keydown needs no
  explicit gate: riders have no floor (AD-009) so `own` is null, exactly as
  the scene contract already behaved.
- **Scope**: `packages/shared/src/affordances.ts` (+25 test cases),
  `packages/sim/src/{roundSim,guests}.ts`, `apps/client/src/scenes/
  WorldScene.ts`, `CONTEXT.md`. The harness suitcase spec's hand-pinned
  `doorXTiles` now derives from the shared layout — the same anti-pattern
  this AD closes (it broke silently under the AD-036 geometry re-derivation,
  with a corrective walk added for the 900 ms exit-hop overshoot).
- **Date**: 2026-09-01
- **Status**: active

### AD-038
- **Decision**: The `ElevatorPresenter` becomes the single clock authority for
  elevator presentation. It absorbs the three state homes the scene had
  co-owned alongside it: the per-car hall-call lights (AD-024 — lit on a call
  the car is NOT standing at, cleared on that car's arrival), the ART-17
  landing-panel flash window (700 ms, every call registers, decoys included),
  and the rider's in-car screen transit sweep (the leg clock, re-anchored
  from the own car's press queue — now advanced by `tick`'s dtMs instead of
  wall-clock re-anchoring). `tick(dtMs, viewFloor, rider)` takes the Rider
  session read-only; the scene's `syncCarScreenReadouts` applies the
  presenter's readout to the DOM verbatim and `updatePanel`/`syncPanelFlash`
  read `panelState()`/`isFlashing()`. Snapshot car-floor seeding now flows
  through `onMoved` (unifying the scene's `cars` map, which keeps only
  `view`; its duplicate `floor` field is deleted), and the scene's per-frame
  `car.view.y = laneY(floor) + 30` write is deleted — the presenter's `setY`
  already overwrote it every frame (dead write; commit 6e8ea4b removed the
  +30 offset from the presenter's base years ago).
- **Reason**: Architecture review candidate 4 (user-accepted): elevator
  behavior was one domain spread over three state homes with a redundant
  sweep clock — the scene's re-anchoring (`carScreenLeg` vs the presenter's
  clocks) was a drift bug surface only Gate 3 could observe, and `updatePanel`
  re-filled DOM every frame from scene-copied state. The presenter seam
  already existed and was node-tested; completing it keeps one test surface.
- **Trade-off**: `tick` gains a third parameter (the rider facts); the
  flash's `until` stays wall-clock-anchored inside `onCalled` (cosmetic only,
  never compared against sim time). The presenter now imports two pure
  helpers from `ui/carScreen` (`transitFloorReadout`, `floorLabel`) — still
  Phaser-free and node-testable.
- **Scope**: `apps/client/src/scenes/elevatorPresenter.ts` (+7 state tests),
  `apps/client/src/scenes/WorldScene.ts`. No protocol, sim, or CONTEXT
  changes; the deleted scene fields are `calledLights`, `panelFlash`,
  `carScreenLeg`.
- **Date**: 2026-09-01
- **Status**: active

### AD-039
- **Decision**: PRD v1.5 — delivery scoring (cycle 3.D, proposal:
  `.specs/proposals/delivery-scoring.md`). The FR-29(a) wrong-delivery door
  complaint is **decoupled from the FR-31 complaint budget**: the
  building-wide line still fires at guest arrival (evidence beat, honest-
  mistake feedback, recap provenance unchanged) but counts toward nothing —
  the budget means "caught sabotaging" (trash-discovery complaints only,
  wired by 3.3). The §6.6 buzzer leg swaps coverage% for the **settle
  score**: staff win at the buzzer when the round's settled-guest count ≥
  `SETTLE_TARGET` (§7 v1.5: 4p 5 / 5p 7 / 6p 9, provisional pending the 3.5
  exit-bot gate); win reasons rename `coverage-met`/`coverage-failed` →
  `settle-target-met`/`settle-target-failed`; coverage survives as FR-23
  telemetry/KPI only. Transport: **no new protocol message** — the client
  HUD counts the already-public `guest:settled` stream (pure `ScoreHud`
  presenter in the scene); `round:recap` carries `settleScore`+`settleTarget`
  and `round:resumed` carries `settleScore` (reconnect re-seed) as payload
  extensions on existing rows.
- **Reason**: User direction ("simpler: right room = points, wrong room =
  nothing"), refined in discussion: a fully silent mis-placement would
  remove the suitcase system's evidence beat and honest-mistake feedback, so
  the line stays while its punitive coupling dies. Budget = getting caught
  sabotaging; score = doing the job; wrong delivery costs time only.
- **Trade-off**: The 8-complaint leg becomes harder to reach (trash
  discovery only) — its dial is re-examined at the 3.5 gate, not retuned
  now. Per-player points were rejected (staff-vs-staff incentives); the
  score is one public team number.
- **Scope**: `packages/shared` (`tuning.settleTargetFor`, `RoundEndReason`
  rename, `RoundRecap`/`RoundResumed` fields), `packages/sim`
  (`GuestSim.settledCount`, `RoundSim` buzzer verdict), `apps/server`
  (recap/resume builders), `apps/client` (`ui/scoreHud` + WorldScene mount,
  results view, state/mappers), harness `client:score_hud`, prd/roadmap.
  Sequencing: cycle 3.D precedes 3.3 (the letter precedent — 3.3's loss
  loop consumes these triggers); 3.5 calibrates `SETTLE_TARGET`.
- **Date**: 2026-09-01
- **Status**: active

## Handoff
- **Feature**: `delivery-scoring` (cycle 3.D, prd v1.5, AD-039) — all 8 tasks
  committed (T1 `settleTargetFor`, T2 `GuestSim.settledCount`, T3 buzzer
  verdict swap + reason rename, T4 recap/resume payloads, T5 score HUD,
  T6 results + resume wiring, T7 `client:score_hud` ×2, T8 docs). Verifier
  report: `.specs/features/delivery-scoring/validation.md`.
- **Phase / Task**: Execute → Validate.
- **Next step**: cycle 3.3 `complaint-budget` (scope amended by 3.D:
  trash-discovery complaints only) or the 3.5 gate for `SETTLE_TARGET`
  calibration.
- **Gates**: typecheck ✓ · lint ✓ · test:sim 436 ✓ · test:client 38/38
  (one in-suite re-flake of `client:lobby_join` room-full — green isolated
  and 2× full green at HEAD; documented bleed class, predates 3.D).
- **Follow-ups (non-blocking)**: (1) **Elevator boarding jam at high guest
  density** (found while building `client:score_hud`, pre-existing): a FULL
  car parked at a landing with a lit same-floor hall call keeps its doors
  open indefinitely — boarders queue behind capacity and the car never
  departs ("dwell extends while a call remains to attend", AD-027 wording).
  Needs ~7+ simultaneous self-assigned boarders (harness timing only at
  §7 dials); movement quirk, not 3.D scope — investigate before the 3.5
  bot sims which may hit it at scale. (2) `SETTLE_TARGET` values are
  provisional by design — 3.5 calibrates.
- **Blockers**: none.
- **Branch**: master
