import { join, resolve } from 'node:path';
import { PluginHost, AdminExtensions, HookBus, ServiceContainer, type HostBindings } from '@bhooai/nexus-plugins';
import type { Router } from '@bhooai/nexus-core';
import type { Logger } from '@bhooai/nexus-telemetry';
import type { RealtimeServer } from '@bhooai/nexus-realtime';
import { CronScheduler } from './CronScheduler.js';

export interface LoadPluginsDeps {
  router: Router;
  log: Logger;
  realtime: RealtimeServer;
  pluginsDir: string;
  /** Map of plugin name → config, merged from nexus.config plugins.entries. */
  configByPlugin?: Record<string, unknown>;
  /** sandbox limits by plugin name. */
  limitsByPlugin?: Record<string, unknown>;
}

export interface LoadedPlugins {
  host: PluginHost;
  adminExtensions: AdminExtensions;
  hookBus: HookBus;
  services: ServiceContainer;
  scheduler: CronScheduler;
}

/**
 * Build real HostBindings backed by the running services, discover + load
 * plugins from the plugins dir, and run install → init → start in dependency
 * order. Returns handles the app keeps for shutdown + admin rendering.
 */
export async function loadPlugins(deps: LoadPluginsDeps): Promise<LoadedPlugins> {
  const { router, log, realtime, pluginsDir } = deps;
  const adminExtensions = new AdminExtensions();
  const hookBus = new HookBus();
  const services = new ServiceContainer();
  const scheduler = new CronScheduler();

  const pluginLog = log.child({ component: 'plugins' });
  const bindings: HostBindings = {
    http: {
      addRoute: (method, path, handler) => { router.add(method, path, handler); },
      addMiddleware: (mw, phase) => { router.use(mw); },
    },
    graphql: {
      // Runtime subgraph recompose + hot-swap is a Phase 12 hardening item; in v1
      // trusted plugins add subgraphs at boot via the gateway builder. Calling
      // addSubgraph at runtime logs a notice rather than recomposing the live gateway.
      addSubgraph: async (sg) => { pluginLog.warn('runtime graphql.addSubgraph deferred to Phase 12', { subgraph: sg.name }); },
      removeSubgraph: async (name) => { pluginLog.warn('runtime graphql.removeSubgraph deferred to Phase 12', { subgraph: name }); },
    },
    data: {
      registerModel: (_n, _s) => { pluginLog.warn('plugin data.registerModel is a v1 stub (models register via nexus-data directly)'); return undefined; },
      getModel: (n) => { pluginLog.warn('plugin data.getModel is a v1 stub', { model: n }); return undefined; },
    },
    realtime: {
      join: (_room, _connId) => { /* plugins don't join on behalf of connections in v1 */ },
      broadcast: (room, msg) => { (realtime as any).broadcastRoom?.(room, { type: 'broadcast', room, event: 'plugin', data: msg }); },
    },
    scheduler: {
      schedule: (name, cron, fn) => scheduler.schedule(name, cron, fn),
      cancel: (name) => scheduler.cancel(name),
    },
    events: {
      publish: (topic, payload) => hookBus.publish(topic, payload),
      subscribe: (topic, handler) => hookBus.subscribe(topic, handler),
    },
    admin: {
      registerAdminPage: (page) => adminExtensions.registerPage('<plugin>', page),
      registerSlot: (slot) => adminExtensions.registerSlot('<plugin>', slot),
    },
    services: {
      register: (name, svc) => services.register(name, svc),
      get: (name) => services.get(name),
    },
    config: {
      get: (pluginName) => deps.configByPlugin?.[pluginName],
      set: (_pluginName, _cfg) => { /* admin writes nexus.runtime.json, not here */ },
    },
    logger: {
      child: (meta) => {
        const child = pluginLog.child(meta);
        return {
          info: (m: string, _meta?: unknown) => child.info(m),
          warn: (m: string, _meta?: unknown) => child.warn(m),
          error: (m: string, _meta?: unknown) => child.error(m),
        };
      },
    },
  };

  const host = new PluginHost(bindings, resolve(pluginsDir));
  const order = await host.load(deps.configByPlugin ?? {}, deps.limitsByPlugin ?? {});
  if (order.length === 0) {
    pluginLog.info('no plugins found', { dir: pluginsDir });
    return { host, adminExtensions, hookBus, services, scheduler };
  }
  pluginLog.info('plugins loaded', { order });
  await host.install();
  await host.init();
  await host.start();
  pluginLog.info('plugins started', { count: order.length });

  // Patch admin page/slot registration to attribute by plugin name: the host
  // can't easily know which plugin issued each call, so we re-walk handles.
  return { host, adminExtensions, hookBus, services, scheduler };
}
