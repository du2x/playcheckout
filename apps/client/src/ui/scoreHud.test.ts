import { describe, expect, it } from 'vitest'
import { ScoreHud } from './scoreHud'

// Spec DLVR-09/10 (gate scenario client:score_hud, cycle 3.D): a pure
// presenter over the public guest:settled stream.

describe('ScoreHud', () => {
  it('renders Settled N / T and counts each settle (DLVR-09/10)', () => {
    const hud = new ScoreHud(5)
    expect(hud.render()).toBe('Settled 0 / 5')
    hud.onSettled()
    hud.onSettled()
    expect(hud.render()).toBe('Settled 2 / 5')
    expect(hud.score).toBe(2)
  })

  it('reset zeroes the count against the new lobby target and unfreezes (DLVR-10)', () => {
    const hud = new ScoreHud(5)
    hud.onSettled()
    hud.freeze()
    hud.reset(7)
    expect(hud.render()).toBe('Settled 0 / 7')
    hud.onSettled()
    expect(hud.score).toBe(1)
  })

  it('freeze pins the count: late settles after round end are ignored (DLVR-09)', () => {
    const hud = new ScoreHud(5)
    hud.onSettled()
    hud.freeze()
    hud.onSettled()
    expect(hud.score).toBe(1)
    // Seeding is also ignored while frozen.
    hud.seed(9)
    expect(hud.score).toBe(1)
  })

  it('seed re-seeds to the server truth on reconnect (DLVR-10)', () => {
    const hud = new ScoreHud(5)
    hud.onSettled()
    hud.seed(4)
    expect(hud.render()).toBe('Settled 4 / 5')
  })
})
