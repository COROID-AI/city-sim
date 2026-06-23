import { test, expect } from '@playwright/test';

/**
 * E2E smoke test verifying city boot and a 60-second stable run.
 *
 * Implements spec 9.3 and success criterion 6:
 *  - Loading screen appears then clears within 30s
 *  - Canvas is visible after loading clears
 *  - 5x speed button is clicked exactly once
 *  - Simulation runs for 60s of wall-clock time
 *  - Event log accumulates >= 5 entries
 *  - No console errors or uncaught pageerrors occur
 *  - window.__CITY_BENCHMARK__.fps > 30
 */
test.describe('City Simulation 60s stable run', () => {
  test('boots, runs 60s at 5x speed, and stays stable', async ({ page }) => {
    // Collect console errors and uncaught page errors throughout the run.
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    // 1. Visit / and wait for the loading screen to appear then clear (<=30s).
    await page.goto('/');
    const loadingScreen = page.getByTestId('loading-screen');
    await expect(loadingScreen).toBeVisible();
    await expect(loadingScreen).toBeHidden({ timeout: 30_000 });

    // 2. Assert the canvas is visible after loading clears.
    const canvas = page.getByTestId('city-canvas');
    await expect(canvas).toBeVisible();

    // 3. Click the 5x speed button exactly once.
    const speed5xButton = page.getByTestId('speed-5x-button');
    await speed5xButton.click();

    // 4. Wait 60 seconds of wall-clock time for the simulation to run.
    await page.waitForTimeout(60_000);

    // 5. Assert the event log has >= 5 entries.
    const logEntries = page.getByTestId('city-log-entry');
    await expect.poll(async () => await logEntries.count(), {
      timeout: 10_000,
      message: 'expected at least 5 city-log-entry elements',
    }).toBeGreaterThanOrEqual(5);

    // 6. Assert no console errors or uncaught pageerrors occurred.
    expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toEqual([]);
    expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);

    // 7. Assert window.__CITY_BENCHMARK__.fps > 30 via page.evaluate.
    const fps = await page.evaluate(() => {
      const benchmark = (window as unknown as { __CITY_BENCHMARK__?: { fps?: number } })
        .__CITY_BENCHMARK__;
      return benchmark?.fps ?? 0;
    });
    expect(fps, `expected FPS > 30, got ${fps}`).toBeGreaterThan(30);
  });
});
