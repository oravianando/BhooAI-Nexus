import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { NexusConfig } from '../../nexus-core/src/index.js';

/**
 * Config sync - propagate the single `nexus.config.ts` source of truth into
 * every derived artifact that still hardcodes a host/port/URL:
 *
 *   - Dockerfile                (EXPOSE, healthcheck, docker-run comments)
 *   - docker.ps1 / docker.sh / docker.bat (port vars, -p mappings, URLs)
 *   - bin/serve-all.mjs         (cluster node port + frontend/admin preview ports)
 *   - apps/admin/package.json   (the `vite --port NNNN` dev script)
 *   - shared project-info database (upsertProjectInfo so the DB record shows
 *     the same value the admin dashboard reads)
 *
 * A `.nexus-sync.json` fingerprint at the project root lets `nexus dev` detect
 * "config changed since last sync" and re-sync every artifact before booting.
 */

export interface SyncValues {
  /** Docker image / container name (package.json `name`). */
  image: string;
  serverPort: string;
  frontendPort: string;
  adminPort: string;
  nodePort: string;
  lbPort: string;
  aiPort: string;
  /** Host-service URLs as the docker helpers should reference them. */
  dbUri: string;
  redisUri: string;
  aiUrl: string;
  /** Mongo database name parsed from `db.uri`. */
  dbName: string;
}

export interface FileSyncReport {
  file: string;
  status: 'updated' | 'in-sync' | 'no-match' | 'missing';
  changes: string[];
}

export interface SyncReport {
  values: SyncValues;
  fingerprint: string;
  files: FileSyncReport[];
  db: 'updated' | 'skipped' | 'failed';
}

export interface SyncOptions {
  /** Write files (default true). False = dry-run / diff-only audit. */
  write?: boolean;
  /** Upsert the project-info MongoDB record (default true). */
  db?: boolean;
}

/* -- helpers -------------------------------------------------------------- */

/** Stable hash of the values that drive every derived artifact. */
export function fingerprintOf(values: SyncValues): string {
  return createHash('sha256')
    .update(
      [
        values.image,
        values.serverPort,
        values.frontendPort,
        values.adminPort,
        values.nodePort,
        values.lbPort,
        values.aiPort,
        values.dbUri,
        values.redisUri,
        values.aiUrl,
        values.dbName,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 16);
}

/** Path to the `.nexus-sync.json` fingerprint file. */
export function syncFingerprintPath(root: string): string {
  return join(root, '.nexus-sync.json');
}

/** Read the last-synced record, or undefined. */
export function readFingerprint(root: string): { fingerprint: string; values: SyncValues; syncedAt?: string } | undefined {
  const file = syncFingerprintPath(root);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { fingerprint: string; values: SyncValues; syncedAt?: string };
  } catch {
    return undefined;
  }
}

/** MongoDB database name parsed out of a connection string. */
export function dbNameFromUrl(uri: string): string {
  try {
    const url = new URL(uri);
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return name || 'platform';
  } catch {
    return 'platform';
  }
}

/** Rewrite a host-service URL so a container reaches it via the host gateway. */
function dockerHost(url: string): string {
  return url.replace(/\/\/(localhost|127\.0\.0\.1|\[::1\])([:/])/g, (m, _h, sep) => `//host.docker.internal${sep}`);
}

/** Port parsed from a URL (falls back on a sensible default). */
function portFrom(url: string, fallback: string): string {
  try {
    return new URL(url).port || fallback;
  } catch {
    return fallback;
  }
}

/** Package.json `name`, else the project folder name. */
function projectImageName(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) return pkg.name;
  } catch {
    /* no valid package.json - fall through */
  }
  return basename(root);
}

/** Role order used when scanning a contiguous `-p <port>:<port>` run. */
const PORT_ROLES = ['server', 'frontend', 'admin', 'node'] as const;

/** Value for a role before a `-p` token maps to. */
function forRole(role: string, v: SyncValues): string {
  switch (role) {
    case 'server':
      return v.serverPort;
    case 'frontend':
      return v.frontendPort;
    case 'admin':
      return v.adminPort;
    case 'node':
      return v.nodePort;
    default:
      return role;
  }
}

/**
 * Rewrite every group of contiguous `-p <port>:<port>` mapping tokens into the
 * configured ports. Roles are assigned positionally (server, frontend, admin,
 * node) so the rewrite is idempotent even after an earlier run wrote a custom
 * port (e.g. 3120) that role-splitting cannot recognize by number alone.
 *
 * The tokens in one `docker run` may be separated by whitespace, line-continuation
 * carets (`^` in .bat / `\` in .sh), and newlines, but never by another flag.
 */
function syncPortMap(content: string, v: SyncValues): string {
  return content.replace(/-p\s+\d+:\d+(?:[ \t\r\n^\\]*-p\s+\d+:\d+)*/g, (run) => {
    let idx = 0;
    return run.replace(/-p\s+\d+:\d+/g, (token) => {
      const p = forRole(PORT_ROLES[idx % PORT_ROLES.length], v);
      idx++;
      return token.replace(/\d+:\d+/, `${p}:${p}`);
    });
  });
}

/** Run a value-aware pipeline over file content. */
function render(content: string, v: SyncValues, steps: Array<(c: string) => string>): { out: string; changed: boolean } {
  let out = content;
  for (const step of steps) out = step(out);
  return { out, changed: out !== content };
}

/** Show the human-readable diff between two file versions. */
function diffLines(before: string, after: string): string[] {
  const changes: string[] = [];
  const b = before.split('\n');
  const a = after.split('\n');
  const max = Math.max(b.length, a.length);
  for (let i = 0; i < max; i++) {
    if (b[i] !== a[i]) {
      changes.push(`line ${i + 1}: ${(b[i] ?? '').trim()}  ->  ${(a[i] ?? '').trim()}`);
    }
  }
  return changes;
}

/* -- per-file renderers --------------------------------------------------- */

function renderDockerfile(content: string, v: SyncValues): string {
  return render(content, v, [
    (c) => c.replace(/^EXPOSE .*$/m, `EXPOSE ${v.frontendPort} ${v.adminPort} ${v.serverPort} ${v.nodePort}`),
    (c) => c.replace(/NEXUS_SERVER_PORT:-?\d+/g, `NEXUS_SERVER_PORT:-${v.serverPort}`),
    (c) => syncPortMap(c, v),
    (c) => c.replace(/-e NEXUS_SERVER_PORT=\d+/g, `-e NEXUS_SERVER_PORT=${v.serverPort}`),
    (c) => c.replace(/-e NEXUS_NODE_PORT=\d+/g, `-e NEXUS_NODE_PORT=${v.nodePort}`),
    (c) => c.replace(/(frontend\s+http:\/\/localhost:)\d+/g, `$1${v.frontendPort}`),
    (c) => c.replace(/(admin\s+http:\/\/localhost:)\d+/g, `$1${v.adminPort}`),
    (c) => c.replace(/(backend\s+http:\/\/localhost:)\d+/g, `$1${v.serverPort}`),
    (c) => c.replace(/(node\s+http:\/\/localhost:)\d+/g, `$1${v.nodePort}`),
  ]).out;
}

function renderServeAll(content: string, v: SyncValues): string {
  return render(content, v, [
    (c) => c.replace(/process\.env\.NEXUS_NODE_PORT\s*\?\?\s*'[^']+'/, `process.env.NEXUS_NODE_PORT ?? '${v.nodePort}'`),
    // Each service's preview port: match inside the `run('frontend'/'admin'` line.
    (c) => c.replace(/(run\('frontend',[^\n]*?'--port',\s*')[0-9]+(')/, `$1${v.frontendPort}$2`),
    (c) => c.replace(/(run\('admin',[^\n]*?'--port',\s*')[0-9]+(')/, `$1${v.adminPort}$2`),
    (c) => c.replace(/(frontend.*?on\s+:)[0-9]+/g, `$1${v.frontendPort}`),
    (c) => c.replace(/(admin.*?on\s+:)[0-9]+/g, `$1${v.adminPort}`),
  ]).out;
}

function renderAdminPackage(content: string, v: SyncValues): string {
  return render(content, v, [
    (c) => c.replace(/"dev":\s*"vite[^"]*"/, `"dev": "vite --port ${v.adminPort}"`),
  ]).out;
}

function renderDockerPs1(content: string, v: SyncValues): string {
  const set = (c: string, key: string, value: string) =>
    c.replace(new RegExp(`(\\$${key}\\s*=\\s*')[0-9]+(')`, 'g'), `$1${value}$2`);
  return render(content, v, [
    (c) => set(c, 'serverPort', v.serverPort),
    (c) => set(c, 'frontendPort', v.frontendPort),
    (c) => set(c, 'adminPort', v.adminPort),
    (c) => set(c, 'nodePort', v.nodePort),
    (c) => c.replace(/(\$dbUri\s*=\s*')([^']*)(')/g, `$1${v.dbUri}$3`),
    (c) => c.replace(/(\$redisUrl\s*=\s*')([^']*)(')/g, `$1${v.redisUri}$3`),
    (c) => c.replace(/(\$aiUrl\s*=\s*')([^']*)(')/g, `$1${v.aiUrl}$3`),
    (c) => syncPortMap(c, v),
  ]).out;
}

function renderDockerSh(content: string, v: SyncValues): string {
  return render(content, v, [
    (c) => c.replace(/(DB_URI=")([^"]*)(")/g, `$1${v.dbUri}$3`),
    (c) => c.replace(/(REDIS_URL=")([^"]*)(")/g, `$1${v.redisUri}$3`),
    (c) => c.replace(/(AI_URL=")([^"]*)(")/g, `$1${v.aiUrl}$3`),
    (c) => c.replace(/(NODE_PORT=")([^"]*)(")/g, `$1${v.nodePort}$3`),
    (c) => syncPortMap(c, v),
    (c) => c.replace(/(frontend http:\/\/localhost:)\d+/g, `$1${v.frontendPort}`),
    (c) => c.replace(/(admin\s+http:\/\/localhost:)\d+/g, `$1${v.adminPort}`),
    (c) => c.replace(/(backend\s+http:\/\/localhost:)\d+/g, `$1${v.serverPort}`),
  ]).out;
}

function renderDockerBat(content: string, v: SyncValues): string {
  return render(content, v, [
    (c) => syncPortMap(c, v),
    (c) => c.replace(/NEXUS_DB_URI=mongodb:\/\/[^\s^&]+/g, `NEXUS_DB_URI=${v.dbUri}`),
    (c) => c.replace(/NEXUS_REDIS_URL=redis:\/\/[^\s^&]+/g, `NEXUS_REDIS_URL=${v.redisUri}`),
    (c) => c.replace(/NEXUS_AI_SERVER_URL=http:\/\/[^\s^&]+/g, `NEXUS_AI_SERVER_URL=${v.aiUrl}`),
    (c) => c.replace(/NEXUS_NODE_PORT=\d+/g, `NEXUS_NODE_PORT=${v.nodePort}`),
    (c) => c.replace(/(frontend http:\/\/localhost:)\d+/g, `$1${v.frontendPort}`),
    (c) => c.replace(/(admin\s+http:\/\/localhost:)\d+/g, `$1${v.adminPort}`),
    (c) => c.replace(/(backend\s+http:\/\/localhost:)\d+/g, `$1${v.serverPort}`),
  ]).out;
}

/* -- targets -------------------------------------------------------------- */

type FileRenderer = (content: string, v: SyncValues) => string;

const TARGETS: Array<{ rel: string; render: FileRenderer }> = [
  { rel: 'Dockerfile', render: renderDockerfile },
  { rel: 'bin/serve-all.mjs', render: renderServeAll },
  { rel: 'apps/admin/package.json', render: renderAdminPackage },
  { rel: 'docker.ps1', render: renderDockerPs1 },
  { rel: 'docker.sh', render: renderDockerSh },
  { rel: 'docker.bat', render: renderDockerBat },
];

/* -- public API ----------------------------------------------------------- */

/** Derive the full set of printable / embeddable values from the effective config. */
export function deriveValues(cfg: NexusConfig, image: string): SyncValues {
  return {
    image,
    serverPort: String(cfg.server.port),
    frontendPort: String(cfg.frontend.port),
    adminPort: String(cfg.admin.port),
    nodePort: String(cfg.cluster.nodeAgentPort ?? 7575),
    lbPort: String(cfg.cluster.lbPort ?? 8080),
    aiPort: portFrom(cfg.ai.serverUrl, '8000'),
    dbUri: dockerHost(cfg.db.uri),
    redisUri: dockerHost(cfg.redis.url),
    aiUrl: dockerHost(cfg.ai.serverUrl),
    dbName: dbNameFromUrl(cfg.db.uri),
  };
}

/**
 * Sync the effective config into every derived file + the project-info DB.
 * Returns a field-level report; with `opts.write === false` it only audits.
 */
export async function syncConfig(root: string, cfg: NexusConfig, opts: SyncOptions = {}): Promise<SyncReport> {
  const write = opts.write !== false;
  const image = projectImageName(root);
  const values = deriveValues(cfg, image);
  const fingerprint = fingerprintOf(values);

  const files: FileSyncReport[] = [];
  for (const target of TARGETS) {
    const abs = join(root, target.rel);
    if (!existsSync(abs)) {
      files.push({ file: target.rel, status: 'missing', changes: [] });
      continue;
    }
    try {
      const current = await readFile(abs, 'utf8');
      const next = target.render(current, values);
      if (next === current) {
        files.push({ file: target.rel, status: 'in-sync', changes: [] });
        continue;
      }
      if (write) await writeFile(abs, next, 'utf8');
      files.push({ file: target.rel, status: 'updated', changes: diffLines(current, next) });
    } catch (err) {
      files.push({ file: target.rel, status: 'no-match', changes: [String((err as Error).message)] });
    }
  }

  if (write) {
    const record = { fingerprint, values, syncedAt: new Date().toISOString() };
    writeFileSync(syncFingerprintPath(root), JSON.stringify(record, null, 2), 'utf8');
  }

  const db = opts.db === false ? 'skipped' : await syncDatabase(root, cfg, values, write);

  return { values, fingerprint, files, db };
}

/** Upsert the shared `nexus_projects` record so the DB mirrors the config. */
async function syncDatabase(root: string, cfg: NexusConfig, values: SyncValues, write: boolean): Promise<SyncReport['db']> {
  if (!write) return 'skipped';
  try {
    const { resolveProjectInfo, connectProjectInfo, upsertProjectInfo, closeProjectInfo } = await import(
      '../../../nexus-data/src/index.js'
    );
    const project = await resolveProjectInfo(root);
    connectProjectInfo(cfg.db.uri, { autoIndex: false });
    await upsertProjectInfo({
      ...project,
      status: 'stopped',
      settings: {
        env: cfg.env,
        host: cfg.server.host,
        serverPort: cfg.server.port,
        frontendPort: cfg.frontend.port,
        adminPort: cfg.admin.port,
        lbPort: cfg.cluster?.lbPort,
        nodePort: cfg.cluster?.nodeAgentPort,
        aiPort: Number(values.aiPort),
        database: values.dbName,
        dbUri: cfg.db.uri,
        redisUrl: cfg.redis.url,
        aiUrl: cfg.ai.serverUrl,
        graphqlPath: cfg.graphql.path,
        wsPath: cfg.ws.path,
      },
    });
    await closeProjectInfo();
    return 'updated';
  } catch {
    return 'failed';
  }
}

/** True when the stored fingerprint differs from the current config. */
export function configChangedSinceSync(root: string, cfg: NexusConfig): boolean {
  const image = projectImageName(root);
  const current = fingerprintOf(deriveValues(cfg, image));
  const saved = readFingerprint(root);
  return !saved || saved.fingerprint !== current;
}