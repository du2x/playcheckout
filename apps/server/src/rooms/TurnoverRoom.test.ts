import { Client } from '@colyseus/sdk'
import { type LobbySnapshot, TUNING } from '@turnover/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startServer } from '../index'
import { TurnoverRoom } from './TurnoverRoom'

let port: number
let app: Awaited<ReturnType<typeof startServer>>['app']
let gameServer: Awaited<ReturnType<typeof startServer>>['gameServer']

type ClientRoom = Awaited<ReturnType<Client['create']>>

beforeAll(async () => {
  TurnoverRoom.tickMs = 0 // tests drive ticks deterministically via __driveTicks
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

async function roomWithFour() {
  const host = await createRoom('ada')
  const clients: ClientRoom[] = [host]
  for (const name of ['bruno', 'caro', 'dina']) {
    clients.push(await newClient().joinById(host.roomId, { name }))
  }
  const [h, a, b, c] = clients
  if (h === undefined || a === undefined || b === undefined || c === undefined) {
    throw new Error('failed to gather 4 clients')
  }
  return [h, a, b, c] as const
}

function collectAll(room: ClientRoom) {
  const snaps: { type: string; payload: Record<string, unknown> }[] = []
  const wake: (() => void)[] = []
  const off = room.onMessage('*', (messageType, payload) => {
    snaps.push({ type: String(messageType), payload: payload as Record<string, unknown> })
    for (const w of wake.splice(0)) w()
  })
  return {
    async waitFor(type: string, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const found = snaps.find((m) => m.type === type)
        if (found !== undefined) {
          snaps.splice(snaps.indexOf(found), 1)
          return found
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error(`timeout waiting for ${type}`)
        await Promise.race([
          new Promise<void>((resolve) => wake.push(resolve)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), remaining),
          ),
        ])
      }
    },
    stop() {
      off()
    },
  }
}

// Spec DEAL-01..05, CLK-03/CLK-04 (gate scenario sim:role_deal, server half):
// host start guards, private role routing, buzzer → lobby, re-deal.
describe('sim:role_deal (server)', () => {
  it('deals exactly one saboteur via private role payloads, never in broadcasts (DEAL-01, DEAL-02)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const collectors = [host, a, b, c].map((room) => collectAll(room))
    const instance = TurnoverRoom.instances.at(-1)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)

    const roles: string[] = []
    for (const collector of collectors) {
      const dealt = await collector.waitFor('role:dealt')
      expect(Object.keys(dealt.payload).sort()).toEqual(['role', 'type'])
      roles.push(dealt.payload.role as string)
    }
    expect(roles.filter((r) => r === 'saboteur')).toHaveLength(1)
    expect(roles.filter((r) => r === 'staff')).toHaveLength(3)

    for (const collector of collectors) {
      const started = await collector.waitFor('round:started')
      // Broadcast carries ids only — no role field (protocol rule 3).
      expect(Object.keys(started.payload).sort()).toEqual(['playerIds', 'type'])
      expect(started.payload.playerIds).toHaveLength(4)
      collector.stop()
    }
    host.leave()
    a.leave()
    b.leave()
    c.leave()
  })

  it('rejects start with fewer than 4 players (DEAL-03)', async () => {
    const host = await createRoom('ada')
    const guests = []
    for (const name of ['bruno', 'caro']) {
      guests.push(await newClient().joinById(host.roomId, { name }))
    }
    const collector = collectAll(host)
    host.send('lobby:start', { type: 'lobby:start' })
    const err = await collector.waitFor('error')
    expect(err.payload.code).toBe('need-more-players')
    expect(TUNING.PLAYERS_MIN).toBe(4)
    collector.stop()
    host.leave()
    for (const g of guests) g.leave()
  })

  it('rejects start from a non-host (DEAL-04)', async () => {
    const host = await createRoom('ada')
    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    await newClient().joinById(host.roomId, { name: 'caro' })
    await newClient().joinById(host.roomId, { name: 'dina' })
    const guestCollector = collectAll(guest)
    guest.send('lobby:start', { type: 'lobby:start' })
    const err = await guestCollector.waitFor('error')
    expect(err.payload.code).toBe('not-host')
    guestCollector.stop()
    host.leave()
    guest.leave()
  })

  it('rejects double start while a round is active (DEAL-05)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const collector = collectAll(host)
    const instance = TurnoverRoom.instances.at(-1)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)
    host.send('lobby:start', { type: 'lobby:start' })
    const err = await collector.waitFor('error')
    expect(err.payload.code).toBe('round-already-active')
    collector.stop()
    host.leave()
    a.leave()
    b.leave()
    c.leave()
  })

  it('rejects joins while the round is in progress (LOBBY-04)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const instance = TurnoverRoom.instances.at(-1)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)
    await expect(newClient().joinById(host.roomId, { name: 'late' })).rejects.toThrow(
      /round in progress/i,
    )
    host.leave()
    a.leave()
    b.leave()
    c.leave()
  })

  it('fires the buzzer, returns to lobby, and re-deals fresh roles (CLK-03, CLK-04)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const collectors = [host, a, b, c].map((room) => collectAll(room))
    const instance = TurnoverRoom.instances.at(-1)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(6000) // full shift: TUNING.SHIFT_SECONDS × TICK_HZ

    const firstSaboteur = new Set<string>()
    for (const collector of collectors) {
      await collector.waitFor('round:buzzer')
      const dealt = await collector.waitFor('role:dealt')
      if (dealt.payload.role === 'saboteur') firstSaboteur.add('x')
      collector.stop()
    }
    expect(firstSaboteur.size).toBe(1)

    // Room is back in lobby: a join succeeds and the host can re-deal.
    const late = await newClient().joinById(host.roomId, { name: 'elin' })
    const hostCollector = collectAll(host)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)
    const redealt = await hostCollector.waitFor('role:dealt')
    expect(['staff', 'saboteur']).toContain(redealt.payload.role)
    hostCollector.stop()
    host.leave()
    a.leave()
    b.leave()
    c.leave()
    late.leave()
  })
})

// Spec CHURN-01..03: roster broadcasts on leave, implicit host migration,
// mid-round idle slots to the buzzer.
describe('server:lobby_churn', () => {
  it('broadcasts the roster without the leaver (CHURN-01)', async () => {
    const host = await createRoom('ada')
    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    const hostSnaps = collect(host)

    guest.leave()
    const after = await hostSnaps.nextWhere((s) => s.roster.length === 1)
    expect(after.roster.map((p) => p.name)).toEqual(['ada'])
    hostSnaps.stop()
    host.leave()
  })

  it('migrates the host to the earliest remaining player (CHURN-02)', async () => {
    const host = await createRoom('ada')
    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    const guestSnaps = collect(guest)

    host.leave()
    const migrated = await guestSnaps.nextWhere((s) => s.isHost)
    expect(migrated.ownName).toBe('bruno')
    expect(migrated.isHost).toBe(true)
    guestSnaps.stop()
    guest.leave()
  })

  it('keeps the round running with an idle slot after a mid-round leave (CHURN-03)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const hostCollector = collectAll(host)
    const instance = TurnoverRoom.instances.at(-1)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))

    c.leave()
    instance?.__driveTicks(6000)
    await hostCollector.waitFor('round:buzzer')

    // Back in lobby after the buzzer, with the leaver gone.
    await vi.waitFor(() => expect(instance?.__phase()).toBe('lobby'))
    const joiner = await newClient().joinById(host.roomId, { name: 'elin' })
    expect(joiner.sessionId).toBeTruthy()
    hostCollector.stop()
    host.leave()
    a.leave()
    b.leave()
    joiner.leave()
  })
})
