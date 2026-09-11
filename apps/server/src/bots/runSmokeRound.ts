import { parseArgs } from 'node:util'
import { Client } from '@colyseus/sdk'
import { TUNING } from '@turnover/shared'
import { BotPlayer, type BotRoom } from './botPlayer.js'
import { newBotMemory, saboteurDecide, staffDecide } from './policies.js'

/**
 * Bot smoke: a full-round automated playthrough on the REAL network stack —
 * N AI staff members (one secretly the saboteur, per the deal) join a room as
 * ordinary Colyseus clients and play the shift by protocol intents only.
 * Opt-in and expensive, deliberately OUTSIDE the gate ladder: run it before
 * the human 5-minute check (pnpm boot + `pnpm bots:smoke --connect --code …`),
 * or standalone against its own server. Exit 0 means every round reached a
 * verdict + recap on the wire (`--expect staff|saboteur` also pins winners).
 */

const BOT_NAMES = ['bot-ada', 'bot-brun', 'bot-ciro', 'bot-dora', 'bot-eli', 'bot-flor'] as const

interface Session {
  bot: BotPlayer
  room: BotRoom
  memory: ReturnType<typeof newBotMemory>
}

function fail(message: string): never {
  console.error(`bots:smoke: ${message}`)
  process.exit(1)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function waitFor(
  pred: () => boolean,
  budgetMs: number,
  timeoutMessage: string,
): Promise<void> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (pred()) return
    if (Date.now() > deadline) throw new Error(timeoutMessage)
    await sleep(200)
  }
}

function botNameById(sessions: readonly Session[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const { bot } of sessions) map.set(bot.world.selfId, bot.world.name)
  return map
}

function printRound(report: RoundReport, sessions: readonly Session[]): void {
  const nameById = botNameById(sessions)
  console.log(`--- round ${report.index} ${'-'.repeat(50)}`)
  console.log(
    `  winner: ${report.winner} (${report.reason}) · saboteur: ` +
      `${report.saboteurId !== null ? (nameById.get(report.saboteurId) ?? report.saboteurId) : '—'}`,
  )
  console.log(
    `  settle ${report.settleScore}/${report.settleTarget} · complaints ${report.complaints}/${TUNING.COMPLAINT_BUDGET} · ` +
      `trash marks ${report.trashMarks} (${report.sabotageComplaints} sabotage-authored complaints) · ambush catches ${report.ambushCatches} · wall ${report.wallSeconds}s`,
  )
  for (const { bot } of sessions) console.log(`  ${bot.describe()}`)
}

interface RoundReport {
  index: number
  winner: string
  reason: string
  saboteurId: string | null
  settleScore: number
  settleTarget: number
  complaints: number
  trashMarks: number
  sabotageComplaints: number
  ambushCatches: number
  wallSeconds: number
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      players: { type: 'string' },
      rounds: { type: 'string' },
      'shift-seconds': { type: 'string' },
      'guest-scale': { type: 'string' },
      expect: { type: 'string' },
      connect: { type: 'string' },
      code: { type: 'string' },
      'auto-start': { type: 'boolean', default: false },
      'hold-start': { type: 'string' },
      trace: { type: 'boolean', default: false },
    },
  })
  const num = (raw: string | undefined, fallback: number): number =>
    raw === undefined ? fallback : Number(raw)
  const cli = {
    players: num(values.players, 4),
    rounds: num(values.rounds, 1),
    'shift-seconds': num(values['shift-seconds'], 90),
    'guest-scale': num(values['guest-scale'], 0.25),
    'hold-start': num(values['hold-start'], 0),
    expect: values.expect,
    connect: values.connect,
    code: values.code,
    'auto-start': values['auto-start'] === true,
    trace: values.trace === true,
  }
  if (!Number.isInteger(cli.players) || !Number.isInteger(cli.rounds)) {
    fail('--players and --rounds take integers')
  }
  if (cli['hold-start'] < 0 || !Number.isFinite(cli['hold-start'])) {
    fail('--hold-start takes seconds ≥ 0')
  }
  if (cli.players < 1 || cli.players > TUNING.PLAYERS_MAX) {
    fail(`--players must be 1..${TUNING.PLAYERS_MAX}`)
  }
  // Create mode (default self-hosted, or --connect without --code): the bots
  // ARE the whole roster, so the room needs a full deal. Join mode
  // (--connect --code): --players counts only the bots entering the room.
  const createsRoom = cli.code === undefined
  if (createsRoom && cli.players < TUNING.PLAYERS_MIN) {
    fail(
      `--players must be ${TUNING.PLAYERS_MIN}..${TUNING.PLAYERS_MAX} when the bots create ` +
        `the room (with --connect --code it counts only the joining bots)`,
    )
  }
  if (cli.rounds < 1) fail('--rounds must be ≥ 1')
  if (cli['shift-seconds'] < 20 || cli['shift-seconds'] > TUNING.SHIFT_SECONDS) {
    fail(`--shift-seconds must be 20..${TUNING.SHIFT_SECONDS}`)
  }
  if (cli['guest-scale'] <= 0 || cli['guest-scale'] >= 1 || !Number.isFinite(cli['guest-scale'])) {
    fail('--guest-scale must be in (0,1)')
  }
  if (cli.expect !== undefined && cli.expect !== 'staff' && cli.expect !== 'saboteur') {
    fail('--expect must be "staff" or "saboteur"')
  }
  if (cli.connect === undefined && cli.code !== undefined) fail('--code requires --connect')
  if (createsRoom && cli['auto-start']) {
    fail(
      '--auto-start only applies to --connect --code: rooms the bots create ' +
        'start on their own (use --hold-start to leave a spectator window)',
    )
  }
  if (process.env.NODE_ENV === 'production') {
    fail('refusing to run under NODE_ENV=production — the shift seam is inert there')
  }

  let closeServer: (() => Promise<void>) | null = null
  let url: string
  if (cli.connect !== undefined) {
    url = cli.connect
  } else {
    // The AD-004/AD-028 seams are read at round start — env before any join.
    process.env.TURNOVER_TEST_SHIFT_SECONDS = String(cli['shift-seconds'])
    process.env.TURNOVER_TEST_GUEST_SCALE = String(cli['guest-scale'])
    const { startServer } = await import('../index.js')
    const started = await startServer(0, { heartbeat: false })
    const address = started.app.server.address()
    if (address === null || typeof address === 'string') {
      fail('server did not listen on a TCP port')
    }
    url = `ws://127.0.0.1:${address.port}`
    closeServer = async () => {
      await started.gameServer.gracefullyShutdown(false)
      await started.app.close()
    }
  }

  console.log(
    `turnover bot smoke — ${cli.players} bots · ${cli.rounds} round(s) · ` +
      `shift ${cli['shift-seconds']}s · guest scale ${cli['guest-scale']} · ${url}` +
      (cli.code !== undefined ? ` room ${cli.code}` : createsRoom ? ' (creating the room)' : ''),
  )

  const sessions: Session[] = []
  // The first bot creates the room (its Colyseus roomId IS the 4-letter code);
  // the rest join it — every bot calling create would fork N lobbies of one.
  let code = cli.code ?? null
  for (let i = 0; i < cli.players; i++) {
    const name = BOT_NAMES[i] ?? 'bot-x'
    const client = new Client(url)
    const room = (code === null
      ? await client.create('turnover', { name })
      : await client.joinById(code, { name })) as unknown as BotRoom
    if (code === null) {
      code = room.roomId
      if (cli.connect !== undefined) {
        // Created on the user's dev server: their vite client already talks
        // to it, so the ?room= deep link is the shortest path to spectating.
        console.log(
          `room ${code} created on the dev server — spectate: open ` +
            `http://localhost:5173/?room=${code} and join with "watch (spectator)" checked`,
        )
      } else {
        console.log(`room ${code} created — humans may join it too while the smoke runs`)
        console.log(
          `spectate: open ${url.replace('ws', 'http')} and join ${code} ` +
            `with "watch (spectator)" checked (dev builds only)`,
        )
      }
    }
    const memory = newBotMemory()
    const bot = new BotPlayer(room, {
      name,
      shiftSeconds: cli['shift-seconds'],
      trace: cli.trace,
      decide: (world, now) =>
        world.role === 'saboteur'
          ? saboteurDecide(world, memory, now)
          : staffDecide(world, memory, now),
    })
    bot.listen()
    bot.start(120)
    sessions.push({ bot, room, memory })
  }

  if (cli['hold-start'] > 0) {
    console.log(
      `holding the first start for ${cli['hold-start']}s — join ${code} with ` +
        `"watch (spectator)" checked to watch this round live`,
    )
  }

  // Lobby kicker: the host bot sends lobby:start whenever the room sits
  // outside a round. Bot-created rooms always self-start (self-hosted and
  // --connect without --code); joining an existing room needs --auto-start
  // (a bot only becomes host there by migration). --hold-start N keeps the
  // first start on hold for N seconds so a browser spectator can join first.
  const holdUntil = Date.now() + cli['hold-start'] * 1000
  let lastKick = 0
  const kicker = setInterval(() => {
    if (Date.now() < holdUntil) return
    if (sessions.some((s) => s.bot.world.phase === 'round')) return
    const host = sessions.find((s) => s.bot.world.isHost)
    if (host === undefined) return
    if (!createsRoom && !cli['auto-start']) return
    if (host.bot.world.roster.length < TUNING.PLAYERS_MIN) return
    if (Date.now() - lastKick < 3000) return
    lastKick = Date.now()
    host.room.send('lobby:start', { type: 'lobby:start' })
  }, 400)

  const timers: ReturnType<typeof setInterval>[] = [kicker]
  if (cli.trace) {
    timers.push(
      setInterval(() => {
        const now = Date.now()
        for (const { bot, memory } of sessions) {
          const w = bot.world
          console.log(
            `  [trace] ${w.name} ${w.phase} ${w.floor}@${w.x} moving=${w.moving ?? '-'} ` +
              `ride=${w.riding ? w.carFloor : '-'} stairs=${w.stairs !== null ? w.stairs.to : '-'} ` +
              `q=${w.queueCount} carry=${w.carryGuest ?? '-'} claim=${memory.claim ?? '-'} ` +
              `rooms=${w.roomStates.size} cards=${w.cards.size} pat=${memory.patrolIdx} ` +
              `elv=${Math.max(0, memory.elevatorUntilMs - now)} skips=${memory.skips.size} i=${w.intentCount}`,
          )
        }
      }, 5000),
    )
  }

  const reports: RoundReport[] = []
  let aborted = false
  for (let index = 1; index <= cli.rounds; index++) {
    const startedAt = Date.now()
    try {
      await waitFor(
        () => sessions.some((s) => s.bot.world.phase === 'round'),
        30_000,
        `round ${index}: bots never entered the round (roster/lobby/start failed)`,
      )
      const budget = (cli['shift-seconds'] + 60) * 1000
      await waitFor(
        () => sessions.every((s) => s.bot.world.recap !== null),
        budget,
        `round ${index}: no recap within ${budget / 1000}s — bots stalled:\n  ` +
          sessions.map((s) => s.bot.describe()).join('\n  '),
      )
    } catch (error) {
      console.error(`bots:smoke: ${(error as Error).message}`)
      aborted = true
      break
    }
    const source = sessions[0]
    if (source === undefined) {
      aborted = true
      break
    }
    const verdict = source.bot.world.verdict
    const recap = source.bot.world.recap
    if (verdict === null || recap === null) {
      aborted = true
      break
    }
    const trashMarks = recap.entries.filter((e) => e.kind === 'crime').length
    const sabotageComplaints = recap.entries.filter(
      (e) => e.kind === 'complaint' && e.provenance === 'sabotage',
    ).length
    const report: RoundReport = {
      index,
      winner: verdict.winner,
      reason: verdict.reason,
      saboteurId: verdict.saboteurId,
      settleScore: recap.settleScore,
      settleTarget: recap.settleTarget,
      complaints: recap.complaints,
      trashMarks,
      sabotageComplaints,
      ambushCatches: recap.entries.filter((e) => e.kind === 'catch').length,
      wallSeconds: Math.round((Date.now() - startedAt) / 1000),
    }
    reports.push(report)
    printRound(report, sessions)
    if (index < cli.rounds) await sleep(2500)
  }

  for (const timer of timers) clearInterval(timer)
  for (const { bot, room } of sessions) {
    bot.stop()
    room.leave().catch(() => {})
  }

  let exitCode = 0
  if (aborted || reports.length < cli.rounds) {
    exitCode = 1
  } else {
    const nameById = botNameById(sessions)
    for (const report of reports) {
      if (report.winner === 'aborted') {
        console.error(`bots:smoke: round ${report.index} aborted — no verdict`)
        exitCode = 1
        continue
      }
      if (cli.expect !== undefined && report.winner !== cli.expect) {
        console.error(
          `bots:smoke: round ${report.index} expected ${cli.expect}, got ${report.winner}`,
        )
        exitCode = 1
      }
    }
    console.log(
      `bot smoke ${exitCode === 0 ? 'ok' : 'FAILED'}: ${reports.length}/${cli.rounds} round(s) — ` +
        `winners ${reports.map((r) => `${r.winner} (sab ${nameById.get(r.saboteurId ?? '') ?? '—'})`).join(', ')}`,
    )
  }

  if (closeServer !== null) await closeServer()
  return exitCode
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('bots:smoke crashed:', error)
    process.exit(1)
  })
