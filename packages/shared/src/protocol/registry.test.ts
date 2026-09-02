import { describe, expect, it } from 'vitest'
import { FLOOR_IDS } from '../layout.js'
import { ROLES } from '../roles.js'
import {
  accuseIntentSchema,
  deskInteractIntentSchema,
  elevatorCallIntentSchema,
  elevatorPressIntentSchema,
  suitcasePickupIntentSchema,
  suitcasePlaceIntentSchema,
} from './intents.js'
import {
  type LobbySnapshot,
  lobbyStartIntentSchema,
  type RoleDealt,
  type RoundResumed,
  type RoundStarted,
  type SpectatorSnapshot,
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

  // Cycle 3.B (AD-032): the desk intent checks the front guest in; the
  // suitcase intents replace the deleted desk:send (two-choice flow removed
  // with the walkie-broadcast model).
  it('desk:interact intent schema accepts only the empty intent', () => {
    expect(deskInteractIntentSchema.parse({ type: 'desk:interact' })).toEqual({
      type: 'desk:interact',
    })
    expect(() => deskInteractIntentSchema.parse({})).toThrow()
    expect(() => deskInteractIntentSchema.parse({ type: 'desk:interact', room: 3 })).toThrow()
  })

  it('suitcase:place intent accepts exactly a room index 1-8', () => {
    expect(suitcasePlaceIntentSchema.parse({ type: 'suitcase:place', room: 8 })).toEqual({
      type: 'suitcase:place',
      room: 8,
    })
    expect(() => suitcasePlaceIntentSchema.parse({ type: 'suitcase:place', room: 9 })).toThrow()
    expect(() => suitcasePlaceIntentSchema.parse({ type: 'suitcase:place' })).toThrow()
    expect(() =>
      suitcasePlaceIntentSchema.parse({ type: 'suitcase:place', room: 4, extra: 1 }),
    ).toThrow()
  })

  it('suitcase:pickup intent accepts only the empty intent', () => {
    expect(suitcasePickupIntentSchema.parse({ type: 'suitcase:pickup' })).toEqual({
      type: 'suitcase:pickup',
    })
    expect(() => suitcasePickupIntentSchema.parse({ type: 'suitcase:pickup', room: 3 })).toThrow()
    expect(() => suitcasePickupIntentSchema.parse({})).toThrow()
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
    'guest:moved': 'sameFloor',
    'guest:arrived': 'all',
    'guest:impatient': 'all',
    'guest:self_assigned': 'all',
    'guest:settled': 'all',
    'guest:checked_out': 'all',
    'guest:left': 'all',
    'guest:assigned': 'all',
    'suitcase:carried': 'all',
    'suitcase:placed': 'sameFloor',
    'suitcase:picked_up': 'all',
    'guest:complained': 'all',
    'guest:angered': 'sameFloor',
    'guest:discovered': 'all',
    'elevator:called': 'all',
    'elevator:moved': 'all',
    'elevator:doors': 'all',
    'elevator:pressed': 'riders',
    'elevator:riders': 'riders',
    'stairs:ambushed': 'self',
    'stairs:ambush': 'self',
    'player:left': 'all',
    'player:left-floor': 'sameFloor',
    'movement:snapshot': 'self',
    'work:started': 'self',
    'work:ended': 'self',
    'room:observed': 'self',
    'room:prepped': 'occupants',
    'room:trashed': 'occupants',
    'room:carded': 'sameFloor',
    'room:settled': 'occupants',
    'room:rustle': 'earshot',
    'room:entered': 'sameFloor',
    'player:fired': 'all',
    'round:ended': 'all',
    'round:recap': 'all',
    'spectator:snapshot': 'self',
    'round:resumed': 'self',
  } as const

  it('declares exactly the core, movement, and work types — riders rows included (REG-03, AD-013)', () => {
    expect(Object.keys(PROTOCOL_REGISTRY).sort()).toEqual(Object.keys(LITERAL_POLICIES).sort())
  })

  it('pins every key to its exact literal recipient policy (WORK-16/17, AD-009, AD-013)', () => {
    for (const [key, policy] of Object.entries(LITERAL_POLICIES)) {
      expect(
        PROTOCOL_REGISTRY[key as keyof typeof LITERAL_POLICIES].recipients,
        `policy of ${key}`,
      ).toBe(policy)
    }
  })

  it('declares a valid recipient policy on every entry (REG-19)', () => {
    for (const [key, entry] of Object.entries(PROTOCOL_REGISTRY)) {
      expect(
        ['all', 'self', 'sameFloor', 'occupants', 'riders', 'earshot'],
        `policy of ${key}`,
      ).toContain(entry.recipients)
    }
  })

  // EVID-05/13/15: cards and rustle payloads are exactly {floor, room} — no
  // timestamp, author, or interior state rides the wire (FR-11, leak rule 2).
  it('projects the evidence rows: cards and rustle carry floor+room only (EVID-05, EVID-15)', () => {
    const carded = PROTOCOL_REGISTRY['room:carded'].fromSim({
      type: 'room:carded',
      floor: 'floor1',
      room: 4,
    })
    expect(carded.payload).toEqual({ floor: 'floor1', room: 4 })
    expect(carded.visibility).toEqual({ floor: 'floor1' })
    expect(carded.self).toBeUndefined()

    const rustle = PROTOCOL_REGISTRY['room:rustle'].fromSim({
      type: 'room:rustle',
      floor: 'floor2',
      room: 3,
    })
    expect(PROTOCOL_REGISTRY['room:rustle'].recipients).toBe('earshot')
    expect(rustle.payload).toEqual({ floor: 'floor2', room: 3 })
    expect(rustle.visibility).toEqual({ floor: 'floor2', room: 3 })

    for (const payload of [carded.payload, rustle.payload]) {
      expect(Object.keys(payload).sort()).toEqual(['floor', 'room'])
      expect(Object.keys(payload)).not.toContain('timestamp')
      expect(Object.keys(payload)).not.toContain('author')
      expect(Object.keys(payload)).not.toContain('state')
    }
  })

  it('projects room:settled to occupants and room:entered to the floor with the entrant named (EVID-16)', () => {
    const settled = PROTOCOL_REGISTRY['room:settled'].fromSim({
      type: 'room:settled',
      floor: 'floor3',
      room: 7,
    })
    expect(settled.payload).toEqual({ floor: 'floor3', room: 7 })
    expect(settled.visibility).toEqual({ roomKey: 'floor3:7' })
    expect(settled.self).toBeUndefined()

    const entered = PROTOCOL_REGISTRY['room:entered'].fromSim({
      type: 'room:entered',
      playerId: 'p2',
      floor: 'floor1',
      room: 2,
    })
    expect(entered.payload).toEqual({ playerId: 'p2', floor: 'floor1', room: 2 })
    expect(entered.visibility).toEqual({ floor: 'floor1' })
    expect(entered.self).toBeUndefined()
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
    // ELR P2 AC9 (MOVE-16 carryover): the public elevator payloads never grow
    // queue contents, occupancy, or press targets — riders-only knowledge
    // travels exclusively on the riders-policy rows.
    for (const publicPayload of [carMoved.payload, called.payload] as const) {
      const keys = Object.keys(publicPayload)
      expect(keys).not.toContain('queue')
      expect(keys).not.toContain('occupants')
      expect(keys).not.toContain('riders')
    }
  })

  it('projects elevator:pressed with riders policy and car-only visibility (AD-013, ELR-06)', () => {
    const row = PROTOCOL_REGISTRY['elevator:pressed']
    expect(row.recipients).toBe('riders')
    const projected = row.fromSim({
      type: 'elevator:pressed',
      playerId: 'p1',
      floor: 'floor2',
      car: 2,
    })
    // Payload is EXACTLY {playerId, floor} — the car travels as visibility only.
    expect(projected.payload).toEqual({ playerId: 'p1', floor: 'floor2' })
    expect(Object.keys(projected.payload).sort()).toEqual(['floor', 'playerId'])
    expect(projected.visibility).toEqual({ car: 2 })
    expect(projected.self).toBeUndefined()
  })

  it('projects elevator:riders with the full occupant + queue payload to riders only (ELR-01..03)', () => {
    const row = PROTOCOL_REGISTRY['elevator:riders']
    expect(row.recipients).toBe('riders')
    const projected = row.fromSim({
      type: 'elevator:riders',
      car: 1,
      riders: ['p1', 'p2'],
      queue: ['floor2'],
    })
    expect(projected.payload).toEqual({ car: 1, riders: ['p1', 'p2'], queue: ['floor2'] })
    expect(Object.keys(projected.payload).sort()).toEqual(['car', 'queue', 'riders'])
    expect(projected.visibility).toEqual({ car: 1 })
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

  it('projects guest:moved with sameFloor visibility — {guestId, floor, x} only (cycle 3.1)', () => {
    const projected = PROTOCOL_REGISTRY['guest:moved'].fromSim({
      type: 'guest:moved',
      guestId: 'guest:1',
      floor: 'lobby',
      x: 15,
    })
    expect(projected.payload).toEqual({ guestId: 'guest:1', floor: 'lobby', x: 15 })
    expect(projected.visibility).toEqual({ floor: 'lobby' })
    expect(PROTOCOL_REGISTRY['guest:moved'].recipients).toBe('sameFloor')
    expect(Object.keys(projected.payload).sort()).toEqual(['floor', 'guestId', 'x'])
  })

  it('projects guest:angered sameFloor at the room — room-number level, no detail, no actor (COMP-02)', () => {
    const projected = PROTOCOL_REGISTRY['guest:angered'].fromSim({
      type: 'guest:angered',
      guestId: 'guest:2',
      floor: 'floor1',
      room: 5,
    })
    expect(projected.payload).toEqual({ guestId: 'guest:2', floor: 'floor1', room: 5 })
    expect(projected.visibility).toEqual({ floor: 'floor1' })
    expect(PROTOCOL_REGISTRY['guest:angered'].recipients).toBe('sameFloor')
    expect(Object.keys(projected.payload).sort()).toEqual(['floor', 'guestId', 'room'])
  })

  it('projects guest:discovered building-wide with the freshness tier — the only budget row (COMP-04, FR-31)', () => {
    const fresh = PROTOCOL_REGISTRY['guest:discovered'].fromSim({
      type: 'guest:discovered',
      guestId: 'guest:2',
      floor: 'floor1',
      room: 5,
      fresh: true,
    })
    expect(fresh.payload).toEqual({
      guestId: 'guest:2',
      floor: 'floor1',
      room: 5,
      fresh: true,
    })
    expect(PROTOCOL_REGISTRY['guest:discovered'].recipients).toBe('all')
    expect(Object.keys(fresh.payload).sort()).toEqual(['floor', 'fresh', 'guestId', 'room'])
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

  // JUST-12/13/14 (cycle 2.8): firing is public but name-only — the payload is
  // exactly {playerId}; the sim event's internal reason (and any grace or
  // validity trace) never reaches the wire (FR-18, leak rules 3/4).
  it('projects player:fired to all players with a {playerId}-only payload (FR-18)', () => {
    const row = PROTOCOL_REGISTRY['player:fired']
    expect(row.recipients).toBe('all')
    const projected = row.fromSim({
      type: 'player:fired',
      playerId: 'p3',
      reason: 'correct-accusation',
    })
    expect(projected.payload).toEqual({ playerId: 'p3' })
    expect(Object.keys(projected.payload).sort()).toEqual(['playerId'])
    expect(projected.self).toBeUndefined()
    expect(projected.visibility).toBeUndefined()
    const keys = Object.keys(projected.payload)
    expect(keys).not.toContain('reason')
    expect(keys).not.toContain('valid')
    expect(keys).not.toContain('role')
  })

  it('projects round:ended to all players carrying the verdict + the post-round traitor reveal (FR-21)', () => {
    const row = PROTOCOL_REGISTRY['round:ended']
    expect(row.recipients).toBe('all')
    const projected = row.fromSim({
      type: 'round:ended',
      winner: 'staff',
      reason: 'saboteur-fired',
      saboteurId: 'p2',
    })
    expect(projected.payload).toEqual({
      winner: 'staff',
      reason: 'saboteur-fired',
      saboteurId: 'p2',
    })
    expect(Object.keys(projected.payload).sort()).toEqual(['reason', 'saboteurId', 'winner'])
  })

  it('declares round:recap all-policy and spectator:snapshot / round:resumed self-policy (cycle 2.9)', () => {
    expect(PROTOCOL_REGISTRY['round:recap'].recipients).toBe('all')
    expect(PROTOCOL_REGISTRY['round:recap'].fromSim).toBeUndefined()
    expect(PROTOCOL_REGISTRY['spectator:snapshot'].recipients).toBe('self')
    expect(PROTOCOL_REGISTRY['round:resumed'].recipients).toBe('self')
    const snapshot: SpectatorSnapshot = {
      players: [{ playerId: 'p1', floor: 'floor1', x: 0 }],
      cars: [{ car: 1, floor: 'lobby' }],
      rooms: [{ floor: 'floor1', room: 3, state: 'prepped' }],
      cardedRooms: [{ floor: 'floor1', rooms: [3] }],
    }
    expect(Object.keys(snapshot).sort()).toEqual(['cardedRooms', 'cars', 'players', 'rooms'])
    const resumed: RoundResumed = {
      remainingTicks: 100,
      playerIds: ['p1'],
      ownFired: false,
      settleScore: 0,
    }
    expect(Object.keys(resumed).sort()).toEqual([
      'ownFired',
      'playerIds',
      'remainingTicks',
      'settleScore',
    ])
  })

  it('accuse intent accepts exactly a non-empty targetId and rejects the rest (FR-17)', () => {
    expect(accuseIntentSchema.parse({ type: 'accuse', targetId: 'p2' })).toEqual({
      type: 'accuse',
      targetId: 'p2',
    })
    expect(() => accuseIntentSchema.parse({ type: 'accuse', targetId: '' })).toThrow()
    expect(() => accuseIntentSchema.parse({ type: 'accuse' })).toThrow()
    expect(() =>
      accuseIntentSchema.parse({ type: 'accuse', targetId: 'p2', floor: 'floor1' }),
    ).toThrow()
  })
})
