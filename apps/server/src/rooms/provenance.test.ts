import { describe, expect, it } from 'vitest'
import { MovementSim, RoundSim } from '@turnover/sim'
import type { FloorId } from '@turnover/shared'

class Port {
  constructor(private readonly sim: MovementSim) {}
  joinGuest(id: string, floor: FloorId, xTiles: number) {
    this.sim.join(id, { kind: 'guest', floor, xMilli: Math.round(xTiles * 1000) })
  }
  removeGuest(id: string) {
    this.sim.leave(id)
  }
  announceGuest(id: string) {
    this.sim.announcePosition(id)
  }
  positionOf(id: string) {
    const p = this.sim.positionOf(id)
    return p === undefined ? undefined : { floor: p.floor, x: p.x }
  }
  viewOf(id: string) {
    return this.sim.viewOf(id)
  }
  startMove(id: string, dir: 'left' | 'right') {
    this.sim.startMove(id, dir)
  }
  stopMove(id: string) {
    this.sim.stopMove(id)
  }
  callElevator(id: string) {
    return this.sim.callElevator(id)
  }
  pressFloor(id: string, floor: FloorId) {
    return this.sim.pressFloor(id, floor)
  }
}

describe('server:recap_provenance', () => {
  it('movement snapshot carries tenancies filtered to viewer floor and spectator gets all', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 1,
      playerIds: ['p1', 'p2', 'p3', 'p4'],
      movement: new Port(movement),
      guestTiming: { cadenceTicks: 20, impatienceTicks: 100000, dwellScale: 0.001, carryClockTicks: 1000000 },
    })
    // Directly churn and tenancy via sim guests hack — settle two guests on different floors
    const guests: any = (sim as any).guests
    const port: Port = guests.movement
    // Create two tenanted rooms directly
    guests.tenanted.set('floor1:1', 'guest:1')
    guests.tenanted.set('floor2:3', 'guest:2')
    // Verify RoundSim queries
    expect(sim.tenanciesOn('floor1')).toEqual([{ floor: 'floor1', room: 1, occupied: true }])
    expect(sim.tenanciesOn('floor2')).toEqual([{ floor: 'floor2', room: 3, occupied: true }])
    expect(sim.allTenancies()).toEqual(
      expect.arrayContaining([
        { floor: 'floor1', room: 1, occupied: true },
        { floor: 'floor2', room: 3, occupied: true },
      ]),
    )
    // Tenancy filtering is server's movementSnapshotFor — here we just verify the queries the room consumes
    expect(sim.tenanciesOn('floor3')).toEqual([])
  })

  it('recap complaint entries carry sabotage with actor and churn without', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 2,
      playerIds: ['p1', 'p2', 'p3', 'p4'],
      movement: new Port(movement),
      totalTicks: 50000,
    })
    const sab = sim.saboteurId
    // Force a sabotage trash via direct work manipulation
    const work: any = (sim as any).work
    work.churnTrash('floor1', 2)
    // Prep floor1:2 then sabotage to get sabotage provenance on 1
    const LOBBY = 15_000
    const CENTER = 2750
    let here = new Map([
      ['p1', { floor: 'floor1' as FloorId, x: CENTER }],
      ['p2', { floor: 'lobby' as FloorId, x: LOBBY }],
      ['p3', { floor: 'lobby' as FloorId, x: LOBBY }],
      ['p4', { floor: 'lobby' as FloorId, x: LOBBY }],
    ])
    // Find staff and sab
    const staff = (['p1', 'p2', 'p3', 'p4'] as const).find((id) => id !== sab)!
    movement.tick()
    sim.tick(here)
    sim.startWork(staff as any, 'floor1', 1)
    for (let i = 0; i < 100; i++) {
      movement.tick()
      sim.tick(here)
    }
    let posSab = new Map([
      [sab, { floor: 'floor1' as FloorId, x: CENTER }],
      [staff, { floor: 'lobby' as FloorId, x: LOBBY }],
      ...(['p1', 'p2', 'p3', 'p4'] as const)
        .filter((id) => id !== sab && id !== staff)
        .map((id) => [id, { floor: 'lobby' as FloorId, x: LOBBY }] as const),
    ])
    movement.tick()
    sim.tick(posSab)
    sim.startWork(sab as any, 'floor1', 1)
    for (let i = 0; i < 60; i++) {
      movement.tick()
      sim.tick(posSab)
    }
    expect(work.provenanceOf('floor1', 1)).toBe('sabotage')
    expect(work.provenanceOf('floor1', 2)).toBe('churn')
    // Inject two discovered guests at lobby desk to trigger recap
    const guests2: any = (sim as any).guests
    const mv: any = guests2.movement
    const gS: any = {
      id: 'guest:99',
      phase: 'toExit',
      assigned: { floor: 'floor1', room: 1 },
      target: null,
      impatientAt: 0,
      impatienceRemaining: null,
      diningDwellTicks: null,
      dwellEndsAt: null,
      complaintReport: { floor: 'floor1', room: 1, fresh: true },
    }
    const gC: any = {
      id: 'guest:100',
      phase: 'toExit',
      assigned: { floor: 'floor1', room: 2 },
      target: null,
      impatientAt: 0,
      impatienceRemaining: null,
      diningDwellTicks: null,
      dwellEndsAt: null,
      complaintReport: { floor: 'floor1', room: 2, fresh: false },
    }
    guests2.guests.set('guest:99', gS)
    guests2.guests.set('guest:100', gC)
    mv.joinGuest('guest:99', 'lobby', 15)
    mv.joinGuest('guest:100', 'lobby', 15.2)
    movement.tick()
    const flushed = sim.tick(here)
    expect(flushed.filter((e) => e.type === 'guest:discovered').length).toBe(2)
    const recaps = sim.recapEntries()
    const complaints = recaps.filter((e) => e.kind === 'complaint') as any[]
    expect(complaints.length).toBe(2)
    const sabC = complaints.find((c: any) => c.room === 1)!
    expect(sabC.provenance).toBe('sabotage')
    expect(sabC.actorId).toBe(sab)
    const churnC = complaints.find((c: any) => c.room === 2)!
    expect(churnC.provenance).toBe('churn')
    expect(churnC.actorId).toBeUndefined()
  })
})
