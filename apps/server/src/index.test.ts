import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@colyseus/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer } from './index'
import { TurnoverRoom } from './rooms/TurnoverRoom'

let port: number
let app: Awaited<ReturnType<typeof startServer>>['app']
let gameServer: Awaited<ReturnType<typeof startServer>>['gameServer']
let distDir: string

beforeAll(async () => {
  distDir = mkdtempSync(join(tmpdir(), 'turnover-static-'))
  writeFileSync(
    join(distDir, 'index.html'),
    '<!doctype html><title>turnover</title>placeholder-dist',
  )

  const started = await startServer(0, { clientDist: distDir })
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
  rmSync(distDir, { recursive: true, force: true })
})

// Spec SKEL-06 AC1/AC2 carried forward: single port serves static + WS (AD-001);
// the turnover room joins message-only (patchRate null, no Schema state sync).
describe('server transport shell', () => {
  it('serves static assets and accepts a Colyseus join on the same port', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('placeholder-dist')

    const client = new Client(`ws://127.0.0.1:${port}`)
    const room = await client.create('turnover', { name: 'ada' })
    expect(room.sessionId).toBeTruthy()
    room.leave()
  })

  it('runs the turnover room message-only: patchRate null, no state sync', async () => {
    const client = new Client(`ws://127.0.0.1:${port}`)
    const room = await client.create('turnover', { name: 'bruno' })
    const instance = TurnoverRoom.instances.at(-1)
    expect(instance).toBeDefined()
    expect(instance?.patchRate).toBeNull()
    room.leave()
  })
})
