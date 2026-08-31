#!/usr/bin/env node
/**
 * Dev boot: starts the game server and the Vite client, waits until both answer,
 * prints the URLs, then tears both down on Ctrl-C.
 *
 *   pnpm boot            # server on :2567, client on :5173 (default ports)
 *   PORT=3000 pnpm boot  # override the server port
 */
import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const SERVER_PORT = Number(process.env.PORT ?? 2567)
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173)
const serverUrl = `http://localhost:${SERVER_PORT}`
const clientUrl = `http://localhost:${CLIENT_PORT}`

function label(name, color) {
  return (line) => process.stdout.write(`\x1b[${color}m[${name}]\x1b[0m ${line}\n`)
}

const children = []
let shuttingDown = false

/** Returns PIDs of processes currently listening on `port` (Linux/macOS via lsof). */
function findPortPids(port) {
  return new Promise((resolve) => {
    const probe = spawn('lsof', ['-ti', `tcp:${port}`], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    probe.stdout.on('data', (chunk) => {
      out += chunk
    })
    probe.on('error', () => resolve([]))
    probe.on('close', () => {
      const pids = out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((pid) => Number.isInteger(pid) && pid !== process.pid)
      resolve(pids)
    })
  })
}

/** Kills whatever is already listening on `port`, so a stale dev server doesn't block boot. */
async function killPortIfBusy(port, label) {
  const pids = await findPortPids(port)
  if (pids.length === 0) return
  label(`port ${port} is busy (pid ${pids.join(', ')}) — killing…`)
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if ((await findPortPids(port)).length === 0) return
    await new Promise((r) => setTimeout(r, 200))
  }
  const stillBusy = await findPortPids(port)
  for (const pid of stillBusy) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}

function start(name, color, args, cwd, ready) {
  const say = label(name, color)
  const child = spawn('pnpm', args, {
    cwd,
    env: process.env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  const forward = (stream, out) => {
    let buffered = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffered += chunk
      for (const line of buffered.split('\n').slice(0, -1)) out(line)
      buffered = buffered.slice(buffered.lastIndexOf('\n') + 1)
    })
  }
  forward(child.stdout, say)
  forward(child.stderr, say)
  child.on('exit', (code) => {
    if (!shuttingDown) {
      say(`exited unexpectedly (code ${code}) — shutting down`)
      shutdown(1)
    }
  })
  return ready()
}

async function poll(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  await rm(lockfile, { force: true }).catch(() => {})
  process.exit(code)
}

const lockfile = join(tmpdir(), `turnover-boot-${SERVER_PORT}.pid`)
await writeFile(lockfile, String(process.pid)).catch(() => {})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

label('boot', '1')(`starting server + client…`)
await killPortIfBusy(SERVER_PORT, label('boot', '1'))
await killPortIfBusy(CLIENT_PORT, label('boot', '1'))
start('server', '34', ['dev'], 'apps/server', async () => {
  const serverUp = await poll(`${serverUrl}/`)
  if (!serverUp) {
    label('boot', '1')(`server did not become ready on ${serverUrl}`)
    await shutdown(1)
  }
})
start(
  'client',
  '35',
  ['dev', '--port', String(CLIENT_PORT), '--strictPort'],
  'apps/client',
  async () => {
    const clientUp = await poll(clientUrl)
    if (!clientUp) {
      label('boot', '1')(`client did not become ready on ${clientUrl}`)
      await shutdown(1)
    }
  },
)

// Both ready (or one exited) → print the banner once both polls settle.
await Promise.all([poll(`${serverUrl}/`), poll(clientUrl)])
label('boot', '1')(`game server  ${serverUrl}  (Colyseus ws endpoint, room 'turnover')`)
label('boot', '1')(`client       ${clientUrl}  (Phaser shell — lobby UI arrives in Phase 3)`)
label('boot', '1')(`Ctrl-C to stop both.`)
