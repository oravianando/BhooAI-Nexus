import type { GraphQLFieldResolver, GraphQLResolveInfo } from 'graphql';
import type { Resolvers, GraphQLContext, SubscribeResolver } from '../types.js';

/**
 * Build a graphql-js `fieldResolver` that dispatches to the user's resolvers
 * map. Resolution order:
 *   1. `__typename` → the parent's `__typename` (or the field's parent type name).
 *   2. `resolvers[typeName][fieldName]` — if it's a `{ resolve, subscribe }`
 *      shape (subscription field), use `.resolve`; otherwise call it directly.
 *   3. Default property access: `parent[fieldName]`.
 */
export function createFieldResolver(resolvers: Resolvers): GraphQLFieldResolver<any, GraphQLContext> {
  return (parent, args, context, info: GraphQLResolveInfo) => {
    const fieldName = info.fieldName;
    if (fieldName === '__typename') {
      return parent?.__typename ?? info.parentType.name;
    }
    const typeResolvers = resolvers[info.parentType.name];
    if (typeResolvers) {
      const field = typeResolvers[fieldName];
      if (field) {
        if (typeof field === 'function') return field(parent, args, context, info);
        if (typeof field === 'object' && field && typeof field.resolve === 'function') {
          return field.resolve(parent, args, context, info);
        }
      }
    }
    // Default: read the property off the parent (works for DB docs/objects).
    return parent != null ? parent[fieldName] : undefined;
  };
}

/** Build a `subscribeFieldResolver` for subscription root fields. */
export function createSubscribeFieldResolver(resolvers: Resolvers): GraphQLFieldResolver<any, GraphQLContext> {
  return (parent, args, context, info: GraphQLResolveInfo): AsyncIterable<any> | Promise<AsyncIterable<any>> => {
    const typeResolvers = resolvers[info.parentType.name];
    const field = typeResolvers?.[info.fieldName];
    const subscribe: SubscribeResolver | undefined =
      field && typeof field === 'object' && field ? field.subscribe : undefined;
    if (typeof subscribe !== 'function') {
      throw new Error(`No 'subscribe' resolver for ${info.parentType.name}.${info.fieldName}`);
    }
    return subscribe(parent, args, context, info);
  };
}