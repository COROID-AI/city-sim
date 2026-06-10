import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config.
 *
 * The static export is served by `http-server ./out -p 3000` per the
 * test strategy. CI runs the build, then starts the server, then runs
 * these tests against the live URL.
 *
 * We do NOT use the webServer config because the build output is
 * committed to CI's working dir; the e2e is meant to be runnable both
 * locally and in CI without juggling process management.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
