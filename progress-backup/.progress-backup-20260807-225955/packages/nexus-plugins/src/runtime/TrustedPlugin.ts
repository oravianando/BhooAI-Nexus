import { pathToFileURL } from 'node:url';
import type { PluginManifest } from '../manifest.js';
import type { PluginContext, PluginModule, PluginHandle, HostBindings } from '../host.js';

/**
 * Trusted in-process plugin: the entry module is imported directly into the host
 * and its lifecycle functions run with full Node API access. Every registrar on
 * the context is checked against the manifest's capabilities (defense in depth —
 * a trusted plugin could reach the host directly, but going through the context
 * keeps the contract uniform with sandboxed plugins and lets the app audit usage).
 */
export class TrustedPlugin implements PluginHandle {
  readonly manifest: PluginManifest;
  state: PluginHandle['state'] = 'loaded';
  private readonly bindings: HostBindings;
  private readonly pluginDir: string;
  private module: PluginModule | null = null;
  private ctx: PluginContext | null = null;
  private config: unknown;

  constructor(manifest: PluginManifest, pluginDir: string, bindings: HostBindings, config: unknown) {
    this.manifest = manifest;
    this.bindings = bindings;
    this.pluginDir = pluginDir;
    this.config = config;
  }

  private requireCap(cap: string): void {
    if (!this.manifest.capabilities.includes(cap as any)) {
      throw new Error(`[nexus-plugins] ${this.manifest.name} lacks capability: ${cap}`);
    }
  }

  private buildContext(): PluginContext {
    const self = this;
    const logger = this.bindings.logger.child({ plugin: this.manifest.name });
    const has = (c: string) => this.manifest.capabilities.includes(c as any);
    const ctx: PluginContext = {
      pluginName: this.manifest.name,
      capabilities: this.manifest.capabilities,
      config: this.config,
      logger,
      http: {
        addRoute: (method, path, handler) => { self.requireCap('http'); self.bindings.http.addRoute(method, path, handler); },
        addMiddleware: (mw, phase) => { self.requireCap('http'); self.bindings.http.addMiddleware(mw, phase); },
      },
      graphql: { addSubgraph: async (sg) => { self.requireCap('graphql'); await self.bindings.graphql.addSubgraph(sg); } },
      data: {
        registerModel: (n, s) => { self.requireCap('data'); return self.bindings.data.registerModel(n, s); },
        getModel: (n) => { self.requireCap('data'); return self.bindings.data.getModel(n); },
      },
      realtime: {
        join: (r, c) => { self.requireCap('realtime'); self.bindings.realtime.join(r, c); },
        broadcast: (r, m) => { self.requireCap('realtime'); self.bindings.realtime.broadcast(r, m); },
      },
      scheduler: {
        schedule: (n, cron, fn) => { self.requireCap('scheduler'); self.bindings.scheduler.schedule(n, cron, fn); },
        cancel: (n) => { self.requireCap('scheduler'); self.bindings.scheduler.cancel(n); },
      },
      events: {
        publish: (t, p) => { self.requireCap('events'); self.bindings.events.publish(t, p); },
        subscribe: (t, h) => { self.requireCap('events'); return self.bindings.events.subscribe(t, h); },
      },
      admin: {
        registerAdminPage: (p) => { self.requireCap('admin'); self.bindings.admin.registerAdminPage(p); },
        registerSlot: (s) => { self.requireCap('admin'); self.bindings.admin.registerSlot(s); },
      },
      services: {
        register: (n, s) => { self.requireCap('events'); self.bindings.services.register(n, s); },
        get: (n) => { self.requireCap('events'); return self.bindings.services.get(n); },
      },
    };
    if (has('fs')) {
      ctx.fs = {
        readFile: async (p) => { self.requireCap('fs'); return import('node:fs/promises').then((f) => f.readFile(p)); },
        writeFile: async (p, d) => { self.requireCap('fs'); return import('node:fs/promises').then((f) => f.writeFile(p, d)); },
      };
    }
    if (has('net')) {
      ctx.net = {
        fetch: async (url, init) => { self.requireCap('net'); const r = await fetch(url, { method: init?.method, headers: init?.headers, body: init?.body }); return { status: r.status, body: await r.text() }; },
      };
    }
    this.ctx = ctx;
    return ctx;
  }

  private async loadModule(): Promise<PluginModule> {
    if (this.module) return this.module;
    const entryUrl = pathToFileURL(`${this.pluginDir}/${this.manifest.entry}`).href;
    const mod = await import(entryUrl);
    this.module = (mod.default ?? mod) as PluginModule;
    return this.module;
  }

  async install(): Promise<void> {
    const mod = await this.loadModule();
    const ctx = this.buildContext();
    if (mod.install) await mod.install(ctx);
    this.state = 'installed';
  }

  async init(): Promise<void> {
    const mod = this.module ?? (await this.loadModule());
    const ctx = this.ctx ?? this.buildContext();
    if (mod.init) await mod.init(ctx);
    this.state = 'initialized';
  }

  async start(): Promise<void> {
    const mod = this.module ?? (await this.loadModule());
    const ctx = this.ctx ?? this.buildContext();
    if (mod.start) await mod.start(ctx);
    this.state = 'started';
  }

  async stop(): Promise<void> {
    if (this.module?.stop && this.ctx) await this.module.stop(this.ctx);
    this.state = 'stopped';
  }

  async updateConfig(cfg: unknown): Promise<void> {
    this.config = cfg;
    if (this.ctx) (this.ctx as { config: unknown }).config = cfg;
    if (this.module?.onConfigChange && this.ctx) await this.module.onConfigChange(this.ctx, cfg);
  }

  async unload(): Promise<void> {
    await this.stop();
    this.module = null;
    this.ctx = null;
    this.state = 'stopped';
  }
}