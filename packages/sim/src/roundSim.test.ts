import { type FloorId, type GuestFloorId, type SimEvent, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { RoundSim, TICK_HZ } from './index.js'
import { MovementSim } from './movement.js'
import { FRESHNESS_TICKS, PREP_TICKS, UNPREP_TICKS } from './work.js'

// Tuning cited: TUNING.SHIFT_SECONDS (300 s) × TICK_HZ (20) = 6000 ticks (prd §7, §11).
const IDS = ['p1', 'p2', 'p3', 'p4']

function runFullRound(seed: number, playerIds: string[]): SimEvent[] {
  const sim = new RoundSim({ seed, playerIds })
  const events: SimEvent[] = []
  for (let t = 0; t < RoundSim.TOTAL_TICKS; t++) events.push(...sim.tick())
  return events
}

// Gate scenario `sim:role_deal` — spec DEAL-01, DEAL-06, CLK-01..04.
describe('sim:role_deal', () => {
  it('emits round:started and one private role:dealt per player on the first tick', () => {
    const sim = new RoundSim({ seed: 1234, playerIds: IDS })
    const first = sim.tick()
    expect(first[0]).toEqual({ type: 'round:started', playerIds: IDS })
    const dealt = first.filter((e) => e.type === 'role:dealt')
    expect(dealt).toHaveLength(IDS.length)
    const saboteurs = dealt.filter((e) => e.type === 'role:dealt' && e.role === 'saboteur')
    expect(saboteurs).toHaveLength(1)
  })

  it('yields exactly one saboteur across 1000 seeds (DEAL-01)', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const sim = new RoundSim({ seed, playerIds: IDS })
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
    const sim = new RoundSim({ seed: 1, playerIds: IDS })
    expect(sim.clockTicksRemaining).toBe(TUNING.SHIFT_SECONDS * TICK_HZ)
    expect(RoundSim.TOTAL_TICKS).toBe(6000)
  })

  it('decrements the clock by exactly one tick per tick (CLK-02: 0.05 s per tick)', () => {
    const sim = new RoundSim({ seed: 1, playerIds: IDS })
    sim.tick()
    expect(sim.clockTicksRemaining).toBe(5999)
    sim.tick()
    expect(sim.clockTicksRemaining).toBe(5998)
  })

  it('fires the buzzer at exactly tick 6000 and never again (CLK-03)', () => {
    const events = runFullRound(42, IDS)
    const buzzers = events.filter((e) => e.type === 'round:buzzer')
    expect(buzzers).toHaveLength(1)
    const sim = new RoundSim({ seed: 42, playerIds: IDS })
    for (let t = 1; t < RoundSim.TOTAL_TICKS; t++) sim.tick()
    const last = sim.tick()
    // Cycle 2.9: the buzzer flush now carries the coverage verdict right
    // after the buzzer (zero preps by default → saboteur win, coverage-failed).
    expect(last).toEqual([
      { type: 'round:buzzer' },
      {
        type: 'round:ended',
        winner: 'saboteur',
        reason: 'coverage-failed',
        saboteurId: expect.any(String),
      },
    ])
  })

  it('emits nothing from ticks past the buzzer', () => {
    const sim = new RoundSim({ seed: 42, playerIds: IDS })
    for (let t = 0; t < RoundSim.TOTAL_TICKS; t++) sim.tick()
    expect(sim.clockTicksRemaining).toBe(0)
    expect(sim.tick()).toEqual([])
  })

  it('rejects deal sizes outside 4-6 players (TUNING.PLAYERS_MIN/MAX)', () => {
    expect(() => new RoundSim({ seed: 1, playerIds: ['p1', 'p2', 'p3'] })).toThrow()
    expect(
      () => new RoundSim({ seed: 1, playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'] }),
    ).toThrow()
  })
})

// AD-004 test seam: an optional shift-length override exists ONLY so gate-3
// harness rounds can reach a real buzzer quickly. The §7 default is unchanged
// (asserted by the CLK tests above); production never passes the override.
describe('sim:shift_override (AD-004 test seam)', () => {
  it('fires the buzzer at exactly the overridden tick count and never before', () => {
    const sim = new RoundSim({ seed: 42, playerIds: IDS, totalTicks: 100 })
    for (let t = 1; t < 100; t++) {
      expect(sim.tick().filter((e) => e.type === 'round:buzzer')).toHaveLength(0)
    }
    // Cycle 2.9: the buzzer flush carries the coverage verdict after the buzzer.
    const last = sim.tick()
    expect(last.map((e) => e.type)).toEqual(['round:buzzer', 'round:ended'])
    expect(sim.clockTicksRemaining).toBe(0)
    expect(sim.tick()).toEqual([])
  })

  it('maps a 1-second override to 20 ticks (TICK_HZ)', () => {
    const sim = new RoundSim({ seed: 1, playerIds: IDS, totalTicks: TICK_HZ })
    expect(sim.clockTicksRemaining).toBe(TICK_HZ)
  })

  it('rejects non-positive or non-integer overrides', () => {
    expect(() => new RoundSim({ seed: 1, playerIds: IDS, totalTicks: 0 })).toThrow()
    expect(() => new RoundSim({ seed: 1, playerIds: IDS, totalTicks: -5 })).toThrow()
    expect(() => new RoundSim({ seed: 1, playerIds: IDS, totalTicks: 2.5 })).toThrow()
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

// ---------------------------------------------------------------------------
// Gate scenario `sim:win_checks` (cycle 2.9, REND-01..05): the three §6.6
// paths — saboteur fired, staff reduced, buzzer coverage — plus the journal.
// Positions are integer millitiles; room r on a guest floor spans
// [1000 + 3500(r-1), +3500) (AD-010).
// ---------------------------------------------------------------------------
const roomX = (room: number): number => 1000 + 3500 * (room - 1) + 100

describe('sim:win_checks', () => {
  /** A dealt round + a per-tick position feeder. */
  function dealtRound(seed = 1, totalTicks?: number) {
    const sim = new RoundSim({
      seed,
      playerIds: IDS,
      ...(totalTicks === undefined ? {} : { totalTicks }),
    })
    const first = sim.tick()
    const dealt = first.filter((e) => e.type === 'role:dealt')
    const saboteur = dealt.find((e) => e.type === 'role:dealt' && e.role === 'saboteur')?.playerId
    if (saboteur === undefined) throw new Error('no saboteur dealt')
    const staff = IDS.filter((id) => id !== saboteur)
    const feed = (placement: Map<string, { floor: GuestFloorId | 'lobby'; x: number }>) =>
      sim.tick(placement)
    return { sim, saboteur, staff, feed }
  }

  /** Prep one room by one staff member and return the ticks consumed. */
  function prepRoom(
    sim: RoundSim,
    worker: string,
    floor: GuestFloorId,
    room: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    placement: Map<string, { floor: GuestFloorId | 'lobby'; x: number }>,
  ): number {
    placement.set(worker, { floor, x: roomX(room) })
    void sim.tick(placement)
    expect(sim.startWork(worker, floor, room)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) void sim.tick(placement)
    return PREP_TICKS + 1
  }

  it('walk-in conviction ends the round: staff win on the same flush as the firing (REND-01)', () => {
    const { sim, saboteur, staff, feed } = dealtRound()
    const [prepper, catcher] = staff as [string, string]
    const placement = new Map([
      [prepper, { floor: 'floor1' as const, x: roomX(1) }],
      [saboteur, { floor: 'lobby' as const, x: 15000 }],
      [catcher, { floor: 'lobby' as const, x: 15000 }],
    ])
    void feed(placement)
    expect(sim.startWork(prepper, 'floor1', 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) void feed(placement)
    // Saboteur un-preps the now-prepped room; the catcher walks in mid-channel.
    placement.set(saboteur, { floor: 'floor1', x: roomX(1) })
    void feed(placement)
    expect(sim.startWork(saboteur, 'floor1', 1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS - 2; i++) void feed(placement)
    placement.set(catcher, { floor: 'floor1', x: roomX(1) })
    const flush = feed(placement)
    // Same flush: the firing first, then the verdict — exactly once. The
    // entrant's room:entered/observed cues may precede them in this flush.
    expect(flush.slice(-2).map((e) => e.type)).toEqual(['player:fired', 'round:ended'])
    expect(flush.at(-1)).toEqual({
      type: 'round:ended',
      winner: 'staff',
      reason: 'saboteur-fired',
      saboteurId: saboteur,
    })
    // The round is over: silence afterwards, intents rejected.
    expect(sim.tick(placement)).toEqual([])
    expect(sim.accuse(prepper, saboteur)).toBe('round-not-active')
    // The catch is journaled.
    const catches = sim.recapEntries().filter((e) => e.kind === 'catch')
    expect(catches).toEqual([
      { kind: 'catch', tick: expect.any(Number), entrantId: catcher, saboteurId: saboteur },
    ])
  })

  it('a wrong-accusation cascade down to one staff ends the round for the saboteur (REND-02)', () => {
    const { sim, saboteur, staff, feed } = dealtRound()
    const [a, b, c] = staff as [string, string, string]
    const placement = new Map(IDS.map((id) => [id, { floor: 'floor1' as const, x: roomX(1) }]))
    void feed(placement)
    // Everyone co-located in room 1's segment: every accusation is in range.
    expect(sim.accuse(a, b)).toBe('resolved') // wrong → accuser a fired
    let flush = feed(placement)
    expect(flush.map((e) => e.type)).toEqual(['player:fired'])
    expect(sim.accuse(c, b)).toBe('resolved') // wrong → accuser c fired
    flush = feed(placement)
    // Staff live count dropped to 1 → the verdict joins the same flush.
    expect(flush.map((e) => e.type)).toEqual(['player:fired', 'round:ended'])
    expect(flush[1]).toMatchObject({
      winner: 'saboteur',
      reason: 'staff-reduced',
      saboteurId: saboteur,
    })
    // Exactly two accusations journaled, both wrong.
    const accusations = sim.recapEntries().filter((e) => e.kind === 'accusation')
    expect(accusations).toHaveLength(2)
    for (const entry of accusations) {
      if (entry.kind !== 'accusation') continue
      expect(entry.correct).toBe(false)
      expect(entry.targetId).toBe(b)
    }
  })

  it('staff ghosted down to one ends the round for the saboteur — silently (REND-02 + FR-25)', () => {
    const { sim, saboteur, staff, feed } = dealtRound()
    const placement = new Map([[saboteur, { floor: 'lobby' as const, x: 15000 }]])
    void feed(placement)
    const [a, b] = staff as [string, string]
    sim.ghost(a)
    expect(sim.tick(new Map()).length).toBe(0) // no win yet, no events
    sim.ghost(b)
    // The queued win check flushes on the next tick — no player:fired ever.
    const flush = sim.tick(new Map())
    expect(flush).toHaveLength(1)
    expect(flush[0]).toMatchObject({
      type: 'round:ended',
      winner: 'saboteur',
      reason: 'staff-reduced',
    })
    // Ghosts leave no journal trace and cannot be accused targets.
    expect(sim.recapEntries()).toEqual([])
    expect(sim.accuse(saboteur, b)).toBe('round-not-active')
  })

  it('buzzer with zero preps: buzzer first, then coverage-failed saboteur win, same flush (REND-03)', () => {
    const { sim, saboteur } = dealtRound(1, 20)
    const events: SimEvent[] = []
    for (let t = 0; t < 20; t++) events.push(...sim.tick(new Map()))
    expect(events.at(-2)).toEqual({ type: 'round:buzzer' })
    expect(events.at(-1)).toEqual({
      type: 'round:ended',
      winner: 'saboteur',
      reason: 'coverage-failed',
      saboteurId: saboteur,
    })
    expect(events.filter((e) => e.type === 'round:ended')).toHaveLength(1)
  })

  it('buzzer with ≥80% coverage: staff win, coverage-met (REND-03)', () => {
    const { sim, saboteur, staff } = dealtRound(1, 2300)
    const placement = new Map([[saboteur, { floor: 'lobby' as const, x: 15000 }]])
    // Three staff sequentially prep 20 of the 24 rooms (7+7+6) — the first 20
    // rooms in deterministic order: floor1 1..8, floor2 1..8, floor3 1..4.
    const allRooms: [GuestFloorId, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8][] = []
    for (const floor of ['floor1', 'floor2', 'floor3'] as const) {
      for (
        let room = 1 as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
        room <= 8;
        room = (room + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
      ) {
        if (allRooms.length < 20) allRooms.push([floor, room])
      }
    }
    const plan = allRooms.map(([floor, room], index) => {
      const worker = staff[Math.floor(index / 7)] ?? staff[0]
      return [worker as string, floor, room] as [
        string,
        GuestFloorId,
        1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
      ]
    })
    for (const [worker, floor, target] of plan) {
      prepRoom(sim, worker, floor, target, placement)
    }
    // Run the shift to the buzzer, collecting events.
    const events: SimEvent[] = []
    while (sim.clockTicksRemaining > 0) events.push(...sim.tick(placement))
    expect(events.map((e) => e.type)).toEqual(['round:buzzer', 'round:ended'])
    expect(events[1]).toMatchObject({ winner: 'staff', reason: 'coverage-met' })
  })

  it('journals a crime per trash with freshness resolved at recap time (REND-08)', () => {
    const { sim, saboteur, staff, feed } = dealtRound()
    const [prepper] = staff as [string]
    const placement = new Map([
      [prepper, { floor: 'floor1' as const, x: roomX(2) }],
      [saboteur, { floor: 'floor1' as const, x: roomX(2) }],
    ])
    void feed(placement)
    expect(sim.startWork(prepper, 'floor1', 2)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) void feed(placement)
    expect(sim.startWork(saboteur, 'floor1', 2)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS; i++) void feed(placement)
    // The trash completed: one fresh crime entry (evidence inside the window).
    let crimes = sim.recapEntries().filter((e) => e.kind === 'crime')
    expect(crimes).toEqual([
      { kind: 'crime', tick: expect.any(Number), floor: 'floor1', room: 2, fresh: true },
    ])
    // Age past the freshness window: the recap now reads fresh: false.
    for (let i = 0; i < FRESHNESS_TICKS; i++) void feed(placement)
    crimes = sim.recapEntries().filter((e) => e.kind === 'crime')
    expect(crimes).toHaveLength(1)
    if (crimes[0]?.kind !== 'crime') throw new Error('entry kind')
    expect(crimes[0].fresh).toBe(false)
  })
})

// --- Cycle 3.1 (GUEST-01..09, AD-028): the guest economy inside the round —
// churn lands as settled room state; guests are round-scoped. Uses the same
// production-shaped port adapter the room builds.
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
  positionOf(id: string) {
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

describe('sim:checkout_churn (round integration)', () => {
  it('a checked-out guest leaves their room settled — never sabotage-shaped', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 7,
      playerIds: IDS,
      movement: new PortAdapter(movement),
      // Test timing (AD-028 seam): full lifecycles fit a short scripted run.
      guestTiming: { cadenceTicks: 10, impatienceTicks: 10, dwellScale: 0.001 },
    })
    let checkedOut: { floor: FloorId; room: number } | null = null
    for (let t = 0; t < 4000 && checkedOut === null; t++) {
      movement.tick()
      for (const e of sim.tick()) {
        if (e.type === 'guest:checked_out') checkedOut = { floor: e.floor, room: e.room }
      }
    }
    if (checkedOut === null) throw new Error('no guest checkout within 4000 ticks')
    // The churned room is `settled`: re-trashed by churn, never fresh
    // sabotage (no room:trashed event exists for it), excluded from coverage.
    const state = sim.roomState(checkedOut.floor as GuestFloorId, checkedOut.room as 1)
    expect(state).toBe('settled')
  })

  it('guest events never survive the round end (GUEST-11)', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 7,
      playerIds: IDS,
      movement: new PortAdapter(movement),
      guestTiming: { cadenceTicks: 10, impatienceTicks: 10, dwellScale: 0.001 },
    })
    let endedAt = -1
    let guestEventsAfterEnd = 0
    for (let t = 0; t < RoundSim.TOTAL_TICKS + 10; t++) {
      movement.tick()
      const events = sim.tick()
      for (const e of events) {
        if (e.type === 'round:ended') endedAt = t
        if (endedAt >= 0 && e.type.startsWith('guest:')) guestEventsAfterEnd++
      }
    }
    expect(endedAt).toBeGreaterThanOrEqual(0)
    expect(guestEventsAfterEnd).toBe(0)
  })
})

// --- Suitcase transport (cycle 3.B, AD-032): the RoundSim desk + carry APIs.

/** Positions map: everyone on the lobby floor, `at` in tiles (milli out). */
function lobbyPositions(at: Record<string, number>): Map<string, { floor: FloorId; x: number }> {
  const map = new Map<string, { floor: FloorId; x: number }>()
  for (const [id, x] of Object.entries(at)) map.set(id, { floor: 'lobby', x: Math.round(x * 1000) })
  return map
}

/** Drive one round to the first guest arrival, returning the tick cursor. */
function runToArrival(
  movement: MovementSim,
  sim: RoundSim,
  positions: Map<string, { floor: FloorId; x: number }>,
): number {
  sim.tick(positions) // starts the round
  let arrived = false
  let t = 1
  for (; t < 200 && !arrived; t++) {
    movement.tick()
    arrived = sim.tick(positions).some((e) => e.type === 'guest:arrived')
  }
  expect(arrived).toBe(true)
  return t
}

describe('sim:suitcase_carry (round integration)', () => {
  it('check-in through the round sim flushes the assignment overhear + carried next tick (SUI-01/03)', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 7,
      playerIds: IDS,
      movement: new PortAdapter(movement),
      guestTiming: { cadenceTicks: 20, impatienceTicks: 100000, dwellScale: 0.001 },
    })
    const positions = lobbyPositions({ p1: 15, p2: 15, p3: 15, p4: 15 })
    const t = runToArrival(movement, sim, positions)
    expect(sim.deskInteract('p1')).toBe('accepted')
    // MOVE-10 announce pattern: the overheard assignment + handoff flush next.
    const flushed = sim.tick(positions)
    const overheard = flushed.find((e) => e.type === 'assignment:overheard')
    if (overheard === undefined || overheard.type !== 'assignment:overheard') {
      throw new Error('missing assignment:overheard')
    }
    expect(overheard.guestId).toBe('guest:1')
    expect(flushed).toContainEqual({
      type: 'suitcase:carried',
      guestId: 'guest:1',
      carrierId: 'p1',
    } satisfies SimEvent)
    void t
  })

  it('E outside the desk zone or before the round is rejected silently (SUI-01 zone)', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 7,
      playerIds: IDS,
      movement: new PortAdapter(movement),
      guestTiming: { cadenceTicks: 20, impatienceTicks: 100000, dwellScale: 0.001 },
    })
    expect(sim.deskInteract('p1')).toBe('rejected') // round not started
    sim.tick(lobbyPositions({ p1: 15, p2: 22, p3: 15, p4: 15 }))
    expect(sim.deskInteract('p2')).toBe('rejected') // 7 tiles from the desk
    expect(sim.deskInteract('p1')).toBe('rejected') // queue empty — silent
  })

  it('carrying blocks work starts through the round sim (SUI-11, FR-9a)', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 7,
      playerIds: IDS,
      movement: new PortAdapter(movement),
      guestTiming: { cadenceTicks: 20, impatienceTicks: 100000, dwellScale: 0.001 },
    })
    const positions = lobbyPositions({ p1: 15, p2: 22, p3: 15, p4: 15 })
    runToArrival(movement, sim, positions)
    expect(sim.deskInteract('p1')).toBe('accepted')
    // Carrying is hands-full: the START is rejected before any room work
    // validation. (Accusation/escalator paths are untouched — separate code.)
    expect(sim.startWork('p1', 'floor1', 1)).toBe('carrying')
    // Dropping the carry (teardown path) unblocks work.
    sim.ghost('p1')
    void positions
  })

  it('a ghosted carrier loses the suitcase; the re-queued guest is checked in by the next player (SUI-20 teardown path)', () => {
    const movement = new MovementSim()
    const sim = new RoundSim({
      seed: 7,
      playerIds: IDS,
      movement: new PortAdapter(movement),
      guestTiming: { cadenceTicks: 20, impatienceTicks: 100000, dwellScale: 0.001 },
    })
    const positions = lobbyPositions({ p1: 15, p2: 15, p3: 15, p4: 15 })
    runToArrival(movement, sim, positions)
    expect(sim.deskInteract('p1')).toBe('accepted')
    sim.ghost('p1')
    // The guest is back in the queue front with the assignment void: p2 at
    // the desk checks them in again (a fresh assignment re-seeds).
    expect(sim.deskInteract('p2')).toBe('accepted')
  })
})
