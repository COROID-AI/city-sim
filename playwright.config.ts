import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for city-sim.
 *
 * Runs headless by default; pass `--headed` (or use `npm run test:e2e:headed`)
 * to watch the browser locally.
 *
 * The webServer uses `npm run dev` because next.config.js sets
 * `output: 'export'` — there is no Node server runtime for `next start`.
 * See discovery `next_static_export_constraint`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
