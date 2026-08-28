import type { MovementSnapshot } from '@turnover/shared'
import { TUNING } from '@turnover/shared'
import Phaser from 'phaser'

/**
 * The persistent world (cycle 2.4, AD-005): mounts when the player first joins
 * and survives lobby→round→lobby — positions never reset. Rendering contract
 * (keeps the LIGHT-09 harness assertions green unmodified): scene children are
 * exactly one labeled Rectangle per player plus one Ellipse per elevator car —
 * every other visual (hall line, elevator panel) is DOM.
 *
 * Movement model (spec): the local player is predicted (own rectangle moves
 * immediately on keydown) and reconciled by server events; other players lerp
 * toward their last server position. The view shows the local player's floor.
 */

const TILE_PX = 832 / 30 // hall width in px per tile
const GROUND_Y = 430
const SPEED_TILES_PER_SEC = TUNING.PLAYER_SPEED_TILES_PER_SEC

export interface WorldPlayerEntry {
  readonly id: string
  readonly name: string
}

export interface WorldStartData {
  players: WorldPlayerEntry[]
  ownId: string
  sendMoveStart: (dir: 'left' | 'right') => void
  sendMoveStop: () => void
}

type MovementAction =
  | { type: 'player-moved'; playerId: string; floor: string; x: number; facing: string }
  | { type: 'elevator-called'; floor: string; car: 1 | 2 }
  | { type: 'elevator-moved'; car: 1 | 2; floor: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'movement-snapshot'; snapshot: MovementSnapshot }

interface PlayerDisplay {
  rect: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  x: number
  floor: string
  targetX: number | null
}

export class WorldScene extends Phaser.Scene {
  private ownId = ''
  private sendMoveStart: (dir: 'left' | 'right') => void = () => {}
  private sendMoveStop: () => void = () => {}
  private players = new Map<string, PlayerDisplay>()
  private cars = new Map<1 | 2, { ellipse: Phaser.GameObjects.Ellipse; floor: string }>()
  private ownMoving: 'left' | 'right' | null = null
  private viewFloor = 'lobby'

  constructor() {
    super('Round')
  }

  create(data: WorldStartData): void {
    this.ownId = data.ownId
    this.sendMoveStart = data.sendMoveStart
    this.sendMoveStop = data.sendMoveStop
    this.players.clear()
    this.cars.clear()
    this.ownMoving = null
    this.viewFloor = 'lobby'

    // Hall line (Graphics — deliberately not a Rectangle/Text: harness contract).
    this.add
      .graphics()
      .lineStyle(2, 0x556677, 1)
      .lineBetween(0, GROUND_Y + 66, 832, GROUND_Y + 66)

    for (const player of data.players) this.addPlayerDisplay(player.id, player.name)

    // One Ellipse per elevator car at its landing x (never a Rectangle: harness
    // counts player rectangles; and never an occupant list (privacy rule).
    for (const id of [1, 2] as const) {
      const ellipse = this.add.ellipse(this.carPx(id), GROUND_Y + 30, 46, 60, 0x775533)
      this.cars.set(id, { ellipse, floor: 'lobby' })
    }

    const keyboard = this.input.keyboard
    if (keyboard !== null) {
      keyboard.on('keydown-LEFT', () => this.beginMove('left'))
      keyboard.on('keydown-RIGHT', () => this.beginMove('right'))
      keyboard.on('keyup-LEFT', () => this.endMove('left'))
      keyboard.on('keyup-RIGHT', () => this.endMove('right'))
    }
  }

  /** Movement-kind ViewActions are routed here by the App (render state). */
  applyAction(action: MovementAction): void {
    switch (action.type) {
      case 'player-moved': {
        const display = this.players.get(action.playerId)
        if (display === undefined) return
        display.floor = action.floor
        display.x = action.x
        if (action.playerId === this.ownId) {
          display.targetX = null
          this.viewFloor = action.floor
        } else {
          display.targetX = action.x
        }
        break
      }
      case 'elevator-moved': {
        const car = this.cars.get(action.car)
        if (car !== undefined) car.floor = action.floor
        this.updatePanel()
        break
      }
      case 'elevator-called':
        this.updatePanel()
        break
      case 'player-left': {
        const display = this.players.get(action.playerId)
        if (display !== undefined) {
          display.rect.destroy()
          display.label.destroy()
          this.players.delete(action.playerId)
        }
        break
      }
      case 'movement-snapshot':
        this.applySnapshot(action.snapshot)
        break
    }
  }

  /** Track roster growth/shrink from lobby snapshots (players join over time). */
  syncRoster(players: readonly WorldPlayerEntry[]): void {
    const known = new Set(players.map((p) => p.id))
    for (const [id, display] of this.players) {
      if (known.has(id)) continue
      display.rect.destroy()
      display.label.destroy()
      this.players.delete(id)
    }
    for (const player of players) {
      if (this.players.has(player.id)) continue
      // Fresh joiners stand at the lobby center spawn until they move.
      this.addPlayerDisplay(player.id, player.name)
    }
  }

  /** Seed positions from a movement snapshot (join / buzzer). */
  applySnapshot(snapshot: MovementSnapshot): void {
    for (const p of snapshot.players) {
      const display = this.players.get(p.playerId)
      if (display === undefined) continue
      display.x = p.x
      display.floor = p.floor
      display.targetX = null
      if (p.playerId === this.ownId) this.viewFloor = p.floor
    }
    for (const c of snapshot.cars) {
      const car = this.cars.get(c.car)
      if (car !== undefined) car.floor = c.floor
    }
    this.updatePanel()
  }

  private addPlayerDisplay(id: string, name: string): void {
    const x = 15
    const rect = this.add.rectangle(x * TILE_PX, GROUND_Y, 26, 60, 0x2f4f6f)
    const label = this.add.text(x * TILE_PX, GROUND_Y + 48, name.slice(0, 12), {
      color: '#ffffff',
    })
    label.setOrigin(0.5, 0.5)
    this.players.set(id, { rect, label, x, floor: 'lobby', targetX: null })
  }

  private beginMove(dir: 'left' | 'right'): void {
    if (this.ownMoving === dir) return
    this.ownMoving = dir
    this.sendMoveStart(dir)
  }

  private endMove(dir: 'left' | 'right'): void {
    if (this.ownMoving !== dir) return
    this.ownMoving = null
    this.sendMoveStop()
  }

  private carPx(car: 1 | 2): number {
    return car === 1 ? 0 : 30 * TILE_PX
  }

  private updatePanel(): void {
    const panel = document.querySelector('#elevator-panel')
    if (panel === null) return
    const west = this.cars.get(1)?.floor ?? '?'
    const east = this.cars.get(2)?.floor ?? '?'
    const w = panel.querySelector('#panel-west')
    const e = panel.querySelector('#panel-east')
    if (w !== null) w.textContent = west
    if (e !== null) e.textContent = east
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000
    // Local prediction for the own rectangle; server positions reconcile it.
    const own = this.players.get(this.ownId)
    if (own !== undefined && this.ownMoving !== null) {
      own.x += this.ownMoving === 'left' ? -SPEED_TILES_PER_SEC * dt : SPEED_TILES_PER_SEC * dt
      own.x = Math.min(30, Math.max(0, own.x))
    }
    for (const [id, display] of this.players) {
      if (id !== this.ownId && display.targetX !== null) {
        // Others follow server positions within ~2 ticks (exponential approach).
        display.x += (display.targetX - display.x) * Math.min(1, dt * 12)
      }
      const visible = display.floor === this.viewFloor
      display.rect.setVisible(visible)
      display.label.setVisible(visible)
      display.rect.x = display.x * TILE_PX
      display.label.x = display.x * TILE_PX
    }
    for (const [, car] of this.cars) {
      car.ellipse.setVisible(car.floor === this.viewFloor)
    }
  }
}
