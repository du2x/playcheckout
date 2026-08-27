# Monorepo Skeleton + Shared Types Specification

## Problem Statement

The repo contains only planning documents (prd.md, roadmap.md, CI workflow, agent
skills). Phase 1 must lay the workspace foundation every later phase builds on:
pnpm workspaces with four members, the shared types/tuning package, a bootable
Fastify + Colyseus transport shell, a Vite + Phaser 4 client shell, and root gate
scripts so the existing CI contract (`.github/workflows/ci.yml`) runs green from
the first commit.

## Goals

- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` all exit 0 at repo root, locally and in CI
- [ ] `packages/shared` is the single source of truth for layout constants, room states, and prd §7 tuning values — zero duplicated literals in other workspaces
- [ ] Server shell boots on one port (static client + Colyseus WS, message-only); client shell boots Phaser 4 with a dev-only `window.__TURNOVER__` hook

## Out of Scope

| Feature | Reason |
|---|---|
| Any game rules (movement, prep channels, evidence, justice) | Phase 2 — sim is built headless-first there |
| Concrete message catalog (`room:prepped`, …) | Phase 2, after the sim's event surface exists; wire envelope + FR-23 schema types only here |
| Lobby / join-by-code / role dealing | Phase 2 item 1 |
| Gray-box rendering beyond a placeholder scene | Phase 3 |
| Full client-harness scenario format | Phase 3 (minimal boot check only here) |
| Railway deploy, JSONL telemetry writing, KPI computation | Phase 4 |
| Art, audio, tutorial UI | Non-goals (prd §4) |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| Exact room count for layout constants | 24 rooms (3 floors × 8) | Locked by roadmap step 0 travel-budget math; prd FR-3 says 7–8 rooms/floor, roadmap assumed 8 | y (roadmap) |
| Phase 1 scope of protocol types in `packages/shared` | Wire envelope types (per-player event stream, personal snapshot shape, client→server intent base, FR-23 JSONL event schema) — no concrete message catalog | The catalog mirrors sim events that don't exist until Phase 2; envelope shapes are structural and stable | y |
| `pnpm test:client` at Phase 1 | Minimal boot check: Playwright headless Chromium loads the served client page and asserts the Phaser boot hook (`window.__TURNOVER__`) | CI runs gate 3 as soon as `pnpm-lock.yaml` exists; the gate must exit 0 from day one without inventing Phase 3 scenario machinery | y |
| `pnpm test:sim` at Phase 1 | One trivial placeholder vitest scenario in `packages/sim` (imports shared constants, asserts them) | Same CI constraint; avoids relying on vitest `passWithNoTests` semantics | y |
| Placeholder room on the server | One trivial Colyseus room, message-only, `patchRate = null` | Proves the Fastify+Colyseus attach (undocumented combination — we are the reference) before Phase 2 stacks game logic on it | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Workspace + gate tooling ⭐ MVP

**User Story**: As a developer, I want a four-member pnpm workspace with root gate
scripts so that every later task has a green-gate foundation and CI runs from push one.

**Why P1**: Nothing can be built or verified without it; CI is already wired to
activate the moment a lockfile lands.

**Acceptance Criteria** (EARS):

1. WHEN `pnpm install` runs at the repo root THEN pnpm SHALL resolve all four workspace members (`packages/shared`, `packages/sim`, `apps/server`, `apps/client`) into one lockfile
2. WHEN `pnpm typecheck` runs at the repo root THEN it SHALL run `tsc --noEmit` across all four workspaces and exit 0
3. WHEN `pnpm lint` runs at the repo root THEN Biome SHALL check all workspaces and exit 0
4. WHEN `pnpm test:sim` runs at the repo root THEN vitest SHALL execute the `packages/sim` suite and exit 0
5. WHEN `pnpm test:client` runs at the repo root THEN the headless-Chromium harness SHALL exit 0 (see P1 story 4)
6. WHEN CI runs on a push containing `pnpm-lock.yaml` THEN the `gates` job SHALL re-run gates 1–3 via the same root scripts and exit green
7. The repo SHALL pin Node 24 in CI and declare `engines` with Node ≥22 and pnpm ≥10 in the root `package.json`

**Independent Test**: Clone, `pnpm install`, run the four root scripts — all exit 0; push and watch the CI `gates` job go green.

---

### P1: Shared package — layout, states, tuning ⭐ MVP

**User Story**: As a developer, I want `packages/shared` to hold layout constants,
room states, and the prd §7 tuning table so that there is exactly one source of
truth for numbers the prd owns.

**Why P1**: The sim, server, and client all consume these; duplicating them now
guarantees drift against a locked prd.

**Acceptance Criteria**:

1. `packages/shared` SHALL export floor/room layout constants equal to: 1 grand lobby + 3 guest floors × 8 rooms = 24 rooms (roadmap step 0)
2. `packages/shared` SHALL export the four room states from prd FR-10 (`prepped`, `trashed`, `fresh`, `settled`) as a closed union type
3. `packages/shared` SHALL export the prd §7 tuning table verbatim (every parameter and value, including reserve-dial-order notes) as typed constants
4. IF any tuning or layout literal appears in `packages/sim`, `apps/server`, or `apps/client` outside of an import from `packages/shared` THEN the codebase SHALL be treated as failing review (gate-2 test greps for violations)
5. WHEN the placeholder sim scenario runs THEN it SHALL import its assertions' values from `packages/shared` (proves cross-workspace import resolution)

**Independent Test**: `pnpm test:sim` asserts shared exports against literal values copied from prd §7 / roadmap step 0; grep confirms no duplicated literals.

---

### P1: Server transport shell boots ⭐ MVP

**User Story**: As a developer, I want a bootable Fastify server that serves the
client and accepts Colyseus connections on one port so that Phase 2 game logic has
a proven transport shell.

**Why P1**: The Fastify + `WebSocketTransport` attach is a documented mechanism
with zero public examples; proving it in Phase 1 de-risks Phase 2.

**Acceptance Criteria**:

1. WHEN the server starts THEN it SHALL listen on a single port serving the built client via `@fastify/static` and accepting Colyseus WebSocket connections via `new WebSocketTransport({ server: fastify.server })`
2. WHEN a Colyseus client joins the placeholder room THEN the join SHALL succeed with message-only configuration (`patchRate = null`, no Schema state)
3. WHILE the server runs THEN no room SHALL transmit state via Colyseus schema sync (`patchRate = null` on every room — auditable by grep)
4. WHEN `pnpm dev` runs at the repo root THEN the server SHALL start in watch mode via tsx for development

**Independent Test**: Vitest boots the server on an ephemeral port, connects a Colyseus test client to the placeholder room, and asserts the join succeeds and a static asset is served.

---

### P1: Client shell boots ⭐ MVP

**User Story**: As a developer, I want a Vite + Phaser 4 client that boots a
placeholder scene with a DOM-overlay mount point and a dev-only debug hook so
that Phase 3 rendering and the gate-3 harness have a live surface.

**Why P1**: Gate 3 (`pnpm test:client`) must exercise a real served client from
day one; the hook contract (`window.__TURNOVER__`, dev/harness builds only) is
already fixed by the client-harness skill.

**Acceptance Criteria**:

1. WHEN the client is served and loaded in a browser THEN Phaser 4 SHALL boot and render a placeholder scene
2. WHILE the client runs a dev or harness build THEN `window.__TURNOVER__` SHALL exist on `window`
3. IF the client is built for production THEN `window.__TURNOVER__` SHALL be absent (stripped)
4. The client SHALL include an empty DOM-overlay root element designated for lobby/HUD/toasts (consumed by later phases, rendered above the Phaser canvas)

**Independent Test**: `pnpm test:client` loads the served page in headless Chromium and asserts Phaser booted and `window.__TURNOVER__` exists.

---

### P2: Wire envelope + telemetry schema types

**User Story**: As a developer, I want the per-player event-stream and personal-snapshot
envelope types and the FR-23 JSONL event schema in `packages/shared` so that Phase 2
message authoring starts from the protocol skill's shape, not ad-hoc types.

**Why P2**: Structural types are stable and cheap now; the concrete catalog needs
the Phase 2 sim's event surface and a protocol-skill review.

**Acceptance Criteria**:

1. `packages/shared` SHALL export types for the per-player event stream (past-tense domain events) and personal snapshot envelope, per the `turnover-protocol` skill conventions
2. `packages/shared` SHALL export the FR-23 telemetry event schema types (room transitions with actor+time, elevator calls/rides, walk-in catches, accusations with `wasTargetSaboteur`/`crimeOccurred`, 1/s coverage samples)
3. Every exported message type SHALL carry a one-line comment naming its intended recipients (protocol-skill audit rule)

**Independent Test**: Type-only — `pnpm typecheck` proves the shapes compile; a Phase 2 consumer imports them without modification.

---

## Edge Cases

- IF `pnpm install` runs on Node <22 THEN the engines field SHALL cause pnpm to fail fast rather than booting on an unsupported runtime
- IF the harness runs against a production build THEN the missing `window.__TURNOVER__` SHALL make the boot-check fail loudly (never silently pass an empty page)
- IF a workspace's `tsc --noEmit` fails THEN `pnpm typecheck` SHALL exit non-zero naming the failing workspace (root script fans out, does not mask)

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
|---|---|---|---|
| SKEL-01 | P1: Workspace + gate tooling | Design | Pending |
| SKEL-02 | P1: Workspace + gate tooling | Design | Pending |
| SKEL-03 | P1: Workspace + gate tooling | Design | Pending |
| SKEL-04 | P1: Shared package | Tasks | Implementing |
| SKEL-05 | P1: Shared package | Tasks | Implementing |
| SKEL-06 | P1: Server transport shell | Design | Pending |
| SKEL-07 | P1: Client shell | Design | Pending |
| SKEL-08 | P1: Client shell (prod hook strip) | Design | Pending |
| SKEL-09 | P2: Wire envelope + telemetry schema | - | Pending |

**ID format:** `SKEL-[NUMBER]`

**Coverage:** 9 total, 0 mapped to tasks yet, 9 unmapped (Tasks phase maps them)

---

## Success Criteria

- [ ] All four root gate scripts exit 0 locally and in the CI `gates` job on a fresh clone
- [ ] `packages/shared` contains the prd §7 tuning table and layout constants; grep finds zero duplicated literals in the other three workspaces
- [ ] A Colyseus test client joins the placeholder room over the Fastify-hosted port; the served client passes the headless boot check
- [ ] `window.__TURNOVER__` present in dev/harness build, absent in production build
