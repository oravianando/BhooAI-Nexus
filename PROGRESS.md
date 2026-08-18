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

- Re-run a slave `npm run dev`; confirm the `node-agent` service auto-starts
  and the agent URL prints. From the master admin Cluster tab → Link node →
  paste the slave agent URL + token → should link and show in the new
  per-node cards (allocation %, test button, enable toggle, service grid).
- Re-run `nexus init . --as=node --role=backend` fresh to confirm
  `applyClusterConfig` writes `role: 'backend'` into nexus.config.ts.
- Repo-wide `tsc` still has pre-existing errors in `apps/*`, `tests/`,
  `nexus.config.ts` (JwtConfig `secret`) — untouched by this session.
- No git repo in the tree — nothing committed.

## Latest milestone (2): admin cluster redesign + slave auto-agent (2026-08-17)

- **Admin "Connected slaves" redesigned** (`packages/nexus-admin/src/App.tsx`):
  the node `<table>` is now per-node glass-cards under an aggregate header
  (node count + ready + total rps + stacked allocation-split bar). Each card
  shows status, id/role/tier, a stale badge, an enable/standby toggle, a
  **REQUESTS HANDLED allocation %** bar (`node.rps / totalRps * 100`), CPU +
  MEM load bars, a per-service health grid (backend/files/database/ai), and
  a **test** button (live agent probe) + start/restart/kill/unlink. New CSS
  classes in `index.css`.
- **New backend routes**: `POST /admin/cluster/test {id}` (live-probe a
  node's agent, returns ok + latencyMs) and `POST /admin/cluster/enable
  {id, enabled}` (per-node enable toggle, now **persists** to the registry
  file via new `NodeRegistry.setEnabled`). Added to the framework
  `clusterRoutes.ts` and to the master + both slave project copies.
- **Slave auto-agent**: new `cluster.role` config field (optional; set on
  nodes by `nexus init`). `nexus node serve --no-service` runs the agent in
  agent-only mode (no duplicate backend — advertises the dev supervisor's
  backend as the role service). `dev.ts` now starts a `node-agent`
  supervised service when `cfg.cluster.role` is set, invoked via
  `node node_modules/bhooai-nexus/bin/nexus.js node serve --no-service`.
  Existing slave configs updated with `role: 'backend'`.