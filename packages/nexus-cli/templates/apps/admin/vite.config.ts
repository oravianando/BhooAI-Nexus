import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Read the merged host/port values from the project's single nexus config file
// (ts/js/mjs/cjs, discovery order matches the backend loader) plus NEXUS_*
// env overrides, so this Vite dev server and its proxy target stay in one
// source of truth: nexus.config.js.
async function loadConfig() {
  const exts = ['ts', 'js', 'mjs', 'cjs'];
  let user: Record<string, any> = {};
  for (const ext of exts) {
    const file = join(PROJECT_ROOT, `nexus.config.${ext}`);
    if (existsSync(file)) {
      const mod = (await import(pathToFileURL(file).href + `?v=${Date.now()}`)) as Record<string, any>;
      user = mod.default ?? mod.config ?? {};
      break;
    }
  }
  const num = (v: string | undefined, fallback: number) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : fallback);
  const str = (v: string | undefined, fallback: string) => (v !== undefined && v !== '' ? v : fallback);

  return {
    server: {
      host: str(process.env.NEXUS_SERVER_HOST, user.server?.host ?? '0.0.0.0'),
      port: num(process.env.NEXUS_SERVER_PORT, user.server?.port ?? 4000),
    },
    admin: {
      host: str(process.env.NEXUS_ADMIN_HOST, user.admin?.host ?? 'localhost'),
      port: num(process.env.NEXUS_ADMIN_PORT, user.admin?.port ?? 3300),
      enabled: user.admin?.enabled ?? true,
    },
    frontend: {
      host: str(process.env.NEXUS_FRONTEND_HOST, user.frontend?.host ?? 'localhost'),
      port: num(process.env.NEXUS_FRONTEND_PORT, user.frontend?.port ?? 3000),
      enabled: user.frontend?.enabled ?? true,
    },
  };
}

export default defineConfig(async () => {
  const cfg = await loadConfig();
  const backendHost = cfg.server.host === '0.0.0.0' || cfg.server.host === '::' ? '127.0.0.1' : cfg.server.host;
  const target = `http://${backendHost}:${cfg.server.port}`;

  return {
    plugins: [react()],
    server: {
      port: cfg.admin.port,
      host: cfg.admin.host,
      proxy: {
        '/admin': { target, changeOrigin: true },
        '/auth': { target, changeOrigin: true },
        '/payments': { target, changeOrigin: true },
        '/csrf-token': { target, changeOrigin: true },
        '/ai': { target, changeOrigin: true },
      },
    },
  };
});