import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { AuthService, CsrfOptions } from '@bhooai/nexus-auth';
import { checkWsUpgrade } from '@bhooai/nexus-auth';
import { AuthenticationError } from '@bhooai/nexus-core';
import type { ClientMessage, ServerMessage, Connection } from '../types.js';
import type { PubSubAdapter } from '../adapter/PubSubAdapter.js';
import { MemoryPubSubAdapter } from '../adapter/PubSubAdapter.js';
import type { MediasoupAdapter } from '../mediasoup/MediasoupAdapter.js';

export interface RealtimeServerOptions {
  /** The HTTP server to attach the WebSocket upgrade handler to. */
  httpServer: HttpServer;
  /** WS path (default '/ws'). */
  path?: string;
  /** Auth service for access-token verification on upgrade (optional → anonymous). */
  authService?: AuthService;
  /** CSRF options for the WS upgrade origin + double-submit check (optional). */
  csrfOptions?: CsrfOptions;
  /** Pub/sub adapter for cross-instance fanout (default in-memory). */
  adapter?: PubSubAdapter;
  /** mediasoup SFU adapter for media routing (optional). */
  mediasoup?: MediasoupAdapter;
  /** Require authentication on upgrade (default true when authService provided). */
  requireAuth?: boolean;
}

const CONN_CHANNEL = (id: string) => `conn:${id}`;
const ROOM_CHANNEL = (room: string) => `room:${room}`;

/**
 * WebSocket realtime server. Attaches to an HTTP server's 'upgrade' event,
 * authenticates the upgrade (access token via `?token=` query, optional CSRF
 * origin/double-submit check), and dispatches client messages: room join/leave,
 * WebRTC offer/answer/ICE-candidate relay, and app broadcasts.
 *
 * Cross-instance fanout uses the pub/sub adapter: direct peer messages are
 * published to `conn:<id>` (delivered by whichever instance hosts the peer);
 * room events are published to `room:<room>` (delivered to every instance with
 * local members).
 */
export class RealtimeServer {
  private wss: WebSocketServer;
  private adapter: PubSubAdapter;
  private connections = new Map<string, Connection>();
  /** Local members per room (connIds on THIS instance). */
  private roomMembers = new Map<string, Set<string>>();
  private subscribedRooms = new Set<string>();
  private opts: RealtimeServerOptions;

  constructor(opts: RealtimeServerOptions) {
    this.opts = opts;
    this.adapter = opts.adapter ?? new MemoryPubSubAdapter();
    this.wss = new WebSocketServer({ noServer: true });
    this.opts.httpServer.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Only handle our WS path; let other upgrade listeners handle the rest.
    if (url.pathname !== (this.opts.path ?? '/ws')) return;

    try {
      // 1. CSRF + origin check (WS has no CORS preflight).
      if (this.opts.csrfOptions) checkWsUpgrade(req.headers as Record<string, string | string[] | undefined>, this.opts.csrfOptions);

      // 2. Authenticate via ?token=<accessToken> (or subprotocol).
      const token = (url.searchParams.get('token') ?? req.headers['sec-websocket-protocol']?.split(',').map((s) => s.trim())[0]) ?? '';
      let userId: string | undefined;
      let roles: string[] = [];
      if (this.opts.authService && token) {
        const payload = await this.opts.authService.verifyAccessToken(token);
        userId = payload.sub;
        roles = payload.roles ?? [];
      } else if (this.opts.requireAuth ?? !!this.opts.authService) {
        throw new AuthenticationError('Missing access token');
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        const id = userId ?? randomBytes(9).toString('base64url');
        this.register(ws, id, userId, roles);
      });
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  }

  private register(ws: WebSocket, id: string, userId: string | undefined, roles: string[]): void {
    const conn: Connection = {
      id,
      userId,
      roles,
      rooms: new Set(),
      get isOpen() { return ws.readyState === ws.OPEN; },
      send: (message) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message)); },
      close: (code, reason) => ws.close(code, reason),
    };
    this.connections.set(id, conn);

    // Subscribe to this connection's direct channel (cross-instance delivery).
    const direct = (raw: Buffer | string) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      conn.send(msg);
    };
    this.adapter.subscribe(CONN_CHANNEL(id), direct);
    (conn as Connection & { _direct?: unknown })._direct = direct;

    ws.on('message', (data) => this.onMessage(conn, data.toString('utf8')));
    ws.on('close', () => this.onClose(conn, direct));
    ws.on('error', () => this.onClose(conn, direct));
  }

  private async onMessage(conn: Connection, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      conn.send({ type: 'error', message: 'Invalid JSON' });
      return;
    }
    switch (msg.type) {
      case 'ping':
        conn.send({ type: 'pong' });
        return;
      case 'join':
        await this.joinRoom(conn, msg.room);
        return;
      case 'leave':
        await this.leaveRoom(conn, msg.room);
        return;
      case 'offer':
      case 'answer':
      case 'candidate': {
        const to = this.connections.get(msg.to);
        if (to) {
          // Same instance: send directly.
          to.send(this.relayFrom(conn, msg));
        } else {
          // Cross-instance: publish to the peer's direct channel (best-effort).
          this.adapter.publish(CONN_CHANNEL(msg.to), JSON.stringify(this.relayFrom(conn, msg)));
        }
        return;
      }
      case 'broadcast':
        this.broadcastRoom(msg.room, { type: 'broadcast', room: msg.room, from: conn.id, event: msg.event, data: msg.data });
        return;
      case 'media':
        await this.handleMedia(conn, msg);
        return;
      default:
        conn.send({ type: 'error', message: `Unknown message type` });
    }
  }

  private relayFrom(conn: Connection, msg: ClientMessage): ServerMessage {
    if (msg.type === 'offer') return { type: 'offer', from: conn.id, sdp: msg.sdp };
    if (msg.type === 'answer') return { type: 'answer', from: conn.id, sdp: msg.sdp };
    if (msg.type === 'candidate') return { type: 'candidate', from: conn.id, candidate: msg.candidate };
    throw new Error('Cannot relay a non-peer message');
  }

  private async joinRoom(conn: Connection, room: string): Promise<void> {
    if (conn.rooms.has(room)) return;
    let set = this.roomMembers.get(room);
    const wasEmpty = !set || set.size === 0;
    if (!set) { set = new Set(); this.roomMembers.set(room, set); }
    set.add(conn.id);
    conn.rooms.add(room);

    if (wasEmpty && !this.subscribedRooms.has(room)) {
      this.adapter.subscribe(ROOM_CHANNEL(room), this.deliverRoom);
      this.subscribedRooms.add(room);
    }
    // Notify everyone (including cross-instance) that a peer joined.
    this.adapter.publish(ROOM_CHANNEL(room), JSON.stringify({ type: 'peer-joined', room, peer: conn.id }));
    // Tell the joiner who's already here (local members).
    const peers = [...set].filter((id) => id !== conn.id);
    conn.send({ type: 'joined', room, peers });
  }

  private async leaveRoom(conn: Connection, room: string): Promise<void> {
    conn.rooms.delete(room);
    const set = this.roomMembers.get(room);
    if (!set) return;
    set.delete(conn.id);
    this.adapter.publish(ROOM_CHANNEL(room), JSON.stringify({ type: 'peer-left', room, peer: conn.id }));
    conn.send({ type: 'left', room });
    if (set.size === 0) {
      this.roomMembers.delete(room);
      this.subscribedRooms.delete(room);
      this.adapter.unsubscribe(ROOM_CHANNEL(room), this.deliverRoom);
    }
  }

  /** Deliver a room-channel message to all local members of that room, skipping the originator. */
  private deliverRoom = (raw: Buffer | string): void => {
    const msg = JSON.parse(raw.toString()) as ServerMessage & { room?: string };
    const room = msg.room;
    if (!room) return;
    const set = this.roomMembers.get(room);
    if (!set) return;
    // The originator must not receive its own join/leave/broadcast echo.
    const origin =
      msg.type === 'peer-joined' || msg.type === 'peer-left' ? (msg as { peer: string }).peer
      : msg.type === 'broadcast' ? (msg as { from: string }).from
      : undefined;
    for (const id of set) {
      if (id === origin) continue;
      this.connections.get(id)?.send(msg);
    }
  };

  private broadcastRoom(room: string, msg: ServerMessage): void {
    this.adapter.publish(ROOM_CHANNEL(room), JSON.stringify(msg));
  }

  /** Publish an application event to every authenticated connection in a room. */
  broadcast(room: string, event: string, data?: unknown): void {
    this.broadcastRoom(room, { type: 'broadcast', room, from: 'server', event, data });
  }

  private async handleMedia(conn: Connection, msg: ClientMessage & { type: 'media' }): Promise<void> {
    if (!this.opts.mediasoup) {
      conn.send({ type: 'error', message: 'mediasoup SFU not enabled', code: 'NO_SFU' });
      return;
    }
    const reply = await this.opts.mediasoup.handle(conn, msg.action, msg.payload);
    conn.send({ type: 'media', action: msg.action, payload: reply });
  }

  private async onClose(conn: Connection, direct: (raw: Buffer | string) => void): Promise<void> {
    this.connections.delete(conn.id);
    this.adapter.unsubscribe(CONN_CHANNEL(conn.id), direct);
    for (const room of [...conn.rooms]) await this.leaveRoom(conn, room);
    this.opts.mediasoup?.cleanup(conn);
  }

  /** Number of live connections (test/monitoring helper). */
  get connectionCount(): number {
    return this.connections.size;
  }

  /** Close the WS server and all connections. */
  close(): Promise<void> {
    for (const conn of this.connections.values()) conn.close(1001, 'server shutting down');
    this.wss.close();
    return Promise.resolve();
  }
}
