import { test, expect } from '@playwright/test';

/**
 * Basic smoke test verifying the dev server serves the app.
 * The full 60s stable-run E2E will be added by the downstream Playwright task.
 */
test('homepage loads successfully', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/City Simulation/i);
});
