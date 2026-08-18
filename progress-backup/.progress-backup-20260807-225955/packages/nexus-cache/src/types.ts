/**
 * Options for constructing a {@link Cache} instance.
 */
export interface CacheOptions {
  /** Redis connection URL (e.g. `redis://localhost:6379`). */
  url?: string;
  /** Logical namespace applied to all keys as `${namespace}:` prefix. */
  namespace?: string;
  /** Explicit key prefix (overrides namespace prefix when provided). */
  keyPrefix?: string;
  /** Connection timeout in milliseconds passed to the redis client. */
  connectTimeout?: number;
}

/**
 * A cached value entry (kept for symmetry; values are JSON-stringified as-is).
 */
export interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

/**
 * Result of a rate-limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed under the current window. */
  allowed: boolean;
  /** Maximum requests permitted in the window. */
  limit: number;
  /** Remaining requests in the current window (>= 0). */
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /** Seconds until the next request would be allowed (present when denied). */
  retryAfter?: number;
}

/**
 * Fixed-window rate-limit rule.
 */
export interface RateLimitRule {
  /** Window length in seconds. */
  windowSeconds: number;
  /** Maximum requests permitted per window. */
  max: number;
}