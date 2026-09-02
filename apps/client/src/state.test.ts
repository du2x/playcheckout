import { type LobbySnapshot, type Role, TUNING } from '@turnover/shared'
import { describe, expect, it, vi } from 'vitest'
import { clockRemainingMs, initialViewState, reduce, roundPlayers } from './state'

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

function inRound(): ReturnType<typeof initialViewState> {
  return reduce(reduce(joinedLobby(), { type: 'round-started', playerIds: ['p1', 'p2'] }), {
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

  it('enters the round, stamps the receipt clock, and clears errors (LIGHT-09)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    try {
      const s = reduce(
        { ...joinedLobby(), error: 'need more players' },
        { type: 'round-started', playerIds: ['p1', 'p2'] },
      )
      expect(s.view).toBe('round')
      expect(s.error).toBeNull()
      expect(s.roundStartedAt).toBe(1000)
      expect(s.roundPlayerIds).toEqual(['p1', 'p2'])
      expect(clockRemainingMs(s, 1000)).toBe(TUNING.SHIFT_SECONDS * 1000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stores only the recipient’s own role (LIGHT-11)', () => {
    expect(inRound().role).toBe('staff')
    const sab = reduce(inRound(), { type: 'role-dealt', role: 'saboteur' as Role })
    expect(sab.role).toBe('saboteur')
  })

  it('counts the clock down and clamps at zero without going negative (LIGHT-10)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const s = inRound()
      expect(clockRemainingMs(s, 1500)).toBe((TUNING.SHIFT_SECONDS - 1.5) * 1000)
      expect(clockRemainingMs(s, TUNING.SHIFT_SECONDS * 1000 * 10)).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns to the lobby at the buzzer with role and clock cleared (LIGHT-13)', () => {
    const s = reduce(inRound(), { type: 'buzzer' })
    expect(s.view).toBe('lobby')
    expect(s.role).toBeNull()
    expect(s.roundStartedAt).toBeNull()
    expect(s.roundPlayerIds).toEqual([])
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

  it('labels round players by roster name, falling back to the raw id (LIGHT-12)', () => {
    expect(roundPlayers(['p1', 'p2'], snapshot())).toEqual([
      { id: 'p1', name: 'ada' },
      { id: 'p2', name: 'bruno' },
    ])
    expect(roundPlayers(['p1', 'ghost-id'], snapshot())).toEqual([
      { id: 'p1', name: 'ada' },
      { id: 'ghost-id', name: 'ghost-id' },
    ])
    expect(roundPlayers(['p1'], null)).toEqual([{ id: 'p1', name: 'p1' }])
  })
})

// Spec REND-06..07 (cycle 2.9): round-end verdict, recap, and the resumed seat.
describe('round-end reducer', () => {
  it('enters the results view with the winner banner data on round:ended (REND-06)', () => {
    const s = reduce(inRound(), {
      type: 'round-ended',
      winner: 'staff',
      reason: 'saboteur-fired',
      saboteurId: 'p2',
    })
    expect(s.view).toBe('results')
    expect(s.results).toEqual({
      winner: 'staff',
      reason: 'saboteur-fired',
      saboteurId: 'p2',
      entries: [],
      settleScore: null,
      settleTarget: null,
    })
  })

  it('stores an aborted verdict with saboteurId null — no traitor reveal (REND-07)', () => {
    const s = reduce(inRound(), {
      type: 'round-ended',
      winner: 'aborted',
      reason: 'saboteur-disconnected',
      saboteurId: null,
    })
    expect(s.view).toBe('results')
    expect(s.results?.winner).toBe('aborted')
    expect(s.results?.saboteurId).toBeNull()
  })

  it('merges recap entries into the stored result (REND-08)', () => {
    const ended = reduce(inRound(), {
      type: 'round-ended',
      winner: 'saboteur',
      reason: 'settle-target-failed',
      saboteurId: 'p2',
    })
    const entries = [
      { kind: 'crime' as const, tick: 40, floor: 'floor1' as const, room: 2 as const, fresh: true },
    ]
    const s = reduce(ended, {
      type: 'round-recap',
      entries,
      settleScore: 4,
      settleTarget: 7,
      complaints: 2,
    })
    expect(s.results?.entries).toEqual(entries)
    // Cycle 3.D (AD-039): the recap carries the verdict's inputs to the view.
    expect(s.results?.settleScore).toBe(4)
    expect(s.results?.settleTarget).toBe(7)
    // A recap with no stored result is absorbed without creating one.
    const stray = reduce(joinedLobby(), {
      type: 'round-recap',
      entries,
      settleScore: 4,
      settleTarget: 7,
      complaints: 2,
    })
    expect(stray.results).toBeNull()
    expect(stray.view).toBe('lobby')
  })

  it('restores the round view from round:resumed with the honest stamped clock (REND-18)', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const lost = reduce(inRound(), { type: 'connection-lost' })
      const s = reduce(lost, {
        type: 'round-resumed',
        remainingTicks: 100,
        playerIds: ['p1', 'p2'],
        ownFired: false,
        settleScore: 0,
        complaints: 0,
      })
      expect(s.view).toBe('round')
      expect(s.roundPlayerIds).toEqual(['p1', 'p2'])
      // Deadline = receipt + remainingTicks × 50 ms — server truth, not the
      // full-shift receipt math.
      expect(s.roundEndsAtMs).toBe(1_000_000 + 100 * 50)
      expect(clockRemainingMs(s, 1_000_000 + 40 * 50)).toBe(60 * 50)
      expect(clockRemainingMs(s, 1_000_000 + 200 * 50)).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the buzzer transient: lobby flip is overridden by the verdict in the same flush', () => {
    let s = inRound()
    // Server flush order: round:buzzer first, then round:ended.
    s = reduce(s, { type: 'buzzer' })
    expect(s.view).toBe('lobby')
    s = reduce(s, {
      type: 'round-ended',
      winner: 'saboteur',
      reason: 'settle-target-failed',
      saboteurId: 'p2',
    })
    expect(s.view).toBe('results')
    // A fresh deal clears the previous result and the resumed clock.
    s = reduce(s, { type: 'round-started', playerIds: ['p1', 'p2'] })
    expect(s.view).toBe('round')
    expect(s.results).toBeNull()
    expect(s.roundEndsAtMs).toBeNull()
  })
})

// Spec REND-19/23 (cycle 2.9): the reconnecting client state machine —
// drop → reconnecting lost view (scene kept) → restore clears the flag.
describe('reconnecting client', () => {
  it('marks a drop as reconnecting without tearing the round state down', () => {
    const s = reduce(inRound(), { type: 'connection-dropped' })
    expect(s.view).toBe('lost')
    expect(s.reconnecting).toBe(true)
    // The restore needs the roster + round cast — the drop keeps them.
    expect(s.snapshot).toEqual(snapshot())
    expect(s.roundPlayerIds).toEqual(['p1', 'p2'])
  })

  it('restores a mid-round seat via round:resumed and clears the flag', () => {
    const dropped = reduce(inRound(), { type: 'connection-dropped' })
    const s = reduce(dropped, {
      type: 'round-resumed',
      remainingTicks: 500,
      playerIds: ['p1', 'p2'],
      ownFired: false,
      settleScore: 0,
      complaints: 0,
    })
    expect(s.view).toBe('round')
    expect(s.reconnecting).toBe(false)
  })

  it('a results-phase reconnect lands in the lobby via the restore snapshot', () => {
    const dropped = reduce(inRound(), { type: 'connection-dropped' })
    const s = reduce(dropped, { type: 'snapshot', snapshot: snapshot() })
    expect(s.view).toBe('lobby')
    expect(s.reconnecting).toBe(false)
  })

  it('a terminal connection-loss clears the reconnecting flag', () => {
    const dropped = reduce(inRound(), { type: 'connection-dropped' })
    const s = reduce(dropped, { type: 'connection-lost' })
    expect(s.view).toBe('lost')
    expect(s.reconnecting).toBe(false)
  })

  it('never marks the join view as reconnecting', () => {
    const s = reduce(initialViewState(), { type: 'connection-dropped' })
    expect(s.view).toBe('join')
    expect(s.reconnecting).toBe(false)
  })
})
