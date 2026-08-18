# @bhooai/nexus-plugins

The plugin runtime: manifest, host, hooks, trusted in-process plugins, and a
sandboxed worker-thread plugin with capability-restricted RPC.

## Exports

- **manifest** — `PluginManifest { name, version, entry, mode, capabilities[],
  configSchema, hooks[], dependencies[] }`.
- **host** — `PluginHost` runs the lifecycle (`install → init → start →
  config:change → stop`) in topological order.
- **runtime/TrustedPlugin** — first-party, full Node API.
- **sandbox/SandboxedPlugin** — `worker_threads` with real heap/event-loop
  isolation (a crash can't take down the host) and a capability-restricted RPC
  bridge (`capabilityPolicy`). `resourceLimits` + heartbeat watchdog.
- **admin/adminExtensions** — pages/slots contributed by plugins, consumed by the
  admin app at `/plugins/extensions`.
- **HookBus / registry** — lifecycle hooks and the plugin registry.

## PluginContext

Exposes registrars (each capability-gated in sandbox mode): `http.addRoute`,
`http.addMiddleware`, `graphql.addSubgraph` (recompose + hot-swap the gateway),
`services.register/get` (DI), `scheduler`, `events`, `realtime`, `admin.registerAdminPage/
registerSlot`, and `fs`/`net` only when granted.

> The sandbox is **not** cryptographic — for truly untrusted plugins, recommend
> child-process/OS isolation (documented as a future seam).