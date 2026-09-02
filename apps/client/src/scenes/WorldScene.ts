import {
  accuseTargetAtHoldExpiry,
  atStairwellMouth,
  carriedGuestIdOf,
  type FloorId,
  type GuestFloorId,
  inDeskZone,
  type MovementSnapshot,
  onLanding,
  ROOMS_PER_FLOOR,
  type RoomIndex,
  type RoomState,
  resolveEKeydown,
  resolveEKeyup,
  roomDoorXMilli,
  roomIndexAtMilli,
  roomSegmentEndMilli,
  roomSegmentStartMilli,
  type SpectatorSnapshot,
  type SuitcaseRef,
  stairsDirections,
  TUNING,
} from '@turnover/shared'
import Phaser from 'phaser'
import type { AccuseSession } from '../accuseSession'
import { ACCUSE_HOLD_MS } from '../accuseSession'
import {
  dropCues,
  type EvidenceSession,
  initialEvidenceSession,
  liveCues,
  reduceEvidence,
} from '../evidenceSession'
import type { RiderUpdate } from '../riderSession'
import type { SceneAction } from '../state'
import { setCarScreenDoors, setCarScreenFloor, setCarScreenState } from '../ui/carScreen'
import { ComplaintHud } from '../ui/complaintHud'
import { ScoreHud } from '../ui/scoreHud'
import { type StairAnchor, stairPhaseReadout, syncStairScreen } from '../ui/stairScreen'
import { DEFAULT_ANIMATION_CONFIG, doorsOpenAmount, ElevatorPresenter } from './elevatorPresenter'

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

const TILE_PX = 32 // hall width in px per tile (960 / 30, integer grid — AD-030)
const GROUND_Y = 430
const SPEED_TILES_PER_SEC = TUNING.PLAYER_SPEED_TILES_PER_SEC
/** Guest marker fills (3.C dining cue): ice-blue in the lobby/queue, amber
 *  while dining on the mezzanine. */
const GUEST_FILL = 0xbfe3ff
const DINING_FILL = 0xffd27a

/**
 * Spectator lanes (cycle 2.9, FR-20): the full-building overview stacks all
 * five floors vertically — the 3.C mezzanine sits directly above the lobby.
 * Live players render the single own-floor lane at GROUND_Y exactly as
 * before — the spectator privilege never widens their view.
 */
const SPECTATOR_LANE_Y: Partial<Record<FloorId, number>> = {
  floor3: 80,
  floor2: 180,
  floor1: 280,
  mezzanine: 380,
  lobby: 480,
}

/** In-car press keymap (ELR-06): browser event.code → floor pressed. */
const IN_CAR_FLOOR_BY_CODE: Record<string, FloorId> = {
  Digit1: 'floor1',
  Digit2: 'floor2',
  Digit3: 'floor3',
  KeyM: 'mezzanine',
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
  /** Stairwell entry (cycle 3.E, AD-040): ArrowUp/Down at the west mouth. */
  sendStairsEnter: (dir: 'up' | 'down') => void
  sendWorkStart: (floor: GuestFloorId, room: RoomIndex) => void
  /** Desk E (cycle 3.B): check the front queued guest in — the caller takes
   *  the suitcase. Derived server-side; rejections are silent. */
  sendDeskInteract: () => void
  /** Suitcase intents (cycle 3.B, AD-032): place at a room door / pick up. */
  sendSuitcasePlace: (room: RoomIndex) => void
  sendSuitcasePickup: () => void
  /** Hold-E expiry (JUST-16): opens the confirm menu for the nearest candidate. */
  openAccuseMenu: (targetId: string) => void
  /** The App-reduced rider session at mount time (usually null on fresh join). */
  riderSession: RiderUpdate
}

interface PlayerDisplay {
  sprite: Phaser.GameObjects.Sprite
  label: Phaser.GameObjects.Text
  x: number
  floor: string
  targetX: number | null
  /** True once the player departed our floor by elevator (AD-009). */
  left: boolean
  /** Profile facing: the sheet faces right; left renders flipX (ART-02). */
  facing: 'left' | 'right'
}

export class WorldScene extends Phaser.Scene {
  private ownId = ''
  private sendMoveStart: (dir: 'left' | 'right') => void = () => {}
  private sendMoveStop: () => void = () => {}
  private sendElevatorCall: () => void = () => {}
  private sendElevatorPress: (floor: FloorId) => void = () => {}
  private sendStairsEnter: (dir: 'up' | 'down') => void = () => {}
  private sendWorkStart: (floor: GuestFloorId, room: RoomIndex) => void = () => {}
  private sendDeskInteract: () => void = () => {}
  private sendSuitcasePlace: (room: RoomIndex) => void = () => {}
  private sendSuitcasePickup: () => void = () => {}
  private openAccuseMenu: (targetId: string) => void = () => {}
  private players = new Map<string, PlayerDisplay>()
  /** Guest NPC positions (cycle 3.1 plumbing) — rendered by the guest slice. */
  private guests = new Map<string, { floor: FloorId; x: number }>()
  /** Guests whose free impatience cue is active (foot-tap + bell, GUEST-13). */
  private impatientGuests = new Set<string>()
  // --- Front desk (cycle 3.B): the E-zone hint; the two-step send menu is
  // gone with the walkie-broadcast model (the suitcase replaces it).
  private deskHint: HTMLElement | null = null
  private walkieLog: HTMLElement | null = null
  /** The settle-score HUD (cycle 3.D, AD-039): a pure presenter over the
   *  public guest:settled stream; DOM lives with the other HUD layers. */
  private scoreHud: ScoreHud = new ScoreHud(0)
  private scoreHudEl: HTMLElement | null = null
  /** The complaint-budget HUD (cycle 3.3, FR-31/FR-14): the budget counter
   *  over the public guest:discovered stream; pulses when nearing the budget. */
  private complaintHud: ComplaintHud = new ComplaintHud(TUNING.COMPLAINT_BUDGET)
  private complaintHudEl: HTMLElement | null = null
  /** In-world anger cues (cycle 3.3, FR-29b stage 1): short-lived Text "!" at
   *  the room door — sameFloor only — TTL-bound and pruned per frame. */
  private angerCues: { view: Phaser.GameObjects.Text; until: number; floor: FloorId }[] = []
  /** Suitcase markers (cycle 3.B, SUI-24): one Rectangle per suitcase —
   *  carried rides the carrier, rest pins the doorway (never a Sprite —
   *  scene-children contract). */
  private suitcaseViews = new Map<string, Phaser.GameObjects.Rectangle>()
  /** The blind-place confirm is REMOVED (AD-034) — kept only the
   *  owned-assignment hint (SUI-27, convenience surface). */
  private assignmentHint: HTMLElement | null = null
  private cars = new Map<1 | 2, { view: Phaser.GameObjects.Sprite }>()
  /** Owns door/motion visuals, hall-call lights, the landing-panel flash, and
   *  the in-car screen readout (ELAN + AD-038): the single clock authority for
   *  elevator presentation — built in `create()` once cars exist. */
  private elevatorPresenter: ElevatorPresenter | null = null
  private ownMoving: 'left' | 'right' | null = null
  private viewFloor = 'lobby'
  /** The actor's own running channel: DOM progress bar state (never a kind). */
  private work: { startedAt: number; seconds: number } | null = null
  /** The interior last observed for the own segment (FR-10 read half). */
  private interior: { floor: string; room: number; state: RoomState } | null = null
  /** Evidence view state + its DOM layer (cycle 2.7, EVID-19). */
  private evidence: EvidenceSession = initialEvidenceSession()
  private evidenceLayer: HTMLElement | null = null
  /** The west stairwell marker (cycle 3.E, AD-040, STAIRS-17): one DOM glyph
   *  following the viewed floor's lane — the camera-free west end's signpost. */
  private stairMarker: HTMLElement | null = null
  /** The ambush toast (STAIRS-19): "you were ambushed" + a local stun
   *  countdown; the saboteur instead gets a private confirmation line. */
  private ambushToast: { el: HTMLElement; until: number } | null = null
  private ambushConfirm: { el: HTMLElement; until: number } | null = null
  /** The transit remainder captured at the ambush — the resume clock after
   *  the local stun expiry (the interior publishes no resume event). */
  private stunResumeMs = 0
  /** Guest NPC markers (cycle 3.1): one Arc per guest — deliberately NOT a
   *  player Sprite (GUEST-12). Created lazily, pruned on guest:left. */
  private guestViews = new Map<string, Phaser.GameObjects.Arc>()
  /** The desk-bell DOM line (GUEST-13) — visible while an impatient guest
   *  queues on the viewed floor. */
  private deskBell: HTMLElement | null = null
  /** Assignments announced building-wide (cycle 3.B, SUI-27; amended
   *  AD-034): every client receives `guest:assigned` — the announce line
   *  renders for all, and this map feeds the owned-marker hint
   *  (convenience surface only). Never redistributed. */
  private heardAssignments = new Map<string, { floor: FloorId; room: RoomIndex }>()
  /** Suitcase state per checked-in guest (cycle 3.B, SUI-24): carried rides
   *  the carrier's position stream; rest pins the doorway marker. */
  private suitcases = new Map<
    string,
    { carrierId: string | null; rest: { floor: FloorId; room: RoomIndex } | null }
  >()
  private tapPhase = 0
  private cardMarkers = new Map<string, HTMLElement>()
  private cueNodes = new Map<number, HTMLElement>()
  private audio: AudioContext | null = null
  /** Production door Images per room segment per guest floor (ART-06) —
   *  phase-free; the name `door:<floor>:<room>` drives harness filtering. */
  private doorImages = new Map<string, Phaser.GameObjects.Image>()
  /** The own observed room's interior (ART-08): one slot — a live viewer can
   *  stand in at most one segment, so structurally ≤1 interior exists (ART-14). */
  private interiorImage: Phaser.GameObjects.Image | null = null
  /** Spectator overview interiors (ART-12): one per baseline-known room. */
  private spectatorInteriors = new Map<string, Phaser.GameObjects.Image>()
  /** The App-owned rider session (riderSession.ts): keymap gate + rider
   * visibility. The scene derives nothing — it only consumes. */
  private riderSession: RiderUpdate = null
  /** The App-owned accusation session (accuseSession.ts): the self-fired flag
   * gates every live-play intent — a fired player watches quietly (JUST-04). */
  private selfFired = false
  /** The fired player's full-world baseline (FR-20, cycle 2.9). Public: the
   * spectator overview (and the harness) read it; live clients never receive
   * the message at all ('self' to the fired session). */
  spectatorSnapshot: SpectatorSnapshot | null = null
  /** FR-20 spectator mode: the whole building renders as stacked lanes. */
  private spectator = false
  /** Current room states known to this client — own interior via room:observed,
   * the whole building via the spectator baseline (door tints). */
  private roomStates = new Map<string, RoomState>()
  /** Landing panel sprites (ART-17): west/east landings of the viewed floor;
   * frame 0 idle, frame 1 during a call's flash window (decoys included). */
  private panelImages = new Map<'west' | 'east', Phaser.GameObjects.Image>()
  private hallLines: Phaser.GameObjects.Graphics | null = null
  /** Corridor band backdrop (AD-020 art slice): live lane only, never a
   *  Rectangle — the harness counts Rectangle/Ellipse per player/car. */
  private corridorBand: Phaser.GameObjects.TileSprite | null = null
  /** Cream wall fill above the band (same Graphics constraint as hallLines). */
  private wallFill: Phaser.GameObjects.Graphics | null = null
  /** Roster names for the reconnection re-add (unknown-id player:moved). */
  private rosterNames = new Map<string, string>()
  /** The own stairs clock (AD-040 client presentation): anchored by every
   *  personal snapshot's `stairs` row, stunned by the private ambush event,
   *  cleared when the own floor stream resumes. */
  private stairsAnchor: StairAnchor | null = null

  constructor() {
    super('Round')
  }

  create(data: WorldStartData): void {
    this.ownId = data.ownId
    this.sendMoveStart = data.sendMoveStart
    this.sendMoveStop = data.sendMoveStop
    this.sendElevatorCall = data.sendElevatorCall
    this.sendElevatorPress = data.sendElevatorPress
    this.sendStairsEnter = data.sendStairsEnter
    this.sendWorkStart = data.sendWorkStart
    this.sendDeskInteract = data.sendDeskInteract
    this.sendSuitcasePlace = data.sendSuitcasePlace
    this.sendSuitcasePickup = data.sendSuitcasePickup
    this.openAccuseMenu = data.openAccuseMenu
    this.players.clear()
    this.cars.clear()
    this.ownMoving = null
    this.viewFloor = 'lobby'
    this.work = null
    this.interior = null
    this.stairsAnchor = null
    this.evidence = initialEvidenceSession()
    this.cardMarkers.clear()
    this.cueNodes.clear()
    this.doorImages.clear()
    this.riderSession = data.riderSession
    this.buildEvidenceLayer()
    this.buildGuestLayer()
    this.buildDeskLayer()
    this.buildDoorImages()

    // Hall lines (Graphics — deliberately not a Rectangle/Text: harness
    // contract). One lane live; one per floor for the spectator overview.
    this.drawHallLines()

    // Corridor band backdrop (AD-020): one tileable strip behind the live
    // lane (wainscot + carpet, y350..495). Live view only — the spectator
    // overview's stacked lanes keep their plain backdrop. Additive visual:
    // no Rectangle/Ellipse/Text is created or removed (LIGHT-09 contract).
    if (this.textures.exists('corridor-band')) {
      this.corridorBand = this.add.tileSprite(0, 350, 960, 146, 'corridor-band')
      this.corridorBand.setOrigin(0, 0)
      this.corridorBand.setDepth(-2)
      this.corridorBand.setVisible(!this.spectator)
    }
    if (this.textures.exists('staff-walk') && !this.anims.exists('staff-walk')) {
      this.anims.create({
        key: 'staff-walk',
        frames: this.anims.generateFrameNumbers('staff-walk', { start: 0, end: 7 }),
        frameRate: 12,
        repeat: -1,
      })
    }
    if (this.textures.exists('fx-rustle') && !this.anims.exists('fx-rustle')) {
      this.anims.create({
        key: 'fx-rustle',
        frames: this.anims.generateFrameNumbers('fx-rustle', { start: 0, end: 3 }),
        frameRate: 12,
        hideOnComplete: true,
      })
    }

    for (const player of data.players) {
      this.rosterNames.set(player.id, player.name)
      this.addPlayerDisplay(player.id, player.name)
    }

    // One elevator-car Sprite for the single car (cycle 3.E, AD-040) at its
    // EAST landing x (ART-15: frame 0 = doors-open cage, frame 1 = closed
    // slab; never an occupant list — privacy rule). The presenter drives
    // frame/visibility from its clock.
    for (const id of [1] as const) {
      const sprite = this.add.sprite(this.carPx(id), GROUND_Y, 'elevator-car')
      sprite.setOrigin(0.5, 1)
      this.cars.set(id, { view: sprite })
    }
    // Landing panel sprite (ART-17): position-only — a call flashes it
    // (decoys included); occupants are never rendered (privacy rule). The
    // single car's panel rides the east landing; the west end is the
    // stairwell.
    if (this.textures.exists('elevator-panel')) {
      const image = this.add.sprite(960 - 16, GROUND_Y - 80, 'elevator-panel')
      image.setFrame(0)
      image.setName('panel:east')
      image.setVisible(!this.spectator)
      this.panelImages.set('east', image)
    }
    // Fresh presenter per scene restart (its constructor resets both clocks).
    this.elevatorPresenter = new ElevatorPresenter(this.cars, (car) => this.carLaneY(car))

    const keyboard = this.input.keyboard
    if (keyboard !== null) {
      keyboard.on('keydown-LEFT', () => this.beginMove('left'))
      keyboard.on('keydown-RIGHT', () => this.beginMove('right'))
      keyboard.on('keyup-LEFT', () => this.endMove('left'))
      keyboard.on('keyup-RIGHT', () => this.endMove('right'))
      // Elevator calls / stairwell entry (AD-040): up/down summons a car to
      // this floor — destination-free (AD-014) — unless the player stands at
      // the stairwell mouth, where the direction enters the stairs.
      // E is the accusation key (FR-17): a tap calls, a hold opens the menu.
      keyboard.on('keydown-UP', () => this.callElevatorOrStairs('up'))
      keyboard.on('keydown-DOWN', () => this.callElevatorOrStairs('down'))
      keyboard.on('keydown-E', (event: KeyboardEvent) => {
        // Key auto-repeat must not re-trigger: the desk branch would toggle
        // receive/release every repeat (a held E would thrash the queue).
        if (event.repeat) return
        this.beginAccuseHold()
      })
      keyboard.on('keyup-E', () => this.endAccuseHold())
      // In-car floor presses (ELR-06): 1/2/3 press floor1..floor3, M presses
      // the mezzanine, 0 presses lobby — active only while the local player
      // rides a car.
      keyboard.on('keydown', (event: KeyboardEvent) => {
        const floor = IN_CAR_FLOOR_BY_CODE[event.code]
        if (floor !== undefined) this.pressFloor(floor)
      })
      // Work: Space starts a channel inside the room segment the own
      // rectangle stands in; the server validates role and room state (FR-7).
      keyboard.on('keydown-SPACE', () => this.startWorkHere())
    }
  }

  /** Send work:start when the own predicted position is inside a segment. */
  private startWorkHere(): void {
    if (this.selfFired) return
    const own = this.players.get(this.ownId)
    if (own === undefined) return
    const floor = own.floor as FloorId
    if (floor === 'lobby') return
    const room = roomIndexAtMilli(Math.round(own.x * 1000))
    if (room === 0) return
    this.sendWorkStart(floor as GuestFloorId, room as RoomIndex)
  }

  /** The App pushes the reduced rider session whenever it changes. */
  setRiderSession(session: RiderUpdate): void {
    this.riderSession = session
  }

  /** The self-fired flag arrives with every accusation-session change; its
   * flip toggles the FR-20 spectator overview (all-floor lanes). */
  setAccuseSession(session: AccuseSession): void {
    const wasSpectator = this.spectator
    this.selfFired = session.selfFired
    this.spectator = session.selfFired
    if (wasSpectator !== this.spectator) this.applyViewMode()
  }

  /** Lane y for a floor: the own-floor lane in live play, stacked lanes as a spectator. */
  private laneY(floor: string): number {
    if (!this.spectator) return GROUND_Y
    return SPECTATOR_LANE_Y[floor as FloorId] ?? GROUND_Y
  }

  /** y of a car's feet line on its floor's lane (the presenter draws the
   *  car body above it; the arrival slide still dips 30 px via carY). The
   *  car floor lives in the presenter's clocks (AD-038) — one home. */
  private carLaneY(car: 1 | 2): number {
    return this.laneY(this.elevatorPresenter?.floorOf(car) ?? 'lobby')
  }

  /** Switch between the live single-floor view and the spectator overview. */
  private applyViewMode(): void {
    this.drawHallLines()
    this.corridorBand?.setVisible(!this.spectator)
    this.syncDoors()
    if (this.spectator) this.seedFromSpectatorSnapshot()
  }

  /** Redraw the hall line(s): one lane live, one per floor as a spectator. */
  private drawHallLines(): void {
    if (this.hallLines === null) {
      this.hallLines = this.add.graphics()
      this.hallLines.lineStyle(2, 0xb3873a, 1)
    }
    this.hallLines.clear()
    this.hallLines.lineStyle(2, 0xb3873a, 1)
    if (this.wallFill === null) {
      this.wallFill = this.add.graphics()
      this.wallFill.setDepth(-3)
    }
    this.wallFill.clear()
    if (!this.spectator) {
      // Slate wall above the corridor band (Deco Noir brief, AD-029: y48..350,
      // flat quiet field so the door rhythm reads). Graphics, not a Rectangle.
      this.wallFill.fillStyle(0x33505a, 1)
      this.wallFill.fillRect(0, 48, 960, 302)
      this.hallLines.lineBetween(0, GROUND_Y + 66, 960, GROUND_Y + 66)
      return
    }
    for (const floor of ['lobby', 'mezzanine', 'floor1', 'floor2', 'floor3'] as const) {
      const y = SPECTATOR_LANE_Y[floor] ?? GROUND_Y
      this.hallLines.lineBetween(0, y + 66, 960, y + 66)
    }
  }

  /** Seed the full-world view from the FR-20 baseline (fired client only). */
  private seedFromSpectatorSnapshot(): void {
    const snapshot = this.spectatorSnapshot
    if (snapshot === null) return
    for (const p of snapshot.players) {
      const display = this.players.get(p.playerId)
      if (display === undefined) continue
      display.x = p.x
      display.floor = p.floor
      display.targetX = null
      display.left = false
    }
    for (const c of snapshot.cars) {
      this.elevatorPresenter?.onMoved(c.car, c.floor)
    }
    this.roomStates.clear()
    for (const room of snapshot.rooms) {
      this.roomStates.set(`${room.floor}:${room.room}`, room.state)
    }
    // All carded rooms of every floor become card markers (FR-20: door cards
    // are floor-public, and the spectator sees every floor).
    let cards = this.evidence
    for (const floorRow of snapshot.cardedRooms) {
      for (const room of floorRow.rooms) {
        cards = reduceEvidence(cards, { type: 'carded', floor: floorRow.floor, room }, Date.now())
      }
    }
    this.evidence = cards
    this.syncCardMarkers()
    this.updatePanel()
  }

  /**
   * Scene-kind ViewActions routed here by the App (render state). The
   * parameter is `SceneAction` — derived from ACTION_ROUTES, so a new
   * registry message routed 'scene' must be handled here or compilation
   * fails (the drift guard the hand-mirrored union used to evade).
   */
  applyAction(action: SceneAction): void {
    switch (action.type) {
      case 'guest-moved': {
        // T4 plumbing: the authoritative guest position lands here; the
        // client guest slice (T8) renders markers/queue from this map.
        this.guests.set(action.guestId, { floor: action.floor, x: action.x })
        break
      }
      case 'guest-arrived': {
        this.guests.set(action.guestId, { floor: 'lobby', x: 15 })
        // SUI-21: arrival is a lifecycle fact — the walkie reads it out.
        this.appendWalkieLine('a guest arrives at the front desk')
        break
      }
      case 'guest-impatient': {
        // The tap/bell window runs from the impatience cue until the guest
        // SETTLES — in 3.1 self-assignment is instant, so clearing at
        // self_assigned would make the cue invisible.
        this.impatientGuests.add(action.guestId)
        break
      }
      case 'guest-self-assigned':
        // The tap window deliberately persists past self-assignment (3.1
        // self-assign is instant — clearing here would hide the cue).
        break
      case 'guest-settled': {
        this.impatientGuests.delete(action.guestId)
        // SUI-21: settle is a lifecycle fact — the room becomes public here.
        this.appendWalkieLine(`a guest settles into ${action.floor}:${action.room}`)
        // The settle score ticks on the same public fact (cycle 3.D).
        this.scoreHud.onSettled()
        this.renderScoreHud()
        break
      }
      case 'guest-checked-out': {
        this.impatientGuests.delete(action.guestId)
        this.appendWalkieLine(`a guest checks out of ${action.floor}:${action.room}`)
        break
      }
      case 'guest-left': {
        this.guests.delete(action.guestId)
        this.impatientGuests.delete(action.guestId)
        break
      }
      case 'player-moved': {
        let display = this.players.get(action.playerId)
        if (display === undefined) {
          // Reconnection re-announce (FR-25): one player:moved re-creates the
          // display the player:left removed. Name from the roster, raw id
          // fallback (LIGHT-12); the roster sync corrects it if needed.
          this.addPlayerDisplay(
            action.playerId,
            this.rosterNames.get(action.playerId) ?? action.playerId,
          )
          display = this.players.get(action.playerId)
          if (display === undefined) return
        }
        display.floor = action.floor
        display.x = action.x
        display.left = false
        display.facing = action.facing
        if (action.playerId === this.ownId) {
          display.targetX = null
          this.viewFloor = action.floor
          // The stairs mirror (AD-040) owns the visit-end transition — the
          // arrival moved event (delivered even while floorless in the
          // breath) reconciles the display position; the anchor stays until
          // the local breath clock runs out.
        } else {
          display.targetX = action.x
        }
        break
      }
      case 'elevator-moved': {
        this.elevatorPresenter?.onMoved(action.car, action.floor)
        this.updatePanel()
        break
      }
      case 'elevator-doors': {
        // Public door state (AD-026/027): the presenter drives the open/close
        // swing from it; the panel's floor readout follows the event too.
        this.elevatorPresenter?.onDoors(action.car, action.floor, action.open)
        this.updatePanel()
        break
      }
      case 'elevator-called': {
        // Hall-call light (AD-024) and the ART-17 landing-panel flash both
        // live in the presenter (AD-038) — a decoy call naming a car parked
        // at the called floor lights nothing, the flash registers every call.
        this.elevatorPresenter?.onCalled(action.car, action.floor)
        this.updatePanel()
        break
      }
      case 'player-left': {
        const display = this.players.get(action.playerId)
        if (display !== undefined) {
          display.sprite.destroy()
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
      case 'room-trashed':
      case 'room-settled': {
        // The state map feeds the door tints (whole building for a spectator,
        // FR-20 baseline + over-delivered transitions).
        this.roomStates.set(
          `${action.floor}:${action.room}`,
          action.type === 'room-prepped'
            ? 'prepped'
            : action.type === 'room-trashed'
              ? 'trashed'
              : 'settled',
        )
        // Live play: only the room we are inside exists in our view (FR-10); a
        // matching transition updates it, everything else is not for us.
        const interior = this.interior
        if (interior === undefined || interior === null) break
        if (interior.floor !== action.floor || interior.room !== action.room) break
        interior.state =
          action.type === 'room-prepped'
            ? 'prepped'
            : action.type === 'room-trashed'
              ? 'trashed'
              : 'settled'
        break
      }
      // Evidence cues (cycle 2.7, EVID-19): hallway-visible gray-box rendering
      // — cards accumulate, door-open and rustle cues flash at the room front.
      case 'room-carded':
        this.evidence = reduceEvidence(
          this.evidence,
          { type: 'carded', floor: action.floor, room: action.room },
          Date.now(),
        )
        this.syncCardMarkers()
        break
      case 'room-entered':
        this.evidence = reduceEvidence(
          this.evidence,
          {
            type: 'entered',
            playerId: action.playerId,
            floor: action.floor,
            room: action.room,
          },
          Date.now(),
        )
        this.beep(660)
        break
      case 'room-rustle':
        this.evidence = reduceEvidence(
          this.evidence,
          { type: 'rustle', floor: action.floor, room: action.room },
          Date.now(),
        )
        this.beep(180)
        this.playRustleFx(action.floor, action.room)
        break
      case 'player-fired': {
        // JUST-04: the fired player's rectangle disappears everywhere — the
        // fired event itself is the removal signal (no player:left exists for
        // a firing; the session stays connected as a spectator, 2.9 scope).
        this.removePlayerDisplay(action.playerId)
        // Cycle 3.B: the desk absorbed their suitcase (no dedicated event —
        // the firing IS the signal).
        for (const [id, sc] of this.suitcases) {
          if (sc.carrierId === action.playerId) this.suitcases.delete(id)
        }
        break
      }
      case 'guest-assigned': {
        // SUI-03/04 (amended AD-034): the assignment is a building-wide
        // notice — every client hears it. Render the announce walkie line
        // and store it for the owned-marker hint.
        this.heardAssignments.set(action.guestId, { floor: action.floor, room: action.room })
        this.appendWalkieLine(`a guest announces: I'm in ${action.floor}:${action.room}`)
        break
      }
      case 'suitcase-carried': {
        // SUI-24: carried — the marker rides the carrier's position stream.
        this.suitcases.set(action.guestId, { carrierId: action.carrierId, rest: null })
        // SUI-21: check-in handoff is a lifecycle fact (no room named).
        const taker = this.rosterNames.get(action.carrierId) ?? action.carrierId
        this.appendWalkieLine(`«${taker}» takes a guest's suitcase`)
        break
      }
      case 'suitcase-placed':
        // SUI-24: resting — pinned at the doorway until a pickup.
        // SUI-21/22: PLACEMENT IS SILENT — deliberately no walkie line; the
        // resting room is learnable only on this floor (or later via the
        // settle/complaint lines).
        this.suitcases.set(action.guestId, {
          carrierId: null,
          rest: { floor: action.floor, room: action.room },
        })
        break
      case 'suitcase-picked-up': {
        // SUI-24: fresh carry leg under the new carrier.
        this.suitcases.set(action.guestId, { carrierId: action.carrierId, rest: null })
        const picker = this.rosterNames.get(action.carrierId) ?? action.carrierId
        this.appendWalkieLine(`«${picker}» picks up a suitcase`)
        break
      }
      case 'guest-complained':
        // SUI-14: wrong-delivery door complaint — a lifecycle fact building-
        // wide. It names the room + guest, never the assignment. The budget
        // counter lands in cycle 3.3.
        this.appendWalkieLine(
          `the guest of ${action.floor}:${action.room} complained about the suitcase`,
        )
        this.beep(140)
        break
      case 'spectator-snapshot': {
        // FR-20 baseline: kept for the spectator overview (own client only —
        // the server routes it 'self' to the fired session).
        this.spectatorSnapshot = action.snapshot
        if (this.spectator) this.seedFromSpectatorSnapshot()
        break
      }
      case 'stairs-ambushed':
        // Cycle 3.E (AD-040): the private ambush lands ONLY on the victim —
        // capture the live transit remainder (the resume clock), override
        // the own stairs clock with the stun phase, and raise the toast with
        // a local stun countdown (STAIRS-19).
        if (this.stairsAnchor !== null) {
          this.stunResumeMs = stairPhaseReadout(this.stairsAnchor, Date.now())?.remainingMs ?? 0
          this.stairsAnchor = {
            ...this.stairsAnchor,
            phase: 'stunned',
            remainingMs: action.stunSeconds * 1000,
            anchoredAtMs: Date.now(),
          }
        }
        this.showAmbushToast(action.stunSeconds)
        break
      case 'stairs-ambush':
        // The saboteur's own confirmation — a private line naming the victim
        // (legitimate self-knowledge; never broadcast). No stairs clock of
        // their own: they are mid-transit, anchored by their snapshot.
        this.showAmbushConfirm(action.victimId)
        break
      case 'guest-angered': {
        // FR-29(b) stage 1: in-world anger cue at the room — room-number
        // level, no detail — the guest storms out. SameFloor delivery is the
        // transport gate; the client just renders the short-lived cue here.
        const x = (roomDoorXMilli(action.room) / 1000) * TILE_PX
        const y = this.laneY(action.floor) - 40
        const cue = this.add.text(x, y, '!', {
          fontSize: '28px',
          color: '#ff3b30',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 3,
        })
        cue.setOrigin(0.5, 0.5)
        cue.setDepth(100)
        cue.setVisible(this.spectator || action.floor === this.viewFloor)
        this.angerCues.push({ view: cue, until: Date.now() + 2500, floor: action.floor })
        this.beep(320)
        break
      }
      case 'guest-discovered': {
        // FR-29(b) stage 2: the desk report — the walkie line with the
        // fuzzy-timestamp flavor — and the budget counter tick. Wrong-delivery
        // complaints (guest:complained above) never touch the counter.
        const when = action.fresh ? 'maybe a minute ago' : 'a while ago now'
        this.appendWalkieLine(
          `a guest reports: someone hit ${action.floor}:${action.room} — ${when}`,
        )
        this.complaintHud.onDiscovered()
        this.renderComplaintHud()
        this.beep(220)
        break
      }
      default: {
        // Exhaustiveness: SceneAction covers every 'scene'-routed member of
        // ACTION_ROUTES; an unhandled one must fail the build, not slip.
        const _exhaustive: never = action
        break
      }
    }
  }

  /** Destroy one player's rectangle + label (justice removal + churn reuse). */
  private removePlayerDisplay(playerId: string): void {
    const display = this.players.get(playerId)
    if (display === undefined) return
    display.sprite.destroy()
    display.label.destroy()
    this.players.delete(playerId)
  }

  /**
   * Dust-puff FX at a rustling room's door front (AD-020 art slice, FR-13's
   * visual half). Sprite-based: adds no Rectangle/Ellipse/Text (harness
   * contract), no payload carries a role (FR-9 — the cue is location-only).
   */
  private playRustleFx(floor: string, room: RoomIndex): void {
    if (!this.textures.exists('fx-rustle') || !this.anims.exists('fx-rustle')) return
    const startPx = (roomSegmentStartMilli(room) / 1000) * TILE_PX
    const endPx = (roomSegmentEndMilli(room) / 1000) * TILE_PX
    const sprite = this.add.sprite((startPx + endPx) / 2, this.laneY(floor), 'fx-rustle')
    sprite.setOrigin(0.5, 1)
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy())
    sprite.play('fx-rustle')
  }

  /** Track roster growth/shrink from lobby snapshots (players join over time). */
  syncRoster(players: readonly WorldPlayerEntry[]): void {
    const known = new Set(players.map((p) => p.id))
    for (const [id, display] of this.players) {
      if (known.has(id)) continue
      display.sprite.destroy()
      display.label.destroy()
      this.players.delete(id)
    }
    for (const player of players) {
      this.rosterNames.set(player.id, player.name)
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
      this.elevatorPresenter?.onMoved(c.car, c.floor)
    }
    // SUI-24 late joiners: resting suitcases ride the snapshot (sameFloor-
    // filtered by the room) — carried ones are derived from the carrier's
    // position stream. A row IS the rest truth for that guest.
    for (const sc of snapshot.suitcases ?? []) {
      this.suitcases.set(sc.guestId, { carrierId: null, rest: { floor: sc.floor, room: sc.room } })
    }
    // 3.C (AD-017 class): guests appear in slots by NPC teleport, so an
    // arriving player's snapshot is the ONLY delivery for a teleport that
    // happened while they rode a car (riders get no floor stream). Snapshot
    // guests are own-floor rows — merge them in; departures still arrive as
    // guest:left events.
    for (const g of snapshot.guests ?? []) {
      this.guests.set(g.guestId, { floor: g.floor, x: g.x })
    }
    // Own stairs state (AD-040): the personal snapshot is the anchor — its
    // presence IS the stairs-truth (present only while the recipient is in
    // the stairwell), and a fresh row re-anchors the local countdown.
    const ownStairs = snapshot.stairs
    this.stairsAnchor =
      ownStairs === undefined
        ? null
        : {
            from: ownStairs.from,
            to: ownStairs.to,
            phase: ownStairs.phase,
            remainingMs: ownStairs.remainingSeconds * 1000,
            anchoredAtMs: Date.now(),
          }
    this.updatePanel()
  }

  private addPlayerDisplay(id: string, name: string): void {
    const x = 15
    // ART-01: one staff-walk Sprite per player, bottom-center anchored on the
    // lane ground line — identical texture/anim for every role (FR-9). The
    // label stays a Text (harness label assertions unchanged).
    const sprite = this.add.sprite(x * TILE_PX, GROUND_Y, 'staff-walk')
    sprite.setOrigin(0.5, 1)
    const label = this.add.text(x * TILE_PX, GROUND_Y + 48, name.slice(0, 12), {
      color: '#ffffff',
    })
    label.setOrigin(0.5, 0.5)
    this.players.set(id, {
      sprite,
      label,
      x,
      floor: 'lobby',
      targetX: null,
      left: false,
      facing: 'right',
    })
  }

  private beginMove(dir: 'left' | 'right'): void {
    if (this.selfFired) return
    if (this.ownMoving === dir) return
    this.ownMoving = dir
    this.sendMoveStart(dir)
  }

  private endMove(dir: 'left' | 'right'): void {
    if (this.selfFired) return
    if (this.ownMoving !== dir) return
    this.ownMoving = null
    this.sendMoveStop()
  }

  /**
   * Destination-free elevator call (AD-014): the pickup floor is implicit.
   * Hall-button gate (AD-022): the call only fires from within
   * ELEVATOR_LANDING_TILES of a car landing (x≈0 west, x≈30 east) — the
   * server still dispatches, so which car answers stays sim policy. Riders
   * never send (the server rejects rider calls anyway).
   */
  private callElevator(): void {
    if (this.selfFired) return
    if (this.riderSession !== null) return
    const own = this.players.get(this.ownId)
    if (own === undefined) return
    if (!onLanding(own.x)) return
    this.sendElevatorCall()
  }

  /**
   * E is the accusation key (FR-17, cycle 2.8): keydown starts the hold
   * window; expiry opens the confirm menu for the nearest in-range candidate.
   * A keyup before expiry sends the elevator call exactly as the old tap did
   * (JUST-17) — the hold swallows the call instead.
   */
  private accuseHoldTimer: number | null = null

  /** The guest whose suitcase the local player carries, or null (SUI-25). */
  private ownCarriedGuest(): string | null {
    return carriedGuestIdOf(this.suitcaseRefs(), this.ownId)
  }

  private suitcaseRefs(): SuitcaseRef[] {
    return [...this.suitcases].map(([id, s]) => ({ id, carrierId: s.carrierId, rest: s.rest }))
  }

  /** The own player's predicted position in affordances units (tiles), or
   * null — riders have no floor (AD-009). */
  private ownPos(): { floor: FloorId; x: number } | null {
    const own = this.players.get(this.ownId)
    return own === undefined ? null : { floor: own.floor as FloorId, x: own.x }
  }

  private beginAccuseHold(): void {
    if (this.selfFired || this.accuseHoldTimer !== null) return
    // SUI-25 ladder (AD-037): the decision table lives in the shared
    // affordances module — the same expressions the sim's guards run; the
    // scene only maps the intent to sends and owns the hold timer.
    const intent = resolveEKeydown({
      selfFired: this.selfFired,
      own: this.ownPos(),
      suitcases: this.suitcaseRefs(),
      playerId: this.ownId,
    })
    if (intent.kind === 'desk') {
      this.sendDeskInteract()
      return
    }
    if (intent.kind === 'place') {
      this.sendSuitcasePlace(intent.room)
      return
    }
    if (intent.kind === 'pickup') {
      this.sendSuitcasePickup()
      return
    }
    if (intent.kind !== 'hold') return
    this.accuseHoldTimer = window.setTimeout(() => {
      this.accuseHoldTimer = null
      const candidates = [...this.players]
        .filter(([id, display]) => id !== this.ownId && !display.left)
        .map(([id, display]) => ({ id, floor: display.floor as FloorId, x: display.x }))
      const target = accuseTargetAtHoldExpiry(this.riderSession !== null, this.ownPos(), candidates)
      if (target !== undefined) this.openAccuseMenu(target.id)
    }, ACCUSE_HOLD_MS)
  }

  private endAccuseHold(): void {
    if (this.accuseHoldTimer === null) return
    window.clearTimeout(this.accuseHoldTimer)
    this.accuseHoldTimer = null
    // JUST-17: a keyup that ends the hold window sends the elevator call —
    // the swallow rule is the shared table's, not the scene's.
    if (
      resolveEKeyup({
        selfFired: this.selfFired,
        riding: this.riderSession !== null,
        own: this.ownPos(),
      }).kind === 'elevatorCall'
    ) {
      // AD-040: at the stairwell mouth a terminal floor's E is the stairs
      // alias — the only valid direction (the E-ladder amendment).
      const own = this.ownPos()
      if (own !== null && atStairwellMouth(own.x)) {
        const dirs = stairsDirections(own.floor)
        if (dirs.length === 1) {
          this.sendStairsEnter(dirs[0] as 'up' | 'down')
          return
        }
      }
      this.sendElevatorCall()
    }
  }

  /**
   * ArrowUp/Down (AD-040 input): at the stairwell mouth the direction enters
   * the stairs (gated by the shared affordance table — a terminal direction
   * falls through); anywhere else it summons the car (destination-free,
   * AD-014), exactly as before.
   */
  private callElevatorOrStairs(dir: 'up' | 'down'): void {
    const own = this.ownPos()
    if (own !== null && atStairwellMouth(own.x) && stairsDirections(own.floor).includes(dir)) {
      this.sendStairsEnter(dir)
      return
    }
    this.callElevator()
  }

  /** In-car floor press — sent only while the local player rides a car. */
  private pressFloor(floor: FloorId): void {
    if (this.selfFired) return
    if (this.riderSession === null) return
    this.sendElevatorPress(floor)
  }

  /** The single car's landing (cycle 3.E, AD-040): the EAST end — the
   *  stairwell took the west landing. */
  private carPx(_car: 1 | 2): number {
    return 30 * TILE_PX
  }

  // --- Evidence rendering (cycle 2.7, EVID-19): DOM layer over the canvas ---
  // Scene children stay exactly rectangles+ellipses (harness contract); every
  // evidence visual is absolutely positioned DOM matched to canvas px.

  /** The desk-bell DOM line + guest layer root (GUEST-13, AD-018 pattern). */
  private buildGuestLayer(): void {
    const gameEl = document.querySelector('#game')
    if (gameEl === null) return
    const bell = document.createElement('div')
    bell.id = 'desk-bell'
    bell.textContent = 'desk bell rings - a guest is waiting'
    bell.style.position = 'absolute'
    bell.style.left = '50%'
    bell.style.transform = 'translateX(-50%)'
    bell.style.top = '12px'
    bell.style.padding = '4px 10px'
    bell.style.fontSize = '14px'
    bell.style.background = '#3a3a52'
    bell.style.color = '#ffe9a8'
    bell.style.borderRadius = '4px'
    bell.style.visibility = 'hidden'
    gameEl.appendChild(bell)
    this.deskBell = bell
  }

  // --- Front desk DOM (cycle 3.2, DESK-11/13): gray-box hint + two-step menu.

  /** True when the own predicted position stands in the E desk zone (AD-031). */
  private ownInDeskZone(): boolean {
    const own = this.ownPos()
    return own !== null && inDeskZone(own)
  }

  /** Per-frame desk DOM sync: the check-in hint. */
  private syncDesk(): void {
    if (this.deskHint !== null) {
      const guestQueued = [...this.guests.values()].some((g) => g.floor === 'lobby')
      this.deskHint.style.visibility = this.ownInDeskZone() && guestQueued ? 'visible' : 'hidden'
    }
  }

  private buildDeskLayer(): void {
    const gameEl = document.querySelector('#game')
    if (gameEl === null) return
    const hint = document.createElement('div')
    hint.id = 'desk-hint'
    hint.textContent = 'E - check the guest in (take the suitcase)'
    hint.style.position = 'absolute'
    hint.style.left = '50%'
    hint.style.transform = 'translateX(-50%)'
    hint.style.top = '40px'
    hint.style.padding = '4px 10px'
    hint.style.fontSize = '14px'
    hint.style.background = '#2b3a4a'
    hint.style.color = '#d7e9ff'
    hint.style.borderRadius = '4px'
    hint.style.visibility = 'hidden'
    gameEl.appendChild(hint)
    this.deskHint = hint

    const log = document.createElement('div')
    log.id = 'walkie-log'
    log.style.position = 'absolute'
    log.style.right = '8px'
    log.style.top = '12px'
    log.style.padding = '4px 8px'
    log.style.fontSize = '13px'
    log.style.color = '#ffe9a8'
    log.style.background = 'rgba(20, 28, 34, 0.85)'
    log.style.borderRadius = '4px'
    gameEl.appendChild(log)
    this.walkieLog = log

    const score = document.createElement('div')
    score.id = 'score-hud'
    score.style.position = 'absolute'
    score.style.left = '8px'
    score.style.top = '12px'
    score.style.padding = '4px 8px'
    score.style.fontSize = '13px'
    score.style.color = '#8ad07a'
    score.style.background = 'rgba(20, 28, 34, 0.85)'
    score.style.borderRadius = '4px'
    score.textContent = this.scoreHud.render()
    gameEl.appendChild(score)
    this.scoreHudEl = score

    const complaints = document.createElement('div')
    complaints.id = 'complaint-hud'
    complaints.style.position = 'absolute'
    complaints.style.left = '8px'
    complaints.style.top = '40px'
    complaints.style.padding = '4px 8px'
    complaints.style.fontSize = '13px'
    complaints.style.color = '#ff8a8a'
    complaints.style.background = 'rgba(20, 28, 34, 0.85)'
    complaints.style.borderRadius = '4px'
    complaints.textContent = this.complaintHud.render()
    gameEl.appendChild(complaints)
    this.complaintHudEl = complaints

    const assignment = document.createElement('div')
    assignment.id = 'suitcase-assignment'
    assignment.style.position = 'absolute'
    assignment.style.left = '50%'
    assignment.style.top = '64px'
    assignment.style.transform = 'translateX(-50%)'
    assignment.style.padding = '4px 10px'
    assignment.style.fontSize = '13px'
    assignment.style.background = '#2b3a4a'
    assignment.style.color = '#d7e9ff'
    assignment.style.borderRadius = '4px'
    assignment.style.visibility = 'hidden'
    gameEl.appendChild(assignment)
    this.assignmentHint = assignment
  }

  /** The walkie log (SUI-21/23): one line per server-generated lifecycle
   *  fact, building-wide; last 5 kept. NO player can author a line, and
   *  placement never produces one. */
  private appendWalkieLine(text: string): void {
    if (this.walkieLog === null) return
    const line = document.createElement('div')
    line.className = 'walkie-line'
    line.textContent = text
    this.walkieLog.prepend(line)
    while (this.walkieLog.children.length > 5) {
      this.walkieLog.lastElementChild?.remove()
    }
  }

  /** Suitcase marker sync (SUI-24, called every frame): carried rides the
   *  carrier's display position, rest pins the doorway; sameFloor view filter
   *  like the guests. Also renders the SUI-27 assignment hint for the own
   *  carried suitcase (own knowledge only). */
  private syncSuitcases(): void {
    for (const [id, sc] of this.suitcases) {
      let view = this.suitcaseViews.get(id)
      if (view === undefined) {
        view = this.add.rectangle(0, GROUND_Y - 22, 14, 10, 0xffd27f)
        this.suitcaseViews.set(id, view)
      }
      let x: number | null = null
      let floor: string | null = null
      if (sc.carrierId !== null) {
        const carrier = this.players.get(sc.carrierId)
        if (carrier !== undefined) {
          x = carrier.x
          floor = carrier.floor
        }
      } else if (sc.rest !== null) {
        x = roomDoorXMilli(sc.rest.room) / 1000
        floor = sc.rest.floor
      }
      if (x === null || floor === null) {
        view.setVisible(false)
        continue
      }
      view.setVisible(this.spectator || floor === this.viewFloor)
      view.x = x * TILE_PX
    }
    for (const [id, view] of this.suitcaseViews) {
      if (!this.suitcases.has(id)) {
        view.destroy()
        this.suitcaseViews.delete(id)
      }
    }
    if (this.assignmentHint !== null) {
      const carried = this.ownCarriedGuest()
      const heard = carried !== null ? this.heardAssignments.get(carried) : undefined
      if (heard !== undefined) {
        this.assignmentHint.textContent = `guest's room: ${heard.floor}:${heard.room}`
        this.assignmentHint.style.visibility = 'visible'
      } else {
        this.assignmentHint.style.visibility = 'hidden'
      }
    }
  }

  /** Guest marker sync (called every frame): one Arc per guest on the viewed
   *  floor, bouncing while its free impatience cue is active (GUEST-12/13).
   *  Dining guests (3.C: on the mezzanine) render amber — the dining cue. */
  private syncGuests(delta: number): void {
    this.tapPhase += delta / 1000
    for (const [id, g] of this.guests) {
      let view = this.guestViews.get(id)
      const laneY = this.laneY(g.floor)
      if (view === undefined) {
        view = this.add.circle(g.x * TILE_PX, laneY - 10, 9, 0xbfe3ff)
        this.guestViews.set(id, view)
      }
      const visible = this.spectator || g.floor === this.viewFloor
      view.setVisible(visible)
      view.x = g.x * TILE_PX
      const tap = this.impatientGuests.has(id)
        ? Math.abs(Math.sin(this.tapPhase * Math.PI * 2)) * 8
        : 0
      view.y = laneY - 10 - tap
      view.setFillStyle(g.floor === 'mezzanine' ? DINING_FILL : GUEST_FILL)
    }
    for (const [id, view] of this.guestViews) {
      if (!this.guests.has(id)) {
        view.destroy()
        this.guestViews.delete(id)
      }
    }
    if (this.deskBell !== null) {
      const anyImpatient = [...this.impatientGuests].some(
        (id) => this.guests.get(id)?.floor === 'lobby',
      )
      this.deskBell.style.visibility =
        anyImpatient && (this.spectator || this.viewFloor === 'lobby') ? 'visible' : 'hidden'
    }
  }

  private buildEvidenceLayer(): void {
    const gameEl = document.querySelector('#game')
    if (gameEl === null) return
    const layer = document.createElement('div')
    layer.id = 'evidence-layer'
    layer.style.position = 'absolute'
    layer.style.inset = '0'
    layer.style.pointerEvents = 'none'
    gameEl.appendChild(layer)
    this.evidenceLayer = layer
    // The stairwell marker (STAIRS-17): DOM over the canvas at the west
    // landing of the viewed floor — position mirrors the card markers.
    const marker = document.createElement('div')
    marker.id = 'stairwell-marker'
    marker.textContent = '⇕ stairs'
    marker.style.cssText =
      'position:absolute;left:6px;color:#e6c56a;font:11px ui-monospace,monospace;' +
      'letter-spacing:2px;text-shadow:0 0 8px rgba(230,197,106,0.62);pointer-events:none;'
    layer.appendChild(marker)
    this.stairMarker = marker
  }

  private roomCenterPx(room: RoomIndex): number {
    const centerMilli = (roomSegmentStartMilli(room) + roomSegmentEndMilli(room)) / 2
    return (centerMilli / 1000) * TILE_PX
  }

  /**
   * Production door Images (client:doors_pre_round, ART-06): one door per
   * room segment (AD-010 geometry) per guest floor, rendered from the moment
   * the world mounts — phase-free, so pre-round free-roam (AD-015) shows room
   * boundaries. Live play shows the own floor's doors only (AD-008 view);
   * the spectator overview shows every floor's lane (FR-20). No state tint
   * exists anywhere (ART-10): the hallway sees nothing of interiors except
   * door cards; the grand lobby floor has no rooms.
   */
  private buildDoorImages(): void {
    for (const floor of ['floor1', 'floor2', 'floor3'] as const) {
      for (let room = 1; room <= ROOMS_PER_FLOOR; room++) {
        if (!this.textures.exists('door-closed')) return
        const image = this.add.image(this.roomCenterPx(room as RoomIndex), GROUND_Y, 'door-closed')
        image.setOrigin(0.5, 1)
        image.setName(`door:${floor}:${room}`)
        image.setVisible(false)
        this.doorImages.set(`${floor}:${room}`, image)
      }
    }
  }

  /** ART-08 texture mapping: protocol states → interior art. The protocol's
   *  'fresh' is the clean init state and renders tidy; FR-12's two trash
   *  tiers map to the fresh/settled trash sheets (same mess, different age). */
  private interiorTexture(state: RoomState): string {
    switch (state) {
      case 'trashed':
        return 'room-trash-fresh'
      case 'settled':
        return 'room-trash-settled'
      default:
        return 'room-prepped'
    }
  }

  /**
   * Door Images follow the own view floor (live play) — as a spectator, every
   * guest floor's doors show on its lane (FR-20). A doorway renders open iff
   * the own player stands inside that room (ART-08) or a live `room:entered`
   * cue is running for it (ART-07) — never from state knowledge (ART-10).
   * Spectator overview: baseline-known rooms render open with their interior
   * Image behind the doorway (ART-12); unknown rooms stay closed.
   */
  private syncDoors(): void {
    const own = this.players.get(this.ownId)
    const ownRoom =
      !this.spectator &&
      this.interior !== null &&
      own !== undefined &&
      this.viewFloor === this.interior.floor &&
      roomIndexAtMilli(Math.round(own.x * 1000)) === this.interior.room
        ? this.interior.room
        : null
    const cuedRooms = new Set(
      this.evidence.cues.filter((c) => c.kind === 'entered').map((c) => `${c.floor}:${c.room}`),
    )
    for (const [key, image] of this.doorImages) {
      const [floor, roomText] = String(key).split(':')
      const visible = this.spectator || floor === this.viewFloor
      image.setVisible(visible)
      image.y = this.laneY(floor ?? '')
      const room = Number(roomText) as RoomIndex
      const state =
        ownRoom === room && this.interior !== null
          ? this.interior.state
          : this.roomStates.get(String(key))
      const open =
        visible &&
        ((this.spectator && state !== undefined) ||
          (!this.spectator &&
            (ownRoom === room ||
              (ownRoom === null && cuedRooms.has(String(key)) && floor === this.viewFloor))))
      image.setTexture(open ? 'door-open' : 'door-closed')
      if (this.spectator) {
        this.syncSpectatorInterior(floor ?? '', room, visible && open, state)
      }
    }
    if (!this.spectator) {
      for (const image of this.spectatorInteriors.values()) image.setVisible(false)
      this.syncOwnInterior(ownRoom)
    }
  }

  /**
   * Live own-room interior slot (ART-08/14), synced ONCE per frame — the
   * slot exists only while the own player stands inside the observed
   * segment (ART-09: no interior Image exists for any room the viewer is
   * not inside).
   */
  private syncOwnInterior(ownRoom: number | null): void {
    const show =
      ownRoom !== null && this.interior !== null && this.viewFloor === this.interior.floor
    if (!show || this.interior === null || ownRoom === null) {
      this.interiorImage?.setVisible(false)
      return
    }
    const room = this.interior.room as RoomIndex
    if (this.interiorImage === null) {
      this.interiorImage = this.add.image(0, 0, this.interiorTexture(this.interior.state))
      this.interiorImage.setOrigin(0, 1)
      this.interiorImage.setDepth(-1)
      this.interiorImage.setName(`interior:${this.interior.floor}:${room}`)
    }
    this.interiorImage.setTexture(this.interiorTexture(this.interior.state))
    this.interiorImage.x = (roomSegmentStartMilli(room) / 1000) * TILE_PX
    this.interiorImage.y = this.laneY(this.interior.floor)
    this.interiorImage.setVisible(true)
  }

  /** Spectator overview interior per baseline-known room (ART-12/13). */
  private syncSpectatorInterior(
    floor: string,
    room: RoomIndex,
    open: boolean,
    state: RoomState | undefined,
  ): void {
    const key = `${floor}:${room}`
    let image = this.spectatorInteriors.get(key)
    if (image === undefined && state !== undefined) {
      image = this.add.image(
        (roomSegmentStartMilli(room) / 1000) * TILE_PX,
        this.laneY(floor),
        this.interiorTexture(state),
      )
      image.setOrigin(0, 1)
      image.setDepth(-1)
      image.setName(`interior:${key}`)
      this.spectatorInteriors.set(key, image)
    }
    if (image !== undefined) {
      image.setVisible(open && state !== undefined)
      image.y = this.laneY(floor)
      if (state !== undefined) image.setTexture(this.interiorTexture(state))
    }
  }

  /** Create-on-demand card glyph per carded room; own floor live, all floors
   * as a spectator (the lane offset follows the card's floor). */
  private syncCardMarkers(): void {
    const layer = this.evidenceLayer
    if (layer === null) return
    for (const key of this.evidence.cards) {
      if (this.cardMarkers.has(key)) continue
      const room = Number(key.split(':')[1]) as RoomIndex
      const marker = document.createElement('div')
      marker.dataset.roomKey = key
      marker.textContent = 'CARD'
      marker.style.position = 'absolute'
      marker.style.left = `${this.roomCenterPx(room) - 24}px`
      marker.style.width = '48px'
      marker.style.padding = '2px 0'
      marker.style.textAlign = 'center'
      marker.style.fontSize = '12px'
      marker.style.background = '#c8a24a'
      marker.style.color = '#111'
      marker.style.borderRadius = '3px'
      layer.appendChild(marker)
      this.cardMarkers.set(key, marker)
    }
  }

  /** Expire cue DOM nodes and prune the session (called every frame). */
  private syncCues(): void {
    const now = Date.now()
    const live = liveCues(this.evidence, now)
    const expired = new Set(
      this.evidence.cues.filter((c) => !live.some((l) => l.id === c.id)).map((c) => c.id),
    )
    for (const id of expired) {
      this.cueNodes.get(id)?.remove()
      this.cueNodes.delete(id)
    }
    this.evidence = dropCues(this.evidence, expired)
    for (const cue of live) {
      if (this.cueNodes.has(cue.id)) continue
      const node = document.createElement('div')
      node.dataset.cueId = String(cue.id)
      node.dataset.cueKind = cue.kind
      node.textContent = cue.kind === 'rustle' ? 'rustle' : 'door'
      node.style.position = 'absolute'
      node.style.left = `${this.roomCenterPx(cue.room) - 30}px`
      node.style.width = '60px'
      node.style.textAlign = 'center'
      node.style.fontSize = '12px'
      node.style.color = cue.kind === 'rustle' ? '#e2705a' : '#8ad07a'
      this.evidenceLayer?.appendChild(node)
      this.cueNodes.set(cue.id, node)
    }
  }

  /** Reset for a fresh round deal: cards and cues die with the previous sim. */
  resetEvidence(): void {
    this.evidence = initialEvidenceSession()
    this.cardMarkers.clear()
    this.cueNodes.clear()
    if (this.evidenceLayer !== null) this.evidenceLayer.replaceChildren()
  }

  // --- Settle-score HUD (cycle 3.D, AD-039): the counter lives in the scene
  // because guest:settled is scene-routed; App drives reset (fresh deal)
  // and seed (reconnect re-store).

  /** Fresh deal: zero the counter against the new lobby's target. */
  resetScore(target: number): void {
    this.scoreHud.reset(target)
    this.renderScoreHud()
  }

  /** Reconnect re-store: re-seed to the server's settle truth (round:resumed). */
  seedScore(count: number): void {
    this.scoreHud.seed(count)
    this.renderScoreHud()
  }

  /** Round over: freeze at the final value — late settles are ignored. */
  freezeScore(): void {
    this.scoreHud.freeze()
    this.renderScoreHud()
  }

  private renderScoreHud(): void {
    if (this.scoreHudEl !== null) this.scoreHudEl.textContent = this.scoreHud.render()
  }

  // --- Complaint-budget HUD (cycle 3.3, FR-31/FR-14): the budget counter lives
  // in the scene because guest:discovered is scene-routed; App drives reset
  // (fresh deal) and seed (reconnect re-store).

  /** Fresh deal: zero the counter. */
  resetComplaints(): void {
    this.complaintHud.reset()
    this.renderComplaintHud()
  }

  /** Reconnect re-store: re-seed to the server's truth (round:resumed). */
  seedComplaints(count: number): void {
    this.complaintHud.seed(count)
    this.renderComplaintHud()
  }

  /** Round over: freeze at the final value — late reports are ignored. */
  freezeComplaints(): void {
    this.complaintHud.freeze()
    this.renderComplaintHud()
  }

  private renderComplaintHud(): void {
    if (this.complaintHudEl === null) return
    this.complaintHudEl.textContent = this.complaintHud.render()
    this.complaintHudEl.classList.toggle('pulse', this.complaintHud.pulsing)
  }

  /** Short gray-box tone for audible cues; silent in environments without audio. */
  private beep(freq: number): void {
    try {
      if (this.audio === null) this.audio = new AudioContext()
      const ctx = this.audio
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
      osc.start()
      osc.stop(ctx.currentTime + 0.2)
    } catch {
      // No AudioContext (headless runs): the visual cue still fires.
    }
  }

  private updatePanel(): void {
    const panel = document.querySelector('#elevator-panel')
    if (panel === null) return
    // Car floor + hall-call light read from the presenter (AD-038); single
    // car (cycle 3.E, AD-040) — one readout, position-only.
    const p = this.elevatorPresenter?.panelState()
    const floorEl = panel.querySelector('#panel-floor')
    if (floorEl !== null) floorEl.textContent = p?.floor ?? '?'
    // Hall-call light (AD-024): amber while the car owes the floor a stop.
    const light = panel.querySelector('#panel-light')
    if (light instanceof HTMLElement) {
      light.style.color = (p?.light ?? false) ? '#e8c34a' : '#4a5568'
    }
  }

  /** Per-frame panel sprite sync: idle frame, flash frame inside the window. */
  private syncPanelFlash(): void {
    const flashing = this.elevatorPresenter?.isFlashing(this.viewFloor as FloorId) ?? false
    for (const [side, image] of this.panelImages) {
      void side
      image.setVisible(!this.spectator)
      image.setFrame(flashing ? 1 : 0)
    }
  }

  /** Current-floor sweep + state line for the in-car screen (every frame).
   *  The readout is derived in the presenter's tick (AD-038); the scene only
   *  applies it to the DOM. */
  private syncCarScreenReadouts(): void {
    const readout = this.elevatorPresenter?.carScreen() ?? { floor: null, state: null }
    setCarScreenFloor(readout.floor)
    setCarScreenState(readout.state)
  }

  /** The "you were ambushed" toast (STAIRS-19): text + countdown synced per
   *  frame while the stun window runs. */
  private showAmbushToast(stunSeconds: number): void {
    if (this.evidenceLayer === null) return
    if (this.ambushToast === null) {
      const el = document.createElement('div')
      el.id = 'ambush-toast'
      el.style.cssText =
        'position:absolute;left:50%;top:64px;transform:translateX(-50%);' +
        'background:#2a1414;border:1px solid #ff7a6a;color:#ff9a8a;border-radius:8px;' +
        'padding:8px 16px;font:13px ui-monospace,monospace;letter-spacing:1px;' +
        'box-shadow:0 0 18px rgba(255,90,70,0.35);'
      this.evidenceLayer.appendChild(el)
      this.ambushToast = { el, until: 0 }
    }
    this.ambushToast.until = Date.now() + stunSeconds * 1000
  }

  /** The saboteur's private confirmation line (STAIRS-19), shown briefly. */
  private showAmbushConfirm(victimId: string): void {
    if (this.evidenceLayer === null) return
    if (this.ambushConfirm === null) {
      const el = document.createElement('div')
      el.id = 'ambush-confirm'
      el.style.cssText =
        'position:absolute;left:50%;bottom:70px;transform:translateX(-50%);' +
        'background:#14211a;border:1px solid #8ad07a;color:#a8e29a;border-radius:8px;' +
        'padding:6px 14px;font:12px ui-monospace,monospace;letter-spacing:1px;'
      this.evidenceLayer.appendChild(el)
      this.ambushConfirm = { el, until: 0 }
    }
    const name = this.rosterNames.get(victimId) ?? victimId
    this.ambushConfirm.el.textContent = `your ambush landed on ${name}`
    this.ambushConfirm.until = Date.now() + 6000
  }

  /** Per-frame ambush DOM sync: the toast counts down, both expire cleanly. */
  private syncAmbushDom(): void {
    if (this.ambushToast !== null) {
      const left = this.ambushToast.until - Date.now()
      if (left <= 0) {
        this.ambushToast.el.remove()
        this.ambushToast = null
      } else {
        this.ambushToast.el.textContent = `you were ambushed — ${Math.ceil(left / 1000)}s`
      }
    }
    if (this.ambushConfirm !== null && this.ambushConfirm.until - Date.now() <= 0) {
      this.ambushConfirm.el.remove()
      this.ambushConfirm = null
    }
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
    if (own !== undefined && this.ownMoving !== null) {
      own.x += this.ownMoving === 'left' ? -SPEED_TILES_PER_SEC * dt : SPEED_TILES_PER_SEC * dt
      own.x = Math.min(30, Math.max(0, own.x))
    }
    for (const [id, display] of this.players) {
      if (id !== this.ownId && display.targetX !== null) {
        // Others follow server positions within ~2 ticks (exponential approach).
        display.x += (display.targetX - display.x) * Math.min(1, dt * 12)
      }
      // Riders are on NO floor (AD-009): the own rectangle never renders while
      // riding — the boarding events are routed while the boarder's view is a
      // rider's (no floor stream), so the chip is the in-car view instead.
      // Live play shows the own floor only (AD-008); the spectator overview
      // shows every live player on their floor's lane (FR-20).
      const laneY = this.laneY(display.floor)
      const visible =
        !display.left &&
        !(id === this.ownId && this.riderSession !== null) &&
        // AD-040 prediction mirror: the own body is inside the black box
        // while in the stairwell — no floor view renders it.
        !(id === this.ownId && this.stairsAnchor !== null) &&
        (this.spectator || display.floor === this.viewFloor)
      display.sprite.setVisible(visible)
      display.label.setVisible(visible)
      display.sprite.x = display.x * TILE_PX
      display.label.x = display.x * TILE_PX
      display.sprite.y = laneY
      display.label.y = laneY + 48
      // ART-02/03: facing + walk cycle. The own player's facing follows the
      // local prediction; remote players keep their last moved facing. The
      // walk plays while the display is live (predicted own movement or an
      // unsettled lerp target) and settles back to frame 0 when stopped —
      // identical presentation for every role (FR-9).
      if (id === this.ownId && this.ownMoving !== null) display.facing = this.ownMoving
      const moving =
        (id === this.ownId && this.ownMoving !== null) ||
        (display.targetX !== null && Math.abs(display.targetX - display.x) > 0.01)
      display.sprite.flipX = display.facing === 'left'
      if (moving) {
        if (!display.sprite.anims.isPlaying) display.sprite.play('staff-walk')
      } else if (display.sprite.anims.isPlaying) {
        display.sprite.anims.stop()
        display.sprite.setFrame(0)
      }
    }
    // The presenter drives every car's y (base lane + arrival slide) in tick.
    this.elevatorPresenter?.tick(delta, this.viewFloor as FloorId, this.riderSession)
    this.syncGuests(delta)
    // Anger cues (cycle 3.3, FR-29b stage 1): TTL-bound Text "!" at the room
    // door — sameFloor visibility, pruned here so the harness pollution
    // window stays short.
    {
      const now = Date.now()
      this.angerCues = this.angerCues.filter((cue) => {
        if (now >= cue.until) {
          cue.view.destroy()
          return false
        }
        cue.view.setVisible(this.spectator || cue.floor === this.viewFloor)
        return true
      })
    }
    this.syncSuitcases()
    this.syncDesk()
    // Card glyph position/visibility follow the floor lanes; cues expire here.
    this.syncCardMarkers()
    for (const [key, marker] of this.cardMarkers) {
      const floor = key.split(':')[0] ?? ''
      marker.style.top = `${this.laneY(floor) - 130}px`
      marker.style.visibility = this.spectator || floor === this.viewFloor ? 'visible' : 'hidden'
    }
    for (const [cueId, node] of this.cueNodes) {
      const cue = this.evidence.cues.find((c) => c.id === cueId)
      if (cue === undefined) continue
      node.style.top = `${this.laneY(cue.floor) - (cue.kind === 'rustle' ? 100 : 160)}px`
    }
    this.syncCues()
    this.syncDoors()
    // The elevator panel is self-healing: view re-renders rebuild the DOM
    // element, so refresh it every frame from scene state.
    this.updatePanel()
    this.syncPanelFlash()
    // The in-car screen's readouts follow the own car's animation clock —
    // floor swept through transition floors mid-ride, state line naming the
    // door/motion phase. Both cleared when not riding.
    this.syncCarScreenReadouts()
    // The stairwell clock prediction mirror (AD-040): when the local clock
    // says the visit is over, the arrival is applied to the own display —
    // the sameFloor stream resumed while the client was floorless, so the
    // event never reached us. The stairwell screen itself is hidden —
    // elevator-only — but the clock still ticks for movement.
    if (this.stairsAnchor !== null) {
      const readout = stairPhaseReadout(this.stairsAnchor, Date.now())
      if (readout === null) {
        if (this.stairsAnchor.phase === 'stunned' && this.stunResumeMs > 0) {
          // The stun ended: the interrupted transit resumes with its
          // preserved remainder.
          this.stairsAnchor = {
            from: this.stairsAnchor.from,
            to: this.stairsAnchor.to,
            phase: 'transit',
            remainingMs: this.stunResumeMs,
            anchoredAtMs: Date.now(),
          }
          this.stunResumeMs = 0
        } else {
          const own = this.players.get(this.ownId)
          if (own !== undefined) {
            own.floor = this.stairsAnchor.to
            own.x = 0
            own.targetX = null
          }
          this.stairsAnchor = null
        }
      }
    }
    // Doors on the elevator screen — the leaves slide with the presenter's
    // clock (the single car, cycle 3.E). The screen is the star, so the
    // doors read live even before the car sprite animates.
    {
      const carForDoors = this.riderSession?.car ?? (1 as const)
      const doorClock = this.elevatorPresenter?.clockOf(carForDoors)
      const amount =
        doorClock !== undefined ? doorsOpenAmount(doorClock, DEFAULT_ANIMATION_CONFIG) : 0
      setCarScreenDoors(amount)
    }
    syncStairScreen(this.stairsAnchor, Date.now())
    // The stairwell marker sits at the west landing of the rendered lane
    // (every floor has one); the ambush DOM expires per frame.
    if (this.stairMarker !== null) {
      this.stairMarker.style.top = `${this.laneY(this.viewFloor) - 150}px`
    }
    this.syncAmbushDom()
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
