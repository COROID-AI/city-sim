import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the performance-budget suite.
 *
 * The suite measures the assembled café in the kernel's headless mode: render
 * statistics read from the composed scene graph and wall-clock/scene-time costs
 * for era switches and frames. It must never need a GPU — but it does need the
 * whole machine, so it runs as a single node worker with no file parallelism and
 * a generous timeout rather than competing with other suites for CPU.
 */
export default defineConfig({
  test: {
    name: 'cafe-perf',
    environment: 'node',
    globals: false,
    restoreMocks: true,
    include: ['tests/perf/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    reporters: ['default'],
  },
});
