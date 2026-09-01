import type { GuestFloorId, SimEvent } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { Justice } from './justice.js'
import { RoundSim } from './roundSim.js'
import { PREP_TICKS, UNPREP_TICKS } from './work.js' // Spec JUST-01..05 (gate scenario sim:walkin_conviction, FR-15/FR-16): scripted

// positions over the pure round sim. Positions are integer millitiles; AD-010
// (re-derived AD-036) room 1 on any guest floor spans [2000, 5250), room 2
// [5250, 8500).

const CENTER = 3625 // room 1's doorway (segment center)
const WEST_HALL = 500 // open hall west of every segment
const F1 = 'floor1' as GuestFloorId
const IDS = ['p1', 'p2', 'p3', 'p4']

type Pos = { floor: GuestFloorId | 'lobby'; x: number }
const pos = (floor: GuestFloorId | 'lobby', x: number): Pos => ({ floor, x })
const at = (playerId: string, p: Pos): [string, Pos] => [playerId, p]
const positions = (...entries: [string, Pos][]) => new Map(entries)

/** A round with its first (dealing) tick consumed and the saboteur resolved. */
function startedRound(seed = 1): { sim: RoundSim; saboteur: string; staff: string[] } {
  const sim = new RoundSim({ seed, playerIds: IDS })
  const dealt = sim.tick().filter((e) => e.type === 'role:dealt')
  const saboteur = dealt.find((e) => e.type === 'role:dealt' && e.role === 'saboteur')?.playerId
  if (saboteur === undefined) throw new Error('no saboteur dealt')
  return { sim, saboteur, staff: IDS.filter((id) => id !== saboteur) }
}

function firedOf(events: readonly SimEvent[]) {
  return events.filter((e) => e.type === 'player:fired')
}

describe('sim:walkin_conviction', () => {
  it('fires the saboteur instantly when a staff enters the un-prepping room (JUST-01)', () => {
    const { sim, saboteur, staff } = startedRound()
    const [a, watcher] = staff
    if (a === undefined || watcher === undefined) throw new Error('ids')
    const feed = (map: Map<string, Pos>) => void sim.tick(map)

    // a preps room 1; everyone else waits in the lobby (entries there convict
    // nothing — the lobby has no rooms).
    feed(positions(at(a, pos(F1, WEST_HALL))))
    feed(positions(at(a, pos(F1, CENTER))))
    expect(sim.startWork(a, F1, 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) feed(positions(at(a, pos(F1, CENTER))))

    // Saboteur walks in and starts the un-prep; a stays inside (their earlier
    // entry pre-dated the channel — no conviction), nobody else approaches.
    feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    expect(sim.startWork(saboteur, F1, 1)).toBe('accepted')
    for (let i = 0; i < 10; i++) {
      feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    }
    // Mid-channel probe tick: everyone keeps feeding positions (an absent
    // position is a walk-out — the channel would cancel harmlessly early).
    expect(
      firedOf(sim.tick(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))),
    ).toEqual([])

    // Mid-channel, watcher walks in from the west hall: instant conviction on
    // the entry tick — pass-through included, stopping is not required.
    const conviction = sim.tick(
      positions(
        at(a, pos(F1, CENTER)),
        at(saboteur, pos(F1, CENTER)),
        at(watcher, pos(F1, CENTER)),
      ),
    )
    expect(firedOf(conviction)).toEqual([
      { type: 'player:fired', playerId: saboteur, reason: 'walkin' },
    ])
    // The fired saboteur's own channel is cancelled SILENTLY (JUST-04, WORK-12):
    // no work:ended names them.
    expect(conviction.filter((e) => e.type === 'work:ended' && e.playerId === saboteur)).toEqual([])
  })

  it("never convicts the channel owner's own entry (JUST-02, FR-16)", () => {
    const { sim, saboteur } = startedRound(2)
    const a = 'p1'
    const feed = (map: Map<string, Pos>) => void sim.tick(map)
    feed(positions(at(a, pos(F1, CENTER))))
    expect(sim.startWork(a, F1, 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) feed(positions(at(a, pos(F1, CENTER))))

    // Saboteur starts the un-prep, then walks OUT (cancel, FR-16) and back IN.
    feed(positions(at(saboteur, pos(F1, CENTER))))
    expect(sim.startWork(saboteur, F1, 1)).toBe('accepted')
    feed(positions(at(saboteur, pos(F1, WEST_HALL))))
    feed(positions(at(saboteur, pos(F1, CENTER))))
    // The channel died on the walk-out tick, so re-entry is a plain entry:
    // no conviction exists for the owner, and the channel is gone anyway.
    for (let i = 0; i < 20; i++) {
      expect(firedOf(sim.tick(positions(at(saboteur, pos(F1, CENTER)))))).toEqual([])
    }
  })

  it('fires nobody on entry after the un-prep completed (JUST-03)', () => {
    const { sim, saboteur, staff } = startedRound(3)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    const feed = (map: Map<string, Pos>) => void sim.tick(map)
    feed(positions(at(a, pos(F1, CENTER))))
    expect(sim.startWork(a, F1, 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) feed(positions(at(a, pos(F1, CENTER))))

    // Saboteur completes the un-prep; a walks out.
    feed(positions(at(saboteur, pos(F1, CENTER))))
    expect(sim.startWork(saboteur, F1, 1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS; i++) {
      feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    }
    feed(positions(at(a, pos(F1, WEST_HALL))))

    // b enters the (now trashed, channel-less) room: no conviction.
    const entry = sim.tick(positions(at(b, pos(F1, CENTER))))
    expect(firedOf(entry)).toEqual([])
  })

  it('convicts when the entrant arrives on the very tick the un-prep completes (spec edge)', () => {
    const { sim, saboteur, staff } = startedRound(4)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    const feed = (map: Map<string, Pos>) => void sim.tick(map)
    feed(positions(at(a, pos(F1, CENTER))))
    expect(sim.startWork(a, F1, 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) feed(positions(at(a, pos(F1, CENTER))))

    feed(positions(at(saboteur, pos(F1, CENTER))))
    expect(sim.startWork(saboteur, F1, 1)).toBe('accepted')
    // Leave the un-prep one tick from completion, then co-time the entry.
    for (let i = 0; i < UNPREP_TICKS - 1; i++) {
      feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    }
    const last = sim.tick(
      positions(at(a, pos(F1, WEST_HALL)), at(saboteur, pos(F1, CENTER)), at(b, pos(F1, CENTER))),
    )
    // The channel was active at b's entry tick: conviction + completion, both.
    expect(firedOf(last)).toEqual([{ type: 'player:fired', playerId: saboteur, reason: 'walkin' }])
    expect(last.some((e) => e.type === 'room:trashed')).toBe(true)
  })

  it("ignores a fired player's stale position and never fires twice (JUST-04/05)", () => {
    const { sim, saboteur, staff } = startedRound(5)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    const feed = (map: Map<string, Pos>) => void sim.tick(map)
    feed(positions(at(a, pos(F1, CENTER))))
    expect(sim.startWork(a, F1, 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) feed(positions(at(a, pos(F1, CENTER))))

    feed(positions(at(saboteur, pos(F1, CENTER))))
    expect(sim.startWork(saboteur, F1, 1)).toBe('accepted')
    for (let i = 0; i < 5; i++) {
      feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    }
    // a (inside) and b (entering) on the same tick — but the channel owner
    // fires once; a's ongoing presence convicts nobody new.
    const conviction = sim.tick(
      positions(
        at(a, pos(F1, CENTER)),
        at(b, pos(F1, CENTER)),
        // The room tear-down may race one stale position from the fired
        // saboteur — it must be ignored, not re-processed.
        at(saboteur, pos(F1, CENTER)),
      ),
    )
    expect(firedOf(conviction)).toHaveLength(1)
    // Subsequent ticks with the fired player's position still streaming:
    // no further justice events, no work processing on their behalf.
    for (let i = 0; i < 10; i++) {
      const events = sim.tick(
        positions(at(a, pos(F1, CENTER)), at(b, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))),
      )
      expect(firedOf(events)).toEqual([])
      expect(events.some((e) => e.type === 'work:started' && e.playerId === saboteur)).toBe(false)
    }
  })
})

describe('justice:grace', () => {
  // JUST-07/08 prep (pin): noteSabotage flips the hidden grace flag exactly
  // once — re-notifications (re-trashing) cannot un-flip it.
  it('marks the grace ended on the first sabotage and stays ended (hidden state)', () => {
    const justice = new Justice(
      new Map([
        ['p1', 'staff'],
        ['p2', 'saboteur'],
      ]),
    )
    expect(justice.graceEnded).toBe(false)
    justice.noteSabotage()
    expect(justice.graceEnded).toBe(true)
    justice.noteSabotage()
    expect(justice.graceEnded).toBe(true)
  })

  it('rejects a deal without exactly one saboteur (deal invariant)', () => {
    expect(
      () =>
        new Justice(
          new Map([
            ['p1', 'staff'],
            ['p2', 'staff'],
          ] as const),
        ),
    ).toThrow()
    expect(
      () =>
        new Justice(
          new Map([
            ['p1', 'saboteur'],
            ['p2', 'saboteur'],
          ]),
        ),
    ).toThrow()
  })
})

// Spec JUST-06..11 (gate scenario sim:accuse, FR-17/18/19) + JUST-12..15
// (sim:firing_toast): accusations resolve with hidden grace; every firing is
// a name-only event. Positions are movement-layer millitiles.

/** Drives a prep → un-prep cycle in room 1 and returns both players' spots. */
function roomWithTrashedRoom1(sim: RoundSim, staff: string, saboteur: string): void {
  const feed = (map: Map<string, Pos>) => void sim.tick(map)
  feed(positions(at(staff, pos(F1, CENTER))))
  expect(sim.startWork(staff, F1, 1)).toBe('accepted')
  for (let i = 0; i < PREP_TICKS; i++) feed(positions(at(staff, pos(F1, CENTER))))
  feed(positions(at(staff, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
  expect(sim.startWork(saboteur, F1, 1)).toBe('accepted')
  let lastTickEvents: SimEvent[] = []
  for (let i = 0; i < UNPREP_TICKS; i++) {
    lastTickEvents = [
      ...sim.tick(positions(at(staff, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER)))),
    ]
  }
  // Grace has ended: the un-prep completed (the trash transition is the
  // grace-end signal — design pin).
  expect(lastTickEvents.some((e) => e.type === 'room:trashed')).toBe(true)
}

describe('sim:accuse', () => {
  it('fires the saboteur on a correct post-grace accusation (JUST-07, FR-19)', () => {
    const { sim, saboteur, staff } = startedRound(11)
    const a = staff[0]
    if (a === undefined) throw new Error('ids')
    roomWithTrashedRoom1(sim, a, saboteur)

    // a stands within range of the saboteur and accuses: resolved.
    expect(sim.accuse(a, saboteur)).toBe('resolved')
    const fired = firedOf(
      sim.tick(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER)))),
    )
    expect(fired).toEqual([
      { type: 'player:fired', playerId: saboteur, reason: 'correct-accusation' },
    ])
  })

  it('fires the ACCUSER on an innocent target (JUST-08, FR-18)', () => {
    const { sim, saboteur, staff } = startedRound(12)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    // No sabotage has completed: grace is irrelevant for an innocent target.
    sim.tick(positions(at(a, pos(F1, 2100)), at(b, pos(F1, 2400))))
    // a is mid-prep when they accuse: firing them cancels the channel
    // silently (JUST-11 — no work:ended, no trace).
    expect(sim.startWork(a, F1, 1)).toBe('accepted')
    sim.tick(positions(at(a, pos(F1, 2100)), at(b, pos(F1, 2400))))
    expect(sim.accuse(a, b)).toBe('resolved')
    const fired = firedOf(sim.tick(positions(at(a, pos(F1, 2100)), at(b, pos(F1, 2400)))))
    expect(fired).toEqual([{ type: 'player:fired', playerId: a, reason: 'wrong-accusation' }])
    expect(
      sim
        .tick(positions(at(a, pos(F1, 2100)), at(b, pos(F1, 2400))))
        .filter((e) => e.type === 'work:ended' && e.playerId === a),
    ).toEqual([])
    void saboteur
  })

  it('fires the accuser on the in-grace saboteur with a byte-identical payload shape (JUST-08)', () => {
    const { sim, saboteur, staff } = startedRound(13)
    const a = staff[0]
    if (a === undefined) throw new Error('ids')
    // The saboteur stands nearby but has NEVER completed an un-prep.
    sim.tick(positions(at(a, pos(F1, 1100)), at(saboteur, pos(F1, 1400))))
    expect(sim.accuse(a, saboteur)).toBe('resolved')
    const fired = firedOf(sim.tick(positions(at(a, pos(F1, 1100)), at(saboteur, pos(F1, 1400)))))
    expect(fired).toEqual([{ type: 'player:fired', playerId: a, reason: 'wrong-accusation' }])
    // Byte-identical shape to the innocent case — the wire can never tell
    // "innocent" from "in grace" (FR-18 hidden-grace rule).
    expect(Object.keys(fired[0] ?? {}).sort()).toEqual(['playerId', 'reason', 'type'])
  })

  it('rejects every ineligible accusation without firing anybody (JUST-09)', () => {
    const { sim, saboteur, staff } = startedRound(14)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')

    // Lobby phase: the sim has not started ticking positions — but the round
    // starts on the first tick, so consume it first for live-phase edges.
    const fresh = new RoundSim({ seed: 14, playerIds: IDS })
    expect(fresh.accuse(a, b)).toBe('round-not-active')
    fresh.tick()

    // Saboteur accuser.
    expect(sim.accuse(saboteur, a)).toBe('accuser-is-saboteur')
    // Self-target.
    expect(sim.accuse(a, a)).toBe('self-target')
    // Unknown target.
    expect(sim.accuse(a, 'nobody')).toBe('target-not-live')
    // Other floor / out of range: a on floor1, b on floor2.
    sim.tick(positions(at(a, pos(F1, CENTER)), at(b, pos('floor2' as GuestFloorId, CENTER))))
    expect(sim.accuse(a, b)).toBe('out-of-range')
    // Range is inclusive: exactly 2000 milli resolves — wait: resolving fires
    // somebody, so probe the boundary with a rejection at 2001 only.
    sim.tick(positions(at(a, pos(F1, 1000)), at(b, pos(F1, 3001))))
    expect(sim.accuse(a, b)).toBe('out-of-range')
    expect(firedOf(sim.tick(new Map()))).toEqual([])
  })

  it('accepts the inclusive range boundary (exactly ACCUSATION_RANGE_TILES)', () => {
    const { sim, staff } = startedRound(15)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    sim.tick(positions(at(a, pos(F1, 1000)), at(b, pos(F1, 3000))))
    expect(sim.accuse(a, b)).toBe('resolved')
    const fired = firedOf(sim.tick(new Map()))
    expect(fired).toEqual([{ type: 'player:fired', playerId: a, reason: 'wrong-accusation' }])
  })

  it('rejects after the buzzer and after the accuser was fired (JUST-09)', () => {
    const { sim, saboteur, staff } = startedRound(16)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    // A wrong accusation fires a: their next accusation is rejected.
    sim.tick(positions(at(a, pos(F1, 1000)), at(b, pos(F1, 1200))))
    expect(sim.accuse(a, b)).toBe('resolved')
    sim.tick(positions(at(a, pos(F1, 1000)), at(b, pos(F1, 1200))))
    expect(sim.accuse(a, saboteur)).toBe('accuser-not-live')

    // Buzzer: a shortened round (AD-004) runs dry; accusations die with it.
    const short = new RoundSim({ seed: 16, playerIds: IDS, totalTicks: 5 })
    for (let i = 0; i < 5; i++) short.tick()
    expect(short.accuse(a, b)).toBe('round-not-active')
  })

  it('resolves simultaneous accusations exactly once (spec edge)', () => {
    const { sim, saboteur, staff } = startedRound(17)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    roomWithTrashedRoom1(sim, a, saboteur)
    // Both accuse the (post-grace) saboteur in the same inter-tick window:
    // the first resolves, the second targets an already-fired player.
    expect(sim.accuse(a, saboteur)).toBe('resolved')
    expect(sim.accuse(b, saboteur)).toBe('target-not-live')
    const fired = firedOf(sim.tick(new Map()))
    expect(fired).toHaveLength(1)
  })
})

describe('sim:firing_toast', () => {
  it('emits exactly one name-only firing per resolution on every path (JUST-12..15)', () => {
    // Path 1: walk-in.
    const walk = startedRound(18)
    const a = walk.staff[0]
    const b = walk.staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    walk.sim.tick(positions(at(a, pos(F1, CENTER))))
    expect(walk.sim.startWork(a, F1, 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) walk.sim.tick(positions(at(a, pos(F1, CENTER))))
    walk.sim.tick(positions(at(a, pos(F1, CENTER)), at(walk.saboteur, pos(F1, CENTER))))
    expect(walk.sim.startWork(walk.saboteur, F1, 1)).toBe('accepted')
    walk.sim.tick(positions(at(a, pos(F1, CENTER)), at(walk.saboteur, pos(F1, CENTER))))
    const walkEvents = walk.sim.tick(
      positions(at(a, pos(F1, CENTER)), at(walk.saboteur, pos(F1, CENTER)), at(b, pos(F1, CENTER))),
    )
    expect(firedOf(walkEvents)).toHaveLength(1)
    expect(firedOf(walkEvents)[0]).toEqual({
      type: 'player:fired',
      playerId: walk.saboteur,
      reason: 'walkin',
    })

    // Path 2: wrong accusation (innocent target).
    const wrong = startedRound(19)
    const wa = wrong.staff[0]
    const wb = wrong.staff[1]
    if (wa === undefined || wb === undefined) throw new Error('ids')
    wrong.sim.tick(positions(at(wa, pos(F1, 1100)), at(wb, pos(F1, 1400))))
    expect(wrong.sim.accuse(wa, wb)).toBe('resolved')
    const wrongEvents = firedOf(
      wrong.sim.tick(positions(at(wa, pos(F1, 1100)), at(wb, pos(F1, 1400)))),
    )
    expect(wrongEvents).toHaveLength(1)

    // Path 3: correct accusation (post-grace saboteur).
    const right = startedRound(20)
    const ra = right.staff[0]
    if (ra === undefined) throw new Error('ids')
    roomWithTrashedRoom1(right.sim, ra, right.saboteur)
    expect(right.sim.accuse(ra, right.saboteur)).toBe('resolved')
    const rightEvents = firedOf(right.sim.tick(new Map()))
    expect(rightEvents).toHaveLength(1)

    // Shape audit across all three paths: the sim event carries only the
    // player and the internal reason — the registry projection (registry
    // tests, T1) strips the reason, so the wire payload is {playerId} exactly.
    for (const event of [...wrongEvents, ...rightEvents]) {
      expect(Object.keys(event).sort()).toEqual(['playerId', 'reason', 'type'])
      expect((event as { reason: string }).reason).not.toContain('grace')
    }
  })
})

// Verifier Gap 1 fix (sensor survivor): grace must flip on un-prep COMPLETION
// (`room:trashed`), not on channel start — an accusation landing mid-channel
// is still in-grace and fires the accuser.
describe('sim:accuse — grace boundary', () => {
  it('treats a mid-un-prep accusation as in-grace (accuser fired), then correct after completion', () => {
    const { sim, saboteur, staff } = startedRound(21)
    const a = staff[0]
    if (a === undefined) throw new Error('ids')
    const feed = (map: Map<string, Pos>) => void sim.tick(map)
    feed(positions(at(a, pos(F1, CENTER))))
    expect(sim.startWork(a, F1, 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) feed(positions(at(a, pos(F1, CENTER))))

    // Saboteur STARTS the un-prep — grace has NOT ended yet.
    feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    expect(sim.startWork(saboteur, F1, 1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS - 1; i++) {
      feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    }
    // a accuses one tick BEFORE completion: wrong, the accuser fires.
    expect(sim.accuse(a, saboteur)).toBe('resolved')
    const wrong = firedOf(
      sim.tick(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER)))),
    )
    expect(wrong).toEqual([{ type: 'player:fired', playerId: a, reason: 'wrong-accusation' }])
  })

  it('fires the saboteur when the accusation lands on the completion tick (grace ends exactly there)', () => {
    const { sim, saboteur, staff } = startedRound(22)
    const a = staff[0]
    const b = staff[1]
    if (a === undefined || b === undefined) throw new Error('ids')
    const feed = (map: Map<string, Pos>) => void sim.tick(map)
    feed(positions(at(a, pos(F1, CENTER))))
    expect(sim.startWork(a, F1, 1)).toBe('accepted')
    for (let i = 0; i < PREP_TICKS; i++) feed(positions(at(a, pos(F1, CENTER))))
    feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    expect(sim.startWork(saboteur, F1, 1)).toBe('accepted')
    for (let i = 0; i < UNPREP_TICKS; i++) {
      feed(positions(at(a, pos(F1, CENTER)), at(saboteur, pos(F1, CENTER))))
    }
    // The un-prep has now COMPLETED: the next accusation is correct.
    expect(sim.accuse(a, saboteur)).toBe('resolved')
    const correct = firedOf(sim.tick(new Map()))
    expect(correct).toEqual([
      { type: 'player:fired', playerId: saboteur, reason: 'correct-accusation' },
    ])
    void b
  })
})
