import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AiClient, AiError } from '../src/index.js';
import type { ChatCompletionChunk } from '../src/index.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body: any) => void;

function startServer(handler: Handler): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body: any = undefined;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* */ }
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${(addr as { port: number }).port}`;
      resolve({ server, url });
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

let servers: Server[] = [];
async function withServer(handler: Handler, fn: (url: string) => Promise<void>): Promise<void> {
  const { server, url } = await startServer(handler);
  servers.push(server);
  try { await fn(url); } finally { /* closed in afterEach */ }
}

afterEach(() => {
  for (const s of servers) { (s as any).closeAllConnections?.(); s.close(); }
  servers = [];
});

describe('AiClient', () => {
  it('chat (non-stream) parses the response', async () => {
    await withServer((_req, res, body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'c1', model: body.model, provider: 'ollama',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }));
    }, async (url) => {
      const client = new AiClient({ serverUrl: url });
      const r = await client.chat({ model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] });
      expect(r.choices[0].message.content).toBe('Hi');
      expect(r.provider).toBe('ollama');
    });
  });

  it('chatStream yields chunks until [DONE]', async () => {
    await withServer((_req, res, body) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunks: ChatCompletionChunk[] = [
        { id: 'c1', model: body.model, provider: 'openai', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' }, finish_reason: null }] },
        { id: 'c1', model: body.model, provider: 'openai', choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] },
        { id: 'c1', model: body.model, provider: 'openai', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ];
      for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }, async (url) => {
      const client = new AiClient({ serverUrl: url });
      const out: string[] = [];
      for await (const c of client.chatStream({ model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] })) {
        out.push(c.choices[0].delta.content ?? '');
      }
      expect(out.join('')).toBe('Hello');
    });
  });

  it('embeddings (single + batch)', async () => {
    await withServer((_req, res, body) => {
      const n = Array.isArray(body.input) ? body.input.length : 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: body.model, provider: 'openai',
        data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [0.1, 0.2] })),
        usage: { prompt_tokens: n, total_tokens: n },
      }));
    }, async (url) => {
      const client = new AiClient({ serverUrl: url });
      const single = await client.embeddings({ model: 'e', input: 'hello' });
      expect(single.data).toHaveLength(1);
      const batch = await client.embeddings({ model: 'e', input: ['a', 'b', 'c'] });
      expect(batch.data).toHaveLength(3);
    });
  });

  it('listModels forwards the provider query param', async () => {
    await withServer((req, res) => {
      expect(req.url).toBe('/models?provider=ollama');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ provider: 'ollama', data: [{ id: 'llama3', owned_by: 'ollama' }] }));
    }, async (url) => {
      const client = new AiClient({ serverUrl: url });
      const r = await client.listModels('ollama');
      expect(r.data[0].id).toBe('llama3');
    });
  });

  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    await withServer((_req, res) => {
      calls += 1;
      if (calls < 3) { res.writeHead(503); res.end(JSON.stringify({ error: { message: 'down' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], provider: 'openai' }));
    }, async (url) => {
      const client = new AiClient({ serverUrl: url, maxRetries: 3, retryDelayMs: 10 });
      const r = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
      expect(r.choices[0].message.content).toBe('ok');
      expect(calls).toBe(3);
    });
  });

  it('throws AiError (non-retryable) on 400', async () => {
    await withServer((_req, res) => {
      res.writeHead(400); res.end(JSON.stringify({ error: { message: 'bad', code: 'BAD' } }));
    }, async (url) => {
      const client = new AiClient({ serverUrl: url, maxRetries: 2, retryDelayMs: 10 });
      await expect(client.chat({ model: 'm', messages: [] })).rejects.toThrow(/bad/);
      await expect(client.chat({ model: 'm', messages: [] })).rejects.toBeInstanceOf(AiError);
    });
  });

  it('times out and aborts the request', async () => {
    await withServer((_req, res) => {
      // Never respond.
      setTimeout(() => res.end(), 5000);
    }, async (url) => {
      const client = new AiClient({ serverUrl: url, timeoutMs: 100, maxRetries: 0 });
      await expect(client.chat({ model: 'm', messages: [] })).rejects.toThrow(/timed out|aborted/i);
    });
  });

  it('sends the auth token header when configured', async () => {
    await withServer((req, res) => {
      expect(req.headers['authorization']).toBe('Bearer secret-token');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], provider: 'openai' }));
    }, async (url) => {
      const client = new AiClient({ serverUrl: url, authToken: 'secret-token' });
      await client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    });
  });

  it('forwards the `provider` field to the AI server for routing', async () => {
    await withServer((_req, res, body) => {
      expect(body.provider).toBe('auto'); // server routes on this; strips before upstream
      expect(body.model).toBe('m');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], provider: 'openai' }));
    }, async (url) => {
      const client = new AiClient({ serverUrl: url });
      await client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }], provider: 'auto' });
    });
  });
});