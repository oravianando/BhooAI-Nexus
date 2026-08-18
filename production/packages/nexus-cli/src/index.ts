import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { dev } from './commands/dev.js';
import { pysetup } from './commands/pysetup.js';
import { cluster } from './commands/cluster.js';
import { node } from './commands/node.js';
import { syncCommand } from './commands/sync.js';
import { uninstall } from './commands/uninstall.js';
import { loadDotEnv } from './dotenv.js';

/** Dispatch a CLI command. Returns the exit code. */
export async function run(cmd: string, args: string[]): Promise<number> {
  // Load the project .env once so NEXUS_* keys reach the config loader AND the
  // supervised child processes (they inherit process.env).
  loadDotEnv(process.cwd());

  switch (cmd) {
    case 'doctor':
      return doctor();
    case 'init':
      return init({}, args);
    case 'dev':
      return dev(args);
    case 'build':
      console.log('nexus build - implemented in a later phase (tsc across workspaces).');
      return 0;
    case 'test':
      console.log('nexus test - run `npm test` (vitest + pytest) for now.');
      return 0;
    case 'plugin':
      console.log('nexus plugin <new|install> - implemented in Phase 8.');
      return 0;
    case 'add':
      console.log('nexus add <subgraph|module> - implemented in Phase 5/6.');
      return 0;
    case 'pysetup':
      return pysetup(args);
    case 'uninstall':
      return uninstall(args);
    case 'cluster':
      return cluster(args);
    case 'node':
      return node(args);
    case 'sync':
      return syncCommand(args);
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  console.log(`
BhooAI Nexus CLI

Usage: nexus <command> [args]

Commands:
  init [target] [--as=root|node] [--role=R] [--name=N] [--mongo-uri=URI]
       [--redis-url=URL] [--ai-providers=a,b] [--ai-key id=val]
       [--cluster-token=T] [--venv|--no-venv] [--no-interactive] [--no-install] [--skip-mongo-check]
                                   Scaffold a project; one-command wizard sets up
                                   Node + frontend + admin + Python AI + Mongo/Redis
  dev [--only a,b]          Start the four terminals under the supervisor
  build                     Build all TypeScript workspaces
  test                      Run all test suites
  doctor                    Verify the environment (node, python, mongo, redis)
  plugin <new|install>      Manage plugins
  add <subgraph|module>     Scaffold a new subgraph or module
  pysetup [pkgs...] [--venv] [--interactive]
                             Install the AI-server Python deps (requirements.txt) + extras
  uninstall [--target <path>] [--purge] [--force] [--dry-run]
                             Drop the project DB, delete its nexus_projects record,
                             optionally remove the project directory (--purge)
  node <id|serve>           Run this machine as a cluster node (agent + role service)
  cluster <sub>             Root-side mesh: status, link, scale, serve, etc.
  sync [--check] [--no-db]  Rewrite Dockerfiles, docker.*, serve-all.mjs & DB from nexus.config.ts

Options:
  -h, --help                Show this help
`);
}

// Re-exports for programmatic use.
export { doctor, init, dev, pysetup, cluster, node, syncCommand };
export { syncConfig, configChangedSinceSync, deriveValues, fingerprintOf } from './config-sync.js';
export { Supervisor } from './supervisor.js';
export type { LogEntry } from './supervisor.js';
