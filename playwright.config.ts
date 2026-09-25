import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration for Chrono City.
 *
 * The suite drives the *built* app: `vite preview` serves `dist/`, which is the
 * same artefact the delivery gate inspects, so nothing here can pass against a
 * dev-only code path. The `webServer` block rebuilds first (`npm run build &&
 * npm run preview`) so `npm run test:e2e` is self-contained and repeatable on a
 * clean checkout, and an already-running preview server (for example one the
 * delivery gate started) is reused instead of colliding on the port.
 *
 * `127.0.0.1` is spelled out both in the `--host` flag and in `baseURL`: Vite
 * preview otherwise binds `localhost`, which resolves to `::1` on some hosts and
 * leaves the IPv4 readiness probe unanswered.
 *
 * Every artefact the run produces - per-era screenshots, traces, the HTML
 * report - lands under `artifacts/e2e`, so verification evidence stays in one
 * discardable place.
 */

/** Host/port the preview server and `baseURL` share. */
const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  /** Screenshots, traces and the report all live under one discardable root. */
  outputDir: "artifacts/e2e/test-results",
  /**
   * One worker: the suite drives a WebGL scene whose era transformations are
   * wall-clock bound, so serialising the specs keeps frame pacing - and the
   * timing assertions - stable on software-rendered CI machines.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  /**
   * Generous per-test budget: a spec that walks all five stops plays five ~2.5 s
   * transformations, plus boot and settling.
   */
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/e2e/report", open: "never" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host ${HOST} --port ${PORT} --strictPort`,
    url: `${BASE_URL}/`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
