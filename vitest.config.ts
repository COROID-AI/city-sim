import { defineConfig } from "vitest/config";

/**
 * Unit-test configuration for Chrono City.
 *
 * The jsdom environment is mandatory: the shell, timeline and HUD modules are
 * DOM-rooted, so their tests need `document`, `getComputedStyle` and the
 * canvas element API. Playwright specs live in `tests/e2e` and are executed by
 * `npm run test:e2e`, never by vitest.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    reporters: "default",
  },
});
