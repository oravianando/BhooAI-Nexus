/** Messages a client may send over the WebSocket. */
export type ClientMessage =
  | { type: 'join'; room: string }
  | { type: 'leave'; room: string }
  | { type: 'offer'; to: string; sdp: string; room?: string }
  | { type: 'answer'; to: string; sdp: string; room?: string }
  | { type: 'candidate'; to: string; candidate: unknown; room?: string }
  | { type: 'broadcast'; room: string; event: string; data?: unknown }
  | { type: 'ping' }
  | { type: 'media'; action: MediaAction; payload: Record<string, unknown> };

/** Messages the server sends to a client. */
export type ServerMessage =
  | { type: 'joined'; room: string; peers: string[] }
  | { type: 'left'; room: string }
  | { type: 'peer-joined'; room: string; peer: string }
  | { type: 'peer-left'; room: string; peer: string }
  | { type: 'offer'; from: string; sdp: string }
  | { type: 'answer'; from: string; sdp: string }
  | { type: 'candidate'; from: string; candidate: unknown }
  | { type: 'broadcast'; room: string; from: string; event: string; data?: unknown }
  | { type: 'pong' }
  | { type: 'media'; action: MediaAction; payload: Record<string, unknown> }
  | { type: 'error'; message: string; code?: string };

/** mediasoup signaling actions relayed over WS. */
export type MediaAction =
  | 'getRouterRtpCapabilities'
  | 'createWebRtcTransport'
  | 'connectTransport'
  | 'produce'
  | 'consume'
  | 'closeProducer'
  | 'closeConsumer';

/** A connected client's server-side record. */
export interface Connection {
  /** Stable id for this connection (the user id when authenticated, else random). */
  id: string;
  /** Authenticated user id (undefined for anonymous connections). */
  userId?: string;
  /** Roles from the access token. */
  roles: string[];
  /** Rooms this connection has joined (on this instance). */
  rooms: Set<string>;
  /** Send a JSON message to the client. */
  send(message: ServerMessage): void;
  /** Close the connection. */
  close(code?: number, reason?: string): void;
  /** Whether the underlying socket is still open. */
  readonly isOpen: boolean;
}