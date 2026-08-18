#!/usr/bin/env node
/**
 * BhooAI Nexus CLI entry.
 *
 * Thin ESM shim: loads the compiled `@bhooai/nexus-cli` dist if present,
 * otherwise runs the TypeScript source via tsx's programmatic API (which
 * rewrites .js import specifiers to .ts). This keeps the framework usable
 * with `node bin/nexus.js ...` and no build step.
 */
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const distEntry = join(__dirname, '..', 'packages', 'nexus-cli', 'dist', 'index.js');
  const srcEntry = join(__dirname, '..', 'packages', 'nexus-cli', 'src', 'index.ts');
  const { tsImport } = await import('tsx/esm/api');
  let mod;
  if (existsSync(srcEntry)) {
    // Prefer source in the monorepo and in the published package so the CLI
    // does not depend on a stale or omitted build artifact.
    mod = await tsImport(pathToFileURL(srcEntry).href, import.meta.url);
  } else if (existsSync(distEntry)) {
    // Workspace packages export TypeScript sources with `.js` specifiers.
    // Keep tsx in the chain even when the CLI dist exists so Node can resolve
    // those source imports during development and after partial builds.
    mod = await tsImport(pathToFileURL(distEntry).href, import.meta.url);
  } else {
    mod = await tsImport(pathToFileURL(srcEntry).href, import.meta.url);
  }
  const cmd = process.argv[2] ?? 'help';
  const rest = process.argv.slice(3);
  await mod.run(cmd, rest);
}

/** True when a rejected promise was the user pressing Ctrl+C during an
 *  interactive prompt (node:readline/promises rejects the open question with an
 *  AbortError). A cancelled wizard is not a failure — no error dump. */
function isUserCancel(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  return err instanceof Error && /aborted with ctrl\+c/i.test(err.message);
}

main().catch((err) => {
  if (isUserCancel(err)) process.exit(130);
  console.error(err?.stack ?? err);
  process.exit(1);
});
