import type { FloorId, GuestFloorId, LobbySize, RoomIndex, SimEvent } from '@turnover/shared'
import {
  doorInRange,
  GUEST_FLOOR_IDS,
  HALL_LENGTH_TILES,
  nearestRestingSuitcase,
  ROOM_INDEXES,
  roomDoorXMilli,
  TUNING,
} from '@turnover/shared'
import { Rng } from './rng.js'
import { TICK_HZ } from './tick.js'

/**
 * The NPC-only seam into the room's movement layer (AD-028, amending AD-005's
 * read-only rule for guests): guests issue the SAME intents players do —
 * walk, call (which boards per AD-025), in-car press — through this narrow
 * port. Intents take effect at intent time and their events flush next tick
 * (MOVE-10), so a tick's driver decisions are visible to the next tick: the
 * guest loop is deterministic and race-free.
 */
export interface MovementPort {
  joinGuest(id: string, floor: FloorId, xTiles: number): void
  removeGuest(id: string): void
  announceGuest(id: string): void
  positionOf(id: string): { floor: FloorId; x: number } | undefined
  viewOf(id: string): {
    floor: FloorId | null
    roomKey: string | null
    car: 1 | 2 | null
    x: number | null
  }
  startMove(id: string, dir: 'left' | 'right'): void
  stopMove(id: string): void
  callElevator(id: string): 'dispatched' | 'ignored' | 'rejected'
  pressFloor(id: string, floor: FloorId): 'accepted' | 'ignored' | 'rejected'
}

export type GuestPhase = 'queued' | 'impatient' | 'dining' | 'toRoom' | 'settling' | 'toExit'

interface Guest {
  id: string
  phase: GuestPhase
  assigned: { floor: GuestFloorId; room: RoomIndex } | null
  /** The suitcase's last resting room this guest walks toward (cycle 3.B) —
   *  null for self-assigned guests (they walk straight to `assigned`) and
   *  while no suitcase rest exists. */
  target: { floor: GuestFloorId; room: RoomIndex } | null
  /** Absolute tick impatience fires (spawn + GUEST_IMPATIENCE_SECONDS). */
  impatientAt: number
  /** Ticks left on the frozen impatience clock while checked in (cycle 3.B) —
   *  null ⇔ not checked in. Re-queueing restores impatientAt = tick + remaining. */
  impatienceRemaining: number | null
  /** Ticks of the drawn dining dwell for the CURRENT dining stay (cycle 3.C) —
   *  null ⇔ not dining. No behavioral consumer (the dwell is a wait buffer,
   *  REST-10): determinism/telemetry surface via diningDwellOf only. */
  diningDwellTicks: number | null
  /** Absolute tick a settling guest checks out (settle + seeded dwell). */
  dwellEndsAt: number | null
}

/**
 * One suitcase per checked-in guest (cycle 3.B, AD-032): either carried
 * (`carrier` set, carry leg running) or resting (`rest` set — a room doorway
 * or the desk). Exactly one of carrier/rest is set.
 */
export interface SuitcaseState {
  carrier: string | null
  rest: { floor: GuestFloorId; room: RoomIndex } | null
  /** Absolute tick the current carry leg started (check-in or pickup) — the
   *  carry clock reads it; null while resting. */
  legStartTick: number | null
}

const IMPATIENCE_TICKS = TUNING.GUEST_IMPATIENCE_SECONDS * TICK_HZ
const DESK_X = TUNING.DESK_X_TILES
const QUEUE_STEP = TUNING.GUEST_QUEUE_SPACING_TILES
/** Dining slots (cycle 3.C, AD-035): checked-in guests wait in the mezzanine
 *  restaurant — slot i at DINING_START + i × QUEUE_STEP — until their suitcase
 *  first rests. Replaces the 3.B lobby holding-area stub. */
const DINING_START = TUNING.GUEST_RESTAURANT_START_TILES
/** Walking is 0.3 tiles/tick; arrival tolerance is one step (gray-box: the
 *  guest settles/hotel-exits at the nearest deterministic point). */
const ARRIVAL_TOLERANCE_TILES = 0.3

const roomKey = (floor: GuestFloorId, room: RoomIndex): string => `${floor}:${room}`

function slotX(index: number): number {
  return DESK_X + index * QUEUE_STEP
}

/**
 * Test-only timing override (AD-028, the AD-004 pattern): shortens the guest
 * cadence/impatience/dwell so harness rounds observe full guest lifecycles
 * inside the AD-004 shortened shift. Production never supplies it.
 */
export interface GuestTiming {
  readonly cadenceTicks?: number
  readonly impatienceTicks?: number
  /** Scales the drawn dwell (45–90 s) — e.g. 0.02 → 0.9–1.8 s. */
  readonly dwellScale?: number
  /** Scales the drawn dining dwell (the 15–30 s restaurant wait, cycle 3.C)
   *  the same way dwellScale scales the settled dwell. Production never
   *  supplies it. */
  readonly diningScale?: number
  /** Overrides the carry clock (§7: 60 s per leg) — e.g. 30 ticks for a
   *  round-integration test. Production never supplies it. */
  readonly carryClockTicks?: number
}

/**
 * Guest lifecycle as weather (cycle 3.1, FR-26/FR-28 + spawn half of FR-32).
 * Round-scoped: constructed at round start with the round's seed, dies with
 * the sim (GUEST-11). All sampling — dwell and self-assign choice — draws
 * from the dedicated guest RNG stream (AD-022 trade-off 5); the arrival
 * schedule is a fixed interval with NO jitter (§7 cadence).
 *
 * Arrival holding (GUEST-02): every scheduled arrival tick with a full hotel
 * banks one backlog unit; each tick with vacancy and a backlog spawns ONE
 * guest, FIFO — guests never spawn into a full hotel.
 *
 * Impatience (GUEST-04/05): after 20 s queued the guest fires the free
 * impatience cue and self-assigns a uniform random VACANT room; with no
 * vacancy it stays queued and re-checks every tick. Assignment commits at
 * choice time (no re-routing exists in 3.1).
 *
 * Checkout churn (GUEST-09): the guest emits `guest:checked_out` and walks
 * home; the ROUND maps that event to `WorkChannels.churnTrash` — this class
 * owns tenancy only.
 */
export class GuestSim {
  private readonly guests = new Map<string, Guest>()
  /** FIFO by arrival: index = queue slot (0 = at the desk, eastward growth).
   *  NEVER contains a dining guest (cycle 3.2/3.C): check-in removes from the queue
   *  without re-placing; release re-inserts at the FRONT and re-places. */
  private readonly queue: string[] = []
  /** roomKey → guestId (the single tenancy/vacancy source). */
  private readonly tenanted = new Map<string, string>()
  /** Room keys reserved by check-in assignments (cycle 3.B): vacancy excludes
   *  them until settle converts the reservation into tenancy or teardown voids
   *  the assignment. */
  private readonly reserved = new Set<string>()
  /** guestId → suitcase (cycle 3.B): one per checked-in guest. */
  private readonly suitcases = new Map<string, SuitcaseState>()
  /** Per-round settle score (cycle 3.D, AD-039): one per committed settleAt,
   *  both the suitcase-match and the self-assign path. Monotonic; reset only
   *  by constructing a fresh sim at round start. */
  private settledTotal = 0
  /** Checked-in guests dining in the mezzanine restaurant, FIFO by check-in
   *  (the dining slot index). */
  private readonly dining: string[] = []
  /** Intent-time events (desk receive/route) flushed on the NEXT tick —
   *  the MOVE-10 announce pattern: tick() is the only event emitter. */
  private pending: SimEvent[] = []
  private readonly rng: Rng
  private readonly cadenceTicks: number
  private readonly impatienceTicks: number
  private readonly dwellScale: number
  private readonly diningScale: number
  private readonly carryClockTicks: number
  private nextScheduleTick: number
  private backlog = 0
  private ordinal = 0
  /** Carriers whose carry leg expired this tick — drained by the RoundSim,
   *  which fires them through the justice pipeline (SUI-18). */
  private expiredCarriers: string[] = []

  constructor(
    seed: number,
    playerCount: LobbySize,
    private readonly movement: MovementPort,
    timing?: GuestTiming,
  ) {
    this.rng = new Rng(seed)
    this.cadenceTicks = timing?.cadenceTicks ?? TUNING.GUEST_CADENCE_SECONDS[playerCount] * TICK_HZ
    this.impatienceTicks = timing?.impatienceTicks ?? IMPATIENCE_TICKS
    this.dwellScale = timing?.dwellScale ?? 1
    this.diningScale = timing?.diningScale ?? 1
    this.carryClockTicks = timing?.carryClockTicks ?? TUNING.CARRY_CLOCK_SECONDS * TICK_HZ
    // The first arrival lands one full cadence interval after round start.
    this.nextScheduleTick = this.cadenceTicks
  }

  /** Every room key a guest could occupy — floors then rooms ascending. */
  private allRoomKeys(): { floor: GuestFloorId; room: RoomIndex }[] {
    const rooms: { floor: GuestFloorId; room: RoomIndex }[] = []
    for (const floor of GUEST_FLOOR_IDS) {
      for (const room of ROOM_INDEXES) rooms.push({ floor, room: room as RoomIndex })
    }
    return rooms
  }

  private vacantRooms(): { floor: GuestFloorId; room: RoomIndex }[] {
    return this.allRoomKeys().filter(
      (r) =>
        !this.tenanted.has(roomKey(r.floor, r.room)) &&
        !this.reserved.has(roomKey(r.floor, r.room)),
    )
  }

  private hasVacancy(): boolean {
    return this.vacantRooms().length > 0
  }

  /**
   * Advance one 0.05 s step. `tick` is the absolute round tick (from the
   * RoundSim clock). Returns the guest lifecycle events emitted this tick —
   * including the desk intents queued since the last tick (announce pattern).
   */
  tick(tick: number): SimEvent[] {
    const events: SimEvent[] = [...this.pending]
    this.pending = []

    // Carry clock (SUI-18/19, cycle 3.B): a carry leg expires after
    // CARRY_CLOCK_SECONDS — check-in → first placement, fresh on every
    // pickup; a resting suitcase runs no clock. Expiry raises the carrier to
    // the RoundSim, which fires them through the justice pipeline; the
    // dropCarry aftermath rides the fired teardown in the same flush.
    for (const sc of this.suitcases.values()) {
      if (sc.carrier === null || sc.legStartTick === null) continue
      if (tick - sc.legStartTick >= this.carryClockTicks) {
        this.expiredCarriers.push(sc.carrier)
        sc.legStartTick = null // the leg is consumed; teardown owns the rest
      }
    }

    // Arrival schedule: fixed interval, backlog when the hotel is full.
    if (tick >= this.nextScheduleTick) {
      this.backlog++
      this.nextScheduleTick += this.cadenceTicks
    }
    if (this.backlog > 0 && this.hasVacancy()) {
      this.backlog--
      this.spawn(tick, events)
    }

    // Impatience (GUEST-04): the cue fires once, exactly the impatience
    // interval after spawn. Free — no complaint, no budget effect in 3.1.
    // v1.4 re-scope: the clock times only the CHECK-IN wait — checked-in
    // guests are patient (FR-28 v1.4), so the scan covers the queue only.
    for (const id of this.queue) {
      const g = this.guests.get(id)
      if (g === undefined) continue
      if (g.phase === 'queued' && tick >= g.impatientAt) {
        g.phase = 'impatient'
        events.push({ type: 'guest:impatient', guestId: id })
      }
    }

    // Self-assignment (GUEST-04/05): queue-order scan, one pass per tick.
    for (const id of [...this.queue]) {
      const g = this.guests.get(id)
      if (g === undefined || g.phase !== 'impatient') continue
      if (!this.hasVacancy()) continue // GUEST-05: stay queued, re-check next tick
      const vacants = this.vacantRooms()
      const pick = vacants[this.rng.int(vacants.length - 1)]
      if (pick === undefined) continue
      g.assigned = pick
      g.target = pick
      g.phase = 'toRoom'
      this.removeFromQueue(id)
      events.push({
        type: 'guest:self_assigned',
        guestId: id,
        floor: pick.floor,
        room: pick.room,
      })
    }

    // Settled guests whose dwell elapsed check out (GUEST-09).
    for (const g of this.guests.values()) {
      if (g.phase !== 'settling' || g.dwellEndsAt === null || tick < g.dwellEndsAt) continue
      const assigned = g.assigned
      if (assigned === null) continue
      g.phase = 'toExit'
      this.tenanted.delete(roomKey(assigned.floor, assigned.room))
      // Re-enter the hall at the room door and walk home.
      this.movement.joinGuest(g.id, assigned.floor, roomDoorXMilli(assigned.room) / 1000)
      events.push({
        type: 'guest:checked_out',
        guestId: g.id,
        floor: assigned.floor,
        room: assigned.room,
      })
    }

    // Movement drivers — one intent per guest per tick.
    for (const g of this.guests.values()) {
      if (g.phase === 'toRoom') {
        if (this.suitcases.has(g.id)) this.driveToResting(g, tick, events)
        else this.driveToRoom(g, tick, events)
      } else if (g.phase === 'toExit') {
        this.driveToExit(g, tick, events)
      }
    }

    return events
  }

  private spawn(tick: number, events: SimEvent[]): void {
    this.ordinal++
    const id = `guest:${this.ordinal}`
    const guest: Guest = {
      id,
      phase: 'queued',
      assigned: null,
      target: null,
      impatientAt: tick + this.impatienceTicks,
      impatienceRemaining: null,
      diningDwellTicks: null,
      dwellEndsAt: null,
    }
    this.guests.set(id, guest)
    this.queue.push(id)
    this.movement.joinGuest(id, 'lobby', slotX(this.queue.length - 1))
    events.push({ type: 'guest:arrived', guestId: id })
  }

  /** Shift the remaining queue forward into their deterministic slots. */
  private removeFromQueue(id: string): void {
    const idx = this.queue.indexOf(id)
    if (idx === -1) return
    this.queue.splice(idx, 1)
    this.rePlaceQueue()
  }

  /** Re-place every queued guest into their deterministic slot (NPC
   *  positions, not walks — the same re-place removeFromQueue always did).
   *  The floor check matters since 3.C: a dropCarry re-queue may teleport the
   *  guest from a mezzanine dining slot whose x equals the queue slot x. */
  private rePlaceQueue(): void {
    this.queue.forEach((qid, slot) => {
      const pos = this.movement.positionOf(qid)
      if (
        pos !== undefined &&
        (pos.floor !== 'lobby' || Math.abs(pos.x - slotX(slot)) > ARRIVAL_TOLERANCE_TILES)
      ) {
        this.movement.removeGuest(qid)
        this.movement.joinGuest(qid, 'lobby', slotX(slot))
        this.movement.announceGuest(qid)
      }
    })
  }

  // --- Suitcase check-in + carry (cycle 3.B, AD-032) ------------------------

  /**
   * E in the desk zone (SUI-01): check the FRONT queued guest in — seed the
   * assignment (uniform random room vacant AND unreserved, guest Rng stream),
   * reserve it, make the caller the suitcase's carrier (first carry leg), and
   * move the guest to the mezzanine restaurant (patient — the impatience clock freezes
   * for the whole check-in). One suitcase per player: a caller already
   * carrying is ignored silently (SUI-02), as is an empty queue.
   */
  checkIn(playerId: string, tick: number): 'accepted' | 'ignored' {
    if (this.isCarrying(playerId)) return 'ignored'
    const id = this.queue[0]
    if (id === undefined) return 'ignored'
    const g = this.guests.get(id)
    if (g === undefined) return 'ignored'
    const vacants = this.vacantRooms()
    const pick = vacants[this.rng.int(vacants.length - 1)]
    if (pick === undefined) return 'ignored'
    this.removeFromQueue(id)
    g.phase = 'dining'
    g.assigned = pick
    g.target = null
    g.impatienceRemaining = Math.max(0, g.impatientAt - tick)
    this.reserved.add(roomKey(pick.floor, pick.room))
    this.suitcases.set(id, { carrier: playerId, rest: null, legStartTick: tick })
    this.dining.push(id)
    this.rePlaceDining()
    g.diningDwellTicks = this.drawDiningDwellTicks()
    // SUI-03 (amended AD-034): the assignment is a BUILDING-WIDE notice —
    // emitted once, at the check-in tick, on the 'all' policy. Every player
    // learns it (saboteur included, AD-034(e)); the contested gameplay is
    // physical interception of the suitcase. Never repeated.
    this.pending.push(
      { type: 'guest:assigned', guestId: id, floor: pick.floor, room: pick.room },
      { type: 'suitcase:carried', guestId: id, carrierId: playerId },
    )
    return 'accepted'
  }

  /**
   * Place the sender's carried suitcase at a room door (SUI-07): server-side
   * range validation against the named room's door x on the carrier's floor.
   * Resting stops the carry leg and emits `suitcase:placed` (sameFloor,
   * SILENT — no walkie line, SUI-21/22). The guest re-targets the resting
   * room (SUI-13).
   */
  placeSuitcase(playerId: string, room: RoomIndex, _tick: number): 'placed' | 'ignored' {
    const id = this.carriedGuestOf(playerId)
    if (id === null) return 'ignored'
    const sc = this.suitcases.get(id)
    if (sc === undefined) return 'ignored'
    const pos = this.movement.positionOf(playerId)
    if (pos === undefined || pos.floor === 'lobby' || pos.floor === 'mezzanine') {
      // No room doors exist on the lobby or the mezzanine (3.C): a rest there
      // would strand the guest target (REST-05).
      return 'ignored'
    }
    if (!doorInRange(pos.x, room)) return 'ignored'
    sc.carrier = null
    sc.rest = { floor: pos.floor as GuestFloorId, room }
    sc.legStartTick = null
    this.pending.push({ type: 'suitcase:placed', guestId: id, floor: sc.rest.floor, room })
    this.retargetOnRest(id)
    return 'placed'
  }

  /**
   * Pick up the nearest resting suitcase on the sender's floor within
   * ROOM_DOOR_RANGE_TILES (SUI-08) — by anyone, saboteur included; self-regrab
   * allowed. Ties resolve to the lowest guest ordinal (deterministic). A fresh
   * carry leg starts (the carry clock restarts, SUI-19). Emits
   * `suitcase:picked_up` (lifecycle fact — the walkie log renders it).
   */
  pickupSuitcase(playerId: string, tick: number): 'picked_up' | 'ignored' {
    if (this.isCarrying(playerId)) return 'ignored'
    const pos = this.movement.positionOf(playerId)
    if (pos === undefined) return 'ignored'
    // Nearest on the same floor within ROOM_DOOR_RANGE_TILES; ties resolve to
    // the lowest guest ordinal — the rule lives once in the affordances
    // module (AD-036) and the client's pickup affordance reuses it.
    const bestId = nearestRestingSuitcase(
      { floor: pos.floor, x: pos.x },
      [...this.suitcases].map(([id, s]) => ({ id, carrierId: s.carrier, rest: s.rest })),
    )
    if (bestId === null) return 'ignored'
    const sc = this.suitcases.get(bestId)
    if (sc === undefined) return 'ignored'
    sc.carrier = playerId
    sc.rest = null
    sc.legStartTick = tick
    this.pending.push({ type: 'suitcase:picked_up', guestId: bestId, carrierId: playerId })
    return 'picked_up'
  }

  /**
   * Carrier-loss teardown (SUI-20, fired/ghosted/disconnect): the guest
   * re-queues at the FRONT with the impatience clock resumed exactly where it
   * froze, and the assignment is void — reservation released, re-assigned at
   * re-check-in.
   *
   * SPEC_DEVIATION: the roadmap/proposal shorthand "the suitcase rests at the
   * desk" is implemented as the desk ABSORBING the suitcase (removed from
   * play). A rest-at-desk object with a voided assignment has no game
   * consequence — nothing follows it, and a movable one could dead-end the
   * desk for its guest — so the re-check-in issues the guest's luggage afresh.
   * Recorded in the cycle's STATE.md decisions.
   */
  dropCarry(playerId: string, tick: number): void {
    const id = this.carriedGuestOf(playerId)
    if (id === null) return
    this.suitcases.delete(id)
    const g = this.guests.get(id)
    if (g === undefined) return
    if (g.assigned !== null) this.reserved.delete(roomKey(g.assigned.floor, g.assigned.room))
    g.assigned = null
    g.target = null
    g.phase = 'queued'
    g.impatientAt = tick + (g.impatienceRemaining ?? 0)
    g.impatienceRemaining = null
    const hIdx = this.dining.indexOf(id)
    if (hIdx !== -1) {
      this.dining.splice(hIdx, 1)
      g.diningDwellTicks = null
      this.rePlaceDining()
    }
    this.queue.unshift(id)
    this.rePlaceQueue()
  }

  /** True when this player carries a suitcase (SUI-11 work block + SUI-02). */
  isCarrying(playerId: string): boolean {
    return this.carriedGuestOf(playerId) !== null
  }

  private carriedGuestOf(playerId: string): string | null {
    for (const [id, sc] of this.suitcases) {
      if (sc.carrier === playerId) return id
    }
    return null
  }

  /** Re-place dining guests into their deterministic mezzanine slots. The
   *  floor check matters: queue slots and dining slots share x values, so an
   *  x-only compare would leave a checked-in guest stranded on the lobby. */
  private rePlaceDining(): void {
    this.dining.forEach((gid, slot) => {
      const want = DINING_START + slot * QUEUE_STEP
      const pos = this.movement.positionOf(gid)
      if (
        pos !== undefined &&
        (pos.floor !== 'mezzanine' || Math.abs(pos.x - want) > ARRIVAL_TOLERANCE_TILES)
      ) {
        this.movement.removeGuest(gid)
        this.movement.joinGuest(gid, 'mezzanine', want)
        this.movement.announceGuest(gid)
      }
    })
  }

  /** One seeded dining dwell draw in ticks (uniform within the 15–30 s dial,
   *  scaled by the test seam). The value has no behavioral consumer — the
   *  dwell is a wait buffer (REST-10) — but the draw keeps the guest Rng
   *  stream deterministic per dining stay. */
  private drawDiningDwellTicks(): number {
    const seconds = this.rng.uniform(
      TUNING.GUEST_DINING_MIN_SECONDS,
      TUNING.GUEST_DINING_MAX_SECONDS,
    )
    return Math.max(1, Math.round(seconds * this.diningScale * TICK_HZ))
  }

  /** The drawn dining dwell of the current dining stay, or null (tests +
   *  telemetry; no behavioral consumer, REST-10). */
  diningDwellOf(guestId: string): number | null {
    return this.guests.get(guestId)?.diningDwellTicks ?? null
  }

  /** A rest event re-targets the suitcase's guest (SUI-13): waiting guests
   *  leave the restaurant; door-waiting guests re-target in place. */
  private retargetOnRest(id: string): void {
    const g = this.guests.get(id)
    const sc = this.suitcases.get(id)
    if (g === undefined || sc === undefined) return
    const rest = sc.rest
    if (rest === null) return
    if (g.phase === 'dining') {
      const hIdx = this.dining.indexOf(id)
      if (hIdx !== -1) {
        this.dining.splice(hIdx, 1)
        g.diningDwellTicks = null
        this.rePlaceDining()
      }
      g.phase = 'toRoom'
      g.target = rest
    } else if (g.phase === 'toRoom') {
      g.target = rest
    }
  }

  /**
   * The guest driver (design §Components): at most one intent per tick,
   * reading only public mover state. Hall goal: walk to the NEAREST landing
   * (tie → west), press the call every tick in the landing zone — the press
   * BOARDS through open doors (AD-025), summons, queues pinned (AD-023), or
   * flashes as a duplicate (AD-019): all safe to re-issue idempotently.
   * Riding goal: press the target floor until queued; hold the exit
   * direction from the moment the car serves the target floor — the held
   * intent applies the tick the doors are fully open (AD-026).
   */
  private driveToRoom(g: Guest, tick: number, events: SimEvent[]): void {
    const target = g.assigned
    if (target === null) return
    const doorX = roomDoorXMilli(target.room) / 1000
    const view = this.movement.viewOf(g.id)
    const pos = this.movement.positionOf(g.id)
    if (pos === undefined) return

    if (view.car !== null) {
      // Riding: press the target floor until queued; hold the exit direction
      // once the car is at (or past) the target floor.
      if (pos.floor !== target.floor) {
        this.movement.pressFloor(g.id, target.floor)
        return
      }
      this.movement.startMove(g.id, doorX < pos.x ? 'left' : 'right')
      return
    }

    if (pos.floor === target.floor) {
      // On the assigned floor: walk to the door and settle (GUEST-08).
      if (Math.abs(pos.x - doorX) <= ARRIVAL_TOLERANCE_TILES) {
        this.movement.stopMove(g.id)
        this.movement.removeGuest(g.id) // enters the room — leaves hall view
        this.settleAt(g, target.floor, target.room, tick, events)
        return
      }
      this.movement.startMove(g.id, doorX < pos.x ? 'left' : 'right')
      return
    }

    // On the lobby floor: reach the nearest landing and press (which boards,
    // summons, pins, or flashes — all idempotent).
    this.driveToLandingAndCall(g, pos)
  }

  /** Shared settle (tenancy commits at arrival; seeded dwell). Reservation
   *  cleanup is a no-op for self-assigned guests (never reserved). */
  private settleAt(
    g: Guest,
    floor: GuestFloorId,
    room: RoomIndex,
    tick: number,
    events: SimEvent[],
  ): void {
    g.phase = 'settling'
    this.settledTotal += 1
    this.tenanted.set(roomKey(floor, room), g.id)
    this.reserved.delete(roomKey(floor, room))
    const dwellSeconds = this.rng.uniform(
      TUNING.GUEST_DWELL_MIN_SECONDS,
      TUNING.GUEST_DWELL_MAX_SECONDS,
    )
    const dwellTicks = Math.max(1, Math.round(dwellSeconds * this.dwellScale * TICK_HZ))
    g.dwellEndsAt = tick + dwellTicks
    events.push({ type: 'guest:settled', guestId: g.id, floor, room })
  }

  /**
   * The suitcase-guest driver (SUI-13/14, cycle 3.B): walk toward the
   * suitcase's last resting room. Re-targeting happens on rest events
   * (retargetOnRest); a mid-walk pickup strands the guest exactly where they
   * stand — dining on the mezzanine or waiting at the old door — until the next rest
   * event. Arrival resolves the outcome (SUI-14): assignment match → settle
   *  (tenancy commits); mismatch → door complaint + return to the dining
   * area, re-targeting on the next rest (SUI-15: no personal penalty).
   */
  private driveToResting(g: Guest, tick: number, events: SimEvent[]): void {
    const sc = this.suitcases.get(g.id)
    const target = g.target
    if (target === null) return
    const rest = sc?.rest
    if (rest === undefined || rest === null) {
      this.movement.stopMove(g.id)
      return
    }
    if (target.floor !== rest.floor || target.room !== rest.room) {
      g.target = rest
      return
    }
    const doorX = roomDoorXMilli(target.room) / 1000
    const view = this.movement.viewOf(g.id)
    const pos = this.movement.positionOf(g.id)
    if (pos === undefined) return

    if (view.car !== null) {
      // Riding: press the target floor until queued; hold the exit direction
      // once the car is at (or past) the target floor.
      if (pos.floor !== target.floor) {
        this.movement.pressFloor(g.id, target.floor)
        return
      }
      this.movement.startMove(g.id, doorX < pos.x ? 'left' : 'right')
      return
    }

    if (pos.floor === target.floor) {
      if (Math.abs(pos.x - doorX) <= ARRIVAL_TOLERANCE_TILES) {
        this.movement.stopMove(g.id)
        this.movement.removeGuest(g.id) // at the door — leaves hall view
        const assigned = g.assigned
        if (assigned !== null && assigned.floor === target.floor && assigned.room === target.room) {
          this.settleAt(g, target.floor, target.room, tick, events)
        } else {
          events.push({
            type: 'guest:complained',
            guestId: g.id,
            floor: target.floor,
            room: target.room,
          })
          g.phase = 'dining'
          g.target = null
          this.dining.push(g.id)
          // Re-place directly: the guest was just removed from the hall at
          // the door, and rePlaceDining only corrects existing positions.
          // A fresh dining stay draws a fresh dwell (REST-08: per stay).
          this.movement.joinGuest(
            g.id,
            'mezzanine',
            DINING_START + (this.dining.length - 1) * QUEUE_STEP,
          )
          this.movement.announceGuest(g.id)
          g.diningDwellTicks = this.drawDiningDwellTicks()
        }
        return
      }
      this.movement.startMove(g.id, doorX < pos.x ? 'left' : 'right')
      return
    }

    this.driveToLandingAndCall(g, pos)
  }

  private driveToExit(g: Guest, _tick: number, events: SimEvent[]): void {
    const view = this.movement.viewOf(g.id)
    const pos = this.movement.positionOf(g.id)
    if (pos === undefined) return

    if (view.car !== null) {
      // Riding: press lobby until queued; hold the exit once the car is there.
      if (pos.floor !== 'lobby') {
        this.movement.pressFloor(g.id, 'lobby')
        return
      }
      this.movement.startMove(g.id, DESK_X < pos.x ? 'left' : 'right')
      return
    }

    if (pos.floor === 'lobby') {
      if (Math.abs(pos.x - DESK_X) <= ARRIVAL_TOLERANCE_TILES) {
        // Reached the desk: the hotel exit (GUEST-09 despawn).
        this.movement.stopMove(g.id)
        this.movement.removeGuest(g.id)
        this.guests.delete(g.id)
        events.push({ type: 'guest:left', guestId: g.id })
        return
      }
      this.movement.startMove(g.id, DESK_X < pos.x ? 'left' : 'right')
      return
    }

    this.driveToLandingAndCall(g, pos)
  }

  /**
   * Hall behavior on a guest floor (toRoom's first leg, toExit's first leg).
   * Single car (cycle 3.E, AD-040): the landing is the EAST end — the
   * stairwell took the west landing, so there is no nearest-landing choice
   * anymore. Press the call every tick in the landing zone — the press
   * BOARDS through open doors (AD-025), summons, queues (AD-023/019), or
   * flashes as a duplicate: all safe to re-issue idempotently.
   */
  private driveToLandingAndCall(g: Guest, pos: { floor: FloorId; x: number }): void {
    if (Math.abs(pos.x - HALL_LENGTH_TILES) <= TUNING.ELEVATOR_LANDING_TILES) {
      this.movement.stopMove(g.id)
      this.movement.callElevator(g.id)
      return
    }
    this.movement.startMove(g.id, 'right')
  }

  /** Carriers whose carry leg expired — the RoundSim drains this right after
   *  the guest tick and fires them through the justice pipeline (SUI-18). */
  drainExpiredCarriers(): string[] {
    return this.expiredCarriers.splice(0)
  }

  /** Snapshot query for tests and the room's routing helpers. */
  tenantedRooms(): { floor: GuestFloorId; room: RoomIndex }[] {
    return this.allRoomKeys().filter((r) => this.tenanted.has(roomKey(r.floor, r.room)))
  }

  /** The per-round settle score (cycle 3.D, AD-039): committed settles on
   *  both the suitcase-match and the self-assign path — the buzzer win
   *  check and the recap read this. */
  get settledCount(): number {
    return this.settledTotal
  }

  /**
   * Resting suitcases for the movement snapshot (cycle 3.B): sameFloor-public
   * rows; the room filters by the viewer's floor.
   */
  restingSuitcases(): { guestId: string; floor: FloorId; room: RoomIndex }[] {
    const rows: { guestId: string; floor: FloorId; room: RoomIndex }[] = []
    for (const [id, sc] of this.suitcases) {
      if (sc.rest === null) continue
      rows.push({ guestId: id, floor: sc.rest.floor, room: sc.rest.room })
    }
    return rows
  }

  guestIds(): string[] {
    return [...this.guests.keys()]
  }
}
