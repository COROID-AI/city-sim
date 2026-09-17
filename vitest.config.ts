import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the simulation test suite.
 *
 * The default environment is `node` so that `src/sim/**` is exercised without
 * any browser globals (which is also what the DOM-free guard test asserts).
 * Browser-facing suites opt in per file with a `@vitest-environment jsdom`
 * docblock, e.g. `tests/boot.test.ts`.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
