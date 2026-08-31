import type { FloorId, MovementEvent } from '@turnover/shared'
import { HALL_LENGTH_TILES, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import {
  DOOR_TICKS,
  DWELL_TICKS,
  MovementSim,
  RIDE_TICKS_PER_FLOOR,
  SPEED_MILLI_PER_TICK,
} from './movement.js'
import { TICK_HZ } from './tick.js'

function movedEvents(events: readonly MovementEvent[]) {
  return events.filter((e) => e.type === 'player:moved')
}

function lastX(sim: MovementSim, playerId: string): number {
  return sim.positionOf(playerId)?.x ?? Number.NaN
}

/**
 * Car events, with the AD-027 door-state events filtered out — the swing
 * announcements ride every open/close and are pinned separately in the
 * `sim:elevator_doors` describe; the flow tests assert the rest.
 */
function carEvents(events: readonly MovementEvent[]) {
  return events.filter((e) => e.type !== 'player:moved' && e.type !== 'elevator:doors')
}

/**
 * Walk a player from the lobby center to a PARKED car's landing and board it
 * with the landing call press (AD-025: proximity auto-boarding is disabled —
 * the call press at a parked car's landing IS the boarding action). AD-026:
 * the parked doors are shut, so the press swings them open (0.5 s) and the
 * board lands the tick they finish opening. Ends after the boarding's
 * next-tick event flush.
 */
function boardParkedCar(sim: MovementSim, playerId: string, carId: 1 | 2): void {
  sim.startMove(playerId, carId === 1 ? 'left' : 'right')
  for (let i = 0; i < 100 && lastX(sim, playerId) !== (carId === 1 ? 0 : HALL_LENGTH_TILES); i++) {
    sim.tick()
  }
  sim.stopMove(playerId)
  expect(lastX(sim, playerId)).toBe(carId === 1 ? 0 : HALL_LENGTH_TILES)
  expect(sim.callElevator(playerId)).toBe('ignored') // parked-car press: boards
  // The doors swing open for DOOR_TICKS before the board lands (AD-026).
  for (let i = 0; i <= DOOR_TICKS && sim.viewOf(playerId).car === null; i++) sim.tick()
  expect(sim.viewOf(playerId).car).toBe(carId)
  // Consume the boarding + flash + reopen events that flush on the next tick
  // (full payload pins live in the ELR P1 describe below).
  sim.tick()
}

/** Tick until an `elevator:called` flash announces (skipping door events); null on timeout. */
function huntFlash(sim: MovementSim, max = 90): readonly MovementEvent[] | null {
  for (let i = 0; i < max; i++) {
    const events = carEvents(sim.tick())
    if (events.some((e) => e.type === 'elevator:called')) return events
  }
  return null
}

/** Tick until the car reports a moved event for `floor`; returns the tick offset. */
function runUntilCarMoved(sim: MovementSim, car: 1 | 2, floor: FloorId, max = 400): number {
  for (let i = 1; i <= max; i++) {
    const hit = carEvents(sim.tick()).some(
      (e) => e.type === 'elevator:moved' && e.car === car && e.floor === floor,
    )
    if (hit) return i
  }
  return -1
}

// Spec MOVE-01..05, MOVE-07/08 (gate scenario sim:motion): scripted intents over
// the pure movement sim. Integration is exact integer millitiles — bit-for-bit.
describe('sim:motion', () => {
  it('integrates at exactly 6 tiles/s: 20 ticks displace 6.0 tiles (MOVE-01)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'right')
    const events = []
    for (let i = 0; i < 20; i++) events.push(...sim.tick())
    expect(lastX(sim, 'p1')).toBe(21) // join center 15 + 6
    const moved = movedEvents(events)
    expect(moved).toHaveLength(20)
    expect(moved[0]).toMatchObject({
      type: 'player:moved',
      playerId: 'p1',
      x: 15.3,
      facing: 'right',
    })
    expect(moved[19]).toMatchObject({ x: 21, floor: 'lobby' })
  })

  it('replays bit-for-bit across two runs (spec success criterion)', () => {
    const run = () => {
      const sim = new MovementSim()
      sim.join('p1')
      sim.join('p2')
      sim.startMove('p1', 'right')
      sim.startMove('p2', 'left')
      const trace: string[] = []
      for (let i = 0; i < 120; i++) {
        if (i === 40) {
          sim.stopMove('p1')
          sim.stopMove('p2')
        }
        if (i === 80) sim.startMove('p1', 'left')
        trace.push(JSON.stringify(sim.tick()))
      }
      return trace.join('\n')
    }
    expect(run()).toBe(run())
  })

  it('stops on release at the current x and emits a terminal event (MOVE-02, MOVE-03)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick()
    const xAtStop = lastX(sim, 'p1')
    sim.stopMove('p1')
    // Terminal event carries the authoritative rest x so the moving client
    // reconciles its local prediction (which overshoots past the last stream
    // event by up to a frame+latency of uncorrected drift).
    expect(sim.tick()).toEqual([
      expect.objectContaining({ type: 'player:moved', playerId: 'p1', x: xAtStop }),
    ])
    for (let i = 0; i < 5; i++) expect(sim.tick()).toEqual([])
    expect(lastX(sim, 'p1')).toBe(xAtStop)
  })

  it('broadcasts nothing on idle ticks (MOVE-03)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    for (let i = 0; i < 10; i++) expect(sim.tick()).toEqual([])
  })

  it('flips facing on direction change even when x cannot change (MOVE-01)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // Evacuate the west landing first: p2 boards the parked car and rides to
    // floor1 (a parked open-doors car auto-boards anyone walking into range).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    // Press during the stop's dwell: the surviving dwell + closing swing
    // (AD-026) precede the ride — the boarding flush tick ate one dwell tick.
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    // Walk to the west wall — car 1 no longer parks there.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 60; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(0)
    // Face left→right while pinned at the wall: no x change, facing still flips.
    expect(sim.positionOf('p1')?.facing).toBe('left')
    sim.startMove('p1', 'right')
    sim.stopMove('p1')
    const flip = movedEvents(sim.tick())
    expect(flip).toHaveLength(1)
    expect(flip[0]).toMatchObject({ facing: 'right', x: 0 })
  })

  it('clamps x to the hall bounds 0..HALL_LENGTH_TILES (MOVE-04)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Park both cars on guest floors so both landings are free to walk past.
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(
      DWELL_TICKS + DOOR_TICKS + 3 * RIDE_TICKS_PER_FLOOR - 1,
    )
    sim.startMove('p1', 'left')
    for (let i = 0; i < 100; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(0)
    sim.startMove('p1', 'right')
    for (let i = 0; i < 200; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(HALL_LENGTH_TILES)
    expect(HALL_LENGTH_TILES).toBe(30)
    expect(TUNING.PLAYER_SPEED_TILES_PER_SEC).toBe(6)
    expect(SPEED_MILLI_PER_TICK).toBe(300)
  })

  it('emits nothing while a player is pinned at a wall with the intent held (WORK-21, M5b)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    sim.startMove('p1', 'left')
    for (let i = 0; i < 100; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(0)
    // Intent still held, facing already 'left', x cannot change: the sim must
    // stay silent — a pinned player emits no player:moved (MOVE-03's letter).
    sim.startMove('p1', 'left')
    for (let i = 0; i < 5; i++) expect(sim.tick()).toEqual([])
    expect(lastX(sim, 'p1')).toBe(0)
  })

  it('lets a player walk on floor1 during an active round (MOVE-06 positive half, WORK-22)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the west landing
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('ignored') // parked-car press: doors open (AD-026)
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p1').car === null; i++) sim.tick()
    expect(sim.viewOf('p1').car).toBe(1)
    sim.tick() // flush the boarding events
    // In-car destination choice: press floor1 and ride (AD-014 press queue).
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    // Exit through the open doors during the dwell: hold a direction.
    sim.startMove('p1', 'right')
    const exitTick = movedEvents(sim.tick())
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    expect(exitTick.some((e) => e.type === 'player:moved' && e.playerId === 'p1')).toBe(true)
    for (let i = 0; i < 9; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(3) // 10 walk ticks × 300 millitiles = 3.0 tiles
  })

  it('lets two players pass through each other and broadcasts both (MOVE-05)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // Park p2 three tiles east of p1, then walk p1 right and p2 left.
    sim.startMove('p2', 'right')
    for (let i = 0; i < 10; i++) sim.tick()
    sim.stopMove('p2')
    const p2x = lastX(sim, 'p2')
    sim.startMove('p1', 'right')
    sim.startMove('p2', 'left')
    let crossed = 0
    for (let i = 0; i < 30; i++) {
      const events = movedEvents(sim.tick())
      const p1 = events.find((e) => e.type === 'player:moved' && e.playerId === 'p1')
      const p2 = events.find((e) => e.type === 'player:moved' && e.playerId === 'p2')
      if (p1?.x !== undefined && p2?.x !== undefined && p1.x > p2.x) crossed++
    }
    expect(crossed).toBeGreaterThan(0)
    expect(lastX(sim, 'p1')).toBeGreaterThan(p2x)
    expect(lastX(sim, 'p2')).toBeLessThan(p2x)
  })

  it('keeps the floor on lobby at join and runs identically across phases (MOVE-04)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick()
    expect(sim.positionOf('p1')?.floor).toBe('lobby')
    const xBefore = lastX(sim, 'p1')

    // The movement layer is phase-free (AD-005 amendment): intents continue
    // uninterrupted and positions never reset.
    const events = movedEvents(sim.tick())
    expect(lastX(sim, 'p1')).toBe(xBefore + 0.3)
    expect(events[0]).toMatchObject({ playerId: 'p1', floor: 'lobby' })

    sim.startMove('p1', 'left')
    const xAtLock = lastX(sim, 'p1')
    sim.tick()
    expect(lastX(sim, 'p1')).toBe(xAtLock - 0.3)
  })

  it('allows walking on guest floors in lobby phase (AD-015)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    // Ride the west car to floor1 pre-round, exit, and stop near the landing.
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'right')
    sim.tick()
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    sim.stopMove('p1')
    sim.tick()
    const xStart = lastX(sim, 'p1')
    // Lobby phase: walking on floor1 is now allowed.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick()
    sim.stopMove('p1')
    expect(lastX(sim, 'p1')).toBe(xStart + 3)
  })

  it('treats duplicate start and stray stop as no-ops (spec edges)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'right')
    sim.startMove('p1', 'right')
    for (let i = 0; i < 3; i++) sim.tick()
    // One moving player: exactly one event per tick despite the double start.
    expect(movedEvents(sim.tick())).toHaveLength(1)
    sim.stopMove('p1')
    sim.stopMove('p1')
    // Stray stop is a no-op: exactly one terminal event, not two.
    expect(sim.tick()).toEqual([expect.objectContaining({ type: 'player:moved', playerId: 'p1' })])
  })
})

// WORK-18 (AD-008/AD-009): snapshots are filtered to the viewer's floor; the
// Router view context puts riders outside any floor stream (WORK-17).
describe('movement visibility (AD-008)', () => {
  it('snapshotForFloor keeps only the viewer-floor players and both cars (WORK-18)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    expect(
      sim
        .snapshotForFloor('lobby')
        .players.map((p) => p.playerId)
        .sort(),
    ).toEqual(['p1', 'p2'])
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'lobby' },
    ])
    expect(sim.snapshotForFloor('floor1').players).toEqual([])
    expect(sim.snapshotForFloor('floor1').cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('viewOf: lobby player gets no roomKey, riders get no floor, segments map to keys', () => {
    const sim = new MovementSim()
    sim.join('p1')
    // Lobby center is outside every segment (lobby floor has none).
    expect(sim.viewOf('p1')).toEqual({ floor: 'lobby', roomKey: null, car: null, x: 15000 })

    // Board the parked west car with the landing call press: the rider
    // context loses its floor while in the car (AD-008) and names the ride
    // (AD-013).
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the landing
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('ignored') // parked-car press: doors open (AD-026)
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p1').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p1')).toEqual({ floor: null, roomKey: null, car: 1, x: null })

    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    // Press during the just-opened stop: surviving dwell + closing swing
    // (AD-026) precede the ride; the boarding flush tick ate one dwell tick.
    for (let i = 0; i < DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1; i++) sim.tick()
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'right') // exit through the open doors at the stop
    expect(sim.positionOf('p1')?.floor).toBe('floor1')

    // Exited riders stand at the landing x=0 — outside every segment (AD-010).
    expect(sim.viewOf('p1')).toEqual({ floor: 'floor1', roomKey: null, car: null, x: 0 })
  })
})

// Spec MOVE-09..18 + ELR P2/P3 (gate scenario sim:elevator): the press-queue
// car machine over the pure sim. Ticks are the only clock: arrival = 60 ticks,
// ride = 40/floor, dwell = 20 ticks at EVERY stop. Calls carry no destination;
// the destination is an in-car press (AD-014).
describe('sim:elevator_doors (AD-027 public door state)', () => {
  it('announces doors-open at every opening swing and doors-close only into a departure', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 100 && sim.positionOf('p1')?.x !== 0; i++) sim.tick()
    sim.stopMove('p1')
    // The boarding press at the parked (doors-shut) car: the swing opens and
    // the board lands when the doors are fully open.
    expect(sim.callElevator('p1')).toBe('ignored')
    const opened = sim.tick().filter((e) => e.type === 'elevator:doors')
    expect(opened).toEqual([{ type: 'elevator:doors', car: 1, floor: 'lobby', open: true }])
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p1').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    // Ride to floor1: the stop's minimum dwell elapses, the attend check
    // closes the doors (open: false) and the departure follows silently.
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    // The minimum dwell re-arms (AD-027): the attend check closes at its end.
    let closed: MovementEvent | undefined
    for (let i = 0; i < DWELL_TICKS + DOOR_TICKS + 5 && closed === undefined; i++) {
      closed = sim.tick().find((e) => e.type === 'elevator:doors' && !e.open)
    }
    expect(closed).toEqual({ type: 'elevator:doors', car: 1, floor: 'lobby', open: false })
    // The arrival at floor1 announces the new floor AND the doors opening.
    const arrival: MovementEvent[] = []
    for (let i = 0; i < 2 * RIDE_TICKS_PER_FLOOR + 2 * DOOR_TICKS && arrival.length < 2; i++) {
      arrival.push(
        ...sim.tick().filter((e) => e.type === 'elevator:doors' || e.type === 'elevator:moved'),
      )
    }
    expect(arrival).toEqual([
      { type: 'elevator:moved', car: 1, floor: 'floor1' },
      { type: 'elevator:doors', car: 1, floor: 'floor1', open: true },
    ])
  })

  it('a landing press while the summoned car is still arriving pends the board (AD-027 one-press boarding)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // Stage car 1 away (doors-open at floor1 with its rider aboard).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    // p1 walks to the EAST landing and calls: the call pins to car 2 (AD-023)
    // — car 2 is dwelling shut at the lobby, so it opens up and boards p1.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 60; i++) sim.tick() // clamps at the east landing
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('ignored') // parked-car press: boards
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p1').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p1').car).toBe(2)
    // Ride to floor2, step off, walk into the hall, and re-summon a car:
    // while the attending car is still ARRIVING, a landing press pends the
    // board — one press, boarded the moment the doors open (AD-027).
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(3 * RIDE_TICKS_PER_FLOOR)
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'left') // step off at the floor2 east landing
    sim.stopMove('p1')
    sim.startMove('p1', 'left') // walk into the hall (out of boarding range)
    for (let i = 0; i < 7; i++) sim.tick() // x ≈ 27.9: 2.1 tiles from the landing
    sim.stopMove('p1')
    // Car 2 stands doors-open here (nothing to attend) and car 1 is at
    // floor1: the call queues and car 1 attends — closes and comes over.
    expect(sim.callElevator('p1')).toBe('dispatched')
    // Walk to the WEST landing (car 1's — car 2 stands doors-open at the east
    // landing) and press while car 1 is still arriving: the press pends the
    // board (AD-027) — no second press needed once the doors open.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 100 && sim.positionOf('p1')?.x !== 0; i++) sim.tick()
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('ignored') // pends the board while arriving
    for (let i = 0; i < 250 && sim.viewOf('p1').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p1').car).toBe(1)
  })

  it('a doors-open car re-arms its minimum dwell when a ride is queued', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    // The stop's minimum dwell runs out with nothing to attend: doors stay
    // open, no events.
    for (let i = 0; i < DWELL_TICKS + DOOR_TICKS; i++) expect(carEvents(sim.tick())).toEqual([])
    // Queue a ride: the full minimum dwell re-arms before the attend check
    // closes for the departure (AD-027: at least 3 s after it was opened).
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    let closed: MovementEvent | undefined
    for (let i = 0; i < DWELL_TICKS + 5 && closed === undefined; i++) {
      const events = sim.tick()
      if (i < DWELL_TICKS) {
        // The press announce rides the first tick; nothing else may happen.
        expect(
          events.filter((e) => e.type !== 'elevator:pressed' && e.type !== 'elevator:doors'),
        ).toEqual([])
      }
      closed = events.find((e) => e.type === 'elevator:doors' && !e.open)
    }
    expect(closed).toEqual({ type: 'elevator:doors', car: 1, floor: 'lobby', open: false })
  })
})

describe('sim:elevator', () => {
  it('pins the dwell literal: exactly 60 ticks derived from ELEVATOR_DWELL_SECONDS × TICK_HZ (ELR-14, AD-027)', () => {
    // Spec-precision pin (ELR P3 AC1): every dwell assertion elsewhere is
    // constant-relative, so a tuning drift must fail HERE, not survive the
    // suite. AD-027 raised the minimum open time to 3 s.
    expect(TUNING.ELEVATOR_DWELL_SECONDS).toBe(3)
    expect(DWELL_TICKS).toBe(TUNING.ELEVATOR_DWELL_SECONDS * TICK_HZ)
    expect(DWELL_TICKS).toBe(60)
  })

  it('arrives at exactly tick 60, dwells at least 60 ticks, and KEEPS the doors open for a caller who never boards (MOVE-11, ELR-14, ELR P3 AC4, AD-027)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Stage: car 1 empty-idle on floor1, car 2 occupied-idle on floor2 — no
    // car stands at the lobby, so p1's call dispatches.
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p2', 'right') // step off through the open doors
    expect(sim.viewOf('p2').car).toBeNull()
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(
      DWELL_TICKS + DOOR_TICKS + 3 * RIDE_TICKS_PER_FLOOR - 1,
    )
    expect(sim.viewOf('p3').car).toBe(2) // stay-in-car: no auto-exit (ELR P3 AC2)

    expect(sim.callElevator('p1')).toBe('dispatched')
    // AD-027: no idle car exists (both stand doors-open at their stops), so
    // the call queues — and is served by the FIRST car whose attend check
    // fires (car 1's floor1 dwell already elapsed): it closes and dispatches.
    const flash = (() => {
      for (let i = 0; i < 120; i++) {
        const events = carEvents(sim.tick())
        if (events.some((e) => e.type === 'elevator:called')) return events
      }
      return null
    })()
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // The flash tick above already counted toward the 60-tick arrival.
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBe(59)
    // AD-026/027 stop anatomy: 10 opening ticks (61..70), then the open-door
    // dwell — the MINIMUM 60 ticks (71..130, ELR-14) — and then the doors
    // STAY OPEN: with no queued ride and no attendable hall call, nothing
    // ever closes the car (the caller, mid-hall and out of boarding range,
    // never boarded and nothing auto-proceeds, ELR P3 AC4).
    for (let i = 0; i < DOOR_TICKS + DWELL_TICKS; i++) {
      expect(carEvents(sim.tick())).toEqual([])
    }
    for (let i = 0; i < 40; i++) {
      expect(carEvents(sim.tick())).toEqual([])
      expect(sim.snapshotForFloor('lobby').cars[0]).toEqual({ car: 1, floor: 'lobby' })
    }
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'floor2' },
    ])
  })

  it('a mid-hall call with both cars dwelling elsewhere queues and is served by the first car to reach its attend check (AD-027)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Both cars stand doors-open at their stops: car 1 at floor1 (rider
    // stepped off), car 2 at floor2 (rider stays aboard).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p2', 'right')
    expect(sim.viewOf('p2').car).toBeNull()
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(
      DWELL_TICKS + DOOR_TICKS + 3 * RIDE_TICKS_PER_FLOOR - 1,
    )
    // p1 calls from near the EAST landing but OUTSIDE it (mid-hall): no idle
    // car exists — the call queues, and the FIRST car whose attend check runs
    // (car 1: lobby ≠ floor1) closes its doors and dispatches to the lobby.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 46; i++) sim.tick() // 15 + 46 × 0.3 = x 28.8 (> 1 tile from the landing)
    sim.stopMove('p1')
    expect(lastX(sim, 'p1')).toBe(28.8)
    expect(sim.callElevator('p1')).toBe('dispatched')
    const flash = huntFlash(sim)
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // The flash tick above already counted toward the 60-tick arrival.
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBe(59)
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'floor2' },
    ])
  })

  it('a call pressed at a landing whose car is busy elsewhere queues PINNED to that car (AD-023) and that car attends it (AD-027)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    sim.startMove('p2', 'right')
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(
      DWELL_TICKS + DOOR_TICKS + 3 * RIDE_TICKS_PER_FLOOR - 1,
    )
    sim.startMove('p3', 'left') // p3 steps off on floor2
    // p1 at the EAST landing (AD-023 pin): car 2 is the landing's car — it is
    // BUSY (dwelling at floor2), so the call queues PINNED to it and car 1 is
    // never summoned. Car 2's dwell already elapsed: its attend check serves
    // the pinned call — closing swing, then the dispatch.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick()
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(carEvents(sim.tick())).toEqual([]) // no flash yet: queued pinned
    const flash = huntFlash(sim)
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 2 }])
    expect(runUntilCarMoved(sim, 2, 'lobby')).toBe(59)
  })

  it('a mid-hall call with both cars occupied-dwelling queues; the attending car cannot be re-pressed for its pickup (AD-027, ELR edge)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Both cars occupied-dwelling on guest floors (riders stay aboard).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(
      DWELL_TICKS + DOOR_TICKS + 3 * RIDE_TICKS_PER_FLOOR - 1,
    )
    // p1 calls from the lobby center: the call queues — car 1 (tie → car 1)
    // attends first, closes, and dispatches to the lobby.
    expect(sim.callElevator('p1')).toBe('dispatched')
    const flash = huntFlash(sim)
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // The carried rider presses the pickup floor while the car is arriving:
    // the pickup is being served — silently ignored (no zero-tick rides).
    expect(sim.pressFloor('p2', 'lobby')).toBe('ignored')
    // The walk staging above consumed much of the car's minimum dwell, so
    // the attend check fires shortly after the call — assert only that the
    // arrival lands with the carried rider kept aboard.
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBeGreaterThan(0)
    expect(sim.viewOf('p2').car).toBe(1) // the carried rider stays aboard
  })

  it('serves presses FIFO in press order at 2 s per floor; a stay-in-car rider keeps riding (ELR P2 AC4, ELR P3 AC2)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor3')).toBe('accepted')
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted') // queued behind floor3
    // Press during the just-opened stop: the surviving dwell + closing swing
    // (AD-026) precede the ride (the boarding flush tick ate one dwell tick);
    // lobby → floor3: 4 floors × 40 ticks (§7 ELEVATOR_RIDE_SECONDS_PER_FLOOR;
    // the 3.C mezzanine adds one stride between the lobby and floor1).
    expect(runUntilCarMoved(sim, 1, 'floor3')).toBe(
      DWELL_TICKS + DOOR_TICKS + 4 * RIDE_TICKS_PER_FLOOR - 1,
    )
    // The stop (10 opening + 20 dwell + 10 closing, AD-026) ends into the
    // NEXT queued floor — FIFO.
    for (let i = 0; i < 2 * DOOR_TICKS + DWELL_TICKS; i++) {
      expect(carEvents(sim.tick())).toEqual([])
    }
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(2 * RIDE_TICKS_PER_FLOOR)
    expect(sim.viewOf('p1').car).toBe(1) // stay-in-car: no forced exit
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    // Queue empty: the minimum dwell elapsed and the car KEEPS its doors
    // open (AD-027) with the rider aboard.
    for (let i = 0; i < 2 * DOOR_TICKS + DWELL_TICKS; i++) sim.tick()
    expect(sim.viewOf('p1').car).toBe(1)
    // A press into the doors-open car queues the ride: the attend check runs
    // the very next tick (the minimum dwell already elapsed) — closing swing,
    // then the departure.
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(DOOR_TICKS + RIDE_TICKS_PER_FLOOR + 1)
  })

  it('rejects presses silently: duplicate, being-served, current-floor-while-open, and non-rider (ELR P2 AC2/AC3)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'lobby')).toBe('ignored') // current floor, doors just opened
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    expect(sim.pressFloor('p1', 'floor2')).toBe('ignored') // being served (queue head)
    expect(sim.pressFloor('p2', 'floor3')).toBe('rejected') // non-rider
    // Silence: exactly ONE press event reaches the next tick — the accepted one.
    expect(sim.tick().filter((e) => e.type === 'elevator:pressed')).toEqual([
      { type: 'elevator:pressed', playerId: 'p1', floor: 'floor2', car: 1 },
    ])
    // Press during the just-opened stop: the surviving dwell + closing swing
    // (AD-026) precede the ride (the flush tick above ate one dwell tick).
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(
      DWELL_TICKS + DOOR_TICKS + 3 * RIDE_TICKS_PER_FLOOR - 2,
    )
    expect(sim.pressFloor('p1', 'floor2')).toBe('ignored') // current floor while opening
    // The origin floor is queueable while stopped elsewhere — a return trip.
    expect(sim.pressFloor('p1', 'lobby')).toBe('accepted')
    // The press queues during the opening swing: both swings + the dwell
    // precede the lobby ride (AD-026).
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBe(
      2 * DOOR_TICKS + DWELL_TICKS + 3 * RIDE_TICKS_PER_FLOOR,
    )
  })

  it('rejects a press of a queued non-head floor silently — exactly one pressed event per accepted press (ELR P2 AC2)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor3')).toBe('accepted') // departs: the served head
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted') // queued behind the head
    // The queued (non-head) floor is already lit: re-pressing it while it
    // waits behind the served head is a duplicate — silently ignored.
    expect(sim.pressFloor('p1', 'floor2')).toBe('ignored')
    // Exactly one pressed event per accepted press — never one for the
    // duplicate — and the queue keeps its two entries (a double-queue would
    // later reach the zero-ride throw).
    expect(sim.tick().filter((e) => e.type === 'elevator:pressed')).toEqual([
      { type: 'elevator:pressed', playerId: 'p1', floor: 'floor3', car: 1 },
      { type: 'elevator:pressed', playerId: 'p1', floor: 'floor2', car: 1 },
    ])
    expect(sim.snapshotFor('p1').carOccupants).toEqual({
      car: 1,
      riders: ['p1'],
      queue: ['floor3', 'floor2'],
    })
  })

  it("boards a call pressed at a parked car's landing and keeps mid-hall calls a decoy flash when BOTH cars are parked at the pickup floor (AD-019: narrowed MOVE-12, AD-025)", () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // p1 rides car 1 to floor1 and steps off; car 1 idles there, doors open.
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'right')
    sim.stopMove('p1') // step off and STAY at the west landing
    expect(sim.viewOf('p1').car).toBeNull()
    // p2 joins p1 on floor1 via car 2 (east landing), also stepping off.
    boardParkedCar(sim, 'p2', 2)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p2', 'left')
    sim.stopMove('p2') // step off and STAY at the east landing
    expect(sim.viewOf('p2').car).toBeNull()
    // Consume the walk-off occupancy update (AD-013) before the calls.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 2, riders: [], queue: [] },
    ])
    // At the landings, the call press IS boarding (AD-025) — and with
    // AD-027 both cars stand with their doors OPEN (nothing to attend), so
    // each caller boards instantly; no car is summoned anywhere.
    expect(sim.callElevator('p1')).toBe('ignored')
    expect(sim.callElevator('p2')).toBe('ignored')
    const events = sim.tick()
    const called = events.filter((e) => e.type === 'elevator:called')
    expect(called).toEqual([
      { type: 'elevator:called', floor: 'floor1', car: 1 },
      { type: 'elevator:called', floor: 'floor1', car: 2 },
    ])
    // No door events and no car moved: the boarding happens through the
    // already-open doors.
    expect(
      events.filter((e) => e.type === 'elevator:moved' || e.type === 'elevator:doors'),
    ).toEqual([])
    expect(sim.viewOf('p1').car).toBe(1)
    expect(sim.viewOf('p2').car).toBe(2)
    // Mid-hall, with BOTH cars parked open-doors at the pickup floor, nothing
    // can arrive: the call stays a decoy flash naming car 1 (AD-019 line).
    const mid = new MovementSim()
    mid.join('p1')
    mid.join('p2')
    boardParkedCar(mid, 'p1', 1)
    mid.pressFloor('p1', 'floor1')
    expect(runUntilCarMoved(mid, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) mid.tick() // the doors finish opening
    mid.startMove('p1', 'right') // steps off at the west landing...
    mid.startMove('p1', 'right')
    for (let i = 0; i < 7; i++) mid.tick() // ...and walks mid-hall (2.1 tiles)
    mid.stopMove('p1')
    boardParkedCar(mid, 'p2', 2)
    mid.pressFloor('p2', 'floor1')
    expect(runUntilCarMoved(mid, 2, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) mid.tick() // the doors finish opening
    mid.startMove('p2', 'left') // car 2 parked empty at floor1, east landing
    expect(mid.viewOf('p2').car).toBeNull()
    mid.tick() // consume the walk-off riders update
    expect(mid.callElevator('p1')).toBe('ignored')
    const decoy = mid.tick().filter((e) => e.type === 'elevator:called')
    expect(decoy).toEqual([{ type: 'elevator:called', floor: 'floor1', car: 1 }])
    expect(mid.viewOf('p1').car).toBeNull()
  })

  it("never summons the OTHER car for a call pressed at the parked car's own landing — the press boards (AD-023, AD-025)", () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // Car 1 idles open-doors at floor1 (p1 rode it there and stepped off).
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'right')
    sim.stopMove('p1') // step off and STAY at car 1's west landing
    expect(sim.viewOf('p1').car).toBeNull()
    // Consume the walk-off occupancy update (AD-013) before the call.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 1, riders: [], queue: [] },
    ])
    // p1 stands at car 1's west landing (the exit places him there): the call
    // press boards him into car 1 (AD-025) — and car 2 is NEVER summoned
    // (AD-023 overrides AD-019 at landings).
    expect(sim.callElevator('p1')).toBe('ignored')
    expect(sim.tick().filter((e) => e.type === 'elevator:called')).toEqual([
      { type: 'elevator:called', floor: 'floor1', car: 1 },
    ])
    for (let i = 0; i < 80; i++) expect(carEvents(sim.tick())).toEqual([])
    expect(sim.viewOf('p1').car).toBe(1) // re-boarded by his own press
    expect(sim.snapshotForFloor('floor1').cars).toEqual([
      { car: 1, floor: 'floor1' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('summons the OTHER car for a mid-hall call when one is parked open-doors at the pickup floor (AD-019, mid-hall branch)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // Car 1 idles doors-shut at floor1 (p1 rode it there and stepped off).
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'right')
    expect(sim.viewOf('p1').car).toBeNull()
    // Consume the walk-off occupancy update (AD-013) before the call.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 1, riders: [], queue: [] },
    ])
    // p1 walks OFF the landing (the stock client's gate would not send from
    // here, but the sim stays robust): car 1 is parked here, so car 2 is
    // summoned (AD-019 mid-hall policy).
    sim.startMove('p1', 'right')
    for (let i = 0; i < 7; i++) sim.tick() // 0.3 + 7 × 0.3 = 2.4 tiles from the landing
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(sim.tick().filter((e) => e.type === 'elevator:called')).toEqual([
      { type: 'elevator:called', floor: 'floor1', car: 2 },
    ])
    // The flash tick above already counted toward the 60-tick arrival.
    expect(runUntilCarMoved(sim, 2, 'floor1')).toBe(3 * TICK_HZ - 1)
    // Car 2 finishes its stop (opening + dwell + closing, AD-026) and idles
    // with doors shut beside car 1; nobody boarded (p1 stands 2+ tiles from
    // BOTH landings, out of car 2's boarding range).
    for (let i = 0; i < 2 * DOOR_TICKS + DWELL_TICKS; i++) {
      expect(carEvents(sim.tick())).toEqual([])
    }
    expect(sim.snapshotForFloor('floor1').cars).toEqual([
      { car: 1, floor: 'floor1' },
      { car: 2, floor: 'floor1' },
    ])
  })

  it('pins a call pressed at a landing to its busy car; the other car is never summoned (AD-023, AD-027)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // Car 1 departs on p2's floor3 press (after its minimum dwell); car 2
    // stays parked shut at the lobby (never called).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor3')).toBe(
      DWELL_TICKS + DOOR_TICKS + 4 * RIDE_TICKS_PER_FLOOR - 1,
    )
    // p1 walks to the WEST landing (car 1's) while car 1 stands at floor3,
    // and calls: the call pins to car 1 (dwelling, busy) — car 2 must never
    // be summoned.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 60; i++) sim.tick() // clamps at the west landing
    sim.stopMove('p1')
    expect(lastX(sim, 'p1')).toBe(0)
    expect(sim.callElevator('p1')).toBe('dispatched')
    // No flash yet: the call waits in the FIFO pinned to car 1.
    expect(carEvents(sim.tick())).toEqual([])
    // Car 1's attend check fires (lobby ≠ floor3): closing swing, dispatch,
    // 60-tick arrival, and its stop keeps the doors open at the lobby; car 2
    // never moves.
    const seen: MovementEvent[] = []
    for (let i = 0; i < 400; i++) seen.push(...sim.tick())
    expect(seen.filter((e) => e.type === 'elevator:called')).toEqual([
      { type: 'elevator:called', floor: 'lobby', car: 1 },
    ])
    expect(seen.some((e) => e.type === 'elevator:moved' && e.car === 2)).toBe(false)
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('queues the call for a busy other car when one is parked open-doors at the pickup floor (AD-019, MOVE-15)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Car 2 departs to floor1 (rider stays aboard); car 1 departs to floor3.
    boardParkedCar(sim, 'p2', 2)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    boardParkedCar(sim, 'p3', 1)
    expect(sim.pressFloor('p3', 'floor3')).toBe('accepted')
    // p1 calls from the lobby center with car 1 riding: no car is parked at
    // the LOBBY, both cars busy → sim-level FIFO queue, no flash yet.
    expect(sim.callElevator('p1')).toBe('dispatched')
    // Car 2 frees first (floor1, ~tick 40) and serves the queued lobby pickup;
    // car 1 is still mid-ride to floor3.
    const seen: MovementEvent[] = []
    for (let i = 0; i < 250; i++) seen.push(...sim.tick())
    expect(seen.filter((e) => e.type === 'elevator:called')).toEqual([
      { type: 'elevator:called', floor: 'lobby', car: 2 },
    ])
    expect(
      seen.some((e) => e.type === 'elevator:moved' && e.car === 2 && e.floor === 'lobby'),
    ).toBe(true)
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'floor3' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('queues a call when both cars are busy and serves it with the first car to free (MOVE-15)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    sim.join('p4')
    // Both cars depart on presses (car 1: 120-tick ride, car 2: 40-tick ride).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted')
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor1')).toBe('accepted')
    // p4 calls from the lobby center: both cars riding → sim-level FIFO queue.
    expect(sim.callElevator('p4')).toBe('dispatched')
    // The next tick announces p3's press (rider-exclusive; it also eats one
    // dwell tick — AD-026's stop anatomy precedes the ride) and the queued
    // call itself flashes only at dispatch time.
    expect(carEvents(sim.tick())).toEqual([
      { type: 'elevator:pressed', playerId: 'p3', floor: 'floor1', car: 2 },
    ])
    expect(runUntilCarMoved(sim, 2, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 2,
    )
    // Car 2 frees first: once its minimum dwell elapses, its attend check
    // serves the queued call — closing swing, then the dispatch announces.
    const flash = huntFlash(sim)
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 2 }])
    // The flash tick above already counted toward the 60-tick arrival.
    expect(runUntilCarMoved(sim, 2, 'lobby')).toBe(59)
  })

  it('drops a boarding player queued call (AD-012 #3: no car to an abandoned floor)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // 3.C re-stage: car 2 (the SHORT round trip) departs FIRST so that p1
    // boards its return before car 1's attend check can serve the queued
    // call — the 5-floor economy lengthened car 1's floor3 ride and flipped
    // the original race.
    // p3 pre-steps to 28.8 (1.2 tiles out of car 2's boarding range → walks in).
    sim.startMove('p3', 'right')
    for (let i = 0; i < 46; i++) sim.tick()
    sim.stopMove('p3')
    expect(lastX(sim, 'p3')).toBe(28.8)
    sim.startMove('p3', 'right')
    for (let i = 0; i < 10 && lastX(sim, 'p3') !== HALL_LENGTH_TILES; i++) sim.tick()
    sim.stopMove('p3')
    expect(sim.callElevator('p3')).toBe('ignored') // parked-car press: doors open
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p3').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    expect(sim.pressFloor('p3', 'floor1')).toBe('accepted') // car 2: 80-tick ride
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted') // car 1: 160-tick ride
    // p1 calls from the lobby center: both cars riding → the call waits in
    // the sim-level FIFO (MOVE-15) — no flash, no dispatch yet.
    expect(sim.callElevator('p1')).toBe('dispatched')
    // p1 heads for the east landing. p3 (stay-in-car) queues the lobby return
    // during the floor1 dwell, so car 2 comes back and p1 boards it with the
    // landing call press (AD-025).
    sim.startMove('p1', 'right')
    // Offsets are relative to p1's call — p2's boarding staging sits between
    // p3's press and here, so the exact anatomy pins live in the other tests;
    // this test only needs the arrivals to happen in order.
    expect(runUntilCarMoved(sim, 2, 'floor1')).toBeGreaterThan(0)
    expect(sim.pressFloor('p3', 'lobby')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'lobby')).toBeGreaterThan(0)
    expect(sim.callElevator('p1')).toBe('ignored') // parked-car press: doors open
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p1').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p1').car).toBe(2) // boarded the other car at its landing
    // Boarding drops the boarder's own queued call (AD-012 #3): no car may
    // ever be summoned to a floor they left. Tick past car 1's arrival, dwell,
    // and idle transition — a surviving call would flash there and dispatch
    // car 1 to the lobby.
    const tail: MovementEvent[] = []
    for (let i = 0; i < 150; i++) tail.push(...sim.tick())
    expect(tail.filter((e) => e.type === 'elevator:called')).toEqual([])
    expect(
      tail.some((e) => e.type === 'elevator:moved' && e.car === 1 && e.floor === 'lobby'),
    ).toBe(false)
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'floor3' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('serves a call queued at the buzzer once a car frees (EL-02, AD-011)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    sim.join('p4')
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted')
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor1')).toBe('accepted')
    expect(sim.callElevator('p4')).toBe('dispatched') // queued: both cars busy
    sim.tick()
    // AD-011: the queue is NOT cleared (it belongs to the car, never to the
    // phase). Car 2's attend check fires first (its stop ended earlier), it
    // dispatches the queued lobby pickup (one flash) and completes the trip.
    let flashes = 0
    for (let i = 0; i < 400; i++) {
      flashes += carEvents(sim.tick()).filter((e) => e.type === 'elevator:called').length
    }
    expect(flashes).toBe(1)
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'floor3' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('serves the queue as a ghost trip after the presser walks off (ELR P3 AC3)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    // Arrival-relative staging (deterministic): T = the arrival tick. The
    // press queues during the opening swing; the doors finish at T+10; the
    // walk-off happens in the open-door dwell; the stop ends at T+40 and the
    // ghost departure serves floor2 (the queue belongs to the CAR — the
    // walk-off never clears it, ELR P3 AC3).
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    // T+1 flushes the rider-exclusive pressed announce.
    expect(sim.tick().filter((e) => e.type === 'elevator:pressed')).toEqual([
      { type: 'elevator:pressed', playerId: 'p1', floor: 'floor2', car: 1 },
    ])
    for (let i = 0; i < DOOR_TICKS - 1; i++) sim.tick() // T+2..T+10: swing ends
    sim.startMove('p1', 'right') // walk-off through the open doors
    // T+11 flushes the walk-off's occupancy update (empty riders, surviving
    // queue).
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 1, riders: [], queue: ['floor2'] },
    ])
    // T+12..T+40: the rest of the dwell + the closing swing, then the ghost
    // departure — nothing announces (departures are silent).
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) {
      expect(carEvents(sim.tick())).toEqual([])
    }
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(RIDE_TICKS_PER_FLOOR) // floor1 → floor2: one floor
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'floor2' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('declines a call press into a full car; a freed slot admits the next press (MOVE-13 capacity, ELR P2 AC8, AD-025)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Fill the parked west car to capacity 2 via landing call presses.
    boardParkedCar(sim, 'p1', 1)
    boardParkedCar(sim, 'p2', 1)
    // p3 walks to the west landing: the car stands full with doors open.
    sim.startMove('p3', 'left')
    for (let i = 0; i < 50; i++) sim.tick()
    sim.stopMove('p3')
    // Full car: the landing press declines silently — no board, no summon.
    // The doors are OPEN (AD-027: nothing to attend), so no swing plays.
    expect(sim.callElevator('p3')).toBe('ignored')
    sim.tick() // flush the flash
    expect(sim.viewOf('p3').car).toBeNull()
    expect(sim.viewOf('p1').car).toBe(1)
    expect(sim.viewOf('p2').car).toBe(1)
    // p1 walks off through the open doors: a slot frees.
    sim.startMove('p1', 'right')
    expect(sim.viewOf('p1').car).toBeNull()
    // The freed slot admits p3's next press (the car is still dwelling).
    expect(sim.callElevator('p3')).toBe('ignored') // parked-car press boards
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p3').car).toBe(1)
    expect(sim.viewOf('p1').car).toBeNull()
  })

  it('never re-boards an exiter by proximity; the landing call press re-boards (AD-025 supersedes the AD-016 episode guard)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1', 1)
    // p1 exits and stays inside the boarding radius: no proximity re-board,
    // no board/exit oscillation, no event spam — boarding is the explicit
    // call press now.
    sim.startMove('p1', 'right')
    sim.stopMove('p1')
    expect(sim.viewOf('p1').car).toBeNull()
    expect(lastX(sim, 'p1')).toBe(0)
    for (let i = 0; i < 30; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
      expect(lastX(sim, 'p1')).toBe(0)
    }
    // The car's doors stay OPEN here (AD-027: nothing to attend): p1's call
    // press boards him instantly through them (AD-025).
    expect(sim.callElevator('p1')).toBe('ignored')
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p1').car).toBe(1)
    // p2 boards alongside (capacity 2) and the re-boarded rider rides along.
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    // The minimum dwell long elapsed: the attend check fires the next tick —
    // closing swing, then the ride.
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR + 1)
    expect(sim.viewOf('p1').car).toBe(1)
    expect(sim.viewOf('p2').car).toBe(1)
  })

  it('serves presses pre-round and lets a pre-round exiter walk away (EL-01, EL-04, AD-015, ELR edge)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    // Pre-round: board the parked west car and press floor1 — no round needed.
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    // Exit through the open doors pre-round: allowed in ANY door-open moment
    // (AD-015, AD-026 gate).
    sim.startMove('p1', 'right')
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    expect(lastX(sim, 'p1')).toBe(0)
    // Hallway walking is now allowed pre-round (AD-015): the exiter leaves the
    // landing and cannot board by walking — boarding is the explicit call
    // press (AD-025); they only walk back 1.5 tiles here, and never press.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 25; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
    }
    expect(lastX(sim, 'p1')).toBeGreaterThan(0)
    // Walking back part-way does not board either (no press, no board).
    sim.startMove('p1', 'left')
    for (let i = 0; i < 5; i++) sim.tick()
    expect(sim.viewOf('p1').car).toBeNull()
  })

  it('a direction held through the opening swing exits the tick the doors are fully open (AD-026)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    // Ride to floor2 (two floors): the stop must finish first (dwell tail +
    // closing).
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(3 * RIDE_TICKS_PER_FLOOR)
    // The arrival moved lands at the START of the opening swing (AD-026):
    // the rider holds a direction NOW (the client sends the intent once) —
    // the hop-off applies the tick the doors are fully open, never mid-swing.
    sim.startMove('p1', 'right')
    for (let i = 0; i < DOOR_TICKS - 1; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBe(1) // still aboard: doors not fully open
    }
    sim.tick() // the doors finish opening: the held exit applies now
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor2')
    expect(sim.positionOf('p1')?.x).toBe(0) // the exit pins the landing x
    sim.tick() // the held walk resumes on the floor
    expect(sim.positionOf('p1')?.x).toBe(0.3)
  })

  it('releasing the direction while the exit is pending cancels it (AD-026 held-intent rule)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(3 * RIDE_TICKS_PER_FLOOR)
    // Pend the exit during the opening swing, then release before the doors
    // are fully open: the hop-off never applies.
    sim.startMove('p1', 'right')
    sim.stopMove('p1')
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    expect(sim.viewOf('p1').car).toBe(1) // still aboard: the exit was cancelled
  })

  it('a direction held during the ride or the closing swing never exits (MOVE-09, AD-026)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    // Let the boarding stop finish: attend → closing swing → departure.
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    // Held during the ride: consumed while the doors are shut — no pending
    // exit, no exit when the doors open at the stop.
    sim.startMove('p1', 'right')
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(3 * RIDE_TICKS_PER_FLOOR)
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    expect(sim.viewOf('p1').car).toBe(1) // still aboard through the dwell
    // Now queue a return trip and hold a direction during the CLOSING swing
    // (the attend check closes for the queued ride): the hop window is
    // shutting — the hold is lost, and the rider rides along.
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    // The queued ride re-arms the minimum dwell (AD-027): it must elapse
    // before the attend check closes for the departure.
    for (let i = 0; i < DWELL_TICKS - 1; i++) sim.tick()
    sim.tick() // the dwell expires; the attend evaluation closes the doors
    sim.startMove('p1', 'right')
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the closing swing runs
    expect(sim.viewOf('p1').car).toBe(1) // departing with the doors shut
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    for (let i = 0; i < 10; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBe(1) // doors open, still no auto-exit
    }
  })

  it('ignores in-car move intents while doors are shut; open doors let the rider walk off (MOVE-09, MOVE-16, AD-015, AD-026)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted') // 80-tick ride
    // The just-opened stop must finish first (surviving dwell + closing
    // swing, AD-026) — holding a direction NOW would walk off instead.
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    const xInCar = lastX(sim, 'p1')
    sim.startMove('p1', 'right') // doors shut: riding — ignored (MOVE-09)
    for (let i = 0; i < 40; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(xInCar)
    expect(sim.viewOf('p1').car).toBe(1) // still riding: the held ticks never exit
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBeGreaterThan(0) // ride completes
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    // Open doors: the same intent now exits at the served floor.
    // MOVE-16 payload purity: occupancy never rides any public event (the
    // registry pins in T4 carry the wire half of this guarantee).
    sim.startMove('p1', 'right')
    sim.tick()
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor2')
    expect(sim.positionOf('p1')?.x).toBe(0.3) // walking continues (AD-015)
  })

  it('dispatches across floors while a car is mid-arrival elsewhere (AD-012 narrowed: pickup-only predicate)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Park both cars on guest floors, riders stepped off (empty idle).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p2', 'right')
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(
      DWELL_TICKS + DOOR_TICKS + 3 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p3', 'left')
    // Consume the walk-off occupancy update (AD-013) before the calls.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 2, riders: [], queue: [] },
    ])
    // p1 (lobby center, tie → car 1) calls: no idle car exists — the call
    // queues and car 1 (lobby ≠ floor1) attends: closing swing, dispatch,
    // and the flash announces (MOVE-10). Car 1 is now ARRIVING to the lobby.
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(huntFlash(sim)).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // p2's call from floor1 is a DIFFERENT pickup: the mid-arrival car must
    // not swallow it (the old destination-only decoy is dead — AD-012). Car 2
    // is still mid-dwell, so the call queues and dispatches when it idles.
    expect(sim.callElevator('p2')).toBe('dispatched')
    const flash2 = huntFlash(sim, 120)
    expect(flash2).toEqual([{ type: 'elevator:called', floor: 'floor1', car: 2 }])
  })

  it('replays a 200-tick scripted dwell+queue sequence bit-for-bit across two runs (MOVE-17 determinism)', () => {
    const run = () => {
      const sim = new MovementSim()
      sim.join('p1')
      sim.join('p2')
      boardParkedCar(sim, 'p1', 1)
      sim.pressFloor('p1', 'floor2')
      sim.startMove('p2', 'left')
      const trace: string[] = []
      for (let i = 0; i < 200; i++) {
        if (i === 100) sim.pressFloor('p1', 'lobby') // queued return while riding
        trace.push(JSON.stringify(sim.tick()))
      }
      return trace.join('\n')
    }
    expect(run()).toBe(run())
  })

  it('reports the public movement state for a floor (MOVE-18, floor-scoped post-AD-008)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick()
    expect(sim.snapshotForFloor('lobby')).toEqual({
      players: [
        { playerId: 'p1', floor: 'lobby', x: 18 },
        { playerId: 'p2', floor: 'lobby', x: 15 },
      ],
      cardedRooms: [],
      cars: [
        { car: 1, floor: 'lobby' },
        { car: 2, floor: 'lobby' },
      ],
    })
    sim.leave('p1')
    expect(sim.snapshotForFloor('lobby').players).toEqual([
      { playerId: 'p2', floor: 'lobby', x: 15 },
    ])
  })
})

// WORK-19 (AD-009 coherence): boarding removes the rider from the boarding
// floor's stream — one player:left-floor per boarding, naming the floor
// BOARDed (never any destination; none exists under AD-014).
describe('boarding left-floor event (WORK-19)', () => {
  it('emits player:left-floor once per boarding, naming the boarded floor only', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the west landing
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('ignored') // parked-car press boards
    let leftFloor: MovementEvent | undefined
    for (let i = 0; i < 20 && leftFloor === undefined; i++) {
      for (const e of sim.tick()) {
        if (e.type === 'player:left-floor') leftFloor = e
      }
    }
    expect(leftFloor).toEqual({ type: 'player:left-floor', playerId: 'p1', floor: 'lobby' })
    expect(JSON.stringify(leftFloor)).not.toContain('floor1')
    // Exactly once: ride, dwell, and idle ticks emit no further left-floor.
    sim.pressFloor('p1', 'floor1')
    for (let i = 0; i < 60; i++) {
      expect(sim.tick().filter((e) => e.type === 'player:left-floor')).toEqual([])
    }
  })
})

// ELR P1 + AD-013: occupancy and press-queue knowledge is rider-exclusive.
// The sim emits elevator:riders on EVERY rider-list change (board, walk-off,
// disconnect dirty-flush) next tick, carrying the car's current occupants AND
// press queue. Wire-level exclusivity ("neither appears for non-riders") is
// the riders recipient policy — pinned by the Router tests (AD-013) and the
// registry projections.
describe('elevator riders events and snapshot (ELR P1, AD-013)', () => {
  it('emits elevator:riders on boarding with the full occupant + queue payload (ELR-01)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the west landing
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('ignored') // parked-car press boards
    let ridersEvent: MovementEvent | undefined
    for (let i = 0; i < 20 && ridersEvent === undefined; i++) {
      for (const e of sim.tick()) {
        if (e.type === 'elevator:riders') ridersEvent = e
      }
    }
    expect(ridersEvent).toEqual({ type: 'elevator:riders', car: 1, riders: ['p1'], queue: [] })
  })

  it('emits an updated list when a rider walks off, carrying the surviving queue (ELR-02, ELR-04)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1', 1) // flushes ['p1']
    boardParkedCar(sim, 'p2', 1) // flushes ['p1', 'p2']
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted') // departs after the stop
    // The staging walk consumed much of the minimum dwell — the attend
    // check fires shortly after the press; only the arrival matters here.
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBeGreaterThan(0)
    // During the open-door dwell: p2 queues another floor, then p1 walks
    // off. The walk-off update carries the car's survivors AND its queued
    // floors.
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    expect(sim.pressFloor('p2', 'floor2')).toBe('accepted')
    sim.startMove('p1', 'right')
    expect(sim.viewOf('p1').car).toBeNull()
    let ridersEvent: MovementEvent | undefined
    for (let i = 0; i < 20 && ridersEvent === undefined; i++) {
      for (const e of sim.tick()) {
        if (e.type === 'elevator:riders') ridersEvent = e
      }
    }
    expect(ridersEvent).toEqual({
      type: 'elevator:riders',
      car: 1,
      riders: ['p2'],
      queue: ['floor2'],
    })
  })

  it('flushes exactly one elevator:riders on the next tick after a disconnect (ELR-01 dirty flush)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1', 1)
    boardParkedCar(sim, 'p2', 1) // boarding updates flushed by the helper
    sim.leave('p1')
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 1, riders: ['p2'], queue: [] },
    ])
    for (let i = 0; i < 10; i++) {
      expect(sim.tick().some((e) => e.type === 'elevator:riders')).toBe(false)
    }
  })

  it('gives riders players:[], public car floors, and carOccupants; floor snapshots never carry occupancy (ELR-03, ELR-04)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted') // queue into the snapshot
    const riderSnap = sim.snapshotFor('p1')
    expect(riderSnap.players).toEqual([]) // no floor stream in a car (AD-009)
    expect(riderSnap.cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'lobby' },
    ])
    expect(riderSnap.carOccupants).toEqual({ car: 1, riders: ['p1'], queue: ['floor2'] })
    // Non-rider snapshots are byte-identical to the public shape — no
    // occupancy field anywhere.
    const floorSnap = sim.snapshotForFloor('lobby')
    expect(floorSnap).toEqual({
      players: [{ playerId: 'p2', floor: 'lobby', x: 15 }],
      cardedRooms: [],
      cars: [
        { car: 1, floor: 'lobby' },
        { car: 2, floor: 'lobby' },
      ],
    })
    expect('carOccupants' in floorSnap).toBe(false)
    // The rider never appears in any floor snapshot while aboard (AD-009).
    expect(sim.snapshotForFloor('lobby').players).toEqual([
      { playerId: 'p2', floor: 'lobby', x: 15 },
    ])
    // A non-rider's snapshotFor falls back to the floor snapshot.
    expect('carOccupants' in sim.snapshotFor('p2')).toBe(false)
  })
})

// AD-025: proximity boarding is gone entirely — an exiter standing anywhere
// (inside the 1-tile zone included) stays out until they press the call at
// the landing again. No episode guard is needed without a proximity rule.
describe('re-boarding after an exit (AD-025)', () => {
  it('an exiter lingering in the zone is never re-boarded by proximity', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    // Exit with a 3-tick walk (0.9 tiles): still inside the 1-tile radius.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 3; i++) sim.tick()
    sim.stopMove('p1')
    sim.tick()
    expect(lastX(sim, 'p1')).toBe(0.9)
    // Linger: no proximity board/exit oscillation exists anymore.
    for (let i = 0; i < 10; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
    }
  })

  it('a re-boarded exiter (via the landing call press) presses and rides normally', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick() // walk away from the landing
    sim.stopMove('p1')
    sim.tick()
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // walk back to the landing (x=0)
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('ignored') // parked-car press: boards
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p1').car).toBe(1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    // The attend check closes for the queued ride once the minimum dwell
    // elapses (the walk staging consumed much of it already).
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBeGreaterThan(0)
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    expect(sim.viewOf('p1').car).toBe(1) // stayed aboard the served floor
  })
})

// Spec EVID-04 (cycle 2.7): the own-floor carded-room set rides the snapshot;
// riders get an empty set (cards are floor knowledge, AD-009), join/buzzer
// callers omit the parameter and receive [].
describe('movement snapshot: carded rooms', () => {
  function riderOnFloor1(): MovementSim {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the west landing
    sim.stopMove('p1')
    sim.callElevator('p1') // parked-car press: doors open, then boards (AD-025/026)
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p1').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    sim.pressFloor('p1', 'floor1')
    for (let i = 0; i < DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1; i++) sim.tick()
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'right') // exit at the floor1 landing
    for (let i = 0; i < 5 && sim.viewOf('p1').car !== null; i++) sim.tick()
    return sim
  }

  it('carries the given carded rooms on a floor snapshot, defaulting to []', () => {
    const sim = riderOnFloor1()
    expect(sim.snapshotForFloor('floor1').cardedRooms).toEqual([])
    expect(sim.snapshotForFloor('floor1', [2, 5]).cardedRooms).toEqual([2, 5])
    // The lobby floor snapshot is unaffected.
    expect(sim.snapshotForFloor('lobby').cardedRooms).toEqual([])
  })

  it('passes the carded set through to a non-rider snapshot and empties it for riders', () => {
    const sim = riderOnFloor1()
    // p1 exited: non-rider on floor1 — their snapshot carries the floor's cards.
    expect(sim.snapshotFor('p1', [1]).cardedRooms).toEqual([1])

    // A rider still in the car: no floor, so no cards — even when the caller
    // passes a set (the rider policy wins, AD-009).
    const riding = new MovementSim()
    riding.join('p1')
    riding.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) riding.tick() // walk to the west landing
    riding.stopMove('p1')
    riding.callElevator('p1') // parked-car press: doors open, then boards (AD-025/026)
    for (let i = 0; i <= DOOR_TICKS && riding.viewOf('p1').car === null; i++) riding.tick()
    const riderSnap = riding.snapshotFor('p1', [1, 2])
    expect(riderSnap.cardedRooms).toEqual([])
    expect(riderSnap.carOccupants).toBeDefined()
  })
})

// --- Cycle 3.1 (GUEST-06/07): guest movers share every walk/elevator rule,
// emit guest:moved (never player:moved), count toward capacity, and appear
// in rider knowledge. Guests are never in player rows or player:* events.
describe('sim:guest_movers', () => {
  const DESK_X = TUNING.DESK_X_TILES * 1000

  it('a guest walking emits guest:moved — never player:moved (GUEST-06)', () => {
    const sim = new MovementSim()
    sim.join('guest:1', { kind: 'guest', floor: 'lobby', xMilli: DESK_X })
    sim.startMove('guest:1', 'right')
    const events = sim.tick()
    const guestMoves = events.filter((e) => e.type === 'guest:moved')
    expect(guestMoves.length).toBeGreaterThan(0)
    expect(guestMoves[0]).toMatchObject({ guestId: 'guest:1', floor: 'lobby' })
    expect(events.some((e) => e.type === 'player:moved')).toBe(false)
    // Milli-to-tile conversion: the x is in tiles on the wire.
    expect((guestMoves[0] as { x: number }).x).toBeGreaterThan(TUNING.DESK_X_TILES)
  })

  it('guests never appear in player snapshot rows; standing guests ride the guests field', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('guest:1', { kind: 'guest', floor: 'lobby', xMilli: DESK_X })
    sim.join('guest:2', { kind: 'guest', floor: 'floor1', xMilli: DESK_X })
    sim.tick()
    const snap = sim.snapshotFor('p1')
    expect(snap.players.some((r) => r.playerId.startsWith('guest'))).toBe(false)
    expect(snap.players.some((r) => r.playerId === 'p1')).toBe(true)
    // Own-floor guests only (AD-009 filtering), and present only when non-empty.
    expect(snap.guests).toEqual([{ guestId: 'guest:1', floor: 'lobby', x: TUNING.DESK_X_TILES }])
    const noGuests = new MovementSim()
    noGuests.join('p1')
    expect(noGuests.snapshotFor('p1').guests).toBeUndefined()
  })

  it('a guest boarding counts toward capacity and rides in rider knowledge (GUEST-07)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('guest:1', { kind: 'guest', floor: 'lobby', xMilli: 0 })
    sim.join('p2')
    sim.tick()
    // The guest boards car 1 via the parked-car landing press (AD-025).
    sim.callElevator('guest:1')
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('guest:1').car === null; i++) sim.tick()
    expect(sim.viewOf('guest:1').car).toBe(1)
    // Boarding a guest emits NO player:left-floor (that names a player).
    expect(sim.guestIds()).toEqual(['guest:1'])
    // p2 presses at the same landing: the car has 1 guest + 0 players = room
    // for one more; a third candidate would be declined silently.
    sim.join('p2', { floor: 'lobby', xMilli: 0 })
    sim.callElevator('p2')
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p2').car === null; i++) sim.tick()
    expect(sim.viewOf('p2').car).toBe(1)
    // Now the car is full (1 player + 1 guest = capacity 2): a third press declines.
    sim.join('p3', { floor: 'lobby', xMilli: 0 })
    const before = sim.viewOf('p3')
    sim.callElevator('p3')
    for (let i = 0; i <= DOOR_TICKS + 2; i++) sim.tick()
    expect(sim.viewOf('p3')).toEqual(before) // still standing at the landing
  })

  it('riders learn about a guest co-rider via elevator:riders guests — absent when none', () => {
    const sim = new MovementSim()
    sim.join('p1', { floor: 'lobby', xMilli: 0 })
    sim.join('guest:1', { kind: 'guest', floor: 'lobby', xMilli: 0 })
    sim.tick()
    sim.callElevator('guest:1')
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('guest:1').car === null; i++) sim.tick()
    sim.callElevator('p1') // joins the dwelling car immediately (AD-025)
    const events = sim.tick()
    const riders = events.find((e) => e.type === 'elevator:riders') as
      | { riders: string[]; guests?: string[] }
      | undefined
    expect(riders).toBeDefined()
    expect(riders?.riders).toEqual(['p1'])
    expect(riders?.guests).toEqual(['guest:1'])
    // And the rider's personal snapshot carries the guest too.
    const snap = sim.snapshotFor('p1')
    expect(snap.carOccupants?.guests).toEqual(['guest:1'])
    expect(snap.carOccupants?.riders).toEqual(['p1'])
  })

  it('a rider snapshot with no guests aboard keeps the pre-3.1 shape (no guests key)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    const snap = sim.snapshotFor('p1')
    expect(snap.carOccupants).toBeDefined()
    expect(snap.carOccupants?.guests).toBeUndefined()
    expect(snap.carOccupants?.riders).toEqual(['p1'])
  })

  it('a guest press in-car queues silently — no elevator:pressed testimony event', () => {
    const sim = new MovementSim()
    sim.join('p1', { floor: 'lobby', xMilli: 0 })
    sim.join('guest:1', { kind: 'guest', floor: 'lobby', xMilli: 0 })
    sim.tick()
    sim.callElevator('guest:1')
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('guest:1').car === null; i++) sim.tick()
    sim.callElevator('p1')
    sim.tick()
    expect(sim.pressFloor('guest:1', 'floor2')).toBe('accepted')
    const events = sim.tick()
    expect(events.some((e) => e.type === 'elevator:pressed')).toBe(false)
    // The queue still holds the floor (visible via the riders payload).
    const snap = sim.snapshotFor('p1')
    expect(snap.carOccupants?.queue).toEqual(['floor2'])
  })
})
