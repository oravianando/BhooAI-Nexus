import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, getConnection } from '@bhooai/nexus-data';
import { MongoClient } from 'mongodb';
import { createGateway, PubSub, type GraphQLContext } from '@bhooai/nexus-graphql';
import { parse } from 'graphql';
import { buildUsersSubgraph } from '../src/modules/users/userGraph.js';
import { getUserModel, initUserModel } from '../src/modules/users/userModel.js';

const URI = (process.env.NEXUS_DB_URI ?? 'mongodb://localhost:27017/nexus').replace(/\/[^/?]*$/, '/nexus_backend_sub_test');
const TEST_DB = new URL(URI.replace(/^mongodb:/, 'http:')).pathname.slice(1);

let gateway: ReturnType<typeof createGateway>;
let pubsub: PubSub;

beforeAll(async () => {
  const mongo = new MongoClient(URI);
  await mongo.connect();
  await mongo.db(TEST_DB).dropDatabase();
  await mongo.close();
  await connect(URI, { autoIndex: false });
  await getConnection().db;
  initUserModel();
  await getUserModel().createIndexes();
  gateway = createGateway({ subgraph: buildUsersSubgraph() });
  pubsub = new PubSub();
});

afterAll(async () => {
  await getUserModel().deleteMany({});
  await getConnection().close();
});

describe('GraphQL userCount subscription (in-process, PubSub)', () => {
  it('yields the live user count when USER_COUNT is published', async () => {
    const ctx: GraphQLContext = { pubsub };
    const stream = await gateway.subscribe({
      document: parse(`subscription { userCount }`),
      contextValue: ctx,
    });

    // The async iterator yields ExecutionResult per published event.
    const iter = (stream as AsyncIterable<{ data?: { userCount: number } }>)[Symbol.asyncIterator]();
    // Publish after a tick so the iterator is parked on next().
    setTimeout(() => {
      void getUserModel().create({ email: 'sub@x.com', passwordHash: 'x', roles: ['user'] })
        .then(() => pubsub.publish('USER_COUNT', 1));
    }, 20);

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.data?.userCount).toBe(1);

    // Second event: add another user.
    setTimeout(() => {
      void getUserModel().create({ email: 'sub2@x.com', passwordHash: 'x', roles: ['user'] })
        .then(() => pubsub.publish('USER_COUNT', 2));
    }, 20);
    const second = await iter.next();
    expect(second.value?.data?.userCount).toBe(2);

    await iter.return?.();
  });

  it('returns an async iterable (subscription, not a single ExecutionResult)', async () => {
    const ctx: GraphQLContext = { pubsub };
    const stream = await gateway.subscribe({ document: parse(`subscription { userCount }`), contextValue: ctx });
    expect(typeof (stream as any)[Symbol.asyncIterator]).toBe('function');
    await (stream as any)[Symbol.asyncIterator]().return?.();
  });
});