import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import { handle } from './backend-handle.js';

const E2E_PORT = Number(process.env.NEXUS_E2E_PORT ?? 4199);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const ENTRY = resolve(ROOT, 'apps', 'backend', 'src', 'main.ts');
const LOG = resolve(ROOT, 'logs', 'e2e-backend.log');

async function waitForHealth(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${E2E_PORT}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`backend did not become healthy on :${E2E_PORT} within ${timeoutMs}ms`);
}

// Drop the throwaway e2e DB so each run starts empty (the "first registered
// user is admin" bootstrap keys off an empty users collection). Uses the raw
// mongodb driver — the ODM isn't loaded here.
async function dropE2eDb(uri: string): Promise<void> {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri);
  try {
    await client.db().dropDatabase();
  } catch {
    // mongo may be briefly unavailable; the backend will retry connecting.
  } finally {
    await client.close();
  }
}

export default async function globalSetup(): Promise<void> {
  const dbUri = (process.env.NEXUS_DB_URI ?? 'mongodb://localhost:27017/nexus').replace(/\/[^/?]*$/, '/nexus_e2e');
  await dropE2eDb(dbUri);
  mkdirSync(resolve(ROOT, 'logs'), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXUS_SERVER_PORT: String(E2E_PORT),
    NEXUS_SERVER_HOST: '127.0.0.1',
    // throwaway DB so the e2e never touches a real one
    NEXUS_DB_URI: dbUri,
    NEXUS_AUTH_JWT_SECRET: 'e2e-test-secret-long-enough-for-hs256-aaaaaaaaaaaaaaaa',
    // disable the plugin loader so the e2e doesn't depend on example plugins
    NEXUS_PLUGINS_DIR: '__e2e_no_plugins__',
    NEXUS_LOGGING_LEVEL: 'warn',
    FORCE_COLOR: '0',
  };
  handle.backend = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', ENTRY], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  // Tee stdout/stderr to logs/e2e-backend.log so a mid-suite crash is diagnosable.
  const tee = (tag: string) => (chunk: Buffer) => {
    try { appendFileSync(LOG, `[${tag}] ${chunk.toString()}`); } catch { /* ignore */ }
  };
  handle.backend.stdout?.on('data', tee('out'));
  handle.backend.stderr?.on('data', tee('err'));
  handle.backend.on('exit', (code, signal) => {
    try { appendFileSync(LOG, `[exit] code=${code} signal=${signal}\n`); } catch { /* ignore */ }
  });

  try {
    await waitForHealth();
  } catch (err) {
    handle.backend?.kill('SIGKILL');
    throw err;
  }
}