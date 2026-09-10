import type Phaser from 'phaser'

/**
 * Stage layout: the canvas is the whole UI. The world is authored at a fixed
 * 960×576 canvas, but players run windowed, maximized, or fullscreen on any
 * monitor — and every DOM surface (lobby, HUD, results, plus the scene's own
 * DOM chips) must sit exactly on the canvas, scaled with it, never spilling
 * onto the page around it. Three boxes cooperate:
 *
 *   #game-wrapper — viewport-filling fullscreen target (letterbox background)
 *     #game      — real-px box pinned to the live canvas rect; Phaser's FIT
 *                  canvas fills it exactly (no transform — Phaser measures
 *                  this box with getBoundingClientRect and sizes the canvas
 *                  in real px)
 *       #game-dom — design surface (960×576, transform-scaled): every
 *                   scene DOM layer keeps its design-px math (evidence
 *                   markers, lane readouts) and lands on the right screen px
 *     #overlay   — the DOM UI design surface, same rect, same scale
 *
 * Fullscreen targets the WRAPPER (scale.fullscreenTarget in main.ts), so the
 * overlay rides into fullscreen instead of being left behind on the hidden
 * page — previously only the bare canvas was fullscreened and every DOM
 * element vanished.
 */

export const GAME_WIDTH = 960
export const GAME_HEIGHT = 576

const STYLE_ID = 'stage-layout-styles'

const STYLE = `
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0f1419;
}
#game-wrapper {
  position: fixed;
  inset: 0;
  overflow: hidden;
}
#game {
  position: absolute;
  overflow: hidden;
}
#game canvas { display: block; }
#game-dom, #overlay {
  position: absolute;
  left: 0;
  top: 0;
  width: ${GAME_WIDTH}px;
  height: ${GAME_HEIGHT}px;
  transform-origin: 0 0;
}
#overlay { overflow: hidden; pointer-events: none; }
/* The overlay is a click-through HUD; interactive mounts re-enable hits. */
#overlay form, #overlay button, #overlay input, #overlay #lobby-card, #overlay #results-card,
#overlay #accuse-menu, #overlay .car-screen-inner, #overlay .stair-screen-inner {
  pointer-events: auto;
}

/* ---- view roots: full-surface, children place themselves ---- */
#round-hud, #join-view, #lobby-view, #results-view, #lost-view {
  position: absolute;
  inset: 0;
}

/* ---- shared HUD placement (design px; both lobby and round views mount
   these ride-along elements) ---- */
#clock {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  padding: 2px 14px;
  font: bold 22px ui-monospace, monospace;
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
  color: #ffd98a;
  text-shadow: 0 0 12px rgba(230, 197, 106, 0.5), 0 2px 0 rgba(0, 0, 0, 0.62);
  background: rgba(10, 14, 19, 0.72);
  border: 1px solid #2a3542;
  border-radius: 6px;
}
#hud-error {
  position: absolute;
  top: 46px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 21;
  margin: 0;
  font: 12px ui-monospace, monospace;
  color: #ff9a8a;
  background: rgba(25, 10, 10, 0.85);
  border: 1px solid #7a3a30;
  border-radius: 4px;
  padding: 3px 10px;
}
#accuse-toasts {
  position: absolute;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 24;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.accuse-toast {
  padding: 4px 12px;
  font: 12px ui-monospace, monospace;
  letter-spacing: 1px;
  color: #ffb0a0;
  background: rgba(40, 12, 12, 0.85);
  border: 1px solid #7a3a30;
  border-radius: 4px;
  white-space: nowrap;
}
#fired-banner {
  position: absolute;
  top: 128px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 26;
  padding: 8px 22px;
  font: bold 15px ui-monospace, monospace;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #ffd3c8;
  background: rgba(60, 14, 10, 0.92);
  border: 1px solid #a04a3a;
  border-radius: 6px;
  box-shadow: 0 0 24px rgba(200, 70, 50, 0.35);
  white-space: nowrap;
}
#accuse-menu {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 45;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  font: 13px ui-monospace, monospace;
  color: #dfe8f2;
  background: rgba(13, 18, 24, 0.95);
  border: 1px solid #55492c;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7);
}
#accuse-menu[hidden] { display: none; }
#accuse-menu button {
  padding: 4px 14px;
  font: 11px ui-monospace, monospace;
  letter-spacing: 2px;
  text-transform: uppercase;
  border-radius: 4px;
  border: 1px solid #3d4a58;
  background: #1a2530;
  color: #9fb0c0;
  cursor: pointer;
}
#accuse-menu #accuse-confirm { border-color: #7a3a30; color: #ffb0a0; }
#accuse-menu button:hover { color: #dfe8f2; }

#role-label {
  position: absolute;
  left: 12px;
  bottom: 42px;
  z-index: 20;
  font: 10px ui-monospace, monospace;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #8899aa;
}
#role-card {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 20;
  padding: 5px 14px;
  font: bold 14px ui-monospace, monospace;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #ffd98a;
  background: rgba(13, 18, 24, 0.88);
  border: 1px solid #55492c;
  border-left: 4px solid #e6c56a;
  border-radius: 6px;
  text-shadow: 0 0 10px rgba(230, 197, 106, 0.45);
}
#elevator-panel {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 20;
  padding: 4px 12px;
  font: 11px ui-monospace, monospace;
  letter-spacing: 1px;
  color: #9fb0c0;
  background: rgba(13, 18, 24, 0.88);
  border: 1px solid #2a3542;
  border-radius: 6px;
}
#elevator-riders {
  position: absolute;
  right: 12px;
  bottom: 40px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  padding: 6px 12px;
  font: 11px ui-monospace, monospace;
  letter-spacing: 1px;
  color: #9fb0c0;
  background: rgba(13, 18, 24, 0.88);
  border: 1px solid #55492c;
  border-radius: 6px;
}
#elevator-riders[hidden] { display: none; }
#elevator-riders-names { color: #dfe8f2; }
#elevator-indicators { display: inline-flex; gap: 7px; }
.floor-indicator { opacity: 0.3; color: #9fb0c0; }
.floor-indicator.lit { opacity: 1; color: #ffd98a; text-shadow: 0 0 8px rgba(230, 197, 106, 0.7); }
#elevator-press { color: #8ad07a; min-height: 13px; }

#work-progress {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 22;
  width: 240px;
  height: 14px;
  background: #0a0f14;
  border: 1px solid #2a3542;
  border-radius: 7px;
  overflow: hidden;
}
#work-progress-fill {
  display: block;
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #8ad07a, #e6c56a);
}
#room-state {
  position: absolute;
  bottom: 38px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 22;
  padding: 3px 12px;
  font: 11px ui-monospace, monospace;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #dfe8f2;
  background: rgba(13, 18, 24, 0.88);
  border: 1px solid #2a3542;
  border-radius: 6px;
}
#room-state:empty { display: none; }

#tutorial-hud {
  position: absolute;
  left: 12px;
  bottom: 64px;
  z-index: 35;
  max-width: 430px;
}

/* Stairwell DOM twin (breath window). The climb canvas owns transit/stun. */
#elevator-stair-screen {
  position: absolute;
  left: 50%;
  bottom: 120px;
  transform: translateX(-50%);
  width: 460px;
  z-index: 30;
}

#lost-view {
  display: flex;
  align-items: center;
  justify-content: center;
  font: 14px ui-monospace, monospace;
  letter-spacing: 2px;
  color: #9fb0c0;
  background: rgba(15, 20, 25, 0.9);
}
`

/**
 * Pin both DOM layers to the live canvas rectangle and keep them there
 * (window resizes, orientation, fullscreen enter/leave). Safe to call before
 * the game finishes booting — the first refresh happens on the scale events.
 */
export function installStageLayout(game: Phaser.Game): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = STYLE

  syncStage(game)

  if (game.scale === undefined) {
    // Pre-boot edge: the ScaleManager appears with the rest of the game.
    game.events.once('ready', () => installStageListeners(game))
  } else {
    installStageListeners(game)
  }
}

/** Recompute the stage geometry from the current viewport and re-fit Phaser. */
function syncStage(game: Phaser.Game): void {
  const gameSurface = document.getElementById('game')
  const overlay = document.getElementById('overlay')
  const domSurface = document.getElementById('game-dom')
  if (gameSurface === null || overlay === null || domSurface === null) return

  const scale = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT)
  const left = (window.innerWidth - GAME_WIDTH * scale) / 2
  const top = (window.innerHeight - GAME_HEIGHT * scale) / 2
  // #game is the un-transformed real-px box Phaser FITs its canvas into;
  // the design surfaces scale their 960×576 coordinate space onto it.
  gameSurface.style.left = `${left}px`
  gameSurface.style.top = `${top}px`
  gameSurface.style.width = `${GAME_WIDTH * scale}px`
  gameSurface.style.height = `${GAME_HEIGHT * scale}px`
  const fit = `scale(${scale})`
  domSurface.style.transform = fit
  overlay.style.left = `${left}px`
  overlay.style.top = `${top}px`
  overlay.style.transform = fit
  // Phaser re-measures #game (transform-aware getBoundingClientRect) and
  // resizes the canvas on refresh; the rect compare breaks the
  // sync → refresh → resize → sync loop once they agree.
  const canvas = game.canvas
  if (canvas !== null) {
    const box = gameSurface.getBoundingClientRect()
    const rect = canvas.getBoundingClientRect()
    if (Math.abs(box.width - rect.width) > 0.5 || Math.abs(box.height - rect.height) > 0.5) {
      game.scale.refresh()
    }
  }
}

function installStageListeners(game: Phaser.Game): void {
  let pending = 0
  const schedule = (): void => {
    cancelAnimationFrame(pending)
    pending = requestAnimationFrame(() => syncStage(game))
  }
  const scheduleSoon = (): void => {
    schedule()
    // Fullscreen viewport metrics can settle a beat after the event fires.
    window.setTimeout(schedule, 350)
  }
  game.scale.on('resize', schedule)
  game.scale.on('enterfullscreen', scheduleSoon)
  game.scale.on('leavefullscreen', scheduleSoon)
  window.addEventListener('resize', schedule)
}
