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
  // --- Justice (cycle 2.8, FR-15/18/19): firing is public but name-only.
  // `reason` is server-internal — the registry projection strips it, so the
  // wire payload is exactly {playerId} (FR-18; leak rules 3/4: no role, no
  // grace state, no validity verdict on the wire). Telemetry (2.10) reads the
  // reason from this event stream 1:1 (FR-23).
  | {
      readonly type: 'player:fired'
      readonly playerId: string
      readonly reason: FireReason
    }
  // --- Round end (cycle 2.9, §6.6): the winner reveal is legal ONLY because
  // the round is over (FR-21). `saboteurId` must never appear on any
  // pre-round payload — the sim's two-winner union is projected verbatim;
  // the wire payload widens with 'aborted' for the room-originated path.
  | {
      readonly type: 'round:ended'
      readonly winner: 'staff' | 'saboteur'
      readonly reason: RoundEndReason
      readonly saboteurId: string
    }

  // --- Guest lifecycle (cycle 3.1, FR-26/28): public weather. Every event is
  // 'all'-policy — guests are public NPCs, their target room is the checkable
  // claim the economy stands on (FR-27/FR-33 depend on it).
  | { readonly type: 'guest:arrived'; readonly guestId: string }
  | { readonly type: 'guest:impatient'; readonly guestId: string }
  | {
      readonly type: 'guest:self_assigned'
      readonly guestId: string
      readonly floor: FloorId
      readonly room: RoomIndex
    }
  | {
      readonly type: 'guest:settled'
      readonly guestId: string
      readonly floor: FloorId
      readonly room: RoomIndex
    }
  | {
      readonly type: 'guest:checked_out'
      readonly guestId: string
      readonly floor: FloorId
      readonly room: RoomIndex
    }
  | { readonly type: 'guest:left'; readonly guestId: string }

/**
 * Why a player was fired — server-internal only, never projected to the wire.
 * `wrong-accusation` covers both wrong cases (innocent target, saboteur in
 * grace) indistinguishably: validity is revealed only on the recap (FR-22).
 */
export type FireReason = 'walkin' | 'wrong-accusation' | 'correct-accusation'

/**
 * Why the round ended — §6.6 paths only. The room-originated abort carries
 * `saboteur-disconnected` directly on the wire payload (FR-25); the sim never
 * emits it (disconnects are transport-shaped, AD-002).
 */
export type RoundEndReason = 'saboteur-fired' | 'staff-reduced' | 'coverage-met' | 'coverage-failed'

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
  // AD-026/027: public door state — emitted when a car's doors begin their
  // opening swing (open: true) and when they begin closing to attend a call
  // (open: false). Door state is hallway-visible info (turnover-protocol
  // rule 2); it carries car/floor only, never occupants.
  | {
      readonly type: 'elevator:doors'
      readonly car: CarId
      readonly floor: FloorId
      readonly open: boolean
    }
  // AD-009 coherence: when a rider departs a floor, that floor's viewers learn
  // ONLY that she left — never the destination (cross-floor sightings stay
  // impossible for live players).
  | { readonly type: 'player:left-floor'; readonly playerId: string; readonly floor: FloorId }
  // --- Guest NPCs (cycle 3.1): public weather. A guest's position is public
  // same-floor info exactly like a player's (GUEST-12); guests are never
  // players and never appear in player:* events.
  | {
      readonly type: 'guest:moved'
      readonly guestId: string
      readonly floor: FloorId
      readonly x: number
    }
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
      /** Guests aboard (cycle 3.1, GUEST-07) — present only when non-empty. */
      readonly guests?: readonly string[]
    }
