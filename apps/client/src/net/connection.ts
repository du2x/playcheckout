import type { Room } from '@colyseus/sdk'
import { Client } from '@colyseus/sdk'
import type {
  IntentError,
  LobbySnapshot,
  RoleDealt,
  RoundBuzzer,
  RoundStarted,
} from '@turnover/shared'
import { recordServerMessage, setLocalIdentity } from '../debug'

/**
 * Thin wrapper over the Colyseus SDK session (AD-001: the client talks to the
 * same Fastify origin that serves it — vite dev proxies matchmake/ws). Every
 * received message is forwarded typed AND recorded into the dev-only hook.
 * Recipient rules per turnover-protocol: role:dealt arrives only on the
 * recipient's own connection; nothing here is ever shared between players.
 */

export type ServerMessage =
  | { kind: 'lobby:snapshot'; snapshot: LobbySnapshot }
  | { kind: 'round:started'; message: RoundStarted }
  | { kind: 'role:dealt'; message: RoleDealt }
  | { kind: 'round:buzzer'; message: RoundBuzzer }
  | { kind: 'error'; message: IntentError }

export interface ConnectionCallbacks {
  onMessage: (message: ServerMessage) => void
  onDisconnect: () => void
}

type ClientRoom = Room<unknown>

export class Connection {
  private constructor(private readonly room: ClientRoom) {}

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

    room.onMessage('lobby:snapshot', (snapshot: LobbySnapshot) => {
      recordServerMessage('lobby:snapshot', snapshot)
      cb.onMessage({ kind: 'lobby:snapshot', snapshot })
    })
    room.onMessage('round:started', (message: RoundStarted) => {
      recordServerMessage('round:started', message)
      cb.onMessage({ kind: 'round:started', message })
    })
    room.onMessage('role:dealt', (message: RoleDealt) => {
      recordServerMessage('role:dealt', message)
      cb.onMessage({ kind: 'role:dealt', message })
    })
    room.onMessage('round:buzzer', (message: RoundBuzzer) => {
      recordServerMessage('round:buzzer', message)
      cb.onMessage({ kind: 'round:buzzer', message })
    })
    room.onMessage('error', (message: IntentError) => {
      recordServerMessage('error', message)
      cb.onMessage({ kind: 'error', message })
    })
    room.onLeave(() => cb.onDisconnect())

    return new Connection(room)
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
