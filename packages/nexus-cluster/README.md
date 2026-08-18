# @bhooai/nexus-cluster

Multi-host mesh for BhooAI Nexus: node agent (control API on every node),
central registry, round-robin load balancer, deterministic + AI autoscaler, and
a `ClusterManager` that glues it together for the CLI and admin UI.

## Exports

- **`NodeAgent`** — lives on every node (`cluster.nodeAgentPort`, default 7575). Owns
  the node's role service as one child process and exposes `/health`, `/info`,
  `/exec`, `/metrics`, all bearer-gated by the shared pairing token.
- **`NodeClient`** — central→node HTTP client; `info()`, `health()`, `metrics()`,
  `exec()`, bearer-authenticated.
- **`NodeRegistry`** — the central's book of linked nodes, persisted to a JSON
  file (gitignored) so the mesh survives restarts. `link()`, `poll()`,
  `readyByRole(role)`, remove.
- **`LoadBalancer`** — central-side reverse proxy on `cluster.lbPort` (default
  8080) that round-robins across every *ready* backend node, streaming raw bodies
  (SSE/uploads pass through) and stamping `x-bhooai-node`.
- **`Autoscaler`** — samples the LB's RPS histogram + node metrics every 10s and
  decides scale-up / scale-down: deterministic guardrails (RPS + CPU hysteresis)
  always active in `auto` mode, with an optional AI advisor whose move is only
  followed inside the `[minNodes, maxNodes]` rails.
- **`HttpAiAdvisor`** — the AI-manages-it layer; asks the BhooAI Nexus AI server
  for a one-line `scale-up|scale-down|hold`, falls back to rules on error/off-rail.
- **`ClusterManager`** — assembles registry + LB + autoscaler from
  `cluster.*` config and exposes `link`, `unlink`, `exec`, `scaleTo`, `startNode`,
  `stopNode`, `restartNode`, `pollAll`, `rps`.
- **`nodeIdFor(root, role)`** — canonical stable node id (project-root hash + role).
- Types — `NodeIdentity`, `NodeHealth`, `NodeMetricsSample`, `NodeExecRequest/Result`,
  `RegistryNode`, `NodeTier`, `NodeCommand`.

## Flow

```
node side:  nexus node serve --role=backend --port=<nodeAgentPort>   (starts NodeAgent)
central:    nexus cluster serve                                      (registry + LB + autoscaler)
            nexus cluster link http://<node-host>:<node-port>        (handshake + register)
```

Both sides read host/port/token from the same `nexus.config.ts` `cluster` section:
`lbPort` 8080, `nodeAgentPort` 7575, shared `token`, autoscale `minNodes/maxNodes`.

### Multiple nodes on one device

Each agent needs a unique `--port` and ideally its own project directory. Two agents on
one machine can run from one project (quick test only — they share a node id), or from
separate `nexus init` folders (recommended — distinct backend ports + node ids):

```bash
# project A (master)
nexus cluster serve
# project B (slave, different folder)
nexus node serve --role=backend --port=7575
# project C (slave, different folder, different port)
nexus node serve --role=backend --port=7576
# from project A
nexus cluster link http://localhost:7575
nexus cluster link http://localhost:7576
```

## Config

```ts
cluster: {
  enabled: true,
  failOpenSingleNode: true,
  lbHost: '0.0.0.0', lbPort: 8080,
  nodeAgentHost: '0.0.0.0', nodeAgentPort: 7575,
  registryFile: 'cluster.runtime.json',
  token: '<shared pairing secret>',
  autoscale: { enabled: true, mode: 'auto', minNodes: 1, maxNodes: 4,
               cooldownMs: 60_000, cpuHigh: 80, rpsPerNodeHigh: 15, rpsPerNodeLow: 5 },
}
```

> With `failOpenSingleNode`, the LB fails open to a single direct node when no
> scaling is needed.