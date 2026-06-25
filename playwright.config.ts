import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration.
 * Uses the Next.js dev server for local E2E runs.
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './src/__tests__/e2e',
  // Global per-test timeout >= 120s to accommodate the 60s stable-run wait.
  timeout: 120 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
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
