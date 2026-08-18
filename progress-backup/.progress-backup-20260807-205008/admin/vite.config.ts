import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Admin app — runs on :5174, talks to the backend (:4000) for config/plugins/
// users/metrics and to the supervisor control API (:7474) for process control.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // Proxy admin API calls to the backend so auth cookies + CSRF work cross-origin-free.
      // Backend target must match the running backend's port (this stack: 4000).
      '/admin': { target: 'http://localhost:4000', changeOrigin: true },
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
      '/payments': { target: 'http://localhost:4000', changeOrigin: true },
      '/csrf-token': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
