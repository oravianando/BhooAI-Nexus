import { handle } from './backend-handle.js';

export default async function globalTeardown(): Promise<void> {
  const backend = handle.backend;
  if (!backend) return;
  backend.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (backend.exitCode === null) backend.kill('SIGKILL');
}