# BhooAI Nexus — Admin

React 18 + Vite + TypeScript admin console that manages the user project.

## Appearance & theme

The console uses a dark glass/Aurora workspace interface inspired by the BhooAI
Nexus desktop reference: a framed project workspace, system widgets, a live
inspector, floating tools, and a bottom connection dock. Shell size is a **fixed
80% of the actual screen width**, centered on desktop and full-width on ≤1024px.

The **◒ Appearance** button in the top bar provides three local themes —
**Aurora**, **Midnight**, and **Violet** — and three interface modes —
**Workspace**, **Compact**, and **Focus**. The selection is saved to browser
local storage (`nexus-admin-theme`, `nexus-admin-ui`) and is applied to **both**
the login screen and the dashboard. The page is responsive: the inspector hides
≤1120px, the sidebar becomes a slide-in drawer ≤1024px, and grids/panels collapse
further on phones.

## Workspace dashboard

The app opens on an `admin`-guarded login gate (register/login) followed by the
dashboard:

- **Overview** — project health, service count, request count, uptime, runtime
  environment, quick links, and a live supervisor pulse.
- **Processes** — services table with start/stop/restart/logs via the supervisor
  control API.
- **Configuration** — dot-path key/value editor as **grouped rows** (by top-level
  key, e.g. `server.port` → group `server`) with type-aware values, an inline
  **add-key box** at the top, load-from-existing-config, schema validation, and a
  raw source editor for the human-edited `nexus.config.js`/`.ts`. Overrides are
  written to `nexus.runtime.json`; an **effective merged config** read-only view
  is also provided.
- **Environment** — masked key/value editor for the project `.env` file, loaded
  into grouped rows, with an **add-variable box** at the top. Existing comments
  and blank lines are preserved; secret values are never returned to the browser,
  and sending a masked secret unchanged keeps the original value on disk.
- **Plugins** — pages/slots contributed by plugins.
- **Users** — users table.
- **Monitoring** — traffic/uptime/pid + metrics JSON.
- **Payments** — persisted orders and webhook transactions
  (`/admin/payments/orders`, `/admin/payments/transactions`).
- **Databases** — create/drop databases; create, rename, drop and preview
  collections (optionally with a `$jsonSchema` validator).
- **Schema** — AI-enabled schema creation: describe your data in plain English,
  review the generated `$jsonSchema` validator and create the collection with it.

Destructive actions (database/collection drops) and configuration/environment
saves show custom glass dialogs: a **confirmation dialog** for irreversible drops
and a **restart-required** dialog after config/env saves (with an *Open services*
shortcut to the Processes tab).

Admin auth reuses `@bhooai/nexus-auth` (bearer token + `admin` role; the first
registered user is bootstrapped as admin).

## Configuration safety

- Runtime JSON writes are validated against the schema before saving and use a
  temporary file followed by a rename.
- Environment writes accept only valid shell variable names and preserve untouched
  comments and formatting lines.
- Secret environment keys are detected from names containing `SECRET`, `PASSWORD`,
  `PASS`, `TOKEN`, `PRIVATE`, `API_KEY`, `CLIENT_SECRET`, `ACCESS_KEY`, or
  `KEY_SECRET`.
- Both configuration surfaces prompt for a service restart after saving. The
  backend process does not hot-reload `.env` or runtime JSON values.
- The raw TypeScript/JavaScript source editor remains available for advanced users;
  key/value rows target `nexus.runtime.json` because arbitrary source code and
  comments cannot be safely represented as rows.

## Run

```bash
npm run dev   # vite on :5174 (the backend must be running on :4000)
```

The backend routes used by the configuration surfaces are:

- `GET /admin/config` and `PUT /admin/config`
- `PUT /admin/config/file`
- `GET /admin/env` and `PUT /admin/env`
