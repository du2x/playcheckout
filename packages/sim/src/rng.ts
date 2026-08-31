import { mulberry32 } from './deal.js'

/**
 * Deterministic seeded sampling helpers for the guest economy (AD-022
 * trade-off 5): no `Math.random` anywhere in the deterministic core. Wraps
 * the existing `mulberry32` PRNG (deal.ts). Consumers that need independent
 * sample streams (guests now, routing/complaints later) each construct their
 * own instance from the round seed so one consumer's draw count can never
 * shift another's sequence.
 */
export class Rng {
  private readonly rand: () => number

  constructor(seed: number) {
    this.rand = mulberry32(seed)
  }

  /** Raw draw in [0, 1). */
  next(): number {
    return this.rand()
  }

  /** Integer in [0, maxInclusive]. */
  int(maxInclusive: number): number {
    return Math.floor(this.next() * (maxInclusive + 1))
  }

  /** Float in [min, max]. */
  uniform(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
}
