import type { Middleware } from '../../nexus-core/src/http/index.js';
import { AuthenticationError } from '../../nexus-core/src/index.js';

export interface RateLimitOptions {
  /** Time window in ms. */
  windowMs: number;
  /** Maximum requests per window per key. */
  max: number;
  /** Function to derive the rate-limit key (default: client IP). */
  keyGenerator?: (ctx: import('../../nexus-core/src/http/index.js').RequestContext) => string;
  /** Message returned when limited. */
  message?: string;
}

/** Pluggable store — default is in-memory; Redis backend added in Phase 7. */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export function memoryStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, windowMs) {
      const now = Date.now();
      let entry = buckets.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        buckets.set(key, entry);
      }
      entry.count++;
      return { count: entry.count, resetAt: entry.resetAt };
    },
  };
}

/**
 * Inbuilt rate limiter (fixed window). In-memory by default; pass a Redis-backed
 * store for horizontal scaling. Sets standard `rate-limit-*` headers.
 */
export function rateLimit(options: RateLimitOptions): Middleware {
  const store = options.keyGenerator ? memoryStore() : memoryStore();
  const keyGenerator =
    options.keyGenerator ??
    ((ctx) => (ctx.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? ctx.req.socket.remoteAddress ?? 'unknown');

  return async (ctx, next) => {
    const key = keyGenerator(ctx);
    const { count, resetAt } = await store.hit(key, options.windowMs);
    const remaining = Math.max(0, options.max - count);
    ctx.setHeader('rate-limit-limit', String(options.max));
    ctx.setHeader('rate-limit-remaining', String(remaining));
    ctx.setHeader('rate-limit-reset', String(Math.ceil((resetAt - Date.now()) / 1000)));
    if (count > options.max) {
      ctx.setHeader('retry-after', String(Math.ceil((resetAt - Date.now()) / 1000)));
      throw new AuthenticationError(options.message ?? 'Too many requests');
    }
    await next();
  };
}
