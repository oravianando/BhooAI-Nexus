import type { Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { NexusSchema } from '../schema/Schema.js';
import { Connection } from '../connection/Connection.js';
import { DocumentInstance } from './Document.js';
import { hydrate } from './hydrate.js';
import { Query } from '../query/Query.js';

/** Build a NEW (not-yet-persisted) document instance from input data. */
export function newInstance<T extends DocumentInstance>(
  schema: NexusSchema,
  model: Model<T>,
  data: Record<string, unknown>,
): T {
  return new DocumentInstance(schema, model, data, true) as T;
}

export class Model<T extends DocumentInstance> {
  collection: Promise<Collection>;
  schema: NexusSchema;
  connection: Connection;
  collectionName: string;
  name: string;

  constructor(name: string, schema: NexusSchema, connection: Connection, collectionName: string) {
    this.name = name;
    this.schema = schema;
    this.connection = connection;
    this.collectionName = collectionName;
    this.collection = connection.db.then((db: Db) => db.collection(collectionName));

    // Attach static methods declared on the schema.
    for (const [key, fn] of Object.entries(schema.statics)) {
      (this as unknown as Record<string, unknown>)[key] = fn.bind(this);
    }
  }

  /** Hydrate a raw mongo doc into a Document instance. */
  hydrate(doc: Record<string, unknown>): T {
    return hydrate<T>(this.schema, this, doc) as T;
  }

  // ── Query builders ──────────────────────────────────────────────────────
  find(filter: Record<string, unknown> = {}): Query<T> {
    return new Query<T>(this, 'find', filter);
  }

  findOne(filter: Record<string, unknown> = {}): Query<T> {
    return new Query<T>(this, 'findOne', filter);
  }

  findById(id: unknown): Query<T> {
    return new Query<T>(this, 'findOne', { _id: castId(id) });
  }

  // ── Writes ──────────────────────────────────────────────────────────────
  async create(docs: Record<string, unknown> | Record<string, unknown>[]): Promise<T[]> {
    const input = Array.isArray(docs) ? docs : [docs];
    const out: T[] = [];
    for (const data of input) {
      const instance = newInstance(this.schema, this, data);
      await instance.save();
      out.push(instance);
    }
    return out;
  }

  async insertMany(docs: Record<string, unknown>[]): Promise<T[]> {
    const prepared = docs.map((d) => {
      const copy = { ...d };
      this.schema.applyDefaults(copy);
      this.schema.validate(copy);
      return copy;
    });
    const coll = await this.collection;
    const result = await coll.insertMany(prepared);
    return prepared.map((d, i) => {
      d._id = result.insertedIds[i];
      return this.hydrate(d);
    });
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<number> {
    await runSchemaHooks(this.schema, 'updateOne', { filter, update, model: this });
    const coll = await this.collection;
    const result = await coll.updateOne(filter, update);
    return result.modifiedCount;
  }

  async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<number> {
    const coll = await this.collection;
    const result = await coll.updateMany(filter, update);
    return result.modifiedCount;
  }

  async deleteOne(filter: Record<string, unknown>): Promise<number> {
    const coll = await this.collection;
    const result = await coll.deleteOne(filter);
    return result.deletedCount;
  }

  async deleteMany(filter: Record<string, unknown>): Promise<number> {
    await runSchemaHooks(this.schema, 'deleteMany', { filter, model: this });
    const coll = await this.collection;
    const result = await coll.deleteMany(filter);
    return result.deletedCount;
  }

  /** Find a doc and apply an update in one round-trip; returns the updated (or original) hydrated doc. */
  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    opts: { returnDocument?: 'before' | 'after'; upsert?: boolean } = {},
  ): Promise<T | null> {
    const coll = await this.collection;
    const result = await coll.findOneAndUpdate(filter, update, {
      returnDocument: opts.returnDocument === 'before' ? 'before' : 'after',
      upsert: opts.upsert ?? false,
      includeResultMetadata: true,
    });
    if (!result || !result.value) return null;
    return this.hydrate(result.value as Record<string, unknown>);
  }

  /** Find a doc and remove it; returns the deleted hydrated doc (or null). */
  async findOneAndDelete(filter: Record<string, unknown>): Promise<T | null> {
    const coll = await this.collection;
    const result = await coll.findOneAndDelete(filter, { includeResultMetadata: true });
    if (!result || !result.value) return null;
    return this.hydrate(result.value as Record<string, unknown>);
  }

  /** Run a bulk write of mixed operations; returns the driver result summary. */
  async bulkWrite(ops: Record<string, unknown>[]): Promise<{ insertedCount: number; modifiedCount: number; deletedCount: number }> {
    const coll = await this.collection;
    const result = await coll.bulkWrite(ops as never);
    return {
      insertedCount: result.insertedCount,
      modifiedCount: result.modifiedCount,
      deletedCount: result.deletedCount,
    };
  }

  async countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
    const coll = await this.collection;
    return coll.countDocuments(filter);
  }

  async aggregate(pipeline: Record<string, unknown>[]): Promise<unknown[]> {
    const coll = await this.collection;
    return coll.aggregate(pipeline).toArray();
  }

  /** Create indexes declared in the schema. Called automatically on connect. */
  async createIndexes(): Promise<void> {
    if (this.schema.indexes.length === 0) return;
    const coll = await this.collection;
    for (const { spec, options } of this.schema.indexes) {
      await coll.createIndex(spec, options);
    }
  }
}

/** Run pre/post hooks for a write event on a schema (best-effort, used by updateOne/deleteMany). */
async function runSchemaHooks(schema: NexusSchema, event: string, ctx: Record<string, unknown>): Promise<void> {
  const pre = schema.preHooks.get(event);
  if (pre) for (const fn of pre) await fn.call(ctx, ctx);
  const post = schema.postHooks.get(event);
  if (post) for (const fn of post) await fn.call(ctx, ctx);
}

/** Cast a 24-char hex string (or any ObjectId-like) to ObjectId; pass through otherwise. */
export function castId(id: unknown): unknown {
  if (id instanceof ObjectId) return id;
  if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) return new ObjectId(id);
  return id;
}