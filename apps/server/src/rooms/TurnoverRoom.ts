import { randomInt } from 'node:crypto'
import { type LobbySnapshot, lobbyStartIntentSchema, TUNING } from '@turnover/shared'
import { type Client, Room } from 'colyseus'

/**
 * The round container (cycle 2.1). Lobby half: join by 4-letter code with
 * validated display names, roster snapshots, host tracking. Round half lands
 * with the sim wiring (T5). Message-only — patchRate null, no Schema state
 * (protocol leak rule 1: the server never syncs state).
 */

/** 24-letter read-aloud alphabet — no I/O (codes are spoken aloud, FR-1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Process-local set of live room codes (AD-001: single-process deploy). */
const activeCodes = new Set<string>()

interface LobbyPlayer {
  sessionId: string
  name: string
  joinedAt: number
}

export class TurnoverRoom extends Room {
  /** Test hook: tracks created instances so tests can assert message-only config. */
  static instances: TurnoverRoom[] = []

  private phase: 'lobby' | 'round' = 'lobby'
  private players = new Map<string, LobbyPlayer>()
  private joinedCounter = 0

  override onCreate() {
    this.patchRate = null
    // Custom roomId = the shareable code (settable only during onCreate, verified
    // against installed 0.18.8 sources). Codes die with the room (FR-1: fresh
    // codes only for new groups).
    let code = this.drawCode()
    while (activeCodes.has(code)) code = this.drawCode()
    this.roomId = code
    activeCodes.add(code)
    TurnoverRoom.instances.push(this)

    // Overload 3 of onMessage (verified in installed 0.18.8 sources) takes a
    // StandardSchema validator — zod 4 implements Standard Schema V1.
    this.onMessage('lobby:start', lobbyStartIntentSchema, (client) => {
      this.handleStartIntent(client.sessionId)
    })
  }

  override onDispose() {
    activeCodes.delete(this.roomId)
  }

  override onJoin(client: Client, options: { name?: unknown }) {
    if (this.phase !== 'lobby') {
      throw new Error('round in progress')
    }
    if (this.players.size >= TUNING.PLAYERS_MAX) {
      throw new Error('room full')
    }
    const name = typeof options?.name === 'string' ? options.name.trim() : ''
    if (name.length < 1 || name.length > 16) {
      throw new Error('invalid name')
    }
    for (const player of this.players.values()) {
      if (player.name === name) throw new Error('name taken')
    }
    this.players.set(client.sessionId, {
      sessionId: client.sessionId,
      name,
      joinedAt: this.joinedCounter++,
    })
    // Fresh snapshot to everyone so rosters stay consistent without a feed.
    for (const sessionId of this.players.keys()) {
      this.sendTo(sessionId, 'lobby:snapshot', this.buildSnapshot(sessionId))
    }
  }

  override onLeave(client: Client) {
    this.players.delete(client.sessionId)
    for (const sessionId of this.players.keys()) {
      this.sendTo(sessionId, 'lobby:snapshot', this.buildSnapshot(sessionId))
    }
  }

  private drawCode(): string {
    let code = ''
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    return code
  }

  private buildSnapshot(ownId: string): LobbySnapshot {
    const roster = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.sessionId, name: p.name }))
    const hostId = roster[0]?.id
    const own = this.players.get(ownId)
    return {
      ownId,
      ownName: own?.name ?? '',
      isHost: ownId === hostId,
      roster,
    }
  }

  private handleStartIntent(sessionId: string) {
    // Round half (T5): guards, sim creation, event routing. Intent shell wired now.
    this.sendTo(sessionId, 'error', {
      type: 'error',
      code: 'not-host',
      message: 'round start not available yet',
    })
  }

  private sendTo(sessionId: string, type: string, payload: unknown) {
    const target = this.clients.find((c) => c.sessionId === sessionId)
    target?.send(type, payload)
  }
}
