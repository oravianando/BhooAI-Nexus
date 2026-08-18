import type { Capability } from '../manifest.js';

/** Maps an RPC method name to the capability it requires. */
const METHOD_CAPABILITY: Record<string, Capability> = {
  'http.addRoute': 'http',
  'http.addMiddleware': 'http',
  'data.registerModel': 'data',
  'data.getModel': 'data',
  'realtime.join': 'realtime',
  'realtime.broadcast': 'realtime',
  'scheduler.schedule': 'scheduler',
  'scheduler.cancel': 'scheduler',
  'events.publish': 'events',
  'events.subscribe': 'events',
  'events.unsubscribe': 'events',
  'admin.registerAdminPage': 'admin',
  'admin.registerSlot': 'admin',
  'services.register': 'events',
  'services.get': 'events',
  'fs.readFile': 'fs',
  'fs.writeFile': 'fs',
  'net.fetch': 'net',
};

/** Result of an authorization check. */
export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether a sandboxed plugin may invoke an RPC method with the given args,
 * given its declared capabilities and allowlists. The capability set is checked
 * first; for fs/net the path/host is additionally checked against the allowlist.
 * The `http` route handler is *not* gated here — it is a push from the host to the
 * worker (invokeRoute), not a worker RPC.
 */
export function authorize(
  method: string,
  args: Record<string, unknown>,
  capabilities: Set<Capability>,
  fsAllowPaths?: string[],
  netAllowHosts?: string[],
): PolicyDecision {
  const cap = METHOD_CAPABILITY[method];
  if (!cap) {
    // Unknown methods (incl. logger, which is always allowed) — allow by default.
    return { allowed: true };
  }
  if (!capabilities.has(cap)) {
    return { allowed: false, reason: `missing capability: ${cap}` };
  }
  if (method === 'fs.readFile' || method === 'fs.writeFile') {
    const path = String(args.path ?? '');
    if (fsAllowPaths && fsAllowPaths.length > 0 && !fsAllowPaths.some((p) => path === p || path.startsWith(p))) {
      return { allowed: false, reason: `path outside allowlist: ${path}` };
    }
  }
  if (method === 'net.fetch') {
    const url = String(args.url ?? '');
    let host = '';
    try { host = new URL(url).hostname; } catch { host = url; }
    if (netAllowHosts && netAllowHosts.length > 0 && !netAllowHosts.includes(host)) {
      return { allowed: false, reason: `host outside allowlist: ${host}` };
    }
  }
  return { allowed: true };
}