# Telemetry Design (cycle 3.6, Phase exit)

**Spec**: `.specs/features/telemetry/spec.md`
**Status**: Draft

---

## Architecture Overview

Telemetry is server-authoritative but sim-shaped: the deterministic core maps past-tense domain facts to JSONL lines (ticks → `timeMs`), and the thin transport shell owns the file sink. This preserves AD-002 (sim owns the round, room owns the lifecycle) and the message-only hard rule — telemetry never enters `PROTOCOL_REGISTRY`.

```mermaid
graph TD
    Sim[RoundSim + MovementSim + GuestSim] -->|SimEvent / MovementEvent per tick| Sink[TelemetrySink packages/sim]
    Sink -->|TelemetryLine time = tick*50| Room[TurnoverRoom apps/server]
    Room -->|append JSONL per tick, 1/s coverage sample| File[data/telemetry/<roomId>-<roundIndex>.jsonl]
    File -->|string[] per file| KPIs[computeKpis packages/sim]
    KPIs -->|Kpis JSON + console| Report

    Work[WorkChannels.preppedCount] -.-> Sink
    Justice[Justice deal + didSabotage] -.-> Sink
```

**Chosen approach (A) — Sim-owned `TelemetrySink` + server file writer:**

- `TelemetrySink` lives in `packages/sim` (pure, no I/O): buffer of `TelemetryLine` objects, `record(event, tick, actor, room, floor, justice)` mapping + `sampleCoverage(tick, preppedCount)` synthetic. Tests consume the sink directly (no filesystem).
- `TurnoverRoom` owns one sink per round + the JSONL file handle: on every 20 Hz `tick()` it drains the sim's emitted events and the movement layer's elevator events into the sink, appends lines to the file, and at `round:ended`/`aborted` flushes the final line and closes. Aborted files remain on disk but carry `winner:'aborted'` and the KPI layer excludes them.

**Alternatives considered:**

| Approach | Trade-off | Why not chosen |
|---|---|---|
| **B — Router tap only** (server sniffs every routed event, no sim change) | Avoids sim touch | Coverage (`preppedCount/24`) and accusation flags (`wasTargetSaboteur`/`crimeOccurred`) need `WorkChannels` + `Justice` state that only the sim owns — the router would re-derive them and drift |
| **C — Hybrid: sim returns `TelemetryEvent[]` per `tick()`** | Sim does mapping inline | Couples the 20 Hz hot path return type to file I/O concerns; the sink-buffer decouples mapping from flushing and keeps `RoundSim.tick()`'s existing `SimEvent[]` return shape byte-identical for all existing callers |

Recommendation **A** keeps `packages/sim` deterministic, `roundSim.tick()` unchanged, and `apps/server` as a line-appending shell — the AD-002 seam.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
|---|---|---|
| `TelemetryEvent` placeholder | `packages/shared/src/protocol/telemetry.ts:8` | Widen `TelemetryEventKind` + `TelemetryEvent`/`TelemetryLine` fields (add `guest-*`, `suitcase-*`, `tenancy`, `carry-clock-expiry`, `walk-in-catch`, `accusation` flags, `provenance`, `actorId`, `coverage`); export `Kpis` + `computeKpis` signature |
| `RoundSim` + `MovementSim` + `GuestSim` | `packages/sim/src/roundSim.ts`, `movement.ts`, `guests.ts` | Existing event streams are the telemetry source 1:1 — no new sim events; sink reads `WorkChannels.preppedCount`, `Justice.saboteurId`/`didSabotage`, `GuestSim.settledCount` |
| `WorkChannels` + `Justice` | `packages/sim/src/work.ts:127`, `justice.ts` | Coverage = `preppedCount/24`; accusation flags = `targetId===saboteurId` + `justice.didSabotage` at tick |
| `PROTOCOL_REGISTRY` / `SimEvent` / `MovementEvent` | `packages/shared/src/protocol/*` | Exhaustive registry ensures every future sim event that should be logged is a typed addition — telemetry mapping is `satisfies Record<SimEvent['type'], …>` friendly (AD-006) |
| `guestExit` harness `PortAdapter` | `packages/sim/src/guestExit.test.ts:11` | Copy the real `MovementSim` port adapter for `exit_a`/`exit_b`; theirs is the reference for stairs-preferring delivery bots |
| `computeKpis` test pattern | `packages/sim/src/guestExit.test.ts` synthetic harness shape | Hand-counted 20-file synthetic generator for P3 — same deterministic harness discipline |
| `TurnoverRoom` tick + file pattern | `apps/server/src/rooms/TurnoverRoom.ts` (AD-004/AD-028 seams) | Reuse `TURNOVER_TEST_*` env pattern for harnesses; file path `data/telemetry/<roomId>-<roundIndex>.jsonl` mirrors the `existSync(CLIENT_DIST)` guard in `index.ts` |

### Integration Points

| System | Integration Method |
|---|---|
| `packages/shared` → `packages/sim` | Shared widened telemetry types imported by the sink and `computeKpis` — no runtime dependency, type-only |
| `packages/sim` → `apps/server` | `TelemetrySink` instance per room-round; room calls `sink.drain()` per tick and appends via `node:fs` `createWriteStream({flags:'a'})` — the only I/O site |
| Disk → KPI layer | Pure `computeKpis(jsonlFiles: readonly string[][])` over line arrays — callable from vitest and from a `tsx` CLI (`pnpm kpi < file.jsonl`) without a running server |

---

## Components

### TelemetrySink (pure, packages/sim)

- **Purpose**: Map each tick's domain facts to JSONL lines; buffer until the room drains.
- **Location**: `packages/sim/src/telemetry.ts` (new)
- **Interfaces**:
  - `constructor(seed: number, saboteurId: string | null)` — seed kept for determinism tag only; `saboteurId` resolved at RoundSim start when the deal is known (lazy setter `setSaboteurId(id)` if null at construction)
  - `recordSim(event: SimEvent, tickIndex: number, ctx: { work: WorkChannels; justice: Justice }): void` — one JSON line per eligible event (room transitions include `state`+`provenance` when available)
  - `recordMovement(event: MovementEvent, tickIndex: number): void`
  - `recordCarryClockExpired(carrierId: string, tickIndex: number): void` — the `player:fired` `carry-clock` drain path
  - `sampleCoverage(tickIndex: number, preppedCount: number): void` — appends synthetic `coverage-sample` iff `tickIndex % 20 === 0` and round still live
  - `drain(): readonly TelemetryLine[]` / `toJSONL(): string[]` — returns and clears buffer; `toJSONL` serializes `JSON.stringify` one line each
  - `lines: readonly TelemetryLine[]` getter for tests (read-only snapshot before drain)
- **Dependencies**: `packages/shared` widened types, `WorkChannels`, `Justice`
- **Reuses**: Existing `TICK_HZ=20` constant for the 1/s cadence; `roomKey` helper for `room = floor:room`

### Widened Shared Protocol (`packages/shared`)

- **Purpose**: Single source of truth for the post-guest JSONL schema and the KPI shape — never sent on the wire.
- **Location**: `packages/shared/src/protocol/telemetry.ts`
- **Interfaces**:
  - `TelemetryEventKind = 'room-transition'|'elevator-call'|'elevator-ride'|'elevator-doors'|'walk-in-catch'|'accusation'|'coverage-sample'|'guest-arrived'|…|'tenancy'|'carry-clock-expiry'` — 14+ kinds (core 7 + guest 8 + tenancy + carry-clock)
  - `TelemetryLine { kind, time, tick, actor?, room?, floor?, guestId?, carrierId?, fresh?, provenance?, actorId?, state?, coverage?, winner?, reason? }` — flat JSONL row; exactly one `kind` per line
  - `Kpis { rounds, saboteurWinRate, correctAccusationRate, catchesPerHour, meanTimeToFirstCrimeSeconds: number | null, decoyCallRate, meanSettleScore, meanComplaintsPerRound, carryClockFiresPerRound, provenanceSplit: {sabotage, churn}, settlesPerMinute, malformedLines }`
  - `computeKpis` signature kept in `packages/sim` (pure) — the shared file holds the type, not the impl
- **Dependencies**: `RoomIndex`, `FloorId` types only
- **Reuses**: Existing 6-kind placeholder shape — fields widened, no renames for the 6 that already exist

### KPI Computation (`packages/sim`)

- **Purpose**: Pure aggregation over one or more rounds' JSONL lines.
- **Location**: `packages/sim/src/kpis.ts` (new) — or `packages/sim/src/telemetry.ts` if co-located; a thin `kpis.ts` keeps the sink focused on line emission
- **Interfaces**:
  - `computeKpis(files: readonly (readonly string[])[]): Kpis` — each inner array is one round's lines; aborts excluded; unknown/malformed lines skipped and counted in `malformedLines`
  - `computeKpisFromLines(lines: readonly TelemetryLine[]): Kpis` — test helper avoiding string parse
- **Dependencies**: Widened `TelemetryLine`/`Kpis` types only
- **Reuses**: `settledCount`/`complaintTotal` semantics (already readable from lines) — the 1/s coverage lines are available for future coverage variance KPIs but not required for the 3.6 set

### Server File Wiring (`apps/server`)

- **Purpose**: Persist per-round JSONL and close on `round:ended`/`aborted`.
- **Location**: `apps/server/src/rooms/TurnoverRoom.ts` (existing file, surgical edit) + optional `apps/server/src/telemetry/fileSink.ts` extract if the room method grows past ~40 lines
- **Interfaces** (room-local, not exported):
  - `private telemetry?: { sink: TelemetrySink; stream: WriteStream; path: string; roundIndex: number }`
  - `private openTelemetry(roundIndex: number): void` — `mkdir -p data/telemetry`, `createWriteStream(path, {flags:'a'})`, write header comment `{"kind":"round-started","roomId":…, "seed":…}` as line 0 for grep convenience
  - `private appendTelemetry(lines: readonly TelemetryLine[]): void` — one `write(JSON.stringify(line)+"\n")` per line (no buffering beyond Node stream)
  - `private closeTelemetry(): Promise<void>` — `stream.end()` awaited before emitting `round:ended` to the clients? No — room still emits `round:ended` to clients in the same flush; the file close waits for drain but never blocks the wire.
- **Dependencies**: `node:fs`, `node:path`, `TelemetrySink`
- **Reuses**: `activeCodes` / `roomId` as the file prefix (`<code>-<idx>.jsonl`), AD-004 `testShiftTicks` seam for harness rounds

### Exit-Bot Harnesses (`packages/sim`)

- **Purpose**: Re-prove the v1.2 bars under the full economy as the phase-exit gate.
- **Location**: `packages/sim/src/telemetry.test.ts` (new) — `describe('sim:exit_a')` + `describe('sim:exit_b')`; plus the shared `guestExit.test.ts` harness stays green (no copy)
- **Interfaces**: No exported API — the `describe` blocks are the gates. Internals:
  - `runAfkExit(seed, size): {lines, win, settled, discovered}` — builds `MovementSim` + `RoundSim` with `PortAdapter`, stairs-preferring bots (copy of `guestExit` `runPureChurn` bots without mis-placement), AFK saboteur
  - `runBlitzExit(seed): {lines, win, discovered}` — same bots but the saboteur blitzes ticks 240–300 s: every `UNPREP_TICKS` interval `startWork` on the nearest un-prepped room within `ROOM_DOOR_RANGE_TILES` (deterministic floor scan `floor1→floor3`, `room 1→8`)
- **Dependencies**: `MovementSim`, `RoundSim`, `PortAdapter`, `TelemetrySink`, `computeKpis`
- **Reuses**: `guestExit.test.ts:11` `PortAdapter` verbatim; `GUEST_FLOOR_IDS` + `roomDoorXMilli` + `TUNING` constants — zero duplicated geometry

---

## Data Models

### TelemetryLine (JSONL row, shared)

```typescript
type TelemetryLineKind =
  | 'room-transition'   // actor, room=F:R, floor, roomIdx, state, provenance
  | 'elevator-call'     // actor, floor, car
  | 'elevator-ride'     // car, floor (from elevator:moved)
  | 'elevator-doors'    // car, floor, open
  | 'walk-in-catch'     // actor (entrantId), caughtPlayer (saboteurId)
  | 'accusation'        // actor (accuserId), targetId, wasTargetSaboteur, crimeOccurred
  | 'coverage-sample'   // coverage 0..1 (preppedCount/24)
  // guest extension
  | 'guest-arrived' | 'guest-assigned' | 'guest-self-assigned'
  | 'suitcase-carried' | 'suitcase-placed' | 'suitcase-picked-up'
  | 'guest-settled' | 'guest-checked-out' | 'guest-left'
  | 'guest-angered' | 'guest-discovered' | 'guest-complained' | 'tenancy'
  | 'carry-clock-expiry' // actor = carrierId
  | 'round-ended'     // winner, reason, saboteurId (machine-readable close marker; never counted as a domain KPI numerator)

interface TelemetryLine {
  readonly kind: TelemetryLineKind
  readonly tick: number        // 0-based
  readonly time: number        // tick * 50 ms
  readonly actor?: string
  readonly room?: string       // "floor1:3" for room-transition
  readonly floor?: FloorId
  readonly roomIdx?: RoomIndex
  readonly car?: CarId
  readonly guestId?: string
  readonly carrierId?: string
  readonly targetId?: string
  readonly wasTargetSaboteur?: boolean
  readonly crimeOccurred?: boolean
  readonly fresh?: boolean
  readonly provenance?: 'sabotage' | 'churn' | 'none'
  readonly state?: RoomState
  readonly coverage?: number
  readonly winner?: 'staff' | 'saboteur' | 'aborted'
  readonly reason?: string
  readonly saboteurId?: string | null
  // guest-discovered specifics
  readonly actorId?: string    // saboteur actor on sabotage provenance only
}
```

**Relationships**: One line per eligible `SimEvent`/`MovementEvent` (+ one synthetic `coverage-sample` per 20 ticks). `round-ended` is the file's close marker — one per file, last line.

### Kpis (aggregation over files)

```typescript
interface Kpis {
  readonly rounds: number                // non-aborted files
  readonly abortedRounds: number
  readonly malformedLines: number
  // v1.2 five
  readonly saboteurWinRate: number       // 0..1
  readonly correctAccusationRate: number // 0..1 (0 when no accusations)
  readonly catchesPerHour: number        // walk-in catches × 12 / (rounds×5)
  readonly meanTimeToFirstCrimeSeconds: number | null // mean tick*0.05 of first sabotage room-transition
  readonly decoyCallRate: number         // elevator-call with no board within 60 ticks / total calls (board = walk-in not observable here — define as: call not followed by any elevator-ride of that car within 60 ticks)
  // guest bleed-vs-throughput four
  readonly meanSettleScore: number
  readonly meanComplaintsPerRound: number // guest-discovered only
  readonly carryClockFiresPerRound: number
  readonly provenanceSplit: { readonly sabotage: number; readonly churn: number }
  readonly settlesPerMinute: number
}
```

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
|---|---|---|
| Malformed JSONL line (hand-edited or crash-partial last line) | `computeKpis` skips the line, increments `malformedLines`, continues — never throws | KPI report shows a non-zero `malformedLines` hint; aggregation still completes |
| Unknown `kind` on a line (forward-compatible) | Skip + `malformedLines++` — a newer binary's file read by an older `computeKpis` | Same as malformed — graceful forward compat |
| Disk write fails (`ENOENT`/`ENOSPC`) | Log to `console.error('[telemetry] write failed', path, err)` and keep the round live — the file is best-effort observability, never a gameplay gate | Round plays to completion; post-round `pnpm kpi` warns about a missing file |
| `computeKpis([])` or all-aborted input | Returns `rounds:0` and every rate `0` (or `null` for `meanTimeToFirstCrimeSeconds`) — no division-by-zero throw | Phase-exit script reports "no data" rather than crashing |
| `TelemetrySink` constructed before deal (saboteurId unknown) | Sink created with `saboteurId=null`, `setSaboteurId(id)` called on the first `tick()`'s `role:dealt` drain — accusation flags before the deal are never logged (impossible: `accuse` rejects `round-not-active`) | No impact |
| Server crash between `append` and `close` | Partial file stays readable: last partial line is the only malformed line (spec Edge Case 4) | Next `computeKpis` run counts one `malformedLines`; no file corruption beyond the tail |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
|---|---|---|---|
| `TurnoverRoom` tick already ~180 lines and acquires a second `WriteStream` owner (leak on abort/disconnect) | `apps/server/src/rooms/TurnoverRoom.ts:1` | Unclosed handles block `pnpm test:server` teardown | Extract `fileSink.ts` if the method exceeds ~40 lines; close in `onLeave`/`onDispose` and in the ghost/abort paths; test asserts `stream.writableEnded` after `round:ended` |
| Previous `TelemetryEvent` 6-kind union has tests that assert the exact union (`telemetry.test` not yet written) — widening breaks baseline | `packages/shared/src/protocol/telemetry.ts:8` | `pnpm typecheck` fails on old narrowing | Widen atomically and update the single baseline test in the same commit (T1) |
| Decoy definition "call with no subsequent board within 60 ticks" is a proxy — the step-0 definition tracked call→ride, not board | `packages/sim/src/kpis.ts` | KPI mis-reports decoy vs legitimate idle call | Pin exact definition in the P3 AC + a hand-counted synthetic test; revisit via AD if playtests show a better board proxy (telemetry-only, never a dial) |
| Stairs-preferring bots duplicated from `guestExit.test.ts` drift copy-paste on the next elevator AD | `packages/sim/src/guestExit.test.ts:11` `PortAdapter` | Exit_a/b behavior diverges from the guest-exit keep-pace model | Single shared helper `packages/sim/src/botHarness.ts` if the second copy appears (T6 optional refactor) — at 3.6 scope, copy once and comment `// keep in sync with guestExit.test.ts:PortAdapter` |
| Bulk exit harness (~40 sim×300 s = 12k ticks×3 sizes ≈ 36s) risks `test:sim` timeout (120 s wall) | `packages/sim/src/telemetry.test.ts` | CI `test:sim` flakes on `sim:exit_a`/`sim:exit_b` | Keep each `describe` under 30 s (6p only for exit_b, 4/5/6 for exit_a via a single loop) and reuse the 60 s fast-guest seam `TURNOVER_TEST_GUEST_SCALE=0.2` for the local run? No — the bots must run the real 300 s economy; gate 3 uses `TURNOVER_TEST_SHIFT_SECONDS=8` for server tests, unrelated. Monitor wall time and split `describe` if >60 s |

> Project-level hot spot: `packages/sim/src/movement.ts` is the most-amended file in the repo (AD-012…040) — this design reads it but never mutates it, so the hot-spot risk stays contained to the bot harness copy.

---

## Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
|---|---|---|
| Where the file lives | `data/telemetry/<code>-<idx>.jsonl` relative to project root, `mkdir -p` on open | Railway single-container: local disk survives the session; no DB/Auth stack (prd §11) |
| Line format | `JSON.stringify(TelemetryLine)+"\n"` — one JSON object per line, no header array | Line-delimited survives crash-partial tails; `grep`/`jq` friendly |
| Who owns the `round-ended` line | The sink records `round:ended` exactly once per file, from the sim's `RoundSim.tick()` drain (`winner`/`reason`/`saboteurId`), plus the room-originated `aborted` path via `onLeave` ghost/abort | Mirrors the wire's single `round:ended` (REND-05: exactly once) — the file's last line is the close marker |
| `computeKpis` location | `packages/sim/src/kpis.ts` (pure, no server import) | Tests and `pnpm kpi` both call it headless — no server live |
| Telemetry never on the wire | No `PROTOCOL_REGISTRY` entry, no client mapper, no `window.__TURNOVER__` hook | FR-23 is internal-only; a registry entry would ship hidden state to clients (turnover-protocol hard rule) |

> **Project-level decision to record:** None beyond the shared-type widening — the file location and line format are implementation details, not conventions future cycles must follow, so no new AD is needed here. The phase-exit AD-044 will record the five telemetry choices, measured KPIs, and handoff to Phase 4 when Execute closes.

