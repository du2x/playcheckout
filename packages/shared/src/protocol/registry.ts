import type {
  CarId,
  ElevatorCalled,
  ElevatorDoors,
  ElevatorMoved,
  ElevatorPressed,
  ElevatorRiders,
  FloorId,
  GuestAngered,
  GuestArrived,
  GuestAssigned,
  GuestCheckedOut,
  GuestComplained,
  GuestDiscovered,
  GuestImpatient,
  GuestLeft,
  GuestMoved,
  GuestSelfAssigned,
  GuestSettled,
  IntentError,
  LobbySnapshot,
  MovementSnapshot,
  PlayerFired,
  PlayerLeft,
  PlayerLeftFloor,
  PlayerMoved,
  RoleDealt,
  RoomCarded,
  RoomEntered,
  RoomIndex,
  RoomObserved,
  RoomPrepped,
  RoomRustle,
  RoomSettled,
  RoomTenancy,
  RoomTrashed,
  RoundBuzzer,
  RoundEnded,
  RoundRecap,
  RoundResumed,
  RoundStarted,
  SpectatorSnapshot,
  StairsAmbush,
  StairsAmbushed,
  SuitcaseCarried,
  SuitcasePickedUp,
  SuitcasePlaced,
  WorkEnded,
  WorkStarted,
} from './messages.js'
import type { MovementEvent, SimEvent } from './simEvents.js'

/**
 * The protocol registry (cycle 2.3, AD-006): every server→client message type is
 * declared exactly ONCE — wire name, payload type, and recipient policy. This
 * file is the audit surface for turnover-protocol rule 5: hidden information is
 * the product, and who may receive what is declared here, not grepped.
 *
 * Client→server intents are NOT part of the registry (they stay zod-validated
 * in the room's `validate()` handlers). The registry is the only catalog of
 * server→client messages; `envelope.ts` and the drift-prone broadcast/private
 * unions were deleted in this cycle.
 */

/**
 * Closed recipient-policy enum. Extended deliberately, never speculatively:
 * `sameFloor` (AD-008/AD-009) delivers to live viewers on the event's floor;
 * `occupants` (cycle 2.5) delivers to viewers inside the event's room segment;
 * `riders` (cycle 2-6, AD-013) delivers ONLY to viewers riding the event's car
 * — occupancy and press knowledge belongs exclusively to the people inside.
 */
export type RecipientPolicy = 'all' | 'self' | 'sameFloor' | 'occupants' | 'riders' | 'earshot'

/**
 * Positional selector a projection returns for the positional policies: the
 * event's floor (`sameFloor`), its room-segment key (`occupants`), or the car
 * it happened in (`riders`).
 */
export interface EventVisibility {
  readonly floor?: FloorId
  /** `\`${floor}:${room}\`` — the occupants key the Router matches against. */
  readonly roomKey?: string
  /** Which car the event concerns — the riders key the Router matches against. */
  readonly car?: CarId
  /** Which room segment the event concerns — the earshot range the Router matches against. */
  readonly room?: RoomIndex
}

/**
 * The envelope the Router stamps on every server→client message. `seq` is
 * per-connection, monotonic, starting at 1; `time` is server `Date.now()` in ms.
 * The Colyseus wire name is the only type tag — payloads carry no `type` field.
 */
export interface Envelope<P = unknown> {
  readonly seq: number
  readonly time: number
  readonly payload: P
}

/** Wire payload type per registry key. */
export interface Payloads {
  /** server → one player. Personal snapshot on join and every roster change. */
  'lobby:snapshot': LobbySnapshot
  /** server → all players (broadcast). Round begin; ids only — no roles. */
  'round:started': RoundStarted
  /** server → exactly one player, private. The recipient's own role card (FR-2). */
  'role:dealt': RoleDealt
  /** server → all players (broadcast). Shift clock expired. */
  'round:buzzer': RoundBuzzer
  /** server → one player. Intent rejection reason (join errors use Colyseus join rejection). */
  error: IntentError
  // --- Movement (cycle 2.4): own-floor visibility (AD-008/AD-009); cars never
  // name occupants (FR-6); panels remain public ---
  /** server → same-floor viewers. A player's position/floor/facing changed this tick. */
  'player:moved': PlayerMoved
  /** server → same-floor viewers (cycle 3.1). A guest NPC's public position. */
  'guest:moved': GuestMoved
  /** server → all players (cycle 3.1). A guest NPC arrived at the desk queue. */
  'guest:arrived': GuestArrived
  /** server → all players (cycle 3.1). The guest's free impatience cue fires. */
  'guest:impatient': GuestImpatient
  /** server → all players (cycle 3.1). The guest self-assigned a vacant room. */
  'guest:self_assigned': GuestSelfAssigned
  /** server → all players (cycle 3.1). The guest entered and settled. */
  'guest:settled': GuestSettled
  /** server → all players (cycle 3.1). The guest checked out — room re-trashes. */
  'guest:checked_out': GuestCheckedOut
  /** server → all players (cycle 3.1). The guest walked out of the hotel. */
  'guest:left': GuestLeft
  // --- Suitcase transport (cycle 3.B, AD-032) ---
  /** server → all players. The guest's room assignment, announced building-wide once (AD-034). */
  'guest:assigned': GuestAssigned
  /** server → all players. Check-in handoff lifecycle fact (no room named). */
  'suitcase:carried': SuitcaseCarried
  /** server → same-floor viewers. A suitcase rests at a doorway — silent, no walkie line. */
  'suitcase:placed': SuitcasePlaced
  /** server → all players. Pickup lifecycle fact (fresh carry leg). */
  'suitcase:picked_up': SuitcasePickedUp
  /** server → all players. Wrong-delivery door complaint (FR-29(a)) — counts
   *  toward nothing since v1.5 (AD-039). */
  'guest:complained': GuestComplained
  /** server → same-floor viewers. The FR-29(b) anger cue at the room —
   *  room-number level, no detail, no actor (cycle 3.3). */
  'guest:angered': GuestAngered
  /** server → all players. The FR-29(b) desk report — the ONLY budget-counting
   *  complaint (FR-31, cycle 3.3). */
  'guest:discovered': GuestDiscovered
  /** server → same-floor viewers. Tenancy flip-sign per guest door (FR-33, cycle 3.4). */
  'room:tenancy': RoomTenancy
  /** server → all players. A call was registered (incl. decoy flashes, FR-5). */
  'elevator:called': ElevatorCalled
  /** server → all players. A car's floor changed. */
  'elevator:moved': ElevatorMoved
  /** server → all players. Public door state: the doors began opening (open) or
   *  began closing to attend a call (AD-026/027). */
  'elevator:doors': ElevatorDoors
  /** server → the car's riders ONLY. A rider pressed a floor in-car (AD-013). */
  'elevator:pressed': ElevatorPressed
  /** server → the car's riders ONLY. The car's occupants + press queue (AD-013). */
  'elevator:riders': ElevatorRiders
  /** server → the ambushed staff member ONLY (cycle 3.E, AD-040). Anonymous —
   *  never names the saboteur. */
  'stairs:ambushed': StairsAmbushed
  /** server → the saboteur ONLY (cycle 3.E, AD-040): their ambush landed. */
  'stairs:ambush': StairsAmbush
  /** server → all players. A player disconnected; remove their rectangle. */
  'player:left': PlayerLeft
  /** server → the departed floor's viewers: drop the rectangle (AD-009). */
  'player:left-floor': PlayerLeftFloor
  /** server → one player. Own-floor movement state on join and at the buzzer (MOVE-18). */
  'movement:snapshot': MovementSnapshot
  // --- Work channels (cycle 2.5): interiors reach only people inside the
  // segment (FR-10); channel events are the actor's private view (FR-9) ---
  /** server → the actor. Their channel began (prep, un-prep, or fake — indistinguishable). */
  'work:started': WorkStarted
  /** server → the actor. Their channel ended (completed or cancelled). */
  'work:ended': WorkEnded
  /** server → one player. The state of a room they just entered (FR-10 read half). */
  'room:observed': RoomObserved
  /** server → the room's occupants. A prep transition completed (FR-7). */
  'room:prepped': RoomPrepped
  /** server → the room's occupants. An un-prep transition completed (FR-8). */
  'room:trashed': RoomTrashed
  // --- Evidence (cycle 2.7): hallway-visible cues (leak rule 2) ---
  /** server → same-floor viewers. A prep transition completed; the card is hung (FR-11). */
  'room:carded': RoomCarded
  /** server → the room's occupants. The trash aged past the freshness window (FR-12). */
  'room:settled': RoomSettled
  /** server → earshot viewers. Sabotage rustle within RUSTLE_RANGE_TILES through walls (FR-13). */
  'room:rustle': RoomRustle
  /** server → same-floor viewers. A player entered the room's segment (FR-10 cue half). */
  'room:entered': RoomEntered
  // --- Justice (cycle 2.8): firing is public but name-only (FR-18) ---
  /** server → all players. A firing resolved (walk-in or accusation); {playerId} exactly. */
  'player:fired': PlayerFired
  // --- Round end (cycle 2.9, §6.6/§6.7): post-round reveals only ---
  /** server → all players. The round's verdict + traitor reveal (FR-21). */
  'round:ended': RoundEnded
  /** server → all players. The FR-22 recap timeline, right after round:ended. */
  'round:recap': RoundRecap
  /** server → one fired player. The full-world spectator baseline (FR-20). */
  'spectator:snapshot': SpectatorSnapshot
  /** server → one reconnected player. Seat restore: honest clock + cast (FR-25). */
  'round:resumed': RoundResumed
}

export type RegistryKey = keyof Payloads
export type RegistryPayload<K extends RegistryKey> = Payloads[K]

/**
 * A sim event of type K projects into its declared wire payload (+ optional
 * private recipient). Typed per key so a projection returning the wrong payload
 * shape fails to compile.
 */
export type SimProjection<K extends SimEvent['type'] | MovementEvent['type']> = (
  event: Extract<SimEvent | MovementEvent, { type: K }>,
) => {
  payload: RegistryPayload<K>
  self?: string
  visibility?: EventVisibility
}

type Entry<K extends RegistryKey> = {
  readonly payload: RegistryPayload<K>
  readonly recipients: RecipientPolicy
  readonly fromSim: K extends SimEvent['type'] | MovementEvent['type']
    ? SimProjection<K>
    : undefined
}

/**
 * THE registry. Exhaustiveness is structural:
 * - `{ [K in RegistryKey]: Entry<K> }` types every row against its own key.
 * - `& { [K in SimEvent['type']]: unknown }` makes an undeclared sim event a
 *   compile error (spec REG-02) while allowing room-originated keys.
 */
export const PROTOCOL_REGISTRY = {
  'lobby:snapshot': {
    payload: {} as LobbySnapshot,
    recipients: 'self',
    fromSim: undefined,
  },
  'round:started': {
    payload: {} as RoundStarted,
    recipients: 'all',
    // Cast to the declared projection: `satisfies` validates rows, but the
    // const's inferred per-row function types would otherwise drop the optional
    // `self` field and break uniform destructuring in the Router.
    fromSim: ((event) => ({
      payload: { playerIds: event.playerIds },
    })) as SimProjection<'round:started'>,
  },
  'role:dealt': {
    payload: {} as RoleDealt,
    recipients: 'self',
    fromSim: ((event) => ({
      self: event.playerId,
      payload: { role: event.role },
    })) as SimProjection<'role:dealt'>,
  },
  'round:buzzer': {
    payload: {} as RoundBuzzer,
    recipients: 'all',
    fromSim: (() => ({ payload: {} })) as SimProjection<'round:buzzer'>,
  },
  error: {
    payload: {} as IntentError,
    recipients: 'self',
    fromSim: undefined,
  },
  'player:moved': {
    payload: {} as PlayerMoved,
    recipients: 'sameFloor',
    fromSim: ((event) => ({
      payload: {
        playerId: event.playerId,
        floor: event.floor,
        x: event.x,
        facing: event.facing,
      },
      visibility: { floor: event.floor },
    })) as SimProjection<'player:moved'>,
  },
  /** server → same-floor viewers (cycle 3.1). A guest NPC's public position. */
  'guest:moved': {
    payload: {} as GuestMoved,
    recipients: 'sameFloor',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, floor: event.floor, x: event.x },
      visibility: { floor: event.floor },
    })) as SimProjection<'guest:moved'>,
  },
  /** server → all players (cycle 3.1). A guest NPC arrived at the desk queue. */
  'guest:arrived': {
    payload: {} as GuestArrived,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId },
    })) as SimProjection<'guest:arrived'>,
  },
  /** server → all players (cycle 3.1). The guest's free impatience cue fires. */
  'guest:impatient': {
    payload: {} as GuestImpatient,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId },
    })) as SimProjection<'guest:impatient'>,
  },
  /** server → all players (cycle 3.1). The guest self-assigned a vacant room. */
  'guest:self_assigned': {
    payload: {} as GuestSelfAssigned,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, floor: event.floor, room: event.room },
    })) as SimProjection<'guest:self_assigned'>,
  },
  /** server → all players (cycle 3.1). The guest entered and settled. */
  'guest:settled': {
    payload: {} as GuestSettled,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, floor: event.floor, room: event.room },
    })) as SimProjection<'guest:settled'>,
  },
  /** server → all players (cycle 3.1). The guest checked out — room re-trashes. */
  'guest:checked_out': {
    payload: {} as GuestCheckedOut,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, floor: event.floor, room: event.room },
    })) as SimProjection<'guest:checked_out'>,
  },
  /** server → all players (cycle 3.1). The guest walked out of the hotel. */
  'guest:left': {
    payload: {} as GuestLeft,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId },
    })) as SimProjection<'guest:left'>,
  },
  // --- Suitcase transport (cycle 3.B, AD-032; amended AD-034). The
  // assignment is a building-wide notice (AD-034): announced to ALL players
  // at the check-in tick — the saboteur learns it for free, and the contested
  // gameplay is physical interception of the suitcase, not information.
  'guest:assigned': {
    payload: {} as GuestAssigned,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, floor: event.floor, room: event.room },
    })) as SimProjection<'guest:assigned'>,
  },
  'suitcase:carried': {
    payload: {} as SuitcaseCarried,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, carrierId: event.carrierId },
    })) as SimProjection<'suitcase:carried'>,
  },
  'suitcase:placed': {
    payload: {} as SuitcasePlaced,
    recipients: 'sameFloor',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, floor: event.floor, room: event.room },
      visibility: { floor: event.floor },
    })) as SimProjection<'suitcase:placed'>,
  },
  'suitcase:picked_up': {
    payload: {} as SuitcasePickedUp,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, carrierId: event.carrierId },
    })) as SimProjection<'suitcase:picked_up'>,
  },
  'guest:complained': {
    payload: {} as GuestComplained,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, floor: event.floor, room: event.room },
    })) as SimProjection<'guest:complained'>,
  },
  'guest:angered': {
    payload: {} as GuestAngered,
    recipients: 'sameFloor',
    fromSim: ((event) => ({
      payload: { guestId: event.guestId, floor: event.floor, room: event.room },
      visibility: { floor: event.floor },
    })) as SimProjection<'guest:angered'>,
  },
  'guest:discovered': {
    payload: {} as GuestDiscovered,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: {
        guestId: event.guestId,
        floor: event.floor,
        room: event.room,
        fresh: event.fresh,
      },
    })) as SimProjection<'guest:discovered'>,
  },
  'room:tenancy': {
    payload: {} as RoomTenancy,
    recipients: 'sameFloor',
    fromSim: ((event) => ({
      payload: { floor: event.floor, room: event.room, occupied: event.occupied },
      visibility: { floor: event.floor },
    })) as SimProjection<'room:tenancy'>,
  },
  'elevator:called': {
    payload: {} as ElevatorCalled,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { floor: event.floor, car: event.car },
    })) as SimProjection<'elevator:called'>,
  },
  'elevator:moved': {
    payload: {} as ElevatorMoved,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { car: event.car, floor: event.floor },
    })) as SimProjection<'elevator:moved'>,
  },
  'elevator:doors': {
    payload: {} as ElevatorDoors,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { car: event.car, floor: event.floor, open: event.open },
    })) as SimProjection<'elevator:doors'>,
  },
  'elevator:pressed': {
    payload: {} as ElevatorPressed,
    recipients: 'riders',
    fromSim: ((event) => ({
      payload: { playerId: event.playerId, floor: event.floor },
      visibility: { car: event.car },
    })) as SimProjection<'elevator:pressed'>,
  },
  'elevator:riders': {
    payload: {} as ElevatorRiders,
    recipients: 'riders',
    fromSim: ((event) => ({
      payload: {
        car: event.car,
        riders: event.riders,
        queue: event.queue,
        ...(event.guests !== undefined && event.guests.length > 0 ? { guests: event.guests } : {}),
      },
      visibility: { car: event.car },
    })) as SimProjection<'elevator:riders'>,
  },
  // --- Stairs (cycle 3.E, AD-040): ambush knowledge is exactly as wide as
  // its two ends — the victim (anonymous payload) and the saboteur (their
  // own confirmation). Both rows are 'self'; nothing about the stairs
  // interior is ever broadcast.
  'stairs:ambushed': {
    payload: {} as StairsAmbushed,
    recipients: 'self',
    fromSim: ((event) => ({
      self: event.playerId,
      payload: { playerId: event.playerId, stunSeconds: event.stunSeconds },
    })) as SimProjection<'stairs:ambushed'>,
  },
  'stairs:ambush': {
    payload: {} as StairsAmbush,
    recipients: 'self',
    fromSim: ((event) => ({
      self: event.playerId,
      payload: { playerId: event.playerId, victimId: event.victimId },
    })) as SimProjection<'stairs:ambush'>,
  },
  'player:left': {
    payload: {} as PlayerLeft,
    recipients: 'all',
    fromSim: undefined,
  },
  'player:left-floor': {
    payload: {} as PlayerLeftFloor,
    recipients: 'sameFloor',
    fromSim: ((event) => ({
      payload: { playerId: event.playerId, floor: event.floor },
      visibility: { floor: event.floor },
    })) as SimProjection<'player:left-floor'>,
  },
  'movement:snapshot': {
    payload: {} as MovementSnapshot,
    recipients: 'self',
    fromSim: undefined,
  },
  'work:started': {
    payload: {} as WorkStarted,
    recipients: 'self',
    fromSim: ((event) => ({
      self: event.playerId,
      payload: {
        playerId: event.playerId,
        floor: event.floor,
        room: event.room,
        seconds: event.seconds,
      },
    })) as SimProjection<'work:started'>,
  },
  'work:ended': {
    payload: {} as WorkEnded,
    recipients: 'self',
    fromSim: ((event) => ({
      self: event.playerId,
      payload: {
        playerId: event.playerId,
        floor: event.floor,
        room: event.room,
        outcome: event.outcome,
      },
    })) as SimProjection<'work:ended'>,
  },
  'room:observed': {
    payload: {} as RoomObserved,
    recipients: 'self',
    fromSim: ((event) => ({
      self: event.playerId,
      payload: {
        playerId: event.playerId,
        floor: event.floor,
        room: event.room,
        state: event.state,
      },
    })) as SimProjection<'room:observed'>,
  },
  'room:prepped': {
    payload: {} as RoomPrepped,
    recipients: 'occupants',
    fromSim: ((event) => ({
      payload: { floor: event.floor, room: event.room },
      visibility: { roomKey: `${event.floor}:${event.room}` },
    })) as SimProjection<'room:prepped'>,
  },
  'room:trashed': {
    payload: {} as RoomTrashed,
    recipients: 'occupants',
    fromSim: ((event) => ({
      payload: { floor: event.floor, room: event.room },
      visibility: { roomKey: `${event.floor}:${event.room}` },
    })) as SimProjection<'room:trashed'>,
  },
  // --- Evidence (cycle 2.7): cards/entered are floor-public (FR-10/FR-11),
  // settled stays occupant-only, rustle is exactly as wide as earshot ---
  'room:carded': {
    payload: {} as RoomCarded,
    recipients: 'sameFloor',
    fromSim: ((event) => ({
      payload: { floor: event.floor, room: event.room },
      visibility: { floor: event.floor },
    })) as SimProjection<'room:carded'>,
  },
  'room:settled': {
    payload: {} as RoomSettled,
    recipients: 'occupants',
    fromSim: ((event) => ({
      payload: { floor: event.floor, room: event.room },
      visibility: { roomKey: `${event.floor}:${event.room}` },
    })) as SimProjection<'room:settled'>,
  },
  'room:rustle': {
    payload: {} as RoomRustle,
    recipients: 'earshot',
    fromSim: ((event) => ({
      payload: { floor: event.floor, room: event.room },
      visibility: { floor: event.floor, room: event.room },
    })) as SimProjection<'room:rustle'>,
  },
  'room:entered': {
    payload: {} as RoomEntered,
    recipients: 'sameFloor',
    fromSim: ((event) => ({
      payload: { playerId: event.playerId, floor: event.floor, room: event.room },
      visibility: { floor: event.floor },
    })) as SimProjection<'room:entered'>,
  },
  // --- Justice (cycle 2.8): public-but-name-only firing. The projection
  // strips the sim event's internal `reason` — the wire carries {playerId}
  // and nothing else (FR-18; leak rules 3/4).
  'player:fired': {
    payload: {} as PlayerFired,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: { playerId: event.playerId },
    })) as SimProjection<'player:fired'>,
  },
  // --- Round end (cycle 2.9, §6.6/§6.7). round:ended is the ONLY message that
  // ever names the saboteur (FR-21) — legal because the round is over. The
  // recap reveals accusation validity and ride occupancy for the same reason
  // (FR-22). spectator:snapshot / round:resumed are self-policy room
  // originals: FR-20's full-world baseline and the FR-25 seat restore.
  'round:ended': {
    payload: {} as RoundEnded,
    recipients: 'all',
    fromSim: ((event) => ({
      payload: {
        winner: event.winner,
        reason: event.reason,
        saboteurId: event.saboteurId,
      },
    })) as SimProjection<'round:ended'>,
  },
  'round:recap': {
    payload: {} as RoundRecap,
    recipients: 'all',
    fromSim: undefined,
  },
  'spectator:snapshot': {
    payload: {} as SpectatorSnapshot,
    recipients: 'self',
    fromSim: undefined,
  },
  'round:resumed': {
    payload: {} as RoundResumed,
    recipients: 'self',
    fromSim: undefined,
  },
} as const satisfies { [K in RegistryKey]: Entry<K> } & {
  [K in SimEvent['type'] | MovementEvent['type']]: unknown
}

export type RegistryRecipients<K extends RegistryKey> = (typeof PROTOCOL_REGISTRY)[K]['recipients']

/** Registry keys whose declared policy is R — the Router's compile-time policy gate. */
export type KeysWith<R extends RecipientPolicy> = {
  [K in RegistryKey]: RegistryRecipients<K> extends R ? K : never
}[RegistryKey]
