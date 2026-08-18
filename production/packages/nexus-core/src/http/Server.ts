import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Middleware, RequestContext } from './context.js';
import { createContext } from './context.js';
import type { Router } from './Router.js';
import { NexusError, toNexusError } from '../errors.js';

/** Generate a request id (overridable for tests/injection). */
export function newRequestId(): string {
  return randomUUID();
}

export interface ServerOptions {
  router: Router;
  /** Global middleware run before routing. */
  middleware?: Middleware[];
  /** Trust X-Forwarded-* headers (boolean or hop count). */
  trustProxy?: boolean | number;
  /** Maximum request body size in bytes. */
  bodyLimit?: number;
  /** HTTPS cert/key paths (enables TLS when both present). */
  certFile?: string;
  keyFile?: string;
  /** Called for each error to produce a JSON error body. */
  onError?: (err: NexusError, ctx: RequestContext) => unknown;
}

/**
 * Inbuilt HTTP server built on node:http (no express). Runs a middleware
 * pipeline, dispatches to the router, propagates request/trace ids, and
 * supports graceful shutdown.
 */
export class NexusServer {
  private server: HttpServer;
  private middleware: Middleware[];
  private opts: ServerOptions;

  constructor(opts: ServerOptions) {
    this.opts = { trustProxy: false, bodyLimit: 1024 * 1024, ...opts };
    this.middleware = opts.middleware ?? [];
    const handler = (req: IncomingMessage, res: ServerResponse) => this.handle(req, res);
    if (opts.certFile && opts.keyFile) {
      this.server = createHttpsServer(
        { cert: readFileSync(opts.certFile), key: readFileSync(opts.keyFile) },
        handler,
      );
    } else {
      this.server = createServer(handler);
    }
  }

  use(mw: Middleware): this {
    this.middleware.push(mw);
    return this;
  }

  listen(port: number, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, host, () => resolve());
    });
  }

  get address() {
    return this.server.address();
  }

  /** The underlying node:http(s) server (for attaching WebSocket upgrades, etc.). */
  get httpServer(): HttpServer {
    return this.server;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = (req.headers['x-request-id'] as string) ?? newRequestId();
    res.setHeader('x-request-id', requestId);
    const ctx = createContext(req, res, requestId);

    try {
      await this.runPipeline(ctx);
    } catch (err) {
      this.handleError(err, ctx);
    }
  }

  private async runPipeline(ctx: RequestContext): Promise<void> {
    const stack = [...this.middleware, this.dispatchMiddleware()];
    let i = 0;
    const next = async () => {
      const mw = stack[i++];
      if (mw) await mw(ctx, next);
    };
    await next();

    if (!ctx.res.writableEnded) {
      ctx.status(404);
    }
  }

  private dispatchMiddleware(): Middleware {
    return async (ctx, next) => {
      const match = this.opts.router.match(ctx.method, ctx.path);
      if (!match) {
        await next();
        return;
      }
      ctx.params = match.params;
      ctx.routePattern = match.pattern;
      // Run route middleware then the handler.
      let i = 0;
      const routeStack = [...match.middleware, match.handler];
      const routeNext = async () => {
        const fn = routeStack[i++];
        if (fn) await fn(ctx, routeNext);
      };
      await routeNext();
      await next();
    };
  }

  private handleError(err: unknown, ctx: RequestContext): void {
    if (ctx.res.writableEnded) return;
    const ne = toNexusError(err);
    const body = this.opts.onError ? this.opts.onError(ne, ctx) : defaultErrorBody(ne);
    if (!ctx.res.headersSent) {
      ctx.res.statusCode = ne.statusCode;
      ctx.res.setHeader('content-type', 'application/json; charset=utf-8');
    }
    ctx.res.end(JSON.stringify(body));
  }
}

function defaultErrorBody(err: NexusError): unknown {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}
