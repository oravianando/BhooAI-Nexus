import { Connection, type ConnectOptions } from './Connection.js';

/**
 * Manages multiple named connections (e.g. a primary app DB plus an analytics
 * DB). The default connection is registered under the name `'default'` and is
 * what the top-level `connect()`/`model()` helpers use.
 */
export class ConnectionManager {
  private connections = new Map<string, Connection>();

  connect(name: string, uri: string, options: ConnectOptions = {}): Connection {
    const existing = this.connections.get(name);
    if (existing) return existing;
    const conn = new Connection(uri, options);
    this.connections.set(name, conn);
    return conn;
  }

  get(name = 'default'): Connection {
    const conn = this.connections.get(name);
    if (!conn) throw new Error(`Connection '${name}' is not registered.`);
    return conn;
  }

  has(name: string): boolean {
    return this.connections.has(name);
  }

  /** Close all managed connections. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.values()].map((c) => c.close()));
    this.connections.clear();
  }
}

/** A process-wide connection manager for multi-DB setups. */
export const connectionManager = new ConnectionManager();