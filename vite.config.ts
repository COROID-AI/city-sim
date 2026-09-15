import { defineConfig } from 'vite';

/**
 * Vite application rooted at the repository. The dev server and the production
 * build both consume `index.html` at the repository root, which in turn loads
 * `src/main.ts`.
 */
export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~0.5 MB minified; the app ships as one entry chunk.
    chunkSizeWarningLimit: 1100,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
