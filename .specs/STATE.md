# STATE

## Decisions

### AD-001
- **Decision**: The server is a single Fastify process that hosts Colyseus via `new WebSocketTransport({ server: fastify.server })` — one port serves both the static client and the WebSocket endpoint.
- **Reason**: prd §11 locks single-container deploy (Railway); the attach is the documented mechanism (roadmap "Key API facts") but has zero public examples, so it is proven in Phase 1 with a placeholder room before Phase 2 stacks game logic on it.
- **Trade-off**: We own an integration no public reference covers (first to publish it); separate-port dev setups would be simpler to debug but break the deploy contract.
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
