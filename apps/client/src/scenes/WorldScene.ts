import {
  type FloorId,
  type GuestFloorId,
  type MovementSnapshot,
  type RoomIndex,
  type RoomState,
  roomIndexAtMilli,
  TUNING,
} from '@turnover/shared'
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

/** In-car press keymap (ELR-06): browser event.code → floor pressed. */
const IN_CAR_FLOOR_BY_CODE: Record<string, FloorId> = {
  Digit1: 'floor1',
  Digit2: 'floor2',
  Digit3: 'floor3',
  Digit0: 'lobby',
}

export interface WorldPlayerEntry {
  readonly id: string
  readonly name: string
}

export interface WorldStartData {
  players: WorldPlayerEntry[]
  ownId: string
  sendMoveStart: (dir: 'left' | 'right') => void
  sendMoveStop: () => void
  sendElevatorCall: () => void
  sendElevatorPress: (floor: FloorId) => void
  sendWorkStart: (floor: GuestFloorId, room: RoomIndex) => void
}

type MovementAction =
  | { type: 'player-moved'; playerId: string; floor: string; x: number; facing: string }
  | { type: 'elevator-called'; floor: string; car: 1 | 2 }
  | { type: 'elevator-moved'; car: 1 | 2; floor: string }
  | { type: 'elevator-riders'; car: 1 | 2; riders: readonly string[]; queue: readonly string[] }
  | { type: 'player-left'; playerId: string }
  | { type: 'player-left-floor'; playerId: string; floor: string }
  | { type: 'movement-snapshot'; snapshot: MovementSnapshot }
  // Work channels (cycle 2.5): the actor's own channel view + the interior of
  // the room they stand in. No payload names a role or a channel kind (FR-9).
  | { type: 'work-started'; playerId: string; floor: string; room: number; seconds: number }
  | {
      type: 'work-ended'
      playerId: string
      floor: string
      room: number
      outcome: 'completed' | 'cancelled'
    }
  | { type: 'room-observed'; playerId: string; floor: string; room: number; state: RoomState }
  | { type: 'room-prepped'; floor: string; room: number }
  | { type: 'room-trashed'; floor: string; room: number }

interface PlayerDisplay {
  rect: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  x: number
  floor: string
  targetX: number | null
  /** True once the player departed our floor by elevator (AD-009). */
  left: boolean
}

export class WorldScene extends Phaser.Scene {
  private ownId = ''
  private sendMoveStart: (dir: 'left' | 'right') => void = () => {}
  private sendMoveStop: () => void = () => {}
  private sendElevatorCall: () => void = () => {}
  private sendElevatorPress: (floor: FloorId) => void = () => {}
  private sendWorkStart: (floor: GuestFloorId, room: RoomIndex) => void = () => {}
  private players = new Map<string, PlayerDisplay>()
  private cars = new Map<1 | 2, { ellipse: Phaser.GameObjects.Ellipse; floor: string }>()
  private ownMoving: 'left' | 'right' | null = null
  private viewFloor = 'lobby'
  /** Round phase mirror: prediction must match the server's confinement. */
  private round = false
  /** The actor's own running channel: DOM progress bar state (never a kind). */
  private work: { startedAt: number; seconds: number } | null = null
  /** The interior last observed for the own segment (FR-10 read half). */
  private interior: { floor: string; room: number; state: RoomState } | null = null
  /** The car the local player is riding, or null (keymap gate for presses). */
  private riding: 1 | 2 | null = null

  constructor() {
    super('Round')
  }

  create(data: WorldStartData): void {
    this.ownId = data.ownId
    this.sendMoveStart = data.sendMoveStart
    this.sendMoveStop = data.sendMoveStop
    this.sendElevatorCall = data.sendElevatorCall
    this.sendElevatorPress = data.sendElevatorPress
    this.sendWorkStart = data.sendWorkStart
    this.players.clear()
    this.cars.clear()
    this.ownMoving = null
    this.viewFloor = 'lobby'
    this.work = null
    this.interior = null
    this.riding = null

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
      // Elevator calls: up/down/E summons a car to this floor — destination-
      // free (AD-014): the destination is chosen inside the car via a press.
      keyboard.on('keydown-UP', () => this.callElevator())
      keyboard.on('keydown-DOWN', () => this.callElevator())
      keyboard.on('keydown-E', () => this.callElevator())
      // In-car floor presses (ELR-06): 1/2/3 press floor1..floor3, 0 presses
      // lobby — active only while the local player rides a car.
      keyboard.on('keydown', (event: KeyboardEvent) => {
        const floor = IN_CAR_FLOOR_BY_CODE[event.code]
        if (floor !== undefined) this.pressFloor(floor)
      })
      // Work: Space starts a channel inside the room segment the own
      // rectangle stands in; the server validates role and room state (FR-7).
      keyboard.on('keydown-SPACE', () => this.startWorkHere())
    }
  }

  /**
   * Phase mirror from the App (round:started / buzzer): own prediction
   * integrates only under the server's confinement rule — lobby phase allows
   * walking on the lobby floor only (MOVE-08), so a pre-round rider standing
   * on a guest floor must NOT predict movement the server will refuse.
   */
  setRound(round: boolean): void {
    this.round = round
  }

  /** Send work:start when the own predicted position is inside a segment. */
  private startWorkHere(): void {
    const own = this.players.get(this.ownId)
    if (own === undefined) return
    const floor = own.floor as FloorId
    if (floor === 'lobby') return
    const room = roomIndexAtMilli(Math.round(own.x * 1000))
    if (room === 0) return
    this.sendWorkStart(floor as GuestFloorId, room as RoomIndex)
  }

  /** Movement-kind ViewActions are routed here by the App (render state). */
  applyAction(action: MovementAction): void {
    switch (action.type) {
      case 'player-moved': {
        const display = this.players.get(action.playerId)
        if (display === undefined) return
        display.floor = action.floor
        display.x = action.x
        display.left = false
        if (action.playerId === this.ownId) {
          display.targetX = null
          this.viewFloor = action.floor
          // The own floor stream only runs OFF a car: boarding's position snap
          // precedes the first riders update, and an exit resumes the stream —
          // either way the own player:moved clears stale riding state.
          this.riding = null
        } else {
          display.targetX = action.x
        }
        break
      }
      case 'elevator-riders': {
        // AD-013: the rider-exclusive occupancy update is the authoritative
        // riding signal — board (own id present) and walk-off (absent).
        if (action.riders.includes(this.ownId)) this.riding = action.car
        else if (this.riding === action.car) this.riding = null
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
        this.flashPanel()
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
      case 'player-left-floor': {
        // The player departed OUR floor by elevator: drop the rectangle. The
        // payload names no destination (AD-009 coherence).
        const display = this.players.get(action.playerId)
        if (display !== undefined && display.floor === action.floor) display.left = true
        break
      }
      case 'movement-snapshot':
        this.applySnapshot(action.snapshot)
        break
      case 'work-started':
        if (action.playerId !== this.ownId) return
        this.work = { startedAt: Date.now(), seconds: action.seconds }
        this.updateWorkBar()
        break
      case 'work-ended':
        if (action.playerId !== this.ownId) return
        this.work = null
        this.updateWorkBar()
        break
      case 'room-observed':
        if (action.playerId !== this.ownId) return
        this.interior = { floor: action.floor, room: action.room, state: action.state }
        break
      case 'room-prepped':
      case 'room-trashed': {
        // Only the room we are inside exists in our view (FR-10); a matching
        // transition updates it, everything else is not for us.
        const interior = this.interior
        if (interior === undefined || interior === null) return
        if (interior.floor !== action.floor || interior.room !== action.room) return
        interior.state = action.type === 'room-prepped' ? 'prepped' : 'trashed'
        break
      }
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
      display.left = false
      if (p.playerId === this.ownId) this.viewFloor = p.floor
    }
    for (const c of snapshot.cars) {
      const car = this.cars.get(c.car)
      if (car !== undefined) car.floor = c.floor
    }
    // AD-013: a rider's snapshot carries their car's occupants; a non-rider's
    // carries none — the snapshot is authoritative at join/buzzer resync.
    this.riding = snapshot.carOccupants?.car ?? null
    this.updatePanel()
  }

  private addPlayerDisplay(id: string, name: string): void {
    const x = 15
    const rect = this.add.rectangle(x * TILE_PX, GROUND_Y, 26, 60, 0x2f4f6f)
    const label = this.add.text(x * TILE_PX, GROUND_Y + 48, name.slice(0, 12), {
      color: '#ffffff',
    })
    label.setOrigin(0.5, 0.5)
    this.players.set(id, { rect, label, x, floor: 'lobby', targetX: null, left: false })
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

  /** Destination-free elevator call (AD-014): the pickup floor is implicit. */
  private callElevator(): void {
    this.sendElevatorCall()
  }

  /** In-car floor press — sent only while the local player rides a car. */
  private pressFloor(floor: FloorId): void {
    if (this.riding === null) return
    this.sendElevatorPress(floor)
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

  /**
   * Visible call acknowledgment (AD-012): the flash is data-only on the wire,
   * so the panel pulses here — a call always looks registered (FR-5).
   */
  private flashPanel(): void {
    const panel = document.querySelector('#elevator-panel')
    if (panel === null || !(panel instanceof HTMLElement)) return
    panel.style.backgroundColor = '#3a5a3a'
    window.setTimeout(() => {
      panel.style.backgroundColor = ''
    }, 700)
  }

  /** Progress bar is DOM: fill width from the own channel's elapsed time. */
  private updateWorkBar(): void {
    const bar = document.querySelector('#work-progress')
    if (bar === null) return
    if (this.work === null) {
      bar.setAttribute('hidden', '')
      return
    }
    bar.removeAttribute('hidden')
    const fill = bar.querySelector('#work-progress-fill')
    if (fill instanceof HTMLElement) fill.style.width = '0%'
  }

  /** Room-state label: visible only while the own rectangle is inside that segment. */
  private updateRoomLabel(): void {
    const label = document.querySelector('#room-state')
    if (label === null) return
    const interior = this.interior
    const own = this.players.get(this.ownId)
    const inside =
      interior !== null &&
      own !== undefined &&
      own.floor === interior.floor &&
      roomIndexAtMilli(Math.round(own.x * 1000)) === interior.room
    if (!inside) {
      label.setAttribute('hidden', '')
      return
    }
    label.removeAttribute('hidden')
    label.textContent = `room ${interior.room}: ${interior.state}`
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000
    // Local prediction for the own rectangle; server positions reconcile it.
    const own = this.players.get(this.ownId)
    const confined = !this.round && own !== undefined && own.floor !== 'lobby'
    if (own !== undefined && this.ownMoving !== null && !confined) {
      own.x += this.ownMoving === 'left' ? -SPEED_TILES_PER_SEC * dt : SPEED_TILES_PER_SEC * dt
      own.x = Math.min(30, Math.max(0, own.x))
    }
    for (const [id, display] of this.players) {
      if (id !== this.ownId && display.targetX !== null) {
        // Others follow server positions within ~2 ticks (exponential approach).
        display.x += (display.targetX - display.x) * Math.min(1, dt * 12)
      }
      const visible = display.floor === this.viewFloor && !display.left
      display.rect.setVisible(visible)
      display.label.setVisible(visible)
      display.rect.x = display.x * TILE_PX
      display.label.x = display.x * TILE_PX
    }
    for (const [, car] of this.cars) {
      car.ellipse.setVisible(car.floor === this.viewFloor)
    }
    // The elevator panel is self-healing: view re-renders rebuild the DOM
    // element, so refresh it every frame from scene state.
    this.updatePanel()
    // Work-channel DOM state: bar fill follows elapsed time; the interior
    // label lives only while the own rectangle stands inside the segment.
    if (this.work !== null) {
      const fill = document.querySelector('#work-progress-fill')
      if (fill instanceof HTMLElement) {
        const elapsed = (Date.now() - this.work.startedAt) / 1000
        fill.style.width = `${Math.min(100, (elapsed / this.work.seconds) * 100)}%`
      }
    }
    this.updateRoomLabel()
  }
}
