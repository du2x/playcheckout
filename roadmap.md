# Roadmap — Turnover

Companion to `prd.md` v1.4 (decisions locked; v1.3 = guest-traffic economy, AD-022;
v1.4 = guest-transport/suitcase economy, AD-032 — proposal at
`.specs/proposals/guest-transport-economy.md`, cycles 3.B/3.C below).
Stack per prd §11: TypeScript, Phaser 4 client, Node 24 + Colyseus 0.18 (message-only),
pure sim package, Railway single-container deploy.

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

Run as **10 tlc cycles**, each a full Specify → Execute pass with its own feature dir
under `.specs/features/`, named gate scenarios, and a STATE.md handoff commit.
Order is dependency-driven: each cycle's sim state machine extends the previous one.

| Cycle | Feature | Scope | New gates (named scenarios) |
|---|---|---|---|
| 2.1 | `room-shell` | Colyseus room hosting the headless sim, join by code, host start ≥4, role deal (FR-1, FR-2), round clock | `server:lobby_join`, `sim:role_deal` |
| 2.2 | `first-light` | Minimal client slice (AD-003): join-by-code screen, roster, host-start, labeled rectangles + round clock after start — consumes only existing T3 catalog messages, roles never render. Proves the AD-001 Fastify+Colyseus wiring in a real browser and gives Gate 3 its first real scenarios | `client:lobby_join`, `client:round_start` |
| 2.3 | `protocol-registry` | Deepen the protocol pipeline (AD-006): one registry in `packages/shared` declaring every server→client message (payload type + closed recipient-policy enum), per-room Router stamping a `{seq, time, payload}` envelope, generated client dispatcher with exhaustive view mappers. Behavior-preserving; deletes the route() switch, per-type handlers, and dead envelope.ts | `server:protocol_registry`, `client:envelope_gap` |
| 2.4 | `movement` | Persistent movement layer in room + sim (AD-005): linear left/right, pass-through bodies, 6 tiles/s, walkable grand lobby pre-round, full building at round start; deterministic elevator cycle, 2s/floor, one pending destination, position-only panels (FR-4–FR-6) | `sim:motion`, `sim:elevator`, `client:movement` |
| 2.5 | `work-channels` | Prep 5s from any non-prepped state, un-prep 3s, fake prep = animation only, clean cancel on walk-out (FR-7–FR-9, FR-16) | `sim:prep`, `sim:unprep`, `sim:fake_prep` |
| 2.6 | `elevator-riders` | Rider knowledge in the car (AD-013/AD-014): destination-free calls, in-car FIFO press queue, 1 s open-door dwell, rider-exclusive occupancy/press chip, lit floor indicators; panels stay position-only (FR-5) | `sim:elevator_riders`, `client:elevator_riders` |
| 2.7 | `evidence` | Door cards (permanent, hallway-readable, no timestamp), freshness tiers, rustle 3 tiles through walls, door-open visible+audible from hallway (FR-10–FR-13) | `sim:door_card`, `sim:rustle`, `sim:door_open_cue` |
| 2.8 | `justice` | Walk-in conviction, hidden grace, name-only firing toasts, accusation range 2 tiles same floor (FR-14–FR-19) | `sim:walkin_conviction`, `sim:accuse`, `sim:firing_toast` |
| 2.9 | `round-end` | Win checks + results + recap timeline (FR-20–FR-22); disconnect/abort handling, 60s reconnection with role restore (FR-25) | `sim:win_checks`, `server:reconnect` |
| 2.10 | `art-swap` | Gray-box → production art swap (AD-020 visual contract): player sprites + walk cycle, door sprites + doorway interiors, elevator car sprites + panel flash — rendering-only, zero protocol/sim/tuning changes; rewrites the harness count contract (Rectangle/Ellipse → texture filters). Interiors render only from `room:observed` or the FR-20 spectator baseline | `client:art_players`, `client:art_doors`, `client:art_elevator` |

Cycle rules:
- Visibility-sensitive content (roles, grace state, interiors) never enters a
  client-bound payload — checked per cycle at design review (turnover-protocol skill).
- Every cycle ends with gates 1–3 green + STATE.md handoff; gate ladder per AGENTS.md.
- Cycle 2.10 is the phase exit (the rendering contract proven over the full
  v1.2 sim). The former 2.11 `telemetry` cycle (FR-23/24 JSONL + KPI + exit
  bot sims) is **postponed to 3.6** — the last Phase 3 cycle — per user
  direction (2026-08-30); the v1.2 exit proof moves there and re-runs under
  the full economy.

Build the full round as a headless state machine in `packages/sim` — pure TypeScript,
inputs + time in / events out, 20 Hz tick — before any rendering, testable via scripted
bot inputs in vitest. Colyseus stays a thin transport shell; nothing visibility-sensitive
ever uses Colyseus state sync (message-only protocol). Full FR mapping lives in each
cycle's spec (items 1–8 of the original plan → cycles 2.1–2.10 above; 2.3
`protocol-registry` is an inserted hardening cycle, AD-006; 2.10 `art-swap` is an
inserted rendering cycle, AD-021; telemetry postponed to 3.6).

## Phase 3 — Guest-traffic economy (prd v1.3, AD-022)

Run as **8 tlc cycles**, each a full Specify → Execute pass with its feature dir under
`.specs/features/`, named gate scenarios, and a STATE.md handoff commit. Dependency
order: lifecycle first, then the desk/routing social layer (3.2), then the suitcase-
transport redesign (3.B) and the restaurant floor (3.C), then the evidence + loss
loop, then signage/provenance, then the rate-based exit proof, then telemetry last.
One inserted art cycle (**3.A**, lettered so the locked 3.2–3.6 numbering — including
the in-flight 3.2 Specify — stays stable; precedent: the inserted 2.3/2.10 cycles)
runs **in parallel** with 3.2–3.3 and must land before any guest sprite is authored.
The v1.4 inserts (**3.B/3.C**) reuse the same letter precedent and sit between 3.2
and 3.3 — 3.3's loss loop consumes 3.B's complaint triggers, so 3.B precedes 3.3.
The v1.5 insert (**3.D**, `delivery-scoring`, AD-039) sits between 3.C and 3.3 for
the same reason one level up: 3.3's budget scope depends on 3.D's decoupling
(wrong-delivery lines stop counting), and 3.5 calibrates 3.D's `SETTLE_TARGET`.

Phase rules:
- **Entry task (in 3.1's Specify phase): recompute the prd §8 throughput math** with
  churn as a third mess source (AD-022 trade-off) — the dials in §7 v1.3 rows are
  provisional until this lands.
- **Seeded RNG only** in `packages/sim` for dwell/arrival sampling (AD-022) — no
  `Math.random` anywhere in the deterministic core.
- Every guest/complaint/walkie message enters the protocol registry with an explicit
  recipient policy (turnover-protocol skill); guests are NPCs whose tenancy is public
  (FR-33) but whose *reports* are diegetic — policy per message decided in each
  cycle's Design phase, never defaulted to `'all'`.
- Guest expressiveness (foot-tap, storm-out, anger cue, flip-sign) is load-bearing
  fun, not polish — each cycle's client slice renders it gray-box first and the art
  manifest (AD-020) gains guest entries before the art workstream touches them.
- **Cosmetic variety (3.A) is identity, never role**: the `cosmeticSeed` stream is
  decorrelated from the role deal, so no variant distribution can hint at the
  saboteur (FR-9 boundary); the gate asserts the decorrelation, not just the render.
- The former 2.11 exit bot sims (`exit_a`, `exit_b`) move to 3.6 and re-prove
  the v1.2 exit criteria under the full economy; 3.5's rate-based guest bots
  are the new-signal proof.
- No dial changes without a recorded AD; v1.3 §7 rows are the reserve list.

| Cycle | Feature | Scope | New gates (named scenarios) |
|---|---|---|---|
| 3.1 | `guest-flow` | Guest lifecycle as weather (FR-26, FR-28, half of FR-32): NPCs arrive at the lobby on the headcount-scaled cadence (30s/24s/18s), queue, wait 20s impatience (foot-tap + bell, no complaint cost), **self-assign** a uniform random vacant room, settle, dwell 45–90s (seeded), check out → room re-trashes spawning **settled** trash; 7 of 24 rooms trashed at t=0. Client: guest rectangles, queue + impatience cues | `sim:guest_arrival`, `sim:guest_impatience`, `sim:checkout_churn`, `client:guest_flow` |
| 3.A | `char-variants` | **Visual variety without saboteur tells** (user direction 2026-08-31, Deco Noir AD-029). (0) Precursor: decide the open **960×576 viewport** (=32 px/tile, art brief recommendation) and land the integer-tile resize — unlocks the Deco Noir 34×64 elongation *before* new sheets are authored. (1) Protocol: `cosmeticSeed` per player and per guest, drawn from a **role-decorrelated Rng stream** (guests already use the AD-028 seeded-stream pattern); public info → registry-first entry with `'all'` policy. (2) Client: staff rendered in **two layers** (shared body sheet + head/accent variant sheet, ≈8 variants from skin × hair × accessory) — variety lives ONLY in idle/walk/head layer, the FR-9 work-channel frames stay identical for every role; guest archetypes (3–4 distinct silhouettes × 4 civil palette rotations) replace the 3.1 gray-box markers, class read enforced: **no ivory/brass on guests**, staff silhouette unchanged. Art manifest gains all new entries BEFORE authoring (phase rule). Client render-only besides the seed field — zero sim/tuning churn | `client:char_variants` (assert: variant ⊥ role — different roles may share a variant; guests never render staff uniform/brass; work-channel frames byte-identical), plus viewport smoke via existing `client:movement` |
| 3.2 | `front-desk` | Desk station + mandatory walkie routing (FR-27): any player at the desk receives the queued guest; sending requires the canned walkie broadcast (building-wide, "«Marco»: guest going to 305") — the broadcast is a **claim, not server-truth**; routed guests walk/elevator to their room (guests as elevator citizens, panels stay position-only). Self-assign remains the fallback path from 3.1. Client: desk interaction + walkie broadcast line (DOM) | `sim:desk_receive`, `sim:walkie_broadcast`, `sim:walkie_lie`, `client:desk_walkie` |
| 3.B | `suitcase-transport` | v1.4 suitcase redesign of desk routing (proposal: `.specs/proposals/guest-transport-economy.md`): check-in hands the guest's **suitcase** to the receiver (one per player; **carrying blocks work channels**; accusation stays available); the guest waits in a lobby holding area (restaurant stub) and follows the suitcase's **last resting room**; E **places** at a room door / **picks up** a resting suitcase — by anyone, saboteur included, self-regrab allowed; rolling **60s carry clock fires the current carrier** on expiry (the only personal foul); assignment notice = building-wide `guest:assigned` announce at the check-in tick (AD-034 amendment; never repeated); arrival outcome: correct room → settle (FR-29 economy intact), wrong room → **door complaint counting toward the budget**, no entry, no personal penalty; walkie becomes the **server-generated lifecycle log** (arrival/check-in/pickup/settle/complaint/checkout — `walkie:broadcast` intent deleted, **placement is silent**). Client: suitcase marker, E-priority ladder (desk > elevator-call > place > pickup), placement is direct (AD-034: confirm dropped, assignment public), walkie log rework. Impatience re-scoped to the check-in wait; walk-out/fired/ghosted/disconnect → suitcase rests at desk, guest re-queued, assignment void | `sim:suitcase_carry`, `sim:assignment_announce`, `sim:carry_clock`, `sim:wrong_delivery`, `client:suitcase` (amended by AD-034: assignment announced building-wide; confirm dropped) |
| 3.C | `restaurant-floor` | v1.4 mezzanine restaurant directly above the lobby: breaks the pinned AD-010 layout (lobby + 3 guest floors × 8 rooms → +mezzanine; `layout.ts`/`layout.test.ts` re-pinned), elevators serve 5 stops, guest `dining` phase replaces 3.B's holding stub — dwell 15–30s seeded as a wait buffer (a guest whose suitcase rests leaves immediately). Art manifest gains floor/suitcase/restaurant entries BEFORE authoring (phase rule). Client: mezzanine floor view + dining cues | `sim:dining`, `client:restaurant` |
| 3.D | `delivery-scoring` | v1.5 settle score (proposal: `.specs/proposals/delivery-scoring.md`, AD-039): correct deliveries settle guests and build a **public team settle score** — staff win at the buzzer when the score ≥ `SETTLE_TARGET` (4p 5 / 5p 7 / 6p 9, provisional pending 3.5); the wrong-delivery door complaint **stops counting toward the complaint budget** (the building-wide line stays — it informs, it no longer damages); coverage% drops out of the win check into FR-23 telemetry/KPI. Sim: `GuestSim.settledCount` + buzzer verdict swap (`settle-target-met`/`settle-target-failed` win reasons). Client: score HUD (`Settled N / T`) fed by the public `guest:settled` stream, recap carries the final score vs target, `round:resumed` re-seeds a reconnecting counter. 3.3's loss loop is amended: trash-discovery complaints only | `sim:settle_score`, `sim:win_checks` (amended), `client:score_hud` |
| 3.3 | `complaint-budget` | The evidence + loss loop (FR-29, FR-30, FR-31; FR-14 amendment), amended by v1.4 and **shrunk by v1.5 (3.D)**: guests enter only the suitcase's resting room (3.B) — trash discovered on settle; triggers are **trash-discovery complaints only since v1.5** (the 3.B wrong-delivery door complaint fires its line but counts toward nothing); entering mid-un-prep **flees, never convicts** (FR-15 stays staff-only); two-stage complaint (in-world anger cue at the room → fuzzy-timestamp desk report); one complaint then the guest leaves (no retry); HUD complaint counter (pulse ≥6); 8th complaint = **instant loss** wired into §6.6 win checks + results/recap plumbing. Client: anger cue + counter | `sim:complaint`, `sim:guest_never_convicts`, `sim:budget_instant_loss`, `client:complaint_cues` |
| 3.4 | `provenance-signs` | Trash authorship + tenancy signage (FR-32, FR-33; FR-22 amendment; walkie-lie verification clause dropped — v1.4 deletes the walkie lie): full provenance rules (sabotage spawns fresh, re-trash resets fresh, churn stays settled — laundering possible, hiding hits is not); recap complaint lines carry provenance (post-reveal only); Occupied/Vacant flip-signs on every guest door (tenancy, not presence; separate channel from FR-11 cards). Client: door signs | `sim:trash_provenance`, `server:recap_provenance`, `client:tenancy_sign` |
| 3.5 | `guest-exit` | Rate-based bot sims, the new-signal proof, v1.5 edition: (a) staff bots reach `SETTLE_TARGET` against pure churn at the 6p cadence, (b) **mis-placement saboteur bot** (free wrong placements + interception) wins at plausible rates against interception-shaped staff — doubles as the v1.4/v1.5 §7 **balance gate**: if interception cannot keep up, dials move before §7 locks (and it calibrates `SETTLE_TARGET` + re-checks the shrunken complaint budget's reachability) | `sim:guest_exit_a`, `sim:guest_exit_b` |
| 3.6 | `telemetry` | Phase exit (postponed from 2.11): JSONL telemetry with 1/s coverage sampling (FR-23) + guest extension (FR-23/24 — guest arrivals/check-ins/checkouts, suitcase carry/place/pickup + carry-clock expiries, complaint events with source + provenance, bleed-vs-throughput KPIs) + KPI computation from JSONL; the v1.2 exit bot sims re-proven under the full economy: (a) staff vs. AFK saboteur ≥80% pre-buzzer, (b) last-60s blitz defeats spread bots at plausible rates | `sim:telemetry`, `sim:telemetry_guests`, `sim:exit_a`, `sim:exit_b` |

Cycle rules (inherited from Phase 2):
- Visibility-sensitive content (roles, grace state, interiors) never enters a
  client-bound payload — checked per cycle at design review (turnover-protocol skill).
- Every cycle ends with gates 1–3 green + STATE.md handoff; gate ladder per AGENTS.md.
- Cycle 3.6 is the phase exit: all bot sims must pass before Phase 4 starts.

## Phase 4 — Gray-box client

- Rectangles + floor labels; no art, no audio polish (non-goal).
- DOM overlay for lobby / HUD / firing toasts / results / recap; Phaser 4 renders only
  the game world.
- Local playback of server events; door-open/rustle as simple cues; HUD = coverage % +
  timer + complaint counter (FR-14 as amended by v1.3); spectator overview camera incl.
  interiors (FR-20).
- Results screen: winner banner, traitor reveal, recap timeline with validity flags
  and complaint provenance (FR-22 as amended).

## Phase 5 — Playtest harness

- KPI computation from JSONL (FR-24) + a tiny viewer script.
- 10 recorded sessions (5–6 players, Discord voice, rotating groups) against the §8 table.
- Railway deploy (auto from git) live before the first remote playtest.

## Phase 6 — Evaluate & tune

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
