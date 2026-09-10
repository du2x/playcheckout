import type { FloorId } from '@turnover/shared'
import Phaser from 'phaser'
import type { RiderUpdate } from '../riderSession'
import { FLOOR_ORDER } from '../ui/carScreen'
import {
  arrivalBurstAlpha,
  type CarClock,
  type CarScreenReadout,
  carSwayY,
  DEFAULT_ANIMATION_CONFIG,
  doorsOpenAmount,
} from './elevatorPresenter'

/** One resolved occupant figure: the scene maps rider ids to roster names. */
export interface CarOccupant {
  readonly name: string
  readonly you: boolean
}

/** The readouts the interior renders — facts, not sources: the scene pulls
 *  `screen`/`clock` from its presenter (shared with the world car, DOM twins,
 *  audio) and resolves the occupant names before handing them over. */
export interface CarInteriorInput {
  /** `null` hides the interior (the local player is not riding). */
  readonly rider: RiderUpdate
  readonly screen: CarScreenReadout
  /** The own car's presenter clock (doors, sway, arrival burst). */
  readonly clock: CarClock | undefined
  readonly occupants: readonly CarOccupant[]
}

/**
 * CarInteriorView: the fullscreen elevator-car interior as a view module —
 * one interface, one sync per frame. It owns the `elevatorCanvas` container
 * and everything inside it: walls, handrail, carpet, the beyond-door glow
 * (arrival burst), the brushed-steel doors, the floor dial + state line, the
 * pressable brass button pillar, and the occupant figures center stage on
 * the carpet (the social read IS the scene; the DOM car bar is retired while
 * riding). Container-owned, so top-level ART counts are blind to every
 * rectangle here. Button presses emit through the scene callback — the view
 * never talks to the server.
 */
export class CarInteriorView {
  private readonly scene: Phaser.Scene
  private readonly onPressFloor: (floor: FloorId) => void
  private canvas: Phaser.GameObjects.Container | null = null
  private floorLabel: Phaser.GameObjects.Text | null = null
  private stateLabel: Phaser.GameObjects.Text | null = null
  private doors: {
    left: Phaser.GameObjects.Rectangle
    right: Phaser.GameObjects.Rectangle
  } | null = null
  private occupantsRow: Phaser.GameObjects.Container | null = null
  private readonly buttons = new Map<FloorId, Phaser.GameObjects.Arc>()
  private beyond: Phaser.GameObjects.Rectangle | null = null
  /** `Date.now()` the current arrival burst began; -1 = no burst. */
  private burstT0 = -1

  constructor(scene: Phaser.Scene, onPressFloor: (floor: FloorId) => void) {
    this.scene = scene
    this.onPressFloor = onPressFloor
    this.build()
  }

  /** The car interior is a top-level harness child (by name `elevatorCanvas`). */
  get visible(): boolean {
    return this.canvas?.visible ?? false
  }

  /** Apply one frame of the input: hidden unless the local player rides. */
  sync(input: CarInteriorInput): void {
    if (this.canvas === null) return
    const riding = input.rider
    if (riding === null) {
      this.canvas.setVisible(false)
      return
    }
    this.canvas.setVisible(true)
    const readout = input.screen
    if (this.floorLabel !== null) {
      const label = readout.floor
      this.floorLabel.setText(
        label === null
          ? ''
          : label === 'lobby'
            ? 'L'
            : label === 'mezzanine'
              ? 'M'
              : label.slice(-1),
      )
    }
    if (this.stateLabel !== null) {
      this.stateLabel.setText(readout.state ?? '')
    }
    const carLabel = this.canvas.getByName('carLabel') as Phaser.GameObjects.Text | null
    if (carLabel !== null) carLabel.setText(`car ${riding.car}`)
    const dirArrow = this.canvas.getByName('dirArrow') as Phaser.GameObjects.Text | null
    const movingFrom = readout.floor
    const movingTo = readout.state?.startsWith('moving to ')
      ? readout.state.slice('moving to '.length).trim()
      : null
    if (dirArrow !== null && movingTo !== null && movingFrom !== null) {
      const here = FLOOR_ORDER.indexOf(movingFrom)
      const there = FLOOR_ORDER.indexOf(movingTo as FloorId)
      dirArrow.setText(there > here ? '▲' : '▼')
    } else if (dirArrow !== null) {
      dirArrow.setText('')
    }
    // Ride sway: the whole car breathes vertically while in transit.
    const clock = input.clock
    const swaying = clock?.phase === 'transit'
    this.canvas.setY(swaying ? 288 + carSwayY(Date.now()) : 288)
    // The beyond-door glow: an arrival burst when the doors begin opening.
    if (this.beyond !== null) {
      if (clock?.phase === 'opening') {
        if (this.burstT0 < 0) this.burstT0 = Date.now()
      } else {
        this.burstT0 = -1
      }
      const burstElapsed = this.burstT0 < 0 ? -1 : Date.now() - this.burstT0
      this.beyond.setAlpha(arrivalBurstAlpha(burstElapsed))
    }
    if (this.doors !== null) {
      const amount = clock !== undefined ? doorsOpenAmount(clock, DEFAULT_ANIMATION_CONFIG) : 0
      this.doors.left.x = -70 - amount * 66
      this.doors.right.x = 70 + amount * 66
    }
    for (const [floorId, btn] of this.buttons) {
      const lit = riding.queue.includes(floorId)
      const here = readout.floor === floorId
      btn.setFillStyle(lit ? 0xc8a24a : 0x1a2530)
      btn.setStrokeStyle(here ? 2 : 1, here ? 0xe6c56a : lit ? 0xe6c56a : 0x3d4a58)
    }
    if (this.occupantsRow !== null) {
      this.occupantsRow.removeAll(true)
      const count = input.occupants.length
      input.occupants.forEach((occupant, idx) => {
        // Center the row on the carpet; 90px berths keep four riders legible.
        const x = (idx - (count - 1) / 2) * 90
        const headColor = occupantColor(occupant.name)
        const head = this.scene.add.circle(x, -26, 13, headColor)
        const body = this.scene.add.rectangle(x, 2, 26, 20, 0x2a3a4a)
        const label = this.scene.add.text(x, 24, occupant.name.slice(0, 5 + 1), {
          fontSize: '9px',
          color: occupant.you ? '#ffd98a' : '#dfe8f2',
          fontFamily: 'monospace',
        })
        label.setOrigin(0.5)
        if (occupant.you) {
          head.setStrokeStyle(2, 0xe6c56a)
          body.setStrokeStyle(2, 0xe6c56a)
        }
        this.occupantsRow?.add([head, body, label])
      })
    }
  }

  private build(): void {
    const scene = this.scene
    const container = scene.add.container(480, 288)
    container.setScrollFactor(0)
    container.setDepth(50)
    container.setVisible(false)
    container.setName('elevatorCanvas')
    // Backdrop: oversized so the ride sway never shows an edge.
    container.add(scene.add.rectangle(0, 0, 984, 600, 0x221c12))
    // Walls: dim cream upper, dim tan wainscot, gold trim line, panel seams.
    container.add(scene.add.rectangle(0, -160, 960, 288, 0x6e6450))
    container.add(scene.add.rectangle(0, 140, 960, 328, 0x574a36))
    container.add(scene.add.rectangle(0, -16, 960, 5, 0x8a6a2e))
    for (let x = -360; x <= 360; x += 120) {
      container.add(scene.add.rectangle(x, -30, 3, 576, 0x4f4634))
    }
    // Brass handrail across the back wall.
    container.add(scene.add.rectangle(0, -34, 752, 10, 0x8a6a2e))
    container.add(scene.add.rectangle(-368, -34, 12, 24, 0x55492c))
    container.add(scene.add.rectangle(368, -34, 12, 24, 0x55492c))
    // Carpet: crimson field with a gold edge strip (the passengers' floor).
    container.add(scene.add.rectangle(0, 216, 960, 152, 0x5e2626))
    container.add(scene.add.rectangle(0, 142, 960, 4, 0x8a6a2e))
    // The hallway beyond the doors: a lit glow the burst drives.
    const beyond = scene.add.rectangle(0, -36, 250, 262, 0xf0d9a8, 0.32)
    container.add(beyond)
    const beyondFloor = scene.add.rectangle(0, 84, 250, 5, 0x8a6a2e)
    container.add(beyondFloor)
    // Doors: brushed-steel leaves with brass jambs, center-seamed.
    const jambL = scene.add.rectangle(-141, -36, 12, 262, 0x8a6a2e)
    const jambR = scene.add.rectangle(141, -36, 12, 262, 0x8a6a2e)
    const left = scene.add.rectangle(-70, -36, 128, 258, 0x4a5568)
    const right = scene.add.rectangle(70, -36, 128, 258, 0x4a5568)
    const seamL = scene.add.rectangle(-3, -36, 3, 258, 0x2a3542)
    const seamR = scene.add.rectangle(3, -36, 3, 258, 0x2a3542)
    container.add([beyond, jambL, jambR, left, right, seamL, seamR])
    this.doors = { left, right }
    // Floor dial above the doors: brass plate, the ticking glyph, arrow.
    const dialPlate = scene.add.rectangle(0, -214, 190, 62, 0x241d12)
    dialPlate.setStrokeStyle(2, 0x8a6a2e)
    container.add(dialPlate)
    const floor = scene.add.text(-20, -214, '', {
      fontSize: '40px',
      color: '#ffd98a',
      fontFamily: 'monospace',
    })
    floor.setOrigin(0.5)
    floor.setName('floor')
    container.add(floor)
    this.floorLabel = floor
    const dirArrow = scene.add.text(52, -214, '', {
      fontSize: '22px',
      color: '#e6c56a',
      fontFamily: 'monospace',
    })
    dirArrow.setOrigin(0.5)
    dirArrow.setName('dirArrow')
    container.add(dirArrow)
    // Car tag + state line.
    const carLabel = scene.add.text(-430, -262, '', {
      fontSize: '10px',
      color: '#8899aa',
      fontFamily: 'monospace',
    })
    carLabel.setName('carLabel')
    container.add(carLabel)
    const state = scene.add.text(0, -172, '', {
      fontSize: '11px',
      color: '#8ad07a',
      fontFamily: 'monospace',
    })
    state.setOrigin(0.5)
    state.setName('state')
    container.add(state)
    this.stateLabel = state
    // Button pillar (right wall): five round brass buttons, pressable.
    const pillar = scene.add.rectangle(332, -36, 84, 262, 0x5a4c38)
    pillar.setStrokeStyle(2, 0x8a6a2e)
    container.add(pillar)
    const floors: FloorId[] = ['floor3', 'floor2', 'floor1', 'mezzanine', 'lobby']
    const labels = ['3', '2', '1', 'M', 'L']
    floors.forEach((floorId, i) => {
      const y = -124 + i * 58
      const btn = scene.add.circle(332, y, 17, 0x1a2530)
      btn.setStrokeStyle(1, 0x3d4a58)
      btn.setInteractive({ useHandCursor: true })
      btn.on('pointerdown', () => this.onPressFloor(floorId))
      const label = scene.add.text(332, y, labels[i] ?? '', {
        fontSize: '13px',
        color: '#9fb0c0',
        fontFamily: 'monospace',
      })
      label.setOrigin(0.5)
      container.add([btn, label])
      this.buttons.set(floorId, btn)
    })
    // The passengers: center stage on the carpet (rebuilt each sync).
    const occ = scene.add.container(0, 196)
    container.add(occ)
    this.occupantsRow = occ
    this.canvas = container
    this.beyond = beyond
    this.burstT0 = -1
  }
}

/** Stable per-name occupant hue: a hash → HSL pick, not a seed stream. */
function occupantColor(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const hue = hash % 360
  const c = Phaser.Display.Color.HSLToColor(hue / 360, 0.58, 0.5)
  return (c.red << 16) | (c.green << 8) | c.blue
}
