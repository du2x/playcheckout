import { TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { floorLabel, transitFloorReadout } from './carScreen'

// In-car screen readouts (pure clock math — no DOM, no Phaser):
// the transition-floor sweep mirrors the sim's per-floor ride cost
// (ELEVATOR_RIDE_SECONDS_PER_FLOOR = 2 s). 3.C: the mezzanine sits between
// the lobby and floor1 — a lobby↔floor3 sweep crosses FOUR strides now.

describe('carScreen — transit floor sweep', () => {
  it('stays on the origin floor until the first per-floor stride elapses', () => {
    expect(transitFloorReadout('lobby', 'floor3', 0)).toBe('lobby')
    expect(transitFloorReadout('lobby', 'floor3', 1999)).toBe('lobby')
  })

  it('steps through every transition floor, one stride each', () => {
    expect(transitFloorReadout('lobby', 'floor3', 2000)).toBe('mezzanine')
    expect(transitFloorReadout('lobby', 'floor3', 4000)).toBe('floor1')
    expect(transitFloorReadout('lobby', 'floor3', 6000)).toBe('floor2')
    // The sweep clamps at the destination — it never overshoots past it.
    expect(transitFloorReadout('lobby', 'floor3', 9000)).toBe('floor3')
  })

  it('sweeps downward the same way (floor3 → lobby)', () => {
    expect(transitFloorReadout('floor3', 'lobby', 0)).toBe('floor3')
    expect(transitFloorReadout('floor3', 'lobby', 2000)).toBe('floor2')
    expect(transitFloorReadout('floor3', 'lobby', 4000)).toBe('floor1')
    expect(transitFloorReadout('floor3', 'lobby', 6000)).toBe('mezzanine')
    expect(transitFloorReadout('floor3', 'lobby', 7999)).toBe('mezzanine')
    expect(transitFloorReadout('floor3', 'lobby', 8000)).toBe('lobby')
  })

  it('is the origin floor when origin equals destination or is unknown', () => {
    expect(transitFloorReadout('floor1', 'floor1', 5000)).toBe('floor1')
  })
})

describe('carScreen — floor labels', () => {
  it('labels the lobby L, the mezzanine M, and guest floors by number (3.C)', () => {
    expect(floorLabel('lobby')).toBe('L')
    expect(floorLabel('mezzanine')).toBe('M')
    expect(floorLabel('floor1')).toBe('1')
    expect(floorLabel('floor3')).toBe('3')
  })

  it('sweeps the transit readout through the mezzanine between lobby and floor1 (3.C)', () => {
    // lobby → floor1 is now a two-stride ride: after the first stride it
    // reads the mezzanine, then clamps at the destination.
    const stride = TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR * 1000
    expect(transitFloorReadout('lobby', 'floor1', stride + 1)).toBe('mezzanine')
    expect(transitFloorReadout('lobby', 'floor1', stride * 2 - 1)).toBe('mezzanine')
    expect(transitFloorReadout('lobby', 'floor1', stride * 2)).toBe('floor1')
  })
})
