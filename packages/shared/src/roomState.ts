export const ROOM_STATES = ['prepped', 'trashed', 'fresh', 'settled'] as const

export type RoomState = (typeof ROOM_STATES)[number]

export const TRASH_PROVENANCE = ['sabotage', 'churn', 'none'] as const
export type TrashProvenance = (typeof TRASH_PROVENANCE)[number]
