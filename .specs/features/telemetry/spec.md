# Telemetry Specification (cycle 3.6, Phase exit — prd v1.6)

## Problem Statement

Phase 3 (3.1–3.5 + 3.B/C/D/E) ships the full guest-traffic economy — NPC guests, suitcase transport, restaurant dwell, complaint budget, provenance, stairs/ambush, and the `SETTLE_TARGET` balance gate — but the round still emits no server-authoritative telemetry. FR-23 (JSONL log per round: room transitions with actor+time, elevator calls/rides, walk-in catches, accusations with `wasTargetSaboteur`/`crimeOccurred`, coverage sampled once per second) and FR-24 (post-round KPI computation) have no implementation; the JSONL schema in `packages/shared/src/protocol/telemetry.ts` is a pre-Phase-2 placeholder (six kinds, single `coverage` number) that never widened with the guest economy. The Phase exit rule (roadmap) demands that the v1.2 exit bots (staff vs. AFK saboteur and last-60s blitz) be re-proven under the full economy, plus bleed-vs-throughput KPIs over the guest extension, before Phase 4 starts.

## Goals

- [ ] Server-authoritative JSONL telemetry per round: every qualifying domain event as one JSON line (past-tense facts only) + synthetic coverage sample once per second (20 ticks) — FR-23 as a verifiable file/sink.
- [ ] Guest-extension coverage: guest arrivals, assignments, suitcase carry/place/pickup + carry-clock expiries, complaint events with source + provenance, settle/checkout, and tenancy — wired 1:1 from the existing sim event stream (FR-23 guest extension).
- [ ] KPI computation from JSONL (FR-24): saboteur win rate, correct-accusation rate, catches/hour, time-to-first-crime-discovery, decoy-call usage, plus guest bleed-vs-throughput KPIs (mean settle score vs target, complaints per round, carry-clock fires, churn/sabotage provenance split).
- [ ] v1.2 exit bots re-proven under the full economy (single elevator, stairs, guest churn+interception workload): `sim:exit_a` staff vs. AFK saboteur ≥80% staff wins, `sim:exit_b` last-60s blitz defeats spread bots at plausible rates.

## Out of Scope

| Feature | Reason |
|---|---|
| Production file rotation, S3 upload, or DB persistence | Phase 5 deploy concern; file lives on the single-container filesystem or an in-memory sink for tests |
| Client-side telemetry or analytics beacons | Server-authoritative only (FR-23); client is untrusted |
| Real-harness `client:*` telemetry scenarios | Server + sim only — telemetry never reaches the wire (protocol rule) |
| Changing cadence/dwell/`SETTLE_TARGET`/`COMPLAINT_BUDGET` dials | Locked by AD-043; 3.6 only reads them for sampling/KPI |
| Art, HUD, or tenancy-sign changes | No client change beyond the existing recap/results plumbing |
| New protocol messages | Guest/suitcase/complaint/tenancy messages already exist; telemetry observes the existing stream |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| Telemetry sink shape | `TelemetrySink` in `packages/sim` (pure) + file writer in `apps/server` (JSONL): the sim owns the *event → telemetry line* mapping (time = `tickIndex * 50` ms), the server owns file I/O (one file per round, line-delimited JSON). Tests consume the sink directly; the room wires `RoundSim` events + `MovementSim` elevator events into it each tick | Keeps `packages/sim` deterministic and testable without I/O; server stays a thin transport shell (AD-002 seam) | n (assumed) |
| Clock for timestamps | `tickIndex` 0-based × `TICK_MS=50` → `timeMs` (0, 50, 100 …). Coverage samples stamp the tick they were taken | Single source of truth — the sim's tick count never wall time; matches the envelope `time` semantics | n (assumed) |
| Coverage sampling | One synthetic `coverage-sample` per 20 ticks (once per wall second) while the round is live: `coverage = preppedCount / 24` (fresh/settled/trashed count as un-prepped, same as the win-check denominator). Sample 0 fires at tick 0 if the round started that tick; aborted/ghósted rounds still sample until `round:ended` emits | 1/s row of prd FR-23; 20 ticks is the only stable 1 s cadence at 20 Hz; integer-safe with 24 rooms | n (assumed) |
| Which events are logged | Every domain fact that already exists as a SimEvent or MovementEvent and is named in FR-23 plus the guest extension: `room:prepped`/`room:trashed`→`room-transition`, `elevator:called`/`elevator:moved`+`elevator:doors`→`elevator-call`/`elevator-ride`/`elevator-doors`, `player:fired` with walk-in reason→`walk-in-catch`, `player:fired` via accusation→`accusation` (+ `wasTargetSaboteur`/`crimeOccurred` from the deal + `justice.crimeOccurred()` at accusation tick), plus guest-kind `guest:arrived`/`guest:assigned`/`guest:self_assigned`/`suitcase:carried`/`suitcase:placed`/`suitcase:picked_up`/`guest:settled`/`guest:checked_out`/`guest:left`/`guest:angered`/`guest:discovered`/`guest:complained`/`room:tenancy` and the `carry-clock` firing (`player:fired` reason `carry-clock`). `coverage-sample` is the only synthetic telemetry kind | Mirrors FR-23's "room transition (actor+time), elevator calls/rides, walk-in catches, accusations (wasTargetSaboteur, crimeOccurred), coverage 1/s" and roadmap's "guest arrivals/check-ins/checkouts, suitcase carry/place/pickup + carry-clock expiries, complaint events with source+provenance" | n (assumed) |
| Accusation flag semantics | `wasTargetSaboteur := targetId === saboteurId`; `crimeOccurred := justice.didSabotage` (any prior `room:trashed`) at the accusation tick — materializes the FR-23 flags without plumbing a new payload | Matches prd FR-23 letter ("wasTargetSaboteur, crimeOccurred flags") and the Justice deal+noteSabotage shape | n (assumed) |
| `room-transition` attribution | `actor` = the worker that completed the transition (prep actor for `room:prepped`, un-prep owner for `room:trashed`, churn has no actor — `actor` omitted). `room` = `F:R` string for readability (`"floor1:3"`), `floor`/`room` split carried alongside | Hallway-visible room transition needs actor+time for the KPI "time-to-first-crime-discovery" and for coverage reconstruction; churn has no saboteur actor by definition | n (assumed) |
| File layout | `data/telemetry/<roomId>-<roundIndex>.jsonl` on the server (created at round start, appended per tick, closed at `round:ended`/`aborted`). Aborted rounds (`saboteur-disconnected`) are written but carry `winner:'aborted'` and are excluded from KPI aggregation | Single-container Railway deploy (AD-001): local file is the simplest persistent sink; abort exclusion matches prd FR-25 telemetry rule | n (assumed) |
| KPI input | Pure function `computeKpis(jsonl: string[]): Kpis` (or parsed `TelemetryEvent[]`) — reads only the JSONL lines, not live sim state. Aborted rounds excluded; truncated/malformed lines are skipped and counted in `malformedLines` | Deterministic replay from the file; abort exclusion is prd FR-25 letter | n (assumed) |
| Bleed-vs-throughput KPIs (guest extension) | Added to the v1.2 five (`saboteurWinRate`, `correctAccusationRate`, `catchesPerHour`, `timeToFirstCrimeTicks`, `decoyCallRate`): `meanSettleScore`, `meanComplaintsPerRound` (trash-discovery only), `carryClockFiresPerRound`, `provenanceSplit {sabotage,churn}`, `settlesPerMinute` | Roadmap names "bleed-vs-throughput KPIs"; these are directly readable from the JSONL without new simulation | n (assumed) |
| `sim:exit_a` definition (v1.2 re-proof under full economy) | Staff bots (stairs-preferring delivery bots from `guestExit` — walk 6 tiles/s, single elevator east car, stairs 3s+2s — plus prepped-patrol when idle) vs. **AFK saboteur** (joins, moves, never starts work). 20 deterministic seeds, 300 s at 20 Hz, MovementPort attached (full guest economy + churn `settled` re-trashing). Staff SHALL win (`settle-target-met` or `saboteur-fired`) in ≥16/20 at 6p (≥80%), ≥16/20 at 5p, ≥15/20 at 4p | v1.2 FR-25-adjacent "staff vs AFK" bar (the economy's only-signal proof); AFK means the hotel must reach `SETTLE_TARGET` on chore throughput alone — the guest-exit 3.5 `exit_a` proved the same economy, now the phase-exit guard pins it | n (assumed) |
| `sim:exit_b` definition (last-60s blitz) | Same bots + an active saboteur bot that does **nothing for 240 s** then blitzes the last 60 s: `room:trashed` directly via `WorkChannels` every `UNPREP_TICKS` (3 s) on the next un-prepped room within 2 tiles (roundSim `startWork`+tick), spreading across floors via elevator/stairs. 20 seeds. Measured: staff win rate 8–18/20 is healthy (blitz is lethal but not deterministic); the sensor pins that `complaintTotal` > pure-churn baseline and at least one `guest:discovered` fires from blitz-trash | Roadmap "last-60s blitz defeats spread bots at plausible rates" — the step-0 travel-budget verdict's win lever (last-60s trash blitz) must still defeat the delivery bots at a plausible rate under the single-car economy | n (assumed) |
| Telemetry ordering | Within a tick, lines are appended in event-flush order (room transitions, then guest lifecycle, then movement elevator events for that tick). Coverage sample line for that tick sorts **after** the tick's domain events | Deterministic replay from a single flush order — the same order the sim produces | n (assumed) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Coverage-sampled JSONL per round (FR-23 core) ⭐ MVP

**User Story**: As the sim, I want every qualifying round event plus a 1/s coverage sample written as one JSON line each so that the round's evolution is reconstructable from the file alone.

**Why P1**: FR-23 is the telemetry contract itself; every KPI and the recap derive from this file.

**Acceptance Criteria** (EARS):

1. The system SHALL append one JSON line per qualifying domain event (`room:prepped`/`room:trashed` → `room-transition`, `elevator:called` → `elevator-call`, `elevator:moved`/`elevator:doors` → `elevator-ride`/`elevator-doors`, `player:fired` via walk-in → `walk-in-catch`, `player:fired` via accusation → `accusation`) plus one synthetic `coverage-sample` per 20 ticks while the round is live. <!-- ubiquitous -->
2. WHEN a telemetry-eligible event emits on tick `t` THEN the system SHALL append a line with `time = t * 50` ms, `actor` and `room` fields where defined, and `coverage` only on `coverage-sample` lines. <!-- event-driven -->
3. WHEN `player:fired` via accusation emits THEN the system SHALL record `wasTargetSaboteur` (`targetId === saboteurId`) and `crimeOccurred` (`Justice.didSabotage` at that tick) on the `accusation` line. <!-- event-driven -->
4. WHEN `room:trashed` via checkout churn emits THEN the system SHALL append a `room-transition` with `actor` omitted (churn has no saboteur actor) and `room = floor:room`. <!-- event-driven -->
5. WHILE the round is past `round:ended` (buzzer, attrition, budget-exhausted, or abort) THEN the system SHALL emit no further telemetry lines. <!-- state-driven -->
6. IF the round is `aborted` (saboteur-disconnected) THEN the system SHALL still close the file with a final `round:ended` line carrying `winner:'aborted'` so the abort is machine-readable and excludable from KPIs. <!-- unwanted-behavior -->
7. WHERE a JSONL file is read back line-by-line THEN every domain-event line SHALL equal the corresponding sim event's domain fact (same tick ordering, same actor/room/floor, no invented fields) and the coverage sequence SHALL be `preppedCount / 24` at each sample tick. <!-- optional-feature -->

**Independent Test**: `sim:telemetry` — scripted 300-tick round with one prep, one un-prep, one accusation, one walk-in; assert line counts, 1/s coverage cadence, accusation flags, churn no-actor, and deterministic replay (`seed=7` same file twice).

---

### P2: Guest-extension telemetry (FR-23 guest rows + FR-32 provenance) ⭐ MVP

**User Story**: As the guest economy, I want every guest lifecycle fact with its room, actor, and provenance to appear in the same JSONL so that bleed, throughput, and laundering are all KPIs without re-simulating.

**Why P1**: The roadmap's guest extension makes telemetry the only place the complaint budget's provenance (churn vs sabotage) and the suitcase economy's carry-clock pressure are observable at scale.

**Acceptance Criteria**:

1. WHEN a guest domain event emits (`guest:arrived`, `guest:assigned`, `guest:self_assigned`, `suitcase:carried`, `suitcase:placed`, `suitcase:picked_up`, `guest:settled`, `guest:checked_out`, `guest:left`, `guest:angered`, `guest:discovered`, `guest:complained`, `room:tenancy`) THEN the system SHALL append a telemetry line of kind `guest-arrived`/`guest-assigned`/`guest-self-assigned`/`suitcase-carried`/`suitcase-placed`/`suitcase-picked-up`/`guest-settled`/`guest-checked-out`/`guest-left`/`guest-angered`/`guest-discovered`/`guest-complained`/`tenancy` with `guestId`/`carrierId`/`floor`/`room` carried verbatim. <!-- event-driven -->
2. WHEN `player:fired` with reason `carry-clock` drains THEN the system SHALL append a `carry-clock-expiry` line naming the `actor` (the fired carrier) and the tick. <!-- event-driven -->
3. WHEN `guest:discovered` emits THEN the system SHALL record `fresh` and `provenance` (`sabotage` with `actorId = saboteurId` vs `churn`) on that telemetry line — the FR-32 author dimension that makes the laundering game KPIs soluble. <!-- event-driven -->
4. WHEN `room:prepped`/`room:trashed`/`guest:checked_out` churn emits THEN the system SHALL record the resulting `RoomState` (`prepped`/`trashed`/`settled`) and its `provenance` (`none`/`sabotage`/`churn`) on that line when the domain event's journal has it. <!-- event-driven -->
5. IF a `guest:complained` (wrong-delivery door complaint, FR-29(a)) emits THEN the system SHALL log it as `guest-complained` and SHALL NOT increment the `guest:discovered` KPI counter (wrong-delivery informs, it never damages the budget since AD-039). <!-- unwanted-behavior -->
6. The system SHALL emit guest telemetry only when a `MovementPort` (cycle 3.1) is attached — pre-guest callers (legacy 2.x sims) produce the pre-3.6 core kinds only, byte-identical to before. <!-- ubiquitous -->

**Independent Test**: `sim:telemetry_guests` — seed a round with one suitcase delivery, one impatience self-assign, one carry-clock expiry, one trash-discovery (`sabotage`) and one churn-discovery (`churn`); assert 13 guest kinds appear, carry-clock line attributes the carrier, provenance split `1/1`.

---

### P3: KPI computation from JSONL (FR-24) ⭐ MVP

**User Story**: As a playtest analyst, I want a pure function that reads saved JSONL files and returns the five v1.2 KPIs plus the four guest bleed-vs-throughput KPIs so that playtests evaluate themselves against the §8 kill criteria without re-running rooms.

**Why P1**: FR-24 letter — "saboteur win rate, correct-accusation rate, catches/hour, time-to-first-crime-discovery, decoy-call usage" plus the Phase 3 "bleed-vs-throughput" extension; aborted rounds must be excluded (FR-25).

**Acceptance Criteria**:

1. The system SHALL export `computeKpis(jsonlFiles: readonly string[][]): Kpis` (or `fromEvents`) in `packages/sim` that accepts one or more rounds' line arrays and returns the aggregated KPIs over exactly the non-aborted rounds. <!-- ubiquitous -->
2. WHEN KPI aggregates over N non-aborted rounds THEN the system SHALL compute `saboteurWinRate = sabotage-Wins / N`, `correctAccusationRate = correctAccusations / totalAccusations` (0 when no accusations), `catchesPerHour = walkInCatches × 12 / (N × 5)` (5-min shift), `timeToFirstCrimeSeconds = mean(room:trashed time) where actor === saboteurId` over the N rounds that had one, and `decoyCallRate = elevator-call lines with no subsequent board within 60 ticks / total elevator-call lines`. <!-- event-driven -->
3. WHEN KPI aggregates over the same N rounds THEN the system SHALL additionally compute `meanSettleScore = mean(settleCount)`, `meanComplaintsPerRound = mean(guest:discovered)`, `carryClockFiresPerRound = mean(carry-clock-expiry)`, `provenanceSplit = {sabotage, churn}` over the complaint lines, and `settlesPerMinute = meanSettleScore / 5`. <!-- event-driven -->
4. IF a round's JSONL carries `winner:'aborted'` THEN the system SHALL exclude that round from every denominator and numerator. <!-- unwanted-behavior -->
5. IF a JSONL line is malformed JSON or carries an unknown `kind` THEN the system SHALL skip that line and increment `malformedLines` without failing the aggregation. <!-- unwanted-behavior -->
6. WHERE a single-round file is parsed THEN the per-round KPIs SHALL equal the direct `RoundSim` state (`settledCount`, `complaintTotal`, `wasTargetSaboteur`, `crimeOccurred`) that the sim exposes at `round:ended` time. <!-- optional-feature -->

**Independent Test**: Build 20 synthetic JSONL files (mix of staff wins, sab wins, one abort, one malformed line, varying accusations/catches/settles/complaints/carry-fires) and assert `computeKpis` returns exact hand-counted `Kpis` including guest fields and abort exclusion.

---

### P4: Exit bots re-proven — staff vs AFK saboteur (exit_a) ⭐ MVP

**User Story**: As the sim, I want the classic staff-vs-AFK exit bot to clear ≥80% staff wins under the one-car + stairs + guest-churn economy so that the Phase exit proves the economy is still winnable when the saboteur does nothing.

**Why P1**: The v1.2 contract — if AFK beats the hotel, the §7 dials or the guest economy's churn rate are wrong and Phase 4 must not start.

**Acceptance Criteria**:

1. The system SHALL run 20 deterministic full-shift sims (300 s at 20 Hz, `MovementSim` + `RoundSim` with the `guestExit` PortAdapter and seeded guest economy) per lobby size (4p 5/6) with stairs-preferring delivery bots (the 3.5 harness bots: elevator east car `car:1` only, `STAIR_X=0`, 3 s transit + 2 s breath, walk 6 tiles/s, patrol `prepped` rooms when idle) and an **AFK saboteur** (joins, never calls `startWork`). <!-- ubiquitous -->
2. WHEN the 20 seeds (1..20) complete THEN the staff win count (`round:ended` `settle-target-met` or `saboteur-fired`) SHALL be ≥16/20 at 6p (≥80%), ≥16/20 at 5p, and ≥15/20 at 4p — the 3.5 `exit_a` bar, now pinned as the phase-exit guard. <!-- event-driven -->
3. WHILE the AFK runs execute THEN `guest:discovered` (`discovered`) SHALL stay < `COMPLAINT_BUDGET` (8) in ≥19/20 runs and the walk-in catch count SHALL be 0 — AFK never un-preps, so catches and budget wins are impossible. <!-- state-driven -->
4. IF the AFK bar fails THEN the system SHALL record the failure as a spec violation — no dial move occurs here (3.5 locked `SETTLE_TARGET` 5/7/9); the failure blocks the phase exit. <!-- unwanted-behavior -->
5. The system SHALL expose the per-run `settled/discovered/win` that the KPI layer aggregates and SHALL keep `sim:guest_exit_a` green on the same economy (no regression). <!-- ubiquitous -->

**Independent Test**: `sim:exit_a` — 20-seed AFK harness per lobby size, assert win bars and zero catches — `packages/sim/src/telemetry.test.ts` `describe('sim:exit_a')`.

---

### P5: Exit bots re-proven — last-60s trash blitz (exit_b) ⭐ MVP

**User Story**: As the saboteur, I want a last-60 s trash blitz (re-trash every 3 s on the next visible un-prepped room) to defeat the delivery bots at a plausible rate under the one-car + stairs + churn economy so that the travel-budget verdict's win lever still holds when the lobby is loaded.

**Why P1**: The step-0 throughput claim — staff outproduce churn but lose to a spread blitz — is the only win lever that survives to the buzzer; if the blitz is toothless under the full economy, the saboteur has no path to the buzzer win leg.

**Acceptance Criteria**:

1. WHEN the saboteur bot is AFK for 240 s then blitzes ticks 240–300 s (every `UNPREP_TICKS` interval it `startWork` on the nearest room ≤ `ROOM_DOOR_RANGE_TILES` away whose state is not `trashed`, walking to the nearest un-prepped room between starts — `roomDoorXMilli` deterministic, same as the work harness) THEN the staff bots (same delivery + patrol model as `exit_a`) SHALL interleave blitz coping with their delivery work. <!-- event-driven -->
2. WHILE the 20 blitz seeds (1..20) at 6p execute THEN the staff win rate (buzzer `settle-target-met`) SHALL lie in [8/20, 18/20] (40–90%) — blitz defeats the bots *sometimes* but not always; the busiest floor's blitz spread decides. <!-- state-driven -->
3. WHEN the blitz runs THEN `guest:discovered` totals SHALL exceed the AFK baseline (`exit_a` 6p `discovered` mode ≤2) by ≥1 on average — blitz trash overlaps the guest discovery loop (the FR-32 laundering overlap). <!-- event-driven -->
4. IF the blitz bar lands outside 8–18/20 THEN the system SHALL record the failure as a spec violation (no dial move here) — the phase exit blocks until the delivery/blitz harness is re-tuned via an AD. <!-- unwanted-behavior -->
5. The system SHALL assert the 3.3 kill boxes inside the same runs: wrong-delivery `guest:complained` never increments `discovered` or `settled`, and the ambush never creates a complaint (differential `guest:discovered` count unchanged by a `stairs:ambushed` tick) — the shrunken-budget semantics survive blitz pressure. <!-- ubiquitous -->

**Independent Test**: `sim:exit_b` — 20-seed 6p blitz harness, assert win band + complaint delta over `exit_a` + the two kill checks — `packages/sim/src/telemetry.test.ts` `describe('sim:exit_b')`.

---

## Edge Cases

- IF the simulation is constructed without a `MovementPort` (legacy 2.x caller) THEN telemetry SHALL emit only the pre-3.6 core kinds — no guest lines, no carry-clock lines — and coverage sampling SHALL still run.
- IF `TURNOVER_TEST_GUEST_SCALE` (3.1 seam) scales the guest timing THEN coverage sampling SHALL still sample every 20 ticks of *sim* time, not wall time — the sample count scales with `totalTicks` (AD-004 pattern).
- IF `settleTargetFor` is called with a count outside 4–6 THEN telemetry SHALL read the clamped value for the `settle-target` win reason (the room already does).
- IF the server writes JSONL and crashes between append and close THEN the partial file SHALL remain readable (line-delimited: last partial line is the only malformed line) and the KPI layer SHALL count it as one `malformedLines` entry.
- IF the round ends at the exact tick a coverage sample would fire THEN that sample SHALL NOT emit in the same flush as `round:ended` — the round is ended, and past-`round:ended` emission is forbidden (P1 AC5).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
|---|---|---|---|
| TLM-01 | P1: Coverage-sampled JSONL (event kinds) | Design | Pending |
| TLM-02 | P1: per-event time/actor/room stamping | Design | Pending |
| TLM-03 | P1: accusation flags | Design | Pending |
| TLM-04 | P1: churn no-actor | Design | Pending |
| TLM-05 | P1: post-ended silence | Design | Pending |
| TLM-06 | P1: aborted still logs round:ended | Design | Pending |
| TLM-07 | P1: ordering + coverage denominator replay | Design | Pending |
| TLM-08 | P2: Guest extension kinds | Design | Pending |
| TLM-09 | P2: carry-clock-expiry line | Design | Pending |
| TLM-10 | P2: discovered provenance (fresh + sabotage/churn) | Design | Pending |
| TLM-11 | P2: state+provenance on transition lines | Design | Pending |
| TLM-12 | P2: wrong-delivery never counts as discovered | Design | Pending |
| TLM-13 | P2: guest telemetry only with MovementPort | Design | Pending |
| TLM-14 | P3: computeKpis over non-aborted rounds | Design | Pending |
| TLM-15 | P3: five v1.2 KPI formulas | Design | Pending |
| TLM-16 | P3: four guest KPI formulas | Design | Pending |
| TLM-17 | P3: aborted exclusion | Design | Pending |
| TLM-18 | P3: malformed-line skip | Design | Pending |
| TLM-19 | P3: single-round equality with sim state | Design | Pending |
| TLM-20 | P4: AFK harness shape + per-size bar | Design | Pending |
| TLM-21 | P4: AFK budget silence + zero catches | Design | Pending |
| TLM-22 | P4: no dial move on AFK failure | Design | Pending |
| TLM-23 | P4: settled/discovered/win exposed + guest_exit_a green | Design | Pending |
| TLM-24 | P5: Blitz 240–300 s re-trash every 3 s | Design | Pending |
| TLM-25 | P5: 6p win band 8–18/20 | Design | Pending |
| TLM-26 | P5: complaint delta over AFK baseline | Design | Pending |
| TLM-27 | P5: AFK bar failure blocks phase exit | Design | Pending |
| TLM-28 | P5: wrong-delivery + ambush kill boxes under blitz | Design | Pending |

**Coverage:** 28 total, 28 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] `sim:telemetry` green: coverage-sample cadence 1/s + per-event `time`/`actor`/`room` stamping + accusation flags `wasTargetSaboteur`/`crimeOccurred` + churn no-actor pin, deterministic replay, post-ended silence.
- [ ] `sim:telemetry_guests` green: all 13 guest kinds appear in the JSONL with `guestId`/`carrierId`/`floor`/`room` verbatim, `carry-clock-expiry` attributes the carrier, `guest:discovered` carries `fresh`+`provenance` (`sabotage` with `actorId`, `churn` without), wrong-delivery never counts toward discovered, guest-less callers emit core kinds only.
- [ ] `computeKpis` green over 20 synthetic files (mix of staff wins, sab wins, one abort, one malformed line): all nine KPIs hand-counted and matched, abort excluded, `malformedLines` counted.
- [ ] `sim:exit_a` green: 20-seed AFK harness `≥16/20` 6p, `≥16/20` 5p, `≥15/20` 4p; `discovered<8` in ≥19/20, zero walks catch.
- [ ] `sim:exit_b` green: 20-seed 6p blitz harness staff wins 8–18/20, complaint delta over AFK, plus the two kill boxes (wrong-delivery inert, ambush never creates complaint).
- [ ] `pnpm typecheck && pnpm lint && pnpm test:sim` green repo-wide; `packages/shared/src/protocol/telemetry.ts` widened from 6 kinds to the post-guest schema; no wire leak (telemetry never appears in `PROTOCOL_REGISTRY`).
- [ ] `prd.md` §7/§8 and `roadmap.md` Phase 3 exit note reconciled (no dial change); `.specs/STATE.md` records AD-044 with the five telemetry choices, measured KPIs, and handoff to Phase 4.
