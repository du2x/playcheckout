import { describe, expect, it } from 'vitest'
import {
  accuseTargetAtHoldExpiry,
  carriedGuestIdOf,
  doorInRange,
  doorRoomAt,
  inAccuseRange,
  inDeskZone,
  nearestInAccuseRange,
  nearestRestingSuitcase,
  onLanding,
  resolveEKeydown,
  resolveEKeyup,
  type SuitcaseRef,
} from './affordances'

import { type RoomIndex, roomDoorXMilli } from './layout'
import type { FloorId } from './protocol/messages'

const pos = (floor: FloorId, x: number) => ({ floor, x })

const sc = (
  id: string,
  rest: { floor: FloorId; room: RoomIndex } | null,
  carrierId: string | null = null,
): SuitcaseRef => ({ id, carrierId, rest })

// Room doors: room N's doorway x. Room 4 and room 2 are used with real
// geometry from layout (segment centers), so boundaries are derived, not
// hand-pinned: door±(RANGE) is in, door±(RANGE+ε) is out.
const doorX = (room: RoomIndex) => roomDoorXMilli(room) / 1000

describe('inDeskZone', () => {
  it('is the desk x ± DESK_RANGE_TILES on the lobby, inclusive', () => {
    const r = 1 // DESK_RANGE_TILES
    expect(inDeskZone(pos('lobby', 15 - r))).toBe(true)
    expect(inDeskZone(pos('lobby', 15 + r))).toBe(true)
    expect(inDeskZone(pos('lobby', 15 - r - 0.001))).toBe(false)
    expect(inDeskZone(pos('lobby', 15 + r + 0.001))).toBe(false)
  })
  it('is false off the lobby', () => {
    expect(inDeskZone(pos('floor1', 15))).toBe(false)
    expect(inDeskZone(pos('mezzanine', 15))).toBe(false)
  })
})

describe('onLanding', () => {
  it('covers the car landings (x≈0 west, x≈30 east) within 1 tile', () => {
    expect(onLanding(0)).toBe(true)
    expect(onLanding(1)).toBe(true)
    expect(onLanding(1.001)).toBe(false)
    expect(onLanding(29)).toBe(true)
    expect(onLanding(30)).toBe(true)
    expect(onLanding(15)).toBe(false)
  })
})

describe('doorRoomAt', () => {
  it('returns the room whose doorway the position stands at', () => {
    expect(doorRoomAt(pos('floor1', doorX(4)))).toBe(4)
    expect(doorRoomAt(pos('floor2', doorX(2) + 1))).toBe(2)
  })
  it('is null outside every door zone', () => {
    expect(doorRoomAt(pos('floor1', 0.5))).toBeNull()
  })
  it('is null on the lobby and the mezzanine — no room doors there (REST-05)', () => {
    expect(doorRoomAt(pos('lobby', doorX(4)))).toBeNull()
    expect(doorRoomAt(pos('mezzanine', doorX(4)))).toBeNull()
  })
})

describe('doorInRange', () => {
  it('is the door x ± ROOM_DOOR_RANGE_TILES, inclusive', () => {
    expect(doorInRange(doorX(4) - 1, 4)).toBe(true)
    expect(doorInRange(doorX(4) + 1, 4)).toBe(true)
    expect(doorInRange(doorX(4) + 1.001, 4)).toBe(false)
  })
})

describe('inAccuseRange', () => {
  it('is same floor within ACCUSATION_RANGE_TILES, inclusive', () => {
    expect(inAccuseRange(pos('floor1', 10), pos('floor1', 12))).toBe(true)
    expect(inAccuseRange(pos('floor1', 10), pos('floor1', 12.001))).toBe(false)
    expect(inAccuseRange(pos('floor1', 10), pos('floor2', 10))).toBe(false)
  })
})

describe('nearestInAccuseRange', () => {
  it('picks the nearest in-range candidate and skips out-of-range', () => {
    const own = pos('floor1', 10)
    const near = { id: 'near', ...pos('floor1', 10.5) }
    const far = { id: 'far', ...pos('floor1', 10.9) }
    const offFloor = { id: 'off', ...pos('floor2', 10) }
    expect(nearestInAccuseRange(own, [far, near, offFloor])?.id).toBe('near')
  })
  it('returns undefined with no in-range candidate', () => {
    expect(
      nearestInAccuseRange(pos('floor1', 0), [{ id: 'x', ...pos('floor1', 10) }]),
    ).toBeUndefined()
  })
})

describe('nearestRestingSuitcase', () => {
  it('filters by floor and range', () => {
    const own = pos('floor1', doorX(4))
    expect(nearestRestingSuitcase(own, [sc('guest:1', { floor: 'floor2', room: 4 })])).toBeNull()
    expect(nearestRestingSuitcase(own, [sc('guest:1', { floor: 'floor1', room: 8 })])).toBeNull()
    expect(nearestRestingSuitcase(own, [sc('guest:1', { floor: 'floor1', room: 4 })])).toBe(
      'guest:1',
    )
  })
  it('resolves ties to the lowest guest ordinal (SUI-08)', () => {
    // Two doors equidistant is unreachable (zones are disjoint); tie instead
    // via exact same-door rests in two refs.
    const own = pos('floor1', doorX(4))
    expect(
      nearestRestingSuitcase(own, [
        sc('guest:7', { floor: 'floor1', room: 4 }),
        sc('guest:3', { floor: 'floor1', room: 4 }),
      ]),
    ).toBe('guest:3')
  })
  it('carries are not resting and never match', () => {
    expect(nearestRestingSuitcase(pos('floor1', doorX(4)), [sc('guest:1', null, 'p1')])).toBeNull()
  })
})

describe('carriedGuestIdOf', () => {
  it('returns the guest whose suitcase the player carries', () => {
    const s = [sc('guest:2', null, 'p9'), sc('guest:1', { floor: 'floor1', room: 4 })]
    expect(carriedGuestIdOf(s, 'p9')).toBe('guest:2')
    expect(carriedGuestIdOf(s, 'p1')).toBeNull()
  })
})

describe('resolveEKeydown — the SUI-25 ladder', () => {
  const base = { selfFired: false, playerId: 'p1' }
  const atDoor = pos('floor1', doorX(4))

  it('desk first — even while carrying at a door', () => {
    const facts = {
      ...base,
      own: pos('lobby', 15),
      suitcases: [sc('guest:1', null, 'p1')],
    }
    expect(resolveEKeydown(facts)).toEqual({ kind: 'desk' })
  })

  it('place when carrying at a room door', () => {
    const facts = { ...base, own: atDoor, suitcases: [sc('guest:1', null, 'p1')] }
    expect(resolveEKeydown(facts)).toEqual({ kind: 'place', room: 4 })
  })

  it('hold when carrying but not at a door — carrying blocks pickup', () => {
    const facts = {
      ...base,
      own: pos('floor1', 15),
      suitcases: [sc('guest:1', { floor: 'floor1', room: 4 }, 'p1')],
    }
    expect(resolveEKeydown(facts)).toEqual({ kind: 'hold' })
  })

  it('pickup when not carrying near a resting suitcase', () => {
    const facts = {
      ...base,
      own: atDoor,
      suitcases: [sc('guest:1', { floor: 'floor1', room: 4 }, null)],
    }
    expect(resolveEKeydown(facts)).toEqual({ kind: 'pickup' })
  })

  it('hold otherwise', () => {
    const facts = { ...base, own: pos('lobby', 20), suitcases: [] }
    expect(resolveEKeydown(facts)).toEqual({ kind: 'hold' })
  })

  it('none when self-fired or position unknown — riders have no floor, so own is null (AD-009)', () => {
    const own = atDoor
    const s = [sc('guest:1', { floor: 'floor1', room: 4 }, 'p1')]
    expect(resolveEKeydown({ ...base, selfFired: true, own, suitcases: s })).toEqual({
      kind: 'none',
    })
    expect(resolveEKeydown({ ...base, own: null, suitcases: s })).toEqual({ kind: 'none' })
  })
})

describe('resolveEKeyup — the JUST-17 swallow rule', () => {
  it('sends the elevator call on a landing', () => {
    expect(resolveEKeyup({ selfFired: false, riding: false, own: pos('lobby', 0.5) })).toEqual({
      kind: 'elevatorCall',
    })
  })
  it('is none mid-hall', () => {
    expect(resolveEKeyup({ selfFired: false, riding: false, own: pos('lobby', 15) })).toEqual({
      kind: 'none',
    })
  })
  it('is none when self-fired, riding, or position unknown', () => {
    expect(resolveEKeyup({ selfFired: true, riding: false, own: pos('lobby', 0.5) })).toEqual({
      kind: 'none',
    })
    expect(resolveEKeyup({ selfFired: false, riding: true, own: pos('lobby', 0.5) })).toEqual({
      kind: 'none',
    })
    expect(resolveEKeyup({ selfFired: false, riding: false, own: null })).toEqual({ kind: 'none' })
  })
})

describe('accuseTargetAtHoldExpiry', () => {
  it('returns the nearest candidate for a standing player', () => {
    const own = pos('floor1', 10)
    const c = [{ id: 'p2', ...pos('floor1', 10.5) }]
    expect(accuseTargetAtHoldExpiry(false, own, c)?.id).toBe('p2')
  })
  it('is undefined while riding or without a position', () => {
    expect(accuseTargetAtHoldExpiry(true, pos('lobby', 10), [])).toBeUndefined()
    expect(accuseTargetAtHoldExpiry(false, null, [])).toBeUndefined()
  })
})
