import Phaser from 'phaser'
import { App } from './app'
import { armMusicAutostart } from './audio/music'
import { installDebugHook } from './debug'
import { BootScene } from './scenes/BootScene'
import { WorldScene } from './scenes/WorldScene'
import { GAME_HEIGHT, GAME_WIDTH, installStageLayout } from './ui/stage'

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0f1419',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Fullscreen the whole stage (canvas + DOM overlay), not the bare canvas —
    // the overlay must stay visible in fullscreen (ui/stage.ts).
    fullscreenTarget: 'game-wrapper',
  },
  scene: [BootScene, WorldScene],
})

installStageLayout(game)

if (import.meta.env.MODE !== 'production') {
  installDebugHook(game)
}

new App(document.querySelector('#overlay') as HTMLElement, game)

armMusicAutostart()
