import { type LobbySnapshot, type Role, TUNING } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { clockRemainingMs, initialViewState, reduce } from './state'

function snapshot(overrides: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    ownId: 'p1',
    ownName: 'ada',
    isHost: true,
    roster: [
      { id: 'p1', name: 'ada' },
      { id: 'p2', name: 'bruno' },
    ],
    ...overrides,
  }
}

function joinedLobby(): ReturnType<typeof initialViewState> {
  return reduce(initialViewState(), { type: 'snapshot', snapshot: snapshot() })
}

function inRound(atMs = 1000): ReturnType<typeof initialViewState> {
  return reduce(reduce(joinedLobby(), { type: 'round-started', atMs }), {
    type: 'role-dealt',
    role: 'staff' as Role,
  })
}

// Spec LIGHT-01..14: view-state transitions for the first-light client slice.
describe('first-light view reducer', () => {
  it('starts on the join screen with no snapshot, role, or error', () => {
    const s = initialViewState()
    expect(s.view).toBe('join')
    expect(s.snapshot).toBeNull()
    expect(s.role).toBeNull()
    expect(s.error).toBeNull()
    expect(s.joining).toBe(false)
  })

  it('marks a submission in flight and clears any prior error (LIGHT-01)', () => {
    const s = reduce({ ...initialViewState(), error: 'stale' }, { type: 'submit-join' })
    expect(s.joining).toBe(true)
    expect(s.error).toBeNull()
  })

  it('ignores a duplicate submission while a connection is in flight (edge case)', () => {
    const inFlight = reduce(initialViewState(), { type: 'submit-join' })
    expect(reduce(inFlight, { type: 'submit-join' })).toBe(inFlight)
  })

  it('enters the lobby on the personal snapshot (LIGHT-01)', () => {
    const s = reduce(reduce(initialViewState(), { type: 'submit-join' }), {
      type: 'snapshot',
      snapshot: snapshot(),
    })
    expect(s.view).toBe('lobby')
    expect(s.joining).toBe(false)
    expect(s.snapshot?.ownId).toBe('p1')
    expect(s.snapshot?.isHost).toBe(true)
  })

  it('stays on the join screen with the server reason on join failure (LIGHT-02)', () => {
    const s = reduce(reduce(initialViewState(), { type: 'submit-join' }), {
      type: 'join-failed',
      reason: 'room not found',
    })
    expect(s.view).toBe('join')
    expect(s.joining).toBe(false)
    expect(s.error).toBe('room not found')
  })

  it('updates the roster in place on later snapshots (LIGHT-05)', () => {
    const grown = snapshot({ roster: [...snapshot().roster, { id: 'p3', name: 'caro' }] })
    const s = reduce(joinedLobby(), { type: 'snapshot', snapshot: grown })
    expect(s.view).toBe('lobby')
    expect(s.snapshot?.roster).toHaveLength(3)
  })

  it('does not kick a round view back to lobby on a stray snapshot', () => {
    const s = reduce(inRound(), { type: 'snapshot', snapshot: snapshot() })
    expect(s.view).toBe('round')
  })

  it('enters the round with the deadline at atMs + 300 s and clears errors (LIGHT-09)', () => {
    const s = reduce(
      { ...joinedLobby(), error: 'need more players' },
      { type: 'round-started', atMs: 1000 },
    )
    expect(s.view).toBe('round')
    expect(s.error).toBeNull()
    expect(s.roundStartedAt).toBe(1000)
    expect(clockRemainingMs(s, 1000)).toBe(TUNING.SHIFT_SECONDS * 1000)
  })

  it('stores only the recipient’s own role (LIGHT-11)', () => {
    expect(inRound().role).toBe('staff')
    const sab = reduce(inRound(), { type: 'role-dealt', role: 'saboteur' as Role })
    expect(sab.role).toBe('saboteur')
  })

  it('counts the clock down and clamps at zero without going negative (LIGHT-10)', () => {
    const s = inRound(0)
    expect(clockRemainingMs(s, 1500)).toBe((TUNING.SHIFT_SECONDS - 1.5) * 1000)
    expect(clockRemainingMs(s, TUNING.SHIFT_SECONDS * 1000 * 10)).toBe(0)
  })

  it('returns to the lobby at the buzzer with role and clock cleared (LIGHT-13)', () => {
    const s = reduce(inRound(), { type: 'buzzer' })
    expect(s.view).toBe('lobby')
    expect(s.role).toBeNull()
    expect(s.roundStartedAt).toBeNull()
    expect(s.snapshot).not.toBeNull() // roster survives for re-deal rendering
  })

  it('shows an intent error in the current view and stays put (LIGHT-08)', () => {
    const lobby = joinedLobby()
    const s = reduce(lobby, { type: 'intent-error', message: 'need at least 4 players' })
    expect(s.view).toBe('lobby')
    expect(s.error).toBe('need at least 4 players')
    const round = reduce(inRound(), { type: 'intent-error', message: 'x' })
    expect(round.view).toBe('round')
  })

  it('clears the error without changing anything else', () => {
    const errored = reduce(joinedLobby(), { type: 'intent-error', message: 'x' })
    const cleared = reduce(errored, { type: 'clear-error' })
    expect(cleared.error).toBeNull()
    expect(cleared.view).toBe(errored.view)
    expect(cleared.snapshot).toBe(errored.snapshot)
  })

  it('goes to the connection-lost view from lobby or round, never from join (edge case)', () => {
    expect(reduce(joinedLobby(), { type: 'connection-lost' }).view).toBe('lost')
    expect(reduce(inRound(), { type: 'connection-lost' }).view).toBe('lost')
    expect(reduce(initialViewState(), { type: 'connection-lost' }).view).toBe('join')
  })
})
