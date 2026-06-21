import { test, expect } from '@playwright/test';

/**
 * E2E smoke test.
 *
 * Boots the Next.js dev server (via playwright.config.ts webServer), navigates
 * to the home page, and asserts the city-sim <canvas> is present. This proves
 * Playwright + Chromium + baseURL are wired correctly.
 */
test('home page renders the city canvas', async ({ page }) => {
  await page.goto('/');

  // The canvas is the smoke-test target. Its id is stable so downstream
  // tasks can replace the page contents without breaking this assertion.
  const canvas = page.locator('canvas#city-canvas');
  await expect(canvas).toBeVisible();
});

test('home page has the expected title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/City Sim/i);
});
