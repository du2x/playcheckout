#!/usr/bin/env node
/**
 * Fly.io deploy helper — one Fastify container serves the client and the
 * Colyseus WebSocket endpoint (AD-001); see fly.toml for region and checks.
 *
 *   pnpm fly:launch         # first time: auth → create the app → ready to deploy
 *   pnpm fly:deploy         # every change: build the image, ship it, pin scale, verify
 *   pnpm fly:status         # machines, versions, health
 *   pnpm fly:logs           # tail recent logs
 *   node scripts/fly.mjs deploy --app <name>   # override the app name from fly.toml
 *   node scripts/fly.mjs deploy -- --remote-only  # extra flags pass through to flyctl
 *
 * The app is created in region `gru` (São Paulo) via `primary_region` in fly.toml.
 * Scale stays pinned to 1: rooms and matchmaking live in process memory.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const ROOT = join(import.meta.dirname, '..')

function label(name, color) {
  return (line) => process.stdout.write(`\x1b[${color}m[${name}]\x1b[0m ${line}\n`)
}
const say = label('fly', '1')

function resolveFlyctl() {
  const candidates = [process.env.FLYCTL, 'flyctl', join(homedir(), '.fly', 'bin', 'flyctl')]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (spawnSync(candidate, ['version'], { stdio: 'ignore' }).status === 0) return candidate
  }
  return undefined
}

/** Runs with inherited stdio; resolves the exit code. */
function run(cmd, args) {
  return new Promise((resolve) => {
    spawn(cmd, args, { stdio: 'inherit' }).on('exit', (code) => resolve(code ?? 1))
  })
}

/** Runs quietly; resolves { code, out } with combined stdout. */
function capture(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      out += chunk
    })
    child.on('error', () => resolve({ code: 1, out }))
    child.on('exit', (code) => resolve({ code: code ?? 1, out }))
  })
}

function appFromFlytoml() {
  try {
    const name = readFileSync(join(ROOT, 'fly.toml'), 'utf8').match(/^app\s*=\s*"([^"]+)"/m)?.[1]
    return name
  } catch {
    return undefined
  }
}

function parseArgs(argv) {
  const appFlag = argv.find((a) => a.startsWith('--app'))
  const override = appFlag?.split('=')[1] ?? argv[argv.indexOf(appFlag) + 1]
  const passthrough = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : []
  return { app: override ?? appFromFlytoml(), passthrough }
}

async function requireAuth(fly, { interactive }) {
  if ((await capture(fly, ['auth', 'whoami'])).code === 0) return
  if (!interactive) {
    say('not logged in — run: pnpm fly:launch (or: flyctl auth login)')
    process.exit(1)
  }
  say('not logged in — opening browser login…')
  if ((await run(fly, ['auth', 'login'])) !== 0) {
    say('login failed — see output above')
    process.exit(1)
  }
}

async function appExists(fly, app) {
  const { code, out } = await capture(fly, ['apps', 'list', '--json'])
  if (code !== 0) {
    say(`could not list apps (flyctl said: ${out.trim().split('\n')[0]})`)
    process.exit(1)
  }
  return out.includes(`"${app}"`)
}

async function launch(fly, { app }) {
  await requireAuth(fly, { interactive: true })
  if (!app) {
    say('no app name — set `app = "…"` in fly.toml or pass --app <name>')
    process.exit(1)
  }
  if (await appExists(fly, app)) {
    say(`app '${app}' already exists — nothing to create`)
  } else {
    say(`creating app '${app}' (region comes from fly.toml on first deploy)…`)
    if ((await run(fly, ['apps', 'create', app])) !== 0) process.exit(1)
  }
  say(`next: pnpm fly:deploy`)
}

async function deploy(fly, { app, passthrough }) {
  await requireAuth(fly, { interactive: false })
  if (!app) {
    say('no app name — set `app = "…"` in fly.toml or pass --app <name>')
    process.exit(1)
  }
  if (!(await appExists(fly, app))) {
    say(`app '${app}' does not exist yet — run: pnpm fly:launch`)
    process.exit(1)
  }

  const localDocker = (await capture('docker', ['info', '--format', 'ok'])).out.includes('ok')
  const buildMode = passthrough.some((a) => a.startsWith('--remote') || a.startsWith('--local'))
    ? []
    : localDocker
      ? ['--local-only']
      : []
  if (localDocker) say('building image with the local Docker daemon…')
  else say('no local Docker — using the Fly remote builder…')
  if ((await run(fly, ['deploy', '-a', app, ...buildMode, ...passthrough])) !== 0) {
    say('deploy failed — see output above')
    process.exit(1)
  }

  const scale = await capture(fly, ['scale', 'count', '1', '-a', app])
  if (scale.code === 0) say('scale pinned to 1 machine (in-memory rooms — never scale out)')
  else say(`warning: could not pin scale (flyctl said: ${scale.out.trim().split('\n')[0]})`)

  const health = await fetch(`https://${app}.fly.dev/`, { signal: AbortSignal.timeout(15000) })
  if (health.status === 200) say(`live and serving: https://${app}.fly.dev`)
  else say(`deployed, but https://${app}.fly.dev answered ${health.status} — check pnpm fly:logs`)
}

async function status(fly, { app }) {
  await requireAuth(fly, { interactive: false })
  process.exit(await run(fly, ['status', '-a', app]))
}

async function logs(fly, { app }) {
  await requireAuth(fly, { interactive: false })
  process.exit(await run(fly, ['logs', '-a', app]))
}

const fly = resolveFlyctl()
if (!fly) {
  say('flyctl not found — install it, then reopen the shell:')
  say('  curl -L https://fly.io/install.sh | sh')
  process.exit(1)
}

const [command, ...argv] = process.argv.slice(2)
const opts = parseArgs(argv)
const commands = { launch, deploy, status, logs }
if (commands[command]) await commands[command](fly, opts)
else {
  say('usage: node scripts/fly.mjs <launch|deploy|status|logs> [--app <name>] [-- <flyctl flags>]')
  process.exit(command ? 1 : 0)
}
