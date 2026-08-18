import { test, expect, type APIRequestContext } from '@playwright/test';

// Cross-service happy path against the REAL backend (booted in globalSetup):
// health → CSRF → register (first user = admin) → /me → GraphQL query
// → payments error path. The Playwright `request` fixture keeps a cookie
// jar, so the HttpOnly CSRF cookie from GET /csrf-token rides along to POSTs.
//
// CSRF note: the backend's trustedOrigins is non-empty by default, so every
// unsafe method MUST carry an Origin header (checkOrigin) AND the double-submit
// x-csrf-token matching the cookie. APIRequestContext doesn't send Origin, so
// we add it explicitly — same reason the vitest integration tests do.

const E2E_PORT = Number(process.env.NEXUS_E2E_PORT ?? 4199);
const ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

// Windows occasionally refuses a fresh socket to 127.0.0.1 even while the
// server is up (the very next request succeeds). The window can be ~1-2s in a
// tight test loop, so retry transient connection errors with backoff rather
// than letting a flaky single attempt fail the whole suite.
function isTransient(err: unknown): boolean {
  const msg = String((err as Error).message ?? err);
  return /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up/i.test(msg);
}
async function send<T>(
  request: APIRequestContext,
  fn: () => Promise<T>,
  attempts = 12,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isTransient(err)) throw err;
      await new Promise((r) => setTimeout(r, Math.min(200 * i, 1000)));
    }
  }
}

async function csrfToken(request: APIRequestContext): Promise<string> {
  const r = await send(request, () => request.get('/csrf-token'));
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token;
}

test.describe('Nexus cross-service e2e', () => {
  test('health + CSRF are available', async ({ request }) => {
    const health = await request.get('/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });
    const csrf = await csrfToken(request);
    expect(typeof csrf).toBe('string');
    expect(csrf.length).toBeGreaterThan(0);
  });

  test('register → me → GraphQL (first user is admin)', async ({ request }) => {
    const csrf = await csrfToken(request);
    const email = `e2e_${Date.now()}@x.com`;
    const reg = await send(request, () => request.post('/auth/register', {
      headers: { origin: ORIGIN, 'x-csrf-token': csrf },
      data: { email, password: 'supersecret', name: 'E2E' },
    }));
    expect(reg.status()).toBe(200);
    const regBody = await reg.json();
    expect(regBody.user.roles).toEqual(['admin']);
    const accessToken = regBody.accessToken;
    expect(accessToken).toBeTruthy();

    const me = await send(request, () => request.get('/auth/me', { headers: { authorization: `Bearer ${accessToken}` } }));
    expect(me.ok()).toBeTruthy();
    expect((await me.json()).user.email).toBe(email);

    const csrf2 = await csrfToken(request);
    const gql = await send(request, () => request.post('/graphql', {
      headers: { origin: ORIGIN, 'x-csrf-token': csrf2, authorization: `Bearer ${accessToken}` },
      data: { query: `{ me { id email roles } }` },
    }));
    expect(gql.ok()).toBeTruthy();
    const gbody = await gql.json();
    expect(gbody.errors).toBeUndefined();
    expect(gbody.data.me.email).toBe(email);
    expect(gbody.data.me.roles).toEqual(['admin']);

    const users = await send(request, () => request.post('/graphql', {
      headers: { origin: ORIGIN, 'x-csrf-token': csrf2, authorization: `Bearer ${accessToken}` },
      data: { query: `{ users(limit: 5) { id email } }` },
    }));
    const ubody = await users.json();
    expect(ubody.data.users.length).toBeGreaterThan(0);
  });

  test('CSRF is enforced on unsafe methods', async ({ request }) => {
    // POST /auth/register with Origin but NO x-csrf-token → 401 (double-submit fail).
    const res = await send(request, () => request.post('/auth/register', {
      headers: { origin: ORIGIN },
      data: { email: 'no-csrf@x.com', password: 'supersecret' },
    }));
    expect(res.status()).toBe(401);
  });

  test('payments order rejects an unknown provider', async ({ request }) => {
    const csrf = await csrfToken(request);
    const reg = await send(request, () => request.post('/auth/register', {
      headers: { origin: ORIGIN, 'x-csrf-token': csrf },
      data: { email: `pay_${Date.now()}@x.com`, password: 'supersecret' },
    }));
    const accessToken = (await reg.json()).accessToken;
    const payCsrf = await csrfToken(request);

    const res = await send(request, () => request.post('/payments/order', {
      headers: { origin: ORIGIN, 'x-csrf-token': payCsrf, authorization: `Bearer ${accessToken}` },
      data: { provider: 'stripe', amount: 10 },
    }));
    expect(res.status()).toBe(400);
    const body = await res.text();
    expect(body).toContain('Unknown or disabled provider');
  });

  test('payments order requires auth', async ({ request }) => {
    const csrf = await csrfToken(request);
    const res = await send(request, () => request.post('/payments/order', {
      headers: { origin: ORIGIN, 'x-csrf-token': csrf },
      data: { provider: 'razorpay', amount: 10 },
    }));
    expect(res.status()).toBe(401);
  });
});