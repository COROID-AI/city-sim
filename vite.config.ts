import { defineConfig } from 'vite';

/**
 * Chrono City is a self-starting browser experience: a single page that boots
 * the renderer and begins ticking the moment the module graph is ready. The
 * config therefore stays deliberately small — no framework plugins, no asset
 * pipeline, relative `base` so the emitted `dist/` works from any static host.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // All artwork is procedural, so the bundle stays code-only.
    assetsInlineLimit: 4096,
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    open: false,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
