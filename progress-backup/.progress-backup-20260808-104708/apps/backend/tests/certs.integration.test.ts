import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { cors, csrf, securityHeaders, rateLimit, issueCsrfToken } from '@bhooai/nexus-auth';
import { generateKeyPair, createSelfSignedCertificate, createCsr } from '@bhooai/nexus-crypto';
import { request } from 'node:http';
import { X509Certificate, createPublicKey } from 'node:crypto';
import type { AddressInfo } from 'node:net';

let server: NexusServer;
let port: number;
const jar = new Map<string, string>();

function call(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; body: string }> {
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
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

beforeAll(async () => {
  const router = new Router();
  router.get('/csrf-token', (ctx) => ctx.json({ token: issueCsrfToken(ctx) }));
  // Mirrors the main.ts /certs/self-signed route so the test exercises the real wiring.
  router.post('/certs/self-signed', (ctx) => {
    const body = (ctx.body ?? {}) as { commonName?: string; organization?: string; country?: string; csr?: boolean };
    const kp = generateKeyPair('rsa', { modulusLength: 2048 });
    const cert = createSelfSignedCertificate({
      keyPair: { publicKey: kp.publicKey, privateKey: kp.privateKey },
      commonName: body.commonName ?? 'localhost',
      organization: body.organization,
      country: body.country,
    });
    const out: Record<string, string> = { cert: cert.pem, privateKey: kp.pem.private, publicKey: kp.pem.public };
    if (body.csr) {
      const csr = createCsr({ keyPair: { publicKey: kp.publicKey, privateKey: kp.privateKey }, commonName: body.commonName ?? 'localhost', organization: body.organization, country: body.country });
      out.csr = csr.pem;
    }
    ctx.json(out);
  });
  server = new NexusServer({
    router,
    middleware: [securityHeaders(), cors({ origin: true, credentials: true }), bodyParser(), csrf(), rateLimit({ windowMs: 60_000, max: 1000 })],
  });
  await server.listen(0, '127.0.0.1');
  port = (server.address as AddressInfo).port;
});

afterAll(async () => {
  await server.close();
});

describe('backend certs endpoint (nexus-crypto over HTTP + CSRF)', () => {
  it('generates a verifiable self-signed cert + keypair + CSR', async () => {
    const csrfToken = JSON.parse((await call({ path: '/csrf-token' })).body).token as string;
    const res = await call({
      method: 'POST',
      path: '/certs/self-signed',
      headers: { 'x-csrf-token': csrfToken },
      body: { commonName: 'api.example.com', organization: 'BhooAI', country: 'IN', csr: true },
    });
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.cert).toMatch(/BEGIN CERTIFICATE/);
    expect(out.privateKey).toMatch(/BEGIN PRIVATE KEY/);
    expect(out.publicKey).toMatch(/BEGIN PUBLIC KEY/);
    expect(out.csr).toMatch(/BEGIN CERTIFICATE REQUEST/);

    const x509 = new X509Certificate(out.cert);
    expect(x509.subject).toContain('api.example.com');
    // Self-signed: verifies against its own public key.
    expect(x509.verify(createPublicKey(out.publicKey))).toBe(true);
  });

  it('rejects POST without a CSRF token', async () => {
    const res = await call({ method: 'POST', path: '/certs/self-signed', body: { commonName: 'x' } });
    expect(res.status).toBe(401);
  });
});