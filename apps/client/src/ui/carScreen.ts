import type { FloorId } from '@turnover/shared'
import { TUNING } from '@turnover/shared'
import type { RiderUpdate } from '../riderSession'
import { el } from './dom'

/**
 * In-car screen (AD-013 presentation surface): a fullscreen overlay shown only
 * while the local player rides a car — a deco car station with the current
 * floor readout (direction arrow while moving), the floor-button panel as a
 * vertical ladder (lit while queued, haloed on the current floor), and the
 * rider chips (rider-exclusive knowledge the session already holds). It
 * renders from the same RiderSession the chip consumes (one state home,
 * riderSession.ts); the current-floor readout is driven by the world scene
 * from the public per-car position (same data as the hallway panel). Purely
 * client-side presentation over existing payloads — no new message types,
 * nothing hidden is named.
 */

/** Car-panel order: top floor first, lobby last — like a real car station.
 *  The 3.C mezzanine rides between floor1 and the lobby (its building order). */
const CAR_BUTTONS: readonly { floor: FloorId; label: string }[] = [
  { floor: 'floor3', label: '3' },
  { floor: 'floor2', label: '2' },
  { floor: 'floor1', label: '1' },
  { floor: 'mezzanine', label: 'M' },
  { floor: 'lobby', label: 'L' },
]

const FLOOR_LABELS: Record<string, string> = {
  lobby: 'L',
  mezzanine: 'M',
  floor1: '1',
  floor2: '2',
  floor3: '3',
}

/** Building floor order, ground up — the sweep path for transit readouts.
 *  Mirrors the sim's FLOOR_IDS order (mezzanine directly above the lobby).
 *  Exported for sibling stair screen direction math (same building). */
export const FLOOR_ORDER: readonly FloorId[] = ['lobby', 'mezzanine', 'floor1', 'floor2', 'floor3']

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
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: transparent;
}
#elevator-car-screen[hidden] { display: none; }
.car-screen-inner {
  pointer-events: auto;
  min-width: 340px;
  max-width: 420px;
  background: linear-gradient(180deg, #1b2530 0%, #131b24 60%, #0f161e 100%);
  border: 1px solid #7a6a42;
  border-radius: 14px;
  outline: 1px solid #2a3542;
  outline-offset: -6px;
  padding: 22px 30px 18px;
  color: #dfe8f2;
  font-family: ui-monospace, monospace;
  text-align: center;
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.76),
    0 0 0 1px rgba(0, 0, 0, 0.62) inset,
    0 1px 0 rgba(230, 197, 106, 0.12) inset;
  animation: car-screen-in 220ms ease-out;
}
@keyframes car-screen-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
.car-screen-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #2a3542;
  padding-bottom: 10px;
  margin-bottom: 16px;
}
.car-screen-title {
  font-size: 11px;
  letter-spacing: 4px;
  color: #8899aa;
  text-transform: uppercase;
}
.car-screen-car {
  font-size: 11px;
  letter-spacing: 2px;
  color: #e6c56a;
  border: 1px solid #55492c;
  border-radius: 4px;
  padding: 2px 8px;
  background: rgba(230, 197, 106, 0.07);
}
.car-screen-body {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 22px;
}
.car-screen-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 150px;
  padding: 18px 20px 12px;
  border-radius: 8px;
  border: 1px solid #060a0e;
  background:
    radial-gradient(ellipse at 50% 20%, rgba(230, 197, 106, 0.09) 0%, transparent 70%),
    linear-gradient(180deg, #0a0f14, #070b0f);
  box-shadow:
    0 0 22px rgba(230, 197, 106, 0.08) inset,
    0 1px 0 rgba(255, 255, 255, 0.05);
}
.car-screen-arrow {
  height: 18px;
  font-size: 15px;
  line-height: 18px;
  color: #e6c56a;
  text-shadow: 0 0 8px rgba(230, 197, 106, 0.82);
}
.car-screen-arrow.up, .car-screen-arrow.down { animation: car-arrow-blink 1s steps(2) infinite; }
.car-screen-arrow[data-dir='none'] { visibility: hidden; }
@keyframes car-arrow-blink {
  0% { opacity: 1; }
  50% { opacity: 0.25; }
}
.car-screen-floor {
  font-size: 76px;
  line-height: 1;
  font-weight: bold;
  color: #ffd98a;
  text-shadow: 0 0 18px rgba(230, 197, 106, 0.55), 0 0 4px rgba(255, 217, 138, 0.9);
  margin: 8px 0 6px;
  font-variant-numeric: tabular-nums;
}
.car-screen-floor-label { font-size: 11px; color: #66788a; letter-spacing: 4px; text-transform: uppercase; }
.car-screen-state {
  font-size: 13px;
  color: #8ad07a;
  margin-top: 10px;
  min-height: 16px;
  letter-spacing: 1px;
}
.car-screen-state.busy { color: #e6c56a; }
.car-screen-state.busy::after {
  content: '';
  display: inline-block;
  width: 3ch;
  text-align: left;
  animation: car-dots 1.2s steps(4) infinite;
}
@keyframes car-dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  100% { content: '...'; }
}
.car-screen-doors {
  position: relative;
  width: 100%;
  height: 32px;
  margin-top: 12px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #1a2530;
  background: #050a0f;
  display: flex;
}
.car-door-leaf {
  flex: 1 1 50%;
  background: linear-gradient(90deg, #243040 0%, #1e2d3a 50%, #243040 100%);
  border-right: 1px solid #2a3542;
  transition: transform 220ms ease;
  position: relative;
}
.car-door-leaf:last-child { border-right: none; border-left: 1px solid #2a3542; }
.car-door-leaf::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 3px;
  height: 14px;
  background: #3d4a58;
  border-radius: 2px;
  transform: translateY(-50%);
}
.car-door-left::after { right: 4px; }
.car-door-right::after { left: 4px; }
.car-buttons { display: grid; grid-template-rows: repeat(5, 44px); gap: 9px; align-content: center; }
.car-button {
  width: 44px;
  border-radius: 50%;
  border: 1px solid #3d4a58;
  background: radial-gradient(circle at 35% 30%, #2a3948, #1a2530 70%);
  color: #9fb0c0;
  font-family: ui-monospace, monospace;
  font-size: 17px;
  cursor: pointer;
  touch-action: manipulation;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255, 255, 255, 0.06) inset;
  transition: box-shadow 120ms ease, color 120ms ease;
}
.car-button:hover { color: #dfe8f2; }
.car-button.lit {
  background: radial-gradient(circle at 35% 30%, #ffd98a, #c8a24a 76%);
  border-color: #e6c56a;
  color: #14100a;
  animation: car-lit-pulse 1.4s ease-in-out infinite;
}
@keyframes car-lit-pulse {
  0%, 100% { box-shadow: 0 0 12px rgba(230, 197, 106, 0.65), 0 2px 4px rgba(0, 0, 0, 0.5); }
  50% { box-shadow: 0 0 22px rgba(230, 197, 106, 0.95), 0 2px 4px rgba(0, 0, 0, 0.5); }
}
.car-button.here {
  box-shadow:
    0 0 0 3px rgba(230, 197, 106, 0.35),
    0 0 14px rgba(230, 197, 106, 0.45),
    0 2px 4px rgba(0, 0, 0, 0.5);
  color: #ffd98a;
  border-color: #e6c56a;
}
.car-screen-aboard {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid #2a3542;
  min-height: 26px;
}
.car-screen-aboard-label { font-size: 10px; letter-spacing: 3px; color: #5a6b7c; }
.car-screen-occupants { display: inline-flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.car-occupant-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 54px;
  padding: 5px 4px 4px;
  background: #0f1a24;
  border: 1px solid #2a3542;
  border-radius: 8px;
}
.car-occupant-visual.you { border-color: #e6c56a; background: #1a2214; }
.char-figure { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.char-head {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  color: #0f1419;
  text-shadow: none;
}
.char-body {
  width: 22px;
  height: 14px;
  border-radius: 4px 4px 2px 2px;
  border: 1px solid rgba(255,255,255,0.12);
  position: relative;
}
.char-body::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 3px;
  width: 8px;
  height: 5px;
  background: rgba(255,255,255,0.22);
  border-radius: 2px;
  transform: translateX(-50%);
}
.char-name { font-size: 9px; color: #aab8c8; letter-spacing: 0.5px; max-width: 52px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.car-occupant-visual.you .char-name { color: #ffd98a; }
.car-screen-hint { font-size: 10px; color: #556677; margin-top: 10px; letter-spacing: 1px; }
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
      el('div', { class: 'car-screen-header' }, [
        el('div', { class: 'car-screen-title' }, ['elevator']),
        el('div', { class: 'car-screen-car' }, ['']),
      ]),
      el('div', { class: 'car-screen-doors' }, [
        el('div', { class: 'car-door-leaf car-door-left' }, []),
        el('div', { class: 'car-door-leaf car-door-right' }, []),
      ]),
      el('div', { class: 'car-screen-body' }, [
        el('div', { class: 'car-screen-display' }, [
          el('div', { class: 'car-screen-arrow', 'data-dir': 'none' }, ['▲']),
          el('div', { class: 'car-screen-floor' }, ['']),
          el('div', { class: 'car-screen-floor-label' }, ['floor']),
          el('div', { class: 'car-screen-state' }, []),
        ]),
        el(
          'div',
          { class: 'car-buttons' },
          CAR_BUTTONS.map(({ floor, label }) =>
            el('button', { class: 'car-button', 'data-floor': floor }, [label]),
          ),
        ),
      ]),
      el('div', { class: 'car-screen-aboard' }, [
        el('span', { class: 'car-screen-aboard-label' }, ['aboard']),
        el('span', { class: 'car-screen-occupants' }, []),
      ]),
      el('div', { class: 'car-screen-hint' }, ['keys: 1 · 2 · 3 · M · 0']),
    ]),
  ])
}

/** The last floor the world scene fed the readout — the `here` halo + arrow. */
let displayedFloor: string | null = null

function floorFromLabel(label: string): FloorId | null {
  return FLOOR_ORDER.find((floor) => floorLabel(floor) === label) ?? null
}

function occupantPalette(name: string): { head: string; body: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const hue = hash % 360
  const head = `hsl(${hue} 58% 68%)`
  const body = `hsl(${(hue + 14) % 360} 34% 34%)`
  return { head, body }
}

/**
 * Mirror the rider session onto the screen: visible only while riding, each
 * button lit while its floor is in the own car's queue. Idempotent — safe to
 * call on every rider-session change and after every view re-render. `press`
 * forwards button taps to the same channel the keymap uses; pointerdown (not
 * click) keeps the button from taking focus and stealing the game's Space key.
 * `ownName` highlights the local player's visual (optional, lobby-snapshot name).
 */
export function syncCarScreen(
  riding: RiderUpdate,
  occupantNames: readonly string[],
  press: (floor: FloorId) => void,
  ownName: string | null = null,
): void {
  const screen = document.getElementById('elevator-car-screen')
  if (screen === null) return
  if (riding === null) {
    screen.setAttribute('hidden', '')
    return
  }
  screen.removeAttribute('hidden')
  const car = screen.querySelector('.car-screen-car')
  if (car !== null) car.textContent = `car ${riding.car}`
  const aboard = screen.querySelector('.car-screen-occupants')
  if (aboard !== null) {
    aboard.replaceChildren(
      ...occupantNames.map((name) => {
        const palette = occupantPalette(name)
        const isYou = name === ownName
        return el('span', { class: `car-occupant-visual${isYou ? ' you' : ''}` }, [
          el('span', { class: 'char-figure' }, [
            el('span', { class: 'char-head', style: `background:${palette.head}` }, [
              name.slice(0, 1).toUpperCase(),
            ]),
            el('span', { class: 'char-body', style: `background:${palette.body}` }, []),
          ]),
          el('span', { class: 'char-name' }, [name + (isYou ? ' (you)' : '')]),
        ])
      }),
    )
  }
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
  syncHereHalo()
}

/** The `here` halo on the panel's current-floor button (self-healing). */
function syncHereHalo(): void {
  const screen = document.getElementById('elevator-car-screen')
  if (screen === null) return
  for (const button of screen.querySelectorAll<HTMLElement>('.car-button')) {
    button.classList.toggle('here', button.dataset.floor === displayedFloor)
  }
}

/**
 * Current-floor readout (world-scene driven every frame, self-healing like the
 * hallway panel): the own car's public position — swept through transition
 * floors while the car rides. `null` clears the readout and the `here` halo.
 */
export function setCarScreenFloor(floor: string | null): void {
  displayedFloor = floor
  const screen = document.getElementById('elevator-car-screen')
  if (screen === null) return
  const readout = screen.querySelector('.car-screen-floor')
  if (readout !== null) readout.textContent = floor === null ? '' : floorLabel(floor as FloorId)
  syncHereHalo()
}

/**
 * Elevator state line (world-scene driven every frame): "doors open", "doors
 * closing", or "moving to N" — derived client-side from the same animation
 * clock that drives the door visuals, never a new wire message. While moving,
 * the direction arrow lights from the swept readout vs the stated destination.
 * `null` clears.
 */
export function setCarScreenState(state: string | null): void {
  const screen = document.getElementById('elevator-car-screen')
  if (screen === null) return
  const line = screen.querySelector('.car-screen-state')
  if (line !== null) line.textContent = state ?? ''
  const busy = state !== null && state !== 'doors open' && state !== 'doors closed'
  if (line !== null) line.classList.toggle('busy', busy)
  const arrow = screen.querySelector<HTMLElement>('.car-screen-arrow')
  if (arrow === null) return
  let dir: 'up' | 'down' | 'none' = 'none'
  if (busy && state.startsWith('moving to ') && displayedFloor !== null) {
    const target = floorFromLabel(state.slice('moving to '.length).trim())
    const here = FLOOR_ORDER.indexOf(displayedFloor as FloorId)
    const there = target === null ? -1 : FLOOR_ORDER.indexOf(target)
    if (there >= 0 && here >= 0 && there !== here) dir = there > here ? 'up' : 'down'
  }
  arrow.dataset.dir = dir
  arrow.classList.toggle('up', dir === 'up')
  arrow.classList.toggle('down', dir === 'down')
  arrow.textContent = dir === 'down' ? '▼' : '▲'
}

/**
 * Door leaves (world-scene driven every frame): `openAmount` 0 = fully closed,
 * 1 = fully open. The leaves slide from the center outward — purely
 * presentation, never a new wire message.
 */
export function setCarScreenDoors(openAmount: number): void {
  const screen = document.getElementById('elevator-car-screen')
  if (screen === null) return
  const clamped = Math.max(0, Math.min(1, openAmount))
  for (const leaf of screen.querySelectorAll<HTMLElement>('.car-door-leaf')) {
    const isLeft = leaf.classList.contains('car-door-left')
    const shift = isLeft ? -clamped * 100 : clamped * 100
    leaf.style.transform = `translateX(${shift}%)`
  }
}
