import { defineConfig } from 'vitest/config';

/**
 * Vite + Vitest configuration for Chrono City.
 *
 * The app is a fully static, procedural bundle (base "./" so it can be hosted
 * from any sub-path). Vitest runs in a plain Node environment: the world/sim
 * modules are written so that three.js scene graphs can be constructed without
 * a canvas or a WebGL context, which keeps the whole test suite headless.
 */
export default defineConfig({
  base: './',
  esbuild: {
    target: 'es2020',
    legalComments: 'none',
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2500,
    reportCompressedSize: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Building five fully detailed era layers (five times over, since the
    // determinism test rebuilds) is deliberately heavy work for Node.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'threads',
  },
});
