import { roomDoorXMilli } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { applyMessage, type BotWorld, newBotWorld } from './botPlayer.js'
import { navigate, newBotMemory, saboteurDecide, staffDecide } from './policies.js'

/**
 * Cheap deterministic gates for the bot layer (the expensive full-round smoke
 * stays OUT of the ladder): the wire-fed model and the pure policies, fed
 * fabricated registry payloads — no sockets, no timers.
 */

const NOW = 1_000_000

function door(room: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
  return roomDoorXMilli(room) / 1000
}

function base(over: Partial<BotWorld> = {}): BotWorld {
  const world = newBotWorld('bot-ada', 'a', 90)
  world.role = 'staff'
  world.phase = 'round'
  world.roster = ['a']
  world.floor = 'floor1'
  world.x = 15
  return Object.assign(world, over)
}

describe('server:bot_model', () => {
  it('mirrors own kinematics from snapshots and the same-floor stream', () => {
    const world = newBotWorld('bot-ada', 'a', 90)
    applyMessage(world, 'movement:snapshot', {
      players: [{ playerId: 'a', floor: 'lobby', x: 12.5 }],
      cars: [{ car: 1, floor: 'lobby' }],
      cardedRooms: [2, 3],
    })
    expect(world.floor).toBe('lobby')
    expect(world.x).toBe(12.5)
    expect(world.riding).toBe(false)
    applyMessage(world, 'player:moved', { playerId: 'a', floor: 'lobby', x: 13 })
    expect(world.x).toBe(13)
    applyMessage(world, 'player:left-floor', { playerId: 'a', floor: 'lobby' })
    expect(world.floor).toBeNull()
    expect(world.x).toBeNull()
  })

  it('reads the own stairs row as floorless transit and extends it on a stun', () => {
    const world = newBotWorld('bot-ada', 'a', 90)
    applyMessage(
      world,
      'movement:snapshot',
      {
        players: [],
        cars: [],
        cardedRooms: [],
        stairs: { from: 'lobby', to: 'floor1', phase: 'transit', remainingSeconds: 3 },
      },
      NOW,
    )
    expect(world.floor).toBeNull()
    expect(world.stairs?.to).toBe('floor1')
    expect(world.stairs?.freeAtMs).toBe(NOW + (3 + 2) * 1000) // transit + breath
    applyMessage(world, 'stairs:ambushed', { playerId: 'a', stunSeconds: 20 }, NOW)
    expect(world.stairs?.freeAtMs).toBe(NOW + 5000 + 20_000)
  })

  it('derives queue, assignments, settle set, and churn trash from guest lines', () => {
    const world = newBotWorld('bot-ada', 'a', 90)
    applyMessage(world, 'guest:arrived', { guestId: 'g1' })
    expect(world.queueCount).toBe(1)
    applyMessage(world, 'guest:assigned', { guestId: 'g1', floor: 'floor1', room: 3 })
    expect(world.queueCount).toBe(0)
    expect(world.assignments.get('g1')).toEqual({ floor: 'floor1', room: 3 })
    applyMessage(world, 'guest:settled', { guestId: 'g1', floor: 'floor1', room: 3 })
    expect(world.settledGuests.has('g1')).toBe(true)
    applyMessage(world, 'guest:checked_out', { guestId: 'g1', floor: 'floor1', room: 3 })
    expect(world.settledGuests.has('g1')).toBe(false)
    expect(world.roomStates.get('floor1:3')).toBe('settled') // checkout churn = work
  })

  it('tracks the own carry through carried/placed', () => {
    const world = newBotWorld('bot-ada', 'a', 90)
    applyMessage(world, 'suitcase:carried', { guestId: 'g2', carrierId: 'a' })
    expect(world.carryGuest).toBe('g2')
    applyMessage(world, 'suitcase:placed', { guestId: 'g2', floor: 'floor2', room: 5 })
    expect(world.carryGuest).toBeNull()
    expect(world.resting.get('g2')).toEqual({ floor: 'floor2', room: 5 })
  })
})

describe('server:bot_staff_policy', () => {
  it('places the carried suitcase at the assigned room door', () => {
    const memory = newBotMemory()
    const world = base({ carryGuest: 'g1', x: door(3) })
    world.assignments.set('g1', { floor: 'floor1', room: 3 })
    expect(staffDecide(world, memory, NOW)).toEqual({ type: 'suitcase:place', room: 3 })
  })

  it('walks west toward the stairwell when the assignment is upstairs', () => {
    const memory = newBotMemory()
    const world = base({ carryGuest: 'g1', floor: 'floor1' })
    world.assignments.set('g1', { floor: 'floor3', room: 3 })
    expect(staffDecide(world, memory, NOW)).toEqual({ type: 'move:start', dir: 'left' })
  })

  it('answers a waiting queue at the desk zone', () => {
    const memory = newBotMemory()
    const world = base({ floor: 'lobby', x: 15.2, queueCount: 1 })
    expect(staffDecide(world, memory, NOW)).toEqual({ type: 'desk:interact' })
  })

  it('starts the prep channel at an adopted trashed room', () => {
    const memory = newBotMemory()
    const world = base({ x: door(3) })
    world.roomStates.set('floor1:3', 'trashed')
    expect(staffDecide(world, memory, NOW)).toEqual({
      type: 'work:start',
      floor: 'floor1',
      room: 3,
    })
  })

  it('stops before working — a held walk walks out and cancels the channel', () => {
    const memory = newBotMemory()
    const world = base({ x: door(3), moving: 'right' })
    world.roomStates.set('floor1:3', 'trashed')
    expect(staffDecide(world, memory, NOW)).toEqual({ type: 'move:stop' })
    world.moving = null
    expect(staffDecide(world, memory, NOW + 200)).toEqual({
      type: 'work:start',
      floor: 'floor1',
      room: 3,
    })
  })

  it('re-issues holds only on change (wire intents are hold-to-walk)', () => {
    const memory = newBotMemory()
    const world = base({ moving: 'left' })
    expect(staffDecide(world, memory, NOW)).toBeNull() // patrol west already held
  })

  it('rides the panel: queues the floor, hops off through open doors', () => {
    const memory = newBotMemory()
    const world = base({ riding: true, floor: null, x: null, carryGuest: 'g1' })
    world.assignments.set('g1', { floor: 'floor2', room: 2 })
    world.carFloor = 'floor2'
    world.carDoorsOpen = false
    expect(staffDecide(world, memory, NOW)).toEqual({ type: 'elevator:press', floor: 'floor2' })
    world.carDoorsOpen = true
    expect(staffDecide(world, memory, NOW)).toEqual({ type: 'move:start', dir: 'left' })
  })

  it('falls back to the car after a silent stairs rejection', () => {
    const memory = newBotMemory()
    const world = base({ x: 0.5 }) // at the mouth, work known upstairs
    world.roomStates.set('floor2:4', 'trashed')
    expect(staffDecide(world, memory, NOW)).toEqual({ type: 'stairs:enter', dir: 'up' })
    expect(staffDecide(world, memory, NOW + 1000)).toEqual({ type: 'elevator:call' })
  })

  it('skips cross-floor desk duty — the free self-assign outranks the commute', () => {
    const memory = newBotMemory()
    const world = base({ x: door(3), queueCount: 1 }) // floor1, guests waiting downstairs
    expect(staffDecide(world, memory, NOW)).toEqual({ type: 'move:start', dir: 'right' }) // patrol/work continues
  })

  it('enters the stairs toward the target floor', () => {
    const memory = newBotMemory()
    const world = base({ floor: 'lobby', x: 0.5, queueCount: 0 })
    world.roomStates.set('floor2:4', 'trashed')
    const intent = navigate(world, memory, { floor: 'floor2', room: 4 }, NOW)
    expect(intent).toEqual({ type: 'stairs:enter', dir: 'up' })
  })
})

describe('server:bot_saboteur_policy', () => {
  it('un-preps a known card it stands at', () => {
    const memory = newBotMemory()
    const world = base({ role: 'saboteur', x: door(3) })
    world.cards.add('floor1:3')
    expect(saboteurDecide(world, memory, NOW)).toEqual({
      type: 'work:start',
      floor: 'floor1',
      room: 3,
    })
  })

  it('prefers the room an assigned-not-settled guest is heading to', () => {
    const memory = newBotMemory()
    const world = base({ role: 'saboteur', x: 13 })
    world.cards.add('floor1:1')
    world.cards.add('floor1:7')
    world.assignments.set('g1', { floor: 'floor1', room: 7 })
    expect(saboteurDecide(world, memory, NOW)).toEqual({ type: 'move:start', dir: 'right' }) // toward room 7
    world.x = door(7)
    expect(saboteurDecide(world, memory, NOW)).toEqual({
      type: 'work:start',
      floor: 'floor1',
      room: 7,
    })
  })

  it('blitz: with the shift ending it chases the nearest card instead', () => {
    const memory = newBotMemory()
    const world = base({ role: 'saboteur', x: 13, roundStartedAtMs: NOW - 85_000 })
    world.cards.add('floor1:1')
    world.cards.add('floor1:7')
    world.assignments.set('g1', { floor: 'floor1', room: 7 })
    expect(saboteurDecide(world, memory, NOW)).toEqual({ type: 'move:start', dir: 'left' }) // room 1 is nearer
  })

  it('patrols when no card is known', () => {
    const memory = newBotMemory()
    const world = base({ role: 'saboteur' })
    const intent = saboteurDecide(world, memory, NOW)
    expect(intent).toEqual({ type: 'move:start', dir: 'left' }) // west toward the patrol door
  })
})
