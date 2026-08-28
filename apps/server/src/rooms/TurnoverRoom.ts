import { randomInt } from 'node:crypto'
import { type LobbySnapshot, lobbyStartIntentSchema, TUNING } from '@turnover/shared'
import { RoundSim, type SimEvent } from '@turnover/sim'
import { type Client, Room } from 'colyseus'

/**
 * The round container (cycle 2.1). Lobby half: join by 4-letter code with
 * validated display names, roster snapshots, host tracking. Round half: guards
 * the host start intent, owns the RoundSim lifecycle, routes sim events per the
 * turnover-protocol rules — role:dealt reaches ONLY the dealt player; no role
 * field ever rides a broadcast. Message-only — patchRate null, no Schema state.
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

  /** Production: 50 ms = 20 Hz (prd §11). Tests set 0 and drive ticks directly. */
  static tickMs = 50

  private phase: 'lobby' | 'round' = 'lobby'
  private players = new Map<string, LobbyPlayer>()
  private joinedCounter = 0
  private sim: RoundSim | null = null

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

    if (TurnoverRoom.tickMs > 0) {
      this.setSimulationInterval(() => this.advance(), TurnoverRoom.tickMs)
    }
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
    if (this.phase !== 'lobby') {
      this.sendTo(sessionId, 'error', {
        type: 'error',
        code: 'round-already-active',
        message: 'a round is already running',
      })
      return
    }
    const hostId = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]?.sessionId
    if (sessionId !== hostId) {
      this.sendTo(sessionId, 'error', {
        type: 'error',
        code: 'not-host',
        message: 'only the host can start the round',
      })
      return
    }
    if (this.players.size < TUNING.PLAYERS_MIN) {
      this.sendTo(sessionId, 'error', {
        type: 'error',
        code: 'need-more-players',
        message: `need at least ${TUNING.PLAYERS_MIN} players`,
      })
      return
    }
    this.startRound()
  }

  private startRound() {
    this.phase = 'round'
    const playerIds = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => p.sessionId)
    // Seed never leaves the server: it appears in no event and no payload.
    this.sim = new RoundSim({ seed: randomInt(2 ** 31), playerIds })
  }

  /** One fixed 0.05 s step; the production interval and the test hook share this path. */
  private advance() {
    const sim = this.sim
    if (sim === null || this.phase !== 'round') return
    for (const event of sim.tick()) this.route(event)
    if (sim.clockTicksRemaining <= 0) {
      // Buzzer: roles were the sim's alone — dropping it wipes the deal (AD-002).
      this.sim = null
      this.phase = 'lobby'
    }
  }

  private route(event: SimEvent) {
    switch (event.type) {
      case 'round:started':
        this.broadcast('round:started', { type: event.type, playerIds: event.playerIds })
        break
      case 'role:dealt':
        this.sendTo(event.playerId, 'role:dealt', { type: event.type, role: event.role })
        break
      case 'round:buzzer':
        this.broadcast('round:buzzer', { type: event.type })
        break
    }
  }

  /** Test hook: drive the sim deterministically without wall-clock waits. */
  __driveTicks(count: number) {
    for (let i = 0; i < count; i++) this.advance()
  }

  /** Test hook: read the phase without poking private state from tests. */
  __phase(): 'lobby' | 'round' {
    return this.phase
  }

  private sendTo(sessionId: string, type: string, payload: unknown) {
    const target = this.clients.find((c) => c.sessionId === sessionId)
    target?.send(type, payload)
  }
}
