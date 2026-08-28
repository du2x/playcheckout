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
- **Status**: active

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

## Handoff

- **Feature**: elevator-lobby (`.specs/features/elevator-lobby/`) — AD-011 fix ✅ COMPLETE
- **Phase / Task**: Specify → Execute (small scope, inline) → Verifier **PASS**
  (`validation.md`: 4/4 EL ACs evidenced; sensor 5 injected / 5 killed / 0 surviving;
  gates 1–3 exit 0 — 163/163 sim+server, 21/21 client; doc-only gap closed in the
  same session: movement spec/design stale elevator text now annotated as
  AD-011-superseded). Gate 4 human round still open.
- **Completed**: `MovementSim.callElevator` phase guard removed (only in-car callers
  rejected, `movement.ts:142`); `lock()` no longer clears the call FIFO (queued calls
  served across the buzzer, EL-02); intent-error message updated; elevator panel added
  to the lobby view (`lobbyView.ts`) and made self-healing in `WorldScene.update()`;
  amended sim tests (pre-round ride, post-buzzer queued dispatch at exact tick 99,
  in-car rejection, confinement interplay) + server test + new harness scenario
  `client:elevator_lobby` (ride floor1 and back with zero host starts — the fast
  Playwright elevator-debug entry point). Commit `63fd475`.
- **In-progress** (file:line): none
- **Next step**: cycle 2.6 `evidence` (FR-10–FR-13) per the previous handoff. Note for
  its Design: pass-through room crossings already emit `room:observed` (2.5) and
  elevators now run pre-round — decide whether door-open cues apply pre-round (likely
  no: work channels are round-scoped, so pre-round door traffic is elevator-only).
- **Blockers**: none (Gate 4 human rounds pending: movement, work-channels,
  elevator-lobby — the elevator one is quick now: `pnpm boot`, one tab, walk to a
  landing, ArrowUp/ArrowDown with no round started)
- **Uncommitted files**: user WIP `scripts/dev-boot.mjs` + `package.json` boot script;
  `.playwright-mcp/` gitignored session logs
- **Branch**: master

Deferred notes from Verifier (room-shell PASS, low-severity spec-precision gaps):
(1) LOBBY-02 "create no room" clause unasserted; (2) rejected start intent lacks a
lobby-phase re-assertion (reject-then-start mutant); (3) LOBBY-05 "roster unchanged"
after name rejection unasserted — fold into the next cycle touching TurnoverRoom.

Deferred notes from Verifier (first-light PASS): (2) LIGHT-02 unknown-code message,
(3) LIGHT-08 "round already active", (4) LIGHT-04 1-char name minimum — fold into the
next client-touching cycle.

Deferred notes from Verifier (protocol-registry PASS, low severity, fold into the next
cycle touching these files): (N1) TurnoverRoom.test.ts:412-415 comment misattributes the
collector-added `type` key to Colyseus transport; (N2) registry.test.ts:66-70 pins policy
membership, not literal per-key values — a literal per-key policy walk would be direct;
(N3) `RegistryEntry<P>` (registry.ts:41-44) exported but unused — dead declaration.
