import type { GuestFloorId, Role, SimEvent } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { TICK_HZ } from './tick.js'
import { PREP_TICKS, UNPREP_TICKS, WorkChannels } from './work.js'

// Spec WORK-01..15 (gate scenarios sim:prep / sim:unprep / sim:fake_prep):
// scripted positions + start intents over the pure work system. Positions are
// integer millitiles; AD-010 room 1 on any guest floor spans [1000, 4500).

const CENTER = 2750 // inside room 1
const OUTSIDE = 29_500 // east open hall, outside every segment
const LOBBY = 15_000 // grand-lobby center: no rooms there
const R1 = 1 as const

function workOf(events: readonly SimEvent[], type: SimEvent['type']) {
  return events.filter((e) => e.type === type)
}

type Pos = { floor: GuestFloorId | 'lobby'; x: number }
const pos = (floor: GuestFloorId | 'lobby', x: number): Pos => ({ floor, x })
const positions = (...entries: [string, Pos][]) => new Map(entries)

function simWith(deal: [string, Role][]) {
  return new WorkChannels(new Map(deal))
}

describe('sim:prep', () => {
  it('preps a fresh room in exactly 100 ticks (WORK-01, WORK-02)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const here = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])

    // Entry tick: the first interior observation rides alone.
    expect(sim.tick(here)).toEqual([
      { type: 'room:observed', playerId: 'ada', floor: 'floor1', room: 1, state: 'fresh' },
    ])
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    expect(sim.startWork('ada', 'floor1', R1)).toBe('channel-active')

    // Tick 1 after start: the private start confirmation only.
    expect(sim.tick(here)).toEqual([
      { type: 'work:started', playerId: 'ada', floor: 'floor1', room: 1, seconds: 5 },
    ])
    // Ticks 2..99 are silent; the transition lands exactly on tick 100.
    for (let i = 2; i < PREP_TICKS; i++) {
      expect(sim.tick(here)).toEqual([])
    }
    expect(sim.tick(here)).toEqual([
      { type: 'room:prepped', floor: 'floor1', room: 1 },
      { type: 'work:ended', playerId: 'ada', floor: 'floor1', room: 1, outcome: 'completed' },
    ])
    expect(sim.stateOf('floor1', R1)).toBe('prepped')
    expect(PREP_TICKS).toBe(100)
    expect(TICK_HZ).toBe(20)
  })

  it('preps a trashed room back to prepped and survives unlimited re-trash (WORK-02, WORK-06)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const here = positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', 3000)])
    sim.tick(here)

    // Staff: fresh → prepped.
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(here)
    expect(sim.stateOf('floor1', R1)).toBe('prepped')

    // Saboteur: prepped → trashed.
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS; i++) sim.tick(here)
    expect(sim.stateOf('floor1', R1)).toBe('trashed')

    // Staff re-preps the trashed room (FR-7: any non-prepped state).
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(here)
    expect(sim.stateOf('floor1', R1)).toBe('prepped')

    // Re-trash is unlimited — no counter exists anywhere (§7).
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS; i++) sim.tick(here)
    expect(sim.stateOf('floor1', R1)).toBe('trashed')
  })

  it('rejects work:start with no positions, wrong floor, lobby floor, double start, and on prepped rooms (WORK-03)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    // No positions yet: not demonstrably inside any segment.
    expect(sim.startWork('ada', 'floor1', R1)).toBe('not-in-room')
    // Standing on the lobby floor: segments exist only on guest floors.
    sim.tick(positions(['ada', pos('lobby', LOBBY)], ['vin', pos('lobby', LOBBY)]))
    expect(sim.startWork('ada', 'floor1', R1)).toBe('not-in-room')
    // Inside room 1 of floor2 but naming floor1: segment matching includes floor.
    sim.tick(positions(['ada', pos('floor2', CENTER)], ['vin', pos('lobby', LOBBY)]))
    expect(sim.startWork('ada', 'floor1', R1)).toBe('not-in-room')
    // Inside the segment: accepted; a second intent while channeling bounces.
    expect(sim.startWork('ada', 'floor2', R1)).toBe('accepted')
    expect(sim.startWork('ada', 'floor2', R1)).toBe('channel-active')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(positions(['ada', pos('floor2', CENTER)]))
    // Prepped room offers staff no action.
    expect(sim.startWork('ada', 'floor2', R1)).toBe('room-not-workable')
  })

  it('cancels cleanly on walk-out: exactly one work:ended, state unchanged (WORK-11)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const inside = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    sim.tick(inside)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < 10; i++) sim.tick(inside)

    // Walk out: the exit tick carries exactly one cancelled end, nothing else.
    const exit = sim.tick(positions(['ada', pos('floor1', OUTSIDE)], ['vin', pos('lobby', LOBBY)]))
    expect(workOf(exit, 'work:ended')).toEqual([
      { type: 'work:ended', playerId: 'ada', floor: 'floor1', room: 1, outcome: 'cancelled' },
    ])
    expect(sim.stateOf('floor1', R1)).toBe('fresh')
    // No lingering channel: further ticks emit nothing for ada.
    for (let i = 0; i < 5; i++) {
      expect(
        sim.tick(positions(['ada', pos('floor1', OUTSIDE)], ['vin', pos('lobby', LOBBY)])),
      ).toEqual([])
    }
  })

  it('lets two staff channel in one room; same-tick completions apply in start order (edge case)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['bruno', 'staff'],
      ['vin', 'saboteur'],
    ])
    const here = positions(
      ['ada', pos('floor1', CENTER)],
      ['bruno', pos('floor1', 3000)],
      ['vin', pos('lobby', LOBBY)],
    )
    sim.tick(here)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    expect(sim.startWork('bruno', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS - 1; i++) sim.tick(here)
    const done = sim.tick(here)
    expect(workOf(done, 'room:prepped')).toEqual([
      { type: 'room:prepped', floor: 'floor1', room: 1 },
    ])
    const ended = workOf(done, 'work:ended')
    expect(ended.map((e) => ('playerId' in e ? e.playerId : ''))).toEqual(['ada', 'bruno'])
  })

  it('drops a leaver channel silently: no work:ended, no transition (WORK-12)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const here = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    sim.tick(here)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < 10; i++) sim.tick(here)
    sim.leave('ada')
    for (let i = 0; i < PREP_TICKS + 5; i++) {
      expect(sim.tick(positions(['vin', pos('lobby', LOBBY)]))).toEqual([])
    }
    expect(sim.stateOf('floor1', R1)).toBe('fresh')
  })
})

describe('sim:unprep', () => {
  it('un-preps a prepped room in exactly 60 ticks (WORK-04, WORK-05)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    // Setup: staff makes the room prepped while vin waits in the lobby.
    const adaHere = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    sim.tick(adaHere)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(adaHere)
    expect(sim.stateOf('floor1', R1)).toBe('prepped')

    // Saboteur walks in and observes the prepped interior (FR-10).
    const vinEnters = sim.tick(positions(['vin', pos('floor1', CENTER)]))
    expect(workOf(vinEnters, 'room:observed')).toEqual([
      { type: 'room:observed', playerId: 'vin', floor: 'floor1', room: 1, state: 'prepped' },
    ])

    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    const vinHere = positions(['vin', pos('floor1', CENTER)])
    expect(sim.tick(vinHere)).toEqual([
      { type: 'work:started', playerId: 'vin', floor: 'floor1', room: 1, seconds: 3 },
    ])
    for (let i = 2; i < UNPREP_TICKS; i++) {
      expect(sim.tick(vinHere)).toEqual([])
    }
    expect(sim.tick(vinHere)).toEqual([
      { type: 'room:trashed', floor: 'floor1', room: 1 },
      { type: 'work:ended', playerId: 'vin', floor: 'floor1', room: 1, outcome: 'completed' },
    ])
    expect(sim.stateOf('floor1', R1)).toBe('trashed')
    expect(UNPREP_TICKS).toBe(60)
  })

  it('rejects a staff un-prep on a prepped room — role gating is server-side (WORK-07)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const here = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    sim.tick(here)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(here)
    expect(sim.stateOf('floor1', R1)).toBe('prepped')
    expect(sim.startWork('ada', 'floor1', R1)).toBe('room-not-workable')
  })
})

describe('sim:fake_prep', () => {
  it('runs the fake channel on a fresh room: same duration, no state change, no room event (WORK-08, WORK-09)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const here = positions(['vin', pos('floor1', CENTER)], ['ada', pos('lobby', LOBBY)])
    sim.tick(here)
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    // Indistinguishable from a staff prep: same shape, same duration (FR-9).
    expect(sim.tick(here)).toEqual([
      { type: 'work:started', playerId: 'vin', floor: 'floor1', room: 1, seconds: 5 },
    ])
    for (let i = 2; i < PREP_TICKS; i++) {
      expect(sim.tick(here)).toEqual([])
    }
    const done = sim.tick(here)
    // The ONLY difference from a real prep: no room transition event.
    expect(done).toEqual([
      { type: 'work:ended', playerId: 'vin', floor: 'floor1', room: 1, outcome: 'completed' },
    ])
    expect(sim.stateOf('floor1', R1)).toBe('fresh')
  })

  it('never emits a room transition for a fake channel on a trashed room (WORK-09)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const here = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    sim.tick(here)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(here)
    expect(sim.stateOf('floor1', R1)).toBe('prepped')

    // Saboteur un-preps (the prepped-room action), then fake-preps the result.
    const both = positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', CENTER)])
    sim.tick(both) // vin enters
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS; i++) sim.tick(both)
    expect(sim.stateOf('floor1', R1)).toBe('trashed')
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(positions(['vin', pos('floor1', CENTER)]))
    expect(sim.stateOf('floor1', R1)).toBe('trashed')
  })
})

describe('sim:room_observed', () => {
  it('sends room:observed on segment entry only, with the current state (WORK-14, WORK-15)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    // Entering room 1 observes fresh.
    const enter = sim.tick(positions(['ada', pos('floor1', CENTER)]))
    expect(workOf(enter, 'room:observed')).toEqual([
      { type: 'room:observed', playerId: 'ada', floor: 'floor1', room: 1, state: 'fresh' },
    ])
    // Standing still observes nothing new.
    expect(sim.tick(positions(['ada', pos('floor1', CENTER)]))).toEqual([])
    // Outside segments observes nothing.
    expect(sim.tick(positions(['ada', pos('floor1', OUTSIDE)]))).toEqual([])
    // Re-entry observes again.
    expect(
      workOf(sim.tick(positions(['ada', pos('floor1', CENTER)])), 'room:observed'),
    ).toHaveLength(1)
    // The lobby floor has no rooms: no observation events there.
    expect(sim.tick(positions(['ada', pos('lobby', LOBBY)]))).toEqual([])
  })
})

describe('sim:work determinism', () => {
  it('replays a 120-tick scripted sequence bit-for-bit across runs', () => {
    function run(): string {
      const sim = simWith([
        ['ada', 'staff'],
        ['vin', 'saboteur'],
      ])
      const log: SimEvent[][] = []
      // Script: both enter room 1 (ada preps, vin fake-preps), ada walks out
      // mid-channel at tick 51 (cancel), vin's fake completes on tick 100.
      log.push([
        ...sim.tick(positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', 3000)])),
      ])
      expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
      expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
      for (let i = 1; i <= 120; i++) {
        const here =
          i <= 50
            ? positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', 3000)])
            : positions(['ada', pos('floor1', OUTSIDE)], ['vin', pos('floor1', 3000)])
        log.push([...sim.tick(here)])
      }
      return JSON.stringify(log)
    }
    expect(run()).toBe(run())
  })
})
