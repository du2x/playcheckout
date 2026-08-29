import { type GuestFloorId, type Role, roomIndexAtMilli, TUNING } from '@turnover/shared'
import { dealRoles } from './deal.js'
import type { SimEvent } from './events.js'
import { Justice } from './justice.js'
import { TICK_HZ } from './tick.js'
import { type PositionSample, type RoundPositions, WorkChannels } from './work.js'

export interface RoundSimConfig {
  readonly seed: number
  readonly playerIds: readonly string[]
  /**
   * Test-only shift-length override (AD-004): lets harness rounds reach a real
   * buzzer without waiting the §7 shift. Production never passes it; omitted,
   * the shift is TUNING.SHIFT_SECONDS × TICK_HZ exactly as prd §7 locks it.
   */
  readonly totalTicks?: number
}

/** `\`${floor}:${room}\`` — the justice segment key (room 0 = open hall). */
function roomKeyOf(floor: GuestFloorId, room: number): string | null {
  return room === 0 ? null : `${floor}:${room}`
}

function splitRoomKey(
  key: string,
): [GuestFloorId, Parameters<WorkChannels['activeUnprepOwner']>[1]] {
  const [floor, room] = key.split(':') as [GuestFloorId, string]
  return [floor, Number(room) as Parameters<WorkChannels['activeUnprepOwner']>[1]]
}

/**
 * Headless round state machine (AD-002: the sim owns the round only).
 * Inputs + time in, events out — no I/O, no clocks. The room drives one
 * `tick()` per 50 ms interval; determinism lives in the tick count, never
 * in wall time. Later Phase 2 cycles extend this class.
 */
export class RoundSim {
  /** Total ticks in a shift: TUNING.SHIFT_SECONDS seconds at TICK_HZ. */
  static readonly TOTAL_TICKS = TUNING.SHIFT_SECONDS * TICK_HZ

  readonly playerIds: readonly string[]
  private readonly deal: Map<string, Role>
  private readonly work: WorkChannels
  private readonly justice: Justice
  /** Own segment tracking for walk-in detection (decoupled from work.ts's
   *  interior-observation state — design decision, cycle 2.8). */
  private readonly justiceSegments = new Map<string, string | null>()
  private started = false
  private ticksLeft: number

  constructor(config: RoundSimConfig) {
    if (
      config.playerIds.length < TUNING.PLAYERS_MIN ||
      config.playerIds.length > TUNING.PLAYERS_MAX
    ) {
      throw new Error(`round requires ${TUNING.PLAYERS_MIN}-${TUNING.PLAYERS_MAX} players`)
    }
    this.playerIds = [...config.playerIds]
    this.deal = dealRoles(config.seed, this.playerIds)
    this.work = new WorkChannels(this.deal)
    this.justice = new Justice(this.deal)
    const totalTicks = config.totalTicks ?? RoundSim.TOTAL_TICKS
    if (!Number.isInteger(totalTicks) || totalTicks < 1) {
      throw new Error(`totalTicks must be a positive integer, got ${config.totalTicks}`)
    }
    this.ticksLeft = totalTicks
  }

  /** Shift ticks remaining; a full shift starts at TUNING.SHIFT_SECONDS × TICK_HZ. */
  get clockTicksRemaining(): number {
    return this.ticksLeft
  }

  /**
   * Advance the sim by one 0.05 s step and return the events emitted this tick.
   * The first tick deals (round:started + one private role:dealt per player);
   * the final tick fires the buzzer; ticks past the buzzer emit nothing.
   *
   * Cycle 2.5: the room also passes the movement layer's positions each tick
   * (AD-005 seam, integer millitiles) — the work channels consume them for
   * inside-segment validation, walk-out cancels, and room observation.
   */
  tick(positions?: RoundPositions): readonly SimEvent[] {
    if (this.ticksLeft <= 0) return []
    const events: SimEvent[] = []
    if (!this.started) {
      this.started = true
      events.push({ type: 'round:started', playerIds: this.playerIds })
      for (const [playerId, role] of this.deal) {
        events.push({ type: 'role:dealt', playerId, role })
      }
    }
    // Fired players are out of live play: one stale position may arrive after
    // the firing (the room tears them down on the event), so they are filtered
    // before any justice or work processing reads them.
    const live = new Map<string, PositionSample>()
    if (positions !== undefined) {
      for (const [playerId, sample] of positions) {
        if (!this.justice.isFired(playerId)) live.set(playerId, sample)
      }
    }
    // Walk-in conviction check (JUST-01..03, FR-15): segment diff against the
    // work channels' active un-prep rooms — BEFORE work.tick, so a channel
    // completing this very tick still convicts (channel active at the entry
    // tick, spec edge). Deterministic order: positions-map insertion order.
    for (const [playerId, p] of live) {
      const key =
        p.floor === 'lobby' ? null : roomKeyOf(p.floor as GuestFloorId, roomIndexAtMilli(p.x))
      if (key === (this.justiceSegments.get(playerId) ?? null)) continue
      this.justiceSegments.set(playerId, key)
      if (key === null) continue
      const [floor, room] = splitRoomKey(key)
      const owner = this.work.activeUnprepOwner(floor, room)
      this.justice.walkIn(playerId, owner)
    }
    for (const workEvent of this.work.tick(live)) {
      events.push(workEvent)
      // Grace (JUST-07/08): `room:trashed` can only come from a completed
      // un-prep — attribute it to the deal's single saboteur.
      if (workEvent.type === 'room:trashed') this.justice.noteSabotage()
    }
    // Firing teardown (JUST-04/06/11): the fired player's channels are
    // cancelled silently (WORK-12) and their position memory is dropped, so
    // later accusations/range checks cannot reach them.
    for (const fired of this.justice.drainPending()) {
      events.push(fired)
      this.work.leave(fired.playerId)
      this.justiceSegments.delete(fired.playerId)
    }
    this.ticksLeft--
    if (this.ticksLeft === 0) events.push({ type: 'round:buzzer' })
    return events
  }

  /**
   * Validate a `work:start` intent (FR-7/8/9). Rejections map 1:1 to intent
   * errors in the room; the channel itself announces on the next tick.
   */
  startWork(
    playerId: string,
    floor: Parameters<WorkChannels['startWork']>[1],
    room: Parameters<WorkChannels['startWork']>[2],
  ): ReturnType<WorkChannels['startWork']> {
    return this.work.startWork(playerId, floor, room)
  }

  /** Drop a departing player's channel silently (WORK-12). */
  leave(playerId: string): void {
    this.work.leave(playerId)
  }

  /** The carded rooms of one floor, ascending (EVID-04 snapshot query). */
  cardedOn(floor: Parameters<WorkChannels['cardedOn']>[0]): ReturnType<WorkChannels['cardedOn']> {
    return this.work.cardedOn(floor)
  }
}
