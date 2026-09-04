import { describe, expect, it } from 'vitest'
import {
  FLOOR_IDS,
  FLOORS,
  GUEST_FLOOR_IDS,
  HALL_LENGTH_TILES,
  ROOM_COUNT,
  ROOM_DEPTH_TILES,
  ROOM_HALL_START_TILES,
  ROOMS_PER_FLOOR,
  roomDoorXMilli,
  roomIndexAtMilli,
  roomSegmentEndMilli,
  roomSegmentStartMilli,
} from './layout'

// Expected values copied from roadmap step 0 / prd FR-3 — locked planning docs
// (7 rooms per floor: AD-046).
describe('layout', () => {
  it('matches the locked building shape: 3 guest floors x 7 rooms', () => {
    expect(FLOORS).toBe(3)
    expect(ROOMS_PER_FLOOR).toBe(7)
    expect(ROOM_COUNT).toBe(21)
  })

  it('has the grand lobby, the mezzanine restaurant, and three guest floors (3.C)', () => {
    expect(FLOOR_IDS).toEqual(['lobby', 'mezzanine', ...GUEST_FLOOR_IDS])
  })

  it('matches the roadmap step 0 travel-budget assumptions', () => {
    expect(HALL_LENGTH_TILES).toBe(30)
    expect(ROOM_DEPTH_TILES).toBe(3.25)
  })

  it('tiles the hall contiguously: 7 segments of 3.25 from tile 2 (AD-010, re-derived AD-036/AD-046)', () => {
    expect(ROOM_HALL_START_TILES).toBe(2)
    expect(roomSegmentStartMilli(1)).toBe(2000)
    expect(roomSegmentEndMilli(ROOMS_PER_FLOOR as 7)).toBe(24_750)
    for (let i = 2; i <= ROOMS_PER_FLOOR; i++) {
      expect(roomSegmentStartMilli(i as 2)).toBe(roomSegmentEndMilli((i - 1) as 1))
    }
  })

  it('leaves landing clearance at each end (AD-036 elevator door; AD-046 east gap)', () => {
    expect(ROOM_HALL_START_TILES).toBeGreaterThanOrEqual(2)
    // East gap: rooms end at 24.75 tiles; the 80 px elevator door spans 27.5–30.
    expect(roomSegmentEndMilli(ROOMS_PER_FLOOR as 7)).toBeLessThanOrEqual(27_500)
  })

  it('resolves segment membership half-open, last room inclusive (AD-010)', () => {
    expect(roomIndexAtMilli(1999)).toBe(0)
    expect(roomIndexAtMilli(2000)).toBe(1)
    expect(roomIndexAtMilli(5249)).toBe(1)
    expect(roomIndexAtMilli(5250)).toBe(2)
    expect(roomIndexAtMilli(15_000)).toBe(5)
    expect(roomIndexAtMilli(24_749)).toBe(7)
    expect(roomIndexAtMilli(24_750)).toBe(7)
    expect(roomIndexAtMilli(24_751)).toBe(0)
  })
})

// Cycle 3.1: guests walk to the segment-center doorway of their assigned room.
describe('room doorway geometry (cycle 3.1)', () => {
  it('places every door at its segment center', () => {
    // Room 1 spans [2000, 5250) milli → center 3625.
    expect(roomDoorXMilli(1)).toBe(3625)
    // Room 7 spans [21500, 24750) milli → center 23125.
    expect(roomDoorXMilli(7)).toBe(23_125)
  })

  it('door x resolves back through the room-at predicate', () => {
    for (let room = 1; room <= ROOMS_PER_FLOOR; room++) {
      const x = roomDoorXMilli(room as 1)
      expect(roomIndexAtMilli(x)).toBe(room)
    }
  })

  it('keeps every door inside the walkable hall', () => {
    for (let room = 1; room <= ROOMS_PER_FLOOR; room++) {
      const x = roomDoorXMilli(room as 1)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(HALL_LENGTH_TILES * 1000)
    }
  })
})
