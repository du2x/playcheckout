# Telemetry Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/telemetry/design.md`
**Status**: Done

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md`, `vitest.config.ts`, `package.json`, `.github/workflows/ci.yml` - or "none - strong defaults applied".

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Domain / business-logic (packages/sim) | unit | All branches; 1:1 to spec ACs; every listed edge case has a test | `packages/sim/src/*.test.ts` | `pnpm vitest run packages/sim/src/telemetry.test.ts` (per-task) / `pnpm test:sim` (full) |
| Shared types / config (packages/shared) | none | - (build gate only) | `packages/shared/src/**` | `pnpm typecheck` |
| Server transport/file I/O (apps/server) | integration | Key file paths + error handling; roster/round lifecycle paths that touch FS | `apps/server/src/rooms/*.test.ts` | `pnpm vitest run apps/server/src/rooms/TurnoverRoom.test.ts` / `pnpm test:sim` |
| Repository / data-access | none | - | - | - |
| Entity / config / schema | none | - (build gate only) | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only (packages/sim) | `pnpm vitest run packages/sim/src/telemetry.test.ts` (or the specific suite touched) |
| Full | After tasks with integration/server tests or after KPI harness | `pnpm test:sim` (vitest over ALL workspace projects: packages/* + apps/* per AGENTS.md) |
| Build | After phase completion or config/entity-only tasks | `pnpm typecheck && pnpm lint` + `pnpm test:sim` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Foundation

Telemetry schema + core sink. Server stays untouched.

```
T1 → T2
```

### Phase 2: Guest Extension + KPIs + Server Sink

Guest lines, pure KPI aggregation, and the server file wiring that consumes the sink.

```
T2 → T3 → T4 → T5
```

### Phase 3: Phase-Exit Bots + Docs

Re-prove the v1.2 bars under the full economy and reconcile docs/handoff.

```
T5 → T6 → T7 → T8
```

---

## Task Breakdown

### T1: Widen shared telemetry schema (kind union + TelemetryLine + Kpis types)

**What**: Replace the 6-kind placeholder in `packages/shared/src/protocol/telemetry.ts` with the post-guest 14+ kind union and export `TelemetryLine` (tick, time, actor/room/floor/guestId/carrierId/fresh/provenance/state/coverage/winner) + `Kpis` (5 v1.2 + 4 guest fields + rounds/aborted/malformed) shapes. No runtime logic, no registry entry (internal-only).
**Where**: `packages/shared/src/protocol/telemetry.ts`
**Depends on**: None
**Reuses**: Existing 6-kind file as baseline; `RoomIndex`/`FloorId`/`RoomState`/`CarId` types; never touches `PROTOCOL_REGISTRY`
**Requirement**: TLM-01, TLM-08, TLM-14, TLM-16

**Tools**:

- MCP: `filesystem` (or NONE)
- Skill: NONE

**Done when**:

- [ ] `TelemetryEventKind` lists at least `room-transition`, `elevator-call`, `elevator-ride`, `elevator-doors`, `walk-in-catch`, `accusation`, `coverage-sample`, `guest-arrived`, `guest-assigned`, `guest-self-assigned`, `suitcase-carried`, `suitcase-placed`, `suitcase-picked-up`, `guest-settled`, `guest-checked-out`, `guest-left`, `guest-angered`, `guest-discovered`, `guest-complained`, `tenancy`, `carry-clock-expiry`, `round-ended`
- [ ] `TelemetryLine` carries `kind`, `tick`, `time`, and optional `actor`/`room`/`floor`/`guestId`/`carrierId`/`fresh`/`provenance`/`actorId`/`state`/`coverage`/`winner`/`reason`
- [ ] `Kpis` carries `rounds`, `abortedRounds`, `malformedLines`, the 5 v1.2 fields, plus `meanSettleScore`, `meanComplaintsPerRound`, `carryClockFiresPerRound`, `provenanceSplit`, `settlesPerMinute`
- [ ] `pnpm typecheck` exits 0

**Tests**: none
**Gate**: Build

**Commit**: `feat(shared): widen telemetry schema for guest economy and KPI shapes`

---

### T2: Pure TelemetrySink — core kinds + 1/s coverage sampling

**What**: Create `packages/sim/src/telemetry.ts` `TelemetrySink` mapping eligible `SimEvent`/`MovementEvent` to one JSONL line each plus synthetic `coverage-sample` every 20 ticks (`coverage = preppedCount/24`). Record accusation flags (`wasTargetSaboteur`, `crimeOccurred`), churn no-actor, tick→`time = tick*50`, post-ended silence (TLM-05), aborted still emits `round-ended` close marker (TLM-06). Expose `drain()`/`toJSONL()`/`lines` getter.
**Where**: `packages/sim/src/telemetry.ts`
**Depends on**: T1
**Reuses**: `WorkChannels.preppedCount` for coverage; `Justice.saboteurId`/`didSabotage` for flags; `TICK_HZ=20`; test file `packages/sim/src/telemetry.test.ts` first `describe('sim:telemetry')` block
**Requirement**: TLM-01, TLM-02, TLM-03, TLM-04, TLM-05, TLM-06, TLM-07

**Tools**:

- MCP: `filesystem`
- Skill: NONE

**Done when**:

- [ ] `sim:telemetry` scenario green: one prep + one un-prep + one accusation + one walk-in in a scripted 300-tick round asserts line counts, 1/s coverage cadence (`lines.filter(k==='coverage-sample').length === ceil(ticks/20)`), per-event `time`/`actor`/`room = F:R` stamping, accusation flags hand-counted, churn `room-transition` with `actor` omitted
- [ ] Past-`round:ended` ticks emit zero lines (TLM-05) and `round-ended` line carries `winner`/`reason`/`saboteurId`
- [ ] Deterministic replay: `seed=7` same lines twice (TLM-01 determinism)
- [ ] Gate check passes: `pnpm vitest run packages/sim/src/telemetry.test.ts` (quick) and `pnpm typecheck && pnpm lint` clean

**Tests**: unit
**Gate**: Quick

**Commit**: `feat(sim): add TelemetrySink with coverage-sampled JSONL mapping for core kinds`

---

### T3: Guest-extension telemetry (13 guest kinds + carry-clock + provenance)

**What**: Extend the same `TelemetrySink` to the guest extension: map `guest:arrived`/`guest:assigned`/`guest:self_assigned`/`suitcase:carried`/`suitcase:placed`/`suitcase:picked_up`/`guest:settled`/`guest:checked_out`/`guest:left`/`guest:angered`/`guest:discovered`/`guest:complained`/`room:tenancy` → `guest-*`/`tenancy` kinds with `guestId`/`carrierId`/`floor`/`room` verbatim, plus `carry-clock-expiry` from the `player:fired carry-clock` drain path, and `fresh`+`provenance` (`sabotage` with `actorId = saboteurId` vs `churn`) on `guest-discovered`/`room-transition` lines. Guest-less callers emit core kinds only (TLM-13, edge case 1).
**Where**: `packages/sim/src/telemetry.ts`
**Depends on**: T2
**Reuses**: `GuestSim` events + `WorkChannels.provenanceOf` + `Justice.saboteurId`; test block `packages/sim/src/telemetry.test.ts` `sim:telemetry_guests`
**Requirement**: TLM-08, TLM-09, TLM-10, TLM-11, TLM-12, TLM-13

**Tools**:

- MCP: `filesystem`
- Skill: NONE

**Done when**:

- [ ] `sim:telemetry_guests` green: seeds a round with one suitcase delivery (carried→placed→settled), one impatience self-assign, one carry-clock expiry (`player:fired carry-clock`), one trash-discovery `sabotage` (fresh) and one churn-discovery (`churn` aged); asserts all 13 guest kinds appear with verbatim `guestId`/`carrierId`/`floor`/`room`, carry-clock line attributes the carrier, `guest:discovered` carries `fresh`+`provenance` (`sabotage` with `actorId`, `churn` without), and `guest:complained` (wrong-delivery) never increments the `guest:discovered` KPI counter (TLM-12)
- [ ] Core-only caller (no `MovementPort`) produces core kinds only, byte-identical shape to T2 — `suites`/`guests` absent
- [ ] Gate check passes: `pnpm vitest run packages/sim/src/telemetry.test.ts`

**Tests**: unit
**Gate**: Quick

**Commit**: `feat(sim): extend TelemetrySink with guest-extension kinds and provenance`

---

### T4: Pure KPI computation from JSONL (FR-24 + guest bleed-vs-throughput)

**What**: Create pure `computeKpis(files: readonly string[][]): Kpis` (plus `computeKpisFromLines`) in `packages/sim` that aggregates over non-aborted rounds only: 5 v1.2 KPIs (`saboteurWinRate`, `correctAccusationRate`, `catchesPerHour`, `meanTimeToFirstCrimeSeconds`, `decoyCallRate`) + 4 guest KPIs (`meanSettleScore`, `meanComplaintsPerRound`, `carryClockFiresPerRound`, `provenanceSplit`, `settlesPerMinute`). Skip malformed/unknown-kind lines and increment `malformedLines`; `aborted` files excluded from every denominator.
**Where**: `packages/sim/src/kpis.ts`
**Depends on**: T3
**Reuses**: Widened `TelemetryLine`/`Kpis` types from T1; `TelemetrySink.toJSONL()` strings as the synthetic input; test `packages/sim/src/kpis.test.ts`
**Requirement**: TLM-14, TLM-15, TLM-16, TLM-17, TLM-18, TLM-19

**Tools**:

- MCP: `filesystem`
- Skill: NONE

**Done when**:

- [ ] Synthetic 20-file generator (mix of staff wins, sab wins, one `aborted`, one malformed/unknown-kind line, varying accusations/catches/settles/complaints/carry-fires) asserts hand-counted `Kpis` exactly: sab rate, correct-accusation rate, catches/hour, time-to-first-crime, decoy rate, guest 4 fields, `aborted` excluded, `malformedLines===1`
- [ ] Single-round equality: one scripted round's `computeKpis([sink.toJSONL()])` equals the direct `RoundSim` state (`settledCount`, `complaintTotal`, `wasTargetSaboteur`, `crimeOccurred`) at `round:ended` time (TLM-19)
- [ ] All-`aborted` and empty input return `rounds:0` with rates `0`/`null`, never throw
- [ ] Gate check passes: `pnpm vitest run packages/sim/src/kpis.test.ts` (quick)

**Tests**: unit
**Gate**: Quick

**Commit**: `feat(sim): add pure KPI aggregation over JSONL with abort/malformed handling`

---

### T5: Server JSONL file wiring (per-round sink → data/telemetry/<code>-<idx>.jsonl)

**What**: Wire `TurnoverRoom` to own one `TelemetrySink` + one `WriteStream` per round: `mkdir -p data/telemetry`, open `<roomId>-<roundIdx>.jsonl` at round start, on every 20 Hz tick drain `RoundSim` events + `MovementSim` elevator events into the sink and append `sink.toJSONL()` lines, synthetic `coverage-sample` included, and on `round:ended`/`aborted` flush the final line and close the stream. The file is never on the wire (internal-only, no registry entry); disk failures log and keep the round live.
**Where**: `apps/server/src/rooms/TurnoverRoom.ts`
**Depends on**: T4
**Reuses**: `activeCodes`/`roomId` file prefix; AD-004 `testShiftTicks` seam (harness rounds still write scaled files); `node:fs` `createWriteStream({flags:'a'})`; optional extract `apps/server/src/telemetry/fileSink.ts` if keeper prefers
**Requirement**: TLM-05, TLM-06, TLM-07

**Tools**:

- MCP: `filesystem`
- Skill: NONE

**Done when**:

- [ ] New server test boots two rooms, hosts start, asserts `data/telemetry/<code>-*.jsonl` exists, contains at least one `room-transition` + one `coverage-sample` + one `round-ended` last line, and `stream.writableEnded === true` after `round:ended`
- [ ] Injected malformed legacy scenario (pre-T2 sim without `MovementPort`) still writes core kinds only — no guest lines
- [ ] Disk failure branch covered by unit test stubbing `createWriteStream` to throw (round still reaches `round:ended`)
- [ ] Gate check passes: `pnpm test:sim` (vitest over ALL workspace projects per AGENTS.md, including server transport-shell tests) green; `pnpm typecheck` clean

**Tests**: integration
**Gate**: Full

**Commit**: `feat(server): wire per-round JSONL file sink via TelemetrySink`

---

### T6: Exit bot harness — staff vs AFK saboteur (sim:exit_a)

**What**: Add `describe('sim:exit_a')` in `packages/sim/src/telemetry.test.ts` running 20 deterministic full-shift sims (300 s at 20 Hz, real `MovementSim` + `RoundSim` with `guestExit` `PortAdapter` + seeded guest economy) per lobby size (4p/5/6) with the stairs-preferring delivery bot (single elevator east `car:1` only, `STAIR_X=0`, 3 s transit + 2 s breath, walk 6 tiles/s, patrol `prepped` rooms when idle) and an AFK saboteur (never calls `startWork`). Assert `≥16/20` 6p, `≥16/20` 5p, `≥15/20` 4p staff wins (settle-target-met or saboteur-fired), `discovered < COMPLAINT_BUDGET` in ≥19/20, zero walk-in catches, and keep `sim:guest_exit_a` green on the same economy.
**Where**: `packages/sim/src/telemetry.test.ts`
**Depends on**: T5
**Reuses**: `guestExit.test.ts:11` `PortAdapter` verbatim; `GUEST_FLOOR_IDS`/`roomDoorXMilli`/`TUNING`/`settleTargetFor`; optional extract `packages/sim/src/botHarness.ts` if keeper prefers
**Requirement**: TLM-20, TLM-21, TLM-22, TLM-23

**Tools**:

- MCP: `filesystem`
- Skill: NONE

**Done when**:

- [ ] `sim:exit_a` green: 20 seeds × 3 lobby sizes, per-size win bar as above, hand-counted `settled`/`discovered`/`win` traced to `round:ended` `settle-target-met`/`saboteur-fired`; `discovered<8` in ≥19/20, `catches===0`
- [ ] Failure does not move any dial — the job fails and the phase exit blocks (TLM-22)
- [ ] `sim:guest_exit_a` (existing 3.5 harness) still green on the same `MovementPort` economy (no regression)
- [ ] Gate check passes: `pnpm vitest run packages/sim/src/telemetry.test.ts -- -t "sim:exit_a"` (quick) and `pnpm test:sim` green

**Tests**: unit
**Gate**: Quick

**Commit**: `feat(sim): add exit_a AFK harness - staff vs AFK under full economy`

---

### T7: Exit bot harness — last-60s trash blitz (sim:exit_b)

**What**: Add `describe('sim:exit_b')` — same bots + a saboteur that sits AFK for 240 s then blitzes ticks 240–300 s: every `UNPREP_TICKS` interval `startWork` on the nearest room `roomDoorXMilli` ≤ `ROOM_DOOR_RANGE_TILES` away whose state is not `trashed`, walking to the nearest un-prepped room between starts (deterministic scan `floor1→floor3`, `room 1→8`). 20 seeds at 6p. Assert staff win band `8–18/20` (40–90%), `discovered` delta over the AFK baseline +≥1 on average (blitz trash overlaps discovery), and the two kill boxes: wrong-delivery `guest:complained` never increments `discovered` or `settled`, and `stairs:ambushed` never creates a complaint (differential unchanged).
**Where**: `packages/sim/src/telemetry.test.ts` (new block)
**Depends on**: T6
**Reuses**: Same `PortAdapter` + bot harness as T6; `UNPREP_TICKS` constant; `ROOM_DOOR_RANGE_TILES`
**Requirement**: TLM-24, TLM-25, TLM-26, TLM-27, TLM-28

**Tools**:

- MCP: `filesystem`
- Skill: NONE

**Done when**:

- [ ] `sim:exit_b` green: 20 seeds at 6p, staff wins 8–18/20; mean `discovered` exceeds `exit_a` 6p mean by ≥1; hand-counted `settled`/`discovered`/`complained` per seed match the JSONL lines
- [ ] Kill boxes pinned in the same runs: `complained` count >0 but `discovered`/`settled` unchanged on a wrong-delivery seed, and `discovered` differential over a `stairs:ambushed` seed without blitz trash is 0
- [ ] Failure does not move any dial — the phase exit blocks until re-tuned via AD (TLM-27)
- [ ] Gate check passes: `pnpm vitest run packages/sim/src/telemetry.test.ts -- -t "sim:exit_b"` (quick) and `pnpm test:sim` green

**Tests**: unit
**Gate**: Quick

**Commit**: `feat(sim): add exit_b last-60s blitz harness with complaint delta and kill boxes`

---

### T8: Docs & AD-044 — prd/roadmap reconciled and phase exit handoff

**What**: Record AD-044 (five telemetry choices, measured KPIs from T4/T6/T7, file location decision, and handoff to Phase 4), reconcile `prd.md` §7/§8 and `roadmap.md` Phase 3 exit note (no dial change — keep `SETTLE_TARGET` 5/7/9), update `CONTEXT.md` if a new glossary entry landed, and write the `STATE.md` handoff for `telemetry` COMPLETE (phase exit). Ensure no `TelemetryLine` ever appears in `PROTOCOL_REGISTRY` (wire-leak check) and the telemetry file is `.gitignore`'d.
**Where**: `.specs/STATE.md`
**Depends on**: T7
**Reuses**: AD-043 precedent shape; `prd.md` §7 `SETTLE_TARGET` row + §8 v1.6 headroom note; also touches `prd.md`, `roadmap.md`, `CONTEXT.md`, `.gitignore` (add `data/telemetry/`)
**Requirement**: Success criteria (spec § Success Criteria), TLM success row

**Tools**:

- MCP: `filesystem`
- Skill: NONE

**Done when**:

- [ ] `.specs/STATE.md` carries AD-044 with seven choices? No — five telemetry choices (sink+KPI), the measured 20-seed KPIs, the file location decision, and the handoff to Phase 4; Handoff marks `telemetry` COMPLETE and names the next step (Phase 4 gray-box)
- [ ] `prd.md` §7/§8 and `roadmap.md` Phase 3 exit note reflect "keep 5/7/9 — measured 6p 20/20 AFK, 5/6 scale holds; `sim:exit_a/b` re-proven; telemetry file `data/telemetry/*.jsonl`"
- [ ] No `TelemetryLine` ever appears in `PROTOCOL_REGISTRY` (`grep -r TelemetryLine packages/shared/src/protocol/registry.ts` empty) and `data/telemetry/` is git-ignored
- [ ] Gate check passes: `pnpm typecheck && pnpm lint && pnpm test:sim` green repo-wide

**Tests**: none
**Gate**: Build

**Commit**: `docs(specs): record AD-044 telemetry phase exit and reconcile prd/roadmap/CONTEXT`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ------→ T2
Phase 2:  T3 ------→ T4 ------→ T5
Phase 3:  T6 ------→ T7 ------→ T8
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

**How phase-based execution works:**

At Execute, the agent counts total tasks and packs phases into **task-budgeted batches** (~7 tasks
per worker, whole phases - the benchmarked sweet spot is ~20 tasks → ~3 workers). A **phase** is the
semantic/dependency unit; a **batch** is one or more *consecutive whole phases* assigned to one
worker. The cut only ever lands on a phase boundary - a phase is never split across workers. When
packing yields more than one batch (> ~8 tasks), the agent offers to dispatch batch sub-agents.
Batches run sequentially: each worker executes ALL its tasks in order, then reports a compact summary
before the next batch starts. This right-sizes the worker count by workload instead of by phase
count (one-per-phase is too fragmented; expensive and slow). See `sub-agents.md` for
the full model - packing algorithm, offer-then-confirm, worker payload, compact summary contract,
failure handling, and context sizing guidance.

When the whole feature fits a single batch (≤ ~8 tasks), execution happens inline in the main window
with no sub-agents spawned.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Widen shared telemetry schema | 1 file (`packages/shared/src/protocol/telemetry.ts`) — widen union + add 2 interfaces | ✅ Granular |
| T2: Pure TelemetrySink — core kinds + 1/s sampling | 1 class + 1 test file (`telemetry.ts` + `telemetry.test.ts` block) | ✅ Granular |
| T3: Guest-extension telemetry | 1 class extension + 1 test block (same 2 files, same phase) | ✅ Granular |
| T4: Pure KPI computation | 1 function + 1 test file (`kpis.ts` + `kpis.test.ts`) | ✅ Granular |
| T5: Server JSONL file wiring | 1 room file + 1 server test file (`TurnoverRoom.ts` + `TurnoverRoom.test.ts`) | ✅ Granular |
| T6: Exit bot harness — exit_a | 1 harness function + 1 `describe` block | ✅ Granular |
| T7: Exit bot harness — exit_b | 1 harness function + 1 `describe` block | ✅ Granular |
| T8: Docs & AD-044 | `STATE.md` + `prd.md`/`roadmap.md`/`CONTEXT.md` + `.gitignore` — one handoff | ✅ Granular |

**Granularity check**:

- ✅ 1 component / 1 function / 1 endpoint = Good
- ⚠️ 2-3 related things in same file = OK if cohesive
- ❌ Multiple components or files = MUST split

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | (phase start) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |

**Rules**:

- Every `Depends on` in a task body must have a corresponding arrow in the diagram.
- Every arrow in the diagram must correspond to a `Depends on` in the target task's body.
- A task must never depend on a task in a later phase - dependencies point backward or within the same phase only.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1: Widen shared schema | Shared types / config | none | none | ✅ OK |
| T2: TelemetrySink core | Domain / business-logic (packages/sim) | unit | unit | ✅ OK |
| T3: Guest-extension telemetry | Domain / business-logic (packages/sim) | unit | unit | ✅ OK |
| T4: KPI computation | Domain / business-logic (packages/sim) | unit | unit | ✅ OK |
| T5: Server JSONL file wiring | Server transport/file I/O | integration | integration | ✅ OK |
| T6: Exit_a harness | Domain / business-logic (packages/sim) | unit | unit | ✅ OK |
| T7: Exit_b harness | Domain / business-logic (packages/sim) | unit | unit | ✅ OK |
| T8: Docs & AD-044 | Entity / config / schema | none | none | ✅ OK |

---

## Tips

- **Phases are ordered** - Each phase completes before the next; tasks run in order within a phase
- **Reuses = Token saver** - Always reference existing code
- **Tools per task** - MCPs and Skills prevent wrong approaches
- **Dependencies are gates** - Clear what blocks what
- **Done when = Testable** - If you can't verify it, rewrite it
- **Requirement ID = Traceable** - Every task traces back to a spec requirement
- **One commit per task** - Plan the commit message format in advance

---

## Task Verification Standards

Every task MUST follow the `Done when` + `Tests` + `Gate` fields defined in the **Task Breakdown** template above. Each `Done when` entry must be specific, testable (binary pass/fail), and reference the gate check command from the `Gate Check Commands` section. Include the expected test count to prevent silent deletions.
