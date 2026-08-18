# @bhooai/nexus-cache

Redis wrapper, cache-aside, pub/sub, and the Redis-backed rate-limit backend.

## Exports

- **Cache** — `new Cache({ url, keyPrefix })`. `get/set/del/incr` with TTL,
  cache-aside helpers, graceful no-op when Redis is unavailable.
- **RateLimiter** — `new RateLimiter({ windowMs, max })` (Redis-backed;
  in-memory fallback in `nexus-auth`).
- **PubSub** — publish/subscribe for WS fanout and inter-process events.

## Usage

```ts
import { Cache } from '@bhooai/nexus-cache';
const cache = new Cache({ url: 'redis://localhost:6379', keyPrefix: 'app' });
await cache.set('k', 'v', { ttl: 60 });
const v = await cache.get('k');
await cache.close();
```

Redis is **optional**: if the URL is unreachable the cache degrades to misses and
the server keeps running. Tests use a real Redis via `.env` (`NEXUS_REDIS_URL`).