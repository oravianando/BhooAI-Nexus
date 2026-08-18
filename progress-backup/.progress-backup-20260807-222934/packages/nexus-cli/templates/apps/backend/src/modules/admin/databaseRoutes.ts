/**
 * Admin routes for MongoDB database / collection administration.
 *
 * The admin app uses these to create, rename and drop databases and
 * collections, and to preview documents. Collections can be created with a
 * `$jsonSchema` validator (used by the AI schema generator).
 *
 * Routes (all guarded by the caller):
 *   GET    /admin/databases                       → { databases: [{ name, sizeOnDisk, collections: [{ name, count }] }] }
 *   POST   /admin/databases                       → { name } → create
 *   DELETE /admin/databases/:db                   → drop database
 *   POST   /admin/databases/:db/collections       → { name, jsonSchema? } → create
 *   PUT    /admin/databases/:db/collections/:name → { newName? | validator? } → rename / collMod
 *   DELETE /admin/databases/:db/collections/:name → drop collection
 *   GET    /admin/databases/:db/collections/:name/docs → { count, docs } (preview, max 10)
 */
import type { Router, Middleware } from '@bhooai/nexus-core';
import { ValidationError as BadRequest } from '@bhooai/nexus-core';
import { getConnection } from '@bhooai/nexus-data';

const DOC_PREVIEW_LIMIT = 10;

/** Ugly but real: dropping a db's only collection deletes the whole database. */
const BOOTSTRAP_COLLECTION = '_nexus_bootstrap';

/** Databases managed by MongoDB itself — hidden from the admin surface. */
const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

export function registerDatabaseRoutes(router: Router, guard: Middleware[]): void {
  const client = () => getConnection().client;

  router.get('/admin/databases', async (ctx) => {
    const list = await client().db().admin().listDatabases();
    const databases = [];
    for (const d of list.databases) {
      if (!d.name || SYSTEM_DATABASES.has(d.name)) continue;
      const db = client().db(d.name);
      const raw = await db.listCollections().toArray();
      const collections = [];
      for (const c of raw) {
        if (c.name.startsWith(BOOTSTRAP_COLLECTION)) continue;
        let count = 0;
        try { count = await db.collection(c.name).countDocuments({}, { maxTimeMS: 5000 }); } catch { /* stats unavailable */ }
        collections.push({ name: c.name, count });
      }
      databases.push({ name: d.name, sizeOnDisk: d.sizeOnDisk ?? 0, collections });
    }
    ctx.json({ databases });
  }, guard);

  router.post('/admin/databases', async (ctx) => {
    const name = assertDbName((ctx.body as { name?: unknown } | undefined)?.name);
    // Mongo creates a database lazily on first write. Keep a hidden bootstrap
    // collection so the database exists immediately; internal collections are
    // filtered out of the listing.
    await client().db(name).createCollection(BOOTSTRAP_COLLECTION);
    ctx.json({ ok: true, name });
  }, guard);

  router.delete('/admin/databases/:db', async (ctx) => {
    const db = assertDbName(ctx.params.db);
    await client().db(db).dropDatabase();
    ctx.json({ ok: true, dropped: db });
  }, guard);

  router.post('/admin/databases/:db/collections', async (ctx) => {
    const db = assertDbName(ctx.params.db);
    const body = (ctx.body ?? {}) as { name?: unknown; jsonSchema?: unknown };
    const name = assertCollectionName(body.name);
    const validator = parseJsonSchema(body.jsonSchema);
    const mongoDb = client().db(db);
    if (validator) {
      await mongoDb.createCollection(name, {
        validator: { $jsonSchema: validator },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await mongoDb.createCollection(name);
    }
    ctx.json({ ok: true, db, collection: name, validator: validator ? { $jsonSchema: validator } : null });
  }, guard);

  router.put('/admin/databases/:db/collections/:name', async (ctx) => {
    const db = assertDbName(ctx.params.db);
    const name = assertCollectionName(ctx.params.name);
    const body = (ctx.body ?? {}) as { newName?: unknown; validator?: unknown };
    const mongoDb = client().db(db);
    const changed: string[] = [];
    if (body.newName !== undefined) {
      const newName = assertCollectionName(body.newName);
      if (newName !== name) {
        await mongoDb.collection(name).rename(newName);
        changed.push(`renamed to ${newName}`);
      }
    }
    if (body.validator !== undefined) {
      const validator = parseJsonSchema(body.validator);
      await mongoDb.command({
        collMod: changed.length ? String(body.newName) : name,
        validator: { $jsonSchema: validator },
        validationLevel: 'strict',
      });
      changed.push('validator updated');
    }
    if (!changed.length) {
      ctx.json({ error: 'nothing to modify — send newName and/or validator' }, 400);
      return;
    }
    ctx.json({ ok: true, db, collection: name, changed });
  }, guard);

  router.delete('/admin/databases/:db/collections/:name', async (ctx) => {
    const db = assertDbName(ctx.params.db);
    const name = assertCollectionName(ctx.params.name);
    await client().db(db).dropCollection(name);
    ctx.json({ ok: true, dropped: { db, collection: name } });
  }, guard);

  router.get('/admin/databases/:db/collections/:name/docs', async (ctx) => {
    const db = assertDbName(ctx.params.db);
    const name = assertCollectionName(ctx.params.name);
    const coll = client().db(db).collection(name);
    const count = await coll.countDocuments();
    const docs = await coll.find({}).limit(DOC_PREVIEW_LIMIT).toArray();
    ctx.json({ db, collection: name, count, docs });
  }, guard);
}

function assertDbName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name || name.length > 63) throw new BadRequest('database name is required (max 63 chars)');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name) || name.includes('..')) {
    throw new BadRequest(`invalid database name: ${name}`);
  }
  return name;
}

function assertCollectionName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name || name.length > 255) throw new BadRequest('collection name is required (max 255 chars)');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name) || name.startsWith('system.')) {
    throw new BadRequest(`invalid collection name: ${name}`);
  }
  return name;
}

function parseJsonSchema(v: unknown): Record<string, unknown> | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { throw new BadRequest('jsonSchema is not valid JSON'); }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new BadRequest('jsonSchema must be an object');
  }
  const schema = v as Record<string, unknown>;
  if (schema.bsonType !== 'object' || typeof schema.properties !== 'object' || schema.properties === null) {
    throw new BadRequest('jsonSchema must have bsonType: "object" and a properties object');
  }
  return schema;
}
