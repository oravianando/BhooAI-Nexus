# Progress snapshot — 2026-08-08 13:51

Checkpoint for the **"one file for every server host/port"** work. Source of truth:
framework at `C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`; live project
`node-1`; mirrors under `C:\server\BhooAI\BhooAI-Nexus\{MyFirstProject,sample-project,social-network}\`.

## User problem
- Wanted ONE place listing host/port of ALL servers; `nexus.config.ts` was incomplete.
- Asked to convert it to `nexus.config.js` with every section.
- Fresh `node-1` showed `[admin] vite http proxy error /csrf-token AggregateError ECONNREFUSED`
  — the admin/frontend Vite dev servers proxied the backend at a HARDCODED
  `http://localhost:4000`, but node-1's backend runs on `:4010`.

## Delivered
- **`node-1/nexus.config.js` (new, complete)** with every section — env, server,
  uploads, db, redis, graphql, ws, auth/jwt, payments, email, certs, ads, webrtc,
  ai, logging, plugins, frontend, admin, cluster. Host/port for every server in ONE
  file. Deleted `nexus.config.ts` (loader prefers `.ts`, would shadow the `.js`).
- **Dynamic Vite configs** — `admin/vite.config.ts` and `apps/frontend/vite.config.ts`
  now OPEN the same `nexus.config.{js}` at runtime (esbuild-compiled, discovery order
  ts>js>mjs>cjs, NEXUS_* env still wins), deriving: the dev-server `port`+`host` from
  `cfg.frontend/admin` AND every proxy target from `cfg.server.host/port` (mapping
  `0.0.0.0`/`::` → `127.0.0.1`). Verified: admin proxy target now
  `http://127.0.0.1:4010`, WS target `ws://127.0.0.1:4010`.
- **`trustedOrigins()`** in backend `main.ts` (framework template + all projects) now
  reads `config.frontend.port`/`config.admin.port` instead of hardcoded `:3000/:5174`.
- **AI server honors config** — `nexus dev` passes `AI_PORT=<port from cfg.ai.serverUrl>`
  to the Python server (`packages/nexus-cli/src/commands/dev.ts`), and the generated
  `apps/ai-server/main.py read `os.environ["AI_PORT",8000]`.
- **`.env.example`** updated (template + node-1) — points at `nexus.config(.js/.ts)` as the
  single place for host/port; `.env` for secrets/overrides only.
- **Framework template** `templates/nexus.config.ts` expanded to the complete set so new
  `nx` scaffolds start from a full, commented config.

## Verification
- `loadConfigAuto` reads node-1 config: `server 0.0.0.0:4010`, `frontend localhost:5173`,
  `admin localhost:5174`, `ai http://localhost:8010`, cluster enabled/lb 8080/agent 7575.
- Live proxy test: backend started on `:4010`, `/csrf-token` direct 200; started the
  admin Vite dev server and `http://localhost:5174/csrf-token` → **200** with a token
  JSON (ECONNREFUSED gone).
- Admin build clean in framework + mirrors (identical assets `index-F8IUcLPp.css` /
  `index-CdL9Q-m2.js`); node-1 frontend build clean (29 modules).
- `dev.ts` hash identical across framework + node-1 + 3 mirrors.
- Only lingering `tsc` noise is the pre-existing backend errors (adminRoutes.ts line 124,
  aiProxy.ts provider typing, userGraph.ts UserInstance map, nexus-data Document/oauth) —
  none from this change.

## Notes
- `node-1/.env` intentionally holds only the JWT secret — ports all come from config.
- A user's own backend (`tsx watch apps/backend/src/main.ts` in `my-app`, PID 30776) was
  left untouched.
- Prior checkpoints: `-20260808-123706` (init `--as=root|node`), `-20260808-121945`
  (mesh M1–M6 e2e), `-104708` (preflight Node probes).
- Next roadmap item: Incr 3 enhanced AI schema generation (flakey-node fencing,
  conda-free ai-server packaging as optional follow-ups).