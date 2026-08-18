import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Try a TCP connect to host:port within a timeout. */
export function tcpReachable(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Parse host/port from common connection-string formats. */
export function parseHostPort(url: string, defaultPort: number): { host: string; port: number } {
  try {
    const u = new URL(url);
    return { host: u.hostname || 'localhost', port: u.port ? Number(u.port) : defaultPort };
  } catch {
    return { host: 'localhost', port: defaultPort };
  }
}

export async function versionOf(cmd: string, args: string[] = ['--version']): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { shell: process.platform === 'win32' });
    return stdout.trim();
  } catch {
    return '';
  }
}