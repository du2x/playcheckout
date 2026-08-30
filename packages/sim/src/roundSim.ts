import {
  type GuestFloorId,
  type RecapEntry,
  ROOM_COUNT,
  type Role,
  type RoundEndReason,
  roomIndexAtMilli,
  TUNING,
} from '@turnover/shared'
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

/** Why an `accuse` intent was rejected — the room maps these to errors 1:1. */
export type AccuseRejection =
  | 'round-not-active'
  | 'accuser-not-live'
  | 'accuser-is-saboteur'
  | 'self-target'
  | 'target-not-live'
  | 'out-of-range'

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
  private readonly totalTicks: number
  private ticksLeft: number
  // --- Round end (cycle 2.9, win conditions + FR-25): the round can now finish early.
  private ended = false
  /** Winner + reason of the single `round:ended`; null until `end()` fires. */
  private result: { winner: 'staff' | 'saboteur'; reason: RoundEndReason } | null = null
  private resultEmitted = false
  /** Disconnected leavers past their reconnection window (FR-25) — out of
   *  live play like fired players, but silently and without a firing event. */
  private readonly ghosted = new Set<string>()
  /** Crimes, catches, accusations in tick order — the FR-22 recap's sim half
   *  (rides are the room's half; the sim never sees movement). */
  private readonly journal: RecapEntry[] = []

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
    this.totalTicks = totalTicks
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
    // A ghost-queued win check (FR-25) must flush once past the end; after the
    // verdict is out, the round emits nothing.
    if (this.resultEmitted || this.ticksLeft <= 0) return []
    // 0-based tick index of the events produced here (deterministic journal
    // stamp; identical under the AD-004 totalTicks override).
    const tickIndex = this.totalTicks - this.ticksLeft
    const events: SimEvent[] = []
    // A win check resolved from an intent-time call (ghost, FR-25) flushes at
    // the top of the next tick (announce pattern).
    this.emitResult(events)
    if (this.ended) return events
    if (!this.started) {
      this.started = true
      events.push({ type: 'round:started', playerIds: this.playerIds })
      for (const [playerId, role] of this.deal) {
        events.push({ type: 'role:dealt', playerId, role })
      }
    }
    // Fired AND ghosted players are out of live play: one stale position may
    // arrive after the removal (the room tears them down), so they are
    // filtered before any justice or work processing reads them.
    const live = new Map<string, PositionSample>()
    if (positions !== undefined) {
      for (const [playerId, sample] of positions) {
        if (!this.justice.isFired(playerId) && !this.ghosted.has(playerId)) {
          live.set(playerId, sample)
        }
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
      const caught = this.justice.walkIn(playerId, owner)
      // REND-08: every walk-in conviction is a recap catch entry.
      if (caught !== null) {
        this.journal.push({
          kind: 'catch',
          tick: tickIndex,
          entrantId: playerId,
          saboteurId: caught,
        })
      }
    }
    for (const workEvent of this.work.tick(live)) {
      events.push(workEvent)
      // Grace (JUST-07/08): `room:trashed` can only come from a completed
      // un-prep — attribute it to the deal's single saboteur. REND-08: it is
      // also a recap crime entry (freshness resolved at recap time).
      if (workEvent.type === 'room:trashed') {
        this.justice.noteSabotage()
        this.journal.push({
          kind: 'crime',
          tick: tickIndex,
          floor: workEvent.floor,
          room: workEvent.room,
          fresh: true,
        })
      }
    }
    // Firing teardown (JUST-04/06/11): the fired player's channels are
    // cancelled silently (WORK-12) and their position memory is dropped, so
    // later accusations/range checks cannot reach them.
    for (const fired of this.justice.drainPending()) {
      events.push(fired)
      this.work.leave(fired.playerId)
      this.justiceSegments.delete(fired.playerId)
    }
    // Win checks (REND-01/02): saboteur fired → staff win; live staff down to
    // one → saboteur win. Checked after the drain so the `round:ended` lands
    // in the same flush as its triggering `player:fired`.
    if (this.justice.isFired(this.justice.saboteurId)) {
      this.end('staff', 'saboteur-fired')
    } else if (this.liveStaffCount() === 1) {
      this.end('saboteur', 'staff-reduced')
    }
    this.emitResult(events)
    if (this.ended) {
      this.ticksLeft--
      return events
    }
    this.ticksLeft--
    if (this.ticksLeft === 0) {
      // Buzzer (REND-03): the clock-expiry event first, then the coverage
      // verdict in the same flush — `prepped × 5 ≥ ROOM_COUNT × 4` is the
      // integer-safe ≥80% of the locked 24 rooms.
      events.push({ type: 'round:buzzer' })
      if (this.work.preppedCount * 5 >= ROOM_COUNT * 4) {
        this.end('staff', 'coverage-met')
      } else {
        this.end('saboteur', 'coverage-failed')
      }
      this.emitResult(events)
    }
    return events
  }

  /** Live staff = round players − fired − ghosted − the saboteur (REND-02). */
  private liveStaffCount(): number {
    let count = 0
    for (const playerId of this.playerIds) {
      if (
        playerId !== this.justice.saboteurId &&
        !this.justice.isFired(playerId) &&
        !this.ghosted.has(playerId)
      ) {
        count++
      }
    }
    return count
  }

  /** Record the verdict once; the event is emitted by `emitResult`. */
  private end(winner: 'staff' | 'saboteur', reason: RoundEndReason): void {
    if (this.ended) return
    this.ended = true
    this.result = { winner, reason }
  }

  /** Push the single `round:ended` into the current flush (REND-05: exactly once). */
  private emitResult(events: SimEvent[]): void {
    if (this.result === null || this.resultEmitted) return
    this.resultEmitted = true
    events.push({ type: 'round:ended', ...this.result, saboteurId: this.justice.saboteurId })
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

  /**
   * Validate and resolve an accusation (JUST-06..11, FR-17/18/19). Eligibility
   * is enforced here — round active, accuser live and staff, target live and
   * not the accuser, same floor within TUNING.ACCUSATION_RANGE_TILES (movement
   * positions, inclusive) — the client menu is a mirror, never an authority.
   * The return value is coarse: it NEVER distinguishes verdicts; validity is
   * carried only by the internal event's `reason`, which the Router strips.
   */
  accuse(accuserId: string, targetId: string): 'resolved' | AccuseRejection {
    if (!this.started || this.ended || this.ticksLeft <= 0) return 'round-not-active'
    if (this.justice.isFired(accuserId) || this.ghosted.has(accuserId)) return 'accuser-not-live'
    if (accuserId === this.justice.saboteurId) return 'accuser-is-saboteur'
    if (accuserId === targetId) return 'self-target'
    if (
      this.justice.isFired(targetId) ||
      this.ghosted.has(targetId) ||
      !this.playerIds.includes(targetId)
    ) {
      return 'target-not-live'
    }
    const accuser = this.work.positionOf(accuserId)
    const target = this.work.positionOf(targetId)
    const range = TUNING.ACCUSATION_RANGE_TILES * 1000
    if (
      accuser === undefined ||
      target === undefined ||
      accuser.floor !== target.floor ||
      Math.abs(accuser.x - target.x) > range
    ) {
      return 'out-of-range'
    }
    const verdict = this.justice.accuse(accuserId, targetId)
    // REND-08: every resolved accusation is a recap entry — accuser, target,
    // and the validity verdict that is only ever revealed post-round (FR-22).
    this.journal.push({
      kind: 'accusation',
      tick: this.totalTicks - this.ticksLeft,
      accuserId,
      targetId,
      correct: verdict === 'correct',
    })
    return 'resolved'
  }

  /**
   * Mark a disconnected leaver as an idle ghost (FR-25, cycle 2.9): out of
   * live play like a fired player — filtered positions, unreachable targets —
   * but silently (no event, no journal entry). If the ghosting reduces live
   * staff to one, the saboteur win check fires and flushes on the next tick.
   */
  ghost(playerId: string): void {
    if (this.ended || this.justice.isFired(playerId)) return
    this.ghosted.add(playerId)
    this.work.leave(playerId)
    this.justiceSegments.delete(playerId)
    if (this.liveStaffCount() === 1) this.end('saboteur', 'staff-reduced')
  }

  /** The deal's single saboteur — the room needs it for the abort path (FR-25). */
  get saboteurId(): string {
    return this.justice.saboteurId
  }

  /**
   * The sim half of the FR-22 recap: crimes, catches, accusations in tick
   * order, with crime freshness resolved NOW (still `trashed` = inside the
   * freshness window; `settled` = aged out). Rides are the room's half.
   */
  recapEntries(): readonly RecapEntry[] {
    return this.journal.map((entry) => {
      if (entry.kind !== 'crime') return entry
      return {
        ...entry,
        fresh: this.work.stateOf(entry.floor as GuestFloorId, entry.room) === 'trashed',
      }
    })
  }

  /** True once a win check has fired — the room reads it after routing. */
  get isEnded(): boolean {
    return this.ended
  }

  /** The carded rooms of one floor, ascending (EVID-04 snapshot query). */
  cardedOn(floor: Parameters<WorkChannels['cardedOn']>[0]): ReturnType<WorkChannels['cardedOn']> {
    return this.work.cardedOn(floor)
  }
}
