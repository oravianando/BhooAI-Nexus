import { describe, it, expect, afterEach } from 'vitest';
import { Router, NexusServer, bodyParser, parseUrlEncoded, parseMultipart, registerUploadRoutes, serveStatic } from '../src/index.js';
import { request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function getJson(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method ?? 'GET', headers: opts.headers },
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

describe('Router', () => {
  it('matches static routes and extracts params', () => {
    const r = new Router();
    r.get('/users/:id', (ctx) => ctx.json({ id: ctx.params.id }));
    const m = r.match('GET', '/users/42');
    expect(m).not.toBeNull();
    expect(m!.params.id).toBe('42');
  });

  it('matches wildcards', () => {
    const r = new Router();
    r.get('/assets/*', (ctx) => ctx.text('ok'));
    expect(r.match('GET', '/assets/a/b.css')).not.toBeNull();
    expect(r.match('GET', '/other/x')).toBeNull();
  });

  it('returns 405 handler when method mismatches but path matches', () => {
    const r = new Router();
    r.post('/items', () => undefined);
    const m = r.match('GET', '/items');
    expect(m).not.toBeNull();
  });

  it('decodes URI-encoded params', () => {
    const r = new Router();
    r.get('/q/:term', () => undefined);
    expect(r.match('GET', '/q/hello%20world')!.params.term).toBe('hello world');
  });
});

describe('bodyParser', () => {
  it('parses urlencoded', () => {
    expect(parseUrlEncoded('a=1&b=hi%20there&b=2')).toEqual({ a: '1', b: ['hi there', '2'] });
  });

  it('parses multipart fields and files', () => {
    const boundary = '----testboundary';
    const body = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="title"\r\n\r\n' +
        'Hello\r\n' +
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="upload"; filename="f.txt"\r\n' +
        'Content-Type: text/plain\r\n\r\n' +
        'file contents\r\n' +
        `--${boundary}--\r\n`,
    );
    const { fields, files } = parseMultipart(body, boundary);
    expect(fields.title).toBe('Hello');
    expect(files[0]?.filename).toBe('f.txt');
    expect(files[0]?.data.toString('utf8')).toBe('file contents');
  });
});

describe('NexusServer end-to-end', () => {
  let server: NexusServer;
  let port: number;

  afterEach(async () => {
    if (server) await server.close();
  });

  it('routes a request and returns JSON', async () => {
    const router = new Router();
    router.get('/health', (ctx) => ctx.json({ ok: true }));
    server = new NexusServer({ router, middleware: [bodyParser()] });
    await server.listen(0, '127.0.0.1');
    port = (server.address as import('node:net').AddressInfo).port;
    const res = await getJson(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('parses a JSON POST body', async () => {
    const router = new Router();
    router.post('/echo', (ctx) => ctx.json({ received: ctx.body }));
    server = new NexusServer({ router, middleware: [bodyParser()] });
    await server.listen(0, '127.0.0.1');
    port = (server.address as import('node:net').AddressInfo).port;
    const res = await getJson(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: 'hi' }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: { msg: 'hi' } });
  });

  it('returns 404 for unknown routes and 405 for wrong method', async () => {
    const router = new Router();
    router.post('/only', () => undefined);
    server = new NexusServer({ router });
    await server.listen(0, '127.0.0.1');
    port = (server.address as import('node:net').AddressInfo).port;
    const notFound = await getJson(`http://127.0.0.1:${port}/nope`);
    expect(notFound.status).toBe(404);
    const wrong = await getJson(`http://127.0.0.1:${port}/only`);
    expect(wrong.status).toBe(405);
    expect(wrong.headers['allow']).toBe('POST');
  });

  it('stores multipart uploads and serves them below a URL prefix', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-uploads-'));
    const boundary = '----nexus-upload-test';
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="hello.txt"\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      'hello nexus\r\n' +
      `--${boundary}--\r\n`;
    try {
      const router = new Router();
      registerUploadRoutes(router, { directory });
      server = new NexusServer({
        router,
        middleware: [serveStatic(directory, { prefix: '/uploads' }), bodyParser()],
      });
      await server.listen(0, '127.0.0.1');
      port = (server.address as import('node:net').AddressInfo).port;

      const uploaded = await getJson(`http://127.0.0.1:${port}/uploads`, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
      expect(uploaded.status).toBe(201);
      const saved = JSON.parse(uploaded.body).files[0] as { url: string; filename: string };
      expect(saved.url).toBe(`/uploads/${saved.filename}`);

      const downloaded = await getJson(`http://127.0.0.1:${port}${saved.url}`);
      expect(downloaded.status).toBe(200);
      expect(downloaded.body).toBe('hello nexus');
      expect((await readFile(join(directory, saved.filename))).toString()).toBe('hello nexus');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
