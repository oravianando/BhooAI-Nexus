import type { NexusSchema } from '../schema/Schema.js';
import type { Model } from './Model.js';

/** A hydrated document instance wrapping a plain Mongo object. */
export class DocumentInstance {
  _doc: Record<string, unknown> = {};
  _schema: NexusSchema;
  _model: Model<this>;
  _isNew = true;
  _modified = new Set<string>();

  constructor(schema: NexusSchema, model: Model<this>, data: Record<string, unknown>, isNew = true) {
    this._schema = schema;
    this._model = model;
    this._isNew = isNew;
    this._doc = { ...data };
    // New documents consider all initial fields modified (matches mongoose isNew semantics),
    // so pre('save') hooks using isModified() fire for first inserts.
    if (isNew) for (const k of Object.keys(this._doc)) this._modified.add(k);

    // Proxy property access to _doc so `doc.email` reads/writes the stored value.
    return new Proxy(this, {
      get(target, prop: string) {
        if (prop in target || typeof prop !== 'string') return (target as unknown as Record<string, unknown>)[prop];
        return target._doc[prop];
      },
      set(target, prop: string, value: unknown) {
        if (prop in target && typeof (target as unknown as Record<string, unknown>)[prop] !== 'undefined' && prop.startsWith('_')) {
          (target as unknown as Record<string, unknown>)[prop] = value;
          return true;
        }
        if (prop === '_doc' || prop.startsWith('_')) {
          (target as unknown as Record<string, unknown>)[prop] = value;
          return true;
        }
        target._doc[prop] = value;
        target._modified.add(prop);
        return true;
      },
    });
  }

  isModified(path?: string): boolean {
    if (path) return this._modified.has(path);
    return this._modified.size > 0;
  }

  toObject(): Record<string, unknown> {
    const out = { ...this._doc };
    // Apply virtual getters (bound to the instance so they can read other fields).
    for (const [name, virt] of this._schema.virtuals) {
      if (virt.get) {
        try { out[name] = virt.get.call(this); } catch { /* virtual getters must not break serialization */ }
      }
    }
    return out;
  }

  toJSON(): Record<string, unknown> {
    return this.toObject();
  }

  async validate(): Promise<void> {
    await runHooks(this._schema.preHooks, 'validate', this);
    this._schema.validate(this._doc);
    await runHooks(this._schema.postHooks, 'validate', this);
  }

  async populate(path: string): Promise<this> {
    const { populate } = await import('../populate/populate.js');
    await populate(this._model.connection, [this], path);
    return this;
  }

  async save(): Promise<this> {
    await runHooks(this._schema.preHooks, 'save', this);
    if (this._schema.options.timestamps) {
      const now = new Date();
      const ts = this._schema.options.timestamps === true ? { createdAt: 'createdAt', updatedAt: 'updatedAt' } : this._schema.options.timestamps;
      if (ts?.createdAt && this._isNew) this._doc[ts.createdAt] = now;
      if (ts?.updatedAt) this._doc[ts.updatedAt] = now;
    }
    if (this._isNew) {
      this._schema.applyDefaults(this._doc);
      await this.validate();
      const result = await this._model.collection.then((c) => c.insertOne(this._doc));
      if (result.acknowledged) this._doc._id = result.insertedId;
      this._isNew = false;
    } else {
      await this.validate();
      const update = this._modified.size ? this._buildUpdate() : { $set: this._doc };
      await this._model.collection.then((c) => c.updateOne({ _id: this._doc._id }, update));
    }
    this._modified.clear();
    await runHooks(this._schema.postHooks, 'save', this);
    return this;
  }

  async remove(): Promise<void> {
    await runHooks(this._schema.preHooks, 'remove', this);
    await this._model.collection.then((c) => c.deleteOne({ _id: this._doc._id }));
    await runHooks(this._schema.postHooks, 'remove', this);
  }

  private _buildUpdate(): Record<string, unknown> {
    const $set: Record<string, unknown> = {};
    for (const path of this._modified) {
      // Immutable fields cannot be written after the initial insert.
      const field = this._schema.compiledPaths.get(path);
      if (field?.immutable && !this._isNew) continue;
      $set[path] = this._doc[path];
    }
    return { $set };
  }
}

async function runHooks(
  hooks: Map<string, Array<(ctx: unknown) => unknown | Promise<unknown>>>,
  event: string,
  ctx: unknown,
): Promise<void> {
  const list = hooks.get(event);
  if (!list) return;
  for (const fn of list) await fn.call(ctx, ctx);
}