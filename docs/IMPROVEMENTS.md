# BhooAI Nexus — Improvements & Suggested Next Steps

This document records (a) improvements already made over the obvious/naive approach while building the framework, and (b) concrete next steps that would take Nexus from a runnable developer platform to production-hardened. The current runtime uses a project-root `.env`, a user-owned `nexus.config.ts`, a gitignored `nexus.runtime.json`, and a Windows-safe process-tree supervisor. Each item is honest about the current seam.

---

## A. Improvements already made during the build

### Architecture
- **Scoped packages over a mega-package.** The framework is split into 14 `@bhooai/nexus-*` packages so the frontend can tree-shake and each subsystem is independently testable, instead of one barrel that re-exports everything.
- **Custom supervisor instead of `concurrently`/`pm2`.** `bin/nexus.js dev` owns the four child processes (backend, frontend, ai-server, admin), streams prefixed colored logs, handles graceful Ctrl-C, and exposes a localhost control API (:7474) the admin app drives. This decouples admin from OS-specific process management — important on Windows.
- **`nexus.runtime.json` instead of AST patching.** The admin app writes overrides to a gitignored JSON file rather than rewriting the human-edited `nexus.config.ts` with `ts-morph`. The typed config stays clean; admin never touches source.
- **Single cross-service contract.** `contracts/ai-openapi.yaml` is the source of truth for the Node↔Python AI boundary; the Python server and the Node `nexus-ai-client` both derive from it, eliminating drift between terminals.

### Frontend CSS pipeline
- **`@bhooai/nexus-postcss` preset.** A framework-owned PostCSS preset packages the entire CSS build chain — `postcss-import` → `postcss-nested` → `tailwindcss` → `postcss-preset-env` → `autoprefixer` → `cssnano` (production only) — behind one `createPreset()` factory call. Scaffolded projects get Tailwind by default without hand-maintaining a plugin list. All 7 preset deps are MIT-licensed.
- **`theme.css` design tokens.** 22 CSS custom properties (`--nexus-bg`, `--nexus-ink`, `--nexus-surface`, `--nexus-accent`, `--nexus-mesh`, etc.) on `:root` provide a consistent dark theme baseline. 15 `--admin-*` aliases map to their `--nexus-*` equivalents for backwards compatibility with existing admin CSS. Apps opt in with `@import '@bhooai/nexus-postcss/theme.css'`.
- **Plugin resolution inside the preset.** Plugins are imported and instantiated within `@bhooai/nexus-postcss` (not resolved from the consumer's `node_modules`), so scaffolded projects don't need `postcss-import`/`postcss-nested`/etc. installed directly.

### GraphQL (no Apollo)
- **`graphql` (graphql-js) core + a from-scratch federation layer.** Composition, supergraph SDL, a query planner (FetchNode DAG with `@key` entity joins, `@provides`/`@requires`), and a gateway executor — all ours. No `@apollo/*`, no `@graphql-tools/federation`.
- **In-process vs distributed execution behind one gateway interface.** A single-subgraph app pays no federation overhead (direct `execute()`); `nexus add subgraph` opts into federation. The naive sequential planner is correct before being clever.

### Data (custom ODM, no mongoose)
- **ODM on the official `mongodb` driver, self-contained validators** (no zod dependency in the data layer). Full middleware hooks, batched multi-level `populate` with `refPath`, `withTransaction` passthrough, auto-index creation at boot.
- **New-instance vs hydrate discipline.** `create()` builds `_isNew=true` instances so `save()` inserts; `hydrate()` marks `_isNew=false` for rehydration. This was a real bug class caught during the build.

### Security
- **CSRF on the WebSocket upgrade** (double-submit via query/`Sec-WebSocket-Protocol`), since WS has no CORS preflight — a gap most frameworks leave open.
- **Access tokens in memory, refresh in HttpOnly cookies** on the frontend — reduces XSS token theft vs. `localStorage`.
- **Double-submit CSRF with origin check** gated on a non-empty `trustedOrigins` list (so a single-origin deploy isn't accidentally locked out).

### Plugins
- **Real isolation via `worker_threads`** for sandboxed plugins (heap/event-loop isolation, crash can't take down the host) with a capability policy (fs path-allowlist, net host-allowlist, method caps) and a heartbeat watchdog. Trusted plugins run in-process for full Node API. Documented that this is not a cryptographic sandbox.

### AI
- **One OpenAI-compatible provider** for both OpenAI and Ollama (they speak the same API shape) — half the code of two separate clients. The Python server re-emits SSE with a `provider` tag and strips it before forwarding upstream; the Node client forwards it and the proxy re-emits over its own SSE.

### Payments / Crypto
- **Hand-rolled DER/ASN.1 encoder for CSR** (~400 lines) rather than pulling in `node-forge` — `node:crypto` creates keys/certs but not CSRs.
- **Injectable `HttpTransport`** on every payment provider — tests inject mocks, no live-gateway keys needed, and the provider abstraction is identical across Razorpay/PayPal/PayU/Skrill/Payoneer.

---

## B. Suggested next steps (production hardening)

### Federation
1. **Parallel query planner.** The current planner is a correct naive sequential executor. Replace the entity-join passes with a parallel FetchNode scheduler (fetch independent subgraphs concurrently, batch `_entities` by `__typename+keyFields`).
2. **Federation directive coverage.** Implement `@shareable` arbitration, `@override`, and `@inaccessible` enforcement — currently documented as a v1 subset (`@key`, `@external`, `@requires`, `@provides`, `@extends`).
3. **Subscription federation** — currently subscriptions run only on the single-subgraph gateway; federated subscriptions need a routing layer.
4. **Distributed mode hot-swap.** The registry/supergraph-store is designed but the in-process mode is the default; ship SDL polling + atomic schema swap for multi-instance deploys.

### ODM
5. **Query plan caching / DataLoader.** `populate` is batched but a per-request DataLoader would dedupe within a single resolver tree and cut N+1 to 1.
6. **Change stream support** for real-time cache invalidation and GraphQL subscription fan-out from Mongo.
7. **Lean cursors / streaming aggregation** to avoid materializing large result sets.
8. **Schema migrations.** Auto-index creation handles additive indexes; a migration runner is needed for renames/drops.

### Realtime / WebRTC
9. **Producer discovery API on the SFU.** Currently producers announce themselves over the broadcast channel (works, but races on join). Add a `getProducers` media action so a late joiner can consume existing producers without waiting for a re-announce.
10. **Room/transport lifecycle hardening** — band-aid the 8s client timeout with server-driven consumer close, and add ICE restart on failures.
11. **Horizontal-scale pub/sub** is wired (Redis adapter); verify fanout under multi-instance + sticky-session LB for WebRTC signaling.

### Security
12. **Redis-backed rate limit + session store in production** (in-memory today) so limits survive restarts and apply across instances.
13. **Refresh-token rotation already detects reuse; add a Redis denylist** for revoked-but-unexpired access tokens for instant logout across instances.
14. **Security headers audit** — add a CSP builder and `Permissions-Policy`; the current helmet-equivalent covers the basics.
15. **Plugin sandbox escape audit.** The worker sandbox is capability-gated but not cryptographic; document (and eventually add) child-process / OCI isolation for truly untrusted plugins.

### AI
16. **Token-usage accounting + cost guardrails** — parse upstream usage, bill per user/tenant, enforce per-key quotas.
17. **Streaming backpressure** — the proxy currently writes as fast as upstream sends; add flow control so a slow client doesn't balloon server memory.
18. **Provider failover** — `provider: 'auto'` picks one at startup; add per-request failover (OpenAI → Ollama) on upstream errors.

### Payments
19. **Idempotency keys** on create-order (Razorpay/PayPal support them) to make retries safe.
20. **Webhook replay protection** (timestamp + event-id dedup via Redis) so a redelivery doesn't double-fulfill.
21. **Full PayU/Skrill/Payoneer** — currently happy-path + sandbox tests; the weaker Node SDKs need raw-HTTP completion for capture/refund/verify.

### Frontend / Admin
22. **Route-level code-splitting** — the mediasoup-client bundle (~400KB) is loaded eagerly; lazy-load the LiveStream route.
23. **OAuth callback UX** — currently the backend redirects with `?token=`; promote to a same-page postMessage or a short-lived exchange code to avoid the token ever appearing in a URL/Referer.
24. **Admin live plugin install/uninstall** — the registry has load/unload; wire the admin UI to hot-toggle plugins at runtime.

### Ops / Release
25. **CI matrix** — run vitest + pytest on Windows and Linux (Playwright e2e gating the happy path).
26. **`nexus init` templates** — keep the scaffold in `packages/nexus-cli/templates/` as real files so generated apps remain complete and runnable.
27. **OpenTelemetry tracing** — request/trace IDs already propagate; emit spans to OTLP so the admin monitoring pane can show distributed traces.
28. **Container build** — a Dockerfile per terminal + a compose file that brings up Mongo/Redis and the four services for `nexus dev` parity.

---

## C. Honest seams in the current build

| Area | Seam | Why |
|------|------|-----|
| Plugins (sandbox) | Can't add GraphQL subgraphs (resolvers aren't serializable) | Use trusted mode for subgraphs |
| Plugins (sandbox) | Middleware registration is a no-op | Functions can't be serialized across worker boundary |
| Federation | `@shareable`/`@override`/`@inaccessible` not enforced | v1 subset; documented |
| Payments | PayU/Skrill/Payoneer are happy-path + sandbox only | Weak Node SDKs; full needs raw HTTP |
| Realtime | Producers self-announce (no discovery API) | Works for demo; races on late join |
| WebRTC | Requires the mediasoup native worker installed | Adapter skips gracefully if absent |
| Admin | Plugin page attribution tags `<plugin>` placeholder | Phase 10 seam; needs per-plugin id in manifest |

These are documented in code (`Phase X seam`) and above so they are not mistaken for missing features.
