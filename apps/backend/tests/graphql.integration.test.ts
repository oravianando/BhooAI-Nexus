import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { cors, csrf, securityHeaders, rateLimit, issueCsrfToken, AuthService, MemorySessionStore } from '@bhooai/nexus-auth';
import { connect, getConnection } from '@bhooai/nexus-data';
import { createGateway, graphqlHttpHandler, type GraphQLContext } from '@bhooai/nexus-graphql';
import { MongoClient } from 'mongodb';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NexusConfig, RequestContext } from '@bhooai/nexus-core';
import { registerAuthRoutes } from '../src/modules/auth/authRoutes.js';
import { getUserModel } from '../src/modules/users/userModel.js';
import { buildUsersSubgraph } from '../src/modules/users/userGraph.js';

// Distinct DB from auth.integration.test.ts so the two files can run concurrently
// without their beforeEach `deleteMany({})` racing each other's fixtures.
const URI = (process.env.NEXUS_DB_URI ?? 'mongodb://localhost:27017/nexus').replace(/\/[^/?]*$/, '/nexus_backend_gql_test');
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

const authService = new AuthService(
  { secret: config.auth.jwt.secret, algorithm: 'HS256', issuer: config.auth.jwt.issuer, audience: config.auth.jwt.audience, accessTtl: config.auth.jwt.accessTtl, refreshTtl: config.auth.jwt.refreshTtl },
  new MemorySessionStore(),
);

let server: NexusServer;
let port: number;
const jar = new Map<string, string>();

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
  const mongo = new MongoClient(URI);
  await mongo.connect();
  await mongo.db(TEST_DB).dropDatabase();
  await mongo.close();

  const router = new Router();
  router.get('/csrf-token', (ctx) => ctx.json({ token: issueCsrfToken(ctx) }));
  registerAuthRoutes(router, config);

  const gateway = createGateway({ subgraph: buildUsersSubgraph() });
  const graphContext = async (ctx: RequestContext): Promise<GraphQLContext> => {
    const auth = ctx.headers['authorization'];
    const header = Array.isArray(auth) ? auth[0] : auth;
    const token = header && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (token) {
      try {
        const claims = await authService.verifyAccessToken(token);
        return { request: ctx, user: { sub: claims.sub, roles: claims.roles ?? [], sid: claims.sid } };
      } catch { /* anonymous */ }
    }
    return { request: ctx };
  };
  router.post('/graphql', graphqlHttpHandler({ gateway, context: graphContext }));
  router.get('/graphql', graphqlHttpHandler({ gateway, context: graphContext }));

  await getUserModel().createIndexes();
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

describe('backend graphql integration (single subgraph over real Mongo + CSRF)', () => {
  const freshCsrf = async () => JSON.parse((await call({ path: '/csrf-token' })).body).token as string;

  async function registerAndLogin(email: string, password: string): Promise<string> {
    const token = await freshCsrf();
    const reg = await call({ method: 'POST', path: '/auth/register', headers: { 'x-csrf-token': token }, body: { email, password, name: email.split('@')[0] } });
    expect(reg.status).toBe(200);
    return JSON.parse(reg.body).accessToken as string;
  }

  async function gql(query: string, accessToken?: string): Promise<any> {
    const csrf = await freshCsrf();
    const headers: Record<string, string> = { 'x-csrf-token': csrf };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const res = await call({ method: 'POST', path: '/graphql', headers, body: { query } });
    return JSON.parse(res.body);
  }

  it('resolves `me` for an authenticated user via the users subgraph', async () => {
    const token = await registerAndLogin('alice@x.com', 'supersecret');
    const r = await gql(`{ me { id email name roles } }`, token);
    expect(r.errors).toBeUndefined();
    expect(r.data.me.email).toBe('alice@x.com');
    expect(r.data.me.name).toBe('alice');
    expect(r.data.me.roles).toEqual(['admin']); // first registered user is bootstrapped as admin
    expect(r.data.me.passwordHash).toBeUndefined();
  });

  it('returns null for `me` when unauthenticated', async () => {
    const r = await gql(`{ me { id email } }`);
    expect(r.errors).toBeUndefined();
    expect(r.data.me).toBeNull();
  });

  it('lists users via `users` query', async () => {
    await registerAndLogin('a@x.com', 'supersecret');
    await registerAndLogin('b@x.com', 'supersecret');
    const r = await gql(`{ users { id email } }`);
    expect(r.errors).toBeUndefined();
    expect(r.data.users.length).toBe(2);
  });

  it('resolves a user by id via the `user` query', async () => {
    const token = await registerAndLogin('carol@x.com', 'supersecret');
    const me = await gql(`{ me { id } }`, token);
    const id = me.data.me.id;
    const r = await gql(`{ user(id: "${id}"){ email } }`);
    expect(r.errors).toBeUndefined();
    expect(r.data.user.email).toBe('carol@x.com');
  });

  it('serves introspection when enabled', async () => {
    const r = await gql(`{ __schema { queryType { name } mutationType { name } } }`);
    expect(r.errors).toBeUndefined();
    expect(r.data.__schema.queryType.name).toBe('Query');
  });
});