import type { PubSubAdapter } from './PubSubAdapter.js';

/**
 * Minimal Redis client interface this adapter depends on (compatible with
 * `node-redis` i.e. `createClient()`). Kept structural so the realtime package
 * does not hard-depend on a redis client at import time — `nexus-cache`
 * (Phase 7) supplies a configured client.
 */
export interface RedisLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<number>;
  unsubscribe(...channels: string[]): Promise<number>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  off(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

/**
 * Redis-backed pub/sub adapter for multi-instance room broadcast. Uses one
 * configured Redis client in subscribe mode; messages are JSON strings.
 */
export class RedisPubSubAdapter implements PubSubAdapter {
  private handlers = new Map<string, Set<(message: Buffer | string) => void>>();

  constructor(private client: RedisLike) {
    // Route incoming Redis messages to registered handlers.
    const route = (channel: string, message: string) => {
      const set = this.handlers.get(channel);
      if (set) for (const h of set) h(message);
    };
    this.route = route;
    client.on('message', route);
  }

  private route: (channel: string, message: string) => void;

  publish(channel: string, message: Buffer | string): void {
    void this.client.publish(channel, typeof message === 'string' ? message : message.toString('utf8'));
  }

  async subscribe(channel: string, handler: (message: Buffer | string) => void): Promise<void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.client.subscribe(channel);
    }
    set.add(handler);
  }

  async unsubscribe(channel: string, handler: (message: Buffer | string) => void): Promise<void> {
    const set = this.handlers.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(channel);
      await this.client.unsubscribe(channel);
    }
  }
}