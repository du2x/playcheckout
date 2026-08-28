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
