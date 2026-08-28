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

## Handoff

- **Feature**: protocol-registry (`.specs/features/protocol-registry/`) — cycle 2.3 (AD-006) ✅ COMPLETE
- **Phase / Task**: Specify → Design → Tasks (T1–T6) → Execute → Verifier **PASS**
  (validation.md: 20/20 REGs evidenced, gates 1–3 exit 0 — typecheck, lint, 94/94 sim,
  16/16 client; discrimination sensor 8/8 mutants killed; Gate 4 N/A — behavior-preserving)
- **Completed**: registry in `packages/shared/src/protocol/registry.ts` (SimEvent moved to
  shared, sim re-exports; payload `type` literals dropped; envelope.ts + unions deleted);
  per-room Router `apps/server/src/rooms/router.ts` (only sender, per-connection seq from 1,
  `toSelf`/`toAll` policy-typed via `KeysWith`); client generic dispatch (`connection.ts`
  `onMessage('*')` + seq guard + gap→leave, `mappers.ts` exhaustive table, `app.ts`
  view-transition scene sync); harness `client:envelope_gap`; turnover-protocol rule 5
  rewritten (registry = audit surface, grep retired)
- **In-progress** (file:line): none
- **Next step**: cycle 2.4 `movement` (`.specs/features/movement/spec.md` exists) — Design
  must target the registry (declare new message types there; recipient-policy enum extends
  deliberately, e.g. `nearby`/`roomOccupants` land with their first consumers; 20 Hz
  position streams ride the envelope's seq/time)
- **Blockers**: none (Gate 4 human rounds pending for first-light + protocol-registry is
  N/A; run `pnpm boot`, open 4 tabs, create/join/start when convenient)
- **Uncommitted files**: user WIP `scripts/dev-boot.mjs` + `package.json` boot script
  (not part of any feature); `.playwright-mcp/` gitignored session logs
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
