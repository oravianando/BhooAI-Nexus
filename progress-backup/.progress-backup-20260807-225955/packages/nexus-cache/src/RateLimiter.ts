import type { Cache } from './Cache.js';
import type { RateLimitResult, RateLimitRule } from './types.js';

/**
 * Fixed-window counter rate limiter backed by Redis INCR via a {@link Cache}.
 * Each call to {@link RateLimiter.check} atomically increments a per-key
 * counter and, on the first hit of a window, sets the window expiry.
 */
export class RateLimiter {
  constructor(private cache: Cache) {}

  /**
   * Check (and consume) one unit against the rule for `key`. Redis INCR both
   * increments and returns the count, so the counter is consumed regardless of
   * whether the request is allowed — matching the in-memory store semantics.
   */
  async check(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const redisKey = `${key}:rate`;
    const count = await this.cache.incr(redisKey, rule.windowSeconds);
    const limit = rule.max;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    // Use the live TTL to compute resetAt; falls back to now + window.
    let ttl = await this.cache.ttl(redisKey);
    if (ttl < 0) ttl = rule.windowSeconds;
    const resetAt = Date.now() + ttl * 1000;
    const result: RateLimitResult = {
      allowed,
      limit,
      remaining,
      resetAt,
    };
    if (!allowed) {
      result.retryAfter = rule.windowSeconds;
    }
    return result;
  }

  /** Alias of {@link check}; the counter is already consumed by INCR. */
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    return this.check(key, rule);
  }
}