import { settleTargetFor, TUNING } from '@turnover/shared'
import {
  currentStep,
  type TutorialSession,
  type TutorialStepId,
  tutorialSteps,
} from '../tutorial/tutorialSession'
import { el } from './dom'

/**
 * Tutorial HUD (first-run onboarding): the guided-step card and the permanent
 * how-to-play panel, riding in the lobby and round views like the accuse HUD
 * (both views rebuild their DOM on entry; the App re-syncs after every render
 * and every session change). Presentation only — the state machine lives in
 * tutorialSession.ts. All timing/threshold numbers come from TUNING: tuning
 * literals are denylist-locked to packages/shared.
 */

const STYLE_ID = 'tutorial-hud-styles'

const STYLE = `
#tutorial-card {
  margin: 0 0 12px;
  padding: 10px 14px;
  background: rgba(15, 20, 25, 0.9);
  border: 1px solid #6a5a2a;
  border-left: 4px solid #e6c56a;
  border-radius: 4px;
  max-width: 640px;
}
#tutorial-card[hidden] { display: none; }
#tutorial-step {
  display: block;
  font: 10px ui-monospace, monospace;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #e6c56a;
  margin-bottom: 4px;
}
#tutorial-body {
  margin: 0 0 8px;
  font: 13px/1.45 ui-monospace, monospace;
  color: #dfe8f2;
}
#tutorial-buttons { display: flex; gap: 10px; align-items: center; }
#tutorial-confirm, #tutorial-skip, #help-button {
  font: 10px ui-monospace, monospace;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #9fb0c0;
  background: rgba(15, 20, 25, 0.82);
  border: 1px solid #2a3542;
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
  touch-action: manipulation;
}
#tutorial-confirm { color: #0f1419; background: #e6c56a; border-color: #e6c56a; }
#tutorial-confirm:hover { background: #ffe9a8; }
#tutorial-skip, #help-button:hover { color: #dfe8f2; border-color: #556677; }
#help-panel {
  margin: 0 0 12px;
  padding: 10px 14px;
  background: rgba(15, 20, 25, 0.9);
  border: 1px solid #2a3542;
  border-radius: 4px;
  max-width: 640px;
}
#help-panel[hidden] { display: none; }
#help-panel h3 {
  margin: 0 0 6px;
  font: 10px ui-monospace, monospace;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #e6c56a;
}
#help-panel ul { margin: 0; padding-left: 18px; }
#help-panel li {
  font: 12px/1.5 ui-monospace, monospace;
  color: #9fb0c0;
}
#help-panel li strong { color: #dfe8f2; font-weight: normal; }
`

const STEP_TITLES: Record<TutorialStepId, string> = {
  walk: 'walk the hall',
  elevator: 'ride the car',
  checkin: 'work the desk',
  deliver: 'deliver the suitcase',
  work: 'turn a room',
  saboteur: 'you are the turncoat',
  goal: 'the shift',
}

/** Per-step body copy; numbers arrive from TUNING, never inline (denylist). */
const STEP_BODY: Record<TutorialStepId, (ctx: TutorialBodyContext) => string> = {
  walk: () => 'hold ← / → to walk the hallway.',
  elevator: () =>
    'tap E at a landing (or press ↑) to call the car — aboard, press 1 · 2 · 3 · M · 0 to choose a floor. the west stairwell is slower but unobserved.',
  checkin: () =>
    'when the desk bell rings, stand at the desk and tap E to check the guest in — you take their suitcase.',
  deliver: ({ carrySeconds }) =>
    `the guest announces their room building-wide: carry the suitcase to that door and tap E to place it. the ${carrySeconds}s carry clock fires you if it runs out.`,
  work: ({ prepSeconds, unprepSeconds }) =>
    `step inside an unprepared room and hold Space to prep it (${prepSeconds}s) — a door card marks every prepped room. a trashed room takes a ${unprepSeconds}s clean instead. walking out cancels.`,
  saboteur: ({ prepSeconds, unprepSeconds, rustleTiles }) =>
    `hold Space inside a ready room to trash it — the ${unprepSeconds}s un-prep is your sabotage, and its rustle carries ${rustleTiles} tiles. in a dirty room, Space runs a ${prepSeconds}s fake prep instead. anyone walking in mid-channel fires you on the spot.`,
  goal: ({ settleTarget, complaintBudget }) =>
    `settle ${settleTarget} guests before the buzzer — check-ins, deliveries, prep. one of you is trashing rooms: read door cards, interiors and the rustle, then hold E beside a suspect to accuse. a wrong accusation fires YOU. ${complaintBudget} trash discoveries and the house loses.`,
}

interface TutorialBodyContext {
  settleTarget: number
  carrySeconds: number
  prepSeconds: number
  unprepSeconds: number
  rustleTiles: number
  complaintBudget: number
}

/** The root rides in the lobby and round views (buildAccuseHud precedent). */
export function buildTutorialHud(): HTMLElement {
  const root = el('div', { id: 'tutorial-hud' }, [
    el('div', { id: 'tutorial-card', hidden: '' }, [
      el('span', { id: 'tutorial-step' }, []),
      el('p', { id: 'tutorial-body' }, []),
      el('div', { id: 'tutorial-buttons' }, [
        el('button', { id: 'tutorial-confirm', type: 'button', hidden: '' }, ['got it']),
        el('button', { id: 'tutorial-skip', type: 'button' }, ['skip tutorial']),
      ]),
    ]),
    el('button', { id: 'help-button', type: 'button' }, ['? how to play']),
    buildHelpPanel(),
  ])
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = STYLE
  return root
}

function buildHelpPanel(): HTMLElement {
  const { CARRY_CLOCK_SECONDS, COMPLAINT_BUDGET, PREP_SECONDS, UNPREP_SECONDS } = TUNING
  return el('div', { id: 'help-panel', hidden: '' }, [
    el('h3', {}, ['the night shift']),
    el('ul', {}, [
      el('li', {}, [el('strong', {}, ['← / → ']), 'walk the hallway']),
      el('li', {}, [
        el('strong', {}, ['E tap']),
        ' — check a guest in at the desk · place / pick up a suitcase at a door · call the car at a landing',
      ]),
      el('li', {}, [
        el('strong', {}, ['E hold']),
        ` — accuse a player within ${TUNING.ACCUSATION_RANGE_TILES} tiles. a wrong accusation fires YOU`,
      ]),
      el('li', {}, [
        el('strong', {}, ['↑ / ↓']),
        ' — call the elevator · enter the stairwell at its west mouth',
      ]),
      el('li', {}, [el('strong', {}, ['1 · 2 · 3 · M · 0']), ' — choose a floor while riding']),
      el('li', {}, [
        el('strong', {}, ['Space']),
        ` — work inside a room: prep (${PREP_SECONDS}s) or clean trash (${UNPREP_SECONDS}s)`,
      ]),
      el('li', {}, [
        el('strong', {}, ['the goal']),
        ` — settle enough guests before the buzzer; one of you secretly trashes rooms. ${COMPLAINT_BUDGET} trash discoveries lose the shift; a carried suitcase must land within ${CARRY_CLOCK_SECONDS}s`,
      ]),
    ]),
  ])
}

export interface TutorialHudHandlers {
  onConfirm: () => void
  onSkip: () => void
  onToggleHelp: () => void
}

/**
 * Mirror the session into the DOM: the current step card (hidden while fired
 * or finished), and the help panel toggle. `lobbySize` clamps to the legal
 * lobby range so the goal card can name the settle target pre-round too.
 */
export function syncTutorialHud(
  session: TutorialSession,
  lobbySize: number,
  handlers: TutorialHudHandlers,
): void {
  const card = document.querySelector('#tutorial-card')
  if (card instanceof HTMLElement) {
    const step = currentStep(session)
    if (step === null) {
      card.setAttribute('hidden', '')
    } else {
      card.removeAttribute('hidden')
      const steps = tutorialSteps(session.role)
      const index = steps.indexOf(step)
      const label = card.querySelector('#tutorial-step')
      if (label !== null) {
        label.textContent = `shift school ${index + 1}/${steps.length} — ${STEP_TITLES[step]}`
      }
      const body = card.querySelector('#tutorial-body')
      if (body !== null) {
        const size = Math.min(TUNING.PLAYERS_MAX, Math.max(TUNING.PLAYERS_MIN, lobbySize))
        body.textContent = STEP_BODY[step]({
          settleTarget: settleTargetFor(size),
          carrySeconds: TUNING.CARRY_CLOCK_SECONDS,
          prepSeconds: TUNING.PREP_SECONDS,
          unprepSeconds: TUNING.UNPREP_SECONDS,
          rustleTiles: TUNING.RUSTLE_RANGE_TILES,
          complaintBudget: TUNING.COMPLAINT_BUDGET,
        })
      }
      const confirm = card.querySelector('#tutorial-confirm')
      if (confirm instanceof HTMLElement) {
        if (step === 'saboteur' || step === 'goal') confirm.removeAttribute('hidden')
        else confirm.setAttribute('hidden', '')
      }
    }
  }
  const confirm = document.querySelector('#tutorial-confirm')
  if (confirm instanceof HTMLButtonElement) confirm.onclick = handlers.onConfirm
  const skip = document.querySelector('#tutorial-skip')
  if (skip instanceof HTMLButtonElement) skip.onclick = handlers.onSkip
  const panel = document.querySelector('#help-panel')
  if (panel instanceof HTMLElement) {
    if (session.helpOpen) panel.removeAttribute('hidden')
    else panel.setAttribute('hidden', '')
  }
  const helpButton = document.querySelector('#help-button')
  if (helpButton instanceof HTMLButtonElement) helpButton.onclick = handlers.onToggleHelp
}
