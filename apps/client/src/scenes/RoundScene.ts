import Phaser from 'phaser'

/**
 * Round world (first-light): one labeled rectangle per player, static —
 * movement and rooms arrive with cycle 2.3. Labels come from the lobby roster;
 * a playerId without a roster name falls back to the raw id (LIGHT-12).
 */
export interface RoundPlayerEntry {
  readonly id: string
  readonly name: string
}

export class RoundScene extends Phaser.Scene {
  constructor() {
    super('Round')
  }

  create(data: { players?: RoundPlayerEntry[] }): void {
    const players = data.players ?? []
    const spacing = 120
    players.forEach((player, index) => {
      const x = 416 + (index - (players.length - 1) / 2) * spacing
      this.add.rectangle(x, 288, 90, 130, 0x2f4f6f)
      this.add.text(x, 370, player.name.slice(0, 12), { color: '#ffffff' }).setOrigin(0.5, 0.5)
    })
  }
}
