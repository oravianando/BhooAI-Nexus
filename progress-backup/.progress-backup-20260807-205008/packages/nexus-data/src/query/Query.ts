import type { DocumentInstance } from '../model/Document.js';
import type { Model } from '../model/Model.js';

type Op = 'find' | 'findOne';

interface PopulatePath {
  path: string;
  select?: string;
  match?: Record<string, unknown>;
}

/**
 * Fluent, thenable query builder. Accumulates filter/projection/sort/limit/skip/
 * populate options and compiles them to a mongo driver call on `then()` or
 * `exec()`. Hydrates results into Document instances unless `lean()` is used.
 */
export class Query<T extends DocumentInstance> {
  private filter: Record<string, unknown>;
  private projection: Record<string, 0 | 1> | undefined;
  private sortSpec: Record<string, 1 | -1> | undefined;
  private limitVal = 0;
  private skipVal = 0;
  private populatePaths: PopulatePath[] = [];
  private leanFlag = false;
  private sessionRef?: { session: unknown };

  constructor(
    private model: Model<T>,
    private op: Op,
    filter: Record<string, unknown>,
  ) {
    this.filter = { ...filter };
  }

  // ── Filter helpers ─────────────────────────────────────────────────────
  where(path: string, value: unknown): this { this.filter[path] = value; return this; }
  gt(path: string, value: unknown): this { return this.op2(path, '$gt', value); }
  gte(path: string, value: unknown): this { return this.op2(path, '$gte', value); }
  lt(path: string, value: unknown): this { return this.op2(path, '$lt', value); }
  lte(path: string, value: unknown): this { return this.op2(path, '$lte', value); }
  in(path: string, values: unknown[]): this { return this.op2(path, '$in', values); }
  nin(path: string, values: unknown[]): this { return this.op2(path, '$nin', values); }
  ne(path: string, value: unknown): this { return this.op2(path, '$ne', value); }
  exists(path: string, yes = true): this { return this.op2(path, '$exists', yes); }

  private op2(path: string, op: string, value: unknown): this {
    const current = this.filter[path];
    if (current && typeof current === 'object' && !Array.isArray(current) && !(current instanceof Date)) {
      (current as Record<string, unknown>)[op] = value;
    } else {
      this.filter[path] = { [op]: value };
    }
    return this;
  }

  // ── Shaping ────────────────────────────────────────────────────────────
  sort(spec: string | Record<string, 1 | -1>): this {
    if (typeof spec === 'string') {
      this.sortSpec = {};
      for (const part of spec.split(' ')) {
        if (!part) continue;
        const desc = part.startsWith('-');
        this.sortSpec[desc ? part.slice(1) : part] = desc ? -1 : 1;
      }
    } else {
      this.sortSpec = spec;
    }
    return this;
  }

  limit(n: number): this { this.limitVal = n; return this; }
  skip(n: number): this { this.skipVal = n; return this; }

  select(fields: string): this {
    this.projection = {};
    for (const part of fields.split(' ')) {
      if (!part) continue;
      const exclude = part.startsWith('-');
      this.projection[exclude ? part.slice(1) : part] = exclude ? 0 : 1;
    }
    return this;
  }

  populate(path: string, opts: { select?: string; match?: Record<string, unknown> } = {}): this {
    this.populatePaths.push({ path, select: opts.select, match: opts.match });
    return this;
  }

  lean(): this { this.leanFlag = true; return this; }
  session(session: unknown): this { this.sessionRef = { session }; return this; }

  // ── Execution ──────────────────────────────────────────────────────────
  async exec(): Promise<T[] | T | null> {
    const schema = this.model.schema;
    // pre('find') / pre('findOne') hooks receive the query's filter for mutation.
    const hookCtx = { filter: this.filter, model: this.model, op: this.op };
    await runFindHooks(schema.preHooks, this.op, hookCtx);
    this.filter = hookCtx.filter;

    const coll = await this.model.collection;
    const options: Record<string, unknown> = {};
    // Default projection: exclude fields flagged select:false unless caller set an explicit projection.
    if (this.projection) {
      options.projection = this.projection;
    } else {
      const excluded: Record<string, 0> = {};
      let hasExcluded = false;
      for (const [path, field] of schema.compiledPaths) {
        if (field.select === false) { excluded[path] = 0; hasExcluded = true; }
      }
      if (hasExcluded) options.projection = excluded;
    }
    if (this.sessionRef) options.session = this.sessionRef.session;
    if (this.sortSpec) options.sort = this.sortSpec;
    if (this.limitVal) options.limit = this.limitVal;
    if (this.skipVal) options.skip = this.skipVal;

    if (this.op === 'find') {
      const cursor = coll.find(this.filter, options);
      const docs = await cursor.toArray();
      let result: unknown[] = this.leanFlag ? docs : docs.map((d) => this.model.hydrate(d));
      if (this.populatePaths.length && !this.leanFlag) {
        const { populate } = await import('../populate/populate.js');
        await populate(this.model.connection, result as DocumentInstance[], this.populatePaths);
      }
      await runFindHooks(schema.postHooks, 'find', { docs: result, ...hookCtx });
      return result as T[];
    } else {
      const doc = await coll.findOne(this.filter, options);
      if (!doc) return null;
      const result = this.leanFlag ? doc : this.model.hydrate(doc);
      if (this.populatePaths.length && !this.leanFlag) {
        const { populate } = await import('../populate/populate.js');
        await populate(this.model.connection, [result as DocumentInstance], this.populatePaths);
      }
      await runFindHooks(schema.postHooks, 'findOne', { doc: result, ...hookCtx });
      return result as T;
    }
  }

  // ── Thenable ───────────────────────────────────────────────────────────
  then<TResult1 = T[] | T | null, TResult2 = never>(
    onFulfilled?: (value: T[] | T | null) => TResult1 | PromiseLike<TResult1>,
    onRejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onFulfilled, onRejected);
  }
}

async function runFindHooks(
  hooks: Map<string, Array<(ctx: unknown) => unknown | Promise<unknown>>>,
  op: string,
  ctx: unknown,
): Promise<void> {
  const list = hooks.get(op);
  if (!list) return;
  for (const fn of list) await fn.call(ctx, ctx);
}