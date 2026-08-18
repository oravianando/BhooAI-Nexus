# My Nexus App

Scaffolded by `nexus init` — a [BhooAI Nexus](https://github.com/bhooai/nexus) full-stack app
with four runnable terminals: backend, frontend, Python AI server, and admin.

## Quick start

```bash
npm install
npm run doctor     # verify node, python, mongo, redis
npm run dev        # start all four terminals under the supervisor
```

`nexus init` installs these dependencies automatically. Run `npm install` manually only when this
directory was copied without running `nexus init`, or after changing dependency versions.

Then visit:

- Backend: http://localhost:4000/health
- Frontend: http://localhost:3000
- Admin: http://localhost:3300
- AI server: http://localhost:8000

## What you got

- `apps/backend/` — Node backend on the Nexus framework (custom HTTP server, CSRF/CORS,
  GraphQL, websockets, ODM, OAuth, payments, and multipart uploads under `/uploads`.
  Uploaded files are stored in the project-local `uploads/` directory. See `src/main.ts`.
- `apps/frontend/` — React + Vite + Tailwind (placeholder; add components in `src/`).
- `apps/ai-server/` — Python FastAPI (OpenAI + Ollama). `pip install -r requirements.txt`.
- `apps/admin/` — React + Vite admin console (config, processes, plugins, users, monitoring).

## Config

Edit `nexus.config.ts` for app settings. Secrets go directly in `.env` (no `.env.example`).
Admin overrides are written to `nexus.runtime.json` (gitignored).

## Uploads

The generated backend accepts a `multipart/form-data` `POST /uploads` request and returns generated
file URLs. The default limit is 10 MiB per file and 20 files per request. The request must include the
CSRF token returned by `GET /csrf-token`:

```js
const csrf = await fetch('/csrf-token', { credentials: 'include' }).then((r) => r.json());
const form = new FormData();
form.append('file', input.files[0]);
const response = await fetch('/uploads', {
  method: 'POST',
  body: form,
  credentials: 'include',
  headers: { 'x-csrf-token': csrf.token },
});
```

Configure `uploads.dir`, `uploads.path`, `uploads.maxFileSize`, `uploads.maxFiles`, and
`uploads.allowedTypes` in `nexus.config.ts`. Uploaded files are ignored by Git.

> Generated projects depend on the published `bhooai-nexus` package. Publish the framework package
> from the `bhooai-nexus/` workspace root with `npm publish` before installing it from the public registry.

## Scripts

| command | what it does |
| --- | --- |
| `npm run dev` | start backend + frontend + AI + admin under the supervisor |
| `npm run doctor` | check node/python versions and mongo/redis reachability |
| `npm run build` | build all TypeScript workspaces |
| `npm test` | run the test suites |
