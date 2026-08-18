import { buildSchema, GraphQLSchema } from 'graphql';

/**
 * Strip federation directives from subgraph SDL to produce the *public*
 * (client-facing) schema. The gateway exposes this clean schema; the federation
 * internals (`_service`, `_entities`, `@key`, `@external`, ...) are not part of
 * the public API. For the single-subgraph case the public schema is simply the
 * user's types without the federation markers.
 */
export function buildPublicSchema(subgraphSdl: string): GraphQLSchema {
  const cleaned = subgraphSdl
    // Drop the `extend schema @link(...)` clause and any standalone @link.
    .replace(/extend\s+schema\s*@\s*link\s*\([^)]*\)/g, '')
    .replace(/@\s*link\s*\([^)]*\)/g, '')
    // Drop federation field/type directives.
    .replace(/@\s*key\s*\([^)]*\)/g, '')
    .replace(/@\s*requires\s*\([^)]*\)/g, '')
    .replace(/@\s*provides\s*\([^)]*\)/g, '')
    .replace(/@\s*external\b/g, '')
    .replace(/@\s*extends\b/g, '')
    // Collapse multiple blank lines left behind.
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return buildSchema(cleaned);
}