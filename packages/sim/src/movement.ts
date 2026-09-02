import type { MovementEvent, MovementSnapshotStairs, RoomIndex } from '@turnover/shared'
import {
  atStairwellMouth,
  FLOOR_IDS,
  type FloorId,
  HALL_LENGTH_TILES,
  roomIndexAtMilli,
  stairsDirections,
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
/**
 * The single car's landing (cycle 3.E, AD-040): the EAST end. The stairwell
 * replaced the west elevator landing — car 1's landing moved from x=0 to
 * x=HALL_MAX_MILLI and the car field stays `1` on the wire everywhere.
 */
export const CAR_LANDING_MILLI = HALL_MAX_MILLI
/** Stairs stride timings (cycle 3.E, AD-040): 3 s transit + 2 s breath. */
export const STAIRS_TRANSIT_TICKS = TUNING.STAIRS_TRANSIT_SECONDS * TICK_HZ
export const STAIRS_BREATH_TICKS = TUNING.STAIRS_BREATH_SECONDS * TICK_HZ
export const STAIRS_STUN_TICKS = TUNING.STAIRS_STUN_SECONDS * TICK_HZ

export type MoveDir = 'left' | 'right'

interface PlayerMoveState {
  /** Cycle 3.1: `'guest'` movers share every walk/elevator rule and emit
   *  `guest:moved` instead of `player:moved`; they never appear in player
   *  snapshots, presses are not announced (guests are weather, not
   *  testimony), and boarding emits no `player:left-floor`. */
  kind: 'player' | 'guest'
  floor: FloorId
  x: number
  facing: MoveDir
  moving: MoveDir | null
  /** The single car (cycle 3.E, AD-040) — `1` while riding, null otherwise. */
  inCar: 1 | null
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
}

/**
 * Per-player stairs state (cycle 3.E, AD-040 design): the west stairwell's
 * black-box transit. One floor stride per activation — transit (3 s) →
 * arrival breath (2 s) → free. A stun (ambush, T4) pauses the transit and
 * preserves `transitTicksLeft` for the resume.
 */
export interface StairsState {
  from: FloorId
  to: FloorId
  /** −1 = down, +1 = up (FLOOR_IDS strides). */
  dir: -1 | 1
  phase: 'transit' | 'breath' | 'stunned'
  /** Ticks left of the current phase (transit or breath). */
  ticksLeft: number
  /** Remaining transit ticks — preserved through a stun. */
  transitTicksLeft: number
  stunTicksLeft: number
}

/**
 * Pending announce for the next tick (MOVE-10 pattern): call flashes (public)
 * and accepted in-car presses (rider-exclusive — routed by the `riders`
 * policy, AD-013). Single car (AD-040): `car` is always 1.
 */
type PendingAnnounce =
  | { kind: 'called'; floor: FloorId; car: 1 }
  | { kind: 'pressed'; playerId: string; floor: FloorId; car: 1 }
  | { kind: 'riders'; car: 1 }

export class MovementSim {
  private readonly players = new Map<string, PlayerMoveState>()
  /** The single elevator car (cycle 3.E, AD-040) — the east landing. */
  private readonly car: CarState = {
    floor: 'lobby',
    riders: [],
    phase: 'idle',
    ticksLeft: 0,
    pickup: null,
    queue: [],
    pendingBoarders: [],
  }
  private callQueue: QueuedCall[] = []
  private announced: PendingAnnounce[] = []
  /** Intent-time events (AD-025 explicit boarding) flushed at the next tick. */
  private pendingEvents: MovementEvent[] = []
  /** The car's rider list changed since the last tick — one coalesced
   * `elevator:riders` at tick start (AD-013). */
  private ridersDirty = false
  /** The stairwell's occupants (cycle 3.E, AD-040): per-player stairs state.
   *  The interior is a black box — occupants are floorless (no stream, no
   *  floor snapshots, no spectator baseline rows) until they arrive. */
  private readonly stairs = new Map<string, StairsState>()

  // --- roster / lifecycle -------------------------------------------------

  /**
   * Fresh-joiner placement (FR-2 "spawn"): lobby center, facing right.
   * Cycle 3.1: guest NPCs join with `{ kind: 'guest' }` and an optional
   * deterministic spawn placement (`floor` + `xMilli` — the desk queue slots
   * and the room-door re-entry on checkout). Every walk/elevator rule
   * (AD-011…027) applies identically to both kinds.
   */
  join(
    playerId: string,
    opts?: { kind?: 'player' | 'guest'; floor?: FloorId; xMilli?: number },
  ): void {
    this.players.set(playerId, {
      kind: opts?.kind ?? 'player',
      floor: opts?.floor ?? 'lobby',
      x: opts?.xMilli ?? HALL_MAX_MILLI / 2,
      facing: 'right',
      moving: null,
      inCar: null,
      facingDirty: false,
      pendingExit: null,
    })
  }

  leave(playerId: string): void {
    this.players.delete(playerId)
    this.stairs.delete(playerId) // FR-25: the stairwell state dies with the seat
    const car = this.car
    if (car.pendingBoarders.includes(playerId)) {
      car.pendingBoarders = car.pendingBoarders.filter((b) => b !== playerId)
    }
    if (car.riders.includes(playerId)) {
      car.riders = car.riders.filter((r) => r !== playerId)
      this.markRidersDirty() // disconnect-dirty flush: one update next tick
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
   * own-floor filtered (AD-008/AD-009). Guests are excluded (they ride the
   * guest:moved stream / snapshot `guests` rows — never player rows).
   */
  allPositions(): { playerId: string; floor: FloorId; x: number }[] {
    return [...this.players.entries()]
      .filter(
        ([playerId, p]) => p.inCar === null && p.kind === 'player' && !this.stairs.has(playerId),
      )
      .map(([playerId, p]) => ({ playerId, floor: p.floor, x: p.x / MILLI }))
  }

  /** Standing + riding guest NPC ids (cycle 3.1) — the round-end purge list. */
  guestIds(): string[] {
    return [...this.players.entries()].filter(([, p]) => p.kind === 'guest').map(([id]) => id)
  }

  /** The car's public floor — panel data is public everywhere (single car, AD-040). */
  carFloors(): { car: 1; floor: FloorId }[] {
    return [{ car: 1 as const, floor: this.car.floor }]
  }

  /** Queue a rider-list update for the next tick — coalesced (AD-013). */
  private markRidersDirty(): void {
    this.ridersDirty = true
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
    // Cycle 3.E (AD-040): stairs occupants are on no floor — direction keys
    // are ignored mid-transit (STAIRS-09) and the breath is immobile
    // (STAIRS-06). The stream stays silent either way.
    if (this.stairs.has(playerId)) return
    if (p.inCar !== null) {
      const car = this.car
      if (car.phase !== 'dwelling') {
        // AD-026: the doors are swinging OPEN — remember the held exit so it
        // applies the tick the doors are fully open (the client sends the
        // intent once per keypress). A hold during `closing` or any shut
        // phase is lost: that hop-off never happens (MOVE-09).
        p.pendingExit = car.phase === 'opening' ? dir : null
        return
      }
      this.exitCar(playerId, dir)
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
  private exitCar(playerId: string, dir: MoveDir): void {
    const car = this.car
    const p = this.players.get(playerId)
    if (p === undefined) return
    p.pendingExit = null
    p.inCar = null
    p.floor = car.floor
    p.x = CAR_LANDING_MILLI
    car.riders = car.riders.filter((r) => r !== playerId)
    this.markRidersDirty() // walk-off: remaining riders get the update
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

  // --- stairs (cycle 3.E, AD-040) -------------------------------------------

  /**
   * Enter the west stairwell toward `dir` — one floor stride per activation.
   * Silent-reject ('ignored') unless the sender is a live player (never a
   * guest), on foot, not already inside, standing at the stairwell mouth
   * (`atStairwellMouth`), and `dir` has an adjacent floor
   * (`stairsDirections`). Entry ends the walk, drops any stale facing event,
   * and publishes ONLY the `player:left-floor` departure (STAIRS-07) on the
   * next tick (MOVE-10). The room answers with a personal snapshot (T5).
   */
  enterStairs(playerId: string, dir: 'up' | 'down'): 'entered' | 'ignored' {
    const p = this.players.get(playerId)
    if (p === undefined || p.kind !== 'player') return 'ignored'
    if (p.inCar !== null || this.stairs.has(playerId)) return 'ignored'
    if (!atStairwellMouth(p.x / MILLI)) return 'ignored'
    if (!stairsDirections(p.floor).includes(dir)) return 'ignored'
    const step = dir === 'up' ? 1 : -1
    const to = FLOOR_IDS[FLOOR_IDS.indexOf(p.floor) + step] as FloorId
    p.moving = null
    p.facingDirty = false // interior silence: no stale event may publish
    p.pendingExit = null
    this.stairs.set(playerId, {
      from: p.floor,
      to,
      dir: step,
      phase: 'transit',
      ticksLeft: STAIRS_TRANSIT_TICKS,
      transitTicksLeft: STAIRS_TRANSIT_TICKS,
      stunTicksLeft: 0,
    })
    this.pendingEvents.push({ type: 'player:left-floor', playerId, floor: p.floor })
    return 'entered'
  }

  /** Read-only view of one player's stairs state (tests / the room snapshot). */
  stairsStateOf(playerId: string): StairsState | undefined {
    const st = this.stairs.get(playerId)
    return st === undefined ? undefined : { ...st }
  }

  /** Advance every stairs occupant's phase clock one tick. (T4 wires the
   *  stun/ambush checks here; arrival and breath emit nothing — the interior
   *  is silent by design.) */
  private tickStairs(_events: MovementEvent[]): void {
    for (const [playerId, st] of this.stairs) {
      if (st.phase === 'transit') {
        st.ticksLeft--
        if (st.ticksLeft > 0) continue
        // Arrival: place at the destination mouth; the arrival floor's stream
        // resumes NEXT tick via facingDirty (mirrors exitCar) — the arrival
        // itself emits no dedicated event (design: sameFloor self-visibility).
        const p = this.players.get(playerId)
        if (p === undefined) {
          this.stairs.delete(playerId)
          continue
        }
        p.floor = st.to
        p.x = 0
        p.facingDirty = true
        st.phase = 'breath'
        st.ticksLeft = STAIRS_BREATH_TICKS
      } else if (st.phase === 'breath') {
        st.ticksLeft--
        if (st.ticksLeft <= 0) this.stairs.delete(playerId) // free to act again
      }
      // 'stunned' ticks with the ambush authority (cycle 3.E T4).
    }
  }

  // --- elevator calls and in-car presses ------------------------------------

  /**
   * Call the car to the caller's floor — destination-free (AD-014): the call
   * carries no target; the destination is chosen inside the car via
   * `elevator:press`. SINGLE CAR (cycle 3.E, AD-040): every two-car choice
   * predicate (AD-019/AD-023 closest-landing, empty-idle draft, both-parked)
   * collapses — the one car is the only candidate. Returns why the call ended
   * as it did:
   * - 'dispatched': the car was dispatched (60-tick arrival begins now) or
   *   the call was queued sim-level FIFO (the car busy)
   * - 'ignored': duplicate call — duplicate predicate = pickup floor ONLY
   *   (AD-012 narrowed): the car already en route to (or queued for) the
   *   pickup, a queued call for the pickup, or parked at the pickup with
   *   nothing pending (a mid-hall parked-car flash — boarding through the
   *   landing press is how a parked car moves). The panel still flashes.
   * - 'rejected': caller in a car (AD-011: elevators run in BOTH phases)
   */
  callElevator(playerId: string): 'dispatched' | 'ignored' | 'rejected' {
    const caller = this.players.get(playerId)
    // Cycle 3.E (AD-040): a stairs occupant is on no floor — the call channel
    // is shut inside the black box (STAIRS-07's silence outranks the call).
    if (caller === undefined || caller.inCar !== null || this.stairs.has(playerId)) {
      return 'rejected'
    }
    const car = this.car
    const pickup = caller.floor
    // AD-025: a caller standing at the landing whose car stands at their floor
    // is BOARDING, not calling — the press outranks the duplicate/queue
    // handling below. AMENDED by AD-026: boarding through the doors requires
    // them fully open. A `dwelling` car admits the presser immediately; a
    // car with shut or swinging doors (idle/opening/closing) queues the
    // presser as a pending boarder and swings the doors open (0.5 s) — the
    // board lands the tick the doors finish opening. Nothing is dispatched;
    // the flash acknowledges. A full car declines the board silently.
    const atLanding =
      Math.abs(caller.x - CAR_LANDING_MILLI) <= TUNING.ELEVATOR_LANDING_TILES * MILLI
    if (atLanding) {
      // AD-027: the caller's car is EITHER standing here (floor match) OR
      // arriving to this floor (the pickup they summoned it for) — either
      // way the press is a boarding commitment through the doors.
      const calledHere = car.floor === pickup || (car.phase === 'arriving' && car.pickup === pickup)
      if (calledHere) {
        if (car.phase === 'dwelling') {
          this.boardPlayer(playerId)
          this.announce({ kind: 'called', floor: pickup, car: 1 })
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
            if (car.phase === 'idle') this.pendingEvents.push(this.openDoors())
          }
          this.announce({ kind: 'called', floor: pickup, car: 1 })
          return 'ignored'
        }
      }
    }
    const duplicating =
      (car.phase === 'arriving' && car.pickup === pickup) ||
      (car.phase === 'riding' && car.queue.includes(pickup))
    if (duplicating) {
      this.announce({ kind: 'called', floor: pickup, car: 1 })
      return 'ignored'
    }
    if (this.callQueue.some((q) => q.pickup === pickup)) {
      this.announce({ kind: 'called', floor: pickup, car: 1 })
      return 'ignored'
    }
    // A caller standing at the landing pins the call to the car (AD-023's
    // single-candidate degenerate): dispatched when idle, queued when busy —
    // it is served when the car frees.
    if (atLanding) {
      if (car.phase === 'idle') {
        this.dispatch(pickup)
        this.announce({ kind: 'called', floor: pickup, car: 1 })
        return 'dispatched'
      }
      this.callQueue.push({ playerId, pickup })
      return 'dispatched'
    }
    // Mid-hall caller: AD-019 policy, degenerate single-car form — a car
    // stopped at the pickup floor with no departure pending is excluded from
    // dispatch candidacy, and with no other car the call is the decoy flash.
    // (AD-026: a `dwelling` car with a queued floor is NOT parked — it
    // departs when its stop ends.)
    const parked =
      (car.phase === 'idle' || (car.phase === 'dwelling' && car.queue.length === 0)) &&
      car.floor === pickup
    if (parked) {
      this.announce({ kind: 'called', floor: pickup, car: 1 })
      return 'ignored'
    }
    if (car.phase === 'idle') {
      this.dispatch(pickup)
      this.announce({ kind: 'called', floor: pickup, car: 1 })
      return 'dispatched'
    }
    // The car is busy: the call waits in the FIFO and is served when the car
    // frees. Its panel flash happens at dispatch time, not now.
    this.callQueue.push({ playerId, pickup })
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
    const car = this.car
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
      this.pendingEvents.push(this.openDoors())
      return 'accepted'
    }
    car.queue.push(floor)
    // Guest presses are NOT announced: `elevator:pressed` is rider testimony
    // naming a player (AD-013); guests are weather (cycle 3.1). The press
    // still queues, and the queue rides `elevator:riders`/snapshots.
    if (p.kind === 'player') this.announce({ kind: 'pressed', playerId, floor, car: 1 })
    // A press into an idling car departs it immediately (ELR P2 AC5): the
    // parked doors are shut (AD-026), so the car leaves without opening.
    if (car.phase === 'idle') this.departRiding()
    return 'accepted'
  }

  /** Queue the panel flash for the next tick, naming the serving car (MOVE-10). */
  private announce(entry: PendingAnnounce): void {
    this.announced.push(entry)
  }

  private dispatch(pickup: FloorId): void {
    const car = this.car
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
  private openDoors(): MovementEvent {
    const car = this.car
    car.phase = 'opening'
    car.ticksLeft = DOOR_TICKS
    return { type: 'elevator:doors', car: 1, floor: car.floor, open: true }
  }

  /**
   * AD-027: begin the closing swing (0.5 s) — the car has a call to attend
   * (a queued ride or a waiting hall call it can serve from another floor).
   * The departure/dispatch itself lands at the swing's end.
   */
  private closeDoors(): MovementEvent {
    const car = this.car
    car.phase = 'closing'
    car.ticksLeft = DOOR_TICKS
    return { type: 'elevator:doors', car: 1, floor: car.floor, open: false }
  }

  /**
   * AD-027: a waiting hall call THIS car can serve from a DIFFERENT floor.
   * Calls for the car's own floor are NOT attendable from here — the caller
   * boards through the open doors.
   */
  private attendableCall(): QueuedCall | undefined {
    const car = this.car
    const idx = this.callQueue.findIndex((q) => q.pickup !== car.floor)
    return idx === -1 ? undefined : this.callQueue[idx]
  }

  /** Depart toward the oldest queued floor (queue non-empty at every call site). */
  private departRiding(): void {
    const car = this.car
    const target = car.queue[0]
    if (target === undefined) throw new Error('depart with empty queue: car 1')
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
    cars: { car: 1; floor: FloorId }[]
    cardedRooms: readonly RoomIndex[]
    guests?: { guestId: string; floor: FloorId; x: number }[]
  } {
    const guests = [...this.players.entries()].filter(
      ([, p]) => p.kind === 'guest' && p.floor === floor && p.inCar === null,
    )
    return {
      players: [...this.players.entries()]
        .filter(
          ([playerId, p]) =>
            p.kind === 'player' &&
            p.floor === floor &&
            p.inCar === null &&
            !this.stairs.has(playerId),
        )
        .map(([playerId, p]) => ({ playerId, floor: p.floor, x: p.x / MILLI })),
      cars: [{ car: 1 as const, floor: this.car.floor }],
      cardedRooms: [...cardedRooms],
      // Present ONLY when non-empty: floor snapshots without guests keep the
      // exact pre-3.1 shape (existing payloads byte-identical).
      ...(guests.length > 0
        ? {
            guests: guests.map(([guestId, p]) => ({
              guestId,
              floor: p.floor,
              x: p.x / MILLI,
            })),
          }
        : {}),
    }
  }

  /**
   * THE personal snapshot (AD-013; join and buzzer resync): the single home
   * of the rider-vs-floor policy. A rider's snapshot carries an EMPTY players
   * list (no floor stream in a car, AD-009 — this also fixes the AD-009 rider
   * leak), the car's public floor (panels stay public), and the car's
   * occupants + press queue. A non-rider falls back to the byte-identical
   * floor snapshot — occupancy never appears. Callers never branch.
   */
  snapshotFor(
    playerId: string,
    cardedRooms: readonly RoomIndex[] = [],
  ): {
    players: { playerId: string; floor: FloorId; x: number }[]
    cars: { car: 1; floor: FloorId }[]
    cardedRooms: readonly RoomIndex[]
    guests?: { guestId: string; floor: FloorId; x: number }[]
    carOccupants?: {
      car: 1
      riders: string[]
      queue: FloorId[]
      guests?: string[]
    }
    stairs?: MovementSnapshotStairs
  } {
    const p = this.players.get(playerId)
    if (p === undefined) return this.snapshotForFloor('lobby', cardedRooms)
    if (p.inCar !== null) {
      const car = this.car
      const carGuests = car.riders.filter((rid) => this.players.get(rid)?.kind === 'guest')
      return {
        players: [],
        cars: [{ car: 1 as const, floor: car.floor }],
        // A rider's card set is empty: cards are floor knowledge and riders
        // have no floor while in a car (AD-009).
        cardedRooms: [],
        carOccupants: {
          car: 1,
          riders: car.riders.filter((rid) => this.players.get(rid)?.kind === 'player'),
          queue: [...car.queue],
          // GUEST-07: guests are public NPCs and count toward capacity — rider
          // knowledge includes them. Absent when no guests are aboard.
          ...(carGuests.length > 0 ? { guests: carGuests } : {}),
        },
      }
    }
    // Cycle 3.E (AD-040): a stairs occupant's own snapshot is the floorless
    // black-box shape plus their own stairs row (self-legitimate knowledge) —
    // present in every phase (transit, breath, stunned), absent otherwise.
    const st = this.stairs.get(playerId)
    if (st !== undefined) {
      return {
        players: [],
        cars: [{ car: 1 as const, floor: this.car.floor }],
        cardedRooms: [],
        stairs: {
          from: st.from,
          to: st.to,
          phase: st.phase,
          remainingSeconds:
            st.phase === 'stunned' ? st.stunTicksLeft / TICK_HZ : st.ticksLeft / TICK_HZ,
        },
      }
    }
    return this.snapshotForFloor(p.floor, cardedRooms)
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
    car: 1 | null
    x: number | null
  } {
    const p = this.players.get(playerId)
    if (p === undefined) return { floor: null, roomKey: null, car: null, x: null }
    if (p.inCar !== null) return { floor: null, roomKey: null, car: p.inCar, x: null }
    // Cycle 3.E (AD-040): stairs occupants are floorless — the interior is a
    // black box, so no sameFloor/room/earshot routing can see them.
    if (this.stairs.has(playerId)) return { floor: null, roomKey: null, car: null, x: null }
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
    if (this.ridersDirty) {
      this.ridersDirty = false
      const car = this.car
      const guests = car.riders.filter((rid) => this.players.get(rid)?.kind === 'guest')
      events.push({
        type: 'elevator:riders',
        car: 1,
        riders: car.riders.filter((rid) => this.players.get(rid)?.kind === 'player'),
        queue: [...car.queue],
        // GUEST-07: present only when guests are aboard (pre-3.1 payloads
        // keep their exact shape).
        ...(guests.length > 0 ? { guests } : {}),
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

    this.tickStairs(events)
    this.tickCars(events)
    return events
  }

  private tickCars(events: MovementEvent[]): void {
    const car = this.car
    if (car.phase === 'idle') {
      // Parked with the doors SHUT (AD-026): nobody boards or hops off a
      // parked car — the landing call press (or an in-car current-floor
      // press) reopens the doors.
      return
    }
    if (car.phase === 'arriving') {
      car.ticksLeft--
      if (car.ticksLeft > 0) return
      // Arrived at the pickup floor: the doors begin their 0.5 s opening
      // swing (AD-026) — the public `elevator:moved` announces the stop.
      // Riders stay aboard — arrival never auto-exits anyone (AD-014), and
      // the caller boards through the doors once they finish opening
      // (AD-025/AD-026).
      car.floor = car.pickup as FloorId
      car.pickup = null
      events.push({ type: 'elevator:moved', car: 1, floor: car.floor })
      events.push(this.openDoors())
      this.syncRiderFloors()
      return
    }
    if (car.phase === 'opening') {
      // Opening swing countdown; the doors finish and the 1 s dwell begins
      // with any pending boarders stepping in (AD-026, capacity-checked in
      // press order — a full car declines silently).
      car.ticksLeft--
      if (car.ticksLeft > 0) return
      car.phase = 'dwelling'
      car.ticksLeft = DWELL_TICKS
      for (const boarder of car.pendingBoarders.splice(0)) this.boardPlayer(boarder)
      // Doors fully open: riders who held a direction through the opening
      // swing hop off now (AD-026 pending exits, join order is stable).
      for (const [rid, p] of this.players) {
        if (p.inCar === 1 && p.pendingExit !== null) {
          this.exitCar(rid, p.pendingExit)
        }
      }
      return
    }
    if (car.phase === 'dwelling') {
      // Doors fully open — the only hop window. AD-027: the dwell is the
      // MINIMUM open time (3 s); afterwards the doors STAY OPEN until the
      // car has a call to attend — a queued ride, or a waiting hall call
      // it can serve from another floor. Nothing to attend: keep dwelling.
      if (car.ticksLeft > 0) {
        car.ticksLeft--
        if (car.ticksLeft > 0) return
      }
      if (car.queue.length > 0) {
        // A queued ride: close, then depart at the swing's end. The queue
        // belongs to the car: an empty car still departs and serves (ghost
        // trips, ELR P3 AC3).
        events.push(this.closeDoors())
        return
      }
      if (this.attendableCall() !== undefined) {
        // A waiting hall call from another floor: close, then dispatch to
        // it at the swing's end.
        events.push(this.closeDoors())
        return
      }
      return
    }
    if (car.phase === 'closing') {
      car.ticksLeft--
      if (car.ticksLeft > 0) return
      if (car.queue.length > 0) {
        this.departRiding()
      } else {
        // The close was for a waiting hall call (or a press landed during
        // the swing and changed the picture): serve it, or reopen when the
        // call went away.
        const idx = this.callQueue.findIndex((q) => q.pickup !== car.floor)
        const next = idx === -1 ? undefined : this.callQueue.splice(idx, 1)[0]
        if (next !== undefined) {
          this.dispatch(next.pickup)
          this.announce({ kind: 'called', floor: next.pickup, car: 1 })
        } else {
          events.push(this.openDoors())
        }
      }
      return
    }
    // riding: |Δfloors| × 40 ticks to the oldest queued floor.
    car.ticksLeft--
    if (car.ticksLeft > 0) return
    const served = car.queue.shift() as FloorId
    car.floor = served
    events.push({ type: 'elevator:moved', car: 1, floor: served })
    events.push(this.openDoors())
    this.syncRiderFloors()
  }

  /** Rider floor tracking: a rider's floor follows the car (never evented —
   * riders have no floor stream, AD-008; positionOf bookkeeping only). */
  private syncRiderFloors(): void {
    for (const rid of this.car.riders) {
      const p = this.players.get(rid)
      if (p !== undefined) p.floor = this.car.floor
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
  private boardPlayer(playerId: string): boolean {
    const p = this.players.get(playerId)
    if (p === undefined) return false
    const car = this.car
    if (car.riders.length >= TUNING.ELEVATOR_CAPACITY) return false
    const landing = CAR_LANDING_MILLI
    p.inCar = 1
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
    // `player:left-floor` names a PLAYER's boarding (WORK-19/MOVE-16). A
    // guest boarding is silent — their guest:moved stream simply stops
    // (inference from stream-stop, same as players' silence rule).
    if (p.kind === 'player') {
      this.pendingEvents.push({ type: 'player:left-floor', playerId, floor: car.floor })
    }
    this.markRidersDirty() // AD-013: riders learn the new occupant list
    return true
  }
}

function moved(playerId: string, p: PlayerMoveState): MovementEvent {
  if (p.kind === 'guest') {
    return { type: 'guest:moved', guestId: playerId, floor: p.floor, x: p.x / MILLI }
  }
  return {
    type: 'player:moved',
    playerId,
    floor: p.floor,
    x: p.x / MILLI,
    facing: p.facing,
  }
}
