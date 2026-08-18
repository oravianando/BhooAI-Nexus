# Plan: `docs/learn/` step-by-step build guide + interactive playgrounds

## Deliverable
1. **`docs/learn/`** — index + 13 chapter pages walking through every module of BhooAI Nexus (full code walkthrough, every source file explained with annotated excerpts).
2. **Hybrid playground** on **all 15 `docs/api/*` pages and all 14 `docs/learn/*` pages** to run the code.

## Part A — Learn section

| Page | Covers |
|---|---|
| `learn/index.html` | Overview, 4-terminal model, build order, reading guide |
| `01-foundation` | Workspace + `nexus-core` (config, di, errors, http server/router/context/bodyParser/static/uploads) |
| `02-security` | `nexus-auth` (cors, csrf, headers, rateLimit, jwt, session, rbac, password, oauth, middleware) + `nexus-telemetry` |
| `03-data` | `nexus-data` (connection, schema, model, query, populate, projects) |
| `04-graphql` | `nexus-graphql` (subgraph, federation, gateway, subscriptions) |
| `05-realtime` | `nexus-realtime` (server, pub/sub adapters, mediasoup SFU) |
| `06-payments-email-crypto` | `nexus-payments`, `nexus-email`, `nexus-crypto` |
| `07-cache-ads` | `nexus-cache`, `nexus-ads` |
| `08-ai` | `nexus-ai-client` + `apps/ai-server` Python + `contracts/ai-openapi.yaml` |
| `09-plugins` | `nexus-plugins` (manifest, host, sandbox, HookBus, admin ext) |
| `10-cluster` | `nexus-cluster` (agent, registry, lb, autoscaler, manager, client, ai) |
| `11-cli` | `nexus-cli` (supervisor, commands, config-sync, dotenv, templates) |
| `12-apps` | `apps/backend`, `apps/frontend`, `apps/admin`, `bin/nexus.js`, Docker |
| `13-tests` | vitest suites, backend integration, pytest, Playwright e2e |

Each chapter: purpose → file-map table (every file, one-line "what it does") → annotated code walkthrough with `.kw/.str/.com/.num` highlighting → callouts → cross-links to `docs/api/*.html`.

## Part B — Hybrid playground

### Shared assets
- **`docs/assets/playground.js`** — `window.NexusPlayground`:
  - `mount(el, config)` → editor textarea, mode tabs, Run + Reset buttons, output pane.
  - `initAll()` → auto-initialize every `[data-playground]`.
  - **JS Sandbox**: `<iframe sandbox="allow-scripts">` with `srcdoc`; shim captures `console.log`/errors via `postMessage`; parent renders.
  - **Live API**: `fetch` against per-page `apiBase` (default `http://localhost:4000`); CSRF flow (GET `/csrf-token` → send `x-csrf-token`); graceful down-hint.
- **`docs/assets/style.css`** additions — `.playground`, editor, tabs, buttons, output pane.

### Embedding
Each API + learn page gets a `Try it live` section: `<section data-playground='{...}'></section>` with curated JS + API snippets per module.

### SPA integration (`docs/assets/docs.js`)
- Add **"Learn"** group to `NAV`.
- Fix logo path for `/learn/`.
- After `loadRoute()` replaces `#content`, call `window.NexusPlayground?.initAll()`; also on `DOMContentLoaded`.

### Notes
- Sandbox snippets are plain JS (browser-runnable) even where walkthrough code is TS.
- No external deps; hand-rolled.

## Execution order
1. `docs/assets/playground.js` + `style.css` additions.
2. `docs/assets/docs.js` NAV/logo/init hook + `index.html` "Learn" link.
3. `docs/learn/index.html`, then chapters 01→13 with walkthrough + playground.
4. Add `data-playground` blocks to all 15 `docs/api/*.html` pages.
5. Final verify.

## Verify
- Playground JS mode runs offline; API mode hits `:4000`/`:8000` when up.
- All 29 pages render + SPA-navigate; code excerpts match source.
