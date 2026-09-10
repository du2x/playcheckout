import type Phaser from 'phaser'
import { el } from './dom'

const STYLE_ID = 'fullscreen-toggle-styles'

const STYLE = `
#fullscreen-toggle {
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
#fullscreen-toggle:hover { color: #dfe8f2; border-color: #556677; }
`

function render(button: HTMLElement, isFullscreen: boolean): void {
  button.textContent = isFullscreen ? 'exit fullscreen' : 'fullscreen'
}

export function buildFullscreenToggle(game: Phaser.Game): HTMLElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = STYLE

  const button = el('button', { id: 'fullscreen-toggle', type: 'button' }, [])

  const updateLabel = () => {
    render(button, game.scale.isFullscreen)
  }

  updateLabel()

  button.addEventListener('pointerup', (event) => {
    event.preventDefault()
    if (game.scale.isFullscreen) {
      game.scale.stopFullscreen()
    } else {
      game.scale.startFullscreen()
    }
  })

  game.scale.on('enterfullscreen', updateLabel)
  game.scale.on('leavefullscreen', updateLabel)

  return button
}
