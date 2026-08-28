import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  server: {
    // `pnpm boot` dev flow: the Vite client on :5173 talks to the game server
    // on :2567 (AD-001 single-port contract applies to serving prod; dev
    // proxies the matchmake HTTP + websocket upgrade across ports).
    //
    // The room websocket path is NOT a fixed '/websocket' — the SDK connects
    // to `/<processId>/<roomId>?sessionId=…` (verified in @colyseus/sdk
    // Client.buildEndpoint), so forward that shape as a websocket upgrade.
    proxy: {
      '/matchmake': { target: 'http://localhost:2567', changeOrigin: true },
      '^/[A-Za-z0-9_-]+/[A-Z]{4}(\\?|$)': { target: 'ws://localhost:2567', ws: true },
    },
  },
})
