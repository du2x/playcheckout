# Justice (cycle 2.8) — Validation Report

**Verifier**: independent (author ≠ verifier; all evidence re-derived from the tree).
**Diff range**: `9a96027..cb30989` (spec docs commit 9a96027; 8 implementation commits c586298 protocol → 39afe10 sim walk-in → 6646472 sim accuse → d239ca3 server → b6ff9c5/452a26d client → d3b3674 harness → 42ec37d deferred gaps → cb30989 style). Prior state 56261e3. HEAD at verification: `cb30989`.
**Date**: 2026-08-29.

## Verdict: **PASS** (2 MEDIUM test-coverage gaps found by the sensor — both test-only, neither a spec violation in shipped behavior; 2 INFO notes)
**Result**: PASS

---

## Gate evidence (re-run by verifier, exit codes recorded)

| Gate | Command | Result |
|---|---|---|
| 1a | `pnpm typecheck` | exit 0 — 4 workspace projects compile |
| 2 | `pnpm test:sim` | exit 0 — **286 tests / 21 files passed** (21.9 s), matches the expected 286/286 |
| 3 | `pnpm test:client` | exit 0 — **27 passed** (1.4 m), matches the expected 27/27; includes `client:accuse_ui` |
| 4 | human 5-min round | **open** (player-facing change) — owner's responsibility, not verifier-runnable |

**Tuning integrity**: `git diff 9a96027..cb30989 -- packages/shared/src/tuning.ts` is **empty**. `ACCUSATION_RANGE_TILES: 2` (tuning.ts:30) is consumed as `TUNING.ACCUSATION_RANGE_TILES * 1000` (roundSim.ts:179, server-side) and as a tile-integer client mirror only (WorldScene.ts:473). The 400 ms hold threshold lives in client code (`ACCUSE_HOLD_MS`, accuseSession.ts:23) and is **absent from TUNING** (grep confirms) — spec Success Criterion met.

---

## Protocol / leak audit (hard rule; FR-18 name-only)

- **Sim event carries `reason` server-internally** (`packages/shared/src/protocol/simEvents.ts:59-63`: `player:fired {playerId, reason: FireReason}`; `FireReason` at :69-72 documented "server-internal only, never projected").
- **Registry row**: `packages/shared/src/protocol/registry.ts:350-357` — `'player:fired': { payload: {} as PlayerFired, recipients: 'all', fromSim → { playerId: event.playerId } }`. The projection drops `reason`; the row's payload type is `PlayerFired` (`messages.ts:243-250`, `playerId` only), so a reason-bearing payload is also a type error.
- **Registry exhaustiveness intact**: `registry.ts:358-361` `satisfies { [K in RegistryKey]: Entry<K> } & { [K in SimEvent['type'] | MovementEvent['type']]: unknown }` — an undeclared sim event still fails compilation (unchanged from 2.7).
- **Router never names a message type** (`router.ts:54-56` header, route driven by the registry row); `'all'` dispatch is the generic path (`router.ts:96-97`).
- **Client mapper is name-only**: `apps/client/src/net/mappers.ts:45` `'player:fired': ({ playerId }) => [{ type: 'player-fired', playerId }]` — destructures `playerId` only; `state.ts:83-85` view action carries `playerId` only. No grace, reason, or role field exists anywhere client-bound; grep over registry/router/mappers finds `reason` only in the sim event, a projection-stripping comment, and the internal `AccuseRejection` union (which never leaves the room except as a free-text human message, `TurnoverRoom.ts:148-162`).
- **Wire payload `{playerId}` asserted on every path**: registry projection test (`registry.test.ts:371-387`, key walk `['playerId']` + `not.toContain('reason'/'valid'/'role')`), server integration (`TurnoverRoom.test.ts:1654-1660` for every connection, plus :1777-1781 on the wrong-accusation path), harness payload audit (`justice.spec.ts:150-156`, `Object.keys(payload)` `['playerId']`).

---

## Per-AC evidence — file:line + assertion

### P1: Walk-in conviction (JUST-01..05)

| AC | Spec outcome | Evidence (file:line, assertion) |
|---|---|---|
| P1 AC1 (JUST-01) | Live entrant into an un-prepping room's segment (pass-through incl.) → saboteur fired same tick, `player:fired` to all | `packages/sim/src/justice.test.ts:62-71` — mid-channel entry tick returns exactly `[{ type: 'player:fired', playerId: saboteur, reason: 'walkin' }]`; same-tick-as-completion edge `:136-141` (conviction + `room:trashed` both). Segment diff is positional (pass-through needs no stop — entry = segment-key change, `roundSim.ts:115-124`). All-policy delivery: `registry.test.ts:372-373` `row.recipients` `toBe('all')` via the literal walk `:117`; behavioral e2e `TurnoverRoom.test.ts:1652-1660` (every connection receives it) |
| P1 AC2 (JUST-02) | Channel owner's own entry fires nobody | `justice.test.ts:77-95` — walk-out then re-entry loop `:92-94` `firedOf(...)` `toEqual([])` for 20 ticks; guard `justice.ts:63` (`channelOwnerId === entrantId → null`) |
| P1 AC3 (JUST-03) | Entry after completion / never-started fires nobody | `justice.test.ts:97-118` — post-`UNPREP_TICKS` entry `:116-117` `firedOf(entry)` `toEqual([])`; no-channel entry structurally null (`activeUnprepOwner` returns null, `work.ts:84-93`) |
| P1 AC4 (JUST-04) | Pending channels cancelled silently, movement stops, rectangle removed client-side | Sim: `justice.test.ts:74` no `work:ended` names the fired saboteur (`toEqual([])`); `work.leave` on drain `roundSim.ts:134-138`; stale-position filtering `roundSim.ts:105-110` pinned `justice.test.ts:144-179` (`:170` `toHaveLength(1)`, `:177` `firedOf` `toEqual([])` across 10 ticks). Server teardown: `TurnoverRoom.ts:344-347` (`fired.add` + `movement.leave`). Client: `WorldScene.ts:357-366` `removePlayerDisplay` destroys rect+label on `player-fired`; harness `justice.spec.ts:162-174` (Text label gone on every page — destroyed, not hidden). **Room-side "no further positional streams" leg is weakly pinned → Gap 2 (sensor M-j)** |
| P1 AC5 (JUST-05) | No payload names reason / entrant / role — wire payload `{playerId}` exactly | See leak audit: `registry.test.ts:379-387` (payload `toEqual({playerId:'p3'})`, key walk, `not.toContain`), `TurnoverRoom.test.ts:1655-1659` (`not.toHaveProperty('reason')`, `not.toHaveProperty('valid')`), `justice.spec.ts:150-156`. Entrant never appears in any payload shape (`PlayerFired` has one field) |

### P2: Accusation (JUST-06..11)

| AC | Spec outcome | Evidence (file:line, assertion) |
|---|---|---|
| P2 AC1 (JUST-06) | Live staff accuses live target in range, same floor, round active → resolves on that tick | `justice.test.ts:253` `sim.accuse(a, saboteur)` `toBe('resolved')` post-grace; guards ordered `roundSim.ts:169-190`; server handler `TurnoverRoom.ts:139-162` (phase gate + `sim.accuse`) |
| P2 AC2 (JUST-07) | Target is saboteur AND ≥1 completed un-prep → saboteur fired | `justice.test.ts:246-259` — `roomWithTrashedRoom1` pins grace end on `room:trashed` (`:242`), then `:257-259` fired `toEqual([{playerId: saboteur, reason: 'correct-accusation'}])`; validity rule `justice.ts:77-84` |
| P2 AC3 (JUST-08) | Innocent target OR in-grace saboteur → ACCUSER fired, byte-identical, no distinguishing payload | Innocent: `justice.test.ts:262-282` (`:275` `reason: 'wrong-accusation'`); in-grace: `:284-296` (`:292` same reason; `:295` key walk `['playerId','reason','type']` — "byte-identical shape"). Grace is hidden state (`justice.ts:25,41-43`); only `graceEnded` reads it. **Grace-timing boundary (start vs completion) not discriminated → Gap 1 (sensor M-e)** |
| P2 AC4 (JUST-09) | Reject: saboteur accuser / fired accuser / round inactive / target not live / self / out-of-range / other floor — error, nobody fires | `justice.test.ts:298-324` — `:307` `'round-not-active'`, `:311` `'accuser-is-saboteur'`, `:313` `'self-target'`, `:315` `'target-not-live'`, `:317-318` other-floor `'out-of-range'` (dist 0, floors differ), `:321-322` 2001-milli `'out-of-range'`; `:323` `firedOf` `toEqual([])`; fired accuser `:346` `'accuser-not-live'`; post-buzzer `:349-351`. Server 1:1 error mapping `TurnoverRoom.ts:145-162` (`code: 'justice-rejected'`, distinct human messages); e2e rejections `TurnoverRoom.test.ts:1746-1760` |
| P2 AC5 (JUST-10) | Exactly one `player:fired` per resolution — never two, never zero | `justice.test.ts:170` `toHaveLength(1)` (walk-in), `:364-365` simultaneous accusations `toHaveLength(1)`, firing_toast `:385/:402/:411` `toHaveLength(1)` on all three paths; `fire()` is idempotent on the fired set (`justice.ts:91-95`) |
| P2 AC6 (JUST-11) | Fired player's cleanup (channels cancelled silently, movement stopped) on the resolution tick | `justice.test.ts:276-280` — accusing mid-prep player: next tick no `work:ended` for them (`toEqual([])`); teardown order `roundSim.ts:134-138` (drain → `work.leave` → segment memory drop) inside the same `tick()`; server `movement.leave` `TurnoverRoom.ts:346` (see Gap 2) |

### P3: Firing feedback (JUST-12..15)

| AC | Spec outcome | Evidence (file:line, assertion) |
|---|---|---|
| P3 AC1 (JUST-12) | Any firing → exactly one `player:fired` to ALL incl. the fired player, resolution tick | `justice.test.ts:369-421` (`sim:firing_toast`) — all three paths `toHaveLength(1)`; `'all'` policy pinned `registry.test.ts:117`; fired-player-inclusive delivery is the all-broadcast itself (server `TurnoverRoom.test.ts:1652-1660` iterates every collector incl. the fired one on the correct-accusation path) |
| P3 AC2 (JUST-13) | Payload = id + nothing else | `registry.test.ts:381-387`; `TurnoverRoom.test.ts:1656-1659`; `justice.spec.ts:150-156` |
| P3 AC3 (JUST-14) | Registry declares `player:fired` under `'all'` with a dedicated payload type; no other message carries firing info | `registry.ts:350-357` + type `PlayerFired` (`messages.ts:243-250`); literal policy walk `registry.test.ts:114-126` pins all 23 keys — any drift fails; no other row projects a firing field (leak audit, read-verified) |
| P3 AC4 (JUST-15) | Client toast "X was fired" + rectangle removal; own client shows fired state, stops movement intents | Toast text: `accuseHud.ts:52` `` `${nameOf(t.playerId)} was fired` ``; harness `justice.spec.ts:140-149` (every page sees the exact text). Reducer: `accuseSession.test.ts:21-30` (toasts), `:32-46` (selfFired only for own id). Rectangle: `WorldScene.ts:356-366` + harness `:162-174`. Intent gates: `WorldScene.ts:419/:429/:437/:227/:486` (`beginMove`/`endMove`/`callElevator`/`startWorkHere`/`pressFloor` all `if (this.selfFired) return`); banner `accuseHud.ts:67-72`, harness `:159-160` |

### P4: Accusation UI (JUST-16..20)

| AC | Spec outcome | Evidence (file:line, assertion) |
|---|---|---|
| P4 AC1 (JUST-16) | Hold E ≥ 400 ms with a live in-range same-floor player → confirm menu naming them | Harness `justice.spec.ts:105-116` — `keyboard.down('e')`, menu visible, text `toMatch(/^accuse .+\?$/)` and `not.toContain(accuserName)`; timer `WorldScene.ts:447-459` (`ACCUSE_HOLD_MS` expiry → `nearestAccuseCandidate`); candidate rule mirrors server (same floor, ≤ `TUNING.ACCUSATION_RANGE_TILES`, excludes self/left, nearest, `WorldScene.ts:463-477`) |
| P4 AC2 (JUST-17) | Release before 400 ms → elevator call exactly as today, no menu | Harness `justice.spec.ts:89-101` — tap E → `elevator:called` event arrives AND `#accuse-menu` still `hidden` (`:100-101` `toBe(true)`); keyup path `WorldScene.ts:461-466` (`endAccuseHold` → `callElevator`) |
| P4 AC3 (JUST-18) | Confirm sends `accuse {targetId}`; cancel sends nothing | Confirm: `app.ts:225-228` (`confirmAccuse` → `connection.sendAccuse(menu.targetId)`, sender `connection.ts:120-122`); harness `:130-156` (confirm → toast + payload audit). Cancel: `app.ts:230-232` (reducer-only, no send); harness `:118-125` — menu closes, then 1000 ms wait, `player:fired` absent (`toBe(false)`) |
| P4 AC4 (JUST-19) | Error rejection → surfaced and menu closed without firing | Reducer `accuseSession.test.ts:73-81` (`intent-error` closes menu; identity when clean); `accuseSession.ts:79-83`; server emits the error `TurnoverRoom.ts:145-162`; harness rides the wrong-accusation confirm path (fires) — the reject-and-close leg is reducer-pinned, not harness-driven (INFO note 2) |
| P4 AC5 (JUST-20) | Name-only toast for every `player:fired` (harness gate) | `client:accuse_ui` `justice.spec.ts:140-156` — toast text per page + payload key audit `['playerId']` |

### JUST-21 — deferred gap assertions (T8)

| Leg | Evidence |
|---|---|
| LOBBY-02 no-create clause + LIGHT-02 unknown-code message | `TurnoverRoom.test.ts:1805-1813` — `joinById('ZZZZ')` rejects `/not found/i` twice, `instances.length` unchanged across both |
| LOBBY-05 roster byte-identical after name rejection | `:1814-1838` — two `/name taken/i` rejections, then a real third join shows roster exactly `['ada','bruno','caro']` |
| LIGHT-04 1-char name minimum | `:1839-1842` — `createRoom('a')` succeeds |
| Reject-then-start mutant + LIGHT-08 round-already-active | `:1845-1868` — non-host start → `not-host` error, phase still lobby; host start works; second start → `round-already-active`, phase still round |

### Spec Edge Cases

| Edge | Evidence |
|---|---|
| Same-tick entry as completion → conviction | `justice.test.ts:120-142` (sensor M-d killed by exactly this) |
| Two accusations same tick → first resolves, second rejected | `justice.test.ts:354-366` (`'resolved'` then `'target-not-live'`, one firing) |
| Saboteur fired by walk-in while accusation in flight → rejected | Guard pinned with a fired target: `justice.test.ts:363` `'target-not-live'` (roundSim.ts:174 — same line regardless of firing source); the walk-in-source variant itself is not directly asserted → INFO note 1 |
| Accuser leaves range between confirm and processing → server rejects on its own check | Server-authoritative range: `TurnoverRoom.test.ts:1756-1760` (lobby watcher vs floor1 worker → `justice-rejected`, message contains 'closer'); client is a mirror only (`WorldScene.ts:463-477` uses the same TUNING constant, no authority) |
| Fired player in an `occupants` projection receives nothing | Structural: `movement.leave` drops the position so `viewOf` nulls the context (`TurnoverRoom.ts:344-347`); the server test's positional window (`TurnoverRoom.test.ts:1710-1721`) asserts no `player:moved` reaches the fired viewer — but nobody moves in that window, so the assertion does not discriminate the teardown (sensor M-j survived) → **Gap 2** |
| Buzzer mid-grace kills grace with the round | `justice.test.ts:348-352` (`'round-not-active'` post-buzzer); sim nulled on buzzer `TurnoverRoom.ts:352-355`; grace dies with the Justice instance |

---

## Discrimination sensor

Scratch: rsync to `/tmp/opencode/verifier-justice` (excl. node_modules/.git/.playwright-mcp/dist/test-results), `pnpm install --prefer-offline --ignore-scripts` (5.1 s), targeted baseline green (40/40). 11 behavior-level mutants injected ONE AT A TIME, each confirmed applied by grep before the run; targeted vitest project (or harness) re-run per mutant. Scratch deleted; real tree `git status --porcelain` re-checked **byte-identical to baseline**, HEAD unchanged (`cb30989`).

| # | Mutant | Injected at | Killed by | Result |
|---|---|---|---|---|
| M-a | `player:fired` recipients `'all'` → `'sameFloor'` | registry.ts:352 | `registry.test.ts:117` literal policy walk + `:372-373` (2 failures) | KILLED |
| M-b | Projection forwards `reason` into the payload | registry.ts:355 | `registry.test.ts:381-387` payload key walk (1 failure) | KILLED |
| M-c | `walkIn` fires the ENTRANT instead of the channel owner | justice.ts:65 | `justice.test.ts:69-71` (fired playerId must be saboteur) + 2 more (3 failures) | KILLED |
| M-d | Walk-in detection moved AFTER `work.tick` | roundSim.ts:115-124 relocated | `justice.test.ts:120-142` same-tick entry-then-completion edge (exactly 1 failure) | KILLED |
| M-e | Grace flips on un-prep START instead of `room:trashed` completion | roundSim.ts:129 condition | — (full suite re-run: 286/286 still green) | **SURVIVED** |
| M-f1 | `accuse` drops the same-floor requirement | roundSim.ts:183 | `justice.test.ts:317-318` other-floor rejection at distance 0 (1 failure) | KILLED |
| M-f2 | Range boundary exclusive (`>=`) | roundSim.ts:184 | `justice.test.ts:326-335` inclusive-boundary test at exactly 2000 milli (1 failure) | KILLED |
| M-g | `ensureLive` guard removed from `move:start` | TurnoverRoom.ts:97 | `TurnoverRoom.test.ts:1679+` fired session's `move:start` must error `justice-rejected` (2 failures) | KILLED |
| M-h | Tap-E no longer sends the elevator call (`endAccuseHold` sends nothing) | WorldScene.ts:464 | harness `justice.spec.ts:89-101` (client-only behavior; no sim/room cover exists — harness run) | KILLED |
| M-i | `round-started` reset removed from accuseSession | accuseSession.ts:64 | `accuseSession.test.ts:84-90` (1 failure) | KILLED |
| M-j | Server teardown skips `movement.leave` for the fired player | TurnoverRoom.ts:346 | — (server:justice 3/3, full room file 49/49, harness 1/1 all still green) | **SURVIVED** |

**Sensor result: 11 injected / 9 killed / 2 survivors.** Both kills were by spec-anchored assertions (literal policy walks, exact payload keys, exact event arrays, boundary walks).

### Survivors → gaps (not fixed, per protocol)

1. **Gap 1 — MEDIUM (test-only, spec-precision).** The spec's recorded decision pins grace to the un-prep's **completion** ("starting-but-incomplete un-prep stays inside grace", spec.md Assumptions row 3). No test accuses the saboteur in the window between `work:started` (un-prep) and `room:trashed`, so an implementation that ends grace at un-prep *start* passes all 286 sim tests. Suggested fix: one sim test — start the saboteur's un-prep, tick partway, `accuse(staff, saboteur)` must still be **wrong** (accuser fired, `reason` absent from any payload), then let it complete and assert a second accusation would be correct.
2. **Gap 2 — MEDIUM (test-only, spec edge).** P1 AC4's "no further `player:moved` from them" and the occupants-projection edge case lean on the room-side `movement.leave` (`TurnoverRoom.ts:346`), but the only room assertion over fired-viewer traffic (`TurnoverRoom.test.ts:1710-1721`) runs while nobody moves — it cannot fail if the teardown is skipped (proven by M-j surviving the full room suite + harness). Suggested fix: in the teardown test, keep one live staff player walking on the fired player's floor after the firing, assert the fired viewer receives no `player:moved` and the live viewer's stream never contains the fired id.

### INFO notes

1. The edge "accusation in flight when the saboteur is fired **by walk-in**" is covered via the same `isFired(target)` guard with an accusation-fired target (`justice.test.ts:363`); the walk-in-source variant is not separately asserted. Mechanism-identical; negligible.
2. P4 AC4's reject-closes-menu leg is pinned at the reducer level (`accuseSession.test.ts:73-81`) and the server emits the mapped error (`TurnoverRoom.ts:145-162`), but the harness only exercises the confirm path end-to-end, not a rejection arriving while the menu is open. Reducer + server legs together make the risk low.

---

## Ranked gaps

1. **Gap 1 — MEDIUM (sensor M-e survivor, test-only):** grace end not discriminated against "ends at un-prep start". Spec assumption explicitly chooses completion; one missing sim test.
2. **Gap 2 — MEDIUM (sensor M-j survivor, test-only):** room-side fired-player movement teardown (`movement.leave`) not discriminated; the fired-viewer positional-silence edge is asserted only in a window with no traffic.
3. **Note 1 — INFO:** walk-in-source variant of the in-flight-accusation rejection not directly asserted (same guard line pinned with an accusation-fired target).
4. **Note 2 — INFO:** P4 AC4's menu-close-on-rejection leg not driven end-to-end in the harness (reducer-pinned + server-pinned).

## Code-quality observations

- The justice module is deep and small (96 lines): verdicts + fired set + hidden grace, no positions/clock/wire knowledge; RoundSim owns detection and teardown order, matching the design's tick-order decision (walk-out cancels → walk-in → completions → teardown).
- The Router still never names a message type; `player:fired` is one more registry row; undeclared sim events remain compile errors (`registry.ts:358-361`).
- Firing cleanup reuses WORK-12 (`work.leave`) rather than a parallel mechanism — no duplicated teardown semantics.
- Client keeps the one-state-home pattern (accuseSession reducer, identity-preserving returns) and the DOM-over-canvas HUD; the scene contract change is limited to rectangle/label destruction via a shared `removePlayerDisplay`.
- Buzzer path untouched by the diff (`roundSim.ts:140` unchanged; room still nulls the sim on buzzer) — Success Criterion "buzzer byte-identical to 2.7" holds structurally, and the 2.7 buzzer tests still pass inside 286/286.
