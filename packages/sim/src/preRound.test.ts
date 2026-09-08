import type { FloorId, GuestFloorId, RoomIndex } from '@turnover/shared'
import { GUEST_FLOOR_IDS, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { MovementSim } from './movement.js'
import { RoundSim } from './roundSim.js'

// Pre-round occupancy (2026-09): the shift opens with TUNING.PRE_ROUND_OCCUPANCY
// guests already settled in seeded rooms. Gate scenarios for the spawn beat
// (sim:pre_round_a) and the early checkout-churn beat (sim:pre_round_b).

class PortAdapter {
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

const IDS_4P = ['p1', 'p2', 'p3', 'p4'] as const

function build(seed: number, dwellScale?: number) {
  const movement = new MovementSim()
  const sim = new RoundSim({
    seed,
    playerIds: [...IDS_4P],
    movement: new PortAdapter(movement),
    ...(dwellScale === undefined ? {} : { guestTiming: { dwellScale } }),
  })
  return { movement, sim }
}

describe('sim:pre_round_a', () => {
  it('opens the shift tenanted: seeded distinct rooms, one per floor, identity-only events', () => {
    const { movement, sim } = build(20260907)
    movement.tick()
    const flush = sim.tick()

    // Occupancy dial (tuning): { 4: 3, 5: 2, 6: 2 } — this is the 4p run.
    const count = TUNING.PRE_ROUND_OCCUPANCY[4]
    // Silent at spawn: no identity line (the seed announces at checkout, when
    // the guest enters hall view), no arrival line, no settle score, no
    // check-in plumbing.
    expect(flush.some((e) => e.type === 'cosmetic:guest')).toBe(false)
    expect(flush.some((e) => e.type === 'guest:arrived')).toBe(false)
    expect(flush.some((e) => e.type === 'guest:settled')).toBe(false)
    expect(sim.settledCount).toBe(0)

    // One Occupied sign per guest floor, rooms distinct; state still `fresh`
    // (churn is a checkout product, not a spawn product).
    const tenancies = sim.allTenancies()
    expect(tenancies).toHaveLength(count)
    expect(new Set(tenancies.map((t) => t.floor))).toEqual(new Set<string>(GUEST_FLOOR_IDS))
    expect(new Set(tenancies.map((t) => `${t.floor}:${t.room}`))).toHaveLength(count)
    for (const t of tenancies) {
      expect(t.occupied).toBe(true)
      expect(sim.roomState(t.floor as GuestFloorId, t.room)).toBe('fresh')
    }

    // Seeded determinism: same seed → same rooms.
    const again = build(20260907)
    again.movement.tick()
    again.sim.tick()
    expect(again.sim.allTenancies()).toEqual(tenancies)
  })

  it('keeps pre-round rooms out of the vacancy pool: self-assignment never targets one', () => {
    const { movement, sim } = build(77)
    movement.tick()
    sim.tick()
    const preRoundKeys = new Set(sim.allTenancies().map((t) => `${t.floor}:${t.room}`))
    // Drive past the first arrival (TUNING.GUEST_CADENCE_SECONDS[4] = 30 s)
    // plus impatience (TUNING.GUEST_IMPATIENCE_SECONDS = 20 s) and a margin,
    // collecting every self-assignment the queue produces.
    const selfAssigned: string[] = []
    for (let t = 1; t <= 1200; t++) {
      movement.tick()
      for (const e of sim.tick()) {
        if (e.type === 'guest:self_assigned') {
          selfAssigned.push(`${e.floor}:${e.room}`)
        }
      }
    }
    expect(selfAssigned.length).toBeGreaterThan(0)
    for (const key of selfAssigned) expect(preRoundKeys.has(key)).toBe(false)
  })
})

describe('sim:pre_round_b', () => {
  it('checks pre-round guests out inside the settled dwell and churns their rooms', () => {
    // dwellScale test seam (AD-004): 0.02 → the 45–90 s dwell draws 0.9–1.8 s.
    const { movement, sim } = build(4242, 0.02)
    movement.tick()
    sim.tick()

    const checkedOut: {
      guestId: string
      floor: GuestFloorId
      room: RoomIndex
      tick: number
      preRound?: true
    }[] = []
    const tenancyFlips = new Set<string>()
    const identities = new Set<string>()
    for (let t = 1; t <= 45; t++) {
      movement.tick()
      for (const e of sim.tick()) {
        if (e.type === 'guest:checked_out')
          checkedOut.push({ ...e, floor: e.floor as GuestFloorId, tick: t })
        if (e.type === 'room:tenancy' && !e.occupied) tenancyFlips.add(`${e.floor}:${e.room}`)
        if (e.type === 'cosmetic:guest') identities.add(e.guestId)
      }
    }
    // All PRE_ROUND_OCCUPANCY[4] guests out inside the drawn dwell window
    // (max 90 s × 0.02 × 20 Hz = 36 ticks; padded to 45), each flagged.
    expect(checkedOut).toHaveLength(TUNING.PRE_ROUND_OCCUPANCY[4])
    for (const co of checkedOut) expect(co.tick).toBeLessThanOrEqual(40)
    expect(checkedOut.every((c) => c.preRound === true)).toBe(true)
    // Identity rides the checkout flush — the guest enters hall view now, so
    // the seed is renderable and the snapshot carries its row (VPOL-05).
    expect(identities).toEqual(new Set(checkedOut.map((c) => c.guestId)))

    // Each vacated room re-trashed as checkout churn (`settled`, silently —
    // no sabotage-shaped room:trashed) and its sign flipped Vacant.
    for (const co of checkedOut) {
      expect(sim.roomState(co.floor, co.room)).toBe('settled')
      expect(tenancyFlips.has(`${co.floor}:${co.room}`)).toBe(true)
    }
    expect(sim.allTenancies()).toHaveLength(0)

    // The settle score never saw them; nobody was assigned there yet, so no
    // discovery complaint either.
    expect(sim.settledCount).toBe(0)
    expect(sim.complaintCount).toBe(0)

    // They walk home on the GUEST-09 path and leave the hotel.
    const left = new Set<string>()
    for (let t = 45; t <= 2000 && left.size < checkedOut.length; t++) {
      movement.tick()
      for (const e of sim.tick()) {
        if (e.type === 'guest:left') left.add(e.guestId)
      }
    }
    expect(left).toEqual(new Set(checkedOut.map((c) => c.guestId)))
  })
})
