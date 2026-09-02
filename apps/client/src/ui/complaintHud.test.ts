import { describe, expect, it } from 'vitest'
import { COMPLAINT_BUDGET, ComplaintHud } from './complaintHud'

// Spec COMP-20/23/24/25 (the presenter half of client:complaint_cues): the
// counter over the public guest:discovered stream — pulse at ≥6, re-seed on
// reconnect, freeze at the round's end.
describe('complaintHud', () => {
  it('renders Complaints N / 8 from the §7 budget', () => {
    const hud = new ComplaintHud(COMPLAINT_BUDGET)
    expect(COMPLAINT_BUDGET).toBe(8)
    expect(hud.render()).toBe('Complaints 0 / 8')
  })

  it('counts discoveries and reports the exact count', () => {
    const hud = new ComplaintHud(8)
    hud.onDiscovered()
    hud.onDiscovered()
    expect(hud.count).toBe(2)
    expect(hud.render()).toBe('Complaints 2 / 8')
  })

  it('pulses red only from the 6th complaint on (FR-14)', () => {
    const hud = new ComplaintHud(8)
    for (let i = 1; i <= 5; i++) {
      hud.onDiscovered()
      expect(hud.pulsing).toBe(false)
    }
    hud.onDiscovered()
    expect(hud.pulsing).toBe(true)
    hud.onDiscovered()
    expect(hud.pulsing).toBe(true)
  })

  it('re-seeds to the server truth on reconnect and keeps counting', () => {
    const hud = new ComplaintHud(8)
    hud.onDiscovered()
    hud.seed(4)
    expect(hud.count).toBe(4)
    hud.onDiscovered()
    expect(hud.count).toBe(5)
    expect(hud.render()).toBe('Complaints 5 / 8')
  })

  it('freezes at the round end — late discoveries and seeds are ignored', () => {
    const hud = new ComplaintHud(8)
    hud.onDiscovered()
    hud.freeze()
    hud.onDiscovered()
    hud.seed(7)
    expect(hud.count).toBe(1)
    // A fresh deal re-arms the counter against the same budget.
    hud.reset()
    expect(hud.count).toBe(0)
    expect(hud.pulsing).toBe(false)
    hud.onDiscovered()
    expect(hud.count).toBe(1)
  })
})
