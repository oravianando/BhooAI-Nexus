/** Plugin manifest + capabilities. */

/** A capability grants access to a host registrar or resource. */
export type Capability =
  | 'http' // register routes/middleware
  | 'graphql' // add a subgraph
  | 'data' // ODM models
  | 'auth' // auth helpers
  | 'realtime' // rooms/pubsub
  | 'scheduler' // cron-style jobs
  | 'events' // cross-plugin event bus
  | 'admin' // admin pages/slots
  | 'fs' // filesystem (allowlisted paths)
  | 'net'; // network (allowlisted hosts)

export const ALL_CAPABILITIES: Capability[] = [
  'http', 'graphql', 'data', 'auth', 'realtime', 'scheduler', 'events', 'admin', 'fs', 'net',
];

/** Lifecycle hooks a plugin can implement. */
export type LifecycleHook = 'install' | 'init' | 'start' | 'config:change' | 'stop';
export const LIFECYCLE_HOOKS: LifecycleHook[] = ['install', 'init', 'start', 'config:change', 'stop'];

export interface PluginManifest {
  /** Unique plugin name (kebab-case). */
  name: string;
  /** Semver version. */
  version: string;
  /** Entry module path relative to the plugin dir, e.g. "index.js". */
  entry: string;
  /** 'trusted' runs in-process with full Node API; 'sandboxed' runs in a worker_thread. */
  mode: 'trusted' | 'sandboxed';
  /** Capabilities this plugin requests. Sandbox mode gates every registrar by these. */
  capabilities: Capability[];
  /** Optional JSON schema for the plugin's config (validated before init). */
  configSchema?: Record<string, unknown>;
  /** Lifecycle hooks the plugin implements (for documentation/manifest validation). */
  hooks?: LifecycleHook[];
  /** Other plugin names that must start first (topological ordering). */
  dependencies?: string[];
}

/** Per-plugin sandbox limits (sandboxed mode only). */
export interface SandboxLimits {
  /** node:worker_threads resourceLimits. */
  resourceLimits?: {
    maxOldGenerationSizeMb?: number;
    maxYoungGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
    stackSizeMb?: number;
  };
  /** Heartbeat interval (ms); if a beat is missed within `heartbeatTimeoutMs` the worker is killed. */
  heartbeatMs?: number;
  heartbeatTimeoutMs?: number;
  /** Filesystem paths the plugin may access (when 'fs' capability is granted). */
  fsAllowPaths?: string[];
  /** Hostnames the plugin may reach (when 'net' capability is granted). */
  netAllowHosts?: string[];
}

/** Validate a manifest's shape; throws on missing/invalid fields. */
export function validateManifest(m: PluginManifest): void {
  if (!m.name || !/^[a-z0-9-]+$/.test(m.name)) throw new Error(`[nexus-plugins] invalid manifest name: ${m.name}`);
  if (!m.version) throw new Error(`[nexus-plugins] manifest version required`);
  if (m.mode !== 'trusted' && m.mode !== 'sandboxed') throw new Error(`[nexus-plugins] manifest mode must be trusted|sandboxed`);
  if (!m.entry) throw new Error(`[nexus-plugins] manifest entry required`);
  for (const c of m.capabilities ?? []) {
    if (!ALL_CAPABILITIES.includes(c)) throw new Error(`[nexus-plugins] unknown capability: ${c}`);
  }
  for (const dep of m.dependencies ?? []) {
    if (typeof dep !== 'string' || !dep.trim()) throw new Error(`[nexus-plugins] invalid dependency`);
  }
}