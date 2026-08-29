import { describe, expect, it } from 'vitest'
import {
  CUE_TTL_MS,
  type EvidenceSession,
  dropCues,
  initialEvidenceSession,
  liveCues,
  reduceEvidence,
} from './evidenceSession'

// Spec EVID-19 (cycle 2.7): the evidence view reducer — cards accumulate
// idempotently, cues buffer with arrival timestamps, pruning is caller-timed.

const T0 = 1_000_000

function reduced(session: EvidenceSession, ...actions: Parameters<typeof reduceEvidence>[1][]) {
  let s = session
  for (const a of actions) s = reduceEvidence(s, a, T0)
  return s
}

describe('evidenceSession', () => {
  it('accumulates carded rooms and never loses them (EVID-01, EVID-03)', () => {
    let s = initialEvidenceSession()
    s = reduced(s, { type: 'carded', floor: 'floor1', room: 3 })
    expect([...s.cards]).toEqual(['floor1:3'])
    // Re-emission (re-prep of a carded room) is idempotent.
    s = reduced(s, { type: 'carded', floor: 'floor1', room: 3 })
    expect([...s.cards]).toEqual(['floor1:3'])
    s = reduced(s, { type: 'carded', floor: 'floor1', room: 7 })
    expect([...s.cards].sort()).toEqual(['floor1:3', 'floor1:7'])
  })

  it('buffers entered and rustle cues with increasing ids (EVID-16, EVID-12)', () => {
    const s = reduced(
      initialEvidenceSession(),
      { type: 'entered', playerId: 'p2', floor: 'floor1', room: 1 },
      { type: 'rustle', floor: 'floor1', room: 2 },
    )
    expect(s.cues.map((c) => c.kind)).toEqual(['entered', 'rustle'])
    expect(s.cues[0]?.at).toBe(T0)
    expect(s.cues[1]?.id).toBe((s.cues[0]?.id ?? 0) + 1)
  })

  it('prunes cues by their per-kind TTL and drops them from the session', () => {
    let s = reduced(
      initialEvidenceSession(),
      { type: 'entered', playerId: 'p2', floor: 'floor1', room: 1 },
      { type: 'rustle', floor: 'floor1', room: 2 },
    )
    // Fresh: both live.
    expect(liveCues(s, T0 + 10)).toHaveLength(2)
    // Entered expires first (shorter TTL).
    const enteredId = s.cues[0]?.id ?? 0
    expect(liveCues(s, T0 + CUE_TTL_MS.entered)).toHaveLength(1)
    expect(liveCues(s, T0 + CUE_TTL_MS.rustle)).toHaveLength(0)
    s = dropCues(s, new Set([enteredId]))
    expect(s.cues.map((c) => c.kind)).toEqual(['rustle'])
    // Dropping nothing is a no-op returning the same session.
    expect(dropCues(s, new Set())).toBe(s)
  })

  it('keeps the cue id counter monotonic across prunes', () => {
    let s = reduced(initialEvidenceSession(), { type: 'rustle', floor: 'floor1', room: 1 })
    const firstId = s.cues[0]?.id ?? 0
    s = dropCues(s, new Set([firstId]))
    s = reduceEvidence(s, { type: 'rustle', floor: 'floor1', room: 1 }, T0 + 1)
    expect(s.cues[0]?.id).toBe(firstId + 1)
  })
})
