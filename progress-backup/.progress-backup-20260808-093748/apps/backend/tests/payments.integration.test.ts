import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { cors, csrf, securityHeaders, AuthService, MemorySessionStore, issueCsrfToken } from '@bhooai/nexus-auth';
import { connect, getConnection } from '@bhooai/nexus-data';
import { MongoClient } from 'mongodb';
import { request } from 'node:http';
import type { NexusConfig } from '@bhooai/nexus-core';
import type { PaymentsService } from '@bhooai/nexus-payments';
import { registerAuthRoutes } from '../src/modules/auth/authRoutes.js';
import { registerPaymentRoutes } from '../src/modules/payments/paymentRoutes.js';
import { getUserModel } from '../src/modules/users/userModel.js';

const URI = (process.env.NEXUS_DB_URI ?? 'mongodb://localhost:27017/nexus').replace(/\/[^/?]*$/, '/nexus_backend_payments_test');
const TEST_DB = new URL(URI.replace(/^mongodb:/, 'http:')).pathname.slice(1);

const config = {
  server: { port: 0, host: '127.0.0.1', https: false, bodyLimit: 1_048_576, trustProxy: false },
  auth: { jwt: { secret: 'backend-test-secret-long-enough-for-hs256', accessTtl: 60, refreshTtl: 3600, issuer: 'nexus-test', audience: 'nexus-test' }, cookieName: 'nexus_sid', refreshCookieName: 'nexus_rid', requireEmailVerification: false },
  payments: { webhookPath: '/payments/webhook' },
} as unknown as NexusConfig;

let server: NexusServer;
let port: number;
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

async function freshCsrf(): Promise<string> {
  const r = await call({ path: '/csrf-token' });
  return JSON.parse(r.body).token;
}

// A fake in-process payment provider so we can exercise the checkout routes
// without hitting a real gateway. Implements the PaymentProvider surface.
const fakeOrders = new Map<string, any>();
const fakeProvider = {
  name: 'razorpay',
  async createOrder(input: any) {
    const order = { id: `ord_${fakeOrders.size + 1}`, reference: input.reference, status: 'created', amount: input.amount, currency: input.currency, raw: {} };
    fakeOrders.set(order.id, order);
    return order;
  },
  async capture(input: any) {
    const o = fakeOrders.get(input.orderId);
    if (o) { o.status = 'captured'; o.paymentId = 'pay_1'; }
    return o;
  },
  async refund() { return { id: 'ref_1', orderId: '', status: 'refunded', amount: 0, currency: 'USD', raw: {} }; },
  async getOrderStatus(id: string) { return fakeOrders.get(id); },
  async verifyWebhook() { return { provider: 'razorpay', event: 'test', verified: true, raw: {} }; },
};

// Simulates a gateway rejecting the credentials (e.g. bad Razorpay test keys).
const failingProvider = {
  name: 'paypal',
  async createOrder() { throw new Error('paypal request failed: HTTP 401'); },
  async capture() { throw new Error('paypal request failed: HTTP 401'); },
  async refund() { throw new Error('paypal request failed: HTTP 401'); },
  async getOrderStatus() { throw new Error('paypal request failed: HTTP 401'); },
  async verifyWebhook() { return { provider: 'paypal', event: 'x', verified: false }; },
};

const payments = { providers: new Map([['razorpay', fakeProvider as any], ['paypal', failingProvider as any]]), webhookRouter: (() => ({ handler: () => {} })) as any } as unknown as PaymentsService;

beforeAll(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  await client.db(TEST_DB).dropDatabase();
  await client.close();
  await connect(URI, { autoIndex: false });
  await getConnection().db;
  const router = new Router();
  const authService = new AuthService(
    { secret: config.auth.jwt.secret, algorithm: 'HS256', issuer: config.auth.jwt.issuer, audience: config.auth.jwt.audience, accessTtl: config.auth.jwt.accessTtl, refreshTtl: config.auth.jwt.refreshTtl },
    new MemorySessionStore(),
  );
  registerAuthRoutes(router, config, () => {});
  await getUserModel().createIndexes();
  registerPaymentRoutes(router, config, payments, authService);
  router.get('/csrf-token', (ctx) => ctx.json({ token: issueCsrfToken(ctx) }));
  server = new NexusServer({
    router,
    middleware: [securityHeaders(), cors({ origin: true, credentials: true }), bodyParser(), csrf({ trustedOrigins: ['http://127.0.0.1'] })],
  });
  await server.listen(0, '127.0.0.1');
  port = (server.address as any).port;
});

afterAll(async () => {
  await server?.close();
  const c = getConnection();
  if (c) await c.close?.();
});

beforeEach(async () => {
  jar.clear();
  fakeOrders.clear();
  const User = getUserModel();
  await User.deleteMany({});
});

describe('payment checkout routes (auth + CSRF)', () => {
  it('creates, captures, and reads an order', async () => {
    // register → get access token (first user is admin, but role doesn't matter here)
    const csrf = await freshCsrf();
    const reg = await call({ method: 'POST', path: '/auth/register', body: { email: 'buyer@x.com', password: 'supersecret', name: 'Buyer' }, headers: { 'x-csrf-token': csrf } });
    expect(reg.status).toBe(200);
    const accessToken = JSON.parse(reg.body).accessToken;

    const csrf2 = await freshCsrf();
    const created = await call({
      method: 'POST', path: '/payments/order',
      headers: { 'x-csrf-token': csrf2, authorization: `Bearer ${accessToken}` },
      body: { provider: 'razorpay', amount: 42, currency: 'USD' },
    });
    expect(created.status).toBe(200);
    const cdata = JSON.parse(created.body);
    expect(cdata.provider).toBe('razorpay');
    expect(cdata.order.status).toBe('created');
    expect(cdata.order.amount).toBe(42);
    const orderId = cdata.order.id;

    const csrf3 = await freshCsrf();
    const captured = await call({
      method: 'POST', path: `/payments/order/${orderId}/capture`,
      headers: { 'x-csrf-token': csrf3, authorization: `Bearer ${accessToken}` },
      body: { provider: 'razorpay' },
    });
    expect(captured.status).toBe(200);
    expect(JSON.parse(captured.body).order.status).toBe('captured');

    const status = await call({ path: `/payments/order/${orderId}?provider=razorpay`, headers: { authorization: `Bearer ${accessToken}` } });
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body).order.status).toBe('captured');
  });

  it('returns a readable 502 when a provider upstream fails', async () => {
    const csrf = await freshCsrf();
    await call({ method: 'POST', path: '/auth/register', body: { email: 'u4@x.com', password: 'supersecret' }, headers: { 'x-csrf-token': csrf } });
    const login = await call({ method: 'POST', path: '/auth/login', body: { email: 'u4@x.com', password: 'supersecret' }, headers: { 'x-csrf-token': await freshCsrf() } });
    const accessToken = JSON.parse(login.body).accessToken;

    const res = await call({
      method: 'POST', path: '/payments/order',
      headers: { 'x-csrf-token': await freshCsrf(), authorization: `Bearer ${accessToken}` },
      body: { provider: 'paypal', amount: 1, currency: 'USD' },
    });
    expect(res.status).toBe(502);
    expect(res.body).toContain('paypal order failed');
    expect(res.body).toContain('401');
  });

  it('rejects an unknown provider with 400', async () => {
    const csrf = await freshCsrf();
    await call({ method: 'POST', path: '/auth/register', body: { email: 'u2@x.com', password: 'supersecret' }, headers: { 'x-csrf-token': csrf } });
    const login = await call({ method: 'POST', path: '/auth/login', body: { email: 'u2@x.com', password: 'supersecret' }, headers: { 'x-csrf-token': await freshCsrf() } });
    const accessToken = JSON.parse(login.body).accessToken;

    const res = await call({
      method: 'POST', path: '/payments/order',
      headers: { 'x-csrf-token': await freshCsrf(), authorization: `Bearer ${accessToken}` },
      body: { provider: 'stripe', amount: 1 },
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('Unknown or disabled provider');
  });

  it('requires authentication (401 without token)', async () => {
    const res = await call({
      method: 'POST', path: '/payments/order',
      headers: { 'x-csrf-token': await freshCsrf() },
      body: { provider: 'razorpay', amount: 1 },
    });
    expect(res.status).toBe(401);
  });

  it('requires CSRF on POST (401 without x-csrf-token)', async () => {
    const csrf = await freshCsrf();
    await call({ method: 'POST', path: '/auth/register', body: { email: 'u3@x.com', password: 'supersecret' }, headers: { 'x-csrf-token': csrf } });
    const login = await call({ method: 'POST', path: '/auth/login', body: { email: 'u3@x.com', password: 'supersecret' }, headers: { 'x-csrf-token': await freshCsrf() } });
    const accessToken = JSON.parse(login.body).accessToken;

    const res = await call({
      method: 'POST', path: '/payments/order',
      headers: { origin: 'http://127.0.0.1', authorization: `Bearer ${accessToken}` },
      body: { provider: 'razorpay', amount: 1 },
    });
    expect(res.status).toBe(401);
  });
});