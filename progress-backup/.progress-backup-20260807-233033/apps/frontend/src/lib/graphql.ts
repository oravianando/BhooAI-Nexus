// Minimal non-Apollo GraphQL client.
//
// - Queries/mutations: POST /graphql with the access token (no Apollo, no
//   urql — just fetch + the standard { query, variables, operationName } body).
// - Subscriptions: graphql-transport-ws over /graphql/ws. We implement the
//   connection_init → subscribe → next/error/complete protocol by hand.

import { getAccessToken, getCsrfToken, refreshCsrf } from './auth.js';

export interface GqlError { message: string; path?: (string | number)[]; }
export interface GqlResponse<T> { data?: T; errors?: GqlError[]; }

async function execute<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  await refreshCsrf();
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken() };
  const token = getAccessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch('/graphql', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = (await r.json()) as GqlResponse<T>;
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data as T;
}

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  try {
    return await execute<T>(query, variables);
  } catch {
    // One transparent refresh on a likely-stale CSRF token, then retry once.
    await refreshCsrf();
    return execute<T>(query, variables);
  }
}

// ---- subscriptions over WS ----

type SubHandler<T> = (data: T | null, err?: Error) => void;

class GqlSubscriptionClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, SubHandler<any>>();
  private acked = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private url(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getAccessToken();
    return `${proto}//${window.location.host}/graphql/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  }

  private connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(this.url(), 'graphql-transport-ws');
    this.ws = ws;
    this.acked = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      switch (msg.type) {
        case 'connection_ack':
          this.acked = true;
          for (const [id, handler] of this.pending) {
            ws.send(JSON.stringify({ id, type: 'subscribe', payload: (handler as SubHandler<any> & { __payload: unknown }).__payload }));
          }
          break;
        case 'next': {
          const h = this.pending.get(msg.id);
          h?.(msg.payload?.data ?? null);
          break;
        }
        case 'error': {
          const h = this.pending.get(msg.id);
          h?.(null, new Error(msg.payload?.message ?? 'subscription error'));
          break;
        }
        case 'complete':
          this.pending.delete(msg.id);
          break;
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.pending.size) this.scheduleReconnect(); // auto-reconnect if subs still live
    };
    ws.onerror = () => { /* surfaced via onclose */ };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 2000);
  }

  subscribe<T>(query: string, variables: Record<string, unknown> | undefined, handler: SubHandler<T>): () => void {
    const id = `sub_${Math.random().toString(36).slice(2)}`;
    (handler as SubHandler<any> & { __payload: unknown }).__payload = { query, variables };
    this.pending.set(id, handler as SubHandler<any>);
    this.connect();
    if (this.acked && this.ws) this.ws.send(JSON.stringify({ id, type: 'subscribe', payload: { query, variables } }));
    return () => {
      this.pending.delete(id);
      this.ws?.send(JSON.stringify({ id, type: 'complete' }));
    };
  }
}

let subClient: GqlSubscriptionClient | null = null;
export function subscribe<T>(query: string, variables: Record<string, unknown> | undefined, handler: SubHandler<T>): () => void {
  if (!subClient) subClient = new GqlSubscriptionClient();
  return subClient.subscribe<T>(query, variables, handler);
}