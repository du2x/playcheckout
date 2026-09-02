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
 * Walk a player from the lobby center to the PARKED car's landing (the EAST
 * end — cycle 3.E, AD-040: the stairwell took the west landing) and board it
 * with the landing call press (AD-025: proximity auto-boarding is disabled —
 * the call press at a parked car's landing IS the boarding action). AD-026:
 * the parked doors are shut, so the press swings them open (0.5 s) and the
 * board lands the tick they finish opening. Ends after the boarding's
 * next-tick event flush.
 */
function boardParkedCar(sim: MovementSim, playerId: string): void {
  sim.startMove(playerId, 'right')
  for (let i = 0; i < 100 && lastX(sim, playerId) !== HALL_LENGTH_TILES; i++) sim.tick()
  sim.stopMove(playerId)
  expect(lastX(sim, playerId)).toBe(HALL_LENGTH_TILES)
  expect(sim.callElevator(playerId)).toBe('ignored') // parked-car press: boards
  // The doors swing open for DOOR_TICKS before the board lands (AD-026).
  for (let i = 0; i <= DOOR_TICKS && sim.viewOf(playerId).car === null; i++) sim.tick()
  expect(sim.viewOf(playerId).car).toBe(1)
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
function runUntilCarMoved(sim: MovementSim, car: 1, floor: FloorId, max = 400): number {
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
    // Walk to the west wall — the stairwell replaced the west landing
    // (AD-040): no car ever parks there, and walking is unrestricted.
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
    // Walking past the parked car's landing never boards (AD-025: the call
    // press is the only board) — both walls are free to walk to.
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
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the east landing
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
    sim.startMove('p1', 'left')
    const exitTick = movedEvents(sim.tick())
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    expect(exitTick.some((e) => e.type === 'player:moved' && e.playerId === 'p1')).toBe(true)
    for (let i = 0; i < 9; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(27) // 30 − 10 walk ticks × 300 millitiles
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
    // Ride the car to floor1 pre-round, exit, and stop near the landing.
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'left')
    sim.tick()
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    sim.stopMove('p1')
    sim.tick()
    const xStart = lastX(sim, 'p1')
    // Lobby phase: walking on floor1 is now allowed.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 10; i++) sim.tick()
    sim.stopMove('p1')
    expect(lastX(sim, 'p1')).toBe(xStart - 3)
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
  it('snapshotForFloor keeps only the viewer-floor players and the single car (WORK-18, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    expect(
      sim
        .snapshotForFloor('lobby')
        .players.map((p) => p.playerId)
        .sort(),
    ).toEqual(['p1', 'p2'])
    expect(sim.snapshotForFloor('lobby').cars).toEqual([{ car: 1, floor: 'lobby' }])
    expect(sim.snapshotForFloor('floor1').players).toEqual([])
    expect(sim.snapshotForFloor('floor1').cars).toEqual([{ car: 1, floor: 'lobby' }])
  })

  it('viewOf: lobby player gets no roomKey, riders get no floor, segments map to keys', () => {
    const sim = new MovementSim()
    sim.join('p1')
    // Lobby center is outside every segment (lobby floor has none).
    expect(sim.viewOf('p1')).toEqual({ floor: 'lobby', roomKey: null, car: null, x: 15000 })

    // Board the parked east car with the landing call press: the rider
    // context loses its floor while in the car (AD-008) and names the ride
    // (AD-013).
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the landing (x=30)
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
    sim.startMove('p1', 'left') // exit through the open doors at the stop
    expect(sim.positionOf('p1')?.floor).toBe('floor1')

    // Exited riders stand at the landing x=30 — outside every segment (AD-010).
    expect(sim.viewOf('p1')).toEqual({ floor: 'floor1', roomKey: null, car: null, x: 30000 })
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
    sim.startMove('p1', 'right')
    for (let i = 0; i < 100 && sim.positionOf('p1')?.x !== 30; i++) sim.tick()
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
    // Stage the single car away: p2 rides to floor1 and stays aboard (doors
    // open there, ELR P3 AC2).
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBeGreaterThan(0) // the car left
    // p1 walks to the EAST landing and calls: the car is busy (dwelling at
    // floor1), so the call queues — the car's attend check closes for it and
    // dispatches to the lobby.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 60; i++) sim.tick() // clamps at the east landing
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('dispatched')
    const flash = huntFlash(sim, 400)
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // While the car is ARRIVING to the lobby, p1 presses again at the landing:
    // the press pends the board (AD-027) — no second press needed once the
    // doors open.
    expect(sim.callElevator('p1')).toBe('ignored')
    for (let i = 0; i < 250 && sim.viewOf('p1').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p1').car).toBe(1)
  })

  it('a doors-open car re-arms its minimum dwell when a ride is queued', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1')
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

  it('arrives at exactly tick 59 after the attend dispatch, dwells at least 60 ticks, and KEEPS the doors open for a caller who never boards (MOVE-11, ELR-14, ELR P3 AC4, AD-027, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // Stage: the car occupied-dwelling at floor1 (p2 stays aboard) — no car
    // stands at the lobby, so p1's mid-hall call queues.
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')

    expect(sim.callElevator('p1')).toBe('dispatched')
    // The attend check closes for the queued call and dispatches: the flash
    // announces it (MOVE-10).
    const flash = huntFlash(sim, 400)
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
    expect(sim.snapshotForFloor('lobby').cars).toEqual([{ car: 1, floor: 'lobby' }])
    expect(sim.viewOf('p2').car).toBe(1) // the carried rider stayed aboard
  })

  it('a mid-hall call with the car occupied-dwelling elsewhere queues; the attending car cannot be re-pressed for its pickup (AD-027, ELR edge, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // The car occupied-dwelling on floor1 (rider stays aboard).
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    // p1 calls from the lobby center: the call queues — the car's attend
    // check closes and dispatches to the lobby.
    expect(sim.callElevator('p1')).toBe('dispatched')
    const flash = huntFlash(sim, 400)
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // The carried rider presses the pickup floor while the car is arriving:
    // the pickup is being served — silently ignored (no zero-tick rides).
    expect(sim.pressFloor('p2', 'lobby')).toBe('ignored')
    // The attend check above fired shortly after the call — assert only that
    // the arrival lands with the carried rider kept aboard.
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBeGreaterThan(0)
    expect(sim.viewOf('p2').car).toBe(1) // the carried rider stays aboard
  })

  it('a call pressed at the landing whose car is busy elsewhere queues and that car attends it (AD-023 degenerate, AD-027, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBeGreaterThan(0) // the car left
    // p1 at the EAST landing: the car is BUSY (dwelling at floor2), so the
    // call queues — no flash yet — and the car's attend check serves it:
    // closing swing, then the dispatch.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick()
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(carEvents(sim.tick())).toEqual([]) // no flash yet: queued
    const flash = huntFlash(sim, 400)
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBe(59)
  })

  it('a call queued while the car RIDES is served at the arrival stop (AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted') // long ride departs
    // p1 calls from the lobby center while the car RIDES: queued, no flash —
    // departures are silent and the queued call flashes only at dispatch.
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(runUntilCarMoved(sim, 1, 'floor3')).toBeGreaterThan(0)
    const flash = huntFlash(sim, 400)
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBeGreaterThan(0)
    expect(sim.snapshotForFloor('lobby').cars).toEqual([{ car: 1, floor: 'lobby' }])
  })

  it('serves presses FIFO in press order at 2 s per floor; a stay-in-car rider keeps riding (ELR P2 AC4, ELR P3 AC2)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1')
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
    boardParkedCar(sim, 'p1')
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
    boardParkedCar(sim, 'p1')
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

  it("boards a call pressed at the parked car's landing; a mid-hall call with the car parked at the pickup floor is a decoy flash (AD-019 degenerate, AD-025, AD-040)", () => {
    const sim = new MovementSim()
    sim.join('p1')
    // p1 rides the car to floor1 and steps off; the car idles there, doors open.
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'left')
    sim.stopMove('p1') // step off and STAY at the east landing
    expect(sim.viewOf('p1').car).toBeNull()
    // Consume the walk-off occupancy update (AD-013) before the calls.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 1, riders: [], queue: [] },
    ])
    // At the landing, the call press IS boarding (AD-025) — and with AD-027
    // the car stands doors-OPEN (nothing to attend), so the caller boards
    // instantly; no car is summoned anywhere.
    expect(sim.callElevator('p1')).toBe('ignored')
    const events = sim.tick()
    const called = events.filter((e) => e.type === 'elevator:called')
    expect(called).toEqual([{ type: 'elevator:called', floor: 'floor1', car: 1 }])
    // No door events and no car moved: the boarding happens through the
    // already-open doors.
    expect(
      events.filter((e) => e.type === 'elevator:moved' || e.type === 'elevator:doors'),
    ).toEqual([])
    expect(sim.viewOf('p1').car).toBe(1)
    // Mid-hall, with the car parked open-doors at the pickup floor, nothing
    // can arrive: the call stays a decoy flash naming car 1 (AD-019's
    // both-parked case, degenerate for the single car).
    sim.startMove('p1', 'left') // walk off through the open doors...
    for (let i = 0; i < 7; i++) sim.tick() // ...and walk mid-hall (2.1 tiles)
    sim.stopMove('p1')
    expect(sim.viewOf('p1').car).toBeNull()
    sim.tick() // consume the walk-off riders update
    expect(sim.callElevator('p1')).toBe('ignored')
    const decoy = sim.tick().filter((e) => e.type === 'elevator:called')
    expect(decoy).toEqual([{ type: 'elevator:called', floor: 'floor1', car: 1 }])
    expect(sim.viewOf('p1').car).toBeNull()
  })

  it("never dispatches for a call pressed at the parked car's own landing — the press boards (AD-023 degenerate, AD-025, AD-040)", () => {
    const sim = new MovementSim()
    sim.join('p1')
    // The car idles open-doors at floor1 (p1 rode it there and stepped off).
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'left')
    sim.stopMove('p1') // step off and STAY at the east landing
    expect(sim.viewOf('p1').car).toBeNull()
    // Consume the walk-off occupancy update (AD-013) before the call.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 1, riders: [], queue: [] },
    ])
    // p1 stands at the landing (the exit places him there): the call press
    // boards him into the car (AD-025) — nothing is dispatched (AD-023's
    // pinned-car rule, degenerate for the single car).
    expect(sim.callElevator('p1')).toBe('ignored')
    expect(sim.tick().filter((e) => e.type === 'elevator:called')).toEqual([
      { type: 'elevator:called', floor: 'floor1', car: 1 },
    ])
    for (let i = 0; i < 80; i++) expect(carEvents(sim.tick())).toEqual([])
    expect(sim.viewOf('p1').car).toBe(1) // re-boarded by his own press
    expect(sim.snapshotForFloor('floor1').cars).toEqual([{ car: 1, floor: 'floor1' }])
  })

  it('a mid-hall call with the car parked at the pickup floor flashes and NEVER moves the car (AD-019 degenerate, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    // The car idles doors-open at floor1 (p1 rode it there and stepped off).
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'left')
    expect(sim.viewOf('p1').car).toBeNull()
    // Consume the walk-off occupancy update (AD-013) before the call.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 1, riders: [], queue: [] },
    ])
    // p1 walks OFF the landing (the stock client's gate would not send from
    // here, but the sim stays robust): the car is parked at the pickup floor
    // with no other car to summon — the call is the decoy flash.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 7; i++) sim.tick() // 2.1 tiles from the landing
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('ignored')
    expect(sim.tick().filter((e) => e.type === 'elevator:called')).toEqual([
      { type: 'elevator:called', floor: 'floor1', car: 1 },
    ])
    // Nothing ever moves: boarding/pressing a parked car is how it moves.
    for (let i = 0; i < 250; i++) {
      expect(carEvents(sim.tick()).some((e) => e.type === 'elevator:moved')).toBe(false)
    }
    expect(sim.snapshotForFloor('floor1').cars).toEqual([{ car: 1, floor: 'floor1' }])
  })

  it('serves two queued calls for different pickups strictly in queue order across attend cycles (MOVE-15, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3', { floor: 'floor1', xMilli: 15000 })
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted') // long ride, rider aboard
    // p1 (lobby center) queues the first call; p3 (standing on floor1) queues
    // the second while the car rides.
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(sim.callElevator('p3')).toBe('dispatched')
    // The floor3 attend check serves the FIRST call (lobby): flash, dispatch,
    // arrival. The lobby stop's attend check then serves the SECOND (floor1).
    expect(huntFlash(sim, 500)).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBeGreaterThan(0)
    expect(huntFlash(sim, 500)).toEqual([{ type: 'elevator:called', floor: 'floor1', car: 1 }])
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBeGreaterThan(0)
    expect(sim.snapshotForFloor('floor1').cars).toEqual([{ car: 1, floor: 'floor1' }])
  })

  it('a duplicate call for an already-queued pickup flashes without double-queuing (AD-012 narrowed, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted') // car rides away
    // p1 (lobby center) queues the first lobby call — no flash while queued;
    // the tick after the call flushes p2's rider-exclusive press announce.
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(carEvents(sim.tick())).toEqual([
      { type: 'elevator:pressed', playerId: 'p2', floor: 'floor3', car: 1 },
    ])
    // p3's call for the SAME pickup is a queued-duplicate: it flashes
    // immediately (the panel pulse) without adding a second queue entry.
    expect(sim.callElevator('p3')).toBe('ignored')
    expect(sim.tick().filter((e) => e.type === 'elevator:called')).toEqual([
      { type: 'elevator:called', floor: 'lobby', car: 1 },
    ])
    // Exactly one dispatch flash follows (the attend check serving the single
    // queue entry) — a double entry would flash and dispatch twice.
    const flashes: MovementEvent[] = []
    for (let i = 0; i < 400; i++) {
      flashes.push(...carEvents(sim.tick()).filter((e) => e.type === 'elevator:called'))
    }
    expect(flashes).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    expect(sim.snapshotForFloor('lobby').cars).toEqual([{ car: 1, floor: 'lobby' }])
  })

  it('drops a boarding player queued call (AD-012 #3: no car to an abandoned floor)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3', { floor: 'floor1', xMilli: 15000 })
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted') // car departs, rider aboard
    // p3 (on floor1) queues a floor1 call while the car rides.
    expect(sim.callElevator('p3')).toBe('dispatched')
    // p3 walks to the landing; the queued call makes his landing press a
    // queued-duplicate flash (the car is still riding).
    sim.startMove('p3', 'right')
    for (let i = 0; i < 50; i++) sim.tick()
    sim.stopMove('p3')
    expect(sim.callElevator('p3')).toBe('ignored')
    // The car arrives at floor1 (carrying p2) and opens its doors: p3's
    // landing press boards him instantly.
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBeGreaterThan(0)
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    expect(sim.callElevator('p3')).toBe('ignored') // parked-car press: boards
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p3').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p3').car).toBe(1)
    // Boarding drops the boarder's own queued call (AD-012 #3): no car may
    // ever be summoned to a floor they left. Tick past the stop's end — a
    // surviving call would flash at the attend check and dispatch a phantom
    // floor1 pickup.
    const tail: MovementEvent[] = []
    for (let i = 0; i < 200; i++) tail.push(...sim.tick())
    expect(tail.filter((e) => e.type === 'elevator:called')).toEqual([])
    expect(sim.snapshotForFloor('floor1').cars).toEqual([{ car: 1, floor: 'floor1' }])
  })

  it('serves a call queued at the buzzer once the car frees (EL-02, AD-011)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted')
    expect(sim.callElevator('p1')).toBe('dispatched') // queued: the car is busy
    sim.tick()
    // AD-011: the queue is NOT cleared (it belongs to the car, never to the
    // phase). The car's attend check dispatches the queued lobby pickup (one
    // flash) and completes the trip.
    let flashes = 0
    for (let i = 0; i < 400; i++) {
      flashes += carEvents(sim.tick()).filter((e) => e.type === 'elevator:called').length
    }
    expect(flashes).toBe(1)
    expect(sim.snapshotForFloor('lobby').cars).toEqual([{ car: 1, floor: 'lobby' }])
  })

  it('serves the queue as a ghost trip after the presser walks off (ELR P3 AC3)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1')
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
    sim.startMove('p1', 'left') // walk-off through the open doors
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
    expect(sim.snapshotForFloor('lobby').cars).toEqual([{ car: 1, floor: 'floor2' }])
  })

  it('declines a call press into a full car; a freed slot admits the next press (MOVE-13 capacity, ELR P2 AC8, AD-025)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    sim.join('p4')
    // Fill the parked east car to capacity 2 via landing call presses.
    boardParkedCar(sim, 'p1')
    boardParkedCar(sim, 'p2')
    // p3 walks to the east landing: the car stands full with doors open.
    sim.startMove('p3', 'right')
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
    sim.startMove('p1', 'left')
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
    boardParkedCar(sim, 'p1')
    // p1 exits and stays inside the boarding radius: no proximity re-board,
    // no board/exit oscillation, no event spam — boarding is the explicit
    // call press now.
    sim.startMove('p1', 'left')
    sim.stopMove('p1')
    expect(sim.viewOf('p1').car).toBeNull()
    expect(lastX(sim, 'p1')).toBe(30)
    for (let i = 0; i < 30; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
      expect(lastX(sim, 'p1')).toBe(30)
    }
    // The car's doors stay OPEN here (AD-027: nothing to attend): p1's call
    // press boards him instantly through them (AD-025).
    expect(sim.callElevator('p1')).toBe('ignored')
    sim.tick() // flush the boarding events
    expect(sim.viewOf('p1').car).toBe(1)
    // p2 boards alongside (capacity 2) and the re-boarded rider rides along.
    boardParkedCar(sim, 'p2')
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
    // Pre-round: board the parked east car and press floor1 — no round needed.
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(
      DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1,
    )
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    // Exit through the open doors pre-round: allowed in ANY door-open moment
    // (AD-015, AD-026 gate).
    sim.startMove('p1', 'left')
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    expect(lastX(sim, 'p1')).toBe(30)
    // Hallway walking is now allowed pre-round (AD-015): the exiter leaves the
    // landing and cannot board by walking — boarding is the explicit call
    // press (AD-025); they only walk 1.5 tiles into the hall here, and never
    // press.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 25; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
    }
    expect(lastX(sim, 'p1')).toBe(22.5)
    // Walking back part-way does not board either (no press, no board).
    sim.startMove('p1', 'right')
    for (let i = 0; i < 5; i++) sim.tick()
    expect(sim.viewOf('p1').car).toBeNull()
  })

  it('a direction held through the opening swing exits the tick the doors are fully open (AD-026)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    // Ride to floor2 (two floors): the stop must finish first (dwell tail +
    // closing).
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(3 * RIDE_TICKS_PER_FLOOR)
    // The arrival moved lands at the START of the opening swing (AD-026):
    // the rider holds a direction NOW (the client sends the intent once) —
    // the hop-off applies the tick the doors are fully open, never mid-swing.
    sim.startMove('p1', 'left')
    for (let i = 0; i < DOOR_TICKS - 1; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBe(1) // still aboard: doors not fully open
    }
    sim.tick() // the doors finish opening: the held exit applies now
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor2')
    expect(sim.positionOf('p1')?.x).toBe(30) // the exit pins the landing x
    sim.tick() // the held walk resumes on the floor
    expect(sim.positionOf('p1')?.x).toBe(29.7)
  })

  it('releasing the direction while the exit is pending cancels it (AD-026 held-intent rule)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(3 * RIDE_TICKS_PER_FLOOR)
    // Pend the exit during the opening swing, then release before the doors
    // are fully open: the hop-off never applies.
    sim.startMove('p1', 'left')
    sim.stopMove('p1')
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    expect(sim.viewOf('p1').car).toBe(1) // still aboard: the exit was cancelled
  })

  it('a direction held during the ride or the closing swing never exits (MOVE-09, AD-026)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    // Let the boarding stop finish: attend → closing swing → departure.
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    // Held during the ride: consumed while the doors are shut — no pending
    // exit, no exit when the doors open at the stop.
    sim.startMove('p1', 'left')
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
    sim.startMove('p1', 'left')
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
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted') // 120-tick ride
    // The just-opened stop must finish first (surviving dwell + closing
    // swing, AD-026) — holding a direction NOW would walk off instead.
    for (let i = 0; i < DWELL_TICKS - 1 + DOOR_TICKS; i++) sim.tick()
    const xInCar = lastX(sim, 'p1')
    sim.startMove('p1', 'left') // doors shut: riding — ignored (MOVE-09)
    for (let i = 0; i < 40; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(xInCar)
    expect(sim.viewOf('p1').car).toBe(1) // still riding: the held ticks never exit
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBeGreaterThan(0) // ride completes
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    // Open doors: the same intent now exits at the served floor.
    // MOVE-16 payload purity: occupancy never rides any public event (the
    // registry pins in T4 carry the wire half of this guarantee).
    sim.startMove('p1', 'left')
    sim.tick()
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor2')
    expect(sim.positionOf('p1')?.x).toBe(29.7) // walking continues (AD-015)
  })

  it('dispatches a different-pickup call while the car is mid-arrival elsewhere (AD-012 narrowed: pickup-only predicate, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3', { floor: 'floor1', xMilli: 15000 })
    // The car departs to floor1 with p2 aboard.
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    // p1 (lobby center) calls: the call queues and the car's attend check
    // dispatches it — the flash announces the dispatch (MOVE-10). The car is
    // now ARRIVING to the lobby.
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(huntFlash(sim, 500)).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // p3's call from floor1 is a DIFFERENT pickup: the mid-arrival car must
    // not swallow it (the old destination-only decoy is dead — AD-012). The
    // call queues and dispatches when the car idles at the lobby.
    expect(sim.callElevator('p3')).toBe('dispatched')
    const flash2 = huntFlash(sim, 500)
    expect(flash2).toEqual([{ type: 'elevator:called', floor: 'floor1', car: 1 }])
  })

  it('replays a 200-tick scripted dwell+queue sequence bit-for-bit across two runs (MOVE-17 determinism)', () => {
    const run = () => {
      const sim = new MovementSim()
      sim.join('p1')
      sim.join('p2')
      boardParkedCar(sim, 'p1')
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
      cars: [{ car: 1, floor: 'lobby' }],
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
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the east landing
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
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the east landing
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
    boardParkedCar(sim, 'p1') // flushes ['p1']
    boardParkedCar(sim, 'p2') // flushes ['p1', 'p2']
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted') // departs after the stop
    // The staging walk consumed much of the minimum dwell — the attend
    // check fires shortly after the press; only the arrival matters here.
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBeGreaterThan(0)
    // During the open-door dwell: p2 queues another floor, then p1 walks
    // off. The walk-off update carries the car's survivors AND its queued
    // floors.
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    expect(sim.pressFloor('p2', 'floor2')).toBe('accepted')
    sim.startMove('p1', 'left')
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
    boardParkedCar(sim, 'p1')
    boardParkedCar(sim, 'p2') // boarding updates flushed by the helper
    sim.leave('p1')
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 1, riders: ['p2'], queue: [] },
    ])
    for (let i = 0; i < 10; i++) {
      expect(sim.tick().some((e) => e.type === 'elevator:riders')).toBe(false)
    }
  })

  it('gives riders players:[], the public car floor, and carOccupants; floor snapshots never carry occupancy (ELR-03, ELR-04, AD-040)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted') // queue into the snapshot
    const riderSnap = sim.snapshotFor('p1')
    expect(riderSnap.players).toEqual([]) // no floor stream in a car (AD-009)
    expect(riderSnap.cars).toEqual([{ car: 1, floor: 'lobby' }])
    expect(riderSnap.carOccupants).toEqual({ car: 1, riders: ['p1'], queue: ['floor2'] })
    // Non-rider snapshots are byte-identical to the public shape — no
    // occupancy field anywhere.
    const floorSnap = sim.snapshotForFloor('lobby')
    expect(floorSnap).toEqual({
      players: [{ playerId: 'p2', floor: 'lobby', x: 15 }],
      cardedRooms: [],
      cars: [{ car: 1, floor: 'lobby' }],
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
    boardParkedCar(sim, 'p1')
    // Exit with a 3-tick walk (0.9 tiles): still inside the 1-tile radius.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 3; i++) sim.tick()
    sim.stopMove('p1')
    sim.tick()
    expect(lastX(sim, 'p1')).toBe(29.1)
    // Linger: no proximity board/exit oscillation exists anymore.
    for (let i = 0; i < 10; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
    }
  })

  it('a re-boarded exiter (via the landing call press) presses and rides normally', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 10; i++) sim.tick() // walk away from the landing
    sim.stopMove('p1')
    sim.tick()
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick() // walk back to the landing (x=30)
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
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the east landing
    sim.stopMove('p1')
    sim.callElevator('p1') // parked-car press: doors open, then boards (AD-025/026)
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p1').car === null; i++) sim.tick()
    sim.tick() // flush the boarding events
    sim.pressFloor('p1', 'floor1')
    for (let i = 0; i < DWELL_TICKS + DOOR_TICKS + 2 * RIDE_TICKS_PER_FLOOR - 1; i++) sim.tick()
    for (let i = 0; i < DOOR_TICKS; i++) sim.tick() // the doors finish opening
    sim.startMove('p1', 'left') // exit at the floor1 landing
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
    riding.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) riding.tick() // walk to the east landing
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
  const LANDING_X = HALL_LENGTH_TILES * 1000

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
    sim.join('guest:1', { kind: 'guest', floor: 'lobby', xMilli: LANDING_X })
    sim.join('p2')
    sim.tick()
    // The guest boards the car via the parked-car landing press (AD-025).
    sim.callElevator('guest:1')
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('guest:1').car === null; i++) sim.tick()
    expect(sim.viewOf('guest:1').car).toBe(1)
    // Boarding a guest emits NO player:left-floor (that names a player).
    expect(sim.guestIds()).toEqual(['guest:1'])
    // p2 presses at the same landing: the car has 1 guest + 0 players = room
    // for one more; a third candidate would be declined silently.
    sim.join('p2', { floor: 'lobby', xMilli: LANDING_X })
    sim.callElevator('p2')
    for (let i = 0; i <= DOOR_TICKS && sim.viewOf('p2').car === null; i++) sim.tick()
    expect(sim.viewOf('p2').car).toBe(1)
    // Now the car is full (1 player + 1 guest = capacity 2): a third press declines.
    sim.join('p3', { floor: 'lobby', xMilli: LANDING_X })
    const before = sim.viewOf('p3')
    sim.callElevator('p3')
    for (let i = 0; i <= DOOR_TICKS + 2; i++) sim.tick()
    expect(sim.viewOf('p3')).toEqual(before) // still standing at the landing
  })

  it('riders learn about a guest co-rider via elevator:riders guests — absent when none', () => {
    const sim = new MovementSim()
    sim.join('p1', { floor: 'lobby', xMilli: LANDING_X })
    sim.join('guest:1', { kind: 'guest', floor: 'lobby', xMilli: LANDING_X })
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
    boardParkedCar(sim, 'p1')
    const snap = sim.snapshotFor('p1')
    expect(snap.carOccupants).toBeDefined()
    expect(snap.carOccupants?.guests).toBeUndefined()
    expect(snap.carOccupants?.riders).toEqual(['p1'])
  })

  it('a guest press in-car queues silently — no elevator:pressed testimony event', () => {
    const sim = new MovementSim()
    sim.join('p1', { floor: 'lobby', xMilli: LANDING_X })
    sim.join('guest:1', { kind: 'guest', floor: 'lobby', xMilli: LANDING_X })
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

// --- Cycle 3.E (AD-040): the single-car collapse. sim:stairs_one_car pins:
// exactly one car in state/snapshots/payloads, its landing at the EAST end,
// and the west end free of any elevator interaction.
describe('sim:stairs_one_car', () => {
  it('reports exactly one car in carFloors, floor snapshots, and rider snapshots (STAIRS-01)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.tick()
    expect(sim.carFloors()).toEqual([{ car: 1, floor: 'lobby' }])
    expect(sim.snapshotForFloor('lobby').cars).toEqual([{ car: 1, floor: 'lobby' }])
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    expect(sim.snapshotFor('p1').cars).toEqual([{ car: 1, floor: 'lobby' }])
    expect(sim.snapshotFor('p2').cars).toEqual([{ car: 1, floor: 'lobby' }])
    // No payload anywhere ever names car 2.
    sim.tick()
  })

  it("the car's landing is the EAST end; the west end is never an elevator landing (STAIRS-01, AD-040)", () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // A caller at the west end (where the stairwell now sits) summons the car
    // as a MID-HALL caller: the car dispatches to the lobby from wherever it
    // is — no landing-pin semantics apply at x=0.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 60; i++) sim.tick()
    sim.stopMove('p1')
    expect(lastX(sim, 'p1')).toBe(0)
    // The car is parked at the pickup floor (the lobby) with no other car:
    // AD-019's mid-hall degenerate — the decoy flash, never a dispatch. The
    // caller walks east and boards through the landing press.
    expect(sim.callElevator('p1')).toBe('ignored')
    expect(sim.tick().filter((e) => e.type === 'elevator:called')).toEqual([
      { type: 'elevator:called', floor: 'lobby', car: 1 },
    ])
    for (let i = 0; i < 100; i++) {
      expect(carEvents(sim.tick()).some((e) => e.type === 'elevator:moved')).toBe(false)
    }
    // The east landing is the boarding zone: a caller there with the parked
    // car boards through the landing press (AD-025).
    boardParkedCar(sim, 'p2')
    expect(sim.viewOf('p2').car).toBe(1)
  })

  it('every elevator event names car 1 only (STAIRS-02)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1')
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    boardParkedCar(sim, 'p2')
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted')
    const seen: MovementEvent[] = []
    for (let i = 0; i < 500; i++) seen.push(...sim.tick())
    for (const e of seen) {
      if (
        e.type === 'elevator:called' ||
        e.type === 'elevator:moved' ||
        e.type === 'elevator:doors' ||
        e.type === 'elevator:pressed' ||
        e.type === 'elevator:riders'
      ) {
        expect(e.car).toBe(1)
      }
    }
  })
})

// --- Cycle 3.E (AD-040): the stairs transit channel. sim:stairs_transit pins
// the west stairwell: 3 s transit + 2 s breath per floor stride, departure
// observable / interior silent / arrival via the resumed stream, the
// floorless black-box policy, and every silent rejection branch.

/** Join a player standing exactly at the stairwell mouth (x=0, any floor). */
function joinAtMouth(sim: MovementSim, playerId: string, floor: FloorId = 'lobby'): void {
  sim.join(playerId, { floor, xMilli: 0 })
}

/** The whole stairs visit in ticks: entry flush, 60-tick transit, 40-tick breath. */
function runTransit(
  sim: MovementSim,
  playerId: string,
  dir: 'up' | 'down',
): { arrivalAt: number; breathEndsAt: number } {
  expect(sim.enterStairs(playerId, dir)).toBe('entered')
  sim.tick() // the entry flush: player:left-floor
  let arrivalAt = -1
  let breathEndsAt = -1
  for (let i = 1; i <= 200; i++) {
    const st = sim.stairsStateOf(playerId)
    if (st === undefined) {
      breathEndsAt = i
      break
    }
    if (st.phase === 'breath' && arrivalAt === -1) arrivalAt = i
    sim.tick()
  }
  return { arrivalAt, breathEndsAt }
}

describe('sim:stairs_transit', () => {
  it('enters at the west mouth and rides STAIRS_TRANSIT_SECONDS per stride (STAIRS-05)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'p1')
    expect(sim.enterStairs('p1', 'up')).toBe('entered')
    expect(sim.stairsStateOf('p1')).toMatchObject({
      from: 'lobby',
      to: 'mezzanine',
      dir: 1,
      phase: 'transit',
    })
    // Entry flushes on the NEXT tick (MOVE-10 intent-time pattern). The flush
    // tick is transit tick 1 of 60.
    expect(sim.tick()).toEqual([{ type: 'player:left-floor', playerId: 'p1', floor: 'lobby' }])
    for (let i = 0; i < 58; i++) sim.tick() // transit ticks 2..59
    expect(sim.stairsStateOf('p1')?.phase).toBe('transit')
    sim.tick() // transit tick 60: arrival
    expect(sim.positionOf('p1')).toMatchObject({ floor: 'mezzanine', x: 0 })
    expect(sim.stairsStateOf('p1')?.phase).toBe('breath')
  })

  it('holds the arrival breath for STAIRS_BREATH_SECONDS, then frees the player (STAIRS-06)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'p1')
    const { arrivalAt, breathEndsAt } = runTransit(sim, 'p1', 'up')
    expect(arrivalAt).toBe(TUNING.STAIRS_TRANSIT_SECONDS * TICK_HZ)
    expect(breathEndsAt).toBe(
      TUNING.STAIRS_TRANSIT_SECONDS * TICK_HZ + TUNING.STAIRS_BREATH_SECONDS * TICK_HZ,
    )
    expect(sim.stairsStateOf('p1')).toBeUndefined()
    // Freed: the player acts normally again.
    expect(sim.enterStairs('p1', 'up')).toBe('entered')
  })

  it('the breath is immobile: held direction keys change nothing (STAIRS-06)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'p1')
    sim.enterStairs('p1', 'up')
    for (let i = 0; i < 60; i++) sim.tick()
    expect(sim.stairsStateOf('p1')?.phase).toBe('breath')
    const before = sim.positionOf('p1')
    sim.startMove('p1', 'right')
    const events: MovementEvent[] = []
    for (let i = 0; i < 10; i++) events.push(...sim.tick())
    expect(sim.positionOf('p1')).toEqual(before)
    expect(movedEvents(events).filter((e) => e.playerId === 'p1')).toHaveLength(1) // arrival flush only
    sim.stopMove('p1')
  })

  it('publishes only the departure and the arrival — the interior is silent (STAIRS-07)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'p1')
    joinAtMouth(sim, 'p2', 'floor1')
    expect(sim.enterStairs('p1', 'up')).toBe('entered')
    const events: MovementEvent[] = []
    for (let i = 0; i <= 60 + TUNING.STAIRS_BREATH_SECONDS * TICK_HZ; i++) {
      events.push(...sim.tick())
    }
    const own = events.filter((e) => e.type === 'player:moved' && e.playerId === 'p1')
    // Exactly ONE player:moved for the transiter across the whole visit: the
    // arrival flush (next tick after arrival — mirrors exitCar).
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({ playerId: 'p1', floor: 'mezzanine', x: 0 })
    // The departure is observable to the origin floor: player:left-floor.
    expect(events).toContainEqual({ type: 'player:left-floor', playerId: 'p1', floor: 'lobby' })
  })

  it('is floorless inside: viewOf, allPositions, and floor snapshots exclude the occupant (STAIRS-07)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'p1')
    joinAtMouth(sim, 'watcher')
    sim.enterStairs('p1', 'up')
    sim.tick()
    expect(sim.viewOf('p1')).toEqual({ floor: null, roomKey: null, car: null, x: null })
    expect(sim.allPositions().some((r) => r.playerId === 'p1')).toBe(false)
    expect(sim.allPositions().some((r) => r.playerId === 'watcher')).toBe(true)
    expect(sim.snapshotForFloor('lobby').players.some((r) => r.playerId === 'p1')).toBe(false)
    expect(sim.snapshotForFloor('lobby').players.some((r) => r.playerId === 'watcher')).toBe(true)
  })

  it("the occupant's personal snapshot carries the stairs row; others' stay byte-identical (STAIRS-08)", () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'p1')
    joinAtMouth(sim, 'p2')
    sim.enterStairs('p1', 'up')
    sim.tick()
    const own = sim.snapshotFor('p1')
    expect(own.players).toEqual([])
    expect(own.stairs).toMatchObject({ from: 'lobby', to: 'mezzanine', phase: 'transit' })
    expect(own.stairs?.remainingSeconds).toBeGreaterThan(0)
    expect(own.stairs?.remainingSeconds).toBeLessThanOrEqual(TUNING.STAIRS_TRANSIT_SECONDS)
    const other = sim.snapshotFor('p2')
    expect('stairs' in other).toBe(false)
    expect(other.players.some((r) => r.playerId === 'p1')).toBe(false)
    // Breath phase keeps the row (the recipient is still in the stairwell).
    for (let i = 0; i < 59; i++) sim.tick()
    expect(sim.snapshotFor('p1').stairs?.phase).toBe('breath')
  })

  it('ignores direction keys mid-transit and a second entry while inside (STAIRS-09)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'p1')
    expect(sim.enterStairs('p1', 'up')).toBe('entered')
    sim.tick()
    expect(sim.enterStairs('p1', 'up')).toBe('ignored')
    expect(sim.enterStairs('p1', 'down')).toBe('ignored')
    const pos = sim.positionOf('p1')
    sim.startMove('p1', 'left')
    sim.startMove('p1', 'right')
    expect(sim.positionOf('p1')).toEqual(pos)
    expect(sim.stairsStateOf('p1')?.phase).toBe('transit')
    // The held-move attempt must not leak events either.
    expect(movedEvents(sim.tick()).filter((e) => e.playerId === 'p1')).toHaveLength(0)
  })

  it('rejects silently: mid-hall, beyond the mouth scale, and terminal directions (STAIRS-10)', () => {
    const sim = new MovementSim()
    sim.join('mid', { xMilli: 15000 })
    expect(sim.enterStairs('mid', 'up')).toBe('ignored')
    sim.join('edge', { xMilli: 1001 }) // one milli past the mouth scale
    expect(sim.enterStairs('edge', 'up')).toBe('ignored')
    sim.join('rim', { xMilli: 1000 }) // exactly ELEVATOR_LANDING_TILES: inside
    expect(sim.enterStairs('rim', 'up')).toBe('entered')
    sim.join('top', { floor: 'floor3', xMilli: 0 })
    expect(sim.enterStairs('top', 'up')).toBe('ignored')
    joinAtMouth(sim, 'bottom')
    expect(sim.enterStairs('bottom', 'down')).toBe('ignored') // lobby down
  })

  it('rejects silently: in a car, a guest, and elevator calls from inside (STAIRS-11)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'rider')
    boardParkedCar(sim, 'rider')
    expect(sim.enterStairs('rider', 'up')).toBe('ignored')
    sim.join('guest', { kind: 'guest', xMilli: 0 })
    expect(sim.enterStairs('guest', 'up')).toBe('ignored')
    // The call channel is shut inside the black box: no flash leaves the
    // stairwell, and a mid-breath player summons nothing.
    joinAtMouth(sim, 'breather')
    sim.enterStairs('breather', 'up')
    for (let i = 0; i < 60; i++) sim.tick()
    expect(sim.stairsStateOf('breather')?.phase).toBe('breath')
    expect(sim.callElevator('breather')).toBe('rejected')
    expect(sim.tick().some((e) => e.type === 'elevator:called')).toBe(false)
  })

  it('rides the FLOOR_IDS adjacency both ways through the mezzanine (STAIRS-05)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'up1', 'floor1')
    joinAtMouth(sim, 'down1', 'mezzanine')
    expect(sim.enterStairs('up1', 'up')).toBe('entered')
    expect(sim.enterStairs('down1', 'down')).toBe('entered')
    expect(sim.stairsStateOf('up1')).toMatchObject({ from: 'floor1', to: 'floor2' })
    expect(sim.stairsStateOf('down1')).toMatchObject({ from: 'mezzanine', to: 'lobby', dir: -1 })
    for (let i = 0; i < 61; i++) sim.tick()
    expect(sim.positionOf('up1')).toMatchObject({ floor: 'floor2', x: 0 })
    expect(sim.positionOf('down1')).toMatchObject({ floor: 'lobby', x: 0 })
  })

  it('drops the stairs state when the player leaves mid-transit (FR-25 seat loss)', () => {
    const sim = new MovementSim()
    joinAtMouth(sim, 'p1')
    sim.enterStairs('p1', 'up')
    sim.tick()
    sim.leave('p1')
    expect(sim.stairsStateOf('p1')).toBeUndefined()
    sim.join('p1')
    expect(sim.viewOf('p1').floor).toBe('lobby')
  })
})
