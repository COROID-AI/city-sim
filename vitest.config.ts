import { defineConfig } from 'vitest/config';

/**
 * Vitest setup for the café timelapse.
 *
 * `node` is the default environment: the kernel, the contracts, the period
 * registry, the domain modules and the audio engine are pure logic and must run
 * without a GPU. DOM suites — the timeline slider and the HUD/overlay work —
 * live under `src/ui` and `src/app` and run in the `jsdom` environment.
 *
 * Both projects are self contained (`extends: false`) so their `include`
 * patterns never merge with each other: the kernel/contracts suites must not be
 * re-run inside jsdom.
 *
 * The DOM project enables CSS processing so `src/ui/timeline/TimelineSlider.ts`
 * can import `timeline.css?raw`: that source text is what the control injects
 * inline, which keeps the browser and jsdom behaviour identical and costs the
 * page no extra request.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    restoreMocks: true,
    projects: [
      {
        // Kernel, contracts, registry, domains, audio: no DOM, no GPU.
        extends: false,
        test: {
          name: 'node',
          environment: 'node',
          globals: false,
          restoreMocks: true,
          include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', 'src/ui/**', 'src/app/**'],
        },
      },
      {
        // Timeline slider, HUD and overlay DOM suites.
        extends: false,
        test: {
          name: 'dom',
          environment: 'jsdom',
          css: true,
          globals: false,
          restoreMocks: true,
          include: [
            'src/ui/**/*.test.ts',
            'src/ui/**/*.test.tsx',
            'src/app/**/*.test.ts',
            'src/app/**/*.test.tsx',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
    ],
  },
});
