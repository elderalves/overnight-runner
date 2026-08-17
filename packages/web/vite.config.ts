import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// The backend's own default port (bin/overnight-runner.ts) -- overridable so
// the dev proxy can target a `serve` process that had to move ports.
const API_TARGET = `http://127.0.0.1:${process.env.OVERNIGHT_RUNNER_API_PORT ?? 4321}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // packages/overnight-runner/server/staticUi.ts's resolveWebDir() reads
    // straight from this package's own `dist/` -- no cross-package outDir.
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
});
