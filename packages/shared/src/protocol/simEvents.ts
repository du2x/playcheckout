import type { Role } from '../roles.js'

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
