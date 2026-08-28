import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LobbySnapshot } from '@turnover/shared'
import type { Room } from 'colyseus'
import { describe, expect, it } from 'vitest'
import { Router } from './router'

// Spec REG-05..07, REG-09 (unit half): generic routing with envelope stamping
// and per-connection seq counters, asserted against fake clients. Policy typing
// (toSelf/toAll keyed by declared policy) is compile-time — gate 1.

interface Sent {
  type: string
  message: Record<string, unknown>
}

function fakeClient(sessionId: string) {
  const sent: Sent[] = []
  return {
    sessionId,
    sent,
    send(type: string, message: unknown) {
      sent.push({ type, message: message as Record<string, unknown> })
    },
  }
}

function newRouter(...clients: ReturnType<typeof fakeClient>[]) {
  return new Router({ clients } as unknown as Room)
}

describe('router: envelope stamping and policies', () => {
  it('wraps every message in { seq, time, payload } with monotonic per-connection seq (REG-06)', () => {
    const c = fakeClient('p1')
    const router = newRouter(c)
    router.route({ type: 'round:buzzer' })
    router.route({ type: 'round:buzzer' })

    expect(c.sent).toHaveLength(2)
    const first = c.sent[0]?.message
    const second = c.sent[1]?.message
    if (first === undefined || second === undefined) throw new Error('messages missing')
    expect(Object.keys(first).sort()).toEqual(['payload', 'seq', 'time'])
    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(typeof first.time).toBe('number')
    // In-payload `type` literal is gone — the wire name is the only type tag (REG-08).
    expect(Object.keys(first.payload as object)).toEqual([])
  })

  it('gives each recipient its own next seq on a broadcast (REG-07)', () => {
    const a = fakeClient('a')
    const b = fakeClient('b')
    const router = newRouter(a, b)
    router.route({ type: 'round:started', playerIds: ['a', 'b'] })

    expect(a.sent[0]?.message.seq).toBe(1)
    expect(b.sent[0]?.message.seq).toBe(1)
    router.route({ type: 'round:buzzer' })
    expect(a.sent[1]?.message.seq).toBe(2)
    expect(b.sent[1]?.message.seq).toBe(2)
  })

  it('delivers role:dealt ONLY to the named player — by declared policy (REG-09)', () => {
    const a = fakeClient('a')
    const b = fakeClient('b')
    const router = newRouter(a, b)
    router.route({ type: 'role:dealt', playerId: 'b', role: 'saboteur' })

    expect(a.sent).toEqual([])
    expect(b.sent).toHaveLength(1)
    expect(b.sent[0]?.type).toBe('role:dealt')
    expect(b.sent[0]?.message.payload).toEqual({ role: 'saboteur' })
  })

  it('counts per connection: a fresh connection starts at seq 1 again (REG-17 seam)', () => {
    const a = fakeClient('a')
    const router = newRouter(a)
    router.route({ type: 'round:buzzer' })
    router.forget('a')
    router.route({ type: 'round:buzzer' })

    expect(a.sent.map((s) => s.message.seq)).toEqual([1, 1])
  })

  it('sends room-originated self messages through the same envelope path', () => {
    const a = fakeClient('a')
    const router = newRouter(a)
    const snapshot: LobbySnapshot = {
      ownId: 'a',
      ownName: 'ada',
      isHost: true,
      roster: [{ id: 'a', name: 'ada' }],
    }
    router.toSelf('lobby:snapshot', 'a', snapshot)

    expect(a.sent).toHaveLength(1)
    expect(a.sent[0]?.type).toBe('lobby:snapshot')
    expect(Object.keys(a.sent[0]?.message as object).sort()).toEqual(['payload', 'seq', 'time'])
    expect(a.sent[0]?.message.seq).toBe(1)
  })
})

// WORK-17/18/15 (AD-008/AD-009): positional policies deliver only to viewers
// whose registered view context matches the event's declared visibility.
describe('router: positional policies', () => {
  it('delivers player:moved only to same-floor viewers (WORK-17)', () => {
    const lobbyViewer = fakeClient('lobby')
    const floor1Viewer = fakeClient('f1')
    const rider = fakeClient('rider')
    const router = newRouter(lobbyViewer, floor1Viewer, rider)
    router.setViewContext((sessionId) => {
      if (sessionId === 'lobby') return { floor: 'lobby', roomKey: null, car: null }
      if (sessionId === 'f1') return { floor: 'floor1', roomKey: 'floor1:3', car: null }
      return { floor: null, roomKey: null, car: 2 } // rider in car 2
    })

    router.route({
      type: 'player:moved',
      playerId: 'mover',
      floor: 'floor1',
      x: 3.5,
      facing: 'left',
    })

    expect(lobbyViewer.sent).toEqual([])
    expect(rider.sent).toEqual([])
    expect(floor1Viewer.sent).toHaveLength(1)
    expect(floor1Viewer.sent[0]?.type).toBe('player:moved')
    expect(floor1Viewer.sent[0]?.message.payload).toEqual({
      playerId: 'mover',
      floor: 'floor1',
      x: 3.5,
      facing: 'left',
    })
  })

  it('delivers room transitions only to viewers inside that segment (WORK-15)', () => {
    const inside = fakeClient('inside')
    const sameFloorOtherRoom = fakeClient('elsewhere')
    const router = newRouter(inside, sameFloorOtherRoom)
    router.setViewContext((sessionId) => {
      if (sessionId === 'inside') return { floor: 'floor2', roomKey: 'floor2:5', car: null }
      return { floor: 'floor2', roomKey: null, car: null } // same floor, outside segments
    })

    router.route({ type: 'room:prepped', floor: 'floor2', room: 5 })

    expect(sameFloorOtherRoom.sent).toEqual([])
    expect(inside.sent).toHaveLength(1)
    expect(inside.sent[0]?.type).toBe('room:prepped')
    expect(inside.sent[0]?.message.payload).toEqual({ floor: 'floor2', room: 5 })
  })

  it('keeps elevator panels and leaver events broadcast to everyone (WORK-19)', () => {
    const a = fakeClient('a')
    const b = fakeClient('b')
    const router = newRouter(a, b)
    router.setViewContext((sessionId) =>
      sessionId === 'a'
        ? { floor: 'lobby', roomKey: null, car: null }
        : { floor: 'floor1', roomKey: null, car: null },
    )

    router.route({ type: 'elevator:moved', car: 1, floor: 'floor1' })
    router.toAll('player:left', { playerId: 'x' })

    expect(a.sent.map((s) => s.type)).toEqual(['elevator:moved', 'player:left'])
    expect(b.sent.map((s) => s.type)).toEqual(['elevator:moved', 'player:left'])
  })
})

// ELR-01..03/ELR-06 (AD-013): the riders policy delivers ONLY to viewers whose
// view context car matches the event's car — occupancy and presses never reach
// the floor, the other car, or anyone else.
describe('router: riders policy', () => {
  function ridersContext(sessionId: string) {
    if (sessionId === 'r1a' || sessionId === 'r1b')
      return { floor: null, roomKey: null, car: 1 as const }
    if (sessionId === 'r2') return { floor: null, roomKey: null, car: 2 as const }
    return { floor: 'lobby', roomKey: null, car: null } // a non-rider on the floor
  }

  it('delivers elevator:riders only to viewers riding that car (ELR-01..03)', () => {
    const rider1a = fakeClient('r1a')
    const rider1b = fakeClient('r1b')
    const rider2 = fakeClient('r2')
    const floorViewer = fakeClient('f')
    const router = newRouter(rider1a, rider1b, rider2, floorViewer)
    router.setViewContext(ridersContext)

    router.route({ type: 'elevator:riders', car: 1, riders: ['r1a', 'r1b'], queue: ['floor2'] })

    expect(rider1a.sent).toHaveLength(1)
    expect(rider1a.sent[0]?.type).toBe('elevator:riders')
    expect(rider1a.sent[0]?.message.payload).toEqual({
      car: 1,
      riders: ['r1a', 'r1b'],
      queue: ['floor2'],
    })
    expect(rider1b.sent).toHaveLength(1)
    expect(rider1b.sent[0]?.message.payload).toEqual({
      car: 1,
      riders: ['r1a', 'r1b'],
      queue: ['floor2'],
    })
    // Non-riders: the other car's rider and every floor viewer get nothing.
    expect(rider2.sent).toEqual([])
    expect(floorViewer.sent).toEqual([])
  })

  it("delivers elevator:pressed only to the pressing car's riders with payload exactly {playerId, floor} (ELR-06)", () => {
    const rider1a = fakeClient('r1a')
    const rider2 = fakeClient('r2')
    const floorViewer = fakeClient('f')
    const router = newRouter(rider1a, rider2, floorViewer)
    router.setViewContext(ridersContext)

    router.route({ type: 'elevator:pressed', playerId: 'r1a', floor: 'floor2', car: 1 })

    expect(rider1a.sent).toHaveLength(1)
    expect(rider1a.sent[0]?.type).toBe('elevator:pressed')
    expect(rider1a.sent[0]?.message.payload).toEqual({ playerId: 'r1a', floor: 'floor2' })
    expect(rider2.sent).toEqual([])
    expect(floorViewer.sent).toEqual([])
  })
})

// Spec REG-10: the Router is the only module allowed to send. Same fs-walk
// pattern as packages/sim/src/literals.test.ts; *.test.ts files excluded so
// this file's own literals don't self-match.
describe('send bypass denylist', () => {
  it('finds no raw .send(/.broadcast( outside the Router module', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const violations: string[] = []
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || /\.(test|spec)\.ts$/.test(file) || file === 'router.ts') continue
      const lines = readFileSync(join(dir, file), 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/\.send\(|\.broadcast\(/.test(line)) violations.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(violations).toEqual([])
  })
})
