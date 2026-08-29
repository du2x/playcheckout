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
