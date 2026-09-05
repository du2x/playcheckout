import { describe, expect, it } from 'vitest'
import {
  CLIMB,
  climbBobY,
  climbWalkFraction,
  lurchKickY,
  sconceAlpha,
  stairPoint,
  stunFx,
} from './climbPresenter'

const TRANSIT_MS = 3000

describe('climb presenter (night-juice)', () => {
  it('walk fraction goes 0→1 with the countdown and clamps overshoot', () => {
    expect(climbWalkFraction(TRANSIT_MS)).toBe(0)
    expect(climbWalkFraction(TRANSIT_MS / 2)).toBeCloseTo(0.5, 5)
    expect(climbWalkFraction(0)).toBe(1)
    expect(climbWalkFraction(-500)).toBe(1)
    expect(climbWalkFraction(TRANSIT_MS + 500)).toBe(0)
  })

  it('the stair line spans exactly one stride between the landings', () => {
    const start = stairPoint(0)
    const end = stairPoint(1)
    expect(end.y - start.y).toBe(-CLIMB.stridePx)
    expect(end.x).toBeGreaterThan(start.x)
  })

  it('the bob is flat at both landings and bounded by the amplitude', () => {
    expect(climbBobY(0)).toBe(0)
    expect(climbBobY(1)).toBeCloseTo(0, 9)
    for (let i = 0; i <= 20; i++) {
      const w = i / 20
      expect(climbBobY(w)).toBeGreaterThanOrEqual(0)
      expect(climbBobY(w)).toBeLessThanOrEqual(CLIMB.bobPx)
    }
    expect(climbBobY(0.5 / CLIMB.treads)).toBe(CLIMB.bobPx)
  })

  it('sconce flicker stays in the warm band for any seed', () => {
    for (const seed of [0, 1.3, 9.7, 42]) {
      for (let t = 0; t < 5000; t += 97) {
        const a = sconceAlpha(t, seed)
        expect(a).toBeGreaterThanOrEqual(0.55)
        expect(a).toBeLessThanOrEqual(1)
      }
    }
  })

  it('stun fx: impact window flashes, sweeps once, then hands over to blackout', () => {
    // Impact start: white flash peaks, no blackout yet, sweep not launched.
    const at0 = stunFx(0, 1000)
    expect(at0.flashAlpha).toBeCloseTo(0.85, 5)
    expect(at0.redAlpha).toBeGreaterThan(0)
    expect(at0.sweepX).toBeNull()
    expect(at0.blackoutAlpha).toBe(0)
    expect(at0.vignetteAlpha).toBe(0)

    // Mid-impact: the abstract dark bar crosses left→right exactly once.
    const mid = stunFx(CLIMB.impactMs / 2, 1000)
    expect(mid.sweepX).toBeGreaterThanOrEqual(-1)
    expect(mid.sweepX).toBeLessThanOrEqual(1)
    expect(mid.flashAlpha).toBeLessThan(at0.flashAlpha)

    const atEnd = stunFx(CLIMB.impactMs - 1, 1000)
    expect(atEnd.sweepX).toBeCloseTo(1, 2)

    // After the impact: no flash, blackout ramping to full, vignette pulsing.
    const during = stunFx(CLIMB.impactMs + CLIMB.blackoutFadeMs / 2, 1000)
    expect(during.flashAlpha).toBe(0)
    expect(during.redAlpha).toBe(0)
    expect(during.sweepX).toBeNull()
    expect(during.blackoutAlpha).toBeGreaterThan(0)
    expect(during.blackoutAlpha).toBeLessThan(0.94)
    expect(during.vignetteAlpha).toBe(0)

    const held = stunFx(CLIMB.impactMs + CLIMB.blackoutFadeMs + 5000, 1000)
    expect(held.blackoutAlpha).toBeCloseTo(0.94, 5)
    expect(held.vignetteAlpha).toBeGreaterThanOrEqual(0.16)
    expect(held.vignetteAlpha).toBeLessThanOrEqual(0.5)
  })

  it('the resume lurch kicks then settles, and is zero outside the window', () => {
    expect(lurchKickY(-1)).toBe(0)
    expect(lurchKickY(0)).toBeCloseTo(0, 9)
    expect(Math.abs(lurchKickY(CLIMB.lurchMs / 4))).toBeGreaterThan(0)
    expect(Math.abs(lurchKickY(CLIMB.lurchMs / 4))).toBeLessThanOrEqual(CLIMB.lurchPx)
    expect(lurchKickY(CLIMB.lurchMs)).toBe(0)
    expect(lurchKickY(CLIMB.lurchMs + 1000)).toBe(0)
  })
})
