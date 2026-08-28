import { describe, expect, it } from 'vitest'
import { FLOOR_IDS } from '../layout.js'
import { ROLES } from '../roles.js'
import { elevatorCallIntentSchema, elevatorPressIntentSchema } from './intents.js'
import {
  type LobbySnapshot,
  lobbyStartIntentSchema,
  type RoleDealt,
  type RoundStarted,
} from './messages.js'
import { PROTOCOL_REGISTRY } from './registry.js'

// Spec DEAL-02 / LOBBY-01 payload shapes + REG-03 registry contents. Payloads
// carry no `type` literal — the Colyseus wire name is the only type tag (REG-08).
describe('protocol payloads', () => {
  it('lobby:snapshot carries ids and names only — no role field anywhere (LOBBY-01)', () => {
    const snapshot: LobbySnapshot = {
      ownId: 's1',
      ownName: 'ada',
      isHost: true,
      roster: [
        { id: 's1', name: 'ada' },
        { id: 's2', name: 'bruno' },
      ],
    }
    expect(Object.keys(snapshot).sort()).toEqual(['isHost', 'ownId', 'ownName', 'roster'])
    for (const entry of snapshot.roster) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'name'])
    }
  })

  it('role:dealt carries exactly one role field - the own role of the recipient (DEAL-02)', () => {
    const payload: RoleDealt = { role: 'saboteur' }
    expect(Object.keys(payload).sort()).toEqual(['role'])
    expect(ROLES).toContain(payload.role)
  })

  it('round:started broadcasts player ids only — never roles', () => {
    const payload: RoundStarted = { playerIds: ['s1', 's2', 's3', 's4'] }
    expect(Object.keys(payload).sort()).toEqual(['playerIds'])
  })

  it('lobby:start intent schema accepts the empty intent (zod validate contract)', () => {
    const parsed = lobbyStartIntentSchema.parse({ type: 'lobby:start' })
    expect(parsed.type).toBe('lobby:start')
  })

  it('lobby:start intent schema rejects extra fields and wrong types', () => {
    expect(() => lobbyStartIntentSchema.parse({ type: 'lobby:start', seed: 1234 })).toThrow()
    expect(() => lobbyStartIntentSchema.parse({ type: 'move' })).toThrow()
    expect(() => lobbyStartIntentSchema.parse({})).toThrow()
  })

  // ELR-06/ELR-07: the call carries NO destination — it only summons a car to
  // the caller's floor; the destination is chosen in-car via elevator:press.
  it('elevator:call intent is destination-free: accepts only the type literal (ELR-06)', () => {
    const parsed = elevatorCallIntentSchema.parse({ type: 'elevator:call' })
    expect(parsed).toEqual({ type: 'elevator:call' })
    expect(() =>
      elevatorCallIntentSchema.parse({ type: 'elevator:call', target: 'floor1' }),
    ).toThrow()
    expect(() =>
      elevatorCallIntentSchema.parse({ type: 'elevator:call', floor: 'lobby' }),
    ).toThrow()
    expect(() => elevatorCallIntentSchema.parse({})).toThrow()
  })

  it('elevator:press intent accepts exactly a FLOOR_IDS floor and rejects the rest (ELR-08)', () => {
    for (const floor of FLOOR_IDS) {
      expect(elevatorPressIntentSchema.parse({ type: 'elevator:press', floor })).toEqual({
        type: 'elevator:press',
        floor,
      })
    }
    expect(() => elevatorPressIntentSchema.parse({ type: 'elevator:press' })).toThrow()
    expect(() =>
      elevatorPressIntentSchema.parse({ type: 'elevator:press', floor: 'floor9' }),
    ).toThrow()
    expect(() =>
      elevatorPressIntentSchema.parse({ type: 'elevator:press', floor: 'lobby', extra: 1 }),
    ).toThrow()
  })
})

// Spec REG-01/REG-03/REG-19 + WORK-16/17: the registry is the single catalog
// and the audit surface — every server→client type, one declaration each,
// with its exact recipient policy. This walk is literal, not membership-based
// (protocol-registry verifier note N2): a policy drift on any single key fails.
describe('protocol registry', () => {
  const LITERAL_POLICIES = {
    'lobby:snapshot': 'self',
    'round:started': 'all',
    'role:dealt': 'self',
    'round:buzzer': 'all',
    error: 'self',
    'player:moved': 'sameFloor',
    'elevator:called': 'all',
    'elevator:moved': 'all',
    'player:left': 'all',
    'player:left-floor': 'sameFloor',
    'movement:snapshot': 'self',
    'work:started': 'self',
    'work:ended': 'self',
    'room:observed': 'self',
    'room:prepped': 'occupants',
    'room:trashed': 'occupants',
  } as const

  it('declares exactly the five core, five movement, and five work types (REG-03)', () => {
    expect(Object.keys(PROTOCOL_REGISTRY).sort()).toEqual(Object.keys(LITERAL_POLICIES).sort())
  })

  it('pins every key to its exact literal recipient policy (WORK-16/17, AD-009)', () => {
    for (const [key, policy] of Object.entries(LITERAL_POLICIES)) {
      expect(
        PROTOCOL_REGISTRY[key as keyof typeof LITERAL_POLICIES].recipients,
        `policy of ${key}`,
      ).toBe(policy)
    }
  })

  it('declares a valid recipient policy on every entry (REG-19)', () => {
    for (const [key, entry] of Object.entries(PROTOCOL_REGISTRY)) {
      expect(['all', 'self', 'sameFloor', 'occupants'], `policy of ${key}`).toContain(
        entry.recipients,
      )
    }
  })

  it('projects movement events to payloads that never name elevator occupants (MOVE-17)', () => {
    const moved = PROTOCOL_REGISTRY['player:moved'].fromSim({
      type: 'player:moved',
      playerId: 'p1',
      floor: 'lobby',
      x: 1.5,
      facing: 'left',
    })
    expect(moved.self).toBeUndefined()
    expect(moved.payload).toEqual({ playerId: 'p1', floor: 'lobby', x: 1.5, facing: 'left' })

    const carMoved = PROTOCOL_REGISTRY['elevator:moved'].fromSim({
      type: 'elevator:moved',
      car: 2,
      floor: 'floor2',
    })
    expect(Object.keys(carMoved.payload).sort()).toEqual(['car', 'floor'])
    const called = PROTOCOL_REGISTRY['elevator:called'].fromSim({
      type: 'elevator:called',
      floor: 'lobby',
      car: 1,
    })
    expect(Object.keys(called.payload).sort()).toEqual(['car', 'floor'])
  })

  it('keeps room-originated types out of the sim-event surface (fromSim undefined)', () => {
    expect(PROTOCOL_REGISTRY['lobby:snapshot'].fromSim).toBeUndefined()
    expect(PROTOCOL_REGISTRY.error.fromSim).toBeUndefined()
  })

  it('projects role:dealt to the named player with the payload shape of the declared type (REG-05 prep)', () => {
    const projected = PROTOCOL_REGISTRY['role:dealt'].fromSim({
      type: 'role:dealt',
      playerId: 'p2',
      role: 'saboteur',
    })
    expect(projected.self).toBe('p2')
    expect(Object.keys(projected.payload).sort()).toEqual(['role'])
    expect(projected.payload.role).toBe('saboteur')
  })

  it('projects round:started to an all-policy payload carrying ids only', () => {
    const projected = PROTOCOL_REGISTRY['round:started'].fromSim({
      type: 'round:started',
      playerIds: ['p1', 'p2', 'p3', 'p4'],
    })
    expect(projected.self).toBeUndefined()
    expect(projected.payload.playerIds).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(PROTOCOL_REGISTRY['round:started'].recipients).toBe('all')
  })

  it('projects player:moved with sameFloor visibility = the event floor (AD-009)', () => {
    const projected = PROTOCOL_REGISTRY['player:moved'].fromSim({
      type: 'player:moved',
      playerId: 'p1',
      floor: 'floor2',
      x: 3.5,
      facing: 'left',
    })
    expect(projected.self).toBeUndefined()
    expect(projected.visibility).toEqual({ floor: 'floor2' })
  })

  it('projects work events to the actor only — no kind, no role in any payload (FR-9)', () => {
    const started = PROTOCOL_REGISTRY['work:started'].fromSim({
      type: 'work:started',
      playerId: 'p1',
      floor: 'floor1',
      room: 3,
      seconds: 5,
    })
    expect(started.self).toBe('p1')
    expect(Object.keys(started.payload).sort()).toEqual(['floor', 'playerId', 'room', 'seconds'])
    expect(started.payload).toEqual({ playerId: 'p1', floor: 'floor1', room: 3, seconds: 5 })

    const ended = PROTOCOL_REGISTRY['work:ended'].fromSim({
      type: 'work:ended',
      playerId: 'p1',
      floor: 'floor1',
      room: 3,
      outcome: 'cancelled',
    })
    expect(ended.self).toBe('p1')
    expect(ended.payload).toEqual({
      playerId: 'p1',
      floor: 'floor1',
      room: 3,
      outcome: 'cancelled',
    })
  })

  it('projects player:left-floor to the departed floor with sameFloor visibility (WORK-19)', () => {
    const projected = PROTOCOL_REGISTRY['player:left-floor'].fromSim({
      type: 'player:left-floor',
      playerId: 'p1',
      floor: 'lobby',
    })
    expect(projected.self).toBeUndefined()
    expect(projected.payload).toEqual({ playerId: 'p1', floor: 'lobby' })
    expect(projected.visibility).toEqual({ floor: 'lobby' })
  })

  it('projects room transitions with occupants roomKey visibility (WORK-15)', () => {
    const prepped = PROTOCOL_REGISTRY['room:prepped'].fromSim({
      type: 'room:prepped',
      floor: 'floor2',
      room: 5,
    })
    expect(prepped.payload).toEqual({ floor: 'floor2', room: 5 })
    expect(prepped.visibility).toEqual({ roomKey: 'floor2:5' })

    const trashed = PROTOCOL_REGISTRY['room:trashed'].fromSim({
      type: 'room:trashed',
      floor: 'floor3',
      room: 1,
    })
    expect(trashed.payload).toEqual({ floor: 'floor3', room: 1 })
    expect(trashed.visibility).toEqual({ roomKey: 'floor3:1' })
  })

  it('projects room:observed to the entering player with the room state (FR-10)', () => {
    const observed = PROTOCOL_REGISTRY['room:observed'].fromSim({
      type: 'room:observed',
      playerId: 'p2',
      floor: 'floor1',
      room: 2,
      state: 'trashed',
    })
    expect(observed.self).toBe('p2')
    expect(observed.payload).toEqual({
      playerId: 'p2',
      floor: 'floor1',
      room: 2,
      state: 'trashed',
    })
  })
})
