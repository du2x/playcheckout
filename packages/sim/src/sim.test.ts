import { ROOM_COUNT, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { TICK_HZ } from './index'

// Proves cross-workspace import resolution (spec SKEL-04 AC5): packages/sim
// consumes @turnover/shared via the workspace dependency, values from prd §7.
describe('sim placeholder', () => {
  it('resolves the shared workspace package', () => {
    expect(ROOM_COUNT).toBe(21) // 7 rooms/floor (AD-046)
    expect(TUNING.SHIFT_SECONDS).toBe(300)
  })

  it('locks the 20 Hz tick from prd §11', () => {
    expect(TICK_HZ).toBe(20)
  })
})
