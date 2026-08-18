import { describe, it, expect, afterEach } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { cors, csrf, securityHeaders, rateLimit } from '../src/index.js';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';

function call(port: number, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path: opts.path ?? '/', method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function extractCookie(setCookie: string | string[] | undefined, name: string): string | undefined {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) return undefined;
  const match = new RegExp(`${name}=([^;]+)`).exec(header);
  return match?.[1];
}

describe('security: CORS', () => {
  let server: NexusServer;
  let port: number;
  afterEach(async () => server && (await server.close()));

  it('reflects origin and handles preflight with credentials', async () => {
    const router = new Router();
    router.get('/x', (ctx) => ctx.json({ ok: true }));
    server = new NexusServer({
      router,
      middleware: [cors({ origin: ['http://app.test'], credentials: true })],
    });
    await server.listen(0, '127.0.0.1');
    port = (server.address as AddressInfo).port;

    const preflight = await call(port, {
      method: 'OPTIONS',
      path: '/x',
      headers: { origin: 'http://app.test', 'access-control-request-method': 'GET' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://app.test');
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(String(preflight.headers['vary'])).toContain('Origin');

    const blocked = await call(port, { method: 'OPTIONS', path: '/x', headers: { origin: 'http://evil.test', 'access-control-request-method': 'GET' } });
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('security: CSRF', () => {
  let server: NexusServer;
  let port: number;
  afterEach(async () => server && (await server.close()));

  it('blocks unsafe requests without a matching token and allows them with one', async () => {
    const router = new Router();
    router.get('/csrf', (ctx) => ctx.json({ token: ctx.state.csrfToken }));
    router.post('/unsafe', (ctx) => ctx.json({ done: true }));
    server = new NexusServer({ router, middleware: [bodyParser(), csrf()] });
    await server.listen(0, '127.0.0.1');
    port = (server.address as AddressInfo).port;

    // 1. get a token (and its cookie)
    const tokenRes = await call(port, { path: '/csrf' });
    const token = JSON.parse(tokenRes.body).token;
    const cookie = extractCookie(tokenRes.headers['set-cookie'], 'nexus_csrf');
    expect(token).toBeDefined();
    expect(cookie).toBe(token);

    // 2. POST without token -> 401
    const blocked = await call(port, { method: 'POST', path: '/unsafe', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(blocked.status).toBe(401);

    // 3. POST with matching token + cookie -> 200
    const allowed = await call(port, {
      method: 'POST',
      path: '/unsafe',
      headers: { 'content-type': 'application/json', cookie: `nexus_csrf=${cookie}`, 'x-csrf-token': token },
      body: '{}',
    });
    expect(allowed.status).toBe(200);
    expect(JSON.parse(allowed.body)).toEqual({ done: true });
  });
});

describe('security: headers', () => {
  let server: NexusServer;
  let port: number;
  afterEach(async () => server && (await server.close()));

  it('applies helmet-equivalent headers', async () => {
    const router = new Router();
    router.get('/', (ctx) => ctx.text('ok'));
    server = new NexusServer({ router, middleware: [securityHeaders()] });
    await server.listen(0, '127.0.0.1');
    port = (server.address as AddressInfo).port;
    const res = await call(port, { path: '/' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
  });
});

describe('security: rateLimit', () => {
  let server: NexusServer;
  let port: number;
  afterEach(async () => server && (await server.close()));

  it('limits requests beyond max within the window', async () => {
    const router = new Router();
    router.get('/limited', (ctx) => ctx.text('ok'));
    server = new NexusServer({ router, middleware: [rateLimit({ windowMs: 10_000, max: 2, keyGenerator: () => 'k' })] });
    await server.listen(0, '127.0.0.1');
    port = (server.address as AddressInfo).port;
    const a = await call(port, { path: '/limited' });
    const b = await call(port, { path: '/limited' });
    const c = await call(port, { path: '/limited' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(401);
    expect(Number(c.headers['rate-limit-remaining'])).toBe(0);
  });
});