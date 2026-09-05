# Turnover

**Turnover** is a browser-based social-deduction game for 4–6 friends — *Among Us with the meetings deleted and the evidence made physical.*

It's the night shift at a grand hotel. Staff prepare rooms for a stream of NPC guests while one hidden player — the saboteur — quietly ruins them. Guests who find trash file complaints, and the complaint budget can lose the shift for everyone, saboteur or not. There are no corpses, no vote meetings, no chat logs: the hotel itself leaks traces (door cards, trash freshness, elevator panels, stairwell ambushes), and spoken testimony over Discord turns those traces into accusations. Wrong accusations get you fired. The results screen exposes every lie after the fact.

- 4–6 players, ~5-minute rounds, drop-in via room code — no installs, desktop browser only
- Hidden roles with strictly one-way information: the server never sends anything a player can't legitimately know
- Physical evidence instead of meetings: suitcases, trash provenance, tenancy signs, elevator panels, a camera-free stairwell
- Team settle score against a sabotage loss leg — the 5:00 buzzer decides

## Monorepo layout

| Package | What it is |
|---|---|
| [`packages/shared`](packages/shared) | Protocol types, tuning constants, layout/state contracts shared by both sides |
| [`packages/sim`](packages/sim) | Authoritative game logic — pure TypeScript, deterministic round simulation at 20 Hz |
| [`apps/server`](apps/server) | Node + Colyseus room server: message router, transport, static hosting |
| [`apps/client`](apps/client) | Phaser 4 world + DOM overlay, Vite app |

## Getting started

Prerequisites: **Node ≥ 22** and **pnpm ≥ 10**.

```bash
pnpm install
pnpm boot        # server on :2567 + client on :5173
```

Open [http://localhost:5173](http://localhost:5173) and share the room link. One Fastify process hosts both the static client and the Colyseus endpoint — there is no separate server port.

## Scripts

| Script | What it does |
|---|---|
| `pnpm boot` | Kill stale port owners, boot server + client, wait for both (`PORT` / `CLIENT_PORT` to override) |
| `pnpm dev` | Run all workspace dev tasks in parallel |
| `pnpm build` | Build every workspace package |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm lint` | Biome (`biome check .`) — fix with `pnpm exec biome check --write .` |
| `pnpm test:sim` | Vitest across all workspace projects (sim logic, protocol, server shell) |
| `pnpm test:client` | Playwright end-to-end harness — real server + client in headless Chromium |
| `pnpm fly:launch` / `fly:deploy` / `fly:status` / `fly:logs` | Fly.io operations via `scripts/fly.mjs` |

## Verification

Changes are gated, in order — compile output is not proof that gameplay works:

1. `pnpm typecheck` && `pnpm lint`
2. `pnpm test:sim` — deterministic sim scenarios
3. `pnpm test:client` — full end-to-end rounds (one-time setup: `pnpm exec playwright install --with-deps chromium`; the harness compresses the 5-minute shift to 8 seconds via `TURNOVER_TEST_SHIFT_SECONDS`)
4. A human 5-minute round for anything player-facing

CI runs gates 1–3 on every push and PR (`.github/workflows/ci.yml`).

## Architecture notes

Full details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The short version:

- **Message-only protocol.** Every server→client message is declared exactly once in the registry (`packages/shared/src/protocol/`) with its payload type and recipient policy. The router stamps an envelope (sequence number + server time); a sequence gap forces a clean rejoin. Roles, saboteur identity, and room interiors never cross the wire.
- **Deterministic core.** `@turnover/sim` is pure TypeScript with a seeded RNG — no I/O, no wall clock — so rounds are reproducible and testable headlessly.
- **One seam for interactions.** Range and affordance predicates live in `packages/shared/src/affordances.ts` and are consumed by both the sim's authority guards and the client's prediction mirror — range expressions have exactly one home.
- **Locked tuning.** Game-feel constants live in `packages/shared/src/tuning.ts`; they are deliberate design decisions, not knobs to turn casually.

## Deployment

Single-container deploy on [Fly.io](https://fly.io) (São Paulo, `gru` — see [`fly.toml`](fly.toml), app `turnover-night`): one Fastify process serves the client and the Colyseus endpoint on `$PORT`, with one machine kept warm to avoid cold starts mid-session.

```bash
pnpm fly:launch   # first time
pnpm fly:deploy
```

## Further reading

- [CONTEXT.md](CONTEXT.md) — domain vocabulary and framing: the language the code speaks
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime topology, message pipeline, module seams
- [docs/agents](docs/agents) — repo-specific agent guides
- [docs/art](docs/art) — art direction briefs
