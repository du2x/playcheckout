import type { FloorId, GuestFloorId, RoomIndex } from '@turnover/shared'
import type Phaser from 'phaser'
import { Connection } from './net/connection'
import { initialRiderSession, type RiderUpdate, reduceRider } from './riderSession'
import type { WorldScene } from './scenes/WorldScene'
import {
  ACTION_ROUTES,
  initialViewState,
  reduce,
  type SceneAction,
  type ViewAction,
  type ViewName,
  type ViewState,
} from './state'
import { syncCarScreen } from './ui/carScreen'
import { el } from './ui/dom'
import { renderJoin } from './ui/joinView'
import { renderLobby } from './ui/lobbyView'
import { renderRoundHud } from './ui/roundHud'

/**
 * First-light app controller (cycle 2.2): owns the reducer state, the Colyseus
 * connection, and the DOM overlay views. Server messages → mapper actions →
 * state → re-render; the Phaser world only mirrors what the state already
 * knows. Cycle 2.3 (AD-006): messages arrive pre-dispatched as ViewActions from
 * the exhaustive mapper table. Cycle 2.4 (AD-005): movement actions are render
 * state — they route to the persistent world scene (and surgical panel DOM
 * updates) instead of the reducer, which no-ops them; view actions keep driving
 * state + DOM. The world scene mounts at first lobby entry and survives the
 * buzzer — positions persist across lobby→round→lobby.
 * SPEC_DEVIATION: hosts create rooms (Connection.create) — join-only UI cannot
 * start the human flow; recorded in the spec's Assumptions table.
 */
export class App {
  private state: ViewState = initialViewState()
  private connection: Connection | null = null
  private roomCode = ''
  private stopClock: (() => void) | null = null
  /** The rider session (AD-013): the single derivation of the local player's
   * in-car state, reduced purely in riderSession.ts — the chip renders from it
   * and the world scene receives it for its keymap gate + rider visibility. */
  private rider: RiderUpdate = initialRiderSession()

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
      onActions: (actions: ViewAction[]) => {
        let viewChanged = false
        const ownId = this.state.snapshot?.ownId
        for (const action of actions) {
          // Rider knowledge reduces first (one state home, riderSession.ts);
          // the scene's keymap gate + the chip both consume the result.
          const riderBefore = this.rider
          this.rider = reduceRider(this.rider, action, ownId)
          if (this.rider !== riderBefore) {
            this.world()?.setRiderSession(this.rider)
            this.updateRiderChip()
          }
          const route = ACTION_ROUTES[action.type]
          if (route === 'scene') {
            if (isSceneAction(action)) this.world()?.applyAction(action)
            continue
          }
          if (route === 'consumed') {
            // Rider-exclusive events: fully consumed by the session.
            continue
          }
          this.dispatch(action)
          viewChanged = true
          // Roster growth/shrink must reach the world scene too (AD-005:
          // players are visible from the moment they join).
          if (action.type === 'snapshot') {
            this.world()?.syncRoster(action.snapshot.roster)
          }
          // A fresh deal resets every room: cards and cues die with the sim.
          if (action.type === 'round-started') this.world()?.resetEvidence()
        }
        if (viewChanged) this.render()
      },
      onDisconnect: () => {
        this.dispatch({ type: 'connection-lost' })
        this.render()
      },
    }
  }

  private world(): WorldScene | null {
    return (this.game.scene.getScene('Round') as WorldScene | null) ?? null
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

  private dispatch(action: ViewAction): void {
    const previousView = this.state.view
    this.state = reduce(this.state, action)
    this.syncScenes(previousView)
  }

  /**
   * The world scene mounts when the session enters the lobby for the first
   * time (players walk from the moment they join — AD-005) and unmounts only
   * when the session ends (lost/join). Round transitions never touch it.
   */
  private syncScenes(previousView: ViewName): void {
    if (this.state.view === previousView) return
    if (this.state.view === 'lobby' && previousView === 'join') {
      this.startWorld()
    } else if (this.state.view === 'join' || this.state.view === 'lost') {
      this.game.scene.stop('Round')
    }
  }

  private startWorld(): void {
    const snapshot = this.state.snapshot
    if (snapshot === null) return
    this.game.scene.stop('Boot')
    this.game.scene.start('Round', {
      players: snapshot.roster.map(({ id, name }) => ({ id, name })),
      ownId: snapshot.ownId,
      sendMoveStart: (dir: 'left' | 'right') => this.connection?.sendMoveStart(dir),
      sendMoveStop: () => this.connection?.sendMoveStop(),
      sendElevatorCall: () => this.connection?.sendElevatorCall(),
      sendElevatorPress: (floor: FloorId) => this.connection?.sendElevatorPress(floor),
      sendWorkStart: (floor: GuestFloorId, room: RoomIndex) =>
        this.connection?.sendWorkStart(floor, room),
      riderSession: this.rider,
    })
  }

  /**
   * Surgical chip write (AD-013): occupant names, the own car's queue as four
   * lit floor indicators (lit = queued or being served), and the last-press
   * line — visible only while the local player rides. The `#elevator-panel`
   * sibling is never touched: panels stay position-only (MOVE-17).
   */
  private updateRiderChip(): void {
    const chip = document.querySelector('#elevator-riders')
    if (chip === null) return
    const riding = this.rider
    if (riding === null) {
      chip.setAttribute('hidden', '')
      syncCarScreen(null, [], () => {})
      return
    }
    chip.removeAttribute('hidden')
    const names = new Map(this.state.snapshot?.roster.map((e) => [e.id, e.name] as const) ?? [])
    const namesEl = chip.querySelector('#elevator-riders-names')
    if (namesEl !== null) {
      namesEl.textContent = riding.occupants.map((id) => names.get(id) ?? id).join(', ')
    }
    for (const indicator of chip.querySelectorAll<HTMLElement>('.floor-indicator')) {
      const floor = indicator.dataset.floor as FloorId | undefined
      indicator.classList.toggle('lit', floor !== undefined && riding.queue.includes(floor))
    }
    const press = chip.querySelector('#elevator-press')
    if (press !== null) {
      press.textContent =
        riding.lastPress === null
          ? ''
          : `${names.get(riding.lastPress.playerId) ?? riding.lastPress.playerId} pressed ${riding.lastPress.floor}`
    }
    // In-car screen (AD-013): the button panel mirrors the same session.
    syncCarScreen(
      riding,
      riding.occupants.map((id) => names.get(id) ?? id),
      (floor) => this.connection?.sendElevatorPress(floor),
    )
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
    // View re-renders rebuild the chip DOM: restore the rider-exclusive state.
    this.updateRiderChip()
  }
}

/**
 * Scene narrowing derived from ACTION_ROUTES (state.ts): the runtime check
 * and the type claim come from the same table, so they cannot disagree.
 */
function isSceneAction(action: ViewAction): action is SceneAction {
  return ACTION_ROUTES[action.type] === 'scene'
}
