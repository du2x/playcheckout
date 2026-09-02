import type { FloorId } from '@turnover/shared'
import { TUNING } from '@turnover/shared'
import { FLOOR_ORDER, floorLabel } from './carScreen'
import { el } from './dom'

/**
 * Stairwell screen (AD-040 client presentation): a fullscreen overlay shown
 * only while the local player is inside the west stairwell — transit, breath,
 * or stunned. It renders the recipient's OWN stairs state exclusively, from
 * the personal `movement:snapshot` `stairs` row (self-policy: the stairwell
 * interior is a black box to everyone else, so there is no occupant view and
 * never will be) plus the private `stairs:ambushed` stun seconds. The phase
 * clock re-anchors on every personal snapshot and ticks locally between them
 * (transit → breath is derived from TUNING, self-healing like the car screen
 * readouts). Purely client-side presentation over existing payloads — no new
 * message types, nothing hidden is named.
 */

export type StairPhase = 'transit' | 'breath' | 'stunned'

/**
 * One anchor of the own stairs clock: a personal snapshot's stairs row (or a
 * `stairs:ambushed` stun override), stamped with the wall-clock moment it
 * landed. `remainingMs` is what the payload said was left of `phase`.
 */
export interface StairAnchor {
  readonly from: FloorId
  readonly to: FloorId
  readonly phase: StairPhase
  readonly remainingMs: number
  /** `Date.now()` when the anchor landed. */
  readonly anchoredAtMs: number
}

/** The live phase readout; `null` = the current stair visit is over. */
export type StairReadout = { readonly phase: StairPhase; readonly remainingMs: number } | null

/**
 * The phase + countdown at `nowMs`, derived purely from the anchor and
 * TUNING: the anchored phase counts down, an expired transit rolls into the
 * breath (STAIRS_BREATH_SECONDS), and an expired breath or stun ends the
 * visit (the resumed floor stream re-anchors the truth).
 */
export function stairPhaseReadout(anchor: StairAnchor, nowMs: number): StairReadout {
  const remaining = anchor.remainingMs - (nowMs - anchor.anchoredAtMs)
  if (remaining > 0) return { phase: anchor.phase, remainingMs: remaining }
  const overshoot = -remaining
  if (anchor.phase === 'transit') {
    const breathMs = TUNING.STAIRS_BREATH_SECONDS * 1000
    if (overshoot < breathMs) return { phase: 'breath', remainingMs: breathMs - overshoot }
  }
  return null
}

/** The visit direction from the building order (always one stride apart). */
export function stairDirection(from: FloorId, to: FloorId): 'up' | 'down' {
  return FLOOR_ORDER.indexOf(to) > FLOOR_ORDER.indexOf(from) ? 'up' : 'down'
}

const STYLE_ID = 'elevator-stair-screen-styles'

const STYLE = `
#elevator-stair-screen {
  position: fixed;
  top: 420px;
  right: 16px;
  width: 380px;
  z-index: 5;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
  background: transparent;
}
#elevator-stair-screen[hidden] { display: none; }
.stair-screen-inner {
  pointer-events: auto;
  width: 100%;
  min-width: 0;
  background: linear-gradient(180deg, #1b2530 0%, #131b24 60%, #0f161e 100%);
  border: 1px solid #7a6a42;
  border-radius: 14px;
  outline: 1px solid #2a3542;
  outline-offset: -6px;
  padding: 22px 30px 16px;
  color: #dfe8f2;
  font-family: ui-monospace, monospace;
  text-align: center;
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.76),
    0 0 0 1px rgba(0, 0, 0, 0.62) inset,
    0 1px 0 rgba(230, 197, 106, 0.12) inset;
  animation: stair-screen-in 220ms ease-out;
}
@keyframes stair-screen-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
.stair-screen-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #2a3542;
  padding-bottom: 10px;
  margin-bottom: 16px;
}
.stair-screen-title {
  font-size: 11px;
  letter-spacing: 4px;
  color: #8899aa;
  text-transform: uppercase;
}
.stair-screen-dir {
  font-size: 11px;
  letter-spacing: 2px;
  color: #e6c56a;
  border: 1px solid #55492c;
  border-radius: 4px;
  padding: 2px 8px;
  background: rgba(230, 197, 106, 0.07);
}
.stair-screen-body { display: flex; align-items: center; justify-content: center; gap: 26px; }
.stair-screen-shaft {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  width: 96px;
  height: 148px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #060a0e;
  background: linear-gradient(180deg, #0a0f14, #070b0f);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05);
}
.stair-step {
  height: 16px;
  border: 1px solid #2a3542;
  border-bottom-color: #55492c;
  background: linear-gradient(180deg, #243040, #1a2530);
}
.stair-step:nth-child(1) { width: 22px; }
.stair-step:nth-child(2) { width: 34px; }
.stair-step:nth-child(3) { width: 46px; }
.stair-step:nth-child(4) { width: 58px; }
.stair-step:nth-child(5) { width: 70px; }
.stair-step:last-child { width: 82px; }
.stair-screen-arrow {
  font-size: 34px;
  line-height: 1;
  margin-top: 10px;
  color: #e6c56a;
  text-shadow: 0 0 12px rgba(230, 197, 106, 0.82);
}
.stair-screen-arrow[data-phase='transit'] { animation: stair-climb 700ms ease-in-out infinite; }
.stair-screen-arrow[data-phase='breath'] { animation: stair-breath 1.8s ease-in-out infinite; }
.stair-screen-arrow[data-phase='stunned'] {
  color: #ff7a6a;
  text-shadow: 0 0 12px rgba(255, 90, 70, 0.82);
  animation: stair-stun 260ms steps(2) infinite;
}
@keyframes stair-climb {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7px); }
}
@keyframes stair-breath {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
@keyframes stair-stun {
  0% { transform: translate(0, 0); }
  50% { transform: translate(2px, -2px); }
  100% { transform: translate(0, 0); }
}
.stair-screen-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 130px;
}
.stair-screen-clock {
  font-size: 58px;
  line-height: 1;
  font-weight: bold;
  color: #ffd98a;
  text-shadow: 0 0 16px rgba(230, 197, 106, 0.55), 0 0 4px rgba(255, 217, 138, 0.9);
  font-variant-numeric: tabular-nums;
}
.stair-screen-clock[data-phase='stunned'] {
  color: #ff9a8a;
  text-shadow: 0 0 16px rgba(255, 90, 70, 0.62);
}
.stair-screen-route { font-size: 15px; color: #9fb0c0; letter-spacing: 2px; margin-top: 10px; }
.stair-screen-phase { font-size: 13px; color: #e6c56a; margin-top: 8px; min-height: 16px; letter-spacing: 1px; }
.stair-screen-phase[data-phase='breath'] { color: #8ad07a; }
.stair-screen-phase[data-phase='stunned'] { color: #ff7a6a; }
.stair-screen-hint {
  font-size: 10px;
  color: #556677;
  margin-top: 16px;
  padding-top: 10px;
  border-top: 1px solid #2a3542;
  letter-spacing: 1px;
}
`

/** Mount once per HUD build; the stylesheet is injected idempotently. */
export function buildStairScreen(): HTMLElement {
  if (document.getElementById(STYLE_ID) === null) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLE
    document.head.appendChild(style)
  }
  return el('div', { id: 'elevator-stair-screen', hidden: '' }, [
    el('div', { class: 'stair-screen-inner' }, [
      el('div', { class: 'stair-screen-header' }, [
        el('div', { class: 'stair-screen-title' }, ['stairwell']),
        el('div', { class: 'stair-screen-dir' }, ['']),
      ]),
      el('div', { class: 'stair-screen-body' }, [
        el('div', { class: 'stair-screen-shaft' }, [
          el('div', { class: 'stair-step' }, []),
          el('div', { class: 'stair-step' }, []),
          el('div', { class: 'stair-step' }, []),
          el('div', { class: 'stair-step' }, []),
          el('div', { class: 'stair-step' }, []),
          el('div', { class: 'stair-step' }, []),
          el('div', { class: 'stair-screen-arrow', 'data-phase': 'transit' }, ['▲']),
        ]),
        el('div', { class: 'stair-screen-info' }, [
          el('div', { class: 'stair-screen-clock', 'data-phase': 'transit' }, ['']),
          el('div', { class: 'stair-screen-route' }, ['']),
          el('div', { class: 'stair-screen-phase', 'data-phase': 'transit' }, ['']),
        ]),
      ]),
      el('div', { class: 'stair-screen-hint' }, ['slow · unobserved · staff only']),
    ]),
  ])
}

const PHASE_LABELS: Record<StairPhase, string> = {
  transit: 'moving',
  breath: 'catching breath',
  stunned: 'stunned',
}

/**
 * Mirror the own stairs state onto the screen (world-scene driven every
 * frame, self-healing like the car screen): visible only while a phase
 * readout is live, re-anchored by every personal snapshot, ticking locally
 * between them. `null` anchor hides the screen.
 */
export function syncStairScreen(anchor: StairAnchor | null, nowMs: number): void {
  const screen = document.getElementById('elevator-stair-screen')
  if (screen === null) return
  const readout = anchor === null ? null : stairPhaseReadout(anchor, nowMs)
  if (readout === null) {
    screen.setAttribute('hidden', '')
    return
  }
  screen.removeAttribute('hidden')
  const dir = anchor === null ? 'up' : stairDirection(anchor.from, anchor.to)
  const badge = screen.querySelector('.stair-screen-dir')
  if (badge !== null) badge.textContent = dir === 'up' ? '▲ up' : '▼ down'
  const clock = screen.querySelector<HTMLElement>('.stair-screen-clock')
  if (clock !== null) {
    clock.dataset.phase = readout.phase
    clock.textContent = `${Math.ceil(readout.remainingMs / 1000)}s`
  }
  const route = screen.querySelector('.stair-screen-route')
  if (route !== null && anchor !== null) {
    route.textContent = `${floorLabel(anchor.from)} → ${floorLabel(anchor.to)}`
  }
  const phase = screen.querySelector<HTMLElement>('.stair-screen-phase')
  if (phase !== null) {
    phase.dataset.phase = readout.phase
    phase.textContent = PHASE_LABELS[readout.phase]
  }
  const arrow = screen.querySelector<HTMLElement>('.stair-screen-arrow')
  if (arrow !== null) {
    arrow.dataset.phase = readout.phase
    arrow.textContent = dir === 'up' ? '▲' : '▼'
  }
}
