import { describe, expect, it } from 'vitest'
import {
  FLOOR_IDS,
  FLOORS,
  HALL_LENGTH_TILES,
  ROOM_COUNT,
  ROOM_DEPTH_TILES,
  ROOMS_PER_FLOOR,
} from './layout'

// Expected values copied from roadmap step 0 / prd FR-3 — locked planning docs.
describe('layout', () => {
  it('matches the locked building shape: 3 guest floors x 8 rooms', () => {
    expect(FLOORS).toBe(3)
    expect(ROOMS_PER_FLOOR).toBe(8)
    expect(ROOM_COUNT).toBe(24)
  })

  it('has the grand lobby plus three guest floors', () => {
    expect(FLOOR_IDS).toEqual(['lobby', 'floor1', 'floor2', 'floor3'])
  })

  it('matches the roadmap step 0 travel-budget assumptions', () => {
    expect(HALL_LENGTH_TILES).toBe(30)
    expect(ROOM_DEPTH_TILES).toBe(4)
  })
})
