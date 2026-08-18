import { createServer, request as httpRequest, IncomingMessage, ServerResponse } from 'node:http';
import type { NodeRegistry } from './registry.js';

export interface LoadBalancerOptions {
  registry: NodeRegistry;
  port?: number;
  host?: string;
}

/**
 * LoadBalancer — the central's reverse proxy on `cluster.lbPort` (default 8080).
 * Round-robins incoming HTTP across every *ready backend node* in the registry
 * (role === 'backend'), streaming the raw request/response (SSE, uploads, and
 * regular JSON all pass through untouched). Emits `x-bhooai-node` so you can
 * see which node served each request.
 */
export class LoadBalancer {
  private rr = 0;
  server: ReturnType<typeof createServer>;
  /** In-flight per-node request counter (the autoscaler's RPS source). */
  private counters = new Map<string, number>();
  private histogram: Array<{ nodeId: string; at: number }> = [];

  constructor(private opts: LoadBalancerOptions) {
    this.server = createServer((req, res) => void this.handle(req, res).catch(() => {
      if (!res.writableEnded) { res.statusCode = 502; res.end('bad gateway'); }
    }));
  }

  private targets(): Array<{ id: string; baseUrl: string }> {
    return this.opts.registry.readyByRole('backend').map((n) => ({
      id: n.identity.id,
      baseUrl: n.identity.services.backend || n.identity.baseUrl,
    }));
  }

  private nextTarget(): { id: string; baseUrl: string } {
    const targets = this.targets();
    if (targets.length === 0) return { id: '', baseUrl: '' };
    const target = targets[this.rr % targets.length]!;
    this.rr = (this.rr + 1) % targets.length;
    return target;
  }

  private record(id: string): void {
    const now = Date.now();
    this.counters.set(id, (this.counters.get(id) ?? 0) + 1);
    this.histogram.push({ nodeId: id, at: now });
    // keep only the last 10s of samples (autoscaler RPS window)
    const cutoff = now - 10_000;
    while (this.histogram.length && this.histogram[0]!.at < cutoff) this.histogram.shift();
  }

  /** Requests-per-second per node over the last 10s. */
  rpsSnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const { nodeId } of this.histogram) out[nodeId] = (out[nodeId] ?? 0) + 1;
    for (const id of this.counters.keys()) if (!(id in out)) out[id] = 0;
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round((v / 10) * 10) / 10]));
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization, x-request-id');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

    const { id, baseUrl } = this.nextTarget();
    if (!baseUrl) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'no_backend_nodes', message: 'no healthy backend node registered' } }));
      return;
    }

    const url = new URL(req.url ?? '/', baseUrl);
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    delete headers.host;
    const xff = header(req.headers, 'x-forwarded-for');
    headers['x-forwarded-for'] = xff ? `${xff}, ${req.socket.remoteAddress ?? ''}` : req.socket.remoteAddress ?? '';
    headers['x-forwarded-proto'] = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
    headers['x-forwarded-host'] = req.headers.host;

    const outReq = httpRequest({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      protocol: url.protocol,
      path: url.pathname + url.search,
      method: req.method ?? 'GET',
      headers,
    }, (upRes) => {
      if (res.writableEnded) { upRes.resume(); return; }
      res.statusCode = upRes.statusCode ?? 502;
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (k === 'set-cookie') continue; // js cookie headers are handled below
        if (v !== undefined) res.setHeader(k as string, v as string | string[]);
      }
      res.setHeader('x-bhooai-node', id);
      upRes.pipe(res);
    });
    outReq.on('error', () => {
      if (res.writableEnded) return;
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'node_unreachable', message: `backend node ${id} is unreachable` } }));
    });
    this.record(id);
    req.pipe(outReq);
  }

  /** Snapshot of the raw aggregated request counters (per backend node). */
  countersSnapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  async listen(port: number, host = '0.0.0.0'): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(port, host, () => resolve()));
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function header(headers: IncomingMessage['headers'], key: string): string | undefined {
  const v = headers[key];
  return Array.isArray(v) ? v[0] : v;
}