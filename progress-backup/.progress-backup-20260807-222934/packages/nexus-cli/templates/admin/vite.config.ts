import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/admin': { target: 'http://localhost:4000', changeOrigin: true },
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
      '/payments': { target: 'http://localhost:4000', changeOrigin: true },
      '/csrf-token': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
