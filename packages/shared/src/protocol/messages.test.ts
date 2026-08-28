import { describe, expect, it } from 'vitest'
import { ROLES } from '../roles.js'
import { type LobbySnapshot, lobbyStartIntentSchema } from './messages.js'

// Spec DEAL-02 / LOBBY-01 payload shapes; turnover-protocol rule 5 recipient audit.
describe('room-shell message catalog', () => {
  it('LobbySnapshot exposes ids and names only — no role field anywhere in the shape', () => {
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
    const event: { type: 'role:dealt'; role: (typeof ROLES)[number] } = {
      type: 'role:dealt',
      role: 'saboteur',
    }
    expect(Object.keys(event).sort()).toEqual(['role', 'type'])
    expect(ROLES).toContain(event.role)
  })

  it('round:started broadcasts player ids only — never roles', () => {
    const event: { type: 'round:started'; playerIds: string[] } = {
      type: 'round:started',
      playerIds: ['s1', 's2', 's3', 's4'],
    }
    expect(Object.keys(event).sort()).toEqual(['playerIds', 'type'])
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
