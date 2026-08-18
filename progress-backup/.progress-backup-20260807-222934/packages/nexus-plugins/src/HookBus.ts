/** Cross-plugin event bus + simple service container (DI). */

/** A typed pub/sub bus for inter-plugin events. Subscribers return an unsubscribe fn. */
export class HookBus {
  private readonly subs = new Map<string, Set<(payload: unknown) => void>>();

  publish(topic: string, payload: unknown): void {
    const set = this.subs.get(topic);
    if (set) for (const h of [...set]) h(payload);
  }

  subscribe(topic: string, handler: (payload: unknown) => void): () => void {
    const set = this.subs.get(topic) ?? new Set();
    set.add(handler);
    this.subs.set(topic, set);
    return () => { set.delete(handler); if (set.size === 0) this.subs.delete(topic); };
  }

  /** For tests/inspection. */
  subscriberCount(topic: string): number {
    return this.subs.get(topic)?.size ?? 0;
  }
}

/** A minimal named-service container (inbuilt DI): register/get by name. */
export class ServiceContainer {
  private readonly services = new Map<string, unknown>();
  register<T>(name: string, svc: T): void {
    if (this.services.has(name)) throw new Error(`[nexus-plugins] service already registered: ${name}`);
    this.services.set(name, svc);
  }
  get<T>(name: string): T {
    if (!this.services.has(name)) throw new Error(`[nexus-plugins] service not found: ${name}`);
    return this.services.get(name) as T;
  }
  has(name: string): boolean {
    return this.services.has(name);
  }
  remove(name: string): void {
    this.services.delete(name);
  }
}