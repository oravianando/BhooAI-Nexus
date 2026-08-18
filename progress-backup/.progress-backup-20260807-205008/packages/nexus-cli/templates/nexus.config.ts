import type { NexusConfig } from '@bhooai/nexus-core';

/**
 * The single, human-edited config file. Precedence (low → high):
 *   code defaults < this file < nexus.runtime.json (admin, gitignored)
 *   < NEXUS_* env vars < CLI flags.
 *
 * Admin writes only `nexus.runtime.json`, so this file stays clean.
 */
const config: Partial<NexusConfig> = {
  env: 'development',
  server: { port: 4000, host: '0.0.0.0' },
  uploads: { dir: 'uploads', path: '/uploads', maxFileSize: 10 * 1024 * 1024, maxFiles: 20, allowedTypes: [] },
  graphql: { path: '/graphql', federation: 'in-process', subscriptions: true, introspection: true },
  ws: { path: '/ws', requireCsrf: true },
  ai: { serverUrl: 'http://localhost:8000', timeoutMs: 60_000, defaultProvider: 'auto' },
  logging: { level: 'info', format: 'pretty', console: true },
};

export default config;
