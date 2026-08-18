import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { cors, csrf, securityHeaders, rateLimit, issueCsrfToken } from '@bhooai/nexus-auth';
import { connect, getConnection } from '@bhooai/nexus-data';
import { AdminExtensions } from '@bhooai/nexus-plugins';
import { MongoClient } from 'mongodb';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NexusConfig } from '@bhooai/nexus-core';
import { registerAuthRoutes } from '../src/modules/auth/authRoutes.js';
import { registerAdminRoutes } from '../src/modules/admin/adminRoutes.js';
import { getUserModel } from '../src/modules/users/userModel.js';

const URI = (process.env.NEXUS_DB_URI ?? 'mongodb://localhost:27017/nexus').replace(/\/[^/?]*$/, '/nexus_backend_admin_test');
const TEST_DB = new URL(URI.replace(/^mongodb:/, 'http:')).pathname.slice(1);

const config = {
  server: { port: 0, host: '127.0.0.1', https: false, bodyLimit: 1_048_576, trustProxy: false },
  auth: { jwt: { secret: 'backend-test-secret-long-enough-for-hs256', accessTtl: 60, refreshTtl: 3600, issuer: 'nexus-test', audience: 'nexus-test' }, cookieName: 'nexus_sid', refreshCookieName: 'nexus_rid', requireEmailVerification: false },
} as unknown as NexusConfig;

let server: NexusServer;
let port: number;
let root: string;
const adminExt = new AdminExtensions();
const jar = new Map<string, string>();

function call(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; body: string }> {
  const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const headers = { origin: 'http://127.0.0.1', ...(opts.headers ?? {}) };
  if (cookieHeader) headers.cookie = (headers.cookie ? headers.cookie + '; ' : '') + cookieHeader;
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  if (bodyStr) headers['content-type'] = headers['content-type'] ?? 'application/json';
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: opts.path ?? '/', method: opts.method ?? 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const sc = res.headers['set-cookie'];
        if (sc) for (const c of (Array.isArray(sc) ? sc : [sc])) {
          const m = /([^=;]+)=([^;]+)/.exec(c);
          if (m) jar.set(m[1].trim(), m[2].trim());
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexus-admin-'));
  connect(URI, { autoIndex: false });
  await getConnection().db;
  const mongo = new MongoClient(URI);
  await mongo.connect();
  await mongo.db(TEST_DB).dropDatabase();
  await mongo.close();

  const router = new Router();
  router.get('/csrf-token', (ctx) => ctx.json({ token: issueCsrfToken(ctx) }));
  registerAuthRoutes(router, config);
  // Seed an admin plugin page so /admin/plugins has content.
  adminExt.registerPage('analytics', { path: '/plugins/analytics', title: 'Analytics', group: 'Insights', order: 10 });
  registerAdminRoutes(router, config, { root, adminExtensions: adminExt, metrics: () => ({ http_requests_total: 5 }) });
  await getUserModel().createIndexes();
  server = new NexusServer({
    router,
    middleware: [securityHeaders(), cors({ origin: true, credentials: true }), bodyParser(), csrf({ trustedOrigins: ['http://127.0.0.1'] }), rateLimit({ windowMs: 60_000, max: 1000 })],
  });
  await server.listen(0, '127.0.0.1');
  port = (server.address as AddressInfo).port;
});

beforeEach(async () => { jar.clear(); await getUserModel().deleteMany({}); });

afterAll(async () => { await server.close(); await getConnection().close(); });

const freshCsrf = async () => JSON.parse((await call({ path: '/csrf-token' })).body).token as string;

async function registerAndLogin(email: string, password: string): Promise<string> {
  const token = await freshCsrf();
  const reg = await call({ method: 'POST', path: '/auth/register', headers: { 'x-csrf-token': token }, body: { email, password, name: email.split('@')[0] } });
  expect(reg.status).toBe(200);
  return JSON.parse(reg.body).accessToken as string;
}

describe('backend admin routes (auth + admin role + runtime.json)', () => {
  it('first registered user is admin and can read config/plugins/users/metrics', async () => {
    const adminToken = await registerAndLogin('admin@x.com', 'supersecret');
    const auth = { authorization: `Bearer ${adminToken}` };

    const cfg = await call({ path: '/admin/config', headers: auth });
    expect(cfg.status).toBe(200);
    const cfgJson = JSON.parse(cfg.body);
    expect(cfgJson.runtime).toEqual({});
    expect(cfgJson.config.auth.jwt.secret).toBe('***'); // redacted

    const plugins = await call({ path: '/admin/plugins', headers: auth });
    expect(plugins.status).toBe(200);
    expect(JSON.parse(plugins.body).pages[0].title).toBe('Analytics');

    const users = await call({ path: '/admin/users', headers: auth });
    expect(users.status).toBe(200);
    const usersJson = JSON.parse(users.body);
    expect(usersJson.users).toHaveLength(1);
    expect(usersJson.users[0].roles).toContain('admin');
    expect(usersJson.users[0].passwordHash).toBeUndefined();

    const metrics = await call({ path: '/admin/metrics', headers: auth });
    expect(metrics.status).toBe(200);
    expect(JSON.parse(metrics.body).metrics.http_requests_total).toBe(5);
  });

  it('writes runtime overrides to nexus.runtime.json via PUT /admin/config', async () => {
    const adminToken = await registerAndLogin('admin2@x.com', 'supersecret');
    const csrf = await freshCsrf();
    const put = await call({ method: 'PUT', path: '/admin/config', headers: { authorization: `Bearer ${adminToken}`, 'x-csrf-token': csrf }, body: { server: { port: 4001 } } });
    expect(put.status).toBe(200);
    expect(JSON.parse(put.body).ok).toBe(true);
    const written = JSON.parse(await readFile(join(root, 'nexus.runtime.json'), 'utf8'));
    expect(written.server.port).toBe(4001);
  });

  it('reads and updates .env key/value entries without exposing secrets', async () => {
    const adminToken = await registerAndLogin('env-admin@x.com', 'supersecret');
    const auth = { authorization: `Bearer ${adminToken}` };
    await writeFile(join(root, '.env'), '# keep this comment\nNEXUS_SERVER_PORT=4000\nAPI_TOKEN=top-secret\nREMOVE_ME=yes\n', 'utf8');

    const get = await call({ path: '/admin/env', headers: auth });
    expect(get.status).toBe(200);
    const entries = JSON.parse(get.body).entries as Array<{ key: string; value: string | null; secret: boolean; configPath?: string }>;
    expect(entries.find((entry) => entry.key === 'API_TOKEN')).toMatchObject({ value: null, secret: true });
    expect(entries.find((entry) => entry.key === 'NEXUS_SERVER_PORT')?.configPath).toBe('server.port');

    const put = await call({
      method: 'PUT',
      path: '/admin/env',
      headers: { ...auth, 'x-csrf-token': await freshCsrf() },
      body: {
        entries: [
          { key: 'NEXUS_SERVER_PORT', value: '4100' },
          { key: 'API_TOKEN', value: null },
          { key: 'FEATURE_FLAG', value: 'true' },
        ],
      },
    });
    expect(put.status).toBe(200);
    const written = await readFile(join(root, '.env'), 'utf8');
    expect(written).toContain('# keep this comment');
    expect(written).toContain('NEXUS_SERVER_PORT=4100');
    expect(written).toContain('API_TOKEN=top-secret');
    expect(written).toContain('FEATURE_FLAG=true');
    expect(written).not.toContain('REMOVE_ME');
  });

  it('rejects an invalid config override (schema validation)', async () => {
    const adminToken = await registerAndLogin('admin3@x.com', 'supersecret');
    const csrf = await freshCsrf();
    // port must be a number; a string fails the zod schema.
    const put = await call({ method: 'PUT', path: '/admin/config', headers: { authorization: `Bearer ${adminToken}`, 'x-csrf-token': csrf }, body: { server: { port: 'not-a-number' } } });
    expect(put.status).toBe(500);
  });

  it('forbids a non-admin user (403)', async () => {
    await registerAndLogin('first@x.com', 'supersecret'); // first → admin
    // The second registration in this beforeEach is NOT admin.
    const csrf = await freshCsrf();
    const reg = await call({ method: 'POST', path: '/auth/register', headers: { 'x-csrf-token': csrf }, body: { email: 'plain@x.com', password: 'supersecret', name: 'plain' } });
    const plainToken = JSON.parse(reg.body).accessToken as string;
    const r = await call({ path: '/admin/config', headers: { authorization: `Bearer ${plainToken}` } });
    expect(r.status).toBe(403);
  });

  it('rejects an unauthenticated request (401)', async () => {
    const r = await call({ path: '/admin/config' });
    expect(r.status).toBe(401);
  });
});
