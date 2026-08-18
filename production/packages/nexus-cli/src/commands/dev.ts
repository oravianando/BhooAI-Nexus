import { ServiceSpec, Supervisor } from '../supervisor.js';
import { loadConfigAuto } from '../../../nexus-core/src/index.js';
import { configChangedSinceSync, syncConfig } from '../config-sync.js';

const COLORS = {
  backend: '\x1b[32m',
  frontend: '\x1b[36m',
  'ai-server': '\x1b[33m',
  admin: '\x1b[35m',
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

  // If nexus.config.* changed since the last sync, rewrite every derived
  // artifact (Dockerfile, docker.*, serve-all.mjs, admin pkg, project DB)
  // before booting so the whole stack runs on the new values.
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

  const all: ServiceSpec[] = [
    {
      name: 'backend',
      command: ['tsx', 'watch', 'apps/backend/src/main.ts'],
      cwd: '',
      color: COLORS.backend,
    },
    {
      name: 'frontend',
      command: ['vite', '--port', String(cfg.frontend.port), '--host', cfg.frontend.host],
      cwd: 'apps/frontend',
      color: COLORS.frontend,
      optional: true,
    },
    {
      name: 'ai-server',
      command: ['python', 'main.py'],
      cwd: 'apps/ai-server',
      color: COLORS['ai-server'],
      optional: true,
      env: { AI_PORT: aiPort(cfg.ai.serverUrl) },
    },
    {
      name: 'admin',
      command: ['vite', '--port', String(cfg.admin.port), '--host', cfg.admin.host],
      cwd: 'apps/admin',
      color: COLORS.admin,
      optional: true,
    },
  ];

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
        port = String(cfg.server.port);
        break;
      case 'frontend':
        host = cfg.frontend.host;
        port = String(cfg.frontend.port);
        break;
      case 'admin':
        host = cfg.admin.host;
        port = String(cfg.admin.port);
        break;
      case 'ai-server':
        host = '0.0.0.0';
        port = aiPort(cfg.ai.serverUrl);
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
    process.stdout.write(`  http://localhost:${cfg.frontend.port}  (frontend)\n`);
    process.stdout.write(`  http://localhost:${cfg.admin.port}  (admin)\n`);
    process.stdout.write(`  http://localhost:${cfg.server.port}/health  (backend)\n`);
    process.stdout.write(`\n`);
  }, 2000);

  // Keep the process alive; supervisor handles SIGINT/SIGTERM.
  return 0;
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
