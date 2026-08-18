import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { cors, csrf, securityHeaders, rateLimit, issueCsrfToken } from '@bhooai/nexus-auth';
import { connect, getConnection } from '@bhooai/nexus-data';
import type { AiClient } from '@bhooai/nexus-ai-client';
import type { PaymentsService } from '@bhooai/nexus-payments';
import { AdminExtensions } from '@bhooai/nexus-plugins';
import { MongoClient } from 'mongodb';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NexusConfig } from '@bhooai/nexus-core';
import { registerAuthRoutes } from '../src/modules/auth/authRoutes.js';
import { registerAdminRoutes } from '../src/modules/admin/adminRoutes.js';
import { getUserModel } from '../src/modules/users/userModel.js';
import { getOrderModel, getTransactionModel } from '../src/modules/payments/paymentStore.js';

const URI = (process.env.NEXUS_DB_URI ?? 'mongodb://localhost:27017/nexus').replace(/\/[^/?]*$/, '/nexus_backend_admin_features_test');
const TEST_DB = new URL(URI.replace(/^mongodb:/, 'http:')).pathname.slice(1);
const FEATURES_DB = 'nexus_admin_features_test_db';

const config = {
  server: { port: 0, host: '127.0.0.1', https: false, bodyLimit: 1_048_576, trustProxy: false },
  auth: { jwt: { secret: 'backend-test-secret-long-enough-for-hs256', accessTtl: 60, refreshTtl: 3600, issuer: 'nexus-test', audience: 'nexus-test' }, cookieName: 'nexus_sid', refreshCookieName: 'nexus_rid', requireEmailVerification: false },
  payments: {
    razorpay: { enabled: true, sandbox: true, keyId: 'rk_test', keySecret: 'sk_test' },
    paypal: { enabled: true, sandbox: true, clientId: 'client_id', clientSecret: 'client_secret' },
    payu: { enabled: true, sandbox: true, merchantKey: 'mk', salt: 'salt' },
    skrill: { enabled: false, merchantEmail: '' },
    payoneer: { enabled: false, programId: '', apiKey: '' },
  },
} as unknown as NexusConfig;

/** Stub providers: razorpay probes OK, paypal auth fails — no network touched. */
const stubPayments = {
  providers: new Map<string, unknown>([
    ['razorpay', { name: 'razorpay', testConnection: async () => ({ ok: true, detail: 'authenticated; 0 order(s) in the first page' }) }],
    ['paypal', { name: 'paypal', testConnection: async () => { throw new Error('paypal request failed: HTTP 401'); } }],
  ]),
} as unknown as PaymentsService;

let server: NexusServer;
let port: number;
let root: string;
const adminExt = new AdminExtensions();
const jar = new Map<string, string>();

let aiChat: (req: { model: string; messages: unknown[] }) => Promise<unknown> = async () => {
  throw new Error('no AI stub configured');
};
const stubAI = {
  serverUrl: 'http://127.0.0.1:1',
  timeoutMs: 1000,
  client: { chat: async (req: { model: string; messages: unknown[] }) => aiChat(req) } as unknown as AiClient,
};

function call(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; body: string }> {
  const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const headers: Record<string, string> = { origin: 'http://127.0.0.1', ...(opts.headers ?? {}) };
  if (cookieHeader) headers.cookie = cookieHeader;
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
  root = await mkdtemp(join(tmpdir(), 'nexus-admin-features-'));
  connect(URI, { autoIndex: false });
  await getConnection().db;
  const mongo = new MongoClient(URI);
  await mongo.connect();
  await mongo.db(TEST_DB).dropDatabase();
  await mongo.db(FEATURES_DB).dropDatabase();
  await mongo.close();

  const router = new Router();
  router.get('/csrf-token', (ctx) => ctx.json({ token: issueCsrfToken(ctx) }));
  registerAuthRoutes(router, config);
  registerAdminRoutes(router, config, { root, adminExtensions: adminExt, ai: stubAI, payments: stubPayments });
  await getUserModel().createIndexes();
  server = new NexusServer({
    router,
    middleware: [securityHeaders(), cors({ origin: true, credentials: true }), bodyParser(), csrf({ trustedOrigins: ['http://127.0.0.1'] }), rateLimit({ windowMs: 60_000, max: 1000 })],
  });
  await server.listen(0, '127.0.0.1');
  port = (server.address as AddressInfo).port;
});

beforeEach(async () => {
  jar.clear();
  await getUserModel().deleteMany({});
});

afterAll(async () => {
  const mongo = new MongoClient(URI);
  await mongo.connect();
  await mongo.db(TEST_DB).dropDatabase();
  await mongo.db(FEATURES_DB).dropDatabase();
  await mongo.close();
  await server.close();
  await getConnection().close();
});

const freshCsrf = async () => JSON.parse((await call({ path: '/csrf-token' })).body).token as string;

async function loginAdmin(email = 'features-admin@x.com'): Promise<string> {
  const token = await freshCsrf();
  const reg = await call({ method: 'POST', path: '/auth/register', headers: { 'x-csrf-token': token }, body: { email, password: 'supersecret', name: email.split('@')[0] } });
  expect(reg.status).toBe(200);
  return JSON.parse(reg.body).accessToken as string;
}

describe('admin config file (nexus.config.js)', () => {
  it('reports null file when no user config exists', async () => {
    const tok = await loginAdmin('cfg-null@x.com');
    const r = await call({ path: '/admin/config', headers: { authorization: `Bearer ${tok}` } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).file).toBeNull();
  });

  it('exposes the config file content and saves back after validating', async () => {
    const tok = await loginAdmin('cfg-file@x.com');
    const auth = { authorization: `Bearer ${tok}` };
    await writeFile(join(root, 'nexus.config.js'), 'module.exports = { env: "development" };\n', 'utf8');

    const get = await call({ path: '/admin/config', headers: auth });
    const got = JSON.parse(get.body);
    expect(got.file).not.toBeNull();
    expect(got.file.path).toContain('nexus.config.js');
    expect(got.file.content).toContain('module.exports');

    const csrf = await freshCsrf();
    const put = await call({
      method: 'PUT', path: '/admin/config/file',
      headers: { ...auth, 'x-csrf-token': csrf },
      body: { content: 'module.exports = { server: { port: 4242 } };\n' },
    });
    expect(put.status).toBe(200);
    expect(JSON.parse(put.body).ok).toBe(true);
    expect(await readFile(join(root, 'nexus.config.js'), 'utf8')).toContain('port: 4242');
  });

  it('rejects an invalid config file and rolls the content back', async () => {
    const tok = await loginAdmin('cfg-rollback@x.com');
    const csrf = await freshCsrf();
    const put = await call({
      method: 'PUT', path: '/admin/config/file',
      headers: { authorization: `Bearer ${tok}`, 'x-csrf-token': csrf },
      body: { content: 'this is not valid javascript {' },
    });
    expect(put.status).toBe(400);
    expect(JSON.parse(put.body).error).toMatch(/invalid/i);
    // Original content preserved after the failed write.
    expect(await readFile(join(root, 'nexus.config.js'), 'utf8')).toContain('port: 4242');
  });
});

describe('admin payments (orders + transactions)', () => {
  it('lists persisted orders and transactions', async () => {
    const tok = await loginAdmin('pay-admin@x.com');
    const auth = { authorization: `Bearer ${tok}` };
    await getOrderModel().create({
      provider: 'stripe', orderId: 'ord_123', reference: 'nx_ref_1', status: 'paid',
      amount: 12.5, currency: 'USD', description: 'test order',
    });
    await getTransactionModel().create({
      provider: 'stripe', event: 'payment.captured', verified: true,
      orderId: 'ord_123', paymentId: 'pay_9', amount: 12.5, currency: 'USD', status: 'success',
    });

    const orders = await call({ path: '/admin/payments/orders', headers: auth });
    expect(orders.status).toBe(200);
    const os = JSON.parse(orders.body).orders;
    expect(os).toHaveLength(1);
    expect(os[0].orderId).toBe('ord_123');
    expect(os[0].status).toBe('paid');

    const transactions = await call({ path: '/admin/payments/transactions', headers: auth });
    expect(transactions.status).toBe(200);
    const ts = JSON.parse(transactions.body).transactions;
    expect(ts).toHaveLength(1);
    expect(ts[0].event).toBe('payment.captured');
    expect(ts[0].verified).toBe(true);
  });

  it('filters orders and transactions by provider', async () => {
    const tok = await loginAdmin('pay-filter@x.com');
    const auth = { authorization: `Bearer ${tok}` };
    await getOrderModel().create({ provider: 'paypal', orderId: 'ord_paypal', reference: 'r1', status: 'created', amount: 1, currency: 'USD' });
    await getOrderModel().create({ provider: 'razorpay', orderId: 'ord_rzp', reference: 'r2', status: 'paid', amount: 2, currency: 'USD' });
    await getTransactionModel().create({ provider: 'paypal', event: 'payment.captured', verified: true, orderId: 'ord_paypal' });

    const orders = JSON.parse((await call({ path: '/admin/payments/orders?provider=paypal', headers: auth })).body).orders;
    expect(orders).toHaveLength(1);
    expect(orders[0].orderId).toBe('ord_paypal');

    const ts = JSON.parse((await call({ path: '/admin/payments/transactions?provider=paypal', headers: auth })).body).transactions;
    expect(ts).toHaveLength(1);
    expect(ts[0].provider).toBe('paypal');
  });

  it('reports per-provider status with live probe results', async () => {
    const tok = await loginAdmin('pay-status@x.com');
    const r = await call({ path: '/admin/payments/status', headers: { authorization: `Bearer ${tok}` } });
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.checkedAt).toBeTruthy();
    const byName = Object.fromEntries((body.providers as Array<Record<string, unknown>>).map((p) => [p.name, p]));

    // razorpay: enabled + probe succeeded.
    expect(byName.razorpay.enabled).toBe(true);
    expect(byName.razorpay.configured).toBe(true);
    expect(byName.razorpay.ok).toBe(true);
    expect(String(byName.razorpay.detail)).toContain('authenticated');

    // paypal: enabled but the probe throws (bad credentials).
    expect(byName.paypal.enabled).toBe(true);
    expect(byName.paypal.ok).toBe(false);
    expect(String(byName.paypal.error)).toContain('401');

    // payu: enabled + keys present, no public probe → reported ok with a note.
    expect(byName.payu.ok).toBe(true);
    expect(String(byName.payu.note)).toContain('test order');

    // skrill: disabled → red.
    expect(byName.skrill.enabled).toBe(false);
    expect(byName.skrill.configured).toBe(false);
    expect(byName.skrill.ok).toBe(false);
  });
});

describe('admin databases (create / rename / delete)', () => {
  it('creates and lists a database, then manages collections', async () => {
    const tok = await loginAdmin('db-admin@x.com');
    const auth = { authorization: `Bearer ${tok}` };

    const create = await call({
      method: 'POST', path: '/admin/databases',
      headers: { ...auth, 'x-csrf-token': await freshCsrf() }, body: { name: FEATURES_DB },
    });
    expect(create.status).toBe(200);
    expect(JSON.parse(create.body).ok).toBe(true);

    const list = await call({ path: '/admin/databases', headers: auth });
    const names = (JSON.parse(list.body).databases as Array<{ name: string }>).map((d) => d.name);
    expect(names).toContain(FEATURES_DB);

    // Create a collection with a validator.
    const coll = await call({
      method: 'POST', path: `/admin/databases/${FEATURES_DB}/collections`,
      headers: { ...auth, 'x-csrf-token': await freshCsrf() },
      body: {
        name: 'products',
        jsonSchema: { bsonType: 'object', required: ['name', 'price'], properties: { name: { bsonType: 'string' }, price: { bsonType: 'int' } } },
      },
    });
    expect(coll.status).toBe(200);
    expect(JSON.parse(coll.body).validator).toBeTruthy();

    // Insert a valid doc so the docs endpoint has content.
    const mongo = new MongoClient(URI);
    await mongo.connect();
    await mongo.db(FEATURES_DB).collection('products').insertOne({ name: 'widget', price: 9 });
    await mongo.close();

    const docs = await call({ path: `/admin/databases/${FEATURES_DB}/collections/products/docs`, headers: auth });
    expect(docs.status).toBe(200);
    expect(JSON.parse(docs.body).count).toBe(1);

    // Rename the collection.
    const rename = await call({
      method: 'PUT', path: `/admin/databases/${FEATURES_DB}/collections/products`,
      headers: { ...auth, 'x-csrf-token': await freshCsrf() }, body: { newName: 'catalog' },
    });
    expect(rename.status).toBe(200);

    const after = await call({ path: `/admin/databases/${FEATURES_DB}/collections/catalog/docs`, headers: auth });
    expect(JSON.parse(after.body).count).toBe(1);

    // Drop collection then database.
    const dropColl = await call({
      method: 'DELETE', path: `/admin/databases/${FEATURES_DB}/collections/catalog`,
      headers: { ...auth, 'x-csrf-token': await freshCsrf() },
    });
    expect(dropColl.status).toBe(200);

    const dropDb = await call({
      method: 'DELETE', path: `/admin/databases/${FEATURES_DB}`,
      headers: { ...auth, 'x-csrf-token': await freshCsrf() },
    });
    expect(dropDb.status).toBe(200);
    const list2 = await call({ path: '/admin/databases', headers: auth });
    expect((JSON.parse(list2.body).databases as Array<{ name: string }>).map((d) => d.name)).not.toContain(FEATURES_DB);
  });

  it('rejects malformed database names', async () => {
    const tok = await loginAdmin('db-bad@x.com');
    const csrf = await freshCsrf();
    const r = await call({
      method: 'POST', path: '/admin/databases',
      headers: { authorization: `Bearer ${tok}`, 'x-csrf-token': csrf }, body: { name: 'bad..name' },
    });
    expect(r.status).toBe(400);
  });
});

describe('admin AI schema generation', () => {
  it('rejects a missing prompt (400)', async () => {
    const tok = await loginAdmin('schema-no-prompt@x.com');
    const csrf = await freshCsrf();
    const r = await call({
      method: 'POST', path: '/admin/schemas/generate',
      headers: { authorization: `Bearer ${tok}`, 'x-csrf-token': csrf }, body: {},
    });
    expect(r.status).toBe(400);
  });

  it('returns a parsed schema when the AI reply is well-formed', async () => {
    const tok = await loginAdmin('schema-ok@x.com');
    const csrf = await freshCsrf();
    aiChat = async () => ({
      model: 'stub',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify({
          collection: 'products',
          fields: [
            { name: 'name', type: 'String', required: true },
            { name: 'price', type: 'Number', required: true },
          ],
          jsonSchema: { $jsonSchema: { bsonType: 'object', required: ['name', 'price'], properties: { name: { bsonType: 'string' }, price: { bsonType: 'double' } } } },
        }) },
        finish_reason: 'stop',
      }],
    });
    const r = await call({
      method: 'POST', path: '/admin/schemas/generate',
      headers: { authorization: `Bearer ${tok}`, 'x-csrf-token': csrf }, body: { prompt: 'products with name and price' },
    });
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.collection).toBe('products');
    expect(body.fields).toHaveLength(2);
    expect(body.jsonSchema.$jsonSchema.required).toContain('price');
  });

  it('returns 502 when the AI upstream fails', async () => {
    const tok = await loginAdmin('schema-fail@x.com');
    const csrf = await freshCsrf();
    aiChat = async () => { throw new Error('upstream unreachable'); };
    const r = await call({
      method: 'POST', path: '/admin/schemas/generate',
      headers: { authorization: `Bearer ${tok}`, 'x-csrf-token': csrf }, body: { prompt: 'anything' },
    });
    expect(r.status).toBe(502);
  });
});