import { defineConfig } from 'vitest/config'

// Gate 2 (`pnpm test:sim`): headless vitest projects — shared domain constants,
// the pure sim, and the server transport shell. CI names and order are the
// contract (.github/workflows/ci.yml); keep them stable.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
})
