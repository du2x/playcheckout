import { z } from 'zod'
import type { FLOOR_IDS, GUEST_FLOOR_IDS } from '../layout.js'
import type { Role } from '../roles.js'
import type { RoomState } from '../roomState.js'

/** Guest floors + grand lobby, indexed 0..3 (layout.ts is the source). */
export type FloorId = (typeof FLOOR_IDS)[number]
export type GuestFloorId = (typeof GUEST_FLOOR_IDS)[number]
/** Room 1..8 on a guest floor (layout.ts is the source). */
export type { RoomIndex } from '../layout.js'

import type { RoomIndex } from '../layout.js'
/** Car 1 = west landing, car 2 = east landing. */
export type CarId = 1 | 2
export type Facing = 'left' | 'right'

/**
 * Server→client payload shapes (protocol registry payloads — see registry.ts).
 * Payloads carry NO `type` literal: the Colyseus wire name is the only type
 * tag, and every message travels inside an `Envelope` stamped by the Router.
 * Roles other than the recipient's own NEVER appear here; the deal seed appears
 * nowhere.
 */

/** Roster entry — ids and names only; never roles, never join order. */
export interface RosterEntry {
  readonly id: string
  readonly name: string
}

/**
 * server → one player. Personal snapshot on join and every roster change
 * (join, leave, host migration). Recipient sees own identity + lobby roster.
 */
export interface LobbySnapshot {
  readonly ownId: string
  readonly ownName: string
  readonly isHost: boolean
  readonly roster: readonly RosterEntry[]
}

/** server → all players (broadcast). Round begin; ids only — no roles. */
export interface RoundStarted {
  readonly playerIds: readonly string[]
}

/**
 * server → exactly one player, private. The recipient's own role card (prd FR-2).
 * NEVER broadcast; no other player's role may ever be attached to any payload.
 */
export interface RoleDealt {
  readonly role: Role
}

/** server → all players (broadcast). Shift clock expired — empty payload. */
export type RoundBuzzer = Record<string, never>

/** server → one player. Intent rejection reason (join errors use Colyseus join rejection). */
export interface IntentError {
  readonly code:
    | 'need-more-players'
    | 'not-host'
    | 'round-already-active'
    | 'elevator-locked'
    | 'round-not-active'
    | 'not-in-room'
    | 'room-not-workable'
    | 'channel-active'
    | 'carrying'
    | 'justice-rejected'
  readonly message: string
}

// ---------------------------------------------------------------------------
// Movement (cycle 2.4). Positions are public (protocol rule 2); elevator
// payloads carry car floors only — never occupant ids (FR-6).
// ---------------------------------------------------------------------------

/** server → all players. A player's position/floor/facing changed this tick. */
export interface PlayerMoved {
  readonly playerId: string
  readonly floor: FloorId
  /** Tiles; the sim integrates in integer millitiles for determinism. */
  readonly x: number
  readonly facing: Facing
}

/** server → all players. A call was registered (incl. decoy flashes, FR-5). */
export interface ElevatorCalled {
  /** Floor the car was called to (the caller's pickup floor). */
  readonly floor: FloorId
  readonly car: CarId
}

/** server → all players. A car's floor changed (arrival, ride hop). */
export interface ElevatorMoved {
  readonly car: CarId
  readonly floor: FloorId
}

/**
 * server → all players (AD-026/027). The named car's doors began their
 * opening swing (open: true) or began closing to attend a call (open: false)
 * at the named floor. Public door state — panels and the presenter derive
 * the door visuals from it; it never names occupants.
 */
export interface ElevatorDoors {
  readonly car: CarId
  readonly floor: FloorId
  readonly open: boolean
}

/**
 * server → the riders of the named car ONLY (AD-013 riders policy). A rider
 * pressed a floor inside the car; attribution testimony for co-riders.
 * Panels never carry this — the public target would make tailing trivial.
 */
export interface ElevatorPressed {
  readonly playerId: string
  readonly floor: FloorId
}

/**
 * server → the riders of the named car ONLY (AD-013). The car's full current
 * occupant list and its FIFO press queue — the real-elevator "lit buttons are
 * visible from inside" model (late boarders and rejoiners included).
 */
export interface ElevatorRiders {
  readonly car: CarId
  readonly riders: readonly string[]
  readonly queue: readonly FloorId[]
  /**
   * Guests aboard (cycle 3.1, GUEST-07) — present ONLY when non-empty:
   * guests are public NPCs (FR-33 tenancy is public) and count toward car
   * capacity, so rider knowledge would lie without them. Player occupancy
   * rules are unchanged (AD-013).
   */
  readonly guests?: readonly string[]
}

/** server → same-floor viewers (cycle 3.1). A guest NPC's public position. */
export interface GuestMoved {
  readonly guestId: string
  readonly floor: FloorId
  readonly x: number
}

/** server → all players (cycle 3.1). A guest NPC arrived at the desk queue. */
export interface GuestArrived {
  readonly guestId: string
}

/** server → all players (cycle 3.1). The guest's free impatience cue fires. */
export interface GuestImpatient {
  readonly guestId: string
}

/** server → all players (cycle 3.1). The guest self-assigned a vacant room. */
export interface GuestSelfAssigned {
  readonly guestId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → all players (cycle 3.1). The guest entered and settled. */
export interface GuestSettled {
  readonly guestId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → all players (cycle 3.1). The guest checked out — room re-trashes. */
export interface GuestCheckedOut {
  readonly guestId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → all players (cycle 3.1). The guest walked out of the hotel. */
export interface GuestLeft {
  readonly guestId: string
}

/**
 * server → all players (cycle 3.B, AD-032; amended AD-034). The guest's room
 * assignment — server truth seeded at check-in — announced BUILDING-WIDE at
 * the check-in tick (walkie line "a guest announces: I'm in F:R"). Announced
 * exactly once per guest; the saboteur learns it for free (AD-034(e)) — the
 * contested gameplay is physical interception of the suitcase.
 */
export interface GuestAssigned {
  readonly guestId: string
  readonly floor: GuestFloorId
  readonly room: RoomIndex
}

/**
 * server → all players (cycle 3.B). Check-in handoff lifecycle fact: the
 * named player took the guest's suitcase (receiver = carrier). The walkie
 * log renders it building-wide; no room is named.
 */
export interface SuitcaseCarried {
  readonly guestId: string
  readonly carrierId: string
}

/**
 * server → same-floor viewers ONLY (cycle 3.B). A suitcase came to rest at
 * the named room's doorway. PLACEMENT IS SILENT: no walkie line fires; the
 * resting room is learnable only by being on that floor (or later via the
 * settle/complaint lifecycle lines) — FR-27 v1.4.
 */
export interface SuitcasePlaced {
  readonly guestId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/**
 * server → all players (cycle 3.B). Pickup lifecycle fact: the named player
 * took a resting suitcase (fresh carry leg). The walkie log renders it
 * building-wide; no room is named.
 */
export interface SuitcasePickedUp {
  readonly guestId: string
  readonly carrierId: string
}

/**
 * server → all players (cycle 3.B). The wrong-delivery door complaint
 * (FR-29(a) trigger): the guest arrived at a room that was not their
 * assignment. Names the room + guest, never the assignment; counts toward
 * NOTHING since v1.5 (AD-039) — the line informs, it no longer damages; the
 * budget-counting trigger is `guest:discovered` (cycle 3.3). No personal
 * penalty attaches.
 */
export interface GuestComplained {
  readonly guestId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/**
 * server → same-floor viewers ONLY (cycle 3.3). The FR-29(b) stage-1 anger
 * cue at the room: the guest discovered trash inside their assigned room and
 * storms out. Room-number level, no interior detail, no actor — the evidence
 * beat is the cue plus the desk report that follows, never a name.
 */
export interface GuestAngered {
  readonly guestId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/**
 * server → all players (cycle 3.3). The FR-29(b) stage-2 desk report, the
 * ONLY budget-counting complaint (FR-31): the angered guest reached the desk
 * and delivered their fuzzy-timestamp testimony. `fresh` is the freshness
 * tier the guest observed inside — fresh-tier trash or a witnessed un-prep →
 * true ("maybe a minute ago"), aged/churn trash → false ("a while ago"). The
 * guest leaves the hotel with this message; no retry. Names no actor.
 */
export interface GuestDiscovered {
  readonly guestId: string
  readonly floor: FloorId
  readonly room: RoomIndex
  readonly fresh: boolean
}

/** server → all players. A player disconnected; remove their rectangle. */
export interface PlayerLeft {
  readonly playerId: string
}

/**
 * server → the departed floor's viewers (AD-009 coherence): a player departed this
 * floor by elevator — drop their rectangle. The destination is NOT conveyed.
 */
export interface PlayerLeftFloor {
  readonly playerId: string
  readonly floor: FloorId
}

// --- Stairs (cycle 3.E, AD-040): the west stairwell replaced the W elevator.
// The ambush is private knowledge on both ends: the victim learns only that
// they were ambushed (never by whom — anonymity is the design), the saboteur
// learns only that their ambush landed. Both rows are `self`-policy.

/** server → the ambushed staff member (self). No saboteur identity, ever. */
export interface StairsAmbushed {
  readonly playerId: string
  readonly stunSeconds: number
}

/** server → the saboteur (self): their ambush landed on this victim. */
export interface StairsAmbush {
  readonly playerId: string
  readonly victimId: string
}

/**
 * Movement snapshot row for the recipient's own stairs transit (cycle 3.E) —
 * present ONLY while the recipient is in the stairwell (transit, breath, or
 * stunned). The interior is a black box to everyone else; this is the
 * recipient's own legitimate knowledge of their own state.
 */
export interface MovementSnapshotStairs {
  readonly from: FloorId
  readonly to: FloorId
  readonly phase: 'transit' | 'breath' | 'stunned'
  /** Seconds remaining of the CURRENT phase (transit, breath, or stun). */
  readonly remainingSeconds: number
}

/** Movement snapshot row for one player — public position data only. */
export interface MovementSnapshotPlayer {
  readonly playerId: string
  readonly floor: FloorId
  readonly x: number
}

/** Movement snapshot row for one car — floor only, never occupants (FR-6). */
export interface MovementSnapshotCar {
  readonly car: CarId
  readonly floor: FloorId
}

/** Movement snapshot row for one guest NPC (cycle 3.1) — public position. */
export interface MovementSnapshotGuest {
  readonly guestId: string
  readonly floor: FloorId
  readonly x: number
}

/**
 * Movement snapshot row for one RESTING suitcase (cycle 3.B) — sameFloor-
 * public like the placed event; carried suitcases are derived by the client
 * from the carrier's position stream.
 */
export interface MovementSnapshotSuitcase {
  readonly guestId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/**
 * server → one player. Public movement state on join and at the buzzer (MOVE-18).
 * `carOccupants` is present ONLY in a rider's personal snapshot (AD-013):
 * viewers standing on a floor get the byte-identical public shape — occupancy
 * and queue knowledge belongs exclusively to the people inside the car.
 * `guests` (cycle 3.1) is present ONLY when the snapshot's floor has standing
 * guest NPCs — public weather, never players.
 */
export interface MovementSnapshot {
  readonly players: readonly MovementSnapshotPlayer[]
  readonly cars: readonly MovementSnapshotCar[]
  /**
   * Carded rooms of the snapshot's floor, ascending (EVID-04, cycle 2.7) —
   * cards are floor-public (FR-11), so own-floor cards ride the own-floor
   * snapshot; other floors' cards never appear (AD-009 filtering).
   */
  readonly cardedRooms: readonly RoomIndex[]
  readonly guests?: readonly MovementSnapshotGuest[]
  /**
   * Resting suitcases of the snapshot's floor (cycle 3.B, SUI-24 late
   * joiners) — sameFloor-public; present ONLY when non-empty. Spectator
   * baselines carry every floor's rows.
   */
  readonly suitcases?: readonly MovementSnapshotSuitcase[]
  /**
   * The recipient's own stairs state (cycle 3.E, AD-040) — present ONLY while
   * the recipient is in the stairwell. Everyone else's stairs transit is
   * invisible (the interior is a black box).
   */
  readonly stairs?: MovementSnapshotStairs
  readonly carOccupants?: {
    readonly car: CarId
    readonly riders: readonly string[]
    readonly queue: readonly FloorId[]
    readonly guests?: readonly string[]
  }
}

// ---------------------------------------------------------------------------
// Work channels (cycle 2.5, FR-7/8/9/16). Interiors (room states) reach only
// players inside the room's segment (FR-10); channel events are the actor's
// own private view. No payload names a role, a channel kind, or a fake (FR-9).
// ---------------------------------------------------------------------------

/** server → the actor. Their channel began; `seconds` drives the own progress bar. */
export interface WorkStarted {
  readonly playerId: string
  readonly floor: FloorId
  readonly room: RoomIndex
  readonly seconds: number
}

/** server → the actor. Their channel ended (walk-out cancel or completion). */
export interface WorkEnded {
  readonly playerId: string
  readonly floor: FloorId
  readonly room: RoomIndex
  readonly outcome: 'completed' | 'cancelled'
}

/** server → one player. The state of the room they just entered (FR-10). */
export interface RoomObserved {
  readonly playerId: string
  readonly floor: FloorId
  readonly room: RoomIndex
  readonly state: RoomState
}

/** server → the room's occupants. A real prep transition completed (FR-7). */
export interface RoomPrepped {
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → the room's occupants. A real un-prep transition completed (FR-8). */
export interface RoomTrashed {
  readonly floor: FloorId
  readonly room: RoomIndex
}

// ---------------------------------------------------------------------------
// Evidence layer (cycle 2.7, FR-10–FR-13). Cards, rustle, and door-open cues
// are hallway-visible (leak rule 2); payloads never carry timestamps (FR-11),
// authors, roles, or interior state.
// ---------------------------------------------------------------------------

/** server → same-floor viewers. A room became prepped; its card is now hung (FR-11). */
export interface RoomCarded {
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → the room's occupants. Fresh trash aged past FRESHNESS_WINDOW_SECONDS (FR-12). */
export interface RoomSettled {
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → earshot viewers (same floor within RUSTLE_RANGE_TILES, through walls — FR-13). */
export interface RoomRustle {
  readonly floor: FloorId
  readonly room: RoomIndex
}

/** server → same-floor viewers. A player entered the room's segment (FR-10 cue half). */
export interface RoomEntered {
  readonly playerId: string
  readonly floor: FloorId
  readonly room: RoomIndex
}

/**
 * server → all players. A firing resolved (walk-in or accusation, either
 * verdict) — name-only (FR-18): no role, no reason, no validity flag. Why the
 * player was fired and whether the accusation was correct are revealed only on
 * the recap (FR-22, cycle 2.9).
 */
export interface PlayerFired {
  readonly playerId: string
}

// ---------------------------------------------------------------------------
// Round end (cycle 2.9, §6.6/§6.7). Every payload here is legal ONLY because
// the round is over: the traitor identity (FR-21), accusation validity and
// ride occupancy (FR-22) are post-round reveals. Before `round:ended`, no
// payload ever names the saboteur, a role, or a verdict.
// ---------------------------------------------------------------------------

/** How the round ended — `aborted` exists only on the room-originated path (FR-25). */
export type RoundEndWinner = 'staff' | 'saboteur' | 'aborted'

/**
 * server → all players. The round's verdict (FR-21). `saboteurId` is the
 * traitor reveal — null only on an aborted round (no winner, no reveal).
 */
export interface RoundEnded {
  readonly winner: RoundEndWinner
  readonly reason: string
  readonly saboteurId: string | null
}

/** One recap timeline row (FR-22) — ids only; the client renders roster names. */
export type RecapEntry =
  | {
      readonly kind: 'crime'
      readonly tick: number
      readonly floor: FloorId
      readonly room: RoomIndex
      /** Evidence still inside the freshness window at recap time (FR-12). */
      readonly fresh: boolean
    }
  | {
      readonly kind: 'catch'
      readonly tick: number
      readonly entrantId: string
      readonly saboteurId: string
    }
  | {
      readonly kind: 'accusation'
      readonly tick: number
      readonly accuserId: string
      readonly targetId: string
      readonly correct: boolean
    }
  | {
      readonly kind: 'ride'
      readonly tick: number
      readonly car: CarId
      readonly riderIds: readonly string[]
      readonly from: FloorId
      readonly to: FloorId
    }

/** server → all players. The FR-22 recap timeline, emitted right after round:ended. */
export interface RoundRecap {
  readonly entries: readonly RecapEntry[]
  /** Final settle score and the §7 v1.5 target (cycle 3.D, AD-039) — the
   *  buzzer verdict's inputs, public post-round. */
  readonly settleScore: number
  readonly settleTarget: number
}

/** One room-state row of the spectator baseline. */
export interface SpectatorRoomState {
  readonly floor: FloorId
  readonly room: RoomIndex
  readonly state: RoomState
}

/** One floor's carded rooms of the spectator baseline. */
export interface SpectatorCarded {
  readonly floor: FloorId
  readonly rooms: readonly RoomIndex[]
}

/**
 * server → one fired player (self). The full-world spectator baseline (FR-20):
 * every player's position on every floor, car floors, every room's state, all
 * carded rooms. Live deltas then arrive through the spectator over-delivery.
 */
export interface SpectatorSnapshot {
  readonly players: readonly MovementSnapshotPlayer[]
  readonly cars: readonly MovementSnapshotCar[]
  readonly rooms: readonly SpectatorRoomState[]
  readonly cardedRooms: readonly SpectatorCarded[]
}

/**
 * server → one reconnected player (self, FR-25/§11). Restores the round view:
 * the honest clock (remaining ticks), the round cast, and whether the
 * recipient is a fired spectator (their snapshot path differs).
 */
export interface RoundResumed {
  readonly remainingTicks: number
  readonly playerIds: readonly string[]
  readonly ownFired: boolean
  /** The current settle score (cycle 3.D, AD-039): the reconnecting client
   *  re-seeds its HUD counter — it never saw the settle stream it missed. */
  readonly settleScore: number
}

/**
 * client → server intent: host starts the round (FR-2). Validated by zod in the
 * room's `validate()` handler; the server rejects, it never trusts. Intents are
 * not part of the protocol registry.
 */
export const lobbyStartIntentSchema = z
  .object({
    type: z.literal('lobby:start'),
  })
  .strict()
export type LobbyStartIntent = z.infer<typeof lobbyStartIntentSchema>
