import type { Role } from '@turnover/shared'

/**
 * Sim events are past-tense domain facts. The room routes each event per the
 * turnover-protocol rules — `role:dealt` reaches ONLY the named player.
 */
export type SimEvent =
  | { readonly type: 'round:started'; readonly playerIds: readonly string[] }
  | { readonly type: 'role:dealt'; readonly playerId: string; readonly role: Role }
  | { readonly type: 'round:buzzer' }
