import type {
  NodeExecRequest,
  NodeExecResult,
  NodeHealth,
  NodeIdentity,
  NodeMetricsSample,
} from './types.js';

export interface ClientOptions {
  /** Timeout for any single agent call (ms). */
  timeoutMs?: number;
}

/**
 * NodeClient — HTTP client a central uses against a node's agent API.
 * All calls are bearer-authenticated with the shared pairing token.
 */
export class NodeClient {
  private base: string;
  private token: string;
  private timeoutMs: number;

  constructor(agentUrl: string, token: string, opts: ClientOptions = {}) {
    this.base = agentUrl.replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) throw new Error(`agent ${res.status} ${path}`);
      return (await res.json()) as T;
    } catch (err) {
      if ((err as Error).name === 'AbortError' || (err as Error).message?.includes('aborted')) {
        throw new Error(`timed out connecting to ${this.base}${path} — is the node agent running?`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  info(): Promise<NodeIdentity> { return this.request('/info'); }
  health(): Promise<NodeHealth> { return this.request('/health'); }

  exec(req: NodeExecRequest): Promise<NodeExecResult> {
    return this.request('/exec', { method: 'POST', body: JSON.stringify(req) });
  }

  metrics(): Promise<NodeMetricsSample> {
    return this.request<NodeMetricsSample>('/metrics');
  }
}