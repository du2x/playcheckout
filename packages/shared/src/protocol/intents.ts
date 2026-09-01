import { z } from 'zod'
import { FLOOR_IDS, GUEST_FLOOR_IDS } from '../layout.js'

/**
 * Client → server intents (movement cycle 2.4, work channels cycle 2.5).
 * Always routed through Colyseus 0.18 zod `validate()` handlers — the server
 * rejects, it never trusts. Intents are NOT part of the protocol registry.
 */

const FLOOR_ENUM = z.enum(FLOOR_IDS)
const GUEST_FLOOR_ENUM = z.enum(GUEST_FLOOR_IDS)

/** Hold-to-walk: sent on keydown; one intent per direction, idempotent. */
export const moveStartIntentSchema = z
  .object({
    type: z.literal('move:start'),
    dir: z.enum(['left', 'right']),
  })
  .strict()
export type MoveStartIntent = z.infer<typeof moveStartIntentSchema>

/** Release-to-stop: sent on keyup; a no-op when no move is active. */
export const moveStopIntentSchema = z
  .object({
    type: z.literal('move:stop'),
  })
  .strict()
export type MoveStopIntent = z.infer<typeof moveStopIntentSchema>

/**
 * Call a car to the caller's floor — destination-free (ELR-06/AD-014): the
 * destination is chosen INSIDE the car via `elevator:press`, never at call
 * time. A call from the floor where a car idles open-doors is a decoy flash.
 */
export const elevatorCallIntentSchema = z
  .object({
    type: z.literal('elevator:call'),
  })
  .strict()
export type ElevatorCallIntent = z.infer<typeof elevatorCallIntentSchema>

/**
 * TRANSITIONAL legacy destination-carrying call — REMOVED with the T6 sim
 * rework (AD-014): the wire accepts only the destination-free schema above.
 */

/** Press a floor inside the car the sender is riding (ELR-06/ELR-08). */
export const elevatorPressIntentSchema = z
  .object({
    type: z.literal('elevator:press'),
    floor: FLOOR_ENUM,
  })
  .strict()
export type ElevatorPressIntent = z.infer<typeof elevatorPressIntentSchema>

/**
 * Enter the stairwell at the west end of the sender's floor (cycle 3.E,
 * AD-040): one floor stride per activation in the pressed direction. The
 * server validates the mouth zone, the direction's adjacent floor, and that
 * the sender is a standing player — every rejection is silent.
 */
export const stairsEnterIntentSchema = z
  .object({
    type: z.literal('stairs:enter'),
    dir: z.enum(['up', 'down']),
  })
  .strict()
export type StairsEnterIntent = z.infer<typeof stairsEnterIntentSchema>

/**
 * Start a work channel inside the named room's segment (FR-7/8/9). The action
 * (prep / un-prep / fake prep) is derived server-side from the caller's role
 * and the room's state — the client never sends it.
 */
export const workStartIntentSchema = z
  .object({
    type: z.literal('work:start'),
    floor: GUEST_FLOOR_ENUM,
    room: z.number().int().min(1).max(8),
  })
  .strict()
export type WorkStartIntent = z.infer<typeof workStartIntentSchema>

/**
 * Accuse a nearby player of being the saboteur (FR-17, cycle 2.8). Staff-only,
 * same-floor within TUNING.ACCUSATION_RANGE_TILES — all enforced server-side
 * from the movement layer's positions; the client menu is a mirror, never an
 * authority. No cancel exists: once sent, the accusation resolves.
 */
export const accuseIntentSchema = z
  .object({
    type: z.literal('accuse'),
    targetId: z.string().min(1),
  })
  .strict()
export type AccuseIntent = z.infer<typeof accuseIntentSchema>

/**
 * Tap E at the front desk (cycle 3.2, FR-27): the server derives the action —
 * receive the front queued guest, or release the sender's held guest (the
 * `work:start` derivation pattern). Every rejection is silent (spec AC2).
 */
export const deskInteractIntentSchema = z
  .object({
    type: z.literal('desk:interact'),
  })
  .strict()
export type DeskInteractIntent = z.infer<typeof deskInteractIntentSchema>

/**
 * Place the sender's carried suitcase at a room door (cycle 3.B, AD-032).
 * The floor is derived server-side from the carrier's position; the server
 * validates the carrier is within ROOM_DOOR_RANGE_TILES of the named room's
 * door x. Placement is silent — no walkie line exists for it.
 */
export const suitcasePlaceIntentSchema = z
  .object({
    type: z.literal('suitcase:place'),
    room: z.number().int().min(1).max(8),
  })
  .strict()
export type SuitcasePlaceIntent = z.infer<typeof suitcasePlaceIntentSchema>

/**
 * Pick up the nearest resting suitcase on the sender's floor within
 * ROOM_DOOR_RANGE_TILES (cycle 3.B, AD-032) — by anyone, saboteur included;
 * self-regrab allowed. Ties resolve to the lowest guestId (deterministic).
 */
export const suitcasePickupIntentSchema = z
  .object({
    type: z.literal('suitcase:pickup'),
  })
  .strict()
export type SuitcasePickupIntent = z.infer<typeof suitcasePickupIntentSchema>
