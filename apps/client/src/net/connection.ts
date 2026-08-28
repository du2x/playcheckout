import type { Room } from '@colyseus/sdk'
import { Client } from '@colyseus/sdk'
import type { Envelope, RegistryKey } from '@turnover/shared'
import { recordGap, recordServerMessage, registerGapProbe, setLocalIdentity } from '../debug'
import type { ViewAction } from '../state'
import { MAPPERS } from './mappers'

/**
 * Envelope consumer over the Colyseus SDK session (cycle 2.3, AD-006): one
 * generic `onMessage('*')` handler unwraps the `{ seq, time, payload }`
 * envelope, verifies per-connection seq continuity, and dispatches the payload
 * through the exhaustive `MAPPERS` table. No per-type handlers and no
 * re-tagging union — a new registry key needs only its mapper (REG-13).
 *
 * Seq guardian (REG-16): a non-consecutive seq records the gap in the dev-only
 * hook and leaves the room — the onLeave callback fires the existing
 * connection-loss path, and rejoining starts a fresh per-connection count
 * (REG-17). Recipient rules per turnover-protocol: role:dealt arrives only on
 * the recipient's own connection; nothing here is ever shared between players.
 */

export interface ConnectionCallbacks {
  onActions: (actions: ViewAction[]) => void
  onDisconnect: () => void
}

type ClientRoom = Room<unknown>

export class Connection {
  private constructor(private readonly room: ClientRoom) {
    // Dev-only: the harness forces a seq gap via the hook (client:envelope_gap).
    registerGapProbe(() => {
      this.lastSeq += 1000
    })
  }

  /** Per-connection seq tracking; a new Connection starts at 0 (REG-17). */
  private lastSeq = 0

  /**
   * SPEC_DEVIATION (recorded in spec Assumptions): first players must be able
   * to CREATE a room from the browser — join-by-code alone leaves the human
   * flow unreachable. Uses the same server matchmaking as cycle 2.1's tests
   * (client.create → the room generates its 4-letter code). No protocol change.
   */
  static async create(name: string, cb: ConnectionCallbacks): Promise<Connection> {
    const client = new Client(window.location.origin)
    const room = (await client.create('turnover', { name })) as ClientRoom
    return Connection.wire(room, cb)
  }

  /** Join the room by 4-letter code; rejects with the server's join reason. */
  static async open(code: string, name: string, cb: ConnectionCallbacks): Promise<Connection> {
    const client = new Client(window.location.origin)
    const room = (await client.joinById(code, { name })) as ClientRoom
    return Connection.wire(room, cb)
  }

  private static wire(room: ClientRoom, cb: ConnectionCallbacks): Connection {
    setLocalIdentity(room.sessionId, room.roomId)
    const connection = new Connection(room)

    room.onMessage('*', (wireName, raw) => {
      const name = String(wireName)
      const envelope = raw as Envelope
      recordServerMessage(name, envelope)
      if (connection.isGap(envelope)) return
      const mapper = MAPPERS[name as RegistryKey] as ((p: unknown) => ViewAction[]) | undefined
      if (mapper === undefined) return
      cb.onActions(mapper(envelope.payload))
    })
    room.onLeave(() => cb.onDisconnect())

    return connection
  }

  /** True when the envelope breaks seq continuity; leaves the room on a gap. */
  private isGap(envelope: Envelope): boolean {
    if (envelope.seq === this.lastSeq + 1) {
      this.lastSeq = envelope.seq
      return false
    }
    recordGap({ expected: this.lastSeq + 1, actual: envelope.seq, at: Date.now() })
    this.leave()
    return true
  }

  get roomId(): string {
    return this.room.roomId
  }

  sendStart(): void {
    this.room.send('lobby:start', { type: 'lobby:start' })
  }

  leave(): void {
    this.room.leave()
  }
}
