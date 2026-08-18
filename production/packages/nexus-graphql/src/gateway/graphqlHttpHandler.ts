import { parse, type DocumentNode } from 'graphql';
import type { RequestContext, Handler } from '@bhooai/nexus-core';
import type { Gateway, GraphQLContext } from '../types.js';

export interface GraphqlHandlerOptions {
  /** The gateway to execute against. */
  gateway: Gateway;
  /** Build the per-request resolver context. Defaults to `{ request: ctx, user: ctx.state.user }`. */
  context?: (ctx: RequestContext) => GraphQLContext | Promise<GraphQLContext>;
  /** Allow introspection queries (default follows config.graphql.introspection = true). */
  introspection?: boolean;
}

interface GraphQLRequestBody {
  query?: string;
  variables?: Record<string, any>;
  operationName?: string;
}

/** True when a parsed operation set contains an introspection field (`__schema`/`__type`). */
function isIntrospectionDocument(doc: DocumentNode): boolean {
  for (const def of doc.definitions) {
    if (def.kind === 'OperationDefinition') {
      const sels = def.selectionSet.selections;
      for (const s of sels) {
        if (s.kind === 'Field' && (s.name.value === '__schema' || s.name.value === '__type')) return true;
      }
    }
  }
  return false;
}

/**
 * HTTP handler for `/graphql`. Accepts POST with `{ query, variables, operationName }`
 * (or GET with `?query=`). Applies the gateway in-process. Introspection is
 * rejected when disabled.
 */
export function graphqlHttpHandler(options: GraphqlHandlerOptions): Handler {
  const { gateway, introspection = true } = options;
  return async (ctx: RequestContext) => {
    let body: GraphQLRequestBody;
    if (ctx.method === 'GET') {
      const q = ctx.query.query;
      body = { query: Array.isArray(q) ? q[0] : q, variables: parseJsonQuery(ctx.query.variables), operationName: single(ctx.query.operationName) };
    } else {
      body = (ctx.body as GraphQLRequestBody) ?? {};
    }

    if (!body.query) {
      ctx.json({ errors: [{ message: 'Must provide a query string.' }] }, 400);
      return;
    }

    let document: DocumentNode;
    try {
      document = parse(body.query);
    } catch (err) {
      ctx.json({ errors: [{ message: (err as Error).message }] }, 400);
      return;
    }

    if (!introspection && isIntrospectionDocument(document)) {
      ctx.json({ errors: [{ message: 'Introspection is disabled.' }] }, 403);
      return;
    }

    const contextValue = options.context
      ? await options.context(ctx)
      : { request: ctx, user: (ctx.state.user as GraphQLContext['user']) };

    const result = await gateway.execute({
      document,
      variableValues: body.variables,
      operationName: body.operationName,
      contextValue,
    });
    ctx.json(result);
  };
}

function parseJsonQuery(v: string | string[] | undefined): Record<string, any> | undefined {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return undefined;
  try { return JSON.parse(s as string); } catch { return undefined; }
}
function single(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}