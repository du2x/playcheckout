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
import { sfx } from '../audio/sfx'
import {
  dropCues,
  type EvidenceSession,
  initialEvidenceSession,
  liveCues,
  reduceEvidence,
} from '../evidenceSession'
import type { RiderUpdate } from '../riderSession'
import type { SceneAction } from '../state'
import {
  FLOOR_ORDER,
  setCarScreenDoors,
  setCarScreenFloor,
  setCarScreenState,
} from '../ui/carScreen'
import { ComplaintHud } from '../ui/complaintHud'
import { ScoreHud } from '../ui/scoreHud'
import { buildSfxToggle } from '../ui/sfxToggle'
import { type StairAnchor, stairPhaseReadout, syncStairScreen } from '../ui/stairScreen'
import {
  CLIMB,
  climbBobY,
  climbWalkFraction,
  lurchKickY,
  sconceAlpha,
  stairPoint,
  stunFx,
} from './climbPresenter'
import {
  arrivalBurstAlpha,
  carSwayY,
  DEFAULT_ANIMATION_CONFIG,
  doorsOpenAmount,
  ElevatorPresenter,
} from './elevatorPresenter'
import {
  CHAIR_SEAT_TOP_PX,
  diningFurniture,
  diningSlotAtXTiles,
  diningSlotFacesEast,
  type FurnitureAnchor,
  LOBBY_FURNITURE,
  MEZZANINE_FURNITURE,
  SEATED_GUEST_DEPTH,
} from './furniture'
import { JUICE, shouldShake } from './juice'
import {
  advanceZoom,
  REST_ZOOM,
  roomZoomActive,
  type ZoomView,
  zoomLayerTransform,
  zoomTarget,
} from './zoomPresenter'

/** Guest archetype + palette derivation (Phase 4.1, VPOL-06; 10 kinds per the
 *  2026-09-05 user direction): pure seed → {archetype, palette}. The first
 *  four archetypes keep their historical order so seed 0..3 stays
 *  suite/tourist/clerk/elder. Palette tints are civil Deco tones — never the
 *  staff ivory `0xf2ead8`/`0xf6f1e6` or brass `0xc9a13b`/`0xb3873a` (VPOL-07). */
const GUEST_ARCHETYPES = [
  'guest-suite',
  'guest-tourist',
  'guest-clerk',
  'guest-elder',
  'guest-dandy',
  'guest-diva',
  'guest-flapper',
  'guest-merchant',
  'guest-professor',
  'guest-child',
] as const
const GUEST_PALETTES = [0x5a9aaa, 0xb06a7a, 0x8aa06a, 0x9a7a9a] as const
function guestVariantOf(seed: number): { archetype: number; palette: number } {
  const u = (seed >>> 0) % GUEST_ARCHETYPES.length
  return {
    archetype: u >>> 0,
    palette: (Math.floor((seed >>> 0) / GUEST_ARCHETYPES.length) % GUEST_PALETTES.length) >>> 0,
  }
}
/** Per-channel tint blend toward the dining amber (VPOL-08). */
function blendTint(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t)
  return (mix(ar, br) << 16) | (mix(ag, bg) << 8) | mix(ab, bb)
}

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
/** Front-facing landing door width (Phase 4.2: shared by the car mount and
 *  the landing-panel mount so the two never drift apart). */
const ELEVATOR_DOOR_PX = 80
const SPEED_TILES_PER_SEC = TUNING.PLAYER_SPEED_TILES_PER_SEC
/** Dining tint target (VPOL-08): the lobby→mezzanine dining cue. */
const DINING_FILL = 0xffd27a
/** Staff variant buckets (Phase 4.1, VPOL-02): the client mirror of
 *  packages/sim cosmetic.ts — pure seed → head-frame index. Pinned equal to
 *  the sim's variantIndex by the sim suite; a drift here is a defect. */
const STAFF_VARIANT_BUCKETS = 8
function variantIndexOf(seed: number): number {
  return ((seed >>> 0) % STAFF_VARIANT_BUCKETS) >>> 0
}

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
  /** The head/accent overlay (Phase 4.1, VPOL-02) — pixel-locked to `sprite`. */
  variant: Phaser.GameObjects.Sprite | null
  label: Phaser.GameObjects.Text
  x: number
  floor: string
  targetX: number | null
  /** True once the player departed our floor by elevator (AD-009). */
  left: boolean
  /** Profile facing: the sheet faces right; left renders flipX (ART-02). */
  facing: 'left' | 'right'
  /** Cosmetic seed (Phase 4.1, VPOL-01) — variantIndex(seed%8) drives the overlay. */
  seed?: number
  /** Juice state (VPOL-13): whether the last frame counted as moving — the
   *  settle pop fires on the moving→idle transition only. */
  wasMoving?: boolean
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
  /** Cosmetic seeds (Phase 4.1, VPOL-01): the public decorrelated player
   *  seeds; the variant renderer derives staff-body + staff-variant from it. */
  private playerSeeds = new Map<string, number>()
  /** Cosmetic seeds (Phase 4.1, VPOL-06): guest seeds — archetype + palette. */
  private guestSeeds = new Map<string, number>()
  /** Guests whose free impatience cue is active (foot-tap + bell, GUEST-13). */
  private impatientGuests = new Set<string>()
  /** Guests currently dining in the mezzanine restaurant (furnishing slice):
   *  seeded by the building-wide check-in notice (guest:assigned, SUI-03) and
   *  cleared when the suitcase rests (suitcase:placed → SUI-13 re-target) or
   *  the guest leaves. A dropCarry re-queue emits no message — the stale id
   *  is harmless: the pose gate also requires the guest's floor to be the
   *  mezzanine. */
  private diningGuests = new Set<string>()
  /** Furnishing views per floor (live view only — the spectator overview's
   *  stacked lanes keep their plain backdrop, like the corridor band). */
  private furniture = new Map<FloorId, Phaser.GameObjects.Image[]>()
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
  /** Phaser canvas elevator interior — drawn inside the main window, not as a
   *  DOM modal. Visible only while riding. */
  private elevatorCanvas: Phaser.GameObjects.Container | null = null
  private elevatorCanvasFloor: Phaser.GameObjects.Text | null = null
  private elevatorCanvasState: Phaser.GameObjects.Text | null = null
  private elevatorCanvasDoors: {
    left: Phaser.GameObjects.Rectangle
    right: Phaser.GameObjects.Rectangle
  } | null = null
  private elevatorCanvasOccupants: Phaser.GameObjects.Container | null = null
  private elevatorCanvasButtons = new Map<FloorId, Phaser.GameObjects.Arc>()
  /** The beyond-door glow (AD-054) + its burst t0 (-1 = at rest). */
  private elevatorCanvasBeyond: Phaser.GameObjects.Rectangle | null = null
  private elevatorCanvasBurstT0 = -1
  /** Phaser canvas stairwell interior — full-screen when in the west stairwell
   *  (transit/stun only: the breath stands on the destination floor, where the
   *  small chip carries the countdown instead). */
  private stairCanvas: Phaser.GameObjects.Container | null = null
  private stairCanvasClock: Phaser.GameObjects.Text | null = null
  private stairCanvasRoute: Phaser.GameObjects.Text | null = null
  private stairCanvasPhase: Phaser.GameObjects.Text | null = null
  private stairCanvasArrow: Phaser.GameObjects.Text | null = null
  /** Climb-scene members (night-juice): the scrolled stair band, the lazy
   *  climber sprite (container-owned — never a top-level harness child), the
   *  flicker sconces, the landing glyphs, and the scuffle/blackout FX stack. */
  private climbBand: Phaser.GameObjects.Container | null = null
  private climbClimber: Phaser.GameObjects.Sprite | null = null
  private climbSconces: { lamp: Phaser.GameObjects.Ellipse; seed: number }[] = []
  private climbGlyphFrom: Phaser.GameObjects.Text | null = null
  private climbGlyphTo: Phaser.GameObjects.Text | null = null
  private climbFx: {
    flashWhite: Phaser.GameObjects.Rectangle
    flashRed: Phaser.GameObjects.Rectangle
    sweep: Phaser.GameObjects.Rectangle
    blackout: Phaser.GameObjects.Rectangle
    vignette: Phaser.GameObjects.Rectangle
  } | null = null
  /** Stun total captured at the ambush — the FX timeline's t0 basis. */
  private stunTotalMs = 0
  /** `Date.now()` the interrupted transit resumed (the lurch window's t0). */
  private climbLurchAtMs = 0
  /** The walk fraction frozen at the ambush (a stun never advances the walk). */
  private lastTransitWalk = 0
  /** Previous stair/car phase — the audio transition watchers' memory. */
  private lastStairPhase: 'transit' | 'breath' | 'stunned' | null = null
  private lastCarPhase: string | null = null
  /** Warm light spill at the east landing while the car's doors stand open. */
  private spillGlow: Phaser.GameObjects.Container | null = null
  /** The breath chip: "catching breath" + countdown at the top-left of the
   *  destination floor view (AD-040 amendment — the floor renders beneath). */
  private breathChip: Phaser.GameObjects.Container | null = null
  private breathChipClock: Phaser.GameObjects.Text | null = null
  /** The own breath-puff sprite (breath-sprites, BR-01): at most one — owned
   *  by the own readout, destroyed when the breath ends. Own-viewer only. */
  private breathSprite: Phaser.GameObjects.Sprite | null = null
  private ownMoving: 'left' | 'right' | null = null
  private viewFloor = 'lobby'
  /** The actor's own running channel: DOM progress bar state (never a kind). */
  private work: { startedAt: number; seconds: number } | null = null
  /** The interior last observed for the own segment (FR-10 read half). */
  private interior: { floor: string; room: number; state: RoomState } | null = null
  /** Evidence view state + its DOM layer (cycle 2.7, EVID-19). */
  private evidence: EvidenceSession = initialEvidenceSession()
  private evidenceLayer: HTMLElement | null = null
  /** The screen-space DOM layer (sfx toggle, ambush toasts): evidenceLayer's
   *  untransformed sibling — the room zoom (below) transforms only the
   *  world-anchored marker layer. */
  private uiLayer: HTMLElement | null = null
  /** The room zoom's camera view (room-zoom spec): the eased transform the
   *  camera + marker layer apply per frame; REST_ZOOM is the exact identity. */
  private zoomView: ZoomView = REST_ZOOM
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
  /** Guest NPC markers (Phase 4.1): one archetype Sprite per guest —
   *  texture + palette derive from the decorrelated guest seed (VPOL-06/07);
   *  created lazily, pruned on guest:left. */
  private guestViews = new Map<string, Phaser.GameObjects.Sprite>()
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
  /** Foot-tap proxies (Phase 4.1, VPOL-14) live in syncGuests; the phase
   *  counter is gone — the Tween clock owns the bounce. */
  private cardMarkers = new Map<string, HTMLElement>()
  private tenancies = new Map<string, boolean>()
  private tenancyMarkers = new Map<string, HTMLElement>()
  private cueNodes = new Map<number, HTMLElement>()
  private audio: AudioContext | null = null
  /** Production door Images per room segment per guest floor (ART-06) —
   *  phase-free; the name `door:<floor>:<room>` drives harness filtering. */
  private doorImages = new Map<string, Phaser.GameObjects.Image>()
  /** Authored corridor wall (Phase 4.2, ENV-01): 960x302 TileSprite of the
   *  32x302 wall-field tile (frieze baked in); live view only. */
  private wallField: Phaser.GameObjects.TileSprite | null = null
  /** Missing-texture fallback (spec edge case): flat fill drawn ONLY when
   *  the wall-field texture failed to load — never alongside the tile. */
  private wallFallback: Phaser.GameObjects.Graphics | null = null
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
    this.playerSeeds.clear()
    this.guestSeeds.clear()
    this.cars.clear()
    this.ownMoving = null
    this.viewFloor = 'lobby'
    this.work = null
    this.interior = null
    this.stairsAnchor = null
    this.breathSprite = null
    this.evidence = initialEvidenceSession()
    this.cardMarkers.clear()
    this.tenancies.clear()
    for (const el of this.tenancyMarkers.values()) el.remove()
    this.tenancyMarkers.clear()
    this.cueNodes.clear()
    this.doorImages.clear()
    this.wallField = null
    this.wallFallback = null
    this.riderSession = data.riderSession
    this.buildEvidenceLayer()
    this.buildGuestLayer()
    this.buildDeskLayer()
    this.buildDoorImages()
    this.buildFurniture()
    this.syncTenancyMarkers()

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
    // Authored corridor wall (Phase 4.2, ENV-01): the 32x302 wall-field
    // tile across y48..350 at depth -3. Live view only. The flat-fill
    // fallback runs ONLY when the texture failed to load (spec edge case).
    if (this.textures.exists('wall-field')) {
      this.wallField = this.add.tileSprite(0, 48, 960, 302, 'wall-field')
      this.wallField.setOrigin(0, 0)
      this.wallField.setDepth(-3)
      this.wallField.setVisible(!this.spectator)
    } else {
      this.wallFallback = this.add.graphics()
      this.wallFallback.setDepth(-3)
      this.wallFallback.fillStyle(0x33505a, 1)
      this.wallFallback.fillRect(0, 48, 960, 302)
      this.wallFallback.setVisible(!this.spectator)
    }
    if (this.textures.exists('staff-walk') && !this.anims.exists('staff-walk')) {
      // 34x64 body sheet (Phase 4.1): frame 0 = idle, the rest = the walk
      // cycle (derived from the sheet — no art constant duplicated here).
      const last = this.textures.get('staff-walk').frameTotal - 1
      this.anims.create({
        key: 'staff-walk',
        frames: this.anims.generateFrameNumbers('staff-walk', { start: 1, end: last }),
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
    if (this.textures.exists('fx-breath') && !this.anims.exists('breath')) {
      // 8fps ≈ 4 loops per 2 s breath (cosmetic anim rates stay off §7
      // values per the tuning-literal denylist, literals.test.ts).
      this.anims.create({
        key: 'breath',
        frames: this.anims.generateFrameNumbers('fx-breath', { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      })
    }

    for (const player of data.players) {
      this.rosterNames.set(player.id, player.name)
      this.addPlayerDisplay(player.id, player.name)
    }

    // One elevator-door Sprite for the single car (cycle 3.E, AD-040) hugging
    // the EAST canvas edge (ART-15: frame 0 = doors-open doorway, frame 1 =
    // closed slab; never an occupant list — privacy rule). The presenter
    // drives frame/visibility from its clock. Wall-plane depth: corridor
    // chars (depth 0) overlay the opened doorway, and the widened 80 px door
    // stays fully on-canvas.
    for (const id of [1] as const) {
      const sprite = this.add.sprite(
        this.carPx(id) - ELEVATOR_DOOR_PX / 2,
        GROUND_Y,
        'elevator-door',
      )
      sprite.setOrigin(0.5, 1)
      sprite.setDepth(-1)
      this.cars.set(id, { view: sprite })
    }
    // Landing panel sprite (ART-17): position-only — a call flashes it
    // (decoys included); occupants are never rendered (privacy rule). The
    // indicator hangs ABOVE the door lintel, clear of the widened slab.
    if (this.textures.exists('elevator-panel')) {
      const image = this.add.sprite(
        this.carPx(1) - ELEVATOR_DOOR_PX / 2,
        GROUND_Y - 96 - 18,
        'elevator-panel',
      )
      image.setFrame(0)
      image.setName('panel:east')
      image.setDepth(-1)
      image.setVisible(!this.spectator)
      this.panelImages.set('east', image)
    }
    // Fresh presenter per scene restart (its constructor resets both clocks).
    this.elevatorPresenter = new ElevatorPresenter(this.cars, (car) => this.carLaneY(car))
    this.createElevatorCanvasInterior()
    this.createStairCanvasInterior()
    // The landing light spill (night-juice): container-owned so the top-level
    // ART counts never see it; positioned over the east landing per frame.
    const spill = this.add.container(0, 0)
    spill.setName('spillGlow')
    spill.setDepth(0.5)
    spill.setVisible(false)
    const column = this.add.rectangle(30 * TILE_PX, -80, 130, 170, 0xf0d9a8, 0.08)
    const pool = this.add.rectangle(30 * TILE_PX, -4, 270, 12, 0xf0d9a8, 0.2)
    spill.add([column, pool])
    this.spillGlow = spill

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

  /**
   * The scenic in-car interior (AD-054): a warm hotel elevator car drawn in
   * Phaser primitives on the AD-020 palette — paneled walls, brass rail,
   * crimson carpet, sliding doors onto a lit hallway beyond, and a floor dial
   * above the doors that ticks with the ride. The passengers stand center
   * stage on the carpet (the social read IS the scene); the DOM car bar is
   * retired while riding. Container-owned, so top-level ART counts are blind
   * to every rectangle here.
   */
  private createElevatorCanvasInterior(): void {
    const container = this.add.container(480, 288)
    container.setScrollFactor(0)
    container.setDepth(50)
    container.setVisible(false)
    container.setName('elevatorCanvas')
    // Backdrop: oversized so the ride sway never shows an edge.
    container.add(this.add.rectangle(0, 0, 984, 600, 0x221c12))
    // Walls: dim cream upper, dim tan wainscot, gold trim line, panel seams.
    container.add(this.add.rectangle(0, -160, 960, 288, 0x6e6450))
    container.add(this.add.rectangle(0, 140, 960, 328, 0x574a36))
    container.add(this.add.rectangle(0, -16, 960, 5, 0x8a6a2e))
    for (let x = -360; x <= 360; x += 120) {
      container.add(this.add.rectangle(x, -30, 3, 576, 0x4f4634))
    }
    // Brass handrail across the back wall.
    container.add(this.add.rectangle(0, -34, 752, 10, 0x8a6a2e))
    container.add(this.add.rectangle(-368, -34, 12, 24, 0x55492c))
    container.add(this.add.rectangle(368, -34, 12, 24, 0x55492c))
    // Carpet: crimson field with a gold edge strip (the passengers' floor).
    container.add(this.add.rectangle(0, 216, 960, 152, 0x5e2626))
    container.add(this.add.rectangle(0, 142, 960, 4, 0x8a6a2e))
    // The hallway beyond the doors: a lit glow the burst drives.
    const beyond = this.add.rectangle(0, -36, 250, 262, 0xf0d9a8, 0.32)
    container.add(beyond)
    const beyondFloor = this.add.rectangle(0, 84, 250, 5, 0x8a6a2e)
    container.add(beyondFloor)
    // Doors: brushed-steel leaves with brass jambs, center-seamed.
    const jambL = this.add.rectangle(-141, -36, 12, 262, 0x8a6a2e)
    const jambR = this.add.rectangle(141, -36, 12, 262, 0x8a6a2e)
    const left = this.add.rectangle(-70, -36, 128, 258, 0x4a5568)
    const right = this.add.rectangle(70, -36, 128, 258, 0x4a5568)
    const seamL = this.add.rectangle(-3, -36, 3, 258, 0x2a3542)
    const seamR = this.add.rectangle(3, -36, 3, 258, 0x2a3542)
    container.add([beyond, jambL, jambR, left, right, seamL, seamR])
    this.elevatorCanvasDoors = { left, right }
    // Floor dial above the doors: brass plate, the ticking glyph, arrow.
    const dialPlate = this.add.rectangle(0, -214, 190, 62, 0x241d12)
    dialPlate.setStrokeStyle(2, 0x8a6a2e)
    container.add(dialPlate)
    const floor = this.add.text(-20, -214, '', {
      fontSize: '40px',
      color: '#ffd98a',
      fontFamily: 'monospace',
    })
    floor.setOrigin(0.5)
    floor.setName('floor')
    container.add(floor)
    this.elevatorCanvasFloor = floor
    const dirArrow = this.add.text(52, -214, '', {
      fontSize: '22px',
      color: '#e6c56a',
      fontFamily: 'monospace',
    })
    dirArrow.setOrigin(0.5)
    dirArrow.setName('dirArrow')
    container.add(dirArrow)
    // Car tag + state line.
    const carLabel = this.add.text(-430, -262, '', {
      fontSize: '10px',
      color: '#8899aa',
      fontFamily: 'monospace',
    })
    carLabel.setName('carLabel')
    container.add(carLabel)
    const state = this.add.text(0, -172, '', {
      fontSize: '11px',
      color: '#8ad07a',
      fontFamily: 'monospace',
    })
    state.setOrigin(0.5)
    state.setName('state')
    container.add(state)
    this.elevatorCanvasState = state
    // Button pillar (right wall): five round brass buttons, pressable.
    const pillar = this.add.rectangle(332, -36, 84, 262, 0x5a4c38)
    pillar.setStrokeStyle(2, 0x8a6a2e)
    container.add(pillar)
    const floors: FloorId[] = ['floor3', 'floor2', 'floor1', 'mezzanine', 'lobby']
    const labels = ['3', '2', '1', 'M', 'L']
    floors.forEach((floorId, i) => {
      const y = -124 + i * 58
      const btn = this.add.circle(332, y, 17, 0x1a2530)
      btn.setStrokeStyle(1, 0x3d4a58)
      btn.setInteractive({ useHandCursor: true })
      btn.on('pointerdown', () => this.pressFloor(floorId))
      const label = this.add.text(332, y, labels[i] ?? '', {
        fontSize: '13px',
        color: '#9fb0c0',
        fontFamily: 'monospace',
      })
      label.setOrigin(0.5)
      container.add([btn, label])
      this.elevatorCanvasButtons.set(floorId, btn)
    })
    // The passengers: center stage on the carpet (rebuilt each sync).
    const occ = this.add.container(0, 196)
    container.add(occ)
    this.elevatorCanvasOccupants = occ
    this.elevatorCanvas = container
    this.elevatorCanvasBeyond = beyond
    this.elevatorCanvasBurstT0 = -1
  }

  private syncElevatorCanvas(): void {
    if (this.elevatorCanvas === null) return
    const riding = this.riderSession
    if (riding === null) {
      this.elevatorCanvas.setVisible(false)
      return
    }
    this.elevatorCanvas.setVisible(true)
    const readout = this.elevatorPresenter?.carScreen()
    if (this.elevatorCanvasFloor !== null) {
      const label = readout?.floor ?? null
      this.elevatorCanvasFloor.setText(
        label === null
          ? ''
          : label === 'lobby'
            ? 'L'
            : label === 'mezzanine'
              ? 'M'
              : label.slice(-1),
      )
    }
    if (this.elevatorCanvasState !== null) {
      this.elevatorCanvasState.setText(readout?.state ?? '')
    }
    const carLabel = this.elevatorCanvas.getByName('carLabel') as Phaser.GameObjects.Text | null
    if (carLabel !== null) carLabel.setText(`car ${riding.car}`)
    const dirArrow = this.elevatorCanvas.getByName('dirArrow') as Phaser.GameObjects.Text | null
    const movingFrom = readout?.floor ?? null
    const movingTo =
      readout !== undefined && readout.state !== null && readout.state.startsWith('moving to ')
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
    const clock = this.elevatorPresenter?.clockOf(riding.car as 1 | 2)
    const swaying = clock?.phase === 'transit'
    this.elevatorCanvas.setY(swaying ? 288 + carSwayY(Date.now()) : 288)
    // The beyond-door glow: an arrival burst when the doors begin opening.
    if (this.elevatorCanvasBeyond !== null) {
      if (clock?.phase === 'opening') {
        if (this.elevatorCanvasBurstT0 < 0) this.elevatorCanvasBurstT0 = Date.now()
      } else {
        this.elevatorCanvasBurstT0 = -1
      }
      const burstElapsed =
        this.elevatorCanvasBurstT0 < 0 ? -1 : Date.now() - this.elevatorCanvasBurstT0
      this.elevatorCanvasBeyond.setAlpha(arrivalBurstAlpha(burstElapsed))
    }
    if (this.elevatorCanvasDoors !== null) {
      const amount = clock !== undefined ? doorsOpenAmount(clock, DEFAULT_ANIMATION_CONFIG) : 0
      this.elevatorCanvasDoors.left.x = -70 - amount * 66
      this.elevatorCanvasDoors.right.x = 70 + amount * 66
    }
    for (const [floorId, btn] of this.elevatorCanvasButtons) {
      const lit = riding.queue.includes(floorId)
      const here = readout?.floor === floorId
      btn.setFillStyle(lit ? 0xc8a24a : 0x1a2530)
      btn.setStrokeStyle(here ? 2 : 1, here ? 0xe6c56a : lit ? 0xe6c56a : 0x3d4a58)
    }
    if (this.elevatorCanvasOccupants !== null) {
      this.elevatorCanvasOccupants.removeAll(true)
      const names = riding.occupants.map((id) => this.rosterNames.get(id) ?? id)
      const isYou = (name: string) => name === (this.rosterNames.get(this.ownId) ?? '')
      const count = names.length
      names.forEach((name, idx) => {
        // Center the row on the carpet; 90px berths keep four riders legible.
        const x = (idx - (count - 1) / 2) * 90
        const headColor = this.occupantColor(name)
        const head = this.add.circle(x, -26, 13, headColor)
        const body = this.add.rectangle(x, 2, 26, 20, 0x2a3a4a)
        const label = this.add.text(x, 24, name.slice(0, 5 + 1), {
          fontSize: '9px',
          color: isYou(name) ? '#ffd98a' : '#dfe8f2',
          fontFamily: 'monospace',
        })
        label.setOrigin(0.5)
        if (isYou(name)) {
          head.setStrokeStyle(2, 0xe6c56a)
          body.setStrokeStyle(2, 0xe6c56a)
        }
        this.elevatorCanvasOccupants?.add([head, body, label])
      })
    }
  }

  private occupantColor(name: string): number {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
    const hue = hash % 360
    const c = Phaser.Display.Color.HSLToColor(hue / 360, 0.58, 0.5)
    return (c.red << 16) | (c.green << 8) | c.blue
  }

  /**
   * The stairwell interior, night-juice rework ("the climb"): a side-view
   * staircase the own sprite descends/ascends for the length of the transit —
   * drawn entirely in Phaser primitives on the AD-020 night palette (no new
   * sprite sheets; the deferred TILE_PX decision stays untouched). The clock
   * lives IN the scene as a brass wall sign (the climb owns the countdown —
   * the DOM stair bar retires to the breath window). Every member lives
   * inside the `stairCanvas` container: the ART harness contract counts only
   * top-level children, so nothing here pollutes it.
   */
  private createStairCanvasInterior(): void {
    const container = this.add.container(480, 288)
    container.setScrollFactor(0)
    container.setDepth(100)
    container.setVisible(false)
    container.setName('stairCanvas')
    // Night backdrop (AD-020 night/tension band: deep blue-violet shadow).
    container.add(this.add.rectangle(0, 0, 960, 576, 0x1d1830))
    container.add(this.add.rectangle(0, 120, 960, 336, 0x171226))
    // The scrolled stair band — one stride of stairwell, built once; the
    // per-visit direction only flips the climber and the scroll sign.
    const band = this.add.container(0, 0)
    band.setName('climbBand')
    container.add(band)
    this.climbBand = band
    this.buildClimbBand(band)
    // Brass wall sign: the integrated clock (the climb owns the countdown).
    const sign = this.add.rectangle(-150, -232, 236, 62, 0x0f1419)
    sign.setStrokeStyle(2, 0xd9a441)
    container.add(sign)
    const clock = this.add.text(-150, -232, '', {
      fontSize: '38px',
      color: '#ffd98a',
      fontFamily: 'monospace',
    })
    clock.setOrigin(0.5)
    clock.setName('stairClock')
    container.add(clock)
    this.stairCanvasClock = clock
    const arrow = this.add.text(-42, -232, '', {
      fontSize: '26px',
      color: '#e6c56a',
      fontFamily: 'monospace',
    })
    arrow.setOrigin(0.5)
    arrow.setName('stairArrow')
    container.add(arrow)
    this.stairCanvasArrow = arrow
    const dirLabel = this.add.text(212, -232, '', {
      fontSize: '11px',
      color: '#e6c56a',
      fontFamily: 'monospace',
    })
    dirLabel.setOrigin(1, 0.5)
    dirLabel.setName('stairDir')
    container.add(dirLabel)
    const route = this.add.text(-150, -192, '', {
      fontSize: '13px',
      color: '#9fb0c0',
      fontFamily: 'monospace',
    })
    route.setOrigin(0.5)
    route.setName('stairRoute')
    container.add(route)
    this.stairCanvasRoute = route
    const phase = this.add.text(-150, -172, '', {
      fontSize: '11px',
      color: '#e6c56a',
      fontFamily: 'monospace',
    })
    phase.setOrigin(0.5)
    phase.setName('stairPhase')
    container.add(phase)
    this.stairCanvasPhase = phase
    const title = this.add.text(-258, -232, 'STAIRWELL', {
      fontSize: '9px',
      color: '#66788a',
      fontFamily: 'monospace',
    })
    title.setOrigin(0, 0.5)
    container.add(title)
    // Scuffle/blackout FX stack, topmost: white impact flash, red shock
    // frame, the abstract dark bar (no silhouette — identity never leaks),
    // the blackout, and the heartbeat vignette.
    const flashWhite = this.add.rectangle(0, 0, 960, 576, 0xf2ede2, 0)
    const flashRed = this.add.rectangle(0, 0, 960, 576, 0xa03028, 0)
    const sweep = this.add.rectangle(0, 0, 150, 760, 0x0a0812, 0.9)
    sweep.setRotation(-0.32)
    const blackout = this.add.rectangle(0, 0, 960, 576, 0x050308, 0)
    const vignette = this.add.rectangle(0, 0, 960, 576, 0x000000, 0)
    vignette.setStrokeStyle(16, 0xb3402f)
    for (const fx of [flashWhite, flashRed, sweep, blackout, vignette]) {
      fx.setVisible(false)
      container.add(fx)
    }
    this.climbFx = { flashWhite, flashRed, sweep, blackout, vignette }
    this.stairCanvas = container
    // The breath chip (AD-040 amendment): the arrival breath happens ON the
    // destination floor, so the fullscreen box steps aside and only this
    // compact status chip stays — the own body renders at the mouth beneath.
    const chip = this.add.container(118, 52)
    chip.setScrollFactor(0)
    chip.setDepth(100)
    chip.setVisible(false)
    chip.setName('breathChip')
    const chipBg = this.add.rectangle(0, 0, 204, 56, 0x131b24, 0.92)
    chipBg.setStrokeStyle(1, 0x556677)
    chipBg.setOrigin(0.5)
    chip.add(chipBg)
    const chipLabel = this.add.text(0, -12, 'catching breath', {
      fontSize: '11px',
      color: '#8ad07a',
      fontFamily: 'monospace',
    })
    chipLabel.setOrigin(0.5)
    chipLabel.setName('breathLabel')
    chip.add(chipLabel)
    const chipClock = this.add.text(0, 12, '', {
      fontSize: '16px',
      color: '#ffd98a',
      fontFamily: 'monospace',
    })
    chipClock.setOrigin(0.5)
    chipClock.setName('breathClock')
    chip.add(chipClock)
    this.breathChipClock = chipClock
    this.breathChip = chip
  }

  /**
   * One stride of stairwell geometry (band-local, ascending to the right):
   * treads + risers in warm hotel neutrals, a railing with gold newel caps,
   * landing plates at both ends (glyphs set per visit), and the sconces the
   * per-frame flicker drives. Down-transits reuse the same geometry mirrored
   * by the scroll sign — the walker traverses it the other way.
   */
  private buildClimbBand(band: Phaser.GameObjects.Container): void {
    const stepH = CLIMB.stridePx / CLIMB.treads
    for (let i = 0; i <= CLIMB.treads; i++) {
      const { x, y } = stairPoint(i / CLIMB.treads)
      const tread = this.add.rectangle(x, y, CLIMB.treadRun, 14, 0xc9b28a)
      band.add(tread)
      if (i < CLIMB.treads) {
        const riser = this.add.rectangle(x - CLIMB.treadRun / 2, y + stepH / 2, 10, stepH, 0x8a7a5e)
        band.add(riser)
      }
      // Railing: baluster + handrail segment above every tread edge.
      const baluster = this.add.rectangle(x, y - 44, 5, 76, 0x4a4664)
      band.add(baluster)
      const rail = this.add.rectangle(x, y - 84, CLIMB.treadRun + 5, 8, 0x4a4664)
      band.add(rail)
      if (i % 2 === 0) {
        const cap = this.add.rectangle(x, y - 84, 14, 14, 0xd9a441)
        band.add(cap)
      }
      // Sconce every other step, on the back wall, flicker-driven per frame.
      if (i > 0 && i < CLIMB.treads && i % 2 === 1) {
        const bracket = this.add.rectangle(x - 110, y - 190, 8, 20, 0x55492c)
        band.add(bracket)
        const lamp = this.add.ellipse(x - 110, y - 210, 26, 34, 0xf0d9a8, 0.85)
        band.add(lamp)
        const glow = this.add.ellipse(x - 110, y - 200, 130, 150, 0xf0d9a8, 0.07)
        band.add(glow)
        this.climbSconces.push({ lamp, seed: i * 1.7 })
      }
    }
    // Landing plates + per-visit floor glyphs (from → to read on the wall).
    const plateW = CLIMB.treadRun * 2
    const landingFrom = this.add.rectangle(
      stairPoint(0).x - CLIMB.treadRun,
      stairPoint(0).y + 7,
      plateW,
      14,
      0xc9b28a,
    )
    band.add(landingFrom)
    const landingTo = this.add.rectangle(
      stairPoint(1).x + CLIMB.treadRun,
      stairPoint(1).y + 7,
      plateW,
      14,
      0xc9b28a,
    )
    band.add(landingTo)
    const glyphFrom = this.add.text(stairPoint(0).x - 150, stairPoint(0).y - 60, '', {
      fontSize: '44px',
      color: '#4a4664',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    })
    glyphFrom.setOrigin(0.5)
    glyphFrom.setName('stairGlyphFrom')
    band.add(glyphFrom)
    this.climbGlyphFrom = glyphFrom
    const glyphTo = this.add.text(stairPoint(1).x + 150, stairPoint(1).y - 60, '', {
      fontSize: '44px',
      color: '#4a4664',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    })
    glyphTo.setOrigin(0.5)
    glyphTo.setName('stairGlyphTo')
    band.add(glyphTo)
    this.climbGlyphTo = glyphTo
  }

  /**
   * Own breath-puff sprite (breath-sprites, BR-01/03): one looping
   * `fx-breath` sprite above the own body while the own readout is in
   * `breath`, destroyed otherwise. Own-viewer only — other players' breath
   * phase is not on the wire (messages.ts:398), so nothing here reads it.
   */
  private syncBreathSprite(breathing: boolean): void {
    const own = this.players.get(this.ownId)
    const canShow =
      breathing &&
      !this.spectator &&
      own !== undefined &&
      this.textures.exists('fx-breath') &&
      this.anims.exists('breath')
    if (!canShow) {
      this.breathSprite?.destroy()
      this.breathSprite = null
      return
    }
    if (this.breathSprite === null) {
      this.breathSprite = this.add.sprite(own.x, 0, 'fx-breath')
      this.breathSprite.setOrigin(0.5, 1)
      this.breathSprite.setDepth(1)
      this.breathSprite.setName('fx-breath-own')
      this.breathSprite.play('breath')
    }
    this.breathSprite.setPosition(own.x, this.laneY(own.floor) - 68)
    this.breathSprite.setVisible(!this.spectator && own.floor === this.viewFloor)
  }

  private syncStairCanvas(): void {
    const anchor = this.stairsAnchor
    const readout = anchor === null ? null : stairPhaseReadout(anchor, Date.now())
    // The breath is ON the destination floor (AD-040 amendment): no fullscreen
    // box — the chip carries the countdown while the floor view renders.
    const breathRemaining =
      readout !== null && readout.phase === 'breath' ? readout.remainingMs : null
    if (this.breathChip !== null) {
      this.breathChip.setVisible(breathRemaining !== null)
      if (breathRemaining !== null && this.breathChipClock !== null) {
        this.breathChipClock.setText(`${Math.ceil(breathRemaining / 1000)}s`)
      }
    }
    this.syncBreathSprite(breathRemaining !== null)
    if (this.stairCanvas === null || this.climbBand === null) return
    if (anchor === null || readout === null || breathRemaining !== null) {
      this.stairCanvas.setVisible(false)
      this.destroyClimber()
      return
    }
    this.stairCanvas.setVisible(true)
    // Building order gives the true direction; down-transits traverse the same
    // ascending geometry the other way (walk fraction mirrored).
    const order: readonly string[] = ['lobby', 'mezzanine', 'floor1', 'floor2', 'floor3']
    const dir2 = order.indexOf(anchor.to) > order.indexOf(anchor.from) ? 'up' : 'down'
    const label = (f: string) => (f === 'lobby' ? 'L' : f === 'mezzanine' ? 'M' : f.slice(-1))
    if (this.climbGlyphFrom !== null) this.climbGlyphFrom.setText(label(anchor.from))
    if (this.climbGlyphTo !== null) this.climbGlyphTo.setText(label(anchor.to))
    const stunned = readout.phase === 'stunned'
    // Band scroll: the walker sits at the fixed screen point (-60, 120); the
    // band slides so the stair surface stays under the feet (the lurch adds
    // its decaying kick right after a stun resumes the transit). A stun
    // freezes the walk at the ambush point — never a jump to the landing.
    let walk = this.lastTransitWalk
    if (readout.phase === 'transit') {
      walk = climbWalkFraction(readout.remainingMs)
      this.lastTransitWalk = walk
    }
    const shown = dir2 === 'up' ? walk : 1 - walk
    const point = stairPoint(shown)
    const lurchY = lurchKickY(Date.now() - this.climbLurchAtMs)
    // Derived, never hardcoded: the band sits so the stair surface under the
    // walker lands exactly at the fixed screen point (-60, 120).
    this.climbBand.setPosition(-60 - point.x, 120 - point.y + lurchY)
    // The climber: the own body, bobbing with the treads, playing the walk
    // cycle while moving; it freezes (frame 0) for the stun.
    const climber = this.ensureClimber()
    if (climber !== null) {
      climber.setPosition(-60, 120 - climbBobY(shown))
      climber.flipX = dir2 === 'down'
      if (readout.phase === 'transit') {
        if (!climber.anims.isPlaying) climber.play('staff-walk')
      } else if (climber.anims.isPlaying) {
        climber.anims.stop()
        climber.setFrame(0)
      }
    }
    // Sconce flicker (night-juice): every lamp wobbles on its own seed.
    const now = Date.now()
    for (const { lamp, seed } of this.climbSconces) lamp.setAlpha(sconceAlpha(now, seed))
    // The wall sign readouts — the climb owns the countdown.
    if (this.stairCanvasClock !== null) {
      this.stairCanvasClock.setText(`${Math.ceil(readout.remainingMs / 1000)}s`)
      this.stairCanvasClock.setColor(stunned ? '#ff9a8a' : '#ffd98a')
    }
    if (this.stairCanvasRoute !== null) {
      this.stairCanvasRoute.setText(`${label(anchor.from)} → ${label(anchor.to)}`)
    }
    if (this.stairCanvasPhase !== null) {
      const labels: Record<string, string> = {
        transit: 'moving',
        breath: 'catching breath',
        stunned: 'stunned',
      }
      this.stairCanvasPhase.setText(labels[readout.phase] ?? readout.phase)
      this.stairCanvasPhase.setColor(stunned ? '#ff7a6a' : '#e6c56a')
    }
    if (this.stairCanvasArrow !== null) {
      this.stairCanvasArrow.setText(dir2 === 'up' ? '▲' : '▼')
      this.stairCanvasArrow.setColor(stunned ? '#ff7a6a' : '#e6c56a')
    }
    const dirLabel = this.stairCanvas.getByName('stairDir') as Phaser.GameObjects.Text | null
    if (dirLabel !== null) dirLabel.setText(dir2 === 'up' ? '▲ up' : '▼ down')
    // The scuffle/blackout sequence (victim only, abstract — no silhouette).
    this.syncClimbFx(readout.phase, readout.remainingMs, now)
  }

  /** The container-owned climber sprite, created on first need, never
   *  top-level (the ART staff-walk harness counts must not see it). */
  private ensureClimber(): Phaser.GameObjects.Sprite | null {
    if (this.stairCanvas === null) return null
    if (this.climbClimber === null) {
      if (!this.textures.exists('staff-walk')) return null
      const sprite = this.add.sprite(-60, 120, 'staff-walk')
      sprite.setOrigin(0.5, 1)
      sprite.setName('climbClimber')
      this.stairCanvas.add(sprite)
      this.climbClimber = sprite
    }
    return this.climbClimber
  }

  private destroyClimber(): void {
    this.climbClimber?.destroy()
    this.climbClimber = null
  }

  /** Drive the scuffle/blackout FX stack from the stun clock (victim only). */
  private syncClimbFx(phase: string, remainingMs: number, nowMs: number): void {
    if (this.climbFx === null) return
    const { flashWhite, flashRed, sweep, blackout, vignette } = this.climbFx
    if (phase !== 'stunned') {
      for (const fx of [flashWhite, flashRed, sweep, blackout, vignette]) fx.setVisible(false)
      return
    }
    const total = this.stunTotalMs > 0 ? this.stunTotalMs : TUNING.STAIRS_STUN_SECONDS * 1000
    const elapsed = Math.max(0, total - remainingMs)
    const fx = stunFx(elapsed, nowMs)
    flashWhite.setVisible(fx.flashAlpha > 0).setAlpha(fx.flashAlpha)
    flashRed.setVisible(fx.redAlpha > 0).setAlpha(fx.redAlpha)
    const sweeping = fx.sweepX !== null
    sweep.setVisible(sweeping)
    if (fx.sweepX !== null) sweep.setX(fx.sweepX * 700)
    blackout.setVisible(fx.blackoutAlpha > 0).setAlpha(fx.blackoutAlpha)
    vignette.setVisible(fx.vignetteAlpha > 0).setAlpha(fx.vignetteAlpha)
  }

  /**
   * Stair audio cues (night-juice): a transition watcher over the own stairs
   * readout — footsteps during transit, an exhale at the breath, the sting +
   * heartbeat when the ambush lands, and the lurch (+ step resume) when the
   * interrupted transit continues. Loops are idempotent, so this is safe to
   * call every frame.
   */
  private syncStairCues(readout: { readonly phase: string } | null): void {
    const phase = readout?.phase ?? null
    if (phase === this.lastStairPhase) return
    const prev = this.lastStairPhase
    this.lastStairPhase = phase as 'transit' | 'breath' | 'stunned' | null
    if (phase === 'transit') {
      if (prev === 'stunned') {
        // The stun ended (event-order fallback — the mirror usually fired
        // first): kill the heartbeat; the lurch t0 is set there.
        sfx.heartbeatStop()
        if (this.climbLurchAtMs === 0) this.climbLurchAtMs = Date.now()
      }
      sfx.footstepStart()
    } else if (phase === 'breath') {
      sfx.footstepStop()
      sfx.breathExhale()
    } else if (phase === 'stunned') {
      sfx.footstepStop()
      sfx.ambushSting()
      sfx.heartbeatStart(CLIMB.heartbeatMs)
    } else {
      sfx.stopAll()
    }
  }

  /**
   * Elevator audio (night-juice): a transition watcher over the single car's
   * public presenter clock. A stop on the VIEWED floor (or the own ride)
   * dings and swings the doors; the rumble runs only while the local player
   * rides. Derived purely from existing payloads — no new wire messages.
   */
  private syncElevatorAudio(): void {
    const clock = this.elevatorPresenter?.clockOf(1)
    const phase = clock?.phase ?? null
    if (phase === this.lastCarPhase) return
    const prev = this.lastCarPhase
    this.lastCarPhase = phase
    if (clock === undefined || phase === null) return
    const riding = this.riderSession !== null
    const audible = riding || clock.floor === this.viewFloor
    if (phase === 'opening') {
      if (audible) {
        sfx.arrivalDing()
        sfx.doorWhoosh()
      }
    } else if (phase === 'closing') {
      if (audible) sfx.doorThunk()
    } else if (phase === 'transit') {
      if (riding) sfx.rumbleStart()
    } else if (prev === 'transit') {
      sfx.rumbleStop()
    }
  }

  /** The warm light spill (night-juice): while the car's doors stand open on
   *  the viewed floor, a soft amber pool on the landing tiles. */
  private syncSpillGlow(): void {
    if (this.spillGlow === null) return
    const clock = this.elevatorPresenter?.clockOf(1)
    const open =
      clock !== undefined &&
      clock.phase === 'open' &&
      clock.floor === this.viewFloor &&
      !this.spectator
    this.spillGlow.setVisible(open)
    if (open) this.spillGlow.setY(this.laneY(this.viewFloor))
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
    this.wallField?.setVisible(!this.spectator)
    this.wallFallback?.setVisible(!this.spectator)
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
    if (!this.spectator) {
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
    // FR-33 (3.4): tenancy signs for every floor (spectator sees every floor)
    for (const t of snapshot.tenancies ?? []) {
      this.tenancies.set(`${t.floor}:${t.room}`, t.occupied)
    }
    // Cosmetic seeds (Phase 4.1, VPOL-05): the full-world baseline carries
    // every player and guest seed — variants render per FR-20 lane.
    for (const row of snapshot.cosmeticSeeds?.players ?? []) {
      this.playerSeeds.set(row.playerId, row.seed)
      this.applyPlayerVariant(row.playerId)
    }
    for (const row of snapshot.cosmeticSeeds?.guests ?? []) {
      this.guestSeeds.set(row.guestId, row.seed)
    }
    this.syncTenancyMarkers()
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
        this.diningGuests.delete(action.guestId)
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
        // Night-juice: the hall-call blip (presentation-only; a decoy call
        // still rings — the flash does, so the chime does too).
        sfx.callBlip()
        break
      }
      case 'player-left': {
        const display = this.players.get(action.playerId)
        if (display !== undefined) {
          display.sprite.destroy()
          display.variant?.destroy()
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
        if (shouldShake('player-fired'))
          this.cameras.main.shake(JUICE.shake.durationMs, JUICE.shake.intensity)
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
        // and store it for the owned-marker hint. Check-in is also the
        // moment the guest seats itself in the mezzanine restaurant (the
        // sim re-places it onto a dining slot) — start the seated pose.
        this.heardAssignments.set(action.guestId, { floor: action.floor, room: action.room })
        this.diningGuests.add(action.guestId)
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
        // settle/complaint lines). SUI-13: the rest also re-targets the
        // guest out of the restaurant — end the seated pose.
        this.suitcases.set(action.guestId, {
          carrierId: null,
          rest: { floor: action.floor, room: action.room },
        })
        this.diningGuests.delete(action.guestId)
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
        // a local stun countdown (STAIRS-19). VPOL-16: the medium-tier
        // camera punch marks the beat.
        if (shouldShake('stairs-ambushed')) {
          this.cameras.main.shake(JUICE.shake.durationMs, JUICE.shake.intensity)
        }
        if (this.stairsAnchor !== null) {
          this.stunResumeMs = stairPhaseReadout(this.stairsAnchor, Date.now())?.remainingMs ?? 0
          this.stunTotalMs = action.stunSeconds * 1000
          this.climbLurchAtMs = 0
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
        // their own: they are mid-transit, anchored by their snapshot. The
        // screen never interrupts the saboteur (night-juice decision): one
        // sub-bass thump under the line, nothing more.
        this.showAmbushConfirm(action.victimId)
        sfx.subThump()
        break
      case 'room-tenancy': {
        // FR-33 (cycle 3.4): tenancy flip-sign per guest door — tenancy not presence.
        this.tenancies.set(`${action.floor}:${action.room}`, action.occupied)
        this.syncTenancyMarkers()
        break
      }
      case 'guest-angered': {
        // FR-29(b) stage 1: in-world anger cue at the room — room-number
        // level, no detail — the guest storms out. SameFloor delivery is the
        // transport gate. VPOL-15: the cue pops (Back.Out scale 0 → peak →
        // rest) and throws a short Graphics dust puff — transient juice, not
        // a static glyph.
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
        cue.setScale(0)
        cue.setVisible(this.spectator || action.floor === this.viewFloor)
        this.tweens.add({
          targets: cue,
          scale: { from: 0, to: JUICE.anger.scalePeak },
          duration: JUICE.anger.durationMs,
          ease: 'Back.Out',
          yoyo: false,
        })
        this.tweens.add({
          targets: cue,
          scale: 1,
          delay: JUICE.anger.durationMs,
          duration: 90,
          ease: 'Sine.easeOut',
        })
        this.angerDust(x, y, this.spectator || action.floor === this.viewFloor)
        this.angerCues.push({
          view: cue,
          until: Date.now() + JUICE.anger.ttlMs,
          floor: action.floor,
        })
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
      case 'cosmetic-player':
        // Phase 4.1 (VPOL-01): the public decorrelated seed lands here; the
        // variant renderer (T5) derives staff-body + staff-variant from it.
        this.playerSeeds.set(action.playerId, action.seed)
        this.applyPlayerVariant(action.playerId)
        break
      case 'cosmetic-guest':
        // Phase 4.1 (VPOL-06): the guest seed precedes/rides the guest stream;
        // the archetype renderer (T6) derives texture + tint from it.
        this.guestSeeds.set(action.guestId, action.seed)
        this.applyGuestVariant(action.guestId)
        break
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
    display.variant?.destroy()
    display.label.destroy()
    this.players.delete(playerId)
  }

  /**
   * Phase 4.1 (VPOL-02): apply the stored cosmetic seed to a live player
   * display — `variantIndex(seed % 8)` selects the head/accent overlay frame.
   * The mapping is pure seed → frame; role is unreachable here (VPOL-04).
   */
  private applyPlayerVariant(playerId: string): void {
    const display = this.players.get(playerId)
    const seed = this.playerSeeds.get(playerId)
    if (display === undefined || seed === undefined) return
    display.seed = seed
    if (display.variant !== null) display.variant.setFrame(variantIndexOf(seed))
  }

  /**
   * The archetype texture a guest renders right now: the standing silhouette,
   * or its derived `-sit` variant while seated at a restaurant table (the sit
   * art keeps the grayscale tint-carrier contract, VPOL-06). Falls back to
   * the standing texture when the sit variant failed to load.
   */
  private guestTextureFor(guestId: string, seated: boolean): string {
    const seed = this.guestSeeds.get(guestId) ?? 0
    const { archetype } = guestVariantOf(seed)
    const base = GUEST_ARCHETYPES[archetype] ?? 'guest-clerk'
    if (!seated) return base
    const sit = `${base}-sit`
    return this.textures.exists(sit) ? sit : base
  }

  /**
   * The dining slot a guest currently occupies, or null when it renders
   * standing. Seated ⇔ the client heard the check-in (guest:assigned →
   * diningGuests) AND the guest's authoritative position is at a dining
   * slot on the mezzanine — the floor gate also absorbs a dropCarry
   * re-queue, which emits no dedicated message.
   */
  private seatedSlotOf(guestId: string, g: { floor: FloorId; x: number }): number | null {
    if (!this.diningGuests.has(guestId) || g.floor !== 'mezzanine') return null
    return diningSlotAtXTiles(g.x)
  }

  /**
   * Phase 4.1 (VPOL-06): apply the stored guest seed to a live guest view —
   * re-derives texture + palette tint. The seed may arrive before the view
   * exists (then syncGuests consumes it at creation) or after (this path
   * re-textures in place).
   */
  private applyGuestVariant(guestId: string): void {
    const view = this.guestViews.get(guestId)
    const seed = this.guestSeeds.get(guestId)
    if (view === undefined || seed === undefined) return
    const { palette } = guestVariantOf(seed)
    const g = this.guests.get(guestId)
    const seated = g !== undefined && this.seatedSlotOf(guestId, g) !== null
    const texture = this.guestTextureFor(guestId, seated)
    if (this.textures.exists(texture)) view.setTexture(texture)
    const base = GUEST_PALETTES[palette] ?? 0x5a9aaa
    view.setTint(g?.floor === 'mezzanine' ? blendTint(base, DINING_FILL, 0.45) : base)
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

  /**
   * VPOL-15 anger dust: `dustCount` tiny Graphics puffs that scatter outward
   * and fade — pure decoration, destroyed on tween complete.
   */
  private angerDust(x: number, y: number, visible: boolean): void {
    for (let i = 0; i < JUICE.anger.dustCount; i++) {
      const dust = this.add.circle(x, y, 3, 0xa4b06a, 0.55)
      dust.setDepth(99)
      dust.setVisible(visible)
      const dir = i % 2 === 0 ? 1 : -1
      this.tweens.add({
        targets: dust,
        x: x + dir * (5 + i * 3),
        y: y - 4 - i * 2,
        alpha: 0,
        duration: JUICE.anger.dustDurationMs,
        ease: 'Sine.easeOut',
        onComplete: () => dust.destroy(),
      })
    }
  }

  /** Track roster growth/shrink from lobby snapshots (players join over time). */
  syncRoster(players: readonly WorldPlayerEntry[]): void {
    const known = new Set(players.map((p) => p.id))
    for (const [id, display] of this.players) {
      if (known.has(id)) continue
      display.sprite.destroy()
      display.variant?.destroy()
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
    // FR-33 (3.4): tenancy signs for the viewer's floor
    for (const t of snapshot.tenancies ?? []) {
      this.tenancies.set(`${t.floor}:${t.room}`, t.occupied)
    }
    this.syncTenancyMarkers()
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
    // Cosmetic seeds (Phase 4.1, VPOL-05): snapshot rows re-derive identical
    // variants for late joiners and reconnects — same pure mapping as the
    // dealt events.
    for (const row of snapshot.cosmeticSeeds?.players ?? []) {
      this.playerSeeds.set(row.playerId, row.seed)
      this.applyPlayerVariant(row.playerId)
    }
    for (const row of snapshot.cosmeticSeeds?.guests ?? []) {
      this.guestSeeds.set(row.guestId, row.seed)
    }
    this.updatePanel()
  }

  private addPlayerDisplay(id: string, name: string): void {
    const x = 15
    // ART-01: one staff-walk Sprite per player, bottom-center anchored on the
    // lane ground line — identical texture/anim for every role (FR-9). The
    // variant overlay (Phase 4.1, VPOL-02) rides the same anchor; the label
    // stays a Text (harness label assertions unchanged).
    const sprite = this.add.sprite(x * TILE_PX, GROUND_Y, 'staff-walk')
    sprite.setOrigin(0.5, 1)
    const variant = this.textures.exists('staff-variant')
      ? this.add.sprite(x * TILE_PX, GROUND_Y, 'staff-variant')
      : null
    variant?.setOrigin(0.5, 1)
    const seed = this.playerSeeds.get(id)
    if (variant !== null && seed !== undefined) variant.setFrame(variantIndexOf(seed))
    const label = this.add.text(x * TILE_PX, GROUND_Y + 48, name.slice(0, 12), {
      color: '#ffffff',
    })
    label.setOrigin(0.5, 0.5)
    this.players.set(id, {
      sprite,
      variant,
      label,
      x,
      floor: 'lobby',
      targetX: null,
      left: false,
      facing: 'right',
      ...(seed !== undefined ? { seed } : {}),
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
    sfx.buttonClick()
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

  /** Guest marker sync (called every frame): one archetype Sprite per guest
   *  on the viewed floor (Phase 4.1, VPOL-06) — texture + palette from the
   *  decorrelated guest seed; dining guests shift toward amber (VPOL-08) and
   *  sit at their restaurant slot (furnishing slice); foot-tap yoyo while its
   *  free impatience cue is active (GUEST-13/VPOL-14). */
  private tapProxies = new Map<string, { offset: number }>()

  private syncGuests(delta: number): void {
    void delta
    for (const [id, g] of this.guests) {
      let view = this.guestViews.get(id)
      const laneY = this.laneY(g.floor)
      const seatedSlot = this.seatedSlotOf(id, g)
      if (view === undefined) {
        const texture = this.guestTextureFor(id, seatedSlot !== null)
        if (!this.textures.exists(texture)) continue
        view = this.add.sprite(g.x * TILE_PX, laneY, texture)
        view.setOrigin(0.5, 1)
        this.guestViews.set(id, view)
      }
      const visible = this.spectator || g.floor === this.viewFloor
      view.setVisible(visible)
      view.x = g.x * TILE_PX
      // Seated pose (furnishing slice): the sit texture rides the seat-top
      // lift, tucked behind the shared table; west-facing slots flip. A
      // texture change here also covers the dining→standing transitions the
      // seed event can miss (applyGuestVariant re-derives the same way).
      const wantTexture = this.guestTextureFor(id, seatedSlot !== null)
      if (view.texture.key !== wantTexture && this.textures.exists(wantTexture)) {
        view.setTexture(wantTexture)
      }
      view.setDepth(seatedSlot !== null ? SEATED_GUEST_DEPTH : 0)
      view.setFlipX(seatedSlot !== null && !diningSlotFacesEast(seatedSlot))
      // VPOL-14: the impatience cue is a Tween-driven yoyo bounce around the
      // lane line (a proxy offset survives floor teleports; the frame sync
      // only reads it).
      const impatient = this.impatientGuests.has(id)
      let proxy = this.tapProxies.get(id)
      if (impatient && proxy === undefined) {
        proxy = { offset: 0 }
        this.tapProxies.set(id, proxy)
        this.tweens.add({
          targets: proxy,
          offset: { from: 0, to: -JUICE.footTap.distancePx },
          duration: JUICE.footTap.durationMs,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
        })
      } else if (!impatient && proxy !== undefined) {
        this.tweens.killTweensOf(proxy)
        this.tapProxies.delete(id)
      }
      const seatLift = seatedSlot !== null ? CHAIR_SEAT_TOP_PX : 0
      view.y = laneY - seatLift - (proxy?.offset ?? 0)
      const seed = this.guestSeeds.get(id) ?? 0
      const { palette } = guestVariantOf(seed)
      const base = GUEST_PALETTES[palette] ?? 0x5a9aaa
      view.setTint(g.floor === 'mezzanine' ? blendTint(base, DINING_FILL, 0.45) : base)
    }
    for (const [id, view] of this.guestViews) {
      if (!this.guests.has(id)) {
        const proxy = this.tapProxies.get(id)
        if (proxy !== undefined) {
          this.tweens.killTweensOf(proxy)
          this.tapProxies.delete(id)
        }
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
    // Room zoom (room-zoom spec R4): the layer carries the world-anchored
    // markers, so it transforms WITH the camera — origin top-left, the same
    // mapping screen = (world − scroll) × zoom the canvas renders by.
    layer.style.transformOrigin = '0 0'
    gameEl.appendChild(layer)
    this.evidenceLayer = layer
    // The screen-space sibling (room zoom R4): HUD chips that must NOT move
    // with the world — the sound toggle, the ambush toast/confirm.
    const ui = document.createElement('div')
    ui.id = 'ui-layer'
    ui.style.position = 'absolute'
    ui.style.inset = '0'
    ui.style.pointerEvents = 'none'
    gameEl.appendChild(ui)
    this.uiLayer = ui
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
    // The sound toggle (night-juice): one chip, top-right, session-persisted.
    ui.appendChild(buildSfxToggle())
    // Interior-full suppression (AD-054 fold-in): while a fullscreen interior
    // (the climb / the scenic car) is up, the world-space DOM markers must
    // not float over the scene. One body class hides them all with
    // !important — the markers' own per-frame inline visibility writes lose
    // to it, so no per-marker bookkeeping is needed.
    const suppressStyleId = 'interior-full-suppress'
    if (document.getElementById(suppressStyleId) === null) {
      const suppress = document.createElement('style')
      suppress.id = suppressStyleId
      suppress.textContent = `
body.interior-full [data-tenancy-key],
body.interior-full [data-room-key],
body.interior-full [data-cue-id],
body.interior-full #stairwell-marker,
body.interior-full #desk-bell {
  visibility: hidden !important;
}
`
      document.head.appendChild(suppress)
    }
  }

  private roomCenterPx(room: RoomIndex): number {
    const centerMilli = (roomSegmentStartMilli(room) + roomSegmentEndMilli(room)) / 2
    return (centerMilli / 1000) * TILE_PX
  }

  /**
   * Furnishing (lobby + mezzanine restaurant, furnishing slice): wall-plane
   * Images from the anchors in scenes/furniture.ts — the reception desk on
   * the E zone, lobby seating, and the dining set pinned to the sim's
   * mezzanine slot formula. Live view only (the spectator overview's stacked
   * lanes stay plain, like the corridor band); per-frame visibility rides
   * syncFurniture(). Images, never Rectangles (LIGHT-09 harness contract);
   * names follow the `furniture:<floor>:<name>` filter convention.
   */
  private buildFurniture(): void {
    const plan: readonly (readonly [FloorId, readonly FurnitureAnchor[]])[] = [
      ['lobby', LOBBY_FURNITURE],
      ['mezzanine', [...MEZZANINE_FURNITURE, ...diningFurniture()]],
    ]
    for (const [floor, anchors] of plan) {
      const views: Phaser.GameObjects.Image[] = []
      for (const anchor of anchors) {
        if (!this.textures.exists(anchor.texture)) continue
        const image = this.add.image(anchor.xTiles * TILE_PX, GROUND_Y, anchor.texture)
        image.setOrigin(0.5, 1)
        image.setDepth(anchor.depth)
        image.setName(`furniture:${floor}:${anchor.name}`)
        if (anchor.flipX === true) image.setFlipX(true)
        image.setVisible(false)
        views.push(image)
      }
      this.furniture.set(floor, views)
    }
  }

  /** Furniture follows the own view floor (synced once per frame). */
  private syncFurniture(): void {
    for (const [floor, views] of this.furniture) {
      const visible = !this.spectator && floor === this.viewFloor
      for (const view of views) view.setVisible(visible)
    }
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

  /** Tenancy flip-sign per guest door (FR-33, cycle 3.4): Occupied/Vacant, hallway-visible sameFloor. */
  private syncTenancyMarkers(): void {
    const layer = this.evidenceLayer
    if (layer === null) return
    // Ensure every guest-floor room has a marker (vacant by default); updates change text.
    for (const floor of ['floor1', 'floor2', 'floor3'] as const) {
      for (let room = 1; room <= ROOMS_PER_FLOOR; room++) {
        const key = `${floor}:${room}`
        let marker = this.tenancyMarkers.get(key)
        if (marker === undefined) {
          marker = document.createElement('div')
          marker.dataset.tenancyKey = key
          marker.dataset.floor = floor
          marker.dataset.room = String(room)
          marker.style.position = 'absolute'
          marker.style.left = `${this.roomCenterPx(room as RoomIndex) - 28}px`
          marker.style.width = '56px'
          marker.style.padding = '1px 0'
          marker.style.textAlign = 'center'
          marker.style.fontSize = '10px'
          marker.style.borderRadius = '2px'
          marker.style.border = '1px solid #777'
          layer.appendChild(marker)
          this.tenancyMarkers.set(key, marker)
        }
        const occupied = this.tenancies.get(key) ?? false
        marker.textContent = occupied ? 'Occupied' : 'Vacant'
        marker.style.background = occupied ? '#3a6b4a' : '#4a4a4a'
        marker.style.color = '#f0f0f0'
      }
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
    // Tenancy signs are round-scoped like cards — guests die with the sim (GUEST-11)
    this.tenancies.clear()
    for (const el of this.tenancyMarkers.values()) el.remove()
    this.tenancyMarkers.clear()
    this.cueNodes.clear()
    if (this.evidenceLayer !== null) this.evidenceLayer.replaceChildren()
    // Recreate the vacant sign set so every door shows Vacant on the fresh deal
    this.syncTenancyMarkers()
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
    if (this.uiLayer === null) return
    if (this.ambushToast === null) {
      const el = document.createElement('div')
      el.id = 'ambush-toast'
      el.style.cssText =
        'position:absolute;left:50%;top:64px;transform:translateX(-50%);' +
        'background:#2a1414;border:1px solid #ff7a6a;color:#ff9a8a;border-radius:8px;' +
        'padding:8px 16px;font:13px ui-monospace,monospace;letter-spacing:1px;' +
        'box-shadow:0 0 18px rgba(255,90,70,0.35);'
      this.uiLayer.appendChild(el)
      this.ambushToast = { el, until: 0 }
    }
    this.ambushToast.until = Date.now() + stunSeconds * 1000
  }

  /** The saboteur's private confirmation line (STAIRS-19), shown briefly. */
  private showAmbushConfirm(victimId: string): void {
    if (this.uiLayer === null) return
    if (this.ambushConfirm === null) {
      const el = document.createElement('div')
      el.id = 'ambush-confirm'
      el.style.cssText =
        'position:absolute;left:50%;bottom:70px;transform:translateX(-50%);' +
        'background:#14211a;border:1px solid #8ad07a;color:#a8e29a;border-radius:8px;' +
        'padding:6px 14px;font:12px ui-monospace,monospace;letter-spacing:1px;'
      this.uiLayer.appendChild(el)
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
    // Stairs clock (AD-040), one readout per frame: it gates the own body,
    // applies the breath arrival, and drives the visit-end mirror below.
    const stairReadout =
      this.stairsAnchor === null ? null : stairPhaseReadout(this.stairsAnchor, Date.now())
    if (stairReadout !== null && stairReadout.phase === 'breath') {
      // The breath stands ON the destination floor (AD-040 amendment): the
      // moment the local clock rolls into the breath, the own display moves
      // to the destination mouth — the server's arrival flush and personal
      // snapshot reconcile it a tick later.
      const breathOwn = this.players.get(this.ownId)
      if (breathOwn !== undefined && this.stairsAnchor !== null) {
        if (breathOwn.floor !== this.stairsAnchor.to || breathOwn.x !== 0) {
          breathOwn.floor = this.stairsAnchor.to
          breathOwn.x = 0
          breathOwn.targetX = null
          this.viewFloor = this.stairsAnchor.to
        }
      }
    }
    const ownInStairBox = stairReadout !== null && stairReadout.phase !== 'breath'
    // Local prediction for the own rectangle; server positions reconcile it.
    const own = this.players.get(this.ownId)
    if (own !== undefined && this.ownMoving !== null) {
      own.x += this.ownMoving === 'left' ? -SPEED_TILES_PER_SEC * dt : SPEED_TILES_PER_SEC * dt
      own.x = Math.min(30, Math.max(0, own.x))
    }
    // Room zoom (room-zoom spec): integer 2× focus WHILE the own player
    // runs a work channel (FR-7/8/9) — eased per frame, EXACT identity at
    // rest. The policy lives in the presenter (one home, AD-037 pinch);
    // the camera and the world-anchored DOM marker layer apply the same
    // view, so markers stay in lockstep with the canvas (R4).
    this.syncRoomZoom(dt, own, ownInStairBox, this.work !== null)
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
        // only while transit/stunned — a breathing player stands on the
        // destination floor and renders like any occupant.
        !(id === this.ownId && ownInStairBox) &&
        (this.spectator || display.floor === this.viewFloor)
      display.sprite.setVisible(visible)
      display.variant?.setVisible(visible)
      display.label.setVisible(visible)
      const px = display.x * TILE_PX
      display.sprite.x = px
      display.variant?.setPosition(px, laneY)
      display.label.x = px
      display.sprite.y = laneY
      display.label.y = laneY + 48
      // ART-02/03: facing + walk cycle. The own player's facing follows the
      // local prediction; remote players keep their last moved facing. The
      // walk plays while the display is live (predicted own movement or an
      // unsettled lerp target) and settles back to frame 0 when stopped —
      // identical presentation for every role (FR-9). The variant overlay
      // mirrors facing pixel-for-pixel (VPOL-02 flipX parity).
      if (id === this.ownId && this.ownMoving !== null) display.facing = this.ownMoving
      const moving =
        (id === this.ownId && this.ownMoving !== null) ||
        (display.targetX !== null && Math.abs(display.targetX - display.x) > 0.01)
      const flip = display.facing === 'left'
      display.sprite.flipX = flip
      if (display.variant !== null) {
        display.variant.flipX = flip
        display.variant.setVisible(visible)
      }
      if (moving) {
        if (!display.sprite.anims.isPlaying) display.sprite.play('staff-walk')
      } else if (display.sprite.anims.isPlaying) {
        display.sprite.anims.stop()
        display.sprite.setFrame(0)
      }
      // VPOL-13: the settle pop fires exactly on the moving→idle transition —
      // a small spring back to rest scale (never during the stride).
      const wasMoving = display.wasMoving ?? false
      if (wasMoving && !moving && !display.sprite.anims.isPlaying) {
        const targets =
          display.variant !== null ? [display.sprite, display.variant] : [display.sprite]
        this.tweens.add({
          targets,
          scale: { from: JUICE.settle.scaleFrom, to: 1 },
          duration: JUICE.settle.durationMs,
          ease: JUICE.settle.ease,
        })
      }
      display.wasMoving = moving
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
    // FR-33 (3.4): tenancy signs follow the same floor-lane visibility rule
    this.syncTenancyMarkers()
    for (const [key, marker] of this.tenancyMarkers) {
      const floor = key.split(':')[0] ?? ''
      marker.style.top = `${this.laneY(floor) - 148}px`
      marker.style.visibility = this.spectator || floor === this.viewFloor ? 'visible' : 'hidden'
    }
    for (const [cueId, node] of this.cueNodes) {
      const cue = this.evidence.cues.find((c) => c.id === cueId)
      if (cue === undefined) continue
      node.style.top = `${this.laneY(cue.floor) - (cue.kind === 'rustle' ? 100 : 160)}px`
    }
    this.syncCues()
    this.syncDoors()
    this.syncFurniture()
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
    if (this.stairsAnchor !== null && stairReadout === null) {
      if (this.stairsAnchor.phase === 'stunned' && this.stunResumeMs > 0) {
        // The stun ended: the interrupted transit resumes with its
        // preserved remainder. Night-juice: the heartbeat dies here and the
        // climb's resume lurch takes its t0 (exactly once per stun).
        sfx.heartbeatStop()
        if (this.climbLurchAtMs === 0) this.climbLurchAtMs = Date.now()
        this.stairsAnchor = {
          from: this.stairsAnchor.from,
          to: this.stairsAnchor.to,
          phase: 'transit',
          remainingMs: this.stunResumeMs,
          anchoredAtMs: Date.now(),
        }
        this.stunResumeMs = 0
      } else {
        const ownEnd = this.players.get(this.ownId)
        if (ownEnd !== undefined) {
          ownEnd.floor = this.stairsAnchor.to
          ownEnd.x = 0
          ownEnd.targetX = null
        }
        this.stairsAnchor = null
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
    this.syncElevatorCanvas()
    // The stair screen's DOM twin (night-juice): retired to the BREATH only.
    // The climb canvas owns the transit/stun readouts (integrated wall-sign
    // clock), so the DOM bar shows just the breath window — its hidden
    // attribute stays the harness contract after the visit ends.
    {
      const domReadout =
        this.stairsAnchor === null ? null : stairPhaseReadout(this.stairsAnchor, Date.now())
      syncStairScreen(
        domReadout !== null && domReadout.phase === 'breath' ? this.stairsAnchor : null,
        Date.now(),
      )
    }
    this.syncStairCanvas()
    // Night-juice audio watchers + landing light spill (idempotent per frame).
    this.syncStairCues(stairReadout)
    this.syncElevatorAudio()
    this.syncSpillGlow()
    // Interior-full suppression (AD-054 fold-in): world-space DOM markers
    // (Vacant/Occupied, CARD, cues, the stairs glyph, desk bell) hide while
    // a fullscreen interior scene is up — they return the frame it ends.
    document.body.classList.toggle(
      'interior-full',
      (this.stairCanvas?.visible ?? false) || (this.elevatorCanvas?.visible ?? false),
    )
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

  /**
   * Room zoom (room-zoom spec): one eased step per frame toward the frame's
   * target view, applied to the camera and — through the same transform — to
   * the world-anchored DOM marker layer, so cards, tenancy signs, cues, and
   * the stairs glyph track their world positions while zoomed (R4). At rest
   * the view is the EXACT identity (R3): zoom 1, scroll (0, 0), empty layer
   * transform. The zoom runs only while `channeling` (a live work channel of
   * the own player); spectators and floorless states (riding, stair box)
   * never zoom — the policy is the presenter's, not mirrored here.
   */
  private syncRoomZoom(
    dt: number,
    own: PlayerDisplay | undefined,
    ownInStairBox: boolean,
    channeling: boolean,
  ): void {
    const active = roomZoomActive({
      spectator: this.spectator,
      riding: this.riderSession !== null,
      inStairBox: ownInStairBox,
      channeling,
      floor: own?.floor ?? null,
      xTiles: own?.x ?? null,
    })
    const cam = this.cameras.main
    const target = zoomTarget(
      active,
      (own?.x ?? 0) * TILE_PX,
      this.laneY(own?.floor ?? this.viewFloor),
      cam.width,
      cam.height,
    )
    this.zoomView = advanceZoom(this.zoomView, target, dt)
    cam.setZoom(this.zoomView.zoom)
    cam.setScroll(this.zoomView.scrollX, this.zoomView.scrollY)
    if (this.evidenceLayer !== null) {
      this.evidenceLayer.style.transform = zoomLayerTransform(this.zoomView)
    }
  }
}
