import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, type RawData } from 'ws';
import { parse } from 'graphql';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core';
import { defineSubgraph, createGateway, graphqlHttpHandler, SubscriptionServer, PubSub } from '../src/index.js';

const TYPEDEFS = /* graphql */ `
  type Message { id: ID! text: String! }
  type Query { hello: String! }
  type Mutation { post(text: String!): Message! }
  type Subscription { messageAdded: Message! }
`;

function makeGraph(pubsub: PubSub) {
  const sub = defineSubgraph({
    name: 'chat',
    typeDefs: TYPEDEFS,
    resolvers: {
      Query: { hello: () => 'world' },
      Mutation: {
        post: (_p: any, args: { text: string }) => {
          const msg = { id: String(Math.floor(Math.random() * 1e6)), text: args.text };
          pubsub.publish('MESSAGE_ADDED', msg);
          return msg;
        },
      },
      Subscription: {
        messageAdded: { subscribe: () => pubsub.asyncIterator('MESSAGE_ADDED'), resolve: (p: any) => p },
      },
    },
  });
  return { sub, gateway: createGateway({ subgraph: sub }) };
}

describe('graphql HTTP handler (POST /graphql)', () => {
  let server: NexusServer;
  afterEach(async () => { if (server) await server.close(); });

  async function boot(): Promise<number> {
    const { gateway } = makeGraph(new PubSub());
    const router = new Router();
    // Body parsing is handled by the server-level middleware pipeline; do NOT
    // also add bodyParser as route middleware (it would re-read the consumed
    // stream and hang).
    router.post('/graphql', graphqlHttpHandler({ gateway }));
    server = new NexusServer({ router, middleware: [bodyParser(1 << 20)] });
    await server.listen(0, '127.0.0.1');
    return (server.httpServer.address() as AddressInfo).port;
  }

  async function gql(port: number, body: unknown): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${port}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  it('executes a query', async () => {
    const p = await boot();
    const r = await gql(p, { query: '{ hello }' });
    expect(r.data.hello).toBe('world');
  });

  it('executes a mutation with variables', async () => {
    const p = await boot();
    const r = await gql(p, { query: 'mutation($t:String!){ post(text:$t){ id text } }', variables: { t: 'hi' } });
    expect(r.data.post.text).toBe('hi');
  });

  it('returns an error for a parse failure', async () => {
    const p = await boot();
    const r = await gql(p, { query: '{ hello' });
    expect(r.errors?.[0]?.message).toBeTruthy();
  });

  it('rejects introspection when disabled', async () => {
    const { gateway } = makeGraph(new PubSub());
    const router = new Router();
    router.post('/graphql', graphqlHttpHandler({ gateway, introspection: false }));
    server = new NexusServer({ router, middleware: [bodyParser(1 << 20)] });
    await server.listen(0, '127.0.0.1');
    const port = (server.httpServer.address() as AddressInfo).port;
    const r = await gql(port, { query: '{ __schema { queryType { name } } }' });
    expect(r.errors?.[0]?.message).toMatch(/ntrospection/);
  });
});

describe('graphql subscriptions over WS (graphql-transport-ws)', () => {
  let http: HttpServer;
  let sub: SubscriptionServer;
  let port: number;
  afterEach(async () => {
    await sub?.close();
    if (http) await new Promise<void>((r) => http.close(() => r()));
  });

  async function bootShared(requireAuth = false): Promise<{ gateway: ReturnType<typeof createGateway>; pubsub: PubSub }> {
    const pubsub = new PubSub();
    const { gateway } = makeGraph(pubsub);
    http = createServer((_req, res) => res.end());
    sub = new SubscriptionServer({ httpServer: http, gateway, requireAuth });
    port = await new Promise<number>((resolve) => http.listen(0, '127.0.0.1', () => resolve((http.address() as AddressInfo).port)));
    return { gateway, pubsub };
  }

  interface Client { ws: WebSocket; recv(): Promise<any>; recvOrTimeout(ms?: number): Promise<any>; send(msg: unknown): void; close(): Promise<void>; }
  function connect(port: number): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/graphql/ws`, ['graphql-transport-ws']);
      const queue: any[] = [];
      ws.on('open', () => resolve(makeClient(ws, queue)));
      ws.on('error', reject);
      ws.on('message', (d: RawData) => queue.push(JSON.parse(d.toString())));
    });
  }
  function makeClient(ws: WebSocket, queue: any[]): Client {
    const recv = () => new Promise<any>((resolve) => { const tick = () => { if (queue.length) resolve(queue.shift()); else setTimeout(tick, 10); }; tick(); });
    return {
      ws,
      recv,
      recvOrTimeout(ms = 3000) {
        return Promise.race([
          recv(),
          new Promise<any>((_, reject) => setTimeout(() => reject(new Error('recv timeout')), ms)),
        ]);
      },
      send(msg) { ws.send(JSON.stringify(msg)); },
      close() {
        // If the server already closed the socket, resolve immediately — the
        // 'close' event already fired before we could attach a listener.
        if (ws.readyState === ws.CLOSED) return Promise.resolve();
        return new Promise<void>((r) => { ws.on('close', () => r()); ws.close(); });
      },
    };
  }

  it('streams a subscription result when a mutation publishes', async () => {
    const { gateway } = await bootShared();
    const c = await connect(port);
    c.send({ type: 'connection_init' });
    expect((await c.recvOrTimeout()).type).toBe('connection_ack');
    c.send({ type: 'subscribe', id: '1', payload: { query: 'subscription { messageAdded { id text } }' } });

    // Give the server time to process `subscribe` and register the pubsub
    // listener before we publish (EventEmitter drops events with no listener).
    await new Promise<void>((r) => setTimeout(r, 150));

    // Fire the mutation in-process via the gateway (wires the fieldResolver);
    // the resolver publishes to the same shared pubsub the subscription listens on.
    await gateway.execute({ document: parse(`mutation { post(text:"streamed"){ id text } }`), contextValue: {} });

    const evt = await c.recvOrTimeout();
    expect(evt.type).toBe('next');
    expect(evt.payload.data.messageAdded.text).toBe('streamed');
    await c.close();
  }, 10_000);

  it('replies pong to ping', async () => {
    await bootShared();
    const c = await connect(port);
    c.send({ type: 'connection_init' });
    await c.recvOrTimeout(); // ack
    c.send({ type: 'ping' });
    const evt = await c.recvOrTimeout();
    expect(evt.type).toBe('pong');
    await c.close();
  });

  it('rejects a subscription connection when auth is required and no token', async () => {
    await bootShared(true);
    const c = await connect(port);
    c.send({ type: 'connection_init' });
    // Server replies with an `error` frame then closes the socket.
    const evt = await c.recvOrTimeout();
    expect(evt.type).toBe('error');
    await c.close();
  });
});