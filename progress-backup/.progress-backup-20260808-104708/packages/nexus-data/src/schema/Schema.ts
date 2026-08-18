import { coerce, typeOf, type SchemaTypeToken } from './SchemaType.js';
import { ValidationError } from '../../../nexus-core/src/index.js';
import {
  type CompiledField,
  type FieldDefinition,
  type IndexSpec,
  type SchemaOptions,
  type SchemaDefinition,
} from './validators.js';

export class NexusSchema<T = unknown> {
  compiledPaths = new Map<string, CompiledField>();
  indexes: IndexSpec[] = [];
  options: SchemaOptions;
  virtuals = new Map<string, { get?: () => unknown; set?: (v: unknown) => void }>();
  preHooks = new Map<string, Array<(ctx: unknown) => unknown | Promise<unknown>>>();
  postHooks = new Map<string, Array<(ctx: unknown) => unknown | Promise<unknown>>>();
  methods: Record<string, (...args: unknown[]) => unknown> = {};
  statics: Record<string, (...args: unknown[]) => unknown> = {};

  constructor(definition: SchemaDefinition = {}, options: SchemaOptions = {}) {
    this.options = { timestamps: false, versionKey: '__v', strict: true, ...options };
    for (const [path, raw] of Object.entries(definition)) {
      this.define(path, normalizeField(raw));
    }
    if (this.options.timestamps) {
      const ts = this.options.timestamps === true ? { createdAt: 'createdAt', updatedAt: 'updatedAt' } : this.options.timestamps;
      if (ts.createdAt && !this.compiledPaths.has(ts.createdAt)) {
        this.define(ts.createdAt, { type: Date });
      }
      if (ts.updatedAt && !this.compiledPaths.has(ts.updatedAt)) {
        this.define(ts.updatedAt, { type: Date });
      }
    }
  }

  define(path: string, def: FieldDefinition): void {
    const token = resolveToken(def.type);
    const validators = def.validate ? (Array.isArray(def.validate) ? def.validate : [def.validate]) : [];
    const isRef = !!def.ref || !!def.refPath;
    this.compiledPaths.set(path, {
      token,
      isRef,
      ref: def.ref,
      refPath: def.refPath,
      required: def.required ?? false,
      hasDefault: def.default !== undefined,
      default: def.default,
      enum: def.enum,
      min: def.min,
      max: def.max,
      match: def.match,
      validators,
      select: def.select ?? true,
      immutable: def.immutable ?? false,
      transform: def.transform,
      isEmbedded: false,
    });
    if (def.unique) {
      this.indexes.push({ spec: { [path]: 1 }, options: { unique: true, sparse: def.sparse ?? false } });
    } else if (def.index) {
      const opts = typeof def.index === 'object' ? def.index : {};
      this.indexes.push({ spec: { [path]: 1 }, options: opts });
    }
    if (def.expires) {
      this.indexes.push({ spec: { [path]: 1 }, options: { expireAfterSeconds: def.expires } });
    }
  }

  virtual(path: string, opts: { get?: () => unknown; set?: (v: unknown) => void } = {}): void {
    this.virtuals.set(path, opts);
  }

  pre(event: string, fn: (ctx: unknown) => unknown | Promise<unknown>): void {
    const list = this.preHooks.get(event) ?? [];
    list.push(fn);
    this.preHooks.set(event, list);
  }

  post(event: string, fn: (ctx: unknown) => unknown | Promise<unknown>): void {
    const list = this.postHooks.get(event) ?? [];
    list.push(fn);
    this.postHooks.set(event, list);
  }

  method(name: string, fn: (...args: unknown[]) => unknown): void {
    this.methods[name] = fn;
  }

  staticMethod(name: string, fn: (...args: unknown[]) => unknown): void {
    this.statics[name] = fn;
  }

  /** Apply defaults for missing fields to a plain object. */
  applyDefaults(doc: Record<string, unknown>): Record<string, unknown> {
    for (const [path, field] of this.compiledPaths) {
      if (doc[path] === undefined && field.hasDefault) {
        doc[path] = typeof field.default === 'function' ? (field.default as () => unknown)() : field.default;
      }
    }
    return doc;
  }

  /** Validate + coerce a document object; throws CoreValidationError on failure. */
  validate(doc: Record<string, unknown>): void {
    const errors: Array<{ path: string; message: string }> = [];
    const strict = this.options.strict;

    for (const [path, field] of this.compiledPaths) {
      const value = doc[path];
      const required = typeof field.required === 'function' ? field.required() : field.required;
      if (value === undefined || value === null) {
        if (required) errors.push({ path, message: `Path \`${path}\` is required.` });
        continue;
      }
      let coerced: unknown;
      try {
        coerced = coerce(field.token, value);
      } catch (e) {
        errors.push({ path, message: (e as Error).message });
        continue;
      }
      if (field.transform) coerced = field.transform(coerced);
      if (field.enum && !field.enum.includes(coerced)) {
        errors.push({ path, message: `\`${path}\` must be one of the enum values ${JSON.stringify(field.enum)}.` });
      }
      if (field.token === 'Number' && typeof coerced === 'number') {
        if (field.min !== undefined && coerced < field.min) errors.push({ path, message: `\`${path}\` must be >= ${field.min}.` });
        if (field.max !== undefined && coerced > field.max) errors.push({ path, message: `\`${path}\` must be <= ${field.max}.` });
      }
      if (field.token === 'String' && typeof coerced === 'string' && field.match && !field.match.test(coerced)) {
        errors.push({ path, message: `\`${path}\` format is invalid.` });
      }
      for (const v of field.validators) {
        if (!v.validator(coerced)) errors.push({ path, message: v.message });
      }
      doc[path] = coerced;
    }

    if (strict === true) {
      for (const key of Object.keys(doc)) {
        if (!this.compiledPaths.has(key) && !this.virtuals.has(key) && key !== '_id') {
          delete doc[key];
        }
      }
    } else if (strict === 'throw') {
      for (const key of Object.keys(doc)) {
        if (!this.compiledPaths.has(key) && !this.virtuals.has(key) && key !== '_id') {
          errors.push({ path: key, message: `Path \`${key}\` is not in schema.` });
        }
      }
    }

    if (errors.length) {
      throw new ValidationError(`Validation failed: ${errors.map((e) => e.message).join('; ')}`, errors);
    }
  }
}

function normalizeField(raw: unknown): FieldDefinition {
  if (raw && typeof raw === 'object' && 'type' in (raw as Record<string, unknown>)) {
    return raw as FieldDefinition;
  }
  return { type: raw };
}

function resolveToken(type: unknown): SchemaTypeToken {
  if (Array.isArray(type)) return 'Array';
  if (type instanceof NexusSchema) return 'Mixed';
  if (typeof type === 'string') return type as SchemaTypeToken;
  if (typeof type === 'function') return typeOf(type);
  return 'Mixed';
}
