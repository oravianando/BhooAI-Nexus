import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { NodeIdentity, RegistryNode } from './types.js';
import { NodeClient } from './client.js';

export interface RegistryOptions {
  /** Path to persist the registry (JSON). */
  file: string;
  /** Shared pairing token used to authenticate to linked nodes. */
  token: string;
}

/**
 * NodeRegistry — the central's book of linked nodes. Persists to a JSON file
 * (gitignored) so the mesh survives restarts. A node is "linked" when a trusted
 * central handshakes `/info` and `/health` with the shared token, then persisted.
 *
 * The file is re-read when its mtime changes since the last load, so nodes
 * linked by the CLI (`nexus cluster link`) in a separate process become
 * visible to a long-running backend without a restart.
 */
export class NodeRegistry {
  private nodes = new Map<string, RegistryNode>();
  private file: string;
  private token: string;
  private fileMtimeMs = 0;

  constructor(opts: RegistryOptions) {
    this.file = resolve(opts.file);
    this.token = opts.token;
    this.load();
  }

  /** Reload from disk if the file changed since the last load. Called on every
   *  read (list/get) so external writes (CLI link) are picked up lazily. */
  private reloadIfChanged(): void {
    try {
      if (!existsSync(this.file)) return;
      const mtime = statSync(this.file).mtimeMs;
      if (mtime !== this.fileMtimeMs) this.load();
    } catch { /* ignore stat errors */ }
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as RegistryNode[];
      this.nodes = new Map(raw.map((n) => [n.identity.id, n]));
      this.fileMtimeMs = statSync(this.file).mtimeMs;
    } catch {
      // corrupt registry: start empty rather than crash boot
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify([...this.nodes.values()], null, 2));
    try { this.fileMtimeMs = statSync(this.file).mtimeMs; } catch { /* ignore */ }
  }

  /** Update the shared pairing token at runtime (e.g. after generating a new one). */
  setToken(token: string): void {
    this.token = token;
  }

  list(): RegistryNode[] {
    this.reloadIfChanged();
    return [...this.nodes.values()].sort((a, b) => a.identity.role.localeCompare(b.identity.role) || a.identity.id.localeCompare(b.identity.id));
  }

  get(id: string): RegistryNode | undefined {
    this.reloadIfChanged();
    return this.nodes.get(id);
  }

  remove(id: string): boolean {
    this.reloadIfChanged();
    const existed = this.nodes.delete(id);
    if (existed) this.save();
    return existed;
  }

  /**
   * Link a node by its agent URL: fetch `/info` + `/health`, verify the shared
   * token, store it. Returns the persisted node or throws on a failed handshake.
   * An optional `linkToken` overrides the registry's shared token for this node
   * (per-node pairing — the slave generates its own token and the master uses it).
   */
  async link(agentUrl: string, overrideRole?: NodeIdentity['role'], linkToken?: string): Promise<RegistryNode> {
    const useToken = linkToken ?? this.token;
    const client = new NodeClient(agentUrl, useToken);
    const identity = await client.info();
    const health = await client.health();
    const stored = this.nodes.get(identity.id);
    const now = new Date().toISOString();
    const node: RegistryNode = {
      identity: { ...identity, role: overrideRole ?? identity.role },
      status: health.ok ? 'ready' : 'pending',
      registeredAt: stored?.registeredAt ?? now,
      lastSeenAt: now,
      lastHealth: health,
      enabled: stored?.enabled ?? true,
      lastMetrics: stored?.lastMetrics,
      authToken: useToken,
    };
    this.nodes.set(node.identity.id, node);
    this.save();
    return node;
  }

  /** Refresh health + metrics for a single node. Flips to 'unreachable' on failure. */
  async poll(id: string): Promise<RegistryNode | undefined> {
    this.reloadIfChanged();
    const node = this.nodes.get(id);
    if (!node) return undefined;
    const client = new NodeClient(node.identity.baseUrl, node.authToken ?? this.token);
    const now = new Date().toISOString();
    try {
      const [health, metrics] = await Promise.all([
        client.health().catch(() => undefined),
        client.metrics().catch(() => undefined),
      ]);
      node.lastSeenAt = now;
      node.lastHealth = health;
      node.status = health?.ok ? 'ready' : 'pending';
      if (metrics) node.lastMetrics = metrics;
    } catch {
      node.status = 'unreachable';
      node.lastSeenAt = now;
    }
    return node;
  }

  clientFor(id: string): NodeClient | undefined {
    this.reloadIfChanged();
    const node = this.nodes.get(id);
    if (!node) return undefined;
    return new NodeClient(node.identity.baseUrl, node.authToken ?? this.token);
  }

  /** All nodes with a given role that are currently ready. */
  readyByRole(role: string): RegistryNode[] {
    return this.list().filter((n) => n.enabled && n.status === 'ready' && n.identity.role === role);
  }
}