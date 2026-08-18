import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncConfig, deriveValues, fingerprintOf, configChangedSinceSync, syncFingerprintPath } from '../src/config-sync.js';
import { mergeConfig } from '../../nexus-core/src/index.js';

const DOCKERFILE_FIXTURE = `# Build
#   docker run --rm -p 4000:4000 -p 3000:3000 -p 3001:3001 --env-file .env node-1
# Access:
#   frontend  http://localhost:3000   (SPA)
#   admin     http://localhost:3001   (SPA)
#   backend   http://localhost:4000   (API + /health)
#   node      http://localhost:7575   (cluster node agent)
EXPOSE 3000 3001 4000 7575
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\\\
  CMD wget -qO- http://127.0.0.1:\\\${NEXUS_SERVER_PORT:-4000}/health >/dev/null || exit 1
`;

const SERVE_ALL_FIXTURE = `import { spawn } from 'node:child_process';
const nodePort = process.env.NEXUS_NODE_PORT ?? '7575';
run('frontend', join(root, 'apps', 'frontend'), npm, ['run', 'preview', '--', '--host', '0.0.0.0', '--port', '3000']);
run('admin', join(root, 'apps', 'admin'), npm, ['run', 'preview', '--', '--host', '0.0.0.0', '--port', '3001']);
`;

const ADMIN_PKG_FIXTURE = `{
  "scripts": { "dev": "vite --port 3001", "preview": "vite preview" }
}
`;

const PS1_FIXTURE = [
  "$dbUri    = 'mongodb://host.docker.internal:27017/nexus-docker'",
  "$redisUrl = 'redis://host.docker.internal:6379'",
  "$aiUrl    = 'http://host.docker.internal:8000'",
  "$nodePort = '7575'",
  "$serverPort = '4000'",
  "$frontendPort = '3000'",
  "$adminPort = '3001'",
  "    '-p', \"$serverPort`:$serverPort\",",
  "    '-p', \"$frontendPort`:$frontendPort\",",
  "    '-p', \"$adminPort`:$adminPort\",",
  "    '-p', \"$nodePort`:$nodePort\",",
  "    '-e', \"NEXUS_NODE_PORT=$nodePort\",",
  "    '-e', \"NEXUS_SERVER_PORT=$serverPort\"",
].join('\n');

const SH_FIXTURE = [
  'DB_URI="mongodb://host.docker.internal:27017/nexus-docker"',
  'REDIS_URL="redis://host.docker.internal:6379"',
  'AI_URL="http://host.docker.internal:8000"',
  'NODE_PORT="7575"',
  '    -p 4000:4000',
  '    -p 3000:3000',
  '    -p 3001:3001',
  '    -p 7575:7575',
  '    -e "NEXUS_NODE_PORT=$NODE_PORT"',
].join('\n');

const BAT_FIXTURE = [
  '-p 4000:4000',
  '-p 3000:3000',
  '-p 3001:3001',
  '-p 7575:7575',
  '-e NEXUS_DB_URI=mongodb://host.docker.internal:27017/nexus-docker',
  '-e NEXUS_REDIS_URL=redis://host.docker.internal:6379',
  '-e NEXUS_AI_SERVER_URL=http://host.docker.internal:8000',
  '-e NEXUS_NODE_PORT=7575',
  'echo frontend http://localhost:3000  admin http://localhost:3001  backend http://localhost:4000/health',
].join('\n');

describe('nexus config-sync', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexus-sync-'));
    await mkdir(join(dir, 'bin'), { recursive: true });
    await mkdir(join(dir, 'apps', 'admin'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'sync-test' }), 'utf8');
    await writeFile(join(dir, 'Dockerfile'), DOCKERFILE_FIXTURE, 'utf8');
    await writeFile(join(dir, 'bin', 'serve-all.mjs'), SERVE_ALL_FIXTURE, 'utf8');
    await writeFile(join(dir, 'apps', 'admin', 'package.json'), ADMIN_PKG_FIXTURE, 'utf8');
    await writeFile(join(dir, 'docker.ps1'), PS1_FIXTURE, 'utf8');
    await writeFile(join(dir, 'docker.sh'), SH_FIXTURE, 'utf8');
    await writeFile(join(dir, 'docker.bat'), BAT_FIXTURE, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the configured ports + URLs into every derived file', async () => {
    const cfg = mergeConfig({
      server: { port: 4100, host: '0.0.0.0' },
      frontend: { port: 3100 },
      admin: { port: 3111 },
      cluster: { nodeAgentPort: 7676, lbPort: 9090 },
      ai: { serverUrl: 'http://localhost:8111' },
      db: { uri: 'mongodb://localhost:27017/sync-test' },
      redis: { url: 'redis://localhost:6379' },
    });

    const report = await syncConfig(dir, cfg, { db: false });
    expect(existsSync(join(dir, '.nexus-sync.json'))).toBe(true);

    expect(report.files.every((f) => f.status === 'updated' || f.status === 'in-sync')).toBe(true);

    const df = await readFile(join(dir, 'Dockerfile'), 'utf8');
    expect(df).toContain('EXPOSE 3100 3111 4100 7676');
    expect(df).toContain('-p 4100:4100 -p 3100:3100 -p 3111:3111');
    expect(df).toContain('http://localhost:3100');
    expect(df).toContain('http://localhost:3111');
    expect(df).toContain('http://localhost:4100');
    expect(df).toContain('http://localhost:7676');
    expect(df).toContain('NEXUS_SERVER_PORT:-4100');

    const sa = await readFile(join(dir, 'bin', 'serve-all.mjs'), 'utf8');
    expect(sa).toContain("NEXUS_NODE_PORT ?? '7676'");
    expect(sa).toContain("'--port', '3100'");
    expect(sa).toContain("'--port', '3111'");

    const pkg = await readFile(join(dir, 'apps', 'admin', 'package.json'), 'utf8');
    expect(pkg).toContain('"dev": "vite --port 3111"');

    const ps1 = await readFile(join(dir, 'docker.ps1'), 'utf8');
    expect(ps1).toContain("$nodePort = '7676'");
    expect(ps1).toContain("$serverPort = '4100'");
    expect(ps1).toContain("$frontendPort = '3100'");
    expect(ps1).toContain("$adminPort = '3111'");
    expect(ps1).toContain('NEXUS_NODE_PORT=$nodePort');
    expect(ps1).toContain('NEXUS_SERVER_PORT=$serverPort');

    const sh = await readFile(join(dir, 'docker.sh'), 'utf8');
    expect(sh).toContain('-p 4100:4100');
    expect(sh).toContain('-p 3100:3100');
    expect(sh).toContain('-p 3111:3111');
    expect(sh).toContain('-p 7676:7676');

    const bat = await readFile(join(dir, 'docker.bat'), 'utf8');
    expect(bat).toContain('-p 4100:4100');
    expect(bat).toContain('-p 3100:3100');
    expect(bat).toContain('NEXUS_NODE_PORT=7676');
  });

  it('second run is idempotent (in-sync everywhere)', async () => {
    const cfg = mergeConfig({});
    await syncConfig(dir, cfg, { db: false });
    const second = await syncConfig(dir, cfg, { db: false });
    expect(second.files.map((f) => f.status)).toEqual(['in-sync', 'in-sync', 'in-sync', 'in-sync', 'in-sync', 'in-sync']);
  });

  it('ported to a new value and back — round-trips (no stale digits left)', async () => {
    const cfgA = mergeConfig({ frontend: { port: 3120 }, admin: { port: 3121 } });
    await syncConfig(dir, cfgA, { db: false });
    const cfgB = mergeConfig({});
    await syncConfig(dir, cfgB, { db: false });

    const df = await readFile(join(dir, 'Dockerfile'), 'utf8');
    expect(df).toContain('EXPOSE 3000 3001 4000 7575');
    expect(df).not.toContain('3120');

    const sa = await readFile(join(dir, 'bin', 'serve-all.mjs'), 'utf8');
    expect(sa).toContain("'--port', '3000'");
    expect(sa).not.toContain('312');

    const sh = await readFile(join(dir, 'docker.sh'), 'utf8');
    expect(sh).not.toContain('312');

    const bat = await readFile(join(dir, 'docker.bat'), 'utf8');
    expect(bat).not.toContain('312');

    const pkg = await readFile(join(dir, 'apps', 'admin', 'package.json'), 'utf8');
    expect(pkg).toContain('"dev": "vite --port 3001"');
  });

  it('fingerprint flips when the config changes', async () => {
    const base = mergeConfig({});
    expect(configChangedSinceSync(dir, base)).toBe(true);
    const report = await syncConfig(dir, base, { db: false });
    expect(report.fingerprint).toBeTruthy();
    expect(configChangedSinceSync(dir, base)).toBe(false);
    const changed = mergeConfig({ server: { port: 5555 } });
    expect(configChangedSinceSync(dir, changed)).toBe(true);
    expect(syncFingerprintPath(dir).length).toBeGreaterThan(0);
  });

  it('dry-run (write:false) reports updates but leaves files untouched', async () => {
    const cfg = mergeConfig({ server: { port: 9999 } });
    const before = await readFile(join(dir, 'Dockerfile'), 'utf8');
    const report = await syncConfig(dir, cfg, { write: false, db: false });
    expect(report.files.some((f) => f.status === 'updated')).toBe(true);
    const after = await readFile(join(dir, 'Dockerfile'), 'utf8');
    expect(after).toBe(before);
  });

  it('reports missing files without crashing and without hidden dotfile', async () => {
    await rm(join(dir, 'Dockerfile'));
    const report = await syncConfig(dir, mergeConfig({}), { db: false });
    expect(report.files.find((f) => f.file === 'Dockerfile')?.status).toBe('missing');
  });
});