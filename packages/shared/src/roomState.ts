export const ROOM_STATES = ['prepped', 'trashed', 'fresh', 'settled'] as const

export type RoomState = (typeof ROOM_STATES)[number]
