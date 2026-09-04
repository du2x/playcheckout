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
    // Phase 4.1 cast: the 34x64 body keeps the historical 'staff-walk' key
    // (the harness texture-filter contract); the variant overlay is new.
    this.load.spritesheet('staff-walk', 'art/chars/staff-body-34x64-7f.png', {
      frameWidth: 34,
      frameHeight: 64,
    })
    this.load.spritesheet('staff-variant', 'art/chars/staff-variant-8f.png', {
      frameWidth: 34,
      frameHeight: 64,
    })
    // Guest archetype silhouettes (Phase 4.1, T6) — grayscale tint carriers.
    this.load.image('guest-suite', 'art/chars/guest-suite.png')
    this.load.image('guest-tourist', 'art/chars/guest-tourist.png')
    this.load.image('guest-clerk', 'art/chars/guest-clerk.png')
    this.load.image('guest-elder', 'art/chars/guest-elder.png')
    this.load.spritesheet('fx-rustle', 'art/props/fx-rustle-4f.png', {
      frameWidth: 32,
      frameHeight: 32,
    })
    this.load.image('door-closed', 'art/doors/door-closed.png')
    this.load.image('door-open', 'art/doors/door-open.png')
    this.load.image('door-card', 'art/doors/door-card.png')
    this.load.spritesheet('elevator-door', 'art/elevator/elevator-door.png', {
      frameWidth: 80,
      frameHeight: 96,
    })
    this.load.spritesheet('elevator-panel', 'art/elevator/elevator-panel.png', {
      frameWidth: 16,
      frameHeight: 32,
    })
    this.load.image('corridor-band', 'art/rooms/corridor-band.png')
    this.load.image('wall-field', 'art/rooms/wall-field.png')
    this.load.image('sconce', 'art/props/sconce.png')
    this.load.image('room-prepped', 'art/rooms/room-prepped.png')
    this.load.image('room-trash-fresh', 'art/rooms/room-trash-fresh.png')
    this.load.image('room-trash-settled', 'art/rooms/room-trash-settled.png')
  }

  create() {
    this.add.rectangle(480, 288, 960, 576, 0x0f1b21)
    this.add.text(416, 288, 'turnover', { color: '#ffffff' }).setOrigin(0.5, 0.5)
  }
}
