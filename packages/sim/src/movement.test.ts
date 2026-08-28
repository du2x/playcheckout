import type { MovementEvent } from '@turnover/shared'
import { HALL_LENGTH_TILES, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { MovementSim, SPEED_MILLI_PER_TICK } from './movement.js'

function movedEvents(events: readonly MovementEvent[]) {
  return events.filter((e) => e.type === 'player:moved')
}

function lastX(sim: MovementSim, playerId: string): number {
  return sim.positionOf(playerId)?.x ?? Number.NaN
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
        if (i === 40) sim.stopMove('p1')
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
    // Walk to the west wall first.
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
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // stand at the west landing
    sim.stopMove('p1')
    sim.unlock()
    expect(sim.callElevator('p1', 'floor1')).toBe('dispatched')
    sim.tick() // flash
    for (let i = 0; i < 59; i++) sim.tick() // arrival + boarding at tick 60
    for (let i = 0; i < 40; i++) sim.tick() // ride lobby → floor1
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    // Round-phase walking on a guest floor: x integrates unclamped (MOVE-06).
    sim.startMove('p1', 'right')
    const events = movedEvents(sim.tick())
    expect(events.some((e) => e.type === 'player:moved' && e.playerId === 'p1')).toBe(true)
    for (let i = 0; i < 9; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(3) // 10 ticks × 300 millitiles = 3.0 tiles
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

  it('keeps the floor on lobby in lobby phase and persists positions across lock/unlock (MOVE-04, MOVE-07, MOVE-08)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick()
    expect(sim.positionOf('p1')?.floor).toBe('lobby')
    const xBefore = lastX(sim, 'p1')

    sim.unlock() // host start: positions persist, intents continue uninterrupted
    const events = movedEvents(sim.tick())
    expect(lastX(sim, 'p1')).toBe(xBefore + 0.3)
    expect(events[0]).toMatchObject({ playerId: 'p1', floor: 'lobby' })

    sim.lock() // buzzer: positions persist; lobby-floor movement still allowed
    sim.startMove('p1', 'left')
    const xAtLock = lastX(sim, 'p1')
    sim.tick()
    expect(lastX(sim, 'p1')).toBe(xAtLock - 0.3)
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
    sim.unlock()
    // Put p2 on floor1 without an elevator: impossible — use the ride helper
    // instead. p1 stays in the lobby, so the floor1 view must exclude p1.
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
    expect(sim.viewOf('p1')).toEqual({ floor: 'lobby', roomKey: null })

    // Ride p1 to floor1: rider context loses its floor while in the car (AD-008).
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // walk to the west landing
    sim.unlock()
    expect(sim.callElevator('p1', 'floor1')).toBe('dispatched')
    sim.tick() // flash (tick 1)
    for (let i = 0; i < 59; i++) sim.tick() // ticks 2..60 — arrival + boarding on 60
    expect(sim.viewOf('p1')).toEqual({ floor: null, roomKey: null }) // rider: no floor stream (AD-008)
    for (let i = 0; i < 39; i++) sim.tick() // ride lobby → floor1 (40 ticks)
    sim.tick() // exit tick
    expect(sim.positionOf('p1')?.floor).toBe('floor1')

    // Arrived riders stand at the landing x=0 — outside every segment (AD-010).
    expect(sim.viewOf('p1')).toEqual({ floor: 'floor1', roomKey: null })
  })
})

// Spec MOVE-09..18 (gate scenario sim:elevator): scripted call sequences over
// the pure sim. Ticks are the only clock: arrival = 60 ticks, ride = 40/floor.
describe('sim:elevator', () => {
  function ride(
    sim: MovementSim,
    playerId: string,
    target: Parameters<MovementSim['callElevator']>[1],
  ) {
    return sim.callElevator(playerId, target)
  }

  function carEvents(events: readonly MovementEvent[]) {
    return events.filter((e) => e.type !== 'player:moved')
  }

  it('arrives at exactly tick 60 after the call (MOVE-11)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.unlock()
    expect(ride(sim, 'p1', 'floor2')).toBe('dispatched')
    // Tick 1 announces the call (panel flash); the car arrives at tick 60.
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 1 }])
    for (let i = 0; i < 58; i++) expect(carEvents(sim.tick())).toEqual([])
    const at60 = carEvents(sim.tick())
    expect(at60).toEqual([{ type: 'elevator:moved', car: 1, floor: 'lobby' }])
    // The caller boards at the west landing only if standing there; from center
    // they do not board — the trip still completes (decoy rides are physical).
  })

  it('rides at exactly 2 s per floor traveled (MOVE-11)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    // Stand at the west landing so p1 boards, then ride lobby → floor2 (2 floors).
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(0)
    sim.unlock()
    expect(ride(sim, 'p1', 'floor2')).toBe('dispatched')
    sim.tick() // tick 1: elevator:called flash
    for (let i = 0; i < 58; i++) sim.tick()
    const arrival = carEvents(sim.tick()) // tick 60
    expect(arrival.some((e) => e.type === 'elevator:moved')).toBe(true)

    for (let i = 0; i < 79; i++) expect(carEvents(sim.tick())).toEqual([]) // ticks 61-139
    const at140 = sim.tick() // exit: car hop + rider floor change
    expect(at140).toEqual([
      { type: 'elevator:moved', car: 1, floor: 'floor2' },
      { type: 'player:moved', playerId: 'p1', floor: 'floor2', x: 0, facing: 'left' },
    ])
    expect(sim.snapshot().cars).toEqual([
      { car: 1, floor: 'floor2' },
      { car: 2, floor: 'lobby' },
    ])
  })

  it('boards the closest players up to capacity; overflow waits for the next arrival (MOVE-13)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.join('p3')
    // All three walk to the west landing; distances: p1 15.0, p2 14.7, p3 15.0 —
    // p2 stops closest, p1 and p3 tie at one tile away (within the 1-tile range).
    sim.startMove('p2', 'left')
    for (let i = 0; i < 49; i++) sim.tick() // p2 at 0.3 from landing
    sim.stopMove('p2')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // p1 exactly at the landing
    sim.stopMove('p1')
    sim.startMove('p3', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // p3 exactly at the landing
    sim.stopMove('p3')

    sim.unlock()
    expect(ride(sim, 'p1', 'floor3')).toBe('dispatched')
    sim.tick() // tick 1: flash
    for (let i = 0; i < 59; i++) sim.tick() // arrival at tick 60
    // Capacity 2: the two closest board (p1 and p3 at 0 tiles, then p2 at 0.3).
    expect(sim.positionOf('p1')?.floor).toBe('lobby') // boarded, riding
    expect(sim.positionOf('p3')?.floor).toBe('lobby') // boarded, riding
    expect(sim.positionOf('p2')?.floor).toBe('lobby') // 0.3 tiles away: queued

    // The car rides lobby → floor3 (3 floors, 120 ticks), returns idle there.
    for (let i = 0; i < 120; i++) sim.tick()
    expect(sim.positionOf('p1')?.floor).toBe('floor3')
    expect(sim.positionOf('p3')?.floor).toBe('floor3')
    expect(sim.positionOf('p2')?.floor).toBe('lobby') // still waiting
  })

  it('ignores a call for a floor a car already targets but still flashes (MOVE-12)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.unlock()
    expect(ride(sim, 'p1', 'floor1')).toBe('dispatched')
    expect(ride(sim, 'p2', 'floor1')).toBe('ignored')
    const events = sim.tick()
    // Two flashes announce on the next tick (both calls), one dispatch only.
    const called = events.filter((e) => e.type === 'elevator:called')
    expect(called).toHaveLength(2)
    // Both flashes name the targeting car (car 1, the only car heading to
    // floor1) — the decoy does NOT name the other car (WORK-20, M3).
    expect(called[0]).toEqual({ type: 'elevator:called', floor: 'lobby', car: 1 })
    expect(called[1]).toEqual({ type: 'elevator:called', floor: 'lobby', car: 1 })
    const movedCar = events.filter((e) => e.type === 'elevator:moved')
    expect(movedCar).toHaveLength(0)
    // Only one car is in flight: exactly one arrival exists.
    let arrivals = 0
    for (let i = 0; i < 60; i++) {
      arrivals += carEvents(sim.tick()).filter((e) => e.type === 'elevator:moved').length
    }
    expect(arrivals).toBe(1)
  })

  it('queues when both cars are busy and serves the oldest call when a car frees (MOVE-15)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.unlock()
    expect(ride(sim, 'p1', 'floor3')).toBe('dispatched') // car 1 busy for 60+120 ticks
    expect(ride(sim, 'p1', 'floor1')).toBe('dispatched') // car 2 busy for 60+40
    // Car 2 (floor1 trip: 60+40 = 100 ticks) frees first.
    const queued = ride(sim, 'p1', 'lobby')
    expect(queued).toBe('dispatched') // queued: both cars busy
    // Tick 1: the two immediate calls flash. Tick 60: both cars arrive at lobby.
    expect(carEvents(sim.tick())).toHaveLength(2)
    for (let i = 0; i < 58; i++) expect(carEvents(sim.tick())).toEqual([])
    expect(carEvents(sim.tick())).toEqual([
      { type: 'elevator:moved', car: 1, floor: 'lobby' },
      { type: 'elevator:moved', car: 2, floor: 'lobby' },
    ])
    // Car 2's trip (40 ticks) completes at tick 100; the queued call dispatches
    // on it immediately (pickup lobby, target lobby — a 0-floor ride).
    for (let i = 0; i < 39; i++) expect(carEvents(sim.tick())).toEqual([])
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:moved', car: 2, floor: 'floor1' }])
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:called', floor: 'lobby', car: 2 }])
    for (let i = 0; i < 58; i++) expect(carEvents(sim.tick())).toEqual([])
    expect(carEvents(sim.tick())).toEqual([{ type: 'elevator:moved', car: 2, floor: 'lobby' }])
  })

  it('ignores in-car move intents; riders exit at the target floor (MOVE-09, MOVE-16)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // p1 at the west landing
    sim.stopMove('p1')
    sim.unlock()
    expect(ride(sim, 'p1', 'floor2')).toBe('dispatched')
    sim.tick() // flash
    for (let i = 0; i < 59; i++) sim.tick() // arrival + boarding at tick 60
    const xInCar = lastX(sim, 'p1')
    sim.startMove('p1', 'right') // ignored: positions change only via the car
    for (let i = 0; i < 20; i++) sim.tick()
    expect(lastX(sim, 'p1')).toBe(xInCar)
    for (let i = 0; i < 60; i++) sim.tick() // ride lobby → floor2 (80 ticks) completes
    expect(sim.positionOf('p1')?.floor).toBe('floor2')
    expect(sim.positionOf('p1')?.x).toBe(0)
  })

  it('rejects calls in lobby phase with no event and re-confines movement post-buzzer (edge, MOVE-08)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'left')
    for (let i = 0; i < 50; i++) sim.tick() // west landing
    sim.stopMove('p1')
    sim.unlock()
    expect(ride(sim, 'p1', 'floor1')).toBe('dispatched')
    sim.tick() // flash
    for (let i = 0; i < 59 + 40; i++) sim.tick() // arrive at 60, ride to floor1 at 100
    expect(sim.positionOf('p1')?.floor).toBe('floor1')

    sim.lock() // buzzer: positions persist...
    expect(sim.positionOf('p1')?.floor).toBe('floor1')
    const xBefore = lastX(sim, 'p1')
    sim.startMove('p1', 'right') // ...but non-lobby movement is refused
    expect(sim.tick()).toEqual([])
    expect(lastX(sim, 'p1')).toBe(xBefore)
    expect(ride(sim, 'p1', 'lobby')).toBe('rejected') // elevators idle in lobby phase
  })

  it('drops queued calls at the buzzer: no lobby-phase dispatches (edge case + MOVE-08)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.unlock()
    expect(ride(sim, 'p1', 'floor3')).toBe('dispatched') // car 1 busy 60+120
    expect(ride(sim, 'p1', 'floor1')).toBe('dispatched') // car 2 busy 60+40
    expect(ride(sim, 'p1', 'lobby')).toBe('dispatched') // queued (both busy)
    sim.tick() // both flashes announce
    sim.lock() // buzzer while all three calls are in flight or queued

    // In-flight trips complete, but the queued call is dropped silently: no
    // further elevator:called ever fires, and neither car re-dispatches.
    let flashes = 0
    for (let i = 0; i < 200; i++) {
      flashes += sim.tick().filter((e) => e.type === 'elevator:called').length
    }
    expect(flashes).toBe(0)
    expect(sim.snapshot().cars).toEqual([
      { car: 1, floor: 'floor3' },
      { car: 2, floor: 'floor1' },
    ])
  })

  it('replays a 200-tick mixed sequence bit-for-bit across two runs (MOVE-17 determinism)', () => {
    const run = () => {
      const sim = new MovementSim()
      sim.join('p1')
      sim.join('p2')
      sim.startMove('p1', 'left')
      for (let i = 0; i < 50; i++) sim.tick()
      sim.stopMove('p1')
      sim.callElevator('p1', 'floor2')
      sim.callElevator('p2', 'floor2') // decoy
      sim.startMove('p2', 'left')
      const trace: string[] = []
      for (let i = 0; i < 200; i++) {
        if (i === 100) sim.callElevator('p2', 'lobby')
        trace.push(JSON.stringify(sim.tick()))
      }
      return trace.join('\n')
    }
    expect(run()).toBe(run())
  })

  it('reports the full public movement state in the snapshot (MOVE-18)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.join('p2')
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick()
    expect(sim.snapshot()).toEqual({
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
    expect(sim.snapshot().players).toEqual([{ playerId: 'p2', floor: 'lobby', x: 15 }])
  })
})
