import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /.*\.spec\.ts/,
  use: {
    baseURL: 'http://localhost:2567',
  },
  webServer: {
    // Builds the client in harness mode (dev-only __TURNOVER__ hook kept) and
    // boots the real server — the harness always runs against a dev-mode bundle
    // served by the actual transport shell (AD-001).
    command:
      'pnpm --filter @turnover/client build:harness && pnpm exec tsx apps/server/src/index.ts',
    url: 'http://localhost:2567',
    cwd: repoRoot,
    reuseExistingServer: false,
    timeout: 60000,
  },
})
