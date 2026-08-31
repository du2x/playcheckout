import { describe, expect, it } from 'vitest'
import { Rng } from './rng.js'

describe('Rng (GUEST-10: seeded, deterministic sampling)', () => {
  it('produces the identical sequence for the same seed', () => {
    const a = new Rng(1234)
    const b = new Rng(1234)
    const seqA = Array.from({ length: 32 }, () => a.next())
    const seqB = Array.from({ length: 32 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces a different sequence for a different seed', () => {
    const a = new Rng(1)
    const b = new Rng(2)
    const seqA = Array.from({ length: 16 }, () => a.next())
    const seqB = Array.from({ length: 16 }, () => b.next())
    expect(seqA).not.toEqual(seqB)
  })

  it('int() stays within [0, maxInclusive] across many draws', () => {
    const rng = new Rng(42)
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(5)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('uniform() stays within [min, max] and covers the range', () => {
    const rng = new Rng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const v = rng.uniform(45, 90)
      expect(v).toBeGreaterThanOrEqual(45)
      expect(v).toBeLessThanOrEqual(90)
      seen.add(Math.round(v))
    }
    // every integer bucket in the dwell range is reachable
    for (let bucket = 45; bucket <= 90; bucket++) expect(seen.has(bucket)).toBe(true)
  })

  it('replays a scripted sequence bit-for-bit (GUEST-14 foundation)', () => {
    const draw = (seed: number) => {
      const rng = new Rng(seed)
      return Array.from({ length: 64 }, () => `${rng.int(23)}:${rng.uniform(45, 90).toFixed(6)}`)
    }
    expect(draw(2026)).toEqual(draw(2026))
  })
})
