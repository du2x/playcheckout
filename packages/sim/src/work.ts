import type {
  FloorId,
  GuestFloorId,
  Role,
  RoomIndex,
  RoomState,
  SimEvent,
  TrashProvenance,
} from '@turnover/shared'
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
/** Freshness window (FR-12): trash older than this has settled. */
export const FRESHNESS_TICKS = TUNING.FRESHNESS_WINDOW_SECONDS * TICK_HZ

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
  readonly floor: FloorId
  readonly x: number
}

/** Per-tick position input: playerId → { floor, x in millitiles }. */
export type RoundPositions = ReadonlyMap<string, PositionSample>

const roomKey = (floor: GuestFloorId | 'lobby', room: RoomIndex): string => `${floor}:${room}`

export class WorkChannels {
  private readonly states = new Map<string, RoomState>()
  /** Parallel author dimension (cycle 3.4, FR-32): per-room provenance, only trashed/settled carry sabotage/churn */
  private readonly provenances = new Map<string, TrashProvenance>()
  private readonly channels = new Map<string, Channel>()
  private readonly lastPositions = new Map<string, PositionSample>()
  /** Last segment key seen per player — `room:observed` fires on changes only. */
  private readonly lastSegment = new Map<string, string | null>()
  /** Rooms whose prep ever completed (EVID-01) — permanent, no removal (FR-11). */
  private readonly carded = new Set<string>()
  /** roomKey → absolute tick the freshness window elapses (EVID-06). */
  private readonly settleAt = new Map<string, number>()
  private elapsedTicks = 0
  private pendingStarted: SimEvent[] = []

  constructor(private readonly deal: ReadonlyMap<string, Role>) {
    for (let room = 1 as RoomIndex; room <= 8; room = (room + 1) as RoomIndex) {
      for (const floor of ['floor1', 'floor2', 'floor3'] as const) {
        this.states.set(roomKey(floor, room), 'fresh')
        this.provenances.set(roomKey(floor, room), 'none')
      }
    }
  }

  /** The current state of one room (guest floors only). */
  stateOf(floor: GuestFloorId, room: RoomIndex): RoomState {
    return this.states.get(roomKey(floor, room)) ?? 'fresh'
  }

  /** Author dimension (cycle 3.4, FR-32): provenance of the trash in one room. */
  provenanceOf(floor: GuestFloorId, room: RoomIndex): TrashProvenance {
    return this.provenances.get(roomKey(floor, room)) ?? 'none'
  }

  /**
   * Checkout churn (cycle 3.1, spawn half of FR-32): a settled guest checking
   * out re-trashes their room as `settled` — aged trash with no freshness
   * window, no rustle, no card, and deliberately NO `room:trashed` event
   * (that event is sabotage-shaped: grace and walk-in logic key off it,
   * JUST-07/08). The client learns the room's fate from `guest:checked_out`;
   * snapshots and `room:observed` surface the `settled` state. Excluded from
   * coverage like any un-prepped room (preppedCount only counts `prepped`).
   * Idempotent.
   */
  churnTrash(floor: GuestFloorId, room: RoomIndex): void {
    const key = roomKey(floor, room)
    this.states.set(key, 'settled')
    this.provenances.set(key, 'churn')
  }

  /** The carded rooms of one floor, ascending (EVID-04 snapshot query). */
  cardedOn(floor: GuestFloorId): RoomIndex[] {
    const rooms: RoomIndex[] = []
    for (let room = 1 as RoomIndex; room <= 8; room = (room + 1) as RoomIndex) {
      if (this.carded.has(roomKey(floor, room))) rooms.push(room)
    }
    return rooms
  }

  /**
   * Current state of every room — the FR-20 spectator baseline and the recap's
   * freshness read both consume this (cycle 2.9). Row order is deterministic:
   * floors then rooms ascending.
   */
  roomStates(): { floor: GuestFloorId; room: RoomIndex; state: RoomState }[] {
    const rows: { floor: GuestFloorId; room: RoomIndex; state: RoomState }[] = []
    for (const floor of ['floor1', 'floor2', 'floor3'] as const) {
      for (let room = 1 as RoomIndex; room <= 8; room = (room + 1) as RoomIndex) {
        rows.push({ floor, room, state: this.states.get(roomKey(floor, room)) ?? 'fresh' })
      }
    }
    return rows
  }

  /** Rooms CURRENTLY in `prepped` state — the buzzer coverage check (win conditions). */
  get preppedCount(): number {
    let count = 0
    for (const state of this.states.values()) {
      if (state === 'prepped') count++
    }
    return count
  }

  /**
   * Justice query (cycle 2.8): the owner of the active un-prep channel in one
   * room, or null. At most one exists (exactly one saboteur, one channel per
   * player) — the walk-in conviction's channel lookup.
   */
  activeUnprepOwner(floor: GuestFloorId, room: RoomIndex): string | null {
    for (const channel of this.channels.values()) {
      if (channel.kind === 'unprep' && channel.floor === floor && channel.room === room) {
        return channel.playerId
      }
    }
    return null
  }

  /**
   * Justice query (cycle 2.8): the last fed position of one player — the
   * accusation range check reads the movement layer's positions here.
   */
  positionOf(playerId: string): PositionSample | undefined {
    return this.lastPositions.get(playerId)
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
    this.elapsedTicks++
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
          if (target === 'prepped') {
            // EVID-01: the card auto-hangs on prep completion — permanent
            // (no removal exists, FR-11); a re-prep re-emits idempotently.
            this.carded.add(key)
            events.push({ type: 'room:carded', floor: channel.floor, room: channel.room })
            // EVID-09: a prepped room has no trash to settle — cancel.
            this.settleAt.delete(key)
            // FR-32 (3.4): a clean room has no author.
            this.provenances.set(key, 'none')
          } else {
            // EVID-06: the window starts at the sabotage completion tick;
            // re-trash overwrites (EVID-10).
            this.settleAt.set(key, this.elapsedTicks + FRESHNESS_TICKS)
            // FR-32 (3.4): sabotage trash is sabotage provenance, overwriting churn.
            this.provenances.set(key, 'sabotage')
            // EVID-12: the rustle fires on the same tick as the sabotage —
            // the Router's earshot policy narrows delivery to earshot (FR-13).
            events.push({ type: 'room:rustle', floor: channel.floor, room: channel.room })
          }
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

    // Freshness settle (EVID-08): AFTER completions so a same-tick prep
    // completion cancels the deadline before this check reads it.
    for (const [key, at] of [...this.settleAt]) {
      if (this.elapsedTicks < at) continue
      this.settleAt.delete(key)
      const [floor, room] = key.split(':') as [GuestFloorId, string]
      this.states.set(key, 'settled')
      events.push({ type: 'room:settled', floor, room: Number(room) as RoomIndex })
    }

    // Segment observation (FR-10 read half) + the door-open cue (FR-10 cue
    // half, EVID-16): entering a room's segment fires the public
    // `room:entered` once per entrant and sends that player the room's state
    // privately; every other interior fact stays put.
    for (const [playerId, pos] of positions) {
      if (pos.floor === 'lobby' || pos.floor === 'mezzanine') {
        // The mezzanine carries no rooms (3.C): no segment to observe.
        this.lastSegment.set(playerId, null)
        continue
      }
      const room = roomIndexAtMilli(pos.x)
      const key = room === 0 ? null : roomKey(pos.floor, room)
      if (key === (this.lastSegment.get(playerId) ?? null)) continue
      this.lastSegment.set(playerId, key)
      if (key !== null && room !== 0) {
        events.push({
          type: 'room:entered',
          playerId,
          floor: pos.floor,
          room,
        })
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
