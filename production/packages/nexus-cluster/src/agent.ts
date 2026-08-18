import { spawn, execFile, ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NexusServer, Router, bodyParser } from '@bhooai/nexus-core';
import type {
  NodeExecRequest,
  NodeExecResult,
  NodeHealth,
  NodeIdentity,
  NodeMetricsSample,
  NodeRole,
  NodeTier,
} from './types.js';

export interface AgentOptions {
  /** Working directory whose node_modules/cwd resolves the service command. */
  projectRoot: string;
  role: NodeRole;
  tier: NodeTier;
  port: number;
  /** Shared pairing token the central must present (Bearer header). */
  token: string;
  /** Role -> service base URL this node exposes (LB targets). */
  services: Partial<Record<NodeRole, string>>;
  version: string;
  /** Command (executable + args) that launches the role service. */
  serviceCommand: string[];
  /** Extra service env vars (port overrides etc.). */
  serviceEnv?: Record<string, string>;
  /** Public URL central uses to reach back for health/metrics (defaults to the local tcp url). */
  advertisedUrl?: string;
}

const MAX_TAIL = 200;

/**
 * NodeAgent — the control API that lives on every cluster node (default port
 * from `cluster.nodeAgentPort`, 7575). Owns the node's role service as one
 * child process, exposes health/info/metrics/exec to an authenticated central,
 * and enforces a command allowlist. Uses the framework HTTP core so CORS, ids,
 * and error handling behave like the rest of the framework.
 */
export class NodeAgent {
  readonly server: NexusServer;
  private service?: ChildProcess;
  private serviceStatus: 'stopped' | 'running' | 'errored' = 'stopped';
  private logTail: string[] = [];
  private requestCount = 0;
  private nodeId: string;

  constructor(private opts: AgentOptions) {
    this.nodeId = nodeIdFor(opts.projectRoot, opts.role);
    const router = new Router();

    router.get('/health', async (ctx) => {
      const serviceOk = await this.serviceAlive();
      this.serviceStatus = serviceOk ? 'running' : this.serviceStatus;
      const health: NodeHealth = {
        ok: this.opts.services[opts.role] ? serviceOk : true,
        time: new Date().toISOString(),
        services: { [opts.role]: serviceOk },
      };
      ctx.json(health);
    });

    router.get('/info', (ctx) => {
      ctx.json(this.identity());
    });

    router.post('/exec', async (ctx) => {
      const result = await this.exec((ctx.body ?? {}) as NodeExecRequest);
      ctx.json(result, result.ok ? 200 : 400);
    });

    router.get('/metrics', (ctx) => {
      ctx.json(this.metrics());
    });

    this.server = new NexusServer({
      router,
      trustProxy: true,
      middleware: [NodeAgent.auth(opts.token), bodyParser(1024 * 1024)],
      onError: (_err, _ctx) => ({ error: { code: 'agent:error', message: 'node-agent error' } }),
    });
  }

  /** Probe the role service's /health (if a URL is advertised) — true otherwise. */
  private async serviceAlive(): Promise<boolean> {
    const url = this.opts.services[this.opts.role];
    if (!url) return true;
    const target = new URL(url).origin + '/health';
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Bearer-token gate for every agent route; passes through when authorized. */
  static auth(token: string) {
    return async (ctx: import('@bhooai/nexus-core').RequestContext, next: () => Promise<void> | void): Promise<void> => {
      if (token && ctx.req.headers.authorization !== `Bearer ${token}`) {
        ctx.status(401);
        return;
      }
      await next();
    };
  }

  private identity(): NodeIdentity {
    return {
      id: this.nodeId,
      role: this.opts.role,
      tier: this.opts.tier,
      version: this.opts.version,
      baseUrl: this.opts.advertisedUrl ?? `http://localhost:${this.opts.port}`,
      services: this.opts.services,
      capabilities: ['start', 'stop', 'restart', 'logs', 'update', 'metrics'],
      project: this.projectName(),
    };
  }

  /** Read the node's package.json `name` (fallback: project root basename). */
  private projectName(): string {
    try {
      const pkg = JSON.parse(readFileSync(join(this.opts.projectRoot, 'package.json'), 'utf8')) as { name?: string };
      if (pkg?.name) return pkg.name;
    } catch { /* fall through to basename */ }
    return this.opts.projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'node';
  }

  private metrics(): NodeMetricsSample {
    return {
      nodeId: this.nodeId,
      rps: this.requestRate(),
      cpu: 0,
      memoryMb: Math.round((process.memoryUsage().rss / 1024) / 1024),
      sampledAt: Date.now(),
    };
  }

  private requestRate(): number {
    // Requests sampled over process uptime; the central autoscaler averages.
    const uptime = Math.max(1, Math.round(process.uptime()));
    return Math.ceil(this.requestCount / uptime);
  }

  private async exec(req: NodeExecRequest): Promise<NodeExecResult> {
    const cmd = req.command;
    const allowed = new Set(['start', 'stop', 'restart', 'logs', 'update']);
    if (!allowed.has(cmd)) {
      return { ok: false, exitCode: 1, stdout: '', stderr: `command "${cmd}" not allowed`, audit: this.auditLine(cmd) };
    }
    switch (cmd) {
      case 'start': this.startService(); break;
      case 'stop': this.stopService(); break;
      case 'restart': this.restartService(); break;
      case 'update': this.restartService(); break;
      case 'logs': break;
    }
    return { ok: true, exitCode: this.service?.exitCode ?? null, stdout: this.logTail.join('\n'), audit: this.auditLine(cmd) };
  }

  private auditLine(cmd: string): string {
    return `run "${cmd}" by central at ${new Date().toISOString()}`;
  }

  startService(): void {
    if (this.serviceStatus === 'running') return;
    const [cmd, ...args] = this.opts.serviceCommand;
    if (!cmd) { this.serviceStatus = 'errored'; this.pushLog('no service command configured'); return; }
    // Put local + framework node_modules/.bin first on PATH so bins like tsx/vite
    // resolve even when spawned outside an npm script (e.g. inside Docker where
    // PATH is minimal). Windows keeps the original Path if we merely add PATH,
    // so drop all case variants before setting it.
    const origPath = process.env.PATH ?? process.env.Path ?? process.env.path ?? '';
    const binDirs = [
      join(this.opts.projectRoot, 'node_modules', '.bin'),
      join(resolve(this.opts.projectRoot), 'node_modules', '.bin'),
    ];
    const PATH_SEP = process.platform === 'win32' ? ';' : ':';
    const serviceEnv: NodeJS.ProcessEnv = { ...process.env, ...this.opts.serviceEnv };
    for (const k of ['PATH', 'Path', 'path']) delete serviceEnv[k];
    serviceEnv.PATH = [...binDirs, origPath].filter(Boolean).join(PATH_SEP);
    const proc = spawn(cmd, args, {
      cwd: this.opts.projectRoot,
      env: serviceEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    this.service = proc;
    this.serviceStatus = 'running';
    proc.stdout?.on('data', (c: Buffer) => this.pushLog(c.toString()));
    proc.stderr?.on('data', (c: Buffer) => this.pushLog(c.toString()));
    proc.on('exit', (code) => { this.serviceStatus = 'errored'; this.pushLog(`service exited code=${code}`); });
    this.pushLog(`started ${cmd} ${args.join(' ')}`);
  }

  restartService(): void {
    this.stopService();
    setTimeout(() => this.startService(), 300);
  }

  stopService(): void {
    const proc = this.service;
    if (!proc) { this.serviceStatus = 'stopped'; return; }
    this.serviceStatus = 'stopped';
    try {
      if (process.platform === 'win32' && proc.pid) {
        execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else if (proc.pid) {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
      }
    } catch { /* ignore */ }
    this.service = undefined;
  }

  private pushLog(line: string): void {
    this.logTail.push(line);
    if (this.logTail.length > MAX_TAIL) this.logTail.shift();
  }

  /** Listen on the configured port, optionally on a custom bind host. */
  async listen(host?: string): Promise<void> {
    await this.server.listen(this.opts.port, host ?? '0.0.0.0');
  }

  close(): Promise<void> {
    this.stopService();
    return this.server.close();
  }

  get identitySnapshot(): NodeIdentity { return this.identity(); }
  get status(): string { return this.serviceStatus; }
}

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}

/** Canonical stable node id (project-root hash + role). */
export function nodeIdFor(root: string, role: NodeRole): string {
  return `${hashString(resolve(root) + '::' + role)}-${role}`;
}