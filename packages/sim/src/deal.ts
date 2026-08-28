import type { Role } from '@turnover/shared'

/**
 * mulberry32: tiny seeded PRNG (public domain, Johannes Baagøe lineage).
 * Deterministic across runs and platforms for a fixed 32-bit seed.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deal roles for one round: exactly one saboteur, everyone else staff (prd FR-2).
 * Pure — same seed and player ids always produce the same deal (DEAL-06).
 */
export function dealRoles(seed: number, playerIds: readonly string[]): Map<string, Role> {
  const rand = mulberry32(seed)
  const ids = [...playerIds]
  // Fisher-Yates with the seeded rand, then the first id is the saboteur.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const a = ids[i]
    const b = ids[j]
    if (a !== undefined && b !== undefined) {
      ids[i] = b
      ids[j] = a
    }
  }
  const roles = new Map<string, Role>()
  for (const id of playerIds) roles.set(id, 'staff')
  const saboteur = ids[0]
  if (saboteur !== undefined) roles.set(saboteur, 'saboteur')
  return roles
}
