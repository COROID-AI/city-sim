# Vercel export check

## Status

**This project does not deploy to Vercel.** It ships a static `dist/`
artifact produced by `tsc`. There is no `next.config.*`, no
`@vercel/*` runtime, and no serverless surface to export. The
deliverable is a directory of `.js` and `.d.ts` files, plus an
`index.html` in `public/` that consumes them.

## Why not Vercel?

`city-sim` is a library + demo, not a hosted app:

- The **engine layer** (`src/engine/**`) is intentionally
  framework-agnostic. Importing `react` or `react-dom` from inside
  the engine is forbidden by ESLint and would break the deterministic
  benchmark harness, which runs under plain Node.
- The **systems layer** is the same: pure TS, no DOM, no React. The
  `EventBus`, `TimeSystem`, `EconomySystem`, `TrafficSystem`, and
  `NeedSystem` are designed to run inside a worker or a test fixture.
- The **UI overlay** is React-based (`src/ui/**`), but the host
  shell is a single static `index.html` that loads `dist/index.js`
  in the browser. There is no server-side rendering surface to
  export.

Adding Next.js to wire `@next/bundle-analyzer` would:

1. Force a `react` dependency into the engine layer (or fork the
   engine into a separate package — out of scope).
2. Require scaffolding an `app/` directory with a server runtime,
   which the project does not need.
3. Expand the task beyond its stated body.

## What we use instead

`scripts/bundle-analyzer.mjs` is a zero-dependency Node script that
walks `dist/`, groups files by top-level folder, prints a
fixed-width table, and **exits 1 if the total is ≥ 2 MB**. This is
the same contract `@next/bundle-analyzer` would give us, but without
the Next.js toolchain.

The CI gate (`npm run analyze:ci` in `.github/workflows/ci.yml`) runs
the analyzer after `npm run build` and fails the run on size
violation. The 2 MB threshold is the **v1.0.0 release signal**.

## Migration path (if/when we add a Next wrapper)

If a future task adds a Next.js host (for SSR, ISR, or a hosted
demo), the migration is:

1. Add `next`, `react`, `react-dom` to `package.json`.
2. Add a `next.config.mjs` with `@next/bundle-analyzer` wrapping
   `withBundleAnalyzer`.
3. Replace the `Bundle size gate` step in `.github/workflows/ci.yml`
   with `npx next build` and read the analyzer's exit code.
4. Keep the 2 MB budget.
5. Add a `next-bundle-analyzer` dev dependency.

The 2 MB gate contract is preserved across both stacks.

## Decision record

- **Date:** 2025
- **Decision:** No Vercel deployment; ship `dist/` as a static
  artifact.
- **Rationale:** Engine and systems layers are intentionally
  framework-agnostic. Next.js would violate the engine layer rule.
- **Alternatives considered:** Add a separate `web/` package with
  Next.js, keep `dist/` as the engine build. Rejected: out of scope
  for v1.0.0.
- **Status:** Accepted for v1.0.0.
