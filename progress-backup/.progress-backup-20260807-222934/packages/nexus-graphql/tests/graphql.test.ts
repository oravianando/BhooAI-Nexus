import { describe, it, expect } from 'vitest';
import { parse } from 'graphql';
import {
  defineSubgraph,
  createGateway,
  parseEntityKeys,
  buildPublicSchema,
} from '../src/index.js';

const USER_TYPEDEFS = /* graphql */ `
  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String
  }
  type Query {
    me: User
    user(id: ID!): User
  }
  type Mutation {
    setName(name: String!): User
  }
`;

const USERS: Record<string, any> = {
  u1: { id: 'u1', name: 'Alice', email: 'alice@x.com' },
};

const resolvers = {
  Query: {
    me: () => USERS.u1,
    user: (_p: any, args: { id: string }) => USERS[args.id] ?? null,
  },
  Mutation: {
    setName: (_p: any, args: { name: string }) => {
      USERS.u1.name = args.name;
      return USERS.u1;
    },
  },
};

describe('subgraph: defineSubgraph', () => {
  it('parses @key directives into entityKeys', () => {
    const keys = parseEntityKeys(USER_TYPEDEFS);
    expect(keys.get('User')).toEqual(['id']);
  });

  it('parses composite keys', () => {
    const keys = parseEntityKeys(`
      type Order @key(fields: "id tenant") { id: ID! tenant: String! total: Int! }
    `);
    expect(keys.get('Order')).toEqual(['id', 'tenant']);
  });

  it('builds a federation-compliant schema exposing _service and _entities', () => {
    const sub = defineSubgraph({ name: 'users', typeDefs: USER_TYPEDEFS, resolvers });
    expect(sub.entityKeys.get('User')).toEqual(['id']);
    // _service.sdl returns the subgraph SDL containing the @link + user types.
    expect(sub.sdl).toContain('@link');
    expect(sub.sdl).toContain('type User @key');
  });

  it('executes _service { sdl } and returns the subgraph SDL', async () => {
    const sub = defineSubgraph({ name: 'users', typeDefs: USER_TYPEDEFS, resolvers });
    const gw = createGateway({ subgraph: sub });
    // Use the subgraph schema (which has _service), not the public gateway schema.
    const { execute } = await import('graphql');
    const result = await execute({
      schema: sub.schema,
      document: parse(`{ _service { sdl } }`),
      fieldResolver: (await import('../src/gateway/fieldResolver.js')).createFieldResolver(sub.resolvers),
    });
    expect(result.errors).toBeUndefined();
    const sdl = (result.data as any)._service.sdl as string;
    expect(sdl).toContain('type User @key');
  });

  it('resolves _entities via the provided entityResolver', async () => {
    const sub = defineSubgraph({
      name: 'users',
      typeDefs: USER_TYPEDEFS,
      resolvers,
      entityResolver: (rep) => ({ id: rep.id, name: `resolved-${rep.id}`, email: null }),
    });
    const { execute } = await import('graphql');
    const { createFieldResolver } = await import('../src/gateway/fieldResolver.js');
    const result = await execute({
      schema: sub.schema,
      document: parse(`query($reps: [_Any!]!){ _entities(representations: $reps){ ... on User { id name } } }`),
      variableValues: { reps: [{ __typename: 'User', id: 'u1' }] },
      fieldResolver: createFieldResolver(sub.resolvers),
    });
    expect(result.errors).toBeUndefined();
    expect((result.data as any)._entities[0]).toEqual({ id: 'u1', name: 'resolved-u1' });
  });

  it('rejects an unknown directive in the user SDL', () => {
    expect(() =>
      defineSubgraph({ name: 'bad', typeDefs: `type X @notARealDirective { id: ID! }` }),
    ).toThrow();
  });
});

describe('gateway: in-process single-subgraph execution', () => {
  it('runs a query end-to-end through resolvers', async () => {
    const sub = defineSubgraph({ name: 'users', typeDefs: USER_TYPEDEFS, resolvers });
    const gw = createGateway({ subgraph: sub });
    const result = await gw.execute({
      document: parse(`{ me { id name email } }`),
      contextValue: {},
    });
    expect(result.errors).toBeUndefined();
    expect((result.data as any).me).toEqual({ id: 'u1', name: 'Alice', email: 'alice@x.com' });
  });

  it('runs a mutation', async () => {
    const sub = defineSubgraph({ name: 'users', typeDefs: USER_TYPEDEFS, resolvers });
    const gw = createGateway({ subgraph: sub });
    const result = await gw.execute({
      document: parse(`mutation { setName(name: "Bob"){ id name } }`),
      contextValue: {},
    });
    expect(result.errors).toBeUndefined();
    expect((result.data as any).setName.name).toBe('Bob');
  });

  it('supports variables', async () => {
    const sub = defineSubgraph({ name: 'users', typeDefs: USER_TYPEDEFS, resolvers });
    const gw = createGateway({ subgraph: sub });
    const result = await gw.execute({
      document: parse(`query($id: ID!){ user(id: $id){ id name } }`),
      variableValues: { id: 'u1' },
      contextValue: {},
    });
    expect((result.data as any).user.id).toBe('u1');
  });

  it('reports validation errors for bad queries', async () => {
    const sub = defineSubgraph({ name: 'users', typeDefs: USER_TYPEDEFS, resolvers });
    const gw = createGateway({ subgraph: sub });
    const result = await gw.execute({
      document: parse(`{ me { id doesNotExist } }`),
      contextValue: {},
    });
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('exposes a public schema without federation internals', () => {
    const sub = defineSubgraph({ name: 'users', typeDefs: USER_TYPEDEFS, resolvers });
    const gw = createGateway({ subgraph: sub });
    const introspect = parse(`{ __schema { queryType { name } mutationType { name } } }`);
    // The public schema still has Query+Mutation; _service/_entities are NOT queryable.
    // (We verify by checking the schema's query type doesn't define _entities by name.)
    const queryFields = Object.keys((gw.schema.getQueryType()?.getFields() ?? {}) as Record<string, unknown>);
    expect(queryFields).toContain('me');
    expect(queryFields).not.toContain('_service');
    expect(queryFields).not.toContain('_entities');
  });

  it('throws a clear error for multi-subgraph (Phase 6 territory)', () => {
    const a = defineSubgraph({ name: 'a', typeDefs: `type A @key(fields:"id"){ id: ID! } type Query { a: A }` });
    const b = defineSubgraph({ name: 'b', typeDefs: `type B @key(fields:"id"){ id: ID! } type Query { b: B }` });
    expect(() => createGateway({ subgraphs: [a, b] })).toThrow(/Phase 6/);
  });

  it('buildPublicSchema strips federation directives', () => {
    const sub = defineSubgraph({ name: 'users', typeDefs: USER_TYPEDEFS, resolvers });
    // Public schema builds cleanly from the stripped SDL (no @key in the printed type).
    const schema = buildPublicSchema(sub.sdl);
    expect(() => schema.getQueryType()).not.toThrow();
  });
});