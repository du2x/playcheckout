import type { MovementEvent, RoomIndex } from '@turnover/shared'
import {
  FLOOR_IDS,
  type FloorId,
  HALL_LENGTH_TILES,
  roomIndexAtMilli,
  TUNING,
} from '@turnover/shared'
import { TICK_HZ } from './tick.js'

/**
 * Pure movement sim (cycle 2.4, AD-005): the room's always-running spatial
 * substrate. Inputs + time in, events out — no I/O, no clocks, no randomness.
 * The room drives one `tick()` per 50 ms interval in BOTH phases; the buzzer
 * and host-start never clear it, so positions persist across lobby→round→lobby.
 *
 * Positions are integer MILLITILES (×1000) so integration is bit-for-bit
 * reproducible: per-tick displacement is the §7 speed expressed in millitiles
 * divided by TICK_HZ (an exact integer). Wire values are tiles (millit / 1000).
 */

const MILLI = 1000
/** Millitiles per tick at the §7 speed (exact integer, no float drift). */
export const SPEED_MILLI_PER_TICK = (TUNING.PLAYER_SPEED_TILES_PER_SEC * MILLI) / TICK_HZ
export const HALL_MAX_MILLI = HALL_LENGTH_TILES * MILLI
/** Elevator cycle in ticks, derived from §7 (3 s arrival, 2 s per floor). */
export const ARRIVE_TICKS = TUNING.ELEVATOR_ARRIVE_SECONDS * TICK_HZ
export const RIDE_TICKS_PER_FLOOR = TUNING.ELEVATOR_RIDE_SECONDS_PER_FLOOR * TICK_HZ
/** Open-door dwell at every stop, derived from §7-external ELEVATOR_DWELL_SECONDS. */
export const DWELL_TICKS = TUNING.ELEVATOR_DWELL_SECONDS * TICK_HZ
/** Door-swing stage length (opening AND closing), AD-026 — no hop while swinging. */
export const DOOR_TICKS = TUNING.ELEVATOR_DOOR_SECONDS * TICK_HZ
/** West (car 1) and east (car 2) landings, same x on every level (FR-5). */
export const CAR_LANDING_MILLI: Record<1 | 2, number> = { 1: 0, 2: HALL_MAX_MILLI }

export type MoveDir = 'left' | 'right'

interface PlayerMoveState {
  floor: FloorId
  x: number
  facing: MoveDir
  moving: MoveDir | null
  inCar: 1 | 2 | null
  /** Event owed without an x change: facing flip, or move end (one terminal
   *  rest-x event so clients reconcile prediction overshoot — MOVE-02/03
   *  amendment). */
  facingDirty: boolean
  /** AD-026: a rider held a direction while the doors were swinging OPEN —
   *  the hop-off applies the tick the doors are fully open (the client sends
   *  the intent once per keypress, so the sim remembers it). */
  pendingExit: MoveDir | null
}

type CarPhase = 'idle' | 'arriving' | 'opening' | 'dwelling' | 'closing' | 'riding'

/**
 * Per-car elevator state (AD-014 rider rework, AD-025 boarding amendment,
 * AD-026 door stages): a six-phase machine — idle/arriving/opening/dwelling/
 * closing/riding. Doors are fully open ONLY in `dwelling`: hop-in and hop-off
 * are gated on it, and `idle` is a PARKED car with the doors shut (they
 * reopen through the landing call press or an in-car current-floor press).
 * The FIFO press `queue` belongs to the CAR, not the presser: walk-offs never
 * clear it (ghost trips). `pendingBoarders` holds landing-call presses made
 * while the doors were not yet open — they board the tick the doors finish
 * opening (capacity-checked in press order).
 */
interface CarState {
  floor: FloorId
  riders: string[]
  phase: CarPhase
  ticksLeft: number
  pickup: FloorId | null
  queue: FloorId[]
  pendingBoarders: string[]
}

/**
 * Queued call (sim-level FIFO): dispatched when a car next frees. Calls carry
 * NO destination (AD-014) — the pickup floor is the whole request.
 */
interface QueuedCall {
  playerId: string
  pickup: FloorId
  /** AD-023: set when the caller pressed at this car's own landing — the call
   *  is served only by THAT car, never by the other one. */
  car?: 1 | 2
}

/**
 * Pending announce for the next tick (MOVE-10 pattern): call flashes (public)
 * and accepted in-car presses (rider-exclusive — routed by the `riders`
 * policy, AD-013).
 */
type PendingAnnounce =
  | { kind: 'called'; floor: FloorId; car: 1 | 2 }
  | { kind: 'pressed'; playerId: string; floor: FloorId; car: 1 | 2 }
  | { kind: 'riders'; car: 1 | 2 }

export class MovementSim {
  private readonly players = new Map<string, PlayerMoveState>()
  private readonly cars: Record<1 | 2, CarState> = {
    1: {
      floor: 'lobby',
      riders: [],
      phase: 'idle',
      ticksLeft: 0,
      pickup: null,
      queue: [],
      pendingBoarders: [],
    },
    2: {
      floor: 'lobby',
      riders: [],
      phase: 'idle',
      ticksLeft: 0,
      pickup: null,
      queue: [],
      pendingBoarders: [],
    },
  }
  private callQueue: QueuedCall[] = []
  private announced: PendingAnnounce[] = []
  /** Intent-time events (AD-025 explicit boarding) flushed at the next tick. */
  private pendingEvents: MovementEvent[] = []
  /** Cars whose rider list changed since the last tick — one coalesced
   * `elevator:riders` per dirty car at tick start (AD-013). */
  private ridersDirty: (1 | 2)[] = []

  // --- roster / lifecycle -------------------------------------------------

  /** Fresh-joiner placement (FR-2 "spawn"): lobby center, facing right. */
  join(playerId: string): void {
    this.players.set(playerId, {
      floor: 'lobby',
      x: HALL_MAX_MILLI / 2,
      facing: 'right',
      moving: null,
      inCar: null,
      facingDirty: false,
      pendingExit: null,
    })
  }

  leave(playerId: string): void {
    this.players.delete(playerId)
    for (const id of [1, 2] as const) {
      const car = this.cars[id]
      if (car.pendingBoarders.includes(playerId)) {
        car.pendingBoarders = car.pendingBoarders.filter((b) => b !== playerId)
      }
      if (car.riders.includes(playerId)) {
        car.riders = car.riders.filter((r) => r !== playerId)
        this.markRidersDirty(id) // disconnect-dirty flush: one update next tick
      }
    }
  }

  /**
   * Re-announce a player's position on the next tick — the reconnection
   * rectangle re-add (cycle 2.9, FR-25): other clients removed the display on
   * player:left; one player:moved re-creates it at the preserved position.
   */
  announcePosition(playerId: string): void {
    const p = this.players.get(playerId)
    if (p === undefined) return
    p.facingDirty = true
  }

  /**
   * Full-building positions — the FR-20 spectator baseline (cycle 2.9). The
   * room sends this to fired sessions only; live players' snapshots stay
   * own-floor filtered (AD-008/AD-009).
   */
  allPositions(): { playerId: string; floor: FloorId; x: number }[] {
    return [...this.players.entries()]
      .filter(([, p]) => p.inCar === null)
      .map(([playerId, p]) => ({ playerId, floor: p.floor, x: p.x / MILLI }))
  }

  /** Both cars' public floors — panels data is public everywhere. */
  carFloors(): { car: 1 | 2; floor: FloorId }[] {
    return [
      { car: 1 as const, floor: this.cars[1].floor },
      { car: 2 as const, floor: this.cars[2].floor },
    ]
  }

  /** Queue a rider-list update for the next tick — one per car, coalesced. */
  private markRidersDirty(carId: 1 | 2): void {
    if (!this.ridersDirty.includes(carId)) this.ridersDirty.push(carId)
  }

  // --- intents ------------------------------------------------------------

  /**
   * Hold-to-walk. Idempotent while held (any floor, any phase — AD-015
   * removed the lobby confinement). A direction change flips facing
   * immediately.
   *
   * AD-014 door-open exit, AMENDED by AD-026: a rider holding a direction
   * exits their car ONLY while the doors are fully open (the `dwelling`
   * stage) — the `opening`/`closing` swings and the parked-closed `idle` all
   * block the hop. A rider stranded aboard a parked car reopens the doors by
   * pressing the car's current floor (see `pressFloor`). While the doors are
   * shut or swinging the intent is still ignored (MOVE-09): positions change
   * only via the car.
   */
  startMove(playerId: string, dir: MoveDir): void {
    const p = this.players.get(playerId)
    if (p === undefined) return
    if (p.inCar !== null) {
      const carId = p.inCar
      const car = this.cars[carId]
      if (car.phase !== 'dwelling') {
        // AD-026: the doors are swinging OPEN — remember the held exit so it
        // applies the tick the doors are fully open (the client sends the
        // intent once per keypress). A hold during `closing` or any shut
        // phase is lost: that hop-off never happens (MOVE-09).
        p.pendingExit = car.phase === 'opening' ? dir : null
        return
      }
      this.exitCar(carId, playerId, dir)
      return
    }
    p.facing = dir
    if (p.moving === dir) return
    p.facingDirty = true
    p.moving = dir
  }

  /** AD-026 hop-off through fully open doors: place the exiter at the car's
   *  landing (hallway walking after exit is unrestricted) and resume their
   *  same-floor player:moved stream. */
  private exitCar(carId: 1 | 2, playerId: string, dir: MoveDir): void {
    const car = this.cars[carId]
    const p = this.players.get(playerId)
    if (p === undefined) return
    p.pendingExit = null
    p.inCar = null
    p.floor = car.floor
    p.x = CAR_LANDING_MILLI[carId]
    car.riders = car.riders.filter((r) => r !== playerId)
    this.markRidersDirty(carId) // walk-off: remaining riders get the update
    p.facing = dir
    p.facingDirty = true // the same-floor player:moved stream resumes next tick
    p.moving = dir
  }

  /** Release-to-stop; a no-op when no move is active (spec edge). Emits one
   *  terminal `player:moved` on the next tick so clients reconcile the own
   *  rectangle to the authoritative rest x (prediction overshoot is never
   *  corrected otherwise — stop ends the move-stream). AD-026: releasing the
   *  direction while a door-swing exit is pending CANCELS that exit — the
   *  hop-off is a HELD intent, and the rider kept the doors held open. */
  stopMove(playerId: string): void {
    const p = this.players.get(playerId)
    if (p === undefined) return
    if (p.moving !== null) p.facingDirty = true
    p.moving = null
    p.pendingExit = null
  }

  // --- elevator calls and in-car presses ------------------------------------

  /**
   * Call a car to the caller's floor — destination-free (AD-014): the call
   * carries no target; the destination is chosen inside the car via
   * `elevator:press`. Returns why the call ended as it did:
   * - 'dispatched': a car was dispatched (60-tick arrival begins now) or the
   *   call was queued sim-level FIFO (the pinned/both cars busy)
   * - 'ignored': duplicate call — duplicate predicate = pickup floor ONLY
   *   (AD-012 narrowed): a car already en route to (or queued for) the pickup,
   *   or standing there with open doors. The panel still flashes (MOVE-12).
   * - 'rejected': caller in a car (AD-011: elevators run in BOTH phases)
   */
  callElevator(playerId: string): 'dispatched' | 'ignored' | 'rejected' {
    const caller = this.players.get(playerId)
    if (caller === undefined || caller.inCar !== null) return 'rejected'
    const pickup = caller.floor
    // AD-025: a caller standing at a landing whose car stands at their floor
    // is BOARDING, not calling — the press outranks the duplicate/queue
    // handling below. AMENDED by AD-026: boarding through the doors requires
    // them fully open. A `dwelling` car admits the presser immediately; a
    // car with shut or swinging doors (idle/opening/closing) queues the
    // presser as a pending boarder and swings the doors open (0.5 s) — the
    // board lands the tick the doors finish opening. Nothing is dispatched;
    // the flash acknowledges and the other car stays put. A full car declines
    // the board silently.
    const atLanding = ([1, 2] as const).find(
      (id) => Math.abs(caller.x - CAR_LANDING_MILLI[id]) <= TUNING.ELEVATOR_LANDING_TILES * MILLI,
    )
    if (atLanding !== undefined) {
      const car = this.cars[atLanding]
      // AD-027: the caller's car is EITHER standing here (floor match) OR
      // arriving to this floor (the pickup they summoned it for) — either
      // way the press is a boarding commitment through the doors.
      const calledHere = car.floor === pickup || (car.phase === 'arriving' && car.pickup === pickup)
      if (calledHere) {
        if (car.phase === 'dwelling') {
          this.boardPlayer(atLanding, playerId)
          this.announce({ kind: 'called', floor: pickup, car: atLanding })
          return 'ignored'
        }
        if (
          car.phase === 'idle' ||
          car.phase === 'opening' ||
          car.phase === 'closing' ||
          car.phase === 'arriving'
        ) {
          if (car.riders.length + car.pendingBoarders.length < TUNING.ELEVATOR_CAPACITY) {
            car.pendingBoarders.push(playerId)
            if (car.phase === 'idle') this.pendingEvents.push(this.openDoors(atLanding))
          }
          this.announce({ kind: 'called', floor: pickup, car: atLanding })
          return 'ignored'
        }
      }
    }
    const duplicating = ([1, 2] as const).find((id) => {
      const car = this.cars[id]
      if (car.phase === 'arriving') return car.pickup === pickup
      if (car.phase === 'riding') return car.queue.includes(pickup)
      return false
    })
    if (duplicating !== undefined) {
      this.announce({ kind: 'called', floor: pickup, car: duplicating })
      return 'ignored'
    }
    if (this.callQueue.some((q) => q.pickup === pickup)) {
      this.announce({ kind: 'called', floor: pickup, car: 1 })
      return 'ignored'
    }
    // AD-023 (hall-button dispatch): a caller standing at a landing pins the
    // call to THAT car — the landing pressed at never summons the other car.
    if (atLanding !== undefined) {
      const car = this.cars[atLanding]
      if (car.phase === 'idle') {
        this.dispatch(atLanding, pickup)
        this.announce({ kind: 'called', floor: pickup, car: atLanding })
        return 'dispatched'
      }
      // Busy (arriving | riding | dwelling elsewhere): queue pinned to this
      // car — it is served when THIS car frees, never by the other one.
      this.callQueue.push({ playerId, pickup, car: atLanding })
      return 'dispatched'
    }
    // Mid-hall caller (unreachable for the stock client — its landing gate
    // only sends from a landing): AD-019 policy — a car stopped at the pickup
    // floor with no departure pending is excluded from dispatch candidacy and
    // the OTHER car is summoned. (AD-026: a `dwelling` car with a queued
    // floor is NOT parked — it departs when its stop ends.) Only when BOTH
    // cars are parked here can nothing arrive: the call stays a decoy flash
    // (the landing call press boarding, or an in-car press, is how a parked
    // car moves).
    const parked = (id: 1 | 2): boolean => {
      const car = this.cars[id]
      return (
        (car.phase === 'idle' || (car.phase === 'dwelling' && car.queue.length === 0)) &&
        car.floor === pickup
      )
    }
    if (parked(1) && parked(2)) {
      this.announce({ kind: 'called', floor: pickup, car: 1 })
      return 'ignored'
    }
    // AD-014 (design review): among idle cars, EMPTY ones are drafted first —
    // an occupied-idle car carries a deliberating rider and is used only when
    // no empty idle car exists. Within each pool: closest landing, tie → car 1.
    const idle = ([1, 2] as const).filter((id) => this.cars[id].phase === 'idle' && !parked(id))
    const closest = (pool: (1 | 2)[]): 1 | 2 | undefined =>
      [...pool].sort(
        (a, b) =>
          Math.abs(caller.x - CAR_LANDING_MILLI[a]) - Math.abs(caller.x - CAR_LANDING_MILLI[b]) ||
          a - b,
      )[0]
    const carId = closest(idle.filter((id) => this.cars[id].riders.length === 0)) ?? closest(idle)
    if (carId === undefined) {
      // Both cars busy: the call waits in the FIFO and is served by the first
      // car to free. Its panel flash happens at dispatch time, not now.
      this.callQueue.push({ playerId, pickup })
      return 'dispatched'
    }
    this.dispatch(carId, pickup)
    this.announce({ kind: 'called', floor: pickup, car: carId })
    return 'dispatched'
  }

  /**
   * Press a floor inside the car the sender is riding (ELR P2). The press
   * appends to the car's FIFO queue — riders-only; duplicates, the floor
   * being served, and the car's current floor while its doors are not shut
   * are rejected SILENTLY (no event, no queue change). Returns:
   * - 'accepted': the press had its effect — queued (and announced
   *   rider-exclusive on the next tick), OR the parked car's doors reopened
   *   for a current-floor press (AD-026, no queue entry, no announce — the
   *   doors opening IS the feedback)
   * - 'ignored': silently rejected (duplicate / being served / current floor
   *   with doors not shut)
   * - 'rejected': the sender is not a rider of any car
   */
  pressFloor(playerId: string, floor: FloorId): 'accepted' | 'ignored' | 'rejected' {
    const p = this.players.get(playerId)
    if (p === undefined || p.inCar === null) return 'rejected'
    const carId = p.inCar
    const car = this.cars[carId]
    // Being served: the pickup floor while arriving (the pickup is the car's
    // destination even though the queue is empty — no zero-tick rides), or
    // the queue head while riding.
    if (car.phase === 'arriving' && car.pickup === floor) return 'ignored'
    if (car.phase === 'riding' && car.queue[0] === floor) return 'ignored'
    if (car.queue.includes(floor)) return 'ignored'
    // "Current floor" while the car stands there: rejected while the doors
    // are open or swinging (opening/dwelling/closing — no zero-tick rides);
    // AD-026: while PARKED with the doors shut (`idle`) the current-floor
    // press REOPENS the doors — the stranded rider's escape hatch (walk off
    // during the 1 s dwell that follows; no queue entry, no lit button).
    if (car.phase === 'opening' || car.phase === 'dwelling' || car.phase === 'closing') {
      if (car.floor === floor) return 'ignored'
    }
    if (car.phase === 'idle' && car.floor === floor) {
      this.pendingEvents.push(this.openDoors(carId))
      return 'accepted'
    }
    car.queue.push(floor)
    this.announce({ kind: 'pressed', playerId, floor, car: carId })
    // A press into an idling car departs it immediately (ELR P2 AC5): the
    // parked doors are shut (AD-026), so the car leaves without opening.
    if (car.phase === 'idle') this.departRiding(carId)
    return 'accepted'
  }

  /** Queue the panel flash for the next tick, naming the serving car (MOVE-10). */
  private announce(entry: PendingAnnounce): void {
    this.announced.push(entry)
  }

  private dispatch(carId: 1 | 2, pickup: FloorId): void {
    const car = this.cars[carId]
    car.pendingBoarders = [] // a car summoned elsewhere abandons its waiting boarders
    car.phase = 'arriving'
    car.ticksLeft = ARRIVE_TICKS
    car.pickup = pickup
  }

  /**
   * AD-026/027: swing the doors open at the car's current floor (0.5 s).
   * Public door state rides the `elevator:doors` event (registry, 'all') —
   * the car's floor is unchanged, so no `elevator:moved` is emitted.
   * Returns the event; intent-time callers flush it via `pendingEvents`,
   * tick-time callers push it straight into the tick's event list.
   */
  private openDoors(carId: 1 | 2): MovementEvent {
    const car = this.cars[carId]
    car.phase = 'opening'
    car.ticksLeft = DOOR_TICKS
    return { type: 'elevator:doors', car: carId, floor: car.floor, open: true }
  }

  /**
   * AD-027: begin the closing swing (0.5 s) — the car has a call to attend
   * (a queued ride or a waiting hall call it can serve from another floor).
   * The departure/dispatch itself lands at the swing's end.
   */
  private closeDoors(carId: 1 | 2): MovementEvent {
    const car = this.cars[carId]
    car.phase = 'closing'
    car.ticksLeft = DOOR_TICKS
    return { type: 'elevator:doors', car: carId, floor: car.floor, open: false }
  }

  /**
   * AD-027: a waiting hall call THIS car can serve from a DIFFERENT floor
   * (landing-pinned to it or unpinned). Calls for the car's own floor are
   * NOT attendable from here — the caller boards through the open doors.
   */
  private attendableCall(carId: 1 | 2): QueuedCall | undefined {
    const car = this.cars[carId]
    const idx = this.callQueue.findIndex(
      (q) => (q.car === undefined || q.car === carId) && q.pickup !== car.floor,
    )
    return idx === -1 ? undefined : this.callQueue[idx]
  }

  /** Depart toward the oldest queued floor (queue non-empty at every call site). */
  private departRiding(carId: 1 | 2): void {
    const car = this.cars[carId]
    const target = car.queue[0]
    if (target === undefined) throw new Error(`depart with empty queue: car ${carId}`)
    const ticks = this.rideTicks(car.floor, target)
    // Belt-and-braces zero-ride guard (AD-014): unreachable — the
    // pickup-while-arriving and current-floor press rejections keep every
    // queued floor distinct from the car's stopped-at floor. Pinned by
    // those rejection tests.
    if (ticks <= 0) throw new Error(`zero-tick ride: ${car.floor} -> ${String(target)}`)
    car.pendingBoarders = [] // a departing car abandons its waiting boarders
    car.phase = 'riding'
    car.ticksLeft = ticks
  }

  // --- queries --------------------------------------------------------------

  positionOf(playerId: string): { floor: FloorId; x: number; facing: MoveDir } | undefined {
    const p = this.players.get(playerId)
    if (p === undefined) return undefined
    return { floor: p.floor, x: p.x / MILLI, facing: p.facing }
  }

  /**
   * AD-008 snapshot contract: a live viewer sees the players on their own
   * floor only (the viewer included), plus both cars' public floors — the
   * panels requirement keeps car positions public everywhere. Riders are on
   * NO floor (AD-009): a player inside a car never appears in a floor
   * snapshot (with no auto-exit they can be aboard indefinitely).
   */
  snapshotForFloor(
    floor: FloorId,
    cardedRooms: readonly RoomIndex[] = [],
  ): {
    players: { playerId: string; floor: FloorId; x: number }[]
    cars: { car: 1 | 2; floor: FloorId }[]
    cardedRooms: readonly RoomIndex[]
  } {
    return {
      players: [...this.players.entries()]
        .filter(([, p]) => p.floor === floor && p.inCar === null)
        .map(([playerId, p]) => ({ playerId, floor: p.floor, x: p.x / MILLI })),
      cars: [
        { car: 1 as const, floor: this.cars[1].floor },
        { car: 2 as const, floor: this.cars[2].floor },
      ],
      cardedRooms: [...cardedRooms],
    }
  }

  /**
   * THE personal snapshot (AD-013; join and buzzer resync): the single home
   * of the rider-vs-floor policy. A rider's snapshot carries an EMPTY players
   * list (no floor stream in a car, AD-009 — this also fixes the AD-009 rider
   * leak), both cars' public floors (panels stay public), and their car's
   * occupants + press queue. A non-rider falls back to the byte-identical
   * floor snapshot — occupancy never appears. Callers never branch.
   */
  snapshotFor(
    playerId: string,
    cardedRooms: readonly RoomIndex[] = [],
  ): {
    players: { playerId: string; floor: FloorId; x: number }[]
    cars: { car: 1 | 2; floor: FloorId }[]
    cardedRooms: readonly RoomIndex[]
    carOccupants?: { car: 1 | 2; riders: string[]; queue: FloorId[] }
  } {
    const p = this.players.get(playerId)
    if (p === undefined || p.inCar === null) {
      return this.snapshotForFloor(p?.floor ?? 'lobby', cardedRooms)
    }
    const car = this.cars[p.inCar]
    return {
      players: [],
      cars: [
        { car: 1 as const, floor: this.cars[1].floor },
        { car: 2 as const, floor: this.cars[2].floor },
      ],
      // A rider's card set is empty: cards are floor knowledge and riders
      // have no floor while in a car (AD-009).
      cardedRooms: [],
      carOccupants: { car: p.inCar, riders: [...car.riders], queue: [...car.queue] },
    }
  }

  /**
   * AD-008 view context for the Router: a live player's own floor (riders get
   * none — no floor stream while in a car) plus the room-segment key they
   * currently stand in (null outside every segment; AD-010 segments), and the
   * car they are riding — the riders-policy routing key (AD-013). `x` is the
   * integer millitile position on the current floor (null for riders and
   * unknown players) — the earshot-policy routing key (cycle 2.7, FR-13).
   */
  viewOf(playerId: string): {
    floor: FloorId | null
    roomKey: string | null
    car: 1 | 2 | null
    x: number | null
  } {
    const p = this.players.get(playerId)
    if (p === undefined) return { floor: null, roomKey: null, car: null, x: null }
    if (p.inCar !== null) return { floor: null, roomKey: null, car: p.inCar, x: null }
    if (p.floor === 'lobby') return { floor: p.floor, roomKey: null, car: null, x: p.x }
    const room = roomIndexAtMilli(p.x)
    return {
      floor: p.floor,
      roomKey: room === 0 ? null : `${p.floor}:${room as RoomIndex}`,
      car: null,
      x: p.x,
    }
  }

  // --- tick -----------------------------------------------------------------

  /** Advance one 0.05 s step; returns the events emitted this tick (may be []). */
  tick(): readonly MovementEvent[] {
    const events: MovementEvent[] = [...this.pendingEvents.splice(0)]
    // AD-013: every rider-list change (board, walk-off, disconnect) reaches the
    // car's riders next tick as ONE elevator:riders carrying the car's current
    // occupants AND press queue — the "lit buttons visible from inside" model.
    for (const id of this.ridersDirty.splice(0)) {
      const car = this.cars[id]
      events.push({
        type: 'elevator:riders',
        car: id,
        riders: [...car.riders],
        queue: [...car.queue],
      })
    }
    for (const a of this.announced.splice(0)) {
      if (a.kind === 'called') {
        events.push({ type: 'elevator:called', floor: a.floor, car: a.car })
      } else if (a.kind === 'pressed') {
        events.push({
          type: 'elevator:pressed',
          playerId: a.playerId,
          floor: a.floor,
          car: a.car,
        })
      }
    }

    for (const [playerId, p] of this.players) {
      if (p.inCar !== null || p.moving === null) {
        if (p.facingDirty) {
          p.facingDirty = false
          events.push(moved(playerId, p))
        }
        continue
      }
      const before = p.x
      p.x += p.moving === 'left' ? -SPEED_MILLI_PER_TICK : SPEED_MILLI_PER_TICK
      p.x = Math.min(HALL_MAX_MILLI, Math.max(0, p.x))
      if (p.x !== before || p.facingDirty) {
        p.facingDirty = false
        events.push(moved(playerId, p))
      }
    }

    this.tickCars(events)
    return events
  }

  private tickCars(events: MovementEvent[]): void {
    for (const id of [1, 2] as const) {
      const car = this.cars[id]
      if (car.phase === 'idle') {
        // Parked with the doors SHUT (AD-026): nobody boards or hops off a
        // parked car — the landing call press (or an in-car current-floor
        // press) reopens the doors.
        continue
      }
      if (car.phase === 'arriving') {
        car.ticksLeft--
        if (car.ticksLeft > 0) continue
        // Arrived at the pickup floor: the doors begin their 0.5 s opening
        // swing (AD-026) — the public `elevator:moved` announces the stop.
        // Riders stay aboard — arrival never auto-exits anyone (AD-014), and
        // the caller boards through the doors once they finish opening
        // (AD-025/AD-026).
        car.floor = car.pickup as FloorId
        car.pickup = null
        events.push({ type: 'elevator:moved', car: id, floor: car.floor })
        events.push(this.openDoors(id))
        this.syncRiderFloors(id)
        continue
      }
      if (car.phase === 'opening') {
        // Opening swing countdown; the doors finish and the 1 s dwell begins
        // with any pending boarders stepping in (AD-026, capacity-checked in
        // press order — a full car declines silently).
        car.ticksLeft--
        if (car.ticksLeft > 0) continue
        car.phase = 'dwelling'
        car.ticksLeft = DWELL_TICKS
        for (const boarder of car.pendingBoarders.splice(0)) this.boardPlayer(id, boarder)
        // Doors fully open: riders who held a direction through the opening
        // swing hop off now (AD-026 pending exits, join order is stable).
        for (const [rid, p] of this.players) {
          if (p.inCar === id && p.pendingExit !== null) {
            this.exitCar(id, rid, p.pendingExit)
          }
        }
        continue
      }
      if (car.phase === 'dwelling') {
        // Doors fully open — the only hop window. AD-027: the dwell is the
        // MINIMUM open time (3 s); afterwards the doors STAY OPEN until the
        // car has a call to attend — a queued ride, or a waiting hall call
        // it can serve from another floor. Nothing to attend: keep dwelling.
        if (car.ticksLeft > 0) {
          car.ticksLeft--
          if (car.ticksLeft > 0) continue
        }
        if (car.queue.length > 0) {
          // A queued ride: close, then depart at the swing's end. The queue
          // belongs to the car: an empty car still departs and serves (ghost
          // trips, ELR P3 AC3).
          events.push(this.closeDoors(id))
          continue
        }
        if (this.attendableCall(id) !== undefined) {
          // A waiting hall call from another floor: close, then dispatch to
          // it at the swing's end.
          events.push(this.closeDoors(id))
          continue
        }
        continue
      }
      if (car.phase === 'closing') {
        car.ticksLeft--
        if (car.ticksLeft > 0) continue
        if (car.queue.length > 0) {
          this.departRiding(id)
        } else {
          // The close was for a waiting hall call (or a press landed during
          // the swing and changed the picture): serve it, or reopen when the
          // call went away.
          const idx = this.callQueue.findIndex(
            (q) => (q.car === undefined || q.car === id) && q.pickup !== car.floor,
          )
          const next = idx === -1 ? undefined : this.callQueue.splice(idx, 1)[0]
          if (next !== undefined) {
            this.dispatch(id, next.pickup)
            this.announce({ kind: 'called', floor: next.pickup, car: id })
          } else {
            events.push(this.openDoors(id))
          }
        }
        continue
      }
      // riding: |Δfloors| × 40 ticks to the oldest queued floor.
      car.ticksLeft--
      if (car.ticksLeft > 0) continue
      const served = car.queue.shift() as FloorId
      car.floor = served
      events.push({ type: 'elevator:moved', car: id, floor: served })
      events.push(this.openDoors(id))
      this.syncRiderFloors(id)
    }
  }

  /** Rider floor tracking: a rider's floor follows the car (never evented —
   * riders have no floor stream, AD-008; positionOf bookkeeping only). */
  private syncRiderFloors(carId: 1 | 2): void {
    const car = this.cars[carId]
    for (const rid of car.riders) {
      const p = this.players.get(rid)
      if (p !== undefined) p.floor = car.floor
    }
  }

  private rideTicks(from: FloorId, to: FloorId): number {
    const a = FLOOR_IDS.indexOf(from)
    const b = FLOOR_IDS.indexOf(to)
    return Math.abs(b - a) * RIDE_TICKS_PER_FLOOR
  }

  /**
   * Explicit boarding (AD-025): the caller pressed the call button while
   * standing at the parked car's landing — they step in. AMENDED by AD-026:
   * the board fires only through fully open doors — immediately when the
   * car is `dwelling`, otherwise at the NEXT dwelling start via the car's
   * `pendingBoarders` (the 0.5 s opening swing comes first). Capacity 2
   * still applies; a full car declines silently (the caller can walk off).
   * Boarding removes the player from the floor stream (player:left-floor
   * names the floor BOARDed — never any destination, WORK-19/MOVE-16) and
   * drops their own queued call (AD-012 #3: no car to an abandoned floor).
   * Emits on the NEXT tick (intent calls run between ticks — MOVE-10).
   */
  private boardPlayer(carId: 1 | 2, playerId: string): boolean {
    const p = this.players.get(playerId)
    if (p === undefined) return false
    const car = this.cars[carId]
    if (car.riders.length >= TUNING.ELEVATOR_CAPACITY) return false
    const landing = CAR_LANDING_MILLI[carId]
    p.inCar = carId
    // Boarding ends the walk: clear the held move so a later move:stop while
    // aboard cannot emit a terminal player:moved for a rider (riders are on
    // NO floor, AD-009 — the exit intent resumes the stream via facingDirty).
    p.moving = null
    p.pendingExit = null
    p.facingDirty = false
    if (p.x !== landing) {
      p.x = landing
      this.pendingEvents.push(moved(playerId, p))
    }
    car.riders.push(playerId)
    this.callQueue = this.callQueue.filter((q) => q.playerId !== playerId)
    this.pendingEvents.push({ type: 'player:left-floor', playerId, floor: car.floor })
    this.markRidersDirty(carId) // AD-013: riders learn the new occupant list
    return true
  }
}

function moved(playerId: string, p: PlayerMoveState): MovementEvent {
  return {
    type: 'player:moved',
    playerId,
    floor: p.floor,
    x: p.x / MILLI,
    facing: p.facing,
  }
}
