/**
 * Pure round simulation: inputs + time in, events out, 20 Hz fixed tick.
 * No I/O, no Colyseus, no randomness without a seed.
 */

export { dealRoles, mulberry32 } from './deal.js'
export type { SimEvent } from './events.js'
export { createRoundSim, RoundSim, type RoundSimConfig } from './roundSim.js'
export { TICK_HZ } from './tick.js'
