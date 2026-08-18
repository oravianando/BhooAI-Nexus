import type { Middleware } from '../../nexus-core/src/http/index.js';

export interface CorsOptions {
  /** Allowed origin(s): a string, an array, or true to reflect any origin. */
  origin?: string | string[] | boolean;
  /** Allowed methods. */
  methods?: string[];
  /** Allowed request headers. */
  allowedHeaders?: string[];
  /** Headers exposed to the browser. */
  exposedHeaders?: string[];
  /** Allow cookies / credentials. When true, origin cannot be "*". */
  credentials?: boolean;
  /** Preflight cache max age in seconds. */
  maxAge?: number;
}

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

/**
 * Inbuilt CORS middleware. Owns the OPTIONS preflight path entirely, sets
 * `Vary: Origin` for correct cache behavior, and enforces the credentialed
 * rule (no wildcard origin when credentials are enabled).
 */
export function cors(options: CorsOptions = {}): Middleware {
  const opts = {
    origin: options.origin ?? true,
    methods: options.methods ?? DEFAULT_METHODS,
    allowedHeaders: options.allowedHeaders,
    exposedHeaders: options.exposedHeaders,
    credentials: options.credentials ?? false,
    maxAge: options.maxAge ?? 600,
  };

  return async (ctx, next) => {
    const reqOrigin = (ctx.headers['origin'] as string) ?? '';
    const allowedOrigin = resolveOrigin(opts.origin, reqOrigin, opts.credentials);

    // Always vary by origin so caches don't leak the wrong CORS headers.
    appendVary(ctx, 'Origin');

    if (allowedOrigin) {
      ctx.setHeader('access-control-allow-origin', allowedOrigin);
      if (opts.credentials) ctx.setHeader('access-control-allow-credentials', 'true');
      if (opts.exposedHeaders?.length) {
        ctx.setHeader('access-control-expose-headers', opts.exposedHeaders.join(', '));
      }
    }

    if (ctx.method === 'OPTIONS' && ctx.headers['access-control-request-method']) {
      // Preflight: short-circuit
      ctx.setHeader('access-control-allow-methods', opts.methods.join(', '));
      const reqHeaders = (ctx.headers['access-control-request-headers'] as string) ?? '';
      ctx.setHeader('access-control-allow-headers', (opts.allowedHeaders ?? reqHeaders) || '*');
      ctx.setHeader('access-control-max-age', String(opts.maxAge));
      ctx.status(204);
      return;
    }

    await next();
  };
}

function resolveOrigin(
  config: string | string[] | boolean,
  requestOrigin: string,
  credentials: boolean,
): string | undefined {
  if (config === true) {
    // Reflect the request origin (works with credentials); no "*" when credentialed.
    return requestOrigin || (credentials ? undefined : '*');
  }
  if (typeof config === 'string') {
    if (config === '*') return credentials ? requestOrigin || undefined : '*';
    return config === requestOrigin ? config : undefined;
  }
  if (Array.isArray(config)) {
    return config.includes(requestOrigin) ? requestOrigin : undefined;
  }
  return undefined;
}

function appendVary(ctx: Parameters<Middleware>[0], value: string): void {
  const existing = ctx.res.getHeader('vary');
  if (existing === undefined) {
    ctx.setHeader('vary', value);
  } else {
    const merged = `${existing}, ${value}`;
    ctx.setHeader('vary', merged);
  }
}
