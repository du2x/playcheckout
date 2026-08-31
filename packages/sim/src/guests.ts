import type { FloorId, GuestFloorId, LobbySize, RoomIndex, SimEvent } from '@turnover/shared'
import {
  GUEST_FLOOR_IDS,
  ROOM_INDEXES,
  ROOMS_PER_FLOOR,
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

export type GuestPhase = 'queued' | 'impatient' | 'held' | 'toRoom' | 'settling' | 'toExit'

interface Guest {
  id: string
  phase: GuestPhase
  assigned: { floor: GuestFloorId; room: RoomIndex } | null
  /** Absolute tick impatience fires (spawn + GUEST_IMPATIENCE_SECONDS). */
  impatientAt: number
  /** Ticks left on the frozen impatience clock while held (cycle 3.2) —
   *  null ⇔ not held. Release restores impatientAt = tick + remaining. */
  impatienceRemaining: number | null
  /** Absolute tick a settling guest checks out (settle + seeded dwell). */
  dwellEndsAt: number | null
  /** Non-null ⇔ the guest is held at the desk by this player (cycle 3.2). */
  heldBy: string | null
}

const IMPATIENCE_TICKS = TUNING.GUEST_IMPATIENCE_SECONDS * TICK_HZ
const DESK_X = TUNING.DESK_X_TILES
const QUEUE_STEP = TUNING.GUEST_QUEUE_SPACING_TILES
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
   *  NEVER contains a held guest (cycle 3.2): holding removes from the queue
   *  without re-placing; release re-inserts at the FRONT and re-places. */
  private readonly queue: string[] = []
  /** roomKey → guestId (the single tenancy/vacancy source). */
  private readonly tenanted = new Map<string, string>()
  /** holderId → held guestId (cycle 3.2): a holder holds at most one guest. */
  private readonly held = new Map<string, string>()
  /** Intent-time events (desk receive/route) flushed on the NEXT tick —
   *  the MOVE-10 announce pattern: tick() is the only event emitter. */
  private pending: SimEvent[] = []
  private readonly rng: Rng
  private readonly cadenceTicks: number
  private readonly impatienceTicks: number
  private readonly dwellScale: number
  private nextScheduleTick: number
  private backlog = 0
  private ordinal = 0

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
    return this.allRoomKeys().filter((r) => !this.tenanted.has(roomKey(r.floor, r.room)))
  }

  private hasVacancy(): boolean {
    return this.tenanted.size < GUEST_FLOOR_IDS.length * ROOMS_PER_FLOOR
  }

  /**
   * Advance one 0.05 s step. `tick` is the absolute round tick (from the
   * RoundSim clock). Returns the guest lifecycle events emitted this tick —
   * including the desk intents queued since the last tick (announce pattern).
   */
  tick(tick: number): SimEvent[] {
    const events: SimEvent[] = [...this.pending]
    this.pending = []

    // Arrival schedule: fixed interval, backlog when the hotel is full.
    if (tick >= this.nextScheduleTick) {
      this.backlog++
      this.nextScheduleTick += this.cadenceTicks
    }
    if (this.backlog > 0 && this.hasVacancy()) {
      this.backlog--
      this.spawn(tick, events)
    }

    // Held-guest walk-out check (DESK-03, cycle 3.2): a holder who leaves the
    // desk zone (or whose slot is gone — fired/ghosted/disconnected) releases
    // their guest to the queue front. The fire/ghost/leave teardown paths call
    // releaseAll directly; this tick check covers the walking-out case.
    for (const [holderId] of this.held) {
      const pos = this.movement.positionOf(holderId)
      if (
        pos === undefined ||
        pos.floor !== 'lobby' ||
        Math.abs(pos.x - DESK_X) > TUNING.DESK_RANGE_TILES
      ) {
        this.releaseHeld(holderId, tick)
      }
    }

    // Impatience (GUEST-04): the cue fires once, exactly the impatience
    // interval after spawn. Free — no complaint, no budget effect in 3.1.
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
      if (g.phase === 'toRoom' && g.assigned !== null) {
        this.driveToRoom(g, tick, events)
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
      impatientAt: tick + this.impatienceTicks,
      impatienceRemaining: null,
      dwellEndsAt: null,
      heldBy: null,
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
   *  positions, not walks — the same re-place removeFromQueue always did). */
  private rePlaceQueue(): void {
    this.queue.forEach((qid, slot) => {
      const pos = this.movement.positionOf(qid)
      if (pos !== undefined && Math.abs(pos.x - slotX(slot)) > ARRIVAL_TOLERANCE_TILES) {
        this.movement.removeGuest(qid)
        this.movement.joinGuest(qid, 'lobby', slotX(slot))
        this.movement.announceGuest(qid)
      }
    })
  }

  // --- Front desk (cycle 3.2, DESK-01..10) ---------------------------------

  /**
   * E in the desk zone (DESK-01): hand the caller the FRONT queued guest —
   * the guest leaves the queue WITHOUT re-placing the rest (the queue does
   * not shift while a guest is held) and their impatience clock freezes.
   * 'ignored' covers every silent case: caller already holds one, or the
   * queue is empty (DESK-02).
   */
  receiveAtDesk(holderId: string, tick: number): 'accepted' | 'ignored' {
    if (this.held.has(holderId)) return 'ignored'
    const id = this.queue[0]
    if (id === undefined) return 'ignored'
    const g = this.guests.get(id)
    if (g === undefined) return 'ignored'
    this.queue.splice(0, 1)
    g.phase = 'held'
    g.heldBy = holderId
    g.impatienceRemaining = Math.max(0, g.impatientAt - tick)
    this.held.set(holderId, id)
    return 'accepted'
  }

  /**
   * Release a holder's guest (DESK-03): back to the queue FRONT, re-placing
   * every slot, with the impatience clock resumed exactly where it paused.
   * No-op (silent) when the holder holds nothing.
   */
  releaseHeld(holderId: string, tick: number): void {
    const id = this.held.get(holderId)
    if (id === undefined) return
    const g = this.guests.get(id)
    this.held.delete(holderId)
    if (g === undefined) return
    g.phase = 'queued'
    g.heldBy = null
    g.impatientAt = tick + (g.impatienceRemaining ?? 0)
    g.impatienceRemaining = null
    this.queue.unshift(id)
    this.rePlaceQueue()
  }

  /** Teardown wrapper (DESK-05): fired/ghosted/disconnected holders release. */
  releaseAll(holderId: string, tick: number): void {
    this.releaseHeld(holderId, tick)
  }

  /** True when this player currently holds a desk guest (deskInteract's
   *  receive-vs-release derivation reads it). */
  holds(holderId: string): boolean {
    return this.held.has(holderId)
  }

  /**
   * Complete the send flow (DESK-06..09): route the holder's guest to the
   * DESTINATION (server truth — tenancy commits NOW, matching 3.1's
   * commit-at-choice; the guest walks as a 3.1 elevator citizen) and queue
   * the departure + walkie claim for the next-tick flush. The ANNOUNCED room
   * is a free claim — never validated against the destination (DESK-08).
   * A tenanted destination is rejected silently (DESK-09): the holder keeps
   * the guest. 'ignored' also covers a non-holder.
   */
  routeHeld(
    holderId: string,
    destination: { floor: GuestFloorId; room: RoomIndex },
    announce: { floor: GuestFloorId; room: RoomIndex },
  ): 'routed' | 'ignored' {
    const id = this.held.get(holderId)
    if (id === undefined) return 'ignored'
    const destKey = roomKey(destination.floor, destination.room)
    if (this.tenanted.has(destKey)) return 'ignored'
    const g = this.guests.get(id)
    if (g === undefined) {
      this.held.delete(holderId)
      return 'ignored'
    }
    this.held.delete(holderId)
    g.phase = 'toRoom'
    g.assigned = destination
    g.heldBy = null
    g.impatienceRemaining = null
    this.tenanted.set(destKey, id)
    this.pending.push(
      { type: 'guest:routed', guestId: id, playerId: holderId },
      {
        type: 'walkie:broadcast',
        playerId: holderId,
        floor: announce.floor,
        room: announce.room,
      },
    )
    return 'routed'
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
        g.phase = 'settling'
        this.tenanted.set(roomKey(target.floor, target.room), g.id)
        const dwellSeconds = this.rng.uniform(
          TUNING.GUEST_DWELL_MIN_SECONDS,
          TUNING.GUEST_DWELL_MAX_SECONDS,
        )
        const dwellTicks = Math.max(1, Math.round(dwellSeconds * this.dwellScale * TICK_HZ))
        g.dwellEndsAt = tick + dwellTicks
        events.push({
          type: 'guest:settled',
          guestId: g.id,
          floor: target.floor,
          room: target.room,
        })
        return
      }
      this.movement.startMove(g.id, doorX < pos.x ? 'left' : 'right')
      return
    }

    // On the lobby floor: reach the nearest landing and press (which boards,
    // summons, pins, or flashes — all idempotent).
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

  /** Hall behavior on a guest floor (toRoom's first leg, toExit's first leg). */
  private driveToLandingAndCall(g: Guest, pos: { floor: FloorId; x: number }): void {
    const west = Math.abs(pos.x - 0)
    const east = Math.abs(pos.x - 30)
    const landingX = west <= east ? 0 : 30
    if (Math.abs(pos.x - landingX) <= TUNING.ELEVATOR_LANDING_TILES) {
      this.movement.stopMove(g.id)
      this.movement.callElevator(g.id)
      return
    }
    this.movement.startMove(g.id, landingX < pos.x ? 'left' : 'right')
  }

  /** Snapshot query for tests and the room's routing helpers. */
  tenantedRooms(): { floor: GuestFloorId; room: RoomIndex }[] {
    return this.allRoomKeys().filter((r) => this.tenanted.has(roomKey(r.floor, r.room)))
  }

  guestIds(): string[] {
    return [...this.guests.keys()]
  }
}
