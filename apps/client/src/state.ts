import {
  type CarId,
  type Facing,
  type FloorId,
  type LobbySnapshot,
  type MovementSnapshot,
  type Role,
  type RoomIndex,
  type RoomState,
  TUNING,
} from '@turnover/shared'

/**
 * First-light view state (cycle 2.2): a pure reducer over the T3 message
 * catalog. No DOM, no Phaser, no network — renderers and the connection
 * wrapper stay dumb; every view transition the spec defines is unit-tested.
 */

export type ViewName = 'join' | 'lobby' | 'round' | 'lost'

export interface ViewState {
  /** Which overlay view is mounted. */
  view: ViewName
  /** Latest personal lobby snapshot (roster survives into the round view). */
  snapshot: LobbySnapshot | null
  /** The player's own role card — never anyone else's (protocol rule). */
  role: Role | null
  /** Wall-clock ms when round:started arrived; deadline = this + shift. */
  roundStartedAt: number | null
  /** Ids from round:started, labeled by roster name in the round view. */
  roundPlayerIds: readonly string[]
  /** Latest public movement snapshot (join / buzzer); positions live in the scene. */
  movementSnapshot: MovementSnapshot | null
  /** Banner text (join rejections, intent errors). */
  error: string | null
  /** True while a join attempt is in flight (duplicate-submit guard). */
  joining: boolean
}

export type ViewAction =
  | { type: 'submit-join' }
  | { type: 'join-failed'; reason: string }
  | { type: 'snapshot'; snapshot: LobbySnapshot }
  | { type: 'round-started'; playerIds: readonly string[] }
  // Movement render-state actions (cycle 2.4): the reducer no-ops the four
  // high-frequency events — continuous positions live in the world scene.
  | { type: 'player-moved'; playerId: string; floor: FloorId; x: number; facing: Facing }
  | { type: 'elevator-called'; floor: FloorId; car: CarId }
  | { type: 'elevator-moved'; car: CarId; floor: FloorId }
  | { type: 'player-left'; playerId: string }
  | { type: 'player-left-floor'; playerId: string; floor: FloorId }
  | { type: 'movement-snapshot'; snapshot: MovementSnapshot }
  // Work render-state actions (cycle 2.5): the reducer no-ops all five —
  // channel progress and room interiors are scene/DOM display state, and no
  // payload names a role or a channel kind (FR-9).
  | { type: 'work-started'; playerId: string; floor: FloorId; room: RoomIndex; seconds: number }
  | {
      type: 'work-ended'
      playerId: string
      floor: FloorId
      room: RoomIndex
      outcome: 'completed' | 'cancelled'
    }
  | { type: 'room-observed'; playerId: string; floor: FloorId; room: RoomIndex; state: RoomState }
  | { type: 'room-prepped'; floor: FloorId; room: RoomIndex }
  | { type: 'room-trashed'; floor: FloorId; room: RoomIndex }
  | { type: 'role-dealt'; role: Role }
  | { type: 'buzzer' }
  | { type: 'intent-error'; message: string }
  | { type: 'connection-lost' }
  | { type: 'clear-error' }

/** Shift deadline in ms from the round:started receipt (client-side, AD-003). */
export function clockRemainingMs(state: ViewState, nowMs: number): number {
  if (state.roundStartedAt === null) return 0
  return Math.max(0, state.roundStartedAt + TUNING.SHIFT_SECONDS * 1000 - nowMs)
}

/**
 * Round-view players: roster names keyed by round:started ids; a playerId
 * without a roster name falls back to the raw id (LIGHT-12).
 */
export function roundPlayers(
  playerIds: readonly string[],
  snapshot: LobbySnapshot | null,
): { id: string; name: string }[] {
  const names = new Map(snapshot?.roster.map((entry) => [entry.id, entry.name]) ?? [])
  return playerIds.map((id) => ({ id, name: names.get(id) ?? id }))
}

export function initialViewState(): ViewState {
  return {
    view: 'join',
    snapshot: null,
    role: null,
    roundStartedAt: null,
    roundPlayerIds: [],
    movementSnapshot: null,
    error: null,
    joining: false,
  }
}

export function reduce(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'submit-join':
      // Spec edge: a submission while a connection is in flight is ignored.
      if (state.joining) return state
      return { ...state, joining: true, error: null }
    case 'join-failed':
      return { ...state, view: 'join', joining: false, error: action.reason }
    case 'snapshot':
      return {
        ...state,
        snapshot: action.snapshot,
        joining: false,
        // A stray mid-round snapshot must not yank the round view back.
        view: state.view === 'join' || state.view === 'lobby' ? 'lobby' : state.view,
      }
    case 'round-started':
      return {
        ...state,
        view: 'round',
        // The reducer stamps receipt time — the mapper stays pure (REG-11).
        roundStartedAt: Date.now(),
        roundPlayerIds: action.playerIds,
        error: null,
        joining: false,
      }
    case 'role-dealt':
      return { ...state, role: action.role }
    case 'buzzer':
      return { ...state, view: 'lobby', role: null, roundStartedAt: null, roundPlayerIds: [] }
    case 'intent-error':
      return { ...state, error: action.message }
    case 'connection-lost':
      // Join-phase failures arrive as join-failed; this is post-join only.
      return state.view === 'join' ? state : { ...state, view: 'lost' }
    case 'clear-error':
      return { ...state, error: null }
    // Render state, not view state: identity return keeps 20 Hz out of the DOM.
    case 'player-moved':
    case 'elevator-called':
    case 'elevator-moved':
    case 'player-left':
    case 'player-left-floor':
      return state
    case 'movement-snapshot':
      return { ...state, movementSnapshot: action.snapshot }
    case 'work-started':
    case 'work-ended':
    case 'room-observed':
    case 'room-prepped':
    case 'room-trashed':
      return state
  }
}
