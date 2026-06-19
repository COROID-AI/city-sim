# E2E Tests (Playwright)

End-to-end smoke tests for city-sim, powered by [Playwright](https://playwright.dev).

## Setup

Dependencies are installed via `npm install` (`@playwright/test` is a devDependency).
Download the Chromium browser binary once after install:

```bash
npx playwright install chromium
# on CI / fresh Linux, also install OS deps:
npx playwright install --with-deps chromium
```

## Running

```bash
# headless (default, CI-friendly)
npm run test:e2e

# list discovered tests without running them
npm run test:e2e:list

# watch the browser locally
npm run test:e2e:headed
```

Playwright spawns `npm run dev` automatically via the `webServer` config
(baseURL `http://localhost:3000`). Because `next.config.js` uses
`output: 'export'`, there is no `next start` server — `next dev` is the
live server used during E2E.

## city-smoke.spec.ts

Visits `/` and asserts the fullscreen `<canvas>` is visible on boot.

> **Expected status (Phase 1):** This test is **red** until the downstream
> task that renders the `<canvas>` in `src/app/page.tsx` lands. That is by
> design — the assertion must not be weakened to an `<h1>` check, or it
> would silently pass before the canvas exists.
