/**
 * Guest cosmetic art derivation (Phase 4.1, VPOL-06; 10 kinds per the
 * 2026-09-05 user direction): pure seed → {archetype, palette}, shared by the
 * guests view (sprite textures + tints) and nothing else — player variants
 * have their own decorrelated stream. The first four archetypes keep their
 * historical order so seed 0..3 stays suite/tourist/clerk/elder. Palette
 * tints are civil Deco tones — never the staff ivory `0xf2ead8`/`0xf6f1e6`
 * or brass `0xc9a13b`/`0xb3873a` (VPOL-07).
 */
export const GUEST_ARCHETYPES = [
  'guest-suite',
  'guest-tourist',
  'guest-clerk',
  'guest-elder',
  'guest-dandy',
  'guest-diva',
  'guest-flapper',
  'guest-merchant',
  'guest-professor',
  'guest-child',
] as const

export type GuestArchetype = (typeof GUEST_ARCHETYPES)[number]

export const GUEST_PALETTES = [0x5a9aaa, 0xb06a7a, 0x8aa06a, 0x9a7a9a] as const

export function guestVariantOf(seed: number): { archetype: number; palette: number } {
  const u = (seed >>> 0) % GUEST_ARCHETYPES.length
  return {
    archetype: u >>> 0,
    palette: (Math.floor((seed >>> 0) / GUEST_ARCHETYPES.length) % GUEST_PALETTES.length) >>> 0,
  }
}
