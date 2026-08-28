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

## Handoff

- **Feature**: room-shell (`.specs/features/room-shell/`) — all 7 tasks committed (T1-T7)
- **Phase / Task**: Awaiting Verifier (validation.md pending)
- **Completed**: sim deal (T1), RoundSim + sim:role_deal (T2), message catalog (T3),
  lobby join (T4), start/sim/routing (T5), churn (T6), registration swap + full round (T7)
- **In-progress** (file:line): none
- **Next step**: Verifier pass, then cycle 2.2 `movement` (see roadmap Phase 2 table)
- **Blockers**: none
- **Uncommitted files**: none
- **Branch**: master
