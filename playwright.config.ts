import { defineConfig, devices } from '@playwright/test';

/**
 * Browser harness for Chrono City.
 *
 * Every task that inspects the live scene drives the real app through this
 * config: the app boots itself on page load and exposes its handle on
 * `window.__chronoCity`, so specs only need to `page.goto('/')` and wait for
 * `window.__chronoCity`.
 *
 * `npm run test:e2e` builds first and then serves the production bundle through
 * `vite preview`, which is what the harness below expects.
 */
const PORT = Number(process.env.CHRONO_E2E_PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IS_CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.e2e.ts', '**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: IS_CI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      // Headless Chromium needs software GL to create the WebGL context used by
      // the renderer; this keeps the app booting deterministically in CI.
      args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
  },
});
