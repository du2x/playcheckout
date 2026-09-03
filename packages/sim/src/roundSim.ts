import {
  type FloorId,
  type GuestFloorId,
  inAccuseRange,
  inDeskZone,
  type LobbySize,
  type RecapEntry,
  type Role,
  type RoomIndex,
  type RoomState,
  type RoundEndReason,
  roomIndexAtMilli,
  settleTargetFor,
  TUNING,
} from '@turnover/shared'
import { assignPlayerSeeds } from './cosmetic.js'
import { dealRoles } from './deal.js'
import type { SimEvent } from './events.js'
import { GuestSim, type GuestTiming, type MovementPort } from './guests.js'
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
  /**
   * The room's NPC movement port (cycle 3.1, AD-028): when present, the sim
   * runs the guest-traffic economy inside the round — guests spawn on the §7
   * cadence, settle, and check out (churn re-trashes via churnTrash). Omitted
   * (every pre-3.1 caller), no guests exist at all.
   */
  readonly movement?: MovementPort
  /**
   * Test-only guest-timing override (AD-028, AD-004 pattern) — passthrough to
   * GuestSim. Production never supplies it.
   */
  readonly guestTiming?: GuestTiming
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
  /** Cosmetic identity seeds (Phase 4.1, VPOL-01) — decorrelated from the
   *  role-deal stream; public, announced at the deal tick. */
  private readonly cosmeticSeeds: Map<string, number>
  private readonly work: WorkChannels
  private readonly justice: Justice
  /** The guest-traffic economy (cycle 3.1) — null when no movement port is
   *  supplied (all pre-3.1 callers and their tests). */
  private readonly guests: GuestSim | null
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
  /** Trash-discovery complaints so far (cycle 3.3, FR-31): the budget's only
   *  input — wrong-delivery door complaints never touch it (AD-039). The 8th
   *  (COMPLAINT_BUDGET, §7) is an instant staff loss. */
  private complaintTotal = 0

  constructor(config: RoundSimConfig) {
    if (
      config.playerIds.length < TUNING.PLAYERS_MIN ||
      config.playerIds.length > TUNING.PLAYERS_MAX
    ) {
      throw new Error(`round requires ${TUNING.PLAYERS_MIN}-${TUNING.PLAYERS_MAX} players`)
    }
    this.playerIds = [...config.playerIds]
    this.deal = dealRoles(config.seed, this.playerIds)
    this.cosmeticSeeds = assignPlayerSeeds(config.seed, this.playerIds)
    this.work = new WorkChannels(this.deal)
    this.justice = new Justice(this.deal)
    this.guests =
      config.movement === undefined
        ? null
        : new GuestSim(
            config.seed,
            this.playerIds.length as LobbySize,
            config.movement,
            config.guestTiming,
            // The arrival-intel port (cycle 3.3): state + an owner-free
            // un-prep boolean — the identity never crosses to the guest sim.
            {
              roomStateOf: (floor, room) => this.work.stateOf(floor, room),
              unprepActiveIn: (floor, room) => this.work.activeUnprepOwner(floor, room) !== null,
            },
          )
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
   * Read-only work-channel state of one room (cycle 3.1 query hook): lets
   * tests and the exit proofs pin checkout churn (`settled`) without poking
   * private state.
   */
  roomState(floor: GuestFloorId, room: RoomIndex): RoomState {
    return this.work.stateOf(floor, room)
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
      // Cosmetic seeds (Phase 4.1, VPOL-01): public, one row per player,
      // immediately after the private role cards in the same flush.
      for (const [playerId, seed] of this.cosmeticSeeds) {
        events.push({ type: 'cosmetic:player', playerId, seed })
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
    // Guest traffic (cycle 3.1, GUEST-01..09): the economy ticks after the
    // work channels, before justice teardown and win checks — a checkout
    // churn this tick lands in the same flush, and a round that ends this
    // tick takes its guests with it (GUEST-11). Checkout churn re-trashes
    // the room as `settled` (spawn half of FR-32) — silently: no
    // sabotage-shaped room:trashed ever comes from churn.
    if (this.guests !== null) {
      for (const guestEvent of this.guests.tick(tickIndex)) {
        if (guestEvent.type === 'guest:checked_out') {
          this.work.churnTrash(guestEvent.floor as GuestFloorId, guestEvent.room)
        }
        // FR-31: the desk report is the ONLY budget-counting complaint.
        if (guestEvent.type === 'guest:discovered') {
          this.complaintTotal++
          // FR-32/FR-22 (3.4): record complaint provenance at discovery tick — the room's author at that instant.
          const prov = this.work.provenanceOf(guestEvent.floor as GuestFloorId, guestEvent.room)
          const provenance = prov === 'churn' ? 'churn' : 'sabotage'
          const actorId = provenance === 'sabotage' ? this.justice.saboteurId : undefined
          this.journal.push({
            kind: 'complaint',
            tick: tickIndex,
            floor: guestEvent.floor,
            room: guestEvent.room,
            guestId: guestEvent.guestId,
            fresh: guestEvent.fresh,
            provenance,
            ...(actorId !== undefined ? { actorId } : {}),
          } as RecapEntry)
        }
        events.push(guestEvent)
      }
      // Carry-clock expiry (cycle 3.B, SUI-18): fire the current carrier
      // through the justice pipeline — the `player:fired` event and the
      // dropCarry aftermath land in this same flush via the drain below.
      for (const carrierId of this.guests.drainExpiredCarriers()) {
        this.justice.fire(carrierId, 'carry-clock')
      }
    }
    // Firing teardown (JUST-04/06/11): the fired player's channels are
    // cancelled silently (WORK-12) and their position memory is dropped, so
    // later accusations/range checks cannot reach them.
    for (const fired of this.justice.drainPending()) {
      events.push(fired)
      this.guests?.dropCarry(fired.playerId, tickIndex)
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
    } else if (this.complaintTotal >= TUNING.COMPLAINT_BUDGET) {
      // FR-31 (cycle 3.3): the 8th trash-discovery complaint is an instant
      // staff loss — same flush as the triggering `guest:discovered`, and
      // ahead of the buzzer verdict (the tie resolves to the budget).
      this.end('saboteur', 'budget-exhausted')
    }
    this.emitResult(events)
    if (this.ended) {
      this.ticksLeft--
      return events
    }
    this.ticksLeft--
    if (this.ticksLeft === 0) {
      // Buzzer (REND-03, prd v1.5/AD-039): the clock-expiry event first, then
      // the settle-target verdict in the same flush — staff win when the
      // round's settle score reached SETTLE_TARGET for the lobby size.
      events.push({ type: 'round:buzzer' })
      const score = this.guests?.settledCount ?? 0
      if (score >= settleTargetFor(this.playerIds.length)) {
        this.end('staff', 'settle-target-met')
      } else {
        this.end('saboteur', 'settle-target-failed')
      }
      this.emitResult(events)
    }
    return events
  }

  /** Live staff = round players − fired − ghosted − the saboteur (REND-02).
   *  Public for the room's AD-040 ambush-authority adapter — the same rule
   *  `liveStaffCount` consumes, in one home. */
  isLiveStaff(playerId: string): boolean {
    return (
      playerId !== this.justice.saboteurId &&
      !this.justice.isFired(playerId) &&
      !this.ghosted.has(playerId) &&
      this.playerIds.includes(playerId)
    )
  }

  /** Live staff = round players − fired − ghosted − the saboteur (REND-02). */
  private liveStaffCount(): number {
    let count = 0
    for (const playerId of this.playerIds) {
      if (this.isLiveStaff(playerId)) count++
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
   * v1.4 (FR-9a, SUI-11): a player carrying a suitcase cannot START a work
   * channel — accusation and elevator calls stay available, and an
   * already-active channel runs to completion.
   */
  startWork(
    playerId: string,
    floor: Parameters<WorkChannels['startWork']>[1],
    room: Parameters<WorkChannels['startWork']>[2],
  ): ReturnType<WorkChannels['startWork']> | 'carrying' {
    if (this.guests?.isCarrying(playerId)) return 'carrying'
    return this.work.startWork(playerId, floor, room)
  }

  /** Drop a departing player's channel silently (WORK-12) and drop any
   *  suitcase they carry (SUI-20, cycle 3.B). */
  leave(playerId: string): void {
    this.guests?.dropCarry(playerId, this.totalTicks - this.ticksLeft)
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
    if (
      accuser === undefined ||
      target === undefined ||
      // work positions are MILLITILES; the affordances interface is tiles.
      !inAccuseRange(
        { floor: accuser.floor, x: accuser.x / 1000 },
        { floor: target.floor, x: target.x / 1000 },
      )
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
    this.guests?.dropCarry(playerId, this.totalTicks - this.ticksLeft)
    this.work.leave(playerId)
    this.justiceSegments.delete(playerId)
    if (this.liveStaffCount() === 1) this.end('saboteur', 'staff-reduced')
  }

  /**
   * E at the front desk (cycle 3.B, SUI-01/02): check the front queued guest
   * in — the caller takes the guest's suitcase (receiver = carrier). One
   * suitcase per player: a caller already carrying is rejected. Eligibility
   * mirrors `accuse`: round active, sender live, standing on the lobby floor
   * within TUNING.DESK_RANGE_TILES of TUNING.DESK_X_TILES. Every rejection
   * maps to silence in the room.
   */
  deskInteract(playerId: string): 'accepted' | 'rejected' {
    const guests = this.guests
    if (!this.started || this.ended || this.ticksLeft <= 0) return 'rejected'
    if (guests === null) return 'rejected'
    if (this.justice.isFired(playerId) || this.ghosted.has(playerId)) return 'rejected'
    const p = this.work.positionOf(playerId)
    if (p === undefined || !inDeskZone({ floor: p.floor, x: p.x / 1000 })) {
      return 'rejected'
    }
    const tick = this.totalTicks - this.ticksLeft
    return guests.checkIn(playerId, tick) === 'accepted' ? 'accepted' : 'rejected'
  }

  /**
   * Place the sender's carried suitcase at a room door (cycle 3.B, SUI-07).
   * Floor/range validation is the sim's (carrier position vs the door x);
   * every rejection is silent (SUI-10).
   */
  suitcasePlace(playerId: string, room: RoomIndex): 'placed' | 'rejected' {
    const guests = this.guests
    if (!this.started || this.ended || this.ticksLeft <= 0) return 'rejected'
    if (guests === null) return 'rejected'
    if (this.justice.isFired(playerId) || this.ghosted.has(playerId)) return 'rejected'
    const tick = this.totalTicks - this.ticksLeft
    return guests.placeSuitcase(playerId, room, tick) === 'placed' ? 'placed' : 'rejected'
  }

  /**
   * Pick up the nearest resting suitcase on the sender's floor (cycle 3.B,
   * SUI-08) — by anyone, saboteur included; a player already carrying is
   * rejected silently (SUI-09).
   */
  suitcasePickup(playerId: string): 'picked_up' | 'rejected' {
    const guests = this.guests
    if (!this.started || this.ended || this.ticksLeft <= 0) return 'rejected'
    if (guests === null) return 'rejected'
    if (this.justice.isFired(playerId) || this.ghosted.has(playerId)) return 'rejected'
    const tick = this.totalTicks - this.ticksLeft
    return guests.pickupSuitcase(playerId, tick) === 'picked_up' ? 'picked_up' : 'rejected'
  }

  /** Resting suitcases for the movement snapshot (cycle 3.B, sameFloor rows). */
  restingSuitcases(): ReturnType<GuestSim['restingSuitcases']> {
    return this.guests?.restingSuitcases() ?? []
  }

  /** Tenancy rows for the viewer's floor snapshot (cycle 3.4, FR-33 sameFloor). */
  tenanciesOn(floor: FloorId): ReturnType<GuestSim['tenanciesOn']> {
    return this.guests?.tenanciesOn(floor) ?? []
  }

  /** All tenancies — the spectator baseline slice (cycle 3.4, FR-33). */
  allTenancies(): ReturnType<GuestSim['allTenancies']> {
    return this.guests?.allTenancies() ?? []
  }

  /** Every player's cosmetic seed (Phase 4.1, VPOL-05 snapshot slice). */
  allPlayerSeeds(): { playerId: string; seed: number }[] {
    return [...this.cosmeticSeeds.entries()].map(([playerId, seed]) => ({ playerId, seed }))
  }

  /** Every guest's cosmetic seed (Phase 4.1, VPOL-05 snapshot slice). */
  allGuestSeeds(): ReturnType<GuestSim['allGuestSeeds']> {
    return this.guests?.allGuestSeeds() ?? []
  }

  /** One guest's cosmetic seed (Phase 4.1) — undefined for unknown ids. */
  guestSeedOf(guestId: string): number | undefined {
    return this.guests?.guestSeedOf(guestId)
  }

  /** The deal's single saboteur — the room needs it for the abort path (FR-25). */
  get saboteurId(): string {
    return this.justice.saboteurId
  }

  /** The trash-discovery complaint count (cycle 3.D-style public query,
   *  cycle 3.3): the recap/resume payloads' source and the HUD's truth; 0
   *  when no movement port was supplied. */
  get complaintCount(): number {
    return this.complaintTotal
  }

  /** The guest economy's settle score (cycle 3.D, AD-039) — the buzzer
   *  verdict's input and the recap/resume payload's source; 0 when no
   *  movement port was supplied. */
  get settledCount(): number {
    return this.guests?.settledCount ?? 0
  }

  /**
   * A round player's dealt role — the reconnection seat restore re-sends the
   * exact role card, saboteur card included (prd reconnection contract).
   */
  roleOf(playerId: string): Role | undefined {
    return this.deal.get(playerId)
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

  /**
   * Current state of every room, deterministic order — the FR-20 spectator
   * baseline (cycle 2.9). Round-scoped: the room reads it while the sim lives.
   */
  roomStates(): ReturnType<WorkChannels['roomStates']> {
    return this.work.roomStates()
  }
}
