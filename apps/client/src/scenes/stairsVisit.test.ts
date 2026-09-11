import { type FloorId, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { type StairAnchor, StairsVisit, stairDirection, stairPhaseReadout } from './stairsVisit'

// Stairs visit (AD-040 client mirror): the clock math moved here from
// stairScreen.test.ts when the visit module became the clock's home; the
// transition tests below cover the edges the world scene used to mirror
// inline (breath arrival, stun resume, visit end). Pure — `nowMs` injected,
// no Phaser, no DOM.

function anchorAt(
  phase: StairAnchor['phase'],
  remainingMs: number,
  from: FloorId = 'floor2',
  to: FloorId = 'floor3',
): StairAnchor {
  return { from, to, phase, remainingMs, anchoredAtMs: 10_000 }
}

describe('stairsVisit — phase readout', () => {
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

describe('stairsVisit — direction', () => {
  it('reads up and down from the building order (mezzanine above the lobby)', () => {
    expect(stairDirection('lobby', 'floor1')).toBe('up')
    expect(stairDirection('floor2', 'floor3')).toBe('up')
    expect(stairDirection('floor1', 'mezzanine')).toBe('down')
    expect(stairDirection('floor3', 'floor2')).toBe('down')
  })
})

describe('stairsVisit — transitions', () => {
  const row = (
    phase: 'transit' | 'breath' | 'stunned',
    remainingSeconds: number,
    from: FloorId = 'floor2',
    to: FloorId = 'floor3',
  ): {
    from: FloorId
    to: FloorId
    phase: 'transit' | 'breath' | 'stunned'
    remainingSeconds: number
  } => ({
    from,
    to,
    phase,
    remainingSeconds,
  })

  it('anchors from a personal snapshot and reads direction from the building order', () => {
    const visit = new StairsVisit()
    visit.onSnapshot(row('transit', 3), 10_000)
    const { readout, transitions } = visit.tick(10_500)
    expect(transitions).toEqual([])
    expect(readout?.phase).toBe('transit')
    expect(readout?.direction).toBe('up')
    expect(readout?.remainingMs).toBe(2500)
    expect(readout?.from).toBe('floor2')
    expect(readout?.elapsedStunMs).toBeNull()
    expect(readout?.lurchElapsedMs).toBeNull()
  })

  it('publishes breath-entered exactly once per breath window', () => {
    const visit = new StairsVisit()
    visit.onSnapshot(row('transit', 3), 10_000)
    const roll = visit.tick(13_000)
    expect(roll.transitions).toEqual([{ type: 'breath-entered', floor: 'floor3' }])
    expect(roll.readout?.phase).toBe('breath')
    expect(visit.tick(13_500).transitions).toEqual([])
  })

  it('ends the visit when the breath expires', () => {
    const visit = new StairsVisit()
    visit.onSnapshot(row('breath', 2), 10_000)
    const end = visit.tick(12_000)
    expect(end.transitions).toEqual([{ type: 'visit-ended', floor: 'floor3' }])
    expect(end.readout).toBeNull()
    expect(visit.tick(12_500)).toEqual({ readout: null, transitions: [] })
  })

  it('ambush overrides the clock and preserves the transit remainder for the resume', () => {
    const visit = new StairsVisit()
    visit.onSnapshot(row('transit', 3), 10_000)
    visit.onAmbush(2, 11_000)
    const stunned = visit.tick(11_500)
    expect(stunned.transitions).toEqual([])
    expect(stunned.readout?.phase).toBe('stunned')
    expect(stunned.readout?.elapsedStunMs).toBe(500)
    const resumed = visit.tick(13_000)
    expect(resumed.transitions).toEqual([{ type: 'stun-resumed' }])
    expect(resumed.readout?.phase).toBe('transit')
    expect(resumed.readout?.remainingMs).toBe(2000)
    expect(resumed.readout?.lurchElapsedMs).toBe(0)
    expect(visit.tick(13_100).transitions).toEqual([])
  })

  it('a snapshot-anchored stun (no ambush remainder) ends the visit at expiry', () => {
    const visit = new StairsVisit()
    visit.onSnapshot(row('stunned', 2), 10_000)
    expect(visit.tick(12_000).transitions).toEqual([{ type: 'visit-ended', floor: 'floor3' }])
  })

  it('ambush without a live visit is a no-op (the toast is the message UI, not the visit)', () => {
    const visit = new StairsVisit()
    visit.onAmbush(20, 10_000)
    expect(visit.tick(10_001).readout).toBeNull()
  })

  it('an absent snapshot row clears the visit without transitions', () => {
    const visit = new StairsVisit()
    visit.onSnapshot(row('transit', 3), 10_000)
    visit.onSnapshot(null, 10_500)
    expect(visit.tick(11_000)).toEqual({ readout: null, transitions: [] })
  })

  it('re-entering the breath after a re-anchor publishes the arrival again', () => {
    const visit = new StairsVisit()
    visit.onSnapshot(row('transit', 3), 10_000)
    expect(visit.tick(13_000).transitions).toEqual([{ type: 'breath-entered', floor: 'floor3' }])
    visit.onSnapshot(row('transit', 1), 14_000)
    expect(visit.tick(14_500).transitions).toEqual([])
    expect(visit.tick(15_000).transitions).toEqual([{ type: 'breath-entered', floor: 'floor3' }])
  })

  it('reset clears the visit (round teardown)', () => {
    const visit = new StairsVisit()
    visit.onSnapshot(row('transit', 3), 10_000)
    visit.onAmbush(2, 11_000)
    visit.reset()
    expect(visit.tick(11_500)).toEqual({ readout: null, transitions: [] })
  })
})

describe('stairsVisit — active', () => {
  const row = (phase: 'transit' | 'breath' | 'stunned', remainingSeconds: number) => ({
    from: 'floor2' as FloorId,
    to: 'floor3' as FloorId,
    phase,
    remainingSeconds,
  })

  // The movement lock's source of truth (the sim drops move intents for the
  // whole visit): active() must track the anchor across every phase and both
  // expiry paths — the tick's visit-ended edge and the null snapshot row.
  it('tracks the anchor through every phase and both expiry paths', () => {
    const visit = new StairsVisit()
    expect(visit.active()).toBe(false)
    visit.onSnapshot(row('transit', 3), 10_000)
    expect(visit.active()).toBe(true)
    visit.onSnapshot(row('breath', 2), 13_000)
    expect(visit.active()).toBe(true)
    visit.tick(15_000) // breath expired → visit-ended cleared the anchor
    expect(visit.active()).toBe(false)
    visit.onSnapshot(row('stunned', 20), 20_000)
    expect(visit.active()).toBe(true)
    visit.onSnapshot(null, 20_500)
    expect(visit.active()).toBe(false)
  })
})
