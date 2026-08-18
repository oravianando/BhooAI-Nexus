# Progress snapshot — 2026-08-08 12:37

Checkpoint for the **Root/Node server choice in `nexus init`**. Source of truth:
framework at `C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`; files synced
into projects under `C:\server\BhooAI\BhooAI-Nexus\{MyFirstProject,sample-project,social-network}\`.

## Files changed this session
- `packages/nexus-cli/src/commands/init.ts` — added server-kind selection + onboarding
- `packages/nexus-cli/src/index.ts` — help text for the new `init` flags
- (both synced to all 3 project mirrors)

## What changed
`nexus init` now asks/detects how this server should run:

```
nexus init [target] --as=root|node [--role=backend|files|database|ai] [--port=N] [--ask] [--force] [--skip-install]
```

- `--as=root` (default): writes `cluster: { enabled: true, token: '…', failOpenSingleNode: true }`
  into nexus.config.ts and prints root onboarding (npm run dev, cluster serve, cluster link, token).
- `--as=node`: writes `cluster: { enabled: false, token: '…' }` (the token is what the agent
  requires for pairing) and prints the **agent link** the root operator pastes in:
  ```
  BhooAI Nexus node server — role backend
    nexus node serve --role=backend --port=7575   start the backend node agent
    node id:        2fba80b13915-backend
    agent link:     http://192.168.1.8:7575
    pairing token:  dc45ebb…723a7
    give these to the root operator:  nexus cluster link http://192.168.1.8:7575
  ```
- `--ask`: interactive prompt (root/node, default root). Works with piped stdin.
- The agent link host is auto-detected (first non-internal IPv4), falling back to `127.0.0.1`.
- Idempotent: existing `cluster:` section in nexus.config.ts is kept untouched.

## Verification
- `--as=node --role=backend`, `--as=root`, `--ask --role=ai` (piped answer "node") all pass;
  the generated nexus.config.ts shows the correct `cluster:` line and a random token.
- `--force` rewrites the file per design (idempotency applies to non-forced re-runs).
- `tsc --noEmit` with the base tsconfig flags is clean for init.ts + index.ts in the
  framework and in all 3 mirrors; SHA256 of init.ts identical across all copies.

## Notes
- Prior checkpoint: `-20260808-121945` (cluster mesh M1–M6 e2e verifier; LB round-robin
  A→B, autoscaler scale-down, exec through real ClusterManager).
- Next roadmap item: Incr 3 enhanced AI schema generation (flakey-node fencing, conda-free
  ai-server packaging as optional follow-ups).