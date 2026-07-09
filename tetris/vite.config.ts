import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Honour the runner-provided PORT for smoke checks; fall back to 5173.
    port: Number(process.env.PORT) || 5173,
    host: true,
  },
});
