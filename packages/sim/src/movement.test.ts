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

  it('stops on release at the current x and emits nothing afterwards (MOVE-02, MOVE-03)', () => {
    const sim = new MovementSim()
    sim.join('p1')
    sim.startMove('p1', 'right')
    for (let i = 0; i < 10; i++) sim.tick()
    const xAtStop = lastX(sim, 'p1')
    sim.stopMove('p1')
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
    expect(sim.tick()).toEqual([])
  })
})
