import { createClient, type RedisClientType } from 'redis';
import type { CacheOptions } from './types.js';

/**
 * Redis-backed cache wrapper. Lazily creates and connects a `node-redis`
 * client on first use. All keys pass through {@link Cache.key} to apply an
 * optional namespace/prefix.
 */
export class Cache {
  private client: RedisClientType;
  private connectPromise: Promise<void> | null = null;
  private readonly keyPrefix: string;
  protected readonly url?: string;
  protected readonly connectTimeout?: number;

  constructor(opts: CacheOptions = {}) {
    this.url = opts.url;
    this.connectTimeout = opts.connectTimeout;
    this.keyPrefix = opts.keyPrefix ?? (opts.namespace ? `${opts.namespace}:` : '');
    // `redis` v4 createClient returns a client in a closed state; we connect
    // lazily on first use via ensureConnected().
    this.client = createClient({
      ...(this.url ? { url: this.url } : {}),
      ...(this.connectTimeout != null ? { socket: { connectTimeout: this.connectTimeout } } : {}),
    });
  }

  /** Connect the underlying client if not already connected. Idempotent. */
  async ensureConnected(): Promise<void> {
    if (this.client.isOpen) return;
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().then(() => {
        // connected
      });
    }
    try {
      await this.connectPromise;
    } catch (err) {
      // Reset so a later retry can attempt reconnection.
      this.connectPromise = null;
      throw err;
    }
  }

  /** Build the fully-prefixed redis key for a logical name. */
  key(name: string): string {
    return `${this.keyPrefix}${name}`;
  }

  /** The underlying redis client (connected after `ensureConnected`). */
  protected getClient(): RedisClientType {
    return this.client;
  }

  /** Get a JSON-decoded value, or undefined on miss/null. */
  async get<T>(name: string): Promise<T | undefined> {
    await this.ensureConnected();
    const raw = await this.client.get(this.key(name));
    if (raw == null) return undefined;
    return JSON.parse(raw) as T;
  }

  /** Set a JSON-encoded value, optionally with a TTL in seconds. */
  async set<T>(name: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.ensureConnected();
    const encoded = JSON.stringify(value);
    if (ttlSeconds != null) {
      await this.client.set(this.key(name), encoded, { EX: ttlSeconds });
    } else {
      await this.client.set(this.key(name), encoded);
    }
  }

  /** Delete a key. */
  async del(name: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(this.key(name));
  }

  /**
   * INCR a key. When `ttlSeconds` is supplied and the result becomes 1 (first
   * hit in a fresh window) the key is expired after `ttlSeconds` seconds.
   * Returns the post-increment integer value.
   */
  async incr(name: string, ttlSeconds?: number): Promise<number> {
    await this.ensureConnected();
    const key = this.key(name);
    const count = await this.client.incr(key);
    if (ttlSeconds != null && count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }

  /** Whether a key exists. */
  async exists(name: string): Promise<boolean> {
    await this.ensureConnected();
    const n = await this.client.exists(this.key(name));
    return n > 0;
  }

  /** Set an expiry (seconds) on an existing key. */
  async expire(name: string, ttlSeconds: number): Promise<void> {
    await this.ensureConnected();
    await this.client.expire(this.key(name), ttlSeconds);
  }

  /** Remaining TTL in seconds (-1 no expiry, -2 missing key). */
  async ttl(name: string): Promise<number> {
    await this.ensureConnected();
    return this.client.ttl(this.key(name));
  }

  /**
   * Delete all keys matching a glob pattern using non-blocking SCAN + DEL.
   * Returns the number of keys removed.
   */
  async flushPattern(pattern: string): Promise<number> {
    await this.ensureConnected();
    const fullPattern = `${this.keyPrefix}${pattern}`;
    let cursor = 0;
    let removed = 0;
    do {
      const reply = await this.client.scan(cursor, { MATCH: fullPattern, COUNT: 100 });
      cursor = Number(reply.cursor);
      const keys = reply.keys;
      if (keys.length > 0) {
        await this.client.del(keys);
        removed += keys.length;
      }
    } while (cursor !== 0);
    return removed;
  }

  /**
   * Cache-aside helper: return the cached value if present, otherwise invoke
   * `loader`, store its result with `ttlSeconds`, and return it. No negative
   * caching in v1 — loader errors propagate to the caller.
   */
  async cacheAside<T>(name: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(name);
    if (cached !== undefined) return cached;
    const fresh = await loader();
    await this.set(name, fresh, ttlSeconds);
    return fresh;
  }

  /** Disconnect the underlying client. */
  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
    this.connectPromise = null;
  }
}