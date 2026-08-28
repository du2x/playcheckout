import type { LobbySnapshot } from '@turnover/shared'
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
    ]),
  )
}
