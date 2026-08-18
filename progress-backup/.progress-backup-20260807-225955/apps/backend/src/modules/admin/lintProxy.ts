import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Router, Middleware, NexusConfig } from '@bhooai/nexus-core';

/**
 * Config / .env linter proxy.
 *
 * Node reads the raw files (auth + file access boundary) and posts the text to
 * the Python AI server, which computes the lint report. This keeps linting
 * logic in Python and file/secret ownership in Node.
 *
 *   POST /admin/lint/env      { envText, exampleText } -> report
 *   POST /admin/lint/config   { content }              -> report
 */

export interface LintCheck { key: string; severity: 'error' | 'warning' | 'info' | 'ok'; kind: string; message: string }
export interface LintReport { ranAt: string; summary: { error: number; warning: number; info: number; ok: number }; checks: LintCheck[] }

function envPathOf(root: string, name: string): string {
  const safe = /^\.env(?:\.\w+)*$/.test(name ?? '.env') ? name : '.env';
  return join(root, safe);
}

export function registerLintRoutes(router: Router, config: NexusConfig, root: string, guard: Middleware[]): void {
  const serverUrlRaw = (config.ai?.serverUrl as string) ?? 'http://localhost:8000';
  const serverUrl = serverUrlRaw.replace(/\/+$/, '');
  const timeoutMs = (config.ai?.timeoutMs as number) ?? 60_000;

  const toPython = async (path: string, body: Record<string, unknown>): Promise<LintReport> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${serverUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`AI server returned HTTP ${res.status}`);
      return (await res.json()) as LintReport;
    } finally {
      clearTimeout(timer);
    }
  };

  const failed = (message: string): LintReport => ({
    ranAt: new Date().toISOString(),
    summary: { error: 1, warning: 0, info: 0, ok: 0 },
    checks: [{ key: '(linter)', severity: 'error', kind: 'unreachable', message }],
  });

  router.post('/admin/lint/env', async (ctx) => {
    const body = (ctx.body ?? {}) as { env?: unknown; example?: unknown };
    const envName = typeof body.env === 'string' && body.env.trim() ? body.env.trim() : '.env';
    const exampleName = typeof body.example === 'string' && body.example.trim() ? body.example.trim() : '.env.example';
    try {
      const envPath = envPathOf(root, envName);
      const examplePath = envPathOf(root, exampleName);
      const envText = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
      const exampleText = existsSync(examplePath) ? await readFile(examplePath, 'utf8') : '';
      try {
        ctx.json(await toPython('/lint/env', { envText, exampleText }));
      } catch (err) {
        ctx.json(failed((err as Error).message || 'linter unreachable'));
      }
    } catch (err) {
      ctx.json({ error: (err as Error).message, summary: { error: 0, warning: 0, info: 0, ok: 0 }, checks: [] });
    }
  }, guard);

  router.post('/admin/lint/config', async (ctx) => {
    const runtimePath = join(root, 'nexus.runtime.json');
    const content = existsSync(runtimePath) ? await readFile(runtimePath, 'utf8') : '{}';
    try {
      ctx.json(await toPython('/lint/config', { content }));
    } catch (err) {
      ctx.json(failed((err as Error).message || 'linter unreachable'));
    }
  }, guard);
}