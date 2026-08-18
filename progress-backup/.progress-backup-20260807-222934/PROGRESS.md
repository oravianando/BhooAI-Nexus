# Progress snapshot — 2026-08-07 22:29

Checkpoint of the BhooAI Nexus admin console work. Framework = source of truth at
`C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`; files are synced into each project
under `C:\server\BhooAI\BhooAI-Nexus\{MyFirstProject,sample-project,social-network}\`.

## Files in this snapshot
- `admin/src/App.tsx` — all pages, PageHero/PageHead, roles UI, Theme Centre v2, particles,
  Overview preflight panel
- `admin/src/index.css` — theme system, hero art, popups blur, particles, Theme Centre, preflight styles
- `admin/src/api.ts` — admin API + `runPreflight()` / preflight types
- `apps/backend/src/modules/admin/adminRoutes.ts` — /admin/* routes incl. preflight wiring
- `apps/backend/src/modules/admin/preflightProxy.ts` — NEW: POST /admin/preflight proxy → Python
- `apps/ai-server/main.py` — includes `preflight` router
- `apps/ai-server/routers/preflight.py` — NEW: POST /preflight concurrent connectivity/latency checks
- plus all prior backend/packages work (roles, databases, schema, env, per-project DB)

## Delivered: Increment 1 — Preflight diagnostics (DONE, built + synced)
Architecture pattern established: browser → Node backend (auth/CSRF) → Python (calculation).
Node composes targets from its own config; Python probes them concurrently.

- **Python** `apps/ai-server/routers/preflight.py`: `POST /preflight` accepts `{ targets: [{name,
  kind: http|tcp, url|host+port, timeout?}] }`; runs all checks concurrently via asyncio (httpx GET
  for http, `asyncio.open_connection` for tcp), measures latencyMs, aggregates into
  `{ ranAt, durationMs, passed, warnings, failed, checks[] }` with failed→slow→ok ordering and an
  800ms "slow" threshold → warnings. **Zero new deps** (stdlib + existing httpx). Registered in main.py.
- **Node** `preflightProxy.ts`: `POST /admin/preflight` (guard = bearer + admin role) builds targets:
  Backend API (`http://host:port/health`), AI server (`ai.serverUrl + /health`), GraphQL
  (`config.graphql.path`), MongoDB (TCP from `config.db.uri`, default 27017), Redis (TCP from
  `config.redis.url` when set). POSTs to Python with a 15s abort; returns report; on AI-server
  failure returns a synthetic failed report. Wired into adminRoutes.ts beside registerSchemaRoutes.
- **Admin**: `api.ts` `runPreflight()` + `PreflightReport/PreflightCheck` types; Overview gained a
  "Preflight diagnostics" panel with Run button, passed/warnings/failed badges, per-check
  latency/error rows. New `.preflight-*` CSS appended to index.css.

## Verification
- `python -m py_compile` on preflight.py + main.py passes (framework + all 3 projects).
- `npx tsc --noEmit -p apps/backend/tsconfig.json` — no errors in preflightProxy.ts/adminRoutes.ts.
- `npm run build` framework admin passes; `tsc -b && vite build` passes in all 3 project admins.

## Next increments (roadmap, not started)
1. ✅ Preflight diagnostics
2. Config/.env validation linter (Python `routers/lint.py`, /admin/lint/*)
3. Enhanced AI schema generation (move pydantic validation + type inference into Python)
4. Payments/Users reports + charts (pandas/matplotlib)
5. Log analytics + live SSE
6. Ops Copilot + (optionally) authenticated Mongo/Redis pings via pymongo/redis

## Notes
- No git repo (cannot commit); `.progress-backup-*` folders are the manual checkpoints.
- Earlier checkpoint `...-205008` = post-Theme-Centre v2 state; this one = after Increment 1.
- Pre-existing duplicate `databases` nav entry in App.tsx — still not fixed.
- Preflight treats Mongo/Redis as TCP-reachability only (authenticated ping deferred to increment 6).
- Backend has pre-existing TS6306 project-reference errors; `tsc --noEmit` here still isolated the
  new files cleanly; dev runs via tsx.

## Fix (after snapshot): ai-server module collision
- `ImportError: cannot import name 'settings' from 'config'` — the local `apps/ai-server/config.py`
  was being shadowed by the PyPI `config` package in user site-packages (Python 3.14).
- Fixed by renaming the local module `config.py` → `settings.py` and updating imports in
  `main.py`, `providers/base.py`, `tests/conftest.py` (now `from settings import ...`).
- Project ai-server copies were minimal stubs (only main.py + requirements.txt, missing
  providers/). Mirrored the full framework `apps/ai-server` into all three projects (caches excluded).
- Verified: `python -c "import main"` from sample-project/ai-server → `sample import OK port= 8000`;
  `py_compile` passes in all three; no `import config`/`from config` matches remain.

## Fix (after snapshot): `nexus pysetup` command
- New CLI command to install the Python AI-server deps (+ extras) via `node bin/nexus.js pysetup`.
- `packages/nexus-cli/src/commands/pysetup.ts`: finds `apps/ai-server/requirements.txt` (or
  `--requirements <path>` / cwd), resolves python (python/python3 or `--python <path>`), optional
  `--venv` (creates apps/ai-server/.venv), optional `--upgrade`, streams pip output, accepts extra
  packages as positional args (e.g. `nexus pysetup pytest pandas`).
- Wired into `packages/nexus-cli/src/index.ts`: `case 'pysetup'` + help line + re-export.
- Synced to all three projects' `packages/nexus-cli/src` (pysetup.ts + index.ts).
- Verified: `node bin/nexus.js pysetup pytest pytest-asyncio` from sample-project installed the
  extras successfully; framework `npx tsc --noEmit -p packages/nexus-cli` reports no errors in the new files.
