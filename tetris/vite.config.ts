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
    // Fail loudly if the chosen port is taken instead of silently incrementing
    // to a different port (which would cause the smoke-check probe to miss).
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
});
