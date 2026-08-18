# Progress snapshot — 2026-08-07 19:53

Checkpoint of the BhooAI Nexus admin console work. These are the framework's source-of-truth
files; the same files are also copied (synced) into each project under `C:\server\BhooAI\BhooAI-Nexus\`.

## In this snapshot
- `admin/src/App.tsx` — all page components (Overview, Configuration, Environment, Plugins,
  Users & Roles, Monitoring, Payments, Databases, AI Schema), `PageHero`, `PageHead`, roles UI,
  env-file switch, compact footer save buttons.
- `admin/src/index.css` — hero/orbit art + 7 per-page art variants, `.env-file-switch`,
  `.config-footer .inspector-primary`, `.role-*`, `.admin-inspector .admin-side-widget`.
- `admin/src/api.ts` — `getAdminEnv(file?)`, `putAdminEnv(entries, file?)`, roles API.
- `apps/backend/src/modules/admin/adminRoutes.ts` — admin routes incl. `/admin/env` with
  `file` param (`.env*` validated), `/admin/roles`, `PUT /admin/users/:id`, `/admin/projects`.
- `apps/backend/src/modules/admin/roleCatalog.ts` — role catalog (admin/user).
- `apps/backend/src/main.ts` — per-project DB + project-info store wiring.
- `packages/nexus-data/src/projects.ts` + `index.ts` — `sanitizeDbName`, project info store.

## Recent features (this session)
1. **Save buttons** — "Save runtime JSON" and "Save .env" now compact width, right-aligned
   in the `config-footer` (`space-between`), via `.config-footer .inspector-primary`.
2. **Page hero cards** — added `PageHero` (`.config-intro` orbit-card style) to the 6 pages
   that lacked one: Processes, Plugins, Users & Roles, Monitoring, Payments, Databases,
   AI Schema. Overview/Config/Environment already had their own.
3. **Distinct hero art** — `PageHero` accepts `art` prop; 7 unique variants with own accent:
   `bars` (processes), `stack` (plugins), `people` (users), `wave` (monitoring), `coins`
   (payments), `cubes` (databases), `spark` (schema). Mobile sizing covered in media query.
4. **`.env.example` editing** — Environment page has a `.env` / `.env.example` switch
   (`.env-file-switch`) in the header; backend `/admin/env` GET+PUT accept a `file` param
   validated against `/^\.env(?:\.\w+)*$/` (traversal-safe). Response includes `fileName`.

## Synced copies
- Backend `adminRoutes.ts` synced to each project's `apps/backend/src/modules/admin/` AND
  `packages/nexus-cli/templates/apps/backend/src/modules/admin/` (MyFirstProject,
  sample-project, social-network).
- Frontend `admin/src/{App.tsx,index.css,api.ts}` synced to each project's `admin/src/`.
- Admin builds pass in the framework and in all 3 projects (vite dist regenerated).

## Still open / notes
- No git repo (cannot commit); these `.progress-backup-*` folders are the manual checkpoints.
- Backend typecheck via full tsconfig fails with pre-existing TS6306 project-reference
  errors; development runs through tsx. Vitest route broken (`vitest/config.js` missing) —
  not needed for this work.
- Mongo DBs in use: `sample_project` (sample-project), `nexus_projects` (info store); legacy
  `myapp`, `nexus`, `nexus_odm_test`, `social_network` remain.
