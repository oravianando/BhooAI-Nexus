import type { ChildProcess } from 'node:child_process';

// Shared between global-setup (spawns) and global-teardown (kills). Playwright
// runs both in the same process, so a module-scoped handle is enough.
export const handle: { backend: ChildProcess | null } = { backend: null };