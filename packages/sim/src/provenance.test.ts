import type { FloorId, GuestFloorId, RecapEntry, RoomIndex, SimEvent } from '@turnover/shared'
import { roomDoorXMilli } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { GuestSim, type MovementPort, type RoomIntelPort } from './guests.js'
import { MovementSim } from './movement.js'
import { RoundSim } from './roundSim.js'
import { PREP_TICKS, UNPREP_TICKS, WorkChannels } from './work.js'

/** Structural test access to GuestSim internals (private by design) — typed
 *  instead of `any` so the lint gate stays clean. */
interface GuestRow {
  id: string
  phase: string
  assigned: { floor: GuestFloorId; room: RoomIndex } | null
  target: { floor: GuestFloorId; room: RoomIndex } | null
  impatientAt: number
  impatienceRemaining: number | null
  diningDwellTicks: number | null
  dwellEndsAt: number | null
  complaintReport: { floor: GuestFloorId; room: RoomIndex; fresh: boolean } | null
}
interface GuestSimInternals {
  guests: Map<string, GuestRow>
  tenanted: Map<string, string>
  movement: MovementPort
}

const IDS = ['p1', 'p2', 'p3', 'p4'] as const
const CENTER = 2750
const LOBBY = 15_000
const R1 = 1 as const

/** Typed escape hatch for GuestSim privates in tests. */
function internalsOf(guests: GuestSim): GuestSimInternals {
  return guests as unknown as GuestSimInternals
}

class StubPort implements MovementPort {
  private pos = new Map<string, { floor: FloorId; x: number }>()
  joinGuest(id: string, floor: FloorId, xTiles: number): void {
    this.pos.set(id, { floor, x: xTiles })
  }
  removeGuest(id: string): void {
    this.pos.delete(id)
  }
  announceGuest(): void {}
  positionOf(id: string) {
    return this.pos.get(id)
  }
  viewOf(id: string) {
    const p = this.pos.get(id)
    return { floor: p?.floor ?? null, roomKey: null, car: null, x: p?.x ?? null }
  }
  startMove(): void {}
  stopMove(): void {}
  callElevator(): 'dispatched' | 'ignored' | 'rejected' {
    return 'ignored'
  }
  pressFloor(): 'accepted' | 'ignored' | 'rejected' {
    return 'ignored'
  }
}

// ---------------------------------------------------------------------------
// WorkChannels provenance (FR-32)
// ---------------------------------------------------------------------------

describe('sim:trash_provenance', () => {
  it('initial rooms are fresh with no provenance (PROV-07)', () => {
    const wc = new WorkChannels(new Map([['p1', 'staff'] as const, ['p2', 'saboteur'] as const]))
    expect(wc.stateOf('floor1', 1)).toBe('fresh')
    expect(wc.provenanceOf('floor1', 1)).toBe('none')
  })

  it('churnTrash sets settled + churn (PROV-02)', () => {
    const wc = new WorkChannels(new Map([['p1', 'staff'] as const]))
    wc.churnTrash('floor1', 1)
    expect(wc.stateOf('floor1', 1)).toBe('settled')
    expect(wc.provenanceOf('floor1', 1)).toBe('churn')
  })

  it('sabotage trashed via prep→unprep sets sabotage overwriting churn (PROV-01, PROV-05)', () => {
    const wc = new WorkChannels(new Map([['ada', 'staff'] as const, ['vin', 'saboteur'] as const]))
    wc.churnTrash('floor1', R1)
    expect(wc.provenanceOf('floor1', R1)).toBe('churn')
    let here: Map<string, { floor: FloorId; x: number }> = new Map([
      ['ada', { floor: 'floor1' as const, x: CENTER }],
      ['vin', { floor: 'lobby' as const, x: LOBBY }],
    ])
    wc.tick(here)
    expect(wc.startWork('ada', 'floor1', R1)).toBe('accepted')
    wc.tick(here)
    for (let i = 2; i < PREP_TICKS; i++) wc.tick(here)
    let ev = wc.tick(here)
    expect(ev.some((e) => e.type === 'room:prepped')).toBe(true)
    expect(wc.provenanceOf('floor1', R1)).toBe('none')
    here = new Map<string, { floor: FloorId; x: number }>([
      ['ada', { floor: 'lobby' as const, x: LOBBY }],
      ['vin', { floor: 'floor1' as const, x: CENTER }],
    ])
    wc.tick(here)
    expect(wc.startWork('vin', 'floor1', R1)).toBe('accepted')
    wc.tick(here)
    for (let i = 2; i < UNPREP_TICKS; i++) wc.tick(here)
    ev = wc.tick(here)
    expect(ev.some((e) => e.type === 'room:trashed')).toBe(true)
    expect(wc.provenanceOf('floor1', R1)).toBe('sabotage')
  })

  it('prep clears provenance to none (PROV-03)', () => {
    const wc = new WorkChannels(new Map([['ada', 'staff'] as const, ['vin', 'saboteur'] as const]))
    wc.churnTrash('floor1', R1)
    let here: Map<string, { floor: FloorId; x: number }> = new Map([
      ['ada', { floor: 'floor1' as const, x: CENTER }],
      ['vin', { floor: 'lobby' as const, x: LOBBY }],
    ])
    wc.tick(here)
    wc.startWork('ada', 'floor1', R1)
    wc.tick(here)
    for (let i = 2; i < PREP_TICKS; i++) wc.tick(here)
    wc.tick(here)
    expect(wc.provenanceOf('floor1', R1)).toBe('none')
    here = new Map<string, { floor: FloorId; x: number }>([
      ['ada', { floor: 'lobby' as const, x: LOBBY }],
      ['vin', { floor: 'floor1' as const, x: CENTER }],
    ])
    wc.tick(here)
    wc.startWork('vin', 'floor1', R1)
    wc.tick(here)
    for (let i = 2; i < UNPREP_TICKS; i++) wc.tick(here)
    wc.tick(here)
    expect(wc.provenanceOf('floor1', R1)).toBe('sabotage')
    here = new Map<string, { floor: FloorId; x: number }>([
      ['ada', { floor: 'floor1' as const, x: CENTER }],
      ['vin', { floor: 'lobby' as const, x: LOBBY }],
    ])
    wc.tick(here)
    expect(wc.startWork('ada', 'floor1', R1)).toBe('accepted')
    wc.tick(here)
    for (let i = 2; i < PREP_TICKS; i++) wc.tick(here)
    const ev = wc.tick(here)
    expect(ev.some((e) => e.type === 'room:prepped')).toBe(true)
    expect(wc.provenanceOf('floor1', R1)).toBe('none')
  })

  it('sabotage re-trash keeps sabotage (PROV-04)', () => {
    const wc = new WorkChannels(new Map([['ada', 'staff'] as const, ['vin', 'saboteur'] as const]))
    let here: Map<string, { floor: FloorId; x: number }> = new Map([
      ['ada', { floor: 'floor1' as const, x: CENTER }],
      ['vin', { floor: 'lobby' as const, x: LOBBY }],
    ])
    wc.tick(here)
    wc.startWork('ada', 'floor1', R1)
    wc.tick(here)
    for (let i = 2; i < PREP_TICKS; i++) wc.tick(here)
    wc.tick(here)
    here = new Map<string, { floor: FloorId; x: number }>([
      ['ada', { floor: 'lobby' as const, x: LOBBY }],
      ['vin', { floor: 'floor1' as const, x: CENTER }],
    ])
    wc.tick(here)
    wc.startWork('vin', 'floor1', R1)
    wc.tick(here)
    for (let i = 2; i < UNPREP_TICKS; i++) wc.tick(here)
    wc.tick(here)
    expect(wc.provenanceOf('floor1', R1)).toBe('sabotage')
    here = new Map<string, { floor: FloorId; x: number }>([
      ['ada', { floor: 'floor1' as const, x: CENTER }],
      ['vin', { floor: 'lobby' as const, x: LOBBY }],
    ])
    wc.tick(here)
    wc.startWork('ada', 'floor1', R1)
    wc.tick(here)
    for (let i = 2; i < PREP_TICKS; i++) wc.tick(here)
    wc.tick(here)
    here = new Map<string, { floor: FloorId; x: number }>([
      ['ada', { floor: 'lobby' as const, x: LOBBY }],
      ['vin', { floor: 'floor1' as const, x: CENTER }],
    ])
    wc.tick(here)
    wc.startWork('vin', 'floor1', R1)
    wc.tick(here)
    for (let i = 2; i < UNPREP_TICKS; i++) wc.tick(here)
    const ev2 = wc.tick(here)
    expect(ev2.some((e) => e.type === 'room:trashed')).toBe(true)
    expect(wc.provenanceOf('floor1', R1)).toBe('sabotage')
  })

  it('fresh room has none provenance', () => {
    const wc = new WorkChannels(new Map([['p1', 'staff'] as const]))
    expect(wc.provenanceOf('floor1', 2)).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Tenancy lifecycle (FR-33) — direct GuestSim with stub movement
// ---------------------------------------------------------------------------

describe('sim:tenancy', () => {
  it('settle emits occupied true (PROV-09)', () => {
    const stub = new StubPort()
    const intel: RoomIntelPort = {
      roomStateOf: () => 'fresh',
      unprepActiveIn: () => false,
    }
    const guests = new GuestSim(1, 4, stub, undefined, intel)
    // Inject a guest in toRoom at floor1:1, position at door
    const g: GuestRow = {
      id: 'guest:1',
      phase: 'toRoom',
      assigned: { floor: 'floor1', room: 1 },
      target: null,
      impatientAt: 999999,
      impatienceRemaining: null,
      diningDwellTicks: null,
      dwellEndsAt: null,
      complaintReport: null,
    }
    internalsOf(guests).guests.set('guest:1', g)
    stub.joinGuest('guest:1', 'floor1', roomDoorXMilli(1) / 1000)
    const events = guests.tick(0)
    const tenancy = events.find((e) => e.type === 'room:tenancy') as
      | Extract<SimEvent, { type: 'room:tenancy' }>
      | undefined
    expect(tenancy).toBeDefined()
    expect(tenancy?.occupied).toBe(true)
    expect(tenancy?.floor).toBe('floor1')
    expect(tenancy?.room).toBe(1)
    expect(events.some((e) => e.type === 'guest:settled')).toBe(true)
  })

  it('checkout emits occupied false (PROV-10)', () => {
    const stub = new StubPort()
    const guests = new GuestSim(1, 4, stub)
    const g: GuestRow = {
      id: 'guest:1',
      phase: 'settling',
      assigned: { floor: 'floor1', room: 1 },
      target: null,
      impatientAt: 0,
      impatienceRemaining: null,
      diningDwellTicks: null,
      dwellEndsAt: 0,
      complaintReport: null,
    }
    internalsOf(guests).guests.set('guest:1', g)
    internalsOf(guests).tenanted.set('floor1:1', 'guest:1')
    stub.joinGuest('guest:1', 'floor1', roomDoorXMilli(1) / 1000)
    const events = guests.tick(0)
    expect(events.some((e) => e.type === 'guest:checked_out')).toBe(true)
    const tenancy = events.find((e) => e.type === 'room:tenancy') as
      | Extract<SimEvent, { type: 'room:tenancy' }>
      | undefined
    expect(tenancy).toBeDefined()
    expect(tenancy?.occupied).toBe(false)
  })

  it('discovery emits vacant and keeps room trashed provenance (PROV-11)', () => {
    const stub = new StubPort()
    const wc = new WorkChannels(new Map([['p1', 'staff'] as const, ['p2', 'saboteur'] as const]))
    // Make floor1:1 trashed sabotage via work
    wc.churnTrash('floor1', 1)
    let here: Map<string, { floor: FloorId; x: number }> = new Map([
      ['p1', { floor: 'floor1', x: CENTER }],
      ['p2', { floor: 'lobby', x: LOBBY }],
    ])
    wc.tick(here)
    wc.startWork('p1', 'floor1', 1)
    wc.tick(here)
    for (let i = 2; i < PREP_TICKS; i++) wc.tick(here)
    wc.tick(here)
    here = new Map<string, { floor: FloorId; x: number }>([
      ['p1', { floor: 'lobby', x: LOBBY }],
      ['p2', { floor: 'floor1', x: CENTER }],
    ])
    wc.tick(here)
    wc.startWork('p2', 'floor1', 1)
    wc.tick(here)
    for (let i = 2; i < UNPREP_TICKS; i++) wc.tick(here)
    wc.tick(here)
    expect(wc.provenanceOf('floor1', 1)).toBe('sabotage')
    const intel: RoomIntelPort = {
      roomStateOf: (f, r) => wc.stateOf(f, r),
      unprepActiveIn: () => false,
    }
    const guests = new GuestSim(2, 4, stub, undefined, intel)
    const g: GuestRow = {
      id: 'guest:2',
      phase: 'toRoom',
      assigned: { floor: 'floor1', room: 1 },
      target: null,
      impatientAt: 999999,
      impatienceRemaining: null,
      diningDwellTicks: null,
      dwellEndsAt: null,
      complaintReport: null,
    }
    internalsOf(guests).guests.set('guest:2', g)
    stub.joinGuest('guest:2', 'floor1', roomDoorXMilli(1) / 1000)
    const events = guests.tick(1)
    expect(events.some((e) => e.type === 'guest:angered')).toBe(true)
    const tenancy = events.find((e) => e.type === 'room:tenancy') as
      | Extract<SimEvent, { type: 'room:tenancy' }>
      | undefined
    expect(tenancy).toBeDefined()
    expect(tenancy?.occupied).toBe(false)
    expect(wc.stateOf('floor1', 1)).toBe('trashed')
    expect(wc.provenanceOf('floor1', 1)).toBe('sabotage')
  })
})

// ---------------------------------------------------------------------------
// Recap complaint provenance (FR-22 amendment)
// ---------------------------------------------------------------------------

describe('sim:recap_provenance', () => {
  it('complaint entries carry sabotage with actor and churn without, wrong-delivery absent', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 11,
      playerIds: [...IDS],
      movement: {
        joinGuest(id: string, floor: FloorId, xTiles: number) {
          movement.join(id, { kind: 'guest', floor, xMilli: Math.round(xTiles * 1000) })
        },
        removeGuest(id: string) {
          movement.leave(id)
        },
        announceGuest(id: string) {
          movement.announcePosition(id)
        },
        positionOf(id: string) {
          const p = movement.positionOf(id)
          return p === undefined ? undefined : { floor: p.floor, x: p.x }
        },
        viewOf(id: string) {
          return movement.viewOf(id)
        },
        startMove(id: string, dir: 'left' | 'right') {
          movement.startMove(id, dir)
        },
        stopMove(id: string) {
          movement.stopMove(id)
        },
        callElevator(id: string) {
          return movement.callElevator(id)
        },
        pressFloor(id: string, floor: FloorId) {
          return movement.pressFloor(id, floor)
        },
      },
      totalTicks: 30000,
      guestTiming: {
        cadenceTicks: 20,
        impatienceTicks: 100000,
        dwellScale: 0.001,
        carryClockTicks: 1000000,
      },
    })
    const sab = sim.saboteurId
    const staff = [...IDS].find((id) => id !== sab)!
    const startPos: Map<string, { floor: FloorId; x: number }> = new Map<
      string,
      { floor: FloorId; x: number }
    >([...IDS].map((id) => [id, { floor: 'lobby' as const, x: LOBBY }] as const))
    movement.tick()
    sim.tick(startPos)
    // Prep floor1:1 then sabotage
    const posStaff: Map<string, { floor: FloorId; x: number }> = new Map([
      [staff, { floor: 'floor1' as const, x: CENTER }],
      [sab, { floor: 'lobby' as const, x: LOBBY }],
      ...[...IDS]
        .filter((id) => id !== sab && id !== staff)
        .map((id) => [id, { floor: 'lobby' as const, x: LOBBY }] as const),
    ])
    movement.tick()
    sim.tick(posStaff)
    sim.startWork(staff, 'floor1', 1)
    for (let i = 0; i < PREP_TICKS + 1; i++) {
      movement.tick()
      sim.tick(posStaff)
    }
    const posSab: Map<string, { floor: FloorId; x: number }> = new Map([
      [sab, { floor: 'floor1' as const, x: CENTER }],
      [staff, { floor: 'lobby' as const, x: LOBBY }],
      ...[...IDS]
        .filter((id) => id !== sab && id !== staff)
        .map((id) => [id, { floor: 'lobby' as const, x: LOBBY }] as const),
    ])
    movement.tick()
    sim.tick(posSab)
    sim.startWork(sab, 'floor1', 1)
    for (let i = 0; i < UNPREP_TICKS + 1; i++) {
      movement.tick()
      sim.tick(posSab)
    }
    // Now create a churn room via direct churnTrash on floor1:2
    ;(sim as unknown as { work: WorkChannels }).work.churnTrash('floor1', 2)

    // Create two discovered guests already walking home (toExit at lobby desk)
    const guests = (sim as unknown as { guests: GuestSim }).guests
    const mv = internalsOf(guests).movement
    // Guest for sabotage: fresh true
    const gS: GuestRow = {
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
    const gC: GuestRow = {
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
    internalsOf(guests).guests.set('guest:99', gS)
    internalsOf(guests).guests.set('guest:100', gC)
    mv.joinGuest('guest:99', 'lobby', 15)
    mv.joinGuest('guest:100', 'lobby', 15.2)
    movement.tick()
    const flushed = sim.tick(posStaff)
    const discovered = flushed.filter((e) => e.type === 'guest:discovered')
    expect(discovered.length).toBe(2)
    // Check recap
    const recaps = sim.recapEntries()
    const complaints = recaps.filter(
      (e): e is Extract<RecapEntry, { kind: 'complaint' }> => e.kind === 'complaint',
    )
    expect(complaints.length).toBe(2)
    const sabC = complaints.find((c) => c.room === 1)!
    expect(sabC.provenance).toBe('sabotage')
    expect(sabC.actorId).toBe(sab)
    expect(sabC.fresh).toBe(true)
    const churnC = complaints.find((c) => c.room === 2)!
    expect(churnC.provenance).toBe('churn')
    expect(churnC.actorId).toBeUndefined()
    expect(churnC.fresh).toBe(false)
    // Wrong-delivery never in recap — ensure no complaint for guest:complained
    const wrongs = flushed.filter((e) => e.type === 'guest:complained')
    expect(wrongs.length).toBe(0)
  })
})
