import { PROTOCOL_REGISTRY, type RegistryKey } from '@turnover/shared'
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
    }
    const s = reduce(initialViewState(), first(MAPPERS['movement:snapshot'](snap)))
    expect(s.movementSnapshot).toEqual(snap)
  })
})
