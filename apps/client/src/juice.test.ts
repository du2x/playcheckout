import { describe, expect, it } from 'vitest'
import { JUICE, shouldShake } from './scenes/juice'

// Phase 4.1 (VPOL-13..17): the juice table is the single home of the
// transient-feedback timings — the scene consumes it verbatim.
describe('juice presenter', () => {
  it('pins the settle pop (VPOL-13)', () => {
    expect(JUICE.settle.durationMs).toBe(180)
    expect(JUICE.settle.ease).toBe('Cubic.easeOut')
    expect(JUICE.settle.scaleFrom).toBeCloseTo(0.96)
  })

  it('pins the foot-tap yoyo (VPOL-14)', () => {
    expect(JUICE.footTap.durationMs).toBe(400)
    expect(JUICE.footTap.distancePx).toBe(2)
  })

  it('pins the anger pop + dust (VPOL-15)', () => {
    expect(JUICE.anger.durationMs).toBe(220)
    expect(JUICE.anger.scalePeak).toBeCloseTo(1.3)
    expect(JUICE.anger.ttlMs).toBe(1800)
    expect(JUICE.anger.dustCount).toBe(4)
    expect(JUICE.anger.dustDurationMs).toBe(250)
  })

  it('pins the camera shake tier (VPOL-16)', () => {
    expect(JUICE.shake.durationMs).toBe(140)
    expect(JUICE.shake.intensity).toBeCloseTo(0.008)
  })

  it('shakes only for firing and ambush — never routine motion (VPOL-16/17)', () => {
    expect(shouldShake('player-fired')).toBe(true)
    expect(shouldShake('stairs-ambushed')).toBe(true)
    expect(shouldShake('player-moved')).toBe(false)
    expect(shouldShake('elevator-moved')).toBe(false)
    expect(shouldShake('elevator-doors')).toBe(false)
    expect(shouldShake('guest-angered')).toBe(false)
    expect(shouldShake('')).toBe(false)
  })
})
