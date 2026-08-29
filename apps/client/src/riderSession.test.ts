import type { MovementSnapshot } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { initialRiderSession, reduceRider } from './riderSession'

const OWN = 'p1'

function ridersAction(
  overrides: Partial<Parameters<typeof reduceRider>[1] & { type: 'elevator-riders' }> = {},
) {
  return {
    type: 'elevator-riders' as const,
    car: 1 as const,
    riders: [OWN, 'p2'],
    queue: ['floor2' as const],
    ...overrides,
  }
}

function movementSnapshot(carOccupants: MovementSnapshot['carOccupants']): MovementSnapshot {
  return { players: [], cars: [], cardedRooms: [], carOccupants } as MovementSnapshot
}

function riding() {
  return reduceRider(initialRiderSession(), ridersAction(), OWN)
}

// Rider session (AD-013): one pure derivation of the local player's in-car
// state — boarding, walk-off, press queue, resync — previously derived twice
// (App chip + scene keymap gate).
describe('rider session reducer', () => {
  it('boards on the own id in an elevator:riders event (fresh: no press testimony)', () => {
    expect(reduceRider(null, ridersAction(), OWN)).toEqual({
      car: 1,
      occupants: [OWN, 'p2'],
      queue: ['floor2'],
      lastPress: null,
    })
  })

  it('keeps press testimony on an occupancy refresh but clears it on fresh boarding', () => {
    const aboard = riding()
    const pressed = reduceRider(
      aboard,
      { type: 'elevator-pressed', playerId: 'p2', floor: 'floor3' },
      OWN,
    )
    expect(pressed?.lastPress).toEqual({ playerId: 'p2', floor: 'floor3' })
    const refreshed = reduceRider(pressed, ridersAction(), OWN)
    expect(refreshed?.lastPress).toEqual({ playerId: 'p2', floor: 'floor3' })
    expect(reduceRider(null, ridersAction(), OWN)?.lastPress).toBeNull()
  })

  it('walks off when the own id leaves the car we ride', () => {
    expect(reduceRider(riding(), ridersAction({ riders: ['p2'] }), OWN)).toBeNull()
  })

  it('ignores riders events for a car we are not riding', () => {
    const aboard = riding()
    expect(reduceRider(aboard, ridersAction({ car: 2, riders: ['p2'], queue: [] }), OWN)).toBe(
      aboard,
    )
  })

  it('exits on the own player:moved (floor stream resumes off a car)', () => {
    expect(
      reduceRider(
        riding(),
        { type: 'player-moved', playerId: OWN, floor: 'floor1', x: 5, facing: 'right' },
        OWN,
      ),
    ).toBeNull()
  })

  it('ignores other players\u2019 player:moved events', () => {
    const aboard = riding()
    expect(
      reduceRider(
        aboard,
        { type: 'player-moved', playerId: 'p2', floor: 'lobby', x: 4, facing: 'left' },
        OWN,
      ),
    ).toBe(aboard)
  })

  it('accumulates presses into the queue, deduped, with last-press testimony', () => {
    const first = reduceRider(
      riding(),
      { type: 'elevator-pressed', playerId: 'p2', floor: 'floor3' },
      OWN,
    )
    expect(first?.queue).toEqual(['floor2', 'floor3'])
    const duplicate = reduceRider(
      first,
      { type: 'elevator-pressed', playerId: 'p2', floor: 'floor3' },
      OWN,
    )
    expect(duplicate?.queue).toEqual(['floor2', 'floor3'])
    expect(duplicate?.lastPress).toEqual({ playerId: 'p2', floor: 'floor3' })
  })

  it('drops off-car press testimony (the chip is hidden while not riding)', () => {
    expect(
      reduceRider(null, { type: 'elevator-pressed', playerId: 'p2', floor: 'floor3' }, OWN),
    ).toBeNull()
  })

  it('removes a served floor from the own car\u2019s queue on elevator:moved', () => {
    const aboard = reduceRider(
      riding(),
      { type: 'elevator-pressed', playerId: 'p2', floor: 'floor3' },
      OWN,
    )
    const served = reduceRider(aboard, { type: 'elevator-moved', car: 1, floor: 'floor2' }, OWN)
    expect(served?.queue).toEqual(['floor3'])
  })

  it('ignores elevator:moved for another car', () => {
    const aboard = reduceRider(
      riding(),
      { type: 'elevator-pressed', playerId: 'p2', floor: 'floor2' },
      OWN,
    )
    expect(reduceRider(aboard, { type: 'elevator-moved', car: 2, floor: 'floor2' }, OWN)).toBe(
      aboard,
    )
  })

  it('resyncs from a movement snapshot: carOccupants present = riding, absent = null', () => {
    expect(
      reduceRider(
        null,
        {
          type: 'movement-snapshot',
          snapshot: movementSnapshot({ car: 2, riders: [OWN], queue: [] }),
        },
        OWN,
      ),
    ).toEqual({ car: 2, occupants: [OWN], queue: [], lastPress: null })
    expect(
      reduceRider(
        riding(),
        { type: 'movement-snapshot', snapshot: movementSnapshot(undefined) },
        OWN,
      ),
    ).toBeNull()
  })

  it('returns the same reference when nothing changed', () => {
    const aboard = riding()
    const action = { type: 'elevator-called', floor: 'lobby', car: 1 } as const
    expect(reduceRider(aboard, action, OWN)).toBe(aboard)
    expect(reduceRider(null, action, OWN)).toBeNull()
  })

  it('matches no rider fact before the own id is known', () => {
    expect(reduceRider(null, ridersAction(), undefined)).toBeNull()
  })
})
