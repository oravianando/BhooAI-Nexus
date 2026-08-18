// Runs the whole Nexus stack in one process tree (used as the Docker CMD):
//   backend  -> nexus node serve --role=backend --port=<NEXUS_NODE_PORT|7575>
//               (cluster node agent on :7575 + backend role service)
//   frontend -> vite preview on :3000          (built SPA, proxies API)
//   admin    -> vite preview on :3001          (built admin SPA, proxies API)
// Forwards signals / reaps children so `docker stop` shuts down cleanly.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const node = process.execPath;
const nodePort = process.env.NEXUS_NODE_PORT ?? '7575';
const children = [];
let shuttingDown = false;

function run(name, cwd, cmd, args) {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  children.push(p);
  p.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`[serve-all] ${name} exited with code ${code ?? 1}`);
    shutdown(code ?? 1);
  });
  p.on('error', (err) => {
    if (shuttingDown) return;
    console.error(`[serve-all] ${name} failed to start: ${err.message}`);
    shutdown(1);
  });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 3000);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('backend', root, node, ['bin/nexus.js', 'node', 'serve', '--role=backend', `--port=${nodePort}`]);
run('frontend', join(root, 'apps', 'frontend'), npm, ['run', 'preview', '--', '--host', '0.0.0.0', '--port', '3000']);
run('admin', join(root, 'apps', 'admin'), npm, ['run', 'preview', '--', '--host', '0.0.0.0', '--port', '3001']);