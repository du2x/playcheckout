import Phaser from 'phaser'

/**
 * Phase 1 placeholder scene. Phase 3 replaces it with the gray-box client.
 * Coordinates avoid prd §7 tuning literals (denylist test, packages/sim).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create() {
    this.add.rectangle(416, 288, 832, 576, 0x223344)
    this.add.text(416, 288, 'turnover', { color: '#ffffff' }).setOrigin(0.5, 0.5)
  }
}
