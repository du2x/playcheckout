# Work Channels (cycle 2.5) — Validation Report

**Verifier**: independent (author ≠ verifier; all evidence re-derived from the tree).
**Diff range**: `530ea86..HEAD` (6169498, 69c20b3, 6809073, 9e21451, e03c013, 94621ae, f30e563).
**Date**: 2026-08-28.

## Verdict: **PASS** (with 2 low/medium-severity gaps listed below; no fix required to pass)

---

## Gate evidence (re-run by verifier, exit codes recorded)

| Gate | Command | Result |
|---|---|---|
| 1a | `pnpm typecheck` | exit 0 — 4 workspace projects compile |
| 1b | `pnpm lint` | exit 0 — Biome, 76 files, no fixes |
| 2 | `pnpm test:sim` | exit 0 — **160 tests / 15 files passed** (11.4 s) |
| 3 | `pnpm test:client` | exit 0 — **20 passed** (59 s); the `name taken`/`room full` server logs are expected negative-path fixtures |
| 4 | human 5-min round | **open** (player-facing change) — owner's responsibility, not verifier-runnable |

**Test-count delta vs pre-feature baseline (123 tests / 14 files): +37 tests, +1 file** — the +1 file is `packages/sim/src/work.test.ts` (12 tests); the rest are additions to `registry.test.ts`, `router.test.ts`, `TurnoverRoom.test.ts`, `movement.test.ts`, `roundSim.test.ts`, `layout.test.ts`, `mappers.test.ts`, and `apps/client/harness/work.spec.ts`.

---

## Per-AC evidence (WORK-01..22) — file:line + assertion

| AC | Spec outcome | Evidence (file:line, assertion) |
|---|---|---|
| WORK-01 | Staff prep = exactly 100 ticks, `work:started` self | `packages/sim/src/work.test.ts:43` `expect(sim.tick(here)).toEqual([{ type: 'work:started', …, seconds: 5 }])`; `:50` completion lands exactly on tick 100; `:55` `expect(PREP_TICKS).toBe(100)`; `:56` `expect(TICK_HZ).toBe(20)` |
| WORK-02 | fresh \| trashed → prepped + `work:ended` 'completed' | `work.test.ts:50-54` (`room:prepped` + `work:ended completed` in one tick); `:77-80` trashed→prepped re-prep; server e2e `apps/server/src/rooms/TurnoverRoom.test.ts:822-858` |
| WORK-03 | All rejections, no channel events | `work.test.ts:88-107` (`'not-in-room'` ×3 incl. wrong-floor, `'channel-active'`, `'room-not-workable'`); server: `TurnoverRoom.test.ts:913-944` (`'round-not-active'`, `'not-in-room'`, `'channel-active'`, `'room-not-workable'`) |
| WORK-04 | Un-prep = exactly 60 ticks, `work:started` self | `work.test.ts:194` `toEqual([{ type: 'work:started', …, seconds: 3 }])`; `:205` `expect(UNPREP_TICKS).toBe(60)`; server e2e `TurnoverRoom.test.ts:976-982` (`seconds: 3`) |
| WORK-05 | prepped → trashed + `work:ended` completed | `work.test.ts:200-204` (`room:trashed` + `work:ended`); `TurnoverRoom.test.ts:983-988` (occupant staff also sees `room:trashed`) |
| WORK-06 | Re-trash unlimited, no counter | `work.test.ts:59-86` — full prep→unprep→prep→unprep loop; second un-prep accepted at `:83` after prior re-trash |
| WORK-07 | Staff rejected on prepped room | `work.test.ts:218` `expect(sim.startWork('ada', 'floor1', R1)).toBe('room-not-workable')` |
| WORK-08 | Fake = 100 ticks, no state change | `work.test.ts:232-243` — same `work:started seconds 5`, `done` equals ONLY `work:ended completed` (`:240`), `stateOf` stays `'fresh'` (`:243`) |
| WORK-09 | No room transition for fake, both start states | `work.test.ts:246-266` (fake on trashed stays trashed, `:265`); server: `TurnoverRoom.test.ts:1006` `waitFor('room:prepped', 300)` rejects |
| WORK-10 | Channels indistinguishable; no kind/role in payloads | `registry.test.ts:161-187` — `work:started` payload keys exactly `[floor, playerId, room, seconds]`, no kind/role; `work.test.ts:239` "The ONLY difference from a real prep: no room transition"; harness `apps/client/harness/work.spec.ts:216-221` scene contract unchanged (4 rects + 2 ellipses); `ChannelKind` is module-private to `work.ts:23` (grep: no export, never in a payload) |
| WORK-11 | Walk-out cancels on exit tick, exactly one `work:ended` | `work.test.ts:121-123` `expect(workOf(exit, 'work:ended')).toEqual([{ …, outcome: 'cancelled' }])` (toEqual ⇒ exactly one); `:124` state unchanged; `:126-130` subsequent silence |
| WORK-12 | Leave mid-channel: silent drop | `work.test.ts:156-170` — after `sim.leave('ada')`, ticks 1..PREP_TICKS+5 emit `[]`, state stays `'fresh'`; wiring `TurnoverRoom.ts:172-175` `onLeave → sim?.leave()` |
| WORK-13 | Buzzer kills channel silently | `packages/sim/src/roundSim.test.ts:126` `expect(buzzerEvents.some((e) => e.type === 'work:ended')).toBe(false)` + post-buzzer silence `:127`; server: `TurnoverRoom.test.ts:1035` `waitFor('work:ended', 300)` rejects after buzzer, `:1038` post-buzzer start → `'round-not-active'` |
| WORK-14 | `room:observed` on entry only, none outside | `work.test.ts:270-291` (entry observes, standing/outside/lobby observe nothing, re-entry re-observes); `registry.test.ts:207-222` payload shape; server `TurnoverRoom.test.ts:843-850` |
| WORK-15 | Transitions to `occupants` only | `apps/server/src/rooms/router.test.ts:150` `expect(sameFloorOtherRoom.sent).toEqual([])` + `:153` payload `{floor, room}`; registry visibility `registry.test.ts:196,203` (`roomKey: 'floor2:5'`); in-vivo `TurnoverRoom.test.ts:899-902` (same-floor other-segment tab: no `room:prepped`/`work:started`/`work:ended`) |
| WORK-16 | No interior for non-occupied rooms, no roles/cross-floor | `registry.test.ts:58-88` literal per-key policy walk (16 keys, exact policies incl. `sameFloor`/`occupants`); `:78` keys(pins) === keys(REGISTRY); harness `work.spec.ts:209-214` (guest tab: no interior/channel types, `#room-state` hidden) |
| WORK-17 | `player:moved` sameFloor only; rider silence in-car | `router.test.ts:127-128` `expect(lobbyViewer.sent).toEqual([])`, `expect(rider.sent).toEqual([])`; `:129-136` floor1 viewer gets the full payload; in-vivo `TurnoverRoom.test.ts:601-638`; harness `work.spec.ts:111-117` (lobby tab's ada-move count frozen while ada walks floor1) |
| WORK-18 | Snapshot contains only own-floor players + both cars | `packages/sim/src/movement.test.ts:218` `expect(sim.snapshotForFloor('floor1').players).toEqual([])` (lobby-only players), `:214/:219` both cars always present; server `TurnoverRoom.test.ts:615-625` |
| WORK-19 | AC3: `elevator:called`/`moved`/`player:left` stay `all` — **covered**: `router.test.ts:156-169` (both viewers receive both). AC4: `player:left-floor` to departed-floor viewers — **PARTIAL, see Gap 1**: policy pinned `registry.test.ts:68` (`'player:left-floor': 'sameFloor'`), payload type `{playerId, floor}` with no destination (`messages.ts:108-111`), emission exists (`movement.ts:300`) — but no behavioral test asserts emission/routing/payload |
| WORK-20 | Decoy-flash `car` value literal | `movement.test.ts:349-350` `expect(called[1]).toEqual({ type: 'elevator:called', floor: 'lobby', car: 1 })` — both flashes name the targeting car |
| WORK-21 | Pinned-at-wall + intent ⇒ silence | `movement.test.ts:116` `for (let i = 0; i < 5; i++) expect(sim.tick()).toEqual([])` with intent still held |
| WORK-22 | MOVE-06 positive half: walking on floor1 displaces x | `movement.test.ts:134-137` — `player:moved` emitted on floor1, `lastX` = 3.0 tiles after 10 ticks |

**AD-010 geometry**: `layout.test.ts:33-51` — 8 × 3.5 tiles [1,29]; segments [1000, 29000] contiguous; half-open membership with inclusive last-room end (999→0, 1000→1, 4499→1, 4500→2, 29000→8, 29001→0). `roomIndexAtMilli` is the single predicate used by start (work.ts:73), cancel (work.ts:126), observation (work.ts:174), and the client (WorldScene.ts:143) — the spec's boundary edge case is structurally satisfied.

**Tuning integrity**: `git diff 530ea86..HEAD -- packages/shared/src/tuning.ts` is empty; `PREP_SECONDS: 5`, `UNPREP_SECONDS: 3` unchanged (prd §7). No tuning edits in the range.

---

## Discrimination sensor

Scratch: rsync of the tree to `/tmp/verifier-work` (excl. node_modules/.git/.playwright-mcp/test-results/dist), fresh `pnpm install`, baseline suite green (160/15). 12 behavior-level mutants injected one at a time, each confirmed applied by grep before the run; scratch deleted afterwards; real tree `git status --porcelain` re-checked identical to baseline (`M .specs/STATE.md`, `M package.json`, `?? .playwright-mcp/`, `?? scripts/`).

| # | Mutant | Injected at | Killed by | Result |
|---|---|---|---|---|
| M1 | PREP channel 100→101 ticks | `work.ts:16` | `work.test.ts:47-56` exact-tick walk + `PREP_TICKS===100` pin (2 failures) | KILLED |
| M2 | Fake prep emits a `room:prepped` transition | `work.ts` completion | `work.test.ts:240` `done` equals only `work:ended` | KILLED |
| M3 | Walk-out cancel emits no `work:ended` | `work.ts:129` | `work.test.ts:121` `workOf(exit, 'work:ended')` toEqual | KILLED |
| M3b | Walk-out emits TWO `work:ended` | `work.ts` cancel block | same `toEqual` (exactly-one) | KILLED |
| M4 | `startWork` accepts players outside the segment | `work.ts:73` segment check dropped | `work.test.ts:88-107` (lobby/wrong-floor rejections) | KILLED |
| M5 | Staff can un-prep (role matrix flipped) | `work.ts:85` | `work.test.ts:218` `'room-not-workable'` | KILLED |
| M5b | Saboteur fake becomes real prep | `work.ts:82` | `work.test.ts:243` state must stay `'fresh'` | KILLED |
| M6 | Router `sameFloor` delivers to ALL | `router.ts:108-114` | `router.test.ts:127` `lobbyViewer.sent` empty | KILLED |
| M7 | Router `occupants` delivers to everyone | `router.ts:116-122` | `router.test.ts:150` + `TurnoverRoom.test.ts:899-902` | KILLED |
| M8 | `snapshotForFloor` returns all players | `movement.ts:231` | `movement.test.ts:218` `players` `toEqual([])` | KILLED |
| M9 | `roomIndexAtMilli` off-by-one at segment start (open→closed) | `layout.ts:40` | `layout.test.ts:44` `roomIndexAtMilli(1000)` must be 1 | KILLED |
| M10 | Client room index off-by-one (`startWorkHere` +1) | `WorldScene.ts:143` | `pnpm playwright test work` in scratch: server rejects the intent → progress bar never appears → `work.spec.ts:126` timeout (**1 failed / 19 passed** — the failure is the mutant) | KILLED |

**Sensor result: 12 injected / 12 killed / 0 confirmed survivors.**
Analytical survivor (not injected, derived from grep evidence): deleting the `player:left-floor` emission at `movement.ts:300` would survive the entire suite — no test references that event outside the registry policy pin. That is Gap 1 below.

---

## Ranked gaps

1. **Gap 1 — MEDIUM. WORK-19 AC4 (`player:left-floor`) has no behavioral assertion.** The registry pins its policy (`registry.test.ts:68`) and the payload type carries no destination (`messages.ts:108-111`), but nothing asserts that departure by elevator actually *emits* the event, that it reaches the departed floor's viewers, or that the payload stays `{playerId, floor}`. A mutant removing the emission (`movement.ts:300`) or corrupting the payload would pass the whole suite. Suggested fix task: one movement-sim test (rider departs floor X ⇒ exactly one `player:left-floor` with `floor: X`) + a registry projection test mirroring the `player:moved` visibility test (`registry.test.ts:149-159`).
2. **Gap 2 — LOW (spec precision, doc-only). Movement spec not amended for AD-009.** `.specs/features/movement/spec.md:68` (MOVE-03 AC3) still reads "the server SHALL broadcast a `player:moved` event … **to all players**" and `:139` (MOVE-18) still says the snapshot contains "every connected player's" positions — both superseded by AD-009's `sameFloor`/own-floor routing (`.specs/STATE.md` AD-009). The shipped code and its tests are correct; the stale AC text now contradicts them. A one-line amendment to the movement spec (citing AD-009) closes it; Goal 2's "positions are public" wording (line 16) is data-classification language and can stand, but the "to all players" delivery clause cannot.
3. **Gap 3 — INFO.** Harness assertion `work.spec.ts:177` `expect(observed?.room).toBeGreaterThanOrEqual(1)` is looser than the server-side exact pins (room 1); acceptable since the server tests and shared geometry pin the value exactly.

## Code-quality observations

- **Minimum code / deep modules**: `Router.route()` never names a message type — policy + projection + visibility all come from the registry row (`router.ts:69-78`); adding a message type cannot add a send path. `WorkChannels` takes positions as *input* per tick (no I/O, no clocks) and stays deterministic (bit-for-bit replay test, `work.test.ts:293-318`).
- **Protocol hygiene (turnover-protocol)**: registry is the single audit surface; the literal per-key policy walk (`registry.test.ts:81-88`) fails on any single-key drift, and undeclared sim events are compile errors (`registry.ts:266-268`). `ChannelKind` never leaves `work.ts`. Bypass denylist (`router.test.ts:175-187`) confirms the Router is the only sender. No leak found in any payload: no roles, no grace, no "fake", no cross-floor positions, no non-occupied interiors.
- **Amendments judged legitimate**: AD-009 is recorded in `.specs/STATE.md:159-189` with reasoning; the 2.4-era test amendments (registry pins → `sameFloor`, snapshot wording) are deliberate and consistent. The only unamended artifact is the movement spec text itself (Gap 2).
- Concurrent same-tick completions apply in channel-start order deterministically (`work.test.ts:133-154`, `work.ts:139-165`).
