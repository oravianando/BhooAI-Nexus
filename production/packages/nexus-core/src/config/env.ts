import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeepPartial, NexusConfig } from './types.js';

/**
 * Load `<root>/.env` into `env` WITHOUT overriding variables that are already
 * set (a real environment value always wins). Dependency-free: `KEY=VALUE`
 * (optional `export ` prefix), `#` comments, blank lines, optional quotes.
 *
 * The CLI used to be the only `.env` loader, so a backend started directly
 * (tsx, plain node) never saw `.env` secrets. Every config consumer now loads
 * the project `.env` itself; double-loading is harmless (idempotent).
 */
export function loadEnvFile(root: string, env: NodeJS.ProcessEnv): void {
  const file = resolve(root, '.env');
  if (!existsSync(file)) return;
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (env[key] !== undefined) continue; // real env always wins
    let value = m[2]!.trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

/**
 * Build a config-override object from `NEXUS_*` environment variables.
 * Nested keys use `_` as a separator, e.g. `NEXUS_SERVER_PORT` -> { server: { port } }.
 *
 * Type coercion: integers for numeric fields, booleans for true/false,
 * comma lists for arrays where applicable (heuristic by key).
 */
function coerce(value: string): string | number | boolean {
  const v = value.trim();
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (v.toLowerCase() === 'true') return true;
  if (v.toLowerCase() === 'false') return false;
  return v;
}

/**
 * Two `_`-separated env segments that form ONE camelCase config field.
 * Generic splitting would turn `KEY_ID` into `key.id` (a nested object) —
 * these known compounds collapse into a single tree key:
 *   NEXUS_PAYMENTS_RAZORPAY_KEY_ID   -> payments.razorpay.keyId
 *   NEXUS_AUTH_GOOGLE_CLIENT_SECRET  -> auth.google.clientSecret
 */
const PAIR_FIELDS: Record<string, string> = {
  'key_id': 'keyId',
  'key_secret': 'keySecret',
  'client_id': 'clientId',
  'client_secret': 'clientSecret',
  'merchant_key': 'merchantKey',
  'merchant_email': 'merchantEmail',
  'program_id': 'programId',
  'api_key': 'apiKey',
  'webhook_secret': 'webhookSecret',
  'customer_id': 'customerId',
  'developer_token': 'developerToken',
  'refresh_token': 'refreshToken',
  'access_ttl': 'accessTtl',
  'refresh_ttl': 'refreshTtl',
  'callback_path': 'callbackPath',
  'lb_port': 'lbPort',
  'lb_host': 'lbHost',
  'node_agent_port': 'nodeAgentPort',
  'node_agent_host': 'nodeAgentHost',
  'registry_file': 'registryFile',
  'min_nodes': 'minNodes',
  'max_nodes': 'maxNodes',
  'cooldown_ms': 'cooldownMs',
  'cpu_high': 'cpuHigh',
  'rps_per_node_high': 'rpsPerNodeHigh',
  'rps_per_node_low': 'rpsPerNodeLow',
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): DeepPartial<NexusConfig> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(env)) {
    if (!rawKey.startsWith('NEXUS_') || rawValue === undefined) continue;
    const path = rawKey.slice('NEXUS_'.length).toLowerCase().split('_');
    const last = path.length - 1;
    if (last >= 1) {
      const compound = PAIR_FIELDS[`${path[last - 1]}_${path[last]}`];
      if (compound) {
        path.splice(last - 1, 2, compound);
      }
    }
    let node: Record<string, unknown> = out;
    for (let i = 0; i < path.length; i++) {
      const segment = path[i]!;
      if (i === path.length - 1) {
        node[segment] = coerce(rawValue);
      } else {
        node[segment] = (node[segment] as Record<string, unknown>) ?? {};
        node = node[segment] as Record<string, unknown>;
      }
    }
  }
  return out as DeepPartial<NexusConfig>;
}