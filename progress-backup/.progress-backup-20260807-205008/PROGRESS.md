# Progress snapshot — 2026-08-07 20:50

Checkpoint of the BhooAI Nexus admin console work. Framework = source of truth at
`C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`; files are synced into each project
under `C:\server\BhooAI\BhooAI-Nexus\{MyFirstProject,sample-project,social-network}\`.

## Files in this snapshot
- `admin/src/App.tsx` — all pages, PageHero/PageHead, roles UI, Theme Centre + particles + surface tuning
- `admin/src/index.css` — theme system, hero art variants, popups blur, particles, Theme Centre + surface styles
- `admin/src/api.ts` — admin API incl. `getAdminEnv(file?)` / `putAdminEnv(entries, file?)`
- `apps/backend/src/modules/admin/adminRoutes.ts` — `/admin/env` w/ `file` param, roles, projects
- `apps/backend/src/modules/admin/roleCatalog.ts` — role catalog
- `apps/backend/src/main.ts` — per-project DB + project-info store wiring
- `packages/nexus-data/src/projects.ts` + `index.ts` — `sanitizeDbName`, info store

## Delivered this session (Theme Centre v2 — DONE, built + synced)
1. Particle customization is fully wired:
   - `ParticleConfig {amount, speed, colors[]}`, `PARTICLES_KEY`, `DEFAULT_PARTICLE_COLORS`,
     `DEFAULT_PARTICLES`, `loadParticles()`, `buildParticleLayout(amount)`, `hslToHex()`,
     `randomAccentPalette()`, `randomParticleColors()` in App.tsx.
   - Dashboard: `particles` state + `updateParticles` + `particleLayout` (useMemo); `shellStyle`
     always sets `--admin-mesh/--admin-glass/--admin-radius/--admin-mesh-opacity`, and when
     `custom.active` also accent vars + a mesh-scaled radial `background`; renders particle `<i>`
     items inline (left/size/bg/duration/delay/dx/dx2/opacity), color = `colors[i % len]`,
     duration = `p.duration / speed`.
   - ThemeCentre: `particles`/`onParticles` props; **Particle field** (amount 0–48 slider, speed
     0.2–3 slider, editable color palette with add/remove chips, Randomize); **Surface tuning**
     (Ambient glow mesh, Panel glass, Corner radius sliders → `custom.mesh/glass/radius`);
     **Randomize accents**; **Export/Import JSON** (clipboard round-trip of
     `{theme, uiMode, custom, particles}`); **Reset all**; live **preview tile**.
2. CSS:
   - Removed the 12 `.admin-particles i:nth-child()` rules; JS styles each particle inline now.
   - `--admin-mesh/--admin-glass/--admin-radius` defaults on `.admin-shell`.
   - `.admin-shell::before` (grid overlay) opacity bound to `--admin-mesh-opacity`.
   - Radius + glass (backdrop-filter) override rules on `.workspace-panel/.glass-card/.role-box/.overview-stat`.
     Glass was implemented as **blur only** (a background color-mix rewrite was tried and removed to
     avoid regressing the panels' baked-in gradients/backgrounds).
   - New styles: `.surface-row/.surface-range/.surface-value/.palette-list/.palette-chip/.add-color/
     .row-delete/.theme-preview-tile/.theme-preview-glow/-card/-overline/-title/-actions/`
     `.tp-btn/.tp-chip/.theme-preview-dots`; reduced-motion hides `.admin-particles` (opacity 0 !important).
3. Verified: `npm run build` in framework `admin/` passes; `tsc -b && vite build` passes in each of
   sample-project, social-network, MyFirstProject after copying App.tsx + index.css into each.

## Notes
- No git repo (cannot commit); `.progress-backup-*` folders are the manual checkpoints
  (this dir = finished state; earlier `...-203645` = start-of-feature state).
- Pre-existing duplicate `databases` nav entry in App.tsx (two identical items) — still not fixed.
- Backend has pre-existing TS6306 project-reference typecheck errors; dev runs via tsx.
- Mongo DBs: `sample_project` (sample-project), `nexus_projects` (info store).

## Next move (if continuing)
- Optionally fix the duplicate `databases` nav item in App.tsx (~line 232) and re-sync/re-build.