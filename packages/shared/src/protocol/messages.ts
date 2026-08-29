import { z } from 'zod'
import type { FLOOR_IDS, GUEST_FLOOR_IDS } from '../layout.js'
import type { Role } from '../roles.js'
import type { RoomState } from '../roomState.js'

/** Guest floors + grand lobby, indexed 0..3 (layout.ts is the source). */
export type FloorId = (typeof FLOOR_IDS)[number]
export type GuestFloorId = (typeof GUEST_FLOOR_IDS)[number]
/** Room 1..8 on a guest floor (layout.ts is the source). */
export type { RoomIndex } from '../layout.js'

import type { RoomIndex } from '../layout.js'
/** Car 1 = west landing, car 2 = east landing. */
export type CarId = 1 | 2
export type Facing = 'left' | 'right'

/**
 * Server→client payload shapes (protocol registry payloads — see registry.ts).
 * Payloads carry NO `type` literal: the Colyseus wire name is the only type
 * tag, and every message travels inside an `Envelope` stamped by the Router.
 * Roles other than the recipient's own NEVER appear here; the deal seed appears
 * nowhere.
 */

/** Roster entry — ids and names only; never roles, never join order. */
export interface RosterEntry {
  readonly id: string
  readonly name: string
}

/**
 * server → one player. Personal snapshot on join and every roster change
 * (join, leave, host migration). Recipient sees own identity + lobby roster.
 */
export interface LobbySnapshot {
  readonly ownId: string
  readonly ownName: string
  readonly isHost: boolean
  readonly roster: readonly RosterEntry[]
}

/** server → all players (broadcast). Round begin; ids only — no roles. */
export interface RoundStarted {
  readonly playerIds: readonly string[]
}

/**
 * server → exactly one player, private. The recipient's own role card (prd FR-2).
 * NEVER broadcast; no other player's role may ever be attached to any payload.
 */
export interface RoleDealt {
  readonly role: Role
}

/** server → all players (broadcast). Shift clock expired — empty payload. */
export type RoundBuzzer = Record<string, never>

/** server → one player. Intent rejection reason (join errors use Colyseus join rejection). */
export interface IntentError {
  readonly code:
    | 'need-more-players'
    | 'not-host'
    | 'round-already-active'
    | 'elevator-locked'
    | 'round-not-active'
    | 'not-in-room'
    | 'room-not-workable'
    | 'channel-active'
  readonly message: string
}

// ---------------------------------------------------------------------------
// Movement (cycle 2.4). Positions are public (protocol rule 2); elevator
// payloads carry car floors only — never occupant ids (FR-6).
// ---------------------------------------------------------------------------

/** server → all players. A player's position/floor/facing changed this tick. */
export interface PlayerMoved {
  readonly playerId: string
  readonly floor: FloorId
  /** Tiles; the sim integrates in integer millitiles for determinism. */
  readonly x: number
  readonly facing: Facing
}

/** server → all players. A call was registered (incl. decoy flashes, FR-5). */
export interface ElevatorCalled {
  /** Floor the car was called to (the caller's pickup floor). */
  readonly floor: FloorId
  readonly car: CarId
}

/** server → all players. A car's floor changed (arrival, ride hop). */
export interface ElevatorMoved {
  readonly car: CarId
  readonly floor: FloorId
}

/**
 * server → the riders of the named car ONLY (AD-013 riders policy). A rider
 * pressed a floor inside the car; attribution testimony for co-riders.
 * Panels never carry this — the public target would make tailing trivial.
 */
export interface ElevatorPressed {
  readonly playerId: string
  readonly floor: FloorId
}

/**
 * server → the riders of the named car ONLY (AD-013). The car's full current
 * occupant list and its FIFO press queue — the real-elevator "lit buttons are
 * visible from inside" model (late boarders and rejoiners included).
 */
export interface ElevatorRiders {
  readonly car: CarId
  readonly riders: readonly string[]
  readonly queue: readonly FloorId[]
}

/** server → all players. A player disconnected; remove their rectangle. */
export interface PlayerLeft {
  readonly playerId: string
}

/**
 * server → the floor's viewers (AD-009 coherence): a player departed this
 * floor by elevator — drop their rectangle. The destination is NOT conveyed.
 */
export interface PlayerLeftFloor {
  readonly playerId: string
  readonly floor: FloorId
}

/** Movement snapshot row for one player — public position data only. */
export interface MovementSnapshotPlayer {
  readonly playerId: string
  readonly floor: FloorId
  readonly x: number
}

/** Movement snapshot row for one car — floor only, never occupants (FR-6). */
export interface MovementSnapshotCar {
  readonly car: CarId
  readonly floor: FloorId
}

/**
 * server → one player. Public movement state on join and at the buzzer (MOVE-18).
 * `carOccupants` is present ONLY in a rider's personal snapshot (AD-013):
 * viewers standing on a floor get the byte-identical public shape — occupancy
 * and queue knowledge belongs exclusively to the people inside the car.
 */
export interface MovementSnapshot {
  readonly players: readonly MovementSnapshotPlayer[]
  readonly cars: readonly MovementSnapshotCar[]
  readonly carOccupants?: {
    readonly car: CarId
    readonly riders: readonly string[]
    readonly queue: readonly FloorId[]
  }
}

// ---------------------------------------------------------------------------
// Work channels (cycle 2.5, FR-7/8/9/16). Interiors (room states) reach only
// players inside the room's segment (FR-10); channel events are the actor's
// own private view. No payload names a role, a channel kind, or a fake (FR-9).
// ---------------------------------------------------------------------------

/** server → the actor. Their channel began; `seconds` drives the own progress bar. */
export interface WorkStarted {
  readonly playerId: string
  readonly floor: FloorId
  readonly room: RoomIndex
  readonly seconds: number
}

/** server → the actor. Their channel ended (walk-out cancel or completion). */
export interface WorkEnded {
  readonly playerId: string
  readonly floor: FloorId
  readonly room: RoomIndex
  readonly outcome: 'completed' | 'cancelled'
}

/** server → one player. The state of the room they just entered (FR-10). */
export interface RoomObserved {
  readonly playerId: string
  readonly floor: FloorId
  readonly room: RoomIndex
  readonly state: RoomState
}

/** server → the room's occupants. A real prep transition completed (FR-7). */
export interface RoomPrepped {
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → the room's occupants. A real un-prep transition completed (FR-8). */
export interface RoomTrashed {
  readonly floor: FloorId
  readonly room: RoomIndex
}

// ---------------------------------------------------------------------------
// Evidence layer (cycle 2.7, FR-10–FR-13). Cards, rustle, and door-open cues
// are hallway-visible (leak rule 2); payloads never carry timestamps (FR-11),
// authors, roles, or interior state.
// ---------------------------------------------------------------------------

/** server → same-floor viewers. A room became prepped; its card is now hung (FR-11). */
export interface RoomCarded {
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → the room's occupants. Fresh trash aged past FRESHNESS_WINDOW_SECONDS (FR-12). */
export interface RoomSettled {
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → earshot viewers (same floor within RUSTLE_RANGE_TILES, through walls — FR-13). */
export interface RoomRustle {
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → same-floor viewers. A player entered the room's segment (FR-10 cue half). */
export interface RoomEntered {
  readonly playerId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/**
 * client → server intent: host starts the round (FR-2). Validated by zod in the
 * room's `validate()` handler; the server rejects, it never trusts. Intents are
 * not part of the protocol registry.
 */
export const lobbyStartIntentSchema = z
  .object({
    type: z.literal('lobby:start'),
  })
  .strict()
export type LobbyStartIntent = z.infer<typeof lobbyStartIntentSchema>
