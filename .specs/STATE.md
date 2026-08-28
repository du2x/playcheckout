# STATE

## Decisions

### AD-001
- **Decision**: The server is a single Fastify process that hosts Colyseus on one port — static client and WebSocket endpoint share `app.server` via the `colyseus/vite` wiring: `new WebSocketTransport({ noServer: true })` + `transport.attachToServer(app.server)` + `createNodeMatchmakingMiddleware()` mounted on Fastify's request chain.
- **Reason**: prd §11 locks single-container deploy (Railway). The `{ server: fastify.server }` transport option would register its express app as a competing `request` listener; the noServer+attachToServer pattern is Colyseus' own documented shared-HTTP-server mechanism (verified in 0.18.3 sources), with upgrade-only overlap and no request-flow conflict.
- **Trade-off**: We own an integration no public Fastify reference covers (first to publish it); separate-port dev setups would be simpler to debug but break the deploy contract.
- **Scope**: `apps/server`, all future rooms, CI smoke/boot tests.
- **Date**: 2026-08-27
- **Status**: active

## Handoff

- **Feature**: skeleton (`.specs/features/skeleton/`)
- **Phase / Task**: Design complete, awaiting user approval → Tasks
- **Completed**: none
- **In-progress** (file:line): none
- **Next step**: Present design.md for approval, then run validate_tasks.py on the drafted tasks.md
- **Blockers**: none
- **Uncommitted files**: `.specs/` (spec.md, design.md, STATE.md)
- **Branch**: main
