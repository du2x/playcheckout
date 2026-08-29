import type { GuestFloorId, Role, SimEvent } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { RoundSim } from './roundSim.js'
import { TICK_HZ } from './tick.js'
import { FRESHNESS_TICKS, PREP_TICKS, UNPREP_TICKS, WorkChannels } from './work.js'

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

    // Entry tick: the door-open cue (EVID-16) + the first interior observation.
    expect(sim.tick(here)).toEqual([
      { type: 'room:entered', playerId: 'ada', floor: 'floor1', room: 1 },
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
      // EVID-01: the card auto-hangs on the prep completion (same tick).
      { type: 'room:carded', floor: 'floor1', room: 1 },
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
      // EVID-12: the sabotage rustle fires on the same tick as the transition.
      { type: 'room:rustle', floor: 'floor1', room: 1 },
      { type: 'work:ended', playerId: 'vin', floor: 'floor1', room: 1, outcome: 'completed' },
    ])
    expect(sim.stateOf('floor1', R1)).toBe('trashed')
    expect(UNPREP_TICKS).toBe(60)
  })

  it('keeps the card hung across a re-trash (EVID-03) and re-emits it on re-prep (EVID-01)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const adaHere = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    const both = positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', CENTER)])
    sim.tick(adaHere)
    // Prep: card hangs.
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    const prepDone = ticks(sim, PREP_TICKS, both)
    expect(workOf(prepDone, 'room:carded')).toEqual([
      { type: 'room:carded', floor: 'floor1', room: 1 },
    ])
    expect(sim.cardedOn('floor1')).toEqual([1])

    // Un-prep: the card STAYS — no un-card event exists anywhere (FR-11).
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    const trashDone = ticks(sim, UNPREP_TICKS, both)
    expect(trashDone.some((e: SimEvent) => e.type.startsWith('room:'))).toBe(true)
    expect(workOf(trashDone, 'room:carded')).toEqual([])
    expect(sim.cardedOn('floor1')).toEqual([1])

    // Re-prep: the transition re-emits the card (idempotent on the client).
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    const reDone = ticks(sim, PREP_TICKS, both)
    expect(workOf(reDone, 'room:carded')).toEqual([
      { type: 'room:carded', floor: 'floor1', room: 1 },
    ])
    expect(sim.cardedOn('floor1')).toEqual([1])
  })

  it('carries no timestamp, author, or validity flag on the card (EVID-05)', () => {
    const sim = simWith([['ada', 'staff']])
    const here = positions(['ada', pos('floor1', CENTER)])
    sim.tick(here)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    const done = ticks(sim, PREP_TICKS, here)
    const cards = workOf(done, 'room:carded')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toBeDefined()
    const card = cards[0] as (typeof cards)[number]
    expect(Object.keys(card).sort()).toEqual(['floor', 'room', 'type'])
  })

  it('queries the carded rooms ascending per floor and nothing for floors without cards (EVID-04 prep)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['bruno', 'staff'],
    ])
    const here = positions(['ada', pos('floor1', CENTER)], ['bruno', pos('floor2', 2750 + 3500)])
    sim.tick(here) // ada in floor1 room1, bruno in floor2 room2
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    expect(sim.startWork('bruno', 'floor2', 2)).toBe('accepted')
    const done = ticks(sim, PREP_TICKS, here)
    expect(workOf(done, 'room:carded')).toEqual([
      { type: 'room:carded', floor: 'floor1', room: 1 },
      { type: 'room:carded', floor: 'floor2', room: 2 },
    ])
    expect(sim.cardedOn('floor1')).toEqual([1])
    expect(sim.cardedOn('floor2')).toEqual([2])
    expect(sim.cardedOn('floor3')).toEqual([])
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
    expect(sim.cardedOn('floor1')).toEqual([]) // EVID-02: a fake hangs nothing
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

// Spec EVID-06..11 (gate scenario sim:freshness): trash ages. The window is
// exactly TUNING.FRESHNESS_WINDOW_SECONDS × TICK_HZ ticks since the sabotage
// completion tick; prep cancels, re-trash restarts, the buzzer kills.

function ticks(sim: WorkChannels, count: number, here: ReturnType<typeof positions>): SimEvent[] {
  let acc: SimEvent[] = []
  for (let i = 0; i < count; i++) acc = acc.concat(sim.tick(here))
  return acc
}

function trashRoom1(sim: WorkChannels): number {
  // Staff preps room 1, then the saboteur un-preps it; returns the absolute
  // tick count consumed (both players parked inside the segment).
  const adaHere = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
  const both = positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', CENTER)])
  sim.tick(adaHere)
  expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
  for (let i = 0; i < PREP_TICKS; i++) sim.tick(adaHere)
  sim.tick(both) // vin walks in (entry tick)
  expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
  for (let i = 0; i < UNPREP_TICKS; i++) sim.tick(both)
  return PREP_TICKS + UNPREP_TICKS + 1
}

describe('sim:freshness', () => {
  it('settles exactly FRESHNESS_WINDOW_SECONDS × TICK_HZ ticks after the sabotage (EVID-06, EVID-07, EVID-08)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    expect(sim.tick(positions())).toEqual([]) // warm-up entry tick
    trashRoom1(sim)
    expect(sim.stateOf('floor1', R1)).toBe('trashed')

    // The window: 1499 silent ticks of 'trashed', then settle on the boundary.
    for (let i = 1; i < FRESHNESS_TICKS; i++) {
      expect(sim.tick(positions())).toEqual([])
      expect(sim.stateOf('floor1', R1)).toBe('trashed')
    }
    expect(sim.tick(positions())).toEqual([{ type: 'room:settled', floor: 'floor1', room: 1 }])
    expect(sim.stateOf('floor1', R1)).toBe('settled')
    expect(FRESHNESS_TICKS).toBe(1500)
  })

  it('reads a settled room as settled through room:observed (EVID-07)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    trashRoom1(sim)
    for (let i = 0; i < FRESHNESS_TICKS; i++) sim.tick(positions())
    expect(sim.stateOf('floor1', R1)).toBe('settled')

    // A player who re-enters (segment was left) reads 'settled' (FR-10).
    sim.tick(positions(['ada', pos('floor1', OUTSIDE)])) // walk out: lastSegment clears
    const reentry = sim.tick(positions(['ada', pos('floor1', CENTER)]))
    expect(workOf(reentry, 'room:observed')).toEqual([
      { type: 'room:observed', playerId: 'ada', floor: 'floor1', room: 1, state: 'settled' },
    ])
  })

  it('cancels the pending settle when the room is re-prepped before the window elapses (EVID-09)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const adaHere = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    sim.tick(adaHere)
    trashRoom1(sim)

    // Re-prep 100 ticks into the 1500-tick window.
    for (let i = 0; i < 100; i++) sim.tick(adaHere)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(adaHere)
    expect(sim.stateOf('floor1', R1)).toBe('prepped')

    // Run well past the original deadline: no settle may fire from prepped.
    for (let i = 0; i < FRESHNESS_TICKS; i++) {
      sim.tick(adaHere)
      expect(sim.stateOf('floor1', R1)).toBe('prepped')
    }
    expect(sim.cardedOn('floor1')).toEqual([1]) // card survived (FR-11)
  })

  it('restarts the window on a re-trash after a cancelled one (EVID-10)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const adaHere = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    const both = positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', CENTER)])
    sim.tick(adaHere)
    trashRoom1(sim) // trash #1
    for (let i = 0; i < 100; i++) sim.tick(adaHere)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) sim.tick(adaHere) // cancel + prepped
    sim.tick(both) // vin is back in the segment (he was parked in the lobby view)
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS; i++) sim.tick(both) // trash #2

    // The NEW window: still trashed past the ORIGINAL deadline would-be spot.
    const remaining = FRESHNESS_TICKS - 1
    for (let i = 0; i < remaining; i++) {
      sim.tick(both)
      expect(sim.stateOf('floor1', R1)).toBe('trashed')
    }
    // ...then settles exactly 1500 ticks after trash #2.
    expect(sim.tick(both)).toEqual([{ type: 'room:settled', floor: 'floor1', room: 1 }])
    expect(sim.stateOf('floor1', R1)).toBe('settled')
  })

  it('dies with the round: no room:settled after the buzzer (EVID-11)', () => {
    // RoundSim with a shift too short for the window to elapse; roles are
    // discovered from the private role:dealt events (roundSim.test.ts pattern).
    const shiftTicks = PREP_TICKS + UNPREP_TICKS + 10
    const sim = new RoundSim({
      seed: 1,
      playerIds: ['ada', 'vin', 'p3', 'p4'],
      totalTicks: shiftTicks,
    })
    const dealt = sim.tick().filter((e) => e.type === 'role:dealt')
    const saboteur = dealt.find((e) => 'role' in e && e.role === 'saboteur')
    if (saboteur === undefined || !('playerId' in saboteur)) throw new Error('no saboteur dealt')
    const staffId = ['ada', 'vin', 'p3', 'p4'].find((id) => id !== saboteur.playerId)
    if (staffId === undefined) throw new Error('no staff dealt')
    // All four stand inside room 1's segment so ANY of them may start work.
    const inside = positions(
      ['ada', pos('floor1', CENTER)],
      ['vin', pos('floor1', CENTER)],
      ['p3', pos('floor1', 3000)],
      ['p4', pos('floor1', 3100)],
    )
    sim.tick(inside)
    expect(sim.startWork(staffId, 'floor1', R1)).toBe('accepted')
    let trashSeen = false
    for (let i = 0; i < PREP_TICKS; i++) {
      trashSeen ||= sim.tick(inside).some((e) => e.type === 'room:prepped')
    }
    expect(sim.startWork(saboteur.playerId, 'floor1', R1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS; i++) {
      trashSeen ||= sim.tick(inside).some((e) => e.type === 'room:trashed')
    }
    expect(trashSeen).toBe(true)

    // Burn the remaining shift ticks (buzzer inside the window) — then silence.
    let buzzerSeen = false
    for (let i = 0; i < shiftTicks; i++) {
      const events = sim.tick(inside)
      if (events.some((e) => e.type === 'round:buzzer')) buzzerSeen = true
      expect(events.some((e) => e.type === 'room:settled')).toBe(false)
    }
    expect(buzzerSeen).toBe(true)
    for (let i = 0; i < FRESHNESS_TICKS; i++) {
      expect(sim.tick(inside)).toEqual([])
    } // frozen: no settle event ever arrives after the buzzer (WORK-13)
  })
})

// Spec EVID-12/13/14 (gate scenario sim:rustle): the sabotage rustle fires
// exactly once per real trash transition — never for fakes, cancels, preps,
// or settles. Delivery range is the Router's earshot policy (router.test.ts).

describe('sim:rustle', () => {
  it('emits room:rustle exactly when a trash transition completes (EVID-12)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const adaHere = positions(['ada', pos('floor1', CENTER)], ['vin', pos('lobby', LOBBY)])
    const both = positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', CENTER)])
    sim.tick(adaHere)
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    const prepEvents = ticks(sim, PREP_TICKS, adaHere)
    // A plain prep completion carries no rustle.
    expect(workOf(prepEvents, 'room:rustle')).toEqual([])

    sim.tick(both)
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    const trashEvents = ticks(sim, UNPREP_TICKS, both)
    expect(workOf(trashEvents, 'room:rustle')).toEqual([
      { type: 'room:rustle', floor: 'floor1', room: 1 },
    ])
    // Exactly one rustle for the whole channel — and none after.
    expect(workOf(ticks(sim, 5, both), 'room:rustle')).toEqual([])
  })

  it('never emits a rustle for a fake prep, a cancelled channel, or a settle (EVID-14)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const here = positions(['vin', pos('floor1', CENTER)], ['ada', pos('lobby', LOBBY)])
    sim.tick(here)
    // Fake prep: no transition, no rustle.
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    expect(workOf(ticks(sim, PREP_TICKS, here), 'room:rustle')).toEqual([])

    // Cancelled channel: walk out mid-channel.
    expect(sim.startWork('vin', 'floor1', R1)).toBe('accepted')
    const cancelEvents = sim.tick(positions(['vin', pos('floor1', OUTSIDE)]))
    expect(workOf(cancelEvents, 'work:ended')).toEqual([
      { type: 'work:ended', playerId: 'vin', floor: 'floor1', room: 1, outcome: 'cancelled' },
    ])
    expect(workOf(cancelEvents, 'room:rustle')).toEqual([])

    // A settle (freshness expiry) is not a sabotage: no rustle.
    sim.tick(positions(['ada', pos('floor1', CENTER)])) // ada walks in
    expect(sim.startWork('ada', 'floor1', R1)).toBe('accepted')
    const prepDone = ticks(sim, PREP_TICKS, positions(['ada', pos('floor1', CENTER)]))
    expect(workOf(prepDone, 'room:prepped')).toHaveLength(1)
    expect(workOf(prepDone, 'room:rustle')).toEqual([])
    ticks(sim, FRESHNESS_TICKS, positions(['ada', pos('floor1', CENTER)]))
    expect(sim.stateOf('floor1', R1)).toBe('prepped') // cancelled by the prep
  })
})

// Spec EVID-16/17/18 (gate scenario sim:door_open_cue): every segment ENTRY
// fires one floor-public room:entered — pass-through included; exits,
// stillness, and lobby crossings stay silent.

describe('sim:door_open_cue', () => {
  it('fires room:entered once per entry, alongside the private room:observed (EVID-16, EVID-17)', () => {
    const sim = simWith([['ada', 'staff']])
    const enter = sim.tick(positions(['ada', pos('floor1', CENTER)]))
    expect(enter).toEqual([
      { type: 'room:entered', playerId: 'ada', floor: 'floor1', room: 1 },
      { type: 'room:observed', playerId: 'ada', floor: 'floor1', room: 1, state: 'fresh' },
    ])
    // Stillness, hallway, and re-entry each behave per the entry-only rule.
    expect(sim.tick(positions(['ada', pos('floor1', CENTER)]))).toEqual([])
    expect(workOf(sim.tick(positions(['ada', pos('floor1', OUTSIDE)])), 'room:entered')).toEqual([])
    const reenter = sim.tick(positions(['ada', pos('floor1', CENTER)]))
    expect(workOf(reenter, 'room:entered')).toEqual([
      { type: 'room:entered', playerId: 'ada', floor: 'floor1', room: 1 },
    ])
  })

  it('fires on a pass-through crossing from one room into the next (EVID-16)', () => {
    const sim = simWith([['ada', 'staff']])
    sim.tick(positions(['ada', pos('floor1', CENTER)]))
    // Room 2 starts at x = 4500 (AD-010); walking straight there is an entry.
    const cross = sim.tick(positions(['ada', pos('floor1', 5000)]))
    expect(workOf(cross, 'room:entered')).toEqual([
      { type: 'room:entered', playerId: 'ada', floor: 'floor1', room: 2 },
    ])
    expect(workOf(cross, 'room:observed')).toEqual([
      { type: 'room:observed', playerId: 'ada', floor: 'floor1', room: 2, state: 'fresh' },
    ])
  })

  it('fires once per entrant when two players enter on the same tick (edge)', () => {
    const sim = simWith([
      ['ada', 'staff'],
      ['vin', 'saboteur'],
    ])
    const enter = sim.tick(
      positions(['ada', pos('floor1', CENTER)], ['vin', pos('floor1', 3000)]),
    )
    expect(workOf(enter, 'room:entered')).toEqual([
      { type: 'room:entered', playerId: 'ada', floor: 'floor1', room: 1 },
      { type: 'room:entered', playerId: 'vin', floor: 'floor1', room: 1 },
    ])
  })

  it('never fires on the lobby floor or while riding a car carries the player (EVID-18)', () => {
    const sim = simWith([['ada', 'staff']])
    // Lobby: no rooms, no cues — even on the very first position tick.
    expect(sim.tick(positions(['ada', pos('lobby', LOBBY)]))).toEqual([])
    expect(sim.tick(positions(['ada', pos('lobby', 500)]))).toEqual([])
  })
})
