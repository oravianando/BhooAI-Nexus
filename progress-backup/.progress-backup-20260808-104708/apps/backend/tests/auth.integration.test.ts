import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { cors, csrf, securityHeaders, rateLimit, issueCsrfToken } from '@bhooai/nexus-auth';
import { connect, getConnection } from '@bhooai/nexus-data';
import { MongoClient } from 'mongodb';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NexusConfig } from '@bhooai/nexus-core';
import { registerAuthRoutes } from '../src/modules/auth/authRoutes.js';
import { getUserModel } from '../src/modules/users/userModel.js';

const URI = (process.env.NEXUS_DB_URI ?? 'mongodb://localhost:27017/nexus').replace(/\/[^/?]*$/, '/nexus_backend_test');
const TEST_DB = new URL(URI.replace(/^mongodb:/, 'http:')).pathname.slice(1);

const config = {
  server: { port: 0, host: '127.0.0.1', https: false, bodyLimit: 1_048_576, trustProxy: false },
  auth: {
    jwt: { secret: 'backend-test-secret-long-enough-for-hs256', accessTtl: 60, refreshTtl: 3600, issuer: 'nexus-test', audience: 'nexus-test' },
    cookieName: 'nexus_sid',
    refreshCookieName: 'nexus_rid',
    requireEmailVerification: false,
  },
} as unknown as NexusConfig;

let server: NexusServer;
let port: number;
const jar = new Map<string, string>(); // simple cookie jar

function call(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const headers = { ...(opts.headers ?? {}) };
  if (cookieHeader) headers.cookie = (headers.cookie ? headers.cookie + '; ' : '') + cookieHeader;
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  if (bodyStr) headers['content-type'] = headers['content-type'] ?? 'application/json';
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: opts.path ?? '/', method: opts.method ?? 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        // capture set-cookie into the jar
        const sc = res.headers['set-cookie'];
        if (sc) for (const c of (Array.isArray(sc) ? sc : [sc])) {
          const m = /([^=;]+)=([^;]+)/.exec(c);
          if (m) jar.set(m[1].trim(), m[2].trim());
        }
        resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

beforeAll(async () => {
  connect(URI, { autoIndex: false });
  await getConnection().db;
  // clean slate
  const mongo = new MongoClient(URI);
  await mongo.connect();
  await mongo.db(TEST_DB).dropDatabase();
  await mongo.close();

  const router = new Router();
  router.get('/csrf-token', (ctx) => ctx.json({ token: issueCsrfToken(ctx) }));
  registerAuthRoutes(router, config);
  await getUserModel().createIndexes(); // ensure unique index is ready (awaited, not fire-and-forget)
  server = new NexusServer({
    router,
    middleware: [securityHeaders(), cors({ origin: true, credentials: true }), bodyParser(), csrf(), rateLimit({ windowMs: 60_000, max: 1000 })],
  });
  await server.listen(0, '127.0.0.1');
  port = (server.address as AddressInfo).port;
});

beforeEach(async () => {
  jar.clear();
  await getUserModel().deleteMany({});
});

afterAll(async () => {
  await server.close();
  await getConnection().close();
});

describe('backend auth integration (real Mongo + CSRF + live server)', () => {
  // GETs rotate the CSRF cookie, so fetch a fresh token immediately before each unsafe POST.
  const freshCsrf = async () => JSON.parse((await call({ path: '/csrf-token' })).body).token as string;

  it('registers, reads /me, refreshes, and logs out', async () => {
    // 1. obtain a CSRF token (sets nexus_csrf cookie)
    const token = await freshCsrf();
    expect(token).toBeTruthy();

    // 2. register
    const reg = await call({ method: 'POST', path: '/auth/register', headers: { 'x-csrf-token': token }, body: { email: 'Alice@Example.com', password: 'supersecret', name: 'Alice' } });
    expect(reg.status).toBe(200);
    const regJson = JSON.parse(reg.body);
    expect(regJson.user.email).toBe('alice@example.com'); // transform lowercased
    expect(regJson.user.passwordHash).toBeUndefined(); // never leaked
    expect(regJson.accessToken).toBeTruthy();

    // 3. /me with the access token (bearer)
    const me = await call({ path: '/auth/me', headers: { authorization: `Bearer ${regJson.accessToken}` } });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.body).user.email).toBe('alice@example.com');

    // 4. refresh (cookie jar carries nexus_rid)
    const refresh = await call({ method: 'POST', path: '/auth/refresh', headers: { 'x-csrf-token': await freshCsrf() }, body: {} });
    expect(refresh.status).toBe(200);
    expect(JSON.parse(refresh.body).accessToken).toBeTruthy();

    // 5. logout
    const out = await call({ method: 'POST', path: '/auth/logout', headers: { 'x-csrf-token': await freshCsrf() }, body: {} });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).ok).toBe(true);
  });

  it('rejects login with wrong password (401)', async () => {
    const csrfRes = await call({ path: '/csrf-token' });
    const token = JSON.parse(csrfRes.body).token;
    await call({ method: 'POST', path: '/auth/register', headers: { 'x-csrf-token': token }, body: { email: 'bob@x.com', password: 'correctpass', name: 'Bob' } });

    // fresh CSRF for the next unsafe request
    const csrf2 = await call({ path: '/csrf-token' });
    const token2 = JSON.parse(csrf2.body).token;
    const bad = await call({ method: 'POST', path: '/auth/login', headers: { 'x-csrf-token': token2 }, body: { email: 'bob@x.com', password: 'wrongpass' } });
    expect(bad.status).toBe(401);
  });

  it('rejects duplicate registration (409)', async () => {
    const csrfRes = await call({ path: '/csrf-token' });
    const token = JSON.parse(csrfRes.body).token;
    await call({ method: 'POST', path: '/auth/register', headers: { 'x-csrf-token': token }, body: { email: 'dup@x.com', password: 'supersecret', name: 'D' } });
    const csrf2 = await call({ path: '/csrf-token' });
    const token2 = JSON.parse(csrf2.body).token;
    const dup = await call({ method: 'POST', path: '/auth/register', headers: { 'x-csrf-token': token2 }, body: { email: 'dup@x.com', password: 'supersecret', name: 'D2' } });
    expect(dup.status).toBe(409);
  });

  it('blocks unsafe requests without a CSRF token (401)', async () => {
    const blocked = await call({ method: 'POST', path: '/auth/register', body: { email: 'x@x.com', password: 'supersecret' } });
    expect(blocked.status).toBe(401);
  });
});