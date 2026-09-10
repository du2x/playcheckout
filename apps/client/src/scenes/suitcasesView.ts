import { type RoomIndex, roomDoorXMilli } from '@turnover/shared'
import type Phaser from 'phaser'
import { GROUND_Y, TILE_PX } from './furniture'

/**
 * SuitcasesView (cycle 3.B, SUI-24): the suitcase markers as a view module —
 * one Rectangle per suitcase, carried riding the carrier's position stream,
 * rest pinned at the doorway. One sync per frame with resolved facts: the
 * scene keeps the suitcase state map (message-driven) and the carrier
 * positions; the view derives every pixel and prunes departed ids.
 *
 * Same-floor visibility: a suitcase shows on the viewed floor only, every
 * floor for a spectator. Never a Sprite — the scene-children contract counts
 * player Rectangles and car Ellipses, and the suitcase rectangle is
 * deliberately part of that counting (SUI-24 art gate).
 */
export interface SuitcaseFact {
  readonly carrierId: string | null
  readonly rest: { readonly floor: string; readonly room: RoomIndex } | null
}

export interface CarrierFact {
  readonly x: number
  readonly floor: string
}

export interface SuitcasesViewInput {
  readonly suitcases: ReadonlyMap<string, SuitcaseFact>
  readonly carriers: ReadonlyMap<string, CarrierFact>
  readonly spectator: boolean
  readonly viewFloor: string
  /** The SUI-27 owned-assignment hint text for the own carried suitcase's
   *  heard assignment, or null to hide the hint line. */
  readonly hint: string | null
}

export class SuitcasesView {
  private readonly scene: Phaser.Scene
  private readonly hint: HTMLElement | null
  private readonly views = new Map<string, Phaser.GameObjects.Rectangle>()

  constructor(scene: Phaser.Scene, hint: HTMLElement | null) {
    this.scene = scene
    this.hint = hint
  }

  sync(input: SuitcasesViewInput): void {
    for (const [id, sc] of input.suitcases) {
      let view = this.views.get(id)
      if (view === undefined) {
        view = this.scene.add.rectangle(0, GROUND_Y - 22, 14, 10, 0xffd27f)
        this.views.set(id, view)
      }
      let x: number | null = null
      let floor: string | null = null
      if (sc.carrierId !== null) {
        const carrier = input.carriers.get(sc.carrierId)
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
      view.setVisible(input.spectator || floor === input.viewFloor)
      view.x = x * TILE_PX
    }
    for (const [id, view] of this.views) {
      if (!input.suitcases.has(id)) {
        view.destroy()
        this.views.delete(id)
      }
    }
    if (this.hint !== null) {
      if (input.hint !== null) {
        this.hint.textContent = input.hint
        this.hint.style.visibility = 'visible'
      } else {
        this.hint.style.visibility = 'hidden'
      }
    }
  }
}
