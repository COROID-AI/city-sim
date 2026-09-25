import { defineConfig } from "vite";

/**
 * Application build configuration for Chrono City.
 *
 * The app is a fully static bundle: `base: "./"` keeps every emitted URL
 * relative so `dist/` can be served from any sub-path (or a file host) without
 * a rewrite rule. Test configuration lives in `vitest.config.ts` so the
 * production build stays free of test-only settings.
 */

/** Honours a runner-injected `PORT` so managed probes can pick a free port. */
function portFromEnv(fallback: number): number {
  const port = Number.parseInt(process.env.PORT ?? "", 10);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
    sourcemap: true,
    // three.js is a large single dependency; raise the warning threshold instead
    // of splitting the vendor chunk for a single-entry app.
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: portFromEnv(5173),
    open: false,
  },
  preview: {
    port: portFromEnv(4173),
    open: false,
  },
});
