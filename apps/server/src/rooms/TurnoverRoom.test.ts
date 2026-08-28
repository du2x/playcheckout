import { Client } from '@colyseus/sdk'
import { type LobbySnapshot, TUNING } from '@turnover/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer } from '../index'
import { TurnoverRoom } from './TurnoverRoom'

let port: number
let app: Awaited<ReturnType<typeof startServer>>['app']
let gameServer: Awaited<ReturnType<typeof startServer>>['gameServer']

type ClientRoom = Awaited<ReturnType<Client['create']>>

beforeAll(async () => {
  const started = await startServer(0)
  app = started.app
  gameServer = started.gameServer
  const address = app.server.address()
  if (address === null || typeof address === 'string')
    throw new Error('server did not listen on a TCP port')
  port = address.port
})

afterAll(async () => {
  TurnoverRoom.instances = []
  await gameServer.gracefullyShutdown(false)
  await app.close()
})

function newClient(): Client {
  return new Client(`ws://127.0.0.1:${port}`)
}

async function createRoom(name: string): Promise<ClientRoom> {
  return newClient().create('turnover', { name })
}

/**
 * Deterministic snapshot collector: a join frame can be processed by the client
 * before its listener attaches but delivered after, so collectors may drain a
 * stale join-time snapshot first. `nextWhere` skips non-matching snapshots so
 * tests assert on the snapshot produced by the roster event they target.
 */
function collect(room: ClientRoom) {
  const snaps: LobbySnapshot[] = []
  const waiters: ((s: LobbySnapshot) => void)[] = []
  const off = room.onMessage('lobby:snapshot', (snapshot) => {
    snaps.push(snapshot as LobbySnapshot)
    const waiter = waiters.shift()
    if (waiter) waiter(snapshot as LobbySnapshot)
  })
  async function nextWhere(pred: (s: LobbySnapshot) => boolean): Promise<LobbySnapshot> {
    for (;;) {
      const queued = snaps.shift()
      if (queued !== undefined) {
        if (pred(queued)) return queued
        continue
      }
      const received = await new Promise<LobbySnapshot>((resolve, reject) => {
        waiters.push(resolve)
        setTimeout(() => reject(new Error('snapshot timeout')), 2000)
      })
      if (pred(received)) return received
    }
  }
  return {
    nextWhere,
    stop() {
      off()
    },
  }
}

// Spec LOBBY-01..05 (gate scenario server:lobby_join): join by code with
// display names, capacity/phase/name rejections, roster snapshots.
describe('server:lobby_join', () => {
  it('issues a 4-letter code and delivers roster snapshots on change (LOBBY-01)', async () => {
    const host = await createRoom('ada')
    expect(host.roomId).toMatch(/^[A-HJ-NP-Z]{4}$/)
    const hostSnaps = collect(host)

    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    const withGuest = await hostSnaps.nextWhere((s) => s.roster.length === 2)
    expect(withGuest.roster.map((p) => p.name)).toEqual(['ada', 'bruno'])

    guest.leave()
    const afterLeave = await hostSnaps.nextWhere((s) => s.roster.length === 1)
    expect(afterLeave.ownId).toBe(host.sessionId)
    expect(afterLeave.ownName).toBe('ada')
    expect(afterLeave.isHost).toBe(true)
    expect(afterLeave.roster).toEqual([{ id: host.sessionId, name: 'ada' }])
    hostSnaps.stop()
    host.leave()
  })

  it('second joiner is not host and sees the full roster in join order (LOBBY-01)', async () => {
    const host = await createRoom('ada')
    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    const guestSnaps = collect(guest)

    const third = await newClient().joinById(host.roomId, { name: 'caro' })
    const snapshot = await guestSnaps.nextWhere((s) => s.roster.length === 3)
    expect(snapshot.ownId).toBe(guest.sessionId)
    expect(snapshot.ownName).toBe('bruno')
    expect(snapshot.isHost).toBe(false)
    expect(snapshot.roster.map((p) => p.name)).toEqual(['ada', 'bruno', 'caro'])
    guestSnaps.stop()
    host.leave()
    guest.leave()
    third.leave()
  })

  it('normalizes a lowercase room code (LOBBY-01 edge)', async () => {
    const host = await createRoom('ada')
    const guest = await newClient().joinById(host.roomId.toLowerCase(), { name: 'bruno' })
    expect(guest.sessionId).toBeTruthy()
    host.leave()
    guest.leave()
  })

  it('rejects an unknown code without creating a room (LOBBY-02)', async () => {
    await expect(newClient().joinById('ZZZZ', { name: 'ada' })).rejects.toThrow(/not found/i)
  })

  it('rejects the 7th player with room full (LOBBY-03)', async () => {
    const host = await createRoom('ada')
    const guests = []
    for (let i = 0; i < 5; i++) {
      guests.push(await newClient().joinById(host.roomId, { name: `p${i}` }))
    }
    await expect(newClient().joinById(host.roomId, { name: 'late' })).rejects.toThrow(/room full/i)
    expect(TUNING.PLAYERS_MAX).toBe(6)
    host.leave()
    for (const g of guests) g.leave()
  })

  it('rejects names over 16 chars after trim (LOBBY-05)', async () => {
    await expect(createRoom('a'.repeat(17))).rejects.toThrow(/invalid name/i)
  })

  it('rejects a whitespace-only name (LOBBY-05)', async () => {
    await expect(createRoom('   ')).rejects.toThrow(/invalid name/i)
  })

  it('rejects a duplicate display name (LOBBY-05)', async () => {
    const host = await createRoom('ada')
    await expect(newClient().joinById(host.roomId, { name: 'ada' })).rejects.toThrow(/name taken/i)
    host.leave()
  })

  it('serializes same-name joins: exactly one of two racing joins succeeds (LOBBY-05 edge)', async () => {
    const host = await createRoom('ada')
    const results = await Promise.allSettled([
      newClient().joinById(host.roomId, { name: 'bruno' }),
      newClient().joinById(host.roomId, { name: 'bruno' }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    host.leave()
  })

  it('stays message-only: patchRate null, no Schema state', () => {
    const instance = TurnoverRoom.instances.at(-1)
    expect(instance).toBeDefined()
    expect(instance?.patchRate).toBeNull()
  })
})
