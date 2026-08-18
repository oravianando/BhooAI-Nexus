import { defineProject } from 'vitest/config.js';

export default defineProject({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 30_000,
  },
});