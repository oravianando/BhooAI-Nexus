import type { Router, Middleware, NexusConfig } from '@bhooai/nexus-core';

/**
 * Preflight diagnostics proxy.
 *
 * Node owns config + auth; Python performs the actual connectivity/latency
 * checks. /admin/preflight composes the targets it wants checked (backend
 * health, AI server health, Mongo/Redis TCP ports, service ports) and posts
 * them to the Python AI server, which runs them concurrently and returns a
 * normalized { passed, warnings, failed, checks[] } report.
 */

export interface PreflightTarget {
  name: string;
  kind: 'http' | 'tcp';
  url?: string;
  host?: string;
  port?: number;
  timeout?: number;
}

export interface PreflightCheck {
  name: string;
  kind: string;
  ok: boolean;
  latencyMs?: number;
  status?: number | null;
  host?: string;
  url?: string;
  error?: string;
}

export interface PreflightReport {
  ranAt: string;
  durationMs: number;
  passed: number;
  warnings: number;
  failed: number;
  checks: PreflightCheck[];
}

/** Parse a mongodb:// or redis:// URL into a host/port pair (defaults applied). */
function endpointFromUrl(uri: string, defaultPort: number, defaultHost = '127.0.0.1'): { host: string; port: number } {
  let host = defaultHost;
  let port = defaultPort;
  try {
    const u = new URL(uri);
    if (u.hostname) host = u.hostname;
    if (u.port) port = Number(u.port) || defaultPort;
  } catch {
    /* fall back to defaults */
  }
  return { host, port };
}

export function registerPreflightRoutes(router: Router, config: NexusConfig, guard: Middleware[]): void {
  router.post('/admin/preflight', async (ctx) => {
    const serverUrlRaw = (config.ai?.serverUrl as string) ?? 'http://localhost:8000';
    const serverUrl = serverUrlRaw.replace(/\/+$/, '');
    const host = config.server.host ?? '127.0.0.1';
    const port = config.server.port ?? 8080;

    const targets: PreflightTarget[] = [];

    const backendUrl = `http://${host}:${port}/health`;
    targets.push({ name: 'Backend API', kind: 'http', url: backendUrl, timeout: 3 });

    const aiUrl = `${serverUrl}/health`;
    targets.push({ name: 'AI server', kind: 'http', url: aiUrl, timeout: 3 });

    if (config.graphql?.path) {
      targets.push({ name: 'GraphQL', kind: 'http', url: `http://${host}:${port}${config.graphql.path}`, timeout: 3 });
    }

    // Mongo + Redis as TCP reachability probes (authenticated ping is out of scope here).
    const dbUri = (config.db?.uri as string) ?? 'mongodb://127.0.0.1:27017';
    const mongo = endpointFromUrl(dbUri, 27017);
    targets.push({ name: 'MongoDB', kind: 'tcp', host: mongo.host, port: mongo.port, timeout: 2 });

    const redisUrl = (config.redis?.url as string) ?? '';
    if (redisUrl) {
      const redis = endpointFromUrl(redisUrl, 6379);
      targets.push({ name: 'Redis', kind: 'tcp', host: redis.host, port: redis.port, timeout: 2 });
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let report: PreflightReport;
      try {
        const res = await fetch(`${serverUrl}/preflight`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targets }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`AI server returned HTTP ${res.status}`);
        report = (await res.json()) as PreflightReport;
      } finally {
        clearTimeout(timer);
      }
      ctx.json(report);
    } catch (err) {
      ctx.json({
        ranAt: new Date().toISOString(),
        durationMs: 0,
        passed: 0,
        warnings: 0,
        failed: 1,
        checks: [{ name: 'AI preflight server', kind: 'http', ok: false, error: (err as Error).message || 'unreachable' }],
      });
    }
  }, guard);
}