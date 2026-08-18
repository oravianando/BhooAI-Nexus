import type { EmailInput, QueueBackend } from './types.js';

/**
 * In-memory queue backend: push appends to an array; the consumer drains it on a
 * poll interval. Sufficient for single-instance apps and tests; RedisQueue is the
 * horizontal-scale option (below). The queue never blocks the sender.
 */
export class MemoryQueue implements QueueBackend {
  private readonly jobs: EmailInput[] = [];
  private readonly consumers = new Set<(job: EmailInput) => Promise<void>>();
  private readonly interval: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(pollMs = 50) {
    this.interval = setInterval(() => void this.drain(), pollMs);
  }

  async push(job: EmailInput): Promise<void> {
    if (this.closed) throw new Error('[nexus-email] queue closed');
    this.jobs.push(job);
  }

  subscribe(consumer: (job: EmailInput) => Promise<void>): void {
    this.consumers.add(consumer);
  }

  private async drain(): Promise<void> {
    while (this.jobs.length > 0 && this.consumers.size > 0) {
      const job = this.jobs.shift();
      if (!job) break;
      for (const c of this.consumers) {
        await c(job);
      }
    }
  }

  get pending(): number {
    return this.jobs.length;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.interval);
  }
}

/**
 * Redis-backed queue using LPUSH (producer) + RPOP (consumer poll). Uses a
 * dedicated redis client (the `redis` package). Jobs are JSON-serialized
 * EmailInputs. Gracefully degrades to no-op if a client can't connect — callers
 * that need guaranteed delivery should check connectivity at boot.
 */
export class RedisQueue implements QueueBackend {
  private readonly key: string;
  private client: any;
  private connected = false;
  private readonly consumers = new Set<(job: EmailInput) => Promise<void>>();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly createClient: () => any,
    key = 'nexus:email:queue',
    pollMs = 100,
  ) {
    this.key = key;
    this.interval = setInterval(() => void this.drain(), pollMs);
  }

  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.client = this.createClient();
    await this.client.connect();
    this.connected = true;
  }

  async push(job: EmailInput): Promise<void> {
    await this.ensureConnected();
    await this.client.lPush(this.key, JSON.stringify(job));
  }

  subscribe(consumer: (job: EmailInput) => Promise<void>): void {
    this.consumers.add(consumer);
  }

  private async drain(): Promise<void> {
    if (!this.connected || this.consumers.size === 0) return;
    try {
      while (true) {
        const raw = (await this.client.rPop(this.key)) as string | null;
        if (!raw) break;
        const job = JSON.parse(raw) as EmailInput;
        for (const c of this.consumers) await c(job);
      }
    } catch {
      // transient redis errors shouldn't kill the poller
    }
  }

  async close(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    if (this.connected) await this.client?.quit();
  }
}