import type { LobbySnapshot } from '@turnover/shared'
import { buildAccuseHud } from './accuseHud'
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
      // The elevator runs from room creation (AD-011): the position-only
      // panel is visible pre-round too, so the machine is observable and
      // testable. Single car (cycle 3.E, AD-040): one hall-call light +
      // floor readout (AD-024), position-only.
      el('div', { id: 'elevator-panel' }, [
        'elevator E ',
        el('span', { id: 'panel-light', style: 'color:#4a5568' }, ['●']),
        ': ',
        el('span', { id: 'panel-floor' }, ['lobby']),
      ]),
      // Rider chip (AD-013): occupants, five lit floor indicators (lit =
      // queued or being served), and the last-press line — visible only while
      // the local player rides; the panel above stays position-only.
      el('div', { id: 'elevator-riders', hidden: '' }, [
        el('span', { id: 'elevator-riders-names' }, []),
        el('span', { id: 'elevator-indicators' }, [
          el('span', { class: 'floor-indicator', 'data-floor': 'lobby' }, ['L']),
          el('span', { class: 'floor-indicator', 'data-floor': 'mezzanine' }, ['M']),
          el('span', { class: 'floor-indicator', 'data-floor': 'floor1' }, ['1']),
          el('span', { class: 'floor-indicator', 'data-floor': 'floor2' }, ['2']),
          el('span', { class: 'floor-indicator', 'data-floor': 'floor3' }, ['3']),
        ]),
        el('span', { id: 'elevator-press' }, []),
      ]),
      // In-car screen (AD-013): rides are possible pre-round (AD-011).
      // Elevator-only: the lift is the star.
      buildCarScreen(),
      // Accusation HUD (cycle 2.8): firing toasts + fired banner ride in both
      // views so a firing is visible wherever the player is looking.
      buildAccuseHud(),
    ]),
  )
}
