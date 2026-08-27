# Roadmap — Turnover

Companion to `prd.md` v1.2 (all decisions locked). Stack per prd §11: TypeScript,
Phaser 4 client, Node 24 + Colyseus 0.18 (message-only), pure sim package,
Railway single-container deploy.

---

## Step 0 — Travel-budget math ✅ (done, verdict recorded in prd §8)

Assumptions: 24 rooms (3 floors × 8), speed 6 tiles/s, halls ~30 tiles, rooms ~4 tiles,
prep 5s / un-prep 3s, elevator arrive 3s + ride 2s/floor + cap 2.

- Full floor sweep (8 rooms) ≈ 55s; full-building card-verify pass ≈ 55s per staff with
  floors split.
- Staff re-prep throughput ≈ 9.5 rooms/min/person vs. saboteur re-trash ≈ 7/min.
- Conclusion: at 5–6 players staff outproduce the saboteur; his win lever is a **last-60s
  trash blitz** (6–7 rooms spread across floors, outrunning detection) plus attrition at
  low counts. Coverage wins expected at high counts, catch/accusation wins at low counts.
- No dial changes required before gray-box. Revisit this sheet if §8 metrics miss.

## Phase 1 — Monorepo skeleton + shared types

- pnpm workspaces: `packages/shared`, `packages/sim`, `apps/server`, `apps/client`.
- `packages/shared`: room/floor layout constants, room states, message protocol types
  (per-player event stream + personal snapshots — the FR-23 event schema lives here),
  tuning table imported verbatim from prd §7.
- Tooling: Vite (client, Phaser 4), tsx dev / tsup build (server), vitest, Biome,
  Node 24 LTS.
- Single container: Fastify + @fastify/static serving client dist + Colyseus WS on one port.

## Phase 2 — Authoritative server sim (headless-first)

Build the full round as a headless state machine in `packages/sim` — pure TypeScript,
inputs + time in / events out, 20 Hz tick — before any rendering, testable via scripted
bot inputs in vitest. Colyseus stays a thin transport shell; nothing visibility-sensitive
ever uses Colyseus state sync (message-only protocol):

1. Lobby: create/join by code, host start at ≥4, role deal (FR-1, FR-2).
2. Movement: linear left/right, pass-through bodies, 6 tiles/s (FR-4).
3. Elevators: deterministic cycle, 2s/floor, one pending destination per car, position-only
   panels (FR-5, FR-6).
4. Work channels: prep 5s from any non-prepped state, un-prep 3s, fake prep = animation
   only, clean cancel on walk-out (FR-7–FR-9, FR-16).
5. Evidence: door cards (permanent, hallway-readable, no timestamp), freshness tiers,
   rustle 3 tiles through walls, door-open visible+audible from hallway (FR-10–FR-13).
6. Justice: walk-in conviction, hidden grace, name-only firing toasts, accusation range
   2 tiles same floor (FR-14–FR-19).
7. Win checks + results + recap timeline (FR-20–FR-22), disconnect/abort handling and
   60s reconnection with role restore (FR-25).
8. JSONL telemetry with 1/s coverage sampling (FR-23).

Exit criteria: two bot-driven sims — (a) 5 staff bots vs. AFK saboteur reaches ≥80% before
buzzer; (b) scripted saboteur with last-60s blitz defeats spread bots at plausible rates.

## Phase 3 — Gray-box client

- Rectangles + floor labels; no art, no audio polish (non-goal).
- DOM overlay for lobby / HUD / firing toasts / results / recap; Phaser 4 renders only
  the game world.
- Local playback of server events; door-open/rustle as simple cues; HUD = coverage % +
  timer only (FR-14); spectator overview camera incl. interiors (FR-20).
- Results screen: winner banner, traitor reveal, recap timeline with validity flags.

## Phase 4 — Playtest harness

- KPI computation from JSONL (FR-24) + a tiny viewer script.
- 10 recorded sessions (5–6 players, Discord voice, rotating groups) against the §8 table.
- Railway deploy (auto from git) live before the first remote playtest.

## Phase 5 — Evaluate & tune

- Spend dials in prd §7 reserve order only, one at a time, retest each.
- Onboarding check: time-to-first-correct-deduction tracked before any tutorial UI.

---

## References — mined, not forked (researched 2026-08-27)

No seed is adopted as scaffold: all public Phaser+Colyseus seeds are Schema-state-based
(our message-only protocol forbids it) and mostly Phaser 3. These three are reading
references:

| Repo | Mine it for |
|---|---|
| [colyseus/tutorial-phaser](https://github.com/colyseus/tutorial-phaser) (official, 0.17) + [tutorial](https://docs.colyseus.io/tutorial/phaser) | Parts 2–4: linear interpolation, client-predicted input, fixed tickrate — our 20 Hz + walk-in-timing problem, pre-solved |
| [ts-online-game-template](https://github.com/ASteinheiser/ts-online-game-template) (pnpm monorepo, active) | Shared game-logic package shape (= our `packages/sim`), `@colyseus/loadtest` setup, CI plumbing; strip Prisma/GraphQL/Supabase/Electron |
| [pokemonAutoChess](https://github.com/keldaanCommunity/pokemonAutoChess) (Phaser 4.2.1 + Colyseus, shipping game) | Phaser 4 / Beam-renderer API patterns at production scale; reference only (license ambiguity), never copy code |

### Key API facts (verified against 0.18 docs)

- Message-only is first-class: `state` is opt-in, `patchRate = null` disables sync,
  RelayRoom ships with no authoritative state; `messages = {...}` map + `send`/`broadcast`;
  raw `sendBytes`/`broadcastBytes` if we outgrow MsgPack. New in 0.18: request/response
  handlers + zod `validate()` for input validation (home for accuse/move/prep intents).
- Fastify attach: `new WebSocketTransport({ server: fastify.server })` — documented
  mechanism, zero official example. Phase 2 includes a smoke test; we'd be the only
  public reference.
- Reconnection maps 1:1 to FR-25: `onDrop → allowReconnection(client, 60) → onReconnect`;
  client auto-retry + persist `reconnectionToken` after join and each reconnect.
- Node 24 fine (`engines >= 22`); use default `ws` transport, skip uWebSockets (ABI risk).
- `@colyseus/testing` (official): `boot() → createRoom → connectTo` simulated clients +
  `waitForNextTimestep()` — for transport-shell tests; the pure sim stays direct-vitest.
- Phaser 4 tsconfig: `moduleResolution: "bundler"` per official `phaserjs/template-vite-ts`;
  current phaser is 4.2.1.
