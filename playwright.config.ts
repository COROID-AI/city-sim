/**
 * Playwright config for the city-sim end-to-end smoke test.
 *
 * The smoke spec (`tests/e2e/city-smoke.spec.ts`) boots the Next.js
 * dev server, clicks the canvas five times, waits 30 s, then asserts
 * that the CityLog overlay has rendered at least 5 entries and that
 * no console errors fired during the run.
 *
 * Browser install:
 *   npx playwright install --with-deps chromium
 *
 * Run a single spec (used by `npm run test:e2e`):
 *   npx playwright test tests/e2e/city-smoke.spec.ts
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Boots `next dev` so the page renders the live simulation. If
    // a static export is preferred, swap to `npx http-server out -p ${PORT}`.
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
