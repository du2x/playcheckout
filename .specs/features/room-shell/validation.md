# room-shell — Validation Report

**Verdict: PASS**

Independent verifier (author ≠ verifier). All 18 requirements have test evidence for
their primary spec-defined outcomes; all gates re-run by the verifier exit zero; the
discrimination sensor killed all 7 injected mutants. Four low-severity spec-precision
gaps flagged (secondary clauses of compound requirements lack direct assertions) —
none affects a primary outcome; ranked list at the bottom.

Gates re-run by verifier (real tree, e5812c0, clean):

- `pnpm typecheck` → exit 0 (4 projects)
- `pnpm lint` → exit 0 (biome, 50 files)
- `pnpm test:sim` → exit 0 (10 files, 55 tests)
- `pnpm test:client` → exit 0 (1 boot/strip scenario, headless Chromium)

**Diff range:** `git diff 82e7ec9..e5812c0` · task commits `731427d..e5812c0`
(731427d sim deal, 79fa3de sim clock, 896a757 shared messages, 968db27 room lobby,
579cc1c room start/routing, 5b3df8f churn, e5812c0 registration + smoke).

---

## 1. Per-AC evidence

Assertion expressions quoted verbatim. Paths relative to repo root.

| ID | Evidence (file:line) | Assertion expression | Spec-defined outcome | Covered |
| --- | --- | --- | --- | --- |
| LOBBY-01 | apps/server/src/rooms/TurnoverRoom.test.ts:79 | `expect(host.roomId).toMatch(/^[A-HJ-NP-Z]{4}$/)` | 4-letter code, join accepted | YES |
| LOBBY-01 | apps/server/src/rooms/TurnoverRoom.test.ts:83-84 | `expect(withGuest.roster.map((p) => p.name)).toEqual(['ada', 'bruno'])` | roster updated for all on join | YES |
| LOBBY-01 | apps/server/src/rooms/TurnoverRoom.test.ts:103-106 | `expect(snapshot.ownId).toBe(guest.sessionId)` / `ownName` / `isHost` false / roster in join order | personal snapshot: own identity + roster (ids+names only) | YES |
| LOBBY-02 | apps/server/src/rooms/TurnoverRoom.test.ts:122 | `await expect(newClient().joinById('ZZZZ', { name: 'ada' })).rejects.toThrow(/not found/i)` | bad code rejected "room not found" | YES (partial — "create no room" clause unasserted; gap G1) |
| LOBBY-03 | apps/server/src/rooms/TurnoverRoom.test.ts:131-132 | `await expect(newClient().joinById(host.roomId, { name: 'late' })).rejects.toThrow(/room full/i)` and `expect(TUNING.PLAYERS_MAX).toBe(6)` | 7th join rejected "room full"; cap is 6 | YES |
| LOBBY-04 | apps/server/src/rooms/TurnoverRoom.test.ts:302-304 | `await expect(newClient().joinById(host.roomId, { name: 'late' })).rejects.toThrow(/round in progress/i)` | mid-round join rejected | YES |
| LOBBY-05 | apps/server/src/rooms/TurnoverRoom.test.ts:138, 142, 147 | `.rejects.toThrow(/invalid name/i)` (17 chars, whitespace-only) / `.rejects.toThrow(/name taken/i)` | empty/long/duplicate name rejected | YES (roster-unchanged clause unasserted; gap G4) |
| LOBBY-05 edge | apps/server/src/rooms/TurnoverRoom.test.ts:157-160 | `expect(fulfilled).toHaveLength(1)` / `expect(rejected).toHaveLength(1)` | same-name race: exactly one accepted | YES |
| DEAL-01 | packages/sim/src/deal.test.ts:12-13 | `expect(saboteurs).toHaveLength(1)` (4-player and 6-player, deal.test.ts:13, 20) | exactly one saboteur at MIN/MAX | YES |
| DEAL-01 | packages/sim/src/roundSim.test.ts:29-33 | 1000-seed loop → `expect(saboteurs).toHaveLength(1)` | one saboteur across ≥1000 seeds | YES |
| DEAL-01 (server) | apps/server/src/rooms/TurnoverRoom.test.ts:233-234 | `expect(roles.filter((r) => r === 'saboteur')).toHaveLength(1)` / staff length 3 | live 4-player deal: 1 saboteur | YES |
| DEAL-02 | apps/server/src/rooms/TurnoverRoom.test.ts:230, 238-239 | `expect(Object.keys(dealt.payload).sort()).toEqual(['role', 'type'])` / started keys `['playerIds', 'type']` | own-role-only private payload; broadcast carries no roles | YES |
| DEAL-02 | packages/shared/src/protocol/messages.test.ts:17-19, 28 | `expect(Object.keys(snapshot).sort()).toEqual(['isHost','ownId','ownName','roster'])`; entry keys `['id','name']`; RoleDealt keys `['role','type']` | message shapes carry no role leakage surface | YES |
| DEAL-03 | apps/server/src/rooms/TurnoverRoom.test.ts:258-259 | `expect(err.payload.code).toBe('need-more-players')` with 3 players | <4 start rejected with need-more-players | YES ("remains in lobby" clause unasserted; gap G2) |
| DEAL-04 | apps/server/src/rooms/TurnoverRoom.test.ts:273 | `expect(err.payload.code).toBe('not-host')` | non-host start rejected | YES ("remains in lobby" clause unasserted; gap G2) |
| DEAL-05 | apps/server/src/rooms/TurnoverRoom.test.ts:288 | `expect(err.payload.code).toBe('round-already-active')` | double start rejected | YES |
| DEAL-06 | packages/sim/src/deal.test.ts:30-32 | `expect([...a.entries()]).toEqual([...b.entries()])` for seed 1234 twice | fixed seed ⇒ identical deal | YES |
| DEAL-06 | packages/sim/src/roundSim.test.ts:38-40 | `expect(a).toEqual(b)` full 6000-tick event sequences for seed 777 | fixed seed ⇒ identical full sim behavior | YES |
| CLK-01 | packages/sim/src/roundSim.test.ts:45-46 | `expect(sim.clockTicksRemaining).toBe(TUNING.SHIFT_SECONDS * TICK_HZ)` / `expect(RoundSim.TOTAL_TICKS).toBe(6000)` | 20 Hz fixed step; clock starts at 300 s = 6000 ticks | YES |
| CLK-02 | packages/sim/src/roundSim.test.ts:52-54 | `expect(sim.clockTicksRemaining).toBe(5999)` then `.toBe(5998)` | exactly one 0.05 s tick decrement per tick | YES |
| CLK-03 (sim) | packages/sim/src/roundSim.test.ts:59-64 | `expect(buzzers).toHaveLength(1)`; last tick `expect(last).toEqual([{ type: 'round:buzzer' }])` | buzzer at exactly tick 6000, never again | YES |
| CLK-03 (server) | apps/server/src/rooms/TurnoverRoom.test.ts:321-326, 385 | all 4 clients `waitFor('round:buzzer')`; `expect(instance?.__phase()).toBe('lobby')` | buzzer → all players notified, room back to lobby | YES |
| CLK-04 | apps/server/src/rooms/TurnoverRoom.test.ts:329-335, 417-427 | post-buzzer join accepted; restart → phase `'round'`; `expect(saboteurs2).toBe(1)` over 4 fresh role payloads | re-deal after buzzer, no memory of previous deal | YES (fresh-seed asserted structurally — seed is server-only by design; gap G5 note) |
| CHURN-01 | apps/server/src/rooms/TurnoverRoom.test.ts:354-355 | `expect(after.roster.map((p) => p.name)).toEqual(['ada'])` | leave removes leaver; roster broadcast (ids+names via LobbySnapshot shape test) | YES |
| CHURN-02 | apps/server/src/rooms/TurnoverRoom.test.ts:366-368 | `await guestSnaps.nextWhere((s) => s.isHost)`; `expect(migrated.ownName).toBe('bruno')` | host leave promotes earliest remaining | YES |
| CHURN-03 | apps/server/src/rooms/TurnoverRoom.test.ts:380-387 | leave mid-round, `__driveTicks(6000)`, `waitFor('round:buzzer')`, phase `'lobby'`, new join accepted | round keeps running with idle slot until buzzer | YES |

Coverage: 18/18 requirements have primary-outcome evidence. 0 NOT COVERED.
Gate mapping per spec §Traceability holds: LOBBY-* / CHURN-01..02 on `server:lobby_join`
(describe blocks TurnoverRoom.test.ts:76, 347); DEAL-*/CLK-* on `sim:role_deal`
(roundSim.test.ts:17 describe + server half TurnoverRoom.test.ts:218); CHURN-03
server-side idle slot on the churn describe block.

## 2. Protocol audit (turnover-protocol)

Every send site in `apps/server/src/rooms/TurnoverRoom.ts` (grep `this.(send|broadcast|sendTo)` — 8 hits, all audited):

| Site | Message | Routing | Declared recipients (messages.ts) | OK |
| --- | --- | --- | --- | --- |
| :85, :99 | `lobby:snapshot` | `sendTo` per session, payload built per-recipient by `buildSnapshot(sessionId)` | server → one player (personal snapshot) | OK |
| :125, :134, :142 | `error` | `sendTo(sessionId, …)` — intent sender only | server → one player | OK |
| :176 | `round:started` | `broadcast`, payload `{ type, playerIds }` — ids only | server → all, ids only, no roles | OK |
| :179 | `role:dealt` | `sendTo(event.playerId, …)` — dealt player ONLY | server → exactly one player, own role | OK |
| :182 | `round:buzzer` | `broadcast`, `{ type }` only | server → all | OK |

Seed audit: `seed` appears nowhere in `packages/shared/src` outside a comment
(messages.ts:8) and the zod negative test (messages.test.ts:46, asserting the strict
schema rejects a client-supplied seed). The seed exists only server-side at
TurnoverRoom.ts:158 (`randomInt(2 ** 31)`), inside the sim, never in any event or
payload. Room patchRate is null / no Schema state (TurnoverRoom.test.ts:164-168,
index.test.ts:51-58). **Audit clean.**

## 3. Discrimination sensor

Method: repo copied to /tmp/opencode/verify-room-shell (node_modules included);
one behavior-level fault injected per run; `pnpm test:sim` executed in the scratch;
scratch discarded afterwards. Real-tree `git status --porcelain` verified identical to
the pre-sensor baseline (clean) after the sensor.

| # | Mutation (file, fault) | Result | Killed by |
| --- | --- | --- | --- |
| a | deal.ts: deal second saboteur (ids[1] also set saboteur) | KILLED (6 failures) | deal.test.ts:13 (`toHaveLength(1)` at 4-player), deal.test.ts:20 (6-player), roundSim.test.ts:33, TurnoverRoom.test.ts:233/413 |
| b | roundSim.ts:59: buzzer fires when `ticksLeft === 1` (one tick early) | KILLED (1 failure) | roundSim.test.ts:57-64 (buzzer at exactly tick 6000, last tick equals `[{ type: 'round:buzzer' }]`) |
| c | TurnoverRoom.ts:179: `role:dealt` routed as `broadcast` | KILLED (3 failures) | TurnoverRoom.test.ts:233 (`roles.filter(saboteur)` length 1 — broadcast makes every client see the same first role ⇒ 0 or 4) |
| d | TurnoverRoom.ts:141-148: need-more-players guard removed | KILLED (10 failures) | TurnoverRoom.test.ts:258 (`code === 'need-more-players'`; error never sent ⇒ timeout) |
| e | TurnoverRoom.ts: host pinned to first-ever joiner (`pinnedHost` set once, never migrated) | KILLED (1 failure) | TurnoverRoom.test.ts:360-371 (CHURN-02: guest becomes host after host leaves) |
| f | TurnoverRoom.ts:65: mid-round join guard disabled (`phase === 'never'`) | KILLED (1 failure) | TurnoverRoom.test.ts:296-304 (LOBBY-04: join rejected mid-round) |
| g | TurnoverRoom.ts:68: capacity `>= PLAYERS_MAX` → `> PLAYERS_MAX` (off-by-one) | KILLED (1 failure) | TurnoverRoom.test.ts:125-135 (LOBBY-03: 7th player rejected) |

Sensor tally: **7 injected / 7 killed / 0 survived.** No fix tasks from the sensor.
(Process note: the first run of mutation g was invalidated by a scratch-file race —
the restore copy clobbered the mutation before the test ran; re-applied sequentially
with the mutant's presence verified by grep before rerunning. All other mutations
verified live via their distinct failure signatures.)

## 4. Post-sensor integrity check

`git status --porcelain` before and after the sensor: byte-identical (empty — clean
tree). No source or test file in the real tree was modified at any point.

## 5. Ranked gap list (spec-precision; low severity — none blocks PASS)

All gaps share one shape: a compound EARS requirement's secondary clause lacks a
direct assertion, so a mutant that satisfies the primary clause but violates the
secondary would survive. Recommended: add 2–3 lines to existing tests in the next
touch of this feature; do not block the cycle on them.

- **G1 — LOBBY-02 "and create no room"**: TurnoverRoom.test.ts:122 asserts the
  rejection but nothing asserts the room-instance count is unchanged afterwards
  (e.g. `TurnoverRoom.instances` length check).
- **G2 — DEAL-03/DEAL-04 "and the room SHALL remain in lobby state"** (also DEAL-05's
  implicit continuation): TurnoverRoom.test.ts:249-263 and 265-277 assert the error
  codes but never assert `instance?.__phase()` is still `'lobby'` after the rejected
  intent; a reject-then-start mutant would survive both tests.
- **G4 — LOBBY-05 "and the roster SHALL be unchanged"**: name-rejection tests
  (137-148) don't snapshot the roster after a rejected join.
- **G5 (note, not a defect) — CLK-04 "fresh roles from a new seed"**: the fresh seed
  is unobservable by design (server-only), so coverage is structural (fresh RoundSim,
  second deal distributes 1 saboteur — TurnoverRoom.test.ts:417-427). Acceptable given
  the protocol rule; no client-visible assertion is possible without leaking the seed.

Edge cases from spec §Edge Cases: lowercase code (TurnoverRoom.test.ts:113-119),
4-player boundary (DEAL-01 tests), post-buzzer join (329, 386), same-name race
(151-162) — covered. "Start in the same tick as a leave dropping below 4" has no
dedicated test (leave-then-start are separate WS round-trips in the harness); noted,
not a numbered AC — same spirit as G2.

## 6. Sensor/config artifacts

- Scratch: /tmp/opencode/verify-room-shell (discarded after sensor).
- Baseline/post-sensor porcelain snapshots: /tmp/opencode/{baseline,post-sensor}-porcelain.txt.
