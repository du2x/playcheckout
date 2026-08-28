import type Phaser from 'phaser'
import { Connection, type ServerMessage } from './net/connection'
import { initialViewState, reduce, roundPlayers, type ViewAction, type ViewState } from './state'
import { el } from './ui/dom'
import { renderJoin } from './ui/joinView'
import { renderLobby } from './ui/lobbyView'
import { renderRoundHud } from './ui/roundHud'

/**
 * First-light app controller (cycle 2.2): owns the reducer state, the Colyseus
 * connection, and the DOM overlay views. Server messages → actions → state →
 * re-render; the Phaser world only mirrors what the state already knows.
 * SPEC_DEVIATION: hosts create rooms (Connection.create) — join-only UI cannot
 * start the human flow; recorded in the spec's Assumptions table.
 */
export class App {
  private state: ViewState = initialViewState()
  private connection: Connection | null = null
  private roomCode = ''
  private stopClock: (() => void) | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly game: Phaser.Game,
  ) {
    this.render()
  }

  /** Host path: create a room and get its generated 4-letter code. */
  async createRoom(rawName: string): Promise<void> {
    if (!this.beginConnection()) return
    const name = rawName.trim()
    if (name.length < 1 || name.length > 16) {
      this.dispatch({ type: 'join-failed', reason: 'enter a 1-16 character name' })
      this.render()
      return
    }
    await this.connect(() => Connection.create(name, this.callbacks()))
  }

  /** Guest path: join an existing room by 4-letter code (LIGHT-01..04). */
  async submitJoin(rawCode: string, rawName: string): Promise<void> {
    if (!this.beginConnection()) return
    const code = rawCode.trim().toUpperCase()
    const name = rawName.trim()
    if (!/^[A-Z]{4}$/.test(code)) {
      this.dispatch({ type: 'join-failed', reason: 'enter a 4-letter room code' })
      this.render()
      return
    }
    if (name.length < 1 || name.length > 16) {
      this.dispatch({ type: 'join-failed', reason: 'enter a 1-16 character name' })
      this.render()
      return
    }
    await this.connect(() => Connection.open(code, name, this.callbacks()))
  }

  startRound(): void {
    this.connection?.sendStart()
  }

  private beginConnection(): boolean {
    const before = this.state
    this.dispatch({ type: 'submit-join' })
    // Spec edge: a submission while a connection is in flight is ignored
    // (the reducer's joining-guard absorbed the action — nothing to do).
    return this.state !== before
  }

  private callbacks() {
    return {
      onMessage: (message: ServerMessage) => this.handleMessage(message),
      onDisconnect: () => {
        this.dispatch({ type: 'connection-lost' })
        this.render()
      },
    }
  }

  private async connect(open: () => Promise<Connection>): Promise<void> {
    try {
      this.connection = await open()
      this.roomCode = this.connection.roomId
    } catch (error) {
      this.dispatch({
        type: 'join-failed',
        reason: error instanceof Error ? error.message : 'join failed',
      })
    }
    this.render()
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.kind) {
      case 'lobby:snapshot':
        this.dispatch({ type: 'snapshot', snapshot: message.snapshot })
        break
      case 'round:started': {
        this.dispatch({ type: 'round-started', playerIds: message.message.playerIds })
        const players = roundPlayers(this.state.roundPlayerIds, this.state.snapshot)
        this.game.scene.stop('Boot')
        this.game.scene.start('Round', { players })
        break
      }
      case 'role:dealt':
        this.dispatch({ type: 'role-dealt', role: message.message.role })
        break
      case 'round:buzzer':
        this.game.scene.stop('Round')
        this.dispatch({ type: 'buzzer' })
        break
      case 'error':
        this.dispatch({ type: 'intent-error', message: message.message.message })
        break
    }
    this.render()
  }

  private dispatch(action: ViewAction): void {
    this.state = reduce(this.state, action)
  }

  private render(): void {
    this.stopClock?.()
    this.stopClock = null
    this.root.replaceChildren()

    switch (this.state.view) {
      case 'join':
        renderJoin(this.root, this.state.error, this.state.joining, {
          onSubmit: (code, name) => void this.submitJoin(code, name),
          onCreate: (name) => void this.createRoom(name),
        })
        break
      case 'lobby':
        if (this.state.snapshot !== null) {
          renderLobby(this.root, this.state.snapshot, this.roomCode, this.state.error, {
            onStart: () => this.startRound(),
          })
        }
        break
      case 'round':
        this.stopClock = renderRoundHud(this.root, this.state)
        break
      case 'lost':
        this.root.append(el('div', { id: 'lost-view' }, ['connection lost']))
        break
    }
  }
}
