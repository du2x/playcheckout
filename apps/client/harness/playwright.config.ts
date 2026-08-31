import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const stripCheck = `${repoRoot}apps/client/scripts/check-prod-strip.mjs`

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /.*\.spec\.ts/,
  use: {
    baseURL: 'http://localhost:2567',
    // Watchable evidence (cycle 3.B): record every test's pages so a run can
    // be replayed without headed spectating — headed windows freeze rAF when
    // occluded (the game loop stalls and players stand still). Videos land
    // under apps/client/test-results/**.
    video: 'on',
    // Headed spectating: keep every player window's game loop running even
    // when occluded/unfocused — no-op for the headless CI runs.
    launchOptions: {
      args: [
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    },
  },
  webServer: {
    // Prod strip check (SKEL-08), then build the harness bundle (dev-only
    // __TURNOVER__ hook kept) and boot the real server — the harness always
    // runs against a dev-mode bundle served by the actual transport shell (AD-001).
    // The 30 s test shift (AD-004 seam, non-production only) lets round scenarios
    // reach a real buzzer in seconds while leaving room for the LIGHT-09
    // clock sampling that finish before the buzzer; the AD-028 guest-timing
    // seam (scale 0.5) fits full guest lifecycles into that same shift.
    command: `pnpm --filter @turnover/client build && node ${stripCheck} --expect-absent && pnpm --filter @turnover/client build:harness && node ${stripCheck} --expect-present && TURNOVER_TEST_SHIFT_SECONDS=30 TURNOVER_TEST_GUEST_SCALE=0.5 pnpm exec tsx apps/server/src/index.ts`,
    url: 'http://localhost:2567',
    cwd: repoRoot,
    reuseExistingServer: false,
    timeout: 60000,
  },
})
