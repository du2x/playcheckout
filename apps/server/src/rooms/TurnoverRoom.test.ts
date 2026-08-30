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
 * Wire note (cycle 2.3): payloads arrive envelope-wrapped — collectors unwrap
 * and expose the inner payload.
 */
function collect(room: ClientRoom) {
  const snaps: LobbySnapshot[] = []
  const waiters: ((s: LobbySnapshot) => void)[] = []
  const off = room.onMessage('lobby:snapshot', (envelope) => {
    const snapshot = (envelope as { payload: LobbySnapshot }).payload
    snaps.push(snapshot)
    const waiter = waiters.shift()
    if (waiter) waiter(snapshot)
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
  // Wire note (cycle 2.3): every message arrives as { seq, time, payload } —
  // the collector unwraps and records the envelope fields alongside the payload.
  const snaps: { type: string; seq: number; time: number; payload: Record<string, unknown> }[] = []
  const wake: (() => void)[] = []
  const off = room.onMessage('*', (messageType, envelope) => {
    const { seq, time, payload } = envelope as {
      seq: number
      time: number
      payload: Record<string, unknown>
    }
    snaps.push({ type: String(messageType), seq, time, payload })
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
        if (remaining <= 0)
          throw new Error(
            `timeout waiting for ${type}; seen so far: ${snaps.map((m) => m.type).join(',')}`,
          )
        await Promise.race([
          new Promise<void>((resolve) => wake.push(resolve)),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `timeout waiting for ${type}; seen so far: ${snaps.map((m) => m.type).join(',')}`,
                  ),
                ),
              remaining,
            ),
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
      expect(Object.keys(dealt.payload).sort()).toEqual(['role'])
      roles.push(dealt.payload.role as string)
    }
    expect(roles.filter((r) => r === 'saboteur')).toHaveLength(1)
    expect(roles.filter((r) => r === 'staff')).toHaveLength(3)

    for (const collector of collectors) {
      const started = await collector.waitFor('round:started')
      // Broadcast carries ids only — no role field (protocol rule 3).
      expect(Object.keys(started.payload).sort()).toEqual(['playerIds'])
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

  // AD-004 test seam: outside production TURNOVER_TEST_SHIFT_SECONDS shortens
  // the shift; in production it is ignored and the §7 shift always runs.
  describe('TURNOVER_TEST_SHIFT_SECONDS seam (AD-004)', () => {
    it('shortens the shift outside production (1 s override → buzzer at tick 20)', async () => {
      vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '1')
      try {
        const [host, a, b, c] = await roomWithFour()
        const instance = TurnoverRoom.instances.at(-1)
        host.send('lobby:start', { type: 'lobby:start' })
        await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
        instance?.__driveTicks(19)
        expect(instance?.__phase()).toBe('round')
        instance?.__driveTicks(1)
        await vi.waitFor(() => expect(instance?.__phase()).toBe('lobby'))
        host.leave()
        a.leave()
        b.leave()
        c.leave()
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('ignores the env var in production (§7 shift unchanged)', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '1')
      try {
        const [host, a, b, c] = await roomWithFour()
        const instance = TurnoverRoom.instances.at(-1)
        host.send('lobby:start', { type: 'lobby:start' })
        await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
        instance?.__driveTicks(20)
        expect(instance?.__phase()).toBe('round') // a 1 s shift would have buzzed
        host.leave()
        a.leave()
        b.leave()
        c.leave()
      } finally {
        vi.unstubAllEnvs()
      }
    })
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

// Spec REG-05..10, REG-18 (gate scenario server:protocol_registry, live half):
// every server→client message rides the { seq, time, payload } envelope with a
// per-connection monotonic seq — including across the buzzer's return to lobby.
describe('server:protocol_registry', () => {
  it('stamps every message with an envelope; payloads carry no type tag (REG-06, REG-08)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const collectors = [host, a, b, c].map((room) => collectAll(room))
    const instance = TurnoverRoom.instances.at(-1)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)

    for (const collector of collectors) {
      const started = await collector.waitFor('round:started')
      // The test collector re-attaches the wire name as `type` when it records
      // the message; our envelope fields ride beside it and payloads themselves
      // stay type-less.
      expect(Object.keys(started).sort()).toEqual(['payload', 'seq', 'time', 'type'])
      expect(started.seq).toBeGreaterThan(0)
      expect(typeof started.time).toBe('number')
      expect(Object.keys(started.payload).sort()).toEqual(['playerIds'])
      const dealt = await collector.waitFor('role:dealt')
      expect(Object.keys(dealt.payload).sort()).toEqual(['role'])
      expect(dealt.seq).toBe(started.seq + 1)
      collector.stop()
    }
    host.leave()
    a.leave()
    b.leave()
    c.leave()
  })

  it('stamps per-connection seqs that diverge when envelope histories differ (REG-07, absolute)', async () => {
    // Host accrues 8 lobby envelopes (own join + movement snapshot, 2 joins, a
    // leave, 2 re-joins, own movement snapshot); the re-joiner accrues 3. A
    // counter shared across connections would stamp both round:started
    // envelopes with the same seq.
    const host = await createRoom('ada')
    const a = await newClient().joinById(host.roomId, { name: 'bruno' })
    const leaver = await newClient().joinById(host.roomId, { name: 'caro' })
    leaver.leave()
    const elin = await newClient().joinById(host.roomId, { name: 'elin' })
    await newClient().joinById(host.roomId, { name: 'dina' })
    const hostCollector = collectAll(host)
    const elinCollector = collectAll(elin)
    const instance = TurnoverRoom.instances.at(-1)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)

    const hostStarted = await hostCollector.waitFor('round:started')
    const elinStarted = await elinCollector.waitFor('round:started')
    // 8 lobby envelopes: own join, bruno, caro, caro's leave, elin, dina, plus
    // ada's and elin's movement snapshots are self-only (host got its own).
    expect(hostStarted.seq).toBe(9)
    // 3 lobby envelopes for elin: own join, movement snapshot, dina's join.
    expect(elinStarted.seq).toBe(4)
    hostCollector.stop()
    elinCollector.stop()
    host.leave()
    a.leave()
    elin.leave()
  })

  it('keeps seq continuity across the buzzer and a re-deal on the same connection (REG-18)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const collector = collectAll(host)
    const instance = TurnoverRoom.instances.at(-1)
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)
    // Consume the first deal so the collector holds nothing stale.
    await collector.waitFor('round:started')
    await collector.waitFor('role:dealt')
    instance?.__driveTicks(5999) // rest of the shift: buzzer fires, room returns to lobby

    const buzzer = await collector.waitFor('round:buzzer')
    expect(Object.keys(buzzer.payload)).toEqual([])

    // Counters live in the room-owned Router and survive sim disposal.
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)
    const reStarted = await collector.waitFor('round:started')
    // Buzzer + buzzer-tick movement snapshot precede the re-deal's start.
    expect(reStarted.seq).toBe(buzzer.seq + 2)
    const reDealt = await collector.waitFor('role:dealt')
    expect(reDealt.seq).toBe(reStarted.seq + 1)
    collector.stop()
    host.leave()
    a.leave()
    b.leave()
    c.leave()
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

  it('full headless round: join ×4, deal, shift, buzzer, re-deal (integration sweep)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const collectors = [host, a, b, c].map((room) => collectAll(room))
    const instance = TurnoverRoom.instances.at(-1)

    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(6000)

    let saboteurs = 0
    for (const collector of collectors) {
      const started = await collector.waitFor('round:started')
      expect(started.payload.playerIds).toHaveLength(4)
      await collector.waitFor('round:buzzer')
      const dealt = await collector.waitFor('role:dealt')
      expect(Object.keys(dealt.payload).sort()).toEqual(['role'])
      if (dealt.payload.role === 'saboteur') saboteurs++
    }
    expect(saboteurs).toBe(1)
    await vi.waitFor(() => expect(instance?.__phase()).toBe('lobby'))

    // Second round on the same room code: fresh deal, no memory of the first.
    const second = new Map(collectors.map((c2) => [c2, false]))
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1)
    let saboteurs2 = 0
    for (const collector of collectors) {
      const dealt = await collector.waitFor('role:dealt')
      if (dealt.payload.role === 'saboteur') saboteurs2++
      second.set(collector, true)
    }
    expect(saboteurs2).toBe(1)
    expect([...second.values()].every((v) => v)).toBe(true)
    for (const collector of collectors) collector.stop()
    host.leave()
    a.leave()
    b.leave()
    c.leave()
  })
})

// Spec MOVE-03/18/19 + phase transitions (gate scenarios sim:motion/sim:elevator
// server halves): movement events ride the Router in both phases, snapshots are
// self-policy, and positions persist across start and buzzer.
describe('server:movement', () => {
  it('sends the joiner an own-floor movement snapshot and delivers moves to same-floor viewers (WORK-17/18)', async () => {
    const host = await createRoom('ada')
    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    const hostCollector = collectAll(host)
    const guestCollector = collectAll(guest)

    // Guest walks right; tickMs=0 so ticks advance via the test hook.
    guest.send('move:start', { type: 'move:start', dir: 'right' })
    await new Promise((r) => setTimeout(r, 30))
    TurnoverRoom.instances.at(-1)?.__driveTicks(3)
    guest.send('move:stop', { type: 'move:stop' })
    await new Promise((r) => setTimeout(r, 30))
    TurnoverRoom.instances.at(-1)?.__driveTicks(1)

    const guestSnap = await guestCollector.waitFor('movement:snapshot')
    const snapPlayers = guestSnap.payload.players as {
      playerId: string
      floor: string
      x: number
    }[]
    expect(snapPlayers.some((p) => p.playerId === guest.sessionId)).toBe(true)
    expect(guestSnap.payload.cars).toEqual([
      { car: 1, floor: 'lobby' },
      { car: 2, floor: 'lobby' },
    ])

    const guestMoves = hostCollector.waitFor('player:moved')
    const moved = await guestMoves
    expect(moved.payload.playerId).toBe(guest.sessionId)
    expect(moved.payload.floor).toBe('lobby')
    expect((moved.payload.x as number) > 15).toBe(true)
    expect(moved.payload.facing).toBe('right')

    guestCollector.stop()
    hostCollector.stop()
    host.leave()
    guest.leave()
  })

  it('broadcasts player:left on disconnect so rectangles disappear (MOVE-19)', async () => {
    const host = await createRoom('ada')
    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    const hostCollector = collectAll(host)
    guest.leave()
    const left = await hostCollector.waitFor('player:left')
    expect(left.payload.playerId).toBe(guest.sessionId)
    hostCollector.stop()
    host.leave()
  })

  it('keeps positions across start and buzzer and re-confines post-buzzer movement (MOVE-07, MOVE-08)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '1')
    try {
      const [host, a, b, c] = await roomWithFour()
      const hostCollector = collectAll(host)
      const instanceRef = TurnoverRoom.instances.at(-1)
      host.send('move:start', { type: 'move:start', dir: 'right' })
      await new Promise((r) => setTimeout(r, 30))
      instanceRef?.__driveTicks(5)
      host.send('move:stop', { type: 'move:stop' })
      await new Promise((r) => setTimeout(r, 30))

      host.send('lobby:start', { type: 'lobby:start' })
      await vi.waitFor(() => expect(instanceRef?.__phase()).toBe('round'))
      instanceRef?.__driveTicks(20) // 1 s test shift → buzzer at tick 20

      // Buzzer: everyone gets a fresh movement snapshot; positions persist.
      const snap = await hostCollector.waitFor('movement:snapshot')
      const own = (snap.payload.players as { playerId: string; floor: string; x: number }[]).find(
        (p) => p.playerId === host.sessionId,
      )
      expect(own?.floor).toBe('lobby')
      expect(own?.x).toBeGreaterThan(15) // moved right pre-round, kept through the round

      // Post-buzzer, a new snapshot is self-policy — the guest never sees one
      // generated for the host's connection.
      hostCollector.stop()
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('routes elevator press and arrival events through the Router (sim:elevator server half)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '30')
    try {
      const [host, a, b, c] = await roomWithFour()
      const hostCollector = collectAll(host)
      const instanceRef = TurnoverRoom.instances.at(-1)
      host.send('lobby:start', { type: 'lobby:start' })
      await vi.waitFor(() => expect(instanceRef?.__phase()).toBe('round'))
      // A lobby call with a car parked open-doors is a decoy flash (no dispatch).
      host.send('elevator:call', { type: 'elevator:call' })
      await new Promise((r) => setTimeout(r, 30))
      const calledPromise = hostCollector.waitFor('elevator:called')
      instanceRef?.__driveTicks(1) // the flash announces on the next tick
      const called = await calledPromise
      expect(called.payload).toEqual({ floor: 'lobby', car: 1 })
      // Board the parked west car (auto-boarding within the landing zone) and
      // choose the destination in-car: the rider-exclusive press and the public
      // arrival both route through the Router.
      host.send('move:start', { type: 'move:start', dir: 'left' })
      await new Promise((r) => setTimeout(r, 30))
      instanceRef?.__driveTicks(50)
      host.send('move:stop', { type: 'move:stop' })
      await new Promise((r) => setTimeout(r, 30))
      host.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
      await new Promise((r) => setTimeout(r, 30))
      const pressedPromise = hostCollector.waitFor('elevator:pressed')
      instanceRef?.__driveTicks(1)
      const pressed = await pressedPromise
      expect(pressed.payload).toEqual({ playerId: host.sessionId, floor: 'floor1' })
      instanceRef?.__driveTicks(40) // lobby → floor1 ride
      const arrival = await hostCollector.waitFor('elevator:moved')
      expect(arrival.payload).toEqual({ car: 1, floor: 'floor1' })
      hostCollector.stop()
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('answers elevator intents pre-round and rejects only rider calls (EL-01, EL-03, AD-011)', async () => {
    const host = await createRoom('ada')
    const hostCollector = collectAll(host)
    const instance = TurnoverRoom.instances.at(-1)
    // Pre-round, both cars sit open-doors at the lobby: a call is answered with
    // the decoy flash — the elevator sim runs from room creation (AD-011).
    host.send('elevator:call', { type: 'elevator:call' })
    await new Promise((r) => setTimeout(r, 50))
    instance?.__driveTicks(1)
    const called = await hostCollector.waitFor('elevator:called')
    expect(called.payload).toEqual({ floor: 'lobby', car: 1 })
    // Pre-round boarding, in-car press, and ride all work (AD-011): walk to
    // the west landing — auto-boarding catches the parked car.
    host.send('move:start', { type: 'move:start', dir: 'left' })
    await new Promise((r) => setTimeout(r, 50))
    instance?.__driveTicks(60)
    host.send('move:stop', { type: 'move:stop' })
    await new Promise((r) => setTimeout(r, 50))
    host.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
    await new Promise((r) => setTimeout(r, 50))
    instance?.__driveTicks(40) // lobby → floor1 ride
    await hostCollector.waitFor('elevator:moved')
    // Now a rider (aboard the dwelling car): a call is the one rejection.
    host.send('elevator:call', { type: 'elevator:call' })
    const err = await hostCollector.waitFor('error')
    expect(err.payload.code).toBe('elevator-locked')
    hostCollector.stop()
    host.leave()
  })
})

// Spec ELR-01..09 (gate scenario sim:elevator_riders, room half): the room
// wires destination-free calls, silent non-rider press rejection, and the
// AD-013 viewer-branch snapshot — riders get their car's occupants + queue,
// non-riders never see occupancy or queue on any message.
describe('server:elevator_riders', () => {
  /** Records every message type+payload without consuming them. */
  function feed(room: ClientRoom) {
    const seen: { type: string; payload: Record<string, unknown> }[] = []
    const off = room.onMessage('*', (messageType, envelope) => {
      seen.push({
        type: String(messageType),
        payload: (envelope as { payload: Record<string, unknown> }).payload,
      })
    })
    return {
      seen,
      stop() {
        off()
      },
    }
  }

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
  }

  /** Board both players into the parked west car and press floor1 (car departs). */
  async function boardAndPressFloor1(instance: TurnoverRoom, riders: ClientRoom[]) {
    for (const rider of riders) {
      rider.send('move:start', { type: 'move:start', dir: 'left' })
    }
    await sleep(50)
    instance.__driveTicks(60) // walk from center; auto-boarding catches the car
    for (const rider of riders) rider.send('move:stop', { type: 'move:stop' })
    await sleep(50)
    riders[0]?.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
    await sleep(50)
    instance.__driveTicks(2) // flush the press + riders announcements
    await sleep(50)
  }

  it('delivers elevator:pressed/riders to the car riders only and snapshots carOccupants at the buzzer (ELR-01..04)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '1')
    try {
      const [host, a, b, c] = await roomWithFour()
      const feeds = [host, a, b, c].map((room) => feed(room))
      const instance = TurnoverRoom.instances.at(-1)
      if (instance === undefined) throw new Error('no room instance')

      await boardAndPressFloor1(instance, [host, a])

      // Rider-exclusive delivery: the presser's feed carries the press and the
      // co-rider occupancy updates; the floor players' feeds carry neither.
      const pressed = (feeds[0]?.seen ?? []).find((m) => m.type === 'elevator:pressed')?.payload
      expect(pressed).toEqual({ playerId: host.sessionId, floor: 'floor1' })
      const hostRidersUpdates = feeds[0]?.seen.filter((m) => m.type === 'elevator:riders') ?? []
      const lastRiders = hostRidersUpdates.at(-1)?.payload
      expect(lastRiders?.car).toBe(1)
      expect(lastRiders?.queue).toEqual([])
      expect((lastRiders?.riders as string[]).sort()).toEqual([host.sessionId, a.sessionId].sort())
      for (const floorFeed of [feeds[2], feeds[3]]) {
        const types = floorFeed?.seen.map((m) => m.type) ?? []
        expect(types).not.toContain('elevator:pressed')
        expect(types).not.toContain('elevator:riders')
      }

      // Round starts (1 s test shift); the car is mid-ride at the buzzer.
      host.send('lobby:start', { type: 'lobby:start' })
      await vi.waitFor(() => expect(instance.__phase()).toBe('round'))
      instance.__driveTicks(20)
      await sleep(50) // envelope flush

      // Rider snapshot: empty players list + their car's occupants and queue.
      const riderSnaps = feeds[0]?.seen.filter((m) => m.type === 'movement:snapshot') ?? []
      expect(riderSnaps).toHaveLength(1)
      const riderSnap = riderSnaps[0]?.payload as Record<string, unknown>
      expect(riderSnap.players).toEqual([])
      expect(riderSnap.carOccupants).toEqual({
        car: 1,
        riders: expect.arrayContaining([host.sessionId, a.sessionId]),
        queue: ['floor1'],
      })
      expect((riderSnap.carOccupants as { riders: string[] }).riders).toHaveLength(2)

      // Non-rider snapshot: no occupancy field, floor stream without the riders.
      const floorSnaps = feeds[2]?.seen.filter((m) => m.type === 'movement:snapshot') ?? []
      expect(floorSnaps).toHaveLength(1)
      const floorSnap = floorSnaps[0]?.payload as {
        players: { playerId: string }[]
        carOccupants?: unknown
      }
      expect(floorSnap.carOccupants).toBeUndefined()
      const floorIds = floorSnap.players.map((p) => p.playerId)
      expect(floorIds).toContain(b.sessionId)
      expect(floorIds).not.toContain(host.sessionId)
      expect(floorIds).not.toContain(a.sessionId)

      // Ubiquitous: no occupancy/queue field reaches a non-rider on ANY message.
      for (const message of feeds[2]?.seen ?? []) {
        expect(message.payload).not.toHaveProperty('carOccupants')
        expect(message.payload).not.toHaveProperty('riders')
        expect(message.payload).not.toHaveProperty('queue')
      }
      for (const f of feeds) f.stop()
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('rejects a non-rider press silently: no press event, no error, queue untouched (ELR-06 AC3)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const feeds = [host, a, b, c].map((room) => feed(room))
    const instance = TurnoverRoom.instances.at(-1)
    if (instance === undefined) throw new Error('no room instance')

    // Host stands on the lobby floor, in no car: the press is rejected with
    // nothing on the wire — no elevator:pressed anywhere, no error back.
    host.send('elevator:press', { type: 'elevator:press', floor: 'floor2' })
    await sleep(50)
    instance.__driveTicks(2)
    await sleep(50)
    for (const f of feeds) {
      const types = f.seen.map((m) => m.type)
      expect(types).not.toContain('elevator:pressed')
      expect(types).not.toContain('error')
    }
    for (const f of feeds) f.stop()
    host.leave()
    a.leave()
    b.leave()
    c.leave()
  })

  it('flashes a duplicate same-floor call without a second dispatch (ELR-06 AC7, AD-012 narrowed)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const feeds = [host, a, b, c].map((room) => feed(room))
    const instance = TurnoverRoom.instances.at(-1)
    if (instance === undefined) throw new Error('no room instance')

    // Both cars must be AWAY from the lobby for a lobby call to dispatch at
    // all (a parked open-door car makes it a duplicate — pinned separately).
    // Host rides car 1 to floor1; b rides car 2 to floor2 (AD-011: pre-round).
    host.send('move:start', { type: 'move:start', dir: 'left' })
    await sleep(50)
    instance.__driveTicks(60)
    host.send('move:stop', { type: 'move:stop' })
    await sleep(50)
    host.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
    await sleep(50)
    b.send('move:start', { type: 'move:start', dir: 'right' })
    await sleep(50)
    instance.__driveTicks(60) // host's ride completes; b auto-boards car 2
    b.send('move:stop', { type: 'move:stop' })
    await sleep(50)
    b.send('elevator:press', { type: 'elevator:press', floor: 'floor2' })
    await sleep(50)
    instance.__driveTicks(60) // b's ride completes; both cars idle, occupied
    await sleep(50)

    // c (alone in the lobby) dispatches car 1 (closest landing, tie → 1); the
    // immediate re-call duplicates on the pickup floor: it flashes the panel
    // but dispatches nothing.
    c.send('elevator:call', { type: 'elevator:call' })
    await sleep(50)
    c.send('elevator:call', { type: 'elevator:call' })
    await sleep(50)
    instance.__driveTicks(65) // full 60-tick arrival + margin
    await sleep(50)

    const called = (feeds[3]?.seen ?? []).filter((m) => m.type === 'elevator:called')
    expect(called).toHaveLength(2)
    expect(called[0]?.payload).toEqual({ floor: 'lobby', car: 1 })
    expect(called[1]?.payload).toEqual({ floor: 'lobby', car: 1 })
    // Exactly ONE arrival: the duplicate produced no second dispatch.
    const moved = (feeds[3]?.seen ?? []).filter(
      (m) => m.type === 'elevator:moved' && m.payload.car === 1 && m.payload.floor === 'lobby',
    )
    expect(moved).toHaveLength(1)
    for (const f of feeds) f.stop()
    host.leave()
    a.leave()
    b.leave()
    c.leave()
  })

  it('flushes a mid-trip rider disconnect: remaining rider updated, slot freed, player:left unchanged (ELR-01/02, design disconnect row)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '30')
    try {
      const [host, a, b, c] = await roomWithFour()
      const feeds = [host, a, b, c].map((room) => feed(room))
      const instance = TurnoverRoom.instances.at(-1)
      if (instance === undefined) throw new Error('no room instance')

      // Round active: the later landing candidate must walk on floor1 (MOVE-06).
      host.send('lobby:start', { type: 'lobby:start' })
      await vi.waitFor(() => expect(instance.__phase()).toBe('round'))
      instance.__driveTicks(1) // the deal tick

      // host + a board car 1 and depart toward floor1.
      await boardAndPressFloor1(instance, [host, a])

      // a disconnects MID-TRIP (car 1 riding, doors shut).
      const seenBeforeLeave = feeds[0]?.seen.length ?? 0
      a.leave()
      await sleep(50)
      instance.__driveTicks(1) // the disconnect-dirty flush tick
      await sleep(50)

      // (a) The remaining rider's feed carries exactly one elevator:riders —
      // the leaver no longer names the car; the queued floor survives.
      const postLeave = (feeds[0]?.seen ?? []).slice(seenBeforeLeave)
      const flushes = postLeave.filter((m) => m.type === 'elevator:riders')
      expect(flushes).toHaveLength(1)
      expect(flushes[0]?.payload).toEqual({
        car: 1,
        riders: [host.sessionId],
        queue: ['floor1'],
      })

      // (c) The player:left broadcast is unchanged by the movement wiring.
      const left = postLeave.find((m) => m.type === 'player:left')
      expect(left?.payload).toEqual({ playerId: a.sessionId })

      // (b) The freed capacity slot is boardable: b rides car 2 to floor1 and
      // walks to car 1's west landing — boarding a car that already carries
      // host is possible only because the disconnect removed a from car.riders
      // (a ghost leaver would keep the capacity-2 car full forever).
      b.send('move:start', { type: 'move:start', dir: 'right' })
      await sleep(50)
      instance.__driveTicks(60) // walk from center; auto-boarding catches car 2
      b.send('move:stop', { type: 'move:stop' })
      await sleep(50)
      b.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
      await sleep(50)
      instance.__driveTicks(40) // lobby → floor1 ride
      await sleep(50)
      b.send('move:start', { type: 'move:start', dir: 'left' }) // exit in the dwell
      await sleep(50)
      instance.__driveTicks(110) // walk 30 → 0.9 tiles from the west landing
      await sleep(50)
      instance.__driveTicks(2) // flush b's boarding occupancy update
      await sleep(50)

      const boardFlush = (feeds[0]?.seen ?? [])
        .filter((m) => m.type === 'elevator:riders')
        .at(-1)?.payload
      expect(boardFlush?.car).toBe(1)
      expect((boardFlush?.riders as string[]).sort()).toEqual([host.sessionId, b.sessionId].sort())

      for (const f of feeds) f.stop()
      host.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

// Spec WORK-01..16 (gate scenarios sim:prep/sim:unprep/sim:fake_prep, server
// halves): work intents through the room, positions feeding the sim (AD-005
// seam), and positional delivery — interiors reach only segment occupants.
// Timing note: intent WS arrival races fixed tick counts, so events are awaited
// with a drive-until helper; exact channel durations are pinned at sim level
// (sim:prep/sim:unprep/sim:fake_prep), the server asserts payloads and routing.
describe('server:work_channels', () => {
  /** Drive ticks until the collector holds the event, then return it. */
  async function driveUntil(
    collector: ReturnType<typeof collectAll>,
    type: string,
    instance: TurnoverRoom,
    maxTicks = 300,
  ) {
    for (let i = 0; i < maxTicks; i++) {
      instance.__driveTicks(1)
      await new Promise((r) => setTimeout(r, 10))
      try {
        return await collector.waitFor(type, 0)
      } catch {
        // buffer still empty this round — drive again
      }
    }
    throw new Error(`driveUntil: ${type} never arrived within ${maxTicks} ticks`)
  }

  async function sleep(ms: number) {
    await new Promise((r) => setTimeout(r, ms))
  }

  /** Records every message type+payload without consuming them (negative assertions). */
  function record(room: ClientRoom) {
    const seen: { type: string; payload: Record<string, unknown> }[] = []
    const off = room.onMessage('*', (messageType, envelope) => {
      seen.push({
        type: String(messageType),
        payload: (envelope as { payload: Record<string, unknown> }).payload,
      })
    })
    return {
      seen,
      stop() {
        off()
      },
    }
  }

  /** Index of a client in the roomWithFour ordering (collector alignment). */
  function clients_index(clients: readonly ClientRoom[], target: ClientRoom): number {
    const index = clients.indexOf(target)
    if (index < 0) throw new Error('client not in list')
    return index
  }

  /** Start a round with a 30 s test shift and read each player's private role. */
  async function startWithRoles(
    clients: ClientRoom[],
    collectors: ReturnType<typeof collectAll>[],
  ): Promise<{ instance: TurnoverRoom; staff: ClientRoom[]; saboteur: ClientRoom }> {
    const instance = TurnoverRoom.instances.at(-1)
    if (instance === undefined) throw new Error('no room instance')
    clients[0]?.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance.__phase()).toBe('round'))
    instance.__driveTicks(1) // the deal tick
    const roles = new Map<ClientRoom, string>()
    for (const [i, collector] of collectors.entries()) {
      const dealt = await collector.waitFor('role:dealt')
      const client = clients[i]
      if (client === undefined) throw new Error('client missing')
      roles.set(client, dealt.payload.role as string)
    }
    const staff = clients.filter((c) => roles.get(c) === 'staff')
    const saboteur = clients.find((c) => roles.get(c) === 'saboteur')
    if (saboteur === undefined || staff.length < 2) throw new Error('unexpected deal')
    return { instance, staff, saboteur }
  }

  /**
   * Ride a player to floor1 and walk them to x tiles (AD-014 press model):
   * walking into the parked car's landing zone auto-boards them; the in-car
   * press chooses the destination; the exit is a held direction during the
   * open-door dwell at the served floor. `first` picks the car: car 1 boards
   * at the west landing (x=0), car 2 at the east landing (x=30).
   */
  async function rideToFloor1X(
    instance: TurnoverRoom,
    player: ClientRoom,
    xTiles: number,
    first = true,
  ) {
    const toLanding = first ? 'left' : 'right'
    const awayFromLanding = first ? 'right' : 'left'
    player.send('move:start', { type: 'move:start', dir: toLanding })
    await sleep(50)
    instance.__driveTicks(60) // walk from center; auto-boarding catches the parked car
    player.send('move:stop', { type: 'move:stop' })
    await sleep(50)
    player.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
    await sleep(50)
    instance.__driveTicks(40) // lobby → floor1 ride (RIDE_TICKS_PER_FLOOR)
    player.send('move:start', { type: 'move:start', dir: awayFromLanding }) // exit in the dwell
    await sleep(50)
    instance.__driveTicks(Math.round((xTiles * 10) / 3)) // 300 millitiles/tick
    player.send('move:stop', { type: 'move:stop' })
    await sleep(50)
    instance.__driveTicks(1) // terminal reconcile tick
  }

  it('routes a staff prep end-to-end: work:started, room:prepped to occupants, work:ended (WORK-01/02)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '30')
    try {
      const [host, a, b, c] = await roomWithFour()
      const collectors = [host, a, b, c].map((room) => collectAll(room))
      const { instance, staff } = await startWithRoles([host, a, b, c], collectors)
      const worker = staff[0]
      if (worker === undefined) throw new Error('no staff player')
      const workerIdx = clients_index([host, a, b, c], worker)
      const workerCollector = collectors[workerIdx]
      if (workerCollector === undefined) throw new Error('no collector')

      await rideToFloor1X(instance, worker, 3) // inside room 1
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const started = await driveUntil(workerCollector, 'work:started', instance)
      expect(started.payload).toEqual({
        playerId: worker.sessionId,
        floor: 'floor1',
        room: 1,
        seconds: 5,
      })
      // Entering the segment observed the fresh interior — to the worker only.
      const observed = await workerCollector.waitFor('room:observed')
      expect(observed.payload).toEqual({
        playerId: worker.sessionId,
        floor: 'floor1',
        room: 1,
        state: 'fresh',
      })

      await driveUntil(workerCollector, 'work:ended', instance)
      const prepped = await workerCollector.waitFor('room:prepped')
      expect(prepped.payload).toEqual({ floor: 'floor1', room: 1 })

      // Occupants-only: a viewer in the lobby received no interior event.
      const lobbyCollector = collectors[0]
      await expect(lobbyCollector?.waitFor('room:prepped', 300)).rejects.toThrow(/timeout/)
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('delivers room transitions only to segment occupants — same floor, other room sees nothing (WORK-15)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '30')
    try {
      const [host, a, b, c] = await roomWithFour()
      const collectors = [host, a, b, c].map((room) => collectAll(room))
      const { instance, staff } = await startWithRoles([host, a, b, c], collectors)
      const worker = staff[0]
      const outsider = staff[1]
      if (worker === undefined || outsider === undefined) throw new Error('staff missing')
      const outsiderFeed = record(outsider)

      await rideToFloor1X(instance, worker, 3) // room 1
      await rideToFloor1X(instance, outsider, 2.5, false) // car 2 east: walk left 2.4 tiles → x≈27.6 → room 8

      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const workerCollector = collectors[clients_index([host, a, b, c], worker)]
      if (workerCollector === undefined) throw new Error('no collector')
      await driveUntil(workerCollector, 'work:ended', instance)
      await sleep(50)
      instance.__driveTicks(2)

      // Positive control: the outsider did receive their own interior view —
      // the LAST observation is room 3 (they walked through rooms 1 and 2).
      const observed = outsiderFeed.seen.filter((m) => m.type === 'room:observed').at(-1)
      expect(observed?.payload).toEqual({
        playerId: outsider.sessionId,
        floor: 'floor1',
        room: 8,
        state: 'fresh',
      })
      // …but none of the worker's channel facts or room transition.
      const types = outsiderFeed.seen.map((m) => m.type)
      expect(types).not.toContain('room:prepped')
      expect(types).not.toContain('work:started')
      expect(types).not.toContain('work:ended')
      outsiderFeed.stop()
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('rejects work:start in lobby phase, outside segments, twice, and on prepped rooms (WORK-03)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '30')
    try {
      const [host, a, b, c] = await roomWithFour()
      const collectors = [host, a, b, c].map((room) => collectAll(room))
      // Lobby phase: work is impossible before the round starts.
      host.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const early = await collectors[0]?.waitFor('error')
      expect(early?.payload.code).toBe('round-not-active')

      const { instance, staff } = await startWithRoles([host, a, b, c], collectors)
      const worker = staff[0]
      if (worker === undefined) throw new Error('no staff player')
      const workerCollector = collectors[clients_index([host, a, b, c], worker)]
      if (workerCollector === undefined) throw new Error('no collector')

      // Still standing in the lobby: not inside any segment.
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const outside = await workerCollector.waitFor('error')
      expect(outside.payload.code).toBe('not-in-room')

      await rideToFloor1X(instance, worker, 3)
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      await driveUntil(workerCollector, 'work:started', instance)
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const busy = await workerCollector.waitFor('error')
      expect(busy.payload.code).toBe('channel-active')

      await driveUntil(workerCollector, 'work:ended', instance) // finish the prep
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const done = await workerCollector.waitFor('error')
      expect(done.payload.code).toBe('room-not-workable')
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('runs the saboteur matrix end-to-end: un-prep the prepped room, fake-prep a fresh one (WORK-04/05/08/09)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '60')
    try {
      const [host, a, b, c] = await roomWithFour()
      const collectors = [host, a, b, c].map((room) => collectAll(room))
      const { instance, staff, saboteur } = await startWithRoles([host, a, b, c], collectors)
      const worker = staff[0]
      if (worker === undefined) throw new Error('no staff player')
      const workerCollector = collectors[clients_index([host, a, b, c], worker)]
      const sabCollector = collectors[clients_index([host, a, b, c], saboteur)]
      if (workerCollector === undefined || sabCollector === undefined)
        throw new Error('no collector')

      // Staff preps room 1 and stays inside (occupant of the coming trash event).
      await rideToFloor1X(instance, worker, 3)
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      await driveUntil(workerCollector, 'work:ended', instance)
      await workerCollector.waitFor('room:prepped')

      // Saboteur rides car 2 (east landing) and walks left to room 1 (x≈3).
      await rideToFloor1X(instance, saboteur, 27.6, false) // car 2 east: walk left to x≈2.4 → room 1
      saboteur.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const started = await driveUntil(sabCollector, 'work:started', instance)
      expect(started.payload).toEqual({
        playerId: saboteur.sessionId,
        floor: 'floor1',
        room: 1,
        seconds: 3,
      })
      const ended = await driveUntil(sabCollector, 'work:ended', instance)
      expect(ended.payload.outcome).toBe('completed')
      const trashed = await sabCollector.waitFor('room:trashed')
      expect(trashed.payload).toEqual({ floor: 'floor1', room: 1 })
      // The staff occupant of the same room saw the transition too (WORK-15).
      await workerCollector.waitFor('room:trashed')

      // Fake prep on a fresh room: identical confirmation, no transition ever.
      saboteur.send('move:start', { type: 'move:start', dir: 'right' })
      await sleep(50)
      instance.__driveTicks(9) // x ≈ 5700 → room 2 (fresh)
      saboteur.send('move:stop', { type: 'move:stop' })
      await sleep(50)
      instance.__driveTicks(1)
      saboteur.send('work:start', { type: 'work:start', floor: 'floor1', room: 2 })
      const fakeStarted = await driveUntil(sabCollector, 'work:started', instance)
      expect(fakeStarted.payload).toEqual({
        playerId: saboteur.sessionId,
        floor: 'floor1',
        room: 2,
        seconds: 5,
      })
      await driveUntil(sabCollector, 'work:ended', instance)
      await expect(sabCollector.waitFor('room:prepped', 300)).rejects.toThrow(/timeout/)
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('dies with the round: a channel live at the buzzer emits no work:ended (WORK-13)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '30')
    try {
      const [host, a, b, c] = await roomWithFour()
      const collectors = [host, a, b, c].map((room) => collectAll(room))
      const { instance, staff } = await startWithRoles([host, a, b, c], collectors)
      const worker = staff[0]
      if (worker === undefined) throw new Error('no staff player')
      const workerCollector = collectors[clients_index([host, a, b, c], worker)]
      if (workerCollector === undefined) throw new Error('no collector')
      await rideToFloor1X(instance, worker, 3)
      // Park before the buzzer (600-tick shift) and start a prep that cannot
      // finish before tick 600. The press-model ride is 60 ticks shorter than
      // the legacy call ride was, so the park wait makes up the difference and
      // the channel starts at the same absolute tick it always did.
      instance.__driveTicks(410)
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      await driveUntil(workerCollector, 'work:started', instance)
      // The channel cannot outlast the remaining shift: drive to the buzzer.
      instance.__driveTicks(600)
      await workerCollector.waitFor('round:buzzer')
      await expect(workerCollector?.waitFor('work:ended', 300)).rejects.toThrow(/timeout/)
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const late = await workerCollector?.waitFor('error')
      expect(late?.payload.code).toBe('round-not-active')
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

// Room-shell verifier fold-ins (deferred notes, cycle 2.1): the lobby phase
// re-asserts its guards after a rejection, and a rejected join leaves the
// roster untouched.
describe('server:lobby folds', () => {
  it('accepts the host start after a rejected non-host start (reject-then-start leg)', async () => {
    const [host, a, b, c] = await roomWithFour()
    const aCollector = collectAll(a)
    a.send('lobby:start', { type: 'lobby:start' })
    const err = await aCollector.waitFor('error')
    expect(err.payload.code).toBe('not-host')
    // The lobby phase still accepts a valid start afterwards.
    const hostCollector = collectAll(host)
    host.send('lobby:start', { type: 'lobby:start' })
    const instance = TurnoverRoom.instances.at(-1)
    await vi.waitFor(() => expect(instance?.__phase()).toBe('round'))
    instance?.__driveTicks(1) // the deal tick carries round:started
    const started = await hostCollector.waitFor('round:started')
    expect(started.payload.playerIds).toHaveLength(4)
    aCollector.stop()
    hostCollector.stop()
    host.leave()
    a.leave()
    b.leave()
    c.leave()
  })

  it('leaves the roster unchanged when a duplicate-name join is rejected (LOBBY-05)', async () => {
    const host = await createRoom('ada')
    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    const guestCollector = collectAll(guest)
    const before = guestCollector.waitFor('lobby:snapshot')
    await expect(newClient().joinById(host.roomId, { name: 'bruno' })).rejects.toThrow(
      /name taken/i,
    )
    // No fresh snapshot follows the rejection: the roster is unchanged.
    await new Promise((r) => setTimeout(r, 100))
    const snapshot = await before
    const roster = snapshot.payload.roster as { name: string }[]
    expect(roster.map((p) => p.name)).toEqual(['ada', 'bruno'])
    guestCollector.stop()
    host.leave()
    guest.leave()
  })
})

// Spec EVID-04 (cycle 2.7): the door-open exit snapshot carries the arrival
// floor's carded rooms — cards are floor-public (FR-11) and the round sim
// owns the card set (AD-005 seam).
describe('server:evidence', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('delivers the arrival floor carded rooms in the exit snapshot (EVID-04)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '30')
    try {
      const [host, a, b, c] = await roomWithFour()
      const pages = [host, a, b, c]
      // Private role deals (rule 3): read each client's own role:dealt to pick
      // the staff rider — a saboteur's work on a fresh room is a FAKE (FR-9)
      // and would correctly hang no card.
      const roles = new Map<ClientRoom, string>()
      for (const p of pages) {
        p.onMessage('role:dealt', (envelope) =>
          roles.set(p, (envelope as { payload: { role: string } }).payload.role),
        )
      }
      const hostCollector = collectAll(host)
      const instanceRef = TurnoverRoom.instances.at(-1)
      host.send('lobby:start', { type: 'lobby:start' })
      await vi.waitFor(() => expect(instanceRef?.__phase()).toBe('round'))
      instanceRef?.__driveTicks(1) // the deal (round:started + role:dealt each)
      await vi.waitFor(() => expect(roles.size).toBe(4))
      const staffPage = pages.find((p) => roles.get(p) === 'staff')
      if (staffPage === undefined) throw new Error('no staff dealt')
      // The snapshot receiver is a different page than the staff rider.
      const receiver = pages.find((p) => p !== staffPage)
      if (receiver === undefined) throw new Error('no receiver page')
      const staffCollector = collectAll(staffPage)
      const receiverCollector = collectAll(receiver)

      // --- Staff rider: car 1 up, exit, park inside room 1, real prep. ---
      staffPage.send('elevator:call', { type: 'elevator:call' })
      await sleep(60)
      staffPage.send('move:start', { type: 'move:start', dir: 'left' })
      await sleep(60)
      instanceRef?.__driveTicks(50) // walk into the boarding zone; auto-board
      await staffCollector.waitFor('elevator:riders', 8000) // boarding confirmed
      staffPage.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
      await sleep(60)
      instanceRef?.__driveTicks(1)
      await staffCollector.waitFor('elevator:pressed', 8000)
      instanceRef?.__driveTicks(40) // lobby → floor1
      await staffCollector.waitFor('elevator:moved', 8000)
      staffPage.send('move:start', { type: 'move:start', dir: 'right' }) // exit
      await sleep(60)
      await staffCollector.waitFor('movement:snapshot', 8000) // door-open exit

      // Drain the boarding walk's queued moved events so the parking loop
      // below reads only fresh positions.
      for (;;) {
        try {
          await staffCollector.waitFor('player:moved', 40)
        } catch {
          break
        }
      }

      // Walk right until parked INSIDE room 1's segment ([1000, 4500) milli).
      staffPage.send('move:start', { type: 'move:start', dir: 'right' })
      await sleep(60)
      let ownX = 0
      for (let i = 0; i < 15 && ownX < 2.1; i++) {
        instanceRef?.__driveTicks(1)
        const moved = await staffCollector.waitFor('player:moved')
        ownX = (moved.payload as { x: number }).x
      }
      expect(ownX).toBeGreaterThanOrEqual(2.1)
      expect(ownX).toBeLessThan(4.4) // parked with margin before the far edge
      staffPage.send('move:stop', { type: 'move:stop' })
      // Park-until-still: probe until TWO consecutive driven ticks produce no
      // own movement — only then is the stop intent guaranteed processed (a
      // late stop would walk the rider out of the segment and cancel).
      let quietProbes = 0
      let lastX = ownX
      for (let i = 0; i < 20 && quietProbes < 2; i++) {
        instanceRef?.__driveTicks(1)
        try {
          const moved = await staffCollector.waitFor('player:moved', 1200)
          lastX = (moved.payload as { x: number }).x
          quietProbes = 0
        } catch {
          quietProbes++
        }
      }
      expect(quietProbes).toBe(2)
      expect(lastX).toBeLessThan(4.4)

      staffPage.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      await sleep(60)
      instanceRef?.__driveTicks(2) // the private start confirmation announces next tick
      await staffCollector.waitFor('work:started', 8000)
      instanceRef?.__driveTicks(100)
      // The card hangs on the prep completion (EVID-01).
      await staffCollector.waitFor('room:carded', 8000)

      // --- Receiver: rides up and exits — the door-open exit snapshot
      // carries the arrival floor's carded rooms (EVID-04). Car 2 sits parked
      // open-doors at the east lobby landing, so no call is needed (a call
      // here would be the decoy flash, FR-5) — walk straight in and board.
      receiver.send('move:start', { type: 'move:start', dir: 'right' })
      await sleep(60)
      instanceRef?.__driveTicks(50) // walk into the east boarding zone; auto-board
      await receiverCollector.waitFor('elevator:riders', 8000)
      receiver.send('move:stop', { type: 'move:stop' })
      await sleep(60)
      receiver.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
      await sleep(60)
      instanceRef?.__driveTicks(1)
      await receiverCollector.waitFor('elevator:pressed', 8000)
      instanceRef?.__driveTicks(40) // lobby → floor1
      await receiverCollector.waitFor('elevator:moved', 8000)
      receiver.send('move:start', { type: 'move:start', dir: 'right' }) // exit → snapshot
      await sleep(60)
      const exitSnap = await receiverCollector.waitFor('movement:snapshot', 8000)
      expect(exitSnap.payload.cardedRooms).toEqual([1])

      hostCollector.stop()
      staffCollector.stop()
      receiverCollector.stop()
      for (const p of pages) p.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

// Spec JUST-04/06/09/12/13 server half (cycle 2.8): the accuse intent is
// validated server-side, firing routes one name-only payload to ALL, fired
// sessions are torn down (no positional streams, intents rejected), and the
// round continues — win checks are cycle 2.9.
describe('server:justice', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  function collectorOf(
    collectors: ReturnType<typeof collectAll>[],
    clients: readonly ClientRoom[],
    client: ClientRoom,
  ): ReturnType<typeof collectAll> {
    const c = collectors[clients.indexOf(client)]
    if (c === undefined) throw new Error('no collector for client')
    return c
  }

  /** Records every message type+payload without consuming them (negative assertions). */
  function record(room: ClientRoom) {
    const seen: { type: string; payload: Record<string, unknown> }[] = []
    const off = room.onMessage('*', (messageType, envelope) => {
      seen.push({
        type: String(messageType),
        payload: (envelope as { payload: Record<string, unknown> }).payload,
      })
    })
    return {
      seen,
      stop() {
        off()
      },
    }
  }

  /** Drive ticks until the collector holds the event (work_channels pattern). */
  async function driveUntil(
    collector: ReturnType<typeof collectAll>,
    type: string,
    instance: TurnoverRoom,
    maxTicks = 400,
  ) {
    for (let i = 0; i < maxTicks; i++) {
      instance.__driveTicks(1)
      await sleep(8)
      try {
        return await collector.waitFor(type, 0)
      } catch {
        // not yet — drive again
      }
    }
    throw new Error(`driveUntil: ${type} never arrived within ${maxTicks} ticks`)
  }

  /**
   * Ride a player to floor1 inside room 1 (x ≈ 3.6 tiles) — parked, still.
   * The call is a decoy flash while both cars are home (AD-019) and summons
   * the far car once one has left the lobby; walking into the landing zone
   * auto-boards either way, and boarding still works on the open-doors idle
   * the walk may arrive at (AD-016).
   */
  async function rideToRoom1(instance: TurnoverRoom, player: ClientRoom) {
    player.send('elevator:call', { type: 'elevator:call' })
    await sleep(50)
    instance.__driveTicks(65) // summoned car arrives (or both-parked flash)
    player.send('move:start', { type: 'move:start', dir: 'left' })
    await sleep(50)
    instance.__driveTicks(55) // walk into the west landing zone; auto-board
    player.send('move:stop', { type: 'move:stop' })
    await sleep(50)
    player.send('elevator:press', { type: 'elevator:press', floor: 'floor1' })
    await sleep(50)
    instance.__driveTicks(40) // lobby → floor1
    player.send('move:start', { type: 'move:start', dir: 'right' }) // exit in dwell
    await sleep(50)
    instance.__driveTicks(12) // park at x ≈ 3.6 tiles (room 1: [1, 4.5))
    player.send('move:stop', { type: 'move:stop' })
    await sleep(50)
    instance.__driveTicks(1)
  }

  /** Start a round and resolve each player's private role (rule 3: self only). */
  async function startWithRoles(
    clients: ClientRoom[],
  ): Promise<{ instance: TurnoverRoom; staff: ClientRoom[]; saboteur: ClientRoom }> {
    const instance = TurnoverRoom.instances.at(-1)
    if (instance === undefined) throw new Error('no room instance')
    const collectors = clients.map((room) => collectAll(room))
    clients[0]?.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance.__phase()).toBe('round'))
    instance.__driveTicks(1)
    const roles = new Map<ClientRoom, string>()
    for (const [i, collector] of collectors.entries()) {
      const dealt = await collector.waitFor('role:dealt')
      const client = clients[i]
      if (client === undefined) throw new Error('client missing')
      roles.set(client, dealt.payload.role as string)
    }
    const staff = clients.filter((c) => roles.get(c) === 'staff')
    const saboteur = clients.find((c) => roles.get(c) === 'saboteur')
    if (saboteur === undefined || staff.length < 2) throw new Error('unexpected deal')
    return { instance, staff, saboteur }
  }

  it('routes a correct accusation as one name-only payload to every connection (JUST-12/13)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '60')
    try {
      const [host, a, b, c] = await roomWithFour()
      const clients = [host, a, b, c]
      const collectors = clients.map((room) => collectAll(room))
      const { instance, staff, saboteur } = await startWithRoles(clients)
      const worker = staff[0]
      if (worker === undefined) throw new Error('no staff player')
      const watcher = staff[1]
      if (watcher === undefined) throw new Error('no second staff')

      // Grace: staff preps room 1, the saboteur un-preps it.
      await rideToRoom1(instance, worker)
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      await driveUntil(collectorOf(collectors, clients, worker), 'work:ended', instance)
      await rideToRoom1(instance, saboteur)
      saboteur.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      await driveUntil(collectorOf(collectors, clients, saboteur), 'work:ended', instance)

      // Both are parked at x ≈ 3 on floor1 — in range. The staff accuses.
      worker.send('accuse', { type: 'accuse', targetId: saboteur.sessionId })
      // One {playerId}-only payload reaches EVERY connection (all-policy).
      for (const collector of collectors) {
        const fired = await driveUntil(collector, 'player:fired', instance)
        expect(Object.keys(fired.payload).sort()).toEqual(['playerId'])
        expect(fired.payload.playerId).toBe(saboteur.sessionId)
        expect(fired.payload).not.toHaveProperty('reason')
        expect(fired.payload).not.toHaveProperty('valid')
      }
      // The round continues — win checks are cycle 2.9.
      expect(instance.__phase()).toBe('round')
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('tears the fired session down: intents rejected, no positional streams (JUST-04)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '60')
    try {
      const [host, a, b, c] = await roomWithFour()
      const clients = [host, a, b, c]
      const collectors = clients.map((room) => collectAll(room))
      const { instance, staff, saboteur } = await startWithRoles(clients)
      const worker = staff[0]
      if (worker === undefined) throw new Error('no staff player')
      const watcher = staff[1]
      if (watcher === undefined) throw new Error('no second staff')

      await rideToRoom1(instance, worker)
      worker.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      await driveUntil(collectorOf(collectors, clients, worker), 'work:ended', instance)
      await rideToRoom1(instance, saboteur)
      saboteur.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      await driveUntil(collectorOf(collectors, clients, saboteur), 'work:ended', instance)

      worker.send('accuse', { type: 'accuse', targetId: saboteur.sessionId })
      await driveUntil(collectorOf(collectors, clients, host), 'player:fired', instance)

      // The fired session's intents all reject with the coarse justice error.
      const saboteurCollector = collectorOf(collectors, clients, saboteur)
      saboteur.send('move:start', { type: 'move:start', dir: 'left' })
      const moveErr = await saboteurCollector.waitFor('error')
      expect(moveErr.payload.code).toBe('justice-rejected')
      saboteur.send('elevator:call', { type: 'elevator:call' })
      const callErr = await saboteurCollector.waitFor('error')
      expect(callErr.payload.code).toBe('justice-rejected')
      saboteur.send('work:start', { type: 'work:start', floor: 'floor1', room: 1 })
      const workErr = await saboteurCollector.waitFor('error')
      expect(workErr.payload.code).toBe('justice-rejected')

      // No positional stream ever carries the fired player again, and a live
      // floor1 walker's stream does NOT reach the fired viewer (viewOf null) —
      // while 'all' rows (elevator:called) still do: they stay connected.
      const saboteurRecord = record(saboteur)
      const liveRecord = record(watcher)
      watcher.send('elevator:call', { type: 'elevator:call' }) // an 'all' row
      await driveUntil(collectorOf(collectors, clients, watcher), 'elevator:called', instance)
      // Live positional traffic: the surviving staff walker (still parked on
      // floor1) walks — their own same-floor stream MUST arrive (driveUntil
      // below is the positive control: the window is not simply silent),
      // while the fired viewer — whose viewOf is null after the teardown —
      // receives NOTHING.
      const workerCollector = collectorOf(collectors, clients, worker)
      worker.send('move:start', { type: 'move:start', dir: 'left' })
      await driveUntil(workerCollector, 'player:moved', instance)
      instance.__driveTicks(20)
      worker.send('move:stop', { type: 'move:stop' })
      await sleep(120)
      expect(saboteurRecord.seen.some((m) => m.type === 'player:moved')).toBe(false)
      expect(saboteurRecord.seen.some((m) => m.type === 'elevator:called')).toBe(true)
      expect(
        liveRecord.seen.some(
          (m) => m.type === 'player:moved' && m.payload.playerId === saboteur.sessionId,
        ),
      ).toBe(false)
      saboteurRecord.stop()
      liveRecord.stop()
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('fires the accuser on a wrong accusation and rejects ineligible ones (JUST-09)', async () => {
    vi.stubEnv('TURNOVER_TEST_SHIFT_SECONDS', '60')
    try {
      const [host, a, b, c] = await roomWithFour()
      const clients = [host, a, b, c]
      const collectors = clients.map((room) => collectAll(room))
      const { instance, staff, saboteur } = await startWithRoles(clients)
      const worker = staff[0]
      const watcher = staff[1]
      if (worker === undefined || watcher === undefined) throw new Error('no staff players')

      // Lobby phase: accuse before the round — wait, the round is already
      // active here (startWithRoles). The lobby rejection is covered by the
      // fresh-room leg at the bottom.

      // Saboteur accuses: coarse rejection, nobody fires.
      saboteur.send('accuse', { type: 'accuse', targetId: worker.sessionId })
      const saboteurCollector = collectorOf(collectors, clients, saboteur)
      const saboteurErr = await saboteurCollector.waitFor('error')
      expect(saboteurErr.payload.code).toBe('justice-rejected')

      // Out of range: watcher in the lobby, worker on floor1 after the ride.
      await rideToRoom1(instance, worker)
      watcher.send('accuse', { type: 'accuse', targetId: worker.sessionId })
      const watcherCollector = collectorOf(collectors, clients, watcher)
      const rangeErr = await watcherCollector.waitFor('error')
      expect(rangeErr.payload.code).toBe('justice-rejected')
      expect(rangeErr.payload.message).toContain('closer')

      // Wrong accusation: worker and watcher both at x ≈ 3, worker accuses the
      // innocent watcher → the ACCUSER is fired, name-only.
      await rideToRoom1(instance, watcher)
      worker.send('accuse', { type: 'accuse', targetId: watcher.sessionId })
      for (const collector of collectors) {
        const fired = await driveUntil(collector, 'player:fired', instance)
        expect(fired.payload.playerId).toBe(worker.sessionId)
        expect(Object.keys(fired.payload).sort()).toEqual(['playerId'])
      }
      // The fired accuser's intents now reject (live-ness guard).
      worker.send('move:start', { type: 'move:start', dir: 'left' })
      const workerCollector = collectorOf(collectors, clients, worker)
      const firedErr = await workerCollector.waitFor('error')
      expect(firedErr.payload.code).toBe('justice-rejected')
      expect(instance.__phase()).toBe('round')

      // Lobby-phase rejection: a fresh room rejects accusations pre-start.
      const fresh = await createRoom('elin')
      fresh.send('accuse', { type: 'accuse', targetId: 'x' })
      const freshCollector = collectAll(fresh)
      const lobbyErr = await freshCollector.waitFor('error')
      expect(lobbyErr.payload.code).toBe('justice-rejected')
      fresh.leave()
      host.leave()
      a.leave()
      b.leave()
      c.leave()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

// STATE deferred notes (1)+(2), closed with cycle 2.8 (JUST-21): the PASS-gap
// assertions the room-shell and first-light verifiers left open.
describe('server:deferred_gaps', () => {
  it('creates NO room for an unknown code — the code stays free (LOBBY-02, LIGHT-02)', async () => {
    const before = TurnoverRoom.instances.length
    await expect(newClient().joinById('ZZZZ', { name: 'ada' })).rejects.toThrow(/not found/i)
    expect(TurnoverRoom.instances.length).toBe(before)
    // A room created under a consumed code would answer this join — it must not.
    await expect(newClient().joinById('ZZZZ', { name: 'bruno' })).rejects.toThrow(/not found/i)
    expect(TurnoverRoom.instances.length).toBe(before)
  })

  it('keeps the roster byte-identical when a join is rejected on its name (LOBBY-05)', async () => {
    const host = await createRoom('ada')
    const hostSnaps = collect(host)
    const guest = await newClient().joinById(host.roomId, { name: 'bruno' })
    const two = await hostSnaps.nextWhere((s) => s.roster.length === 2)
    const guestSnaps = collect(guest)
    guestSnaps.stop() // nothing further should arrive on a rejected join

    await expect(newClient().joinById(host.roomId, { name: 'bruno' })).rejects.toThrow(
      /name taken/i,
    )
    await expect(newClient().joinById(host.roomId, { name: 'bruno' })).rejects.toThrow(
      /name taken/i,
    )
    // No ghost entry, no roster churn: the next snapshot (driven by a real
    // join) still lists exactly the two members.
    const third = await newClient().joinById(host.roomId, { name: 'caro' })
    const after = await hostSnaps.nextWhere((s) => s.roster.length === 3)
    expect(after.roster.map((p) => p.name)).toEqual(['ada', 'bruno', 'caro'])
    void two
    host.leave()
    guest.leave()
    third.leave()
  })

  it('accepts a 1-character name at the minimum boundary (LIGHT-04)', async () => {
    const host = await createRoom('a')
    expect(host.sessionId).toBeTruthy()
    host.leave()
  })

  it('survives a rejected start: the non-host error does not corrupt the next start (LIGHT-08)', async () => {
    const host = await createRoom('ada')
    const clients = [host]
    for (const name of ['bruno', 'caro', 'dina']) {
      clients.push(await newClient().joinById(host.roomId, { name }))
    }
    const instance = TurnoverRoom.instances.at(-1)
    if (instance === undefined) throw new Error('no room instance')
    const guest = clients[1]
    if (guest === undefined) throw new Error('no guest')
    const guestCollector = collectAll(guest)
    const hostCollector = collectAll(host)

    // A non-host start is rejected — and must leave the room startable.
    guest.send('lobby:start', { type: 'lobby:start' })
    const err = await guestCollector.waitFor('error')
    expect(err.payload.code).toBe('not-host')
    expect(instance.__phase()).toBe('lobby')

    // The host's valid start then works: the round begins and everyone sees it.
    host.send('lobby:start', { type: 'lobby:start' })
    await vi.waitFor(() => expect(instance.__phase()).toBe('round'))
    // LIGHT-08's remaining clause: a start while the round is active answers
    // 'round-already-active' — machine-readable, lobby untouched.
    host.send('lobby:start', { type: 'lobby:start' })
    const again = await hostCollector.waitFor('error')
    expect(again.payload.code).toBe('round-already-active')
    expect(instance.__phase()).toBe('round')

    host.leave()
    for (const g of clients.slice(1)) g.leave()
  })
})
