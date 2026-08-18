import { parse, type DocumentNode, type ExecutionResult } from 'graphql';
import type { Subgraph, GraphQLContext, ExecuteParams } from '../types.js';
import { composeSupergraph, type Supergraph } from './composeSupergraph.js';
import { executeFederated, planQuery, type FetchPlan } from './executor.js';

export interface FederatedGateway {
  /** Client-facing merged schema. */
  schema: Supergraph['schema'];
  supergraph: Supergraph;
  subgraphs: Subgraph[];
  execute(params: Omit<ExecuteParams, 'schema' | 'resolvers'>): Promise<ExecutionResult>;
  /** Inspect the fetch plan for a query (golden tests / debugging). */
  plan(document: DocumentNode): FetchPlan;
}

/**
 * Compose multiple subgraphs into a federated gateway. The gateway exposes the
 * merged public schema and executes queries via the naive sequential federated
 * executor (root fetches + iterative entity-join passes). Subscriptions are not
 * federated in v1 — route them to the owning subgraph's `SubscriptionServer`.
 */
export function createFederatedGateway(subgraphs: Subgraph[]): FederatedGateway {
  const supergraph = composeSupergraph(subgraphs);
  return {
    schema: supergraph.schema,
    supergraph,
    subgraphs,
    async execute(params) {
      const document: DocumentNode = params.document;
      return executeFederated(supergraph, document, params.variableValues, (params.contextValue as GraphQLContext) ?? {});
    },
    plan(document) {
      return planQuery(supergraph, document);
    },
  };
}