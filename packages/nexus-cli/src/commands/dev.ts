import { ServiceSpec, Supervisor } from '../supervisor.js';
import { loadConfigAuto } from '../../../nexus-core/src/index.js';
import { configChangedSinceSync, syncConfig } from '../config-sync.js';
import { isPortFree } from '../util.js';

const COLORS = {
  backend: '\x1b[32m',
  frontend: '\x1b[36m',
  'ai-server': '\x1b[33m',
  admin: '\x1b[35m',
  'node-agent': '\x1b[34m',
};

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** `nexus dev` - start the four terminals under the supervisor. */
export async function dev(args: string[] = []): Promise<number> {  const cfg = await loadConfigAuto({ root: process.cwd() });
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(',') : undefined;
  const cpIdx = args.indexOf('--control-port');
  const controlPort = cpIdx >= 0 && Number.isFinite(Number(args[cpIdx + 1])) ? Number(args[cpIdx + 1]) : 7474;

  // Runtime port auto-allocation: a second project (master + slave) can run on
  // the same machine side-by-side. Any configured port that is already taken is
  // bumped to the next free one and threaded through NEXUS_* env, which both
  // the backend loader and the Vite dev servers honour (config < env).
  const serverPort = await nextFreePort(cfg.server.host, cfg.server.port);
  const frontendPort = await nextFreePort('127.0.0.1', cfg.frontend.port);
  const adminPort = await nextFreePort('127.0.0.1', cfg.admin.port);
  const aiServerPort = await nextFreePort('127.0.0.1', Number(aiPort(cfg.ai.serverUrl)));
  const lbPort = await nextFreePort('127.0.0.1', cfg.cluster.lbPort);
  const agentPort = await nextFreePort('127.0.0.1', cfg.cluster.nodeAgentPort);

  // If the config changed since the last sync, rewrite every derived artifact
  // (Dockerfile, docker.*, serve-all.mjs, admin pkg, project DB) before booting
  // so the whole stack runs on the new values.
  if (!args.includes('--no-sync')) {
    if (configChangedSinceSync(process.cwd(), cfg)) {
      process.stdout.write(`\n  ${BOLD}Config changed - re-syncing derived artifacts...${RESET}\n`);
      const report = await syncConfig(process.cwd(), cfg);
      const changed = report.files.filter((f) => f.status === 'updated').map((f) => f.file);
      process.stdout.write(
        `  ${DIM}updated: ${changed.length > 0 ? changed.join(', ') : 'none'}  |  db: ${report.db}${RESET}\n`,
      );
    }
  }

  // Env override for a port that was bumped away from the configured value.
  // Only set when different, so the configured port is used verbatim otherwise.
  const portEnv = (actual: number, configured: number, key: string): Record<string, string> =>
    actual !== configured ? { [key]: String(actual) } : {};

  const all: ServiceSpec[] = [
    {
      name: 'backend',
      command: ['tsx', 'watch', 'apps/backend/src/main.ts'],
      cwd: '',
      color: COLORS.backend,
      env: {
        ...portEnv(serverPort, cfg.server.port, 'NEXUS_SERVER_PORT'),
        ...portEnv(lbPort, cfg.cluster.lbPort, 'NEXUS_CLUSTER_LBPORT'),
        ...portEnv(agentPort, cfg.cluster.nodeAgentPort, 'NEXUS_CLUSTER_NODEAGENTPORT'),
      },
    },
    {
      name: 'frontend',
      command: ['vite', '--port', String(frontendPort), '--host', cfg.frontend.host],
      cwd: 'apps/frontend',
      color: COLORS.frontend,
      optional: true,
      env: {
        ...portEnv(serverPort, cfg.server.port, 'NEXUS_SERVER_PORT'),
        ...portEnv(frontendPort, cfg.frontend.port, 'NEXUS_FRONTEND_PORT'),
      },
    },
    {
      name: 'ai-server',
      command: ['python', 'main.py'],
      cwd: 'apps/ai-server',
      color: COLORS['ai-server'],
      optional: true,
      env: { AI_PORT: String(aiServerPort) },
    },
    {
      name: 'admin',
      command: ['vite', '--port', String(adminPort), '--host', cfg.admin.host],
      cwd: 'apps/admin',
      color: COLORS.admin,
      optional: true,
      env: {
        ...portEnv(serverPort, cfg.server.port, 'NEXUS_SERVER_PORT'),
        ...portEnv(adminPort, cfg.admin.port, 'NEXUS_ADMIN_PORT'),
      },
    },
  ];

  // Slave/node mode: auto-start a node agent (agent-only — it advertises the dev
  // supervisor's backend as its role service instead of spawning a second one).
  // The master can then link this node via its agent URL right after `npm run dev`.
  // Invoked through `node node_modules/bhooai-nexus/bin/nexus.js` so it resolves
  // even when the `nexus` bin shim isn't linked into the project's .bin.
  if (cfg.cluster.role) {
    all.push({
      name: 'node-agent',
      command: ['node', 'node_modules/bhooai-nexus/bin/nexus.js', 'node', 'serve', `--role=${cfg.cluster.role}`, `--port=${agentPort}`, '--no-service'],
      cwd: '',
      color: COLORS['node-agent'],
      env: {
        ...portEnv(serverPort, cfg.server.port, 'NEXUS_SERVER_PORT'),
        ...portEnv(agentPort, cfg.cluster.nodeAgentPort, 'NEXUS_CLUSTER_NODEAGENTPORT'),
      },
    });
  }

  // Drop services the config disables (unless an explicit --only pins them).
  const enabled = all.filter((s) => {
    if (only) return only.includes(s.name);
    if (s.name === 'frontend') return cfg.frontend.enabled;
    if (s.name === 'admin') return cfg.admin.enabled;
    return true;
  });
  const services = enabled;

  // Startup banner - show host:port for every service about to start.
  process.stdout.write(`\n${BOLD}  *  BhooAI Nexus${RESET} - ${services.map((s) => s.name).join(', ')}\n\n`);
  process.stdout.write(`  ${DIM}Service          Host           Port${RESET}\n`);
  process.stdout.write(`  ${DIM}-----------      ---------      ----${RESET}\n`);

  for (const s of services) {
    let host = '';
    let port = '';
    switch (s.name) {
      case 'backend':
        host = cfg.server.host;
        port = String(serverPort);
        break;
      case 'frontend':
        host = cfg.frontend.host;
        port = String(frontendPort);
        break;
      case 'admin':
        host = cfg.admin.host;
        port = String(adminPort);
        break;
      case 'ai-server':
        host = '0.0.0.0';
        port = String(aiServerPort);
        break;
      case 'node-agent':
        host = cfg.cluster.nodeAgentHost;
        port = String(agentPort);
        break;
    }
    const padName = s.name.padEnd(15);
    const padHost = host.padEnd(16);
    process.stdout.write(`  ${s.color}${padName}${RESET}${padHost}${port}\n`);
  }
  process.stdout.write(`\n`);

  const supervisor = new Supervisor(services, process.cwd(), controlPort);
  await supervisor.start();

  // After services spawn, print quick-start URLs.
  setTimeout(() => {
    process.stdout.write(`\n  ${BOLD}Visit:${RESET}\n`);
    process.stdout.write(`  http://localhost:${frontendPort}  (frontend)\n`);
    process.stdout.write(`  http://localhost:${adminPort}  (admin)\n`);
    process.stdout.write(`  http://localhost:${serverPort}/health  (backend)\n`);
    if (cfg.cluster.role) {
      process.stdout.write(`\n  ${BOLD}Node agent${RESET} — link this from the master:\n`);
      process.stdout.write(`  http://${cfg.cluster.nodeAgentHost}:${agentPort}  (agent)  ·  role: ${cfg.cluster.role}\n`);
    }
    process.stdout.write(`\n`);
  }, 2000);

  // Keep the process alive; supervisor handles SIGINT/SIGTERM.
  return 0;
}

/** First free port at or above `port` on `host` (fails fast, caps at +100). */
async function nextFreePort(host: string, port: number): Promise<number> {
  const base = Number(port);
  if (await isPortFree(host, base)) return base;
  for (let i = 1; i <= 100; i++) {
    if (await isPortFree(host, base + i)) return base + i;
  }
  return base;
}

/** Port parsed from the configured AI server URL (defaults 8000). */
function aiPort(serverUrl: string): string {
  try {
    const port = new URL(serverUrl).port;
    return port || '80';
  } catch {
    return '8000';
  }
}
