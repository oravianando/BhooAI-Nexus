import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { connect, Schema, model, transaction, ObjectId, type DocumentInstance, type Model } from '../src/index.js';
import { MongoClient } from 'mongodb';

const URI = process.env.NEXUS_DB_URI?.replace(/\/[^/?]*$/, '/nexus_odm_test') ?? 'mongodb://localhost:27017/nexus_odm_test';
const TEST_DB = new URL(URI.replace(/^mongodb:/, 'http:')).pathname.slice(1) || 'nexus_odm_test';
const RAW_URI = URI.replace(/\/[^/?]*$/, '/') + TEST_DB;

interface OrgDoc { _id?: ObjectId; name: string; members: number }
interface UserDoc { _id?: ObjectId; email: string; name: string; age?: number; role?: string; orgId?: ObjectId | null }

let Org: Model<DocumentInstance & OrgDoc>;
let User: Model<DocumentInstance & UserDoc>;
let supportsTransactions = false;

beforeAll(async () => {
  connect(URI, { autoIndex: true });
  // wait for connection + drop the test db for a clean slate
  const conn = (await import('../src/index.js')).getConnection();
  await conn.db;
  const mongo = new MongoClient(RAW_URI);
  await mongo.connect();
  await mongo.db(TEST_DB).dropDatabase();
  await mongo.close();

  // Transactions require a replica set / mongos; detect and skip if standalone.
  try {
    const admin = conn.client.db().admin();
    const status = await admin.command({ replSetGetStatus: 1 } as never);
    supportsTransactions = !!status?.ok || !!status?.setName;
  } catch {
    supportsTransactions = false;
  }

  const orgSchema = new Schema<OrgDoc>({ name: { type: String, required: true }, members: { type: Number, default: 0 } });
  Org = model<OrgDoc & DocumentInstance>('Org', orgSchema as unknown as Schema);

  const userSchema = new Schema<UserDoc>({
    email: { type: String, required: true, unique: true, match: /.+@.+\..+/ },
    name: { type: String, required: true },
    age: { type: Number, min: 0, max: 150 },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    orgId: { type: ObjectId, ref: 'Org' },
  });
  userSchema.pre('save', function (this: DocumentInstance & UserDoc) {
    if (this.isModified('email') && this.email) this.email = this.email.toLowerCase();
  });
  User = model<UserDoc & DocumentInstance>('User', userSchema as unknown as Schema);
  // indexes are created async on connect; ensure they're ready
  await User.createIndexes();
  await Org.createIndexes();
});

afterAll(async () => {
  const conn = (await import('../src/index.js')).getConnection();
  await conn.close();
});

beforeEach(async () => {
  await User.deleteMany({});
  await Org.deleteMany({});
});

describe('ODM: create / find / update / delete', () => {
  it('creates a document and reads it back', async () => {
    const [u] = await User.create({ email: 'Alice@Example.com', name: 'Alice', age: 30 });
    expect(u._id).toBeDefined();
    expect(u.email).toBe('alice@example.com'); // pre('save') hook lowercased
    const found = await User.findById(u._id);
    expect(found?.name).toBe('Alice');
  });

  it('chains query helpers: sort, limit, skip, select, lean', async () => {
    for (const n of ['b', 'a', 'c']) await User.create({ email: `${n}@x.com`, name: n });
    const rows = await User.find().sort('name').limit(2).lean();
    expect(rows.map((r) => r.name)).toEqual(['a', 'b']);
    const one = await User.findOne({ name: 'a' }).select('name');
    expect(one?.name).toBe('a');
  });

  it('updates and deletes documents', async () => {
    const [u] = await User.create({ email: 'z@x.com', name: 'Z' });
    await User.updateOne({ _id: u._id }, { $set: { name: 'Zed' } });
    expect((await User.findById(u._id))?.name).toBe('Zed');
    await User.deleteOne({ _id: u._id });
    expect(await User.countDocuments()).toBe(0);
  });
});

describe('ODM: validation', () => {
  it('rejects missing required fields', async () => {
    await expect(User.create({ name: 'NoEmail' })).rejects.toThrow(/required/);
  });

  it('rejects out-of-range numbers and bad enum values', async () => {
    await expect(User.create({ email: 'a@b.com', name: 'A', age: 999 })).rejects.toThrow(/age/);
    await expect(User.create({ email: 'a@b.com', name: 'A', role: 'wizard' })).rejects.toThrow(/enum/);
  });

  it('rejects malformed emails (match)', async () => {
    await expect(User.create({ email: 'not-an-email', name: 'A' })).rejects.toThrow(/format/);
  });

  it('enforces unique indexes', async () => {
    await User.create({ email: 'dup@x.com', name: 'A' });
    await expect(User.create({ email: 'dup@x.com', name: 'B' })).rejects.toThrow();
  });
});

describe('ODM: populate', () => {
  it('resolves a single ref', async () => {
    const [org] = await Org.create({ name: 'Acme' });
    const [u] = await User.create({ email: 'p@x.com', name: 'P', orgId: org._id });
    const found = await User.findById(u._id).populate('orgId');
    expect((found?.orgId as unknown as DocumentInstance)?.toObject?.()?.name ?? (found?.orgId as any)?.name).toBe('Acme');
  });
});

describe('ODM: advanced model API', () => {
  interface SecretDoc { _id?: ObjectId; label: string; token: string; origin: string; visits: number }
  let Secret: Model<DocumentInstance & SecretDoc>;

  beforeAll(() => {
    const schema = new Schema<SecretDoc>({
      label: { type: String, required: true },
      token: { type: String, select: false },
      origin: { type: String, immutable: true, default: 'web' },
      visits: { type: Number, default: 0 },
    });
    schema.virtual('summary', { get(this: DocumentInstance & SecretDoc) { return `${this.label}:${this.visits}`; } });
    Secret = model<SecretDoc & DocumentInstance>('Secret', schema as unknown as Schema);
    void Secret.createIndexes();
  });

  beforeEach(async () => {
    await Secret.deleteMany({});
  });

  it('hides select:false fields from default queries but includes them when selected', async () => {
    await Secret.create({ label: 'L', token: 'secret-value' });
    const def = await Secret.findOne({ label: 'L' }).lean() as Record<string, unknown>;
    expect(def.token).toBeUndefined();
    const explicit = await Secret.findOne({ label: 'L' }).select('token').lean() as Record<string, unknown>;
    expect(explicit.token).toBe('secret-value');
  });

  it('exposes virtual getters via toObject', async () => {
    const [s] = await Secret.create({ label: 'L', token: 't', visits: 3 });
    expect(s.toObject().summary).toBe('L:3');
  });

  it('enforces immutable on update but allows it on insert', async () => {
    const [s] = await Secret.create({ label: 'L', token: 't', origin: 'mobile' });
    expect(s.origin).toBe('mobile');
    s.visits = 5;
    (s as unknown as SecretDoc).origin = 'changed'; // attempt mutation
    await s.save();
    const reloaded = await Secret.findById(s._id).lean() as Record<string, unknown>;
    expect(reloaded.visits).toBe(5);
    expect(reloaded.origin).toBe('mobile'); // immutable blocked the change
  });

  it('findOneAndUpdate returns the updated document', async () => {
    const [s] = await Secret.create({ label: 'L', token: 't' });
    const updated = await Secret.findOneAndUpdate({ _id: s._id }, { $inc: { visits: 2 } });
    expect(updated?.visits).toBe(2);
  });

  it('bulkWrite performs mixed operations', async () => {
    await Secret.bulkWrite([
      { insertOne: { document: { label: 'A', token: 'a' } } },
      { insertOne: { document: { label: 'B', token: 'b' } } },
      { updateOne: { filter: { label: 'A' }, update: { $set: { visits: 9 } } } },
    ]);
    expect(await Secret.countDocuments()).toBe(2);
    expect((await Secret.findOne({ label: 'A' }).lean() as Record<string, unknown>).visits).toBe(9);
  });
});

describe('ODM: transactions', () => {
  it('commits when fn succeeds', async (ctx) => {
    if (!supportsTransactions) ctx.skip();
    const [org] = await Org.create({ name: 'T', members: 0 });
    await transaction(async (session) => {
      await User.collection.then((c) => c.insertOne({ email: 't@x.com', name: 'T', orgId: org._id }, { session }));
      await Org.updateOne({ _id: org._id }, { $inc: { members: 1 } });
    });
    expect((await Org.findById(org._id))?.members).toBe(1);
  });

  it('rolls back when fn throws', async (ctx) => {
    if (!supportsTransactions) ctx.skip();
    const [org] = await Org.create({ name: 'R', members: 5 });
    await expect(
      transaction(async () => {
        await Org.updateOne({ _id: org._id }, { $inc: { members: 100 } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await Org.findById(org._id))?.members).toBe(5);
  });
});