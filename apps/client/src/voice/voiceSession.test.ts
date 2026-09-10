import { describe, expect, it } from 'vitest'
import { initialVoiceSession, reduceVoice, shouldOffer } from './voiceSession'

// Voice party session (per game session): pure membership + mic derivation.
// The engine (voice.ts) owns every effect; these tests pin the state machine.
describe('voice:membership', () => {
  it('starts with the mic off and an empty party', () => {
    expect(initialVoiceSession()).toEqual({ micOn: false, members: [], fired: [], denied: false })
  })

  it('the server state row is the authoritative member list, own id excluded (VOICE-01)', () => {
    let s = reduceVoice(initialVoiceSession(), { type: 'voice-mic', on: true }, 'p1')
    s = reduceVoice(s, { type: 'voice-state', playerIds: ['p3', 'p2', 'p1'] }, 'p1')
    expect(s.micOn).toBe(true)
    expect(s.members).toEqual(['p2', 'p3'])
  })

  it('joins and leaves update the party; the own join echo is ignored (VOICE-02)', () => {
    let s = reduceVoice(initialVoiceSession(), { type: 'voice-mic', on: true }, 'p1')
    s = reduceVoice(s, { type: 'voice-joined', playerId: 'p1' }, 'p1')
    expect(s.members).toEqual([])
    s = reduceVoice(s, { type: 'voice-joined', playerId: 'p2' }, 'p1')
    expect(s.members).toEqual(['p2'])
    s = reduceVoice(s, { type: 'voice-left', playerId: 'p2' }, 'p1')
    expect(s.members).toEqual([])
  })

  it('mic-off clears the party; player:left is a belt-and-braces removal (VOICE-04)', () => {
    let s = reduceVoice(initialVoiceSession(), { type: 'voice-mic', on: true }, 'p1')
    s = reduceVoice(s, { type: 'voice-joined', playerId: 'p2' }, 'p1')
    s = reduceVoice(s, { type: 'voice-mic', on: false }, 'p1')
    expect(s).toEqual({ micOn: false, members: [], fired: [], denied: false })
    s = reduceVoice(s, { type: 'voice-mic', on: true }, 'p1')
    s = reduceVoice(s, { type: 'voice-joined', playerId: 'p2' }, 'p1')
    s = reduceVoice(s, { type: 'player-left', playerId: 'p2' }, 'p1')
    expect(s.members).toEqual([])
  })

  it('a denied mic enable never turns the mic on — the retry stays one click away (VOICE-05)', () => {
    const s = reduceVoice(
      initialVoiceSession(),
      { type: 'voice-mic', on: true, denied: true },
      'p1',
    )
    expect(s).toEqual({ micOn: false, members: [], fired: [], denied: true })
    // A successful retry clears the denial.
    const retry = reduceVoice(s, { type: 'voice-mic', on: true }, 'p1')
    expect(retry).toEqual({ micOn: true, members: [], fired: [], denied: false })
  })

  it('fired peers leave the party and are ignored; the self-fired mic dies (VOICE-06)', () => {
    let s = reduceVoice(initialVoiceSession(), { type: 'voice-mic', on: true }, 'p1')
    s = reduceVoice(s, { type: 'voice-joined', playerId: 'p2' }, 'p1')
    s = reduceVoice(s, { type: 'player-fired', playerId: 'p2' }, 'p1')
    expect(s.members).toEqual([])
    expect(s.fired).toEqual(['p2'])
    // The fired player is not re-added by a late join or state row.
    s = reduceVoice(s, { type: 'voice-joined', playerId: 'p2' }, 'p1')
    expect(s.members).toEqual([])

    const selfFired = reduceVoice(s, { type: 'player-fired', playerId: 'p1' }, 'p1')
    expect(selfFired.micOn).toBe(false)
    expect(selfFired.members).toEqual([])
  })

  it('reset returns to the initial session (terminal connection loss)', () => {
    let s = reduceVoice(initialVoiceSession(), { type: 'voice-mic', on: true }, 'p1')
    s = reduceVoice(s, { type: 'voice-joined', playerId: 'p2' }, 'p1')
    s = reduceVoice(s, { type: 'voice-reset' }, 'p1')
    expect(s).toEqual(initialVoiceSession())
  })

  it('negotiation is deterministic: the smaller session id offers (VOICE-07)', () => {
    expect(shouldOffer('a', 'b')).toBe(true)
    expect(shouldOffer('b', 'a')).toBe(false)
    expect(shouldOffer('p1', 'p1')).toBe(false)
  })
})
