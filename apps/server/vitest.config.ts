import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    environment: 'node',
    name: 'server',
    testTimeout: 15000,
  },
})
