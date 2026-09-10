import type Phaser from 'phaser'
import {
  CHAIR_SEAT_TOP_PX,
  DINING_FILL,
  diningSlotAtXTiles,
  diningSlotFacesEast,
  SEATED_GUEST_DEPTH,
  TILE_PX,
} from './furniture'
import { GUEST_ARCHETYPES, GUEST_PALETTES, type GuestArchetype, guestVariantOf } from './guestArt'
import { JUICE } from './juice'

/**
 * GuestsView (Phase 4.1 + GUEST-13 + the 3.C furnishing slice): the guest NPC
 * sprites as a view module — one interface, one sync per frame. It owns the
 * guest sprite map, the archetype/palette variant derivation from the
 * decorrelated guest seeds (VPOL-06/07), the seated dining pose (sit texture
 * at the restaurant slot, VPOL-08) and the foot-tap yoyo proxies while a
 * guest's free impatience cue is active (GUEST-13/VPOL-14), plus the desk-bell
 * line's visibility rule (an impatient guest queueing in the lobby).
 *
 * Facts, not sources: the scene keeps the guest/dining/impatient state maps
 * (message-driven) and hands them over each frame with its view context; the
 * view derives every pixel. Sprite views are plain top-level children — the
 * scene-children contract counts player Rectangles and car Ellipses, and
 * guests are neither.
 */
export interface GuestFact {
  readonly floor: string
  readonly x: number
}

export interface GuestsViewInput {
  readonly guests: ReadonlyMap<string, GuestFact>
  readonly seeds: ReadonlyMap<string, number>
  /** Guests who heard their check-in notice and still carry (dining pose gate). */
  readonly dining: ReadonlySet<string>
  readonly impatient: ReadonlySet<string>
  readonly spectator: boolean
  readonly viewFloor: string
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

export class GuestsView {
  private readonly scene: Phaser.Scene
  private readonly laneY: (floor: string) => number
  private readonly deskBell: HTMLElement | null
  private readonly views = new Map<string, Phaser.GameObjects.Sprite>()
  /** Foot-tap tween proxies (VPOL-14): a proxy offset survives floor
   *  teleports; the frame sync only reads it. */
  private readonly tapProxies = new Map<string, { offset: number }>()
  private input: GuestsViewInput | null = null

  constructor(scene: Phaser.Scene, laneY: (floor: string) => number, deskBell: HTMLElement | null) {
    this.scene = scene
    this.laneY = laneY
    this.deskBell = deskBell
  }

  /** Re-derive texture + tint for one guest from its stored seed — the seed
   *  may arrive before the view exists (sync consumes it at creation) or
   *  after (this path re-textures in place). Reads the last sync's facts. */
  applyVariant(guestId: string): void {
    const input = this.input
    if (input === null) return
    const view = this.views.get(guestId)
    const seed = input.seeds.get(guestId)
    if (view === undefined || seed === undefined) return
    const g = input.guests.get(guestId)
    const seated = g !== undefined && this.seatedSlotOf(input, guestId, g) !== null
    const texture = this.textureFor(input, guestId, seated)
    if (this.scene.textures.exists(texture)) view.setTexture(texture)
    const { palette } = guestVariantOf(seed)
    const base = GUEST_PALETTES[palette] ?? 0x5a9aaa
    view.setTint(g?.floor === 'mezzanine' ? blendTint(base, DINING_FILL, 0.45) : base)
  }

  sync(input: GuestsViewInput): void {
    this.input = input
    for (const [id, g] of input.guests) {
      let view = this.views.get(id)
      const laneY = this.laneY(g.floor)
      const seatedSlot = this.seatedSlotOf(input, id, g)
      if (view === undefined) {
        const texture = this.textureFor(input, id, seatedSlot !== null)
        if (!this.scene.textures.exists(texture)) continue
        view = this.scene.add.sprite(g.x * TILE_PX, laneY, texture)
        view.setOrigin(0.5, 1)
        this.views.set(id, view)
      }
      const visible = input.spectator || g.floor === input.viewFloor
      view.setVisible(visible)
      view.x = g.x * TILE_PX
      // Seated pose (furnishing slice): the sit texture rides the seat-top
      // lift, tucked behind the shared table; west-facing slots flip. A
      // texture change here also covers the dining→standing transitions the
      // seed event can miss (applyVariant re-derives the same way).
      const wantTexture = this.textureFor(input, id, seatedSlot !== null)
      if (view.texture.key !== wantTexture && this.scene.textures.exists(wantTexture)) {
        view.setTexture(wantTexture)
      }
      view.setDepth(seatedSlot !== null ? SEATED_GUEST_DEPTH : 0)
      view.setFlipX(seatedSlot !== null && !diningSlotFacesEast(seatedSlot))
      // VPOL-14: the impatience cue is a Tween-driven yoyo bounce around the
      // lane line (a proxy offset survives floor teleports; the frame sync
      // only reads it).
      const impatient = input.impatient.has(id)
      let proxy = this.tapProxies.get(id)
      if (impatient && proxy === undefined) {
        proxy = { offset: 0 }
        this.tapProxies.set(id, proxy)
        this.scene.tweens.add({
          targets: proxy,
          offset: { from: 0, to: -JUICE.footTap.distancePx },
          duration: JUICE.footTap.durationMs,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
        })
      } else if (!impatient && proxy !== undefined) {
        this.scene.tweens.killTweensOf(proxy)
        this.tapProxies.delete(id)
      }
      const seatLift = seatedSlot !== null ? CHAIR_SEAT_TOP_PX : 0
      view.y = laneY - seatLift - (proxy?.offset ?? 0)
      const seed = input.seeds.get(id) ?? 0
      const { palette } = guestVariantOf(seed)
      const base = GUEST_PALETTES[palette] ?? 0x5a9aaa
      view.setTint(g.floor === 'mezzanine' ? blendTint(base, DINING_FILL, 0.45) : base)
    }
    for (const [id, view] of this.views) {
      if (!input.guests.has(id)) {
        const proxy = this.tapProxies.get(id)
        if (proxy !== undefined) {
          this.scene.tweens.killTweensOf(proxy)
          this.tapProxies.delete(id)
        }
        view.destroy()
        this.views.delete(id)
      }
    }
    if (this.deskBell !== null) {
      const anyImpatient = [...input.impatient].some(
        (id) => input.guests.get(id)?.floor === 'lobby',
      )
      this.deskBell.style.visibility =
        anyImpatient && (input.spectator || input.viewFloor === 'lobby') ? 'visible' : 'hidden'
    }
  }

  /**
   * The dining slot a guest currently occupies, or null when it renders
   * standing. Seated ⇔ the client heard the check-in (guest:assigned →
   * dining set) AND the guest's authoritative position is at a dining slot
   * on the mezzanine — the floor gate also absorbs a dropCarry re-queue,
   * which emits no dedicated message.
   */
  private seatedSlotOf(
    input: GuestsViewInput,
    guestId: string,
    g: { floor: string; x: number },
  ): number | null {
    if (!input.dining.has(guestId) || g.floor !== 'mezzanine') return null
    return diningSlotAtXTiles(g.x)
  }

  /**
   * The archetype texture a guest renders right now: the standing silhouette,
   * or its derived `-sit` variant while seated at a restaurant table (the sit
   * art keeps the grayscale tint-carrier contract, VPOL-06). Falls back to
   * the standing texture when the sit variant failed to load.
   */
  private textureFor(input: GuestsViewInput, guestId: string, seated: boolean): string {
    const seed = input.seeds.get(guestId) ?? 0
    const { archetype } = guestVariantOf(seed)
    const base: GuestArchetype = GUEST_ARCHETYPES[archetype] ?? 'guest-clerk'
    if (!seated) return base
    const sit = `${base}-sit`
    return this.scene.textures.exists(sit) ? sit : base
  }
}
