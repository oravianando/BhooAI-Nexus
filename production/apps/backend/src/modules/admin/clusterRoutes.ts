import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import type { Router, Middleware } from '@bhooai/nexus-core/http';
import { ClusterManager, nodeIdFor } from '@bhooai/nexus-cluster';
import type { DeepPartial, NexusConfig } from '@bhooai/nexus-core';
import { mergeConfig } from '@bhooai/nexus-core';
import {
  listClusterNodes,
  upsertClusterNode,
  deleteClusterNode,
  syncClusterNodes,
  type ClusterNodeRecord,
} from '@bhooai/nexus-data';

/**
 * Mount /admin/cluster/* — mesh orchestration for the admin UI. All routes are
 * guarded (bearer + 'admin' role) by the `guard` passed from adminRoutes.
 *
 *   GET   /admin/cluster/overview   linked nodes + metrics + LB RPS + autoscale config + running status
 *   GET   /admin/cluster/setup      master (this server) + slave defaults and commands
 *   POST  /admin/cluster/setup      save master/slave host+port overrides (runtime config)
 *   POST  /admin/cluster/link       { nodeUrl }         handshake + register a node
 *   POST  /admin/cluster/unlink     { id }
 *   POST  /admin/cluster/exec       { id, action }      start|stop|restart|kill
 *   POST  /admin/cluster/scale      { target }          scale to n backend nodes
 *   POST  /admin/cluster/poll                            refresh every node once
 *   POST  /admin/cluster/start                           start LB + autoscaler, persist enabled=true
 *   POST  /admin/cluster/stop                            stop LB + autoscaler, persist enabled=false
 */
export function registerClusterRoutes(
  router: Router,
  guard: Middleware[],
  deps: { root: string; config: import('@bhooai/nexus-core').NexusConfig; manager?: ClusterManager },
): void {
  const manager = deps.manager ?? (() => {
    const m = new ClusterManager({ config: deps.config.cluster, root: deps.root, aiServerUrl: deps.config.ai.serverUrl });
    deps.manager = m;
    return m;
  })();
  let nodeAgentProcess: ChildProcess | undefined;
  let nodeAgentStartedAt: string | undefined;

  router.get('/admin/cluster/overview', async (ctx) => {
    const rps = manager.rps();
    const nodes = manager.list().map((n) => ({
      id: n.identity.id,
      role: n.identity.role,
      tier: n.identity.tier,
      version: n.identity.version,
      baseUrl: n.identity.baseUrl,
      serviceUrl: n.identity.services[n.identity.role],
      status: n.status,
      enabled: n.enabled,
      registeredAt: n.registeredAt,
      lastSeenAt: n.lastSeenAt,
      rps: rps[n.identity.id] ?? 0,
      metrics: n.lastMetrics,
      health: n.lastHealth,
    }));
    // Mirror the current registry into Mongo so the CLI + other tools can
    // query cluster state from `nexus_projects.cluster_nodes`.
    syncClusterNodes(nodes.map(toClusterNodeRecord)).catch(() => { /* best-effort */ });
    ctx.json({
      enabled: deps.config.cluster.enabled,
      running: manager.lb.server.listening,
      lbHost: deps.config.cluster.lbHost,
      lbPort: deps.config.cluster.lbPort,
      nodeAgentHost: deps.config.cluster.nodeAgentHost,
      controlPort: deps.config.cluster.nodeAgentPort,
      autoscale: deps.config.cluster.autoscale,
      nodes,
    });
  }, guard);

  /** Master + slave topology and the run/link commands the operators copy. */
  router.get('/admin/cluster/setup', async (ctx) => {
    const c = deps.config.cluster;
    // This server's own agent URL — resolved to a LAN address when bound to
    // 0.0.0.0 so it can be pasted into a remote master (`nexus cluster link`).
    const selfHost = resolveAdvertisedHost(c.nodeAgentHost, c.nodeAgentPort);
    const selfUrl = `http://${selfHost}:${c.nodeAgentPort}`;
    const slaves = [
      { role: 'backend', label: 'API core' },
      { role: 'files', label: 'Static + uploads' },
      { role: 'database', label: 'Mongo + Redis' },
      { role: 'ai', label: 'AI inference' },
    ].map((s) => ({
      role: s.role,
      label: s.label,
      host: c.nodeAgentHost === '0.0.0.0' ? '127.0.0.1' : c.nodeAgentHost,
      port: c.nodeAgentPort,
      serve: `nexus node serve --role=${s.role} --port=${c.nodeAgentPort}`,
      link: `http://${c.nodeAgentHost === '0.0.0.0' ? '127.0.0.1' : c.nodeAgentHost}:${c.nodeAgentPort}`,
    }));
    ctx.json({
      master: {
        enabled: c.enabled,
        lbHost: c.lbHost,
        lbPort: c.lbPort,
        nodeAgentHost: c.nodeAgentHost,
        nodeAgentPort: c.nodeAgentPort,
        registryFile: c.registryFile,
        serverUrl: `http://${c.lbHost}:${c.lbPort}`,
      },
      self: {
        host: selfHost,
        port: c.nodeAgentPort,
        agentUrl: selfUrl,
        serve: `nexus node serve --role=backend --port=${c.nodeAgentPort}`,
        link: `nexus cluster link ${selfUrl}`,
        token: c.token || '<empty — set cluster.token>',
      },
      slaves,
      runtime: await readRuntime(deps.root),
      note: 'Save here rewrites the runtime overrides; restart nexus cluster serve / node serve to apply new ports.',
    });
  }, guard);

  /** Persist master/slave host/port overrides into nexus.runtime.json (validated). */
  router.post('/admin/cluster/setup', async (ctx) => {
    const body = (ctx.body ?? {}) as {
      master?: { enabled?: boolean; lbHost?: string; lbPort?: number; nodeAgentHost?: string; nodeAgentPort?: number };
    };
    const patch: DeepPartial<NexusConfig> = {};
    const c = deps.config.cluster;
    const master = body.master ?? {};
    if (typeof master.enabled === 'boolean') patch.cluster = { ...(patch.cluster ?? {}), enabled: master.enabled };
    if (typeof master.lbHost === 'string' && master.lbHost.trim()) patch.cluster = { ...(patch.cluster ?? {}), lbHost: master.lbHost.trim() };
    if (Number.isFinite(Number(master.lbPort)) && Number(master.lbPort) >= 1 && Number(master.lbPort) <= 65535) patch.cluster = { ...(patch.cluster ?? {}), lbPort: Number(master.lbPort) };
    if (typeof master.nodeAgentHost === 'string' && master.nodeAgentHost.trim()) patch.cluster = { ...(patch.cluster ?? {}), nodeAgentHost: master.nodeAgentHost.trim() };
    if (Number.isFinite(Number(master.nodeAgentPort)) && Number(master.nodeAgentPort) >= 1 && Number(master.nodeAgentPort) <= 65535) patch.cluster = { ...(patch.cluster ?? {}), nodeAgentPort: Number(master.nodeAgentPort) };
    try {
      // Merge with existing runtime overrides so unrelated settings survive.
      const existing = await readRuntime(deps.root);
      const merged = mergeRuntime(existing, patch);
      await writeRuntime(deps.root, merged);
      ctx.json({ ok: true, note: 'master/serve overrides saved — restart the cluster/node processes to apply' });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);

  router.get('/admin/cluster/node/status', async (ctx) => {
    const c = deps.config.cluster;
    let running = nodeAgentProcess?.exitCode === null && !nodeAgentProcess.killed;
    if (!running) {
      try {
        const res = await fetch(`http://127.0.0.1:${c.nodeAgentPort}/health`, {
          headers: { authorization: `Bearer ${c.token}` },
          signal: AbortSignal.timeout(800),
        });
        running = res.ok;
      } catch { /* agent is not running */ }
    }
    ctx.json({
      running,
      pid: running ? nodeAgentProcess?.pid : undefined,
      nodeId: nodeIdFor(deps.root, 'backend'),
      role: 'backend',
      port: c.nodeAgentPort,
      agentUrl: `http://127.0.0.1:${c.nodeAgentPort}`,
      token: c.token || '<empty — set cluster.token>',
      startedAt: nodeAgentStartedAt,
    });
  }, guard);

  router.post('/admin/cluster/node/start', async (ctx) => {
    const c = deps.config.cluster;
    if (nodeAgentProcess?.exitCode === null && !nodeAgentProcess.killed) {
      ctx.json({ ok: true, running: true, pid: nodeAgentProcess.pid, port: c.nodeAgentPort });
      return;
    }
    try {
      const cli = resolve(deps.root, 'bin', 'nexus.js');
      const child = spawn(process.execPath, [cli, 'node', 'serve', '--role=backend', `--port=${c.nodeAgentPort}`], {
        cwd: deps.root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      nodeAgentProcess = child;
      nodeAgentStartedAt = new Date().toISOString();
      child.stdout?.on('data', () => undefined);
      child.stderr?.on('data', () => undefined);
      child.once('exit', () => { nodeAgentProcess = undefined; });
      child.once('error', () => { nodeAgentProcess = undefined; });
      ctx.json({ ok: true, running: true, pid: child.pid, port: c.nodeAgentPort, token: c.token });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);

  router.post('/admin/cluster/node/stop', async (ctx) => {
    const child = nodeAgentProcess;
    if (!child || child.exitCode !== null || child.killed) {
      nodeAgentProcess = undefined;
      ctx.json({ ok: true, running: false });
      return;
    }
    try {
      if (process.platform === 'win32' && child.pid) {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
      } else {
        child.kill('SIGTERM');
      }
      nodeAgentProcess = undefined;
      ctx.json({ ok: true, running: false });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);

  router.post('/admin/cluster/link', async (ctx) => {
    const { nodeUrl, token } = (ctx.body ?? {}) as { nodeUrl?: string; token?: string };
    if (!nodeUrl) { ctx.json({ error: 'nodeUrl is required' }, 400); return; }
    try {
      const node = await manager.link(nodeUrl, token);
      upsertClusterNode(toClusterNodeRecord({
        id: node.identity.id,
        role: node.identity.role,
        tier: node.identity.tier,
        version: node.identity.version,
        baseUrl: node.identity.baseUrl,
        services: node.identity.services,
        status: node.status,
        enabled: node.enabled,
        registeredAt: node.registeredAt,
        lastSeenAt: node.lastSeenAt,
        lastHealth: node.lastHealth,
        lastMetrics: node.lastMetrics,
      })).catch(() => { /* best-effort */ });
      ctx.json({ node });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);

  router.post('/admin/cluster/unlink', async (ctx) => {
    const { id } = (ctx.body ?? {}) as { id?: string };
    const ok = id ? manager.unlink(id) : false;
    if (ok && id) deleteClusterNode(id).catch(() => { /* best-effort */ });
    ctx.json({ ok });
  }, guard);

  /** Generate a new pairing token (slave mode) — persists to nexus.runtime.json
   *  and updates the in-memory config + registry so the node agent uses it
   *  immediately. Returns the plaintext token once for the operator to copy. */
  router.post('/admin/cluster/generate-token', async (ctx) => {
    try {
      const token = randomBytes(16).toString('hex');
      const existing = await readRuntime(deps.root);
      const patched = mergeRuntime(existing, { cluster: { token } });
      await writeRuntime(deps.root, patched);
      deps.config.cluster.token = token;
      manager.registry.setToken(token);
      ctx.json({ token });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);

  router.post('/admin/cluster/exec', async (ctx) => {
    const { id, action } = (ctx.body ?? {}) as { id?: string; action?: string };
    if (!id || !action) { ctx.json({ error: 'id + action are required' }, 400); return; }
    const map: Record<string, string> = { start: 'start', stop: 'stop', restart: 'restart', kill: 'stop' };
    const command = map[action];
    if (!command) { ctx.json({ error: `unknown action: ${action}` }, 400); return; }
    try {
      const result = await manager.exec(id, command);
      ctx.json({ result });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);

  router.post('/admin/cluster/scale', async (ctx) => {
    const { target } = (ctx.body ?? {}) as { target?: number };
    const n = Number(target);
    if (!Number.isFinite(n)) { ctx.json({ error: 'target is a required number' }, 400); return; }
    try {
      await manager.scaleTo(n);
      ctx.json({ ok: true, target: n });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);

  router.post('/admin/cluster/poll', async (ctx) => {
    await manager.pollAll();
    // Sync the refreshed health/metrics into Mongo.
    syncClusterNodes(manager.list().map((n) => toClusterNodeRecord({
      id: n.identity.id,
      role: n.identity.role,
      tier: n.identity.tier,
      version: n.identity.version,
      baseUrl: n.identity.baseUrl,
      services: n.identity.services,
      status: n.status,
      enabled: n.enabled,
      registeredAt: n.registeredAt,
      lastSeenAt: n.lastSeenAt,
      lastHealth: n.lastHealth,
      lastMetrics: n.lastMetrics,
    }))).catch(() => { /* best-effort */ });
    ctx.json({ ok: true });
  }, guard);

  // ── cluster start / stop ─────────────────────────────────────────

  router.post('/admin/cluster/start', async (ctx) => {
    try {
      // Persist enabled=true into nexus.runtime.json so it survives restarts.
      const existing = await readRuntime(deps.root);
      const patched = mergeRuntime(existing, { cluster: { enabled: true } });
      await writeRuntime(deps.root, patched);
      // Mutate the in-memory config so listenLb picks up enabled=true.
      deps.config.cluster.enabled = true;
      await manager.listenLb(deps.config.cluster.lbHost);
      manager.autoscaler.start(10_000);
      ctx.json({ ok: true, running: true });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);

  router.post('/admin/cluster/stop', async (ctx) => {
    try {
      manager.autoscaler.stop();
      await manager.close();
      // Persist enabled=false.
      const existing = await readRuntime(deps.root);
      const patched = mergeRuntime(existing, { cluster: { enabled: false } });
      await writeRuntime(deps.root, patched);
      deps.config.cluster.enabled = false;
      ctx.json({ ok: true, running: false });
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
  }, guard);
}

/** Read the project's runtime config overrides (nexus.runtime.json). */
async function readRuntime(root: string): Promise<DeepPartial<NexusConfig>> {
  const path = join(root, 'nexus.runtime.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(await readFile(path, 'utf8')) as DeepPartial<NexusConfig>; }
  catch { return {}; }
}

/** Shallow-merge a DeepPartial patch into existing overrides. */
function mergeRuntime(existing: DeepPartial<NexusConfig>, patch: DeepPartial<NexusConfig>): DeepPartial<NexusConfig> {
  return {
    ...existing,
    ...patch,
    cluster: { ...(existing.cluster ?? {}), ...(patch.cluster ?? {}) },
  };
}

/** Validate + atomically write nexus.runtime.json. */
async function writeRuntime(root: string, overrides: DeepPartial<NexusConfig>): Promise<void> {
  mergeConfig(overrides); // validate before persisting
  const path = resolve(root, 'nexus.runtime.json');
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
  try {
    await rename(tempPath, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    await unlink(path).catch(() => undefined);
    await rename(tempPath, path);
  }
}

/** Address a remote master should use to reach THIS node's agent. A bind of
 * 0.0.0.0 / :: means "every interface" — advertise the first LAN IPv4 so the
 * pasteable URL actually resolves on the network; fall back to a nested link
 * for the `NEXUS_NODE_ADVERTISED_URL` env override. */
function resolveAdvertisedHost(nodeAgentHost: string, _port: number): string {
  if (process.env.NEXUS_NODE_ADVERTISED_URL) {
    try { return new URL(process.env.NEXUS_NODE_ADVERTISED_URL).hostname; } catch { /* ignore */ }
  }
  const isWildcard = nodeAgentHost === '0.0.0.0' || nodeAgentHost === '::' || nodeAgentHost === '';
  if (!isWildcard) return nodeAgentHost;
  for (const entries of Object.values(networkInterfaces())) {
    for (const net of entries ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

/** Shape a registry node view (from manager.list()) into a ClusterNodeRecord
 *  for Mongo persistence. */
function toClusterNodeRecord(n: {
  id: string; role: string; tier: string; version?: string;
  baseUrl: string; services?: Record<string, string>;
  status: string; enabled: boolean; registeredAt: string; lastSeenAt: string;
  lastHealth?: unknown; lastMetrics?: unknown;
}): ClusterNodeRecord {
  return {
    id: n.id,
    role: n.role,
    tier: n.tier,
    version: n.version,
    baseUrl: n.baseUrl,
    services: n.services,
    status: n.status,
    enabled: n.enabled,
    registeredAt: n.registeredAt,
    lastSeenAt: n.lastSeenAt,
    lastHealth: n.lastHealth,
    lastMetrics: n.lastMetrics,
    updatedAt: new Date().toISOString(),
  };
}
