import type { LobbySnapshot } from '@turnover/shared'
import type Phaser from 'phaser'
import { buildAccuseHud } from './accuseHud'
import { buildCarScreen } from './carScreen'
import { el } from './dom'
import { buildFullscreenToggle } from './fullscreenToggle'
import { roomShareUrl } from './shareLink'
import { buildStairScreen } from './stairScreen'
import { buildTutorialHud } from './tutorialHud'

/**
 * Lobby view (LIGHT-05..08): roster names, host marker, start control for the
 * host only, error banner for rejected intents. Renders from the personal
 * snapshot — ids and names only, never roles.
 */
export interface LobbyCallbacks {
  onStart: () => void
}

const STYLE_ID = 'lobby-view-styles'

const STYLE = `
#lobby-view {
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
#lobby-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 380px;
  max-height: 500px;
  margin-top: 10px;
  padding: 20px 24px;
  background: rgba(13, 18, 24, 0.9);
  border: 1px solid #2a3542;
  border-top: 3px solid #e6c56a;
  border-radius: 10px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.65);
  font-family: ui-monospace, monospace;
  color: #dfe8f2;
}
#lobby-card h2 {
  margin: 0;
  font-size: 15px;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #ffd98a;
  text-shadow: 0 0 14px rgba(230, 197, 106, 0.45);
}
#share-row { display: flex; gap: 6px; }
#share-link {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  font: 11px ui-monospace, monospace;
  color: #9fb0c0;
  background: #0a0f14;
  border: 1px solid #2a3542;
  border-radius: 4px;
}
#share-copy {
  padding: 4px 10px;
  font: 10px ui-monospace, monospace;
  letter-spacing: 1px;
  color: #9fb0c0;
  background: #1a2530;
  border: 1px solid #3d4a58;
  border-radius: 4px;
  cursor: pointer;
}
#share-copy:hover { color: #dfe8f2; }
#roster {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
#roster li {
  padding: 4px 10px;
  font-size: 12px;
  letter-spacing: 1px;
  color: #dfe8f2;
  background: rgba(26, 37, 48, 0.62);
  border: 1px solid #2a3542;
  border-radius: 4px;
}
#roster li.own { border-color: #55492c; color: #ffd98a; }
#start-button {
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
#lobby-waiting {
  margin: 0;
  font-size: 11px;
  letter-spacing: 1px;
  text-align: center;
  color: #8899aa;
}
#lobby-error { margin: 0; font-size: 11px; color: #ff9a8a; text-align: center; }
#lobby-error[hidden] { display: none; }
`

export function renderLobby(
  root: HTMLElement,
  snapshot: LobbySnapshot,
  roomCode: string,
  error: string | null,
  cb: LobbyCallbacks,
  game: Phaser.Game,
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
  // The start control is the host's alone (the server refuses non-host
  // intents anyway); guests get a status line in its place.
  if (!snapshot.isHost) startButton.setAttribute('hidden', '')
  const waitingLine = el('p', { id: 'lobby-waiting' }, ['waiting for the host to start the shift…'])
  if (snapshot.isHost) waitingLine.setAttribute('hidden', '')

  // Share row: the ?room=CODE link under the heading — guests copy it too,
  // since a round needs 4+ players and anyone in the lobby can invite.
  const shareLink = roomShareUrl(roomCode, {
    origin: window.location.origin,
    pathname: window.location.pathname,
  })
  const shareInput = el('input', { id: 'share-link', readonly: true, autocomplete: 'off' })
  // Wide enough to show a deployed-domain link without scrolling the value.
  shareInput.setAttribute('size', '40')
  shareInput.setAttribute('value', shareLink)
  const copyButton = el('button', { id: 'share-copy', type: 'button' }, ['copy link'])
  copyButton.addEventListener('click', () => {
    void copyShareLink(shareInput, copyButton)
  })

  const errorLine = el('p', { id: 'lobby-error' })
  if (error !== null) errorLine.textContent = error
  else errorLine.setAttribute('hidden', '')

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = STYLE

  // The roster card floats over the live world (the staff walks the lobby
  // behind it); the ride-along HUD mounts stay full-surface placements.
  root.append(
    el('div', { id: 'lobby-view' }, [
      // Elevator + stairs — inline HUD bars at the very top of the main
      // window, directly under the game canvas (no modal, no separate window).
      buildCarScreen(),
      buildStairScreen(),
      // Tutorial card (first-run onboarding): walking and the car are
      // learnable pre-round, so the card rides in the lobby view too.
      buildTutorialHud(),
      // Fullscreen toggle — always visible top-right.
      buildFullscreenToggle(game),
      el('div', { id: 'lobby-card' }, [
        el('h2', {}, [`lobby — room ${roomCode}`]),
        el('div', { id: 'share-row' }, [shareInput, copyButton]),
        roster,
        startButton,
        waitingLine,
        errorLine,
      ]),
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
      // Accusation HUD (cycle 2.8): firing toasts + fired banner ride in both
      // views so a firing is visible wherever the player is looking.
      buildAccuseHud(),
    ]),
  )
}

/** How long the button reads "copied ✓" before reverting. */
const COPY_FEEDBACK_MS = 1500

/**
 * Copy the share link: async Clipboard API first; when it is missing or
 * refuses (plain-http LAN play, older browsers), fall back to selecting the
 * input and the deprecated execCommand. The button label reports the outcome
 * either way — an uncopyable link must never fail silently.
 */
async function copyShareLink(input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
  const label = (text: string) => {
    button.textContent = text
    window.setTimeout(() => {
      button.textContent = 'copy link'
    }, COPY_FEEDBACK_MS)
  }
  try {
    await navigator.clipboard.writeText(input.value)
    label('copied ✓')
  } catch {
    input.focus()
    input.select()
    label(document.execCommand('copy') ? 'copied ✓' : 'select + Ctrl+C')
  }
}
