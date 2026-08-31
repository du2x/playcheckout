import type { FloorId, GuestFloorId, SimEvent } from '@turnover/shared'
import { ROOMS_PER_FLOOR, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { GuestSim, type MovementPort } from './guests.js'
import { MovementSim } from './movement.js'
import { TICK_HZ } from './tick.js'

/**
 * The production-shaped adapter over the real MovementSim (the room builds
 * the same thing in T7): guests share the full walk/elevator machinery.
 */
class RealMovementPort implements MovementPort {
  constructor(private readonly sim: MovementSim) {}
  joinGuest(id: string, floor: FloorId, xTiles: number): void {
    this.sim.join(id, { kind: 'guest', floor, xMilli: Math.round(xTiles * 1000) })
  }
  removeGuest(id: string): void {
    this.sim.leave(id)
  }
  announceGuest(id: string): void {
    this.sim.announcePosition(id)
  }
  positionOf(id: string): { floor: FloorId; x: number } | undefined {
    const p = this.sim.positionOf(id)
    return p === undefined ? undefined : { floor: p.floor, x: p.x }
  }
  viewOf(id: string) {
    return this.sim.viewOf(id)
  }
  startMove(id: string, dir: 'left' | 'right'): void {
    this.sim.startMove(id, dir)
  }
  stopMove(id: string): void {
    this.sim.stopMove(id)
  }
  callElevator(id: string) {
    return this.sim.callElevator(id)
  }
  pressFloor(id: string, floor: FloorId) {
    return this.sim.pressFloor(id, floor)
  }
}

/** One fixed 0.05 s step, production order: movement ticks, then the guest sim. */
function step(movement: MovementSim, guests: GuestSim, t: number): SimEvent[] {
  movement.tick()
  return guests.tick(t)
}

function run(
  movement: MovementSim,
  guests: GuestSim,
  ticks: number,
  start = 0,
): { guestEvents: SimEvent[]; movementEvents: ReturnType<MovementSim['tick']>[] } {
  const guestEvents: SimEvent[] = []
  const movementEvents: ReturnType<MovementSim['tick']>[] = []
  for (let t = start; t < start + ticks; t++) {
    movementEvents.push(movement.tick())
    guestEvents.push(...guests.tick(t))
  }
  return { guestEvents, movementEvents }
}

function of(events: readonly SimEvent[], type: SimEvent['type']) {
  return events.filter((e) => e.type === type)
}

const CADENCE_5P = TUNING.GUEST_CADENCE_SECONDS[5] * TICK_HZ
const IMPATIENCE = TUNING.GUEST_IMPATIENCE_SECONDS * TICK_HZ

// Spec GUEST-01..09 (sim:guest_arrival / sim:guest_impatience /
// sim:checkout_churn) + the GUEST-14 replay pin.
describe('sim:guest_arrival', () => {
  it('arrives on the fixed §7 cadence — first guest one full interval after start (GUEST-01)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement))
    let t = 0
    const events = run(movement, guests, CADENCE_5P + 10, t).guestEvents
    t += CADENCE_5P + 10
    const arrivals = of(events, 'guest:arrived')
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0]).toEqual({ type: 'guest:arrived', guestId: 'guest:1' } as SimEvent)
    // No jitter: the second arrival is exactly one cadence later.
    const events2 = run(movement, guests, CADENCE_5P, t).guestEvents
    expect(of(events2, 'guest:arrived').map((e) => (e as { guestId: string }).guestId)).toEqual([
      'guest:2',
    ])
  })

  it('spawns the guest at the desk queue slot (slot 0 at the desk, GUEST-03)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement))
    run(movement, guests, CADENCE_5P + 1)
    const p1 = movement.positionOf('guest:1')
    expect(p1?.floor).toBe('lobby')
    expect(p1?.x).toBe(TUNING.DESK_X_TILES)
  })

  it('holds arrivals while the hotel is full and releases FIFO one per tick (GUEST-02)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement))
    let t = CADENCE_5P + 1
    run(movement, guests, t) // guest:1 arrives at tick 480
    // White-box: fill every room — the branch is unreachable at §7 dials
    // (steady-state occupancy ≈ 2.3–3.8 of 24), so the net is exercised
    // directly through the tenancy map.
    const tenanted = (guests as unknown as { tenanted: Map<string, string> }).tenanted
    for (let f = 1; f <= 3; f++) {
      for (let r = 1; r <= ROOMS_PER_FLOOR; r++) {
        tenanted.set(`floor${f}:${r}`, 'filler')
      }
    }
    const held = run(movement, guests, CADENCE_5P * 2 + 10, t).guestEvents
    t += CADENCE_5P * 2 + 10
    expect(of(held, 'guest:arrived')).toHaveLength(0) // schedule ticks passed, nothing spawned
    // Vacancy returns → the held arrival releases on the next tick.
    tenanted.delete('floor1:1')
    const released = run(movement, guests, 1, t).guestEvents
    expect(of(released, 'guest:arrived').map((e) => (e as { guestId: string }).guestId)).toEqual([
      'guest:2',
    ])
  })
})

describe('sim:guest_impatience', () => {
  it('fires the free cue at exactly 20s and self-assigns a uniform vacant room (GUEST-04)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement))
    const events: SimEvent[] = []
    for (let t = 0; t <= CADENCE_5P + IMPATIENCE + 5; t++) {
      events.push(...step(movement, guests, t))
    }
    const impatient = of(events, 'guest:impatient')
    expect(impatient.map((e) => (e as { guestId: string }).guestId)).toEqual(['guest:1'])
    const assigned = of(events, 'guest:self_assigned')
    expect(assigned).toHaveLength(1)
    const a = assigned[0] as { guestId: string; floor: GuestFloorId; room: number }
    expect(a.guestId).toBe('guest:1')
    expect(['floor1', 'floor2', 'floor3']).toContain(a.floor)
    expect(a.room).toBeGreaterThanOrEqual(1)
    expect(a.room).toBeLessThanOrEqual(ROOMS_PER_FLOOR)
    // Free: no complaint-shaped or loss-shaped event exists anywhere.
    for (const e of events) expect(e.type).not.toMatch(/complaint|fired|ended/)
  })

  it('an impatient guest with NO vacancy stays queued and re-checks every tick (GUEST-05)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement))
    const t = CADENCE_5P + 1
    run(movement, guests, t) // guest:1 has arrived
    const tenanted = (guests as unknown as { tenanted: Map<string, string> }).tenanted
    for (let f = 1; f <= 3; f++) {
      for (let r = 1; r <= ROOMS_PER_FLOOR; r++) {
        tenanted.set(`floor${f}:${r}`, 'filler')
      }
    }
    const held = run(movement, guests, IMPATIENCE + 200, t).guestEvents
    expect(of(held, 'guest:impatient').map((e) => (e as { guestId: string }).guestId)).toEqual([
      'guest:1',
    ])
    expect(of(held, 'guest:self_assigned')).toHaveLength(0) // re-checked every tick, never forced
    expect(of(held, 'guest:left')).toHaveLength(0) // never despawned
    tenanted.delete('floor3:8')
    const assigned = of(
      run(movement, guests, 1, t + IMPATIENCE + 200).guestEvents,
      'guest:self_assigned',
    )
    expect(assigned.map((e) => (e as { room: number }).room)).toEqual([ROOMS_PER_FLOOR])
  })
})

describe('sim:guest_lifecycle', () => {
  function fullLifecycle(seed: number) {
    const movement = new MovementSim()
    const guests = new GuestSim(seed, 5, new RealMovementPort(movement))
    const events = run(movement, guests, 3000).guestEvents
    return { movement, guests, events }
  }

  it('runs a full lifecycle: arrive → ride → settle → checkout → leave (GUEST-06/08/09)', () => {
    const { movement, events } = fullLifecycle(7)
    const settled = of(events, 'guest:settled') as {
      guestId: string
      floor: GuestFloorId
      room: number
    }[]
    expect(settled.length).toBeGreaterThanOrEqual(1)
    const s = settled.at(0)
    if (s === undefined) throw new Error('no settle event')
    expect(movement.viewOf(s.guestId).floor).toBeNull() // inside the room — no hall view
    // Tenancy is recorded and freed again by checkout.
    const checkedOut = of(events, 'guest:checked_out') as typeof settled
    expect(checkedOut.length).toBeGreaterThanOrEqual(1)
    const c = checkedOut.at(0)
    if (c === undefined) throw new Error('no checkout event')
    expect(c.room).toBe(s.room)
    expect(c.floor).toBe(s.floor)
    // The guest walks home and despawns at the desk (GUEST-09).
    const left = of(events, 'guest:left').map((e) => (e as { guestId: string }).guestId)
    expect(left).toContain(s.guestId)
    expect(movement.positionOf(s.guestId)).toBeUndefined()
  })

  it('dwell is a seeded uniform within [45, 90] seconds (GUEST-08)', () => {
    // White-box dwell pin: the machine stores the absolute deadline.
    const dwellChecks: number[] = []
    const m2 = new MovementSim()
    const g2 = new GuestSim(11, 5, new RealMovementPort(m2))
    for (let t = 0; t < 3000; t++) {
      const evts = step(m2, g2, t)
      for (const e of evts) {
        if (e.type === 'guest:settled') {
          const g = (
            g2 as unknown as { guests: Map<string, { dwellEndsAt: number | null }> }
          ).guests.get(e.guestId)
          const deadline = g?.dwellEndsAt
          if (deadline === null || deadline === undefined) {
            throw new Error('settled guest without a dwell deadline')
          }
          dwellChecks.push((deadline - t) / TICK_HZ)
        }
      }
    }
    expect(dwellChecks.length).toBeGreaterThan(0)
    for (const seconds of dwellChecks) {
      expect(seconds).toBeGreaterThanOrEqual(TUNING.GUEST_DWELL_MIN_SECONDS)
      expect(seconds).toBeLessThanOrEqual(TUNING.GUEST_DWELL_MAX_SECONDS)
    }
  })

  it('uses the elevator as a citizen: the guest presses its target floor in-car (GUEST-06)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement))
    let pressObserved = false
    for (let t = 0; t < 3000 && !pressObserved; t++) {
      const movementEvents = movement.tick()
      pressObserved = movementEvents.some(
        (e) => e.type === 'elevator:moved' && e.car === 1 && e.floor !== 'lobby',
      )
      guests.tick(t)
    }
    // The car actually carried the guest to a guest floor (position-only
    // panels; occupancy is rider knowledge).
    expect(pressObserved).toBe(true)
  })

  it('replays a seeded 3000-tick scenario bit-for-bit (GUEST-10/14)', () => {
    const run1 = fullLifecycle(2026).events
    const run2 = fullLifecycle(2026).events
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2))
    const other = fullLifecycle(2027).events
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(run1))
  })
})
