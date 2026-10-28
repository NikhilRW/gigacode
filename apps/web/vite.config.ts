import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// http-proxy streams responses (including SSE) without buffering.
const proxy = { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Browser-safe modules of @engine/shared (no node: imports) are imported by path.
    alias: {
      '@shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/v1': proxy, '/healthz': proxy, '/readyz': proxy, '/docs': proxy },
  },
  build: { chunkSizeWarningLimit: 4000 },
});
