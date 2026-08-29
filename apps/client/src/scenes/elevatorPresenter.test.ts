import { describe, expect, it } from 'vitest'
import {
  advanceCarClock,
  applyCalled,
  applyMoved,
  carAlpha,
  carVisible,
  carY,
  DEFAULT_ANIMATION_CONFIG,
  doorsOpenAmount,
  ElevatorPresenter,
  type EllipseLike,
  type GraphicsLike,
  initialCarClock,
} from './elevatorPresenter'

const cfg = DEFAULT_ANIMATION_CONFIG

// Elevator animation (cycle `elevator-animation`): pure clock reducer tests.
// Every case maps to a spec.md acceptance criterion (ELAN-01..11) or a
// listed edge case — see .specs/features/elevator-animation/spec.md.

describe('elevator clock — doors open at every stop (ELAN-01)', () => {
  it('renders doors fully open once the arrival swing finishes', () => {
    const clock = applyMoved(initialCarClock('lobby'), 'floor1')
    expect(clock.phase).toBe('open')
    const swungOpen = advanceCarClock(clock, cfg.doorAnimMs, cfg)
    expect(doorsOpenAmount(swungOpen, cfg)).toBe(1)
    expect(carVisible(swungOpen)).toBe(true)
  })

  it('keeps doors fully open through the rest of the dwell window', () => {
    const open = advanceCarClock(initialCarClock('floor1'), cfg.doorAnimMs, cfg)
    expect(doorsOpenAmount(open, cfg)).toBe(1)
    const stillOpen = advanceCarClock(open, cfg.dwellMs - cfg.doorAnimMs - 1, cfg)
    expect(doorsOpenAmount(stillOpen, cfg)).toBe(1)
  })
})

describe('elevator clock — doors close before departure (ELAN-02)', () => {
  it('closes automatically once the dwell window elapses with no redirect', () => {
    const open = advanceCarClock(initialCarClock('floor1'), cfg.doorAnimMs, cfg)
    const closingStart = advanceCarClock(open, cfg.dwellMs - cfg.doorAnimMs, cfg)
    expect(closingStart.phase).toBe('closing')

    const closingMidway = advanceCarClock(closingStart, cfg.doorAnimMs / 2, cfg)
    expect(doorsOpenAmount(closingMidway, cfg)).toBeLessThan(1)
    expect(doorsOpenAmount(closingMidway, cfg)).toBeGreaterThan(0)
    expect(carVisible(closingMidway)).toBe(true)

    const transit = advanceCarClock(closingMidway, cfg.doorAnimMs, cfg)
    expect(doorsOpenAmount(transit, cfg)).toBe(0)
    expect(carVisible(transit)).toBe(false)
  })

  it('measures the dwell window from elevator:moved, not from the end of the arrival swing', () => {
    // A fresh arrival starts elapsedMs at 0. The dwell deadline is therefore
    // exactly cfg.dwellMs after the event, regardless of how long the door
    // swing or fade takes.
    const arrived = applyMoved(initialCarClock('lobby'), 'floor1')
    const justBeforeDwell = advanceCarClock(arrived, cfg.dwellMs - 1, cfg)
    expect(justBeforeDwell.phase).toBe('open')
    const atDwell = advanceCarClock(justBeforeDwell, 1, cfg)
    expect(atDwell.phase).toBe('closing')
  })

  it('closes immediately on a public call to a different floor, not waiting for dwell', () => {
    const open = initialCarClock('floor1')
    const called = applyCalled(open, 'floor2')
    expect(called.phase).toBe('closing')
    const transit = advanceCarClock(called, cfg.doorAnimMs, cfg)
    expect(carVisible(transit)).toBe(false)
  })
})

describe('elevator clock — fixed minimum transit duration, distance-independent (ELAN-05, ELAN-08)', () => {
  it('holds the transit visual for at least minTransitMs even if the real arrival is faster', () => {
    const open = initialCarClock('floor1')
    const closing = applyCalled(open, 'floor2')
    const transit = advanceCarClock(closing, cfg.doorAnimMs, cfg)
    expect(transit.phase).toBe('transit')

    const withPending = applyMoved(transit, 'floor2')
    const tooEarly = advanceCarClock(withPending, cfg.minTransitMs - 1, cfg)
    expect(tooEarly.phase).toBe('transit')
    expect(carVisible(tooEarly)).toBe(false)

    const resolved = advanceCarClock(tooEarly, 1, cfg)
    expect(resolved.phase).toBe('open')
    expect(resolved.floor).toBe('floor2')
  })

  it('derives minTransitMs from TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR', () => {
    expect(cfg.minTransitMs).toBe(2000)
  })

  it('never derives transit duration from real ride distance (no distance parameter exists)', () => {
    const openA = initialCarClock('lobby')
    const transitA = advanceCarClock(applyCalled(openA, 'floor3'), cfg.doorAnimMs, cfg)
    const openB = initialCarClock('lobby')
    const transitB = advanceCarClock(applyCalled(openB, 'floor1'), cfg.doorAnimMs, cfg)
    expect(transitA.phase).toBe('transit')
    expect(transitB.phase).toBe('transit')
    expect(advanceCarClock(transitA, cfg.minTransitMs - 1, cfg).phase).toBe('transit')
    expect(advanceCarClock(transitB, cfg.minTransitMs - 1, cfg).phase).toBe('transit')
  })
})

describe('elevator clock — arrival renders motion, not an instant snap (ELAN-06, ELAN-07)', () => {
  it('fades in over arrivalAnimMs rather than snapping to full opacity', () => {
    const arriving = applyMoved(initialCarClock('lobby'), 'floor1')
    expect(arriving.phase).toBe('open')
    expect(arriving.fromFloor).toBe('lobby')
    const halfway = advanceCarClock(arriving, cfg.arrivalAnimMs / 2, cfg)
    expect(carAlpha(halfway, cfg)).toBeGreaterThan(0)
    expect(carAlpha(halfway, cfg)).toBeLessThan(1)
    const done = advanceCarClock(halfway, cfg.arrivalAnimMs / 2, cfg)
    expect(carAlpha(done, cfg)).toBe(1)
  })

  it('slides vertically over arrivalAnimMs rather than snapping to baseY', () => {
    const arriving = applyMoved(initialCarClock('lobby'), 'floor1')
    const baseY = 460
    const start = carY(arriving, cfg, baseY)
    expect(start).toBeLessThan(baseY)
    const halfway = advanceCarClock(arriving, cfg.arrivalAnimMs / 2, cfg)
    const mid = carY(halfway, cfg, baseY)
    expect(mid).toBeGreaterThan(start)
    expect(mid).toBeLessThan(baseY)
    const done = advanceCarClock(halfway, cfg.arrivalAnimMs / 2, cfg)
    expect(carY(done, cfg, baseY)).toBe(baseY)
  })

  it('derives arrival timings from TUNING.ELEVATOR_ARRIVE_SECONDS', () => {
    expect(cfg.doorAnimMs).toBe(300)
    expect(cfg.arrivalAnimMs).toBe(300)
  })
})

describe('elevator clock — decoy re-call does not restart the door animation (edge case)', () => {
  it('is a no-op when called for the floor it is already parked open at', () => {
    const open = initialCarClock('floor1')
    const advancedOpen = advanceCarClock(open, 200, cfg)
    const recalled = applyCalled(advancedOpen, 'floor1')
    expect(recalled).toEqual(advancedOpen)
  })

  it('is a no-op when already mid-transit (call for yet another floor)', () => {
    const open = initialCarClock('floor1')
    const closing = applyCalled(open, 'floor2')
    const transit = advanceCarClock(closing, cfg.doorAnimMs, cfg)
    const recalled = applyCalled(transit, 'floor3')
    expect(recalled).toBe(transit)
  })
})

// Fake structural implementations — no `phaser` import needed (module design
// goal: constructible and testable under plain node, spec ELAN-09/10).

function fakeGraphics(): GraphicsLike & {
  rects: { x: number; y: number; w: number; h: number }[]
} {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  return {
    clear: () => {
      rects.length = 0
    },
    fillStyle: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h })
    },
    destroy: () => {},
    rects,
  }
}

function fakeScene(graphics: ReturnType<typeof fakeGraphics>) {
  return { add: { graphics: () => graphics } }
}

function fakeEllipse(): EllipseLike & { visible: boolean; alpha: number; y: number } {
  let visible = true
  let alpha = 1
  let y = 0
  return {
    x: 0,
    get y() {
      return y
    },
    setVisible: (v: boolean) => {
      visible = v
    },
    setAlpha: (a: number) => {
      alpha = a
    },
    setY: (value: number) => {
      y = value
    },
    get visible() {
      return visible
    },
    get alpha() {
      return alpha
    },
  }
}

describe('ElevatorPresenter — Phaser-facing wiring', () => {
  it('hides a car once its floor no longer matches the view floor (ELAN-04)', () => {
    const graphics = fakeGraphics()
    const scene = fakeScene(graphics)
    const car1 = fakeEllipse()
    const car2 = fakeEllipse()
    const cars = new Map([
      [1 as const, { ellipse: car1 }],
      [2 as const, { ellipse: car2 }],
    ])
    const presenter = new ElevatorPresenter(
      scene,
      cars,
      () => 0,
      () => 460,
    )

    presenter.tick(0, 'lobby')
    expect(car1.visible).toBe(true)

    presenter.tick(0, 'floor1')
    expect(car1.visible).toBe(false)
    expect(graphics.rects.length).toBe(0)
  })

  it('draws doors with a real gap when open and no gap when closed (ELAN-01/02 render proof)', () => {
    const graphics = fakeGraphics()
    const scene = fakeScene(graphics)
    const car1 = fakeEllipse()
    const cars = new Map([[1 as const, { ellipse: car1 }]])
    const presenter = new ElevatorPresenter(
      scene,
      cars,
      () => 100,
      () => 460,
    )

    // Fully open: two rects, each with a positive gap from the center.
    presenter.onMoved(1, 'floor1')
    presenter.tick(cfg.doorAnimMs, 'floor1')
    expect(graphics.rects.length).toBe(2)
    const leftOpen = graphics.rects[0]
    const rightOpen = graphics.rects[1]
    if (leftOpen === undefined || rightOpen === undefined) {
      throw new Error('expected two door rects')
    }
    expect(leftOpen.w).toBeLessThan(23)
    expect(rightOpen.x).toBeGreaterThan(100)

    // Closed: two rects that tile the full door width with zero center gap.
    presenter.onCalled(1, 'floor2')
    presenter.tick(cfg.doorAnimMs, 'floor1')
    expect(graphics.rects.length).toBe(2)
    const leftClosed = graphics.rects[0]
    const rightClosed = graphics.rects[1]
    if (leftClosed === undefined || rightClosed === undefined) {
      throw new Error('expected two door rects')
    }
    expect(leftClosed.w).toBe(23)
    expect(rightClosed.x).toBe(100)
  })

  it('does not render arrival/transit for elevator:moved on a different floor (ELAN-07)', () => {
    const graphics = fakeGraphics()
    const scene = fakeScene(graphics)
    const car1 = fakeEllipse()
    const cars = new Map([[1 as const, { ellipse: car1 }]])
    const presenter = new ElevatorPresenter(
      scene,
      cars,
      () => 100,
      () => 460,
    )

    // Viewer is on floor1; car arrives on floor2.
    presenter.onMoved(1, 'floor2')
    presenter.tick(cfg.doorAnimMs, 'floor1')
    expect(car1.visible).toBe(false)
    expect(graphics.rects.length).toBe(0)
  })

  it('constructing and calling every public method does not throw', () => {
    const graphics = fakeGraphics()
    const scene = fakeScene(graphics)
    const cars = new Map([
      [1 as const, { ellipse: fakeEllipse() }],
      [2 as const, { ellipse: fakeEllipse() }],
    ])
    const presenter = new ElevatorPresenter(
      scene,
      cars,
      () => 0,
      () => 460,
    )
    expect(() => {
      presenter.onCalled(1, 'floor1')
      presenter.tick(16, 'lobby')
      presenter.onMoved(1, 'floor1')
      presenter.tick(16, 'floor1')
      presenter.reset()
    }).not.toThrow()
  })
})
