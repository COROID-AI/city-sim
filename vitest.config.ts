import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the simulation test suite.
 *
 * The default environment is `node` so that `src/sim/**` is exercised without
 * any browser globals (which is also what the DOM-free guard test asserts).
 * Browser-facing suites opt in per file with a `@vitest-environment jsdom`
 * docblock, e.g. `tests/boot.test.ts`.
 *
 * CSS is processed rather than stubbed so the browser-facing suites can assert
 * on the shipped overlay styling (`src/ui/hud.css`) through `?inline` imports.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    css: true,
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
