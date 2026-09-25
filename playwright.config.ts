import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration for Chrono City.
 *
 * `npm run test:e2e` builds nothing on its own: run `npm run build` first (or
 * let the `webServer` block below serve the existing `dist/`). The suite drives
 * the real built app through `vite preview`, which is the same artefact the
 * delivery gate inspects.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
