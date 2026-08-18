import type { GraphQLSchema, ExecutionResult, DocumentNode } from 'graphql';

/** A field resolver: (parent, args, context, info) => value | Promise<value>. */
export type Resolver = (parent: any, args: Record<string, any>, context: GraphQLContext, info: any) => any | Promise<any>;

/** A subscribe resolver returning an AsyncIterable of event payloads. */
export type SubscribeResolver = (parent: any, args: Record<string, any>, context: GraphQLContext, info: any) => AsyncIterable<any> | Promise<AsyncIterable<any>>;

/** Resolvers for a type. Fields may have a plain resolver or `{ resolve, subscribe }` (subscriptions). */
export type TypeResolvers = Record<string, Resolver | { resolve?: Resolver; subscribe?: SubscribeResolver }>;

export interface Resolvers {
  [typeName: string]: TypeResolvers;
}

/** Per-request context passed to every resolver. */
export interface GraphQLContext {
  /** The raw HTTP/WS request (for auth headers, ip, etc.). */
  request?: unknown;
  /** Authenticated user payload (sub, roles, sid) when auth is applied. */
  user?: { sub: string; roles: string[]; sid?: string };
  /** Anything the host wants to inject (DB connections, services, dataloaders). */
  [key: string]: unknown;
}

/** Entity representation: `__typename` + the key fields of an entity. */
export interface EntityRepresentation {
  __typename: string;
  [key: string]: unknown;
}

/** Resolves an entity by its representation. Returns the object (with fields) or null. */
export type EntityResolver = (representation: EntityRepresentation, context: GraphQLContext) => Promise<any | null> | any | null;

export interface DefineSubgraphOptions {
  /** Subgraph name (used as the `__typename` source id and in composition). */
  name: string;
  /** The subgraph SDL (user types + federation directives like `@key`). */
  typeDefs: string;
  /** Field resolvers. */
  resolvers?: Resolvers;
  /** Entity resolver for `_entities`. Defaults to returning the representation as-is. */
  entityResolver?: EntityResolver;
}

/** A built subgraph, ready to be composed or executed in-process. */
export interface Subgraph {
  name: string;
  /** Executable schema including federation boilerplate (_service, _entities). */
  schema: GraphQLSchema;
  /** The subgraph SDL (with federation directives) — what `_service.sdl` returns. */
  sdl: string;
  /** Map of entity typeName -> key field paths (e.g. `["id"]` or `["id email"]`). */
  entityKeys: Map<string, string[]>;
  resolvers: Resolvers;
  entityResolver: EntityResolver;
}

export interface ExecuteParams {
  schema: GraphQLSchema;
  document: DocumentNode;
  resolvers: Resolvers;
  variableValues?: Record<string, any>;
  operationName?: string;
  contextValue?: GraphQLContext;
  rootValue?: any;
}

export type ExecutionResultLike = ExecutionResult;

export interface Gateway {
  /** Public (client-facing) schema — federation internals stripped. */
  schema: GraphQLSchema;
  subgraphs: Subgraph[];
  execute(params: Omit<ExecuteParams, 'schema' | 'resolvers'>): Promise<ExecutionResult>;
  subscribe(params: Omit<ExecuteParams, 'schema' | 'resolvers'>): Promise<AsyncIterable<ExecutionResult>>;
}