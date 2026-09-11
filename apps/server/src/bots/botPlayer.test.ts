import { describe, expect, it, vi } from 'vitest'
import { applyMessage, type BotIntent, BotPlayer, type BotRoom, newBotWorld } from './botPlayer.js'

/** A BotRoom double that records sends — the tick gate is the assert target. */
function fakeRoom() {
  const sent: { type: string; payload: unknown }[] = []
  const room: BotRoom = {
    sessionId: 'bot-session',
    roomId: 'TEST',
    send: (type, payload) => sent.push({ type, payload }),
    onMessage: () => ({}),
    leave: async () => {},
  }
  return { room, sent }
}

describe('bots:player_fired', () => {
  it('marks the model fired on its own firing and clears the channel/carry mirrors', () => {
    const world = newBotWorld('bot-ada', 'bot-session', 90)
    world.role = 'saboteur'
    world.phase = 'round'
    applyMessage(world, 'work:started', {
      playerId: 'bot-session',
      floor: 'floor1',
      room: 1,
      seconds: 3,
    })
    world.carryGuest = 'guest:1'
    world.moving = 'left'

    applyMessage(world, 'player:fired', { playerId: 'bot-session' })

    expect(world.fired).toBe(true)
    expect(world.work).toBeNull()
    expect(world.carryGuest).toBeNull()
    expect(world.moving).toBeNull()
  })

  it('ignores other players’ firings beyond the rectangle removal', () => {
    const world = newBotWorld('bot-ada', 'bot-session', 90)
    world.players.set('other', { floor: 'floor1', x: 3.6 })

    applyMessage(world, 'player:fired', { playerId: 'other' })

    expect(world.fired).toBe(false)
    expect(world.players.has('other')).toBe(false)
  })

  it('stops emitting intents while fired, and a new deal re-arms the policy', () => {
    const { room, sent } = fakeRoom()
    const bot = new BotPlayer(room, {
      name: 'bot-ada',
      shiftSeconds: 90,
      decide: (): BotIntent => ({ type: 'move:start', dir: 'left' }),
    })
    bot.world.role = 'staff'
    bot.world.phase = 'round'
    bot.world.fired = true

    bot.tick(1000)
    expect(sent).toHaveLength(0)

    applyMessage(bot.world, 'round:started', { playerIds: ['bot-session'] })
    expect(bot.world.fired).toBe(false)
    bot.tick(1000)
    expect(sent).toEqual([{ type: 'move:start', payload: { type: 'move:start', dir: 'left' } }])
  })

  it('round:started still resets round state on a fired model', () => {
    const world = newBotWorld('bot-ada', 'bot-session', 90)
    world.fired = true
    world.work = { floor: 'floor1', room: 1, endsAtMs: 99_999 }

    applyMessage(world, 'round:started', { playerIds: ['bot-session'] })

    expect(world.fired).toBe(false)
    expect(world.work).toBeNull()
  })

  it('keeps the listen() registration test honest: every registry message routes somewhere', () => {
    const { room } = fakeRoom()
    const onMessage = vi.spyOn(room, 'onMessage')
    const bot = new BotPlayer(room, {
      name: 'bot-ada',
      shiftSeconds: 90,
      decide: () => null,
    })
    bot.listen()
    const names = onMessage.mock.calls.map((call) => call[0])
    expect(names).toContain('player:fired')
  })
})
