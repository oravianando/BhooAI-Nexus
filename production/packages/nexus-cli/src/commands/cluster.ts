import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfigAuto } from '../../../nexus-core/src/index.js';
import { ClusterManager } from '@bhooai/nexus-cluster';
import type { DeepPartial, NexusConfig } from '@bhooai/nexus-core';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * `nexus cluster <subcommand>` - central-side mesh orchestration.
 *
 *   cluster status            list linked nodes + LB RPS
 *   cluster link <url>        handshake + register a node by its agent URL
 *   cluster unlink <id>       forget a node
 *   cluster start|stop|restart|kill <id>
 *   cluster scale <n>         target exactly n backend nodes
 *   cluster serve             hold process: LB + autoscaler (foreground)
 *   cluster check             poll every node once (health + metrics)
 */
export async function cluster(args: string[]): Promise<number> {
  const cfg = await loadConfigAuto({ root: process.cwd() });
  const [sub, a, b] = args;

  // `serve` is the explicit "start the cluster" command - if a prior admin
  // stop wrote {cluster:{enabled:false}} into nexus.runtime.json, that
  // override wins over nexus.config.ts and would silently keep the cluster
  // off. Re-enable it in runtime.json so the LB actually starts.
  if (sub === 'serve' && !cfg.cluster.enabled) {
    enableClusterInRuntime(process.cwd());
    console.log(`${YELLOW}cluster was disabled in nexus.runtime.json - re-enabling${RESET}`);
  }

  // For non-serve commands, warn (don't block) when the cluster is off.
  if (sub !== 'serve' && !cfg.cluster.enabled) {
    console.warn(`${RED}cluster.enabled is false${RESET} - run ${CYAN}nexus cluster serve${RESET} to start it, or set cluster: { enabled: true } in nexus.config.ts`);
  }

  const manager = new ClusterManager({ config: cfg.cluster, root: process.cwd(), aiServerUrl: cfg.ai.serverUrl });

  switch (sub ?? 'help') {
    case 'status': {
      const nodes = manager.list();
      const rps = manager.rps();
      console.log(`${CYAN}cluster${RESET} - ${nodes.length} linked node(s)`);
      for (const n of nodes) {
        const color = n.status === 'ready' ? GREEN : n.status === 'unreachable' ? RED : CYAN;
        console.log(`  ${color}${n.status}${RESET} ${DIM}${n.identity.id}${RESET} role=${n.identity.role} tier=${n.identity.tier} enabled=${n.enabled} rps=${rps[n.identity.id] ?? 0}${n.lastMetrics ? ` cpu=${n.lastMetrics.cpu}% mem=${n.lastMetrics.memoryMb}MiB` : ''}`);
      }
      return 0;
    }
    case 'link': {
      if (!a) { console.error('cluster link <agent-url>'); return 1; }
      try {
        const node = await manager.link(a);
        const color = node.status === 'ready' ? GREEN : CYAN;
        console.log(`${color}linked${RESET} ${node.identity.id} role=${node.identity.role} base=${node.identity.baseUrl}`);
        return 0;
      } catch (err) {
        console.error(`${RED}link failed${RESET}: ${(err as Error).message}`);
        return 1;
      }
    }
    case 'unlink': {
      if (!a) { console.error('cluster unlink <id>'); return 1; }
      return manager.unlink(a) ? (console.log(`removed ${a}`), 0) : (console.error(`no such node: ${a}`), 1);
    }
    case 'start':
    case 'stop':
    case 'restart':
    case 'kill': {
      if (!a) { console.error(`cluster ${sub} <id>`); return 1; }
      await manager.exec(a, sub === 'kill' ? 'stop' : sub);
      console.log(`${sub} ${a}`);
      return 0;
    }
    case 'scale': {
      if (!a || !Number.isFinite(Number(a))) { console.error('cluster scale <n>'); return 1; }
      try {
        await manager.scaleTo(Number(a));
        console.log(`scaled to ${a} backend node(s)`);
        return 0;
      } catch (err) {
        console.error(`${RED}${(err as Error).message}${RESET}`);
        return 1;
      }
    }
    case 'check': {
      await manager.pollAll();
      console.log(`checked ${manager.list().length} node(s)`);
      return 0;
    }
    case 'serve': {
      console.log(`${CYAN}cluster${RESET} LB on ${cfg.cluster.lbHost}:${cfg.cluster.lbPort}${RESET}`);
      await manager.listenLb(cfg.cluster.lbHost);
      manager.autoscaler.start(10_000);
      setInterval(() => void manager.pollAll().catch(() => {}), 15_000);
      return 0;
    }
    case 'help':
    default:
      console.log(`Usage: nexus cluster <status|link|unlink|start|stop|restart|kill|scale|check|serve>`);
      return 0;
  }
}

/**
 * Patch `nexus.runtime.json` to set `cluster.enabled = true`. The admin
 * "stop cluster" endpoint writes `{cluster:{enabled:false}}` there, and that
 * override beats `nexus.config.ts` in the loader precedence - so `nexus
 * cluster serve` would read `enabled:false` and the LB would never bind.
 * This removes the stale override so `serve` actually starts the cluster.
 */
function enableClusterInRuntime(root: string): void {
  const runtimePath = resolve(root, 'nexus.runtime.json');
  let runtime: Record<string, unknown> = {};
  if (existsSync(runtimePath)) {
    try {
      runtime = JSON.parse(readFileSync(runtimePath, 'utf8')) as Record<string, unknown>;
    } catch {
      // corrupt runtime file - start fresh
      runtime = {};
    }
  }
  const cluster = (runtime['cluster'] ?? {}) as Record<string, unknown>;
  cluster['enabled'] = true;
  runtime['cluster'] = cluster;
  writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`);
}