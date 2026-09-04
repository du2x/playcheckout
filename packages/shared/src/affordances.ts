import {
  FLOOR_IDS,
  GUEST_FLOOR_IDS,
  HALL_LENGTH_TILES,
  ROOM_INDEXES,
  type RoomIndex,
  roomDoorXMilli,
} from './layout'
import type { FloorId } from './protocol/messages'
import { TUNING } from './tuning'

/**
 * The E-affordance module (AD-036): the spatial predicates behind every E-key
 * and range-gated interaction, expressed once and consumed by BOTH the sim's
 * authority guards and the client's prediction mirror. Positions are in TILES
 * — the unit of the TUNING ranges and of the movement sim's `positionOf` and
 * the wire snapshots (`work.positionOf` callers convert MILLI → tiles once at
 * the guard). Nothing here emits, mutates, or knows about transport: pure
 * geometry and pure key-decision tables.
 */

/** A position in tiles — the affordances interface unit. */
export interface TilePos {
  floor: FloorId
  x: number
}

/** A suitcase view: who carries it and where (if anywhere) it rests. */
export interface SuitcaseRef {
  id: string
  carrierId: string | null
  rest: { floor: FloorId; room: RoomIndex } | null
}

// --- spatial predicates -----------------------------------------------------

/** The E receive/release zone at the front desk (AD-031): lobby floor within
 * DESK_RANGE_TILES of DESK_X_TILES, inclusive. */
export function inDeskZone(pos: TilePos): boolean {
  return pos.floor === 'lobby' && Math.abs(pos.x - TUNING.DESK_X_TILES) <= TUNING.DESK_RANGE_TILES
}

/** An elevator landing zone (AD-022; hit box matched to the 80 px door art,
 * AD-046): within ELEVATOR_LANDING_TILES of the EAST car landing
 * (x = HALL_LENGTH_TILES), or near the west end (stairwell mouth scale) —
 * the west branch only gates the same key as the stairs, which route first. */
export function onLanding(xTiles: number): boolean {
  return (
    xTiles <= TUNING.STAIRWELL_MOUTH_TILES ||
    xTiles >= HALL_LENGTH_TILES - TUNING.ELEVATOR_LANDING_TILES
  )
}

/** The stairwell mouth zone (cycle 3.E, AD-040): within
 * STAIRWELL_MOUTH_TILES of the west end (x=0) — the stairwell replaced the
 * west elevator landing, and keeps the original 1-tile landing scale. */
export function atStairwellMouth(xTiles: number): boolean {
  return xTiles <= TUNING.STAIRWELL_MOUTH_TILES
}

/** The stairs directions available from a floor (cycle 3.E, AD-040): 'up'
 * everywhere but the top floor, 'down' everywhere but the lobby — the entry
 * guard and the client's key map consume this one table. */
export function stairsDirections(floor: FloorId): readonly ('up' | 'down')[] {
  const idx = FLOOR_IDS.indexOf(floor)
  const dirs: ('up' | 'down')[] = []
  if (idx < FLOOR_IDS.length - 1) dirs.push('up')
  if (idx > 0) dirs.push('down')
  return dirs
}

/** A room-door E zone (AD-033): within ROOM_DOOR_RANGE_TILES of the room's
 * door x, inclusive. */
export function doorInRange(xTiles: number, room: RoomIndex): boolean {
  return Math.abs(xTiles - roomDoorXTiles(room)) <= TUNING.ROOM_DOOR_RANGE_TILES
}

/** The room whose doorway the position stands at on a guest floor, or null —
 * the place affordance. No room doors exist on the lobby or the mezzanine
 * (3.C, REST-05). Ties cannot occur: door zones are disjoint at the pinned
 * ranges. */
export function doorRoomAt(pos: TilePos): RoomIndex | null {
  if (!(GUEST_FLOOR_IDS as readonly string[]).includes(pos.floor)) return null
  for (const room of ROOM_INDEXES) {
    if (doorInRange(pos.x, room)) return room
  }
  return null
}

/** Accusation range (FR-17/18): same floor, within ACCUSATION_RANGE_TILES,
 * inclusive. */
export function inAccuseRange(a: TilePos, b: TilePos): boolean {
  return a.floor === b.floor && Math.abs(a.x - b.x) <= TUNING.ACCUSATION_RANGE_TILES
}

/** Nearest in-range candidate (accuse menu mirror of the server's rule). The
 * caller filters liveness (fired/ghosted/left) — the module owns floor,
 * range, and nearest selection. */
export function nearestInAccuseRange<T extends { id: string } & TilePos>(
  own: TilePos,
  candidates: readonly T[],
): T | undefined {
  let best: T | undefined
  for (const c of candidates) {
    if (!inAccuseRange(own, c)) continue
    if (best === undefined || Math.abs(c.x - own.x) < Math.abs(best.x - own.x)) best = c
  }
  return best
}

/** The resting suitcase nearest the position on the same floor within
 * ROOM_DOOR_RANGE_TILES, or null. Ties resolve to the lowest guest ordinal
 * (deterministic; SUI-08) — the sim consumes this selection directly, so the
 * rule has exactly one home. */
export function nearestRestingSuitcase(
  pos: TilePos,
  suitcases: readonly SuitcaseRef[],
): string | null {
  let best: { id: string; dist: number; ordinal: number } | null = null
  for (const sc of suitcases) {
    if (sc.rest === null || sc.rest.floor !== pos.floor) continue
    const dist = Math.abs(pos.x - roomDoorXTiles(sc.rest.room))
    if (dist > TUNING.ROOM_DOOR_RANGE_TILES) continue
    const ordinal = Number(sc.id.split(':')[1] ?? 0)
    if (best === null || dist < best.dist || (dist === best.dist && ordinal < best.ordinal)) {
      best = { id: sc.id, dist, ordinal }
    }
  }
  return best?.id ?? null
}

/** The guest whose suitcase the player carries, or null (one suitcase per
 * player; SUI-25). */
export function carriedGuestIdOf(
  suitcases: readonly SuitcaseRef[],
  playerId: string,
): string | null {
  for (const sc of suitcases) {
    if (sc.carrierId === playerId) return sc.id
  }
  return null
}

function roomDoorXTiles(room: RoomIndex): number {
  // roomDoorXMilli is MILLI; the affordances interface is tiles.
  return roomDoorXMilli(room) / 1000
}

// --- E-key decision tables --------------------------------------------------

export type EKeydownIntent =
  | { kind: 'none' }
  | { kind: 'desk' }
  | { kind: 'place'; room: RoomIndex }
  | { kind: 'pickup' }
  | { kind: 'hold' }

/** The E-keydown facts the scene already holds: own predicted position, the
 * suitcase view, and the self-fired gate. Riders have no floor (AD-009) so
 * `own` is null for them — no separate riding gate exists at keydown, exactly
 * as in the scene contract this table pins. */
export interface EKeydownFacts {
  selfFired: boolean
  own: TilePos | null
  suitcases: readonly SuitcaseRef[]
  playerId: string
}

/** The SUI-25 E-keydown ladder: desk receive → place (carrying, at a door) →
 * pickup (not carrying, near a resting suitcase) → otherwise the accuse hold
 * window. Desk/pickup/place targets are spatially disjoint from landings, so
 * the order only breaks ties. Pure — the scene maps the intent to sends and
 * owns the hold timer. */
export function resolveEKeydown(facts: EKeydownFacts): EKeydownIntent {
  if (facts.selfFired || facts.own === null) return { kind: 'none' }
  if (inDeskZone(facts.own)) return { kind: 'desk' }
  const carried = carriedGuestIdOf(facts.suitcases, facts.playerId)
  if (carried !== null) {
    // AD-034: assignments are building-wide — a carrier at a door always
    // places directly (no confirm).
    const room = doorRoomAt(facts.own)
    if (room !== null) return { kind: 'place', room }
  } else if (nearestRestingSuitcase(facts.own, facts.suitcases) !== null) {
    return { kind: 'pickup' }
  }
  return { kind: 'hold' }
}

export type EKeyupIntent = { kind: 'none' } | { kind: 'elevatorCall' }

/** The E-keyup rule (JUST-17): a keyup that ends the hold window sends the
 * elevator call exactly as the old tap did — gated by the same self-fired,
 * riding, and landing predicates. Riding players never send (the server
 * rejects rider calls anyway). */
export function resolveEKeyup(facts: {
  selfFired: boolean
  riding: boolean
  own: TilePos | null
}): EKeyupIntent {
  if (facts.selfFired || facts.riding || facts.own === null) return { kind: 'none' }
  return onLanding(facts.own.x) ? { kind: 'elevatorCall' } : { kind: 'none' }
}

/** The accuse menu target when the hold window expires, or null: riding
 * players cannot accuse (the server sees no floor for them), otherwise the
 * nearest in-range live candidate. The caller pre-filters liveness. */
export function accuseTargetAtHoldExpiry<T extends { id: string } & TilePos>(
  riding: boolean,
  own: TilePos | null,
  candidates: readonly T[],
): T | undefined {
  if (riding || own === null) return undefined
  return nearestInAccuseRange(own, candidates)
}
