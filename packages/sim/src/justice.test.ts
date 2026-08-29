import type { GuestFloorId, SimEvent } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { Justice } from './justice.js'
import { RoundSim } from './roundSim.js'
import { PREP_TICKS, UNPREP_TICKS } from './work.js'

// Spec JUST-01..05 (gate scenario sim:walkin_conviction, FR-15/FR-16): scripted
// positions over the pure round sim. Positions are integer millitiles; AD-010
// room 1 on any guest floor spans [1000, 4500), room 2 [4500, 8000).

const CENTER = 2750 // inside room 1
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
