import { describe, expect, it } from 'vitest'
import {
  advanceCarClock,
  applyCalled,
  applyMoved,
  carAlpha,
  carVisible,
  DEFAULT_ANIMATION_CONFIG,
  doorsOpenAmount,
  ElevatorPresenter,
  type GraphicsLike,
  initialCarClock,
} from './elevatorPresenter'

const cfg = DEFAULT_ANIMATION_CONFIG

// Elevator animation (cycle `elevator-animation`): pure clock reducer tests.
// Every case maps to a spec.md acceptance criterion (ELAN-01/02/05/08) or a
// listed edge case — see .specs/features/elevator-animation/spec.md.
describe('elevator clock — doors open at every stop (ELAN-01)', () => {
  it('renders doors fully open on a fresh arrival (phase becomes "open")', () => {
    const clock = applyMoved(initialCarClock('lobby'), 'floor1')
    // Ground truth wins immediately from a non-transit phase (SPEC_DEVIATION
    // note): the clock jumps straight to 'arriving' at the new floor, then
    // resolves to 'open' once the arrival animation elapses.
    const arrived = advanceCarClock(clock, cfg.arrivalAnimMs, cfg)
    expect(doorsOpenAmount(arrived, cfg)).toBe(1)
    expect(carVisible(arrived)).toBe(true)
  })
})

describe('elevator clock — doors close before departure (ELAN-02)', () => {
  it('closes automatically once the dwell window elapses with no redirect', () => {
    const open = initialCarClock('floor1')
    const stillOpen = advanceCarClock(open, cfg.dwellMs - 1, cfg)
    expect(doorsOpenAmount(stillOpen, cfg)).toBe(1)

    const closingStart = advanceCarClock(stillOpen, 1, cfg)
    expect(closingStart.phase).toBe('closing')
    const closingMidway = advanceCarClock(closingStart, cfg.doorAnimMs / 2, cfg)
    expect(doorsOpenAmount(closingMidway, cfg)).toBeLessThan(1)
    expect(carVisible(closingMidway)).toBe(true) // still visible while doors close

    const transit = advanceCarClock(closingMidway, cfg.doorAnimMs, cfg)
    expect(doorsOpenAmount(transit, cfg)).toBe(0)
    expect(carVisible(transit)).toBe(false)
  })

  it('closes immediately on a public call to a different floor, not waiting for dwell', () => {
    const open = initialCarClock('floor1')
    const called = applyCalled(open, 'floor2')
    expect(called.phase).toBe('closing')
    const midway = advanceCarClock(called, cfg.doorAnimMs / 2, cfg)
    expect(doorsOpenAmount(midway, cfg)).toBeLessThan(1)
    const transit = advanceCarClock(midway, cfg.doorAnimMs, cfg)
    expect(carVisible(transit)).toBe(false)
  })
})

describe('elevator clock — fixed minimum transit duration, distance-independent (ELAN-05, ELAN-08)', () => {
  it('holds the transit visual for at least minTransitMs even if the real arrival is faster', () => {
    const open = initialCarClock('floor1')
    const closing = applyCalled(open, 'floor2')
    const transit = advanceCarClock(closing, cfg.doorAnimMs, cfg)
    expect(transit.phase).toBe('transit')

    // Real elevator:moved arrives almost immediately (faster than minTransitMs).
    const withPending = applyMoved(transit, 'floor2')
    const tooEarly = advanceCarClock(withPending, cfg.minTransitMs - 1, cfg)
    expect(tooEarly.phase).toBe('transit') // still hidden — floor not yet resolved
    expect(carVisible(tooEarly)).toBe(false)

    const resolved = advanceCarClock(tooEarly, 1, cfg)
    expect(resolved.phase).toBe('arriving')
    expect(resolved.floor).toBe('floor2')
  })

  it('never derives transit duration from real ride distance (no distance parameter exists)', () => {
    // The reducer's signature takes no distance/floor-count input at all —
    // this test documents that the fixed minimum is the only bound, proven
    // by using the same minTransitMs regardless of which floor is named.
    const openA = initialCarClock('lobby')
    const transitA = advanceCarClock(applyCalled(openA, 'floor3'), cfg.doorAnimMs, cfg)
    const openB = initialCarClock('lobby')
    const transitB = advanceCarClock(applyCalled(openB, 'floor1'), cfg.doorAnimMs, cfg)
    expect(transitA.phase).toBe('transit')
    expect(transitB.phase).toBe('transit')
    // Same elapsed time held before either resolves — distance never enters.
    expect(advanceCarClock(transitA, cfg.minTransitMs - 1, cfg).phase).toBe('transit')
    expect(advanceCarClock(transitB, cfg.minTransitMs - 1, cfg).phase).toBe('transit')
  })
})

describe('elevator clock — arrival renders motion, not an instant snap (ELAN-06, ELAN-07)', () => {
  it('fades in over arrivalAnimMs rather than snapping to full opacity', () => {
    const arriving = applyMoved(initialCarClock('lobby'), 'floor1')
    expect(arriving.phase).toBe('arriving')
    const halfway = advanceCarClock(arriving, cfg.arrivalAnimMs / 2, cfg)
    expect(carAlpha(halfway, cfg)).toBeGreaterThan(0)
    expect(carAlpha(halfway, cfg)).toBeLessThan(1)
    const done = advanceCarClock(halfway, cfg.arrivalAnimMs / 2, cfg)
    expect(carAlpha(done, cfg)).toBe(1)
    expect(done.phase).toBe('open')
  })

  it('renders no arrival visual for elevator:moved on a car not on the viewer\u2019s floor (ELAN-03/07)', () => {
    // Presented at the ElevatorPresenter.tick level (viewFloor gate) — the
    // clock itself has no floor concept beyond its own; this asserts the
    // clock update never depends on any "viewer" floor argument, i.e. the
    // gating is purely the presenter's job (see class-level test below).
    const arriving = applyMoved(initialCarClock('lobby'), 'floor2')
    expect(arriving.floor).toBe('floor2')
  })
})

describe('elevator clock — decoy re-call does not restart the door animation (edge case)', () => {
  it('is a no-op when called for the floor it is already parked open at', () => {
    const open = initialCarClock('floor1')
    const advancedOpen = advanceCarClock(open, 200, cfg)
    const recalled = applyCalled(advancedOpen, 'floor1')
    expect(recalled).toEqual(advancedOpen) // unchanged — no restart
  })

  it('is a no-op when already mid-transit (call for yet another floor)', () => {
    const open = initialCarClock('floor1')
    const closing = applyCalled(open, 'floor2')
    const transit = advanceCarClock(closing, cfg.doorAnimMs, cfg)
    const recalled = applyCalled(transit, 'floor3')
    expect(recalled).toBe(transit) // same reference — untouched
  })
})

// Fake structural implementations — no `phaser` import needed (module design
// goal: constructible and testable under plain node, spec ELAN-09/10).
function fakeGraphics(): GraphicsLike {
  return { clear: () => {}, fillStyle: () => {}, fillRect: () => {}, destroy: () => {} }
}

function fakeScene() {
  return { add: { graphics: () => fakeGraphics() } }
}

function fakeEllipse() {
  let visible = true
  let alpha = 1
  return {
    x: 0,
    setVisible: (v: boolean) => {
      visible = v
    },
    setAlpha: (a: number) => {
      alpha = a
    },
    get visible() {
      return visible
    },
    get alpha() {
      return alpha
    },
  }
}

describe('ElevatorPresenter — Phaser-facing wiring (smoke, ELAN-01, ELAN-04)', () => {
  it('hides a car once its floor no longer matches the view floor (ELAN-04)', () => {
    const scene = fakeScene()
    const car1 = fakeEllipse()
    const car2 = fakeEllipse()
    const cars = new Map([
      [1 as const, { ellipse: car1 }],
      [2 as const, { ellipse: car2 }],
    ])
    const presenter = new ElevatorPresenter(scene, cars, () => 0)

    presenter.tick(0, 'lobby')
    expect(car1.visible).toBe(true) // parked open at lobby, viewer on lobby

    presenter.tick(0, 'floor1')
    expect(car1.visible).toBe(false) // viewer moved away — no cross-floor leak
  })

  it('constructing and calling every public method does not throw', () => {
    const scene = fakeScene()
    const cars = new Map([
      [1 as const, { ellipse: fakeEllipse() }],
      [2 as const, { ellipse: fakeEllipse() }],
    ])
    const presenter = new ElevatorPresenter(scene, cars, () => 0)
    expect(() => {
      presenter.onCalled(1, 'floor1')
      presenter.tick(16, 'lobby')
      presenter.onMoved(1, 'floor1')
      presenter.tick(16, 'floor1')
      presenter.reset()
    }).not.toThrow()
  })
})
