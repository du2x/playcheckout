import { z } from 'zod'
import type { Role } from '../roles.js'

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
  readonly code: 'need-more-players' | 'not-host' | 'round-already-active'
  readonly message: string
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
