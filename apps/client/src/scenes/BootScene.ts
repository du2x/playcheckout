import Phaser from 'phaser'

/**
 * Phase 1 placeholder scene. Phase 3 replaces it with the gray-box client.
 * Coordinates avoid prd §7 tuning literals (denylist test, packages/sim).
 *
 * Art pipeline (AD-020): the production sheets from apps/client/public/art
 * preload here so WorldScene can consume textures without a loading gate.
 * Sheets are spritesheets (per-frame slicing); stand-alone art loads as images.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload(): void {
    this.load.spritesheet('staff-walk', 'art/chars/staff-walk-8f.png', {
      frameWidth: 28,
      frameHeight: 60,
    })
    this.load.spritesheet('fx-rustle', 'art/props/fx-rustle-4f.png', {
      frameWidth: 32,
      frameHeight: 32,
    })
    this.load.image('door-closed', 'art/doors/door-closed.png')
    this.load.image('door-open', 'art/doors/door-open.png')
    this.load.image('door-card', 'art/doors/door-card.png')
    this.load.image('elevator-car', 'art/elevator/elevator-car.png')
    this.load.image('elevator-panel', 'art/elevator/elevator-panel.png')
    this.load.image('corridor-band', 'art/rooms/corridor-band.png')
    this.load.image('room-prepped', 'art/rooms/room-prepped.png')
    this.load.image('room-trash-fresh', 'art/rooms/room-trash-fresh.png')
    this.load.image('room-trash-settled', 'art/rooms/room-trash-settled.png')
  }

  create() {
    this.add.rectangle(416, 288, 832, 576, 0x223344)
    this.add.text(416, 288, 'turnover', { color: '#ffffff' }).setOrigin(0.5, 0.5)
  }
}
