# Proposal: delivery-scoring (prd v1.5, cycle 3.D)

> Decouples the FR-29(a) wrong-delivery complaint line from the FR-31 complaint
> budget, and replaces the coverage% buzzer check with a settle-point target.
> The suitcase carry/placement mechanics (3.B) are untouched.

## Motivation

v1.4 (AD-032) made the wrong-delivery door complaint count toward the
8-complaint instant-loss budget. That couples a logistics mistake to the
loss loop and blurs the budget's meaning. The redesign separates the two
concerns cleanly:

- **Budget = getting caught sabotaging** (trash-discovery complaints only).
- **Score = doing the job** (guests settled).
- **Wrong delivery = a mistake, not a catastrophe** — it costs time (the
  guest walks, doesn't settle, must be corrected), never loss pressure.

The user direction "simpler: right room = points, wrong room = nothing"
was refined in discussion: a fully silent mis-placement would remove the
suitcase system's main evidence beat and give honest staff zero feedback.
The building-wide manager line **stays**; only its punitive coupling dies.

## The decision

1. **Wrong delivery (FR-29a, unchanged behavior):** at guest arrival at a
   non-assigned resting room the building-wide line fires ("the guest of
   room X complained about the suitcase"), the guest returns to dining and
   re-targets on the next rest event. **No budget effect, no score effect,
   no personal penalty** — the line now informs, it no longer damages.
2. **Complaint budget (FR-31, narrowed):** only trash-discovery complaints
   (FR-29b, built in cycle 3.3) count toward the 8-complaint instant loss.
   With wrong deliveries out, the budget becomes a harder-to-reach leg; its
   dial is re-examined at the 3.5 balance gate rather than retuned now.
3. **Win conditions (§6.6, swapped):** staff win when the saboteur is fired
   **or** the settle score ≥ `SETTLE_TARGET` at the buzzer; saboteur wins on
   budget exhausted, score < `SETTLE_TARGET` at the buzzer, or attrition.
   Coverage% drops out of the win check and survives as FR-23 telemetry/KPI.

## Provisional target math

Expected arrivals per 300 s shift: ~10 (4p, 30 s cadence) / ~12.5 (5p) /
~16.7 (6p). Allowing the impatience self-assign lane and in-flight guests
at the buzzer, the provisional target is ~60% of expected arrivals:

| Lobby | Expected arrivals | `SETTLE_TARGET` (provisional) |
|---|---|---|
| 4p | ~10 | 5 |
| 5p | ~12 | 7 |
| 6p | ~16 | 9 |

**Provisional only**, per the §7 precedent: the value locks only after the
3.5 exit-bot balance gate re-proves settle throughput under interception-
shaped sabotage (the same gate that already governs the carry clock and
earshot rows).

## Sequencing

- Inserted as lettered cycle **3.D `delivery-scoring`** between 3.C (closed)
  and 3.3 (not started) — the same letter precedent as 3.B/3.C, same
  justification: 3.3's loss loop consumes these complaint triggers.
- **3.3 scope shrinks:** its budget counts trash-discovery complaints only;
  the wrong-delivery path is already non-counting when 3.3 speccs.
- **3.5 recalibrates:** the exit-bot gate calibrates `SETTLE_TARGET` (and
  re-checks the shrunken budget's reachability) instead of the coverage
  dials.

## Impact

| Area | Change |
|---|---|
| Sim arrival outcome | None — `guest:complained` + return-to-dining already match v1.5 |
| Sim win check | Buzzer verdict compares settle score to `SETTLE_TARGET` (was coverage %) |
| Tuning | `SETTLE_TARGET` row replaces the coverage-target row as the win dial |
| Win reasons | `coverage-met`/`coverage-failed` → `settle-target-met`/`settle-target-failed` |
| Client | Settle-score HUD counter (public info; saboteur sees it too) |
| Results/recap | Final settle count vs. target on the recap |
| Telemetry | Coverage sampling retained (FR-23); FR-24 KPI wording updated |
| Docs | prd v1.5 (§6.6, FR-29a note, FR-31, §7, §8), roadmap 3.D + 3.3 amendment, AD-039 |
