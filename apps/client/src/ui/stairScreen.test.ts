import { type FloorId, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { type StairAnchor, stairDirection, stairPhaseReadout } from './stairScreen'

// Stairwell screen readouts (pure clock math — no DOM, no Phaser): the own
// stairs clock re-anchors on every personal snapshot and derives the
// transit → breath handoff locally from TUNING (AD-040: STAIRS_TRANSIT_SECONDS
// = 3, STAIRS_BREATH_SECONDS = 2). Pure so the sweep is unit-testable.

function anchorAt(
  phase: StairAnchor['phase'],
  remainingMs: number,
  from: FloorId = 'floor2',
  to: FloorId = 'floor3',
): StairAnchor {
  return { from, to, phase, remainingMs, anchoredAtMs: 10_000 }
}

describe('stairScreen — phase readout', () => {
  it('counts the anchored phase down from the payload seconds', () => {
    const anchor = anchorAt('transit', 3000)
    expect(stairPhaseReadout(anchor, 10_000)).toEqual({ phase: 'transit', remainingMs: 3000 })
    expect(stairPhaseReadout(anchor, 11_000)).toEqual({ phase: 'transit', remainingMs: 2000 })
  })

  it('rolls an expired transit into the breath (AD-040 local derivation)', () => {
    const anchor = anchorAt('transit', 3000)
    expect(stairPhaseReadout(anchor, 13_000)).toEqual({ phase: 'breath', remainingMs: 2000 })
    expect(stairPhaseReadout(anchor, 14_000)).toEqual({ phase: 'breath', remainingMs: 1000 })
  })

  it('subtracts transit overshoot from the breath window', () => {
    const anchor = anchorAt('transit', 3000)
    expect(stairPhaseReadout(anchor, 14_500)).toEqual({ phase: 'breath', remainingMs: 500 })
  })

  it('ends the visit when the breath expires', () => {
    const anchor = anchorAt('breath', 2000)
    expect(stairPhaseReadout(anchor, 11_000)).toEqual({ phase: 'breath', remainingMs: 1000 })
    expect(stairPhaseReadout(anchor, 11_999)).toEqual({ phase: 'breath', remainingMs: 1 })
    expect(stairPhaseReadout(anchor, 12_000)).toBeNull()
  })

  it('ends the visit when the stun expires (no auto-derivation past it)', () => {
    const anchor = anchorAt('stunned', TUNING.STAIRS_STUN_SECONDS * 1000)
    expect(stairPhaseReadout(anchor, 10_001)).toEqual({
      phase: 'stunned',
      remainingMs: TUNING.STAIRS_STUN_SECONDS * 1000 - 1,
    })
    expect(stairPhaseReadout(anchor, 10_000 + TUNING.STAIRS_STUN_SECONDS * 1000)).toBeNull()
  })

  it('stays null past a transit that outran transit + breath combined', () => {
    const anchor = anchorAt('transit', 3000)
    expect(stairPhaseReadout(anchor, 10_000 + 5000)).toBeNull()
  })
})

describe('stairScreen — direction', () => {
  it('reads up and down from the building order (mezzanine above the lobby)', () => {
    expect(stairDirection('lobby', 'floor1')).toBe('up')
    expect(stairDirection('floor2', 'floor3')).toBe('up')
    expect(stairDirection('floor1', 'mezzanine')).toBe('down')
    expect(stairDirection('floor3', 'floor2')).toBe('down')
  })
})
