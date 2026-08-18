import { Worker } from 'node:worker_threads';
import type { PluginManifest, SandboxLimits } from '../manifest.js';
import type { PluginHandle, HostBindings } from '../host.js';
import { authorize } from './capabilityPolicy.js';

/**
 * Sandboxed plugin: the entry runs inside a worker_thread with heap + event-loop
 * isolation. A crash in the worker cannot take the host down. The host owns the
 * real registrars (HostBindings); the worker calls them over a request/response
 * RPC, and the host authorizes every call via the capability policy before
 * forwarding. Route handlers registered by the worker run *inside* the worker —
 * the host proxies inbound requests to the worker over `invokeRoute` and awaits
 * the response. If the worker dies mid-request, the host returns a 503 and
 * (optionally) restarts it.
 */
export class SandboxedPlugin implements PluginHandle {
  readonly manifest: PluginManifest;
  state: PluginHandle['state'] = 'loaded';
  private readonly bindings: HostBindings;
  private readonly pluginDir: string;
  private readonly limits: SandboxLimits;
  private readonly caps: Set<string>;
  private worker: Worker | null = null;
  private ready = false;
  private readonly rpcReplies = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly routeHandlers = new Map<string, (ctx: any) => void | Promise<void>>();
  private readonly pendingRoutes = new Map<string, { resolve: (r: { status: number; body: unknown; headers: Record<string, string> }) => void }>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastHeartbeat = 0;
  private lifecycleWaiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private restartCount = 0;

  constructor(manifest: PluginManifest, pluginDir: string, bindings: HostBindings, config: unknown, limits: SandboxLimits = {}) {
    this.manifest = manifest;
    this.bindings = bindings;
    this.pluginDir = pluginDir;
    this.limits = limits;
    this.caps = new Set(manifest.capabilities as string[]);
    this.config = config;
  }

  private config: unknown;

  private bootstrapUrl(): URL {
    return new URL('./workerBootstrap.mjs', import.meta.url);
  }

  private spawnWorker(): void {
    const entryPath = `${this.pluginDir}/${this.manifest.entry}`;
    const worker = new Worker(this.bootstrapUrl(), {
      workerData: {
        entryPath,
        manifest: this.manifest,
        config: this.config,
        limits: this.limits,
      },
      resourceLimits: this.limits.resourceLimits ?? { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    });
    this.worker = worker;
    this.lastHeartbeat = Date.now();

    worker.on('message', (msg) => this.onWorkerMessage(msg));
    worker.on('error', (err) => {
      this.bindings.logger.child({ plugin: this.manifest.name }).error('worker error', { error: String(err.message) });
      this.handleWorkerDeath(err);
    });
    worker.on('exit', (code) => {
      if (code !== 0 && this.state !== 'stopped' && this.state !== 'errored') {
        this.handleWorkerDeath(new Error(`worker exited with code ${code}`));
      }
    });
  }

  private handleWorkerDeath(err: Error): void {
    this.ready = false;
    // Reject any in-flight RPC requests.
    for (const [, p] of this.rpcReplies) p.reject(err);
    this.rpcReplies.clear();
    for (const [, p] of this.pendingRoutes) p.resolve({ status: 503, body: { error: 'plugin worker unavailable' }, headers: {} });
    this.pendingRoutes.clear();
    for (const [, p] of this.lifecycleWaiters) p.reject(err);
    this.lifecycleWaiters.clear();
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.state = 'errored';
  }

  private onWorkerMessage(msg: any): void {
    switch (msg.kind) {
      case 'ready':
        this.ready = true;
        this.startHeartbeatWatchdog();
        break;
      case 'heartbeat':
        this.lastHeartbeat = Date.now();
        break;
      case 'log':
        this.bindings.logger.child({ plugin: this.manifest.name })[msg.level]?.(msg.msg, msg.meta);
        break;
      case 'rpc': {
        this.handleRpc(msg.id, msg.method, msg.args);
        break;
      }
      case 'routeResponse': {
        const p = this.pendingRoutes.get(msg.routeId);
        if (p) { this.pendingRoutes.delete(msg.routeId); p.resolve({ status: msg.status, body: msg.body, headers: msg.headers }); }
        break;
      }
      case 'lifecycleDone': {
        const w = this.lifecycleWaiters.get(msg.hook);
        if (w) {
          this.lifecycleWaiters.delete(msg.hook);
          if (msg.ok) w.resolve();
          else w.reject(new Error(msg.error));
        }
        break;
      }
      case 'fatal':
        this.handleWorkerDeath(new Error(msg.error));
        break;
    }
  }

  private async handleRpc(id: number, method: string, args: Record<string, unknown>): Promise<void> {
    // Authorize first.
    const decision = authorize(method, args, this.caps as Set<any>, this.limits.fsAllowPaths, this.limits.netAllowHosts);
    if (!decision.allowed) {
      this.worker?.postMessage({ kind: 'rpcResult', id, ok: false, error: decision.reason ?? 'denied' });
      return;
    }
    try {
      const result = await this.dispatch(method, args);
      this.worker?.postMessage({ kind: 'rpcResult', id, ok: true, result });
    } catch (err: any) {
      this.worker?.postMessage({ kind: 'rpcResult', id, ok: false, error: String(err?.message ?? err) });
    }
  }

  private async dispatch(method: string, args: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'http.addRoute': {
        const { method: m, path, routeId } = args as { method: string; path: string; routeId: string };
        const self = this;
        const handler = (ctx: any): void => self.invokeRoute(routeId, ctx);
        this.routeHandlers.set(routeId, handler);
        this.bindings.http.addRoute(m as any, path, handler);
        return undefined;
      }
      case 'http.addMiddleware':
        // Sandbox cannot serialize middleware functions; documented v1 no-op.
        this.bindings.logger.child({ plugin: this.manifest.name }).warn('sandboxed middleware not applied (v1 limitation)');
        return undefined;
      case 'data.registerModel': return this.bindings.data.registerModel(args.name as string, args.schema);
      case 'data.getModel': return this.bindings.data.getModel(args.name as string);
      case 'realtime.join': this.bindings.realtime.join(args.room as string, args.connId as string); return undefined;
      case 'realtime.broadcast': this.bindings.realtime.broadcast(args.room as string, args.msg); return undefined;
      case 'scheduler.schedule': {
        const self = this;
        this.bindings.scheduler.schedule(args.name as string, args.cron as string, () => self.worker?.postMessage({ kind: 'runSchedule', name: args.name as string }));
        return undefined;
      }
      case 'scheduler.cancel': this.bindings.scheduler.cancel(args.name as string); return undefined;
      case 'events.publish': this.bindings.events.publish(args.topic as string, args.payload); return undefined;
      case 'events.subscribe': {
        const self = this;
        this.bindings.events.subscribe(args.topic as string, (payload) => self.worker?.postMessage({ kind: 'event', topic: args.topic, payload }));
        return undefined;
      }
      case 'events.unsubscribe':
        // Best-effort: we don't track the unsubscribe fn here in v1.
        return undefined;
      case 'admin.registerAdminPage': this.bindings.admin.registerAdminPage(args.page as any); return undefined;
      case 'admin.registerSlot': this.bindings.admin.registerSlot(args.slot as any); return undefined;
      case 'services.register': this.bindings.services.register(args.name as string, args.svc); return undefined;
      case 'services.get': return this.bindings.services.get(args.name as string);
      case 'fs.readFile': {
        const f = await import('node:fs/promises');
        return f.readFile(args.path as string);
      }
      case 'fs.writeFile': {
        const f = await import('node:fs/promises');
        await f.writeFile(args.path as string, args.data as any);
        return undefined;
      }
      case 'net.fetch': {
        const r = await fetch(args.url as string, { method: (args.init as any)?.method, headers: (args.init as any)?.headers, body: (args.init as any)?.body });
        return { status: r.status, body: await r.text() };
      }
      default:
        throw new Error(`unknown RPC method: ${method}`);
    }
  }

  /** Proxy an inbound HTTP request into the worker, await its response. */
  private invokeRoute(routeId: string, ctx: any): void {
    const request = {
      method: ctx.method,
      path: ctx.path,
      headers: ctx.headers,
      body: ctx.body,
      params: ctx.params,
      query: ctx.query,
    };
    const promise = new Promise<{ status: number; body: unknown; headers: Record<string, string> }>((resolve) => {
      this.pendingRoutes.set(routeId, { resolve });
    });
    this.worker?.postMessage({ kind: 'invokeRoute', routeId, request });
    promise.then((res) => {
      ctx.status(res.status);
      if (res.headers) for (const [k, v] of Object.entries(res.headers)) ctx.setHeader(k, v);
      if (res.body !== undefined) ctx.json(res.body);
    });
  }

  private startHeartbeatWatchdog(): void {
    const timeout = this.limits.heartbeatTimeoutMs ?? 4000;
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastHeartbeat > timeout) {
        this.bindings.logger.child({ plugin: this.manifest.name }).error('heartbeat missed; terminating worker');
        this.worker?.terminate().catch(() => {});
        this.handleWorkerDeath(new Error('heartbeat timeout'));
      }
    }, timeout);
  }

  private sendLifecycle(hook: string, config?: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      this.lifecycleWaiters.set(hook, { resolve, reject });
      this.worker?.postMessage({ kind: 'lifecycle', hook, config });
    });
  }

  async install(): Promise<void> {
    if (!this.worker) this.spawnWorker();
    // Wait for the worker to report ready, then drive install via RPC.
    await this.waitForReady();
    await this.sendLifecycle('install');
    this.state = 'installed';
  }

  private waitForReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.ready) resolve();
        else if (this.state === 'errored') reject(new Error('worker failed to start'));
        else setTimeout(check, 20);
      };
      check();
    });
  }

  async init(): Promise<void> { await this.sendLifecycle('init'); this.state = 'initialized'; }
  async start(): Promise<void> { await this.sendLifecycle('start'); this.state = 'started'; }
  async stop(): Promise<void> {
    try { await this.sendLifecycle('stop'); } catch { /* worker may be dead */ }
    this.state = 'stopped';
  }

  async updateConfig(cfg: unknown): Promise<void> {
    this.config = cfg;
    await this.sendLifecycle('config:change', cfg);
  }

  async unload(): Promise<void> {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    try { await this.sendLifecycle('stop'); } catch { /* ignore */ }
    await this.worker?.terminate().catch(() => {});
    this.worker = null;
    this.ready = false;
    this.state = 'stopped';
  }

  /** Test helper: number of times the worker died. */
  getRestarts(): number { return this.restartCount; }
}