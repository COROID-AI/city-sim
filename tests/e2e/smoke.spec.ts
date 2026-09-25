import { expect, test } from "@playwright/test";

/**
 * Smoke test for the scaffolded shell.
 *
 * Requires a build (`npm run build`) plus an installed Playwright browser; the
 * `webServer` block in `playwright.config.ts` serves `dist/` through
 * `vite preview`, so this asserts the real production bundle, not the dev
 * server.
 */
test("boots the WebGL shell with the timeline, HUD and loading roots", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");

  const canvas = page.locator("#city-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator("#timeline-root")).toBeAttached();
  await expect(page.locator("#hud-root")).toBeAttached();

  // main.ts hides the overlay only after the first rendered frame.
  await expect(page.locator("#loading-root")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await expect(page.locator("#loading-root")).toBeHidden();

  // The timeline root is pinned to the top edge of the viewport.
  const timelineBox = await page.locator("#timeline-root").boundingBox();
  expect(timelineBox).not.toBeNull();
  expect(timelineBox?.y ?? -1).toBeLessThanOrEqual(1);

  // The canvas is sized by the resize handler and carries a live WebGL surface.
  const canvasSize = await canvas.evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    return { width: surface.width, height: surface.height };
  });
  expect(canvasSize.width).toBeGreaterThan(0);
  expect(canvasSize.height).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});
