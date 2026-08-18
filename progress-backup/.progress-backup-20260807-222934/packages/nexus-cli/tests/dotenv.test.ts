import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotEnv } from '../src/dotenv.js';

describe('loadDotEnv', () => {
  it('parses KEY=VALUE lines, comments, quotes, and export prefixes into env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexus-dotenv-'));
    try {
      await writeFile(
        join(dir, '.env'),
        [
          '# comment',
          'NEXUS_PAYMENTS_RAZORPAY_ENABLED=true',
          'NEXUS_PAYMENTS_RAZORPAY_KEY_ID=rzp_test_abc',
          "export NEXUS_AI_SERVER_URL='http://localhost:8000'",
          'QUOTED="value with spaces"',
          '',
        ].join('\n'),
        'utf8',
      );
      const env: Record<string, string> = {};
      loadDotEnv(dir, env as NodeJS.ProcessEnv);
      expect(env.NEXUS_PAYMENTS_RAZORPAY_ENABLED).toBe('true');
      expect(env.NEXUS_PAYMENTS_RAZORPAY_KEY_ID).toBe('rzp_test_abc');
      expect(env.NEXUS_AI_SERVER_URL).toBe('http://localhost:8000');
      expect(env.QUOTED).toBe('value with spaces');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never overrides an existing environment variable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexus-dotenv-'));
    try {
      await writeFile(join(dir, '.env'), 'NEXUS_SERVER_PORT=9999\n', 'utf8');
      const env: Record<string, string> = { NEXUS_SERVER_PORT: '4000' };
      loadDotEnv(dir, env as NodeJS.ProcessEnv);
      expect(env.NEXUS_SERVER_PORT).toBe('4000');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when there is no .env file', () => {
    const env: Record<string, string> = {};
    loadDotEnv(join(tmpdir(), 'definitely-missing-' + Date.now()), env as NodeJS.ProcessEnv);
    expect(Object.keys(env)).toHaveLength(0);
  });
});