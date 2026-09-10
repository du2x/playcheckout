import { describe, expect, it } from 'vitest'
import {
  ALL_SIM_EVENT_TYPES,
  projectSimEventToTelemetry,
  TELEMETRY_PROJECTIONS,
  TelemetrySink,
  UNTRACKED_SIM_EVENTS,
} from './telemetry'

// Telemetry projection completeness (the Card-4 audit): every SimEvent kind
// must sit in EXACTLY one of the projection table or the named untracked
// list — a new sim event that skips both is a failing test, not silent
// telemetry drift. The type-level half lives in telemetry.ts (the
// ALL_SIM_EVENT_TYPES exhaustiveness assertion fails the build).

describe('telemetry projections — completeness audit', () => {
  it('sorts every sim event kind into exactly one of row or untracked', () => {
    const tracked = new Set(Object.keys(TELEMETRY_PROJECTIONS))
    const untracked = new Set<string>(UNTRACKED_SIM_EVENTS)
    for (const kind of ALL_SIM_EVENT_TYPES) {
      expect(tracked.has(kind) || untracked.has(kind), `${kind} is neither tracked nor named`).toBe(
        true,
      )
      expect(tracked.has(kind) && untracked.has(kind), `${kind} is both tracked and named`).toBe(
        false,
      )
    }
    // No row names a kind outside the union (the satisfies clauses already
    // type-check both sides; this is the runtime mirror).
    for (const kind of tracked) expect(ALL_SIM_EVENT_TYPES).toContain(kind)
    for (const kind of untracked) expect(ALL_SIM_EVENT_TYPES).toContain(kind)
  })

  it('projects guest:discovered with sabotage provenance and the actor', () => {
    const sink = new TelemetrySink('saboteur-1', 7)
    projectSimEventToTelemetry(
      sink,
      { type: 'guest:discovered', guestId: 'g1', floor: 'floor1', room: 3, fresh: true },
      42,
      { saboteurId: 'saboteur-1' },
    )
    const lines = sink.drain()
    expect(lines).toHaveLength(1)
    const line = lines[0] as unknown as Record<string, unknown>
    expect(line.kind).toBe('guest-discovered')
    expect(line.provenance).toBe('sabotage')
    expect(line.actorId).toBe('saboteur-1')
  })

  it('a churn discovery names checkout churn, never the actor', () => {
    const sink = new TelemetrySink('saboteur-1', 7)
    projectSimEventToTelemetry(
      sink,
      { type: 'guest:discovered', guestId: 'g1', floor: 'floor1', room: 3, fresh: false },
      42,
      { saboteurId: 'saboteur-1' },
    )
    const line = sink.drain()[0] as unknown as Record<string, unknown>
    expect(line.provenance).toBe('churn')
    expect(line.actorId).toBeUndefined()
  })

  it('player:fired records only the carry-clock reason (justice fires are not carry fouls)', () => {
    const carry = new TelemetrySink(null, 7)
    projectSimEventToTelemetry(
      carry,
      { type: 'player:fired', playerId: 'p1', reason: 'carry-clock' },
      10,
      { saboteurId: 's1' },
    )
    expect(carry.drain()).toHaveLength(1)

    const justice = new TelemetrySink(null, 7)
    projectSimEventToTelemetry(
      justice,
      {
        type: 'player:fired',
        playerId: 'p1',
        reason: 'accused',
      } as unknown as Parameters<typeof projectSimEventToTelemetry>[1],
      10,
      { saboteurId: 's1' },
    )
    expect(justice.drain()).toHaveLength(0)
  })

  it('untracked kinds are a no-op', () => {
    const sink = new TelemetrySink(null, 7)
    projectSimEventToTelemetry(sink, { type: 'round:buzzer' }, 99, { saboteurId: 's1' })
    expect(sink.drain()).toHaveLength(0)
  })
})
