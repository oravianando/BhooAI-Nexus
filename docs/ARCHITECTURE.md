# BhooAI Nexus — Architecture

BhooAI Nexus is a source-first full-stack framework. A typed config file (`nexus.config.ts`), a project-root `.env`, and the `/bin` CLI drive four services under one supervisor: a Node backend, a React+Vite frontend, a Python (FastAPI) AI server, and a React admin app.

## Repository shape (npm workspaces)

```
BhooAI-Nexus/                      (container; no package.json)
└── bhooai-nexus/                  package/workspace root
    ├── package.json               workspaces root: packages/*, apps/*, admin
    ├── package-lock.json          workspace lockfile
    ├── bin/nexus.js                   CLI entry (loads @bhooai/nexus-cli via tsx, no build step)
    ├── nexus.config.ts                framework reference config
    ├── nexus.runtime.json             gitignored — admin write-back overrides
    ├── contracts/ai-openapi.yaml      Node↔Python AI contract (single source of truth)
    ├── packages/                      14 scoped framework packages
    │   ├── nexus-core        http (node:http, no express), router, middleware, config, DI
    │   ├── nexus-telemetry    structured logger, metrics, request/trace IDs
    │   ├── nexus-auth         CORS, CSRF, security headers, rate limit, JWT, OAuth, RBAC
    │   ├── nexus-data         custom ODM on the mongodb driver (no mongoose)
    │   ├── nexus-graphql      graphql-js + custom federation/gateway (no Apollo)
    │   ├── nexus-realtime     WS server, rooms, Redis pub/sub, WebRTC signaling, mediasoup SFU
    │   ├── nexus-payments     PaymentProvider + Razorpay/PayPal/PayU/Skrill/Payoneer + webhooks
    │   ├── nexus-email        SMTP (nodemailer) + templates + queue
    │   ├── nexus-crypto       RSA/EC keypair, X.509 self-signed, CSR (hand-rolled DER)
    │   ├── nexus-cache        Redis wrapper + cache-aside + rate-limit backend
    │   ├── nexus-ads          Google Ads REST client (GAQL)
    │   ├── nexus-ai-client    Node client for the Python AI server (SSE, retries, timeout)
    │   ├── nexus-plugins      plugin runtime: manifest, host, sandbox, hooks
    │   ├── nexus-postcss      opinionated PostCSS preset (Tailwind, nesting, preset-env, autoprefixer, cssnano) + theme.css design tokens
    │   └── nexus-cli          init, dev (supervisor), build, test, doctor
    ├── apps/
    │   ├── backend/           user backend built on @bhooai/nexus-* (modules + plugins)
    │   ├── frontend/          React+Vite+TS+Tailwind user-facing app
    │   └── ai-server/         Python FastAPI: OpenAI + Ollama
    ├── apps/admin/            admin app (React+Vite+TS) — grouped key/value config + env editors (themed, responsive), database/process control, plugins, users, monitoring
    ├── plugins/               user plugins (self-contained dirs with plugin.json)
    └── tests/                 cross-service Playwright e2e
```

### Frontend CSS pipeline

Both `apps/frontend` and `apps/admin` use Tailwind CSS via the framework-owned
`@bhooai/nexus-postcss` preset. The preset (`packages/nexus-postcss/src/plugins.js`)
loads six PostCSS plugins in order: `postcss-import` → `postcss-nested` → `tailwindcss`
→ `postcss-preset-env` (stage 2) → `autoprefixer` → `cssnano` (production only). A
`theme.css` stylesheet (`packages/nexus-postcss/src/theme.css`) defines 22 CSS custom
properties (`--nexus-bg`, `--nexus-ink`, `--nexus-surface`, `--nexus-accent`, etc.) on
`:root`, plus 15 `--admin-*` aliases for backwards compatibility. Scaffolded projects
import the tokens with `@import '@bhooai/nexus-postcss/theme.css'` at the top of their
`index.css`.

Run workspace commands from `bhooai-nexus/`. The parent directory only groups
the package and related local projects.

## Four terminals = one supervisor + control API

`bin/nexus.js dev` runs a custom supervisor (not `concurrently`/`pm2`) that owns the four child processes:

1. `apps/backend` (tsx watch) — :4000
2. `apps/frontend` (vite) — :3000
3. `apps/ai-server` (uvicorn --reload) — :8000
4. `apps/admin/` (vite) — :3001

The supervisor streams prefixed colored logs, handles graceful Ctrl-C, and exposes a **localhost HTTP control API** on :7474 (`GET /status`, `POST /start?name=...`, `POST /restart?name=...`, `POST /stop?name=...`, `GET /logs?name=...`, CORS-enabled). On Windows, stop/restart terminates the complete child process tree. Each process is also runnable standalone.

## Config precedence

Low → high: **code defaults < framework config < user `nexus.config.ts` < `nexus.runtime.json` (admin, gitignored) < `.env` / env vars < CLI flags.**

`@bhooai/nexus-core/config` loads the project `.env`, validates with zod, deep-merges, and exposes a typed object. The admin app writes **only `nexus.runtime.json`** so the human `nexus.config.ts` stays clean (no AST patching). Sections: server, uploads, db, redis, graphql, ws, auth, payments, email, certs, ads, webrtc, ai, plugins, logging.

## Request lifecycle (backend)

```
HTTP request
  → NexusServer (node:http)            securityHeaders → cors → static /uploads → bodyParser → csrf → rateLimit → router
  → Router (trie: params/wildcard/405)  per-route middleware: [authToken, requireRole, ...] then handler
  → handler(ctx)                       ctx.body (JSON/urlencoded/multipart), ctx.state.user, ctx.json/ctx.res
  → Server sends 404 if !ctx.res.writableEnded
```

`ctx.res` is the raw `ServerResponse` (used directly for SSE streaming: `writeHead` + `write` + `end`). Raw body is retained on `ctx.state.__rawBody` for webhook signature verification.

### File uploads

`bodyParser` buffers multipart requests and exposes `ctx.state.files`. The backend registers
`registerUploadRoutes` at `POST /uploads`; files are validated, renamed with generated UUID-based names,
and written below the configured project-local `uploads.dir`. `serveStatic` mounts that directory read-only
under `uploads.path`. The default request envelope is 12 MiB, the per-file limit is 10 MiB, and CSRF remains
enforced by the normal middleware pipeline. Projects should set `uploads.allowedTypes` and authentication
middleware for their own security requirements.

## Security (nexus-auth — one cohesive unit)

- **CORS**: preflight short-circuit, credentials, `Vary: Origin`.
- **CSRF**: double-submit token (HttpOnly cookie `nexus_csrf` + `x-csrf-token` header); safe methods mint a fresh token, unsafe methods do `checkOrigin` (trustedOrigins non-empty → 401 on missing/untrusted Origin) + double-submit match. **CSRF is also enforced on the WS upgrade** (query/`Sec-WebSocket-Protocol`) since WS has no CORS preflight.
- **Auth**: local (bcryptjs, JWT access+refresh rotation, httpOnly session cookies, Redis session store with reuse detection), Google (PKCE) + Facebook OAuth2 (state, token exchange, account linking), RBAC (role inheritance). First registered user is bootstrapped as admin.
- **Rate limiting**: fixed-window; in-memory now, Redis-backed in production.

## GraphQL (no Apollo)

`nexus-graphql` uses `graphql` (graphql-js) for parse/validate/execute. Composition, supergraph SDL, the query planner, and the gateway executor are ours — no `@apollo/*`, no `@graphql-tools/federation`.

```
defineSubgraph (SDL+resolvers, auto-wires _service/_entities, @key parse)
  → createGateway
      ├─ in-process: execute() against the built PUBLIC schema (federation directives stripped)
      └─ federated:  composeSupergraph → queryPlanner → executeFederated (FetchNode DAG, @key joins, @provides/@requires)
  → graphqlHttpHandler (POST/GET, introspection toggle) + SubscriptionServer (graphql-transport-ws over ws)
```

Federation subset (v1): `@key` (single + composite), `@external`, `@requires`, `@provides`, `@extends`, `_entities`, `_service { sdl }`. The app ships single-subgraph by default; `nexus add subgraph` opts into federation.

## Data (custom ODM, no mongoose)

`nexus-data` on the official `mongodb` driver. Self-contained validators (no zod). Connection/ConnectionManager, Schema (field opts incl. ref/refPath/select/immutable/expires/unique/index/transform), Model (find/findById/create/insertMany/update*/delete*/aggregate/bulkWrite/findOneAndUpdate), DocumentInstance (Proxy, save/remove/validate/populate, pre/post hooks, timestamps, strict, virtuals), chainable+thenable Query, batched multi-level populate, transactions (`withTransaction`). Auto-index creation at boot.

## Realtime + WebRTC (nexus-realtime)

- **WS server** (`ws`, noServer upgrade) with connection registry, room membership, pub/sub adapter (Memory + Redis for cross-instance fanout), auth on upgrade via `?token=`/subprotocol + optional CSRF origin check.
- **WebRTC signaling relay** over WS (offer/answer/candidate — direct if same-instance, else published to `conn:<to>`).
- **mediasoup SFU adapter** (lazy import, one worker/router-per-room, send/recv transports, produce/consume). The browser uses `mediasoup-client`; the frontend `stream.ts` wraps it over the realtime `media` action channel.

## Plugins (nexus-plugins)

Two modes: **trusted** (in-process, full Node API, dynamic-import entry) and **sandboxed** (`worker_threads` with capability-restricted RPC — real heap/event-loop isolation, crash can't take down the host).

```
PluginManifest { name, version, entry, mode, capabilities[], configSchema, hooks[], dependencies[] }
PluginHost: load(dir) → topoSort by deps (cycle detection) → runLifecycle(install→init→start→stop, stop reverses)
PluginContext: http/graphql/data/auth/realtime/scheduler/events/admin registrars (capability-gated in sandbox)
capabilityPolicy: METHOD_CAPABILITY map + fs path-allowlist + net host-allowlist + authorize()
AdminExtensions: registerPage/registerSlot → grouped pages + ordered slots
```

The sandbox bootstrap is plain `.mjs` (Node runs it directly in the worker, no TS loader). The host drives ALL lifecycle hooks including `install`. Documented v1 seams: sandboxed plugins can't add GraphQL subgraphs (resolvers aren't serializable); sandboxed middleware is a no-op.

## Payments (nexus-payments)

`PaymentProvider` interface (createOrder/capture/refund/getOrderStatus/verifyWebhook) with an injectable `HttpTransport` (tests inject mocks — no live gateways). Razorpay + PayPal are full; PayU/Skrill/Payoneer are happy-path + sandbox tests. `WebhookRouter` dispatches by `:provider` param with per-provider signature verification. Browser-facing `/payments/order` routes are auth+CSRF guarded; webhooks stay separate.

## Cross-service contract (contracts/)

`ai-openapi.yaml` (OpenAPI 3.1) is the single source of truth for the Node↔Python AI boundary. The Python FastAPI server and the Node `nexus-ai-client` both conform to it. The browser never talks to Python directly — Node proxies/re-emits SSE. Both OpenAI and Ollama speak the OpenAI-compatible API → one `OpenAICompatibleProvider` parameterised by `base_url`+`api_key`.

## Telemetry (nexus-telemetry)

Structured JSON logger (stdout + rotating file, child loggers, redaction), metrics registry (counters/histograms, `/metrics`), request/trace-ID propagation across Node→WS→Python. Admin monitoring consumes this.

## Testing

- **Vitest** per Node package (real MongoDB via `.env` — no embedded Mongo) + **pytest** for the AI server + **Playwright** for cross-service e2e.
- Each phase ships runnable + tested. See `docs/IMPROVEMENTS.md` for honest seams and next steps.
