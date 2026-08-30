import { PROTOCOL_REGISTRY, type RegistryKey, type SpectatorSnapshot } from '@turnover/shared'
import { describe, expect, it } from 'vitest'
import { initialViewState, reduce, type ViewAction } from '../state'
import { MAPPERS } from './mappers'

function snapshot() {
  return {
    ownId: 'p1',
    ownName: 'ada',
    isHost: true,
    roster: [
      { id: 'p1', name: 'ada' },
      { id: 'p2', name: 'bruno' },
    ],
  } as const
}

function first(actions: ViewAction[]): ViewAction {
  if (actions.length !== 1) throw new Error(`expected exactly one action, got ${actions.length}`)
  return actions[0] as ViewAction
}

// Spec REG-11/REG-12: one pure mapper per registry key, mapping payloads to the
// reducer actions the first-light spec defines. Exhaustiveness is compile-time
// (gate 1); these tests pin each mapper's output shape to the spec outcome.
describe('protocol mappers', () => {
  it('covers every registry key with a mapper (REG-12)', () => {
    for (const key of Object.keys(PROTOCOL_REGISTRY) as RegistryKey[]) {
      expect(typeof MAPPERS[key], `mapper for ${key}`).toBe('function')
    }
  })

  it('maps lobby:snapshot to the snapshot action (LIGHT-01)', () => {
    const s = reduce(initialViewState(), first(MAPPERS['lobby:snapshot'](snapshot())))
    expect(s.view).toBe('lobby')
    expect(s.snapshot?.ownName).toBe('ada')
  })

  it('maps round:started to the round view with the dealt ids (LIGHT-09)', () => {
    const s = reduce(
      initialViewState(),
      first(MAPPERS['round:started']({ playerIds: ['p1', 'p2'] })),
    )
    expect(s.view).toBe('round')
    expect(s.roundPlayerIds).toEqual(['p1', 'p2'])
  })

  it('maps role:dealt to the own role card (LIGHT-11)', () => {
    const s = reduce(initialViewState(), first(MAPPERS['role:dealt']({ role: 'saboteur' })))
    expect(s.role).toBe('saboteur')
  })

  it('maps round:buzzer back to the lobby (LIGHT-13)', () => {
    const joined = reduce(initialViewState(), first(MAPPERS['lobby:snapshot'](snapshot())))
    const inRound = reduce(joined, first(MAPPERS['round:started']({ playerIds: ['p1'] })))
    const s = reduce(inRound, first(MAPPERS['round:buzzer']({})))
    expect(s.view).toBe('lobby')
    expect(s.role).toBeNull()
  })

  it('maps error to the banner message (LIGHT-08)', () => {
    const s = reduce(
      initialViewState(),
      first(MAPPERS.error({ code: 'need-more-players', message: 'need at least 4 players' })),
    )
    expect(s.error).toBe('need at least 4 players')
  })

  it('maps movement events to render-state actions; the reducer no-ops them (MOVE-03)', () => {
    const moved = first(
      MAPPERS['player:moved']({ playerId: 'p2', floor: 'lobby', x: 12.3, facing: 'left' }),
    )
    expect(moved).toEqual({
      type: 'player-moved',
      playerId: 'p2',
      floor: 'lobby',
      x: 12.3,
      facing: 'left',
    })
    const before = initialViewState()
    expect(reduce(before, moved as never)).toBe(before) // identity: render state
    const called = first(MAPPERS['elevator:called']({ floor: 'lobby', car: 1 }))
    expect(reduce(before, called as never)).toBe(before)
    const carMoved = first(MAPPERS['elevator:moved']({ car: 2, floor: 'floor2' }))
    expect(reduce(before, carMoved as never)).toBe(before)
    const left = first(MAPPERS['player:left']({ playerId: 'p2' }))
    expect(reduce(before, left as never)).toBe(before)
  })

  it('maps movement:snapshot into view state (MOVE-18)', () => {
    const snap = {
      players: [{ playerId: 'p1', floor: 'lobby' as const, x: 15 }],
      cars: [{ car: 1 as const, floor: 'lobby' as const }],
      cardedRooms: [2 as const],
    }
    const s = reduce(initialViewState(), first(MAPPERS['movement:snapshot'](snap)))
    expect(s.movementSnapshot).toEqual(snap)
  })
})

// Spec ELR-01/ELR-06 (AD-013, cycle 2.6): the rider-exclusive messages map to
// render-state actions the reducer no-ops — payload keys pinned exactly (the
// press payload carries no car field; the occupancy payload carries the queue).
describe('elevator rider mappers (cycle 2.6)', () => {
  const before = initialViewState()

  it('maps elevator:pressed to the press action with exactly {playerId, floor} (ELR-06)', () => {
    const pressed = first(MAPPERS['elevator:pressed']({ playerId: 'p2', floor: 'floor1' }))
    expect(pressed).toEqual({ type: 'elevator-pressed', playerId: 'p2', floor: 'floor1' })
    expect(reduce(before, pressed)).toBe(before) // identity: render state
  })

  it('maps elevator:riders to the occupancy action with exactly {car, riders, queue} (ELR-01)', () => {
    const riders = first(
      MAPPERS['elevator:riders']({ car: 1, riders: ['p1', 'p2'], queue: ['floor2', 'lobby'] }),
    )
    expect(riders).toEqual({
      type: 'elevator-riders',
      car: 1,
      riders: ['p1', 'p2'],
      queue: ['floor2', 'lobby'],
    })
    expect(reduce(before, riders)).toBe(before)
  })
})

// Spec WORK-10/14/16 + FR-9: work events map to scene-kind actions the reducer
// no-ops; no payload names a role or a channel kind, so no mapper can leak one.
describe('work mappers (cycle 2.5)', () => {
  const before = initialViewState()

  it('maps work:started to the own channel action with its seconds (WORK-01)', () => {
    const started = first(
      MAPPERS['work:started']({ playerId: 'p1', floor: 'floor1', room: 3, seconds: 5 }),
    )
    expect(started).toEqual({
      type: 'work-started',
      playerId: 'p1',
      floor: 'floor1',
      room: 3,
      seconds: 5,
    })
    expect(reduce(before, started)).toBe(before) // identity: render state
  })

  it('maps work:ended with its outcome and no-ops in the reducer (WORK-11)', () => {
    const ended = first(
      MAPPERS['work:ended']({
        playerId: 'p1',
        floor: 'floor1',
        room: 3,
        outcome: 'cancelled',
      }),
    )
    expect(ended).toEqual({
      type: 'work-ended',
      playerId: 'p1',
      floor: 'floor1',
      room: 3,
      outcome: 'cancelled',
    })
    expect(reduce(before, ended)).toBe(before)
  })

  it('maps room:observed/prepped/trashed to scene-kind actions; reducer no-ops (WORK-14/15)', () => {
    const observed = first(
      MAPPERS['room:observed']({ playerId: 'p1', floor: 'floor2', room: 5, state: 'trashed' }),
    )
    expect(observed).toEqual({
      type: 'room-observed',
      playerId: 'p1',
      floor: 'floor2',
      room: 5,
      state: 'trashed',
    })
    expect(reduce(before, observed)).toBe(before)
    const prepped = first(MAPPERS['room:prepped']({ floor: 'floor2', room: 5 }))
    expect(prepped).toEqual({ type: 'room-prepped', floor: 'floor2', room: 5 })
    expect(reduce(before, prepped)).toBe(before)
    const trashed = first(MAPPERS['room:trashed']({ floor: 'floor2', room: 5 }))
    expect(trashed).toEqual({ type: 'room-trashed', floor: 'floor2', room: 5 })
    expect(reduce(before, trashed)).toBe(before)
  })

  it('carries no role or channel-kind field in any work payload (FR-9, WORK-10)', () => {
    const started = MAPPERS['work:started']({
      playerId: 'p1',
      floor: 'floor1',
      room: 1,
      seconds: 5,
    })[0] as Record<string, unknown>
    // The action's `type` tag is the mapper's own; the payload contributes no
    // role or channel-kind field (FR-9).
    expect(Object.keys(started).sort()).toEqual(['floor', 'playerId', 'room', 'seconds', 'type'])
  })
})

// Spec REND-06..07/12/18 (cycle 2.9): the round-end payloads map 1:1 — a
// routed-wrong or field-dropped verdict would silently corrupt the results
// view (verifier Gap 1, sensor mutant M8b).
describe('round-end mappers (cycle 2.9)', () => {
  it('maps round:ended 1:1 with winner, reason, and the post-round traitor reveal (FR-21)', () => {
    const action = first(
      MAPPERS['round:ended']({ winner: 'staff', reason: 'saboteur-fired', saboteurId: 'p2' }),
    )
    expect(action).toEqual({
      type: 'round-ended',
      winner: 'staff',
      reason: 'saboteur-fired',
      saboteurId: 'p2',
    })
    const aborted = first(
      MAPPERS['round:ended']({
        winner: 'aborted',
        reason: 'saboteur-disconnected',
        saboteurId: null,
      }),
    )
    expect(aborted).toEqual({
      type: 'round-ended',
      winner: 'aborted',
      reason: 'saboteur-disconnected',
      saboteurId: null,
    })
  })

  it('maps round:recap 1:1 carrying the entries array (FR-22)', () => {
    const entries = [{ kind: 'crime', tick: 4, floor: 'floor1', room: 2, fresh: true }] as const
    const action = first(MAPPERS['round:recap']({ entries }))
    expect(action).toEqual({ type: 'round-recap', entries })
  })

  it('wraps spectator:snapshot whole — every baseline row survives (FR-20)', () => {
    const snapshotPayload: SpectatorSnapshot = {
      players: [{ playerId: 'p1', floor: 'floor1', x: 1200 }],
      cars: [{ car: 1, floor: 'lobby' }],
      rooms: [{ floor: 'floor1', room: 2, state: 'prepped' }],
      cardedRooms: [{ floor: 'floor1', rooms: [2] }],
    }
    const action = first(MAPPERS['spectator:snapshot'](snapshotPayload))
    expect(action).toEqual({ type: 'spectator-snapshot', snapshot: snapshotPayload })
  })

  it('maps round:resumed 1:1 with the honest clock inputs (REND-18)', () => {
    const action = first(
      MAPPERS['round:resumed']({ remainingTicks: 500, playerIds: ['p1', 'p2'], ownFired: false }),
    )
    expect(action).toEqual({
      type: 'round-resumed',
      remainingTicks: 500,
      playerIds: ['p1', 'p2'],
      ownFired: false,
    })
  })
})
