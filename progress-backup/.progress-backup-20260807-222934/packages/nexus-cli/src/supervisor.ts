import { spawn, execFile, ChildProcess } from 'node:child_process';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { EOL } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The framework workspace root (the dir containing `packages/`, `apps/`, `bin/`), resolved
 * from this file so it's correct whether run from `src/` (tsx) or `dist/` (compiled), and
 * independent of the launcher's cwd. Used to put the framework's `node_modules/.bin` on the
 * child PATH so `tsx`/`vite` resolve even when the supervisor is launched directly via
 * `node bin/nexus.js dev` (where npm hasn't prepended `.bin` to PATH).
 */
const FRAMEWORK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PATH_SEP = process.platform === 'win32' ? ';' : ':';

export interface ServiceSpec {
  name: string;
  /** Command + args to run. */
  command: string[];
  /** Working directory relative to project root. */
  cwd: string;
  /** ANSI color for log prefix. */
  color: string;
  /** When true, a start failure is logged but does not stop the supervisor. */
  optional?: boolean;
  env?: Record<string, string>;
}

export interface ServiceState {
  name: string;
  status: 'stopped' | 'running' | 'errored';
  pid?: number;
  startedAt?: number;
  lastExitCode?: number | null;
  logTail: string[];
}

const MAX_TAIL = 200;

/**
 * Inbuilt process supervisor for the four Nexus terminals.
 * Owns child processes, streams prefixed colored logs, handles graceful shutdown,
 * and exposes a localhost HTTP control API for the admin app.
 */
export class Supervisor {
  private procs = new Map<string, ChildProcess>();
  private states = new Map<string, ServiceState>();
  private controlServer?: ReturnType<typeof createServer>;
  private shuttingDown = false;

  constructor(
    private services: ServiceSpec[],
    private root: string,
    private controlPort = 7474,
  ) {
    for (const s of services) {
      this.states.set(s.name, { name: s.name, status: 'stopped', logTail: [] });
    }
  }

  startService(spec: ServiceSpec): void {
    const state = this.states.get(spec.name)!;
    if (state.status === 'running') return;
    const [cmd, ...args] = spec.command;
    if (!cmd) {
      state.status = 'errored';
      this.pushLog(spec.name, `no command specified for ${spec.name}`);
      return;
    }
    const cwdAbs = resolve(this.root, spec.cwd);
    // Put local + framework `node_modules/.bin` first on PATH so bins like `tsx`/`vite`
    // resolve even when the supervisor is launched directly (not via `npm run dev`).
    // Windows keeps the original `Path` if we merely add `PATH`, so drop all case variants
    // before setting it.
    const origPath = process.env.PATH ?? process.env.Path ?? process.env.path ?? '';
    const binDirs = [
      join(cwdAbs, 'node_modules', '.bin'),
      join(this.root, 'node_modules', '.bin'),
      join(FRAMEWORK_ROOT, 'node_modules', '.bin'),
    ];
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...spec.env };
    for (const k of ['PATH', 'Path', 'path']) delete childEnv[k];
    childEnv.PATH = [...binDirs, origPath].filter(Boolean).join(PATH_SEP);

    const proc = spawn(cmd, args, {
      cwd: cwdAbs,
      env: childEnv,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.procs.set(spec.name, proc);
    state.status = 'running';
    state.pid = proc.pid;
    state.startedAt = Date.now();

    const prefix = `${spec.color}[${spec.name}]${EOL}${'\x1b[0m'}`;
    const onChunk = (stream: NodeJS.ReadableStream, isErr: boolean) => {
      let buf = '';
      stream.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        // Split on CRLF or LF. Children mix line endings on Windows: our own
        // Logger writes os.EOL (\r\n), but Vite/uvicorn/third-party CLIs write
        // LF only. Splitting on os.EOL alone left LF-terminated output stuck in
        // `buf` forever (Vite's whole startup banner never appeared). Re-emit
        // with the platform EOL so the host terminal gets clean line breaks.
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const target = isErr ? process.stderr : process.stdout;
          target.write(`${spec.color}[${spec.name}]\x1b[0m ${line}${EOL}`);
          this.pushLog(spec.name, line);
        }
      });
    };
    onChunk(proc.stdout!, false);
    onChunk(proc.stderr!, true);

    proc.on('exit', (code, signal) => {
      // An intentional stop sets status to 'stopped' first, so don't flip a
      // stopped service to 'errored' when its process tree finally exits.
      state.status = this.shuttingDown || state.status === 'stopped' ? 'stopped' : 'errored';
      state.lastExitCode = code;
      state.pid = undefined;
      this.pushLog(spec.name, `exited code=${code} signal=${signal}`);
      if (!this.shuttingDown && !spec.optional) {
        this.pushLog(spec.name, `required service stopped — supervisor continuing (run 'nexus dev restart ${spec.name}')`);
      }
    });
    proc.on('error', (err) => {
      state.status = 'errored';
      this.pushLog(spec.name, `failed to start: ${err.message}`);
    });
  }

  private pushLog(name: string, line: string): void {
    const state = this.states.get(name);
    if (!state) return;
    state.logTail.push(line);
    if (state.logTail.length > MAX_TAIL) state.logTail.shift();
  }

  stopService(name: string): void {
    const proc = this.procs.get(name);
    if (!proc) return;
    const state = this.states.get(name)!;
    state.status = 'stopped';
    // Windows: services spawn with `shell: true`, so `proc` IS cmd.exe and
    // `proc.kill()` only terminates that one wrapper — the tsx/vite/python
    // process tree below it survives as an orphan and the port stays bound.
    // `taskkill /T /F` kills the whole tree. POSIX: signal the process group.
    try {
      if (process.platform === 'win32' && proc.pid) {
        execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else if (proc.pid) {
        try {
          process.kill(-proc.pid, 'SIGTERM');
        } catch {
          proc.kill('SIGTERM');
        }
      }
    } catch {
      /* ignore */
    }
    this.procs.delete(name);
  }

  restartService(name: string): void {
    const spec = this.services.find((s) => s.name === name);
    if (!spec) return;
    this.stopService(name);
    setTimeout(() => this.startService(spec), 300);
  }

  status(): ServiceState[] {
    return this.services.map((s) => ({ ...this.states.get(s.name)! }));
  }

  /** Start all services and the control API. Resolves when started. */
  async start(): Promise<void> {
    for (const s of this.services) this.startService(s);
    this.startControlServer();
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  private startControlServer(): void {
    this.controlServer = createServer((req, res) => this.handleControl(req, res));
    this.controlServer.listen(this.controlPort, '127.0.0.1', () => {
      process.stdout.write(`\x1b[36m[supervisor]\x1b[0m control API on http://127.0.0.1:${this.controlPort}${EOL}`);
    });
  }

  private handleControl(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.controlPort}`);
    // Permissive CORS so the browser-based admin (localhost:5174) can call us.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && url.pathname === '/status') {
      res.end(JSON.stringify({ services: this.status() }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/start') {
      const name = url.searchParams.get('name');
      const spec = this.services.find((s) => s.name === name);
      if (spec && name) this.startService(spec);
      res.end(JSON.stringify({ ok: !!spec }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/restart') {
      const name = url.searchParams.get('name');
      if (name) this.restartService(name);
      res.end(JSON.stringify({ ok: !!name }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/stop') {
      const name = url.searchParams.get('name');
      if (name) this.stopService(name);
      res.end(JSON.stringify({ ok: !!name }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/logs') {
      const name = url.searchParams.get('name');
      const state = name ? this.states.get(name) : undefined;
      res.end(JSON.stringify({ logs: state?.logTail ?? [] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    process.stdout.write(`\x1b[36m[supervisor]\x1b[0m shutting down...${EOL}`);
    for (const name of this.procs.keys()) this.stopService(name);
    this.controlServer?.close();
    // Give processes a moment to exit.
    await new Promise((r) => setTimeout(r, 200));
    process.exit(0);
  }
}