import { defineConfig } from 'vite';

/**
 * Vite configuration for the Browser Tetris project.
 *
 * The production build emits the static assets (HTML, JS, CSS) into
 * `dist/`, with hashed assets under `dist/assets/`, so the game can be
 * hosted from any static file server.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
  },
});