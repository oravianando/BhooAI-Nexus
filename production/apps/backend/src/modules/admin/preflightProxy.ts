import { createConnection } from 'node:net';
import type { Router, Middleware, NexusConfig } from '@bhooai/nexus-core';

/**
 * Preflight diagnostics proxy.
 *
 * Node performs the connectivity/latency checks itself (fetch + net), so the
 * report no longer depends on the Python engine. The AI-server /preflight
 * endpoint still exists for external tooling; the admin console uses this
 * native path.
 *
 *   POST /admin/preflight -> { passed, warnings, failed, checks[] }
 *
 * Target addresses are derived from config but always normalized to a
 * connectable loopback address — binding on 0.0.0.0 is legal for a listener
 * but invalid as a connect target, so backend/GraphQL probes used to fail with
 * "timed out — the service may be filtering traffic".
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
  port?: number;
  url?: string;
  error?: string;
  errorCategory?: string;
}

export interface PreflightReport {
  ranAt: string;
  durationMs: number;
  engineOk?: boolean;
  passed: number;
  warnings: number;
  failed: number;
  checks: PreflightCheck[];
}

/** Map a bind/alias host to a connectable address. `0.0.0.0`/`::` are bind-only. */
function normalizeProbeHost(host: string | undefined, fallback = '127.0.0.1'): string {
  if (!host) return fallback;
  const h = host.trim().replace(/^\[|\]$/g, '');
  if (h === '0.0.0.0' || h === '::' || h === 'localhost' || h === 'localhost.localdomain') return fallback;
  return h;
}

/** Parse a mongodb:// or redis:// URL into a host/port pair with defaults applied. */
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
  return { host: normalizeProbeHost(host), port };
}

type Category = 'refused' | 'timeout' | 'dns' | 'http' | 'other';

function classifyTransient(err: unknown): { category: Category; message: string } {
  const code = (err as { code?: string })?.code;
  const why = (err as { cause?: unknown })?.cause;
  const causeCode = (why as { code?: string })?.code;
  if (code === 'ECONNREFUSED' || causeCode === 'ECONNREFUSED') {
    return { category: 'refused', message: 'connection refused — is the service running?' };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
    return { category: 'dns', message: 'host not found' };
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || causeCode === 'ETIMEDOUT' || code === 'ABORT_ERR') {
    return { category: 'timeout', message: 'timed out — no response within the probe window' };
  }
  return { category: 'other', message: (err as Error).message || String(err) };
}

function httpProbe(url: string, timeoutMs: number): Promise<PreflightCheck> {
  const start = Date.now();
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    .then((res) => {
      const ok = res.status < 400;
      return {
        name: '',
        kind: 'http',
        url,
        ok,
        status: res.status,
        latencyMs: Date.now() - start,
        errorCategory: ok ? null : 'http',
        error: ok ? null : `HTTP ${res.status}`,
      };
    })
    .catch((err: unknown) => {
      const { category, message } = classifyTransient(err);
      return {
        name: '',
        kind: 'http',
        url,
        ok: false,
        status: null,
        latencyMs: Date.now() - start,
        errorCategory: category,
        error: sanitize(message),
      };
    });
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<PreflightCheck> {
  const start = Date.now();
  return new Promise<PreflightCheck>((resolve) => {
    const socket = createConnection({ host, port });
    const settled = (check: PreflightCheck) => {
      socket.destroy();
      resolve(check);
    };
    let connected = false;
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      connected = true;
      settled({
        name: '',
        kind: 'tcp',
        host,
        port,
        ok: true,
        latencyMs: Date.now() - start,
        errorCategory: null,
        error: null,
      });
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (connected) return;
      const { category, message } = classifyTransient(err);
      settled({
        name: '',
        kind: 'tcp',
        host,
        port,
        ok: false,
        latencyMs: Date.now() - start,
        errorCategory: category,
        error: sanitize(message),
      });
    });
    socket.once('timeout', () => {
      if (connected) return;
      settled({
        name: '',
        kind: 'tcp',
        host,
        port,
        ok: false,
        latencyMs: Date.now() - start,
        errorCategory: 'timeout',
        error: 'timed out — no response within the probe window',
      });
    });
  });
}

/** Raw error strings that carry no diagnostic value. */
const NOISE = /address(?:not valid| already in use)|WinError/i;

function sanitize(message: string): string {
  return NOISE.test(message) ? 'unreachable from this host' : message;
}

export function registerPreflightRoutes(router: Router, config: NexusConfig, guard: Middleware[]): void {
  router.post('/admin/preflight', async (ctx) => {
    const started = Date.now();
    const serverUrlRaw = (config.ai?.serverUrl as string) ?? 'http://localhost:8000';
    const serverUrl = serverUrlRaw.replace(/\/+$/, '');
    const host = normalizeProbeHost(config.server.host);
    const port = config.server.port ?? 8080;

    const targets: PreflightTarget[] = [];

    const backendUrl = `http://${host}:${port}/health`;
    targets.push({ name: 'Backend API', kind: 'http', url: backendUrl, timeout: 3000 });

    const aiUrl = `${serverUrl.replace(/localhost/i, host)}/health`;
    targets.push({ name: 'AI server', kind: 'http', url: aiUrl, timeout: 3000 });

    if (config.graphql?.path) {
      // A bare GET would 400 (no query) and POST is CSRF-blocked — probe with a
      // minimal read-query so the endpoint answers 200 instead.
      const graphqlUrl = `http://${host}:${port}${config.graphql.path}?query=${encodeURIComponent('{ __typename }')}`;
      targets.push({ name: 'GraphQL', kind: 'http', url: graphqlUrl, timeout: 3000 });
    }

    // Mongo + Redis as TCP reachability probes (authenticated ping is out of scope here).
    const dbUri = (config.db?.uri as string) ?? 'mongodb://127.0.0.1:27017';
    const mongo = endpointFromUrl(dbUri, 27017);
    targets.push({ name: 'MongoDB', kind: 'tcp', host: mongo.host, port: mongo.port, timeout: 2000 });

    const redisUrl = (config.redis?.url as string) ?? '';
    if (redisUrl) {
      const redis = endpointFromUrl(redisUrl, 6379);
      targets.push({ name: 'Redis', kind: 'tcp', host: redis.host, port: redis.port, timeout: 2000 });
    }

    const runner = async (t: PreflightTarget): Promise<PreflightCheck> => {
      if (t.kind === 'http') {
        return httpProbe(t.url ?? '', t.timeout ?? 3000).then((c) => ({ ...c, name: t.name }));
      }
      return tcpProbe(t.host ?? '127.0.0.1', t.port ?? 0, t.timeout ?? 2000).then((c) => ({ ...c, name: t.name }));
    };

    const checks = await Promise.all(targets.map(runner));
    const durationMs = Date.now() - started;

    const failed = checks.filter((c) => !c.ok);
    const passed = checks.filter((c) => c.ok);
    const slow = passed.filter((c) => typeof c.latencyMs === 'number' && (c.latencyMs as number) > 800);
    const rest = passed.filter((c) => !slow.includes(c));

    ctx.json({
      ranAt: new Date().toISOString(),
      durationMs,
      engineOk: true,
      passed: passed.length,
      warnings: slow.length,
      failed: failed.length,
      checks: [...failed, ...slow, ...rest],
    });
  }, guard);
}