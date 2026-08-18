import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Try a TCP connect to host:port within a timeout. */
export function tcpReachable(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** True if nothing is listening on `port` (quick TCP connect check). */
export async function isPortFree(host: string, port: number, timeoutMs = 700): Promise<boolean> {
  return !(await tcpReachable(host === '0.0.0.0' ? '127.0.0.1' : host, port, timeoutMs));
}

/** Parse host/port from common connection-string formats. */
export function parseHostPort(url: string, defaultPort: number): { host: string; port: number } {
  try {
    const u = new URL(url);
    return { host: u.hostname || 'localhost', port: u.port ? Number(u.port) : defaultPort };
  } catch {
    return { host: 'localhost', port: defaultPort };
  }
}

export async function versionOf(cmd: string, args: string[] = ['--version']): Promise<string> {
  try {
    // Windows: runtimes like `npm` are .cmd shims requiring a shell. Passing the
    // full command line (no separate args array) avoids Node's DEP0190 warning.
    const win = process.platform === 'win32';
    const { stdout } = win
      ? await execFileAsync(
          [cmd, ...args].map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' '),
          [],
          { shell: true },
        )
      : await execFileAsync(cmd, args, {});
    return stdout.trim();
  } catch {
    return '';
  }
}

/** A prerequisite check (runtime or service). */
export interface Prereq extends CheckResult {
  /** Critical = the wizard should refuse to proceed. Warnings ask to continue. */
  critical?: boolean;
}

/**
 * Detect installed runtimes: node, npm, python, git. Returns a list of checks
 * suitable for printing. node/npm/python are critical; git is a warning.
 * Shared by `nexus doctor` and `nexus init` step 1.
 */
export async function scanRuntimes(): Promise<Prereq[]> {
  const out: Prereq[] = [];
  out.push({ name: 'node', ok: !!process.versions.node, detail: `v${process.versions.node}`, critical: true });
  const npmVer = await versionOf(process.platform === 'win32' ? 'npm' : 'npm');
  out.push({ name: 'npm', ok: !!npmVer, detail: npmVer ? `v${npmVer}` : 'not found', critical: true });
  const pyVer = await versionOf(process.platform === 'win32' ? 'python' : 'python3');
  out.push({ name: 'python', ok: !!pyVer, detail: pyVer || 'not found (ai-server disabled)', critical: true });
  const gitVer = await versionOf('git', ['--version']);
  out.push({ name: 'git', ok: !!gitVer, detail: gitVer ? gitVer.replace(/^git version /, 'v') : 'not found' });
  return out;
}

/** Lightweight config shape used by `scanServices` (avoids importing nexus-core here). */
export interface ServiceConfig {
  db: { uri: string };
  redis: { url: string };
  ai: { serverUrl: string };
  server: { host: string; port: number };
  frontend: { port: number };
  admin: { port: number };
}

/**
 * Probe Mongo, Redis, and the AI server (TCP reachability) plus check that the
 * backend/frontend/admin ports are free. Returns a list of checks.
 * Shared by `nexus doctor` and `nexus init` step 1 / step 18 (verify).
 */
export async function scanServices(cfg: ServiceConfig): Promise<Prereq[]> {
  const out: Prereq[] = [];
  const db = parseHostPort(cfg.db.uri, 27017);
  const dbOk = await tcpReachable(db.host, db.port);
  out.push({ name: 'mongodb', ok: dbOk, detail: `${db.host}:${db.port} ${dbOk ? 'reachable' : 'unreachable'}` });

  const redis = parseHostPort(cfg.redis.url, 6379);
  const redisOk = await tcpReachable(redis.host, redis.port);
  out.push({ name: 'redis', ok: redisOk, detail: `${redis.host}:${redis.port} ${redisOk ? 'reachable' : 'unreachable'}` });

  const ai = parseHostPort(cfg.ai.serverUrl, 8000);
  const aiOk = await tcpReachable(ai.host, ai.port);
  out.push({ name: 'ai server', ok: aiOk, detail: `${ai.host}:${ai.port} ${aiOk ? 'reachable' : 'unreachable'}` });

  const backendFree = await isPortFree(cfg.server.host, cfg.server.port, 500);
  out.push({ name: 'backend port', ok: backendFree, detail: `:${cfg.server.port} ${backendFree ? 'free' : 'IN USE'}` });

  const frontendFree = await isPortFree('127.0.0.1', cfg.frontend.port, 500);
  out.push({ name: 'frontend port', ok: frontendFree, detail: `:${cfg.frontend.port} ${frontendFree ? 'free' : 'in use'}` });

  const adminFree = await isPortFree('127.0.0.1', cfg.admin.port, 500);
  out.push({ name: 'admin port', ok: adminFree, detail: `:${cfg.admin.port} ${adminFree ? 'free' : 'in use'}` });

  return out;
}

/** Returns true if `path` exists and its directory looks like a nexus project root. */
export function looksLikeProject(root: string): boolean {
  return existsSync(join(root, 'package.json')) &&
    ['ts', 'js', 'mjs', 'cjs'].some((ext) => existsSync(join(root, `nexus.config.${ext}`)));
}