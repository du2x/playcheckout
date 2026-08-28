# Monorepo Skeleton Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/skeleton/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md` (gate ladder), `.opencode/skills/turnover-gates/SKILL.md` (gate commands + evidence format), `.github/workflows/ci.yml` (root script names locked), `.opencode/skills/turnover-client-harness/SKILL.md` (gate-3 format), `.opencode/skills/turnover-protocol/SKILL.md` (message-type audit rule). Greenfield repo — no existing tests; the matrix below is the Phase 1 floor and grows in Phases 2–3.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Shared domain constants (layout, room states, tuning) | unit | 1:1 to spec ACs — every §7 parameter and layout number asserted against prd literals; no-duplicate-literal denylist | `packages/shared/src/**/*.test.ts` | `pnpm test:sim` |
| Shared protocol types (envelope, FR-23 schema) | none | Type-only — `tsc` build gate + recipient-comment audit | `packages/shared/src/protocol/` | build gate |
| Sim (placeholder until Phase 2) | unit | Cross-workspace import resolution proven; scenario asserts shared values | `packages/sim/src/**/*.test.ts` | `pnpm test:sim` |
| Server transport shell | integration | Boot on ephemeral port; Colyseus client joins placeholder room; static asset served; `patchRate = null` on every room | `apps/server/src/**/*.test.ts` | `pnpm test:sim` |
| Client shell | e2e | Boot check: headless Chromium loads served page, asserts Phaser boot + `window.__TURNOVER__`; prod build asserts hook absent | `apps/client/harness/**/*.spec.ts` | `pnpm test:client` |
| Root workspace configs | none | Build gate only (typecheck + lint + all suites exit 0) | repo root manifests | `pnpm typecheck && pnpm lint` |

> `pnpm test:sim` runs the vitest workspace (projects: `packages/shared`, `packages/sim`, `apps/server`) — headless, fast, CI gate 2. `pnpm test:client` runs the Playwright harness — CI gate 3.

## Gate Check Commands

> Generated from `.github/workflows/ci.yml` + turnover-gates skill — script names are the CI contract, stable.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After type/schema-only tasks | `pnpm typecheck && pnpm lint` |
| Full | After tasks with vitest suites | `pnpm typecheck && pnpm lint && pnpm test:sim` |
| Build | After phase completion, client/e2e, or final | `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` |

---

## Execution Plan

### Phase 1: Workspace + shared foundation

```
T1 → T2
T2 → T3
T2 → T4
```

### Phase 2: Transport shells + gates

```
T2 → T5
T5 → T6
T2 → T6
T6 → T7
```

---

## Task Breakdown

### T1: Root workspace scaffolding ✅ (commit: chore(repo))

**What**: Create `pnpm-workspace.yaml`, root `package.json` (engines: node ≥22, pnpm ≥10; scripts: `typecheck`, `lint`, `test:sim`, `test:client`, `dev`, `build`), `biome.json`, `tsconfig.base.json` + root solution `tsconfig.json` with project references.
**Where**: `./ (root manifests)`
**Depends on**: None
**Reuses**: `.github/workflows/ci.yml` script contract
**Requirement**: SKEL-01, SKEL-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `pnpm install` at root resolves with zero workspace members declared-but-missing
- [ ] `pnpm typecheck` and `pnpm lint` exit 0 (empty workspace OK)
- [ ] Root scripts `typecheck`, `lint`, `test:sim`, `test:client` exist with exactly the CI-locked names

**Tests**: none
**Gate**: quick

**Commit**: `chore(repo): scaffold pnpm workspace with locked gate scripts`

---

### T2: packages/shared — domain constants + unit tests ✅ (commit: feat(shared))

**What**: `packages/shared` with `layout.ts` (1 lobby + 3×8 = 24 rooms), `roomState.ts` (closed `RoomState` union), `tuning.ts` (verbatim prd §7), each exported typed; vitest unit tests asserting every value against prd §7 / roadmap step 0 literals.
**Where**: `packages/shared/`
**Depends on**: T1
**Reuses**: prd §7 table; roadmap step 0 layout
**Requirement**: SKEL-04, SKEL-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] All constants from design Data Models exported and typed
- [ ] Unit tests assert every tuning value against prd §7 literals
- [ ] Test count: ≥3 tests pass (no silent deletions)
- [ ] Gate check passes: full

**Tests**: unit
**Gate**: full

**Commit**: `feat(shared): layout, room states, and prd §7 tuning table`

---

### T3: packages/shared — protocol envelope + FR-23 telemetry types ✅ (commit: feat(shared))

**What**: `protocol/` module exporting per-player event-stream + personal-snapshot envelope types, client→server intent base, and the FR-23 telemetry event schema; every exported message type carries a one-line intended-recipient comment.
**Where**: `packages/shared/src/protocol/`
**Depends on**: T2
**Reuses**: `turnover-protocol` skill conventions
**Requirement**: SKEL-09

**Tools**:

- MCP: NONE
- Skill: `turnover-protocol` (read before authoring message types)

**Done when**:

- [ ] Envelope + telemetry types compile per design Data Models
- [ ] Every exported message type has an intended-recipient comment (audit-rule)
- [ ] Gate check passes: quick

**Tests**: none
**Gate**: quick

**Commit**: `feat(shared): protocol envelope and FR-23 telemetry schema types`

---

### T4: packages/sim placeholder + vitest workspace wiring ✅ (commit: feat(sim))

**What**: `packages/sim` with one placeholder vitest scenario importing shared constants (cross-workspace resolution proof) plus the no-duplicate-literal denylist test; root `vitest.workspace.ts` covering `packages/shared`, `packages/sim`, `apps/server`; root `test:sim` script wired.
**Where**: `packages/sim/`
**Depends on**: T2
**Reuses**: design Risks & Concerns denylist (300, 75, 6, 0.8…)
**Requirement**: SKEL-04, SKEL-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Placeholder scenario passes importing `@turnover/shared`
- [ ] Denylist test fails if a tuning literal is duplicated outside `packages/shared/src`
- [ ] Test count: ≥2 tests pass
- [ ] Gate check passes: full

**Tests**: unit
**Gate**: full

**Commit**: `feat(sim): placeholder scenario and vitest workspace wiring`

---

### T5: apps/server — Fastify + Colyseus transport shell

**What**: Fastify bootstrap hosting Colyseus via `new WebSocketTransport({ server: fastify.server })`, `@fastify/static` serving client dist, `PlaceholderRoom` with `patchRate = null`; integration test boots on ephemeral port via `@colyseus/testing`, joins the room, fetches a static asset. Transport import shape verified against installed 0.18 package types — never assumed.
**Where**: `apps/server/`
**Depends on**: T2
**Reuses**: AD-001 (`.specs/STATE.md`); roadmap "Key API facts"
**Requirement**: SKEL-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Server boots: static + WS on one port (AD-001 attach)
- [ ] Colyseus test client joins PlaceholderRoom; no Schema state
- [ ] Integration test asserts join + static asset (ephemeral port)
- [ ] Test count: ≥2 tests pass
- [ ] Gate check passes: full

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): fastify-hosted colyseus transport shell`

---

### T6: apps/client — Phaser 4 shell + gate-3 boot-check harness

**What**: Vite + Phaser 4 client booting a placeholder scene with DOM-overlay root; `window.__TURNOVER__` injected only in dev/harness builds; Playwright harness (`apps/client/harness/`) booting the real server + served client in headless Chromium and asserting Phaser boot + hook; root `test:client` script wired.
**Where**: `apps/client/`
**Depends on**: T5 (harness needs the real server to boot), T2
**Reuses**: `turnover-client-harness` skill hook contract; T5's server boot helper
**Requirement**: SKEL-07, SKEL-08 (dev-side)

**Tools**:

- MCP: NONE
- Skill: `turnover-client-harness`

**Done when**:

- [ ] Phaser 4 boots placeholder scene; DOM overlay root present
- [ ] `window.__TURNOVER__` exists in dev/harness mode
- [ ] Boot-check harness exits 0 in headless Chromium
- [ ] Test count: ≥1 e2e test passes
- [ ] Gate check passes: build

**Tests**: e2e
**Gate**: build

**Commit**: `feat(client): phaser shell with dev-only turnover hook and boot-check harness`

---

### T7: Build pipeline + prod hook strip + full ladder

**What**: Root `build` script (client `vite build`; server stays tsx-run per design); verification that the production bundle omits `window.__TURNOVER__` (SKEL-08) by grepping the built dist; full gate ladder green end-to-end.
**Where**: `./ (root package.json build script)` + `apps/client/harness/` strip check
**Depends on**: T6
**Reuses**: T6 harness conventions
**Requirement**: SKEL-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `pnpm build` produces `apps/client/dist`
- [ ] Strip check proves `__TURNOVER__` absent from prod bundle
- [ ] All four gate commands exit 0 in sequence
- [ ] Test count: no test deletions vs T6

**Tests**: e2e
**Gate**: build

**Commit**: `feat(client): prod build with stripped debug hook`

---

## Phase Execution Map

```
Phase 1 → Phase 2

Phase 1:  T1 ------→ T2 ------→ T3
                      │
                      └--------→ T4
Phase 2:  T2 ------→ T5 ------→ T6 ------→ T7
                      └--------------------↗ (T2 → T6)
```

Execution is strictly sequential — one task at a time, in order. Total: 7 tasks → single batch → executed inline, no sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
|---|---|---|
| T1: Root manifests | config set, one cohesive deliverable | ✅ Granular |
| T2: Shared domain module | 1 package, 3 sibling constant files + tests | ✅ Granular |
| T3: Shared protocol types | type-only module | ✅ Granular |
| T4: Sim placeholder + vitest wiring | 1 package + 1 root config | ✅ Granular |
| T5: Server transport shell | 1 app, bootstrap + room + test | ✅ Granular |
| T6: Client shell + harness | 1 app + its e2e runner (cohesive client-side deliverable) | ✅ Granular |
| T7: Build + strip verification | 1 script + 1 check | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
|---|---|---|---|
| T1 | None | — | ✅ Match |
| T2 | T1 | T2 ← T1 | ✅ Match |
| T3 | T2 | T3 ← T2 | ✅ Match |
| T4 | T2 | T4 ← T2 | ✅ Match |
| T5 | T2 | T5 ← T2 | ✅ Match |
| T6 | T5, T2 | T6 ← T5, T6 ← T2 | ✅ Match |
| T7 | T6 | T7 ← T6 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
|---|---|---|---|---|
| T1 | Root config | none — build gate | none | ✅ OK |
| T2 | Shared domain constants | unit | unit | ✅ OK |
| T3 | Shared protocol schema | none — type-only | none | ✅ OK |
| T4 | Sim + vitest wiring | unit | unit | ✅ OK |
| T5 | Server transport shell | integration | integration | ✅ OK |
| T6 | Client shell | e2e | e2e | ✅ OK |
| T7 | Build pipeline + strip | e2e (harness check) | e2e | ✅ OK |