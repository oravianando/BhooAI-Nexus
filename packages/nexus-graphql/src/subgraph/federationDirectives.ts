/**
 * Federation directive definitions and the `@link` schema directive.
 *
 * These are prepended to the user's typeDefs so `buildSchema` accepts the
 * federation directives (`@key`, `@external`, `@requires`, `@provides`,
 * `@extends`). We target a Federation v2-style subset (the same directives
 * Apollo uses); composition (Phase 6) is ours, but the directive *surface*
 * matches the spec so subgraph SDL is interoperable.
 *
 * NOTE: `@link` is declared so `extend schema @link(...)` parses. We do not
 * enforce the import list — the directives are always declared and available.
 */
export const FEDERATION_DIRECTIVE_SDL = /* graphql */ `
  directive @link(url: String!, import: [String!]) on SCHEMA
  directive @key(fields: String!) repeatable on OBJECT | INTERFACE
  directive @external on FIELD_DEFINITION
  directive @requires(fields: String!) on FIELD_DEFINITION
  directive @provides(fields: String!) on FIELD_DEFINITION
  directive @extends on OBJECT | INTERFACE | FIELD_DEFINITION
`;

/** The `extend schema @link(...)` clause advertising the federation import. */
export const FEDERATION_LINK = /* graphql */ `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.0"
    import: ["@key", "@external", "@requires", "@provides", "@extends"]
  )
`;

/** Federation boilerplate types prepended/appended to make a schema subgraph-compliant. */
export const FEDERATION_TYPES = /* graphql */ `
  scalar _Any
  type _Service { sdl: String! }
  extend type Query {
    _service: _Service!
    _entities(representations: [_Any!]!): [_Entity]!
  }
`;

/** Build the `_Entity` union SDL for the given entity type names (or a scalar if none). */
export function entityUnionSdl(entityTypeNames: string[]): string {
  if (entityTypeNames.length === 0) return `scalar _Entity`;
  return `union _Entity = ${entityTypeNames.join(' | ')}`;
}

/** Names of the federation directives we recognize (for stripping when building the public schema). */
export const FEDERATION_DIRECTIVE_NAMES = ['key', 'external', 'requires', 'provides', 'extends', 'link'];