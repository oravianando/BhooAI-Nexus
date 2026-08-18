# Progress snapshot — 2026-08-11

Admin cluster controls, node-agent lifecycle routes, token visibility, slave
route propagation, pairing celebration, autoscaler messaging, and docs complete.
Source of truth: framework at
`C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`.

## Latest milestone: pairing celebration + autoscaler messaging + docs (2026-08-11)

### Pairing success celebration
- Successful cluster link now shows a full-screen **CONGRATULATIONS** overlay with
  ~28 CSS-animated flying ribbons (pure CSS — no new dependencies).
- Overlay is transparent with a light black tint; fades/scales in on mount and
  out on dismiss; respects `prefers-reduced-motion`.
- **No auto-dismiss** — it stays until the user clicks "Awesome — continue".
- Shows the linked slave's fetched identity: **project** (from the slave's
  `package.json` name via new `NodeIdentity.project`), node id, role, version,
  agent URL, and each service URL.
- `NodeIdentity` gained a `project` field (`packages/nexus-cluster/src/types.ts`);
  the node agent reports it via `projectName()` in `/info`.

### Admin polish
- All success/info messages now render green (emerald) instead of amber
  ("Node linked successfully", "Token generated — …", etc.). Error alerts stay
  rose/red.

### Autoscaler messaging
- `[cluster] want scale-up but no standby backend node` was informational but
  spammy (every 10s tick). Reworded to an actionable message and rate-limited to
  once per minute (`packages/nexus-cluster/src/manager.ts`).

### Docs
- `docs/guides/guide-cluster.html` troubleshooting expanded with:
  - "no standby backend node" autoscaler message — how to actually enable scaling
  - stale `nexus.runtime.json` `cluster.enabled: false` override
  - 404 on `/admin/cluster/node/start` / `generate-token` (stale backend routes)
  - masked token `5b5b…a194` (old backend process)
  - Slave-mode node start/stop buttons + Master-mode controls documented
  - Pairing success celebration documented
- Replaced the ASCII "mesh at a glance" diagram with a styled HTML/CSS box diagram
  (`.mesh` styles in `docs/assets/style.css`): master node + LB + autoscaler on
  top, two slave nodes below, agent ports + per-node tokens, round-robin tip.
- Removed the "admin shows a masked token like 5b5b…a194" troubleshooting block
  (fixed — token now returned unmasked).
- Docs now use the default agent port `7575` everywhere (the `7576` examples were
  a single-server test artifact). Port-override examples still show `--port=7576`.
- Added "2b. Multiple nodes on a single device" section to
  `docs/guides/guide-cluster.html`: Option A (separate `nexus init` project
  folders per node — recommended) and Option B (one project, multiple agents via
  `--port` override — id-collision caveat). Mesh diagram slave cards + tip now
  show distinct agent ports and the single-device note.
- `packages/nexus-cluster/README.md` gained the same single-device multi-node
  walkthrough.

### Postman doc screenshots
- Generated 8 Postman-style screenshots (rendered via Edge headless from
  styled HTML mockups) into `docs/assets/screenshots/`:
  `01-collection`, `02-step1-csrf`, `03-step2-login`, `04-step3-link`,
  `05-error-fetch-failed`, `06-error-agent-401`, `07-error-401-csrf`,
  `08-env-runner` (all `.png`, 1280×720).
- `docs/learn/14-postman-testing.html`: replaced every `📸 Screenshot`
  placeholder with a real `<img>` pointing at `../assets/screenshots/*.png`.

### In-app Docs image loading fix
- The standalone docs shell renders each page in an iframe, so `../assets/...`
  image paths worked there. But the in-app Docs view
  (`apps/frontend/src/components/Docs.tsx`) fetches the page HTML and injects it
  into the app DOM, so relative asset URLs resolved against the frontend origin
  instead of `/docs/` — images failed to load.
- Added `absolutizeAssets(html, route)` in `Docs.tsx` that rewrites relative
  `src`/`href` (images, styles, scripts) to absolute `/docs/...` URLs against the
  current page's directory, and applied it in `loadPage`. Absolute, external,
  `#`-anchor, and `data:` URLs are left untouched. Frontend build passes.
- Replaced the ASCII "Visual Flow" box in `docs/learn/14-postman-testing.html`
  with a styled HTML/CSS request-flow diagram (three numbered step cards for
  GET /csrf-token → POST /auth/login → POST /admin/cluster/link with method
  chips, output bullets, and a CSRF-rotation warning footer). Verified via Edge
  headless render.
- Redesigned the Visual Flow diagram: vertical pipeline track with three step
  cards joined by connector arrows, plus a "security layers" strip (Cookie jar /
  JWT Bearer / Agent token badges) and the CSRF-rotation warning footer.
  Verified via Edge headless render.
- Redesigned the Visual Flow diagram again (v3): removed the redundant
  "Get CSRF Token" + "GET" duplication — each step card now shows the method
  chip (GET/POST), a short title, and the endpoint pill on the right; steps
  are laid out on a numbered vertical rail with connector lines, plus a
  caption line, the security-layers strip, and the CSRF warning footer.
  Verified via Edge headless render.
- Final Visual Flow v4: rendered as a **high-resolution PNG image**
  (`docs/assets/screenshots/visual-flow.png`, 1050×450) with a polished
  horizontal timeline design — three cards (CSRF Token → Login · Get JWT →
  Link Slave Node) with `⏵` connectors, gradient step-number badges (green &
  indigo), endpoint pills, output bullets, a three-badge security strip
  (Cookie jar / JWT Bearer / Agent token), and the CSRF-rotation warning
  footer. Pasted via `<img>` tag.

### CLI docs — wizard + uninstall
- `docs/api/cli.html`: updated exports table (`uninstall`), `init` description
  (replaced with 20-step wizard breakdown + full flag table), new `uninstall`
  section with flags, `pysetup --interactive` flag, programmatic-imports block.
- `docs/learn/11-cli.html`: added `wizard.ts` and `uninstall.ts` to the file
  map, new sections 0 (Wizard primitives), 1 (`nexus init` wizard with
  prerequisite scan, auto-detect token, pre-registration, security invariants,
  idempotency), 2 (`nexus uninstall` with three-step cleanup and Windows EPERM
  fallback). Renumbered remaining sections (3→4→5).

### Docs hero — animated background + floating particles
- `docs/index.html`: added `.hero-particles` container inside the hero card.
- `docs/assets/style.css`: replaced the static hero gradient with a 5-stop
  animated gradient (indigo → violet → fuchsia → cyan → teal at 260% size,
  14s `hero-gradient` keyframe). Added `.hero-particle` styles with a
  `hero-particle-drift` keyframe (translate + scale + opacity breathing via
  CSS custom properties `--x`, `--y`, `--dur`, `--delay`). Extended
  `prefers-reduced-motion` to disable hero + particle animation.
- `docs/assets/docs.js`: added `initHeroParticles()` — spawns ~16 soft-glowing
  dots inside `.hero .hero-particles` with random position, size (3–6px),
  duration (10–22s), negative delay, and a palette of cyan/violet/indigo/
  fuchsia/white at alpha 0.35–0.75. Gate-checked: no-ops on non-homepage
  renders. Verified via Edge-headless preview (83 color buckets, 362KB).

## Prior milestone: admin cluster controls + node-agent lifecycle (2026-08-11)

### Admin controls
- Removed master cluster Start/Stop controls from the top `Cluster` header.
- Added master `Start cluster` / `Stop cluster` controls beside the mode tabs.
- Added slave `Start node` / `Stop node` controls beside the mode tabs.
- Slave panel displays node ID, role, agent port, agent URL, full pairing token,
  copy/regenerate actions, and live agent status.
- Admin polls node-agent status every three seconds while Slave Mode is active.

### Node-agent lifecycle endpoints
Added to the framework backend, CLI scaffold template, and current test-app
backend:
- `GET /admin/cluster/node/status`
- `POST /admin/cluster/node/start`
- `POST /admin/cluster/node/stop`

The start endpoint launches the configured project's equivalent of:
`nexus node serve --role=backend --port=<cluster.nodeAgentPort>`.
The stop endpoint terminates the owned process tree on Windows via `taskkill`
and uses SIGTERM on Unix. Status also probes a manually started local agent,
so the UI does not report "stopped" when the agent was launched separately.

### Token and route fixes
- `/admin/cluster/setup` now returns the full pairing token instead of a masked
  prefix/suffix value.
- Added missing `POST /admin/cluster/generate-token` to the CLI template and
  current test-app/slave backends; it persists the token to
  `nexus.runtime.json` and updates the in-memory registry.
- Propagated the missing node-agent routes and token route to
  `test-app/test-app/test-app-slave-1`, which was previously returning 404.

### Verification
- Framework admin build passed.
- Backend route typechecks passed for framework, template, test-app, and
  test-app-slave-1 cluster route files.
- `nexus-cli` tests: **13/13 pass**.
- Current slave route now includes `/admin/cluster/node/start` and compiles.

## Prior milestone: cluster node visibility + Mongo persistence (2026-08-11)

### Admin "No nodes linked" after CLI `nexus cluster link`
**Root cause:** `NodeRegistry` loaded `cluster.runtime.json` once at
construction (`registry.ts:26`) and never re-read it. The CLI `nexus cluster
link` runs in a separate process and writes to that file, but the backend's
in-memory registry stayed empty — so `manager.list()` returned `[]` and the
admin overview showed "No nodes linked yet."

**Fix** in `packages/nexus-cluster/src/registry.ts`:
- `NodeRegistry` now tracks the file's `mtimeMs` and re-reads it on every
  `list()`/`get()` call when the mtime changed (`reloadIfChanged()`).
- When the CLI writes a node to `cluster.runtime.json`, the next
  `/admin/cluster/overview` call in the backend picks it up **without a
  restart**.
- `save()` updates the mtime cache so we don't redundantly reload our own
  writes.

### Cluster data persisted to MongoDB
**New collection:** `nexus_projects.cluster_nodes` — mirrors
`cluster.runtime.json` so cluster state is queryable from Mongo and survives
file loss.

**New `nexus-data` helpers** (`packages/nexus-data/src/projects.ts`):
- `upsertClusterNode(record)` — insert/update by `id` (unique index)
- `deleteClusterNode(id)` — remove by id
- `listClusterNodes()` — list all, sorted by role + id
- `syncClusterNodes(records)` — bulk upsert + delete orphans (full mirror)
- `ClusterNodeRecord` type (id, role, tier, version, baseUrl, services,
  status, enabled, registeredAt, lastSeenAt, lastHealth, lastMetrics,
  updatedAt)

**Wired into `clusterRoutes.ts`** (both the framework's and the template at
`packages/nexus-cli/templates/apps/backend/src/modules/admin/clusterRoutes.ts`):
- `GET /admin/cluster/overview` → `syncClusterNodes()` (mirrors current
  registry to Mongo on every read)
- `POST /admin/cluster/link` → `upsertClusterNode()` (adds the new node)
- `POST /admin/cluster/unlink` → `deleteClusterNode()` (removes from Mongo)
- `POST /admin/cluster/poll` → `syncClusterNodes()` (refreshes
  health/metrics in Mongo)

All Mongo writes are best-effort (`.catch(() => {})`) so a Mongo outage
doesn't break the cluster UI.

### Cluster token mismatch fix (node pairing)
**Root cause:** `nexus init --as=node` generated a fresh random token per
project, but the mesh requires the node and root to share the **same** pairing
token. The node's agent rejected the central's `/info` handshake with `401`.

**Fix** in `packages/nexus-cli/src/commands/init.ts`:
- `detectSiblingRootToken(target)` scans the parent directory for a sibling
  `nexus.config.*` with `cluster: { enabled: true, token: '...' }` and reuses
  it automatically (prints "reused cluster token from sibling root project").
- Interactive prompt for the token when no sibling root is found and
  `--cluster-token` wasn't passed.
- New `--cluster-token` flag for non-interactive/CI use.
- Root still generates a fresh token; node uses the supplied/detected one.
- `WizardChoices` gained a `clusterToken` field.

### Verification (all on 2026-08-11)
- Typecheck: clean for `nexus-cluster` (`registry.ts`), `nexus-data`
  (`projects.ts`), `nexus-cli` (`init.ts`), and the backend
  (`clusterRoutes.ts`).
- Tests: **13/13 pass** (`nexus-cli` vitest suite).
- `cluster.runtime.json` confirmed to contain the linked node
  (`205def6d4db0-backend`); the mtime-reload will make the backend's next
  overview call pick it up.
- Fixed `test-app-slave-1` token in place (`21b52ddd...` → `5b5bfde2...` to
  match the root).

## Prior milestone: CLI wizard + uninstall + project registry (2026-08-11)

### `nexus init` — all-in-one setup wizard
Turned `nexus init` into a single interactive command that leaves a fully
bootable stack (Node backend + frontend + admin + Python AI server + Mongo/Redis
wired + secrets + deps installed). Running it once means `npm run dev` starts
everything.

**New files:**
- `packages/nexus-cli/src/wizard.ts` — shared primitives (`prompt`, `confirm`,
  `select`, `multiSelect`, `promptHidden`, `banner`, `summaryTable`,
  `statusIcon`, `isInteractive`).
- `packages/nexus-cli/PLAN.md` — the wizard design plan (matches repo
  `PLAN.md` convention).

**Rewritten:**
- `packages/nexus-cli/src/commands/init.ts` — 20-step wizard flow: banner →
  prerequisite scan (node/npm/python/git + Mongo/Redis TCP with **retry/yes/no**
  loop) → project name → kind (root/node) → role+port → ports auto-allocate →
  Mongo URI → Redis URL → AI providers (multi-select + per-key prompt) → Python
  venv → review summary → scaffold → wire framework → allocate ports → patch
  config → generate `.env` (JWT + MONGODB_URI + REDIS_URL + AI_HOST=127.0.0.1 +
  AI keys + payments) → **register project in `nexus_projects.projects`** → npm
  install → pysetup → verify → next steps.
- `packages/nexus-cli/src/commands/pysetup.ts` — added `--interactive` flag
  (prompts for venv y/n + python path when TTY).
- `packages/nexus-cli/src/commands/doctor.ts` — refactored to use shared
  `scanRuntimes()` / `scanServices()` (no output change).
- `packages/nexus-cli/src/util.ts` — extracted `scanRuntimes()`,
  `scanServices()`, `isPortFree()`, `looksLikeProject()` (shared by doctor +
  init).
- `packages/nexus-cli/src/index.ts` — updated help text with new flags.
- `packages/nexus-cli/templates/package.json` — added `pysetup` + `uninstall`
  scripts.

**New flags:** `--name`, `--mongo-uri`, `--redis-url`, `--ai-providers`,
`--ai-key id=val`, `--venv`/`--no-venv`, `--no-interactive`, `--skip-mongo-check`.

**Bug fixes during wizard build:**
- `applyClusterConfig` bailed when the template already shipped a `cluster:`
  block → never set `enabled: true` or stamped a token. Rewrote to patch the
  existing line's `enabled` + `token` in place (token only stamped when empty,
  so re-runs don't invalidate already-paired nodes).
- `patchPackageName` added — the template ships `"name": "my-nexus-app"` but
  `resolveProjectInfo()` reads `package.json`'s `name` as the canonical project
  identity, so the wizard now stamps the user's chosen name into `package.json`
  before `wireFrameworkDependency` runs. Otherwise the admin sidebar showed "My
  Nexus App" and the `nexus_projects` record was orphaned under a mismatched
  name.
- Mongo/Redis down prompt upgraded from yes/no to **retry/continue/abort** so
  the user can start Redis in another terminal and re-probe without aborting.

**Security invariants:**
- Python AI server binds `127.0.0.1` (`AI_HOST=127.0.0.1` in `.env`) — only
  Node (same host) can reach it. Verify step asserts loopback.
- `.env` is the single secrets sink (JWT, Mongo URI, Redis URL, AI keys,
  cluster token). `nexus.config.ts` stays clean.
- Idempotent: re-running `nexus init .` updates config + `.env` without
  clobbering secrets.

### `nexus uninstall` — remove a project + its DBs
New command that drops the project's own MongoDB database, deletes its
`nexus_projects.projects` record, and optionally removes the project directory
(`--purge`).

**New files:**
- `packages/nexus-cli/src/commands/uninstall.ts` — three-step cleanup with
  `--dry-run`, `--force`, `--purge`, `--keep-db` flags. Non-fatal on Mongo
  down. Refuses to run non-interactively without `--force`.

**nexus-data helpers added:**
- `packages/nexus-data/src/projects.ts` — `deleteProjectInfo(name)` +
  `dropProjectDatabase(dbName)` (reuses the project-info connection's
  `MongoClient` so no second connection is needed).
- `packages/nexus-data/src/index.ts` — exported the new helpers.

**Windows EPERM fix:** `rmSync` throws `EPERM` on read-only files
(`node_modules/.bin`, `.venv`). The `removeDir()` helper in `uninstall.ts` does
three things: (1) recursively `chmod` to clear the read-only bit, (2) retry
`rmSync` up to 3× with backoff, (3) fall back to `cmd /c rd /s /q` (Windows) /
`rm -rf` (Unix). Verified with a read-only file that used to block deletion.

**CLI wiring:**
- `packages/nexus-cli/src/index.ts` — `uninstall` command + help text.
- `packages/nexus-cli/templates/package.json` — `"uninstall": "nexus uninstall"`.

### `nexus cluster serve` — self-heal stale runtime override
**Root cause:** the admin "stop cluster" button writes
`{"cluster":{"enabled:false}}` into `nexus.runtime.json` (`clusterRoutes.ts:222`).
That override beats `nexus.config.ts` in the loader precedence
(`runtime.json > userConfig`), so `nexus cluster serve` read `enabled:false`
and printed a misleading red error even though `nexus.config.ts` had
`enabled:true`.

**Fix** in `packages/nexus-cli/src/commands/cluster.ts`:
- `serve` now patches `nexus.runtime.json` to set `cluster.enabled = true`
  before starting (prints "cluster was disabled in nexus.runtime.json —
  re-enabling" instead of the error).
- The warning now only fires for non-`serve` commands, and points the user to
  `nexus cluster serve` instead of telling them to edit the config.

### `nexus_projects.projects` pre-registration
`nexus init` now writes the project record during setup (status `stopped`) so
frontend/backend/admin can recognise the project by name + path + settings
before the first `npm run dev`. The backend's existing `upsertProjectInfo`
flips it to `running` on startup.

**Record schema:** `name`, `path`, `dbName`, `status`, `version`, `settings`
(`kind`, `role`, `mongoUri`, `redisUrl`, `database`, `ai.providers` +
`ai.keysConfigured` (names only — **no secret values**), `payments`,
`cluster.enabled` + `cluster.token`, `paths`, `ports`).

Non-fatal: skipped with a warning if Mongo is unreachable (the backend will
upsert a fresher record on first start).

### Verification (all on 2026-08-11)
- Typecheck: clean for `nexus-cli` (`init.ts`, `uninstall.ts`, `cluster.ts`,
  `wizard.ts`, `util.ts`) and `nexus-data` (`projects.ts`).
- Tests: **13/13 pass** (`nexus-cli` vitest suite) — init scaffolding +
  idempotency + dotenv + config-sync + dispatcher.
- E2E: scaffolded `uninstall-test` → `--dry-run` showed the stored record →
  `--force --purge` dropped the DB, deleted the record, removed the directory
  → confirmed all three gone via direct Mongo queries + `Test-Path`.
- E2E: scaffolded `eperm-test` with a read-only file → `--force --purge`
  removed it successfully (EPERM handled).
- E2E: `nexus init` with `--name test-app` → `package.json` name = `test-app`,
  `nexus_projects.projects` record name = `test-app`, paths match.
- Fixed `test-app` in place: patched `package.json` name `my-nexus-app` →
  `test-app`, cleared stale `nexus.runtime.json` cluster override
  (`enabled:false` → `enabled:true`), cleaned 5 orphan DB records.

## Prior milestone: Cluster docs + node-1 port reconciliation (2026-08-09)

- **node-1 port scheme rolled back to the unified scheme**: backend **4000**,
  frontend **3000**, admin **3001** (was the custom 4010/3020/3011). Config
  (`nexus.config.ts`), `bin/serve-all.mjs`, `Dockerfile`
  (EXPOSE/HEALTHCHECK/run comments), and `docker.ps1` all reconciled and
  verified consistent — no stale port references remain anywhere in the
  workspace.
- **`@bhooai/nexus-cluster` now has docs.** It was the only package without a
  README. Added:
  - `packages/nexus-cluster/README.md` — exports, node/central flow, config
    block, fail-open note.
  - `docs/api/cluster.html` — API reference page (exports, cluster config,
    agent routes table, CLI flow, autoscaler description).
  - Nav entry in `docs/assets/docs.js` ("Cluster" under API Reference) + a
    "Cluster / Mesh" card on `docs/index.html`.

## Prior milestone: Docker "Untrusted request origin" fix + port reconciliation (2026-08-09)

- **Root cause**: Docker remaps published host ports when dev servers already
  hold 4000/3000/3001 (e.g. container :3001 published on host as :3011). The
  browser's Origin (`http://localhost:3011`) did not match the strict
  `trustedOrigins()` list (`http://localhost:3001`), so admin login was rejected
  by the CSRF origin check with "Untrusted request origin".
- **Fix** in `packages/nexus-auth/src/csrf.ts`: loopback origins
  (localhost / 127.0.0.1 / ::1) are now trusted regardless of port — safe,
  since only same-machine origins can reach them. External origins still match
  strictly.
- `trustedOrigins()` in `apps/backend/src/main.ts` now builds the full
  localhost + 127.0.0.1 matrix across server/frontend/admin ports.
- Verified against the running container: register + login succeed through the
  remapped admin (:3011) and frontend (:3020) host ports.
- **node-1 port scheme** ~~(custom, avoids `npm run dev` collisions): backend
  **4010**, frontend **3020**, admin **3011**~~ — since rolled back to the unified
  scheme (4000/3000/3001, see top milestone). Historical note: config,
  `Dockerfile` (EXPOSE/HEALTHCHECK), `bin/serve-all.mjs`, and `docker.ps1` were
  made internally consistent (`4010:4010`, `3020:3020`, `3011:3011`,
  healthcheck defaults to 4010). Container verified **healthy**; all endpoints
  200.
- All 5 projects + `nexus-cli/templates` synced with the CSRF fix.

## Projects in this workspace
| Project | Config | Backend | Frontend | Admin | Notes |
| --- | --- | --- | --- | --- | --- |
| `node-1` | `nexus.config.ts` | 4000 | 3000 | 3001 | ROOT node, cluster enabled (LB 8080, agent 7575); unified port scheme, in sync |
| `MyFirstProject` | `nexus.config.ts` | 4000 | 3000 | 3001 | Mirror, in sync |
| `sample-project` | `nexus.config.ts` | 4000 | 3000 | 3001 | Mirror, in sync |
| `social-network` | `nexus.config.ts` | 4000 | 3000 | 3001 | Mirror + Orbit Social UI, in sync |
| `mySecondProject` | `nexus.config.ts` | 4000 | 3000 | 3001 | Mirror, in sync |

## Latest milestone: Port normalization + admin → apps/admin (2026-08-09)

### Port scheme (unified across all projects)
| Service | Port |
| --- | --- |
| Frontend (Vite) | **3000** |
| Admin (Vite) | **3001** |
| Backend (API) | **4000** |
| AI Server (Python) | **8000** |
| Supervisor (control) | **7474** |
| Cluster LB | **8080** |
| Cluster Agent | **7575** |

### Admin restructuring: `admin/` → `apps/admin/`
- Framework: admin moved to `apps/admin/`, workspaces updated, vite.config PROJECT_ROOT fixed
- Template: admin moved to `apps/admin/` in `packages/nexus-cli/templates/`
- All 5 projects: admin moved, configs updated, old artifacts cleaned
- Dockerfiles: `COPY admin` → `COPY apps/admin`, build prefix fixed, EXPOSE ports updated
- `bin/serve-all.mjs`: admin path updated in all projects + template

### Config changes
- All projects now have full `nexus.config.ts` with all sections (db, redis, auth, payments, email, certs, ads, webrtc, ai, logging, plugins, frontend, admin, cluster)
- `trustedOrigins()` in backend `main.ts` now reads frontend/admin ports from config dynamically
- `nexus dev` startup banner shows host:port table for all services
- node-1: `nexus.config.js` → `nexus.config.ts`, port 4010 → 4000, AI 8010 → 8000
- mySecondProject: added `@bhooai/admin` dep, removed `bhooai-nexus` file dep

### Framework core updates
- `defaults.ts`: admin port 5174→3001
- `dev.ts`: admin cwd `'admin'`→`'apps/admin'`, added startup banner with service table
- `supervisor.ts`: comment updated
- `api.ts`: comment updated
- `main.ts`: `trustedOrigins()` uses `config.frontend.port` / `config.admin.port`
- Framework `package.json`: workspaces updated, `files` paths updated
- Framework `tsconfig.json`: includes updated

### Docs updated
- All README.md, docs/*.html, docs/*.md files updated with new ports (frontend 3000, admin 3001)
- `apps/admin/` paths consistent across all documentation

## Completed to date
### ✅ Single host/port config (one file for every server)
- **Complete** `nexus.config.js` in `node-1` — every section: env, server (0.0.0.0:4010),
  uploads, db, redis, graphql, ws, auth/jwt, payments, email, certs, ads, webrtc, ai
  (http://localhost:8010), logging, plugins, frontend (localhost:3000), admin
  (localhost:3001), cluster (LB 8080 / agent 7575, token set).
- **Dynamic Vite configs** — `apps/frontend/vite.config.ts` and `apps/admin/vite.config.ts`
  load `nexus.config.{js/ts}` at runtime (ts>js>mjs>cjs, `NEXUS_*` env still wins) and
  derive dev-server port/host AND every proxy target from `cfg.server/frontend/admin`.
- **Backend `trustedOrigins()`** (`apps/backend/src/main.ts`) reads `frontend.port`/`admin.port`
  from config instead of hardcoded `:3000/:3001`. Applied in framework template + all 4 projects.
- **AI server honors config**: `nexus dev` forwards `AI_PORT` to the Python server
  (`apps/ai-server/main.py` reads `AI_PORT`, default 8000).
- `.env.example` (template + all projects) points to `nexus.config.*` as the single place for
  host/port; `.env` holds secrets/overrides only (`node-1/.env` intentionally holds just the
  JWT secret).
- Root/Node server kind in `nexus init` (`--as=root|node`, `--ask`, `--port`, agent-link
  onboarding, idempotent cluster section).

### ✅ Secrets live only in `.env` (no `.env.example`, nothing in config)
- Removed `auth.jwt.secret` from framework `nexus.config.ts`, template `nexus.config.ts`, and
  `node-1` `nexus.config.js` (sample-project/social-network/MyFirstProject read the env-driven same
  shape — all 4 mirrors + template SHA-match the framework copies). Secrets/keys/ids are read from
  `.env` via `NEXUS_AUTH_JWT_SECRET` (defaults.ts keeps `change-me-please` only as a code-level
  placeholder that `nexus doctor` still flags).
- Deleted `.env.example` everywhere (template + all 4 projects) — `nexus init` scaffolds a real
  `.env` (JWT secret generated into `.env`; `nexus.config.js` applies server settings).
- Admin Environment page: removed the `.env`/`.env.example` switch — always edits `.env`; lint env
  endpoint sends only `{ envText }` (Python `routers/lint.py` + backend `lintProxy.ts` updated).
- Python env lint now warns when `NEXUS_AUTH_JWT_SECRET` is not set in `.env` ("no default JWT
  secret") instead of checking config.
- Docs updated: `README.md` (put secrets in project-root `.env`, no `.env.example`), template
  `README.md`, `docs/getting-started.html`, `settings.py` comment.
- Verified: `config.test.ts` (7 tests) passes; `lint.py`/`settings.py` py_compile clean.
- Prior checkpoints: `-20260807-203645` (`--as=root|node`) etc. — see Notes.

### ✅ Docker per project (backend + frontend + admin in one image)
- `Dockerfile` + `.dockerignore` at the root of all 4 projects (node-1, MyFirstProject,
  sample-project, social-network) + CLI template (`packages/nexus-cli/templates/`); all SHA-match.
- `nexus init` ships the new files (`init.ts` restores `dockerignore`→`.dockerignore`).
- Single image runs the whole stack: `bin/serve-all.mjs` supervisor spawns
  `nexus node serve --role=backend --port=7575` (cluster node agent + backend role service),
  frontend `vite preview` (:3000), admin `vite preview` (:3001). EXPOSE 4000 3000 3001 7575.
- Vite `preview` reuses the existing `server.proxy` → SPAs proxy `/graphql /auth /ai /ws` etc. to the backend.
- Verified on real Docker (client+server 29.6.2; CLI at `C:\Users\Ravi\AppData\Local\Programs\DockerDesktop\resources\bin`):
  `node-1` image builds + boots; container connects to host MongoDB via `host.docker.internal`,
  listens on 0.0.0.0:4010, `/health` returns HTTP 200, runs as non-root `node`. Test container removed.
- **Blocked follow-up**: admin SPA build (`tsc -b`) fails on `bhooai-nexus/apps/admin` — the project's admin
  imports the framework port via a `file:../BhooAI-Nexus/bhooai-nexus` junction that is absent inside
  the image. Frontend builds fine. Needs vendoring `bhooai-nexus` into the image (or a project-local admin).

### Earlier milestones (all complete)
- Cluster mesh M1–M6 e2e verifier (LB round-robin A→B, autoscaler scale-down, real ClusterManager)
- Preflight Node probes (environment/dependency checks)
- Orbit Social UI (social-network): feed, chat, map canvas, AI credits with Razorpay INR plans,
  themes, languages — see `social-network/PROGRESS.md`.

## Verification — 2026-08-08 14:15
- Live servers: backend `:4000` (MyFirstProject) , frontend `127.0.0.1:3000` (node-1), admin
  `127.0.0.1:3001` (MyFirstProject), Redis `:6379`, MongoDB `:27017`, AI `:8000` (social-network)
  and `:8010` (node-1). Running processes confirmed.
- Proxy fix holds: node-1 admin/frontend Vite proxy targets `http://127.0.0.1:4010`.
- All 4 projects have identical dynamic Vite configs + `trustedOrigins()` in backend `main.ts`
  (verified in near-round-trip).
- `node` v24.19.0, Python 3.14.7 present. `mongod`/`redis-cli` not on PATH but daemons running.

## Remaining
- Roadmap: Incr 3 enhanced AI schema generation (flakey-node fencing, conda-free ai-server
  packaging as optional follow-ups).
- Persist posts/comments/saves/messages/credits/themes via Nexus data models (Orbit currently
  uses demo/mock fallbacks).

## Notes
- This snapshot: secrets→`.env` refactor + Docker packaging (above). SHA-verified template copies
  match framework in all 4 projects; admin `App.tsx` + `lintProxy.ts`/`lint.py` updated.
- Workspace directory renamed mid-session (`C:\server\BhooAI-Nexus` → `C:\server\BhooAI\BhooAI-Nexus`);
  all syncs/docker files re-verified at the current location.
- Prior checkpoints: `-20260808-135153` (one-file host/port, 13:51), `-123706` (`--as=root|node`),
  `-121945` (mesh M1–M6 e2e), `-104708` (preflight Node probes).
