import { defineConfig } from 'vitest/config';

/**
 * Build, dev-server and test configuration for the Coroid holographic factory.
 *
 * The dev server is pinned to port 4173 with `strictPort` so browser
 * verification always lands on a predictable origin.
 */
export default defineConfig({
  server: {
    port: 4173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // three.js is a single large chunk; keep the warning threshold realistic
    // for a WebGL game shell instead of masking real regressions.
    chunkSizeWarningLimit: 1300,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
