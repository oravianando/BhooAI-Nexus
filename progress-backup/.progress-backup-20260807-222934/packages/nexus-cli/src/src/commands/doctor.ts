import { loadConfigAuto } from '../../../nexus-core/src/index.js';
import { CheckResult, parseHostPort, tcpReachable, versionOf } from '../util.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** Verify the environment: node/python versions and mongo/redis reachability. */
export async function doctor(): Promise<number> {
  const results: CheckResult[] = [];

  results.push({
    name: 'node',
    ok: !!process.versions.node,
    detail: `v${process.versions.node}`,
  });

  const pyVer = await versionOf(process.platform === 'win32' ? 'python' : 'python3');
  results.push({ name: 'python', ok: !!pyVer, detail: pyVer || 'not found (ai-server disabled)' });

  // Load config to read db/redis URIs (auto-discovers nexus.config.{ts,js} + defaults + env).
  try {
    const cfg = await loadConfigAuto({ root: process.cwd() });
    const db = parseHostPort(cfg.db.uri, 27017);
    const dbOk = await tcpReachable(db.host, db.port);
    results.push({ name: 'mongodb', ok: dbOk, detail: `${db.host}:${db.port} ${dbOk ? 'reachable' : 'unreachable'}` });

    const redis = parseHostPort(cfg.redis.url, 6379);
    const redisOk = await tcpReachable(redis.host, redis.port);
    results.push({ name: 'redis', ok: redisOk, detail: `${redis.host}:${redis.port} ${redisOk ? 'reachable' : 'unreachable'}` });

    if (cfg.auth.jwt.secret === 'change-me-please') {
      results.push({ name: 'jwt-secret', ok: false, detail: 'still the default — set NEXUS_AUTH_JWT_SECRET' });
    }
  } catch (err) {
    results.push({ name: 'config', ok: false, detail: String((err as Error).message) });
  }

  let allOk = true;
  for (const r of results) {
    const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const warn = !r.ok && (r.name === 'python' || r.name === 'redis' || r.name === 'mongodb') ? YELLOW : '';
    console.log(`  ${icon} ${warn}${r.name.padEnd(12)}${RESET ? '' : ''} ${r.detail}`);
    if (!r.ok && (r.name === 'node' || r.name === 'config' || r.name === 'jwt-secret')) allOk = false;
  }

  console.log(allOk ? `\n${GREEN}Nexus environment looks ready.${RESET}` : `\n${YELLOW}Some optional services are missing — see above.${RESET}`);
  return allOk ? 0 : 0; // doctor never hard-fails; missing optional services are advisory
}
