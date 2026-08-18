# Progress snapshot — 2026-08-08 12:19

Checkpoint for the **distributed node mesh (Nexus Cluster)** implementation. Source of
truth: framework at `C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`; files
synced into projects under `C:\server\BhooAI\BhooAI-Nexus\{MyFirstProject,sample-project,social-network}\`.

## Files in this snapshot (changed this session)
- **New workspace package** `packages/nexus-cluster/` — `package.json`, `tsconfig.json`,
  `src/{types.ts, agent.ts, client.ts, registry.ts, lb.ts, autoscaler.ts, ai.ts, manager.ts, index.ts}`
- `packages/nexus-core/src/config/{types.ts, defaults.ts, schema.ts, env.ts}` — new
  `cluster` config section + `NodeRole`/`NodeMetrics` types + PAIR_FIELDS env mapping
- `packages/nexus-cli/src/{index.ts, commands/cluster.ts, commands/node.ts}` + `package.json` (dep)
- `apps/backend/src/modules/admin/{clusterRoutes.ts (new), adminRoutes.ts}` + `package.json` (dep)
- `admin/src/{api.ts, App.tsx}` + rebuilt `admin/dist` in framework and all 3 projects

## What a node mesh is (delivered)
Run `nexus node serve --role=<backend|files|database|ai>` on any server (agent on
`:7575` by default). In a central BhooAI Nexus,:
`nexus cluster link <agent-url>` (or the admin UI ⬡ Cluster tab) registers it via a
handshake. The central then:
- polls each agent (`/health`+`/metrics`) and persists the registry (`cluster.runtime.json`)
- round-robins incoming API traffic across ready **backend** nodes (Load Balancer, `:8080`)
- monitors RPS/CPU and **autonomously autoscales** nodes (AI advisor first, then
  deterministic guardrails: rpsPerNodeHigh/Low, cpuHigh; rails min/max; 60s cooldown)
- executes lifecycle commands on the node agent through a **scripted push + remote CLI**
  allowlist (`start|stop|restart|logs|update`) with per-node capability gates
Scripts/code are pushed from the central to agents; the agent runs them via a spawned child
service (`tsx` drive; win32 `taskkill /T /F` teardown, reused from `nexus-cli/src/supervisor.ts`).

## Key decisions (locked via Q&A)
- Node types: `backend | files | database | ai`; agent default port `7579`; LB default `8080`.
- **Identical replicas** model, not heterogeneous branches.
- Autoscaler rails: min 1 / max 4, cooldown 60s, cpuHigh 80%, rpsPerNodeHigh 15, /Low 5.
- Shared pairing token optional (empty token = binding is unauthenticated).
- Autoscaler `mode: 'auto'` lets AI drive (falls back to rails on no advice); `manual` keeps control.

## Verification
- Full closed-in-one-file e2e harness through the real `ClusterManager`:
  two `NodeAgent` on `:7577/:7578`, `ClusterRegistry.link` → `ready`, LB `:8095`
  round-robin **A→B→A→B→A→B**, one autoscaler tick **scaled DOWN** (rps/node 0.3 < 5),
  `exec logs` OK.
- Prior sandbox runs proved: node-id dedup across roots (sha256 of root+role),
  LB 503 when no backend nodes, `fallback` health probe (service URL vs local service),
  autoscaler case table (hold/scale-up/scale-down/no-nodes/manual-hold).
- Admin `tsc -b && vite build` → `index-F8IUcLPp.css` / `index-CdL9Q-m2.js`, identical in
  framework + all 3 projects. Backend mesh files pass `tsc --noEmit`; full backend build
  has only the pre-existing TS6306 project-reference errors.

## Notes
- `.tmp-verify/` build scratch removed after successful e2e run.
- Next roadmap item: Incr 3 enhanced AI schema generation (and optional flakey-agent
  fencing, conda-free ai-server packaging).