import type {
  IntentError,
  LobbySnapshot,
  RoleDealt,
  RoundBuzzer,
  RoundStarted,
} from './messages.js'
import type { SimEvent } from './simEvents.js'

/**
 * The protocol registry (cycle 2.3, AD-006): every server→client message type is
 * declared exactly ONCE — wire name, payload type, and recipient policy. This
 * file is the audit surface for turnover-protocol rule 5: hidden information is
 * the product, and who may receive what is declared here, not grepped.
 *
 * Client→server intents are NOT part of the registry (they stay zod-validated
 * in the room's `validate()` handlers). The registry is the only catalog of
 * server→client messages; `envelope.ts` and the drift-prone broadcast/private
 * unions were deleted in this cycle.
 */

/** Closed recipient-policy enum. Extended deliberately, never speculatively. */
export type RecipientPolicy = 'all' | 'self'

/**
 * The envelope the Router stamps on every server→client message. `seq` is
 * per-connection, monotonic, starting at 1; `time` is server `Date.now()` in ms.
 * The Colyseus wire name is the only type tag — payloads carry no `type` field.
 */
export interface Envelope<P = unknown> {
  readonly seq: number
  readonly time: number
  readonly payload: P
}

/**
 * One registry row. `payload` is a type token (never read at runtime — only
 * through `RegistryPayload<K>`); `fromSim` projects a sim event into its wire
 * payload and, for self-policy events, the private recipient.
 */
export interface RegistryEntry<P = unknown> {
  readonly payload: P
  readonly recipients: RecipientPolicy
}

/** Wire payload type per registry key. */
export interface Payloads {
  /** server → one player. Personal snapshot on join and every roster change. */
  'lobby:snapshot': LobbySnapshot
  /** server → all players (broadcast). Round begin; ids only — no roles. */
  'round:started': RoundStarted
  /** server → exactly one player, private. The recipient's own role card (FR-2). */
  'role:dealt': RoleDealt
  /** server → all players (broadcast). Shift clock expired. */
  'round:buzzer': RoundBuzzer
  /** server → one player. Intent rejection reason (join errors use Colyseus join rejection). */
  error: IntentError
}

export type RegistryKey = keyof Payloads
export type RegistryPayload<K extends RegistryKey> = Payloads[K]

/**
 * A sim event of type K projects into its declared wire payload (+ optional
 * private recipient). Typed per key so a projection returning the wrong payload
 * shape fails to compile.
 */
export type SimProjection<K extends SimEvent['type']> = (event: Extract<SimEvent, { type: K }>) => {
  payload: RegistryPayload<K>
  self?: string
}

type Entry<K extends RegistryKey> = {
  readonly payload: RegistryPayload<K>
  readonly recipients: RecipientPolicy
  readonly fromSim: K extends SimEvent['type'] ? SimProjection<K> : undefined
}

/**
 * THE registry. Exhaustiveness is structural:
 * - `{ [K in RegistryKey]: Entry<K> }` types every row against its own key.
 * - `& { [K in SimEvent['type']]: unknown }` makes an undeclared sim event a
 *   compile error (spec REG-02) while allowing room-originated keys.
 */
export const PROTOCOL_REGISTRY = {
  'lobby:snapshot': {
    payload: {} as LobbySnapshot,
    recipients: 'self',
    fromSim: undefined,
  },
  'round:started': {
    payload: {} as RoundStarted,
    recipients: 'all',
    // Cast to the declared projection: `satisfies` validates rows, but the
    // const's inferred per-row function types would otherwise drop the optional
    // `self` field and break uniform destructuring in the Router.
    fromSim: ((event) => ({
      payload: { playerIds: event.playerIds },
    })) as SimProjection<'round:started'>,
  },
  'role:dealt': {
    payload: {} as RoleDealt,
    recipients: 'self',
    fromSim: ((event) => ({
      self: event.playerId,
      payload: { role: event.role },
    })) as SimProjection<'role:dealt'>,
  },
  'round:buzzer': {
    payload: {} as RoundBuzzer,
    recipients: 'all',
    fromSim: (() => ({ payload: {} })) as SimProjection<'round:buzzer'>,
  },
  error: {
    payload: {} as IntentError,
    recipients: 'self',
    fromSim: undefined,
  },
} as const satisfies { [K in RegistryKey]: Entry<K> } & { [K in SimEvent['type']]: unknown }

export type RegistryRecipients<K extends RegistryKey> = (typeof PROTOCOL_REGISTRY)[K]['recipients']

/** Registry keys whose declared policy is R — the Router's compile-time policy gate. */
export type KeysWith<R extends RecipientPolicy> = {
  [K in RegistryKey]: RegistryRecipients<K> extends R ? K : never
}[RegistryKey]
