import type { FloorId } from '@turnover/shared'
import { TUNING } from '@turnover/shared'
import type { RiderUpdate } from '../riderSession'
import { el } from './dom'

/**
 * In-car screen (AD-013 presentation surface): a fullscreen overlay shown only
 * while the local player rides a car, with the car's current floor and the
 * floor buttons — lit while the floor is queued or being served. It renders
 * from the same RiderSession the chip consumes (one state home,
 * riderSession.ts); the current-floor readout is driven by the world scene
 * from the public per-car position (same data as the hallway panel). Purely
 * client-side presentation over existing payloads — no new message types,
 * nothing hidden is named (the queue is rider-exclusive knowledge the session
 * already holds).
 */

/** Car-panel order: top floor first, lobby last — like a real car station. */
const CAR_BUTTONS: readonly { floor: FloorId; label: string }[] = [
  { floor: 'floor3', label: '3' },
  { floor: 'floor2', label: '2' },
  { floor: 'floor1', label: '1' },
  { floor: 'lobby', label: 'L' },
]

const FLOOR_LABELS: Record<string, string> = {
  lobby: 'L',
  floor1: '1',
  floor2: '2',
  floor3: '3',
}

/** Building floor order, ground up — the sweep path for transit readouts. */
const FLOOR_ORDER: readonly FloorId[] = ['lobby', 'floor1', 'floor2', 'floor3']

/** The short glyph for a floor id (`L` for the lobby). */
export function floorLabel(floor: FloorId): string {
  return FLOOR_LABELS[floor] ?? floor
}

/**
 * The transition-floor sweep (client-only presentation): where a car riding
 * `from` → `to` reads on the floor display after `elapsedMs` of transit — it
 * steps through every intermediate floor, one `ELEVATOR_RIDE_SECONDS_PER_FLOOR`
 * stride each, mirroring the sim's per-floor ride cost. Pure so the sweep is
 * unit-testable without a scene.
 */
export function transitFloorReadout(from: FloorId, to: FloorId, elapsedMs: number): FloorId {
  const i0 = FLOOR_ORDER.indexOf(from)
  const i1 = FLOOR_ORDER.indexOf(to)
  if (i0 < 0 || i1 < 0 || i0 === i1) return from
  const strideMs = TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR * 1000
  const passed = Math.min(Math.abs(i1 - i0), Math.floor(elapsedMs / strideMs))
  return FLOOR_ORDER[i0 + Math.sign(i1 - i0) * passed] ?? from
}

const STYLE_ID = 'elevator-car-screen-styles'

const STYLE = `
#elevator-car-screen {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: rgba(8, 13, 20, 0.96);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
#elevator-car-screen[hidden] { display: none; }
.car-screen-inner {
  pointer-events: auto;
  background: #16202c;
  border: 2px solid #556677;
  border-radius: 12px;
  padding: 26px 40px;
  color: #dfe8f2;
  font-family: monospace;
  text-align: center;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65);
}
.car-screen-title { font-size: 13px; letter-spacing: 3px; color: #8899aa; }
.car-screen-floor {
  font-size: 72px;
  line-height: 1;
  color: #e6c56a;
  margin: 12px 0 4px;
}
.car-screen-floor-label { font-size: 12px; color: #667788; letter-spacing: 2px; }
.car-screen-state { font-size: 13px; color: #8ad07a; margin-top: 6px; min-height: 15px; }
.car-buttons { display: grid; grid-template-columns: repeat(2, 56px); gap: 12px; justify-content: center; margin-top: 18px; }
.car-button {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid #556677;
  background: #1d2a38;
  color: #dfe8f2;
  font-family: monospace;
  font-size: 22px;
  cursor: pointer;
  touch-action: manipulation;
}
.car-button.lit {
  background: #c8a24a;
  border-color: #e6c56a;
  color: #111;
  box-shadow: 0 0 10px #c8a24a;
}
.car-screen-occupants { font-size: 12px; color: #aabbcc; margin-top: 16px; min-height: 14px; }
.car-screen-hint { font-size: 11px; color: #667788; margin-top: 8px; }
`

/** Mount once per HUD build; the stylesheet is injected idempotently. */
export function buildCarScreen(): HTMLElement {
  if (document.getElementById(STYLE_ID) === null) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLE
    document.head.appendChild(style)
  }
  return el('div', { id: 'elevator-car-screen', hidden: '' }, [
    el('div', { class: 'car-screen-inner' }, [
      el('div', { class: 'car-screen-title' }, ['elevator']),
      el('div', { class: 'car-screen-floor' }, ['']),
      el('div', { class: 'car-screen-floor-label' }, ['floor']),
      el('div', { class: 'car-screen-state' }, []),
      el(
        'div',
        { class: 'car-buttons' },
        CAR_BUTTONS.map(({ floor, label }) =>
          el('button', { class: 'car-button', 'data-floor': floor }, [label]),
        ),
      ),
      el('div', { class: 'car-screen-occupants' }, []),
      el('div', { class: 'car-screen-hint' }, ['keys: 1 · 2 · 3 · 0']),
    ]),
  ])
}

/**
 * Mirror the rider session onto the screen: visible only while riding, each
 * button lit while its floor is in the own car's queue. Idempotent — safe to
 * call on every rider-session change and after every view re-render. `press`
 * forwards button taps to the same channel the keymap uses; pointerdown (not
 * click) keeps the button from taking focus and stealing the game's Space key.
 */
export function syncCarScreen(
  riding: RiderUpdate,
  occupantNames: readonly string[],
  press: (floor: FloorId) => void,
): void {
  const screen = document.getElementById('elevator-car-screen')
  if (screen === null) return
  if (riding === null) {
    screen.setAttribute('hidden', '')
    return
  }
  screen.removeAttribute('hidden')
  const occupants = screen.querySelector('.car-screen-occupants')
  if (occupants !== null) occupants.textContent = occupantNames.join(', ')
  for (const button of screen.querySelectorAll<HTMLElement>('.car-button')) {
    const floor = button.dataset.floor as FloorId | undefined
    button.classList.toggle('lit', floor !== undefined && riding.queue.includes(floor))
    if (button.dataset.wired !== 'true') {
      button.dataset.wired = 'true'
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        press(floor as FloorId)
      })
    }
  }
}

/**
 * Current-floor readout (world-scene driven every frame, self-healing like the
 * hallway panel): the own car's public position — swept through transition
 * floors while the car rides. `null` clears the readout.
 */
export function setCarScreenFloor(floor: string | null): void {
  const screen = document.getElementById('elevator-car-screen')
  if (screen === null) return
  const readout = screen.querySelector('.car-screen-floor')
  if (readout !== null) readout.textContent = floor === null ? '' : floorLabel(floor as FloorId)
}

/**
 * Elevator state line (world-scene driven every frame): "doors open", "doors
 * closing", or "moving to N" — derived client-side from the same animation
 * clock that drives the door visuals, never a new wire message. `null` clears.
 */
export function setCarScreenState(state: string | null): void {
  const screen = document.getElementById('elevator-car-screen')
  if (screen === null) return
  const line = screen.querySelector('.car-screen-state')
  if (line !== null) line.textContent = state ?? ''
}
