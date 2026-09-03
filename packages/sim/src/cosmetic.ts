import { Rng } from './rng.js'

/**
 * Cosmetic seed stream (Phase 4.1, VPOL-01): decorrelated from the role-deal
 * stream so variant distribution never hints the saboteur (FR-9 anti-leak).
 * The fork is a fixed xor — same technique as GuestSim's seeded streams.
 */
export const COSMETIC_FORK = 0x9e3779b9

export const STAFF_VARIANT_BUCKETS = 8
export const GUEST_VARIANT_BUCKETS = 16

/**
 * Pure variant index: `seed % buckets` on the unsigned `u32` view.
 * Never reads `isSaboteur`; the spec's `variant ⊥ role` gate pins this.
 */
export function variantIndex(seed: number, buckets: number): number {
  if (!Number.isInteger(buckets) || buckets < 1) throw new Error(`buckets must be positive int, got ${buckets}`)
  return ((seed >>> 0) % buckets) >>> 0
}

/**
 * Assign one `u32` per player from a dedicated decorrelated Rng fork.
 * Sorted ids make the map independent of join order (the same set of ids
 * with the same seed always yields the same seed per id).
 */
export function assignPlayerSeeds(seed: number, playerIds: readonly string[]): Map<string, number> {
  const rng = new Rng((seed ^ COSMETIC_FORK) >>> 0)
  const sorted = [...playerIds].sort()
  const out = new Map<string, number>()
  for (const id of sorted) {
    // int is inclusive — 0xFFFFFFFF is the full u32 range
    out.set(id, rng.int(0xffffffff))
  }
  return out
}

/**
 * Draw one guest seed from the cosmetic Rng — called at `guest:arrived` tick
 * so per-guest variant is stable for that guest's lifetime. The caller owns
 * the Rng instance so the stream is continuous.
 */
export function assignGuestSeed(cosmeticRng: Rng): number {
  return cosmeticRng.int(0xffffffff)
}
