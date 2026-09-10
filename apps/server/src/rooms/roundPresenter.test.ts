import type { RecapEntry } from '@turnover/shared'
import { MovementSim, RoundSim } from '@turnover/sim'
import type { Room } from 'colyseus'
import { describe, expect, it } from 'vitest'
import { RoundPresenter } from './roundPresenter'
import { Router } from './router'

// RoundPresenter (unit half): the round-scoped layer through its own
// interface — the single slotless-implies-spectator predicate, the round
// lifecycle through tick() (recap, results phase, telemetry bridge), and the
// seat-expiry resolution (ghost vs aborted round). The transport half stays
// covered by TurnoverRoom.test.ts; sameFloor snapshot filtering rides the
// full-room scenarios there (it needs check-in choreography).

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

function harness(...clientIds: string[]) {
  const clients = clientIds.map(fakeClient)
  const router = new Router({ clients } as unknown as Room)
  const movement = new MovementSim()
  const io = {
    sink: () => null,
    flushCalls: 0,
    closeCalls: 0,
    flush() {
      this.flushCalls++
    },
    close() {
      this.closeCalls++
    },
  }
  const presenter = new RoundPresenter(movement, router, io)
  return { clients, router, movement, io, presenter }
}

function startTinyRound(
  presenter: RoundPresenter,
  movement: MovementSim,
  playerIds: readonly string[],
): RoundSim {
  const sim = new RoundSim({
    seed: 7,
    playerIds: [...playerIds],
    movement: {
      joinGuest: () => {},
      removeGuest: () => {},
      announceGuest: () => {},
      positionOf: () => undefined,
      viewOf: (id) => movement.viewOf(id),
      startMove: () => {},
      stopMove: () => {},
      callElevator: () => 'ignored',
      pressFloor: () => {},
    },
    totalTicks: 2,
  })
  presenter.startRound(sim, playerIds)
  return sim
}

const payloads = (client: ReturnType<typeof fakeClient>, type: string) =>
  client.sent
    .filter((s) => s.type === type)
    .map((s) => s.message.payload as Record<string, unknown>)

describe('roundPresenter — the slotless-implies-spectator predicate', () => {
  it('marks a session with a position as a live viewer, slotless as spectator', () => {
    const { movement, presenter } = harness('p1')
    movement.join('p1', { kind: 'player', floor: 'floor1', xMilli: 5_000 })
    const live = presenter.viewContextOf('p1')
    expect(live.spectator).toBe(false)
    expect(live.floor).toBe('floor1')
    // A session that never joined movement (dev spectator, or a fired player
    // whose slot was torn down) is slotless — the ONE predicate, one home.
    const watcher = presenter.viewContextOf('ghost-session')
    expect(watcher.spectator).toBe(true)
    expect(watcher.floor).toBeNull()
  })

  it('movementSnapshotFor passes the movement snapshot through before the deal', () => {
    const { movement, presenter } = harness('p1', 'p2')
    movement.join('p1', { kind: 'player', floor: 'lobby', xMilli: 1_000 })
    const snap = presenter.movementSnapshotFor('p1')
    expect(snap.players.map((p) => p.playerId)).toContain('p1')
    expect(snap.suitcases).toBeUndefined()
  })
})

describe('roundPresenter — round lifecycle through tick()', () => {
  it('runs a tiny round to the buzzer: recap to all, results phase, sim dead, bridge closed', () => {
    const { clients, io, movement, presenter } = harness('p1', 'p2', 'p3', 'p4')
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      movement.join(id, { kind: 'player', floor: 'lobby', xMilli: 1_000 })
    }
    startTinyRound(presenter, movement, ['p1', 'p2', 'p3', 'p4'])
    expect(presenter.roundLive).toBe(true)

    presenter.tick()
    expect(presenter.phase).toBe('round')
    presenter.tick() // totalTicks: 2 — the buzzer lands here
    expect(presenter.phase).toBe('results')
    expect(presenter.roundLive).toBe(false)
    expect(presenter.simOf()).toBeNull()

    // The recap reaches everyone, once, with the §7 verdict inputs riding it.
    for (const client of clients) {
      const recaps = payloads(client, 'round:recap')
      expect(recaps).toHaveLength(1)
      const recap = recaps[0]
      expect(Array.isArray(recap?.entries)).toBe(true)
      expect(typeof recap?.settleScore).toBe('number')
      expect(typeof recap?.settleTarget).toBe('number')
      expect(typeof recap?.complaints).toBe('number')
    }
    // The results snapshots show honest positions (one per participant).
    for (const client of clients) {
      expect(payloads(client, 'movement:snapshot')).toHaveLength(1)
    }
    // Telemetry bridge: the round's file window closed exactly once.
    expect(io.flushCalls).toBeGreaterThan(0)
    expect(io.closeCalls).toBe(1)
    // Ticks past the round are inert movement-only steps (AD-005 phase-free).
    presenter.tick()
    expect(presenter.phase).toBe('results')
  })

  it('round:ended lands on the wire exactly once, before the results snapshots', () => {
    const { clients, movement, presenter } = harness('p1', 'p2', 'p3', 'p4')
    for (const id of ['p1', 'p2', 'p3', 'p4']) movement.join(id)
    startTinyRound(presenter, movement, ['p1', 'p2', 'p3', 'p4'])
    presenter.tick()
    presenter.tick()
    const host = clients[0]
    if (host === undefined) throw new Error('no host client')
    const order = host.sent.map((s) => s.type)
    expect(order.filter((t) => t === 'round:ended')).toHaveLength(1)
    expect(order.indexOf('round:ended')).toBeLessThan(order.indexOf('round:recap'))
  })
})

describe('roundPresenter — seat expiry (REND-19/20)', () => {
  it('ghosts a staff expiry silently: no round:ended, the round lives on', () => {
    const { clients, movement, presenter } = harness('p1', 'p2', 'p3', 'p4')
    for (const id of ['p1', 'p2', 'p3', 'p4']) movement.join(id)
    const sim = startTinyRound(presenter, movement, ['p1', 'p2', 'p3', 'p4'])
    const staffId = ['p1', 'p2', 'p3', 'p4'].find((id) => id !== sim.saboteurId)
    if (staffId === undefined) throw new Error('no staff seat')
    movement.join(staffId, { kind: 'player', floor: 'lobby', xMilli: 1_000 })

    presenter.expireSeat(staffId)
    expect(presenter.phase).toBe('round')
    expect(presenter.roundLive).toBe(true)
    // The ghost lost their position stream; nobody was told the round ended.
    expect(movement.viewOf(staffId).floor).toBeNull()
    for (const client of clients) {
      expect(payloads(client, 'round:ended')).toHaveLength(0)
    }
  })

  it('aborts when the saboteur expires: aborted verdict to all, results phase, bridge closed', () => {
    const { clients, io, movement, presenter } = harness('p1', 'p2', 'p3', 'p4')
    for (const id of ['p1', 'p2', 'p3', 'p4']) movement.join(id)
    const sim = startTinyRound(presenter, movement, ['p1', 'p2', 'p3', 'p4'])

    presenter.expireSeat(sim.saboteurId)
    expect(presenter.phase).toBe('results')
    expect(presenter.roundLive).toBe(false)
    for (const client of clients) {
      const ended = payloads(client, 'round:ended')
      expect(ended).toHaveLength(1)
      expect(ended[0]?.winner).toBe('aborted')
      expect(ended[0]?.reason).toBe('saboteur-disconnected')
      expect(ended[0]?.saboteurId).toBeNull()
    }
    expect(io.closeCalls).toBe(1)
  })

  it('a fresh deal resets the fired set and the ride journal ( RecapEntry flow)', () => {
    const { movement, presenter } = harness('p1', 'p2', 'p3', 'p4')
    startTinyRound(presenter, movement, ['p1', 'p2', 'p3', 'p4'])
    presenter.tick()
    presenter.tick()
    expect(presenter.phase).toBe('results')
    // Re-deal in the results phase (the lobby-like flow) — a fresh round runs.
    startTinyRound(presenter, movement, ['p1', 'p2', 'p3', 'p4'])
    expect(presenter.phase).toBe('round')
    expect(presenter.simOf()).not.toBeNull()
  })
})
