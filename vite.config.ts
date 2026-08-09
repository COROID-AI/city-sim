import { defineConfig } from 'vite';

// Vite configuration: the production build writes all static assets
// (HTML, JS, CSS, images) into `dist/`, with generated files under `dist/assets/`.
export default defineConfig({
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});