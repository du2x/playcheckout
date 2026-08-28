# Skeleton Validation

**Date**: 2026-08-27
**Spec**: `.specs/features/skeleton/spec.md`
**Diff range**: 9d593b8..8eabc44 (7 commits; 9d593b8 = scaffold)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1: Root workspace scaffolding | ✅ Done | commit 9d593b8; scripts exist with CI-locked names (`package.json:10-15`) |
| T2: Shared domain constants + tests | ✅ Done | commit cf06543; 11 unit tests (layout 3, tuning 6, roomState 2) |
| T3: Protocol envelope + FR-23 types | ✅ Done | commit aba6d28; type-only, recipient comments present |
| T4: Sim placeholder + vitest wiring | ✅ Done | commit 04add6a; cross-workspace import + denylist test |
| T5: Server transport shell | ✅ Done | commit d4ff7af; 2 integration tests, ephemeral port |
| T6: Client shell + gate-3 harness | ✅ Done | commit b93d887; 1 Playwright boot-check test |
| T7: Build pipeline + prod strip | ✅ Done | commit 8eabc44; strip check wired into harness webServer chain |

All tasks marked done in `tasks.md`; no blocked or partial work.

---

## Spec-Anchored Acceptance Criteria

### SKEL-01..03 — P1: Workspace + gate tooling

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| AC1: `pnpm install` resolves four members into one lockfile | 4 workspace importers, one lockfile | config-verified: `pnpm-lock.yaml:7` (`importers:`) + `:33,:46,:68,:74` (apps/client, apps/server, packages/shared, packages/sim) | ✅ PASS (config) |
| AC2: `pnpm typecheck` runs tsc --noEmit across all four, exit 0 | exit 0 | root `package.json:10` (`pnpm -r typecheck`); each workspace owns `tsc --noEmit` (e.g. `apps/server/package.json:7`); run observed exit 0 with all 4 workspaces named | ✅ PASS (gate run + config) |
| AC3: `pnpm lint` Biome checks all workspaces, exit 0 | exit 0 | root `package.json:11` (`biome check .`); run observed exit 0, 38 files | ✅ PASS (gate run) |
| AC4: `pnpm test:sim` executes vitest suite, exit 0 | exit 0 | root `package.json:12` (`vitest run`) over `vitest.config.ts:8` projects; run observed 16/16 | ✅ PASS (gate run) |
| AC5: `pnpm test:client` headless harness exits 0 | exit 0 | root `package.json:13` → `harness/playwright.config.ts:13-22` (real server + served client); run observed 1/1 | ✅ PASS (gate run) |
| AC6: CI `gates` job re-runs gates 1–3 via same root scripts | same script names | config-verified: `.github/workflows/ci.yml:30-40` (`pnpm typecheck`, `pnpm lint`, `pnpm test:sim`, `pnpm test:client`), lockfile gate `ci.yml:11` | ✅ PASS (config; actual CI push not verifiable locally) |
| AC7: Node 24 pinned in CI; engines Node ≥22, pnpm ≥10 | exact pins | config-verified: `ci.yml:22` (`node-version: 24`), `package.json:5-8` (`"node": ">=22"`, `"pnpm": ">=10"`) | ✅ PASS (config) |

### SKEL-04/05 — P1: Shared package (layout, states, tuning)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| AC1: layout constants = 1 lobby + 3×8 = 24 rooms | FLOORS=3, ROOMS_PER_FLOOR=8, ROOM_COUNT=24 | `packages/shared/src/layout.test.ts:14-16` — `expect(FLOORS).toBe(3)` / `expect(ROOMS_PER_FLOOR).toBe(8)` / `expect(ROOM_COUNT).toBe(24)`; IDs `:20` | ✅ PASS |
| AC2: four room states as closed union | prepped/trashed/fresh/settled | `packages/shared/src/roomState.test.ts:7` — `expect(ROOM_STATES).toEqual(['prepped','trashed','fresh','settled'])`; union coverage `:11-12` | ✅ PASS |
| AC3: prd §7 tuning verbatim incl. reserve notes | every §7 row | `packages/shared/src/tuning.test.ts:7-9,13-15,19-21,25-26,30-32,36` — all 14 values asserted against prd literals (re-checked verbatim against `prd.md:155-168`); reserve notes in `tuning.ts:13,17` | ✅ PASS |
| AC4: no tuning/layout literal outside shared (gate-2 grep) | denylist violations = [] | `packages/sim/src/literals.test.ts:38` — `expect(violations).toEqual([])` over SCAN_ROOTS `:12-16` | ✅ PASS |
| AC5: placeholder sim imports its values from shared | values from @turnover/shared | `packages/sim/src/sim.test.ts:9-10` — `expect(ROOM_COUNT).toBe(24)` / `expect(TUNING.SHIFT_SECONDS).toBe(300)` (import at `:1`) | ✅ PASS |

### SKEL-06 — P1: Server transport shell

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| AC1: one port serves static + Colyseus WS | static 200 + join on same port | `apps/server/src/index.test.ts:41-43` (`res.status).toBe(200)` + body) and `:45-47` (`joinOrCreate` on `ws://…:${port}`); AD-001 attach `index.ts:42-44` | ✅ PASS |
| AC2: join succeeds message-only (patchRate null, no Schema) | patchRate null | `apps/server/src/index.test.ts:56` — `expect(instance?.patchRate).toBeNull()`; join success `:53,55` | ✅ PASS |
| AC3: no room transmits schema sync (every room patchRate null) | null on every room | `apps/server/src/index.test.ts:56` covers the only room defined (`index.ts:47`); source `PlaceholderRoom.ts:13` — grep-auditable | ✅ PASS (by construction: 1 room exists) |
| AC4: `pnpm dev` starts server in watch mode via tsx | tsx watch | config-verified: `apps/server/package.json:8` (`tsx watch src/index.ts`) fanned out by root `package.json:14` (`pnpm -r --parallel dev`) | ✅ PASS (config) |

### SKEL-07/08 — P1: Client shell

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| AC1: Phaser 4 boots, renders placeholder scene | canvas + Boot scene live | `apps/client/harness/boot.spec.ts:39` (`canvasVisible`) + `:38` (`sceneBooted` via `t.scene('Boot')`) | ✅ PASS |
| AC2: `window.__TURNOVER__` exists in dev/harness build | hook present w/ contract shape | `boot.spec.ts:35-37` (`exists`, `hasEvents`, `hasLocal`); gate-3 side: `check-prod-strip.mjs --expect-present` in `playwright.config.ts:17` | ✅ PASS |
| AC3: prod build strips hook | absent from prod bundle | strip check executed as gate-3 precondition: `playwright.config.ts:17` (`--expect-absent`) + enforcement `check-prod-strip.mjs:18-21` (exit 1 on leak); prod source gate `apps/client/src/debug.ts:9` | ✅ PASS (gate-integrated check, not a browser assertion) |
| AC4: empty DOM-overlay root element | `#overlay` present | `boot.spec.ts:31,40` — `overlayPresent` from `document.querySelector('#overlay')` | ✅ PASS |

### SKEL-09 — P2: Wire envelope + telemetry schema

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| AC1: per-player event stream + personal snapshot envelope types per protocol skill | envelope types exist | type-only (spec: "Independent Test: Type-only — tsc proves shapes compile"); `packages/shared/src/protocol/envelope.ts:8,14,23,29` (`PersonalSnapshot`, `GameEventEnvelope`, `BroadcastEventEnvelope`, `PlayerIntent`); compiled by gate 1 | ✅ PASS (type-level, per spec's own test definition) |
| AC2: FR-23 telemetry schema types (transitions, elevator, catches, accusations w/ flags, 1/s coverage) | kind union + flags | `packages/shared/src/protocol/telemetry.ts:8-14` (6 kinds incl. `accusation`, `coverage-sample`), `:29-31` (`wasTargetSaboteur`, `crimeOccurred`), `:33` (`coverage`) | ✅ PASS (type-level) |
| AC3: every exported message type carries recipient comment | one-line comment per type | `envelope.ts:7,13,22,28` and `telemetry.ts:7` — each type's comment names recipients (Server → one player / all players / Client → server / never client-bound) | ✅ PASS (config/source audit) |

**Status**: ✅ All ACs covered — 21/21 criteria verified (7 of them config-only per spec's own test definitions). No spec-precision gaps found; the two type-only criteria are verified exactly the way the spec defines their test.

---

## Discrimination Sensor

File-copy fallback (node_modules not in a worktree): each target copied to `/tmp/opencode/`, mutated in place, tests run, restored byte-identical (`diff` confirmed), porcelain re-checked empty after each mutation.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| M1 | `packages/shared/src/layout.ts:1` | `FLOORS = 3` → `4` (ROOM_COUNT derives to 32) | ✅ Killed — 2 failed (layout shape test + sim cross-workspace test), 14 passed |
| M2 | `packages/sim/src/literals.test.ts:10` | `DENYLIST` → `[]` + planted `packages/sim/src/sensor-tmp.ts` containing `const x = 75` | ⚠️ Expected-behavior confirmation — 16/16 passed with violation present, i.e. detection disabled. Recorded per brief: the denylist test is the sole guard for SKEL-04 AC4; weakening it disables detection (no redundant guard exists). Restored; re-run green 16/16. |
| M3 | `apps/server/src/rooms/PlaceholderRoom.ts:13` | `patchRate = null` → `1000` | ✅ Killed — 1 failed (`index.test.ts:56` toBeNull assertion), 15 passed |

**Sensor depth**: lightweight (3 targeted mutations, per tasks/design risk)
**Result**: 2/2 behavior mutants killed; M2 confirmed-by-design as the single-guard case → PASS ✅

**Isolation**: baseline `git status --porcelain` = empty; after all mutations and restores = empty; `git diff` = empty; all three backups byte-identical on restore. No `git stash` used.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — server bootstrap 59 lines, room 20 lines, client boot 16 lines; no abstraction for single-use code |
| Surgical changes | ✅ — diff is additive feature work; only `biome.json`/`tsconfig.base.json`/root `package.json` touched as scaffold |
| No scope creep | ✅ — no message catalog, no game rules, no harness scenario format (all correctly deferred to Phase 2/3 per spec Out of Scope) |
| Matches patterns | ✅ — consistent with AGENTS.md gate ladder and locked script names |
| Spec-anchored outcome check | ✅ — asserted values match prd §7 / FR-10 / AD-001 literals (tuning re-verified against `prd.md:155-168`) |
| Per-layer coverage expectation | ✅ — shared 1:1 to ACs; server integration covers static+join+config; client e2e covers boot + hook contract |
| Every test maps to a spec anchor | ✅ — all 17 tests cite SKEL anchors in comments (e.g. `sim.test.ts:5`, `index.test.ts:37`, `boot.spec.ts:3`) or map to tasks.md matrix rows; denylist test maps to SKEL-04 AC4 |
| Documented guidelines followed | ✅ — `AGENTS.md`, `turnover-gates`, `turnover-protocol` (patchRate null, recipient comments), `turnover-client-harness` (hook contract shape) |

One test-integrity note: `PlaceholderRoom.instances` static array is a test hook in production code (`PlaceholderRoom.ts:10`). Justified — Colyseus offers no simpler way to assert room config from the outside; `afterAll` clears it (`index.test.ts:31`).

---

## Edge Cases

- [x] Node <22 install fails fast via `engines` (`package.json:5-8`) — config-verified; no test simulates a failing install (spec's own test for this is the engines field itself)
- [x] Harness against prod build fails loudly — `boot.spec.ts:35-38` asserts hook exists (absent hook ⇒ hard failure); `--expect-present` strip check (`playwright.config.ts:17`) catches a wrong-mode harness bundle before the server even boots
- [x] Workspace typecheck failure propagates non-zero without masking — `pnpm -r typecheck` (`package.json:10`) names each workspace (observed in gate run output); pnpm -r exits non-zero on first failing workspace

---

## Gate Check

- **Gate command**: `pnpm typecheck && pnpm lint && pnpm test:sim && pnpm test:client` (Build level, from tasks.md Gate Check Commands)
- **Result**: 4/4 gates exit 0
  - `pnpm typecheck` → exit 0 (4/4 workspaces)
  - `pnpm lint` → exit 0 (38 files checked, no fixes applied)
  - `pnpm test:sim` → exit 0 (**16/16 tests**, 6 files: layout 3, tuning 6, roomState 2, sim 2, literals 1, server 2)
  - `pnpm test:client` → exit 0 (**1/1 test**, 4.6s; includes both prod-strip and harness-strip checks)
- **Test count before feature**: 0 (greenfield)
- **Test count after feature**: 17 (16 vitest + 1 Playwright) — matches the expected 16 + 1
- **Delta**: +17
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

None required.

---

## Requirement Traceability Update

Recommended status transitions for `spec.md` (left untouched: verifier ran read-only on the real tree; only this report was written):

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| SKEL-01..03 | Design/Pending | ✅ Verified (config + gate evidence) |
| SKEL-04, SKEL-05 | Implementing | ✅ Verified |
| SKEL-06 | Design/Pending | ✅ Verified |
| SKEL-07, SKEL-08 | Design/Pending | ✅ Verified |
| SKEL-09 | Implementing | ✅ Verified |

tasks.md: all 7 tasks marked ✅ with commits — consistent with `git log`. Spec "Coverage: 9 total, 0 mapped" header is stale relative to the tasks.md requirement mappings (T1→SKEL-01/03 … T7→SKEL-08); cosmetic doc drift only.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 21/21 ACs matched spec outcome | 0 spec-precision gaps
**Sensor**: 3 mutations injected, 2 behavior mutants killed, 1 by-design confirmation (denylist is the sole guard, per brief)
**Gate**: 4/4 passed — 16 vitest + 1 Playwright, 0 failures

**What works**: workspace + locked gate scripts; shared layout/room-state/tuning as verified single source of truth; Fastify+Colyseus single-port transport (AD-001) with message-only placeholder room; Phaser 4 client with dev-only `__TURNOVER__` hook, DOM overlay root, prod strip; full gate ladder green.

**Issues found**: none blocking. Two non-blocking notes: (1) M2 sensor run demonstrates the denylist test is the only guard against literal duplication — acceptable per spec design, but any future bypass of `*.test.ts` exclusions would be silent; (2) spec.md traceability "0 mapped to tasks yet" header is stale.

**Next steps**: None. Feature validated.
