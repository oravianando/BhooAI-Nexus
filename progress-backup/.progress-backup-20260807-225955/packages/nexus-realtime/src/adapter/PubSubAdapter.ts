import { EventEmitter } from 'node:events';

/**
 * Pub/sub adapter for cross-instance room broadcast fanout. The default
 * `MemoryPubSubAdapter` is a single-process EventEmitter-backed implementation
 * (fine for tests and single-node deployments). A Redis-backed adapter is used
 * for horizontal scaling — see `RedisPubSubAdapter`.
 *
 * Broadcast model: `RealtimeServer` publishes a room event; every instance's
 * subscriber (including the originator) delivers it to its local members. This
 * gives exactly-once delivery per instance without the originator also sending
 * locally.
 */
export interface PubSubAdapter {
  /** Publish a message to a channel (room). Returns void (fire-and-forget). */
  publish(channel: string, message: Buffer | string): void;
  /** Subscribe to a channel; the handler is called for each published message. */
  subscribe(channel: string, handler: (message: Buffer | string) => void): Promise<void> | void;
  /** Unsubscribe a handler from a channel. */
  unsubscribe(channel: string, handler: (message: Buffer | string) => void): Promise<void> | void;
}

export class MemoryPubSubAdapter implements PubSubAdapter {
  private bus = new EventEmitter();

  constructor() {
    // Many subscribers per channel; allow headroom for fanout.
    this.bus.setMaxListeners(0);
  }

  publish(channel: string, message: Buffer | string): void {
    this.bus.emit(channel, message);
  }

  subscribe(channel: string, handler: (message: Buffer | string) => void): void {
    this.bus.on(channel, handler);
  }

  unsubscribe(channel: string, handler: (message: Buffer | string) => void): void {
    this.bus.off(channel, handler);
  }
}