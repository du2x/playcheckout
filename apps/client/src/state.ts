import {
  type CarId,
  type Facing,
  type FloorId,
  type LobbySnapshot,
  type MovementSnapshot,
  type RecapEntry,
  type Role,
  type RoomIndex,
  type RoomState,
  type SpectatorSnapshot,
  TUNING,
} from '@turnover/shared'

/**
 * First-light view state (cycle 2.2): a pure reducer over the T3 message
 * catalog. No DOM, no Phaser, no network — renderers and the connection
 * wrapper stay dumb; every view transition the spec defines is unit-tested.
 */

export type ViewName = 'join' | 'lobby' | 'round' | 'results' | 'lost'

/** The round-end verdict + recap the results view renders (cycle 2.9). */
export interface ResultsState {
  winner: 'staff' | 'saboteur' | 'aborted'
  reason: string
  saboteurId: string | null
  entries: readonly RecapEntry[]
}

export interface ViewState {
  /** Which overlay view is mounted. */
  view: ViewName
  /** Latest personal lobby snapshot (roster survives into the round view). */
  snapshot: LobbySnapshot | null
  /** The player's own role card — never anyone else's (protocol rule). */
  role: Role | null
  /** Wall-clock ms when round:started arrived; deadline = this + shift. */
  roundStartedAt: number | null
  /**
   * Wall-clock ms deadline for a RESUMED round (FR-25): receipt-stamped from
   * round:resumed's remainingTicks. When set it is the honest clock — the
   * receipt-time shift math never applies to a resumed seat.
   */
  roundEndsAtMs: number | null
  /** Ids from round:started (or round:resumed), labeled by roster name in the round view. */
  roundPlayerIds: readonly string[]
  /** Winner banner + traitor reveal + recap timeline (results view). */
  results: ResultsState | null
  /**
   * True between an unconsented drop and the reconnection outcome (FR-25
   * client half): the lost view shows a reconnecting state and the world
   * scene stays mounted; the next restore message (snapshot/round-resumed)
   * clears it. A terminal connection-loss clears it too.
   */
  reconnecting: boolean
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
  // Rider-exclusive render state (AD-013): reducer no-ops like the
  // other scene-kind events — the chip lives in the DOM layer (T10).
  | { type: 'elevator-pressed'; playerId: string; floor: FloorId }
  | {
      type: 'elevator-riders'
      car: CarId
      riders: readonly string[]
      queue: readonly FloorId[]
    }
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
  // Evidence render-state actions (cycle 2.7): cards and cues are scene/DOM
  // display state; no payload names a role or an interior beyond the read
  // already granted (leak rule 2).
  | { type: 'room-carded'; floor: FloorId; room: RoomIndex }
  | { type: 'room-settled'; floor: FloorId; room: RoomIndex }
  | { type: 'room-rustle'; floor: FloorId; room: RoomIndex }
  | { type: 'room-entered'; playerId: string; floor: FloorId; room: RoomIndex }
  // Justice (cycle 2.8): firing is public but name-only (FR-18) — the scene
  // removes the rectangle; the accusation session renders the toast (T5).
  | { type: 'player-fired'; playerId: string }
  // Round end (cycle 2.9, prd win conditions + results): verdict + recap drive
  // the results view; the spectator baseline is scene state; the seat restore
  // flips the view back to round with an honest clock.
  | {
      type: 'round-ended'
      winner: 'staff' | 'saboteur' | 'aborted'
      reason: string
      saboteurId: string | null
    }
  | { type: 'round-recap'; entries: readonly RecapEntry[] }
  | { type: 'spectator-snapshot'; snapshot: SpectatorSnapshot }
  | { type: 'connection-dropped' }
  | {
      type: 'round-resumed'
      remainingTicks: number
      playerIds: readonly string[]
      ownFired: boolean
    }
  | { type: 'role-dealt'; role: Role }
  | { type: 'buzzer' }
  | { type: 'intent-error'; message: string }
  | { type: 'connection-lost' }
  | { type: 'clear-error' }

/** Shift deadline in ms: a resumed round uses its own stamped deadline (FR-25). */
export function clockRemainingMs(state: ViewState, nowMs: number): number {
  if (state.roundEndsAtMs !== null) return Math.max(0, state.roundEndsAtMs - nowMs)
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
    roundEndsAtMs: null,
    roundPlayerIds: [],
    results: null,
    reconnecting: false,
    error: null,
    joining: false,
  }
}

/** Where the App routes an action after the rider session has reduced it. */
export type ActionRoute = 'view' | 'scene' | 'consumed'

/**
 * Routing declared once (architecture review 2026-08-29): every ViewAction
 * member names its post-reduction route exactly once — `view` → the reducer
 * (state + DOM), `scene` → the world scene (render state), `consumed` → fully
 * absorbed by the rider session (riderSession.ts runs on every action either
 * way). The `satisfies` is the drift guard in both directions: a typo'd or
 * extra key fails, and a new ViewAction member without a route fails the
 * Record — the App never hand-lists action kinds.
 */
export const ACTION_ROUTES = {
  'submit-join': 'view',
  'join-failed': 'view',
  snapshot: 'view',
  'round-started': 'view',
  'player-moved': 'scene',
  'elevator-called': 'scene',
  'elevator-moved': 'scene',
  'elevator-pressed': 'consumed',
  'elevator-riders': 'consumed',
  'player-left': 'scene',
  'player-left-floor': 'scene',
  'movement-snapshot': 'scene',
  'work-started': 'scene',
  'work-ended': 'scene',
  'room-observed': 'scene',
  'room-prepped': 'scene',
  'room-trashed': 'scene',
  'room-carded': 'scene',
  'room-settled': 'scene',
  'room-rustle': 'scene',
  'room-entered': 'scene',
  'player-fired': 'scene',
  'round-ended': 'view',
  'round-recap': 'view',
  'spectator-snapshot': 'scene',
  'connection-dropped': 'view',
  'round-resumed': 'view',
  'role-dealt': 'view',
  buzzer: 'view',
  'intent-error': 'view',
  'connection-lost': 'view',
  'clear-error': 'view',
} as const satisfies Record<ViewAction['type'], ActionRoute>

type RouteOf<K extends ViewAction['type']> = (typeof ACTION_ROUTES)[K]

/** The scene-kind members, derived from the route table — no second list. */
export type SceneAction = Extract<
  ViewAction,
  {
    type: { [K in ViewAction['type']]: RouteOf<K> extends 'scene' ? K : never }[ViewAction['type']]
  }
>

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
        reconnecting: false,
        // A stray mid-round snapshot must not yank the round view back — but
        // a reconnecting client's restore snapshot lands it in the lobby
        // (the results-phase reconnect path; a round resume follows with
        // round:resumed when the round is still active).
        view:
          state.view === 'join' || state.view === 'lobby' || state.reconnecting
            ? 'lobby'
            : state.view,
      }
    case 'round-started':
      return {
        ...state,
        view: 'round',
        // The reducer stamps receipt time — the mapper stays pure (REG-11).
        roundStartedAt: Date.now(),
        roundEndsAtMs: null,
        roundPlayerIds: action.playerIds,
        results: null,
        error: null,
        joining: false,
      }
    case 'role-dealt':
      return { ...state, role: action.role }
    case 'round-ended':
      // The results view (FR-21/22): verdict + traitor reveal; the recap
      // entries may arrive in the same flush (round:recap follows round:ended).
      return {
        ...state,
        view: 'results',
        results: {
          winner: action.winner,
          reason: action.reason,
          saboteurId: action.saboteurId,
          entries: state.results?.entries ?? [],
        },
      }
    case 'round-recap':
      return {
        ...state,
        results:
          state.results === null ? state.results : { ...state.results, entries: action.entries },
      }
    case 'round-resumed':
      // Seat restore (FR-25): back into the round with an honest clock — the
      // remaining ticks are the server's truth, stamped at receipt.
      return {
        ...state,
        view: 'round',
        roundPlayerIds: [...action.playerIds],
        roundEndsAtMs: Date.now() + action.remainingTicks * 50,
        results: null,
        reconnecting: false,
        error: null,
      }
    case 'buzzer':
      return {
        ...state,
        view: 'lobby',
        role: null,
        roundStartedAt: null,
        roundEndsAtMs: null,
        roundPlayerIds: [],
      }
    case 'intent-error':
      return { ...state, error: action.message }
    case 'connection-lost':
      // Join-phase failures arrive as join-failed; this is post-join only,
      // and terminal: no reconnection seat is being held for us.
      return state.view === 'join' ? state : { ...state, view: 'lost', reconnecting: false }
    case 'connection-dropped':
      // An unconsented drop (FR-25): the seat may be held — show the
      // reconnecting state; the restore messages bring the view back.
      return state.view === 'join' ? state : { ...state, view: 'lost', reconnecting: true }
    case 'clear-error':
      return { ...state, error: null }
    // Render state, not view state: identity return keeps 20 Hz out of the DOM.
    case 'player-moved':
    case 'elevator-called':
    case 'elevator-moved':
    case 'elevator-pressed':
    case 'elevator-riders':
    case 'player-left':
    case 'player-left-floor':
    // The scene consumes the snapshot itself (applySnapshot); storing it in
    // ViewState too was a pre-AD-005 leftover — written, never rendered.
    case 'movement-snapshot':
      return state
    case 'work-started':
    case 'work-ended':
    case 'room-observed':
    case 'room-prepped':
    case 'room-trashed':
    case 'room-carded':
    case 'room-settled':
    case 'room-rustle':
    case 'room-entered':
    case 'player-fired':
    case 'spectator-snapshot':
      return state
  }
}
