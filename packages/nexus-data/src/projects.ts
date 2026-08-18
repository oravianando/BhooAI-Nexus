import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Collection } from 'mongodb';
import { connectionManager } from './connection/ConnectionManager.js';

/** Shared database that stores one record per registered project. */
export const PROJECT_INFO_DB = 'nexus_projects';

const CONNECTION_NAME = 'project-info';
const PROJECTS_COLLECTION = 'projects';

/** A registered project's identity + runtime snapshot. */
export interface ProjectInfo {
  /** Canonical project name (package.json `name`). */
  name: string;
  /** Absolute path to the project root. */
  path: string;
  /** Per-project MongoDB database name (sanitized from `name`). */
  dbName: string;
  /** Redacted runtime snapshot (env, ports, paths, db). */
  settings?: Record<string, unknown>;
  /** Whether a backend instance is currently running. */
  status?: 'running' | 'stopped';
  /** App version when last seen running. */
  version?: string;
  startedAt?: string;
  updatedAt?: string;
}

/**
 * Derive a MongoDB-safe database name from a project name. Every project owns
 * its own database (e.g. `sample-project` → `sample_project`).
 */
export function sanitizeDbName(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
  return clean || 'project';
}

/** Resolve the canonical project identity from a project root. */
export async function resolveProjectInfo(root: string): Promise<ProjectInfo> {
  let name = '';
  try {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { name?: string };
    name = pkg.name ?? '';
  } catch { /* fall through to basename */ }
  if (!name) name = root.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
  return { name, path: root, dbName: sanitizeDbName(name) };
}

/**
 * Open the shared project-info database on a second connection. The main
 * (default) connection keeps pointing at the per-project database.
 */
export function connectProjectInfo(uri: string, options: { autoIndex?: boolean } = {}): void {
  connectionManager.connect(CONNECTION_NAME, uri, { name: PROJECT_INFO_DB, autoIndex: options.autoIndex });
}

/** The project-info `projects` collection (call `connectProjectInfo` first). */
export function getProjectInfoCollection(): Promise<Collection<ProjectInfo>> {
  return connectionManager.get(CONNECTION_NAME).db.then((db) => db.collection<ProjectInfo>(PROJECTS_COLLECTION));
}

let indexEnsured = false;
async function ensureIndexes(): Promise<void> {
  if (indexEnsured) return;
  const coll = await getProjectInfoCollection();
  await coll.createIndex({ name: 1 }, { unique: true });
  indexEnsured = true;
}

/** Insert or update a project record in the shared project-info database. */
export async function upsertProjectInfo(project: ProjectInfo): Promise<ProjectInfo> {
  const coll = await getProjectInfoCollection();
  await ensureIndexes();
  const doc = { ...project, updatedAt: new Date().toISOString() };
  await coll.updateOne({ name: project.name }, { $set: doc }, { upsert: true });
  return doc;
}

/** List every registered project, alphabetical by name. */
export async function listProjectInfo(): Promise<ProjectInfo[]> {
  const coll = await getProjectInfoCollection();
  await ensureIndexes();
  return coll.find({}).sort({ name: 1 }).toArray();
}

/** Fetch a single project record by canonical name. */
export async function getProjectInfo(name: string): Promise<ProjectInfo | null> {
  const coll = await getProjectInfoCollection();
  await ensureIndexes();
  return coll.findOne({ name });
}

/** Delete a project record from the shared project-info database. */
export async function deleteProjectInfo(name: string): Promise<boolean> {
  const coll = await getProjectInfoCollection();
  await ensureIndexes();
  const r = await coll.deleteOne({ name });
  return r.deletedCount > 0;
}

/** Drop a project's own database (the per-project one, NOT nexus_projects).
 *  Uses the project-info connection's MongoClient to drop another db on the
 *  same server — no second connection needed. */
export async function dropProjectDatabase(dbName: string): Promise<boolean> {
  const conn = connectionManager.get(CONNECTION_NAME);
  await conn.db; // ensure the client has connected
  return conn.client.db(dbName).dropDatabase();
}

/** Close the project-info connection (call during shutdown). */
export async function closeProjectInfo(): Promise<void> {
  if (connectionManager.has(CONNECTION_NAME)) await connectionManager.get(CONNECTION_NAME).close();
}

// ── cluster node registry (mirror of cluster.runtime.json in Mongo) ───────

const CLUSTER_NODES_COLLECTION = 'cluster_nodes';

/** One linked cluster node's registry record (mirrors cluster.runtime.json). */
export interface ClusterNodeRecord {
  /** Stable node id (e.g. `<host>-<role>`). */
  id: string;
  role: string;
  tier: string;
  version?: string;
  baseUrl: string;
  services?: Record<string, string>;
  status: string;
  enabled: boolean;
  registeredAt: string;
  lastSeenAt: string;
  lastHealth?: unknown;
  lastMetrics?: unknown;
  updatedAt: string;
}

/** The cluster_nodes collection (call `connectProjectInfo` first). */
export function getClusterNodesCollection(): Promise<Collection<ClusterNodeRecord>> {
  return connectionManager.get(CONNECTION_NAME).db.then((db) => db.collection<ClusterNodeRecord>(CLUSTER_NODES_COLLECTION));
}

let clusterNodesIndexEnsured = false;

/** Upsert a cluster node record by id (mirrors registry.save for one node). */
export async function upsertClusterNode(node: ClusterNodeRecord): Promise<void> {
  const coll = await getClusterNodesCollection();
  if (!clusterNodesIndexEnsured) {
    await coll.createIndex({ id: 1 }, { unique: true });
    clusterNodesIndexEnsured = true;
  }
  await coll.updateOne({ id: node.id }, { $set: node }, { upsert: true });
}

/** Delete a cluster node record by id (mirrors registry.remove). */
export async function deleteClusterNode(id: string): Promise<boolean> {
  const coll = await getClusterNodesCollection();
  const r = await coll.deleteOne({ id });
  return r.deletedCount > 0;
}

/** List all cluster node records (mirrors registry.list). */
export async function listClusterNodes(): Promise<ClusterNodeRecord[]> {
  const coll = await getClusterNodesCollection();
  return coll.find({}).sort({ role: 1, id: 1 }).toArray();
}

/** Replace all cluster node records (bulk sync — used after a full reload). */
export async function syncClusterNodes(nodes: ClusterNodeRecord[]): Promise<void> {
  const coll = await getClusterNodesCollection();
  if (!clusterNodesIndexEnsured) {
    await coll.createIndex({ id: 1 }, { unique: true });
    clusterNodesIndexEnsured = true;
  }
  const ops = nodes.map((n) => ({ updateOne: { filter: { id: n.id }, update: { $set: n }, upsert: true } }));
  if (ops.length) await coll.bulkWrite(ops as never);
  // Remove records no longer in the registry.
  const ids = nodes.map((n) => n.id);
  await coll.deleteMany({ id: { $nin: ids } });
}
