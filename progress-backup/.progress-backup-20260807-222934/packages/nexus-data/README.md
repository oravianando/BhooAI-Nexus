# @bhooai/nexus-data

A from-scratch ODM built on the official `mongodb` driver (no mongoose).

## Exports

- `connect(uri, options)` / `getConnection()` — single connection + `ConnectionManager`.
- `model<T>(name, schema, { collection })` — registers a model on the default connection.
- `NexusSchema` (alias `Schema`) with field options: `{ type, required, default, enum,
  min, max, match, validate, ref, refPath, select, immutable, expires, index, unique, transform }`.
- `Model` — `find/findOne/findById/create/insertMany/updateOne/updateMany/
  deleteOne/deleteMany/countDocuments/aggregate/bulkWrite/findOneAndUpdate`.
- `DocumentInstance` — `save/remove/populate/validate` (+ `toObject()`).
- `Query` — chainable + thenable: `where/gt/sort/limit/skip/select/populate/lean/session`.
- `transaction(fn)` — driver `withTransaction`.
- `pre`/`post` hooks for `save/validate/remove/updateOne/deleteOne/find`.
- Batched multi-level `populate` (with `refPath`/`select`/`match`); auto-index creation at boot.

## Usage

```ts
import { connect, model, Schema } from '@bhooai/nexus-data';

connect('mongodb://localhost:27017/app');
const User = model('User', new Schema({
  email: { type: String, required: true, unique: true },
  roles: { type: [String], default: ['user'] },
}));
const u = await User.findOne({ email: 'a@b.com' }).lean();
```

Tests run against real MongoDB via `.env` (`NEXUS_DB_URI`) — no embedded Mongo.