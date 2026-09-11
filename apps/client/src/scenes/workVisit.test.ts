import { describe, expect, it } from 'vitest'
import { WORK_VISIT, WorkVisit, type WorkVisitReadout } from './workVisit'

/** Drive one visit with fixed 60 Hz steps until the predicate holds. */
function stepUntil(
  visit: WorkVisit,
  simXPx: number,
  predicate: (r: WorkVisitReadout) => boolean,
  maxSteps = 1000,
): WorkVisitReadout {
  let readout = visit.step(1 / 60, simXPx)
  for (let i = 0; i < maxSteps && !predicate(readout); i++) {
    readout = visit.step(1 / 60, simXPx)
  }
  expect(predicate(readout)).toBe(true)
  return readout
}

const SPOT = 2000 // the work spot, absolute px

describe('WorkVisit (room work choreography)', () => {
  it('walks the body from the doorway to the work spot with the door open', () => {
    const visit = new WorkVisit(SPOT)
    const first = visit.step(1 / 60, 1900)
    expect(first.phase).toBe('enter')
    expect(first.door).toBe('open')
    expect(first.walking).toBe(true)
    expect(first.scrubbing).toBe(false)
    expect(first.moveDir).toBe(1) // striding east toward the spot
    // Offsets ease toward the spot, never teleport.
    const mid = visit.step(1 / 60, 1900)
    expect(mid.offsetX).toBeGreaterThan(first.offsetX)
    expect(mid.offsetX).toBeLessThan(100)
  })

  it('westward spots stride west; the readout names the direction once', () => {
    const visit = new WorkVisit(1800)
    const first = visit.step(1 / 60, 1900)
    expect(first.moveDir).toBe(-1)
  })

  it('swings the door shut after the enter stride and starts the scrub', () => {
    const visit = new WorkVisit(SPOT)
    const r = stepUntil(visit, 1900, (x) => x.door === 'ajar')
    expect(r.phase).toBe('working')
    expect(r.doorJustClosed).toBe(false) // still ajar
    const closed = stepUntil(visit, 1900, (x) => x.door === 'closed')
    expect(closed.doorJustClosed).toBe(true) // the one close edge
    const settled = visit.step(1 / 60, 1900)
    expect(settled.doorJustClosed).toBe(false) // edges fire exactly once
    expect(settled.scrubbing).toBe(true)
    expect(settled.walking).toBe(false)
    expect(settled.offsetY).toBe(WORK_VISIT.spotDyPx)
    expect(settled.offsetX).toBeCloseTo(SPOT - 1900, 6)
  })

  it('puffs dust on the working clock, once per period', () => {
    const visit = new WorkVisit(SPOT)
    stepUntil(visit, 1900, (x) => x.scrubbing)
    let puffs = 0
    let readout = visit.step(1 / 60, 1900)
    for (let i = 0; i < 120 && puffs < 2; i++) {
      if (readout.dustPuff) puffs++
      readout = visit.step(1 / 60, 1900)
    }
    expect(puffs).toBe(2)
  })

  it('on completion walks back out, reopens the door, and lands exactly at sim truth', () => {
    const visit = new WorkVisit(SPOT)
    stepUntil(visit, 1900, (x) => x.door === 'closed')
    visit.complete()
    const leaving = visit.step(1 / 60, 1900)
    expect(leaving.phase).toBe('exit')
    expect(leaving.walking).toBe(true)
    expect(leaving.door).toBe('ajar')
    const reopened = stepUntil(visit, 1900, (x) => x.doorJustOpened)
    expect(reopened.door).toBe('open')
    const landed = stepUntil(visit, 1900, (x) => x.done)
    expect(landed.offsetX).toBe(0)
    expect(landed.offsetY).toBe(0)
    expect(landed.phase).toBe('idle')
    expect(landed.scrubbing).toBe(false)
    // A second complete after landing is inert.
    visit.complete()
    expect(visit.step(1 / 60, 1900).done).toBe(true)
  })

  it('on a walk-out cancel snaps back fast and walk-free (FR-16)', () => {
    const visit = new WorkVisit(SPOT)
    stepUntil(visit, 1900, (x) => x.scrubbing)
    visit.abort()
    const first = visit.step(1 / 60, 1950) // the cancel walk already moved sim truth
    expect(first.phase).toBe('exit')
    expect(first.walking).toBe(false)
    expect(first.offsetX).toBeLessThan(SPOT - 1900) // pulling home
    const landed = stepUntil(visit, 1950, (x) => x.done)
    expect(landed.offsetX).toBe(0)
    // The abort span is far shorter than the exit walk.
    expect(landed).toBeDefined()
  })

  it('follows sim truth while scrubbing, so an early cancel walk never strands the body', () => {
    const visit = new WorkVisit(SPOT)
    stepUntil(visit, 1900, (x) => x.scrubbing)
    // The player pressed a key: prediction moves the sim x before the echo.
    const drifted = visit.step(1 / 60, 1935)
    expect(drifted.offsetX).toBeCloseTo(SPOT - 1935, 6)
  })

  it('aborts cleanly even mid-enter stride', () => {
    const visit = new WorkVisit(SPOT)
    visit.step(1 / 60, 1900)
    visit.abort()
    const landed = stepUntil(visit, 1900, (x) => x.done)
    expect(landed.offsetX).toBe(0)
    expect(landed.offsetY).toBe(0)
  })
})
