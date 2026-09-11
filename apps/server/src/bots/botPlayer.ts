import type {
  FloorId,
  GuestFloorId,
  MovementSnapshot,
  Role,
  RoomIndex,
  RoomState,
  RoundEnded,
  RoundRecap,
} from '@turnover/shared'
import { PROTOCOL_REGISTRY, STAIRS_ARRIVAL_X_TILES, TUNING } from '@turnover/shared'

/**
 * AI staff member for the bot smoke (`runSmokeRound.ts`): a protocol-true
 * player whose entire world model is fed by registry messages — exactly what
 * a human client receives, nothing more (message-only hard constraint). The
 * model is a plain mutable record so the pure policies in `policies.ts` can
 * read it and the unit tests can fabricate it.
 */

/** What the bot knows, all of it wire-fed (positions in tiles). */
export interface BotWorld {
  selfId: string
  name: string
  role: Role | null
  phase: 'lobby' | 'round' | 'results'
  isHost: boolean
  roster: readonly string[]
  /** Own kinematics; null floor/x while riding or inside the stairwell box. */
  floor: FloorId | null
  x: number | null
  moving: 'left' | 'right' | null
  /** Own stairwell transit — freeAtMs covers transit + arrival breath. */
  stairs: { to: FloorId; freeAtMs: number } | null
  riding: boolean
  carFloor: FloorId | null
  carDoorsOpen: boolean
  /** Same-floor observations, self included (AD-009 filtered truth). */
  players: Map<string, { floor: FloorId; x: number }>
  queueCount: number
  settledCount: number
  discoveredCount: number
  settledGuests: Set<string>
  assignments: Map<string, { floor: GuestFloorId; room: RoomIndex }>
  resting: Map<string, { floor: FloorId; room: RoomIndex }>
  carriedBy: Map<string, string>
  /** Observed interiors (`floor:room` → state) — room:observed + lifecycle inferences. */
  roomStates: Map<string, RoomState>
  /** Prepped rooms this bot has seen (cards are floor-public, FR-11). */
  cards: Set<string>
  carryGuest: string | null
  work: { floor: GuestFloorId; room: RoomIndex; endsAtMs: number } | null
  roundStartedAtMs: number | null
  shiftSeconds: number
  verdict: RoundEnded | null
  recap: RoundRecap | null
  ambushesLanded: number
  stunsTaken: number
  /** This bot was fired this round — intents would only earn justice errors. */
  fired: boolean
  errors: number
  intentCount: number
  selfMoveCount: number
}

export function newBotWorld(name: string, selfId: string, shiftSeconds: number): BotWorld {
  return {
    selfId,
    name,
    role: null,
    phase: 'lobby',
    isHost: false,
    roster: [],
    floor: null,
    x: null,
    moving: null,
    stairs: null,
    riding: false,
    carFloor: null,
    carDoorsOpen: false,
    players: new Map(),
    queueCount: 0,
    settledCount: 0,
    discoveredCount: 0,
    settledGuests: new Set(),
    assignments: new Map(),
    resting: new Map(),
    carriedBy: new Map(),
    roomStates: new Map(),
    cards: new Set(),
    carryGuest: null,
    work: null,
    roundStartedAtMs: null,
    shiftSeconds,
    verdict: null,
    recap: null,
    ambushesLanded: 0,
    stunsTaken: 0,
    fired: false,
    errors: 0,
    intentCount: 0,
    selfMoveCount: 0,
  }
}

export function roomKey(floor: FloorId, room: RoomIndex): string {
  return `${floor}:${room}`
}

/** Round-scoped reset — the results→round transition tears sim state down. */
function resetRoundState(world: BotWorld): void {
  world.assignments.clear()
  world.resting.clear()
  world.carriedBy.clear()
  world.roomStates.clear()
  world.cards.clear()
  world.queueCount = 0
  world.settledCount = 0
  world.discoveredCount = 0
  world.settledGuests.clear()
  world.carryGuest = null
  world.work = null
  world.stairs = null
  world.riding = false
  world.verdict = null
  world.recap = null
  world.fired = false
  world.roundStartedAtMs = Date.now()
}

/**
 * Apply one unwrapped registry payload to the model. `type` is the Colyseus
 * wire name; `payload` is the envelope's inner payload (no type literal).
 * Exported for the policy unit tests.
 */
export function applyMessage(
  world: BotWorld,
  type: string,
  payload: unknown,
  nowMs: number = Date.now(),
): void {
  switch (type) {
    case 'lobby:snapshot': {
      const snap = payload as { ownId: string; isHost: boolean; roster: { id: string }[] }
      world.selfId = snap.ownId
      world.isHost = snap.isHost
      world.roster = snap.roster.map((r) => r.id)
      return
    }
    case 'round:started':
      world.phase = 'round'
      resetRoundState(world)
      return
    case 'role:dealt':
      world.role = (payload as { role: Role }).role
      return
    case 'round:ended':
      world.phase = 'results'
      world.verdict = payload as RoundEnded
      return
    case 'round:recap':
      world.recap = payload as RoundRecap
      return
    case 'movement:snapshot': {
      const snap = payload as MovementSnapshot
      if (snap.stairs !== undefined) {
        world.stairs = {
          to: snap.stairs.to,
          freeAtMs: nowMs + (snap.stairs.remainingSeconds + TUNING.STAIRS_BREATH_SECONDS) * 1000,
        }
        world.floor = null
        world.x = null
        world.moving = null
        return
      }
      const self = snap.players.find((p) => p.playerId === world.selfId)
      if (self !== undefined) {
        world.floor = self.floor
        world.x = self.x
        world.stairs = null
      }
      world.riding = snap.carOccupants !== undefined
      if (world.riding) {
        // Riders are floorless (AD-008) — the exit snapshot is the way back.
        world.floor = null
        world.x = null
        world.moving = null
      }
      world.players = new Map(snap.players.map((p) => [p.playerId, { floor: p.floor, x: p.x }]))
      // Own-floor public rows (cards, resting suitcases) — AD-009 filtered.
      const ownFloor = self?.floor
      if (ownFloor !== undefined) {
        for (const room of snap.cardedRooms) world.cards.add(roomKey(ownFloor, room))
      }
      for (const sc of snap.suitcases ?? []) {
        world.resting.set(sc.guestId, { floor: sc.floor, room: sc.room })
      }
      return
    }
    case 'player:moved': {
      const moved = payload as { playerId: string; floor: FloorId; x: number }
      world.players.set(moved.playerId, { floor: moved.floor, x: moved.x })
      if (moved.playerId === world.selfId) {
        world.floor = moved.floor
        world.x = moved.x
        world.selfMoveCount += 1
      }
      return
    }
    case 'player:left-floor': {
      const left = (payload as { playerId: string }).playerId
      world.players.delete(left)
      if (left === world.selfId) {
        // Own boarding/departure (WORK-19): floorless until the exit snapshot.
        world.floor = null
        world.x = null
        world.moving = null
      }
      return
    }
    case 'elevator:moved':
      world.carFloor = (payload as { floor: FloorId }).floor
      return
    case 'elevator:doors': {
      const doors = payload as { floor: FloorId; open: boolean }
      world.carFloor = doors.floor
      world.carDoorsOpen = doors.open
      return
    }
    case 'elevator:riders':
      // Riders policy: receiving this at all proves the bot is aboard (AD-013).
      world.riding = true
      return
    case 'guest:arrived':
      world.queueCount += 1
      return
    case 'guest:self_assigned': {
      const guest = payload as { guestId: string; floor: GuestFloorId; room: RoomIndex }
      world.queueCount -= 1
      world.assignments.set(guest.guestId, { floor: guest.floor, room: guest.room })
      return
    }
    case 'guest:assigned': {
      const guest = payload as { guestId: string; floor: GuestFloorId; room: RoomIndex }
      world.queueCount -= 1
      world.assignments.set(guest.guestId, { floor: guest.floor, room: guest.room })
      return
    }
    case 'guest:settled':
      world.settledCount += 1
      world.settledGuests.add((payload as { guestId: string }).guestId)
      return
    case 'guest:checked_out': {
      const guest = payload as { guestId: string; floor: FloorId; room: RoomIndex }
      world.settledCount -= 1
      world.settledGuests.delete(guest.guestId)
      // Checkout churn: the room re-trashes as `settled` (work.ts spawn half
      // of FR-32) — building-wide knowledge via the guest lifecycle line.
      world.roomStates.set(roomKey(guest.floor, guest.room), 'settled')
      return
    }
    case 'guest:discovered':
      world.discoveredCount += 1
      return
    case 'guest:left': {
      const gone = (payload as { guestId: string }).guestId
      world.settledGuests.delete(gone)
      world.assignments.delete(gone)
      world.resting.delete(gone)
      return
    }
    case 'suitcase:carried':
    case 'suitcase:picked_up': {
      const carry = payload as { guestId: string; carrierId: string }
      world.carriedBy.set(carry.guestId, carry.carrierId)
      if (carry.carrierId === world.selfId) world.carryGuest = carry.guestId
      return
    }
    case 'suitcase:placed': {
      const placed = payload as { guestId: string; floor: FloorId; room: RoomIndex }
      world.resting.set(placed.guestId, { floor: placed.floor, room: placed.room })
      world.carriedBy.delete(placed.guestId)
      if (world.carryGuest === placed.guestId) world.carryGuest = null
      return
    }
    case 'room:observed': {
      const observed = payload as { floor: FloorId; room: RoomIndex; state: RoomState }
      world.roomStates.set(roomKey(observed.floor, observed.room), observed.state)
      if (observed.state === 'prepped') world.cards.add(roomKey(observed.floor, observed.room))
      return
    }
    case 'room:carded':
    case 'room:prepped': {
      const room = payload as { floor: FloorId; room: RoomIndex }
      world.roomStates.set(roomKey(room.floor, room.room), 'prepped')
      world.cards.add(roomKey(room.floor, room.room))
      return
    }
    case 'room:trashed': {
      const room = payload as { floor: FloorId; room: RoomIndex }
      world.roomStates.set(roomKey(room.floor, room.room), 'trashed')
      return
    }
    case 'work:started': {
      const started = payload as {
        floor: GuestFloorId
        room: RoomIndex
        seconds: number
      }
      world.work = {
        floor: started.floor,
        room: started.room,
        endsAtMs: nowMs + started.seconds * 1000 + 250,
      }
      return
    }
    case 'work:ended':
      world.work = null
      return
    case 'stairs:ambushed': {
      const ambush = payload as { stunSeconds: number }
      world.stunsTaken += 1
      if (world.stairs !== null) world.stairs.freeAtMs += ambush.stunSeconds * 1000
      return
    }
    case 'stairs:ambush':
      world.ambushesLanded += 1
      return
    case 'player:fired': {
      const fired = payload as { playerId: string }
      world.players.delete(fired.playerId)
      if (fired.playerId === world.selfId) {
        // The teardown cancels the channel silently (WORK-12) and drops the
        // carry; mirroring that lets the policy idle instead of re-sending
        // intents the room now answers with justice errors.
        world.fired = true
        world.work = null
        world.carryGuest = null
        world.moving = null
      }
      return
    }
    case 'error':
      world.errors += 1
      return
    default:
      return
  }
}

/**
 * The intents a policy may emit — exactly the wire shapes of
 * `packages/shared/src/protocol/intents.ts`, never a new message.
 */
export type BotIntent =
  | { type: 'move:start'; dir: 'left' | 'right' }
  | { type: 'move:stop' }
  | { type: 'elevator:call' }
  | { type: 'elevator:press'; floor: FloorId }
  | { type: 'stairs:enter'; dir: 'up' | 'down' }
  | { type: 'work:start'; floor: GuestFloorId; room: RoomIndex }
  | { type: 'desk:interact' }
  | { type: 'suitcase:place'; room: RoomIndex }
  | { type: 'suitcase:pickup' }

/** A minimal slice of the Colyseus client room — keeps the module testable. */
export interface BotRoom {
  readonly sessionId: string
  /** The Colyseus roomId — for TurnoverRoom this is the 4-letter share code. */
  readonly roomId: string
  send(type: string, payload: unknown): void
  onMessage(type: string, handler: (envelope: unknown) => void): unknown
  leave(): Promise<void>
}

/**
 * One AI staff member: owns the wire-fed model, drives the injected policy on
 * an interval, and mirrors its own hold-to-walk state so policies re-issue
 * movement intents only on change (the wire intents are hold-to-walk).
 */
export class BotPlayer {
  readonly world: BotWorld
  private readonly room: BotRoom
  private readonly decide: (world: BotWorld, nowMs: number) => BotIntent | null
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly trace: boolean

  constructor(
    room: BotRoom,
    opts: {
      name: string
      shiftSeconds: number
      decide: (world: BotWorld, nowMs: number) => BotIntent | null
      trace?: boolean
    },
  ) {
    this.room = room
    this.decide = opts.decide
    this.trace = opts.trace === true
    this.world = newBotWorld(opts.name, room.sessionId, opts.shiftSeconds)
  }

  /** Subscribe to every registry message the policy layer consumes. The
   *  wire names are DERIVED from PROTOCOL_REGISTRY — a new registry row is
   *  audible to bots by construction, never a hand-copied list to forget.
   *  `error` is the one server→client name outside the registry. */
  listen(): void {
    const names: readonly string[] = [...Object.keys(PROTOCOL_REGISTRY), 'error']
    for (const name of names) {
      this.room.onMessage(name, (envelope: unknown) => {
        const payload = (envelope as { payload: unknown }).payload
        applyMessage(this.world, name, payload)
      })
    }
  }

  start(intervalMs = 120): void {
    this.stop()
    this.timer = setInterval(() => this.tick(), intervalMs)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One decision step — exported loop body, also driven directly by tests. */
  tick(nowMs: number = Date.now()): void {
    const world = this.world
    // Arrival self-placement: the stairwell black box releases onto the
    // destination mouth (transit + breath), and the wire stays silent about
    // it — the mirror shares the sim's own constants.
    if (world.stairs !== null && nowMs >= world.stairs.freeAtMs) {
      world.floor = world.stairs.to
      world.x = STAIRS_ARRIVAL_X_TILES
      world.moving = null
      world.stairs = null
    }
    if (world.phase !== 'round' || world.role === null) return
    if (world.fired) return
    if (world.work !== null && nowMs < world.work.endsAtMs) return
    const intent = this.decide(world, nowMs)
    if (intent === null) return
    this.world.intentCount += 1
    if (intent.type === 'move:start') world.moving = intent.dir
    if (intent.type === 'move:stop') world.moving = null
    if (this.trace) {
      console.log(
        `[intent] ${world.name} t=${Math.round(nowMs / 1000) % 1000} ${JSON.stringify(intent)} ` +
          `at=${world.floor}@${world.x} selfMoves=${world.selfMoveCount} work=${world.work !== null ? `${world.work.floor}:${world.work.room}` : '-'}`,
      )
    }
    this.room.send(intent.type, intent)
  }

  /** One-line state dump for stall reports. */
  describe(): string {
    const w = this.world
    const pos =
      w.stairs !== null ? `stairs→${w.stairs.to}` : w.riding ? 'riding' : `${w.floor}@${w.x}`
    return `${w.name} role=${w.role} phase=${w.phase} pos=${pos} intents=${w.intentCount} errors=${w.errors}`
  }
}
