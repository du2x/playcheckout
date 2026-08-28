import type { EventVisibility, MovementEvent } from '@turnover/shared'
import {
  type Envelope,
  type KeysWith,
  PROTOCOL_REGISTRY,
  type RecipientPolicy,
  type RegistryKey,
  type RegistryPayload,
  type SimEvent,
} from '@turnover/shared'
import type { Client, Room } from 'colyseus'

/**
 * Per-room protocol router (cycle 2.3, AD-006): applies recipient policies to
 * sim events and room-originated sends through ONE generic code path, and
 * stamps every message with the `{ seq, time, payload }` envelope. Owns the
 * per-connection sequence counters (monotonic, starting at 1; dropped when the
 * connection leaves — counters are per-connection, spec REG-17).
 *
 * SECURITY CORE: this module is the ONLY place in apps/server permitted to call
 * `client.send` or any room broadcast (enforced by the bypass denylist test in
 * `router.test.ts`). Recipient policies are declared per message type in
 * `PROTOCOL_REGISTRY` and applied structurally — a self-policy event cannot be
 * broadcast by this code, and an all-policy event cannot be sent to one player.
 *
 * Positional policies (cycle 2.5): `sameFloor` (AD-008/AD-009) delivers only to
 * live viewers whose view context floor matches the event's; `occupants` only
 * to viewers inside the event's room segment. The room supplies per-connection
 * view contexts via `setViewContext`; the Router never derives visibility
 * itself and never names a message type.
 */

/** What a connection may currently see — supplied by the room, never derived here. */
export interface ViewContext {
  /** The viewer's floor, or null for riders (no floor stream in a car, AD-008). */
  readonly floor: string | null
  /** `\`${floor}:${room}\`` of the segment the viewer stands in, or null. */
  readonly roomKey: string | null
}

const NO_VIEW: ViewContext = { floor: null, roomKey: null }

interface Projection {
  payload: unknown
  self?: string
  visibility?: EventVisibility
}

export class Router {
  private seqByConnection = new Map<string, number>()
  private viewContext: (sessionId: string) => ViewContext = () => NO_VIEW

  constructor(private readonly room: Room) {}

  /**
   * Register the per-connection visibility provider. The room derives contexts
   * from its movement sim (own floor + current segment); the Router only
   * matches them against the registry row's declared visibility.
   */
  setViewContext(fn: (sessionId: string) => ViewContext): void {
    this.viewContext = fn
  }

  /**
   * Route a sim event per its declared recipient policy. No per-type switch:
   * the registry row carries the projection and the policy; this method never
   * names a message type.
   */
  route(event: SimEvent | MovementEvent): void {
    const entry = PROTOCOL_REGISTRY[event.type]
    if (entry.fromSim === undefined) return
    // One contained cast: TS cannot apply a union of signatures to a union
    // argument. The registry's own satisfies typing guarantees the projection
    // matches the declared payload for exactly this event variant.
    const project = entry.fromSim as (e: SimEvent | MovementEvent) => Projection
    const { payload, self, visibility } = project(event)
    this.dispatch(event.type as RegistryKey, payload, entry.recipients, self, visibility)
  }

  /** Room-originated send to one player — only for keys whose policy is `self`. */
  toSelf<K extends KeysWith<'self'>>(key: K, sessionId: string, payload: RegistryPayload<K>): void {
    this.dispatch(key, payload, 'self', sessionId)
  }

  /** Room-originated broadcast — only for keys whose policy is `all`. */
  toAll<K extends KeysWith<'all'>>(key: K, payload: RegistryPayload<K>): void {
    this.dispatch(key, payload, 'all')
  }

  /** Drop a departed connection's counter. A fresh connection starts at seq 1. */
  forget(sessionId: string): void {
    this.seqByConnection.delete(sessionId)
  }

  private dispatch(
    key: RegistryKey,
    payload: unknown,
    recipients: RecipientPolicy,
    self?: string,
    visibility?: EventVisibility,
  ): void {
    const time = Date.now()
    if (recipients === 'self') {
      const target = this.liveClient(self)
      if (target !== undefined) this.deliver(target, key, payload, time)
      return
    }
    if (recipients === 'sameFloor') {
      for (const client of this.liveClients()) {
        if (this.viewContext(client.sessionId).floor === visibility?.floor) {
          this.deliver(client, key, payload, time)
        }
      }
      return
    }
    if (recipients === 'occupants') {
      for (const client of this.liveClients()) {
        if (this.viewContext(client.sessionId).roomKey === visibility?.roomKey) {
          this.deliver(client, key, payload, time)
        }
      }
      return
    }
    // Broadcast: each connection receives its own next seq (spec REG-07).
    for (const client of this.liveClients()) this.deliver(client, key, payload, time)
  }

  private deliver(client: Client, key: RegistryKey, payload: unknown, time: number): void {
    const seq = (this.seqByConnection.get(client.sessionId) ?? 0) + 1
    this.seqByConnection.set(client.sessionId, seq)
    client.send(key, { seq, time, payload } satisfies Envelope)
  }

  private liveClients(): Client[] {
    return [...this.room.clients]
  }

  private liveClient(sessionId: string | undefined): Client | undefined {
    if (sessionId === undefined) return undefined
    return this.liveClients().find((c) => c.sessionId === sessionId)
  }
}
