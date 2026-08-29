import type { FloorId, MovementEvent } from '@turnover/shared'
import { HALL_LENGTH_TILES, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { DWELL_TICKS, MovementSim, RIDE_TICKS_PER_FLOOR, SPEED_MILLI_PER_TICK } from './movement.js'
import { TICK_HZ } from './tick.js'

function movedEvents(events: readonly MovementEvent[]) {
  return events.filter((e) => e.type === 'player:moved')
}

function lastX(sim: MovementSim, playerId: string): number {
  return sim.positionOf(playerId)?.x ?? Number.NaN
}

function carEvents(events: readonly MovementEvent[]) {
  return events.filter((e) => e.type !== 'player:moved')
}

/**
 * Walk a player from the lobby center into a PARKED car's 1-tile boarding
 * zone: auto-boarding runs every open-door tick (AD-014), so the player is
 * caught at 0.9 tiles out (tick 47 from center) and snapped to the landing.
 */
function boardParkedCar(sim: MovementSim, playerId: string, carId: 1 | 2): void {
  sim.startMove(playerId, carId === 1 ? 'left' : 'right')
  for (let i = 0; i < 100 && sim.viewOf(playerId).car !== carId; i++) sim.tick()
  sim.stopMove(playerId)
  expect(sim.viewOf(playerId).car).toBe(carId)
  // Consume the AD-013 occupancy update that flushes on the tick after any
  // boarding (full-payload pins live in the ELR P1 describe below).
  sim.tick()
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
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
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
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(2 * RIDE_TICKS_PER_FLOOR)
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
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
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
    for (let i = 0; i < 50; i++) sim.tick() // walk into the parked west car's zone
    expect(sim.viewOf('p1').car).toBe(1) // auto-boarded at 0.9 tiles out (AD-014)
    // In-car destination choice: press floor1 and ride (AD-014 press queue).
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
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
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
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
    expect(sim.viewOf('p1')).toEqual({ floor: 'lobby', roomKey: null, car: null })

    // Board the parked west car: the rider context loses its floor while in
    // the car (AD-008) and names the ride (AD-013).
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // walk into the boarding zone
    sim.stopMove('p1')
    expect(sim.viewOf('p1')).toEqual({ floor: null, roomKey: null, car: 1 })

    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    for (let i = 0; i < RIDE_TICKS_PER_FLOOR; i++) sim.tick() // ride lobby → floor1
    sim.startMove('p1', 'right') // exit through the open doors at the stop
    expect(sim.positionOf('p1')?.floor).toBe('floor1')

    // Exited riders stand at the landing x=0 — outside every segment (AD-010).
    expect(sim.viewOf('p1')).toEqual({ floor: 'floor1', roomKey: null, car: null })
  })
})

// Spec MOVE-09..18 + ELR P2/P3 (gate scenario sim:elevator): the press-queue
// car machine over the pure sim. Ticks are the only clock: arrival = 60 ticks,
// ride = 40/floor, dwell = 20 ticks at EVERY stop. Calls carry no destination;
// the destination is an in-car press (AD-014).
describe('sim:elevator', () => {
  it('pins the dwell literal: exactly 20 ticks derived from ELEVATOR_DWELL_SECONDS × TICK_HZ (ELR-14)', () => {
    // Spec-precision pin (ELR P3 AC1): every dwell assertion elsewhere is
    // constant-relative, so a tuning drift (e.g. 0.95 s → 19 ticks) must fail
    // HERE, not survive the suite.
    expect(TUNING.ELEVATOR_DWELL_SECONDS).toBe(1)
    expect(DWELL_TICKS).toBe(TUNING.ELEVATOR_DWELL_SECONDS * TICK_HZ)
    expect(DWELL_TICKS).toBe(20)
  })

  it('arrives at exactly tick 60, dwells exactly 20 ticks, and idles for a caller who never boards (MOVE-11, ELR-14, ELR P3 AC4)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Stage: car 1 empty-idle on floor1, car 2 occupied-idle on floor2 — no
    // car stands at the lobby, so p1's call dispatches.
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    sim.startMove('p2', 'right') // step off through the open doors
    expect(sim.viewOf('p2').car).toBeNull()
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(2 * RIDE_TICKS_PER_FLOOR)
    expect(sim.viewOf('p3').car).toBe(2) // stay-in-car: no auto-exit (ELR P3 AC2)

    expect(sim.callElevator('p1')).toBe('dispatched')
    // Tick 1 announces the call (panel flash, MOVE-10); the car arrives at 60.
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    for (let i = 0; i < 58; i++) expect(carEvents(sim.tick())).toEqual([])
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:moved', car: 1, floor: 'lobby' }])
    // ELR-14: exactly 20 open-door dwell ticks (61..80) at the pickup floor.
    for (let i = 0; i < DWELL_TICKS; i++) expect(carEvents(sim.tick())).toEqual([])
    // The dwell expires with an empty queue: the car idles open-doors at the
    // pickup floor — the caller (mid-hall, out of boarding range) never
    // boarded and nothing auto-proceeds (ELR P3 AC4).
    expect(carEvents(sim.tick())).toEqual([])
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'floor2' },
    ])
  })

  it('drafts an empty idle car even when an occupied idle car is closer (AD-014 dispatch preference)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Car 1 empty-idle on floor1 (rider stepped off), car 2 occupied-idle on
    // floor2 (rider stays aboard).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    sim.startMove('p2', 'right')
    expect(sim.viewOf('p2').car).toBeNull()
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(2 * RIDE_TICKS_PER_FLOOR)
    // p1 calls from the EAST landing: the occupied car 2 is 0 tiles away, the
    // empty car 1 is 30 — the EMPTY idle car must still be drafted first.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick()
    sim.stopMove('p1')
    expect(lastX(sim, 'p1')).toBe(30)
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // The flash tick above already counted toward the 60-tick arrival.
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBe(59)
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'floor2' },
    ])
  })

  it('dispatches the empty idle car closest to the caller (AD-014: closest landing)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    sim.startMove('p2', 'right')
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(2 * RIDE_TICKS_PER_FLOOR)
    sim.startMove('p3', 'left') // p3 steps off on floor2: car 2 empty-idle too
    // p1 at the EAST landing: car 2 (0 tiles) over car 1 (30 tiles).
    sim.startMove('p1', 'right')
    for (let i = 0; i < 50; i++) sim.tick()
    sim.stopMove('p1')
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 2 }])
  })

  it('drafts an occupied idle car only when no empty idle car exists; the carried rider cannot re-press the pickup (AD-014, ELR edge)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Both cars occupied-idle on guest floors (riders stay aboard).
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(2 * RIDE_TICKS_PER_FLOOR)
    // p1 calls from the lobby center: no empty idle car exists — the
    // occupied-idle car 1 is drafted (closest landing, tie → car 1).
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // The carried rider presses the pickup floor while the car is arriving:
    // the pickup is being served — silently ignored (no zero-tick rides).
    expect(sim.pressFloor('p2', 'lobby')).toBe('ignored')
    for (let i = 0; i < 58; i++) {
      expect(carEvents(sim.tick()).some((e) => e.type === 'elevator:pressed')).toBe(false)
    }
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:moved', car: 1, floor: 'lobby' }])
    expect(sim.viewOf('p2').car).toBe(1) // the carried rider stays aboard
  })

  it('serves presses FIFO in press order at 2 s per floor; a stay-in-car rider keeps riding (ELR P2 AC4, ELR P3 AC2)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor3')).toBe('accepted')
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted') // queued behind floor3
    // lobby → floor3: 3 floors × 40 ticks (§7 ELEVATOR_RIDE_SECONDS_PER_FLOOR).
    expect(runUntilCarMoved(sim, 1, 'floor3')).toBe(3 * RIDE_TICKS_PER_FLOOR)
    // The arrival dwell (20 ticks, departure silent) ends into the NEXT
    // queued floor — FIFO.
    for (let i = 0; i < DWELL_TICKS; i++) expect(carEvents(sim.tick())).toEqual([])
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(2 * RIDE_TICKS_PER_FLOOR)
    expect(sim.viewOf('p1').car).toBe(1) // stay-in-car: no forced exit
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    // Queue empty: the dwell ends into an open-doors idle with the rider aboard.
    for (let i = 0; i < DWELL_TICKS; i++) sim.tick()
    expect(sim.viewOf('p1').car).toBe(1)
    // A press into the idling car departs it immediately (ELR P2 AC5).
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(RIDE_TICKS_PER_FLOOR)
  })

  it('rejects presses silently: duplicate, being-served, current-floor-while-open, and non-rider (ELR P2 AC2/AC3)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'lobby')).toBe('ignored') // current floor, doors open — walk
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    expect(sim.pressFloor('p1', 'floor2')).toBe('ignored') // being served (queue head)
    expect(sim.pressFloor('p2', 'floor3')).toBe('rejected') // non-rider
    // Silence: exactly ONE press event reaches the next tick — the accepted one.
    expect(sim.tick().filter((e) => e.type === 'elevator:pressed')).toEqual([
      { type: 'elevator:pressed', playerId: 'p1', floor: 'floor2', car: 1 },
    ])
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(2 * RIDE_TICKS_PER_FLOOR - 1) // one ride tick elapsed above
    expect(sim.pressFloor('p1', 'floor2')).toBe('ignored') // current floor while dwelling
    // The origin floor is queueable while stopped elsewhere — a return trip.
    expect(sim.pressFloor('p1', 'lobby')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBe(DWELL_TICKS + 2 * RIDE_TICKS_PER_FLOOR)
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

  it('treats same-floor calls at an open-doors car as decoy flashes without dispatch (MOVE-12, ELR P3 AC5)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    // p1 rides car 1 to floor1 and steps off; car 1 idles there, doors open.
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    sim.startMove('p1', 'right')
    expect(sim.viewOf('p1').car).toBeNull()
    // p2 joins p1 on floor1 via car 2 (east landing), also stepping off.
    boardParkedCar(sim, 'p2', 2)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    sim.startMove('p2', 'left')
    expect(sim.viewOf('p2').car).toBeNull()
    // Consume the walk-off occupancy update (AD-013) before the calls.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 2, riders: [], queue: [] },
    ])
    // Boarding and pressing is the way to move an open-doors car: a call from
    // its floor is a duplicate — the decoy flashes, nothing dispatches.
    expect(sim.callElevator('p1')).toBe('ignored')
    expect(sim.callElevator('p2')).toBe('ignored')
    const events = sim.tick()
    const called = events.filter((e) => e.type === 'elevator:called')
    expect(called).toEqual([
      { type: 'elevator:called', floor: 'floor1', car: 1 },
      { type: 'elevator:called', floor: 'floor1', car: 1 },
    ])
    expect(events.filter((e) => e.type === 'elevator:moved')).toEqual([])
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
    // The next tick announces p3's press (rider-exclusive); the queued call
    // itself flashes only at dispatch time.
    expect(carEvents(sim.tick())).toEqual([
      { type: 'elevator:pressed', playerId: 'p3', floor: 'floor1', car: 2 },
    ])
    expect(runUntilCarMoved(sim, 2, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR - 1)
    // Car 2 frees first: its dwell ends into idle and the queued call
    // dispatches THAT tick — the flash announces on the next.
    const flash = (() => {
      for (let i = 0; i < 30; i++) {
        const events = carEvents(sim.tick())
        if (events.length > 0) return events
      }
      return null
    })()
    expect(flash).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 2 }])
    // The flash tick above already counted toward the 60-tick arrival.
    expect(runUntilCarMoved(sim, 2, 'lobby')).toBe(59)
  })

  it('drops a boarding player queued call (AD-012 #3: no car to an abandoned floor)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // Stage the two departures one tick apart so car 1 (floor3, the longest
    // ride) frees long after car 2 returns: p3 pre-steps to 28.8 (1.2 tiles
    // out of car 2's boarding range), p2 boards parked car 1 via the helper.
    sim.startMove('p3', 'right')
    for (let i = 0; i < 46; i++) sim.tick()
    sim.stopMove('p3')
    expect(lastX(sim, 'p3')).toBe(28.8)
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor3')).toBe('accepted') // car 1: 120-tick ride
    sim.startMove('p3', 'right')
    for (let i = 0; i < 10 && sim.viewOf('p3').car === null; i++) sim.tick()
    sim.stopMove('p3')
    expect(sim.pressFloor('p3', 'floor1')).toBe('accepted') // car 2: 40-tick ride
    // p1 calls from the lobby center: both cars riding → the call waits in
    // the sim-level FIFO (MOVE-15) — no flash, no dispatch yet.
    expect(sim.callElevator('p1')).toBe('dispatched')
    // p1 heads for the east landing. p3 (stay-in-car) queues the lobby return
    // during the floor1 dwell, so car 2 comes back and auto-boards p1.
    sim.startMove('p1', 'right')
    expect(runUntilCarMoved(sim, 2, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    expect(sim.pressFloor('p3', 'lobby')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'lobby')).toBe(DWELL_TICKS + RIDE_TICKS_PER_FLOOR)
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
    // phase). Car 2 frees, dispatches the queued lobby pickup (one flash),
    // and completes the trip.
    let flashes = 0
    for (let i = 0; i < 200; i++) {
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
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    // During the open-door dwell: press another floor, then walk off. The
    // queue belongs to the CAR — the walk-off never clears it.
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted')
    sim.startMove('p1', 'right')
    expect(sim.viewOf('p1').car).toBeNull()
    // Ghost trip: the empty car departs at dwell expiry and serves floor2.
    // The walk-off's occupancy update (empty riders, surviving queue) and the
    // accepted press announce both flush on this tick.
    expect(
      sim.tick().filter((e) => e.type === 'elevator:riders' || e.type === 'elevator:pressed'),
    ).toEqual([
      { type: 'elevator:riders', car: 1, riders: [], queue: ['floor2'] },
      { type: 'elevator:pressed', playerId: 'p1', floor: 'floor2', car: 1 },
    ])
    for (let i = 1; i < DWELL_TICKS; i++) expect(carEvents(sim.tick())).toEqual([])
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(RIDE_TICKS_PER_FLOOR) // floor1 → floor2: one floor
    expect(sim.snapshotForFloor('lobby').cars).toEqual([
      { car: 1, floor: 'floor2' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('boards the two closest candidates up to capacity 2 — distance first, ties by playerId — and the overflow waits for the next open-door tick (MOVE-13, ELR P2 AC8)', () => {
    const sim = new MovementSim()
    sim.join('p0')
    sim.join('p2')
    sim.join('p3')
    sim.join('p4')
    // Empty round trip: p0 rides car 1 to floor1, queues the lobby return,
    // and walks off — the queue belongs to the car, so the EMPTY car comes
    // back with doors shut and nobody re-boards mid-flight.
    boardParkedCar(sim, 'p0', 1)
    expect(sim.pressFloor('p0', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    expect(sim.pressFloor('p0', 'lobby')).toBe('accepted')
    sim.startMove('p0', 'right') // walk off through the open dwell doors
    expect(sim.viewOf('p0').car).toBeNull()
    // While the empty car rides home, position three candidates inside the
    // 1-tile boarding range of the west landing: p4 at 0.0 tiles, p2 and p3
    // TIED at 0.3 (lobby-floor walking needs no round, MOVE-08 positive half).
    sim.startMove('p4', 'left')
    sim.startMove('p2', 'left')
    sim.startMove('p3', 'left')
    for (let i = 0; i < 49; i++) sim.tick()
    sim.stopMove('p2')
    sim.stopMove('p3')
    sim.tick()
    sim.stopMove('p4')
    expect(lastX(sim, 'p4')).toBe(0)
    expect(lastX(sim, 'p2')).toBe(0.3)
    expect(lastX(sim, 'p3')).toBe(0.3)
    // Arrival boarding resolution: distance first (p4 at 0.0 beats the tied
    // pair despite the highest id), then playerId within the tie (p2 over
    // p3); capacity 2 leaves p3 overflowing.
    let arrival: readonly MovementEvent[] = []
    for (let i = 0; i < 100; i++) {
      const events = sim.tick()
      if (events.some((e) => e.type === 'elevator:moved' && e.car === 1 && e.floor === 'lobby')) {
        arrival = events
        break
      }
    }
    const boarded: string[] = []
    for (const e of arrival) if (e.type === 'player:left-floor') boarded.push(e.playerId)
    expect(boarded).toEqual(['p4', 'p2'])
    expect(sim.viewOf('p4').car).toBe(1)
    expect(sim.viewOf('p2').car).toBe(1)
    expect(sim.viewOf('p3').car).toBeNull()
    // The overflow candidate waits: no boarding while the car is full...
    for (let i = 0; i < 10; i++) {
      sim.tick()
      expect(sim.viewOf('p3').car).toBeNull()
    }
    // ...until an exit frees a slot on the next open-door tick.
    sim.startMove('p4', 'right') // doors open (dwell): p4 walks off
    expect(sim.viewOf('p4').car).toBeNull()
    sim.tick()
    expect(sim.viewOf('p3').car).toBe(1)
    expect(sim.viewOf('p4').car).toBeNull() // episode guard: no instant re-board
  })

  it('blocks re-boarding after an exit until the car next departs (ELR edge: door-open-episode guard)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    boardParkedCar(sim, 'p1', 1)
    // p1 exits and stays inside the boarding radius: exiting is final for the
    // door-open episode — no board/exit oscillation, no event spam.
    sim.startMove('p1', 'right')
    sim.stopMove('p1')
    expect(sim.viewOf('p1').car).toBeNull()
    expect(lastX(sim, 'p1')).toBe(0)
    for (let i = 0; i < 30; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
      expect(lastX(sim, 'p1')).toBe(0)
    }
    // p2 boards the same parked car and presses floor1: the DEPARTURE opens a
    // new door-open episode and clears the guard.
    boardParkedCar(sim, 'p2', 1)
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    expect(sim.pressFloor('p2', 'lobby')).toBe('accepted') // return trip
    expect(runUntilCarMoved(sim, 1, 'lobby')).toBeGreaterThan(0)
    // The car is back with doors open and a fresh episode: p1 boards again.
    for (let i = 0; i < 5 && sim.viewOf('p1').car === null; i++) sim.tick()
    expect(sim.viewOf('p1').car).toBe(1)
  })

  it('serves presses pre-round and lets a pre-round exiter walk away (EL-01, EL-04, AD-015, ELR edge)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    // Pre-round: board the parked west car and press floor1 — no round needed.
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    // Exit through the open doors pre-round: allowed in ANY phase (AD-015).
    sim.startMove('p1', 'right')
    expect(sim.viewOf('p1').car).toBeNull()
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    expect(lastX(sim, 'p1')).toBe(0)
    // Hallway walking is now allowed pre-round (AD-015): the exiter leaves the
    // landing and cannot re-board while inside the zone (episode guard, AD-016
    // hysteresis lifts it once they are observed outside — they only walk back
    // 1.5 tiles here, never re-entering the 1-tile zone).
    sim.startMove('p1', 'right')
    for (let i = 0; i < 25; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
    }
    expect(lastX(sim, 'p1')).toBeGreaterThan(0)
    // Walking back part-way (still outside the zone) does not board either.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 5; i++) sim.tick()
    expect(sim.viewOf('p1').car).toBeNull()
  })

  it('ignores in-car move intents while doors are shut; open doors let the rider walk off (MOVE-09, MOVE-16, AD-015)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    expect(sim.pressFloor('p1', 'floor2')).toBe('accepted') // 80-tick ride
    const xInCar = lastX(sim, 'p1')
    sim.startMove('p1', 'right') // doors shut: riding — ignored (MOVE-09)
    for (let i = 0; i < 40; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(xInCar)
    expect(sim.viewOf('p1').car).toBe(1)
    expect(runUntilCarMoved(sim, 1, 'floor2')).toBe(40) // the remaining 40 ticks
    // Arrival opens the doors: the same intent now exits at the served floor.
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
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    sim.startMove('p2', 'right')
    boardParkedCar(sim, 'p3', 2)
    expect(sim.pressFloor('p3', 'floor2')).toBe('accepted')
    expect(runUntilCarMoved(sim, 2, 'floor2')).toBe(2 * RIDE_TICKS_PER_FLOOR)
    sim.startMove('p3', 'left')
    // Consume the walk-off occupancy update (AD-013) before the calls.
    expect(sim.tick().filter((e) => e.type === 'elevator:riders')).toEqual([
      { type: 'elevator:riders', car: 2, riders: [], queue: [] },
    ])
    // p1 (lobby center, tie → car 1) calls: car 1 is now ARRIVING to the lobby.
    expect(sim.callElevator('p1')).toBe('dispatched')
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    // p2's call from floor1 is a DIFFERENT pickup: the mid-arrival car must
    // not swallow it (the old destination-only decoy is dead — AD-012). Car 2
    // is still mid-dwell, so the call queues and dispatches when it idles.
    expect(sim.callElevator('p2')).toBe('dispatched')
    const flash2 = (() => {
      for (let i = 0; i < 30; i++) {
        const events = carEvents(sim.tick())
        if (events.length > 0) return events
      }
      return null
    })()
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
    let leftFloor: MovementEvent | undefined
    for (let i = 0; i < 100 && leftFloor === undefined; i++) {
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
    let ridersEvent: MovementEvent | undefined
    for (let i = 0; i < 100 && ridersEvent === undefined; i++) {
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
    expect(sim.pressFloor('p2', 'floor1')).toBe('accepted') // departs immediately
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    // During the dwell: p2 queues another floor, then p1 walks off. The
    // walk-off update carries the car's survivors AND its queued floors.
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

// AD-016 hysteresis: the door-open-episode guard covers the walk-off only.
// An exiter re-boards by walking out of the 1-tile zone (observed outside)
// and back in — no stranded players at an idle car's floor.
describe('re-boarding after an exit (AD-016)', () => {
  it('re-boards an exiter who walked out of the zone and returned', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    // Exit and clear the zone: 10 held ticks × 300 milli = 3 tiles out —
    // observed outside the boarding radius, the guard lifts (AD-016).
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull() // walk-off: no instant re-board
    }
    sim.stopMove('p1')
    sim.tick()
    // Walk back in: the car still idles open-doors at the landing.
    sim.startMove('p1', 'left')
    let boarded = false
    for (let i = 0; i < 15 && !boarded; i++) {
      sim.tick()
      boarded = sim.viewOf('p1').car === 1
    }
    expect(boarded).toBe(true)
    expect(lastX(sim, 'p1')).toBe(0) // snapped to the landing
  })

  it('keeps the guard while the exiter stays inside the zone (no oscillation)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    // Exit with a 3-tick walk (0.9 tiles): still inside the 1-tile radius.
    sim.startMove('p1', 'right')
    for (let i = 0; i < 3; i++) sim.tick()
    sim.stopMove('p1')
    sim.tick()
    expect(lastX(sim, 'p1')).toBe(0.9)
    // Turn around and linger: the guard holds — no board/exit oscillation.
    sim.startMove('p1', 'left')
    for (let i = 0; i < 10; i++) {
      sim.tick()
      expect(sim.viewOf('p1').car).toBeNull()
    }
  })

  it('a re-boarded rider presses and rides normally', () => {
    const sim = new MovementSim()
    sim.join('p1')
    boardParkedCar(sim, 'p1', 1)
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick() // outside the zone: guard lifted
    sim.stopMove('p1')
    sim.tick()
    sim.startMove('p1', 'left')
    for (let i = 0; i < 15 && sim.viewOf('p1').car === null; i++) sim.tick()
    expect(sim.viewOf('p1').car).toBe(1)
    expect(sim.pressFloor('p1', 'floor1')).toBe('accepted')
    expect(runUntilCarMoved(sim, 1, 'floor1')).toBe(RIDE_TICKS_PER_FLOOR)
    expect(sim.viewOf('p1').car).toBe(1) // stayed aboard the served floor
  })
})
