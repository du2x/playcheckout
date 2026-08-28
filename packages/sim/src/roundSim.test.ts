import { TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import type { SimEvent } from './events.js'
import { createRoundSim, RoundSim, TICK_HZ } from './index.js'

// Tuning cited: TUNING.SHIFT_SECONDS (300 s) × TICK_HZ (20) = 6000 ticks (prd §7, §11).
const IDS = ['p1', 'p2', 'p3', 'p4']

function runFullRound(seed: number, playerIds: string[]): SimEvent[] {
  const sim = createRoundSim({ seed, playerIds })
  const events: SimEvent[] = []
  for (let t = 0; t < RoundSim.TOTAL_TICKS; t++) events.push(...sim.tick())
  return events
}

// Gate scenario `sim:role_deal` — spec DEAL-01, DEAL-06, CLK-01..04.
describe('sim:role_deal', () => {
  it('emits round:started and one private role:dealt per player on the first tick', () => {
    const sim = createRoundSim({ seed: 1234, playerIds: IDS })
    const first = sim.tick()
    expect(first[0]).toEqual({ type: 'round:started', playerIds: IDS })
    const dealt = first.filter((e) => e.type === 'role:dealt')
    expect(dealt).toHaveLength(IDS.length)
    const saboteurs = dealt.filter((e) => e.type === 'role:dealt' && e.role === 'saboteur')
    expect(saboteurs).toHaveLength(1)
  })

  it('yields exactly one saboteur across 1000 seeds (DEAL-01)', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const sim = createRoundSim({ seed, playerIds: IDS })
      const dealt = sim.tick().filter((e) => e.type === 'role:dealt')
      const saboteurs = dealt.filter((e) => e.type === 'role:dealt' && e.role === 'saboteur')
      expect(saboteurs).toHaveLength(1)
    }
  })

  it('is deterministic: a fixed seed reproduces the identical full event sequence (DEAL-06)', () => {
    const a = runFullRound(777, IDS)
    const b = runFullRound(777, IDS)
    expect(a).toEqual(b)
  })

  it('starts the clock at 300 s worth of ticks (TUNING.SHIFT_SECONDS × TICK_HZ)', () => {
    const sim = createRoundSim({ seed: 1, playerIds: IDS })
    expect(sim.clockTicksRemaining).toBe(TUNING.SHIFT_SECONDS * TICK_HZ)
    expect(RoundSim.TOTAL_TICKS).toBe(6000)
  })

  it('decrements the clock by exactly one tick per tick (CLK-02: 0.05 s per tick)', () => {
    const sim = createRoundSim({ seed: 1, playerIds: IDS })
    sim.tick()
    expect(sim.clockTicksRemaining).toBe(5999)
    sim.tick()
    expect(sim.clockTicksRemaining).toBe(5998)
  })

  it('fires the buzzer at exactly tick 6000 and never again (CLK-03)', () => {
    const events = runFullRound(42, IDS)
    const buzzers = events.filter((e) => e.type === 'round:buzzer')
    expect(buzzers).toHaveLength(1)
    const sim = createRoundSim({ seed: 42, playerIds: IDS })
    for (let t = 1; t < RoundSim.TOTAL_TICKS; t++) sim.tick()
    const last = sim.tick()
    expect(last).toEqual([{ type: 'round:buzzer' }])
  })

  it('emits nothing from ticks past the buzzer', () => {
    const sim = createRoundSim({ seed: 42, playerIds: IDS })
    for (let t = 0; t < RoundSim.TOTAL_TICKS; t++) sim.tick()
    expect(sim.clockTicksRemaining).toBe(0)
    expect(sim.tick()).toEqual([])
  })

  it('rejects deal sizes outside 4-6 players (TUNING.PLAYERS_MIN/MAX)', () => {
    expect(() => createRoundSim({ seed: 1, playerIds: ['p1', 'p2', 'p3'] })).toThrow()
    expect(() =>
      createRoundSim({ seed: 1, playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'] }),
    ).toThrow()
  })
})

// AD-004 test seam: an optional shift-length override exists ONLY so gate-3
// harness rounds can reach a real buzzer quickly. The §7 default is unchanged
// (asserted by the CLK tests above); production never passes the override.
describe('sim:shift_override (AD-004 test seam)', () => {
  it('fires the buzzer at exactly the overridden tick count and never before', () => {
    const sim = createRoundSim({ seed: 42, playerIds: IDS, totalTicks: 100 })
    for (let t = 1; t < 100; t++) {
      expect(sim.tick().filter((e) => e.type === 'round:buzzer')).toHaveLength(0)
    }
    expect(sim.tick()).toEqual([{ type: 'round:buzzer' }])
    expect(sim.clockTicksRemaining).toBe(0)
    expect(sim.tick()).toEqual([])
  })

  it('maps a 1-second override to 20 ticks (TICK_HZ)', () => {
    const sim = createRoundSim({ seed: 1, playerIds: IDS, totalTicks: TICK_HZ })
    expect(sim.clockTicksRemaining).toBe(TICK_HZ)
  })

  it('rejects non-positive or non-integer overrides', () => {
    expect(() => createRoundSim({ seed: 1, playerIds: IDS, totalTicks: 0 })).toThrow()
    expect(() => createRoundSim({ seed: 1, playerIds: IDS, totalTicks: -5 })).toThrow()
    expect(() => createRoundSim({ seed: 1, playerIds: IDS, totalTicks: 2.5 })).toThrow()
  })
})

// Spec WORK-13 (work channels cycle 2.5): channels are round-scoped — a
// channel dying with the sim emits no work:ended at the buzzer, and post-buzzer
// ticks are silent even with positions still flowing in.
describe('sim:work buzzer', () => {
  it('dies with the round: no work:ended at the buzzer and silence after it', () => {
    const sim = new RoundSim({ seed: 42, playerIds: IDS, totalTicks: 12 })
    const first = sim.tick(new Map(IDS.map((id) => [id, { floor: 'floor1' as const, x: 2750 }])))
    const saboteur = first.find((e) => e.type === 'role:dealt' && e.role === 'saboteur')
    if (saboteur?.type !== 'role:dealt') throw new Error('no saboteur dealt')
    const staffId = IDS.find((id) => id !== saboteur.playerId)
    if (staffId === undefined) throw new Error('no staff player')
    // Staff stands inside room 1 on floor1 and starts a 100-tick prep the
    // shift cannot outlast (totalTicks = 12).
    expect(sim.startWork(staffId, 'floor1', 1)).toBe('accepted')
    const positions_ = new Map(IDS.map((id) => [id, { floor: 'floor1' as const, x: 2750 }]))
    const buzzerEvents: SimEvent[] = []
    for (let t = 1; t <= 12; t++) buzzerEvents.push(...sim.tick(positions_))
    expect(buzzerEvents.some((e) => e.type === 'round:buzzer')).toBe(true)
    expect(buzzerEvents.some((e) => e.type === 'work:ended')).toBe(false)
    // Post-buzzer: ticks past the buzzer emit nothing, positions or not.
    expect(sim.tick(positions_)).toEqual([])
  })
})
