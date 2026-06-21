import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * Targets Chromium only (per spec). The webServer boots the Next.js dev
 * server. The port is taken from the PORT env var (injected by the execution
 * runner) defaulting to 3000 for local development.
 */
const port = process.env.PORT || '3000';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './src/__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
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
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
