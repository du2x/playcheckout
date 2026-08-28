import { defineProject } from 'vitest/config'

// Client unit tests (pure modules only). The harness/*.spec.ts files are
// Playwright specs owned by gate 3 (`pnpm test:client`) — never vitest.
export default defineProject({
  test: {
    environment: 'node',
    name: 'client',
    include: ['src/**/*.test.ts'],
  },
})
