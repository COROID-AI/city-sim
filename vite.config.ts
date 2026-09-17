import { defineConfig } from 'vite';

/**
 * Vite configuration for the browser build.
 *
 * `base: './'` keeps the emitted bundle usable from any static path, so the
 * `dist/` output can be dropped onto any host (or served by `vite preview`)
 * and still load `index.html -> src/main.ts` without a start button.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
