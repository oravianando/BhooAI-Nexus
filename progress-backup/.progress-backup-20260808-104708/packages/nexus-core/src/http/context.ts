import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

/** Route path parameters extracted from the URL. */
export type Params = Record<string, string>;

/** Per-request mutable state shared across middleware. */
export type State = Record<string, unknown>;

export interface RequestContext {
  /** The raw Node request. */
  req: IncomingMessage;
  /** The raw Node response. */
  res: ServerResponse;
  /** HTTP method, uppercased. */
  method: string;
  /** URL pathname (no query). */
  path: string;
  /** Parsed query string. */
  query: Record<string, string | string[]>;
  /** Route params. */
  params: Params;
  /** Headers (lowercased keys). */
  headers: Record<string, string | string[] | undefined>;
  /** Parsed request body (set by body parser middleware). */
  body: unknown;
  /** Per-request state. */
  state: State;
  /** Request id (also in headers as x-request-id). */
  requestId: string;
  /** The matched route pattern, e.g. "/users/:id". */
  routePattern?: string;
  /** Send a JSON response. */
  json(data: unknown, status?: number): void;
  /** Send a text response. */
  text(data: string, status?: number): void;
  /** Send an HTML response. */
  html(data: string, status?: number): void;
  /** Send an empty/status-only response. */
  status(status: number): void;
  /** Redirect to a location. */
  redirect(location: string, status?: number): void;
  /** Set a response header. */
  setHeader(name: string, value: string | string[]): void;
}

export type Next = () => Promise<void> | void;

export type Middleware = (ctx: RequestContext, next: Next) => Promise<void> | void;

export type Handler = (ctx: RequestContext) => void | Promise<void>;

/** Build a RequestContext from raw Node objects. */
export function createContext(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): RequestContext {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const query: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams.entries()) {
    const existing = query[k];
    if (existing === undefined) query[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else query[k] = [existing, v];
  }
  const ctx: RequestContext = {
    req,
    res,
    method: (req.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    query,
    params: {},
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: undefined,
    state: {},
    requestId,
    json(data, status = 200) {
      send(res, JSON.stringify(data), status, 'application/json; charset=utf-8');
    },
    text(data, status = 200) {
      send(res, data, status, 'text/plain; charset=utf-8');
    },
    html(data, status = 200) {
      send(res, data, status, 'text/html; charset=utf-8');
    },
    status(s) {
      res.statusCode = s;
      res.end();
    },
    redirect(location, status = 302) {
      res.statusCode = status;
      res.setHeader('location', location);
      res.end();
    },
    setHeader(name, value) {
      res.setHeader(name, value);
    },
  };
  return ctx;
}

function send(res: ServerResponse, body: string, status: number, type: string): void {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.end(body);
}

/** True if the socket is still writable (not closed). */
export function isAlive(socket: Socket | undefined): boolean {
  return !!socket && !socket.destroyed && socket.writable;
}