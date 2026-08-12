import { defineConfig } from 'vite';

// Serves the project from the repository root, treats public/ as static
// assets, and uses the root index.html (with /src/main.ts as the entry
// module) as the build input.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
  },
});