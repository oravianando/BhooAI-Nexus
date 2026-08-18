import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import { parse, validate } from 'graphql';
import type { AuthService } from '@bhooai/nexus-auth';
import type { Gateway, GraphQLContext } from '../types.js';

export interface SubscriptionServerOptions {
  httpServer: HttpServer;
  gateway: Gateway;
  /** WS path (default '/graphql/ws'). */
  path?: string;
  /** Optional auth: verifies access token from connection_init payload.token or ?token=. */
  authService?: AuthService;
  /** Build per-connection resolver context. Default: `{ user }` from auth. */
  context?: (init: Record<string, unknown> | undefined, user: GraphQLContext['user']) => GraphQLContext | Promise<GraphQLContext>;
  /** Reject unauthenticated connections (default true when authService provided). */
  requireAuth?: boolean;
}

type ClientMsg =
  | { type: 'connection_init'; payload?: Record<string, unknown> }
  | { type: 'subscribe'; id: string; payload: { query: string; variables?: Record<string, any>; operationName?: string } }
  | { type: 'complete'; id: string }
  | { type: 'ping' }
  | { type: 'pong' };

interface ActiveSub {
  iterator: AsyncIterator<unknown>;
  done: boolean;
}

const PROTOCOL = 'graphql-transport-ws';

/**
 * GraphQL subscriptions over WebSocket (the `graphql-transport-ws` protocol).
 * Attaches to an HTTP server's 'upgrade' event. On `connection_init` we
 * (optionally) authenticate; on `subscribe` we run the gateway's `subscribe()`
 * and stream each `next` result back until the client sends `complete` or the
 * socket closes.
 */
export class SubscriptionServer {
  private wss: WebSocketServer;
  private opts: SubscriptionServerOptions;

  constructor(opts: SubscriptionServerOptions) {
    this.opts = opts;
    this.wss = new WebSocketServer({ noServer: true });
    this.opts.httpServer.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  private async handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== (this.opts.path ?? '/graphql/ws')) return;

    const protocols = (req.headers['sec-websocket-protocol'] ?? '').toString().split(',').map((s) => s.trim());
    if (!protocols.includes(PROTOCOL)) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleConnection(ws, url);
    });
  }

  private async handleConnection(ws: WebSocket, url: URL): Promise<void> {
    let user: GraphQLContext['user'];
    let acknowledged = false;
    const active = new Map<string, ActiveSub>();

    const send = (msg: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

    const cleanup = async () => {
      for (const [, sub] of active) {
        if (!sub.done) { sub.done = true; try { await sub.iterator.return?.(); } catch { /* ignore */ } }
      }
      active.clear();
    };

    // If auth is required and no token is supplied via ?token=, we can reject
    // early; but the protocol sends the token in connection_init, so we wait.
    ws.on('message', async (data) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(data.toString('utf8')) as ClientMsg; } catch { return; }

      switch (msg.type) {
        case 'connection_init': {
          try {
            user = await this.authenticate(msg.payload, url);
          } catch (err) {
            send({ type: 'error', id: '', payload: [{ message: (err as Error).message }] });
            ws.close(4401, 'Unauthorized');
            return;
          }
          acknowledged = true;
          send({ type: 'connection_ack' });
          return;
        }
        case 'ping':
          send({ type: 'pong' });
          return;
        case 'pong':
          return;
        case 'subscribe': {
          if (!acknowledged) { send({ type: 'error', id: msg.id, payload: [{ message: 'connection not acknowledged' }] }); return; }
          await this.runSubscription(msg, ws, active, user);
          return;
        }
        case 'complete': {
          const sub = active.get(msg.id);
          if (sub && !sub.done) { sub.done = true; try { await sub.iterator.return?.(); } catch { /* ignore */ } }
          active.delete(msg.id);
          return;
        }
      }
    });

    ws.on('close', () => void cleanup());
    ws.on('error', () => void cleanup());
  }

  private async authenticate(payload: Record<string, unknown> | undefined, url: URL): Promise<GraphQLContext['user']> {
    const requireAuth = this.opts.requireAuth ?? !!this.opts.authService;
    if (!this.opts.authService) {
      if (requireAuth) throw new Error('Authentication required but no authService configured');
      return undefined;
    }
    const token = (payload?.token as string | undefined) ?? url.searchParams.get('token');
    if (!token) {
      if (requireAuth) throw new Error('Missing access token');
      return undefined;
    }
    const claims = await this.opts.authService.verifyAccessToken(token);
    return { sub: claims.sub, roles: claims.roles ?? [], sid: claims.sid };
  }

  private async runSubscription(
    msg: { type: 'subscribe'; id: string; payload: { query: string; variables?: Record<string, any>; operationName?: string } },
    ws: WebSocket,
    active: Map<string, ActiveSub>,
    user: GraphQLContext['user'],
  ): Promise<void> {
    const send = (m: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };

    let document;
    try {
      document = parse(msg.payload.query);
    } catch (err) {
      send({ type: 'error', id: msg.id, payload: [{ message: (err as Error).message }] });
      return;
    }

    const errors = validate(this.opts.gateway.schema, document);
    if (errors.length) {
      send({ type: 'error', id: msg.id, payload: errors.map((e) => ({ message: e.message })) });
      return;
    }

    const contextValue = this.opts.context
      ? await this.opts.context(undefined, user)
      : { user };

    let stream;
    try {
      stream = await this.opts.gateway.subscribe({
        document,
        variableValues: msg.payload.variables,
        operationName: msg.payload.operationName,
        contextValue,
      });
    } catch (err) {
      send({ type: 'error', id: msg.id, payload: [{ message: (err as Error).message }] });
      return;
    }

    const sub: ActiveSub = { iterator: stream[Symbol.asyncIterator](), done: false };
    active.set(msg.id, sub);

    // Pump results asynchronously; stop when the client completes or the stream ends.
    void (async () => {
      try {
        while (!sub.done) {
          const { value, done } = await sub.iterator.next();
          if (done) break;
          if (ws.readyState !== ws.OPEN) break;
          send({ type: 'next', id: msg.id, payload: value });
        }
        if (!sub.done && ws.readyState === ws.OPEN) send({ type: 'complete', id: msg.id });
      } catch (err) {
        send({ type: 'error', id: msg.id, payload: [{ message: (err as Error).message }] });
      } finally {
        active.delete(msg.id);
      }
    })();
  }

  close(): Promise<void> {
    this.wss.close();
    return Promise.resolve();
  }
}