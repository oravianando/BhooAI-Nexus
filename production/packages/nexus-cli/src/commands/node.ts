import { loadConfigAuto } from '../../../nexus-core/src/index.js';
import { NodeAgent, nodeIdFor } from '@bhooai/nexus-cluster';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * `nexus node <subcommand>` - run THIS machine as a cluster node.
 *
 *   node id --role <role>                  print this node's stable id
 *   node serve --role=<role> [--port]     start the agent + role service
 *
 * Onboarding per the mesh flow:
 *   server$ nexus node serve --role=backend
 *   -> prints agent URL + pairing token; paste the URL on the central:
 *   central$ nexus cluster link http://<this-host>:7575
 */
export async function node(args: string[]): Promise<number> {
  const sub = args[0];
  const role = argValue(args, '--role') ?? 'backend';

  const cfg = await loadConfigAuto({ root: process.cwd() });
  const token = cfg.cluster.token;
  const port = Number(argValue(args, '--port') ?? '7575');
  const agentHost = cfg.cluster.nodeAgentHost;
  const defaultPort = Number.isInteger(cfg.cluster.nodeAgentPort) ? cfg.cluster.nodeAgentPort : 7575;
  const effectivePort = Number.isInteger(port) ? port : defaultPort;

  if (sub === 'id') {
    console.log(nodeIdFor(process.cwd(), role as never));
    return 0;
  }

  if (sub === 'serve') {
    const description = roleDescription(role);
    const command = serviceCommand(role, cfg);
    const agent = new NodeAgent({
      projectRoot: process.cwd(),
      role: role as never,
      tier: 'dev',
      port: effectivePort,
      token,
      version: '0.1.0',
      services: serviceUrls(role, cfg),
      serviceCommand: command,
      advertisedUrl: process.env.NEXUS_NODE_ADVERTISED_URL,
    });
    await agent.listen(agentHost);
    console.log(`${CYAN}node-agent${RESET} ready - role ${role} ${description}`);
    console.log(`  ${GREEN}agent url:  http://${agentHost}:${effectivePort}${RESET}`);
    console.log(`  ${GREEN}token:      ${token ? `${token}` : '<empty - set cluster.token>'}`)
    console.log(`  ${DIM}link it from the central:  nexus cluster link http://${agentHost}:${effectivePort}${RESET}`);
    if (command.length) {
      agent.startService();
      console.log(`  started role service: ${command.join(' ')}`);
    }
    // Hold the process.
    return await new Promise<number>(() => {});
  }

  console.log('Usage: nexus node <id|serve> [--role=backend|files|database|ai] [--port=N]');
  return 1;
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

function roleDescription(role: string): string {
  switch (role) {
    case 'backend': return '(API core)';
    case 'files': return '(static + uploads storage)';
    case 'database': return '(Mongo + Redis)';
    case 'ai': return '(AI inference engine)';
    default: return '';
  }
}

function serviceCommand(role: string, cfg: Awaited<ReturnType<typeof loadConfigAuto>>): string[] {
  switch (role) {
    case 'backend':
      return ['tsx', 'apps/backend/src/main.ts'];
    case 'ai':
      return ['python', 'main.py'];
    case 'files':
      // Fall back to the framework uploads server launcher if present.
      return ['tsx', 'apps/backend/src/main.ts'];
    case 'database':
      return ['tsx', 'apps/backend/src/main.ts'];
    default:
      return [];
  }
}

function serviceUrls(role: string, cfg: Awaited<ReturnType<typeof loadConfigAuto>>): Partial<Record<'backend' | 'files' | 'database' | 'ai', string>> {
  return { [role]: `http://localhost:${cfg.server.port}` };
}