import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { run } from '../src/index.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('CLI dispatcher', () => {
  it('prints help and exits 0', async () => {
    const code = await run('help', []);
    expect(code).toBe(0);
  });

  it('returns 1 for an unknown command', async () => {
    const code = await run('nope', []);
    expect(code).toBe(1);
  });
});

describe('CLI init', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-cli-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scaffolds the four-terminal tree', async () => {
    const code = await run('init', [dir, '--skip-install']);
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'nexus.config.ts'))).toBe(true);
    expect(existsSync(join(dir, 'apps/backend/src/main.ts'))).toBe(true);
    expect(existsSync(join(dir, 'apps/frontend/src/main.tsx'))).toBe(true);
    expect(existsSync(join(dir, 'apps/ai-server/main.py'))).toBe(true);
    expect(existsSync(join(dir, 'admin/src/main.tsx'))).toBe(true);
  });

  it('is idempotent (skips existing files without --force)', async () => {
    await run('init', [dir, '--skip-install']);
    const code = await run('init', [dir, '--skip-install']);
    expect(code).toBe(0);
    const cfg = readFileSync(join(dir, 'nexus.config.ts'), 'utf8');
    expect(cfg).toContain('NexusConfig');
  });
});
