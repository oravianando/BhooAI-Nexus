#!/usr/bin/env node
/**
 * Generated Nexus CLI entry. Resolves the `@bhooai/nexus-cli` package and
 * dispatches the command. The CLI package's main points at TypeScript source
 * (run via tsx) so there is no build step; if a compiled dist is present it is
 * used directly.
 */
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function main() {
  // Resolve the CLI through the installed package exports. This works for both
  // the published package and the local wrapper package one directory above it.
  const cliEntry = require.resolve('bhooai-nexus/cli');
  let mod;
  if (existsSync(cliEntry) && extname(cliEntry) === '.js') {
    mod = await import(pathToFileURL(cliEntry).href);
  } else {
    const { tsImport } = await import('tsx/esm/api');
    mod = await tsImport(pathToFileURL(cliEntry).href, import.meta.url);
  }
  const cmd = process.argv[2] ?? 'help';
  const rest = process.argv.slice(3);
  await mod.run(cmd, rest);
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
