import { buildSchema, parse, validate, GraphQLSchema } from 'graphql';
import type { DefineSubgraphOptions, Subgraph, Resolvers, GraphQLContext, EntityRepresentation, EntityResolver } from '../types.js';
import { FEDERATION_DIRECTIVE_SDL, FEDERATION_LINK, FEDERATION_TYPES, entityUnionSdl } from './federationDirectives.js';
import { parseEntityKeys } from './parseKeys.js';
import { createFieldResolver } from '../gateway/fieldResolver.js';

const DEFAULT_ENTITY_RESOLVER: EntityResolver = (rep) => rep;

/**
 * Define a federation-compliant subgraph from user typeDefs + resolvers.
 *
 * The user SDL may use federation directives (`@key`, `@external`, `@requires`,
 * `@provides`, `@extends`). We prepend the directive definitions + the `@link`
 * clause and append the federation boilerplate (`_Any`, `_Entity`, `_Service`,
 * `Query._service`, `Query._entities`) so the resulting schema is a valid
 * subgraph: `_service.sdl` returns the subgraph SDL and `_entities` resolves
 * representations via the provided `entityResolver` (default: pass-through).
 *
 * `defineSubgraph` does NOT compose — it produces a single executable subgraph.
 * The gateway (`createGateway`) executes it in-process for the single-subgraph
 * case; Phase 6 composes multiple subgraphs.
 */
export function defineSubgraph(options: DefineSubgraphOptions): Subgraph {
  const { name, typeDefs, resolvers = {}, entityResolver = DEFAULT_ENTITY_RESOLVER } = options;

  const entityKeys = parseEntityKeys(typeDefs);
  const entityUnion = entityUnionSdl([...entityKeys.keys()]);

  // Subgraph SDL = what _service.sdl returns: the user SDL + the @link clause.
  // (We keep the federation directives in the published SDL — that's the point.)
  const sdl = `${FEDERATION_LINK}\n\n${typeDefs.trim()}\n`;

  // Executable schema: directive defs + @link + user SDL + federation types + _Entity union.
  const fullSdl = [
    FEDERATION_DIRECTIVE_SDL,
    FEDERATION_LINK,
    typeDefs,
    FEDERATION_TYPES,
    entityUnion,
  ].join('\n\n');

  let schema: GraphQLSchema;
  try {
    schema = buildSchema(fullSdl, { assumeValid: false });
  } catch (err) {
    throw new Error(`[nexus-graphql] Failed to build subgraph schema for "${name}": ${(err as Error).message}`);
  }

  // The `_Entity` union needs a resolveType so graphql-js can pick the concrete
  // member type for each resolved entity. Entities carry `__typename` from
  // their representation; we also backfill it onto results that lack it.
  const entityType = schema.getType('_Entity') as
    | { resolveType?: (value: any) => string | null }
    | undefined;
  if (entityType && 'resolveType' in entityType) {
    entityType.resolveType = (value: any) => (value && typeof value === 'object' ? (value as any).__typename ?? null : null);
  }

  // Auto-wire the federation fields into the resolver map (merged, not mutated).
  const federationResolvers: Resolvers = {
    ...resolvers,
    _Any: {
      // Custom scalar: pass-through serialize/parse.
      __serialize: (value: unknown) => value,
      __parseValue: (value: unknown) => value,
      __parseLiteral: (value: unknown) => value,
    } as unknown as Resolvers['_Any'],
    Query: {
      ...(resolvers.Query ?? {}),
      _service: () => ({ sdl }),
      _entities: (_parent: unknown, args: { representations: EntityRepresentation[] }, ctx: GraphQLContext) =>
        Promise.all((args.representations ?? []).map(async (rep) => {
          const resolved = await entityResolver(rep, ctx);
          if (resolved && typeof resolved === 'object' && !('__typename' in resolved)) {
            (resolved as Record<string, unknown>).__typename = rep.__typename;
          }
          return resolved;
        })),
    },
    _Service: {
      sdl: (parent: { sdl?: string }) => parent.sdl ?? sdl,
    },
  };

  // Validate the SDL parses + that the federation directives are used correctly
  // (e.g. @key has a `fields` arg). buildSchema already enforces directive
  // argument types/locations; we additionally assert the SDL parses standalone.
  parse(sdl);

  return {
    name,
    schema,
    sdl,
    entityKeys,
    resolvers: federationResolvers,
    entityResolver,
  };
}

/**
 * Validate a query against a schema before execution (returns errors array).
 * Useful for the HTTP handler to reject malformed operations early.
 */
export function validateOperation(schema: GraphQLSchema, source: string) {
  let doc;
  try {
    doc = parse(source);
  } catch (err) {
    return [(err as Error).message];
  }
  return validate(schema, doc).map((e) => e.message);
}

/** Re-export for the gateway to share the resolver wiring. */
export { createFieldResolver };