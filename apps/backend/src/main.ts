import { dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadConfigAuto, Router, NexusServer, bodyParser, serveStatic, registerUploadRoutes } from '@bhooai/nexus-core';
import { cors, csrf, securityHeaders, rateLimit, issueCsrfToken, AuthService, MemorySessionStore } from '@bhooai/nexus-auth';
import { Logger, MetricsRegistry } from '@bhooai/nexus-telemetry';
import {
  connect,
  getConnection,
  resolveProjectInfo,
  connectProjectInfo,
  getProjectInfo,
  listProjectInfo,
  upsertProjectInfo,
  closeProjectInfo,
  type ProjectInfo,
} from '@bhooai/nexus-data';
import { RealtimeServer } from '@bhooai/nexus-realtime';
import { createGateway, graphqlHttpHandler, SubscriptionServer, PubSub, type GraphQLContext } from '@bhooai/nexus-graphql';
import { Cache } from '@bhooai/nexus-cache';
import { createEmail, TemplateEngine } from '@bhooai/nexus-email';
import { createPayments } from '@bhooai/nexus-payments';
import { generateKeyPair, createSelfSignedCertificate, createCsr } from '@bhooai/nexus-crypto';
import { ClusterManager } from '@bhooai/nexus-cluster';
import { registerAuthRoutes } from './modules/auth/authRoutes.js';
import { buildUsersSubgraph } from './modules/users/userGraph.js';
import { loadPlugins } from './plugins/loadPlugins.js';
import { registerAiRoutes } from './modules/ai/aiProxy.js';
import { registerAdminRoutes } from './modules/admin/adminRoutes.js';
import { registerPaymentRoutes } from './modules/payments/paymentRoutes.js';
import { recordTransaction } from './modules/payments/paymentStore.js';
import { appendRequestLog, closeRequestLog } from './modules/requests/requestLog.js';

// Keep project-relative config and runtime directories tied to this app tree,
// not to the directory from which the backend command was launched.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * BhooAI Nexus backend bootstrap (Phase 5 checkpoint).
 *
 * Boots an inbuilt HTTP server with the security stack applied:
 * security headers → CORS → body parsing → CSRF → rate limiting.
 * Connects to MongoDB, registers the User model, mounts /auth/* routes,
 * and serves a single-subgraph GraphQL gateway over HTTP (/graphql) and
 * WebSocket subscriptions (/graphql/ws). Realtime (/ws) runs alongside.
 */
async function main(): Promise<void> {
  const config = await loadConfigAuto({ root: PROJECT_ROOT });
  const log = new Logger({
    level: config.logging.level,
    format: config.logging.format,
    console: config.logging.console,
    redact: ['password', 'secret', 'authorization'],
  });

  // Each project owns its own database (named from its package.json). The
  // default connection targets that database; a second connection targets the
  // shared project-info store (nexus_projects) for name + settings.
  const project: ProjectInfo = await resolveProjectInfo(PROJECT_ROOT);
  const dbName = config.db.name ?? project.dbName;

  connect(config.db.uri, { name: dbName, autoIndex: config.db.autoIndex });
  await getConnection().db;
  connectProjectInfo(config.db.uri, { autoIndex: config.db.autoIndex });
  const allProjects = await listProjectInfo();
  // Prefer the record matched by path so a project renamed via the admin panel
  // keeps its identity (and settings) across restarts.
  const storedProject = allProjects.find((p) => p.path === PROJECT_ROOT) ?? (await getProjectInfo(project.name).catch(() => null));
  const configuredAiProviders = (config.ai.providers ?? []).map((provider) => ({
    id: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
  }));
  await upsertProjectInfo({
    ...project,
    dbName,
    status: 'running',
    startedAt: new Date().toISOString(),
    version: storedProject?.version ?? await readPackageVersion(PROJECT_ROOT),
    settings: {
      ...(storedProject?.settings ?? {}),
      env: config.env,
      host: config.server.host,
      port: config.server.port,
      graphqlPath: config.graphql.path,
      websocketPath: config.ws.path,
      database: dbName,
      ...(!storedProject?.settings?.aiProviders && configuredAiProviders.length > 0
        ? { aiProviders: configuredAiProviders }
        : {}),
    },
  });
  log.info('connected to MongoDB', { project: project.name, db: dbName });

  // One AuthService shared by realtime + GraphQL context (token verification
  // is stateless; the session store is only used for login/refresh flows).
  const authService = new AuthService(
    { secret: config.auth.jwt.secret, algorithm: 'HS256', issuer: config.auth.jwt.issuer, audience: config.auth.jwt.audience, accessTtl: config.auth.jwt.accessTtl, refreshTtl: config.auth.jwt.refreshTtl },
    new MemorySessionStore(),
  );

  const router = new Router();
  const uploadsDir = join(PROJECT_ROOT, config.uploads.dir);

  // Multipart uploads are persisted beneath the project-local /uploads folder.
  // Filenames are generated by the framework; the public path is read-only.
  registerUploadRoutes(router, {
    directory: uploadsDir,
    path: config.uploads.path,
    publicPath: config.uploads.path,
    maxFileSize: config.uploads.maxFileSize,
    maxFiles: config.uploads.maxFiles,
    allowedTypes: config.uploads.allowedTypes,
  });

  // Health check (no CSRF, no rate limit — always available).
  router.get('/health', (ctx) => {
    ctx.json({ status: 'ok', env: config.env, time: Date.now() });
  });

  // CSRF token endpoint — mints a double-submit token cookie + returns it.
  router.get('/csrf-token', (ctx) => {
    const token = issueCsrfToken(ctx, { trustedOrigins: trustedOrigins(config) });
    ctx.json({ token });
  });

  // A sample unsafe route to demonstrate CSRF enforcement.
  router.post('/echo', (ctx) => {
    ctx.json({ received: ctx.body });
  });

  // Auth routes (register/login/refresh/logout/me + OAuth). Requires DB.
  registerAuthRoutes(router, config, () => pubsub.publish('USER_COUNT', 1));

  // Create a mutable copy of the AI providers array so the admin provider
  // management endpoints can mutate API keys / enabled state in-place, and
  // the AI proxy sees the updates without restarting. The config is frozen
  // (Object.freeze) so we must clone before passing to both routes.
  const aiProviders = (config.ai.providers ?? []).map((p) => ({ ...p }));

  // AI proxy — mounts /ai/* OpenAI-compatible routes that re-emit SSE from the
  // Python AI server. The browser never calls Python directly.
  registerAiRoutes(router, {
    serverUrl: config.ai.serverUrl,
    timeoutMs: config.ai.timeoutMs,
    // Pass the mutable array — same reference the admin endpoints mutate.
    providers: aiProviders,
  });

  // GraphQL: single-subgraph gateway over the users subgraph. The context
  // builder verifies the optional Bearer access token so `me` can resolve.
  const usersSubgraph = buildUsersSubgraph();
  const gateway = createGateway({ subgraph: usersSubgraph });
  // PubSub feeds the GraphQL `userCount` subscription (published on register).
  const pubsub = new PubSub();
  const graphContext = async (ctx: import('@bhooai/nexus-core').RequestContext): Promise<GraphQLContext> => {
    const auth = ctx.headers['authorization'];
    const header = Array.isArray(auth) ? auth[0] : auth;
    const token = header && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (token) {
      try {
        const claims = await authService.verifyAccessToken(token);
        return { request: ctx, user: { sub: claims.sub, roles: claims.roles ?? [], sid: claims.sid }, pubsub };
      } catch { /* invalid token → anonymous */ }
    }
    return { request: ctx, pubsub };
  };
  router.post(config.graphql.path, graphqlHttpHandler({ gateway, introspection: config.graphql.introspection, context: graphContext }));
  router.get(config.graphql.path, graphqlHttpHandler({ gateway, introspection: config.graphql.introspection, context: graphContext }));

  // Phase 7 services — cache (lazy Redis), email (log provider in dev), payments
  // webhook router (no providers enabled unless keys are configured), and a
  // cert/CSR generation endpoint backed by nexus-crypto (hand-rolled DER for CSRs).
  const cache = new Cache({ url: config.redis.url, keyPrefix: config.redis.keyPrefix });

  const templates = new TemplateEngine();
  templates.register('welcome', '<h1>Welcome, {{name}}!</h1><p>Verify your email to get started.</p>');
  const email = createEmail(config.email, { templates });

  const payments = createPayments(config.payments);
  const webhookRouter = payments.webhookRouter((ev) => {
    log.info('payment webhook event', { provider: ev.provider, event: ev.event, verified: ev.verified });
    // Persist every verified webhook event as a transaction (admin dashboard).
    if (ev.provider && ev.event) {
      recordTransaction(ev.provider, ev).catch((err) => log.warn('failed to record payment transaction', { msg: err.message }));
    }
  });
  if (config.payments.webhookPath) {
    router.post(config.payments.webhookPath, webhookRouter.handler);
  }
  // Phase 11 — browser-facing checkout routes (auth-guarded). Webhooks stay separate.
  registerPaymentRoutes(router, config, payments, authService);

  // Generate a self-signed cert + keypair (and optionally a CSR) on demand.
  router.post('/certs/self-signed', (ctx) => {
    const body = (ctx.body ?? {}) as { commonName?: string; organization?: string; country?: string; csr?: boolean };
    const kp = generateKeyPair(config.certs.keyType, {
      modulusLength: config.certs.rsaModulus,
      namedCurve: config.certs.ecCurve,
    });
    const cert = createSelfSignedCertificate({
      keyPair: { publicKey: kp.publicKey, privateKey: kp.privateKey },
      commonName: body.commonName ?? 'localhost',
      organization: body.organization,
      country: body.country,
    });
    const out: Record<string, string> = { cert: cert.pem, privateKey: kp.pem.private, publicKey: kp.pem.public };
    if (body.csr) {
      const csr = createCsr({
        keyPair: { publicKey: kp.publicKey, privateKey: kp.privateKey },
        commonName: body.commonName ?? 'localhost',
        organization: body.organization,
        country: body.country,
      });
      out.csr = csr.pem;
    }
    ctx.json(out);
  });

  const docsDir = join(PROJECT_ROOT, 'docs');

  const server = new NexusServer({
    router,
    bodyLimit: config.server.bodyLimit,
    middleware: [
      securityHeaders(),
      cors({ origin: true, credentials: true }),
      serveStatic(uploadsDir, { prefix: config.uploads.path }),
      serveStatic(docsDir, { prefix: '/docs' }),
      bodyParser(config.server.bodyLimit),
      csrf({ trustedOrigins: trustedOrigins(config) }),
      rateLimit({ windowMs: 60_000, max: 300 }),
    ],
    onError: (err, ctx) => {
      log.warn('request error', { code: err.code, path: ctx.path, method: ctx.method, msg: err.message });
      return { error: { code: err.code, message: err.message } };
    },
  });

  // Realtime (WebSocket) server: auth via access token on upgrade, optional
  // CSRF origin/double-submit check. Reuses the shared authService.
  const realtime = new RealtimeServer({
    httpServer: server.httpServer,
    path: config.ws.path,
    authService,
    csrfOptions: config.ws.requireCsrf ? { trustedOrigins: trustedOrigins(config) } : undefined,
  });

  // GraphQL subscriptions over WebSocket (graphql-transport-ws), on a path
  // under the GraphQL route. Auth via the shared authService.
  const subscriptions = new SubscriptionServer({
    httpServer: server.httpServer,
    gateway,
    path: `${config.graphql.path}/ws`,
    authService,
    context: (_init, user) => ({ user, pubsub }),
  });

  // Phase 8 — plugins: build real HostBindings from the running services,
  // discover plugins from the configured dir, and run their lifecycle in
  // dependency order before the server accepts traffic. Exposes the admin
  // extensions (pages/slots contributed by plugins) at /plugins/extensions.
  const pluginsDir = join(PROJECT_ROOT, config.plugins.dir);
  const configByPlugin: Record<string, unknown> = {};
  for (const entry of config.plugins.entries) {
    if (entry.enabled) configByPlugin[entry.path] = entry.config ?? {};
  }
  const plugins = await loadPlugins({
    router,
    log,
    realtime,
    pluginsDir,
    configByPlugin,
  });
  router.get('/plugins/extensions', (ctx) => {
    ctx.json(plugins.adminExtensions.toJSON());
  });

  // Admin endpoints — bearer-token auth + 'admin' role (first registered user
  // is bootstrapped admin). Edits write to nexus.runtime.json (gitignored).
  const metrics = new MetricsRegistry();
  metrics.counter('http_requests_total', 'Total HTTP requests');
  const requestLogDir = join(PROJECT_ROOT, config.logging.dir);
  // Count every HTTP request so the admin overview "HTTP REQUESTS" stat reflects
  // live traffic, and append each completed request (with IP, url, referer etc.)
  // to a datewise JSON log file under the project's logging dir.
  server.use((ctx, next) => {
    metrics.inc('http_requests_total', 1, { method: ctx.method });
    const started = Date.now();
    ctx.res.on('finish', () => {
      const headers = ctx.headers as Record<string, string | string[] | undefined>;
      const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
      const forwarded = first(headers['x-forwarded-for'])?.split(',')[0]?.trim();
      appendRequestLog(requestLogDir, {
        time: started,
        method: ctx.method,
        path: ctx.path,
        url: ctx.req.url,
        status: ctx.res.statusCode,
        durationMs: Date.now() - started,
        ip: forwarded || ctx.req.socket.remoteAddress,
        referer: first(headers['referer']),
        userAgent: first(headers['user-agent']),
        origin: first(headers['origin']),
        requestId: ctx.requestId,
        route: ctx.routePattern,
      });
    });
    return next();
  });

  // Cluster manager — auto-starts the LB + autoscaler when config says enabled.
  const cluster = new ClusterManager({ config: config.cluster, root: PROJECT_ROOT, aiServerUrl: config.ai.serverUrl, self: { id: 'master', baseUrl: `http://127.0.0.1:${config.server.port}` } });
  if (config.cluster.enabled) {
    try {
      await cluster.listenLb(config.cluster.lbHost);
      cluster.autoscaler.start(10_000);
      log.info(`cluster LB listening on ${config.cluster.lbHost}:${config.cluster.lbPort} (auto-started)`);
    } catch (err) {
      log.warn(`cluster failed to auto-start: ${(err as Error).message}`);
    }
  }

  registerAdminRoutes(router, config, { root: PROJECT_ROOT, project, adminExtensions: plugins.adminExtensions, metrics: () => metrics.toJSON(), payments, cluster, aiProviders });

  await server.listen(config.server.port, config.server.host);
  log.info(`Nexus backend listening on http://${config.server.host}:${config.server.port}`, {
    graphql: config.graphql.path,
    ws: config.ws.path,
  });

  const shutdown = async (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    await plugins.host.stop();
    plugins.scheduler.close();
    await subscriptions.close();
    await realtime.close();
    await server.close();
    await cluster.close();
    await closeProjectInfo();
    await getConnection().close();
    await cache.close();
    closeRequestLog();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function trustedOrigins(config: Awaited<ReturnType<typeof loadConfig>>): string[] {
  const loopback = ['localhost', '127.0.0.1'];
  const origins: string[] = [];
  for (const host of loopback) {
    for (const port of [config.server.port, config.frontend.port, config.admin.port]) {
      origins.push(`http://${host}:${port}`);
    }
  }
  return origins;
}

async function readPackageVersion(root: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
