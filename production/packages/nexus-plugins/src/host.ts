import type { Capability, PluginManifest } from './manifest.js';

/** Admin extension specs a plugin can register (consumed by the admin app). */
export interface AdminPageSpec {
  /** Route path in the admin app, e.g. "/plugins/analytics". */
  path: string;
  /** Nav label. */
  title: string;
  /** Slot group this page belongs to (for nav grouping). */
  group?: string;
  /** Optional icon name. */
  icon?: string;
  /** Optional order within its group. */
  order?: number;
}

export interface SlotSpec {
  /** Named insertion point in the admin UI, e.g. "dashboard:top". */
  slot: string;
  /** Component/module the admin should render there. */
  component: string;
  /** Optional ordering. */
  order?: number;
}

/** A scheduler job descriptor. */
export interface ScheduledJob {
  name: string;
  cron: string;
}

/**
 * Host bindings — the actual implementation the app provides for each registrar.
 * The plugin context (trusted or sandboxed) delegates to these. Sandbox mode
 * intercepts calls to enforce capability policy before reaching the bindings.
 *
 * `ctx` params are deliberately `any` (the host's RequestContext type lives in
 * nexus-core; plugins should not import it directly — they receive a
 * PluginRequest via the sandbox proxy).
 */
export interface HostBindings {
  http: {
    addRoute(method: string, path: string, handler: (ctx: any) => void | Promise<void>): void;
    addMiddleware(mw: (ctx: any, next: () => Promise<void>) => Promise<void>, phase?: 'before-route' | 'after-route'): void;
  };
  graphql: {
    addSubgraph(subgraph: { name: string; typeDefs: string; resolvers: unknown }): Promise<void>;
    removeSubgraph(name: string): Promise<void>;
  };
  data: { registerModel(name: string, schema: unknown): unknown; getModel(name: string): unknown };
  realtime: { join(room: string, connId: string): void; broadcast(room: string, msg: unknown): void };
  scheduler: { schedule(name: string, cron: string, fn: () => void | Promise<void>): void; cancel(name: string): void };
  events: { publish(topic: string, payload: unknown): void; subscribe(topic: string, handler: (payload: unknown) => void): () => void };
  admin: { registerAdminPage(page: AdminPageSpec): void; registerSlot(slot: SlotSpec): void };
  services: { register(name: string, svc: unknown): void; get(name: string): unknown };
  config: { get(pluginName: string): unknown; set(pluginName: string, cfg: unknown): void };
  logger: { child(meta: Record<string, unknown>): { info(m: string, meta?: unknown): void; warn(m: string, meta?: unknown): void; error(m: string, meta?: unknown): void } };
}

/** The facade a plugin's lifecycle functions receive. */
export interface PluginContext {
  readonly pluginName: string;
  readonly capabilities: Capability[];
  readonly config: unknown;
  readonly logger: { info(m: string, meta?: unknown): void; warn(m: string, meta?: unknown): void; error(m: string, meta?: unknown): void };
  http: {
    addRoute(method: string, path: string, handler: (ctx: any) => void | Promise<void>): void;
    addMiddleware(mw: (ctx: any, next: () => Promise<void>) => Promise<void>, phase?: 'before-route' | 'after-route'): void;
  };
  graphql: { addSubgraph(subgraph: { name: string; typeDefs: string; resolvers: unknown }): Promise<void> };
  data: { registerModel(name: string, schema: unknown): unknown; getModel(name: string): unknown };
  realtime: { join(room: string, connId: string): void; broadcast(room: string, msg: unknown): void };
  scheduler: { schedule(name: string, cron: string, fn: () => void | Promise<void>): void; cancel(name: string): void };
  events: { publish(topic: string, payload: unknown): void; subscribe(topic: string, handler: (payload: unknown) => void): () => void };
  admin: { registerAdminPage(page: AdminPageSpec): void; registerSlot(slot: SlotSpec): void };
  services: { register(name: string, svc: unknown): void; get(name: string): unknown };
  /** Filesystem access (only if 'fs' capability granted; sandboxed: allowlisted paths). */
  fs?: { readFile(path: string): Promise<Buffer | string>; writeFile(path: string, data: string | Buffer): Promise<void> };
  /** Network access (only if 'net' capability granted; sandboxed: allowlisted hosts). */
  net?: { fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> };
}

/** Plugin module shape: a default export factory returning lifecycle handlers. */
export interface PluginModule {
  install?(ctx: PluginContext): Promise<void> | void;
  init?(ctx: PluginContext): Promise<void> | void;
  start?(ctx: PluginContext): Promise<void> | void;
  /** Called when the plugin's runtime config changes. */
  onConfigChange?(ctx: PluginContext, newConfig: unknown): Promise<void> | void;
  stop?(ctx: PluginContext): Promise<void> | void;
}

/** A loaded plugin handle. */
export interface PluginHandle {
  manifest: PluginManifest;
  state: 'loaded' | 'installed' | 'initialized' | 'started' | 'stopped' | 'errored';
  install(): Promise<void>;
  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Push a config change (re-validates + calls onConfigChange). */
  updateConfig(cfg: unknown): Promise<void>;
  /** Terminate the plugin (stop + for sandboxed, terminate the worker). */
  unload(): Promise<void>;
}
