# city-sim

A small browser-based city simulator built with **Next.js 15 (static export)** + **Tailwind v4** + **TypeScript (strict)**.

## Architecture

```
src/
  app/                # Next.js App Router
  components/
    city/             # Game canvases (Citizen renderer, vehicle layer, etc.)
    ui/               # shadcn primitives
  entities/           # Pure data: Citizen
  hooks/              # React hooks
  lib/                # Pure helpers (RNG, etc.)
  styles/             # Tailwind v4 @theme tokens (globals.css)
  systems/            # Pure-TS simulation (TimeSystem, NeedSystem, CityGenerator)
  types/              # Shared type definitions
tests/
  unit/               # Jest (jsdom + ts-jest)
  e2e/                # Playwright against `./out` served via http-server
```

The `systems/` and `entities/` layers are **framework-agnostic** — no React, no DOM, no engine coupling. They are pure TypeScript and can be unit-tested in isolation.

## Scripts

```bash
npm install
npm run lint         # ESLint (no-explicit-any: error)
npm run typecheck    # tsc --noEmit (strict)
npm test             # Jest unit tests
npm run build        # Next.js static export to ./out
```

## Citizens, needs and schedules

- `src/entities/Citizen.ts` defines the `Citizen` shape (Vector2 position, energy/hunger/fun/social needs, `currentActivity`, 24h `schedule`, `workplaceId`/`homeId`).
- `src/systems/TimeSystem.ts` is the single source of truth for the in-game clock. Implements a `TimeProvider` interface.
- `src/systems/NeedSystem.ts` reads the current hour from a `TimeProvider` and advances each citizen's `currentActivity` from their schedule. Need values drift according to a per-activity delta matrix and are clamped to `[0, 100]`.
- `src/systems/CityGenerator.ts` spawns 50–100 citizens with 24h schedules and assigns ~70% of them a workplace via deterministic round-robin over the available workplace buildings.
