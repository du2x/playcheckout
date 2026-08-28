# Validation — protocol-registry (cycle 2.3, AD-006)

**Verdict: PASS** (3 low-severity spec-precision notes, none blocking — see Gaps)
**Verifier**: independent (author ≠ verifier); all evidence re-derived from source
and live gate runs.
**Diff range**: `12c3d9c..a2fb865` (HEAD) — commits 8efdd81, 165ae93, 525f0fd,
fa7a47c, 3c91d37, a2fb865.

---

## 1. Gate evidence (re-run by verifier, not trusted from logs)

| Gate | Command | Result |
| --- | --- | --- |
| 1 (types) | `pnpm typecheck` | exit 0 (sim/shared/server/client all `tsc --noEmit` Done) |
| 1 (lint) | `pnpm lint` | exit 0 (biome, 69 files, no fixes) |
| 2 | `pnpm test:sim` | exit 0 — **Test Files 13 passed (13), Tests 94 passed (94), 1.90s** |
| 3 | `pnpm test:client` | exit 0 — **16 passed (34.0s)** incl. `client:envelope_gap`; webServer command runs the prod strip check (`check-prod-strip.mjs --expect-absent` on the prod build, `--expect-present` on the harness build — `apps/client/harness/playwright.config.ts:20`), so REG-15 is gate-run-proven, exit 0 implied by the green run |
| 4 (human) | N/A this cycle | Behavior-preserving wire refactor; recorded in design.md Tech Decisions. Accepted. |

Environment note: two stale `tsx watch src/index.ts` processes from this checkout
were found and killed before gate 3 (matched the kill criteria exactly); port 2567
was otherwise free.

---

## 2. Per-requirement evidence (REG-01..REG-20)

| ID | Spec AC (essence) | Evidence (file:line, asserted expression) | Match to spec? |
| --- | --- | --- | --- |
| REG-01 | Each server→client type declared exactly once (name, payload, policy) | `packages/shared/src/protocol/registry.ts:85-119` — `PROTOCOL_REGISTRY` const, one row per type (`payload`/`recipients`/`fromSim`); walk test `registry.test.ts:55-96` reads exactly this const | ✅ |
| REG-02 | Missing `SimEvent` type → workspace fails to compile | `registry.ts:119` — `as const satisfies { [K in RegistryKey]: Entry<K> } & { [K in SimEvent['type']]: unknown }`. **Live proof** (scratch copy): deleting the `round:buzzer` row → `tsc` exit 2, `error TS1360 … does not satisfy the expected type '{ "round:started": … "round:buzzer": … }'`. Runner = gate 1 (exit 0 on real tree) | ✅ |
| REG-03 | Exactly the five pre-existing types, no new ones | `registry.test.ts:56-63` — `expect(Object.keys(PROTOCOL_REGISTRY).sort()).toEqual(['error','lobby:snapshot','role:dealt','round:buzzer','round:started'])` | ✅ |
| REG-04 | `envelope.ts` + `BroadcastGameEvent`/`PrivateGameEvent` deleted; registry the only catalog | `git diff 12c3d9c..HEAD --stat`: `packages/shared/src/protocol/envelope.ts` deleted (−31); `grep -rn "BroadcastGameEvent\|PrivateGameEvent" packages apps` → **no matches**; `protocol/index.ts` exports only messages/registry/simEvents/telemetry | ✅ |
| REG-05 | Per-room Router routes each event generically, no per-type switch | `apps/server/src/rooms/router.ts:41-50` — `route()` looks up `PROTOCOL_REGISTRY[event.type]`, applies `fromSim`, dispatches per `entry.recipients`; never names a message type. Projection unit tests `registry.test.ts:77-96`. Wiring: `TurnoverRoom.ts:187` `for (const event of sim.tick()) this.router.route(event)` | ✅ |
| REG-06 | Envelope `{seq,time,payload}`, per-connection monotonic seq, server time ms | Unit: `router.test.ts:34-50` — `Object.keys(first).sort()` = `['payload','seq','time']`, `first.seq===1`, `second.seq===2`, `typeof first.time==='number'`. Live: `TurnoverRoom.test.ts:402-428` — envelope keys asserted per collector, `dealt.seq === started.seq + 1` | ✅ |
| REG-07 | Broadcast → each connection gets its own next seq | `router.test.ts:52-63` — `a.seq===1 && b.seq===1`, then `2`/`2`; impl `router.ts:79-80,83-87` (per-sessionId `Map`) | ✅ (see Gap 3 — weak-mutant observation) |
| REG-08 | No in-payload `type` literal; wire name is the only tag | `messages.ts:22-49` — payload interfaces have no `type` field; `router.test.ts:48-49` — `Object.keys(first.payload)` = `[]`; live `TurnoverRoom.test.ts:418,420,443` — payload keys `['playerIds']`/`['role']`/`[]` | ✅ |
| REG-09 | `role:dealt` reaches only the named player, by declared policy | `router.test.ts:65-75` — `a.sent` = `[]`, `b.sent` length 1, payload `{role:'saboteur'}`; policy-driven branch `router.ts:74-77`. Live privacy: `TurnoverRoom.test.ts:229-257` (DEAL-01/02) — every collector receives exactly one private `role:dealt`, exactly one saboteur | ✅ |
| REG-10 | Bypass denylist: no raw `.send(`/`.broadcast(` outside Router | `router.test.ts:108-121` — fs-walk of `apps/server/src/rooms/*.ts` (excl. tests + `router.ts`) for `/\.send\(|\.broadcast\(/`, `expect(violations).toEqual([])`; grep of real tree confirms only `router.ts:86` calls `client.send` | ✅ |
| REG-11 | Client unwraps envelope, verifies seq, dispatches via pure mapper | `connection.ts:63-71` — one `onMessage('*')` handler: `recordServerMessage`, `isGap`, `MAPPERS[name](envelope.payload)`; `mappers.ts:11-19` — pure `payload → ViewAction[]` per key; gate 3 `client:lobby_join` + `client:round_start` green | ✅ |
| REG-12 | Registry key without mapper → compile error | `mappers.ts:11-13` — `MAPPERS: { [K in RegistryKey]: (payload: RegistryPayload<K>) => ViewAction[] }`. **Live proof** (scratch): deleting the `round:buzzer` mapper → `tsc` exit 2, `error TS2741: Property '"round:buzzer"' is missing … but required in type`. Runner = gate 1 | ✅ |
| REG-13 | `ServerMessage` union, per-type handlers, app.ts switch deleted | `grep -rn "ServerMessage" apps packages` → **no matches**; `connection.ts` has a single `onMessage('*')` (no per-type registrations); `app.ts:82-93,108-128` — `onActions` dispatch + view-driven `syncScenes`, names no message type | ✅ |
| REG-14 | Dev hook records every message incl. `seq`,`time` | `debug.ts:40-50` — `recordServerMessage` stores `{ type, payload, seq, time, at }`; connection.ts:66 calls it before the gap check (records *every* message) | ✅ |
| REG-15 | No `window.__TURNOVER__` in production build | `playwright.config.ts:20` — webServer command runs `check-prod-strip.mjs --expect-absent` on the prod bundle inside the green gate-3 run; `debug.ts` guards every export with `import.meta.env.MODE === 'production'` early-return; connection.ts never touches `window` directly | ✅ |
| REG-16 | Gap → recorded in hook → rejoin via existing connection-loss path | `connection.ts:78-86` — non-consecutive seq → `recordGap({expected, actual, at})` → `this.leave()` → `onLeave` → `onDisconnect` → `connection-lost` view (app.ts:88-91). Harness: `envelope.spec.ts:27-58` — `#lost-view` appears; `gaps` length 1 with `expected === actual + 1000` (forceGap offset) | ✅ |
| REG-17 | Rejoin restarts seq tracking per connection | `connection.ts:38` — `lastSeq = 0` per Connection instance; server `router.ts:63-65` `forget()` drops the counter (called `TurnoverRoom.ts:110`). Harness: `envelope.spec.ts:61-77` — fresh join's first event is `lobby:snapshot` with `seq === 1` and `payload.ownName === 'bruno'` | ✅ |
| REG-18 | Buzzer → lobby → re-deal: envelope + continuity unaffected | `TurnoverRoom.test.ts:430-458` (REG-18) — `reStarted.seq === buzzer.seq + 1` and `reDealt.seq === reStarted.seq + 1` across the phase transition on the same connection; also `router.test.ts:77-85` (counter survives `forget` semantics at the seam) | ✅ |
| REG-19 | Rule 5 names the registry, retires grep; walk asserts valid policies | `.opencode/skills/turnover-protocol/SKILL.md:24-33` — "declared exactly once in `PROTOCOL_REGISTRY` (`packages/shared/src/protocol/registry.ts`) under its `recipients` field — the registry IS the audit surface; read it, do not grep", plus envelope + wire-name-as-tag + denylist-test notes; conventions section updated (lines 37-41). Walk half: `registry.test.ts:66-70` — every entry's `recipients` ∈ `['all','self']` | ✅ |
| REG-20 | Every entry declares a valid policy; every policy in use has a Router implementation | Valid policy: `registry.test.ts:66-70` (runtime walk) + compile-time closed enum (`registry.ts:23`). Router coverage of both policies: `router.ts:74-80` implements `'self'` and `'all'` branches; `KeysWith<R>` (`registry.ts:124-126`) makes a policy-keyed helper call a compile error (`router.ts:53-60` `toSelf`/`toAll`) — a policy with no implementation cannot be declared without a compile/unittest failure against the enum | ✅ |

Pre-existing scenarios (spec Goal 3): `server:lobby_join` (TurnoverRoom.test.ts:79-172),
`sim:role_deal` server half (:228-396), `server:lobby_churn` (:463-551),
`client:lobby_join`/`client:round_start` (harness lobby/round specs) — all green in
the verifier's own runs.

---

## 3. Spec-precision deviation — judged

The design (design.md Risks row 1) records: server-side tests' **wire decoding** was
updated mechanically; scenario **names and semantics** unmodified; client harness
specs truly unmodified.

Verified against `git diff 12c3d9c..HEAD -- apps/server/src/rooms/TurnoverRoom.test.ts`:

- `collect()` (:46-54) and `collectAll()` (:187-199) now unwrap the envelope —
  mechanical, as recorded.
- The only assertion-content changes are `['role','type'] → ['role']` and
  `['playerIds','type'] → ['playerIds']` (REG-08's mandated shape change) plus
  comment additions. Scenario names (`server:lobby_join`, `sim:role_deal (server)`,
  `server:lobby_churn`), test titles, and all semantic expectations (roster order,
  rejection codes, saboteur counts, phase transitions) are untouched.
- Client harness: `boot.spec.ts`, `lobby.spec.ts`, `round.spec.ts` have **zero diff**
  in the range; the only new harness file is `envelope.spec.ts`.

**Judgment: the deviation is exactly as described.** Accepted as a legitimate
spec-precision correction (the spec's "unmodified" collided with its own accepted
wire change).

---

## 4. Discrimination sensor (scratch copy, discarded afterwards)

Setup: `rsync` (excl. `node_modules`/`.git`) → `/tmp/opencode/sensor-checkout`,
symlinked root + per-package `node_modules`; `pnpm typecheck` exit 0 before
mutating. All mutants reverted/discarded; real-tree `git status --porcelain`
afterwards = baseline (` M package.json`, `?? .playwright-mcp/`, `?? scripts/`) ✅.

| Mutant (behavior-level) | Result | Killed by |
| --- | --- | --- |
| (a) Router delivers `role:dealt` (self policy) to all clients | **KILLED** — `pnpm test:sim` exit 1, 6 failures | `router.test.ts` REG-09; `TurnoverRoom.test.ts` LOBBY-01, DEAL-01/02, REG-18 continuity, CHURN-02, integration sweep |
| (b) Broadcast uses ONE global seq counter, incremented per delivery (not per-connection) | **KILLED** — `pnpm test:sim` exit 1, 4 failures | `TurnoverRoom.test.ts` REG-06 + REG-18; `router.test.ts` REG-07 + REG-17 seam |
| (b-weak) Broadcast assigns the *first* client's next seq to all connections (counters stay synchronized) | **SURVIVED** — `pnpm test:sim` exit 0 (94/94) | none — see Gap 3 |
| (c) Client drops the seq-continuity check (accepts every envelope) | **KILLED** — `pnpm test:client` exit 1, 2 failures | `client:envelope_gap` (envelope.spec.ts:27) + cascade in round.spec LIGHT-09 |
| (d) Server seq starts at 0 instead of 1 | **KILLED** — `pnpm test:sim` exit 1, 6 failures | `router.test.ts` REG-06/REG-07/REG-17-seam/self-path; `TurnoverRoom.test.ts` REG-06 + REG-18 |
| Compile probe: delete `round:buzzer` registry row (REG-02) | **KILLED** — `tsc` exit 2 (TS1360) | gate 1 exhaustiveness typing |
| Compile probe: delete `round:buzzer` mapper (REG-12) | **KILLED** — `tsc` exit 2 (TS2741) | gate 1 `Record<RegistryKey, Mapper>` |

Scratch deleted (`rm -rf`); no sensor artifacts remain anywhere.

---

## 5. Spec-precision gaps (low severity, PASS not affected)

1. **Messages-test file disposition vs task wording** (cosmetic). T1 says "update
   `messages.test.ts`"; the diff shows it **deleted** (−50) with its LOBBY-01/DEAL-02
   payload-shape assertions folded into `registry.test.ts:14-50`. Coverage is
   preserved 1:1; only the task wording is imprecise.
2. **Transport-level `type` key on the SDK side.** `TurnoverRoom.test.ts:412-415`
   documents that Colyseus 0.18 merges the wire name into the delivered message
   object as `type`, so the client-observed envelope carries four keys
   (`payload,seq,time,type`). This is SDK transport behavior, not an in-payload
   literal: `connection.ts:63-71` reads only `seq/time/payload`, and payloads are
   asserted type-less (REG-08's letter — "payloads SHALL NOT carry an in-payload
   `type` literal" — holds). Worth a line in CONTEXT/protocol docs someday; not a
   spec violation.
3. **Weak seq-counter mutant survives (REG-07, strictest reading).** A mutant that
   assigns the first recipient's next seq to every connection keeps all per-
   connection streams *consecutive* (which is what REG-16/REG-17's gap detector
   actually protects) but does not give "each connection its own next seq" when
   counters have diverged (e.g., host ahead of late joiners). No test observes a
   divergence-and-broadcast case with absolute cross-connection values. The strong
   mutant (shared global counter) is killed, and client-visible continuity — the
   security/product-relevant property — is fully discriminated. Suggested future
   tightening: in `TurnoverRoom.test.ts` REG-06, assert the host's `started.seq` is
   exactly the last joiner's `started.seq + 3` (absolute divergence), which kills
   the weak mutant too.

## 6. Ranked gap list (fix-task candidates)

1. (Low) REG-07 absolute-divergence assertion missing — weak counter mutant survives; add one absolute-seq assertion in the live REG-06 test.
2. (Info) SDK-injected `type` key on delivered messages vs "envelope is `{seq,time,payload}`" wording — document as transport behavior.
3. (Info) T1 task wording "update messages.test.ts" vs actual delete-and-fold.

Items 2–3 are documentation/wording only; item 1 is a test-tightening nicety. None
blocks PASS.
