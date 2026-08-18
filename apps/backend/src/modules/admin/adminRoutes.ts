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
import { registerLintRoutes } from './lintProxy.js';
import { registerPreflightRoutes } from './preflightProxy.js';
import { registerClusterRoutes } from './clusterRoutes.js';
import { registerSchemaRoutes, type SchemaAIConfig } from './schemaRoutes.js';
import { ROLE_CATALOG, findRole } from './roleCatalog.js';
import { readRequestSeries, tailRequestLogs, type RequestSeriesRange } from '../requests/requestLog.js';
import { getProjectInfo, listProjectInfo, resolveProjectInfo, upsertProjectInfo, deleteProjectInfo, ObjectId, getProjectInfoCollection, type ProjectInfo } from '@bhooai/nexus-data';

export interface AdminRouteDeps {
  /** Project root — where nexus.runtime.json lives. */
  root: string;
  /** The currently-running project (identity + info-store record). Optional —
   * callers that don't run the project-info stack get a basic identity derived
   * from the root (package.json name). */
  project?: ProjectInfo;
  /** Plugin admin overrides (pages/slots). */
  adminExtensions: AdminExtensions;
  /** Optional metrics snapshot provider. */
  metrics?: () => Record<string, unknown>;
  /** AI config used by the schema-generator endpoint. */
  ai?: SchemaAIConfig;
  /** Mutable AI providers array (shared with the AI proxy so API key changes
   *  are visible without restarting). When provided, overrides config.ai.providers. */
  aiProviders?: Array<{ id: string; label: string; baseUrl: string; enabled: boolean; apiKey?: string; defaultModel?: string }>;
  /** Enabled payment providers (used by the payments test console). */
  payments?: PaymentsService;
  /** Cluster manager — shared instance for auto-start + admin control. */
  cluster?: import('@bhooai/nexus-cluster').ClusterManager;
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
    const project = deps.project ?? (await resolveProjectInfo(deps.root));
    // Prefer the stored record matched by path so a renamed project is found.
    const stored = (await listProjectInfo().catch(() => [] as ProjectInfo[])).find((p) => p.path === project.path)
      ?? (await getProjectInfo(project.name).catch(() => null));
    const pkg = await readPackageJson(deps.root);
    const resolved = stored ?? project;
    ctx.json({
      runtime: await readRuntime(),
      config: redact(config),
      file: await userConfigFile(deps.root),
      project: { ...resolved, version: pkg?.version ?? resolved.version },
    });
  }, guard);

  // Supervisor discovery — where the running `nexus dev` control API lives
  // (the port in `supervisor.json`, auto-allotted upward when 7474 is busy).
  router.get('/admin/supervisor', async (ctx) => {
    const infoPath = join(deps.root, 'supervisor.json');
    if (!existsSync(infoPath)) {
      ctx.json({ port: null, url: null, note: 'no supervisor.json — run `nexus dev` to start its control API' });
      return;
    }
    try {
      const info = JSON.parse(await readFile(infoPath, 'utf8')) as { port?: number; url?: string; writtenAt?: string };
      ctx.json({ port: info.port ?? null, url: info.url ?? null, writtenAt: info.writtenAt ?? null });
    } catch {
      ctx.json({ port: null, url: null, note: 'supervisor.json is unreadable' });
    }
  }, guard);

  // Project registry — reads the shared project-info database so a project can
  // see its own (and every other) project's name, database and settings.
  router.get('/admin/projects', async (ctx) => {
    ctx.json({ projects: await listProjectInfo() });
  }, guard);

  // PUT /admin/project — update the project's registry record (name) and/or
  // its package.json on disk (version). The physical database is not renamed.
  router.put('/admin/project', async (ctx) => {
    const body = (ctx.body ?? {}) as { name?: string; version?: string };
    const project = deps.project ?? (await resolveProjectInfo(deps.root));
    const stored = (await listProjectInfo().catch(() => [] as ProjectInfo[])).find((p) => p.path === project.path)
      ?? await getProjectInfo(project.name).catch(() => null);
    const current = stored ?? project;
    const next: ProjectInfo = { ...current };

    if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== current.name) {
      const newName = body.name.trim();
      if (!/^[\w@/. -]+$/.test(newName)) throw new Error('project name contains unsupported characters');
      const clash = (await listProjectInfo().catch(() => [] as ProjectInfo[])).find(
        (p) => p.name === newName && p.path !== current.path,
      );
      if (clash) throw new Error(`a project named "${newName}" already exists`);
      next.name = newName;
    }

    if (typeof body.version === 'string' && body.version.trim() && body.version.trim() !== (await readPackageJson(deps.root))?.version) {
      const version = body.version.trim();
      if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error(`"${version}" is not a valid semver version`);
      const pkgPath = join(deps.root, 'package.json');
      let pkg: Record<string, unknown> = {};
      try { pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>; }
      catch { throw new Error('package.json is missing or unreadable'); }
      pkg.version = version;
      await writeTextAtomic(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      next.version = version;
    }

    if (next.name !== current.name || next.version !== current.version) {
      await upsertProjectInfo(next);
      if (next.name !== current.name) await deleteProjectInfo(current.name).catch(() => {});
    }
    ctx.json({ ok: true, project: next });
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
    const pkg = await readPackageJson(deps.root);
    ctx.json({
      metrics: deps.metrics?.() ?? {},
      version: pkg?.version ?? null,
      node: process.version,
      uptime: process.uptime(),
      pid: process.pid,
    });
  }, guard);

  // HTTP request log — datewise JSON files under the project logging dir.
  const requestLogDir = join(deps.root, config.logging.dir);

  // GET /admin/requests?limit=100 → newest-first raw request entries.
  router.get('/admin/requests', async (ctx) => {
    const limit = clampInt(ctx.query.limit, 100);
    ctx.json({ requests: tailRequestLogs(requestLogDir, limit) });
  }, guard);

  // GET /admin/requests/series?range=today|5d|week|month|year → aggregated buckets.
  router.get('/admin/requests/series', async (ctx) => {
    const range = (ctx.query.range ?? 'today') as RequestSeriesRange;
    const series = readRequestSeries(requestLogDir, ['today', '5d', 'week', 'month', 'year'].includes(range) ? range : 'today');
    ctx.json({ series });
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
      const keyFields = PAYMENT_PROVIDER_KEYS[name];
      const entry: Record<string, unknown> = {
        name,
        enabled: live || !!pc.enabled,
        sandbox: !!pc.sandbox,
        configured: keyFields.every((k) => typeof pc[k] === 'string' && (pc[k] as string).length > 0),
        live,
        fields: keyFields.map((k) => ({
          field: k,
          label: PAYMENT_FIELD_LABELS[k] ?? k,
          hasValue: typeof pc[k] === 'string' && (pc[k] as string).length > 0,
        })),
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

  /** PUT /admin/payments/providers/:id — toggle a payment provider's enabled/sandbox state
   *  and/or save credential fields. Credentials (keyId/keySecret/…) are written to
   *  .env as NEXUS_PAYMENTS_<PROVIDER>_<FIELD> so they survive restarts; the
   *  enabled/sandbox state is persisted to nexus.runtime.json + MongoDB settings. */
  router.put('/admin/payments/providers/:id', async (ctx) => {
    const id = ctx.params.id;
    if (!PAYMENT_PROVIDER_NAMES.includes(id as any)) { ctx.json({ error: `unknown provider "${id}"` }, 400); return; }
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    // config is frozen at the top level (Object.freeze), so mutate the payments
    // object in place instead of reassigning config.payments.
    const paymentsCfg = (config.payments ?? {}) as Record<string, any>;
    const pc = (paymentsCfg[id] ?? {}) as Record<string, unknown>;
    if (typeof body.enabled === 'boolean') pc.enabled = body.enabled;
    if (typeof body.sandbox === 'boolean') pc.sandbox = body.sandbox;
    const savedFields: string[] = [];
    for (const field of PAYMENT_PROVIDER_KEYS[id as (typeof PAYMENT_PROVIDER_NAMES)[number]]) {
      const value = body[field];
      if (typeof value === 'string' && value.trim()) {
        pc[field] = value.trim();
        savedFields.push(field);
      }
    }
    paymentsCfg[id] = pc;
    deps.payments?.refresh(paymentsCfg);
    if (savedFields.length > 0) await writeEnvKeys(deps.root, id, pc);
    const persistence = await persistPaymentProvider(deps.root, deps.project?.name, id, pc);
    ctx.json({
      ok: true,
      persistence,
      savedFields,
      provider: {
        name: id,
        enabled: !!pc.enabled,
        sandbox: !!pc.sandbox,
        configured: PAYMENT_PROVIDER_KEYS[id as (typeof PAYMENT_PROVIDER_NAMES)[number]].every((k) => typeof pc[k] === 'string' && (pc[k] as string).length > 0),
      },
    });
  }, guard);

  registerDatabaseRoutes(router, guard);
  registerPreflightRoutes(router, config, guard);
  registerLintRoutes(router, config, deps.root, guard);
  registerClusterRoutes(router, guard, { root: deps.root, config, manager: deps.cluster });
  registerSchemaRoutes(
    router,
    deps.ai ?? { serverUrl: config.ai?.serverUrl ?? 'http://localhost:8000', timeoutMs: config.ai?.timeoutMs ?? 60_000, model: config.ai?.schemaModel, providers: deps.aiProviders ?? config.ai?.providers, root: deps.root, projectName: deps.project?.name },
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

/** Human-friendly labels for the credential fields shown in the admin dialog. */
const PAYMENT_FIELD_LABELS: Record<string, string> = {
  keyId: 'Key ID',
  keySecret: 'Key secret',
  clientId: 'Client ID',
  clientSecret: 'Client secret',
  merchantKey: 'Merchant key',
  salt: 'Salt',
  merchantEmail: 'Merchant email',
  programId: 'Program ID',
  apiKey: 'API key',
};

/** Env var name for a payment credential, e.g. razorpay.keyId → NEXUS_PAYMENTS_RAZORPAY_KEY_ID. */
function paymentEnvKey(provider: string, field: string): string {
  const snake = field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return `NEXUS_PAYMENTS_${provider.toUpperCase()}_${snake}`;
}

/** Write credential fields for a provider into the project .env (creates/updates)
 *  and sync the running process.env so the current process picks them up. */
async function writeEnvKeys(root: string, provider: string, pc: Record<string, unknown>): Promise<void> {
  const envPath = resolve(root, '.env');
  const content = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  const output = [...lines];
  for (const field of PAYMENT_PROVIDER_KEYS[provider as (typeof PAYMENT_PROVIDER_NAMES)[number]]) {
    const value = pc[field];
    if (typeof value !== 'string' || !value) continue;
    const envKey = paymentEnvKey(provider, field);
    process.env[envKey] = value;
    const regex = new RegExp(`^(\\s*export\\s+)?${envKey}\\s*=`);
    const found = output.some((line) => regex.test(line));
    if (found) {
      for (let i = 0; i < output.length; i++) {
        if (regex.test(output[i])) output[i] = `${envKey}=${value}`;
      }
    } else {
      output.push(`${envKey}=${value}`);
    }
  }
  await writeTextAtomic(envPath, `${output.join('\n')}\n`);
}

/** Persist a payment provider's enabled/sandbox state to nexus.runtime.json + MongoDB settings. */
async function persistPaymentProvider(
  root: string,
  projectName: string | undefined,
  provider: string,
  pc: Record<string, unknown>,
): Promise<{ runtime: boolean; database: boolean }> {
  const runtimeState = { enabled: !!pc.enabled, sandbox: !!pc.sandbox };
  let runtime = false;
  let database = false;
  try {
    const runtimePath = resolve(root, 'nexus.runtime.json');
    let overrides: Record<string, any> = {};
    if (existsSync(runtimePath)) {
      try { overrides = JSON.parse(await readFile(runtimePath, 'utf8')) as Record<string, any>; }
      catch { /* corrupt file — start fresh */ }
    }
    const payments = (overrides.payments ?? {}) as Record<string, any>;
    payments[provider] = { ...(payments[provider] ?? {}), ...runtimeState };
    overrides.payments = payments;
    await writeTextAtomic(runtimePath, JSON.stringify(overrides, null, 2) + '\n');
    runtime = true;
  } catch { /* surfaced via persistence flags */ }
  try {
    if (projectName) {
      const coll = await getProjectInfoCollection();
      const result = await coll.updateOne(
        { name: projectName },
        { $set: { [`settings.payments.${provider}`]: runtimeState } },
        { upsert: false },
      );
      if (result.matchedCount === 0) throw new Error(`project "${projectName}" was not found in nexus_projects`);
      database = true;
    }
  } catch { /* surfaced via persistence flags */ }
  return { runtime, database };
}

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

async function readPackageJson(root: string): Promise<{ name?: string; version?: string } | null> {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    return {
      name: typeof pkg.name === 'string' ? pkg.name : undefined,
      version: typeof pkg.version === 'string' ? pkg.version : undefined,
    };
  } catch {
    return null;
  }
}
