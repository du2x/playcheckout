# Round-End (cycle 2.9) — Verifier Validation

**Verdict: PASS** (with 1 medium + 3 low gaps, none blocking the spec's
acceptance criteria; each becomes a follow-up task)

**Diff range reviewed:** `95d9aa2..4abb4ca` — the eight implementation commits
`95d9aa2` (T1 protocol), `65c5ce8` (T2 sim), `1a9d15a` (T3 client state),
`4908992` (T4 server results/spectator), `0e9e7bd` (T5 reconnection seats),
`89b3fae` (T6 results view), `17d3aa2` (T7 spectator overview), `4abb4ca`
(T8 auto-reconnect).

**Fresh gate evidence (this verification run):**
- `pnpm typecheck` — 0 errors
- `pnpm biome check apps/client apps/server packages` — clean (repo-wide
  `pnpm lint` reports 4 errors, all in **untracked** files from the parallel
  art workstream: `scripts/dev-boot.mjs`, `docs/art/asset-manifest.json` —
  not part of this cycle's commits)
- `pnpm test:sim` — 312/312
- Client unit suites in the scratch copy — 85/85 (state + mappers)
- Playwright (29/29) was run green by the orchestrator; not re-run here.

**Protocol audit:** the only pre-round recipient policies carrying
identity-adjacent data are unchanged 2.8 rows (`player:fired` is
`{playerId}`-only — registry.test.ts:377-393); `round:ended {saboteurId}` is
declared `'all'` and is the single post-round reveal
(registry.test.ts:395-410, 120-123); the aborted payload carries
`saboteurId: null` (TurnoverRoom.ts:385-389, asserted TurnoverRoom.test.ts:2357-2361).
The recap is name-free on the wire (TurnoverRoom.test.ts:2100-2104). No §7
tuning value changed; the only new constant is the `RECONNECT_SECONDS = 60`
Room-static seam (TurnoverRoom.ts:86), prd §11's own value.

---

## 1. Spec-anchored outcome check (P1–P4, REND-01..23)

### P1: Win checks — PASS

| AC | Evidence (asserts the spec-defined outcome, not internals) |
|---|---|
| REND-01 saboteur fired → staff win, same flush, fired-first | `packages/sim/src/roundSim.test.ts:185-220` — walk-in conviction asserts `flush.slice(-2)` types are exactly `['player:fired','round:ended']`, the full payload `{winner:'staff', reason:'saboteur-fired', saboteurId}` matched by value, post-round silence + `round-not-active`. Server half: `apps/server/src/rooms/TurnoverRoom.test.ts:2077-2083` (correct accusation → staff/saboteur-fired verdict routed to all). |
| REND-02 staff reduced to 1 → saboteur win | `roundSim.test.ts:222-248` (wrong-accusation cascade: flush types exactly `['player:fired','round:ended']`, staff-reduced + correct saboteurId) and `:250-269` (ghosts: no `player:fired` ever, verdict on the next tick flush). |
| REND-03 buzzer coverage, buzzer-first ordering | `roundSim.test.ts:271-283` — zero preps: `events.at(-2)` is `round:buzzer`, `at(-1)` the coverage-failed payload, exactly one `round:ended` total; `:285-316` — 20/24 rooms prepped → `['round:buzzer','round:ended']` with staff/coverage-met. Server half with the results phase: `TurnoverRoom.test.ts:2012-2026`. |
| REND-04 round over: intents rejected, results phase, no further events | `roundSim.test.ts:213-214` (silence + `accuse` → `round-not-active`); `TurnoverRoom.test.ts:2029-2038` (phase `results`, fresh join flows, host `lobby:start` begins a fresh round). |
| REND-05 exactly once per round | `roundSim.test.ts:205` (single verdict in the firing flush), `:282` (one `round:ended` on the buzzer path), `:213` (nothing after). Discriminated by sensor M2 (below). |

Precision note: the coverage tests sit at 20/24 and 0/24; see sensor M3a —
no integer test can distinguish `≥` from `>` at this threshold (both true
iff prepped ≥ 20), so the AC's letter is covered as far as arithmetic allows.

### P2: Results & recap — PASS

| AC | Evidence |
|---|---|
| REND-06 winner banner + traitor identity | Reducer: `apps/client/src/state.test.ts:167-181` (round-ended → results with winner/reason/saboteurId). DOM: `apps/client/harness/roundEnd.spec.ts:73-81` — every page shows `#results-banner` = "SABOTEUR WINS" and `#results-traitor` naming a roster player. Server: `TurnoverRoom.test.ts:2012-2026`. |
| REND-07 aborted view, no traitor | Reducer: `state.test.ts:183-193` (aborted stored with `saboteurId: null`). Server: `TurnoverRoom.test.ts:2356-2364` (payload equality `{winner:'aborted', reason:'saboteur-disconnected', saboteurId:null}` + recap flows). Gap 3 (low): no DOM-level assertion of the aborted view's banner/traitor suppression. |
| REND-08 recap contents (crime/catch/accusation/ride) | Sim: `roundSim.test.ts:318-341` (crime with freshness flipped at recap time), `:216-219` (catch entry entrant+saboteur), `:241-247` (accusations with `correct:false`). Room: `TurnoverRoom.test.ts:2048-2104` — a real round's recap carries ride + crime + catch kinds, the catch names the watcher/saboteur session ids, tick-ordered, name-free. |
| REND-09 timeline by tick, roster names, LIGHT-12 fallback | Tick order + id-only wire: `TurnoverRoom.test.ts:2100-2104`; roster-name rendering: `roundEnd.spec.ts:83-85` (ride row text contains "ada"); raw-id fallback is the pre-existing `roundPlayers` unit (`state.test.ts:152-162`). |
| REND-10 host start control from results | `roundEnd.spec.ts:88-89` (host clicks start → `#round-hud` on every page) and `TurnoverRoom.test.ts:2036-2038` (phase → round, `round:started`). |
| REND-11 non-hosts see roster while waiting | Indirect: `TurnoverRoom.test.ts:2032-2035` (results-phase join broadcasts roster snapshots). Gap 2 (low): no direct assertion of roster rendering in the results view. |

### P3: Spectator overview — PASS

| AC | Evidence |
|---|---|
| REND-12 fired client switches to overview | `apps/client/harness/spectator.spec.ts:116-160` — fired banner, `spectator:snapshot` received, scene shows exactly the 3 live rectangles, all three guest-floor door lanes visible. |
| REND-13 full positional/interior stream | Server: amended `TurnoverRoom.test.ts:1684-1752` (JUST-04) — the fired spectator receives the live walker's `player:moved` and `elevator:called` while no stream carries the fired id. Client: `spectator.spec.ts:145-160` (floor3 door lane visible from a lobby-spawned page). |
| REND-14 spectator:snapshot full-world baseline | `TurnoverRoom.test.ts:2114-2156` — 3 players (fired excluded), 2 cars, all 24 room states, carded rooms include the prepped room 1; arrives on the firing flush. |
| REND-15 live view unchanged | `spectator.spec.ts:162-172` — the live page receives NO `spectator:snapshot` and shows exactly its floor's rectangles; `TurnoverRoom.test.ts:1746-1750` — no stream carries the fired player's id to live viewers. Positive-control half of the sensor's M5. |
| REND-16 spectator view ends with the round | Reducer-level: `state.test.ts:167-181` (round-ended → results regardless of fired state); server `TurnoverRoom.test.ts:2156` (phase `results` on the same conviction). Gap 1 (low): no test observes a fired page's DOM transition overview → results. |

### P4: Disconnect & reconnection — PASS

| AC | Evidence |
|---|---|
| REND-17 seat held, one `player:left`, round continues | `TurnoverRoom.test.ts:2234-2261` — raw ws close mid-round: `leftCount === 1`, phase still `round`, SDK reconnect disabled so the restore is test-driven. |
| REND-18 exact restore | `TurnoverRoom.test.ts:2266-2280` — same session id, `role:dealt` equals the original role (saboteur card included by construction — the deal's roleOf), `round:resumed` with ownFired false / 4 playerIds / honest remainingTicks > 0, movement snapshot, and a re-announcing `player:moved` reaching the host. |
| REND-19 staff expiry ghosts, silently | `TurnoverRoom.test.ts:2294-2318` — window expiry: phase stays `round`, no firing, no verdict while staff = 2. |
| REND-21 ghost reduces staff → saboteur win | `TurnoverRoom.test.ts:2319-2329` — second ghost → `round:ended {winner:'saboteur', reason:'staff-reduced'}`, phase `results`; sim half `roundSim.test.ts:250-269`. |
| REND-20 saboteur expiry aborts | `TurnoverRoom.test.ts:2340-2364` — payload equality incl. `saboteurId: null`, recap flows, phase `results`; no traitor reveal. |
| REND-22 lobby/results drops unchanged | Lobby: CHURN-01 (`TurnoverRoom.test.ts:513`) immediate removal + roster snapshots; consented mid-round leave unchanged (CHURN-03 `:538`, consented ≠ drop so no seat). Results-phase reducer behavior: `state.test.ts:280-285`. Gap 4 (low): the server's results-phase **drop** branch (`expireSeat` lobby-like release) has no dedicated test. |
| REND-23 client auto-reconnect | Reducer state machine: `state.test.ts:258-298` (drop → reconnecting lost view keeping roster/round cast; resume clears the flag; results-phase reconnect lands in lobby; join view never reconnecting; terminal loss clears). Wiring: `apps/client/src/net/connection.ts:75-83` (onDrop → seq reset before the SDK auto-reconnect) with the lost-view text (`app.ts` lost branch). Harness-level retry is the SDK's built-in machinery per AD-021. |

**Traceability:** all 23 REND rows map to at least one real assertion in the
files above; none relies on a test that merely re-asserts implementation
details. The two amended legacy tests check out as amended-for-behavior-change,
not weakened: JUST-04 (`:1684-1752`) now *additionally* proves the spectator
over-delivery, and REG-18 (`:477-507`) pins the new same-flush verdict+recap
buzzer seq delta (`+4`).

---

## 2. Discrimination sensor (behavior-level mutants)

Scratch copy at `/tmp/opencode/verify-round-end` (working-tree rsync, excluded
`.git`/`node_modules`; node_modules symlinked read-only to the real tree).
Each mutant applied, suite run, then the file restored from the real tree.
The real repo's `git status --porcelain` was snapshotted before and verified
byte-identical after. Playwright not run in the scratch.

| # | Mutant (file: behavior) | Suite | Result |
|---|---|---|---|
| M1 | `roundSim.ts:193` — saboteur-fired check compares a wrong id (never fires) | sim `roundSim.test.ts` | **KILLED** — `walk-in conviction ends the round (REND-01)` failed (1 failed / 17 passed) |
| M2a | `roundSim.ts:243` — drop only the `resultEmitted` guard in `emitResult` | sim | **SURVIVED** — control-flow equivalent: the `resultEmitted` clause at `roundSim.ts:116` independently stops the next tick; no double emission is reachable by this single edit |
| M2b | M2a **+** drop the `resultEmitted` clause at `roundSim.ts:116` (true double-emit) | sim | **KILLED** — `walk-in conviction (REND-01)` failed on the "silence afterwards" assertion (`roundSim.test.ts:213`) |
| M3a | `roundSim.ts:209` — `>=` → `>` | sim | **EQUIVALENT** — for integers `5·p ≥ 96 ⟺ 5·p > 96` (both ⟺ p ≥ 20); no integer test can distinguish; recorded, not a test gap |
| M3b | `roundSim.ts:209` — `>=` → `<` (true inversion) | sim | **KILLED** — 3 failed: CLK-03 buzzer verdict, both REND-03 coverage tests |
| M4a | `roundSim.ts:320` — remove `ghost()`'s inline win check | sim | **SURVIVED** — behaviorally equivalent in room context: the per-tick staff-reduced check (`roundSim.ts:195`) fires the identical verdict one tick later |
| M4b | `roundSim.ts:226` — ghosts not excluded from `liveStaffCount` (ghosts don't count as reduced) | sim | **KILLED** — `staff ghosted down to one (REND-02 + FR-25)` failed |
| M5 | `router.ts:127,136` — remove `\|\| vc.spectator` from sameFloor/occupants | server `TurnoverRoom.test.ts` | **KILLED** — JUST-04 failed (`saboteurRecord` no longer receives the live walker's `player:moved`) |
| M6 | `TurnoverRoom.ts:350` — `restoreSeat` skips the `role:dealt` re-send | server | **KILLED** — `server:reconnect holds the seat … (REND-17/18)` failed |
| M7 | `TurnoverRoom.ts:381` — `expireSeat` takes the ghost branch for the saboteur too | server | **KILLED** — `server:reconnect aborts the round … (REND-20)` failed |
| M8a | `mappers.ts:48` — delete the `round:ended` mapper | client units | **KILLED** — `covers every registry key with a mapper (REG-12)` failed |
| M8b | `mappers.ts:48` — route `round:ended` to the WRONG action (`round-recap`) | client units | **SURVIVED** — 85/85 pass; see Gap 1 |

**Sensor summary: 8 mutant sites → 6 killed at the suggested form; the two
"survivors" at suggested form (M2a, M4a) are provably behavior-equivalent
single edits whose stronger forms are killed; M3a is arithmetically
equivalent. One genuine survivor (M8b) exposes Gap 1 below.**

---

## 3. Gaps (ranked; each is a candidate fix task — no production code changed)

1. **MEDIUM — no mapper-shape unit tests for the four cycle-2.9 payloads.**
   T3's done-when claims "Mapper tests: the four payloads map 1:1"
   (`tasks.md:142`), but `apps/client/src/net/mappers.test.ts` contains no
   `round:ended`/`round:recap`/`spectator:snapshot`/`round:resumed` shape
   tests — only the generic "every key has a function" check
   (`mappers.test.ts:27-31`). Demonstrated by sensor M8b: routing
   `round:ended` to a wrong action passes all 85 client unit tests; only the
   Playwright `client:round_end` gate would catch it. *Fix task: add four
   mapper shape tests pinning each 2.9 mapper's action output.*
2. **LOW — REND-16 lacks an observation-level test.** The spectator→results
   handoff is covered at reducer level only (`state.test.ts:167-181`);
   `client:spectator_view` never reaches round end, so no test sees a fired
   page's overview replaced by the results view. *Fix task: extend
   `spectator.spec.ts` (or a unit DOM smoke) to fire a page, end the round,
   and assert the results view.*
3. **LOW — REND-11 asserted only indirectly.** "Non-hosts see the roster
   while waiting" is evidenced by roster snapshots flowing in results
   (`TurnoverRoom.test.ts:2032-2035`), not by an assertion that the results
   view renders the roster for a non-host. *Fix task: one harness/unit DOM
   assertion on the results roster.*
4. **LOW — REND-22's results-phase drop branch untested server-side.**
   `expireSeat`'s lobby-like release for a drop whose round ended during the
   window (`TurnoverRoom.ts:372-380`) has no dedicated room test; lobby
   (CHURN-01) and reducer-level results reconnect are covered. *Fix task:
   room test — drop on the last tick, let the round end, expire, assert
   lobby-shaped release.*

**Informational (no action required):** edge cases not pinned by tests —
empty-rider recap ride entry (`riderIds: []`, spec edge "ghost trip") and a
firing resolving on the exact buzzer tick (fired-flush precedes the coverage
check). Both paths read as correct in `roundSim.ts`/`TurnoverRoom.ts` but no
assertion discriminates a regression today.

---

## 4. Sensor hygiene

- Real tree `git status --porcelain` identical before and after the sensor
  (verified by file diff of snapshots).
- No `git stash` used; no production file in the real repo modified.
- Scratch mutants reverted by restoring from the real tree after each run;
  scratch `packages/` and `apps/` verified byte-identical to the real tree
  at the end (`diff -r` clean excluding `node_modules`).

## Verifier fix round 1 (post-PASS)

Gap 1 (MEDIUM) closed: mapper-shape unit tests for the four 2.9 payloads added to `apps/client/src/net/mappers.test.ts` (`round-end mappers` describe) — the M8b mutant class (verdict routed to a wrong action / field dropped) is now killed by the client unit suite. Gap 4 (LOW) closed: `server:reconnect > treats a results-phase drop as a plain leave — no seat, roster churn` pins the `TurnoverRoom.ts` results-phase drop branch (player:left + lobby:snapshot, token dead). Gaps 2–3 (LOW: harness fires-then-ends; non-host results roster) remain indirect-covered — accepted as LOW with reducer-level + room-level evidence on record; a future harness cycle may pin them. Gates re-run: `pnpm test:sim` 317/317, client units 89/89, `pnpm test:client` 29/29, typecheck + biome clean.
