/**
 * E2E tests for the /time-city page.
 *
 * Covers the acceptance criteria:
 *  - Loads /time-city and verifies the timeline slider is visible.
 *  - Clicks through all 5 year stops and asserts the displayed year label
 *    updates for each.
 *  - Verifies the transition overlay tooltip appears during a year change
 *    and disappears after the transition completes.
 */
import { test, expect } from '@playwright/test';

/** The five era labels rendered by the TimelineSlider, oldest first. */
const YEAR_LABELS = ['1945', '1965', '1985', '2005', '2025'] as const;

test.describe('Time City timeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/time-city');
    // Wait for the timeline slider to be visible — this confirms the page
    // has hydrated and the HUD is rendered.
    await expect(page.getByTestId('timeline-slider')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('switches through all 5 years and updates the displayed label', async ({
    page,
  }) => {
    const yearDisplay = page.getByTestId('timeline-current-year');

    // The page defaults to the latest era (2025).
    await expect(yearDisplay).toHaveText('2025');

    for (const label of YEAR_LABELS) {
      await page.getByTestId(`timeline-stop-${label}`).click();
      await expect(yearDisplay).toHaveText(label);
    }
  });

  test('shows the transition overlay tooltip during a year change', async ({
    page,
  }) => {
    // At rest, the overlay should not be visible.
    await expect(page.getByTestId('transition-overlay')).toBeHidden();

    // Click a different year to start a transition.
    await page.getByTestId('timeline-stop-1945').click();

    // The overlay should appear (transition is in flight).
    await expect(page.getByTestId('transition-overlay')).toBeVisible({
      timeout: 5_000,
    });

    // The overlay should mention the target year.
    await expect(page.getByText('Travelling to')).toBeVisible();
    await expect(
      page.getByTestId('transition-overlay').getByText('1945'),
    ).toBeVisible();

    // After the transition completes (1.5s + margin), the overlay hides.
    await expect(page.getByTestId('transition-overlay')).toBeHidden({
      timeout: 10_000,
    });
  });

  test('updates the year via the range input', async ({ page }) => {
    const yearDisplay = page.getByTestId('timeline-current-year');
    const rangeInput = page.getByTestId('timeline-range-input');

    // Move to index 2 (1985).
    await rangeInput.fill('2');
    await expect(yearDisplay).toHaveText('1985');

    // Move to index 0 (1945).
    await rangeInput.fill('0');
    await expect(yearDisplay).toHaveText('1945');
  });
});
