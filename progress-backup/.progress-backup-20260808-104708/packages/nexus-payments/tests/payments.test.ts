import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  createPayments,
  RazorpayProvider,
  PayPalProvider,
  PayUProvider,
  SkrillProvider,
  PayoneerProvider,
  WebhookRouter,
  payuRequestHash,
  payuResponseHash,
  hmacSha256Hex,
  sha512Hex,
  md5Hex,
  type HttpTransport,
  type HttpRequest,
  type HttpResponse,
} from '../src/index.js';

/** Build a mock transport that routes by URL substring to canned handlers. */
function mockTransport(routes: { match: string; respond: (req: HttpRequest) => HttpResponse }[]): HttpTransport {
  return async (req) => {
    for (const r of routes) {
      if (req.url.includes(r.match)) return r.respond(req);
    }
    return { status: 404, body: JSON.stringify({ error: `no mock for ${req.url}` }) };
  };
}

/** A capturing transport: records calls, delegates to an inner transport. */
function capturing(inner: HttpTransport): { transport: HttpTransport; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  return {
    calls,
    transport: async (req) => {
      calls.push(req);
      return inner(req);
    },
  };
}

describe('signature helpers', () => {
  it('hmacSha256Hex matches node crypto', () => {
    expect(hmacSha256Hex('secret', 'msg')).toBe(
      createHmac('sha256', 'secret').update('msg').digest('hex'),
    );
  });
  it('sha512Hex matches node crypto', () => {
    expect(sha512Hex('abc')).toBe(createHash('sha512').update('abc').digest('hex'));
  });
  it('md5Hex matches node crypto', () => {
    expect(md5Hex('abc')).toBe(createHash('md5').update('abc').digest('hex'));
  });
  it('PayU request hash joins 10 udf fields + salt', () => {
    const h = payuRequestHash('KEY', 'SALT', {
      txnid: 't1', amount: '10.00', productinfo: 'pi', firstname: 'fn', email: 'e@x.com', udf: ['', '', '', '', '', '', '', '', '', ''],
    });
    // Equals sha512 of the exact 17-field pipe-joined sequence (10 udf fields).
    const manual = sha512Hex(['KEY', 't1', '10.00', 'pi', 'fn', 'e@x.com', '', '', '', '', '', '', '', '', '', '', 'SALT'].join('|'));
    expect(h).toBe(manual);
    // And it's stable (deterministic).
    expect(h).toHaveLength(128);
  });
});

describe('RazorpayProvider', () => {
  const cfg = { enabled: true, sandbox: true, keyId: 'rzp_key', keySecret: 'rzp_secret', webhookSecret: 'wh_secret' };
  function provider(routes: { match: string; respond: (req: HttpRequest) => HttpResponse }[]) {
    return new RazorpayProvider(cfg as any, mockTransport(routes));
  }

  it('creates an order (paise conversion + status mapping)', async () => {
    const p = provider([{ match: '/orders', respond: () => ({ status: 200, body: JSON.stringify({ id: 'order_123', status: 'created', amount: 1000, currency: 'INR', receipt: 'ref1' }) }) }]);
    const order = await p.createOrder({ amount: 10, currency: 'INR', reference: 'ref1' });
    expect(order.id).toBe('order_123');
    expect(order.status).toBe('created');
    expect(order.amount).toBe(10);
    expect(order.reference).toBe('ref1');
  });

  it('verifies a webhook with a valid HMAC signature', async () => {
    const p = provider([]);
    const raw = JSON.stringify({ event: 'payment.captured', payload: { x: 1 } });
    const sig = hmacSha256Hex('wh_secret', raw);
    const ev = await p.verifyWebhook({ rawBody: raw, headers: { 'x-razorpay-signature': sig } });
    expect(ev.verified).toBe(true);
    expect(ev.event).toBe('payment.captured');
  });

  it('rejects a tampered signature', async () => {
    const p = provider([]);
    const ev = await p.verifyWebhook({ rawBody: '{"a":1}', headers: { 'x-razorpay-signature': 'deadbeef' } });
    expect(ev.verified).toBe(false);
  });

  it('maps paid + failed order statuses', async () => {
    const p = provider([
      { match: '/orders/paid', respond: () => ({ status: 200, body: JSON.stringify({ id: 'paid', status: 'paid', amount: 1000, currency: 'INR' }) }) },
      { match: '/orders/failed', respond: () => ({ status: 200, body: JSON.stringify({ id: 'failed', status: 'failed', amount: 1000, currency: 'INR' }) }) },
    ]);
    expect((await p.getOrderStatus('paid')).status).toBe('paid');
    expect((await p.getOrderStatus('failed')).status).toBe('failed');
  });
});

describe('PayPalProvider', () => {
  const cfg = { enabled: true, sandbox: true, clientId: 'cid', clientSecret: 'csec', webhookId: 'wh-1' };
  function provider(routes: { match: string; respond: (req: HttpRequest) => HttpResponse }[]) {
    const t = mockTransport(routes);
    const cap = capturing(t);
    return { p: new PayPalProvider(cfg as any, cap.transport), calls: cap.calls };
  }

  it('caches the OAuth2 token across calls', async () => {
    const { p, calls } = provider([
      { match: '/oauth2/token', respond: () => ({ status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }) },
      { match: '/v2/checkout/orders', respond: () => ({ status: 200, body: JSON.stringify({ id: 'o1', status: 'CREATED', links: [{ rel: 'approve', href: 'https://approve' }] }) }) },
    ]);
    await p.createOrder({ amount: 10, currency: 'USD', reference: 'r1' });
    await p.createOrder({ amount: 20, currency: 'USD', reference: 'r2' });
    const tokenCalls = calls.filter((c) => c.url.includes('/oauth2/token')).length;
    expect(tokenCalls).toBe(1); // token reused
  });

  it('createOrder returns the approve URL', async () => {
    const { p } = provider([
      { match: '/oauth2/token', respond: () => ({ status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }) },
      { match: '/v2/checkout/orders', respond: () => ({ status: 200, body: JSON.stringify({ id: 'o1', status: 'CREATED', links: [{ rel: 'approve', href: 'https://approve' }] }) }) },
    ]);
    const order = await p.createOrder({ amount: 10, currency: 'USD', reference: 'r1' });
    expect(order.paymentUrl).toBe('https://approve');
    expect(order.status).toBe('created');
  });

  it('capture maps COMPLETED', async () => {
    const { p } = provider([
      { match: '/oauth2/token', respond: () => ({ status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }) },
      { match: '/capture', respond: () => ({ status: 200, body: JSON.stringify({ id: 'o1', status: 'COMPLETED', purchase_units: [{ reference_id: 'r1', payments: { captures: [{ id: 'cap1', amount: { value: '10.00', currency_code: 'USD' } }] } }] }) }) },
    ]);
    const order = await p.capture({ orderId: 'o1' });
    expect(order.status).toBe('captured');
    expect(order.paymentId).toBe('cap1');
    expect(order.amount).toBe(10);
  });

  it('verifies a webhook via the verify-webhook-signature API', async () => {
    const { p } = provider([
      { match: '/oauth2/token', respond: () => ({ status: 200, body: JSON.stringify({ access_token: 'tok', expires_in: 3600 }) }) },
      { match: '/verify-webhook-signature', respond: () => ({ status: 200, body: JSON.stringify({ verification_status: 'SUCCESS' }) }) },
    ]);
    const ev = await p.verifyWebhook({
      rawBody: JSON.stringify({ event_type: 'CHECKOUT.ORDER.APPROVED' }),
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://cert',
        'paypal-transmission-id': 't1',
        'paypal-transmission-sig': 'sig',
        'paypal-transmission-time': '2024-01-01',
      },
    });
    expect(ev.verified).toBe(true);
    expect(ev.event).toBe('CHECKOUT.ORDER.APPROVED');
  });
});

describe('PayUProvider', () => {
  const cfg = { enabled: true, sandbox: true, merchantKey: 'KEY', salt: 'SALT' };
  const p = new PayUProvider(cfg as any, mockTransport([]));

  it('createOrder builds a checkout URL + request hash', async () => {
    const order = await p.createOrder({ amount: 10, currency: 'INR', reference: 't1', description: 'pi', customer: { name: 'fn', email: 'e@x.com' } });
    expect(order.paymentUrl).toContain('test.payu.in');
    const params = order.raw as Record<string, string>;
    const expected = payuRequestHash('KEY', 'SALT', { txnid: 't1', amount: '10.00', productinfo: 'pi', firstname: 'fn', email: 'e@x.com', udf: ['', '', '', '', '', '', '', '', '', ''] });
    expect(params.hash).toBe(expected);
  });

  it('verifies a well-formed response hash, rejects a tampered one', async () => {
    const fields = { status: 'success', txnid: 't1', amount: '10.00', productinfo: 'pi', firstname: 'fn', email: 'e@x.com' };
    const udf = ['', '', '', '', '', '', '', '', '', ''];
    const goodHash = payuResponseHash('KEY', 'SALT', { ...fields, udf });
    const goodBody = `status=success&txnid=t1&amount=10.00&productinfo=pi&firstname=fn&email=e%40x.com&hash=${goodHash}`;
    const ev = await p.verifyWebhook({ rawBody: goodBody, headers: {} });
    expect(ev.verified).toBe(true);
    expect(ev.event).toBe('payment.success');

    const badBody = `status=failed&txnid=t1&amount=10.00&productinfo=pi&firstname=fn&email=e%40x.com&hash=${goodHash}`;
    const ev2 = await p.verifyWebhook({ rawBody: badBody, headers: {} });
    expect(ev2.verified).toBe(false);
  });
});

describe('SkrillProvider', () => {
  const cfg = { enabled: true, sandbox: true, merchantEmail: 'mer@x.com', secretWord: 'sekret' };
  const p = new SkrillProvider(cfg as any, mockTransport([]));

  it('createOrder builds a pay.skrill.com URL', async () => {
    const order = await p.createOrder({ amount: 10, currency: 'EUR', reference: 't1' });
    expect(order.paymentUrl).toContain('https://pay.skrill.com/');
    expect(order.paymentUrl).toContain('pay_to_email=mer%40x.com');
    expect(order.paymentUrl).toContain('amount=10.00');
  });

  it('verifies md5sig (uppercase), rejects tampered', async () => {
    const fields = { mb_transaction_id: 't1', amount: '10.00', currency: 'EUR' };
    const sig = md5Hex(`mer@x.comsekrett110.00EUR`).toUpperCase();
    const body = `mb_transaction_id=t1&amount=10.00&currency=EUR&md5sig=${sig}&status=2`;
    const ev = await p.verifyWebhook({ rawBody: body, headers: {} });
    expect(ev.verified).toBe(true);

    const body2 = `mb_transaction_id=t1&amount=99.00&currency=EUR&md5sig=${sig}&status=2`;
    const ev2 = await p.verifyWebhook({ rawBody: body2, headers: {} });
    expect(ev2.verified).toBe(false);
  });
});

describe('PayoneerProvider', () => {
  const cfg = { enabled: true, sandbox: true, programId: 'prog1', apiKey: 'apiK', webhookSecret: 'wh' };
  const p = new PayoneerProvider(cfg as any, mockTransport([]));

  it('createOrder signs the canonical query', async () => {
    const order = await p.createOrder({ amount: 10, currency: 'USD', reference: 'r1' });
    const params = order.raw as Record<string, string>;
    // canonical = sorted(query without signature) ; signature = hmac(apiKey, canonical)
    const sorted = Object.entries(params).filter(([k]) => k !== 'signature').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
    expect(params.signature).toBe(hmacSha256Hex('apiK', sorted));
  });

  it('verifies the HMAC webhook signature, rejects tampered', async () => {
    const raw = JSON.stringify({ event: 'payment.completed', amount: 10 });
    const sig = hmacSha256Hex('wh', raw);
    const ev = await p.verifyWebhook({ rawBody: raw, headers: { 'x-payoneer-signature': sig } });
    expect(ev.verified).toBe(true);
    const ev2 = await p.verifyWebhook({ rawBody: raw + 'x', headers: { 'x-payoneer-signature': sig } });
    expect(ev2.verified).toBe(false);
  });
});

describe('WebhookRouter + createPayments factory', () => {
  it('createPayments only instantiates enabled providers', () => {
    const svc = createPayments({
      razorpay: { enabled: true, sandbox: true, keyId: 'k', keySecret: 's' },
      paypal: { enabled: false, sandbox: true, clientId: '', clientSecret: '' },
    });
    expect([...svc.providers.keys()]).toEqual(['razorpay']);
    expect(() => svc.get('paypal')).toThrow();
    expect(svc.get('razorpay').name).toBe('razorpay');
  });

  it('webhook router dispatches verified events and ACKs 200', async () => {
    const fakeProvider = {
      name: 'fake',
      async createOrder() { return {} as any; },
      async capture() { return {} as any; },
      async refund() { return {} as any; },
      async getOrderStatus() { return {} as any; },
      async verifyWebhook() { return { verified: true, event: 'payment.captured', provider: 'fake' }; },
    };
    const providers = new Map([['fake', fakeProvider as any]]);
    let received: string | undefined;
    const router = new WebhookRouter(providers, (ev) => { received = ev.event; });
    let sentStatus = 0; let sentBody: unknown;
    await router.handler({
      params: { provider: 'fake' },
      headers: {},
      body: '{}',
      state: {},
      json(data, status) { sentStatus = status ?? 200; sentBody = data; },
    } as any);
    expect(received).toBe('payment.captured');
    expect(sentStatus).toBe(200);
    expect((sentBody as { ok: boolean }).ok).toBe(true);
  });

  it('webhook router returns 401 on bad signature', async () => {
    const fakeProvider = { name: 'fake', async verifyWebhook() { return { verified: false, provider: 'fake' }; }, async createOrder() { return {} as any; }, async capture() { return {} as any; }, async refund() { return {} as any; }, async getOrderStatus() { return {} as any; } };
    const router = new WebhookRouter(new Map([['fake', fakeProvider as any]]), () => {});
    let sentStatus = 0;
    await router.handler({ params: { provider: 'fake' }, headers: {}, body: '', state: {}, json: (_d, s) => { sentStatus = s ?? 200; } } as any);
    expect(sentStatus).toBe(401);
  });

  it('webhook router returns 404 for unknown provider', async () => {
    const router = new WebhookRouter(new Map(), () => {});
    let sentStatus = 0;
    await router.handler({ params: { provider: 'nope' }, headers: {}, body: '', state: {}, json: (_d, s) => { sentStatus = s ?? 200; } } as any);
    expect(sentStatus).toBe(404);
  });
});