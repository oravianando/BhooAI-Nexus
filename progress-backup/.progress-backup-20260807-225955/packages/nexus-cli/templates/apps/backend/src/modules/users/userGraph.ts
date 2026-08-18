import { defineSubgraph, type Resolvers, type GraphQLContext, type EntityRepresentation } from '@bhooai/nexus-graphql';
import { getUserModel } from './userModel.js';

/**
 * Users subgraph (single-subgraph Phase 5). Exposes User as a federation
 * entity (`@key(fields: "id")`) plus `me`/`user`/`users` queries. Resolvers
 * use the User ODM model. `me` requires an authenticated context (`ctx.user.sub`).
 */
const typeDefs = /* graphql */ `
  type User @key(fields: "id") {
    id: ID!
    email: String!
    name: String
    roles: [String!]!
    emailVerified: Boolean!
    createdAt: String
    updatedAt: String
  }

  type Query {
    me: User
    user(id: ID!): User
    users(limit: Int = 50): [User!]!
  }

  type Subscription {
    userCount: Int!
  }
`;

function toGraphUser(doc: any): Record<string, unknown> | null {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(obj._id ?? obj.id),
    email: obj.email,
    name: obj.name ?? null,
    roles: obj.roles ?? [],
    emailVerified: obj.emailVerified ?? false,
    createdAt: obj.createdAt ? new Date(obj.createdAt).toISOString() : null,
    updatedAt: obj.updatedAt ? new Date(obj.updatedAt).toISOString() : null,
  };
}

export function buildUsersSubgraph() {
  const resolvers: Resolvers = {
    Query: {
      me: async (_parent, _args, ctx: GraphQLContext) => {
        if (!ctx.user?.sub) return null;
        const User = getUserModel();
        const doc = await User.findById(ctx.user.sub).lean();
        return toGraphUser(doc);
      },
      user: async (_parent, args: { id: string }) => {
        const User = getUserModel();
        return toGraphUser(await User.findById(args.id).lean());
      },
      users: async (_parent, args: { limit: number }) => {
        const User = getUserModel();
        const docs = await User.find().limit(args.limit ?? 50).lean();
        return docs.map(toGraphUser);
      },
    },
    Subscription: {
      // The payload is the new count; the host publishes 'USER_COUNT' after a
      // user is created. ctx.pubsub is injected by main.ts (HTTP + WS contexts).
      userCount: {
        subscribe: (_parent, _args, ctx: GraphQLContext) => (ctx.pubsub as any).asyncIterator('USER_COUNT'),
        resolve: async () => {
          const User = getUserModel();
          return await User.countDocuments();
        },
      },
    },
  };

  const entityResolver = async (rep: EntityRepresentation) => {
    const User = getUserModel();
    return toGraphUser(await User.findById(String(rep.id)).lean());
  };

  return defineSubgraph({ name: 'users', typeDefs, resolvers, entityResolver });
}
