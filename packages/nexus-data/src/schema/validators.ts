import { coerce, typeOf, type SchemaTypeToken } from './SchemaType.js';

export interface FieldValidator {
  validator: (value: unknown) => boolean;
  message: string;
}

export interface FieldDefinition {
  /** A JS constructor, an array `[Constructor]`, a nested Schema, or a type token. */
  type: unknown;
  required?: boolean | (() => boolean);
  default?: unknown | (() => unknown);
  enum?: unknown[];
  min?: number;
  max?: number;
  match?: RegExp;
  validate?: FieldValidator | FieldValidator[];
  ref?: string; // model name for population
  refPath?: string; // dynamic ref field
  select?: boolean; // exclude from queries by default when false
  immutable?: boolean;
  expires?: number; // TTL index seconds
  index?: boolean | Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  transform?: (value: unknown) => unknown;
}

export interface CompiledField {
  token: SchemaTypeToken;
  isRef: boolean;
  ref?: string;
  refPath?: string;
  required: boolean | (() => boolean);
  hasDefault: boolean;
  default: unknown | (() => unknown);
  enum?: unknown[];
  min?: number;
  max?: number;
  match?: RegExp;
  validators: FieldValidator[];
  select: boolean;
  immutable: boolean;
  transform?: (value: unknown) => unknown;
  isEmbedded: boolean;
  embeddedSchema?: Schema;
}

export interface IndexSpec {
  spec: Record<string, 1 | -1>;
  options: Record<string, unknown>;
}

/** A field-validation error with a path. */
export interface FieldError {
  path: string;
  message: string;
}

/** Self-referencing type for embedded schemas. */
export interface Schema {
  compiledPaths: Map<string, CompiledField>;
  indexes: IndexSpec[];
  options: SchemaOptions;
  virtuals: Map<string, { get?: () => unknown; set?: (v: unknown) => void }>;
  preHooks: Map<string, Array<(ctx: unknown) => unknown | Promise<unknown>>>;
  postHooks: Map<string, Array<(ctx: unknown) => unknown | Promise<unknown>>>;
  methods: Record<string, (...args: unknown[]) => unknown>;
  statics: Record<string, (...args: unknown[]) => unknown>;
  define(path: string, def: FieldDefinition): void;
  virtual(path: string, opts?: { get?: () => unknown; set?: (v: unknown) => void }): void;
  pre(event: string, fn: (ctx: unknown) => unknown | Promise<unknown>): void;
  post(event: string, fn: (ctx: unknown) => unknown | Promise<unknown>): void;
  method(name: string, fn: (...args: unknown[]) => unknown): void;
  staticMethod(name: string, fn: (...args: unknown[]) => unknown): void;
}

export interface SchemaOptions {
  timestamps?: boolean | { createdAt?: string; updatedAt?: string };
  collection?: string;
  discriminatorKey?: string;
  versionKey?: string | false;
  strict?: boolean | 'throw';
}

export interface SchemaDefinition {
  [path: string]: FieldDefinition | unknown;
}