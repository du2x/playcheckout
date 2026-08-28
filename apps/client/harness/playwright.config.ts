import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const stripCheck = `${repoRoot}apps/client/scripts/check-prod-strip.mjs`

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /.*\.spec\.ts/,
  use: {
    baseURL: 'http://localhost:2567',
  },
  webServer: {
    // Prod strip check (SKEL-08), then build the harness bundle (dev-only
    // __TURNOVER__ hook kept) and boot the real server — the harness always
    // runs against a dev-mode bundle served by the actual transport shell (AD-001).
    command: `pnpm --filter @turnover/client build && node ${stripCheck} --expect-absent && pnpm --filter @turnover/client build:harness && node ${stripCheck} --expect-present && pnpm exec tsx apps/server/src/index.ts`,
    url: 'http://localhost:2567',
    cwd: repoRoot,
    reuseExistingServer: false,
    timeout: 60000,
  },
})
