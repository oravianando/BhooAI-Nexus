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

/** Close the project-info connection (call during shutdown). */
export async function closeProjectInfo(): Promise<void> {
  if (connectionManager.has(CONNECTION_NAME)) await connectionManager.get(CONNECTION_NAME).close();
}
