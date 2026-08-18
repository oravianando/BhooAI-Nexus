import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gql } from '../src/lib/graphql.js';
import { chatStream } from '../src/lib/ai.js';
import { createOrder } from '../src/lib/payments.js';
import { RealtimeClient } from '../src/lib/realtime.js';
import { __resetAuthState } from '../src/lib/auth.js';

// ---- shared fetch mock (handles /csrf-token + any other path) ----
function mockFetch(handlers: Record<string, (url: string, init: any) => any>) {
  const calls: any[] = [];
  const fn = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    const handler = handlers[url] ?? handlers['*'];
    const res = handler ? handler(url, init) : { status: 404, body: '{}' };
    const status = res.status ?? 200;
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => res.contentType ?? 'application/json' },
      json: async () => JSON.parse(body),
      text: async () => body,
    } as any;
  });
  (globalThis as any).fetch = fn;
  return { fn, calls };
}

// ---- fake WebSocket ----
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: any[] = [];
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(msg: any) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}
function installFakeWs() {
  FakeWebSocket.instances = [];
  (globalThis as any).WebSocket = FakeWebSocket;
}

beforeEach(() => {
  __resetAuthState();
  (globalThis as any).fetch = undefined;
  (globalThis as any).window = { location: { protocol: 'http:', host: 'localhost:3000', pathname: '/' }, history: { replaceState: () => {} } };
  installFakeWs();
});
afterEach(() => {
  (globalThis as any).WebSocket = undefined;
  (globalThis as any).window = undefined;
});

describe('graphql client (non-Apollo)', () => {
  it('POSTs the query with csrf + bearer token and returns data', async () => {
    mockFetch({
      '/csrf-token': () => ({ body: { token: 'csrf-abc' } }),
      '/graphql': () => ({ body: { data: { users: [{ id: '1', email: 'a@x.com' }] } } }),
    });
    const data = await gql<{ users: { id: string }[] }>(`{ users { id } }`);
    expect(data.users).toHaveLength(1);
    expect(data.users[0].email).toBe('a@x.com');
  });

  it('throws on GraphQL errors', async () => {
    mockFetch({
      '/csrf-token': () => ({ body: { token: 'csrf-abc' } }),
      '/graphql': () => ({ body: { errors: [{ message: 'bad field' }] } }),
    });
    await expect(gql(`{ bad }`)).rejects.toThrow('bad field');
  });
});

describe('ai chatStream (SSE parser)', () => {
  it('yields delta content chunks and stops at [DONE]', async () => {
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n` +
      `data: [DONE]\n\n`;
    mockFetch({
      '/csrf-token': () => ({ body: { token: 'csrf' } }),
      '/ai/chat/completions': () => ({
        contentType: 'text/event-stream',
        body: sse,
      }),
    });
    // fetch must return a ReadableStream for chatStream; override body shape.
    (globalThis as any).fetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/csrf-token') return { ok: true, json: async () => ({ token: 'csrf' }) } as any;
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) { controller.enqueue(enc.encode(sse)); controller.close(); },
      });
      return {
        ok: true,
        body: stream,
        json: async () => ({}),
      } as any;
    });

    const chunks: string[] = [];
    for await (const d of chatStream([{ role: 'user', content: 'hi' }])) chunks.push(d);
    expect(chunks.join('')).toBe('Hello');
  });
});

describe('payments client', () => {
  it('creates an order and sends provider + amount', async () => {
    const { fn } = mockFetch({
      '/csrf-token': () => ({ body: { token: 'csrf' } }),
      '/payments/order': () => ({ body: { provider: 'razorpay', order: { id: 'ord_1', reference: 'r', status: 'created', amount: 1000, currency: 'USD' } } }),
    });
    const res = await createOrder({ provider: 'razorpay', amount: 10, currency: 'USD' });
    expect(res.order.id).toBe('ord_1');
    const orderCall = fn.mock.calls.find((c: any) => c[0] === '/payments/order');
    const body = JSON.parse(orderCall[1].body);
    expect(body.provider).toBe('razorpay');
    expect(body.amount).toBe(10);
    expect(orderCall[1].headers['x-csrf-token']).toBe('csrf');
  });
});

describe('realtime client', () => {
  it('joins a room on open and dispatches broadcast/peer events', async () => {
    const rt = new RealtimeClient();
    const joined: string[][] = [];
    const peers: string[] = [];
    const chats: string[] = [];
    rt.on('joined', (_room, p) => joined.push(p));
    rt.on('peer-joined', (_room, peer) => peers.push(peer));
    rt.on('broadcast', (_room, _from, event, data) => { if (event === 'chat') chats.push(String(data)); });
    rt.connect();
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    ws.open();
    // server confirms join with existing peers
    ws.receive({ type: 'joined', room: 'lobby', peers: ['p2'] });
    expect(joined).toEqual([['p2']]);
    // a new peer joins
    ws.receive({ type: 'peer-joined', room: 'lobby', peer: 'p3' });
    expect(peers).toEqual(['p3']);
    // peer broadcasts a chat message
    ws.receive({ type: 'broadcast', room: 'lobby', from: 'p3', event: 'chat', data: 'hi there' });
    expect(chats).toEqual(['hi there']);
  });

  it('send methods write correctly framed JSON to the socket', () => {
    const rt = new RealtimeClient();
    rt.connect();
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    ws.open();
    rt.join('demo');
    rt.broadcast('demo', 'chat', 'hello');
    rt.sendOffer('p2', { type: 'offer' });
    expect(ws.sent).toContainEqual({ type: 'join', room: 'demo' });
    expect(ws.sent).toContainEqual({ type: 'broadcast', room: 'demo', event: 'chat', data: 'hello' });
    expect(ws.sent).toContainEqual({ type: 'offer', to: 'p2', sdp: { type: 'offer' } });
  });
});