import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocket, type RawData } from 'ws';
import type { AddressInfo } from 'node:net';
import { AuthService, MemorySessionStore } from '@bhooai/nexus-auth';
import { RealtimeServer, MemoryPubSubAdapter, MediasoupAdapter } from '../src/index.js';

const JWT = { secret: 'rt-test-secret-long-enough-for-hs256-signing', issuer: 'nexus-test', accessTtl: 60, refreshTtl: 3600 };

function boot(opts: { authService?: AuthService; requireAuth?: boolean } = {}): { http: HttpServer; rt: RealtimeServer; port: number; close: () => Promise<void> } {
  const http = createServer((_req, res) => res.end());
  const rt = new RealtimeServer({ httpServer: http, authService: opts.authService, requireAuth: opts.requireAuth, path: '/ws' });
  return {
    http,
    rt,
    port: 0,
    async close() {
      await rt.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

function listen(s: { http: HttpServer; port: number }): Promise<number> {
  return new Promise((resolve) => {
    s.http.listen(0, '127.0.0.1', () => {
      s.port = (s.http.address() as AddressInfo).port;
      resolve(s.port);
    });
  });
}

interface Client {
  ws: WebSocket;
  messages: import('../src/types.js').ServerMessage[];
  next(): Promise<import('../src/types.js').ServerMessage>;
  send(msg: unknown): void;
  close(): Promise<void>;
}

function connect(port: number, query = '', protocols?: string[]): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, protocols);
    const messages: import('../src/types.js').ServerMessage[] = [];
    ws.on('open', () => resolve(makeClient(ws, messages)));
    ws.on('error', reject);
    ws.on('message', (d: RawData) => messages.push(JSON.parse(d.toString())));
  });
}

function makeClient(ws: WebSocket, messages: import('../src/types.js').ServerMessage[]): Client {
  return {
    ws,
    messages,
    next() {
      return new Promise((resolve) => {
        const tick = () => {
          if (messages.length) resolve(messages.shift()!);
          else setTimeout(tick, 10);
        };
        tick();
      });
    },
    send(msg) { ws.send(JSON.stringify(msg)); },
    close() { return new Promise<void>((r) => ws.on('close', () => r()).close()); },
  };
}

describe('realtime: adapter', () => {
  it('delivers published messages to subscribers', async () => {
    const adapter = new MemoryPubSubAdapter();
    const got: string[] = [];
    adapter.subscribe('room:lobby', (m) => got.push(m.toString()));
    adapter.publish('room:lobby', 'hello');
    adapter.publish('room:other', 'nope');
    expect(got).toEqual(['hello']);
  });
});

describe('realtime: auth + connection', () => {
  let svc: AuthService;
  let s: ReturnType<typeof boot>;
  beforeAll(() => { svc = new AuthService(JWT, new MemorySessionStore()); });
  afterEach(async () => s && (await s.close()));

  it('accepts a connection with a valid access token', async () => {
    s = boot({ authService: svc });
    const port = await listen(s);
    const pair = await svc.login({ userId: 'u1', roles: ['user'] });
    const c = await connect(port, `?token=${pair.accessToken}`);
    c.send({ type: 'ping' });
    const msg = await c.next();
    expect(msg.type).toBe('pong');
    expect(s.rt.connectionCount).toBe(1);
    await c.close();
  });

  it('rejects a connection without a token when auth is required', async () => {
    s = boot({ authService: svc, requireAuth: true });
    const port = await listen(s);
    await expect(connect(port)).rejects.toThrow();
    expect(s.rt.connectionCount).toBe(0);
  });

  it('allows anonymous connections when no authService is configured', async () => {
    s = boot({ requireAuth: false });
    const port = await listen(s);
    const c = await connect(port);
    c.send({ type: 'ping' });
    expect((await c.next()).type).toBe('pong');
    await c.close();
  });
});

describe('realtime: rooms + signaling + broadcast', () => {
  let svc: AuthService;
  let s: ReturnType<typeof boot>;
  beforeAll(() => { svc = new AuthService(JWT, new MemorySessionStore()); });
  afterEach(async () => s && (await s.close()));

  async function twoClients() {
    s = boot({ authService: svc });
    const port = await listen(s);
    const p1 = await svc.login({ userId: 'u-a', roles: ['user'] });
    const p2 = await svc.login({ userId: 'u-b', roles: ['user'] });
    const a = await connect(port, `?token=${p1.accessToken}`);
    const b = await connect(port, `?token=${p2.accessToken}`);
    return { port, a, b };
  }

  it('notifies peers when someone joins a room and reports existing peers', async () => {
    const { a, b } = await twoClients();
    a.send({ type: 'join', room: 'lobby' });
    expect((await a.next()).type).toBe('joined');
    b.send({ type: 'join', room: 'lobby' });
    // B learns A is already here:
    const bJoined = await b.next();
    expect(bJoined.type).toBe('joined');
    expect(bJoined).toMatchObject({ type: 'joined', room: 'lobby' });
    if (bJoined.type === 'joined') expect(bJoined.peers).toContain('u-a');
    // A is told B joined:
    const aPeer = await a.next();
    expect(aPeer.type).toBe('peer-joined');
    if (aPeer.type === 'peer-joined') expect(aPeer.peer).toBe('u-b');
    await a.close();
    await b.close();
  });

  it('relays WebRTC offer/answer/candidate between peers', async () => {
    const { a, b } = await twoClients();
    a.send({ type: 'join', room: 'call' });
    await a.next(); // joined
    b.send({ type: 'join', room: 'call' });
    await b.next(); // joined
    await a.next(); // peer-joined (B)

    a.send({ type: 'offer', to: 'u-b', sdp: 'OFFER-SDP', room: 'call' });
    const bOffer = await b.next();
    expect(bOffer.type).toBe('offer');
    if (bOffer.type === 'offer') { expect(bOffer.from).toBe('u-a'); expect(bOffer.sdp).toBe('OFFER-SDP'); }

    b.send({ type: 'answer', to: 'u-a', sdp: 'ANSWER-SDP', room: 'call' });
    const aAnswer = await a.next();
    expect(aAnswer.type).toBe('answer');
    if (aAnswer.type === 'answer') expect(aAnswer.sdp).toBe('ANSWER-SDP');

    a.send({ type: 'candidate', to: 'u-b', candidate: { c: 1 }, room: 'call' });
    const bCand = await b.next();
    expect(bCand.type).toBe('candidate');
    await a.close();
    await b.close();
  });

  it('broadcasts an event to all room members', async () => {
    const { a, b } = await twoClients();
    a.send({ type: 'join', room: 'stage' });
    await a.next();
    b.send({ type: 'join', room: 'stage' });
    await b.next();
    await a.next(); // peer-joined
    a.send({ type: 'broadcast', room: 'stage', event: 'chat', data: { msg: 'hi' } });
    const bEvt = await b.next();
    expect(bEvt.type).toBe('broadcast');
    if (bEvt.type === 'broadcast') { expect(bEvt.event).toBe('chat'); expect(bEvt.from).toBe('u-a'); }
    await a.close();
    await b.close();
  });

  it('notifies peers when someone leaves', async () => {
    const { a, b } = await twoClients();
    a.send({ type: 'join', room: 'x' });
    await a.next();
    b.send({ type: 'join', room: 'x' });
    await b.next();
    await a.next(); // peer-joined
    await a.close();
    const left = await b.next();
    expect(left.type).toBe('peer-left');
    await b.close();
  });
});

describe('realtime: mediasoup SFU (skip if unavailable)', () => {
  it('returns router RTP capabilities', async (ctx) => {
    if (!(await MediasoupAdapter.isAvailable())) ctx.skip();
    const adapter = new MediasoupAdapter({ announceIp: '127.0.0.1', rtcMinPort: 41000, rtcMaxPort: 41100 });
    // Stand-in connection object (the adapter only uses it as a WeakMap key).
    const conn = { id: 'm1', roles: [], rooms: new Set(), send() {}, close() {}, isOpen: true } as unknown as import('../src/types.js').Connection;
    const reply = await adapter.handle(conn, 'getRouterRtpCapabilities', { room: 'test' });
    expect(reply.rtpCapabilities).toBeDefined();
    adapter.cleanup(conn);
  });
});