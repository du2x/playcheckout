import { loadSfxPref, type SfxPref, storeSfxPref } from '../audio/prefs'
import { sfx } from '../audio/sfx'
import { el } from './dom'

/**
 * The sound toggle (night-juice): one small DOM chip in the HUD corner.
 * Mute state is session-persisted (`audio/prefs.ts`) and drives the SFX
 * engine's master gain — cues and the ambient music loop together.
 * Presentation-only — no game state behind it.
 */

const STYLE_ID = 'sfx-toggle-styles'

const STYLE = `
#sfx-toggle {
  position: absolute;
  right: 10px;
  top: 10px;
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
#sfx-toggle:hover { color: #dfe8f2; border-color: #556677; }
#sfx-toggle[data-muted='true'] { color: #556677; }
`

/** Current pref (module-scoped so rebuilds re-render the right state). */
let pref: SfxPref = 'on'

function render(button: HTMLElement): void {
  button.textContent = pref === 'on' ? 'sound on' : 'sound off'
  button.dataset.muted = pref === 'off' ? 'true' : 'false'
}

/** Mount once per HUD build; idempotent styling, wires the toggle once. */
export function buildSfxToggle(): HTMLElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = STYLE
  const button = el('button', { id: 'sfx-toggle', type: 'button' }, [])
  pref = loadSfxPref(window.sessionStorage)
  sfx.applyPref(pref)
  render(button)
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    pref = pref === 'on' ? 'off' : 'on'
    storeSfxPref(window.sessionStorage, pref)
    sfx.applyPref(pref)
    render(button)
  })
  return button
}
