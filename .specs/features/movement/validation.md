# Validation — movement (Phase 2 cycle 2.4, AD-005)

**Verdict: PASS** (4 ranked gaps below: 1 decision conflict needing adjudication,
2 surviving sensor mutants, 1 partial AC-coverage gap — none blocking)
**Result**: PASS
**Verifier**: independent sub-agent (author ≠ verifier); all evidence re-derived
from source and live gate/sensor runs.
**Diff range**: `c385bbc..HEAD` (branch master) — commits 0ed741e, 85000b5,
fb9e540, e045188, 4d8db03, bd58749, 71f47f2, c11ad83.
**Pre-sensor baseline** (`git status --porcelain`): ` M package.json`,
`?? .playwright-mcp/`, `?? scripts/` — unchanged after sensor cleanup ✅.

---

## 1. Task completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 shared protocol + tuning | ✅ Done | AD-007 recorded in `.specs/STATE.md`; 10-key registry |
| T2 MovementSim core | ✅ Done | `packages/sim/src/movement.ts` + `movement.test.ts` |
| T3 elevator cycle | ✅ Done | incl. 71f47f2 fix (FIFO dropped at buzzer) |
| T4 room wiring | ✅ Done | `TurnoverRoom.ts` + `server:movement` describe |
| T5 client world | ✅ Done | `WorldScene.ts` replaces `RoundScene.ts`, key `'Round'` kept |
| T6 harness `client:movement` | ✅ Done | `apps/client/harness/movement.spec.ts` (2 tests) |

Extra commit in range: 0ed741e (kills the 2.3 weak seq mutant — out-of-feature
but in-range; verified green, no conflict).

---

## 2. Gate evidence (re-run by the verifier, exit codes observed)

| Gate | Command | Result |
| --- | --- | --- |
| 1 (types) | `pnpm typecheck` | exit 0 (shared/sim/server/client `tsc --noEmit` all Done) |
| 1 (lint) | `pnpm lint` | exit 0 (biome, 73 files, no fixes) |
| 2 | `pnpm test:sim` | exit 0 — **Test Files 14 passed (14), Tests 123 passed (123), 2.35s** |
| 3 | `pnpm test:client` | exit 0 — **18 passed (35.7s)** incl. both `client:movement` tests (10.0s, 17.2s); pre-existing `client:round_start`/LIGHT-09 green unmodified |
| 4 (human) | N/A — pending | Player-facing; per STATE.md handoff, Gate 4 human round still open (carry-over from earlier cycles) |

Test-count integrity: 94 tests / 13 files before the feature (2.3 report) →
123 / 14 after. Delta **+29 tests, +1 file**; no deletions, no weakened
assertions observed in the diff.

---

## 3. Spec-anchored acceptance criteria (MOVE-01..19)

Spec-defined values re-derived: speed 6 tiles/s @ 20 Hz = **300 millitiles/tick**;
arrival = 3 s = **tick 60**; ride = 2 s/floor = **40 ticks/floor**; capacity **2**;
lobby clamp **0..30 tiles**; idle ticks emit **nothing**.

| ID | Spec AC (essence) | Evidence (`file:line` — assertion) | Result |
| --- | --- | --- | --- |
| MOVE-01 | hold dir → `move:start`; integrate at 6 tiles/s, 20 Hz | `packages/sim/src/movement.test.ts:23` — `expect(lastX(sim,'p1')).toBe(21)` (15 + 6.0 over 20 ticks); `:26-32` — first event `toMatchObject({playerId:'p1', x:15.3, facing:'right'})`; `:97-98` — `expect(TUNING.PLAYER_SPEED_TILES_PER_SEC).toBe(6)`, `expect(SPEED_MILLI_PER_TICK).toBe(300)`; client half `apps/client/harness/movement.spec.ts:107-108` — displacement within `(6±2)·TILE` for a 1 s hold | ✅ |
| MOVE-02 | release → `move:stop`; x frozen at current value | `movement.test.ts:53-62` — after `stopMove`, 5 ticks `toEqual([])` and `lastX === xAtStop` | ✅ |
| MOVE-03 | position change → `player:moved` (playerId, floor, x, facing) to all; no change → nothing | `movement.test.ts:26-32` payload fields asserted; `:64-69` — 10 idle ticks `toEqual([])`; `:82-84` — facing-flip-only tick emits exactly 1 event; server broadcast path `apps/server/src/rooms/TurnoverRoom.test.ts:616-621` — `playerId/floor/x>15/facing` on the host's collector | ✅ (see Gap 3: pinned-with-intent subcase undiscriminated) |
| MOVE-04 | lobby phase: floor stays `lobby`, x clamped 0..HALL_LENGTH_TILES | `movement.test.ts:87-96` — x pinned at `0` and `HALL_LENGTH_TILES` (asserted `toBe(30)`); `:124-129` — floor `toBe('lobby')`; client `movement.spec.ts:116-121` — label x ≤ 1 px after 4 s leftward hold | ✅ |
| MOVE-05 | pass-through, both positions broadcast | `movement.test.ts:101-122` — `expect(crossed).toBeGreaterThan(0)`, p1 ends beyond p2's parked x and vice versa | ✅ |
| MOVE-06 | round state: x unclamped per-floor; floor changes ONLY via elevator | Negative half: `movement.test.ts:124-135` (walking during round on lobby keeps floor); `movement.spec.ts:171-173` (non-rider's tab keeps lobby view; rider invisible cross-floor). **Positive half (walking on floor1..3 during round) has no test** | ⚠️ Gap 4 |
| MOVE-07 | round start keeps current x and floor | `movement.test.ts:132-135` — after `unlock()`, `lastX === xBefore + 0.3`, floor still `lobby`; server `TurnoverRoom.test.ts:656-662` — snapshot post-buzzer shows `floor 'lobby'`, `x > 15` (pre-round walk preserved through the round) | ✅ |
| MOVE-08 | buzzer: positions persist (non-lobby floor included); future movement re-confined to lobby | `movement.test.ts:323-328` — after `lock()` floor stays `floor1`, `startMove` refused, tick `toEqual([])`, x unchanged; client `movement.spec.ts:180-185` — post-buzzer intent leaves the other tabs' view of ada pixel-identical | ✅ |
| MOVE-09 | in-car move intent ignored | `movement.test.ts:292-309` — 20 ticks of intent in-car, `lastX` unchanged; rider exits at `floor2`, x `toBe(0)` | ✅ |
| MOVE-10 | call during round dispatches sooner car (tie → car 1), broadcast `elevator:called`(floor, car) | `movement.test.ts:177-179` — `'dispatched'` + next tick `toEqual([{type:'elevator:called', floor:'lobby', car:1}])`; `:267-290` — car 2 serves when car 1 busy; server `TurnoverRoom.test.ts:686-692` — payload `toEqual({floor:'lobby', car:1})` via the Router | ✅ |
| MOVE-11 | arrive after 3 s (tick 60); ride 2 s/floor (40 ticks) | `movement.test.ts:180-182` — 58 silent ticks then tick 60 `toEqual([{type:'elevator:moved', car:1, floor:'lobby'}])`; `:201-206` — 2-floor ride completes at tick 140 with the exact event array `[elevator:moved car 1 floor2, player:moved p1 floor2 x 0]` | ✅ |
| MOVE-12 | call for an already-targeted floor ignored for dispatch; panel still flashes | `movement.test.ts:251-264` — second call `'ignored'`; next tick exactly 2 `elevator:called`, 0 `elevator:moved`; exactly 1 arrival in 60 ticks | ✅ (see Gap 2: flash's `car` value unasserted) |
| MOVE-13 | board up to capacity 2; overflow waits for next arrival | `movement.test.ts:213-244` — p1+p3 (distance 0) board, p2 (0.3 tiles) stays `lobby` after the ride completes; capacity value `TUNING.ELEVATOR_CAPACITY` = 2 at `packages/shared/src/tuning.ts:23` | ✅ |
| MOVE-14 | car idle at destination until next call | `movement.test.ts:207-210` — post-ride snapshot `cars toEqual([{car:1,floor:'floor2'},{car:2,floor:'lobby'}])`; `:285-289` — exact per-tick event arrays show no spontaneous car movement (car 2 re-dispatches only when a queued call exists) | ✅ |
| MOVE-15 | ≤1 pending destination per car; overflow queues FIFO | `movement.test.ts:267-290` — third call with both cars busy returns `'dispatched'` (queued), flashes only at dispatch (tick 100), served by the first car to free (car 2) | ✅ |
| MOVE-16 | elevator events/panels carry car floor only — never occupant ids | `packages/shared/src/protocol/registry.test.ts:92-103` — `elevator:moved`/`elevator:called` payload keys `toEqual(['car','floor'])`; types `messages.ts:72-83,97-101` have no occupant field; client `movement.spec.ts:158-161` — panel text contains neither 'ada' nor 'bruno' | ✅ |
| MOVE-17 | deterministic cycle: identical positions/events across runs | `movement.test.ts:35-51` — 120-tick scripted replay `expect(run()).toBe(run())`; `:355-374` — 200-tick mixed move+call+decoy replay, same assertion | ✅ |
| MOVE-18 | join/buzzer → `movement:snapshot` with every player's (playerId, floor, x) and cars (car, floor), self-policy | `movement.test.ts:376-394` — exact snapshot `toEqual` incl. post-leave pruning; server `TurnoverRoom.test.ts:604-614` — joiner's self snapshot carries both cars; `:657-662` buzzer snapshot; policy `registry.test.ts:77-78` — snapshot recipients `'self'`; client seeding `mappers.test.ts:90-97` | ✅ |
| MOVE-19 | leave → `player:left` broadcast; rectangles removed everywhere | server `TurnoverRoom.test.ts:629-638` — `player:left` payload is the leaver's sessionId; scene removal `apps/client/src/scenes/WorldScene.ts:125-132`; e2e `movement.spec.ts:187-204` — rect count drops 4 → 3 on all tabs | ✅ |

**Status**: 19/19 ACs have `file:line` evidence; MOVE-06's positive half is
partially evidenced (Gap 4). No spec-precision gaps in value definitions — the
spec's numbers are all asserted exactly.

### Edge cases

| Spec edge | Evidence |
| --- | --- |
| Idempotent `move:start` / stray `move:stop` | `movement.test.ts:144-155` — exactly 1 event/tick after double start; `toEqual([])` after double stop |
| Same-x overlap renders both | client-local pass-through; e2e rect counts (`movement.spec.ts:93-97`) |
| Join mid-round rejected, no snapshot | pre-existing `TurnoverRoom.test.ts:313` (`/round in progress/i`); unchanged in range |
| Host start mid-walk: intents continue | `movement.test.ts:132-135` (intent active across `unlock()`) |
| `elevator:call` in lobby → intent error, no flash | `movement.test.ts:329` (`'rejected'`); `TurnoverRoom.test.ts:703-713` (`error` payload code `'elevator-locked'`); no `elevator:called` in the lobby-phase leg |

---

## 4. Discrimination sensor

Setup: `rsync` of the tree (excl. `node_modules`/`.git`/`.playwright-mcp`) to
`/tmp/mv-sensor`; per-package `node_modules` rebuilt as real dirs with
`@turnover/*` links re-pointed at the **scratch** packages (the real pnpm links
are relative and would otherwise resolve into the real tree); everything else
symlinked to the real `node_modules`. Pre-mutation run: 123/123 green. Runner:
`./node_modules/.bin/vitest run` in the scratch. Scratch deleted afterwards;
real-tree porcelain matches the baseline exactly ✅.

Depth: expanded tier (protocol/security-adjacent feature) — 9 behavior-level
mutants across sim, server-observable behavior, and the client vitest layer.

| # | Mutant (behavior-level) | File | Result | Killed by |
| --- | --- | --- | --- | --- |
| M1 | speed 300 → 301 millitiles/tick | `movement.ts:18` | ✅ KILLED (4 failures) | `movement.test.ts` MOVE-01/04/07-08/18 exact-value assertions |
| M2 | `lock()` does not clear the call FIFO | `movement.ts:180` | ✅ KILLED (1 failure) | `movement.test.ts` "drops queued calls at the buzzer" |
| M3 | decoy flash names the OTHER car, not the targeting one | `movement.ts:136` | ❌ **SURVIVED** (123/123 green) | none — Gap 2 |
| M4 | boarding capacity 2 → 3 | `movement.ts:299` | ✅ KILLED (1 failure) | `movement.test.ts` MOVE-13 capacity/overflow test |
| M5 | idle players emit `player:moved` every tick | `movement.ts:218-223` | ✅ KILLED (8 failures) | `movement.test.ts` MOVE-02/03/edges/08/11 + server REG-07/REG-18/`server:movement` |
| M5b | pinned-at-wall player (active intent, x cannot change) emits `player:moved` | `movement.ts:228` | ❌ **SURVIVED** (123/123 green; mutation verified applied) | none — Gap 3 |
| M6 | `elevator:moved` payload leaks `riders` ids | `movement.ts` (riding-complete branch) | ✅ KILLED (2 failures) | exact `toEqual` event arrays in MOVE-11/15 tests |
| M7 | lobby-phase `elevator:call` accepted (phase guard removed) | `movement.ts:132` | ✅ KILLED (2 failures) | `movement.test.ts` MOVE-08 edge + `TurnoverRoom.test.ts` lobby-rejection test |
| M8 | client `player:moved` mapper offsets x by +1 | `apps/client/src/net/mappers.ts` | ✅ KILLED (1 failure) | `mappers.test.ts:73-79` exact action equality |

**Result**: 9 injected, 7 killed, 2 survived (M3, M5b) → fix tasks below.

---

## 5. Ranked gaps (fix-task candidates)

1. **(Decision conflict — adjudicate) AD-008 vs shipped 2.4 routing.** AD-008
   (`.specs/STATE.md`, commit 4d8db03, recorded mid-cycle) mandates server-side
   per-recipient routing: live players receive own-floor position streams only,
   riders none; its Scope line names "cycle 2.4 `movement` Design". The design
   (`.specs/features/movement/design.md`, written in 3404b76 **before** AD-008 and
   never reconciled) says the opposite: "the 2.4 movement broadcasts are global",
   and the shipped registry rows are all `'all'` (`registry.ts:139-163`;
   `TurnoverRoom.ts:223` routes every movement event to everyone). spec.md Goal 2
   also declares positions public ("protocol rule 2"), so the implementer followed
   the feature spec — two locked artifacts now contradict each other. No MOVE AC
   fails, but per the message-only hard rule this needs an explicit ruling: amend
   spec+design+registry to AD-008 (new `sameFloor`-style policy) or descope AD-008
   to a later cycle by editing its Scope line. Not resolvable by an implementer
   guessing.
2. **(Low) M3 survives — decoy flash car unasserted (MOVE-12).** Design
   (design.md:110-112) defines "decoys name the targeting car";
   `movement.test.ts:255-256` asserts only `called` **count** 2. Fix: assert
   `called[1]` `toEqual({type:'elevator:called', floor:'lobby', car:1})`.
3. **(Low) M5b survives — pinned-with-intent emissions unobserved (MOVE-03's
   letter).** A player holding a direction against the wall has no position
   change yet the sim would emit; no test asserts silence in that subcase. Fix:
   in `movement.test.ts:71-99` (clamp/facing tests), assert `sim.tick()`
   `toEqual([])` while pinned with the intent still held, before the facing flip.
4. **(Info) MOVE-06 positive half untested.** No test walks a player on
   floor1..3 while the round is active (all round-phase walking tests are on
   `lobby`; post-ride tests lock immediately). The code permits it
   (`movement.ts:104` restricts only lobby phase), but evidence-or-zero: add one
   scripted leg (unlock → ride → walk on floor1 → assert x displacement).

---

## 6. Code quality

| Principle | Status |
| --- | --- |
| Minimum code / no scope creep | ✅ — diff confined to the movement surface (+2,457/−128 across the 8 commits); RoundScene→WorldScene swap is the spec'd replacement |
| Surgical changes | ✅ — Router change is a 2-line type widening; RoundSim untouched (AD-005 seam = `positionOf`) |
| Matches patterns | ✅ — registry rows, zod intents, scripted-intent sim tests, and harness idioms all follow 2.1–2.3 conventions |
| Spec-anchored values | ✅ — 300 millitiles/tick, tick 60, 40 ticks/floor, capacity 2, clamp 0..30 all asserted exactly |
| Tests map to ACs | ✅ — every new test names its MOVE ids; the only unclaimed behavior is Gap 4's missing leg |
| Guidelines followed | ✅ — `AGENTS.md` gate ladder; `turnover-gates` evidence format; AD-007 recorded for the one new tuning value |

Minor observation (not a gap): `ViewState.movementSnapshot`
(`apps/client/src/state.ts:31,130-131`) is written by the reducer but never read
— `app.ts:192-198` routes `movement-snapshot` to the scene, bypassing the
reducer. Dead state field; harmless.

---

## 7. Summary

**Overall**: ✅ Ready (with the adjudication item in Gap 1 surfaced to the user)

**Spec-anchored check**: 19/19 MOVE ACs evidenced with exact spec values (MOVE-06
positive half partial — Gap 4)
**Sensor**: 9 injected, 7 killed, 2 survived (M3 decoy-car flash, M5b pinned
emission)
**Gates**: typecheck + lint + test:sim (123) + test:client (18) all exit 0 in the
verifier's own runs

**What works**: lobby walking from join, exact 6 tiles/s integration, clamping,
pass-through, phase confinement with position persistence, the full deterministic
two-car elevator cycle (tick-60 arrival, 40 ticks/floor, capacity 2 with overflow
queuing, decoy flashes, FIFO, buzzer drop), position-only panels, snapshots on
join/buzzer, leaver removal — all proven at sim, server, and real-browser layers.

**Next steps**: route Gaps 1–4 as fix tasks (Gap 1 needs a user ruling first);
Gate 4 human round remains open.
