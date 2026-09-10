import type { RoomIndex } from '@turnover/shared'
import type Phaser from 'phaser'
import {
  dropCues,
  type EvidenceAction,
  type EvidenceSession,
  initialEvidenceSession,
  liveCues,
  reduceEvidence,
} from '../evidenceSession'

/**
 * EvidenceView (cycle 2.7, EVID-19 + 3.3 cues): the evidence session and its
 * world-anchored DOM markers as a view module — the CARD glyphs per carded
 * room and the short-lived cue nodes (rustle / door). One `reduce` per
 * evidence-relevant action (the session reducer filters by kind itself), one
 * marker sync per frame (create-on-demand, TTL expiry), one position pass
 * under the room zoom's transform.
 *
 * It does NOT own the marker layer element: `#evidence-layer` is the shared
 * world-anchored DOM surface (tenancy signs and the stairwell marker ride the
 * same transform), so the scene builds it and hands the element over. Card
 * markers position via the room-center callback; cue nodes pin to the room's
 * lane line via the lane callback — the scene's geometry stays the scene's.
 */
export class EvidenceView {
  private readonly scene: Phaser.Scene
  private readonly layer: HTMLElement | null
  private readonly roomCenterPx: (room: RoomIndex) => number
  private readonly laneY: (floor: string) => number
  private session: EvidenceSession = initialEvidenceSession()
  private readonly cardMarkers = new Map<string, HTMLElement>()
  private readonly cueNodes = new Map<number, HTMLElement>()

  constructor(
    scene: Phaser.Scene,
    layer: HTMLElement | null,
    roomCenterPx: (room: RoomIndex) => number,
    laneY: (floor: string) => number,
  ) {
    this.scene = scene
    this.layer = layer
    this.roomCenterPx = roomCenterPx
    this.laneY = laneY
  }

  /** The live session — the scene reads it for door-render facts (entered
   *  cues tint doors) without owning the state. */
  get state(): EvidenceSession {
    return this.session
  }

  /** Reduce one evidence-relevant action (session reducer filters by kind). */
  reduce(action: EvidenceAction, nowMs: number): void {
    this.session = reduceEvidence(this.session, action, nowMs)
  }

  /** Snapshot seed (FR-20/spectator + reconnect): every already-carded room
   *  of every floor becomes a card fact. */
  seedCardedRooms(
    rows: readonly { readonly floor: string; readonly rooms: readonly number[] }[],
    nowMs: number,
  ): void {
    for (const floorRow of rows) {
      for (const room of floorRow.rooms) {
        this.reduce({ type: 'carded', floor: floorRow.floor, room } as EvidenceAction, nowMs)
      }
    }
  }

  /** Create-on-demand card glyph per carded room. */
  syncCardMarkers(): void {
    const layer = this.layer
    if (layer === null) return
    for (const key of this.session.cards) {
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

  /** Card glyph position/visibility follow the floor lanes (per frame): the
   *  top rides the card's floor lane; same-floor visible, all floors for a
   *  spectator. */
  syncCardPositions(spectator: boolean, viewFloor: string): void {
    for (const [key, marker] of this.cardMarkers) {
      const floor = key.split(':')[0] ?? ''
      marker.style.top = `${this.laneY(floor) - 130}px`
      marker.style.visibility = spectator || floor === viewFloor ? 'visible' : 'hidden'
    }
  }

  /** Expire cue DOM nodes past their TTL and prune the session (per frame). */
  syncCues(nowMs: number): void {
    const live = liveCues(this.session, nowMs)
    const expired = new Set(
      this.session.cues.filter((c) => !live.some((l) => l.id === c.id)).map((c) => c.id),
    )
    for (const id of expired) {
      this.cueNodes.get(id)?.remove()
      this.cueNodes.delete(id)
    }
    this.session = dropCues(this.session, expired)
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
      this.layer?.appendChild(node)
      this.cueNodes.set(cue.id, node)
    }
  }

  /** Pin every live cue node to its room's lane line (the zoom transform
   *  moves the layer; this pass moves the node inside it). */
  syncCuePositions(): void {
    for (const [cueId, node] of this.cueNodes) {
      const cue = this.session.cues.find((c) => c.id === cueId)
      if (cue === undefined) continue
      node.style.top = `${this.laneY(cue.floor) - (cue.kind === 'rustle' ? 100 : 160)}px`
    }
  }

  /** Reset for a fresh round deal: cards and cues die with the previous sim.
   *  Removes only this view's own nodes — the shared layer also carries
   *  tenancy signs and the stairwell marker, which are not evidence state
   *  (the old whole-layer replaceChildren silently killed the stair marker). */
  reset(): void {
    this.session = initialEvidenceSession()
    for (const el of this.cardMarkers.values()) el.remove()
    this.cardMarkers.clear()
    for (const el of this.cueNodes.values()) el.remove()
    this.cueNodes.clear()
  }
}
