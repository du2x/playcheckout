export const FLOORS = 3
export const ROOMS_PER_FLOOR = 8
export const ROOM_COUNT = FLOORS * ROOMS_PER_FLOOR // 24 — roadmap step 0
export const FLOOR_IDS = ['lobby', 'floor1', 'floor2', 'floor3'] as const
export const GUEST_FLOOR_IDS = ['floor1', 'floor2', 'floor3'] as const
export type RoomIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export const ROOM_INDEXES = [1, 2, 3, 4, 5, 6, 7, 8] as const

/** Travel-budget assumptions, roadmap step 0: halls ~30 tiles, rooms ~4 tiles. */
export const HALL_LENGTH_TILES = 30

/**
 * Room geometry (cycle 2.5, AD-010): the 8 rooms of a guest floor are
 * contiguous x-segments of ROOM_DEPTH_TILES tiling [ROOM_HALL_START_TILES,
 * HALL_LENGTH_TILES − 1] — a 1-tile open hall at each end, outside the
 * elevator landings at x=0/x=30. The grand lobby floor has no rooms.
 */
export const ROOM_DEPTH_TILES = 3.5
export const ROOM_HALL_START_TILES = 1

const ROOM_HALL_START_MILLI = ROOM_HALL_START_TILES * 1000
const ROOM_WIDTH_MILLI = ROOM_DEPTH_TILES * 1000

/** Inclusive start of room i's segment in millitiles (AD-010). */
export function roomSegmentStartMilli(room: RoomIndex): number {
  return ROOM_HALL_START_MILLI + (room - 1) * ROOM_WIDTH_MILLI
}

/** Exclusive end of room i's segment in millitiles. */
export function roomSegmentEndMilli(room: RoomIndex): number {
  return roomSegmentStartMilli(room) + ROOM_WIDTH_MILLI
}

/**
 * The room whose segment contains x (half-open [start, end), last room
 * inclusive end), or 0 when x is outside every segment on that floor.
 */
export function roomIndexAtMilli(x: number): RoomIndex | 0 {
  const endMilli = ROOM_HALL_START_MILLI + ROOMS_PER_FLOOR * ROOM_WIDTH_MILLI
  if (x < ROOM_HALL_START_MILLI || x > endMilli) return 0
  const raw = Math.floor((x - ROOM_HALL_START_MILLI) / ROOM_WIDTH_MILLI) + 1
  return Math.min(raw, ROOMS_PER_FLOOR) as RoomIndex | 0
}
