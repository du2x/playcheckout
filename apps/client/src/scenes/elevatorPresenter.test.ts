import { describe, expect, it } from 'vitest'
import {
  advanceCarClock,
  applyCalled,
  applyDoors,
  applyMoved,
  arrivalBurstAlpha,
  CAR_SCENE,
  type CarViewLike,
  carAlpha,
  carSwayY,
  carVisible,
  carY,
  DEFAULT_ANIMATION_CONFIG,
  doorsOpenAmount,
  ElevatorPresenter,
  initialCarClock,
} from './elevatorPresenter'

const cfg = DEFAULT_ANIMATION_CONFIG

// Elevator animation (cycle `elevator-animation`, AD-026/027): pure clock
// reducer tests. The presenter's door phases are driven by the public
// `elevator:doors` events — the sim's door state is the single truth; the
// presenter never guesses a close from a dwell timer.

function arrive(from: 'lobby' | 'floor1' | 'floor2', to: 'lobby' | 'floor1' | 'floor2') {
  return applyDoors(applyMoved(initialCarClock(from), to), to, true)
}

describe('elevator clock — boot: parked with the doors shut', () => {
  it('starts closed and visible with the slab frame', () => {
    const clock = initialCarClock('lobby')
    expect(clock.phase).toBe('closed')
    expect(carVisible(clock)).toBe(true)
    expect(doorsOpenAmount(clock, cfg)).toBe(0)
  })
})

describe('elevator clock — door events drive everything (AD-026/027)', () => {
  it('plays the opening swing when the doors-open event lands', () => {
    const clock = applyDoors(initialCarClock('lobby'), 'lobby', true)
    expect(clock.phase).toBe('opening')
    const midSwing = advanceCarClock(clock, cfg.doorAnimMs / 2, cfg)
    expect(doorsOpenAmount(midSwing, cfg)).toBeGreaterThan(0)
    expect(doorsOpenAmount(midSwing, cfg)).toBeLessThan(1)
    const swungOpen = advanceCarClock(midSwing, cfg.doorAnimMs / 2, cfg)
    expect(swungOpen.phase).toBe('open')
    expect(doorsOpenAmount(swungOpen, cfg)).toBe(1)
    expect(carVisible(swungOpen)).toBe(true)
  })

  it('an arrival moves the clock into the opening swing with the arrival slide', () => {
    // The sim emits moved (position) then doors(open) at every arrival.
    const opened = arrive('lobby', 'floor1')
    expect(opened.phase).toBe('opening')
    expect(opened.fromFloor).toBe('lobby')
    const halfway = advanceCarClock(opened, cfg.arrivalAnimMs / 2, cfg)
    expect(carAlpha(halfway, cfg)).toBeGreaterThan(0)
    expect(carAlpha(halfway, cfg)).toBeLessThan(1)
    const done = advanceCarClock(halfway, cfg.arrivalAnimMs / 2, cfg)
    expect(carAlpha(done, cfg)).toBe(1)
  })

  it('slides vertically over arrivalAnimMs rather than snapping to baseY', () => {
    const opened = arrive('lobby', 'floor1')
    const baseY = 460
    const start = carY(opened, cfg, baseY)
    expect(start).toBeLessThan(baseY)
    const halfway = advanceCarClock(opened, cfg.arrivalAnimMs / 2, cfg)
    const mid = carY(halfway, cfg, baseY)
    expect(mid).toBeGreaterThan(start)
    expect(mid).toBeLessThan(baseY)
    const done = advanceCarClock(halfway, cfg.arrivalAnimMs / 2, cfg)
    expect(carY(done, cfg, baseY)).toBe(baseY)
  })

  it('keeps doors fully open indefinitely while no call arrives (AD-027)', () => {
    const open = advanceCarClock(
      applyDoors(initialCarClock('floor1'), 'floor1', true),
      cfg.doorAnimMs,
      cfg,
    )
    expect(open.phase).toBe('open')
    // Far beyond any dwell window: no close event = no close. The doors
    // stay open while the car has no call to attend.
    const muchLater = advanceCarClock(open, 60_000, cfg)
    expect(muchLater.phase).toBe('open')
    expect(doorsOpenAmount(muchLater, cfg)).toBe(1)
  })

  it('closes only on a real doors-close event, into a departure (hidden)', () => {
    const open = advanceCarClock(
      applyDoors(initialCarClock('floor1'), 'floor1', true),
      cfg.doorAnimMs,
      cfg,
    )
    const closing = applyDoors(open, 'floor1', false)
    expect(closing.phase).toBe('closing')
    const closingMidway = advanceCarClock(closing, cfg.doorAnimMs / 2, cfg)
    expect(doorsOpenAmount(closingMidway, cfg)).toBeLessThan(1)
    expect(doorsOpenAmount(closingMidway, cfg)).toBeGreaterThan(0)
    expect(carVisible(closingMidway)).toBe(true)
    const transit = advanceCarClock(closingMidway, cfg.doorAnimMs, cfg)
    expect(doorsOpenAmount(transit, cfg)).toBe(0)
    expect(carVisible(transit)).toBe(false)
  })

  it('a doors-open event resolves a mid-ride transit immediately (ground truth)', () => {
    const open = advanceCarClock(
      applyDoors(initialCarClock('lobby'), 'lobby', true),
      cfg.doorAnimMs,
      cfg,
    )
    const transit = advanceCarClock(applyDoors(open, 'lobby', false), cfg.doorAnimMs, cfg)
    expect(transit.phase).toBe('transit')
    // The ride: position updates arrive first (the sweep readout), then the
    // doors-open event at the destination — no fixed minimum transit wait.
    const swept = applyMoved(transit, 'floor1')
    expect(swept.floor).toBe('floor1')
    expect(swept.phase).toBe('transit')
    const resolved = applyDoors(swept, 'floor1', true)
    expect(resolved.phase).toBe('opening')
    expect(resolved.fromFloor).toBe('lobby')
    expect(doorsOpenAmount(advanceCarClock(resolved, cfg.doorAnimMs, cfg), cfg)).toBe(1)
  })

  it('a stale close for a car already hidden is a no-op', () => {
    const open = advanceCarClock(
      applyDoors(initialCarClock('lobby'), 'lobby', true),
      cfg.doorAnimMs,
      cfg,
    )
    const transit = advanceCarClock(applyDoors(open, 'lobby', false), cfg.doorAnimMs, cfg)
    const stale = applyDoors(transit, 'lobby', false)
    expect(stale).toBe(transit)
  })

  it('applies position updates from elevator:moved without touching the door phase', () => {
    const open = advanceCarClock(
      applyDoors(initialCarClock('floor1'), 'floor1', true),
      cfg.doorAnimMs,
      cfg,
    )
    const same = applyMoved(open, 'floor1')
    expect(same).toBe(open)
    const movedFloor = applyMoved(open, 'floor2')
    expect(movedFloor.phase).toBe('open')
    expect(movedFloor.floor).toBe('floor2')
  })

  it('a public call never touches the door phases (the door events drive the rest)', () => {
    const open = advanceCarClock(
      applyDoors(initialCarClock('floor1'), 'floor1', true),
      cfg.doorAnimMs,
      cfg,
    )
    expect(applyCalled(open, 'floor1')).toBe(open)
    expect(applyCalled(open, 'floor2')).toBe(open)
    const closed = initialCarClock('floor1')
    expect(applyCalled(closed, 'floor2')).toBe(closed)
  })
})

describe('elevator clock — timing provenance', () => {
  it('derives the door swing from TUNING.ELEVATOR_DOOR_SECONDS (AD-026) and the fade from ARRIVE_SECONDS', () => {
    expect(cfg.doorAnimMs).toBe(500)
    expect(cfg.arrivalAnimMs).toBe(300)
  })
})

// Fake structural implementations — no `phaser` import needed (module design
// goal: constructible and testable under plain node, spec ELAN-09/10).

function fakeCarView(): CarViewLike & {
  visible: boolean
  alpha: number
  y: number
  frames: number[]
} {
  let visible = true
  let alpha = 1
  let y = 0
  const frames: number[] = []
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
    setFrame: (frame: number) => {
      frames.push(frame)
    },
    get visible() {
      return visible
    },
    get alpha() {
      return alpha
    },
    frames,
  }
}

describe('ElevatorPresenter — Phaser-facing wiring', () => {
  it('renders the closed slab on floors the car is not on (ELAN-04, ART-15)', () => {
    const car1 = fakeCarView()
    const car2 = fakeCarView()
    const cars = new Map([
      [1 as const, { view: car1 }],
      [2 as const, { view: car2 }],
    ])
    const presenter = new ElevatorPresenter(cars, () => 460)

    presenter.tick(0, 'lobby')
    expect(car1.visible).toBe(true)

    presenter.tick(0, 'floor1')
    expect(car1.visible).toBe(true)
    expect(car1.frames.at(-1)).toBe(1)
    expect(car1.alpha).toBe(1)
  })

  it('renders the doors-open cage frame while open and the closed slab once closed (ELAN-01/02, ART-15)', () => {
    const car1 = fakeCarView()
    const cars = new Map([[1 as const, { view: car1 }]])
    const presenter = new ElevatorPresenter(cars, () => 460)

    // Fully open (arrival swing done): the doors-open cage frame (ART-15).
    presenter.onMoved(1, 'floor1')
    presenter.onDoors(1, 'floor1', true)
    presenter.tick(cfg.doorAnimMs, 'floor1')
    expect(car1.frames.at(-1)).toBe(0)

    // Closed (the car departed): the closed slab — then hidden in transit.
    presenter.onDoors(1, 'floor1', false)
    presenter.tick(cfg.doorAnimMs, 'floor1')
    expect(car1.frames.at(-1)).toBe(1)
  })

  it('renders a car parked on a floor the viewer is not on as the closed slab (ELAN-04)', () => {
    const car1 = fakeCarView()
    const cars = new Map([[1 as const, { view: car1 }]])
    const presenter = new ElevatorPresenter(cars, () => 460)

    // Viewer is on floor1; car arrives on floor2.
    presenter.onMoved(1, 'floor2')
    presenter.onDoors(1, 'floor2', true)
    presenter.tick(cfg.doorAnimMs, 'floor1')
    expect(car1.visible).toBe(true)
    expect(car1.frames.at(-1)).toBe(1)
  })

  it('constructing and calling every public method does not throw', () => {
    const cars = new Map([
      [1 as const, { view: fakeCarView() }],
      [2 as const, { view: fakeCarView() }],
    ])
    const presenter = new ElevatorPresenter(cars, () => 460)
    expect(() => {
      presenter.onCalled(1, 'floor1')
      presenter.tick(16, 'lobby')
      presenter.onMoved(1, 'floor1')
      presenter.onDoors(1, 'floor1', true)
      presenter.tick(16, 'floor1')
      presenter.onDoors(1, 'floor1', false)
      presenter.reset()
    }).not.toThrow()
  })
})

describe('ElevatorPresenter — presentation state (AD-038: one clock authority)', () => {
  function makePresenter() {
    const car1 = fakeCarView()
    const car2 = fakeCarView()
    const cars = new Map([
      [1 as const, { view: car1 }],
      [2 as const, { view: car2 }],
    ])
    return { car1, car2, presenter: new ElevatorPresenter(cars, () => 460) }
  }

  it('lights a hall call only when the car is NOT already at the called floor (AD-024 decoy)', () => {
    const { presenter } = makePresenter()
    expect(presenter.panelState().light).toBe(false)
    presenter.onCalled(1, 'floor1') // car stands at the lobby: the call registers
    expect(presenter.panelState().light).toBe(true)
    const decoy = makePresenter()
    decoy.presenter.onMoved(1, 'floor1')
    decoy.presenter.onCalled(1, 'floor1') // already standing there: nothing to wait for
    expect(decoy.presenter.panelState().light).toBe(false)
  })

  it('clears the hall light on the next arrival (single car — cycle 3.E, AD-040)', () => {
    const { presenter } = makePresenter()
    presenter.onCalled(1, 'floor1')
    expect(presenter.panelState().light).toBe(true)
    presenter.onMoved(1, 'floor1')
    expect(presenter.panelState().light).toBe(false)
  })

  it('flashes the called-floor panels for the window, then idle (ART-17)', () => {
    const { presenter } = makePresenter()
    const t0 = Date.now() // `until` anchors to wall-clock inside onCalled
    presenter.onCalled(1, 'floor1')
    expect(presenter.isFlashing('floor1', t0 + 100)).toBe(true)
    expect(presenter.isFlashing('floor2', t0 + 100)).toBe(false)
    expect(presenter.isFlashing('floor1', t0 + 700)).toBe(false)
  })

  it('reports car floors from the clocks; snapshots unify through onMoved', () => {
    const { presenter } = makePresenter()
    expect(presenter.floorOf(1)).toBe('lobby')
    presenter.onMoved(1, 'floor2') // snapshot seeding uses the same path
    expect(presenter.floorOf(1)).toBe('floor2')
    expect(presenter.panelState().floor).toBe('floor2')
  })

  it('clears the car-screen readout when not riding', () => {
    const { presenter } = makePresenter()
    presenter.tick(16, 'lobby', null)
    expect(presenter.carScreen()).toEqual({ floor: null, state: null })
  })

  it('derives the parked readout from the own car clock', () => {
    const { presenter } = makePresenter()
    presenter.onDoors(1, 'lobby', true)
    presenter.tick(cfg.doorAnimMs / 2, 'lobby', { car: 1, queue: ['floor1'] })
    expect(presenter.carScreen()).toEqual({ floor: 'lobby', state: 'doors opening' })
    presenter.tick(cfg.doorAnimMs, 'lobby', { car: 1, queue: ['floor1'] })
    expect(presenter.carScreen()).toEqual({ floor: 'lobby', state: 'doors open' })
  })

  it('sweeps the transit readout from the press queue, re-anchoring per leg', () => {
    const { presenter } = makePresenter()
    // The car is mid-transit (the doors closed into a departure).
    presenter.onMoved(1, 'lobby')
    presenter.onDoors(1, 'lobby', false)
    presenter.tick(cfg.doorAnimMs, 'lobby', { car: 1, queue: ['floor1'] })
    const early = presenter.carScreen()
    expect(early.state).toBe('moving to 1')
    presenter.tick(1000, 'lobby', { car: 1, queue: ['floor1'] })
    presenter.tick(1000, 'lobby', { car: 1, queue: ['floor1'] })
    expect(presenter.carScreen().floor).not.toBe(early.floor) // the sweep advanced
    // A retarget re-anchors the sweep from the known departure.
    presenter.tick(0, 'lobby', { car: 1, queue: ['floor2'] })
    expect(presenter.carScreen().state).toBe('moving to 2')
  })
})

describe('car-scene presentation (AD-054)', () => {
  it('the ride sway oscillates within its amplitude and repeats', () => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let t = 0; t < CAR_SCENE.swayPeriodMs; t += 20) {
      const y = carSwayY(t)
      min = Math.min(min, y)
      max = Math.max(max, y)
    }
    expect(min).toBeGreaterThanOrEqual(-CAR_SCENE.swayAmplitudePx)
    expect(max).toBeLessThanOrEqual(CAR_SCENE.swayAmplitudePx)
    expect(max).toBeGreaterThan(0)
    expect(carSwayY(0)).toBeCloseTo(carSwayY(CAR_SCENE.swayPeriodMs), 9)
  })

  it('the arrival burst: rest → peak mid-fade → rest', () => {
    expect(arrivalBurstAlpha(-1)).toBe(CAR_SCENE.burstRestAlpha)
    const peak = arrivalBurstAlpha(CAR_SCENE.burstFadeMs / 2)
    expect(peak).toBeCloseTo(CAR_SCENE.burstPeakAlpha, 5)
    const rising = arrivalBurstAlpha(CAR_SCENE.burstFadeMs / 4)
    expect(rising).toBeGreaterThan(CAR_SCENE.burstRestAlpha)
    expect(rising).toBeLessThan(peak)
    expect(arrivalBurstAlpha(CAR_SCENE.burstFadeMs)).toBe(CAR_SCENE.burstRestAlpha)
    expect(arrivalBurstAlpha(10_000)).toBe(CAR_SCENE.burstRestAlpha)
  })
})
