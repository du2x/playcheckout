import { ROLES } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { dealRoles, mulberry32 } from './deal.js'

// Spec DEAL-01: exactly one saboteur per deal, everyone else staff (prd FR-2).
describe('dealRoles', () => {
  const ids4 = ['p1', 'p2', 'p3', 'p4']
  const ids6 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']

  it('assigns exactly one saboteur at the 4-player boundary (PLAYERS_MIN)', () => {
    const deal = dealRoles(7, ids4)
    const saboteurs = ids4.filter((id) => deal.get(id) === 'saboteur')
    expect(saboteurs).toHaveLength(1)
    expect(ROLES).toContain('saboteur')
  })

  it('assigns exactly one saboteur at the 6-player cap (PLAYERS_MAX)', () => {
    const deal = dealRoles(7, ids6)
    const saboteurs = ids6.filter((id) => deal.get(id) === 'saboteur')
    expect(saboteurs).toHaveLength(1)
  })

  it('deals every player a role — no gaps', () => {
    const deal = dealRoles(42, ids4)
    expect([...deal.keys()].sort()).toEqual([...ids4].sort())
    for (const role of deal.values()) expect(ROLES).toContain(role)
  })

  it('is deterministic: fixed seed and ids reproduce the identical deal', () => {
    const a = dealRoles(1234, ids4)
    const b = dealRoles(1234, ids4)
    expect([...a.entries()]).toEqual([...b.entries()])
  })

  it('varies the saboteur across different seeds', () => {
    const winners = new Set<string>()
    for (let seed = 0; seed < 200; seed++) {
      const deal = dealRoles(seed, ids4)
      for (const [id, role] of deal) if (role === 'saboteur') winners.add(id)
    }
    // A seed space that never rotates the saboteur would break hidden-info fairness.
    expect(winners.size).toBe(ids4.length)
  })

  it('mulberry32 is seeded-deterministic', () => {
    const a = mulberry32(99)
    const b = mulberry32(99)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })
})
