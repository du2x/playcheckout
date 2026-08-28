import type { Role } from '../roles.js'
import type { CarId, Facing, FloorId } from './messages.js'

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
