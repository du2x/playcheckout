import Phaser from 'phaser'
import { App } from './app'
import { installDebugHook } from './debug'
import { BootScene } from './scenes/BootScene'
import { RoundScene } from './scenes/RoundScene'

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 832,
  height: 576,
  backgroundColor: '#0f1419',
  scene: [BootScene, RoundScene],
})

if (import.meta.env.MODE !== 'production') {
  installDebugHook(game)
}

new App(document.querySelector('#overlay') as HTMLElement, game)
