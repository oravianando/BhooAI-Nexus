import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { Router } from '@bhooai/nexus-core/http';
import type { DeepPartial, NexusConfig } from '@bhooai/nexus-core';
import { mergeConfig, discoverUserConfigPath, frameworkDefaultConfigPath } from '@bhooai/nexus-core';
import { AiClient } from '@bhooai/nexus-ai-client';
import { AuthService, authToken, requireRole } from '@bhooai/nexus-auth';
import type { PaymentsService } from '@bhooai/nexus-payments';
import type { AdminExtensions } from '@bhooai/nexus-plugins';
import { getUserModel } from '../users/userModel.js';
import { getOrderModel, getTransactionModel } from '../payments/paymentStore.js';
import { registerDatabaseRoutes } from './databaseRoutes.js';
import { registerPreflightRoutes } from './preflightProxy.js';
import { registerSchemaRoutes, type SchemaAIConfig } from './schemaRoutes.js';
import { ROLE_CATALOG, findRole } from './roleCatalog.js';
import { getProjectInfo, listProjectInfo, ObjectId, type ProjectInfo } from '@bhooai/nexus-data';

export interface AdminRouteDeps {
  /** Project root — where nexus.runtime.json lives. */
  root: string;
  /** The currently-running project (identity + info-store record). */
  project: ProjectInfo;
  /** Plugin admin overrides (pages/slots). */
  adminExtensions: AdminExtensions;
  /** Optional metrics snapshot provider. */
  metrics?: () => Record<string, unknown>;
  /** AI config used by the schema-generator endpoint. */
  ai?: SchemaAIConfig;
  /** Enabled payment providers (used by the payments test console). */
  payments?: PaymentsService;
}

/**
 * Mount /admin/* routes. They are protected by bearer-token auth + the 'admin'
 * role (the first registered user is bootstrapped as admin). The admin app
 * uses these to edit the config file + runtime overrides, list plugins, users,
 * payments, administer databases, and generate schemas with AI.
 *
 *   GET  /admin/config                  → { runtime, config, file, project } (secrets redacted)
 *   GET  /admin/projects                → registered projects from the project-info database
 *   PUT  /admin/config                  → write a DeepPartial override to nexus.runtime.json
 *   PUT  /admin/config/file             → write the human-edited nexus.config.js/.ts back (validated)
 *   GET  /admin/env                     → masked .env key/value entries
 *   PUT  /admin/env                     → update .env key/value entries
 *   GET  /admin/plugins                 → { pages, slots } contributed by plugins
 *   GET  /admin/users                   → user list (no password hashes)
 *   GET  /admin/roles                   → role catalog (grants + restrictions)
 *   PUT  /admin/users/:id               → set a user's roles (admin only)
 *   GET  /admin/metrics                 → metrics snapshot
 *   GET  /admin/payments/orders         → persisted payment orders
 *   GET  /admin/payments/transactions   → transaction log (webhook events)
 *   ... databases + schema endpoints (see databaseRoutes.ts / schemaRoutes.ts)
 */
export function registerAdminRoutes(router: Router, config: NexusConfig, deps: AdminRouteDeps): AuthService {
  const service = new AuthService(
    { secret: config.auth.jwt.secret, algorithm: 'HS256', issuer: config.auth.jwt.issuer, audience: config.auth.jwt.audience, accessTtl: config.auth.jwt.accessTtl, refreshTtl: config.auth.jwt.refreshTtl },
    // Admin only verifies access tokens (stateless); no session store needed.
    { add: () => {}, get: () => undefined, revoke: () => {}, revokeFamily: () => {} } as any,
  );
  const guard: import('@bhooai/nexus-core').Middleware[] = [authToken(service, { cookieName: config.auth.cookieName }), requireRole('admin')];
  const runtimePath = join(deps.root, 'nexus.runtime.json');

  async function readRuntime(): Promise<DeepPartial<NexusConfig>> {
    if (!existsSync(runtimePath)) return {};
    try { return JSON.parse(await readFile(runtimePath, 'utf8')) as DeepPartial<NexusConfig>; }
    catch { return {}; }
  }

  /** Redact secret-ish fields from a config snapshot before sending to the UI. */
  const PROVIDER_SECRET_KEYS = ['apiKey', 'secret', 'clientSecret', 'keySecret', 'salt', 'secretWord', 'webhookSecret'];
  function redact(cfg: NexusConfig): Record<string, any> {
    const c = JSON.parse(JSON.stringify(cfg)) as Record<string, any>;
    if (c.auth?.jwt) c.auth.jwt.secret = '***';
    if (c.payments) {
      const providers: Record<string, any> = c.payments.providers ?? c.payments;
      for (const k of Object.keys(providers ?? {})) {
        const v = providers[k];
        if (v && typeof v === 'object') {
          for (const sk of PROVIDER_SECRET_KEYS) if (v[sk]) v[sk] = '***';
        }
      }
    }
    if (c.email?.smtp) c.email.smtp.pass = c.email.smtp.pass ? '***' : undefined;
    return c;
  }

  router.get('/admin/config', async (ctx) => {
    const stored = await getProjectInfo(deps.project.name).catch(() => null);
    ctx.json({ runtime: await readRuntime(), config: redact(config), file: await userConfigFile(deps.root), project: stored ?? deps.project });
  }, guard);

  // Project registry — reads the shared project-info database so a project can
  // see its own (and every other) project's name, database and settings.
  router.get('/admin/projects', async (ctx) => {
    ctx.json({ projects: await listProjectInfo() });
  }, guard);

  router.put('/admin/config', async (ctx) => {
    const overrides = (ctx.body ?? {}) as DeepPartial<NexusConfig>;
    // Validate by merging with defaults + parsing the full schema (throws on invalid).
    mergeConfig(overrides);
    await writeTextAtomic(runtimePath, JSON.stringify(overrides, null, 2) + '\n');
    ctx.json({ ok: true, note: 'runtime overrides written — restart services to apply' });
  }, guard);

  const resolveEnvFile = (file: unknown): { fileName: string; envPath: string } => {
    const name = typeof file === 'string' && file.trim() ? file.trim() : '.env';
    if (!/^\.env(?:\.\w+)*$/.test(name)) {
      throw new Error(`unsupported environment file: ${name}`);
    }
    return { fileName: name, envPath: join(deps.root, name) };
  };

  router.get('/admin/env', async (ctx) => {
    const { fileName, envPath } = resolveEnvFile(ctx.query?.file);
    const content = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
    ctx.json({
      fileName,
      path: envPath,
      exists: existsSync(envPath),
      entries: parseEnvEntries(content),
      note: 'Secret values are masked. Send null for an unchanged masked secret.',
    });
  }, guard);

  router.put('/admin/env', async (ctx) => {
    const body = (ctx.body ?? {}) as { entries?: unknown; file?: unknown };
    let fileName: string;
    let envPath: string;
    try {
      ({ fileName, envPath } = resolveEnvFile(body.file ?? ctx.query?.file));
    } catch (error) {
      ctx.json({ error: (error as Error).message }, 400);
      return;
    }
    if (!Array.isArray(body.entries)) {
      ctx.json({ error: 'entries (array) is required' }, 400);
      return;
    }

    const entries = new Map<string, string | null>();
    for (const raw of body.entries) {
      const entry = (raw ?? {}) as { key?: unknown; value?: unknown };
      const key = typeof entry.key === 'string' ? entry.key.trim() : '';
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        ctx.json({ error: `invalid environment key: ${key || '(empty)'}` }, 400);
        return;
      }
      if (entries.has(key)) {
        ctx.json({ error: `duplicate environment key: ${key}` }, 400);
        return;
      }
      if (entry.value !== null && typeof entry.value !== 'string') {
        ctx.json({ error: `environment value must be a string or null: ${key}` }, 400);
        return;
      }
      if (entry.value === null && isSecretEnvKey(key) && !existsSync(envPath)) {
        ctx.json({ error: `a value is required for new secret key: ${key}` }, 400);
        return;
      }
      entries.set(key, entry.value as string | null);
    }

    const original = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
    let next: string;
    try {
      next = updateEnvContent(original, entries);
    } catch (error) {
      ctx.json({ error: (error as Error).message }, 400);
      return;
    }
    await writeTextAtomic(envPath, next);
    ctx.json({
      ok: true,
      fileName,
      path: envPath,
      keys: [...entries.keys()],
      note: 'Environment file saved — restart services to apply changes',
    });
  }, guard);

  /** Save the raw human-edited config file back to disk, after validating it. */
  router.put('/admin/config/file', async (ctx) => {
    const content = (ctx.body as { content?: unknown } | undefined)?.content;
    if (typeof content !== 'string') {
      ctx.json({ error: 'content (string) is required' }, 400);
      return;
    }
    const info = await userConfigFile(deps.root);
    if (!info) {
      ctx.json({ error: 'No user config file found (nexus.config.js / .ts)' }, 404);
      return;
    }
    // Write first, then validate by loading the file the same way the boot
    // loader does. On failure, roll the original content back.
    const original = info.content;
    await writeFile(info.path, content, 'utf8');
    try {
      await validateUserConfigFile(info.path, content);
      ctx.json({ ok: true, path: info.path, note: 'Saved to config file — restart services to apply' });
    } catch (e) {
      await writeFile(info.path, original, 'utf8');
      ctx.json({ error: `Config file invalid — not saved: ${(e as Error).message}` }, 400);
    }
  }, guard);

  router.get('/admin/plugins', async (ctx) => {
    ctx.json(deps.adminExtensions.toJSON());
  }, guard);

  router.get('/admin/users', async (ctx) => {
    const User = getUserModel();
    const users = await User.find({}, { passwordHash: 0 }).lean();
    ctx.json({ users });
  }, guard);

  // Role catalog — assignable roles with what each can do / is restricted from.
  router.get('/admin/roles', async (ctx) => {
    ctx.json({ roles: ROLE_CATALOG });
  }, guard);

  // Update a user's roles. Guards: valid role names, never remove the last
  // admin, and never let an admin strip their own admin role.
  router.put('/admin/users/:id', async (ctx) => {
    const body = (ctx.body ?? {}) as { roles?: unknown };
    const incoming = body.roles;
    if (!Array.isArray(incoming) || !incoming.length || incoming.some((r) => typeof r !== 'string')) {
      ctx.json({ error: 'roles (a non-empty string array) is required' }, 400);
      return;
    }
    const nextRoles = [...new Set(incoming as string[])];
    const unknown = nextRoles.filter((r) => !findRole(r));
    if (unknown.length) {
      ctx.json({ error: `unknown role(s): ${unknown.join(', ')}` }, 400);
      return;
    }

    const User = getUserModel();
    const id = String(ctx.params.id ?? '');
    let oid: import('mongodb').ObjectId;
    try { oid = new ObjectId(id); } catch { ctx.json({ error: 'invalid user id' }, 400); return; }
    const target = await User.findOne({ _id: oid }).lean();
    if (!target) {
      ctx.json({ error: 'user not found' }, 404);
      return;
    }

    const currentRoles = (target.roles ?? []) as string[];
    const isAdmin = currentRoles.includes('admin');
    const keepsAdmin = nextRoles.includes('admin');
    const caller = ctx.state.user as { id?: string; roles?: string[] } | undefined;

    if (isAdmin && !keepsAdmin) {
      const adminCount = await User.countDocuments({ roles: 'admin' });
      if (adminCount <= 1) {
        ctx.json({ error: 'cannot remove the last admin from the system' }, 400);
        return;
      }
      if (caller?.id === id) {
        ctx.json({ error: 'you cannot remove your own admin role' }, 400);
        return;
      }
    }

    await User.updateOne({ _id: oid }, { $set: { roles: nextRoles } });
    const updated = await User.findOne({ _id: oid }).lean();
    ctx.json({ ok: true, user: updated });
  }, guard);

  router.get('/admin/metrics', async (ctx) => {
    ctx.json({ metrics: deps.metrics?.() ?? {}, uptime: process.uptime(), pid: process.pid });
  }, guard);

  // Payments — persisted orders + transactions (recorded by paymentRoutes + webhooks).
  router.get('/admin/payments/orders', async (ctx) => {
    const limit = clampInt(ctx.query.limit, 100);
    const filter = providerFilter(ctx.query.provider);
    const orders = await getOrderModel().find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    ctx.json({ orders });
  }, guard);

  router.get('/admin/payments/transactions', async (ctx) => {
    const limit = clampInt(ctx.query.limit, 100);
    const filter = providerFilter(ctx.query.provider);
    const transactions = await getTransactionModel().find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    ctx.json({ transactions });
  }, guard);

  // Payments test console — per-provider status: enabled/configured from config,
  // plus a live probe via the enabled provider instance when it supports one.
  router.get('/admin/payments/status', async (ctx) => {
    const paymentsCfg = (config.payments ?? {}) as Record<string, any>;
    const results: Array<Record<string, unknown>> = [];
    for (const name of PAYMENT_PROVIDER_NAMES) {
      const pc = paymentsCfg[name] ?? {};
      const instance = deps.payments?.providers.get(name);
      const live = !!instance;
      const entry: Record<string, unknown> = {
        name,
        enabled: live || !!pc.enabled,
        sandbox: !!pc.sandbox,
        configured: PAYMENT_PROVIDER_KEYS[name].every((k) => typeof pc[k] === 'string' && (pc[k] as string).length > 0),
        live,
      };
      if (instance?.testConnection) {
        try {
          const t = await instance.testConnection();
          entry.ok = t.ok;
          entry.detail = t.detail;
          entry.error = t.error;
        } catch (e) {
          entry.ok = false;
          entry.error = (e as Error).message;
        }
      } else {
        entry.ok = live || (!!pc.enabled && entry.configured);
        entry.note = 'no public probe — create a test order to verify';
      }
      results.push(entry);
    }
    ctx.json({ checkedAt: new Date().toISOString(), providers: results });
  }, guard);

  registerDatabaseRoutes(router, guard);
  registerPreflightRoutes(router, config, guard);
  registerSchemaRoutes(
    router,
    deps.ai ?? { serverUrl: config.ai?.serverUrl ?? 'http://localhost:8000', timeoutMs: config.ai?.timeoutMs ?? 60_000, model: config.ai?.schemaModel },
    guard,
  );

  return service;
}

/** Read the nearest human-edited `nexus.config.{ts,js,mjs,cjs}` (skipping the framework default). */
async function userConfigFile(root: string): Promise<{ path: string; content: string } | null> {
  const path = discoverUserConfigPath(resolve(root), frameworkDefaultConfigPath());
  if (!path || !existsSync(path)) return null;
  return { path, content: await readFile(path, 'utf8') };
}

/**
 * Validate a config file by loading it exactly like the boot loader does:
 * dynamic `import()` for ESM (.ts/.mts/.mjs — the runtime runs under tsx), a
 * `vm` sandbox for CommonJS (.js/.cjs) so we never pollute this process's
 * require cache. Throws with a readable message when the file is broken.
 */
async function validateUserConfigFile(absPath: string, content: string): Promise<void> {
  const ext = extname(absPath);
  const cfg = await loadUserConfigFile(absPath, content, ext);
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('config file must export an object (default export, named "config", or module.exports)');
  }
  mergeConfig(cfg as DeepPartial<NexusConfig>);
}

async function loadUserConfigFile(absPath: string, content: string, ext: string): Promise<unknown> {
  if (ext === '.mjs' || ext === '.mts' || ext === '.ts') {
    // Cache-bust so a previously-imported path re-loads the new content.
    const url = `${pathToFileURL(absPath).href}?t=${Date.now()}`;
    const mod = (await import(url)) as Record<string, unknown>;
    return mod.default ?? mod.config;
  }
  // CommonJS — evaluate in a sandbox (no require cache pollution).
  const module = { exports: {} as Record<string, unknown> };
  const sandbox = {
    module,
    exports: module.exports as Record<string, unknown>,
    require: createRequire(absPath),
    __dirname: dirname(absPath),
    __filename: absPath,
    process,
    console,
  };
  const context = createContext(sandbox);
  runInContext(content, context, { filename: absPath, timeout: 3000 });
  const built = module.exports as Record<string, unknown>;
  return built.default ?? built;
}

function clampInt(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 500 ? Math.floor(n) : fallback;
}

const PAYMENT_PROVIDER_NAMES = ['razorpay', 'paypal', 'payu', 'skrill', 'payoneer'] as const;

/** Credential fields that make a provider "configured". */
const PAYMENT_PROVIDER_KEYS: Record<(typeof PAYMENT_PROVIDER_NAMES)[number], string[]> = {
  razorpay: ['keyId', 'keySecret'],
  paypal: ['clientId', 'clientSecret'],
  payu: ['merchantKey', 'salt'],
  skrill: ['merchantEmail'],
  payoneer: ['programId', 'apiKey'],
};

function providerFilter(v: unknown): { provider?: string } {
  const p = typeof v === 'string' ? v.toLowerCase().trim() : '';
  return p ? { provider: p } : {};
}

interface EnvEntry {
  key: string;
  value: string | null;
  secret: boolean;
  configPath?: string;
}

function parseEnvEntries(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1]!;
    const secret = isSecretEnvKey(key);
    entries.push({
      key,
      value: secret && match[2] ? null : decodeEnvValue(match[2]!),
      secret,
      ...(key.startsWith('NEXUS_') ? { configPath: key.slice(6).toLowerCase().replaceAll('_', '.') } : {}),
    });
  }
  return entries;
}

function updateEnvContent(content: string, entries: Map<string, string | null>): string {
  const lines = content.split(/\r?\n/);
  const seen = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const match = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      output.push(line);
      continue;
    }
    const key = match[3]!;
    const value = entries.get(key);
    seen.add(key);
    if (value === undefined) continue;
    if (value === null) {
      output.push(line);
    } else {
      output.push(`${match[1] ?? ''}${match[2] ?? ''}${key}=${encodeEnvValue(value)}`);
    }
  }

  for (const [key, value] of entries) {
    if (seen.has(key)) continue;
    if (value === null) throw new Error(`a value is required for new environment key: ${key}`);
    output.push(`${key}=${encodeEnvValue(value)}`);
  }

  while (output.length > 1 && output.at(-1) === '') output.pop();
  return `${output.join('\n')}\n`;
}

function decodeEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function encodeEnvValue(value: string): string {
  return /^[A-Za-z0-9_./:@%+\-]+$/.test(value) ? value : JSON.stringify(value);
}

function isSecretEnvKey(key: string): boolean {
  return /(SECRET|PASSWORD|PASS|TOKEN|PRIVATE|API_KEY|CLIENT_SECRET|ACCESS_KEY|KEY_SECRET)/i.test(key);
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, 'utf8');
  try {
    await rename(tempPath, path);
  } catch (error) {
    // Windows does not replace an existing file with rename(). Keep the write
    // safe while supporting the local development platform.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    await unlink(path).catch(() => undefined);
    await rename(tempPath, path);
  }
}
