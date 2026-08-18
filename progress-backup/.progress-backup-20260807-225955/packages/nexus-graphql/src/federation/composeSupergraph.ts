import { buildSchema, isObjectType, isInterfaceType, type GraphQLSchema, type GraphQLObjectType, type GraphQLInterfaceType } from 'graphql';
import type { Subgraph } from '../types.js';
import { parseFederationMetadata, type TypeMeta } from './parseMetadata.js';
import { buildPublicSchema } from '../gateway/publicSchema.js';

export interface EntitySource {
  subgraph: string;
  keyFields: string[];
}
export interface RequiresRecord {
  subgraph: string;
  requiresFields: string[];
}

export interface Supergraph {
  subgraphs: Subgraph[];
  /** typeName -> fieldName -> owning subgraph name. */
  ownership: Map<string, Map<string, string>>;
  /** typeName -> subgraphs that can resolve it via _entities (have @key). */
  entities: Map<string, EntitySource[]>;
  /** typeName -> fieldName -> subgraph that @provides the field. */
  provides: Map<string, Map<string, string>>;
  /** typeName -> fieldName -> { subgraph, requiresFields }. */
  requires: Map<string, Map<string, RequiresRecord>>;
  /** Client-facing merged SDL (no federation directives). */
  mergedSdl: string;
  /** Schema built from mergedSdl (for query planning/type lookup only). */
  schema: GraphQLSchema;
  /** Per-subgraph public schemas (type info). */
  subgraphSchemas: Map<string, GraphQLSchema>;
  /** Per-subgraph federation metadata. */
  metadata: Map<string, Map<string, TypeMeta>>;
}

const ROOT_TYPES = ['Query', 'Mutation', 'Subscription'];

/**
 * Compose multiple subgraphs into a Supergraph: collect field ownership,
 * entity @key sources, @provides and @requires records, and a merged public SDL.
 *
 * Ownership rule (v1): a field is owned by a subgraph if that subgraph's SDL
 * defines the field on the type and it is NOT `@external`. The first subgraph
 * to claim a non-external field wins; a conflicting claim by a second subgraph
 * is recorded as a composition warning (real federation would arbitrate via
 * `@shareable`/`@override` — out of scope for v1).
 */
export function composeSupergraph(subgraphs: Subgraph[]): Supergraph {
  if (subgraphs.length === 0) throw new Error('[nexus-graphql] composeSupergraph requires subgraphs');

  const ownership = new Map<string, Map<string, string>>();
  const entities = new Map<string, EntitySource[]>();
  const provides = new Map<string, Map<string, string>>();
  const requires = new Map<string, Map<string, RequiresRecord>>();
  const subgraphSchemas = new Map<string, GraphQLSchema>();
  const metadata = new Map<string, Map<string, TypeMeta>>();
  const conflicts: string[] = [];

  for (const sub of subgraphs) {
    const pub = buildPublicSchema(sub.sdl);
    subgraphSchemas.set(sub.name, pub);
    const meta = parseFederationMetadata(sub.sdl);
    metadata.set(sub.name, meta);

    for (const [typeName, typeMeta] of meta) {
      // Entity sources: every @key on the type makes the subgraph a resolver.
      if (typeMeta.keys.length) {
        const list = entities.get(typeName) ?? [];
        for (const keyFields of typeMeta.keys) list.push({ subgraph: sub.name, keyFields });
        entities.set(typeName, list);
      }
      for (const [fieldName, fieldMeta] of typeMeta.fields) {
        if (fieldMeta.external) continue; // resolved elsewhere — not owned here
        const typeOwn = ownership.get(typeName) ?? new Map<string, string>();
        if (typeOwn.has(fieldName) && typeOwn.get(fieldName) !== sub.name) {
          conflicts.push(`${typeName}.${fieldName} claimed by ${typeOwn.get(fieldName)} and ${sub.name} (v1: first wins)`);
        } else {
          typeOwn.set(fieldName, sub.name);
        }
        ownership.set(typeName, typeOwn);
        if (fieldMeta.provides) {
          const tp = provides.get(typeName) ?? new Map<string, string>();
          tp.set(fieldName, sub.name);
          provides.set(typeName, tp);
        }
        if (fieldMeta.requires) {
          const tr = requires.get(typeName) ?? new Map<string, string>();
          tr.set(fieldName, { subgraph: sub.name, requiresFields: fieldMeta.requires });
          requires.set(typeName, tr);
        }
      }
    }
  }

  const mergedSdl = mergeSdl(subgraphs, subgraphSchemas, metadata, ownership);
  const schema = buildSchema(mergedSdl);

  return { subgraphs, ownership, entities, provides, requires, mergedSdl, schema, subgraphSchemas, metadata };
}

/** Build the merged public SDL from all subgraphs' public types. */
function mergeSdl(
  subgraphs: Subgraph[],
  subgraphSchemas: Map<string, GraphQLSchema>,
  _metadata: Map<string, Map<string, TypeMeta>>,
  ownership: Map<string, Map<string, string>>,
): string {
  // Collect each type's fields (name -> SDL type string) from the owning subgraph's public schema.
  const typeFields = new Map<string, Map<string, string>>();
  const rootFields = new Map<string, Map<string, string>>(); // Query/Mutation/Subscription
  const kinds = new Map<string, 'type' | 'interface'>();

  for (const sub of subgraphs) {
    const pub = subgraphSchemas.get(sub.name)!;
    const typeMap = pub.getTypeMap();
    for (const [typeName, gqlType] of Object.entries(typeMap)) {
      if (typeName.startsWith('__') || typeName.startsWith('_')) continue;
      if (isObjectType(gqlType)) {
        const isRoot = ROOT_TYPES.includes(typeName);
        const target = isRoot ? (rootFields.get(typeName) ?? new Map<string, string>()) : (typeFields.get(typeName) ?? new Map<string, string>());
        kinds.set(typeName, 'type');
        for (const field of Object.values(gqlType.getFields())) {
          const owner = ownership.get(typeName)?.get(field.name);
          // Include the field if this subgraph owns it (or it's a root field here).
          if (isRoot || owner === sub.name) {
            target.set(field.name, field.type.toString());
          }
        }
        if (isRoot) rootFields.set(typeName, target); else typeFields.set(typeName, target);
      } else if (isInterfaceType(gqlType)) {
        const target = typeFields.get(typeName) ?? new Map<string, string>();
        kinds.set(typeName, 'interface');
        for (const field of Object.values(gqlType.getFields())) {
          if (ownership.get(typeName)?.get(field.name) === sub.name) target.set(field.name, field.type.toString());
        }
        typeFields.set(typeName, target);
      }
    }
  }

  const parts: string[] = [];
  for (const [typeName, fields] of rootFields) {
    parts.push(`type ${typeName} {\n${fieldLines(fields)}\n}`);
  }
  for (const [typeName, fields] of typeFields) {
    const kind = kinds.get(typeName) ?? 'type';
    parts.push(`${kind} ${typeName} {\n${fieldLines(fields)}\n}`);
  }
  return parts.join('\n\n');
}

function fieldLines(fields: Map<string, string>): string {
  return [...fields.entries()].map(([name, type]) => `  ${name}: ${type}`).join('\n');
}