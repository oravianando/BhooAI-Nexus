import { execute, parse, isObjectType, isInterfaceType, type DocumentNode, type SelectionSetNode, type FieldNode, type InlineFragmentNode, type FragmentSpreadNode, type ExecutionResult } from 'graphql';
import type { Supergraph } from './composeSupergraph.js';
import type { Subgraph, GraphQLContext } from '../types.js';
import { createFieldResolver } from '../gateway/fieldResolver.js';

/**
 * Naive sequential federated executor (Phase 6, v1).
 *
 * Algorithm:
 *   1. Root pass — group the operation's top-level fields by their owning
 *      subgraph; for each group, execute a trimmed subquery against that
 *      subgraph in-process. Trim keeps only fields owned by that subgraph,
 *      plus `__typename` and entity key fields (so later passes can join).
 *   2. Entity-join passes — scan the stitched result for entity-typed objects
 *      whose requested fields are owned by *other* subgraphs; for each such
 *      (subgraph, type) pair, call that subgraph's `_entities` with
 *      representations built from the parents' keys and a trimmed subquery,
 *      then merge the returned fields back by key. Repeat until no missing
 *      fields remain (handles nested joins, one level per pass).
 *
 * Limitations (documented): sequential (no parallel fetch fan-out), `@requires`
 * supported as "fetch the required external fields first, then resolve", no
 * `@shareable` arbitration, no `@override`. Composition is ours; execution is
 * in-process (shared nothing is Phase 6-distributed, designed not built).
 */

export interface FetchNode {
  kind: 'root' | 'entities';
  subgraph: string;
  /** SDL selection set this fetch executes. */
  selection: string;
  /** For entity fetches: the entity type name being resolved. */
  typeName?: string;
  /** For entity fetches: key fields used to build representations. */
  keyFields?: string[];
}
export interface FetchPlan {
  nodes: FetchNode[];
}

/** Build a FetchPlan description for inspection/golden tests. */
export function planQuery(supergraph: Supergraph, document: DocumentNode): FetchPlan {
  const nodes: FetchNode[] = [];
  const op = document.definitions.find((d) => d.kind === 'OperationDefinition') as
    | { selectionSet: SelectionSetNode }
    | undefined;
  if (!op) return { nodes };
  const rootType = 'Query';
  const bySub = new Map<string, string[]>();
  for (const sel of op.selectionSet.selections) {
    if (sel.kind === 'Field') {
      const owner = supergraph.ownership.get(rootType)?.get((sel as FieldNode).name.value);
      if (owner) bySub.set(owner, [...(bySub.get(owner) ?? []), (sel as FieldNode).name.value]);
    }
  }
  for (const [sub, fields] of bySub) {
    nodes.push({ kind: 'root', subgraph: sub, selection: `{ ${fields.join(' ') } }` });
  }
  return { nodes };
}

/** Execute a federated query in-process against the composed subgraphs. */
export async function executeFederated(
  supergraph: Supergraph,
  document: DocumentNode,
  variableValues: Record<string, any> | undefined,
  contextValue: GraphQLContext,
): Promise<ExecutionResult> {
  const op = document.definitions.find((d) => d.kind === 'OperationDefinition') as
    | { selectionSet: SelectionSetNode; operation: string }
    | undefined;
  if (!op) return { errors: [{ message: 'No operation in document' }] };
  const rootType = op.operation === 'mutation' ? 'Mutation' : op.operation === 'subscription' ? 'Subscription' : 'Query';

  const subgraphByName = new Map<string, Subgraph>(supergraph.subgraphs.map((s) => [s.name, s]));

  // 1. Root pass: group top-level fields by owner and execute trimmed subqueries.
  const rootGroups = new Map<string, FieldNode[]>();
  for (const sel of op.selectionSet.selections) {
    if (sel.kind !== 'Field') continue; // v1: no fragment spreads at root
    const owner = supergraph.ownership.get(rootType)?.get(sel.name.value);
    if (!owner) return { errors: [{ message: `No subgraph owns ${rootType}.${sel.name.value}` }] };
    const arr = rootGroups.get(owner) ?? [];
    arr.push(sel);
    rootGroups.set(owner, arr);
  }

  const data: Record<string, unknown> = {};
  for (const [subName, fields] of rootGroups) {
    const sub = subgraphByName.get(subName)!;
    const sel = trimSelection(fields, rootType, subName, supergraph, true);
    const sdl = `${op.operation} { ${sel} }`;
    const res = await execSubgraph(sub, parse(sdl), variableValues, contextValue);
    if (res.errors) return { errors: res.errors };
    Object.assign(data, res.data as Record<string, unknown>);
  }

  // 2. Iterative entity-join passes.
  for (let pass = 0; pass < 8; pass++) {
    const pending = collectMissing(supergraph, op.selectionSet, rootType, data);
    if (pending.length === 0) break;
    for (const job of pending) {
      const sub = subgraphByName.get(job.subgraph)!;
      const reps = job.parents.map((p) => pickKeys(p, job.keyFields));
      const sel = trimSelection(job.fieldNodes, job.typeName, job.subgraph, supergraph, true);
      const sdl = `query($reps: [_Any!]!){ _entities(representations: $reps){ ... on ${job.typeName} { ${sel} } } }`;
      const res = await execSubgraph(sub, parse(sdl), { ...variableValues, reps }, contextValue);
      if (res.errors) return { errors: res.errors };
      const entities = (res.data as Record<string, unknown> | undefined)?._entities as any[] | undefined;
      if (!entities) continue;
      mergeEntities(job.parents, entities, job.keyFields, job.typeName, job.missingFields);
    }
  }

  return { data };
}

/** Run a document against a subgraph's federation schema + resolvers in-process. */
async function execSubgraph(sub: Subgraph, document: DocumentNode, variableValues: Record<string, any> | undefined, contextValue: GraphQLContext): Promise<ExecutionResult> {
  return execute({
    schema: sub.schema,
    document,
    rootValue: undefined,
    contextValue,
    variableValues,
    fieldResolver: createFieldResolver(sub.resolvers),
  });
}

/** Unwrap a GraphQL type name to its base named type. */
function baseType(type: string): string {
  return type.replace(/[\[\]!]/g, '');
}

/** Output SDL type of a field on a type, from the supergraph (merged) schema. */
function fieldType(supergraph: Supergraph, parentType: string, fieldName: string): string | undefined {
  const t = supergraph.schema.getType(parentType);
  if (isObjectType(t)) return t.getFields()[fieldName]?.type.toString();
  if (isInterfaceType(t)) return t.getFields()[fieldName]?.type.toString();
  return undefined;
}

/**
 * Trim a list of selections (for one parent type) to fields owned by `subgraphName`,
 * preserving field arguments, plus `__typename`. For entity-typed parents, the
 * entity's @key fields owned by `subgraphName` are force-included so downstream
 * join passes can build representations. Fields owned by other subgraphs are
 * omitted here (a later entity-join pass fills them). Returns an SDL selection-set.
 */
function trimSelection(selections: readonly (FieldNode | InlineFragmentNode | FragmentSpreadNode)[], parentType: string, subgraphName: string, supergraph: Supergraph, _includeKeys: boolean): string {
  const parts: string[] = [];
  const included = new Set<string>();
  for (const sel of selections) {
    if (sel.kind === 'Field') {
      const name = sel.name.value;
      if (name === '__typename') { parts.push('__typename'); included.add(name); continue; }
      const owner = supergraph.ownership.get(parentType)?.get(name);
      const ft = fieldType(supergraph, parentType, name);
      const childType = ft ? baseType(ft) : undefined;
      if (owner === subgraphName) {
        const sub = sel.selectionSet ? trimSelection(sel.selectionSet.selections, childType!, subgraphName, supergraph, true) : '';
        const args = argsToSdl(sel.arguments);
        parts.push(sub ? `${name}${args} { ${sub} }` : `${name}${args}`);
        included.add(name);
      }
      // Fields owned by other subgraphs are omitted here; an entity-join pass fills them.
    } else if (sel.kind === 'InlineFragment') {
      const fragType = sel.typeCondition?.name.value ?? parentType;
      const sub = trimSelection(sel.selectionSet.selections, fragType, subgraphName, supergraph, _includeKeys);
      parts.push(`... on ${fragType} { ${sub} }`);
    }
    // FragmentSpread: v1 ignores (rare in generated clients)
  }
  // Force-include this entity's key fields (owned by this subgraph) so join passes
  // can build representations even when the client didn't request them.
  if (supergraph.entities.has(parentType)) {
    const src = (supergraph.entities.get(parentType) ?? []).find((s) => s.subgraph === subgraphName);
    if (src) {
      for (const kf of src.keyFields) {
        if (supergraph.ownership.get(parentType)?.get(kf) === subgraphName && !included.has(kf)) {
          parts.push(kf);
          included.add(kf);
        }
      }
    }
  }
  return parts.join(' ');
}

/** Serialize a field's arguments to SDL, e.g. `(id: "u1", limit: $limit)`. */
function argsToSdl(args: readonly import('graphql').ArgumentNode[] | undefined): string {
  if (!args || args.length === 0) return '';
  return '(' + args.map((a) => `${a.name.value}: ${valueToSdl(a.value)}`).join(', ') + ')';
}
function valueToSdl(v: import('graphql').ValueNode): string {
  switch (v.kind) {
    case 'IntValue': case 'FloatValue': return v.value;
    case 'StringValue': return JSON.stringify(v.value);
    case 'BooleanValue': return String(v.value);
    case 'EnumValue': return v.value;
    case 'NullValue': return 'null';
    case 'Variable': return '$' + v.name.value;
    case 'ListValue': return '[' + v.values.map(valueToSdl).join(', ') + ']';
    case 'ObjectValue': return '{' + v.fields.map((f) => `${f.name.value}: ${valueToSdl(f.value)}`).join(', ') + '}';
    default: return '';
  }
}

function pickKeys(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { __typename: obj.__typename };
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

interface JoinJob {
  subgraph: string;
  typeName: string;
  keyFields: string[];
  parents: Record<string, unknown>[];
  missingFields: string[];
  fieldNodes: (FieldNode | InlineFragmentNode | FragmentSpreadNode)[];
}

/**
 * Walk the stitched `data` against the query selection set; for each entity-typed
 * object, find fields the query wants that are owned by a *different* subgraph
 * than the one that produced the object, and emit a JoinJob to fetch them.
 */
function collectMissing(supergraph: Supergraph, selectionSet: SelectionSetNode, parentType: string, data: Record<string, unknown> | unknown[]): JoinJob[] {
  const jobs: JoinJob[] = [];
  walk(supergraph, selectionSet, parentType, data, jobs, new Set());
  return jobs;
}

function walk(supergraph: Supergraph, selectionSet: SelectionSetNode, parentType: string, data: unknown, jobs: JoinJob[], seen: Set<Record<string, unknown>>): void {
  if (data == null) return;
  if (Array.isArray(data)) { for (const item of data) walk(supergraph, selectionSet, parentType, item, jobs, seen); return; }
  if (typeof data !== 'object') return;
  const obj = data as Record<string, unknown>;

  // Group requested fields by their owning subgraph; identify fields owned by a
  // subgraph other than the one that produced this object (inferred from the
  // fields already present). For each foreign owner, build a job.
  const requestedByOwner = new Map<string, FieldNode[]>();
  for (const sel of selectionSet.selections) {
    if (sel.kind !== 'Field') continue;
    const name = sel.name.value;
    if (name === '__typename') continue;
    const owner = supergraph.ownership.get(parentType)?.get(name);
    if (!owner) continue;
    if (!(name in obj)) { // missing → needs fetching from `owner`
      const arr = requestedByOwner.get(owner) ?? [];
      arr.push(sel);
      requestedByOwner.set(owner, arr);
    } else if (sel.selectionSet) {
      // present → recurse into children for nested joins
      const ft = fieldType(supergraph, parentType, name);
      const childType = ft ? baseType(ft) : undefined;
      if (childType) walk(supergraph, sel.selectionSet, childType, obj[name], jobs, seen);
    }
  }

  if (requestedByOwner.size === 0) return;
  if (seen.has(obj)) return;
  seen.add(obj);

  const entitySources = supergraph.entities.get(parentType) ?? [];
  if (entitySources.length === 0) return; // can't join a non-entity

  for (const [owner, fieldNodes] of requestedByOwner) {
    // Pick a key for this owner: an entity source whose subgraph == owner, else first.
    const source = entitySources.find((s) => s.subgraph === owner) ?? entitySources[0]!;
    const keyFields = source.keyFields;
    // Only emit if we actually have the key fields present on the object.
    if (!keyFields.every((k) => k in obj)) continue;
    jobs.push({
      subgraph: owner,
      typeName: parentType,
      keyFields,
      parents: [obj],
      missingFields: fieldNodes.map((f) => f.name.value),
      fieldNodes,
    });
  }
}

/**
 * Merge fetched entity fields back into the parent objects. `_entities` returns
 * one resolved entity per representation, in order; `reps` were built from
 * `parents` in order, so `entities[i]` corresponds to `parents[i]`. We merge by
 * index (not by key tuple) because the fetched entity may not carry its `@key`
 * fields — they may be `@external` on the resolving subgraph and absent from the
 * trimmed selection. Null entries (entity resolver returned null) are skipped.
 */
function mergeEntities(parents: Record<string, unknown>[], entities: any[], _keyFields: string[], typeName: string, missingFields: string[]): void {
  for (let i = 0; i < parents.length; i++) {
    const e = entities[i];
    const p = parents[i]!;
    if (!e || typeof e !== 'object') continue;
    for (const f of missingFields) {
      if (f in e) p[f] = e[f];
    }
    if (!p.__typename) p.__typename = typeName;
  }
}