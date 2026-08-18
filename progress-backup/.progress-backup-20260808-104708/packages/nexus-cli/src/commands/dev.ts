import { ServiceSpec, Supervisor } from '../supervisor.js';
import { loadConfigAuto } from '../../../nexus-core/src/index.js';

const COLORS = {
  backend: '\x1b[32m',
  frontend: '\x1b[36m',
  'ai-server': '\x1b[33m',
  admin: '\x1b[35m',
};

/** `nexus dev` — start the four terminals under the supervisor. */
export async function dev(args: string[] = []): Promise<number> {
  const cfg = await loadConfigAuto({ root: process.cwd() });
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(',') : undefined;
  const cpIdx = args.indexOf('--control-port');
  const controlPort = cpIdx >= 0 && Number.isFinite(Number(args[cpIdx + 1])) ? Number(args[cpIdx + 1]) : 7474;

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
    },
    {
      name: 'admin',
      command: ['vite', '--port', String(cfg.admin.port), '--host', cfg.admin.host],
      cwd: 'admin',
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
  process.stdout.write(`\x1b[1mBhooAI Nexus dev\x1b[0m — ${services.map((s) => s.name).join(', ')}\n`);

  const supervisor = new Supervisor(services, process.cwd(), controlPort);
  await supervisor.start();

  // Keep the process alive; supervisor handles SIGINT/SIGTERM.
  return 0;
}
