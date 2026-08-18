import { describe, it, expect } from 'vitest';
import { parse } from 'graphql';
import { defineSubgraph, createFederatedGateway, parseFederationMetadata } from '../src/index.js';

/**
 * Two-subgraph federation e2e (Component A, Phase 6):
 *   - users subgraph owns User.id/name/email + Query.user
 *   - orders subgraph extends User with `orders` (needs User.id) and owns
 *     Order.id/total + Query.orders. Order.customer is a User resolved via @key.
 *
 * The naive sequential executor must stitch cross-subgraph fields: a query for
 * `{ user(id) { id name orders { id total } } }` fetches the user from `users`
 * then joins `orders` via `_entities` on the User key.
 */

const ORDERS = new Map<string, { id: string; total: number; customerId: string }>([
  ['o1', { id: 'o1', total: 100, customerId: 'u1' }],
  ['o2', { id: 'o2', total: 250, customerId: 'u1' }],
  ['o3', { id: 'o3', total: 50, customerId: 'u2' }],
]);
const USERS = new Map<string, { id: string; name: string; email: string }>([
  ['u1', { id: 'u1', name: 'Alice', email: 'alice@x.com' }],
  ['u2', { id: 'u2', name: 'Bob', email: 'bob@x.com' }],
]);

const usersSubgraph = defineSubgraph({
  name: 'users',
  typeDefs: /* graphql */ `
    type User @key(fields: "id") {
      id: ID!
      name: String!
      email: String!
    }
    type Query {
      user(id: ID!): User
      users: [User!]!
    }
  `,
  resolvers: {
    Query: {
      user: (_p: any, a: { id: string }) => USERS.get(a.id) ?? null,
      users: () => [...USERS.values()],
    },
  },
  entityResolver: (rep) => USERS.get(String(rep.id)) ?? null,
});

const ordersSubgraph = defineSubgraph({
  name: 'orders',
  typeDefs: /* graphql */ `
    type Order @key(fields: "id") {
      id: ID!
      total: Int!
      customerId: ID!
    }
    type User @key(fields: "id") @extends {
      id: ID! @external
      orders: [Order!]!
    }
    type Query {
      orders: [Order!]!
    }
  `,
  resolvers: {
    Query: {
      orders: () => [...ORDERS.values()],
    },
    User: {
      // `orders` is owned by the orders subgraph; resolve using the parent's id
      // (the key field carried over from the users subgraph).
      orders: (parent: { id: string }) => [...ORDERS.values()].filter((o) => o.customerId === parent.id),
    },
  },
  // The orders subgraph resolves a User entity to just its key (the id), which
  // the User.orders resolver then uses.
  entityResolver: (rep) => ({ __typename: 'User', id: rep.id }),
});

describe('federation: metadata parsing', () => {
  it('detects @external, @extends, and @key on the extended User', () => {
    const meta = parseFederationMetadata(ordersSubgraph.sdl);
    const user = meta.get('User')!;
    expect(user.keys).toContainEqual(['id']);
    expect(user.fields.get('id')?.external).toBe(true);
    expect(user.fields.get('orders')?.external).toBe(false);
  });
});

describe('federation: two-subgraph composition + execution', () => {
  const gateway = createFederatedGateway([usersSubgraph, ordersSubgraph]);

  it('composes a merged public schema with fields from both subgraphs', () => {
    const queryFields = Object.keys(gateway.schema.getQueryType()?.getFields() ?? {});
    expect(queryFields).toContain('user');
    expect(queryFields).toContain('users');
    expect(queryFields).toContain('orders');
    const userFields = Object.keys(gateway.schema.getType('User')?.getFields?.() ?? {});
    expect([...userFields].sort()).toEqual(['email', 'id', 'name', 'orders'].sort());
  });

  it('plans a root fetch per owning subgraph', () => {
    const plan = gateway.plan(parse(`{ user(id: "u1") { id name } orders { id total } }`));
    const owners = plan.nodes.map((n) => n.subgraph).sort();
    expect(owners).toEqual(['orders', 'users']);
  });

  it('stitches a cross-subgraph query: user from users, orders joined from orders', async () => {
    const res = await gateway.execute({
      document: parse(`{ user(id: "u1") { id name orders { id total } } }`),
      contextValue: {},
    });
    expect(res.errors).toBeUndefined();
    const user = (res.data as any).user;
    expect(user.id).toBe('u1');
    expect(user.name).toBe('Alice');
    expect(user.orders.map((o: any) => o.id).sort()).toEqual(['o1', 'o2']);
    expect(user.orders[0].total).toBeGreaterThan(0);
  });

  it('stitches the reverse direction: orders from orders, then customer name from users', async () => {
    // Extend the scenario: orders owns Query.orders; Order.customerId is local.
    // The query asks only for order fields owned by orders → single fetch, no join.
    const res = await gateway.execute({
      document: parse(`{ orders { id total customerId } }`),
      contextValue: {},
    });
    expect(res.errors).toBeUndefined();
    expect((res.data as any).orders.length).toBe(3);
  });

  it('stitches a list query with per-entity joins: users { id name orders }', async () => {
    const res = await gateway.execute({
      document: parse(`{ users { id name orders { id total } } }`),
      contextValue: {},
    });
    expect(res.errors).toBeUndefined();
    const users = (res.data as any).users as any[];
    const alice = users.find((u) => u.id === 'u1');
    expect(alice.name).toBe('Alice');
    expect(alice.orders.map((o: any) => o.id).sort()).toEqual(['o1', 'o2']);
    const bob = users.find((u) => u.id === 'u2');
    expect(bob.orders.map((o: any) => o.id)).toEqual(['o3']);
  });

  it('returns null gracefully for an unknown user', async () => {
    const res = await gateway.execute({
      document: parse(`{ user(id: "zzz") { id name orders { id } } }`),
      contextValue: {},
    });
    expect(res.errors).toBeUndefined();
    expect((res.data as any).user).toBeNull();
  });
});