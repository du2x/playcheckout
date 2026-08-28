# Turnover — Agent Guide

Social-deduction browser game: 4–6 players, hidden saboteur, physical evidence.
Design truth: `prd.md` (v1.2, decisions locked). Build order + verified API facts:
`roadmap.md` (incl. "References — mined, not forked").

## Stack (locked — do not swap)

pnpm workspaces: `packages/sim` (pure TS round sim, no I/O, 20 Hz tick) ·
`packages/shared` (message protocol types + tuning) · `apps/server` (Node 24,
Colyseus 0.18 message-only, Fastify static hosting) · `apps/client` (Phaser 4 +
DOM overlay, Vite). References to mine, never fork: see roadmap.md.

## Workflow

Every feature runs through the `tlc-spec-driven` skill (Specify → Design → Tasks →
Execute, EARS acceptance criteria, atomic conventional commits). Artifacts live in
`.specs/`. Resuming work = read `.specs/STATE.md` first, reconcile against git.

- Spec acceptance criteria must be gate-testable: every user-facing AC maps to a
  named gate scenario (`sim:<name>` or `client:<name>`) — see the `turnover-gates`
  skill.
- Feature >~8 tasks → tlc offers batch workers; workers run as the `implementer`
  agent.
- After the last task, tlc dispatches the `verifier` agent automatically
  (author ≠ verifier, evidence-or-zero, discrimination sensor).
- Research questions → the `explorer` agent.

## Gate ladder (mandatory; every task names its gates)

1. `pnpm typecheck` + `pnpm lint` — tsc --noEmit + Biome
2. `pnpm test:sim` — vitest bot scenarios against `packages/sim`
3. `pnpm test:client` — headless-Chromium harness: real server + client, asserts
   via `window.__TURNOVER__` (see `turnover-client-harness` skill)
4. Human 5-minute round — player-facing changes only

Compile ≠ runs: Gate 1 proves nothing about Gate 3. A gate passes only when its
runner exits zero — never self-assessed. CI (`.github/workflows/ci.yml`) re-runs
gates 1–3 on every push via the same root scripts; keep script names stable.

## Hard rules

- **Message-only protocol.** The server never transmits full state, and never
  sends anything a player cannot legitimately know. See the `turnover-protocol`
  skill before creating or changing any message type. If a task seems to require
  sending hidden state, STOP — that is a spec bug.
- **Tuning values** come from prd §7 only. Changing one is a recorded decision
  in `.specs/STATE.md` (AD-NNN), never an incidental edit.
- **Hidden information is the product.** Roles, saboteur identity, grace state,
  room interiors — absent from every client-bound payload and every debug
  surface. Production builds ship no `window.__TURNOVER__`.
- **Blast radius:** local commits only unless the user explicitly approves
  push/deploy/force operations.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
