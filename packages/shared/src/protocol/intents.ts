import { z } from 'zod'
import { FLOOR_IDS } from '../layout.js'

/**
 * Client → server movement intents (cycle 2.4). Always routed through Colyseus
 * 0.18 zod `validate()` handlers — the server rejects, it never trusts.
 * Intents are NOT part of the protocol registry.
 */

const FLOOR_ENUM = z.enum(FLOOR_IDS)

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

/** Call a car to the caller's floor and ride to `target` (design: call semantics). */
export const elevatorCallIntentSchema = z
  .object({
    type: z.literal('elevator:call'),
    target: FLOOR_ENUM,
  })
  .strict()
export type ElevatorCallIntent = z.infer<typeof elevatorCallIntentSchema>
