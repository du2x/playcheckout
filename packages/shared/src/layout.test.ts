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

// Expected values copied from roadmap step 0 / prd FR-3 — locked planning docs.
describe('layout', () => {
  it('matches the locked building shape: 3 guest floors x 8 rooms', () => {
    expect(FLOORS).toBe(3)
    expect(ROOMS_PER_FLOOR).toBe(8)
    expect(ROOM_COUNT).toBe(24)
  })

  it('has the grand lobby, the mezzanine restaurant, and three guest floors (3.C)', () => {
    expect(FLOOR_IDS).toEqual(['lobby', 'mezzanine', ...GUEST_FLOOR_IDS])
  })

  it('matches the roadmap step 0 travel-budget assumptions', () => {
    expect(HALL_LENGTH_TILES).toBe(30)
    expect(ROOM_DEPTH_TILES).toBe(3.5)
  })

  it('tiles the hall exactly: 8 segments of 3.5 fill [1, 29] (AD-010)', () => {
    expect(ROOM_HALL_START_TILES + ROOMS_PER_FLOOR * ROOM_DEPTH_TILES).toBe(HALL_LENGTH_TILES - 1)
    expect(roomSegmentStartMilli(1)).toBe(1000)
    expect(roomSegmentEndMilli(8)).toBe(29000)
    for (let i = 2; i <= ROOMS_PER_FLOOR; i++) {
      expect(roomSegmentStartMilli(i as 2)).toBe(roomSegmentEndMilli((i - 1) as 1))
    }
  })

  it('resolves segment membership half-open, last room inclusive (AD-010)', () => {
    expect(roomIndexAtMilli(999)).toBe(0)
    expect(roomIndexAtMilli(1000)).toBe(1)
    expect(roomIndexAtMilli(4499)).toBe(1)
    expect(roomIndexAtMilli(4500)).toBe(2)
    expect(roomIndexAtMilli(15_000)).toBe(5)
    expect(roomIndexAtMilli(28_999)).toBe(8)
    expect(roomIndexAtMilli(29_000)).toBe(8)
    expect(roomIndexAtMilli(29_001)).toBe(0)
  })
})

// Cycle 3.1: guests walk to the segment-center doorway of their assigned room.
describe('room doorway geometry (cycle 3.1)', () => {
  it('places every door at its segment center', () => {
    // Room 1 spans [1000, 4500) milli → center 2750.
    expect(roomDoorXMilli(1)).toBe(2750)
    // Room 8 spans [25500, 29000) milli → center 27250.
    expect(roomDoorXMilli(8)).toBe(27250)
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
