import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateManifest,
  HookBus,
  ServiceContainer,
  authorize,
  AdminExtensions,
  TrustedPlugin,
  SandboxedPlugin,
  PluginHost,
  ALL_CAPABILITIES,
} from '../src/index.js';
import type { HostBindings, PluginManifest } from '../src/index.js';

/** Build a mock HostBindings that records registrar calls + stores route handlers. */
function mockBindings(): HostBindings & {
  routes: Map<string, (ctx: any) => void | Promise<void>>;
  logs: Array<{ plugin: string; level: string; msg: string }>;
  events: Map<string, (p: unknown) => void>;
} {
  const routes = new Map<string, (ctx: any) => void | Promise<void>>();
  const logs: Array<{ plugin: string; level: string; msg: string }> = [];
  const eventSubs = new Map<string, (p: unknown) => void>();
  const logger = {
    child(meta: Record<string, unknown>) {
      const plugin = String(meta.plugin ?? '?');
      return {
        info: (m: string) => logs.push({ plugin, level: 'info', msg: m }),
        warn: (m: string) => logs.push({ plugin, level: 'warn', msg: m }),
        error: (m: string) => logs.push({ plugin, level: 'error', msg: m }),
      };
    },
  };
  return {
    routes, logs, eventSubs, logger,
    http: {
      addRoute: (method, path, handler) => routes.set(`${method} ${path}`, handler),
      addMiddleware: () => {},
    },
    graphql: { addSubgraph: async () => {}, removeSubgraph: async () => {} },
    data: { registerModel: () => ({}), getModel: () => ({}) },
    realtime: { join: () => {}, broadcast: () => {} },
    scheduler: { schedule: () => {}, cancel: () => {} },
    events: {
      publish: (t, p) => eventSubs.get(t)?.(p),
      subscribe: (t, h) => { eventSubs.set(t, h); return () => eventSubs.delete(t); },
    },
    admin: { registerAdminPage: () => {}, registerSlot: () => {} },
    services: { register: () => {}, get: () => undefined },
    config: { get: () => undefined, set: () => {} },
  } as any;
}

/** A mock request ctx that resolves `done` when a response method is called. */
function mockRequestCtx() {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const ctx: any = {
    method: 'GET', path: '/x', headers: {}, body: undefined, params: {}, query: {},
    _status: 200, _body: undefined, _headers: {} as Record<string, string>,
    status(s: number) { this._status = s; },
    setHeader(k: string, v: string) { this._headers[k] = v; },
    json(b: unknown, s?: number) { this._body = b; if (s) this._status = s; resolve(); },
    text(b: unknown, s?: number) { this._body = b; if (s) this._status = s; resolve(); },
    done,
  };
  return ctx;
}

async function makePluginDir(manifest: PluginManifest, entrySource: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-plugin-'));
  await writeFile(join(dir, 'plugin.json'), JSON.stringify(manifest));
  await writeFile(join(dir, manifest.entry), entrySource);
  return dir;
}

/** Write a plugin (subdir + manifest + entry) under a plugins root dir. */
async function writePlugin(root: string, name: string, manifest: PluginManifest, entrySource: string): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'plugin.json'), JSON.stringify(manifest));
  await writeFile(join(dir, manifest.entry), entrySource);
}

describe('manifest + validation', () => {
  it('accepts a valid manifest', () => {
    expect(() => validateManifest({ name: 'a-b', version: '1.0.0', entry: 'index.mjs', mode: 'trusted', capabilities: ['http'] })).not.toThrow();
  });
  it('rejects bad name / mode / unknown capability', () => {
    expect(() => validateManifest({ name: 'Bad', version: '1', entry: 'i.mjs', mode: 'trusted', capabilities: [] })).toThrow();
    expect(() => validateManifest({ name: 'ok', version: '1', entry: 'i.mjs', mode: 'weird', capabilities: [] })).toThrow();
    expect(() => validateManifest({ name: 'ok', version: '1', entry: 'i.mjs', mode: 'trusted', capabilities: ['bogus' as any] })).toThrow();
  });
  it('ALL_CAPABILITIES has the 10 expected entries', () => {
    expect(ALL_CAPABILITIES).toHaveLength(10);
    expect(ALL_CAPABILITIES).toContain('fs');
  });
});

describe('HookBus + ServiceContainer', () => {
  it('pub/sub delivers + unsubscribe', () => {
    const bus = new HookBus();
    const seen: unknown[] = [];
    const off = bus.subscribe('t', (p) => seen.push(p));
    bus.publish('t', 1);
    bus.publish('t', 2);
    off();
    bus.publish('t', 3);
    expect(seen).toEqual([1, 2]);
    expect(bus.subscriberCount('t')).toBe(0);
  });
  it('ServiceContainer register/get/has/remove', () => {
    const c = new ServiceContainer();
    expect(c.has('x')).toBe(false);
    c.register('x', { v: 1 });
    expect(c.has('x')).toBe(true);
    expect((c.get<{ v: number }>('x')).v).toBe(1);
    c.remove('x');
    expect(c.has('x')).toBe(false);
  });
  it('rejects double registration + missing get', () => {
    const c = new ServiceContainer();
    c.register('x', 1);
    expect(() => c.register('x', 2)).toThrow();
    expect(() => c.get('y')).toThrow();
  });
});

describe('capabilityPolicy', () => {
  const caps = (arr: string[]) => new Set(arr as any);
  it('allows when capability present', () => {
    expect(authorize('http.addRoute', {}, caps(['http']))).toEqual({ allowed: true });
  });
  it('denies when capability missing', () => {
    expect(authorize('http.addRoute', {}, caps(['events']))).toEqual({ allowed: false, reason: 'missing capability: http' });
  });
  it('fs path must be within allowlist', () => {
    expect(authorize('fs.readFile', { path: '/etc/passwd' }, caps(['fs']), ['/data'])).toEqual({ allowed: false, reason: 'path outside allowlist: /etc/passwd' });
    expect(authorize('fs.readFile', { path: '/data/x.txt' }, caps(['fs']), ['/data'])).toEqual({ allowed: true });
  });
  it('net host must be allowlisted', () => {
    expect(authorize('net.fetch', { url: 'https://evil.com/x' }, caps(['net']), [], ['api.good.com'])).toEqual({ allowed: false, reason: 'host outside allowlist: evil.com' });
    expect(authorize('net.fetch', { url: 'https://api.good.com/x' }, caps(['net']), [], ['api.good.com'])).toEqual({ allowed: true });
  });
  it('unknown methods allowed (logger etc.)', () => {
    expect(authorize('log', {}, caps([]))).toEqual({ allowed: true });
  });
});

describe('AdminExtensions', () => {
  it('registers pages + slots, groups, orders, removes by plugin', () => {
    const ext = new AdminExtensions();
    ext.registerPage('a', { path: '/a', title: 'A', group: 'G1', order: 2 });
    ext.registerPage('b', { path: '/b', title: 'B', group: 'G1', order: 1 });
    ext.registerPage('c', { path: '/c', title: 'C', group: 'G2' });
    ext.registerSlot('a', { slot: 'dash:top', component: 'AComp', order: 2 });
    ext.registerSlot('b', { slot: 'dash:top', component: 'BComp', order: 1 });
    const grouped = ext.groupedPages();
    expect(grouped.G1.map((p) => p.title)).toEqual(['B', 'A']);
    expect(grouped.G2.map((p) => p.title)).toEqual(['C']);
    expect(ext.listSlots('dash:top').map((s) => s.component)).toEqual(['BComp', 'AComp']);
    ext.removePlugin('a');
    expect(ext.listPages().find((p) => p.plugin === 'a')).toBeUndefined();
    expect(ext.listSlots('dash:top').map((s) => s.component)).toEqual(['BComp']);
  });
});

describe('TrustedPlugin', () => {
  it('runs lifecycle and registers a route the host can invoke', async () => {
    const dir = await makePluginDir(
      { name: 'trusted-demo', version: '1.0.0', entry: 'index.mjs', mode: 'trusted', capabilities: ['http'] },
      `export default {
        async install(ctx) { ctx.logger.info('installed'); },
        async start(ctx) {
          ctx.http.addRoute('GET', '/hello', (c) => c.json({ msg: 'hi from ' + ctx.pluginName }));
        },
      }`,
    );
    const b = mockBindings();
    const manifest: PluginManifest = { name: 'trusted-demo', version: '1.0.0', entry: 'index.mjs', mode: 'trusted', capabilities: ['http'] };
    const plugin = new TrustedPlugin(manifest, dir, b, {});
    await plugin.install();
    await plugin.start();
    expect(plugin.state).toBe('started');
    const handler = b.routes.get('GET /hello')!;
    expect(handler).toBeTruthy();
    const ctx = mockRequestCtx();
    await handler(ctx);
    await ctx.done;
    expect(ctx._body).toEqual({ msg: 'hi from trusted-demo' });
    await plugin.unload();
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a registrar the manifest did not request', async () => {
    const dir = await makePluginDir(
      { name: 'no-events', version: '1.0.0', entry: 'index.mjs', mode: 'trusted', capabilities: [] },
      `export default { async start(ctx) { ctx.events.publish('x', 1); } }`,
    );
    const manifest: PluginManifest = { name: 'no-events', version: '1.0.0', entry: 'index.mjs', mode: 'trusted', capabilities: [] };
    const b = mockBindings();
    const plugin = new TrustedPlugin(manifest, dir, b, {});
    await plugin.install();
    await expect(plugin.start()).rejects.toThrow(/lacks capability: events/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('SandboxedPlugin (worker_threads)', () => {
  it('round-trips an HTTP route through the worker and back', async () => {
    const dir = await makePluginDir(
      { name: 'sandbox-demo', version: '1.0.0', entry: 'index.mjs', mode: 'sandboxed', capabilities: ['http'] },
      `export default {
        async start(ctx) {
          ctx.http.addRoute('GET', '/w', (c) => c.json({ from: 'worker', echo: c.query.e }));
        },
      }`,
    );
    const manifest: PluginManifest = { name: 'sandbox-demo', version: '1.0.0', entry: 'index.mjs', mode: 'sandboxed', capabilities: ['http'] };
    const b = mockBindings();
    const plugin = new SandboxedPlugin(manifest, dir, b, {}, { heartbeatMs: 200, heartbeatTimeoutMs: 5000 });
    await plugin.install();
    await plugin.start();
    expect(plugin.state).toBe('started');
    // The host registered a *proxy* handler that posts into the worker.
    const handler = b.routes.get('GET /w')!;
    expect(handler).toBeTruthy();
    const ctx = mockRequestCtx();
    ctx.query = { e: 'ping' };
    await handler(ctx);
    await ctx.done;
    expect(ctx._body).toEqual({ from: 'worker', echo: 'ping' });
    await plugin.unload();
    await rm(dir, { recursive: true, force: true });
  }, 30_000);

  it('isolates a crashing route handler — host survives, returns 500', async () => {
    const dir = await makePluginDir(
      { name: 'sandbox-crash', version: '1.0.0', entry: 'index.mjs', mode: 'sandboxed', capabilities: ['http'] },
      `export default {
        async start(ctx) {
          ctx.http.addRoute('GET', '/crash', () => { throw new Error('boom'); });
          ctx.http.addRoute('GET', '/ok', (c) => c.json({ ok: true }));
        },
      }`,
    );
    const manifest: PluginManifest = { name: 'sandbox-crash', version: '1.0.0', entry: 'index.mjs', mode: 'sandboxed', capabilities: ['http'] };
    const b = mockBindings();
    const plugin = new SandboxedPlugin(manifest, dir, b, {}, { heartbeatMs: 200, heartbeatTimeoutMs: 5000 });
    await plugin.install();
    await plugin.start();
    // Crashing route → 500, but the host process is still alive.
    const crashCtx = mockRequestCtx();
    await b.routes.get('GET /crash')!(crashCtx);
    await crashCtx.done;
    expect(crashCtx._status).toBe(500);
    // A second route on the same (still-running) worker works fine.
    const okCtx = mockRequestCtx();
    await b.routes.get('GET /ok')!(okCtx);
    await okCtx.done;
    expect(okCtx._body).toEqual({ ok: true });
    await plugin.unload();
    await rm(dir, { recursive: true, force: true });
  }, 30_000);

  it('denies a registrar the plugin lacks the capability for (lifecycle fails)', async () => {
    // Plugin calls ctx.events.publish but manifest has no 'events' capability.
    const dir = await makePluginDir(
      { name: 'sandbox-nocap', version: '1.0.0', entry: 'index.mjs', mode: 'sandboxed', capabilities: ['http'] },
      `export default { async start(ctx) { ctx.events.publish('t', 1); } }`,
    );
    const manifest: PluginManifest = { name: 'sandbox-nocap', version: '1.0.0', entry: 'index.mjs', mode: 'sandboxed', capabilities: ['http'] };
    const b = mockBindings();
    const plugin = new SandboxedPlugin(manifest, dir, b, {}, { heartbeatMs: 200, heartbeatTimeoutMs: 5000 });
    await plugin.install();
    await expect(plugin.start()).rejects.toThrow(/lacks capability: events/);
    await plugin.unload();
    await rm(dir, { recursive: true, force: true });
  }, 30_000);
});

describe('PluginHost registry + topological lifecycle', () => {
  it('loads trusted plugins from a dir and runs lifecycle in dependency order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexus-plugins-root-'));
    // Plugin 'base' (no deps) and plugin 'depender' (depends on base).
    // Each records its start order via an http.addRoute whose path encodes order.
    await writePlugin(root, 'base', { name: 'base', version: '1', entry: 'index.mjs', mode: 'trusted', capabilities: ['http'] }, `export default { async start(ctx) { ctx.http.addRoute('GET', '/0-base', () => {}); } };`);
    await writePlugin(root, 'depender', { name: 'depender', version: '1', entry: 'index.mjs', mode: 'trusted', capabilities: ['http'], dependencies: ['base'] }, `export default { async start(ctx) { ctx.http.addRoute('GET', '/1-depender', () => {}); } };`);

    const b = mockBindings();
    const host = new PluginHost(b, root);
    const order = await host.load();
    expect(order).toEqual(['base', 'depender']);
    await host.install();
    await host.start();
    // Routes were registered in start order: base first, depender second.
    expect([...b.routes.keys()]).toEqual(['GET /0-base', 'GET /1-depender']);
    await host.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('stops in reverse dependency order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexus-plugins-root-'));
    await writePlugin(root, 'a', { name: 'a', version: '1', entry: 'index.mjs', mode: 'trusted', capabilities: ['http'] }, `export default { async stop(ctx) { ctx.http.addRoute('GET', '/stop-a', () => {}); } };`);
    await writePlugin(root, 'b', { name: 'b', version: '1', entry: 'index.mjs', mode: 'trusted', capabilities: ['http'], dependencies: ['a'] }, `export default { async stop(ctx) { ctx.http.addRoute('GET', '/stop-b', () => {}); } };`);
    const b = mockBindings();
    const host = new PluginHost(b, root);
    await host.load();
    await host.install();
    await host.start();
    b.routes.clear();
    await host.stop();
    // Stopped in reverse: b first, then a.
    expect([...b.routes.keys()]).toEqual(['GET /stop-b', 'GET /stop-a']);
    await rm(root, { recursive: true, force: true });
  });

  it('detects a dependency cycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexus-plugins-root-'));
    await writePlugin(root, 'x', { name: 'x', version: '1', entry: 'index.mjs', mode: 'trusted', capabilities: [], dependencies: ['y'] }, `export default {};`);
    await writePlugin(root, 'y', { name: 'y', version: '1', entry: 'index.mjs', mode: 'trusted', capabilities: [], dependencies: ['x'] }, `export default {};`);
    const b = mockBindings();
    const host = new PluginHost(b, root);
    await expect(host.load()).rejects.toThrow(/cycle/);
    await rm(root, { recursive: true, force: true });
  });
});