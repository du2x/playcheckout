export const FLOORS = 3
export const ROOMS_PER_FLOOR = 8
export const ROOM_COUNT = FLOORS * ROOMS_PER_FLOOR // 24 — roadmap step 0
export const FLOOR_IDS = ['lobby', 'floor1', 'floor2', 'floor3'] as const

/** Travel-budget assumptions, roadmap step 0: halls ~30 tiles, rooms ~4 tiles. */
export const HALL_LENGTH_TILES = 30
export const ROOM_DEPTH_TILES = 4
