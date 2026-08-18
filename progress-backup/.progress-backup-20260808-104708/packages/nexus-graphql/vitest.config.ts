import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 15_000,
  },
});