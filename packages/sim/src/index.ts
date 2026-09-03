/**
 * Pure round simulation: inputs + time in, events out, 20 Hz fixed tick.
 * No I/O, no Colyseus, no randomness without a seed.
 */

export { dealRoles, mulberry32 } from './deal.js'
export type { MovementEvent, SimEvent } from './events.js'
export { GuestSim, type GuestTiming, type MovementPort } from './guests.js'
export { computeKpis, computeKpisFromLines } from './kpis.js'
export {
  ARRIVE_TICKS,
  CAR_LANDING_MILLI,
  DWELL_TICKS,
  type MoveDir,
  MovementSim,
  RIDE_TICKS_PER_FLOOR,
  SPEED_MILLI_PER_TICK,
} from './movement.js'
export { Rng } from './rng.js'
export { RoundSim, type RoundSimConfig } from './roundSim.js'
export { TelemetrySink } from './telemetry.js'
export { TICK_HZ } from './tick.js'
export {
  type PositionSample,
  PREP_TICKS,
  type RoundPositions,
  type StartWorkResult,
  UNPREP_TICKS,
  WorkChannels,
} from './work.js'
