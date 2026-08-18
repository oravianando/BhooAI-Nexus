import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { cors, csrf, securityHeaders, rateLimit, issueCsrfToken } from '@bhooai/nexus-auth';
import { createServer, type Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerAiRoutes } from '../src/modules/ai/aiProxy.js';

// A mock Python AI server: returns canned JSON + SSE so we test the Node proxy
// re-emission without running Python.
let mockAi: Server;
let mockAiPort: number;
let backend: NexusServer;
let port: number;
const jar = new Map<string, string>();

function call(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
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
        resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Stream a response body chunk-by-chunk for SSE assertions. */
function callStream(opts: { path: string; headers: Record<string, string>; body: unknown }): Promise<{ status: number; lines: string[] }> {
  const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const headers = { 'content-type': 'application/json', origin: 'http://127.0.0.1', ...opts.headers, cookie: cookieHeader };
  const bodyStr = JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: opts.path, method: 'POST', headers }, (res) => {
      const lines: string[] = [];
      let buf = '';
      res.on('data', (c) => {
        buf += c.toString();
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
          lines.push(buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      });
      res.on('end', () => { if (buf) lines.push(buf); resolve({ status: res.statusCode ?? 0, lines }); });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

beforeAll(async () => {
  // Mock AI server.
  mockAi = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (req.url === '/chat/completions') {
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"id":"c1","model":"m","provider":"ollama","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n');
          res.write('data: {"id":"c1","model":"m","provider":"ollama","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}\n\n');
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: 'c1', model: body.model, provider: 'ollama', choices: [{ index: 0, message: { role: 'assistant', content: 'Hi there' }, finish_reason: 'stop' }], usage: { total_tokens: 4 } }));
      }
      if (req.url === '/embeddings') {
        res.writeHead(200, { 'content-type': 'application/json' });
        const n = Array.isArray(body.input) ? body.input.length : 1;
        return res.end(JSON.stringify({ model: body.model, provider: 'ollama', data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [0.1, 0.2] })), usage: { total_tokens: n } }));
      }
      if (req.url === '/models' || req.url?.startsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ provider: 'ollama', data: [{ id: 'llama3', owned_by: 'ollama' }] }));
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => mockAi.listen(0, '127.0.0.1', () => { mockAiPort = (mockAi.address() as AddressInfo).port; r(); }));

  const router = new Router();
  router.get('/csrf-token', (ctx) => ctx.json({ token: issueCsrfToken(ctx) }));
  registerAiRoutes(router, { serverUrl: `http://127.0.0.1:${mockAiPort}`, timeoutMs: 10_000 });

  backend = new NexusServer({
    router,
    middleware: [securityHeaders(), cors({ origin: true, credentials: true }), bodyParser(), csrf({ trustedOrigins: ['http://127.0.0.1'] }), rateLimit({ windowMs: 60_000, max: 1000 })],
  });
  await backend.listen(0, '127.0.0.1');
  port = (backend.address as AddressInfo).port;
});

afterAll(async () => {
  await backend.close();
  (mockAi as any).closeAllConnections?.();
  mockAi.close();
});

const freshCsrf = async () => JSON.parse((await call({ path: '/csrf-token' })).body).token as string;

describe('backend AI proxy (re-emits SSE + CSRF-enforced)', () => {
  it('proxies a non-streaming chat completion', async () => {
    const token = await freshCsrf();
    const r = await call({ method: 'POST', path: '/ai/chat/completions', headers: { 'x-csrf-token': token }, body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] } });
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.provider).toBe('ollama');
    expect(body.choices[0].message.content).toBe('Hi there');
  });

  it('re-emits the SSE stream chunk-by-chunk and terminates with [DONE]', async () => {
    const token = await freshCsrf();
    const { status, lines } = await callStream({ path: '/ai/chat/completions', headers: { 'x-csrf-token': token }, body: { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true } });
    expect(status).toBe(200);
    const dataLines = lines.filter((l) => l.startsWith('data: ')).map((l) => l.slice(6).trim());
    expect(dataLines.length).toBe(3);
    const contents = dataLines.slice(0, 2).map((d) => JSON.parse(d).choices[0].delta.content);
    expect(contents.join('')).toBe('Hi there');
    expect(dataLines[2]).toBe('[DONE]');
  });

  it('rejects a chat completion POST without a CSRF token (401)', async () => {
    jar.clear();
    const r = await call({ method: 'POST', path: '/ai/chat/completions', body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] } });
    expect(r.status).toBe(401);
  });

  it('proxies embeddings (batch)', async () => {
    const token = await freshCsrf();
    const r = await call({ method: 'POST', path: '/ai/embeddings', headers: { 'x-csrf-token': token }, body: { model: 'e', input: ['a', 'b'] } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).data).toHaveLength(2);
  });

  it('proxies GET /ai/models (no CSRF needed for GET)', async () => {
    const r = await call({ method: 'GET', path: '/ai/models' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).data[0].id).toBe('llama3');
  });
});