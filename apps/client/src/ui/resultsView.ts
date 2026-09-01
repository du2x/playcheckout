import type { RecapEntry } from '@turnover/shared'
import type { ResultsState, ViewState } from '../state'
import { buildAccuseHud } from './accuseHud'
import { el } from './dom'

/**
 * Results view (cycle 2.9, FR-21/22): the winner banner, the traitor identity
 * reveal (absent on an aborted round), and the recap timeline. Rendered from
 * the round:ended + round:recap payloads — legal ONLY because the round is
 * over; before it, no payload ever named the saboteur or a verdict.
 */
export interface ResultsCallbacks {
  onStart: () => void
}

const WINNER_LABEL: Record<ResultsState['winner'], string> = {
  staff: 'STAFF WINS',
  saboteur: 'SABOTEUR WINS',
  aborted: 'ROUND ABORTED',
}

const KIND_LABEL: Record<RecapEntry['kind'], string> = {
  crime: 'crime',
  catch: 'walk-in catch',
  accusation: 'accusation',
  ride: 'elevator ride',
}

export function renderResults(root: HTMLElement, state: ViewState, cb: ResultsCallbacks): void {
  const results = state.results
  const banner = el('h2', { id: 'results-banner' }, [results ? WINNER_LABEL[results.winner] : ''])
  const traitorLine = el('p', { id: 'results-traitor' })
  if (results?.saboteurId != null) {
    const name = state.snapshot?.roster.find((e) => e.id === results.saboteurId)?.name
    // LIGHT-12 fallback: a roster miss renders the raw id.
    traitorLine.textContent = `The saboteur was ${name ?? results.saboteurId}`
  } else {
    traitorLine.setAttribute('hidden', '')
  }

  const nameOf = (id: string): string => state.snapshot?.roster.find((e) => e.id === id)?.name ?? id
  // The verdict's inputs (cycle 3.D, AD-039): final score vs the §7 target.
  const scoreLine = el('p', { id: 'results-score' })
  if (results !== null && results.settleScore !== null && results.settleTarget !== null) {
    scoreLine.textContent = `settled ${results.settleScore} of ${results.settleTarget} guests`
  } else {
    scoreLine.setAttribute('hidden', '')
  }
  const recapList = el(
    'ul',
    { id: 'recap-list' },
    (results?.entries ?? []).map((entry) =>
      el('li', { class: `recap-${entry.kind}` }, [describe(entry, nameOf)]),
    ),
  )

  const startButton = el('button', { id: 'start-button' }, ['Start next round'])
  startButton.addEventListener('click', cb.onStart)
  if (state.snapshot?.isHost !== true) startButton.setAttribute('hidden', '')

  root.append(
    el('div', { id: 'results-view' }, [
      banner,
      traitorLine,
      scoreLine,
      el('h3', {}, ['recap']),
      recapList,
      startButton,
      buildAccuseHud(),
    ]),
  )
}

function describe(entry: RecapEntry, nameOf: (id: string) => string): string {
  const floorRoom = entry.kind === 'crime' ? ` floor ${entry.floor} room ${entry.room}` : ''
  const freshness =
    entry.kind === 'crime' ? (entry.fresh ? ' (evidence fresh)' : ' (evidence aged)') : ''
  switch (entry.kind) {
    case 'crime':
      return `${KIND_LABEL.crime}:${floorRoom} — trash dumped${freshness}`
    case 'catch':
      return `${KIND_LABEL.catch}: ${nameOf(entry.entrantId)} walked in on ${nameOf(entry.saboteurId)}`
    case 'accusation':
      return `${KIND_LABEL.accusation}: ${nameOf(entry.accuserId)} accused ${nameOf(entry.targetId)} — ${entry.correct ? 'CORRECT' : 'wrong'}`
    case 'ride': {
      const riders = entry.riderIds.map(nameOf)
      return `${KIND_LABEL.ride}: ${riders.length === 0 ? 'empty car' : riders.join(', ')} — ${entry.from} → ${entry.to}`
    }
  }
}
