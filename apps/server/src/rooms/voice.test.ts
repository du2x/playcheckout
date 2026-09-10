import { Client } from '@colyseus/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer } from '../index'
import { TurnoverRoom } from './TurnoverRoom'

let port: number
let app: Awaited<ReturnType<typeof startServer>>['app']
let gameServer: Awaited<ReturnType<typeof startServer>>['gameServer']

type ClientRoom = Awaited<ReturnType<Client['create']>>

beforeAll(async () => {
  TurnoverRoom.tickMs = 0 // voice tests never drive the sim — lobby phase only
  const started = await startServer(0, { heartbeat: false })
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

interface SeenMessage {
  readonly type: string
  readonly payload: unknown
}

/**
 * Every-message collector with one-shot predicate waiters — the voice flow is
 * plain lobby-phase messaging, so no tick driving is needed; waiters poll the
 * already-seen log first (the join-time snapshot race of the snapshot tests
 * applies to voice:state too).
 */
function collectVoice(room: ClientRoom) {
  const seen: SeenMessage[] = []
  const waiters: {
    pred: (m: SeenMessage) => boolean
    resolve: (m: SeenMessage) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }[] = []
  const off = room.onMessage('*', (type, raw) => {
    const message: SeenMessage = {
      type: String(type),
      payload: (raw as { payload: unknown }).payload,
    }
    seen.push(message)
    const idx = waiters.findIndex((w) => w.pred(message))
    const waiter = idx >= 0 ? waiters[idx] : undefined
    if (idx >= 0 && waiter !== undefined) {
      waiters.splice(idx, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    }
  })
  function waitFor(
    pred: (m: SeenMessage) => boolean,
    label: string,
    timeoutMs = 2000,
  ): Promise<SeenMessage> {
    const queued = seen.find(pred)
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), timeoutMs)
      waiters.push({ pred, resolve, reject, timer })
    })
  }
  return {
    waitFor,
    seen,
    stop() {
      off()
    },
  }
}

async function createRoom(name: string): Promise<ClientRoom> {
  return newClient().create('turnover', { name })
}

const voiceStateOf = (m: SeenMessage) =>
  m.type === 'voice:state' ? (m.payload as { playerIds: string[] }) : null

// Spec server:voice_party — one party per game session: membership is public,
// signaling relays member-to-member verbatim, non-members and fired sessions
// relay nothing. Audio itself is peer-to-peer; only these facts touch the wire.
describe('server:voice_party', () => {
  it('delivers the member list on hello, broadcasts joins, and relays signals only to the target (VOICE-01..03)', async () => {
    const ada = await createRoom('ada')
    const bruno = await newClient().joinById(ada.roomId, { name: 'bruno' })
    const adaWire = collectVoice(ada)
    const brunoWire = collectVoice(bruno)

    ada.send('voice:hello', { type: 'voice:hello' })
    // The joiner learns the current members (empty — nobody else yet).
    const adaState = voiceStateOf(
      await adaWire.waitFor((m) => m.type === 'voice:state', 'ada state'),
    )
    expect(adaState).toEqual({ playerIds: [] })
    // Everyone hears the join.
    await adaWire.waitFor((m) => m.type === 'voice:joined', 'ada joined (ada)')
    await brunoWire.waitFor((m) => m.type === 'voice:joined', 'ada joined (bruno)')

    bruno.send('voice:hello', { type: 'voice:hello' })
    const brunoState = voiceStateOf(
      await brunoWire.waitFor((m) => m.type === 'voice:state', 'bruno state'),
    )
    expect(brunoState?.playerIds).toEqual([ada.sessionId])
    await brunoWire.waitFor(
      (m) =>
        m.type === 'voice:joined' &&
        (m.payload as { playerId: string }).playerId === bruno.sessionId,
      'bruno joined (bruno)',
    )

    // Relay: ada's offer reaches bruno and no one else; the payload rides verbatim.
    ada.send('voice:signal', {
      type: 'voice:signal',
      to: bruno.sessionId,
      kind: 'offer',
      data: '{"type":"offer","sdp":"x"}',
    })
    const relayed = await brunoWire.waitFor((m) => m.type === 'voice:signal', 'bruno signal')
    expect(relayed.payload).toEqual({
      from: ada.sessionId,
      kind: 'offer',
      data: '{"type":"offer","sdp":"x"}',
    })
    expect(adaWire.seen.some((m) => m.type === 'voice:signal')).toBe(false)

    // Targeted only: ice to a stale/unknown id relays nowhere.
    ada.send('voice:signal', {
      type: 'voice:signal',
      to: 'no-such-session',
      kind: 'ice',
      data: '{}',
    })
    ada.send('voice:signal', {
      type: 'voice:signal',
      to: bruno.sessionId,
      kind: 'answer',
      data: '{"type":"answer"}',
    })
    const answer = await brunoWire.waitFor(
      (m) => m.type === 'voice:signal' && (m.payload as { kind: string }).kind === 'answer',
      'bruno answer',
    )
    expect((answer.payload as { from: string }).from).toBe(ada.sessionId)

    adaWire.stop()
    brunoWire.stop()
    ada.leave()
    bruno.leave()
  })

  it('a non-member relays nothing; bye leaves publicly; a drop cleans membership up (VOICE-04..06)', async () => {
    const ada = await createRoom('ada')
    const bruno = await newClient().joinById(ada.roomId, { name: 'bruno' })
    const carol = await newClient().joinById(ada.roomId, { name: 'carol' })
    const adaWire = collectVoice(ada)
    const brunoWire = collectVoice(bruno)
    const carolWire = collectVoice(carol)

    ada.send('voice:hello', { type: 'voice:hello' })
    await brunoWire.waitFor((m) => m.type === 'voice:joined', 'ada joined')
    bruno.send('voice:hello', { type: 'voice:hello' })
    await brunoWire.waitFor(
      (m) =>
        m.type === 'voice:joined' &&
        (m.payload as { playerId: string }).playerId === bruno.sessionId,
      'bruno joined',
    )

    // carol never said hello: her signal is dropped silently — nothing on
    // the wire, no error (the member set is the only authority).
    carol.send('voice:signal', {
      type: 'voice:signal',
      to: ada.sessionId,
      kind: 'offer',
      data: '{"intruder":true}',
    })
    // A real member signal behind it proves the relay still works.
    ada.send('voice:signal', {
      type: 'voice:signal',
      to: bruno.sessionId,
      kind: 'ice',
      data: '{"legit":true}',
    })
    await brunoWire.waitFor(
      (m) => m.type === 'voice:signal' && (m.payload as { data: string }).data === '{"legit":true}',
      'member relay lands',
    )

    // bye: public leave, then the leaver relays nothing anymore.
    ada.send('voice:bye', { type: 'voice:bye' })
    const left = await brunoWire.waitFor((m) => m.type === 'voice:left', 'ada left')
    expect((left.payload as { playerId: string }).playerId).toBe(ada.sessionId)
    ada.send('voice:signal', {
      type: 'voice:signal',
      to: bruno.sessionId,
      kind: 'answer',
      data: '{"zombie":true}',
    })

    expect(
      brunoWire.seen.some(
        (m) =>
          m.type === 'voice:signal' && (m.payload as { data: string }).data === '{"intruder":true}',
      ),
    ).toBe(false)
    expect(
      brunoWire.seen.some(
        (m) =>
          m.type === 'voice:signal' && (m.payload as { data: string }).data === '{"zombie":true}',
      ),
    ).toBe(false)

    // A dropped connection's membership dies with it (VOICE-06).
    ada.send('voice:hello', { type: 'voice:hello' })
    await brunoWire.waitFor(
      (m) =>
        m.type === 'voice:joined' && (m.payload as { playerId: string }).playerId === ada.sessionId,
      'ada re-joined',
    )
    ada.leave()
    const dropped = await brunoWire.waitFor(
      (m) =>
        m.type === 'voice:left' && (m.payload as { playerId: string }).playerId === ada.sessionId,
      'ada drop cleanup',
    )
    expect((dropped.payload as { playerId: string }).playerId).toBe(ada.sessionId)

    adaWire.stop()
    brunoWire.stop()
    carolWire.stop()
    bruno.leave()
    carol.leave()
  })

  it('dev spectators cannot join the party — voice is a seated-player channel (VOICE-07)', async () => {
    const ada = await createRoom('ada')
    const watcher = await newClient().joinById(ada.roomId, { name: 'watch', spectator: true })
    const watcherWire = collectVoice(watcher)

    watcher.send('voice:hello', { type: 'voice:hello' })
    const error = await watcherWire.waitFor((m) => m.type === 'error', 'spectator justice error')
    expect((error.payload as { code: string }).code).toBe('justice-rejected')

    watcherWire.stop()
    ada.leave()
    watcher.leave()
  })
})
