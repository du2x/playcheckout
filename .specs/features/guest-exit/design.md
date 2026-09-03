# Guest Exit Design (cycle 3.5, prd v1.5 + v1.6)

**Spec**: `.specs/features/guest-exit/spec.md`
**Status**: Approved

---

## Architecture Overview

Headless, deterministic bot harness that drives the real sim stack — `MovementSim` (walk 6 tiles/s, stairs 3 s + 2 s, single elevator airtime 2 s/floor, doors 0.5 s + dwell 3 s), `GuestSim` (seeded Rng, cadence 30/24/18 s, dwell 45–90 s, dining 15–30 s), `WorkChannels` (prep 5 s / un-prep 3 s) and `RoundSim` win checks (`budget-exhausted` before `round:buzzer`) — tick-for-tick at 20 Hz for a full 300 s shift. The harness measures the two §7 balance properties the economy stands on and decides the `SETTLE_TARGET` dial.

```mermaid
graph TD
    Harness[guestExit.ts bot runner<br/>20 seeds × 300s] --> M[MovementSim<br/>walk/elevator/stairs]
    Harness --> G[GuestSim<br/>cadence/dwell/dining]
    Harness --> W[WorkChannels<br/>churn/prep]
    Harness --> R[RoundSim<br/>settle/budget win]
    M --> G
    G --> W
    W --> R
    R --> Counters[settledCount / complaintCount<br/>win reason]
    Counters --> GateA[sim:guest_exit_a<br/>hit-rate assert]
    Counters --> GateB[sim:guest_exit_b<br/>win-band assert]
    GateB --> Dial[settleTargetFor()<br/>TUNING.SETTLE_TARGET]
```

No new protocol messages, no client change, no server change — the harness lives in `packages/sim` as `*.test.ts` scenarios, the only production file touched is `tuning.ts` if the bots force a dial move.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
|---|---|---|
| `MovementSim` (single car east `car:1`, stairs west `x=0`) | `packages/sim/src/movement.ts` | Drive bot walks, elevator calls (`callElevator` → pending board), in-car presses (`pressFloor`), stairs entries (`enterStairs`), and door-state; read `positionOf`/`viewOf`/`carFloors`/`stairsStateOf` for bot decisions |
| `GuestSim` + `MovementPort` adapter | `packages/sim/src/guests.ts` + `RoundSim.ts:PortAdapter` | Construct with `movement: PortAdapter(movement)` and `roomIntel` (work state + un-prep bool) — reuses the AD-028 NPC port (`joinGuest`/`removeGuest`/`announceGuest` + walk/elevator intents) |
| `RoundSim` win ladder | `packages/sim/src/roundSim.ts` | `tick(positions)` advances work → guest → justice → win checks; `settledCount`/`complaintCount`/`isEnded`/`saboteurId`/`restingSuitcases()` are the harness queries |
| `WorkChannels` churn model | `packages/sim/src/work.ts` | `churnTrash` on `guest:checked_out` creates `settled` churn that later guests can discover — the shrunken-budget bleed source |
| `TUNING` + `settleTargetFor` | `packages/shared/src/tuning.ts` | Only read through the helper; the gate calibrates `TUNING.SETTLE_TARGET` itself |
| `roomDoorXMilli` / `HALL_LENGTH_TILES` / `TUNING.DESK_X_TILES` etc. | `packages/shared/src/layout.ts` + `tuning.ts` | Bot spatial predicates: desk zone `DESK_RANGE_TILES`, door range `ROOM_DOOR_RANGE_TILES`, landing tolerance `ELEVATOR_LANDING_TILES`, stair mouth `atStairwellMouth` |
| `Rng` (mulberry32) | `packages/sim/src/rng.ts` | Not used directly by bots — guest draws reuse it; harness determinism comes from fixing `seed = 1..20` per run |
| Probe harness pattern | `packages/sim/src/complaints.test.ts` + `guests.test.ts` | Reuse the `PortAdapter` real-movement pattern, the `movement.tick()` → `sim.tick(positions)` production tick order, and the `runUntil`/`stage*` helper style |
| `affordances.ts` helpers | `packages/shared/src/affordances.ts` | Reference predicates only — bots use the same tile-unit expressions as the sim (`doorInRange`, `inAccuseRange`) but do not import the E-ladder |

### Integration Points

| System | Integration Method |
|---|---|
| Sim core | New file `packages/sim/src/guestExit.test.ts` imports `MovementSim`, `RoundSim`, `TUNING`, `roomDoorXMilli`, `HALL_LENGTH_TILES`; bots drive intents (`deskInteract`, `suitcasePlace`, `suitcasePickup`) and read events (`guest:assigned`, `suitcase:carried`, `suite:placed`, `guest:settled`, `guest:discovered`, `guest:complained`, `round:ended`) |
| Tuning | `packages/shared/src/tuning.ts` `SETTLE_TARGET` triple; change only via an AD if the gate forces it (the probe3/4 runs prove the provisional table holds, so the design predicts **no tuning change**) |
| Server/Client | None — the harness is `pnpm test:sim` only; no registry row, no message, no presenter |
| Prd/Roadmap | Docs-only amend if dial moves; otherwise the §8 v1.6 recompute note stays and a one-line calibration note lands in prd §7/§8 via AD |

---

## Components

### GuestExit bot runner (harness)

- **Purpose**: Single deterministic function `runShift(seed, ids, {withSabMisplace})` that returns `{settled, discovered, complained, misplaces, corrections, winReason}` for one full 300 s round; a thin loop runs it for 20 seeds and asserts the bands.
- **Location**: `packages/sim/src/guestExit.test.ts` (test file, not a shipped module) — helpers inside the file, no exported runtime.
- **Interfaces**:
  - `runPureChurn(seed, lobbySize): {settled, discovered, win}` — staff bots only, stairs-preferring delivery, no sab sabotage, no mis-placement
  - `runWithMisplace(seed): {settled, discovered, complained, misplaces, corrections, win}` — plus the saboteur bot that for each carried guest places at `room+1 mod 8` and the idle-scan correction bots
  - `staffBotsTick()` — per-tick walk/call/press/place decision (see below)
  - `sabBotsTick()` — same floor logic but `target = wrongRoom`
- **Dependencies**: `MovementSim`, `RoundSim`, `TUNING`, `roomDoorXMilli`, `HALL_LENGTH_TILES`
- **Reuses**: `PortAdapter` (real movement), the complaint-loop `toExit` walk, the `guest:assigned` building-wide store, the `restingSuitcases()` query for misplace detection

#### Bot decision detail (per tick, before `movement.tick()`)

*Movement choice* — stairs-first (the §8 v1.6 relief valve):

- If the bot carries a suitcase to `target.floor != pos.floor`: walk to `STAIR_X=0` (`ELEVATOR_LANDING_TILES` mouth), `enterStairs(dir)` toward target (3 s + 2 s per stride); if `ignored` (wrong mouth or no adjacent floor), fallback to the east-landing `callElevator` → `pressFloor(target)` once `viewOf(car)=1`.
- If the bot is idle without a carry but a misplaced resting suitcase exists (`rest ≠ guest:assigned`): treat its `rest.floor/room` as the temporary target and walk there (same stairs-first rule); on arrival `suitcasePickup` within `ROOM_DOOR_RANGE_TILES`, then re-target to the correct assignment.
- Otherwise (idle, no correction): return to the lobby desk (`DESK_X_TILES`) — walk to `STAIR_X` and `enterStairs(down)` from guest floors, elevator fallback; on the lobby floor walk to `DESK_X` within `DESK_RANGE_TILES`.

*Riding* — while `viewOf(car)=1` and carrying: `pressFloor(target.floor)` each tick; when `carFloors()[0].floor === target.floor`, hold the exit direction (`startMove` toward the door) so the `dwelling` hop applies the tick doors are fully open (`DOOR_TICKS` swing).

*Sim intents* — after movement decisions and the `positions` map sync (`movement.positionOf → positions`):

- `deskInteract(sid)` for any non-carrying bot whose `positions.get(sid).floor==='lobby'` and `|x/1000 - DESK_X| ≤ DESK_RANGE_TILES`.
- `suitcasePickup(sid)` for any idle staff whose `movement.positionOf(sid)` is within `ROOM_DOOR_RANGE_TILES` of a misplaced rest (staff only, sab never corrects).
- `suitcasePlace(sid, room)` for any carrying bot whose `movement.positionOf(sid).floor === target.floor` and `|x - doorX(target.room)| ≤ ROOM_DOOR_RANGE_TILES`.

### Gate `sim:guest_exit_a` (pure churn — P1)

- **Purpose**: Prove provisional `SETTLE_TARGET` honest against churn under the one-car + stairs trough.
- **Location**: `describe('sim:guest_exit_a')` in `guestExit.test.ts`.
- **Interfaces**: `it('6p stairs bots reach target at 80%')` runs 20 pure-churn shifts at 6p and asserts `hitCount ≥ 16` (≥80%), plus 5p ≥16/20 and 4p ≥15/20; asserts `discovered` mode ≤2 and `<8` in ≥19/20; asserts determinism (seed 7 replay identical) and zero-misplace pin.
- **Dependencies**: Bot runner `runPureChurn`
- **Reuses**: `TUNING.GUEST_CADENCE_SECONDS`, `settleTargetFor`

### Gate `sim:guest_exit_b` (mis-place vs interception — P2)

- **Purpose**: Prove the suitcase interception race is defensible and the three kill checks.
- **Location**: `describe('sim:guest_exit_b')` in `guestExit.test.ts`.
- **Interfaces**: `it('6p sab room+1 vs intercepting staff 30–70% win band')` runs 20 mis-place shifts at 6p and asserts staff win rate in 6..14/20, `corrections ≥ misplaces × 0.5` on average, `guest:complained` fires at least once across the 20 seeds but `guest:discovered` never moves on the same flush (budget inert), and the ambush-with-no-trash pin (0 `guest:discovered` from the ambush alone). A second `it` pins wrong-delivery inertness (no score, no budget).
- **Dependencies**: Bot runner `runWithMisplace`, `TUNING.COMPLAINT_BUDGET`
- **Reuses**: `restingSuitcases()` misplace detector, `guest:complained` vs `guest:discovered` split (AD-041)

### Docs & AD (P3)

- **Purpose**: Record the calibrated dial and the §8 headroom proof.
- **Location**: `packages/shared/src/tuning.ts` (only if the gate forces a move), `prd.md` §7/§8, `roadmap.md` Phase 3 exit, `.specs/STATE.md` AD-NNN
- **Interfaces**: `settleTargetFor` read-path, `TUNING.SETTLE_TARGET` write (recorded)
- **Dependencies**: Gate artifacts (hit rates, mode, win band)

---

## Data Models

No new shipped types. Harness-local:

```typescript
type RunStats = {
  seed: number
  settled: number            // GuestSim.settledCount at round:ended
  discovered: number         // RoundSim.complaintCount (guest:discovered only)
  complained: number         // guest:complained count (wrong-delivery door lines)
  misplaces: number          // suitcase:placed by sab at wrong room
  corrections: number        // suitcase:picked_up by staff that corrected a misplace
  win: 'staff' | 'saboteur'  // round:ended winner (settle-target-met / failed)
  reason: string
}

type BotState = {
  carrying: boolean
  guestId: string | null
  target: { floor: FloorId, room: number } | null
  isSab: boolean
}
```

**Relationships**: `guest:assigned` store (`guestId → {floor,room}`) is the ground truth; `restingSuitcases()` is the hallway-visible re-target set; a `rest ≠ assigned` mismatch is the interception trigger.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
|---|---|---|
| `settleTargetFor` out-of-range lobby (3 or 7) | Clamp to nearest (`3→4p, 7→6p`) — same as shared helper | Deterministic target, never NaN |
| Bot stands at `x=0` but `enterStairs` returns `ignored` (not at mouth due to float) | Fallback to east-landing elevator (`callElevator` + `pressFloor`) | Trip still completes, slower but correct |
| Door-range `suitcasePlace` returns `ignored` (off by 0.01) | Bot re-walks to door next tick (no loop) | One-tick delay, negligible |
| Saboteur and staff both `deskInteract` same tick | First `checkIn` accepted, second sees empty queue — `ignored` | Guest assignment goes to one carrier only |
| Buzzer fires mid-guest-walk or mid-stairs | `RoundSim` discards the in-flight guest (GUEST-11) and `MovementSim.resolveStairsForResults()` pins arrivals | No stray settle/discovery after the buzzer |
| Carry-clock expiry fires the carrier | `GuestSim.drainExpiredCarriers` → `Justice.fire` in same flush; bot's `leave` cleans the suitcase | Staff win check counts reduced live staff |
| Ambush while a guest discovery is in-flight | `detectAmbushes` runs after the guest tick — ambush payload never names a complaint; `driveToResting` re-target is unaffected | Kill check stays pinned |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
|---|---|---|---|
| `MovementSim` is the most-amended file in the repo (AD-012…040) and the harness drives it at full rate | `packages/sim/src/movement.ts:1` | Small elevator/stairs regression could drift every seed | Design pins the production tick order (`movement.tick()` → `sim.tick(positions)`) and reuses the `PortAdapter` pattern the room ships; a one-seed determinism assert fails the gate on drift |
| Probe2's naive walk-to-east-landing bots deadlocked some seeds (seed 1 settled=4) before the stairs relief | `packages/sim/src/movement.test.ts:39` (`boardParkedCar`) | Throughput would be underestimated and the dial mis-calibrated | Design forces stairs-first for staff — §8 v1.6's own relief valve; elevator is fallback, guests keep E, so guest headroom stays 1.5× |
| `suitcasePickup` spam (one per tick) inflated correction counts in probe5 (4000 vs 5) | `packages/sim/src/guests.ts:480` | Win-band would be noisy | Design restricts pickup to misplaced rests only (`rest ≠ assigned`) and only when `doorInRange`; idle bots scan once per tick, not per frame |
| `COMPLAINT_BUDGET=8` reachability drift under the shrunken scope — churn alone never hits 8 (mode ≤2) | `packages/shared/src/tuning.ts:89` | Budget leg could become dead | Design re-checks reachability via a 60 s trash-blitz property (not a gate) and records the verdict in AD; if unreachable, a new AD lowers the budget |
| `SETTLE_TARGET` change needs a recorded AD per repo tuning rule | `packages/shared/src/tuning.ts:88` | Silent dial edit would violate the product contract | Design predicts **no change** (probe4 hit 100% at 6p, probe3 avg 10.8), but if the gate forces a move the tasks write the AD before the tuning edit |
| Harness runtime at 20 seeds × 300 s × 20 Hz ≈ 120k ticks | Vitest runner | Gate must stay <2 s | Single-file harness, no Playwright, 20 seeds is the budget — earlier probes ran in 300–600 ms; `TUNING.SE…` overrides stay test-only via `guestTiming` passthrough, not wall-clock sleeps |

---

## Tech Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Bot shape | Stairs-preferring delivery bots + idle-scan correction, not a rate scalar | Stairs-first is the §8 v1.6 design; teleport-cheats (probe1 10–14) over-estimate, walk-only bots under-estimate; the harness must be honest |
| Lobby set | 6p gate, 5p/4p also asserted | §7 table is per lobby; 6p is worst cadence (18 s) and the Phase 3 exit rule says the cadence dials hold until this gate |
| Seed count | 20 seeds (1..20) | Probe variance stabilizes by 10; 20 gives a binomial band ±11% at 80%, enough to see 30–70% without being 100 |
| Sab mis-place model | `room+1 mod 8` on the assigned floor | Deterministic, free, never equals the assignment, minimal code — the simplest falsifiable sab |
| Write location | `packages/sim/src/guestExit.test.ts` | Pure sim, no server/client, no protocol; keeps the 323-test baseline untouched unless tuning moves |
| Tuning read path | `settleTargetFor(lobbySize)` only | AD-039 API — clamps out-of-range counts |

> **Project-level decisions:** This feature's only §7 write is `SETTLE_TARGET` itself; if the gate forces a move, append the next `AD-NNN` in `.specs/STATE.md` per memory.md. Otherwise no new AD beyond the handoff's `AD-XXX` entry.

