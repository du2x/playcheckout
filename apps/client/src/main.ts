import Phaser from 'phaser'
import { installDebugHook } from './debug'
import { BootScene } from './scenes/BootScene'

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 832,
  height: 576,
  backgroundColor: '#0f1419',
  scene: [BootScene],
})

if (import.meta.env.MODE !== 'production') {
  installDebugHook(game)
}
