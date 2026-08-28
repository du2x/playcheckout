import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTransport } from '@colyseus/core/Transport'
import fastifyStatic from '@fastify/static'
import { createNodeMatchmakingMiddleware, matchMaker, Server, WebSocketTransport } from 'colyseus'
import Fastify, { type FastifyInstance } from 'fastify'
import { PlaceholderRoom } from './rooms/PlaceholderRoom'

const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url))

/**
 * AD-001: one Fastify process hosts Colyseus — a single port serves the static
 * client and the WebSocket endpoint. Wiring mirrors colyseus/vite's documented
 * shared-HTTP-server pattern: noServer transport + attachToServer (upgrade-only,
 * zero request-flow conflict with Fastify) + matchmaking middleware on the
 * request chain.
 */
export async function startServer(
  port = Number(process.env.PORT ?? 2567),
  opts: { clientDist?: string } = {},
): Promise<{ app: FastifyInstance; gameServer: Server }> {
  const app = Fastify()
  const clientDist = opts.clientDist ?? CLIENT_DIST

  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist, prefix: '/' })
  }

  // Matchmake routes ride the Fastify request chain; when the middleware answers
  // (POST /matchmake/*), hijack the reply so Fastify does not double-respond.
  const matchmaking = createNodeMatchmakingMiddleware()
  app.addHook('onRequest', (req, reply, done) => {
    matchmaking(req.raw, reply.raw, () => {
      if (reply.raw.headersSent) {
        reply.hijack()
      }
      done()
    })
  })

  await matchMaker.setup()
  const transport = new WebSocketTransport({ noServer: true })
  transport.attachToServer(app.server)
  setTransport(transport)

  const gameServer = new Server({ transport })
  gameServer.define('placeholder', PlaceholderRoom)
  await matchMaker.accept()

  await app.listen({ port, host: '0.0.0.0' })
  return { app, gameServer }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  startServer().then(() => {
    console.log('turnover server: listening')
  })
}
