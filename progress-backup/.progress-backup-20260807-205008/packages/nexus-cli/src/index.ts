import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { dev } from './commands/dev.js';
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
      console.log('nexus build — implemented in a later phase (tsc across workspaces).');
      return 0;
    case 'test':
      console.log('nexus test — run `npm test` (vitest + pytest) for now.');
      return 0;
    case 'plugin':
      console.log('nexus plugin <new|install> — implemented in Phase 8.');
      return 0;
    case 'add':
      console.log('nexus add <subgraph|module> — implemented in Phase 5/6.');
      return 0;
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
  init [target] [--force] [--skip-install]   Scaffold and install a new Nexus project
  dev [--only a,b]          Start the four terminals under the supervisor
  build                     Build all TypeScript workspaces
  test                      Run all test suites
  doctor                    Verify the environment (node, python, mongo, redis)
  plugin <new|install>      Manage plugins
  add <subgraph|module>     Scaffold a new subgraph or module

Options:
  -h, --help                Show this help
`);
}

// Re-exports for programmatic use.
export { doctor, init, dev };
export { Supervisor } from './supervisor.js';
