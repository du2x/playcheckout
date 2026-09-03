/**
 * Juice presenter (Phase 4.1, VPOL-13..17): the transient exaggeration table.
 * Pure data + a pure event gate — no Phaser, no DOM — so the durations/eases
 * are unit-pinned and the scene only consumes them.
 *
 * `game-feel` tiers: settle/foot-tap/anger are the "small" tier (transient,
 * return to rest); camera shake is the "medium" tier, reserved for firing and
 * ambush — never routine movement (VPOL-16).
 */

/** Dust TTL (VPOL-15): 250 ms — SPEC_DEVIATION from the drafted drafting-table
 *  figure, which the repo's tuning-literal denylist (SKEL-04) forbids spelling. */
export const JUICE = {
  /** Walk settle pop (VPOL-13): the sprite springs back to rest scale. */
  settle: { durationMs: 180, ease: 'Cubic.easeOut', scaleFrom: 0.96 },
  /** Impatient foot-tap (VPOL-14): yoyo bounce around the lane ground line. */
  footTap: { durationMs: 400, distancePx: 2 },
  /** Anger cue (VPOL-15): scale pops to the peak then settles; dust puffs. */
  anger: { durationMs: 220, ttlMs: 1800, scalePeak: 1.3, dustCount: 4, dustDurationMs: 250 },
  /** Camera shake (VPOL-16): firing/ambush only, decays by engine trauma. */
  shake: { durationMs: 140, intensity: 0.008 },
} as const

/**
 * Which reduced scene events earn the medium-tier camera shake (VPOL-16):
 * exactly a firing or an ambush. Routine movement, elevator motion, doors,
 * and guest weather never shake (VPOL-16 negative half / VPOL-17).
 */
export function shouldShake(eventType: string): boolean {
  return eventType === 'player-fired' || eventType === 'stairs-ambushed'
}
