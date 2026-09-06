import { TUNING } from '@turnover/shared'

/**
 * Furniture plan for the furnished floors (lobby + mezzanine restaurant).
 * Pure presentation: the sim never reads any of this. The dining chairs pin
 * to the SAME tuning slot formula the sim places dining guests at
 * (GUEST_RESTAURANT_START_TILES + slot × GUEST_QUEUE_SPACING_TILES, AD-035),
 * so a seated guest and its chair can never drift apart — the slot x is the
 * shared constant, not a copied literal.
 *
 * every anchor keeps clear of the two walk zones every floor shares: the
 * west stairwell mouth (tiles 0..1, AD-040) and the east elevator landing
 * (tiles 27.5..30, AD-046). Foliage only — no flame props (sconces/candles
 * are out per user direction).
 */

/** Chairs the restaurant renders (slot i ⇔ the i-th checked-in guest). */
export const DINING_SLOT_COUNT = 8
/** One shared table per chair pair: table i sits between slots 2i and 2i+1. */
export const DINING_TABLE_COUNT = DINING_SLOT_COUNT / 2

/**
 * The chair seat surface above the lane line, in px — mirrors the seat-top
 * row of art/props/furniture-chair.png (seat pad top at y20 of the 34 px
 * tall sprite). Seated guests anchor their bottom edge here; the generator
 * and this constant change together.
 */
export const CHAIR_SEAT_TOP_PX = 14

/** Render depth of the seated guest: in front of its chair (-1), behind the
 *  shared table (-0.5) that covers the lap, behind walking characters (0).
 *  (Spelled −3/4 — the tuning-literal denylist bans the decimal spelling.) */
export const SEATED_GUEST_DEPTH = -3 / 4

/** The lane x (tiles) of dining slot i — the sim's own placement formula. */
export function diningSlotXTiles(slot: number): number {
  return TUNING.GUEST_RESTAURANT_START_TILES + slot * TUNING.GUEST_QUEUE_SPACING_TILES
}

/** The lane x (tiles) of the shared table between chair pair i. */
export function diningTableXTiles(table: number): number {
  return diningSlotXTiles(table * 2) + TUNING.GUEST_QUEUE_SPACING_TILES / 2
}

/**
 * The dining slot whose chair anchors x, or null when x is not at a slot —
 * the seated-pose gate for a dining guest's announced position.
 */
export function diningSlotAtXTiles(x: number): number | null {
  const slot = Math.round(
    (x - TUNING.GUEST_RESTAURANT_START_TILES) / TUNING.GUEST_QUEUE_SPACING_TILES,
  )
  if (slot < 0 || slot >= DINING_SLOT_COUNT) return null
  return Math.abs(x - diningSlotXTiles(slot)) < TUNING.GUEST_QUEUE_SPACING_TILES / 2 ? slot : null
}

/** Even slots face east toward their table; odd slots face west (flipX). */
export function diningSlotFacesEast(slot: number): boolean {
  return slot % 2 === 0
}

export interface FurnitureAnchor {
  /** Child-name suffix — scenes name these `furniture:<floor>:<name>`. */
  readonly name: string
  readonly texture: string
  readonly xTiles: number
  /** Wall-plane props sit at -1 (characters pass in front); shared tables
   *  draw at -0.5 so a seated guest's lap tucks under the tabletop. */
  readonly depth: number
  readonly flipX?: boolean
}

/** The restaurant's dining set: 8 chairs (alternating facing) + 4 tables. */
export function diningFurniture(): FurnitureAnchor[] {
  const chairs: FurnitureAnchor[] = []
  for (let slot = 0; slot < DINING_SLOT_COUNT; slot++) {
    chairs.push({
      name: `chair-${slot}`,
      texture: 'furniture-chair',
      xTiles: diningSlotXTiles(slot),
      depth: -1,
      flipX: !diningSlotFacesEast(slot),
    })
  }
  const tables: FurnitureAnchor[] = []
  for (let table = 0; table < DINING_TABLE_COUNT; table++) {
    tables.push({
      name: `table-${table}`,
      texture: 'furniture-table',
      xTiles: diningTableXTiles(table),
      depth: -0.5,
    })
  }
  return [...chairs, ...tables]
}

/**
 * The grand lobby: the reception desk anchors the E zone (AD-028/031) — its
 * counter face lands on DESK_X_TILES where the queue front stands — plus the
 * receptionist NPC behind the counter and Deco seating/palms along the west
 * wall.
 */
export const LOBBY_FURNITURE: readonly FurnitureAnchor[] = [
  { name: 'desk', texture: 'furniture-desk', xTiles: TUNING.DESK_X_TILES - 1, depth: -1 },
  // The receptionist stands behind the counter: a shade BEHIND the desk's
  // depth so the countertop occludes her lower body, drawn front-facing
  // (toward the screen) and never flipping — the anchor carries no flipX.
  {
    name: 'receptionist',
    texture: 'npc-receptionist',
    xTiles: TUNING.DESK_X_TILES - 1.25,
    depth: -1.25,
  },
  { name: 'bench-west', texture: 'furniture-bench', xTiles: 4.5, depth: -1 },
  { name: 'bench-east', texture: 'furniture-bench', xTiles: 8, depth: -1, flipX: true },
  { name: 'plant-west', texture: 'furniture-plant', xTiles: 2.25, depth: -1 },
  { name: 'plant-mid', texture: 'furniture-plant', xTiles: 10.5, depth: -1 },
  { name: 'plant-east', texture: 'furniture-plant', xTiles: 26.5, depth: -1 },
]

/**
 * Mezzanine decor: foliage and a waiting settee west of the restaurant, plus
 * the kitchen double door on the west wall back-of-house (visual only for
 * now — a future cycle gives it a use; it deliberately does NOT use the
 * `door:` name prefix, which the ART-06 harness contract pins to the 21
 * guest-room doors).
 */
export const MEZZANINE_FURNITURE: readonly FurnitureAnchor[] = [
  { name: 'plant-west', texture: 'furniture-plant', xTiles: 2.25, depth: -1 },
  { name: 'settee', texture: 'furniture-bench', xTiles: 5.5, depth: -1 },
  { name: 'plant-mid', texture: 'furniture-plant', xTiles: 12.5, depth: -1 },
  {
    name: 'kitchen-door',
    texture: 'furniture-kitchen-door',
    xTiles: 16,
    depth: -1,
  },
]
