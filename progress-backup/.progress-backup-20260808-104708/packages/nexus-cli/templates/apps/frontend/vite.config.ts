import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy API/WS routes to the Nexus backend (:4000 by default).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:4000',
      '/auth': 'http://localhost:4000',
      '/csrf-token': 'http://localhost:4000',
      '/graphql': { target: 'http://localhost:4000', ws: true },
      '/ai': 'http://localhost:4000',
      '/payments': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/ws': { target: 'http://localhost:4000', ws: true },
    },
  },
});
