import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginManifest } from './manifest.js';
import { validateManifest } from './manifest.js';
import type { PluginHandle, HostBindings } from './host.js';
import { TrustedPlugin } from './runtime/TrustedPlugin.js';
import { SandboxedPlugin } from './sandbox/SandboxedPlugin.js';

/**
 * PluginHost: loads plugin manifests from a directory, constructs the right handle
 * (trusted in-process vs sandboxed worker), orders them topologically by their
 * declared `dependencies`, and drives the install → init → start → stop lifecycle
 * in that order. Reload supports updating config and (for sandboxed) restarting.
 */
export class PluginHost {
  private handles = new Map<string, PluginHandle>();
  private readonly bindings: HostBindings;
  private readonly pluginsDir: string;
  private loadOrder: string[] = [];

  constructor(bindings: HostBindings, pluginsDir: string) {
    this.bindings = bindings;
    this.pluginsDir = pluginsDir;
  }

  /** Discover and load (but not start) all plugins. Returns the load order. */
  async load(configByPlugin: Record<string, unknown> = {}, limitsByPlugin: Record<string, unknown> = {}): Promise<string[]> {
    let entries: string[] = [];
    try { entries = await readdir(this.pluginsDir); } catch { /* no plugins dir */ }

    const manifests = new Map<string, { manifest: PluginManifest; dir: string }>();
    for (const entry of entries) {
      const dir = join(this.pluginsDir, entry);
      let isDir = false;
      try { isDir = (await stat(dir)).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      let raw: string;
      try { raw = await readFile(join(dir, 'plugin.json'), 'utf8'); } catch { continue; }
      const manifest = JSON.parse(raw) as PluginManifest;
      validateManifest(manifest);
      manifests.set(manifest.name, { manifest, dir });
    }

    this.loadOrder = this.topoSort(manifests);

    for (const name of this.loadOrder) {
      const { manifest, dir } = manifests.get(name)!;
      const cfg = configByPlugin[name];
      if (manifest.mode === 'trusted') {
        this.handles.set(name, new TrustedPlugin(manifest, dir, this.bindings, cfg));
      } else {
        this.handles.set(name, new SandboxedPlugin(manifest, dir, this.bindings, cfg, (limitsByPlugin[name] ?? {}) as any));
      }
    }
    return this.loadOrder;
  }

  /** Topologically sort manifest names by `dependencies`. Throws on cycles/missing deps. */
  private topoSort(manifests: Map<string, { manifest: PluginManifest }>): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const out: string[] = [];
    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`[nexus-plugins] dependency cycle at ${name}`);
      const entry = manifests.get(name);
      if (!entry) throw new Error(`[nexus-plugins] missing dependency target: ${name}`);
      visiting.add(name);
      for (const dep of entry.manifest.dependencies ?? []) visit(dep);
      visiting.delete(name);
      visited.add(name);
      out.push(name);
    };
    for (const name of manifests.keys()) visit(name);
    return out;
  }

  /** Run a lifecycle hook across all plugins in dependency order. */
  async runLifecycle(hook: 'install' | 'init' | 'start' | 'stop'): Promise<void> {
    const order = hook === 'stop' ? [...this.loadOrder].reverse() : this.loadOrder;
    for (const name of order) {
      const handle = this.handles.get(name)!;
      try {
        await handle[hook]();
      } catch (err: any) {
        handle.state = 'errored';
        this.bindings.logger.child({ plugin: name }).error(`lifecycle ${hook} failed`, { error: String(err?.message ?? err) });
        throw new Error(`[nexus-plugins] ${name} failed during ${hook}: ${err?.message ?? err}`);
      }
    }
  }

  async install(): Promise<void> { return this.runLifecycle('install'); }
  async init(): Promise<void> { return this.runLifecycle('init'); }
  async start(): Promise<void> { return this.runLifecycle('start'); }

  async stop(): Promise<void> {
    // Stop in reverse dependency order; never throw — best-effort shutdown.
    const order = [...this.loadOrder].reverse();
    for (const name of order) {
      try { await this.handles.get(name)?.stop(); } catch { /* swallow */ }
    }
  }

  /** Update a single plugin's config and notify it. */
  async updateConfig(name: string, config: unknown): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle) throw new Error(`[nexus-plugins] unknown plugin: ${name}`);
    await handle.updateConfig(config);
  }

  async unload(name: string): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle) return;
    await handle.unload();
    this.handles.delete(name);
    this.loadOrder = this.loadOrder.filter((n) => n !== name);
  }

  get(name: string): PluginHandle | undefined { return this.handles.get(name); }
  list(): PluginHandle[] { return this.loadOrder.map((n) => this.handles.get(n)!).filter(Boolean); }
  order(): string[] { return [...this.loadOrder]; }
}