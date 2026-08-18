import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfigAuto } from '../../../nexus-core/src/index.js';
import { CheckResult, scanRuntimes, scanServices } from '../util.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** Critical dependency names that must be present. */
const CRITICAL = new Set(['node', 'config', 'jwt-secret', 'jwt token', 'package.json', 'nexus.config']);

/** Compute total directory size in bytes (shallow - does not recurse). */
function dirSize(dir: string): number {
  try {
    let size = 0;
    for (const entry of readdirSync(dir)) {
      try { size += statSync(join(dir, entry)).size; } catch { /* skip */ }
    }
    return size;
  } catch {
    return 0;
  }
}

/** Check whether a directory exists and contains at least one entry. */
function dirPopulated(root: string, rel: string): { ok: boolean; detail: string } {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { ok: false, detail: `${rel}/ missing` };
  try {
    const count = readdirSync(abs).filter((e) => e !== '.gitkeep').length;
    return { ok: count > 0, detail: count > 0 ? `${count} file(s)` : 'empty' };
  } catch {
    return { ok: false, detail: `${rel}/ unreadable` };
  }
}

/** Check whether node_modules exists and has at least 10 packages. */
function depsInstalled(root: string, rel: string): { ok: boolean; detail: string } {
  const mod = join(root, rel, 'node_modules');
  if (!existsSync(mod)) return { ok: false, detail: `${rel}/node_modules missing` };
  try {
    const count = readdirSync(mod).filter((e) => !e.startsWith('.')).length;
    return { ok: count >= 10, detail: count >= 10 ? `${count} pkgs` : `only ${count} pkgs` };
  } catch {
    return { ok: false, detail: `${rel}/node_modules unreadable` };
  }
}

/** Verify the environment comprehensively. */
export async function doctor(): Promise<number> {
  const root = process.cwd();
  const results: CheckResult[] = [];

  // -- runtime versions (shared with `nexus init`) ----------------
  const runtimes = await scanRuntimes();
  results.push(...runtimes.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail })));

  // -- project files ------------------------------------------------
  const pkgJson = existsSync(join(root, 'package.json'));
  results.push({ name: 'package.json', ok: pkgJson, detail: pkgJson ? 'exists' : 'missing - not a nexus project' });

  const configExists = ['ts', 'js', 'mjs', 'cjs'].some((ext) => existsSync(join(root, `nexus.config.${ext}`)));
  const configExt = ['ts', 'js', 'mjs', 'cjs'].find((ext) => existsSync(join(root, `nexus.config.${ext}`)));
  results.push({ name: 'nexus.config', ok: configExists, detail: configExists ? `nexus.config.${configExt}` : 'missing' });

  const envExists = existsSync(join(root, '.env'));
  results.push({ name: '.env', ok: envExists, detail: envExists ? 'exists' : 'missing - secrets not loaded' });

  // -- project structure -------------------------------------------
  const structDirs: Array<{ rel: string; label: string }> = [
    { rel: 'apps/backend', label: 'apps/backend' },
    { rel: 'apps/frontend', label: 'apps/frontend' },
    { rel: 'apps/admin', label: 'apps/admin' },
    { rel: 'apps/ai-server', label: 'ai-server' },
    { rel: 'packages', label: 'packages' },
    { rel: 'bin', label: 'bin' },
    { rel: 'uploads', label: 'uploads' },
    { rel: 'plugins', label: 'plugins' },
    { rel: 'certs', label: 'certs' },
    { rel: 'logs', label: 'logs' },
  ];
  for (const d of structDirs) {
    const r = dirPopulated(root, d.rel);
    results.push({ name: d.label, ok: r.ok, detail: r.detail });
  }

  // -- dependencies ------------------------------------------------
  const depTargets = [
    { rel: '', label: 'root deps' },
    { rel: 'apps/backend', label: 'backend deps' },
    { rel: 'apps/frontend', label: 'frontend deps' },
    { rel: 'apps/admin', label: 'admin deps' },
  ];
  for (const d of depTargets) {
    const r = depsInstalled(root, d.rel);
    results.push({ name: d.label, ok: r.ok, detail: r.detail });
  }

  // -- disk space ---------------------------------------------------
  const uploadsDir = join(root, 'uploads');
  const uploadsSize = dirSize(uploadsDir);
  results.push({ name: 'uploads size', ok: true, detail: existsSync(uploadsDir) ? `${(uploadsSize / 1024 / 1024).toFixed(1)} MB` : 'no dir' });

  const logsDir = join(root, 'logs');
  const logsSize = dirSize(logsDir);
  results.push({ name: 'logs size', ok: true, detail: existsSync(logsDir) ? `${(logsSize / 1024 / 1024).toFixed(1)} MB` : 'no dir' });

  // -- config + services --------------------------------------------
  try {
    const cfg = await loadConfigAuto({ root });

    // config validation
    results.push({ name: 'config load', ok: true, detail: `env=${cfg.env} server=${cfg.server.host}:${cfg.server.port}` });

    // -- services (shared with `nexus init`) -----------------------
    const services = await scanServices(cfg);
    results.push(...services.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail })));

    // jwt secret + token round-trip
    if (cfg.auth.jwt.secret === 'change-me-please') {
      results.push({ name: 'jwt-secret', ok: false, detail: 'still the default - set NEXUS_AUTH_JWT_SECRET in .env' });
      results.push({ name: 'jwt token', ok: false, detail: 'skipped - secret not configured' });
    } else {
      results.push({ name: 'jwt-secret', ok: true, detail: 'configured' });
      // Sign + verify a test access token to validate the JWT pipeline end-to-end.
      try {
        const { SignJWT, jwtVerify } = await import('jose');
        const testToken = await new SignJWT({ sub: 'doctor-test', roles: ['admin'], iat: Math.floor(Date.now() / 1000) })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer(cfg.auth.jwt.issuer ?? 'bhooai-nexus')
          .setAudience(cfg.auth.jwt.audience ?? 'bhooai-nexus-client')
          .setExpirationTime('15m')
          .sign(new TextEncoder().encode(cfg.auth.jwt.secret));
        const { payload } = await jwtVerify(testToken, new TextEncoder().encode(cfg.auth.jwt.secret));
        const ok = payload.sub === 'doctor-test' && payload.roles?.[0] === 'admin';
        results.push({ name: 'jwt token', ok, detail: ok ? `HS256 sign+verify OK (sub=${payload.sub})` : 'token payload mismatch' });
      } catch (err) {
        results.push({ name: 'jwt token', ok: false, detail: `sign/verify failed - ${(err as Error).message}` });
      }
    }

    // graphql + ws paths
    results.push({ name: 'graphql', ok: true, detail: `path=${cfg.graphql.path} federation=${cfg.graphql.federation}` });
    results.push({ name: 'websocket', ok: true, detail: `path=${cfg.ws.path} csrf=${cfg.ws.requireCsrf}` });

    // frontend/admin enabled
    results.push({ name: 'frontend', ok: cfg.frontend.enabled, detail: cfg.frontend.enabled ? `enabled :${cfg.frontend.port}` : 'disabled' });
    results.push({ name: 'admin', ok: cfg.admin.enabled, detail: cfg.admin.enabled ? `enabled :${cfg.admin.port}` : 'disabled' });

    // cluster
    results.push({ name: 'cluster', ok: true, detail: cfg.cluster.enabled ? `enabled (LB :${cfg.cluster.lbPort})` : 'disabled' });

    // payments
    results.push({ name: 'payments', ok: true, detail: `currency=${cfg.payments.currency}` });

    // email
    results.push({ name: 'email', ok: true, detail: `provider=${cfg.email.provider}` });
  } catch (err) {
    results.push({ name: 'config', ok: false, detail: String((err as Error).message) });
  }

  // -- render ------------------------------------------------------
  console.log(`\n${BOLD}  *  BhooAI Nexus Doctor${RESET}  ${DIM}${new Date().toLocaleString()}${RESET}\n`);

  let criticalOk = true;
  let warnings = 0;
  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const icon = r.ok ? `${GREEN}[OK]${RESET}` : `${RED}[X]${RESET}`;
    const label = r.name.padEnd(16);
    if (r.ok) {
      passed++;
      console.log(`  ${icon} ${CYAN}${label}${RESET} ${DIM}${r.detail}${RESET}`);
    } else {
      failed++;
      const warn = CRITICAL.has(r.name) ? RED : YELLOW;
      if (!CRITICAL.has(r.name)) warnings++;
      console.log(`  ${icon} ${warn}${label}${RESET} ${r.detail}`);
      if (CRITICAL.has(r.name)) criticalOk = false;
    }
  }

  console.log(`\n  ${BOLD}${passed} passed${RESET}, ${YELLOW}${warnings} warnings${RESET}, ${RED}${failed - warnings} errors${RESET}\n`);

  if (criticalOk) {
    console.log(`${GREEN}  Nexus environment looks ready.${RESET}\n`);
  } else {
    console.log(`${RED}  Critical issues found - cannot start.${RESET}\n`);
  }
  return 0; // doctor never hard-fails
}
