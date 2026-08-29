import { describe, expect, it } from 'vitest'
import { floorLabel, transitFloorReadout } from './carScreen'

// In-car screen readouts (pure clock math — no DOM, no Phaser):
// the transition-floor sweep mirrors the sim's per-floor ride cost
// (ELEVATOR_RIDE_SECONDS_PER_FLOOR = 2 s).

describe('carScreen — transit floor sweep', () => {
  it('stays on the origin floor until the first per-floor stride elapses', () => {
    expect(transitFloorReadout('lobby', 'floor3', 0)).toBe('lobby')
    expect(transitFloorReadout('lobby', 'floor3', 1999)).toBe('lobby')
  })

  it('steps through every transition floor, one stride each', () => {
    expect(transitFloorReadout('lobby', 'floor3', 2000)).toBe('floor1')
    expect(transitFloorReadout('lobby', 'floor3', 4000)).toBe('floor2')
    // The sweep clamps at the destination — it never overshoots past it.
    expect(transitFloorReadout('lobby', 'floor3', 9000)).toBe('floor3')
  })

  it('sweeps downward the same way (floor3 → lobby)', () => {
    expect(transitFloorReadout('floor3', 'lobby', 0)).toBe('floor3')
    expect(transitFloorReadout('floor3', 'lobby', 2000)).toBe('floor2')
    expect(transitFloorReadout('floor3', 'lobby', 4000)).toBe('floor1')
    expect(transitFloorReadout('floor3', 'lobby', 6000)).toBe('lobby')
  })

  it('is the origin floor when origin equals destination or is unknown', () => {
    expect(transitFloorReadout('floor1', 'floor1', 5000)).toBe('floor1')
  })
})

describe('carScreen — floor labels', () => {
  it('labels the lobby L and guest floors by number', () => {
    expect(floorLabel('lobby')).toBe('L')
    expect(floorLabel('floor1')).toBe('1')
    expect(floorLabel('floor3')).toBe('3')
  })
})
