# Progress snapshot — 2026-08-07 20:36

Checkpoint of the BhooAI Nexus admin console work. Framework = source of truth at
`C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`; files are synced into each project
under `C:\server\BhooAI\BhooAI-Nexus\{MyFirstProject,sample-project,social-network}\`.

## Files in this snapshot
- `admin/src/App.tsx` — all pages, PageHero/PageHead, roles UI, Theme Centre, particles, env switch
- `admin/src/index.css` — theme system, hero art variants, popups blur, particles, Theme Centre styles
- `admin/src/api.ts` — admin API incl. `getAdminEnv(file?)` / `putAdminEnv(entries, file?)`
- `apps/backend/src/modules/admin/adminRoutes.ts` — `/admin/env` w/ `file` param, roles, projects
- `apps/backend/src/modules/admin/roleCatalog.ts` — role catalog
- `apps/backend/src/main.ts` — per-project DB + project-info store wiring
- `packages/nexus-data/src/projects.ts` + `index.ts` — `sanitizeDbName`, info store

## Delivered so far (this session / recent)
1. Compact right-aligned "Save runtime JSON" / "Save .env" buttons (`.config-footer .inspector-primary`).
2. `PageHero` card on the 6 pages that lacked one (Processes, Plugins, Users & Roles, Monitoring,
   Payments, Databases, AI Schema) with **7 distinct art variants** (`bars/stack/people/wave/coins/cubes/spark`).
3. `.env.example` editing — Environment page switch (.env / .env.example), backend `file` param
   validated `/^\.env(?:\.\w+)*$/` (traversal-safe), response includes `fileName`.
4. Blur + pop animation on Appearance & account popups (translucent bg + `backdrop-filter` + `admin-pop`).
5. Floating particle layer behind the shell (CSS-only 12 particles, `admin-float` keyframes,
   `prefers-reduced-motion` hide, `.admin-particles`).
6. **Theme Centre** page (nav ◒, `Tab='theme'`): curated gallery (aurora/midnight/violet), UI-mode
   picker, custom palette editor (blue/violet/pink/bg/ink/muted swatches + hex inputs), `custom.active`
   applies CSS vars inline on the shell (`--admin-*`), persisted in `nexus-admin-custom-theme`.

## IN-PROGRESS (resume here)
Particle customization + extra theme features — **NOT finished / not yet synced / not built**:

- Extended types in App.tsx: `CustomTheme` now has `mesh/glass/radius` numbers; `THEME_PRESETS`
  gained those fields (aurora mesh .32 glass .35 radius 13 / midnight .2 .25 11 / violet .4 .3 15).
- Added (App.tsx, near top): `ParticleConfig {amount,speed,colors[]}`, `PARTICLES_KEY`,
  `DEFAULT_PARTICLE_COLORS`, `SWATCH_CPLAETTE`, `loadParticles()`, `buildParticleLayout(amount)`,
  and `useMemo` import. **These compile but are not wired into the UI yet.**
- TODO remaining:
  1. Dashboard: add `particles` state + `updateParticles` + `particleLayout` memo; build `shellStyle`
     that always sets `--admin-glass/--admin-radius/--admin-mesh` (from active theme preset or custom)
     and, when `custom.active`, accent vars + mesh-scaled gradient background; render particle `<i>`
     items dynamically (left/size/bg/duration/delay/dx/dx2/opacity inline), color = `colors[i % len]`,
     duration = `p.duration / speed`.
  2. ThemeCentre: add `particles`/`onParticles` props; add **Particle field** section (amount slider
     0–48, speed slider 0.2–3, palette list with add/remove color chips, randomize palette); add
     **Surface tuning** section (Ambient glow mesh, Panel glass, Corner radius sliders → custom fields);
     add **Randomize palette** for accents; **Export/Import JSON** (clipboard copy/paste of
     `{theme, uiMode, custom, particles}`); **Reset all** (clears `nexus-admin-custom-theme` +
     `nexus-admin-particles`); live **preview tile** using current accent colors.
  3. CSS: remove the 12 `.admin-particles i:nth-child()` rules (JS now styles inline); add
     `--admin-glass/--admin-radius/--admin-mesh` vars on `.admin-shell`; radius override rules using
     `var(--admin-radius, ...)` on `.workspace-panel/.glass-card/.overview-stat/.role-box/.theme-card`;
     glass override (backdrop-filter + translucent bg via color-mix) for those panels; sliders + palette
     + preview styles; keep reduced-motion as `.admin-particles { opacity:0 !important }`.
  4. Build framework admin; sync `App.tsx` + `index.css` to the 3 projects; rebuild each.
  5. Refresh this backup + PROGRESS.md when done.

## Notes
- No git repo (cannot commit); `.progress-backup-*` folders are the manual checkpoints.
- Backend typecheck has pre-existing TS6306 project-reference errors; dev runs via tsx.
- Mongo DBs: `sample_project` (sample-project), `nexus_projects` (info store); legacy dbs remain.
- Pre-existing duplicate `databases` nav entry noticed in App.tsx (two identical items) — not fixed yet.
