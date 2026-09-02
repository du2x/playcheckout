import type { FloorId, GuestFloorId, RoomIndex, SimEvent } from '@turnover/shared'
import { roomDoorXMilli } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { RoundSim } from './index.js'
import { MovementSim } from './movement.js'
import { FRESHNESS_TICKS, PREP_TICKS, UNPREP_TICKS } from './work.js'

/**
 * Cycle 3.3 (FR-29(b)/FR-30/FR-31): the trash-discovery complaint loop, the
 * guests-never-convict pin, the ambush kill check, and the 8-complaint
 * instant loss — staged through the real work channels (prep → un-prep) and
 * the real guest walk, so the channels' tick ordering against the guest
 * economy is under test.
 */

const IDS = ['p1', 'p2', 'p3', 'p4']

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

/** Positions map: everyone on the lobby floor, `at` in tiles (milli out). */
function lobbyPositions(at: Record<string, number>): Map<string, { floor: FloorId; x: number }> {
  const map = new Map<string, { floor: FloorId; x: number }>()
  for (const [id, x] of Object.entries(at)) map.set(id, { floor: 'lobby', x: Math.round(x * 1000) })
  return map
}

type Positions = Map<string, { floor: FloorId; x: number }>
type Assignment = { floor: GuestFloorId; room: RoomIndex }

interface Stage {
  movement: MovementSim
  sim: RoundSim
  positions: Positions
  carrier: string
  staff: string
  saboteur: string
  /** 0-based iteration cursor — resumed across helper calls. */
  t: number
}

function newStage(seed: number, totalTicks = 20000): Stage {
  const movement = new MovementSim()
  const sim = new RoundSim({
    seed,
    playerIds: IDS,
    movement: new PortAdapter(movement),
    totalTicks,
    guestTiming: {
      cadenceTicks: 20,
      impatienceTicks: 100000,
      dwellScale: 0.001,
      // The stagings hold suitcases across aging windows and multi-room
      // choreography — the 60 s §7 carry clock never fires here (its firing
      // path is pinned by the SUI-18 suites with their own timing).
      carryClockTicks: 1000000,
    },
  })
  const saboteur = sim.saboteurId
  const nonSaboteur = IDS.filter((id) => id !== saboteur)
  return {
    movement,
    sim,
    positions: lobbyPositions({ p1: 15, p2: 15, p3: 15, p4: 15 }),
    carrier: nonSaboteur[0] as string,
    staff: nonSaboteur[1] as string,
    saboteur,
    t: 0,
  }
}

/** One consumed tick: work.lastPositions picks up the current positions map
 *  before any intent that validates against it (startWork, suitcasePlace). */
function advanceOne(s: Stage): void {
  s.movement.tick()
  s.sim.tick(s.positions)
  s.t++
}

function of<T extends SimEvent['type']>(events: SimEvent[], type: T) {
  return events.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[]
}

function runUntil(
  s: Stage,
  max: number,
  probe: (events: SimEvent[]) => boolean,
  perTick?: (s: Stage, flushed: SimEvent[]) => void,
): { events: SimEvent[]; lastFlush: SimEvent[] } {
  const events: SimEvent[] = []
  let lastFlush: SimEvent[] = []
  // The cursor counts EVERY sim.tick (break included): after the loop,
  // s.t equals the round's NEXT tickIndex — replays align exactly.
  for (; s.t < max; ) {
    s.movement.tick()
    const flushed = [...s.sim.tick(s.positions)]
    s.t++
    events.push(...flushed)
    lastFlush = flushed
    perTick?.(s, flushed)
    if (probe(flushed)) break
  }
  return { events, lastFlush }
}

function waitArrival(s: Stage): void {
  runUntil(s, s.t + 2000, (events) => events.some((e) => e.type === 'guest:arrived'))
}

/** Check in the front queued guest; returns the announced assignment. */
function checkIn(s: Stage): Assignment {
  expect(s.sim.deskInteract(s.carrier)).toBe('accepted')
  const { events: announced } = runUntil(s, s.t + 5, (flush) =>
    flush.some((e) => e.type === 'guest:assigned'),
  )
  const assigned = of(announced, 'guest:assigned').at(-1)
  if (assigned === undefined) throw new Error('assignment not announced')
  return { floor: assigned.floor as GuestFloorId, room: assigned.room as RoomIndex }
}

/** Staff preps the room (prepped), leaves; saboteur un-preps (trashed), leaves. */
function trashRoom(s: Stage, a: Assignment): void {
  s.positions.set(s.staff, { floor: a.floor, x: roomDoorXMilli(a.room) })
  advanceOne(s)
  expect(s.sim.startWork(s.staff, a.floor, a.room)).toBe('accepted')
  const { events: prepped } = runUntil(s, s.t + PREP_TICKS + 10, (flush) =>
    flush.some(
      (e) => e.type === 'work:ended' && e.playerId === s.staff && e.outcome === 'completed',
    ),
  )
  expect(of(prepped, 'room:prepped').map((e) => e.room)).toContain(a.room)
  s.positions.set(s.staff, { floor: 'lobby', x: 15 * 1000 })
  s.positions.set(s.saboteur, { floor: a.floor, x: roomDoorXMilli(a.room) })
  advanceOne(s)
  expect(s.sim.startWork(s.saboteur, a.floor, a.room)).toBe('accepted')
  const { events: trashed } = runUntil(s, s.t + UNPREP_TICKS + 10, (flush) =>
    flush.some(
      (e) => e.type === 'work:ended' && e.playerId === s.saboteur && e.outcome === 'completed',
    ),
  )
  expect(of(trashed, 'room:trashed').map((e) => e.room)).toContain(a.room)
  s.positions.set(s.saboteur, { floor: 'lobby', x: 15 * 1000 })
}

/** The carrier places the suitcase at the room's door, then returns to the lobby. */
function deliver(s: Stage, a: Assignment, room: RoomIndex = a.room): void {
  s.positions.set(s.carrier, { floor: a.floor, x: roomDoorXMilli(room) })
  advanceOne(s)
  // The placement validates against the MOVEMENT layer's position (the
  // suitcase rides the carrier's position stream) — join the carrier there.
  s.movement.join(s.carrier, { floor: a.floor, xMilli: roomDoorXMilli(room) })
  expect(s.sim.suitcasePlace(s.carrier, room)).toBe('placed')
  s.positions.set(s.carrier, { floor: 'lobby', x: 15 * 1000 })
}

/**
 * One full discovery staging: check in the front guest, trash the assigned
 * room (prep → un-prep through the real channels), deliver the suitcase,
 * and wait for the walk-in. `duringWalk` observes every tick of the walk
 * (the flee trigger uses it). Returns the discovery events.
 */
function stageTrashAndDiscovery(
  s: Stage,
  opts: {
    ageTicks?: number
    duringWalk?: (s: Stage, flushed: SimEvent[]) => void
  } = {},
): {
  guestId: string
  assignment: Assignment
  angered: Extract<SimEvent, { type: 'guest:angered' }>
  discovered: Extract<SimEvent, { type: 'guest:discovered' }>
  events: SimEvent[]
  lastFlush: SimEvent[]
} {
  waitArrival(s)
  const assignment = checkIn(s)
  trashRoom(s, assignment)
  if (opts.ageTicks !== undefined) {
    for (let i = 0; i < opts.ageTicks; i++, s.t++) {
      s.movement.tick()
      s.sim.tick(s.positions)
    }
    expect(s.sim.roomState(assignment.floor, assignment.room)).toBe('settled')
  }
  deliver(s, assignment)
  const { events, lastFlush } = runUntil(
    s,
    s.t + 8000,
    (events) => events.some((e) => e.type === 'guest:discovered'),
    opts.duringWalk,
  )
  const angered = of(events, 'guest:angered').at(-1)
  const discovered = of(events, 'guest:discovered').at(-1)
  if (angered === undefined || discovered === undefined) throw new Error('discovery did not land')
  expect(angered.floor).toBe(assignment.floor)
  expect(angered.room).toBe(assignment.room)
  expect(discovered.guestId).toBe(angered.guestId)
  return { guestId: angered.guestId, assignment, angered, discovered, events, lastFlush }
}

// Spec COMP-01..09 (gate scenario sim:complaint): the two-stage discovery —
// in-world anger cue at the room, fuzzy-timestamp desk report at the desk,
// one complaint then the guest leaves, the teardown around it.
describe('sim:complaint', () => {
  it('fresh-tier trash: anger cue at the room, fresh report, guest leaves, nothing settles (COMP-01..05, COMP-09)', () => {
    const s = newStage(7)
    const before = s.sim.settledCount
    const { guestId, assignment, angered, discovered, events, lastFlush } =
      stageTrashAndDiscovery(s)

    // Stage 1: the cue is room-number level — guest, floor, room, nothing else.
    expect(angered).toEqual({
      type: 'guest:angered',
      guestId,
      floor: assignment.floor,
      room: assignment.room,
    })
    // Stage 2: the report carries the observed freshness tier (fresh trash).
    expect(discovered).toEqual({
      type: 'guest:discovered',
      guestId,
      floor: assignment.floor,
      room: assignment.room,
      fresh: true,
    })
    // The report and the departure share the flush — one complaint, no retry.
    expect(lastFlush).toEqual([
      {
        type: 'guest:discovered',
        guestId,
        floor: assignment.floor,
        room: assignment.room,
        fresh: true,
      },
      { type: 'guest:left', guestId },
    ])
    // The discovery replaces the settle: no score, and the room stays
    // trashed — "vacant but trashed" is the complaint's footprint.
    expect(s.sim.settledCount).toBe(before)
    expect(s.sim.roomState(assignment.floor, assignment.room)).toBe('trashed')
    // The absorbed suitcase left play (the dropCarry absorb precedent).
    expect(s.sim.restingSuitcases().some((r) => r.guestId === guestId)).toBe(false)
    // The reservation released: the room re-entered the vacancy pool
    // (white-box read — the GUEST-02 poke precedent; no public vacancy query
    // distinguishes reserved from tenanted).
    const reserved = (s.sim as unknown as { guests: { reserved: Set<string> } }).guests.reserved
    expect(reserved.has(`${assignment.floor}:${assignment.room}`)).toBe(false)
    // The wrong-delivery path never ran for this guest (COMP-09).
    expect(of(events, 'guest:complained')).toHaveLength(0)
  })

  it('aged trash past the freshness window reports fresh=false — churn bleeds the budget alike (COMP-08)', () => {
    const s = newStage(7)
    const { discovered } = stageTrashAndDiscovery(s, { ageTicks: FRESHNESS_TICKS + 5 })
    expect(discovered.fresh).toBe(false)
  })

  it('clean rooms settle exactly as before — pristine fresh and prepped alike (COMP-06)', () => {
    const s = newStage(7)
    const before = s.sim.settledCount
    // Pristine: deliver to the assignment without touching the room.
    waitArrival(s)
    const a = checkIn(s)
    deliver(s, a)
    const { events: settled } = runUntil(s, s.t + 8000, (events) =>
      events.some((e) => e.type === 'guest:settled'),
    )
    expect(of(settled, 'guest:settled').at(-1)).toMatchObject({ floor: a.floor, room: a.room })
    expect(of(settled, 'guest:angered')).toHaveLength(0)
    expect(of(settled, 'guest:discovered')).toHaveLength(0)
    expect(s.sim.settledCount).toBe(before + 1)
  })

  it('a guest entering mid-un-prep flees: fresh complaint, the channel still completes (COMP-07)', () => {
    const s = newStage(11)
    waitArrival(s)
    const a = checkIn(s)
    // Prep only: the un-prep starts (via the per-tick trigger) when the
    // guest is ~2 tiles from the door — the arrival lands mid-channel.
    s.positions.set(s.staff, { floor: a.floor, x: roomDoorXMilli(a.room) })
    advanceOne(s)
    expect(s.sim.startWork(s.staff, a.floor, a.room)).toBe('accepted')
    runUntil(s, s.t + PREP_TICKS + 10, (events) =>
      events.some(
        (e) => e.type === 'work:ended' && e.playerId === s.staff && e.outcome === 'completed',
      ),
    )
    s.positions.set(s.staff, { floor: 'lobby', x: 15 * 1000 })
    s.positions.set(s.saboteur, { floor: a.floor, x: roomDoorXMilli(a.room) })
    deliver(s, a)

    const doorX = roomDoorXMilli(a.room) / 1000
    let fled = false
    let trashedAfterFlee = false
    const { events: walkedInto } = runUntil(
      s,
      s.t + 8000,
      (events) => events.some((e) => e.type === 'guest:discovered'),
      (stage, flushed) => {
        if (!fled) {
          const walker = stage.movement
            .guestIds()
            .map((id) => stage.movement.positionOf(id))
            .find((p) => p !== undefined && p.floor === a.floor)
          if (walker !== undefined && Math.abs(walker.x - doorX) <= 2) {
            expect(stage.sim.startWork(stage.saboteur, a.floor, a.room)).toBe('accepted')
            fled = true
          }
        } else {
          // The storm-out precedes the completion: the room is still prepped
          // on the angered tick; room:trashed lands later (COMP-07's tail).
          if (flushed.some((e) => e.type === 'guest:angered')) {
            expect(flushed.some((e) => e.type === 'room:trashed')).toBe(false)
          }
          if (flushed.some((e) => e.type === 'room:trashed')) trashedAfterFlee = true
        }
      },
    )
    expect(fled).toBe(true)
    const angered = of(walkedInto, 'guest:angered').at(-1)
    expect(angered).toMatchObject({ floor: a.floor, room: a.room })
    expect(of(walkedInto, 'guest:discovered').at(-1)).toMatchObject({
      floor: a.floor,
      room: a.room,
      fresh: true,
    })
    expect(trashedAfterFlee).toBe(true)
    expect(s.sim.settledCount).toBe(0)
  })
})

// Spec COMP-17/18/19 (gate scenario sim:guest_never_convicts + the AD-040
// kill check): guest encounters are testimony, never justice, and an ambush
// never creates a complaint — it only enables one already set up.
describe('sim:guest_never_convicts', () => {
  it('a guest walking into an active un-prep never fires the saboteur (FR-30, COMP-17)', () => {
    const s = newStage(13)
    waitArrival(s)
    const a = checkIn(s)
    s.positions.set(s.staff, { floor: a.floor, x: roomDoorXMilli(a.room) })
    advanceOne(s)
    expect(s.sim.startWork(s.staff, a.floor, a.room)).toBe('accepted')
    runUntil(s, s.t + PREP_TICKS + 10, (events) =>
      events.some(
        (e) => e.type === 'work:ended' && e.playerId === s.staff && e.outcome === 'completed',
      ),
    )
    s.positions.set(s.staff, { floor: 'lobby', x: 15 * 1000 })
    s.positions.set(s.saboteur, { floor: a.floor, x: roomDoorXMilli(a.room) })
    deliver(s, a)
    const doorX = roomDoorXMilli(a.room) / 1000
    let fled = false
    const { events } = runUntil(
      s,
      s.t + 8000,
      (events) => events.some((e) => e.type === 'guest:discovered'),
      (stage) => {
        if (!fled) {
          const walker = stage.movement
            .guestIds()
            .map((id) => stage.movement.positionOf(id))
            .find((p) => p !== undefined && p.floor === a.floor)
          if (walker !== undefined && Math.abs(walker.x - doorX) <= 2) {
            expect(stage.sim.startWork(stage.saboteur, a.floor, a.room)).toBe('accepted')
            fled = true
          }
        }
      },
    )
    expect(fled).toBe(true)
    // The guest walked in on the act; the complaint path ran; nobody fired.
    expect(of(events, 'guest:angered')).toHaveLength(1)
    expect(of(events, 'player:fired')).toHaveLength(0)
    expect(s.sim.complaintCount).toBe(1)
  })

  it('an ambush changes nothing in the complaint stream — the kill check (COMP-18)', () => {
    // Differential pin: two identical rounds (same seed, same timing). Run B
    // adds a mid-round ambush — the saboteur passing live staff on the
    // stairs. The guest/complaint streams must be byte-identical: the
    // ambush's only wire surface is the private stun pair, and it never
    // creates a complaint. (The guest economy runs hot — impatience 40 —
    // so natural churn discoveries exercise the counter in BOTH runs.)
    const run = (
      withAmbush: boolean,
    ): { guest: SimEvent[]; complaints: number; ambushed: boolean } => {
      const movement = new MovementSim()
      const sim = new RoundSim({
        seed: 3,
        playerIds: IDS,
        movement: new PortAdapter(movement),
        guestTiming: {
          cadenceTicks: 20,
          impatienceTicks: 40,
          dwellScale: 0.001,
          carryClockTicks: 1000000,
        },
      })
      const positions = lobbyPositions({ p1: 15, p2: 15, p3: 15, p4: 15 })
      const saboteur = sim.saboteurId
      const victim = IDS.find((id) => id !== saboteur) as string
      let ambushed = false
      if (withAmbush) {
        movement.join(saboteur, { floor: 'floor1', xMilli: 0 })
        movement.join(victim, { floor: 'floor2', xMilli: 0 })
        movement.setAmbushAuthority({
          isSaboteur: (id) => id === saboteur,
          isLiveStaff: (id) => id === victim,
        })
        expect(movement.enterStairs(saboteur, 'up')).toBe('entered')
        expect(movement.enterStairs(victim, 'down')).toBe('entered')
      }
      const guest: SimEvent[] = []
      for (let t = 0; t < 4000; t++) {
        if (movement.tick().some((e) => e.type === 'stairs:ambushed')) ambushed = true
        for (const e of sim.tick(positions)) {
          if (e.type.startsWith('guest:')) guest.push(e)
        }
      }
      return { guest, complaints: sim.complaintCount, ambushed }
    }
    const calm = run(false)
    const ambushed = run(true)
    expect(ambushed.ambushed).toBe(true)
    // Both rounds run the same economy: complaints DO fire (churn discoveries)
    // — the ambush added not one of them and shifted no guest event.
    expect(calm.complaints).toBeGreaterThan(0)
    expect(ambushed.complaints).toBe(calm.complaints)
    expect(ambushed.guest).toEqual(calm.guest)
  })

  it('the ambush enables, never causes: with trash pre-laid, the complaint still fires (COMP-19)', () => {
    const s = newStage(5)
    waitArrival(s)
    const a = checkIn(s)
    trashRoom(s, a)
    deliver(s, a)
    // Mid-walk ambush: the saboteur passes the staff member on the stairs.
    s.movement.join(s.saboteur, { floor: 'floor1', xMilli: 0 })
    s.movement.join(s.staff, { floor: 'floor2', xMilli: 0 })
    s.movement.setAmbushAuthority({
      isSaboteur: (id) => id === s.saboteur,
      isLiveStaff: (id) => id === s.staff,
    })
    expect(s.movement.enterStairs(s.saboteur, 'up')).toBe('entered')
    expect(s.movement.enterStairs(s.staff, 'down')).toBe('entered')
    // The ambush fires on the first movement tick after both intents land.
    expect(s.movement.tick().some((e) => e.type === 'stairs:ambushed')).toBe(true)
    const { events } = runUntil(s, s.t + 8000, (flush) =>
      flush.some((e) => e.type === 'guest:discovered'),
    )
    const discoveries = of(events, 'guest:discovered')
    expect(discoveries).toHaveLength(1)
    expect(discoveries[0]).toMatchObject({ floor: a.floor, room: a.room, fresh: true })
    expect(s.sim.complaintCount).toBe(1)
  })
})

// Spec COMP-10..16 (gate scenario sim:budget_instant_loss): only trash
// discoveries count; the 8th is an instant staff loss in the same flush;
// the buzzer tie resolves to the budget; an interrupted angered walk dies
// with the round.
describe('sim:budget_instant_loss', () => {
  it('seven discoveries continue the round, a wrong delivery never counts, the 8th ends it saboteur/budget-exhausted (COMP-10..12)', () => {
    const s = newStage(17)
    for (let n = 1; n <= 7; n++) {
      const { discovered } = stageTrashAndDiscovery(s)
      expect(discovered.fresh).toBe(true)
      expect(s.sim.complaintCount).toBe(n)
      expect(s.sim.isEnded).toBe(false)
    }
    // A wrong-delivery door complaint fires its line and counts toward nothing.
    waitArrival(s)
    const a = checkIn(s)
    const other = ((a.room % 8) + 1) as RoomIndex
    deliver(s, a, other)
    const { events: wrongEvents } = runUntil(s, s.t + 8000, (events) =>
      events.some((e) => e.type === 'guest:complained'),
    )
    expect(of(wrongEvents, 'guest:complained')).toHaveLength(1)
    expect(s.sim.complaintCount).toBe(7) // the door complaint moved nothing
    expect(s.sim.isEnded).toBe(false)
    // The 8th trash discovery: the loss lands in the SAME flush as the
    // report — discovered, left, then the verdict, one flush.
    const eighth = stageTrashAndDiscovery(s)
    expect(eighth.lastFlush).toEqual([
      {
        type: 'guest:discovered',
        guestId: eighth.guestId,
        floor: eighth.assignment.floor,
        room: eighth.assignment.room,
        fresh: true,
      },
      { type: 'guest:left', guestId: eighth.guestId },
      {
        type: 'round:ended',
        winner: 'saboteur',
        reason: 'budget-exhausted',
        saboteurId: s.saboteur,
      },
    ])
    expect(s.sim.complaintCount).toBe(8)
  })

  it('the 8th complaint on the buzzer tick wins the tie — no buzzer verdict fires (COMP-15)', () => {
    // Pass 1: learn the 8th discovery's tick (deterministic per seed).
    const probe = newStage(19)
    let eighthTick = -1
    for (let n = 1; n <= 8; n++) {
      stageTrashAndDiscovery(probe)
      if (n === 8) eighthTick = probe.t
    }
    expect(eighthTick).toBeGreaterThan(0)
    // Pass 2: same seed, totalTicks lands the buzzer on the 8th discovery's
    // very tick (the cursor is the round's NEXT tickIndex after the report).
    const s = newStage(19, eighthTick)
    let lastFlush: SimEvent[] = []
    for (let n = 1; n <= 8; n++) lastFlush = stageTrashAndDiscovery(s).lastFlush
    expect(s.sim.complaintCount).toBe(8)
    expect(s.sim.isEnded).toBe(true)
    // The replay staged identically and the budget verdict won the tie: the
    // 8th discovery's flush carries report → left → budget loss, NO buzzer
    // (unrelated same-tick lifecycle events like a fresh arrival may ride
    // along; the buzzer verdict must not).
    expect(s.t).toBe(eighthTick)
    const kinds = lastFlush.map((e) => e.type)
    expect(kinds).toContain('guest:discovered')
    expect(kinds).toContain('guest:left')
    expect(kinds).toContain('round:ended')
    expect(kinds).not.toContain('round:buzzer')
    expect(kinds.indexOf('guest:discovered')).toBeLessThan(kinds.indexOf('round:ended'))
    expect(lastFlush.find((e) => e.type === 'round:ended')).toMatchObject({
      winner: 'saboteur',
      reason: 'budget-exhausted',
    })
  })

  it('a round ended mid-angered-walk freezes the count — no report from a dead round (COMP-16)', () => {
    const s = newStage(23)
    // One complete discovery: the count stands at 1.
    stageTrashAndDiscovery(s)
    expect(s.sim.complaintCount).toBe(1)
    // A second discovery reaches the storm-out — then the round ends before
    // the report: ghost two live staff (REND-02 path) mid-walk.
    waitArrival(s)
    const a = checkIn(s)
    trashRoom(s, a)
    deliver(s, a)
    runUntil(s, s.t + 8000, (events) => events.some((e) => e.type === 'guest:angered'))
    const others = IDS.filter((id) => id !== s.saboteur && id !== s.carrier)
    s.sim.ghost(others[0] as string)
    s.sim.ghost(others[1] as string)
    const { events } = runUntil(s, s.t + 200, (events) =>
      events.some((e) => e.type === 'round:ended'),
    )
    expect(of(events, 'round:ended').at(-1)).toMatchObject({
      winner: 'saboteur',
      reason: 'staff-reduced',
    })
    // The angered walk never reports: count frozen at its final value, and
    // no guest event of any kind follows the end (GUEST-11).
    expect(of(events, 'guest:discovered')).toHaveLength(0)
    expect(
      events
        .filter((e) => e.type.startsWith('guest:') && e.type !== 'guest:angered')
        .find((e) => events.indexOf(e) > events.findIndex((x) => x.type === 'round:ended')),
    ).toBeUndefined()
    expect(s.sim.complaintCount).toBe(1)
  })
})
