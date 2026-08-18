import { Connection, type ConnectOptions } from './connection/Connection.js';
import { NexusSchema } from './schema/Schema.js';
import { Model } from './model/Model.js';
import type { DocumentInstance } from './model/Document.js';

export * from './schema/SchemaType.js';
export * from './schema/validators.js';
export { NexusSchema as Schema } from './schema/Schema.js';
export { Model } from './model/Model.js';
export { DocumentInstance } from './model/Document.js';
export { Query } from './query/Query.js';
export { Connection } from './connection/Connection.js';
export { ConnectionManager, connectionManager } from './connection/ConnectionManager.js';
export * from './errors.js';
export {
  PROJECT_INFO_DB,
  sanitizeDbName,
  resolveProjectInfo,
  connectProjectInfo,
  getProjectInfoCollection,
  upsertProjectInfo,
  listProjectInfo,
  getProjectInfo,
  deleteProjectInfo,
  dropProjectDatabase,
  closeProjectInfo,
  type ProjectInfo,
  type ClusterNodeRecord,
  getClusterNodesCollection,
  upsertClusterNode,
  deleteClusterNode,
  listClusterNodes,
  syncClusterNodes,
} from './projects.js';

let defaultConnection: Connection | undefined;

/** Connect to MongoDB and establish the default connection. */
export function connect(uri: string, options: ConnectOptions = {}): Connection {
  defaultConnection = new Connection(uri, options);
  return defaultConnection;
}

/** The default connection (set by `connect`). */
export function getConnection(): Connection {
  if (!defaultConnection) throw new Error('Not connected — call connect(uri) first.');
  return defaultConnection;
}

/** Register a model on the default connection. */
export function model<T extends DocumentInstance>(name: string, schema: NexusSchema, options?: { collection?: string }): Model<T> {
  return getConnection().model<T>(name, schema, options);
}

/** Run a transaction on the default connection. */
export async function transaction<T>(fn: (session: import('mongodb').ClientSession) => Promise<T>): Promise<T> {
  const conn = getConnection();
  const session = await conn.startSession();
  try {
    return await session.withTransaction(() => fn(session));
  } finally {
    await session.endSession();
  }
}

export { ObjectId, Decimal128 } from 'mongodb';