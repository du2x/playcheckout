import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  server: {
    // `pnpm boot` dev flow: the Vite client on :5173 talks to the game server
    // on :2567 (AD-001 single-port contract applies to serving prod; dev
    // proxies the matchmake HTTP + websocket upgrade across ports).
    proxy: {
      '/matchmake': { target: 'http://localhost:2567', changeOrigin: true },
      '/websocket': { target: 'ws://localhost:2567', ws: true },
    },
  },
})
