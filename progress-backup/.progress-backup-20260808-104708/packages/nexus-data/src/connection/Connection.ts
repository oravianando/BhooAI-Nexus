import { MongoClient, Db, type MongoClientOptions } from 'mongodb';
import { NexusSchema } from '../schema/Schema.js';
import { Model } from '../model/Model.js';
import type { DocumentInstance } from '../model/Document.js';

export interface ConnectOptions extends MongoClientOptions {
  /** Database name override (otherwise taken from the URI). */
  name?: string;
  /** Auto-create indexes declared in schemas on connect. */
  autoIndex?: boolean;
}

/**
 * Wraps a `MongoClient` and lazily exposes a `Db`. Models are registered per
 * connection. The default connection is created by the top-level `connect()`.
 */
export class Connection {
  client: MongoClient;
  dbPromise: Promise<Db>;
  models = new Map<string, Model<any>>();
  private dbName?: string;
  autoIndex: boolean;

  constructor(uri: string, options: ConnectOptions = {}) {
    this.dbName = options.name;
    this.autoIndex = options.autoIndex ?? true;
    // Strip ODM-only options before handing the rest to the mongo driver.
    const { name: _name, autoIndex: _autoIndex, ...driverOptions } = options;
    this.client = new MongoClient(uri, driverOptions);
    this.dbPromise = this.client.connect().then(() => this.client.db(this.dbName));
  }

  get db(): Promise<Db> {
    return this.dbPromise;
  }

  /** Register a model on this connection and (optionally) create indexes. */
  model<T extends DocumentInstance>(name: string, schema: NexusSchema, options: { collection?: string } = {}): Model<T> {
    const existing = this.models.get(name);
    if (existing) return existing as Model<T>;
    const collectionName = options.collection ?? schema.options.collection ?? name.toLowerCase() + 's';
    const model = new Model<T>(name, schema, this, collectionName);
    this.models.set(name, model);
    if (this.autoIndex) void model.createIndexes();
    return model;
  }

  /** Start a session for transactions. */
  async startSession() {
    await this.dbPromise;
    return this.client.startSession();
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}