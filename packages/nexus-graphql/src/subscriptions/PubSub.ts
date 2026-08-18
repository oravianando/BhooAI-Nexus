import { EventEmitter } from 'node:events';

/**
 * Minimal in-process PubSub for GraphQL subscriptions. Sufficient for the
 * single-instance default app; a Redis-backed pub/sub adapter can be plugged in
 * later for cross-instance fanout (mirrors the realtime adapter pattern).
 *
 * Usage in a subscription resolver:
 *   Subscription: {
 *     messageAdded: {
 *       subscribe: () => pubsub.asyncIterator('MESSAGE_ADDED'),
 *       resolve: (payload) => payload,
 *     }
 *   }
 */
export class PubSub {
  private ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(0);
  }

  /** Publish a payload to a topic. */
  publish(topic: string, payload: unknown): void {
    this.ee.emit(topic, payload);
  }

  /** Return an AsyncIterable that yields payloads published to the topic(s). */
  asyncIterator(topics: string | string[]): AsyncIterable<any> {
    const list = Array.isArray(topics) ? topics : [topics];
    const ee = this.ee;
    const queue: any[] = [];
    let pull: ((v: IteratorResult<any>) => void) | undefined;

    for (const t of list) {
      const push = (payload: any) => {
        if (pull) {
          const resolve = pull;
          pull = undefined;
          resolve({ value: payload, done: false });
        } else {
          queue.push(payload);
        }
      };
      ee.on(t, push);
    }

    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<any>> {
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            return new Promise((resolve) => { pull = resolve; });
          },
          return(): Promise<IteratorResult<any>> {
            // Unsubscribe listeners on early completion (client disconnect).
            for (const t of list) ee.removeAllListeners(t);
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }
}