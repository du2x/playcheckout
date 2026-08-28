# Protocol Registry — Validation Report

**Feature**: protocol-registry (cycle 2.3, AD-006)
**Verifier**: independent (author ≠ verifier); all evidence re-derived from the tree
**Diff range**: `12c3d9c..HEAD` (a2fb865) — commits 8efdd81, 165ae93, 525f0fd, fa7a47c, 3c91d37, a2fb865
**Verdict**: **PASS** (0 blocking gaps; 3 low-severity notes below)

---

## Gate evidence (run by the verifier on the real tree)

| Gate | Command | Result |
| --- | --- | --- |
| 1 | `pnpm typecheck` | exit 0 (4 workspace projects: shared, sim, client, server) |
| 1 | `pnpm lint` | exit 0 (Biome, 69 files checked) |
| 2 | `pnpm test:sim` | exit 0 — **13 test files, 94 tests passed** (incl. `server:protocol_registry`, `server:lobby_join`, `sim:role_deal`, `server:lobby_churn`, registry/mapper/router unit tests) |
| 3 | `pnpm test:client` | exit 0 — **16 passed** (~32 s; incl. `client:lobby_join`, `client:round_start`, new `client:envelope_gap`); the webServer chain also ran the prod strip check (`--expect-absent` on the prod build, `--expect-present` on the harness bundle) |
| 4 | Human 5-minute round | N/A this cycle — behavior-preserving wire refactor, recorded in design.md (Tech Decisions, Gate 4 row) |

---

## Per-AC evidence table (REG-01..REG-20)

| Req | Spec AC (expected outcome) | Asserting test / gate | file:line | Assertion reproduced |
| --- | --- | --- | --- | --- |
| REG-01 | Every server→client type declared exactly once (wire name, payload type, policy) | `protocol registry` unit walk + registry const | `packages/shared/src/protocol/registry.test.ts:56` · `registry.ts:85-119` | `expect(Object.keys(PROTOCOL_REGISTRY).sort()).toEqual(['error','lobby:snapshot','role:dealt','round:buzzer','round:started'])`; each row carries `payload` type token + `recipients` |
| REG-02 | SimEvent type lacking a registry entry → workspace fails to compile | Gate 1 (`pnpm typecheck`) via `satisfies` | `packages/shared/src/protocol/registry.ts:119` | `as const satisfies { [K in RegistryKey]: Entry<K> } & { [K in SimEvent['type']]: unknown }` — verified by scratch experiment E2 (below): adding an undeclared sim event variant → `error TS1360 … does not satisfy` at registry.ts:119, typecheck exit 2 |
| REG-03 | Exactly the five pre-existing types with the spec'd policies, no new types | registry walk + per-key pins | `registry.test.ts:56-64` (keys); policies pinned: `registry.test.ts:95` (`round:started`→`'all'`), behaviorally `router.test.ts:65-75` (`role:dealt` self), `TurnoverRoom.test.ts:229-257` (buzzer to all), compile-time `KeysWith` call-site typing for `lobby:snapshot`/`error` (see note N3) | Key list exact; policy flips are compile errors at `toSelf`/`toAll` call sites (`TurnoverRoom.ts:103,119,145,153,160`) or test failures for sim keys |
| REG-04 | `BroadcastGameEvent`/`PrivateGameEvent` unions + `envelope.ts` deleted; registry is the only catalog | grep audit + diff | diff `12c3d9c..HEAD` (`envelope.ts` −31 lines); grep over `packages/*`, `apps/*` for `BroadcastGameEvent|PrivateGameEvent|ServerMessage` → zero hits; `protocol/index.ts` exports only messages/registry/simEvents/telemetry | Structural evidence: files gone, no importers |
| REG-05 | Per-room Router routes every sim event through one generic path, no per-type switch | router unit + source | `apps/server/src/rooms/router.ts:41-50`; denylist `router.test.ts:108-121` | `route()` looks up `PROTOCOL_REGISTRY[event.type]`, applies `fromSim` + `entry.recipients`; no type-naming switch; denylist asserts `expect(violations).toEqual([])` |
| REG-06 | Every message wrapped `{seq,time,payload}`, per-connection monotonic seq, server time ms | `server:protocol_registry` unit + live halves | `router.test.ts:34-50`; `TurnoverRoom.test.ts:402-428` | `expect(Object.keys(first).sort()).toEqual(['payload','seq','time'])`; `expect(first.seq).toBe(1)`; `expect(second.seq).toBe(2)`; `expect(typeof first.time).toBe('number')`; live: `expect(started.seq).toBeGreaterThan(0)`, `expect(dealt.seq).toBe(started.seq + 1)` |
| REG-07 | Broadcast to N connections → each connection its own next seq | router unit REG-07 test | `router.test.ts:52-63` | `expect(a.sent[0]?.message.seq).toBe(1)`; `expect(b.sent[0]?.message.seq).toBe(1)`; then both `toBe(2)` on the next broadcast |
| REG-08 | Payloads carry no in-payload `type`; wire name is the only tag | router unit + live + payload unit | `router.test.ts:49`; `TurnoverRoom.test.ts:418,420,443`; `registry.test.ts:24,32,38` | `expect(Object.keys(first.payload as object)).toEqual([])`; `expect(Object.keys(started.payload).sort()).toEqual(['playerIds'])`; `expect(Object.keys(dealt.payload).sort()).toEqual(['role'])` |
| REG-09 | `role:dealt` reaches only the named player — by declared policy, not a hand-written case | router unit REG-09 + `sim:role_deal` (server) | `router.test.ts:65-75`; `TurnoverRoom.test.ts:229-257` | `expect(a.sent).toEqual([])` with `expect(b.sent[0]?.type).toBe('role:dealt')`; live: exactly 1 saboteur across 4 private payloads, broadcast carries ids only |
| REG-10 | Bypass denylist: no raw `.send(`/`.broadcast(` outside the Router | `send bypass denylist` | `router.test.ts:108-121` | fs-walk over `apps/server/src/rooms/*.ts` (excl. tests + router.ts) matching `/\.send\(|\.broadcast\(/` → `expect(violations).toEqual([])` |
| REG-11 | Client unwraps envelope, verifies seq continuity, dispatches via pure wire-name-keyed mapper | mapper unit tests + connection source | `apps/client/src/net/mappers.test.ts:26-68`; `connection.ts:63-86` | Each mapper's output pinned through `reduce` (e.g. `expect(s.roundPlayerIds).toEqual(['p1','p2'])`, `expect(s.role).toBe('saboteur')`); `isGap` checks `envelope.seq === this.lastSeq + 1` |
| REG-12 | Registry key lacking a client mapper → fails to compile | Gate 1 via `Record<RegistryKey, Mapper>` | `apps/client/src/net/mappers.ts:11-13` | `{ [K in RegistryKey]: (payload: RegistryPayload<K>) => ViewAction[] }` — verified by scratch experiment E3 (below): deleting the `round:buzzer` row → `error TS2741: Property '"round:buzzer"' is missing`, typecheck exit 2 |
| REG-13 | `ServerMessage` union, per-type `onMessage` handlers, app.ts message switch deleted | grep + source | grep `ServerMessage` in `apps/client/src` → 0 hits; `app.ts:82-93` has only `onActions`/`onDisconnect`; single generic handler `connection.ts:63-71` | Structural evidence |
| REG-14 | Dev hook records every server message incl. envelope `seq`/`time` | `client:envelope_gap` + debug source | `debug.ts:40-50`; `connection.ts:66`; `envelope.spec.ts:67-77` | Hook stores `{ type, payload, seq, time, at }`; scenario asserts `expect(firstEvent?.seq).toBe(1)` |
| REG-15 | No `window.__TURNOVER__` in production builds | prod strip check in gate 3 chain | `apps/client/harness/playwright.config.ts:5,22-23`; `apps/client/scripts/check-prod-strip.mjs` | Strip check (`--expect-absent` on prod build) runs before every `pnpm test:client`; manual run `node check-prod-strip.mjs` → exit 0 |
| REG-16 | Non-consecutive seq → gap recorded in hook → rejoin via existing connection-loss path | `client:envelope_gap` | `apps/client/harness/envelope.spec.ts:48-57`; gap logic `connection.ts:78-86` | `await guest.waitForSelector('#lost-view')`; `expect(gaps).toHaveLength(1)`; `expect(gaps[0]?.expected).toBe((gaps[0]?.actual ?? 0) + 1000)` |
| REG-17 | Rejoin → seq tracking restarts with the new connection | `client:envelope_gap` rejoin half + router unit | `envelope.spec.ts:64-77`; `router.test.ts:77-85`; `router.ts:63-65` | `expect(firstEvent?.seq).toBe(1)`; `expect(firstEvent?.payload.ownName).toBe('bruno')`; `expect(a.sent.map(s => s.message.seq)).toEqual([1, 1])` after `forget()` |
| REG-18 | Buzzer → lobby: envelope stamping and seq continuity unaffected | `server:protocol_registry` continuity test | `TurnoverRoom.test.ts:430-458` | `expect(reStarted.seq).toBe(buzzer.seq + 1)`; `expect(reDealt.seq).toBe(reStarted.seq + 1)` |
| REG-19 | Rule 5 names the registry as audit surface, retires the grep convention | skill file content (a2fb865) | `.opencode/skills/turnover-protocol/SKILL.md:24-33` | Rule 5: "declared exactly once in `PROTOCOL_REGISTRY` (`packages/shared/src/protocol/registry.ts`) … the registry IS the audit surface; read it, do not grep" + Router-only-send + denylist test; conventions note the envelope and undeclared-sim-event compile failure (SKILL.md:37-41). Matches REG-19 AC |
| REG-20 | Registry walk: every entry declares a valid policy; every policy in use has a Router implementation | registry walk + router source | `registry.test.ts:66-70`; `router.ts:67-81` | `expect(['all','self'], \`policy of ${key}\`).toContain(entry.recipients)`; `dispatch` implements `self` (74-78) and `all` (79-80); `KeysWith` typing makes policy misuse a compile error |

---

## Discrimination sensor (scratch copy at /tmp/opencode/verifier-scratch, full `cp -a` incl. node_modules; discarded afterwards)

Scratch baseline: `pnpm test:sim` → 94/94 before injection. Real tree `git status --porcelain` after discard matches the pre-sensor baseline exactly (` M package.json`, `?? .playwright-mcp/`, `?? scripts/`).

| Mutant | Injection | Killed by | Result |
| --- | --- | --- | --- |
| (a) self-policy → broadcast | `dispatch()` self branch broadcasts to all clients | `router.test.ts` REG-09 (`expect(a.sent).toEqual([])`), `sim:role_deal` DEAL-01/02, LOBBY-01, CHURN-02, REG-18, integration sweep | **Killed** (7 tests failed, sim exit ≠ 0) |
| (b) one shared seq counter per broadcast (single increment per dispatch) | counter keyed `'*shared*'`, all recipients same seq | router REG-17-seam, TurnoverRoom REG-06/08, REG-18 | **Killed** (3 failed) |
| (b2) global counter incremented per delivery | counter keyed `'*global*'` in `deliver()` | `router.test.ts` REG-07 (`expect(b.sent[0]?.message.seq).toBe(1)` fails), REG-17-seam, REG-06/08, REG-18 | **Killed** (4 failed; REG-07 assertion directly) |
| (c) client seq-continuity check dropped | `isGap()` always returns false | `client:envelope_gap` — `#lost-view` timeout at `envelope.spec.ts:48` (no gap recorded, no leave) | **Killed** (test:client exit 1, 2 failed) |
| (d) seq starts at 0 | `const seq = get(sessionId) ?? 0` (send 0 first) | router REG-06 (`expect(first.seq).toBe(1)`), REG-07, REG-17-seam, self-envelope path, TurnoverRoom REG-06/08 (`toBeGreaterThan(0)`), REG-18 | **Killed** (6 failed) |
| E1: registry row deleted (`role:dealt`) | structural REG-02 check | `pnpm typecheck` exit 2 — TS1360 "does not satisfy" at registry.ts | **Killed** |
| E2: undeclared sim event added (`room:prepped`) | REG-02 exact direction | `pnpm typecheck` exit 2 — TS1360 at registry.ts:119 | **Killed** |
| E3: mapper row deleted (`round:buzzer`) | REG-12 | `pnpm typecheck` exit 2 — TS2741 property missing at mappers.ts:11 | **Killed** |

No surviving mutants.

---

## Spec-precision deviation review (design.md Risks row 1)

The recorded deviation is **as described**:

- Pre-existing server test changes are limited to wire decoding: `collect`/`collectAll` now unwrap the `{seq,time,payload}` envelope and the `['role','type']`/`['playerIds','type']` key assertions became `['role']`/`['playerIds']` (diff inspected hunk by hunk). Scenario names diff (`git show 12c3d9c:…` vs HEAD) shows **only additions** (the new `server:protocol_registry` describe) — zero renames or removals; semantics of pre-existing assertions unchanged.
- Client harness scenarios are truly unmodified: `git diff 12c3d9c..HEAD -- apps/client/harness/` shows only the new `envelope.spec.ts` (+82 lines).

## Spec-precision gaps / notes (all low severity, non-blocking)

- **N1 (cosmetic)**: `TurnoverRoom.test.ts:412-415` comments that "Colyseus 0.18 merges the wire name into the outgoing object as `type` at transport level", but the `type` key in the `['payload','seq','time','type']` assertion is added by the collector itself (`collectAll`, line 198). The assertion target is the collector's own record, so the test remains valid and the payload-side `type`-absence is still asserted; only the comment is misleading.
- **N2 (note)**: `registry.test.ts:66-70` asserts policy *membership* (`['all','self']`) per entry, not the literal per-key policy value. Coverage is nonetheless effectively complete: policy flips for room-originated keys are compile errors at `toSelf`/`toAll` call sites via `KeysWith` (verified by reading the mapped-type definition; registry.test.ts:95 pins `round:started` literally), and sim-key flips fail behaviorally (killed mutants (a)/(b)/(d) plus buzzer-visibility in `sim:role_deal`). A literal per-key policy walk would make this pinning direct rather than indirect.
- **N3 (note)**: `RegistryEntry<P>` (registry.ts:41-44) is exported but unused — the `satisfies` uses the local `Entry<K>` (line 73). Dead type declaration, no functional impact.

## Coverage summary

20/20 requirements evidenced (18 by named gate scenarios/unit tests, REG-02/REG-12 by gate 1 with scratch-verified kill experiments, REG-04/REG-13/REG-19 structurally + gate 1/gate 3). Gates 1–3 rerun by the verifier, all exit 0. Gate 4 N/A per design.md. Sensor: 8 mutants, 8 killed, real tree clean.
