/**
 * Playwright configuration.
 *
 * Runs the e2e suite headlessly against the Next.js dev server. The dev
 * server handles client-side routing and dynamic imports natively, which
 * avoids static-export clean-URL issues (e.g. /time-city → time-city.html).
 *
 * Uses port 3999 to avoid conflicts with the runner's own port 3000 proxy.
 */
import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3999',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Use port 3999 to avoid the runner's port 3000 proxy.
    // PORT env is overridden inline so next dev honors --port.
    command: 'PORT=3999 npx next dev --port 3999',
    url: 'http://localhost:3999',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
