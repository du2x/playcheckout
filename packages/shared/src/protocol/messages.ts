import { z } from 'zod'
import type { Role } from '../roles.js'

/**
 * Room-shell message catalog (cycle 2.1). Recipient rules per turnover-protocol
 * rule 5: every type names its recipients; reviewers grep every send/broadcast
 * against this list. Roles other than the recipient's own NEVER appear here;
 * the deal seed appears nowhere.
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
  readonly type: 'round:started'
  readonly playerIds: readonly string[]
}

/**
 * server → exactly one player, private. The recipient's own role card (prd FR-2).
 * NEVER broadcast; no other player's role may ever be attached to any payload.
 */
export interface RoleDealt {
  readonly type: 'role:dealt'
  readonly role: Role
}

/** server → all players (broadcast). Shift clock expired. */
export interface RoundBuzzer {
  readonly type: 'round:buzzer'
}

/** server → one player. Intent rejection reason (join errors use Colyseus join rejection). */
export interface IntentError {
  readonly type: 'error'
  readonly code: 'need-more-players' | 'not-host' | 'round-already-active'
  readonly message: string
}

/** Union of server → all broadcast events (no per-player variance, no roles). */
export type BroadcastGameEvent = RoundStarted | RoundBuzzer

/** Union of server → one player private events (own knowledge only). */
export type PrivateGameEvent = RoleDealt | IntentError

/**
 * client → server intent: host starts the round (FR-2). Validated by zod in the
 * room's `validate()` handler; the server rejects, it never trusts.
 */
export const lobbyStartIntentSchema = z
  .object({
    type: z.literal('lobby:start'),
  })
  .strict()
export type LobbyStartIntent = z.infer<typeof lobbyStartIntentSchema>
