# Turnover — Architecture

How Turnover is built: the runtime topology, the message pipeline that enforces the
hidden-information contract, the module seams, and the recipes for extending each
layer. For domain vocabulary see [CONTEXT.md](../CONTEXT.md); for workflows and
commands see the [README](../README.md).

The one-sentence version: a pure, deterministic 20 Hz simulation runs server-side;
every fact it produces is filtered through a per-message recipient policy before it
reaches a browser, and the client is a pure reducer over exactly those filtered
messages — so hidden information stays hidden by construction, not by discipline.

## System overview

```
Browser (one per player)                          Node process (single container)
┌─────────────────────────────┐                   ┌──────────────────────────────────────┐
│  Phaser 4 world scene       │                   │  Fastify (one port)                  │
│   WorldScene + presenters   │                   │   ├─ @fastify/static → client dist   │
│  DOM overlay (join/lobby/   │    WebSocket      │   └─ Colyseus (noServer, attached)   │
│   HUD/results views)        │ ◄───────────────► │       └─ TurnoverRoom                │
│  Connection (net/)          │  Envelope         │           ├─ MovementSim — 20 Hz,    │
│   envelope check + MAPPERS  │   {seq,time,      │   │       │   both phases            │
│  state.ts reducer (pure)    │    payload}       │   │    ├─ RoundSim — 20 Hz, round    │
│  sessions (rider / accuse / │                   │   │    │   phase only, events out   │
│   evidence)                 │  intents ▲        │   │    └─ Router ── stamps envelope, │
│  window.__TURNOVER__ (dev   │  (zod on server)  │   │        applies recipient policy  │
│   only — stripped in prod)  │                   │       └─ TelemetrySink → JSONL file   │
└─────────────────────────────┘                   │         (data/telemetry/, never      │
                                                  │          on the wire)                │
                                                  └──────────────────────────────────────┘
```

## Monorepo and dependency direction

| Package | Depends on | Responsibility |
|---|---|---|
| `packages/shared` | — | Protocol registry, tuning constants, building layout, room-state contracts, affordance predicates |
| `packages/sim` | shared | Authoritative round logic — pure TypeScript, deterministic, no I/O, no clocks |
| `apps/server` | shared, sim | Colyseus room (lobby, intents, tick loop), Router, telemetry writer, static hosting |
| `apps/client` | shared | Phaser 4 world, DOM overlay, connection + envelope handling, view reducer |

Nothing imports across the two apps; everything they share lives in `shared`.
The server is the only importer of `sim` — the client never runs game logic, it
mirrors server messages (plus local prediction built from shared predicates).

## Runtime topology

- **One process, one port.** Fastify hosts the static client build and the Colyseus
  endpoint (`noServer` transport + `attach`) on `$PORT` (2567 in prod). There is no
  second server port, ever (AD-001 single-process deploy).
- **Colyseus is a thin transport shell.** The room runs with no Schema state sync
  (`patchRate` null) — all gameplay travels as routed messages. Nothing
  visibility-sensitive ever rides Colyseus state serialization.
- **Room lifecycle.** `TurnoverRoom` (room type `turnover`): join by 4-letter code
  drawn from a 24-letter read-aloud alphabet; phases `lobby → round → results`.
  A phase-free `MovementSim` ticks in every phase, so player positions persist
  across lobby→round→lobby (AD-015). Mid-round drops hold a 60 s reconnection
  seat with exact role restore; expiry ghosts staff and aborts the round for a
  saboteur (FR-25).
- **Test seams are production-locked.** `TURNOVER_TEST_SHIFT_SECONDS` and
  `TURNOVER_TEST_GUEST_SCALE` shrink the shift / scale guest timing so the
  end-to-end harness can finish rounds in seconds — both are ignored when
  `NODE_ENV=production`, which is pinned in `fly.toml`.

## The authoritative loop

`packages/sim` is the whole game. `RoundSim` is a headless state machine:
inputs and tick count in, `SimEvent[]` out — no I/O, no wall clock, no
`Math.random` (seeded `Rng` streams only; guest timing and the cosmetic-seed
stream are deliberately decorrelated draws). The room drives one `tick()` per
50 ms (`TICK_HZ = 20`); determinism lives in tick counts, never in wall time.

Subsystems under `RoundSim` (each a module in `packages/sim/src`):

| Module | Owns |
|---|---|
| `deal.ts` | Role assignment (staff / saboteur split) |
| `work.ts` | Work channels: prep 5 s / un-prep 3 s / fake prep, cancel-on-leave |
| `justice.ts` | Walk-in conviction, hidden grace, accusations, firing |
| `guests.ts` | GuestSim: arrival cadence, impatience, dining, settle/checkout churn |
| `complaints.ts` | Trash discovery → two-stage complaint → budget loss leg |
| `movement.ts` | Sim-side movement/elevator/stairs state feeding events |
| `cosmetic.ts` | Role-decorrelated visual identity seeds |
| `telemetry.ts` / `kpis.ts` | Per-round JSONL lines; post-hoc KPI aggregation |
| `rng.ts` | Seeded, stream-partitioned randomness |

The room journals what the sim doesn't see (elevator ride legs) and merges both
halves into the `round:recap` timeline at the buzzer. Telemetry is
server-authoritative only: one JSONL file per round under `data/telemetry/`
(git-ignored), closed with a machine-readable `round-ended` marker — it never
touches the wire.

## Protocol: registry → router → envelope → mapper

The security core is a pipeline, not a convention:

1. **Registry** (`packages/shared/src/protocol/registry.ts`): every server→client
   message is declared exactly once — wire name, payload type, recipient policy,
   and (for sim-originated events) the projection from `SimEvent` to payload.
   The closed policy enum: `all | self | sameFloor | occupants | riders | earshot`.
   This file is the audit surface for "what can the server ever send".
2. **Router** (`apps/server/src/rooms/router.ts`): the only module permitted to
   call `client.send` or broadcast (enforced by a bypass-denylist test). It
   applies policies structurally — a `self` event cannot be broadcast, an `all`
   event cannot be sent privately — by matching each connection's `ViewContext`
   (floor, room segment, car, x-position, spectator flag) supplied by the room.
   It stamps every delivery with `Envelope {seq, time, payload}`; `seq` is
   per-connection, monotonic from 1.
3. **Client Connection** (`apps/client/src/net/connection.ts`): one generic
   `onMessage('*')` handler verifies seq continuity (a gap means lost messages —
   the client leaves and rejoins into a fresh snapshot, `round:resumed` restores
   the honest clock) and dispatches through the exhaustive `MAPPERS` table.
4. **Reducer**: mappers emit `ViewAction`s; `state.ts` reduces them into
   `ViewState`; the DOM overlay and the Phaser scene render from state.

**Client→server intents are not in the registry** — they are zod-validated in
the room's intent handlers (`moveStart`, `moveStop`, `workStart`, `deskInteract`,
`elevatorCall`, `elevatorPress`, `stairsEnter`, `suitcasePickup`,
`suitcasePlace`, `accuse`, `lobbyStart`). The sim re-validates every spatial
precondition server-side.

**The hidden-information rule** falls out of this shape: roles, saboteur
identity, grace state, and room interiors are never fields in any registry
payload — the client literally cannot render what it never receives. The one
sanctioned over-delivery is the fired player's spectator view (FR-20), which
switches the connection's `ViewContext` to spectator.

## Key seams (single-home rules)

- **`shared/affordances.ts`** — every E-key interaction predicate (desk zone,
  door range, pickup-nearest, accuse range, landing zones). Consumed by BOTH the
  sim's authority guards and the client's prediction mirror; a mirrored range
  expression anywhere else is a defect.
- **`shared/tuning.ts`** — all game-feel dials; locked design decisions, changed
  only deliberately. Server and client agree on timing because
  both import the same table.
- **`shared/layout.ts` / `roomState.ts`** — building geometry and room-state
  contracts; the room re-pinned for the mezzanine floor (AD-010 → 3.C).
- **Client sessions** — `riderSession`, `accuseSession`, `evidenceSession` are
  pure reducers; each is the single derivation of its UI state, never
  re-derived per consumer.

## Client structure

`app.ts` is the controller: it owns the `ViewState`, the `Connection`, the
session reducers, and mounts the DOM overlay. The Phaser world (`WorldScene`
plus presenter modules for stairs/elevator/zoom, and `juice.ts`) mounts at first
lobby entry and survives the buzzer; movement messages are render-only actions
that route to the scene while view actions drive state + DOM. DOM views
(`joinView`, `lobbyView`, `roundHud`, `scoreHud`, `carScreen`, `stairScreen`,
`resultsView`) are synced from state — no view owns logic. `?room=CODE` deep
links (`shareLink.ts`) carry the drop-in join flow.

`window.__TURNOVER__` exists only in dev builds; production builds strip it
(gate-checked, AGENTS.md hard constraint).

## Testing topology

Gates, mapped to what each actually exercises (run them via the README table):

1. **`pnpm typecheck` + `pnpm lint`** — Biome; exhaustive `MAPPERS`/registry
   tables make missing-message drift a type error.
2. **`pnpm test:sim`** — vitest over *all* workspaces: sim scenarios
   (`sim:<name>`, deterministic, seeded — headless bot proofs like
   `sim:guest_exit_a/b` are balance gates), the registry test (policy audit),
   and server transport-shell tests.
3. **`pnpm test:client`** — Playwright boots the real server + real client in
   headless Chromium with the test clock seams on; scenarios `client:<name>`
   ride real WebSockets end to end.
4. **Human round** — anything player-facing gets a real 5-minute play.

## Deployment

Single Docker container (see `Dockerfile`, `fly.toml`): one Fastify process on
`$PORT`, `NODE_ENV=production` so the test clock seams are inert, one Fly.io
machine kept warm (`gru` region) with auto-stop otherwise. Health check is
`GET /`. Deploy with `pnpm fly:launch` (once) then `pnpm fly:deploy`.

## Recipes

**Add a server→client message**
1. Declare the payload in `protocol/messages.ts`.
2. Add exactly one registry row in `protocol/registry.ts` — wire name, payload
   type, recipient policy (pick the least-privileged policy that is true, never
   reflexively `all`), and the sim-event projection if it originates in the sim.
3. Add the client mapper in `net/mappers.ts` and reduce its actions in
   `state.ts` or a session reducer.
   No new switch cases anywhere — the registry row is the whole server change.

**Add an interaction**
1. Predicate in `shared/affordances.ts` (the one home for ranges).
2. Sim consumes it as an authority guard; client consumes it for prediction/UI.

**Add a sim feature**
1. Extend the relevant `packages/sim` module; emit typed `SimEvent`s.
2. Route them through registry rows (step above) — never send from the room
   around the Router.

## Further reading

- [CONTEXT.md](../CONTEXT.md) — domain vocabulary (protocol registry, suitcase,
  ambush, provenance, …)
- [docs/art/art-direction-brief.md](art/art-direction-brief.md) — the Deco Noir
  visual contract
- [docs/elevator-behavior.md](elevator-behavior.md) — historical design record
  for transit mechanics (cites the pre-3.E two-car era)
