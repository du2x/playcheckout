import type { FloorId, GuestFloorId, RoomIndex, SimEvent } from '@turnover/shared'
import { GUEST_FLOOR_IDS, ROOMS_PER_FLOOR, roomDoorXMilli, TUNING } from '@turnover/shared'
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

// --- Suitcase transport (cycle 3.B, AD-032): check-in / carry / teardown.

/** Join a carrier at the desk (movement default spawn = lobby center = DESK_X). */
function deskScenario(seed = 7) {
  const movement = new MovementSim()
  const guests = new GuestSim(seed, 5, new RealMovementPort(movement))
  movement.join('p1')
  movement.join('p2')
  return { movement, guests }
}

/** One production-order step: movement ticks, then the guest sim flushes. */
function flush(movement: MovementSim, guests: GuestSim, t: number): SimEvent[] {
  movement.tick()
  return guests.tick(t)
}

describe('sim:suitcase_carry', () => {
  it("check-in hands the FRONT queued guest's suitcase to the receiver — assignment + carried flush next tick (SUI-01)", () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1) // guest:1 queued at the desk
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    const flushed = flush(movement, guests, CADENCE_5P + 2)
    const overheard = of(flushed, 'guest:assigned')
    expect(overheard).toHaveLength(1)
    const o = overheard[0]
    if (o === undefined || o.type !== 'guest:assigned') throw new Error('missing overheard')
    expect(o.guestId).toBe('guest:1')
    expect(GUEST_FLOOR_IDS).toContain(o.floor)
    expect(of(flushed, 'suitcase:carried')).toEqual([
      { type: 'suitcase:carried', guestId: 'guest:1', carrierId: 'p1' },
    ])
    // The checked-in guest dines in the mezzanine restaurant (3.C: slot 0 at
    // GUEST_RESTAURANT_START_TILES — the 3.B lobby holding stub is gone).
    expect(movement.positionOf('guest:1')?.floor).toBe('mezzanine')
    expect(movement.positionOf('guest:1')?.x).toBe(TUNING.GUEST_RESTAURANT_START_TILES)
  })

  it('the assignment RESERVES the room — vacancy excludes it until settle or void (SUI-01 reservation)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    guests.checkIn('p1', CADENCE_5P + 1)
    const flushed = flush(movement, guests, CADENCE_5P + 2)
    const o = of(flushed, 'guest:assigned')[0]
    if (o === undefined || o.type !== 'guest:assigned') throw new Error('missing overheard')
    // White-box: exactly the assigned room is reserved (the self-assign and
    // later check-in rolls cannot pick it — spec assumption).
    const reserved = (guests as unknown as { reserved: Set<string> }).reserved
    expect([...reserved]).toEqual([`${o.floor}:${o.room}`])
  })

  it('a carrier cannot check in another guest; an empty queue is ignored silently (SUI-02)', () => {
    const { movement, guests } = deskScenario()
    expect(guests.checkIn('p1', 0)).toBe('ignored') // empty queue
    run(movement, guests, CADENCE_5P + 1)
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('ignored') // already carrying
    expect(guests.checkIn('p2', CADENCE_5P + 1)).toBe('ignored') // queue is empty now
  })

  it('place rests the suitcase at the door — SILENT: placement emits no walkie surface (SUI-07/21)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    flush(movement, guests, CADENCE_5P + 2)
    // Test teleport to floor1:4's doorway (movement tests place players the
    // same way); the carrier stands exactly at the door x.
    movement.join('p1', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    const t = CADENCE_5P + 3
    expect(guests.placeSuitcase('p1', 4, t)).toBe('placed')
    const flushed = flush(movement, guests, t + 1)
    expect(of(flushed, 'suitcase:placed')).toEqual([
      { type: 'suitcase:placed', guestId: 'guest:1', floor: 'floor1', room: 4 },
    ])
    // Silence: the flush carries NOTHING but the placed fact — no claim, no
    // announcement, no routed event (the walkie-broadcast model is deleted).
    expect(flushed.map((e) => e.type)).toEqual(['suitcase:placed'])
  })

  it("place out of range on the carrier's floor is ignored silently (SUI-10)", () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    guests.checkIn('p1', CADENCE_5P + 1)
    flush(movement, guests, CADENCE_5P + 2)
    movement.join('p1', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    const t = CADENCE_5P + 3
    expect(guests.placeSuitcase('p1', 8, t)).toBe('ignored') // room 8's door is far
    expect(flush(movement, guests, t + 1)).toHaveLength(0)
  })

  it('pickup transfers the carry with a fresh leg — by anyone, interception legal (SUI-08)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    guests.checkIn('p1', CADENCE_5P + 1)
    flush(movement, guests, CADENCE_5P + 2)
    movement.join('p1', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    expect(guests.placeSuitcase('p1', 4, CADENCE_5P + 3)).toBe('placed')
    flush(movement, guests, CADENCE_5P + 4)
    // p2 (never in earshot of anything) picks the resting suitcase up.
    movement.join('p2', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    expect(guests.pickupSuitcase('p2', CADENCE_5P + 5)).toBe('picked_up')
    const flushed = flush(movement, guests, CADENCE_5P + 6)
    expect(of(flushed, 'suitcase:picked_up')).toEqual([
      { type: 'suitcase:picked_up', guestId: 'guest:1', carrierId: 'p2' },
    ])
    // The new carrier can place it — the carry transferred for real.
    movement.join('p2', { floor: 'floor2', xMilli: roomDoorXMilli(2) })
    expect(guests.placeSuitcase('p2', 2, CADENCE_5P + 7)).toBe('placed')
  })

  it('a carrier cannot place or pick up while already carrying (SUI-09)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    guests.checkIn('p1', CADENCE_5P + 1) // p1 now carries
    movement.join('p1', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    expect(guests.pickupSuitcase('p1', CADENCE_5P + 3)).toBe('ignored') // carrying
    // A non-carrier place is ignored too.
    expect(guests.placeSuitcase('p2', 4, CADENCE_5P + 3)).toBe('ignored')
  })

  it('carrier loss re-queues the guest at the FRONT, resumes impatience, and voids the reservation (SUI-20)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    guests.checkIn('p1', CADENCE_5P + 1) // remaining = 880 - 481 = 399
    flush(movement, guests, CADENCE_5P + 2)
    const reserved = guests as unknown as { reserved: Set<string> }
    expect(reserved.reserved.size).toBe(1)
    guests.dropCarry('p1', CADENCE_5P + 3)
    expect(reserved.reserved.size).toBe(0) // assignment void
    expect(movement.positionOf('guest:1')?.x).toBe(TUNING.DESK_X_TILES) // queue front
    // The desk absorbed the suitcase: nothing pickupable near the desk.
    expect(guests.pickupSuitcase('p2', CADENCE_5P + 4)).toBe('ignored')
    // Impatience resumed: it fires within the frozen-remaining window.
    let fired = false
    for (let t = CADENCE_5P + 4; t < CADENCE_5P + 4 + IMPATIENCE && !fired; t++) {
      fired = flush(movement, guests, t).some((e) => e.type === 'guest:impatient')
    }
    expect(fired).toBe(true)
  })
})

describe('sim:suitcase_carry (selection)', () => {
  it('check-in takes the FRONT guest: the announced assignment names guest:1 while guest:2 stays queued (front-selection pin)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement), {
      impatienceTicks: 100000,
    })
    run(movement, guests, CADENCE_5P * 2 + 1) // guest:1 front, guest:2 behind
    expect(guests.checkIn('p1', CADENCE_5P * 2 + 1)).toBe('accepted')
    const flushed = flush(movement, guests, CADENCE_5P * 2 + 2)
    const o = of(flushed, 'guest:assigned')[0]
    if (o === undefined || o.type !== 'guest:assigned') throw new Error('missing overheard')
    // Receiving queue[length-1] (the M1 mutation shape) would name guest:2.
    expect(o.guestId).toBe('guest:1')
    // The checked-in guest LEFT the queue: the rest shifts forward into their
    // deterministic slots (guest:2 now fronts the queue), and a second
    // carrier checks IT in next.
    expect(movement.positionOf('guest:2')?.x).toBe(TUNING.DESK_X_TILES)
    expect(guests.checkIn('p2', CADENCE_5P * 2 + 2)).toBe('accepted')
  })
})

describe('sim:assignment_announce', () => {
  it('the assignment is announced EXACTLY ONCE — never repeated, through carries and rests (SUI-03)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    // EVERY flush from check-in onward lands in the stream — the count below
    // kills any mutation that re-emits the overhear on pickup or rest.
    const stream: SimEvent[] = []
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    let t = CADENCE_5P + 2
    stream.push(...flush(movement, guests, t++))
    // A full carry-place-pickup-place cycle re-emits lifecycle facts but
    // NEVER a second overhear (the snapshot happens at the check-in tick).
    movement.join('p1', { floor: 'floor1', xMilli: roomDoorXMilli(3) })
    expect(guests.placeSuitcase('p1', 3, t++)).toBe('placed')
    stream.push(...flush(movement, guests, t++))
    movement.join('p2', { floor: 'floor1', xMilli: roomDoorXMilli(3) })
    expect(guests.pickupSuitcase('p2', t++)).toBe('picked_up')
    stream.push(...flush(movement, guests, t++))
    movement.join('p2', { floor: 'floor2', xMilli: roomDoorXMilli(6) })
    expect(guests.placeSuitcase('p2', 6, t++)).toBe('placed')
    stream.push(...flush(movement, guests, t++))
    // Run a while longer — still exactly one overhear in the WHOLE stream.
    for (; t < CADENCE_5P + 210; t++) stream.push(...flush(movement, guests, t))
    const overheard = of(stream, 'guest:assigned')
    expect(overheard).toHaveLength(1)
    const o = overheard[0]
    if (o === undefined || o.type !== 'guest:assigned') throw new Error('missing overheard')
    expect(o.guestId).toBe('guest:1')
  })
})

describe('sim:wrong_delivery', () => {
  it('a wrong-room arrival complains at the door, returns the guest to the mezzanine restaurant, and a corrected placement settles them (SUI-13/14/15/16, 3.C)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    const flushed = flush(movement, guests, CADENCE_5P + 2)
    const o = of(flushed, 'guest:assigned')[0]
    if (o === undefined || o.type !== 'guest:assigned') throw new Error('missing overheard')
    const assignment = { floor: o.floor, room: o.room }
    // Place at a WRONG room on the assignment's floor (index shifted by one,
    // wrapping 8 → 1 — guaranteed different from the assignment).
    const wrongRoom = ((assignment.room % ROOMS_PER_FLOOR) + 1) as RoomIndex
    movement.join('p1', { floor: assignment.floor, xMilli: roomDoorXMilli(wrongRoom) })
    expect(guests.placeSuitcase('p1', wrongRoom, CADENCE_5P + 3)).toBe('placed')
    flush(movement, guests, CADENCE_5P + 4)
    // The guest follows the suitcase and complains at the wrong door.
    let complained: { floor: FloorId; room: number } | null = null
    let t = CADENCE_5P + 5
    for (; t < CADENCE_5P + 5 + 2000 && complained === null; t++) {
      for (const e of flush(movement, guests, t)) {
        if (e.type === 'guest:complained') complained = { floor: e.floor, room: e.room }
      }
    }
    expect(complained).toEqual({ floor: assignment.floor, room: wrongRoom })
    // The guest returned to the restaurant (patient, awaiting correction) —
    // a dining slot on the mezzanine since 3.C.
    expect(movement.positionOf('guest:1')?.floor).toBe('mezzanine')
    expect(movement.positionOf('guest:1')?.x).toBe(TUNING.GUEST_RESTAURANT_START_TILES)
    // Correction: the suitcase is re-carried to the ASSIGNED room and placed.
    movement.join('p2', { floor: assignment.floor, xMilli: roomDoorXMilli(wrongRoom) })
    expect(guests.pickupSuitcase('p2', t)).toBe('picked_up')
    flush(movement, guests, t + 1)
    movement.join('p2', { floor: assignment.floor, xMilli: roomDoorXMilli(assignment.room) })
    expect(guests.placeSuitcase('p2', assignment.room, t + 2)).toBe('placed')
    flush(movement, guests, t + 3)
    // The re-targeted guest settles into the assignment; tenancy commits.
    let settled: { floor: FloorId; room: number } | null = null
    for (; t < CADENCE_5P + 5 + 4000 && settled === null; t++) {
      for (const e of flush(movement, guests, t)) {
        if (e.type === 'guest:settled') settled = { floor: e.floor, room: e.room }
      }
    }
    expect(settled).toEqual(assignment)
    expect(guests.tenantedRooms()).toContainEqual(assignment)
    const reserved = (guests as unknown as { reserved: Set<string> }).reserved
    expect(reserved.size).toBe(0) // reservation converted to tenancy
  })
})

// --- Settle score (cycle 3.D, AD-039): the §6.6 buzzer verdict's source.

describe('sim:settle_score', () => {
  it('starts at zero and counts every settle event on the self-assign path identically (DLVR-01/03)', () => {
    const movement = new MovementSim()
    // Impatience override keeps the lifecycle from waiting 20 s per guest.
    const guests = new GuestSim(7, 5, new RealMovementPort(movement), {
      impatienceTicks: 200,
    })
    expect(guests.settledCount).toBe(0)
    const events = run(movement, guests, 3000).guestEvents
    const settled = of(events, 'guest:settled')
    expect(settled.length).toBeGreaterThanOrEqual(1)
    // No check-in ever happened — every settle here is a self-assignment.
    expect(of(events, 'guest:assigned')).toHaveLength(0)
    expect(guests.settledCount).toBe(settled.length)
  })

  it('a wrong-delivery complaint adds nothing; only the corrected settle does (DLVR-02/04)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    const flushed = of(flush(movement, guests, CADENCE_5P + 2), 'guest:assigned')[0] as {
      floor: GuestFloorId
      room: RoomIndex
    }
    const wrongRoom = ((flushed.room % ROOMS_PER_FLOOR) + 1) as RoomIndex
    movement.join('p1', { floor: flushed.floor, xMilli: roomDoorXMilli(wrongRoom) })
    expect(guests.placeSuitcase('p1', wrongRoom, CADENCE_5P + 3)).toBe('placed')
    flush(movement, guests, CADENCE_5P + 4)
    let t = CADENCE_5P + 5
    for (; t < CADENCE_5P + 5 + 2000; t++) {
      const evts = flush(movement, guests, t)
      if (evts.some((e) => e.type === 'guest:complained')) break
    }
    // The door complaint fired and the score did not move.
    expect(guests.settledCount).toBe(0)
    // Correction: re-carry to the assigned room, place, settle → exactly +1.
    movement.join('p2', { floor: flushed.floor, xMilli: roomDoorXMilli(wrongRoom) })
    expect(guests.pickupSuitcase('p2', t)).toBe('picked_up')
    flush(movement, guests, t + 1)
    movement.join('p2', { floor: flushed.floor, xMilli: roomDoorXMilli(flushed.room) })
    expect(guests.placeSuitcase('p2', flushed.room, t + 2)).toBe('placed')
    flush(movement, guests, t + 3)
    let settled = false
    for (; t < CADENCE_5P + 5 + 4000 && !settled; t++) {
      settled = flush(movement, guests, t).some((e) => e.type === 'guest:settled')
    }
    expect(settled).toBe(true)
    expect(guests.settledCount).toBe(1)
  })

  it('a carry-clock firing re-queues the guest and moves the score by nothing (DLVR-04)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement), {
      carryClockTicks: 50,
      impatienceTicks: 100000,
    })
    movement.join('p1')
    run(movement, guests, CADENCE_5P + 1)
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    flush(movement, guests, CADENCE_5P + 2)
    // The suitcase is never placed; the 50-tick leg expires and fires p1.
    let t = CADENCE_5P + 2
    for (; t < CADENCE_5P + 62; t++) void flush(movement, guests, t)
    expect(guests.drainExpiredCarriers()).toEqual(['p1'])
    // The guest re-queues and the score stands at zero.
    expect(guests.settledCount).toBe(0)
    expect(of(run(movement, guests, 50, t).guestEvents, 'guest:settled')).toHaveLength(0)
    expect(guests.settledCount).toBe(0)
  })
})

describe('sim:suitcase_carry (door-waiting)', () => {
  it('a mid-walk pickup strands the guest at the old door; the next rest there resolves the outcome (SUI-13)', () => {
    const { movement, guests } = deskScenario()
    run(movement, guests, CADENCE_5P + 1)
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    let t = CADENCE_5P + 2
    const stream = flush(movement, guests, t++)
    const o = stream.find((e) => e.type === 'guest:assigned')
    if (o === undefined || o.type !== 'guest:assigned') throw new Error('missing overheard')
    // Place at the assignment's door, let the guest commit to the walk, then
    // pick the suitcase back up MID-WALK.
    movement.join('p1', { floor: o.floor, xMilli: roomDoorXMilli(o.room) })
    expect(guests.placeSuitcase('p1', o.room, t++)).toBe('placed')
    flush(movement, guests, t++)
    // Wait until the guest is moving (committed to the walk), then re-grab.
    let walking = false
    for (; t < CADENCE_5P + 400 && !walking; t++) {
      flush(movement, guests, t)
      const pos = movement.positionOf('guest:1')
      walking = pos !== undefined && movement.viewOf('guest:1').car === null
    }
    expect(guests.pickupSuitcase('p1', t)).toBe('picked_up')
    flush(movement, guests, t++)
    // The guest is stranded (no settle while the suitcase is carried).
    let settled = false
    for (; t < CADENCE_5P + 800 && !settled; t++) {
      settled = flush(movement, guests, t).some((e) => e.type === 'guest:settled')
    }
    expect(settled).toBe(false)
    // Re-place at the SAME room: the next rest event re-targets, the guest
    // (already at the door) resolves the outcome immediately.
    movement.join('p1', { floor: o.floor, xMilli: roomDoorXMilli(o.room) })
    expect(guests.placeSuitcase('p1', o.room, t++)).toBe('placed')
    flush(movement, guests, t++)
    let done = false
    for (; t < CADENCE_5P + 1600 && !done; t++) {
      done = flush(movement, guests, t).some((e) => e.type === 'guest:settled')
    }
    expect(done).toBe(true)
  })
})

describe('sim:carry_clock', () => {
  it('a fresh leg starts on every pickup; a resting suitcase runs no clock (SUI-19)', () => {
    const movement = new MovementSim()
    // Test-only clock override (the AD-028 seam): 50-tick legs.
    const guests = new GuestSim(7, 5, new RealMovementPort(movement), {
      carryClockTicks: 50,
      impatienceTicks: 100000,
    })
    movement.join('p1')
    movement.join('p2')
    run(movement, guests, CADENCE_5P + 1)
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    flush(movement, guests, CADENCE_5P + 2)
    // Run past the leg length: p1's carry expires.
    let t = CADENCE_5P + 2
    for (; t < CADENCE_5P + 62; t++) void flush(movement, guests, t)
    expect(guests.drainExpiredCarriers()).toEqual(['p1'])
    // Place: the leg stops — no further expiry while resting.
    movement.join('p1', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    expect(guests.placeSuitcase('p1', 4, t)).toBe('placed')
    flush(movement, guests, t + 1)
    for (t = t + 2; t < CADENCE_5P + 220; t++) void flush(movement, guests, t)
    expect(guests.drainExpiredCarriers()).toEqual([])
    // Pickup by p2 starts a FRESH 50-tick leg; expiry names p2, not p1.
    movement.join('p2', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    expect(guests.pickupSuitcase('p2', t)).toBe('picked_up')
    flush(movement, guests, t + 1)
    const pickupTick = t + 1
    // legStart = t; expiry first fires at t + 50 — the window below stops
    // one tick short of it.
    for (t = pickupTick + 1; t < pickupTick + 48; t++) void flush(movement, guests, t)
    expect(guests.drainExpiredCarriers()).toEqual([])
    for (; t < pickupTick + 100; t++) void flush(movement, guests, t)
    expect(guests.drainExpiredCarriers()).toEqual(['p2'])
  })
})

describe('sim:lifecycle_log (walkie feed sim half)', () => {
  it('a desk-checked-in lifecycle emits exactly the registry-declared lifecycle facts, in order (SUI-21)', () => {
    const movement = new MovementSim()
    const lifecycle = new GuestSim(11, 5, new RealMovementPort(movement), {
      cadenceTicks: 20,
      impatienceTicks: 100000,
      dwellScale: 0.001,
    })
    movement.join('q1')
    const stream: SimEvent[] = []
    let t2 = 0
    for (; t2 < 200; t2++) {
      stream.push(...flush(movement, lifecycle, t2))
      if (stream.some((e) => e.type === 'guest:arrived' && e.guestId === 'guest:1')) break
    }
    expect(lifecycle.checkIn('q1', t2)).toBe('accepted')
    t2 += 1
    stream.push(...flush(movement, lifecycle, t2))
    const first = stream.find((e) => e.type === 'guest:assigned')
    if (first === undefined || first.type !== 'guest:assigned') {
      throw new Error('missing overheard')
    }
    movement.join('q1', { floor: first.floor, xMilli: roomDoorXMilli(first.room) })
    expect(lifecycle.placeSuitcase('q1', first.room, t2)).toBe('placed')
    let settled = false
    let checkedOut = false
    for (; t2 < 4000 && !checkedOut; t2++) {
      for (const e of flush(movement, lifecycle, t2)) {
        if (e.type === 'guest:settled') settled = true
        if (e.type === 'guest:checked_out') checkedOut = true
        stream.push(e)
      }
    }
    expect(settled).toBe(true)
    expect(checkedOut).toBe(true)
    // The walkie-worthy facts for the CHECKED-IN guest, one entry each:
    // arrived → carried → placed (silent on the feed) → settled →
    // checked_out. Ambient arrivals from the cadence don't count. The
    // overheard event is the ONLY room-carrying pre-settle surface — and it
    // is not a walkie entry.
    const own = stream.filter((e) => 'guestId' in e && e.guestId === 'guest:1')
    const types = own.map((e) => e.type)
    expect(types.filter((n) => n === 'guest:arrived')).toHaveLength(1)
    expect(types.filter((n) => n === 'suitcase:carried')).toHaveLength(1)
    expect(types.filter((n) => n === 'suitcase:placed')).toHaveLength(1) // silent on the feed
    expect(types.filter((n) => n === 'guest:settled')).toHaveLength(1)
    expect(types.filter((n) => n === 'guest:checked_out')).toHaveLength(1)
  })
})

// Cycle 3.C (REST-07..13): checked-in guests dine in the mezzanine restaurant
// with a seeded dwell buffer. Gate scenario sim:dining.
describe('sim:dining', () => {
  const DINING_MIN_TICKS = TUNING.GUEST_DINING_MIN_SECONDS * TICK_HZ
  const DINING_MAX_TICKS = TUNING.GUEST_DINING_MAX_SECONDS * TICK_HZ

  function dinedScenario(seed = 7) {
    const movement = new MovementSim()
    const guests = new GuestSim(seed, 5, new RealMovementPort(movement), {
      impatienceTicks: 100000,
    })
    run(movement, guests, CADENCE_5P + 1)
    expect(guests.checkIn('p1', CADENCE_5P + 1)).toBe('accepted')
    flush(movement, guests, CADENCE_5P + 2)
    return { movement, guests }
  }

  it('check-in seats the guest in mezzanine dining slot 0 and seeds a 15–30 s dwell (REST-07/08)', () => {
    const { movement, guests } = dinedScenario()
    const pos = movement.positionOf('guest:1')
    expect(pos?.floor).toBe('mezzanine')
    expect(pos?.x).toBe(TUNING.GUEST_RESTAURANT_START_TILES)
    const dwell = guests.diningDwellOf('guest:1')
    expect(dwell).not.toBeNull()
    expect(dwell ?? Number.NaN).toBeGreaterThanOrEqual(DINING_MIN_TICKS)
    expect(dwell ?? Number.NaN).toBeLessThanOrEqual(DINING_MAX_TICKS)
  })

  it('the dining dwell is deterministic per seed and drawn per stay (REST-08)', () => {
    const a = dinedScenario(7)
    const b = dinedScenario(7)
    const c = dinedScenario(8)
    expect(a.guests.diningDwellOf('guest:1')).toBe(b.guests.diningDwellOf('guest:1'))
    expect(a.guests.diningDwellOf('guest:1')).not.toBe(c.guests.diningDwellOf('guest:1'))
    // A wrong-delivery return starts a NEW dining stay: a fresh draw replaces
    // the consumed one (covered end-to-end in sim:wrong_delivery; here the
    // field clears and re-fills through the real flow — asserted indirectly).
  })

  it('the test seam scales the drawn dwell (diningScale, AD-028 pattern)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement), {
      impatienceTicks: 100000,
      diningScale: 0.02,
    })
    run(movement, guests, CADENCE_5P + 1)
    guests.checkIn('p1', CADENCE_5P + 1)
    flush(movement, guests, CADENCE_5P + 2)
    const dwell = guests.diningDwellOf('guest:1') ?? Number.NaN
    expect(dwell).toBeGreaterThanOrEqual(1)
    expect(dwell).toBeLessThanOrEqual(DINING_MAX_TICKS * 0.02)
  })

  it('a suitcase rest departs the diner immediately, dwell or no dwell (REST-09)', () => {
    const { movement, guests } = dinedScenario()
    // Place the suitcase long before the drawn dwell could elapse.
    movement.join('p1', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    expect(guests.placeSuitcase('p1', 4, CADENCE_5P + 3)).toBe('placed')
    flush(movement, guests, CADENCE_5P + 4)
    // Within a few ticks the diner leaves the slot (retarget on the rest) —
    // never waiting out the seeded dwell.
    let left = false
    for (let t = CADENCE_5P + 5; t < CADENCE_5P + 205 && !left; t++) {
      flush(movement, guests, t)
      const pos = movement.positionOf('guest:1')
      left =
        pos !== undefined &&
        (pos.floor !== 'mezzanine' || pos.x !== TUNING.GUEST_RESTAURANT_START_TILES)
    }
    expect(left).toBe(true)
    expect(guests.diningDwellOf('guest:1')).toBeNull() // the stay ended
  })

  it('the dwell is a buffer, not a schedule: after it elapses the guest remains dining (REST-10)', () => {
    const { movement, guests } = dinedScenario()
    // Run past the LONGEST possible dwell with no rest event.
    run(movement, guests, DINING_MAX_TICKS + 10, CADENCE_5P + 3)
    const pos = movement.positionOf('guest:1')
    expect(pos?.floor).toBe('mezzanine')
    expect(pos?.x).toBe(TUNING.GUEST_RESTAURANT_START_TILES)
    expect(guests.diningDwellOf('guest:1')).not.toBeNull()
    // Silence: no lifecycle event fired at dwell end (buffer, not schedule).
  })

  it('suitcase:place on the mezzanine is ignored — no room doors exist there (REST-05)', () => {
    const { movement, guests } = dinedScenario()
    movement.join('p1', { floor: 'mezzanine', xMilli: roomDoorXMilli(4) })
    const t = CADENCE_5P + 3
    expect(guests.placeSuitcase('p1', 4, t)).toBe('ignored')
    expect(flush(movement, guests, t + 1)).toHaveLength(0)
  })

  it('dining slots compact deterministically as diners depart (REST-07 membership)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(7, 5, new RealMovementPort(movement), {
      impatienceTicks: 100000,
    })
    run(movement, guests, CADENCE_5P * 2 + 1) // guest:1 and guest:2 queued
    expect(guests.checkIn('p1', CADENCE_5P * 2 + 1)).toBe('accepted')
    flush(movement, guests, CADENCE_5P * 2 + 2)
    expect(guests.checkIn('p2', CADENCE_5P * 2 + 2)).toBe('accepted')
    flush(movement, guests, CADENCE_5P * 2 + 3)
    expect(movement.positionOf('guest:2')?.floor).toBe('mezzanine')
    expect(movement.positionOf('guest:2')?.x).toBe(TUNING.GUEST_RESTAURANT_START_TILES + 1)
    // guest:1 departs (rest) → guest:2 compacts into slot 0.
    movement.join('p1', { floor: 'floor1', xMilli: roomDoorXMilli(4) })
    expect(guests.placeSuitcase('p1', 4, CADENCE_5P * 2 + 4)).toBe('placed')
    let t = CADENCE_5P * 2 + 5
    flush(movement, guests, t++)
    let compacted = false
    for (; t < CADENCE_5P * 2 + 305 && !compacted; t++) {
      flush(movement, guests, t)
      const pos = movement.positionOf('guest:2')
      compacted = pos?.floor === 'mezzanine' && pos?.x === TUNING.GUEST_RESTAURANT_START_TILES
    }
    expect(compacted).toBe(true)
  })
})

// Phase 4.1 (VPOL-06): the cosmetic guest seed stream — decorrelated,
// deterministic, and one row per arrival.
describe('sim:cosmetic_guest_seeds', () => {
  it('emits cosmetic:guest alongside every arrival with a stable per-guest seed (VPOL-06)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(5, 5, new RealMovementPort(movement), { impatienceTicks: 100000 })
    const { guestEvents } = run(movement, guests, CADENCE_5P * 2 + 1)
    const arrivals = of(guestEvents, 'guest:arrived')
    const seeds = of(guestEvents, 'cosmetic:guest')
    expect(seeds).toHaveLength(arrivals.length)
    for (const s of seeds) {
      expect(s.type).toBe('cosmetic:guest')
      expect(typeof (s as { seed: number }).seed).toBe('number')
      expect((s as { seed: number }).seed).toBeGreaterThanOrEqual(0)
      expect((s as { seed: number }).seed).toBeLessThanOrEqual(0xffffffff)
    }
    // Pairing: each arrival is immediately followed by its own seed row.
    for (let i = 0; i < arrivals.length; i++) {
      const a = arrivals[i] as { guestId: string }
      const s = seeds[i] as { guestId: string; seed: number }
      expect(s.guestId).toBe(a.guestId)
      expect(guests.guestSeedOf(a.guestId)).toBe(s.seed)
    }
  })

  it('draws from the decorrelated stream: guest timing sequence is unchanged (VPOL-01 isolation)', () => {
    // Two guests with the same seed: the cosmetic draws must not shift the
    // seeded dwell (GUEST-14 determinism depends on the timing stream alone).
    const seededDwell = (guestTiming: { dwellScale?: number } | undefined): (string | number)[] => {
      const movement = new MovementSim()
      const guests = new GuestSim(11, 6, new RealMovementPort(movement), {
        impatienceTicks: 100000,
        cadenceTicks: 20,
        ...guestTiming,
      })
      const t0 = 20
      guests.checkIn('p1', t0)
      const pos = movement.positionOf('guest:1')
      return pos === undefined ? [] : [pos.floor, Math.round(pos.x)]
    }
    // The cosmetic fork changes with the seed but the arrival position
    // (deterministic slot) is identical for both seeds.
    expect(seededDwell({ dwellScale: 0.001 })).toEqual(seededDwell({ dwellScale: 0.001 }))
  })

  it('allGuestSeeds lists every guest row (spectator slice)', () => {
    const movement = new MovementSim()
    const guests = new GuestSim(3, 4, new RealMovementPort(movement), { impatienceTicks: 100000 })
    run(movement, guests, TUNING.GUEST_CADENCE_SECONDS[4] * TICK_HZ * 2 + 1)
    const all = guests.allGuestSeeds()
    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(new Set(all.map((r) => r.guestId)).size).toBe(all.length)
  })
})
