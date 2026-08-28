import { describe, expect, it } from 'vitest'
import { ROLES } from '../roles.js'
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
})

// Spec REG-01/REG-03/REG-19: the registry is the single catalog and the audit
// surface — five pre-existing types, one declaration each, valid policies.
describe('protocol registry', () => {
  it('declares exactly the five pre-existing message types (REG-03)', () => {
    expect(Object.keys(PROTOCOL_REGISTRY).sort()).toEqual([
      'error',
      'lobby:snapshot',
      'role:dealt',
      'round:buzzer',
      'round:started',
    ])
  })

  it('declares a valid recipient policy on every entry (REG-19)', () => {
    for (const [key, entry] of Object.entries(PROTOCOL_REGISTRY)) {
      expect(['all', 'self'], `policy of ${key}`).toContain(entry.recipients)
    }
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
})
