/**
 * Wire envelope types for the message-only protocol (turnover-protocol skill).
 * Concrete message catalog arrives in Phase 2, mirroring the sim's event surface.
 * Every type's comment names its intended recipients — audited by grep (protocol rule 5).
 */

/** Server → one player. What this recipient legitimately knows at this moment (rule 1). */
export interface PersonalSnapshot {
  /** Phase 2 fills concrete view fields: own position, own room's interior, panels, door cards. */
  readonly view: unknown
}

/** Server → one player. Ordered past-tense domain event on that player's private stream. */
export interface GameEventEnvelope {
  /** Monotonic per-connection sequence number for client-side gap detection. */
  readonly seq: number
  /** Server simulation time (ms since round start). */
  readonly time: number
  readonly event: { readonly type: string }
}

/** Server → all players. Past-tense domain event with no per-player variance. */
export interface BroadcastEventEnvelope {
  readonly time: number
  readonly event: { readonly type: string }
}

/** Client → server intent. Always routed through Colyseus 0.18 zod validate(); the server rejects, it never trusts (rule: protocol conventions). */
export interface PlayerIntent {
  readonly type: string
}
