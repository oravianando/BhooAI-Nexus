# Progress snapshot — 2026-08-17

Local master + slave cluster on Windows. Framework at
`C:\server\PACKAGES\bhooai-nexus\`; projects at
`C:\server\BhooAI\BhooAI-Nexus\test-app\` (master `test-app`, slaves
`test-app-slave-1`, `test-app-slave-2`). Slave `node_modules` for
`bhooai-nexus` / `@bhooai/nexus-cluster` are junctions → framework edits
are live in projects without reinstall.

## Latest milestone: master + slave cluster running (2026-08-17)

- **DEP0190 (args + `shell:true`) fixed** on Windows — full command-line
  strings passed in 5 sites (init.ts, supervisor.ts, pysetup.ts, util.ts,
  agent.ts).
- **npm allow-scripts**: esbuild + mediasoup approved; `init.ts` runs
  `npm approve-scripts --all --no-allow-scripts-pin` after scaffold install.
- **Runtime port auto-allocation** in `dev.ts` (`nextFreePort` + `NEXUS_*`
  env overrides); fixed the `'80001'` string-port bug (`Number()` coercion).
  Admin default port **3001 → 3300** across framework, templates, apps,
  master + slave configs (slaves auto-allocate 3301/3302).
- **Cluster auth pinned to master**: LB `self` anchor + `/auth/*`,
  `/csrf-token` pinning; slaves verify master access tokens via a shared
  `NEXUS_AUTH_JWT_SECRET` (`verifyAccessToken` is pure JWT — no session
  hit). Refresh + CSRF stay on master.

## Fixed this session

- **Backend crash `[TypeError: fetch failed] ECONNREFUSED :7575`** — an
  unhandled promise rejection from the master's autoscaler: its tick calls
  `scaleUp`/`scaleDown` → `manager.exec` → `NodeClient` global `fetch` to a
  linked node's agent. When that agent was down, the rejection escaped
  `tick()` with no handler and Node 24 crashed the whole backend.
  Guarded in `packages/nexus-cluster/src/autoscaler.ts` (tick-loop `.catch`
  + a `scale()` helper that logs instead of throwing). A dead node now just
  logs `[cluster] autoscaler <dir> failed (<reason>)` — no process crash.

## Next steps

- Re-run master `nexus dev`; confirm 7575 ECONNREFUSED now logs a warning
  instead of crashing; verify admin on 3300 (slaves 3301/3302).
- Re-test connect-nodes end to end (link → LB → `/auth` through master).
- Repo-wide `tsc` still has pre-existing errors in `apps/*`, `tests/`,
  `nexus.config.ts` (JwtConfig `secret`) — untouched by this session.
- No git repo in the tree — nothing committed.