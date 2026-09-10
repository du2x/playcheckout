import Phaser from 'phaser'
import { App } from './app'
import { armMusicAutostart } from './audio/music'
import { installDebugHook } from './debug'
import { BootScene } from './scenes/BootScene'
import { WorldScene } from './scenes/WorldScene'

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-wrapper',
  width: 960,
  height: 576,
  backgroundColor: '#0f1419',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, WorldScene],
})

if (import.meta.env.MODE !== 'production') {
  installDebugHook(game)
}

new App(document.querySelector('#overlay') as HTMLElement, game)

armMusicAutostart()
