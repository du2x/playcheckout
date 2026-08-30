import { describe, expect, it } from 'vitest'
import {
  type AccuseSession,
  initialAccuseSession,
  pruneToasts,
  reduceAccuse,
} from './accuseSession'
import type { ViewAction } from './state'

// Spec JUST-04/15 (cycle 2.8): the accusation session reduces the name-only
// firing facts and the local menu state. Every fired fact arrives without a
// reason or validity — the reducer has nothing else to render (FR-18).

const START: ViewAction = { type: 'round-started', playerIds: ['p1', 'p2', 'p3', 'p4'] }

function sessionWith(changes: Partial<AccuseSession>): AccuseSession {
  return { ...initialAccuseSession(), ...changes }
}

describe('accuseSession — firing toasts', () => {
  it('adds a toast per fired event with the receipt time', () => {
    let s = initialAccuseSession()
    s = reduceAccuse(s, { type: 'player-fired', playerId: 'p2' }, 'p1', 1000)
    s = reduceAccuse(s, { type: 'player-fired', playerId: 'p3' }, 'p1', 1500)
    expect(s.toasts).toEqual([
      { playerId: 'p2', at: 1000 },
      { playerId: 'p3', at: 1500 },
    ])
    expect(s.selfFired).toBe(false)
  })

  it('flips selfFired only when the local player is the one fired (JUST-04)', () => {
    let s = initialAccuseSession()
    s = reduceAccuse(s, { type: 'player-fired', playerId: 'p2' }, 'p1', 1000)
    expect(s.selfFired).toBe(false)
    s = reduceAccuse(s, { type: 'player-fired', playerId: 'p1' }, 'p1', 1100)
    expect(s.selfFired).toBe(true)
    // Without a known own id, nobody is self-fired.
    const anon = reduceAccuse(
      initialAccuseSession(),
      { type: 'player-fired', playerId: 'p1' },
      undefined,
      0,
    )
    expect(anon.selfFired).toBe(false)
  })

  it('prunes toasts past the visibility window and preserves identity otherwise', () => {
    let s = initialAccuseSession()
    s = reduceAccuse(s, { type: 'player-fired', playerId: 'p2' }, 'p1', 1000)
    // Nothing expired: the SAME reference comes back (identity discipline).
    expect(pruneToasts(s, 1000 + 3999)).toBe(s)
    // Past the window: the toast is gone.
    const pruned = pruneToasts(s, 1000 + 4001)
    expect(pruned.toasts).toEqual([])
    expect(pruned.selfFired).toBe(false) // fired state is not toast-scoped
  })
})

describe('accuseSession — menu', () => {
  it('opens, replaces, and closes the menu; confirm and cancel both close', () => {
    let s = initialAccuseSession()
    s = reduceAccuse(s, { type: 'menu-open', targetId: 'p2', targetName: 'bruno' }, 'p1', 0)
    expect(s.menu).toEqual({ targetId: 'p2', targetName: 'bruno' })
    s = reduceAccuse(s, { type: 'menu-open', targetId: 'p3', targetName: 'caro' }, 'p1', 0)
    expect(s.menu).toEqual({ targetId: 'p3', targetName: 'caro' })
    s = reduceAccuse(s, { type: 'menu-cancel' }, 'p1', 0)
    expect(s.menu).toBeNull()
    s = reduceAccuse(s, { type: 'menu-confirm' }, 'p1', 0)
    expect(s.menu).toBeNull()
  })
})

describe('accuseSession — resets', () => {
  it('resets on round-started and buzzer; identity-preserved when already clean', () => {
    let s = sessionWith({ selfFired: true, toasts: [{ playerId: 'p2', at: 0 }] })
    s = reduceAccuse(s, START, 'p1', 0)
    expect(s).toEqual(initialAccuseSession())
    const clean = initialAccuseSession()
    expect(reduceAccuse(clean, START, 'p1', 0)).toBe(clean)
    let fired = sessionWith({ selfFired: true })
    fired = reduceAccuse(fired, { type: 'buzzer' }, 'p1', 0)
    expect(fired).toEqual(initialAccuseSession())
  })

  it('ignores unrelated actions (identity)', () => {
    const s = sessionWith({ selfFired: true })
    const next = reduceAccuse(s, { type: 'room-carded', floor: 'floor1', room: 2 }, 'p1', 0)
    expect(next).toBe(s)
  })
})
