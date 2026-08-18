import { defineConfig } from '@playwright/test';

const E2E_PORT = Number(process.env.NEXUS_E2E_PORT ?? 4199);

// The e2e suite drives the REAL backend over HTTP (Playwright's request API).
// globalSetup boots the backend with tsx on a throwaway port + test DB, waits
// for /health, and globalTeardown tears it down. This is the cross-service
// happy path (auth → CSRF → GraphQL → payments) without needing the frontend
// build or external payment gateways.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}` },
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  reporter: [['list']],
});