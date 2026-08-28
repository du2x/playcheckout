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

- **Feature**: skeleton (`.specs/features/skeleton/`) — COMPLETE
- **Phase / Task**: Validated (validation.md PASS, validate_state exit 0); all 7 tasks committed
- **Completed**: T1–T7 (commits 9d593b8..8eabc44)
- **In-progress** (file:line): none
- **Next step**: Phase 2 — authoritative server sim (headless-first), planned as 7 tlc
  cycles (see `roadmap.md` Phase 2 table). Next: cycle 2.1 `room-shell` — fresh Specify
  for `.specs/features/room-shell/`.
- **Blockers**: none
- **Uncommitted files**: none (after final .specs commit)
- **Branch**: master (renamed from default; 7 commits, no remote)

Deferred notes from validation: (1) tuning-literal denylist test is the sole guard against literal duplication — review-enforced complement; (2) spec.md coverage header was stale, fixed post-validation.
