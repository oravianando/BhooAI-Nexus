# @bhooai/nexus-core

The framework core: config loading with full precedence, a dependency-injection
container, typed error classes, and the inbuilt HTTP server.

## Exports

- **config** — `loadConfig({ root })` resolves defaults < `nexus.config.ts` <
  `nexus.runtime.json` < `NEXUS_*` env vars into a typed `NexusConfig`.
- **http** — `Router`, `NexusServer` (custom `node:http` server with a trie router,
  params/wildcards, and a middleware pipeline), `bodyParser`, `RequestContext`.
- **di** — `Container` (the inbuilt DI used by the plugin host and services).
- **errors** — `HttpError`, `ValidationError`, `AuthenticationError`,
  `ConflictError`, `NotFoundError`, etc.

## Usage

```ts
import { loadConfig, Router, NexusServer, bodyParser } from '@bhooai/nexus-core';

const router = new Router();
router.get('/health', (ctx) => ctx.json({ status: 'ok' }));

const server = new NexusServer({
  router,
  middleware: [bodyParser()],
});
await server.listen(4000, '0.0.0.0');
```

There is **no `server.use()`** — middleware is the `middleware` array passed to the
`NexusServer` constructor. Route middleware is the 3rd argument to `router.method`,
as an array, and runs before the handler.

See `apps/backend/src/main.ts` for the full bootstrap.