import { createClient, type RedisClientType } from 'redis';
import type { Cache } from './Cache.js';

type Handler = (msg: unknown) => void;

/**
 * Redis pub/sub helper. Uses the {@link Cache} client for publishing and a
 * separate, dedicated subscriber client (required by `redis` v4) for
 * subscriptions. Both clients are connected lazily.
 */
export class PubSub {
  private subscriber: RedisClientType;
  private subscriberConnectPromise: Promise<void> | null = null;
  private handlers = new Map<string, Set<Handler>>();

  constructor(private cache: Cache) {
    // Reuse the same URL/connection options as the cache's publisher client.
    // The cache exposes its url/connectTimeout via protected fields; here we
    // reconstruct from the cache's key prefix-agnostic config by reading the
    // same options the cache used. We mirror the cache's createClient call.
    const url = (cache as unknown as { url?: string }).url;
    const connectTimeout = (cache as unknown as { connectTimeout?: number }).connectTimeout;
    this.subscriber = createClient({
      ...(url ? { url } : {}),
      ...(connectTimeout != null ? { socket: { connectTimeout } } : {}),
    });
  }

  private async ensureSubscriberConnected(): Promise<void> {
    if (this.subscriber.isOpen) return;
    if (!this.subscriberConnectPromise) {
      this.subscriberConnectPromise = this.subscriber.connect().then(() => undefined);
    }
    try {
      await this.subscriberConnectPromise;
    } catch (err) {
      this.subscriberConnectPromise = null;
      throw err;
    }
  }

  /** Publish a JSON-encoded message to `channel`. */
  async publish(channel: string, message: unknown): Promise<void> {
    // Ensure the cache (publisher) client is connected.
    await this.cache.ensureConnected();
    const publisher = (this.cache as unknown as { getClient: () => RedisClientType }).getClient();
    await publisher.publish(channel, JSON.stringify(message));
  }

  /**
   * Subscribe to `channel`; `handler` is invoked with the JSON-parsed payload.
   * Returns an unsubscribe function that removes the handler and, when no
   * handlers remain for the channel, unsubscribes from Redis.
   */
  async subscribe(channel: string, handler: Handler): Promise<() => Promise<void>> {
    await this.ensureSubscriberConnected();
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      // `redis` v4 subscribe(channel, callback) registers a per-channel
      // listener that receives the message string.
      await this.subscriber.subscribe(channel, (message) => {
        const handlers = this.handlers.get(channel);
        if (!handlers) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(message);
        } catch {
          parsed = message;
        }
        for (const h of handlers) h(parsed);
      });
    }
    set.add(handler);
    return async () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        try {
          await this.subscriber.unsubscribe(channel);
        } catch {
          /* ignore — client may be closing */
        }
      }
    };
  }

  /** Close the dedicated subscriber client. */
  async close(): Promise<void> {
    if (this.subscriber.isOpen) {
      await this.subscriber.quit();
    }
    this.subscriberConnectPromise = null;
  }
}