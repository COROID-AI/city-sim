import { test, expect } from '@playwright/test';

/**
 * City boot smoke test.
 *
 * Asserts the fullscreen <canvas> is visible after the app boots.
 *
 * NOTE: This test is intentionally RED until the downstream task
 * "Implement src/app/page.tsx + layout.tsx with fullscreen <canvas>"
 * lands. The current page renders only an <h1>. Keeping the canvas
 * assertion (rather than gating on the <h1>) ensures this spec actually
 * validates the boot path once the canvas exists (spec 9.3).
 */
test('city canvas is visible on boot', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('canvas')).toBeVisible();
});
