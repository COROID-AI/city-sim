import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the end-to-end era and interaction suites.
 *
 * These suites boot the **real composition root** (`src/app/compose.ts`) and
 * therefore run outside the project's default `src/**` unit-test includes: they
 * are verification harnesses that must stay runnable on their own, with the
 * package scripts still owned by the scaffold task.
 *
 * Environment:
 *  - `jsdom` is the default because the interaction suite drives the real
 *    timeline control, the enter-café gesture and the keyboard walk input. The
 *    era snapshot suite opts back into `node` with a per-file
 *    `@vitest-environment node` docblock, since it only needs the headless
 *    kernel.
 *  - `css: true` lets `src/ui/timeline/TimelineSlider.ts` import `timeline.css`
 *    as raw text exactly as the browser bundle does.
 *
 * Neither suite may require a GPU, a WebGL context or an audio device: the
 * kernel falls back to its headless mode and the audio engine runs against an
 * injected headless audio-context fake.
 */
export default defineConfig({
  test: {
    name: 'cafe-e2e',
    environment: 'jsdom',
    css: true,
    globals: false,
    restoreMocks: true,
    include: ['tests/e2e/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
});
