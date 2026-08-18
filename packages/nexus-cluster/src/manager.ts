import { resolve } from 'node:path';
import type { ClusterConfig } from '@bhooai/nexus-core';
import { NodeRegistry } from './registry.js';
import { LoadBalancer } from './lb.js';
import { Autoscaler } from './autoscaler.js';
import type { AiAdvisor } from './autoscaler.js';
import { HttpAiAdvisor } from './ai.js';
import type { RegistryNode } from './types.js';
import { NodeClient } from './client.js';

export interface ClusterManagerOptions {
  config: ClusterConfig;
  /** Project root (used to resolve registryFile + node source roots). */
  root: string;
  /** AI server URL for the autonomous advisor (optional). */
  aiServerUrl?: string;
  /** The central's own backend URL. The LB pins `/auth/*` + `/csrf-token` to
   *  it so sessions and refresh-token rotation stay on the master node. */
  self?: { id: string; baseUrl: string };
}

/**
 * ClusterManager — assembles the central-side components (registry + LB +
 * autoscaler) from config and exposes the high-level mesh operations the CLI
 * and admin UI call: link, list, exec, scale, stop, start, kill.
 */
export class ClusterManager {
  readonly registry: NodeRegistry;
  readonly lb: LoadBalancer;
  readonly autoscaler: Autoscaler;
  readonly config: ClusterConfig;
  readonly root: string;

  constructor(opts: ClusterManagerOptions) {
    this.config = opts.config;
    this.root = opts.root;
    this.registry = new NodeRegistry({ file: resolve(opts.root, opts.config.registryFile), token: opts.config.token });
    this.lb = new LoadBalancer({ registry: this.registry, self: opts.self, failOpenToSelf: opts.config.failOpenSingleNode, pathPins: opts.config.pathPins });
    const ai: AiAdvisor | undefined = opts.aiServerUrl && opts.config.autoscale.mode === 'auto'
      ? new HttpAiAdvisor({ serverUrl: opts.aiServerUrl })
      : undefined;
    this.autoscaler = new Autoscaler({
      registry: this.registry,
      lb: this.lb,
      ai,
      scaleUp: (reason) => this.scaleUp(reason),
      scaleDown: (reason) => this.scaleDown(reason),
    }, opts.config.autoscale);
  }

  /** Handshake a node by agent URL and register it. An optional `token`
   *  overrides the shared cluster token for per-node pairing (slave-generated). */
  link(agentUrl: string, token?: string): Promise<RegistryNode> {
    return this.registry.link(agentUrl, undefined, token);
  }

  unlink(id: string): boolean {
    return this.registry.remove(id);
  }

  list(): RegistryNode[] {
    return this.registry.list();
  }

  /** Run an allowlisted command on a node through its agent. */
  exec(id: string, command: string, args: string[] = [], target?: string): Promise<import('./types.js').NodeExecResult> {
    const client = this.registry.clientFor(id);
    if (!client) return Promise.reject(new Error(`node ${id} not linked`));
    return client.exec({ command: command as never, args, target });
  }

  /** Current LB RPS snapshot (per node). */
  rps(): Record<string, number> {
    return this.lb.rpsSnapshot();
  }

  /** Update path-prefix pins at runtime (admin saves new routing without an LB restart). */
  setPathPins(pins: Array<{ prefix: string; nodeId: string; role?: string }>): void {
    this.lb.setPathPins(pins);
  }

  /** Scale to exactly `n` backend nodes by starting/stopping the standby.
   *  Implementation note: with local-branch nodes, `scaleUp` enables a pending
   *  ready node; with remote nodes the admin provisions externally. We enable
   *  nodes to satisfy the target where possible. */
  async scaleTo(n: number): Promise<void> {
    const ready = this.registry.readyByRole('backend');
    const min = this.config.autoscale.minNodes;
    const max = this.config.autoscale.maxNodes;
    const target = Math.min(Math.max(n, min), max);
    const delta = target - ready.length;
    if (delta > 0) {
      const standby = this.registry.list().filter((x) => x.enabled === false && x.identity.role === 'backend' && x.status === 'ready');
      const candidates = standby.slice(0, delta);
      if (candidates.length < delta) throw new Error(`only ${candidates.length} standby backend node(s) available`);
      for (const node of candidates) await this.setEnabled(node.identity.id, true);
    } else if (delta < 0) {
      const excess = ready.slice(0, -delta);
      for (const node of excess) await this.setEnabled(node.identity.id, false);
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const node = this.registry.get(id);
    if (!node) throw new Error(`node ${id} not linked`);
    this.registry.setEnabled(id, enabled);
    await this.registry.poll(id);
  }

  /** Start all registered services on a node. */
  async startNode(id: string): Promise<void> {
    await this.exec(id, 'start');
    await this.registry.poll(id);
  }

  async stopNode(id: string): Promise<void> {
    await this.exec(id, 'stop');
    await this.registry.poll(id);
  }

  async restartNode(id: string): Promise<void> {
    await this.exec(id, 'restart');
    await this.registry.poll(id);
  }

  async killNode(id: string): Promise<void> {
    await this.exec(id, 'stop');
    await this.registry.poll(id);
  }

  /** The framework's own scale-up hook: enable the lowest-priority standby node. */
  private async scaleUp(reason: string): Promise<void> {
    const standby = this.registry.list().filter((x) => !x.enabled && x.identity.role === 'backend' && x.status === 'ready');
    const ready = this.registry.readyByRole('backend');
    if (ready.length >= this.config.autoscale.maxNodes) return;
    const next = standby[0];
    if (next) {
      next.enabled = true;
      await this.exec(next.identity.id, 'start');
      console.log(`[cluster] scaled UP to ${ready.length + 1} nodes (${reason})`);
    } else {
      this.warnScaleUpNoStandby(reason);
    }
  }

  private lastScaleUpNoStandbyLog = 0;

  /** Log "want scale-up but no standby" at most once per minute so it does not
   *  spam the console every autoscaler tick (10s). Informational only. */
  private warnScaleUpNoStandby(reason: string): void {
    const now = Date.now();
    if (now - this.lastScaleUpNoStandbyLog < 60_000) return;
    this.lastScaleUpNoStandbyLog = now;
    console.log(`[cluster] scale-up requested (${reason}) but no standby backend node is available. ` +
      `Link additional backend nodes, or set them to standby via the admin, to enable autoscaling.`);
  }

  /** Drain + retire the least-loaded enabled backend node. */
  private async scaleDown(reason: string): Promise<void> {
    const ready = this.registry.readyByRole('backend');
    if (ready.length <= this.config.autoscale.minNodes) return;
    const least = [...ready].sort((a, b) => (a.lastMetrics?.rps ?? 0) - (b.lastMetrics?.rps ?? 0))[0];
    if (!least) return;
    await this.exec(least.identity.id, 'stop');
    least.enabled = false;
    console.log(`[cluster] scaled DOWN to ${this.registry.readyByRole('backend').length} nodes (${reason})`);
  }

  /** Poll all linked nodes once (health + metrics). */
  async pollAll(): Promise<void> {
    for (const node of this.registry.list()) await this.registry.poll(node.identity.id);
  }

  /** Persistent client helper for scripts/audit. */
  clientFor(id: string): NodeClient | undefined {
    return this.registry.clientFor(id);
  }

  async listenLb(host?: string): Promise<void> {
    if (!this.config.enabled) return;
    await this.lb.listen(this.config.lbPort, host ?? this.config.lbHost);
  }

  close(): Promise<void> {
    this.autoscaler.stop();
    return this.lb.close();
  }
}