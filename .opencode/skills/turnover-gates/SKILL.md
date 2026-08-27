---
name: turnover-gates
description: Run Turnover's 4-gate verification ladder and format evidence for the Verifier. Use when executing, testing, or verifying any task in this repo — gate commands, AC-to-scenario mapping, CI contract.
---

# Turnover gate ladder

Every task names its gates in `tasks.md`; every user-facing AC maps to a named gate
scenario. A gate passes only when its runner exits zero — never by self-assessment.

| Gate | Command | Proves |
|---|---|---|
| 1 | `pnpm typecheck` then `pnpm lint` | compiles + lint-clean (tsc --noEmit, Biome) |
| 2 | `pnpm test:sim` | the sim behaves (vitest bot scenarios on `packages/sim`) |
| 3 | `pnpm test:client` | the game runs (headless Chromium, real server + client, asserts via `window.__TURNOVER__`) |
| 4 | human | it's playable — player-facing changes only |

Compile ≠ runs. Gate 1 proves nothing about Gate 3: a mistyped message type, a scene
left out of registration, or a handler that throws in `create()` all type-check and
ship a black screen. Never substitute Gate 1 evidence for Gate 3.

Evidence format (Verifier + commit messages): `<gate>: <command> → exit 0 (N tests)`,
plus per-AC `file:line` citations of the asserting test.

AC→scenario rule: during tlc's Tasks phase, each user-facing AC gets a scenario name —
`sim:<name>` (format: `turnover-sim-harness` skill) or `client:<name>` (format:
`turnover-client-harness` skill) — recorded in `tasks.md`. The Verifier fails any AC
without one.

CI (`.github/workflows/ci.yml`) re-runs gates 1–3 on every push using the same root
`package.json` scripts. Keep script names stable; the workflow is the contract.
