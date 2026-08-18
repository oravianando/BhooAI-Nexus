# BhooAI Nexus — Admin

React 18 + Vite + TypeScript admin console that manages the user project.

The console uses a dark Aurora workspace UI inspired by the BhooAI Nexus desktop
reference: a framed project workspace, system widgets, a live inspector, floating
tools, and a bottom connection dock. The appearance button in the top bar provides
three local themes (Aurora, Midnight, and Violet) and three interface modes
(Workspace, Compact, and Focus). The selection is stored in browser local storage.

A login gate (register/login) + workspace dashboard:

- **Overview** — project health, service count, request count, uptime, runtime
  environment, quick links, and a live supervisor pulse.

- **Processes** — services table with start/stop/restart/logs, via the supervisor
  control API.
- **Config JSON** — key/value editor for dot-path runtime overrides written to
  `nexus.runtime.json`, with type-aware values, add/delete actions, validation,
  restart notices, effective merged config, and an advanced source editor for the
  human-edited `nexus.config.js`/`.ts` file.
- **Environment** — masked key/value editor for the project `.env` file. Existing
  comments and blank lines are preserved; secret values are never returned to the
  browser. Sending a masked secret unchanged keeps the original value on disk.
- **Plugins** — pages/slots contributed by plugins.
- **Users** — users table.
- **Monitoring** — uptime/pid + metrics JSON.
- **Payments** — persisted orders and webhook transactions
  (`/admin/payments/orders`, `/admin/payments/transactions`).
- **Databases** — create/drop databases; create, rename, drop and preview
  collections (optionally with a `$jsonSchema` validator).
- **Schema** — AI-enabled schema creation: describe your data in plain English,
  review the generated `$jsonSchema` validator and create the collection with it.

Admin auth reuses `@bhooai/nexus-auth` (bearer token + `admin` role; the first
registered user is bootstrapped as admin).

## Configuration Safety

- Runtime JSON writes are schema-validated before saving and use a temporary file
  followed by a rename.
- Environment writes accept only valid shell variable names and preserve untouched
  comments and formatting lines.
- Secret environment keys are detected from names containing `SECRET`, `PASSWORD`,
  `PASS`, `TOKEN`, `PRIVATE`, `API_KEY`, `CLIENT_SECRET`, `ACCESS_KEY`, or
  `KEY_SECRET`.
- Both configuration surfaces show that a service restart is required. The current
  backend process does not hot-reload `.env` or runtime JSON values.
- The raw TypeScript/JavaScript config editor remains available for advanced users;
  key/value editing targets `nexus.runtime.json` because arbitrary source code and
  comments cannot be safely represented as rows.

## Run

```bash
npm run dev   # vite on :5174 (the backend must be running on :4000)
```

The backend routes used by the configuration surfaces are:

- `GET /admin/config` and `PUT /admin/config`
- `PUT /admin/config/file`
- `GET /admin/env` and `PUT /admin/env`
