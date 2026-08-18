import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/nexus-core/vitest.config.ts',
  'packages/nexus-telemetry/vitest.config.ts',
  'packages/nexus-cli/vitest.config.ts',
  'packages/nexus-auth/vitest.config.ts',
  'packages/nexus-data/vitest.config.ts',
  'packages/nexus-realtime/vitest.config.ts',
  'packages/nexus-cache/vitest.config.ts',
  'packages/nexus-graphql/vitest.config.ts',
  'packages/nexus-crypto/vitest.config.ts',
  'packages/nexus-payments/vitest.config.ts',
  'packages/nexus-email/vitest.config.ts',
  'packages/nexus-ads/vitest.config.ts',
  'packages/nexus-plugins/vitest.config.ts',
  'packages/nexus-ai-client/vitest.config.ts',
  'apps/backend/vitest.config.ts',
]);