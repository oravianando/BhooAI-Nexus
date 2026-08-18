import { execute, subscribe, validate, type GraphQLSchema, type ExecutionResult, type DocumentNode } from 'graphql';
import type { Gateway, Subgraph, Resolvers, GraphQLContext, ExecuteParams } from '../types.js';
import { createFieldResolver, createSubscribeFieldResolver } from './fieldResolver.js';
import { buildPublicSchema } from './publicSchema.js';

/**
 * Create an in-process gateway over one or more subgraphs.
 *
 * Single-subgraph mode (Phase 5): the gateway exposes the subgraph's public
 * schema and executes operations directly against the subgraph's resolvers —
 * no network hop, shared in-process context (DB pool, services). This is the
 * default app shape; federation overhead only kicks in when there are multiple
 * subgraphs.
 *
 * Multi-subgraph composition + query planning is Phase 6; calling with >1
 * subgraph here throws a clear "not yet" error so the API is forward-compatible.
 */
export function createGateway(input: { subgraph: Subgraph } | { subgraphs: Subgraph[] }): Gateway {
  const subgraphs: Subgraph[] = 'subgraph' in input ? [input.subgraph] : input.subgraphs;
  if (subgraphs.length === 0) throw new Error('[nexus-graphql] createGateway requires at least one subgraph');
  if (subgraphs.length > 1) {
    throw new Error(
      '[nexus-graphql] Multi-subgraph federation (composition + query planning) is implemented in Phase 6. ' +
        'Pass a single subgraph here, or use the Phase 6 composeSupergraph/createFederatedGateway.',
    );
  }

  const only = subgraphs[0]!;
  const resolvers: Resolvers = only.resolvers;
  const schema: GraphQLSchema = buildPublicSchema(only.sdl);
  const fieldResolver = createFieldResolver(resolvers);
  const subscribeFieldResolver = createSubscribeFieldResolver(resolvers);

  async function run(document: DocumentNode, params: Omit<ExecuteParams, 'schema' | 'resolvers' | 'document'>) {
    const errors = validate(schema, document);
    if (errors.length) return ({ errors: errors.map((e) => ({ message: e.message })) } as unknown) as ExecutionResult;
    return execute({
      schema,
      document,
      rootValue: params.rootValue,
      contextValue: params.contextValue as GraphQLContext,
      variableValues: params.variableValues,
      operationName: params.operationName,
      fieldResolver,
    });
  }

  return {
    schema,
    subgraphs,
    async execute(params) {
      return run(params.document, params);
    },
    async subscribe(params) {
      const document = params.document;
      const errors = validate(schema, document);
      if (errors.length) {
        return (async function* () { yield { errors: errors.map((e) => ({ message: e.message })) }; })() as AsyncIterable<ExecutionResult>;
      }
      const result = await subscribe({
        schema,
        document,
        rootValue: params.rootValue,
        contextValue: params.contextValue as GraphQLContext,
        variableValues: params.variableValues,
        operationName: params.operationName,
        subscribeFieldResolver,
        fieldResolver,
      });
      // graphql-js returns an AsyncIterable on success or an ExecutionResult (with errors) otherwise.
      if (Symbol.asyncIterator in (result as any)) {
        return result as AsyncIterable<ExecutionResult>;
      }
      return (async function* () { yield result as ExecutionResult; })() as AsyncIterable<ExecutionResult>;
    },
  };
}
