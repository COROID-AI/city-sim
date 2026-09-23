import { defineConfig } from 'vitest/config';

/**
 * Unit tests run against a DOM-capable environment: `jsdom` provides the
 * document/overlay scaffolding and — together with the `canvas` package — a
 * real HTMLCanvasElement implementation so later procedural texture generators
 * (`CanvasTexture` factories) can be exercised in Node without a browser.
 *
 * End-to-end specs live under `tests/e2e` (Playwright) and are excluded here.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true,
      },
    },
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
