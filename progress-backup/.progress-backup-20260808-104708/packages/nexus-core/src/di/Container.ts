/**
 * A minimal inbuilt dependency-injection container.
 *
 * Supports factory-based registration (factories receive the container and any
 * declared dependencies), singletons, and transient resolution. Intentionally
 * small — this is the service backbone used by the framework and plugins.
 */
export type Factory<T> = (container: Container, ...deps: unknown[]) => T | Promise<T>;
export type Lifetime = 'singleton' | 'transient';

interface Registration<T = unknown> {
  factory: Factory<T>;
  lifetime: Lifetime;
  deps: readonly string[];
}

export class Container {
  private registrations = new Map<string, Registration>();
  private singletons = new Map<string, unknown>();
  private resolving = new Set<string>();

  /** Register a service with explicit dependency ids. */
  register<T>(
    id: string,
    factory: Factory<T>,
    options: { lifetime?: Lifetime; deps?: readonly string[] } = {},
  ): this {
    this.registrations.set(id, {
      factory,
      lifetime: options.lifetime ?? 'singleton',
      deps: options.deps ?? [],
    });
    return this;
  }

  /** Register an already-constructed value as a singleton. */
  instance<T>(id: string, value: T): this {
    this.singletons.set(id, value);
    return this;
  }

  has(id: string): boolean {
    return this.registrations.has(id) || this.singletons.has(id);
  }

  /** Resolve a service, throwing if it isn't registered. */
  resolve<T>(id: string): T {
    if (this.singletons.has(id)) return this.singletons.get(id) as T;

    const reg = this.registrations.get(id);
    if (!reg) throw new ResolutionError(id, `Service "${id}" is not registered.`);

    if (this.resolving.has(id)) {
      throw new ResolutionError(id, `Circular dependency detected while resolving "${id}".`);
    }
    this.resolving.add(id);
    try {
      const deps = reg.deps.map((d) => this.resolve(d));
      const value = reg.factory(this, ...deps);
      if (reg.lifetime === 'singleton') this.singletons.set(id, value);
      return value as T;
    } finally {
      this.resolving.delete(id);
    }
  }

  /** Resolve a possibly-async factory. */
  async resolveAsync<T>(id: string): Promise<T> {
    if (this.singletons.has(id)) return this.singletons.get(id) as T;
    const value = this.resolve<unknown>(id);
    const resolved = await Promise.resolve(value as T | Promise<T>);
    if (this.registrations.get(id)?.lifetime === 'singleton') {
      this.singletons.set(id, resolved);
    }
    return resolved as T;
  }

  child(): Container {
    // A child container inherits registrations/values but can override locally.
    const child = new Container();
    for (const [id, value] of this.singletons) child.singletons.set(id, value);
    for (const [id, reg] of this.registrations) child.registrations.set(id, reg);
    return child;
  }

  clear(): void {
    this.registrations.clear();
    this.singletons.clear();
    this.resolving.clear();
  }
}

export class ResolutionError extends Error {
  constructor(public readonly serviceId: string, message: string) {
    super(message);
    this.name = 'ResolutionError';
  }
}
