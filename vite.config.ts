import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // Honor the PORT provided by the execution runner for smoke checks.
    port: Number(process.env.PORT) || 5173,
    host: '127.0.0.1',
  },
  preview: {
    port: Number(process.env.PORT) || 4173,
    host: '127.0.0.1',
  },
});
