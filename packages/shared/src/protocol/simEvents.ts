import type { Role } from '../roles.js'
import type { RoomState } from '../roomState.js'
import type { CarId, Facing, FloorId, RoomIndex } from './messages.js'

/**
 * Sim events are past-tense domain facts. The room routes each event per the
 * turnover-protocol rules — `role:dealt` reaches ONLY the named player.
 *
 * Lives in `packages/shared` (protocol surface) so the protocol registry can be
 * typed exhaustively against it; the sim re-exports it. Type-only — no runtime.
 */
export type SimEvent =
  | { readonly type: 'round:started'; readonly playerIds: readonly string[] }
  | { readonly type: 'role:dealt'; readonly playerId: string; readonly role: Role }
  | { readonly type: 'round:buzzer' }
  // --- Work channels (cycle 2.5, FR-7/8/9/16): interiors reach only the
  // people inside the room's segment (FR-10); channel events are the actor's
  // own private view. No payload names a role or a fake (FR-9).
  | {
      readonly type: 'work:started'
      readonly playerId: string
      readonly floor: FloorId
      readonly room: RoomIndex
      readonly seconds: number
    }
  | {
      readonly type: 'work:ended'
      readonly playerId: string
      readonly floor: FloorId
      readonly room: RoomIndex
      readonly outcome: 'completed' | 'cancelled'
    }
  | {
      readonly type: 'room:observed'
      readonly playerId: string
      readonly floor: FloorId
      readonly room: RoomIndex
      readonly state: RoomState
    }
  | { readonly type: 'room:prepped'; readonly floor: FloorId; readonly room: RoomIndex }
  | { readonly type: 'room:trashed'; readonly floor: FloorId; readonly room: RoomIndex }
  // --- Evidence layer (cycle 2.7, FR-10 cue half / FR-11 / FR-12 / FR-13):
  // hallway-visible info is exactly cards, door-open events, and in-range
  // rustle (leak rule 2). Cards carry no timestamp (FR-11); interiors still
  // travel only on room:observed / occupants rows.
  | { readonly type: 'room:carded'; readonly floor: FloorId; readonly room: RoomIndex }
  | { readonly type: 'room:settled'; readonly floor: FloorId; readonly room: RoomIndex }
  | { readonly type: 'room:rustle'; readonly floor: FloorId; readonly room: RoomIndex }
  | {
      readonly type: 'room:entered'
      readonly playerId: string
      readonly floor: FloorId
      readonly room: RoomIndex
    }

/**
 * Movement events (cycle 2.4, AD-005): emitted by the room-owned MovementSim in
 * both phases. Positions are public (turnover-protocol rule 2) — but elevator
 * events carry car floors ONLY, never occupants (FR-6 / rule 2).
 */
export type MovementEvent =
  | {
      readonly type: 'player:moved'
      readonly playerId: string
      readonly floor: FloorId
      readonly x: number
      readonly facing: Facing
    }
  | { readonly type: 'elevator:called'; readonly floor: FloorId; readonly car: CarId }
  | { readonly type: 'elevator:moved'; readonly car: CarId; readonly floor: FloorId }
  // AD-009 coherence: when a rider departs a floor, that floor's viewers learn
  // ONLY that she left — never the destination (cross-floor sightings stay
  // impossible for live players).
  | { readonly type: 'player:left-floor'; readonly playerId: string; readonly floor: FloorId }
  // --- Rider-exclusive knowledge (cycle 2.6, AD-013): occupancy and presses
  // are legitimate knowledge of the people inside the box — and only of them.
  // The event carries `car` for routing; the wire payload never names it.
  | {
      readonly type: 'elevator:pressed'
      readonly playerId: string
      readonly floor: FloorId
      readonly car: CarId
    }
  | {
      readonly type: 'elevator:riders'
      readonly car: CarId
      readonly riders: readonly string[]
      readonly queue: readonly FloorId[]
    }
