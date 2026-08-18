import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { Cache, RateLimiter, PubSub } from '../src/index.js';
import type { Cache as CacheType } from '../src/index.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function connectOrSkip(): Promise<CacheType | null> {
  const c = new Cache({ url: REDIS_URL, connectTimeout: 2000, namespace: 'nexus-cache-test' });
  try {
    await c.ensureConnected();
    return c;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[nexus-cache tests] Redis unavailable, skipping live tests:', (e as Error).message);
    return null;
  }
}

// Top-level await so `cache` is populated before describe bodies register tests.
const cache = await connectOrSkip();

afterEach(async () => {
  if (cache) {
    // Clean all test keys between tests.
    try {
      await cache.flushPattern('*');
    } catch {
      /* ignore */
    }
  }
});

afterAll(async () => {
  if (cache) {
    try {
      await cache.flushPattern('*');
    } catch {
      /* ignore */
    }
    await cache.close();
  }
});

/** Helper: run `fn` only when redis is available, else skip. */
function itif(name: string, fn: () => Promise<void>): void {
  if (cache) {
    it(name, fn);
  } else {
    it.skip(name, fn);
  }
}

describe('Cache: get / set / del', () => {
  itif('set/get round-trip of a JSON object', async () => {
    const c = cache!;
    await c.set('obj', { a: 1, b: ['x', 'y'] });
    const got = await c.get<{ a: number; b: string[] }>('obj');
    expect(got).toEqual({ a: 1, b: ['x', 'y'] });
  });

  itif('get miss returns undefined', async () => {
    const c = cache!;
    const got = await c.get<{ x: number }>('does-not-exist');
    expect(got).toBeUndefined();
  });

  itif('del removes the key', async () => {
    const c = cache!;
    await c.set('todelete', { v: 1 });
    expect(await c.get('todelete')).toEqual({ v: 1 });
    await c.del('todelete');
    expect(await c.get('todelete')).toBeUndefined();
  });
});

describe('Cache: TTL', () => {
  itif('set with ttl=1s expires after 1100ms', async () => {
    const c = cache!;
    await c.set('temp', { n: 42 }, 1);
    expect(await c.get('temp')).toEqual({ n: 42 });
    await new Promise((r) => setTimeout(r, 1100));
    expect(await c.get('temp')).toBeUndefined();
  });
});

describe('Cache: incr', () => {
  itif('starts at 1, increments, sets ttl on first hit, restarts after window', async () => {
    const c = cache!;
    const first = await c.incr('counter', 2);
    expect(first).toBe(1);
    const second = await c.incr('counter', 2);
    expect(second).toBe(2);
    // After window expiry the key should be gone and INCR restarts at 1.
    await new Promise((r) => setTimeout(r, 2200));
    const restarted = await c.incr('counter', 2);
    expect(restarted).toBe(1);
  });
});

describe('Cache: cacheAside', () => {
  itif('miss calls loader and caches; second call does not call loader', async () => {
    const c = cache!;
    let calls = 0;
    const loader = async () => {
      calls++;
      return { hello: 'world' };
    };
    const r1 = await c.cacheAside('aside', 10, loader);
    expect(r1).toEqual({ hello: 'world' });
    expect(calls).toBe(1);
    const r2 = await c.cacheAside('aside', 10, loader);
    expect(r2).toEqual({ hello: 'world' });
    expect(calls).toBe(1);
  });
});

describe('RateLimiter.check', () => {
  itif('allows up to max then denies; allows again after window', async () => {
    const c = cache!;
    const limiter = new RateLimiter(c);
    const rule = { windowSeconds: 2, max: 3 };
    const r1 = await limiter.check('ip', rule);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    const r2 = await limiter.check('ip', rule);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
    const r3 = await limiter.check('ip', rule);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
    const r4 = await limiter.check('ip', rule);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfter).toBeDefined();
    // After window expires the counter resets and a request is allowed again.
    await new Promise((r) => setTimeout(r, 2200));
    const r5 = await limiter.check('ip', rule);
    expect(r5.allowed).toBe(true);
    expect(r5.remaining).toBe(2);
  });
});

describe('PubSub', () => {
  itif('publish reaches a subscribed handler with parsed payload', async () => {
    const c = cache!;
    const pubsub = new PubSub(c);
    const received = new Promise<unknown>((resolve) => {
      void pubsub.subscribe('test', (msg) => resolve(msg));
    });
    // Give the subscription a moment to register.
    await new Promise((r) => setTimeout(r, 50));
    await pubsub.publish('test', { hello: 'pubsub' });
    const msg = await received;
    expect(msg).toEqual({ hello: 'pubsub' });
    await pubsub.close();
  });
});

describe('Cache: flushPattern', () => {
  itif('removes matching keys and leaves others', async () => {
    const c = cache!;
    // Use namespaced names so the prefix is applied.
    await c.set('ns:a', 1);
    await c.set('ns:b', 2);
    await c.set('other', 3);
    const removed = await c.flushPattern('ns:*');
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await c.get('ns:a')).toBeUndefined();
    expect(await c.get('ns:b')).toBeUndefined();
    expect(await c.get('other')).toEqual(3);
  });
});

describe('Cache: exists / expire / ttl', () => {
  itif('exists reports presence, expire sets ttl, ttl reports remaining', async () => {
    const c = cache!;
    await c.set('k', 'v');
    expect(await c.exists('k')).toBe(true);
    expect(await c.exists('missing')).toBe(false);
    await c.expire('k', 5);
    const t = await c.ttl('k');
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(5);
  });
});