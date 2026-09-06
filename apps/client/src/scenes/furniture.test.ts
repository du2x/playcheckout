import { TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import {
  CHAIR_SEAT_TOP_PX,
  DINING_SLOT_COUNT,
  DINING_TABLE_COUNT,
  diningFurniture,
  diningSlotAtXTiles,
  diningSlotFacesEast,
  diningSlotXTiles,
  diningTableXTiles,
  LOBBY_FURNITURE,
  MEZZANINE_FURNITURE,
} from './furniture'

describe('client:furniture plan', () => {
  it('pins dining slots to the sim tuning formula (no literal drift)', () => {
    for (let slot = 0; slot < DINING_SLOT_COUNT; slot++) {
      expect(diningSlotXTiles(slot)).toBe(
        TUNING.GUEST_RESTAURANT_START_TILES + slot * TUNING.GUEST_QUEUE_SPACING_TILES,
      )
    }
  })

  it('derives each shared table strictly between its chair pair, facing it', () => {
    expect(DINING_TABLE_COUNT).toBe(DINING_SLOT_COUNT / 2)
    for (let table = 0; table < DINING_TABLE_COUNT; table++) {
      const west = diningSlotXTiles(table * 2)
      const east = diningSlotXTiles(table * 2 + 1)
      const mid = diningTableXTiles(table)
      expect(mid).toBeGreaterThan(west)
      expect(mid).toBeLessThan(east)
      // Even slots face east (toward the table), odd slots face west.
      expect(diningSlotFacesEast(table * 2)).toBe(true)
      expect(diningSlotFacesEast(table * 2 + 1)).toBe(false)
    }
  })

  it('maps announced positions back to slots (the seated-pose gate)', () => {
    for (let slot = 0; slot < DINING_SLOT_COUNT; slot++) {
      expect(diningSlotAtXTiles(diningSlotXTiles(slot))).toBe(slot)
    }
    expect(diningSlotAtXTiles(diningSlotXTiles(0) - TUNING.GUEST_QUEUE_SPACING_TILES)).toBeNull()
    expect(
      diningSlotAtXTiles(
        diningSlotXTiles(DINING_SLOT_COUNT - 1) + TUNING.GUEST_QUEUE_SPACING_TILES,
      ),
    ).toBeNull()
    expect(diningSlotAtXTiles(0)).toBeNull()
    expect(diningSlotAtXTiles(30)).toBeNull()
  })

  it('keeps every prop clear of the stair mouth and the elevator landing', () => {
    const all = [...LOBBY_FURNITURE, ...MEZZANINE_FURNITURE, ...diningFurniture()]
    expect(all.length).toBeGreaterThan(0)
    for (const a of all) {
      // West stairwell mouth occupies tiles 0..1; the east landing door
      // starts at tile 27.5 (AD-040/046).
      expect(a.xTiles).toBeGreaterThan(1)
      expect(a.xTiles).toBeLessThan(27.5)
    }
  })

  it('anchors the desk counter on the E zone and pairs the dining set', () => {
    const desk = LOBBY_FURNITURE.find((a) => a.name === 'desk')
    expect(desk).toBeDefined()
    // The desk body sits just west of DESK_X so its counter face lands on
    // the queue front / E receive-release zone (AD-028/031).
    expect(desk?.xTiles ?? 0).toBeLessThan(TUNING.DESK_X_TILES)
    expect((desk?.xTiles ?? 0) + 1.5).toBeGreaterThanOrEqual(TUNING.DESK_X_TILES)

    const dining = diningFurniture()
    expect(dining.filter((a) => a.texture === 'furniture-chair')).toHaveLength(DINING_SLOT_COUNT)
    expect(dining.filter((a) => a.texture === 'furniture-table')).toHaveLength(DINING_TABLE_COUNT)
  })

  it('places the receptionist behind the counter, facing the screen', () => {
    const desk = LOBBY_FURNITURE.find((a) => a.name === 'desk')
    const receptionist = LOBBY_FURNITURE.find((a) => a.name === 'receptionist')
    expect(receptionist).toBeDefined()
    // Behind the counter: strictly behind the desk in draw order (lower
    // depth) and horizontally inside the desk body, so the countertop
    // occludes her lower half. No flipX — the sprite is drawn front-facing.
    expect(receptionist?.depth ?? 0).toBeLessThan(desk?.depth ?? 0)
    expect(receptionist?.flipX).toBeUndefined()
    expect(Math.abs((receptionist?.xTiles ?? 0) - (desk?.xTiles ?? 0))).toBeLessThan(1)
  })

  it('hangs the kitchen door on the mezzanine, west of the restaurant', () => {
    const kitchen = MEZZANINE_FURNITURE.find((a) => a.name === 'kitchen-door')
    expect(kitchen).toBeDefined()
    // Back-of-house: on the west wall band, clear of the first dining slot.
    // The `door:` child-name prefix stays reserved for the 21 guest-room
    // doors (ART-06), so the kitchen door rides the furniture namespace.
    expect(kitchen?.xTiles ?? 99).toBeLessThan(diningSlotXTiles(0))
    expect(kitchen?.name).toBe('kitchen-door')
  })

  it('keeps the seat-top constant in step with the chair art scale', () => {
    // The seated guest lifts by this constant; the chair seat pad top row is
    // 14 px above the ground line in furniture-chair.png (34 px tall). If
    // the art changes, both change together — asserted here as the contract.
    expect(CHAIR_SEAT_TOP_PX).toBe(14)
    expect(CHAIR_SEAT_TOP_PX).toBeLessThan(34 / 2)
  })
})
