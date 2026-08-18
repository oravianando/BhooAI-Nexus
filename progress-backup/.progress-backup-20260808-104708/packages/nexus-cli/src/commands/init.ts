import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface InitOptions {
  force?: boolean;
  target?: string;
}

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const __dirname = dirname(fileURLToPath(import.meta.url));
// templates/ lives at the package root (sibling of src/ and dist/), so it works
// whether this file runs from src/commands/ (dev, via tsx) or dist/commands/.
const TEMPLATES = resolve(__dirname, '..', '..', 'templates');
// The published package keeps the framework workspaces beside nexus-cli. This
// also resolves to the generated project root when the vendored CLI is used.
const FRAMEWORK_PACKAGES = resolve(__dirname, '..', '..', '..', '..', 'packages');
const PRUNED_PACKAGE_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.cache', '.vite']);

/** Recursively collect every file under `dir`, as paths relative to `dir`. */
function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...listFiles(abs, base));
    } else {
      out.push(relative(base, abs).replace(/\\/g, '/'));
    }
  }
  return out;
}

/** Scaffold a new Nexus project from templates/. `nexus init [target] [--force]`. */
export async function init(opts: InitOptions = {}, args: string[] = []): Promise<number> {
  const targetArg = opts.target ?? args[0] ?? '.';
  const target = resolve(targetArg);
  const force = opts.force ?? args.includes('--force');
  const skipInstall = args.includes('--skip-install');

  if (!existsSync(TEMPLATES)) {
    console.error(`init: templates directory not found at ${TEMPLATES}`);
    return 1;
  }

  const files = listFiles(TEMPLATES);
  let created = 0;
  let skipped = 0;
  for (const rel of files) {
    // npm strips .gitignore files from published tarballs, so the template is
    // shipped as `gitignore` and restored to the conventional name here.
    const outputRel = rel === 'gitignore' ? '.gitignore' : rel;
    const abs = join(target, outputRel);
    const preservesExistingConfig = outputRel === 'nexus.config.ts' &&
      ['js', 'mjs', 'cjs'].some((ext) => existsSync(join(target, `nexus.config.${ext}`)));
    if (outputRel === 'package.json' && existsSync(abs) && !force) {
      mergePackageManifest(abs, join(TEMPLATES, rel));
      console.log(`  ${GREEN}update${RESET} ${outputRel}`);
      continue;
    }
    if ((existsSync(abs) || preservesExistingConfig) && !force) {
      console.log(`  ${DIM}skip${RESET}  ${outputRel} (exists)`);
      skipped++;
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, readFileSync(join(TEMPLATES, rel)));
    console.log(`  ${GREEN}create${RESET} ${outputRel}`);
    created++;
  }

  const vendored = vendorFrameworkPackages(target, force);
  created += vendored.created;
  skipped += vendored.skipped;

  ensureJwtSecret(target);

  console.log(`\nScaffolded ${created} file(s) into ${target}${skipped ? ` (${skipped} skipped)` : ''}.`);
  if (!skipInstall && installDependencies(target) !== 0) return 1;
  console.log('Next:');
  console.log(`  ${CYAN}npm run doctor${RESET}   # verify the environment`);
  console.log(`  ${CYAN}npm run dev${RESET}      # start backend, frontend, AI server, and admin`);
  return 0;
}

/** Copy framework workspace manifests and source into the generated project. */
function vendorFrameworkPackages(target: string, force: boolean): { created: number; skipped: number } {
  if (!existsSync(FRAMEWORK_PACKAGES)) {
    console.error(`init: framework packages directory not found at ${FRAMEWORK_PACKAGES}`);
    return { created: 0, skipped: 0 };
  }

  let created = 0;
  let skipped = 0;
  const files = listFiles(FRAMEWORK_PACKAGES).filter((rel) => {
    const parts = rel.split('/');
    return !parts.some((part) => PRUNED_PACKAGE_DIRS.has(part)) && !rel.endsWith('.tsbuildinfo');
  });

  for (const rel of files) {
    const abs = join(target, 'packages', rel);
    const existed = existsSync(abs);
    if (existed && !force) {
      skipped++;
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, readFileSync(join(FRAMEWORK_PACKAGES, rel)));
    console.log(`  ${GREEN}${existed ? 'update' : 'create'}${RESET} packages/${rel}`);
    created++;
  }
  return { created, skipped };
}

function installDependencies(target: string): number {
  console.log('\nInstalling project dependencies (React, Vite, admin, and framework packages)...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], {
    cwd: target,
    stdio: 'inherit',
    // Windows npm is a .cmd shim and requires shell execution.
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`init: npm install failed: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    console.error(`init: npm install exited with code ${result.status ?? 'unknown'}`);
    return result.status ?? 1;
  }
  console.log('Dependencies installed.');
  return 0;
}

function ensureJwtSecret(target: string): void {
  const envPath = join(target, '.env');
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const current = /^NEXUS_AUTH_JWT_SECRET\s*=\s*(.*)$/m.exec(existing)?.[1]?.trim();
  if (current && current !== 'change-me-please' && !current.startsWith('change-me-please-')) return;

  const secret = randomBytes(32).toString('base64url');
  const line = `NEXUS_AUTH_JWT_SECRET=${secret}`;
  const next = /^NEXUS_AUTH_JWT_SECRET\s*=.*$/m.test(existing)
    ? existing.replace(/^NEXUS_AUTH_JWT_SECRET\s*=.*$/m, line)
    : `${existing.trimEnd()}${existing.trimEnd() ? '\n' : ''}${line}\n`;
  writeFileSync(envPath, next);
  console.log(`  ${GREEN}${existing ? 'update' : 'create'}${RESET} .env (JWT secret generated)`);
}

function mergePackageManifest(targetPath: string, templatePath: string): void {
  const current = JSON.parse(readFileSync(targetPath, 'utf8')) as Record<string, any>;
  const template = JSON.parse(readFileSync(templatePath, 'utf8')) as Record<string, any>;
  const merged = {
    ...template,
    ...current,
    type: template.type ?? current.type,
    workspaces: template.workspaces ?? current.workspaces,
    scripts: { ...(current.scripts ?? {}), ...(template.scripts ?? {}) },
    // Keep project-specific versions and local file: dependencies when an
    // existing manifest is upgraded; the template only supplies missing keys.
    dependencies: { ...(template.dependencies ?? {}), ...(current.dependencies ?? {}) },
    devDependencies: { ...(template.devDependencies ?? {}), ...(current.devDependencies ?? {}) },
  };
  writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`);
}
