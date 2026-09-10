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
  complaint: 'complaint',
}

const STYLE_ID = 'results-view-styles'

const STYLE = `
#results-view {
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at 50% 30%, rgba(20, 28, 40, 0.82) 0%, rgba(10, 14, 19, 0.92) 70%);
}
#results-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 420px;
  max-height: 540px;
  padding: 22px 26px;
  background: rgba(13, 18, 24, 0.92);
  border: 1px solid #2a3542;
  border-top: 3px solid #e6c56a;
  border-radius: 10px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.65);
  font-family: ui-monospace, monospace;
  color: #dfe8f2;
}
#results-banner {
  margin: 0;
  font-size: 20px;
  letter-spacing: 6px;
  text-transform: uppercase;
  text-align: center;
  color: #ffd98a;
  text-shadow: 0 0 18px rgba(230, 197, 106, 0.5);
}
#results-traitor, #results-score, #results-complaints, #results-reason {
  margin: 0;
  font-size: 12px;
  text-align: center;
  color: #9fb0c0;
}
#results-traitor { color: #dfe8f2; }
#results-reason { color: #ff9a8a; }
#results-card h3 {
  margin: 8px 0 0;
  font-size: 10px;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #8899aa;
  border-top: 1px solid #2a3542;
  padding-top: 10px;
}
#recap-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#recap-list li {
  padding: 4px 10px;
  font-size: 11px;
  line-height: 1.5;
  color: #9fb0c0;
  background: rgba(26, 37, 48, 0.62);
  border: 1px solid #2a3542;
  border-radius: 4px;
}
#recap-list .recap-crime { color: #ffb0a0; border-color: #7a3a30; }
#recap-list .recap-catch, #recap-list .recap-accusation { color: #8ad07a; border-color: #3d5a3a; }
#start-button {
  margin-top: 6px;
  padding: 9px 12px;
  font: bold 12px ui-monospace, monospace;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #14100a;
  background: linear-gradient(180deg, #ffd98a, #c8a24a);
  border: 1px solid #e6c56a;
  border-radius: 4px;
  cursor: pointer;
}
#start-button:hover { filter: brightness(1.1); }
#start-button[hidden] { display: none; }
`

export function renderResults(root: HTMLElement, state: ViewState, cb: ResultsCallbacks): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = STYLE

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
  // The complaint budget input (cycle 3.3, FR-31): final complaints vs the
  // §7 budget and the budget-exhausted reason (COMP-25).
  const complaintsLine = el('p', { id: 'results-complaints' })
  if (results !== null && results.complaints !== null) {
    complaintsLine.textContent = `complaints ${results.complaints} / 8`
  } else {
    complaintsLine.setAttribute('hidden', '')
  }
  const reasonLine = el('p', { id: 'results-reason' })
  if (results?.reason === 'budget-exhausted') {
    reasonLine.textContent = 'Complaint budget exhausted — 8 complaints'
  } else {
    reasonLine.setAttribute('hidden', '')
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
      el('div', { id: 'results-card' }, [
        banner,
        traitorLine,
        scoreLine,
        complaintsLine,
        reasonLine,
        el('h3', {}, ['recap']),
        recapList,
        startButton,
      ]),
      buildAccuseHud(),
    ]),
  )
}

function describe(entry: RecapEntry, nameOf: (id: string) => string): string {
  const floorRoom =
    entry.kind === 'crime' || entry.kind === 'complaint'
      ? ` floor ${entry.floor} room ${entry.room}`
      : ''
  const freshness =
    entry.kind === 'crime' || entry.kind === 'complaint'
      ? entry.fresh
        ? ' (evidence fresh)'
        : ' (evidence aged)'
      : ''
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
    case 'complaint': {
      const prov =
        entry.provenance === 'sabotage'
          ? `sabotage (by ${nameOf(entry.actorId ?? entry.guestId)})`
          : 'checkout churn'
      return `${KIND_LABEL.complaint}:${floorRoom} — ${prov}${freshness}`
    }
  }
}
