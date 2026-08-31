# Turnover — AI agent guide

This repo is a 4–6 player social-deduction game with hidden roles, physical evidence, and a message-only protocol. The design source of truth is [prd.md](prd.md); the build and API plan is [roadmap.md](roadmap.md). Treat both as authoritative unless a task explicitly says otherwise.

## Repo map

- [packages/shared](packages/shared): protocol types, tuning constants, shared layout/state contracts.
- [packages/sim](packages/sim): authoritative game logic, pure TypeScript, deterministic round simulation at 20 Hz.
- [apps/server](apps/server): Node 24 + Colyseus 0.18 room server, message transport, Fastify static hosting.
- [apps/client](apps/client): Phaser 4 world + DOM overlay, Vite app.
- [docs/agents](docs/agents): repo-specific agent and workflow docs.
- [CONTEXT.md](CONTEXT.md): domain vocabulary and project framing.

## Working rules

- Follow the spec-driven workflow: use the `tlc-spec-driven` process for features and keep artifacts under `.specs/`.
- Read `.specs/STATE.md` before resuming work; reconcile it with the current repo state.
- User-facing acceptance criteria must be gate-testable and map to named scenarios like `sim:<name>` or `client:<name>`.
- Prefer the existing references in [roadmap.md](roadmap.md); do not fork public seeds or reimplement architecture from scratch.

## Verification ladder

Every feature should name its gates and run the relevant checks before claiming success:

1. `pnpm typecheck` and `pnpm lint`
2. `pnpm test:sim`
3. `pnpm test:client`
4. Human 5-minute round check for player-facing changes

Do not treat compile output as proof that gameplay or client behavior is correct. Gate 1 is not equivalent to Gate 3.

Gotchas:

- `pnpm test:sim` runs vitest over ALL workspace projects (`packages/*` and `apps/*`), including server transport-shell tests — not just `packages/sim`. Project names/order in `vitest.config.ts` are the CI contract; keep them stable.
- Run one suite with `pnpm vitest run <path-or-pattern>` (e.g. `pnpm vitest run packages/sim/src/movement.test.ts`).
- Gate 3 needs a one-time `pnpm exec playwright install --with-deps chromium` per machine before `pnpm test:client` works. The harness boots the real server + client in headless Chromium with `TURNOVER_TEST_SHIFT_SECONDS=8` so rounds finish in seconds — don't be surprised the in-game clock differs from the 300 s prd shift.
- Lint is Biome (`pnpm lint` = `biome check .`), not ESLint/Prettier. Fix with `pnpm exec biome check --write .`.

## Hard constraints

- Message-only protocol: the server never sends hidden state or anything a player cannot legitimately know. If a task requires transmitting hidden info, stop and treat it as a spec bug.
- Tuning values come from [prd.md](prd.md) section 7 only. Any change needs a recorded decision in `.specs/STATE.md`.
- Hidden information is the product: roles, saboteur identity, grace state, room interiors, and debug surfaces must not leak into client-bound payloads.
- Production builds must not ship browser debug hooks like `window.__TURNOVER__`.
- Keep the change local unless the user explicitly asks for push/deploy/force operations.

## Dev workflow

- `pnpm boot` starts the server (:2567) + Vite client (:5173), waits for both, and kills stale port owners first; override with `PORT`/`CLIENT_PORT`. One Fastify process hosts both static client and the Colyseus endpoint (`noServer` transport + `attachToServer`) — never run a separate server port.

## Project conventions

- Use the domain vocabulary from [CONTEXT.md](CONTEXT.md); avoid drift to synonyms the repo explicitly rejects.
- For protocol changes, review `.opencode/skills/turnover-protocol/SKILL.md` and the message registry in `packages/shared/src/protocol/` first: every server→client message is declared exactly once (payload type + recipient policy); adding a message means adding a registry entry, not a new switch case.
- Prefer small, well-scoped edits over broad refactors. This repo already documents the intended architecture in [roadmap.md](roadmap.md) and [docs/agents/domain.md](docs/agents/domain.md).

## Helpful references

- Repo-local `.opencode/skills/turnover-*`: [turnover-gates](.opencode/skills/turnover-gates/SKILL.md) (gate ladder + evidence), [turnover-protocol](.opencode/skills/turnover-protocol/SKILL.md) (leak rules), [turnover-sim-harness](.opencode/skills/turnover-sim-harness/SKILL.md) (Gate 2 scenario format), [turnover-client-harness](.opencode/skills/turnover-client-harness/SKILL.md) (Gate 3 + `window.__TURNOVER__` hook contract).
- [docs/agents/domain.md](docs/agents/domain.md): how to consume repo domain docs while exploring.
- [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md): issue workflow (`gh` CLI).
- [.specs/STATE.md](.specs/STATE.md): recorded architecture decisions (AD-001+). Read the ADs touching your area before changing room/sim/protocol seams.
- [package.json](package.json): root scripts and toolchain.

When in doubt, follow the repo’s locked product contract rather than intuition: hidden state, message policy, and gate-based verification are the primary guardrails here.
