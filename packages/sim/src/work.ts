import type { GuestFloorId, Role, RoomIndex, RoomState, SimEvent } from '@turnover/shared'
import { roomIndexAtMilli, TUNING } from '@turnover/shared'
import { TICK_HZ } from './tick.js'

/**
 * Pure work-channel system (cycle 2.5, FR-7/8/9/16): the round-scoped half of
 * the work layer, composed by RoundSim. Room states live here; positions are
 * INPUT — the room feeds the movement sim's positions in every tick, so this
 * module stays inputs + time in, events out (no I/O, no clocks, no randomness).
 *
 * Segment geometry is AD-010 (rooms tile [1, 29] in 3.5-tile segments); x is
 * expected in integer MILLITILES, matching the movement sim's internal unit.
 */

/** Channel durations, derived from §7: 5 s prep/fake, 3 s un-prep. */
export const PREP_TICKS = TUNING.PREP_SECONDS * TICK_HZ
export const UNPREP_TICKS = TUNING.UNPREP_SECONDS * TICK_HZ

/** Why a `work:start` intent ended the way it did (room maps these to errors 1:1). */
export type StartWorkResult = 'accepted' | 'not-in-room' | 'room-not-workable' | 'channel-active'

/** The action a channel performs — derived server-side, NEVER client-bound (FR-9). */
type ChannelKind = 'prep' | 'unprep' | 'fake'

interface Channel {
  readonly playerId: string
  readonly floor: GuestFloorId
  readonly room: RoomIndex
  readonly kind: ChannelKind
  ticksLeft: number
}

export interface PositionSample {
  readonly floor: GuestFloorId | 'lobby'
  readonly x: number
}

/** Per-tick position input: playerId → { floor, x in millitiles }. */
export type RoundPositions = ReadonlyMap<string, PositionSample>

const roomKey = (floor: GuestFloorId | 'lobby', room: RoomIndex): string => `${floor}:${room}`

export class WorkChannels {
  private readonly states = new Map<string, RoomState>()
  private readonly channels = new Map<string, Channel>()
  private readonly lastPositions = new Map<string, PositionSample>()
  /** Last segment key seen per player — `room:observed` fires on changes only. */
  private readonly lastSegment = new Map<string, string | null>()
  private pendingStarted: SimEvent[] = []

  constructor(private readonly deal: ReadonlyMap<string, Role>) {
    for (let room = 1 as RoomIndex; room <= 8; room = (room + 1) as RoomIndex) {
      for (const floor of ['floor1', 'floor2', 'floor3'] as const) {
        this.states.set(roomKey(floor, room), 'fresh')
      }
    }
  }

  /** The current state of one room (guest floors only). */
  stateOf(floor: GuestFloorId, room: RoomIndex): RoomState {
    return this.states.get(roomKey(floor, room)) ?? 'fresh'
  }

  /**
   * Validate and start a channel (FR-7/8/9). The action matrix:
   * staff on fresh|trashed → prep (100 ticks); saboteur on prepped → un-prep
   * (60 ticks); saboteur on fresh|trashed → fake prep (100 ticks, no effect).
   * Everything else is a rejection — the room turns rejections into errors.
   */
  startWork(playerId: string, floor: GuestFloorId, room: RoomIndex): StartWorkResult {
    if (this.channels.has(playerId)) return 'channel-active'
    const pos = this.lastPositions.get(playerId)
    if (pos === undefined || pos.floor !== floor || roomIndexAtMilli(pos.x) !== room) {
      return 'not-in-room'
    }
    const role = this.deal.get(playerId)
    const state = this.states.get(roomKey(floor, room)) ?? 'fresh'
    if (role === 'saboteur') {
      if (state === 'prepped') {
        this.begin(playerId, floor, room, 'unprep')
      } else {
        this.begin(playerId, floor, room, 'fake')
      }
    } else {
      if (state === 'prepped') return 'room-not-workable'
      this.begin(playerId, floor, room, 'prep')
    }
    return 'accepted'
  }

  private begin(playerId: string, floor: GuestFloorId, room: RoomIndex, kind: ChannelKind): void {
    const total = kind === 'unprep' ? UNPREP_TICKS : PREP_TICKS
    this.channels.set(playerId, { playerId, floor, room, kind, ticksLeft: total })
    // Announce on the next tick, mirroring the movement sim's announce pattern.
    this.pendingStarted.push({
      type: 'work:started',
      playerId,
      floor,
      room,
      seconds: total / TICK_HZ,
    })
  }

  /** Drop a player's channel silently — no `work:ended`, no trace (WORK-12). */
  leave(playerId: string): void {
    this.channels.delete(playerId)
    this.lastPositions.delete(playerId)
    this.lastSegment.delete(playerId)
  }

  /**
   * Advance one 0.05 s step. Order is deterministic: pending starts, then
   * walk-out cancels, then completions in channel-start order (spec edge:
   * same-tick completions apply in start order), then segment observation.
   */
  tick(positions: RoundPositions): readonly SimEvent[] {
    for (const [playerId, pos] of positions) this.lastPositions.set(playerId, pos)
    const events: SimEvent[] = this.pendingStarted.splice(0)

    // Walk-out cancels (FR-16): leaving the segment — x out, floor change, or
    // boarding an elevator (landing x is outside every segment) — cancels on
    // the exit tick with exactly one `work:ended` and no state change.
    for (const channel of [...this.channels.values()]) {
      const pos = positions.get(channel.playerId)
      const inside =
        pos !== undefined && pos.floor === channel.floor && roomIndexAtMilli(pos.x) === channel.room
      if (!inside) {
        this.channels.delete(channel.playerId)
        events.push({
          type: 'work:ended',
          playerId: channel.playerId,
          floor: channel.floor,
          room: channel.room,
          outcome: 'cancelled',
        })
      }
    }

    // Completions in channel-start order (Map preserves insertion).
    for (const channel of [...this.channels.values()]) {
      channel.ticksLeft--
      if (channel.ticksLeft > 0) continue
      this.channels.delete(channel.playerId)
      const key = roomKey(channel.floor, channel.room)
      if (channel.kind === 'prep' || channel.kind === 'unprep') {
        const target: RoomState = channel.kind === 'prep' ? 'prepped' : 'trashed'
        // Only an actual state change emits a room transition — a second
        // concurrent prep completing on an already-prepped room stays silent.
        if ((this.states.get(key) ?? 'fresh') !== target) {
          this.states.set(key, target)
          events.push(
            target === 'prepped'
              ? { type: 'room:prepped', floor: channel.floor, room: channel.room }
              : { type: 'room:trashed', floor: channel.floor, room: channel.room },
          )
        }
      } // fake prep: animation only — no state change, no room event (FR-9)
      events.push({
        type: 'work:ended',
        playerId: channel.playerId,
        floor: channel.floor,
        room: channel.room,
        outcome: 'completed',
      })
    }

    // Segment observation (FR-10 read half): entering a room's segment sends
    // that player the room's state; every other interior fact stays put.
    for (const [playerId, pos] of positions) {
      if (pos.floor === 'lobby') {
        this.lastSegment.set(playerId, null)
        continue
      }
      const room = roomIndexAtMilli(pos.x)
      const key = room === 0 ? null : roomKey(pos.floor, room)
      if (key === (this.lastSegment.get(playerId) ?? null)) continue
      this.lastSegment.set(playerId, key)
      if (key !== null && room !== 0) {
        events.push({
          type: 'room:observed',
          playerId,
          floor: pos.floor,
          room,
          state: this.states.get(key) ?? 'fresh',
        })
      }
    }

    return events
  }
}
