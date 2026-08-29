import type { LobbySnapshot } from '@turnover/shared'
import { buildCarScreen } from './carScreen'
import { el } from './dom'

/**
 * Lobby view (LIGHT-05..08): roster names, host marker, start control for the
 * host only, error banner for rejected intents. Renders from the personal
 * snapshot — ids and names only, never roles.
 */
export interface LobbyCallbacks {
  onStart: () => void
}

export function renderLobby(
  root: HTMLElement,
  snapshot: LobbySnapshot,
  roomCode: string,
  error: string | null,
  cb: LobbyCallbacks,
): void {
  const roster = el(
    'ul',
    { id: 'roster' },
    snapshot.roster.map((entry) =>
      el(
        'li',
        {
          'data-player-id': entry.id,
          class: entry.id === snapshot.ownId ? 'own' : '',
          'data-host': entry.id === snapshot.ownId && snapshot.isHost ? 'true' : 'false',
        },
        [entry.id === snapshot.ownId && snapshot.isHost ? `${entry.name} (host)` : entry.name],
      ),
    ),
  )

  const startButton = el('button', { id: 'start-button' }, ['Start round'])
  startButton.addEventListener('click', cb.onStart)
  if (!snapshot.isHost) startButton.setAttribute('hidden', '')

  const errorLine = el('p', { id: 'lobby-error' })
  if (error !== null) errorLine.textContent = error
  else errorLine.setAttribute('hidden', '')

  root.append(
    el('div', { id: 'lobby-view' }, [
      el('h2', {}, [`lobby — room ${roomCode}`]),
      roster,
      startButton,
      errorLine,
      // Elevators run from room creation (AD-011): the position-only panel is
      // visible pre-round too, so the machine is observable and testable.
      el('div', { id: 'elevator-panel' }, [
        'elevators  W: ',
        el('span', { id: 'panel-west' }, ['lobby']),
        ' · E: ',
        el('span', { id: 'panel-east' }, ['lobby']),
      ]),
      // Rider chip (AD-013): occupants, four lit floor indicators (lit =
      // queued or being served), and the last-press line — visible only while
      // the local player rides; the panel above stays position-only.
      el('div', { id: 'elevator-riders', hidden: '' }, [
        el('span', { id: 'elevator-riders-names' }, []),
        el('span', { id: 'elevator-indicators' }, [
          el('span', { class: 'floor-indicator', 'data-floor': 'lobby' }, ['L']),
          el('span', { class: 'floor-indicator', 'data-floor': 'floor1' }, ['1']),
          el('span', { class: 'floor-indicator', 'data-floor': 'floor2' }, ['2']),
          el('span', { class: 'floor-indicator', 'data-floor': 'floor3' }, ['3']),
        ]),
        el('span', { id: 'elevator-press' }, []),
      ]),
      // In-car screen (AD-013): rides are possible pre-round (AD-011).
      buildCarScreen(),
    ]),
  )
}
