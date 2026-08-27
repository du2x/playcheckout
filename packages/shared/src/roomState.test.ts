import { describe, expect, it } from 'vitest'
import { ROOM_STATES, type RoomState } from './roomState'

// Expected values from prd FR-10/FR-12: prepped / trashed / fresh / settled.
describe('room states', () => {
  it('is the closed four-state union from prd FR-10', () => {
    expect(ROOM_STATES).toEqual(['prepped', 'trashed', 'fresh', 'settled'])
  })

  it('covers every prd FR-10 state as a valid RoomState', () => {
    const states: RoomState[] = ['prepped', 'trashed', 'fresh', 'settled']
    expect(states).toHaveLength(ROOM_STATES.length)
  })
})
