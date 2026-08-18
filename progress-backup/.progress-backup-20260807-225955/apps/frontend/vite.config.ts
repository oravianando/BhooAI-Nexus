import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser talks only to the backend (:8080). Vite proxies the API surface
// in dev so the frontend can use same-origin fetch + WS without CORS pain.
// In production, put a reverse proxy in front of both apps (or serve the built
// frontend from the backend's static handler). The dev server binds localhost
// on :3000 (see packages/nexus-cli/src/commands/dev.ts); the port here is a
// fallback for standalone `vite` launches.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: 'localhost',
    proxy: {
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
      '/csrf-token': { target: 'http://localhost:4000', changeOrigin: true },
      '/graphql': { target: 'http://localhost:4000', changeOrigin: true, ws: true },
      '/ai': { target: 'http://localhost:4000', changeOrigin: true },
      '/payments': { target: 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
    },
  },
});
