import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal dependency-free `.env` loader for the CLI and supervised services.
 *
 * The framework's config maps every `NEXUS_*` variable onto the config tree
 * (`env.ts`), but nothing ever loaded a `.env` file — so keys like
 * `NEXUS_PAYMENTS_RAZORPAY_KEY_ID` in the project's `.env` were silently
 * ignored. We parse `<root>/.env` once at CLI startup and merge it into
 * `process.env` WITHOUT overriding variables that are already set (a real
 * environment value always wins).
 *
 * Grammar: `KEY=VALUE` (optional `export ` prefix), `#` comments, blank lines,
 * and optional single/double quotes. Placeholder policies are left to the app.
 */
export function loadDotEnv(root: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = resolve(root, '.env');
  if (!existsSync(file)) return;
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (env[key] !== undefined) continue; // real env always wins
    let value = m[2]!.trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}