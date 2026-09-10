import { voice } from '../voice/voice'
import { el } from './dom'

/**
 * The voice party chip (per game session): one small DOM chip in the HUD
 * corner, under the sound toggle. Click toggles mic capture + party join —
 * the click is also the user gesture that unlocks remote-audio playback.
 * Presentation-only over the voice engine's session; data attributes carry
 * the observable state (gate-3 harness + styling).
 */

const STYLE_ID = 'voice-toggle-styles'

const STYLE = `
#voice-toggle {
  position: absolute;
  right: 10px;
  top: 62px;
  z-index: 30;
  pointer-events: auto;
  padding: 3px 10px;
  font: 10px ui-monospace, monospace;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #9fb0c0;
  background: rgba(15, 20, 25, 0.82);
  border: 1px solid #2a3542;
  border-radius: 4px;
  cursor: pointer;
  touch-action: manipulation;
}
#voice-toggle:hover { color: #dfe8f2; border-color: #556677; }
#voice-toggle[data-mic='on'] { color: #9fe0a8; border-color: #426b4c; }
#voice-toggle[data-denied='true'] { color: #c07a7a; border-color: #6b4242; }
`

function label(): string {
  if (voice.session.denied) return 'voice ✗'
  if (!voice.session.micOn) return 'voice off'
  const count = voice.session.members.length
  return count === 0 ? 'voice on' : `voice ${count + 1}`
}

function render(button: HTMLElement): void {
  button.textContent = label()
  button.dataset.mic = voice.session.micOn ? 'on' : 'off'
  button.dataset.members = String(voice.session.members.length)
  button.dataset.connected = String(voice.connectedCount)
  button.dataset.denied = voice.session.denied ? 'true' : 'false'
}

/** Mount once per HUD build; idempotent styling, prunes itself when detached. */
export function buildVoiceToggle(): HTMLElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = STYLE
  const button = el('button', { id: 'voice-toggle', type: 'button', title: 'voice party' }, [])
  render(button)
  const unsubscribe = voice.onChange(() => {
    if (!button.isConnected) {
      unsubscribe()
      return
    }
    render(button)
  })
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    void voice.toggle()
  })
  return button
}
