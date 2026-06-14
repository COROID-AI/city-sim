# city-sim

A deterministic, framework-agnostic **city simulation engine** with a React
UI overlay. The engine layer is pure TypeScript with no React imports; the
UI layer (Next.js-style components) consumes it through a thin prop /
shared-ref boundary.

<!-- hero: docs/hero.png (drop your screenshot here) -->

---

## 1. Pitch

`city-sim` is a small but serious simulation core: a tile-based world, a
time system, an economy, traffic, citizens, and a React overlay that
visualises all of it in real time. The codebase is split into a
**framework-agnostic engine** and a **React UI overlay** so the engine can
be embedded in workers, Node benchmarks, or non-React runtimes without
dragging a view layer with it.

Goals:

- **Determinism** — same seed → same city, every time.
- **Layered** — engine, systems, entities, generation, UI. No cross-layer
  imports.
- **Small** — the entire `dist/` artifact is held under a 2 MB budget by
  CI.
- **Testable** — Jest unit tests with an 80% coverage gate, plus
  Playwright E2E gated to `main`.

## 2. Architecture diagram

```
                        ┌────────────────────────────────────┐
                        │           React UI overlay         │
                        │  src/ui  ·  src/hooks  ·  src/app  │
                        └──────────────┬─────────────────────┘
                                       │ (props / shared ref)
                                       │   no engine → UI imports
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │  src/systems     │    │  src/generation  │    │  src/constants   │
   │  Time, Economy,  │    │  Seeded PRNG,    │    │  Palette,        │
   │  Traffic, Need,  │    │  city layout,    │    │  building-types  │
   │  EventBus        │    │  road graph      │    └──────────────────┘
   └────────┬─────────┘    └────────┬─────────┘
            │                       │
            │   pure TS, no React,  │
            │   no DOM              │
            └───────────┬───────────┘
                        │
                        ▼
              ┌──────────────────────┐
              │     src/engine       │
              │  World, Renderer,    │
              │  Pathfinder, Camera  │
              │  (no React, no DOM   │
              │   imports)           │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │    src/entities      │
              │  Tile, Building,     │
              │  Citizen, Vehicle    │
              └──────────────────────┘
```

**Layer rules**

- `src/engine/**` may import from `src/entities/**` and `src/constants/**`
  only. **No React, no DOM, no `src/ui/`.**
- `src/systems/**` is pure TS. It may import from `src/entities/**` and
  `src/constants/**`. It may emit events through `EventBus` but must not
  import from `src/ui/`, `src/hooks/`, or `src/app/`.
- `src/ui/**` is React-only. It may import from any lower layer.
- `src/app/**` is the host shell (Next.js / Vite / plain HTML) and is the
  only place that wires `engine + systems + UI` together.

These rules are enforced by ESLint (`no-restricted-imports`).

## 3. Features

- **Deterministic seeded world generation** via `mulberry32` PRNG
  (`src/generation/random.ts`). The same seed produces the same city
  layout, traffic graph, and citizen assignments — useful for benchmarks
  and regression tests.
- **Layered simulation** — `TimeSystem` ticks, `EconomySystem` collects
  revenue, `TrafficSystem` routes vehicles on an A\* pathfinder over a
  road graph, `NeedSystem` updates citizen drives, and `EventBus` keeps
  decoupled wiring.
- **Day/night lighting** — palette-driven (`src/constants/palette.ts`),
  no hex literals in the renderer.
- **React UI overlay** — `TimeControls`, `Dashboard`, `CityLog`,
  `MiniMap`. Components are client-side and consume the engine via prop
  or shared ref, not by importing from `src/engine/`.
- **Static build with a 2 MB bundle gate** — `tsc` emits `dist/`, and
  `scripts/bundle-analyzer.mjs` measures it. CI fails if the total
  reaches 2 MB.

## 4. Quick start

```bash
git clone https://github.com/COROID-AI/city-sim.git
cd city-sim
npm ci
npm run lint          # ESLint, no warnings allowed
npm run type-check    # tsc --noEmit
npm run test:unit     # Jest, 80% coverage gate
npm run build         # tsc → dist/
npm run analyze:ci    # bundle-size gate (≤ 2 MB)
```

Then open `index.html` in `public/` against the `dist/` output, or wire
`dist/` into your host of choice. A pre-rendered static `index.html`
lives in `public/` for that purpose.

## 5. Folder map

| Folder         | Purpose                                                   |
| -------------- | --------------------------------------------------------- |
| `src/engine/`  | Pure TS world, renderer, pathfinder, camera. No React.    |
| `src/systems/` | Time, Economy, Traffic, Need, EventBus. Pure TS.          |
| `src/entities/`| Data shapes: Tile, Building, Citizen, Vehicle.            |
| `src/generation/` | Seeded PRNG, city layout, road graph generation.      |
| `src/constants/` | Palette, building-types, tuning tables.                |
| `src/ui/`      | React components: `TimeControls`, `Dashboard`, etc.       |
| `src/hooks/`   | React hooks bridging systems → components.                |
| `src/app/`     | Host shell that wires everything together.                |
| `tests/unit/`  | Jest specs (jsdom).                                       |
| `tests/e2e/`   | Playwright specs against the static `dist/` build.        |
| `scripts/`     | Node CLI tools (bundle analyzer + tests).                 |
| `public/`      | Static assets and the `index.html` entry point.           |
| `docs/`        | Long-form docs (Vercel export decision, hero image).      |
| `.github/`     | CI workflows.                                             |

## 6. Scripts

| Script                | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `npm run lint`        | ESLint over `src/`, `tests/`, and `scripts/`.             |
| `npm run type-check`  | `tsc --noEmit`.                                            |
| `npm run build`       | `tsc` → `dist/`.                                          |
| `npm run test`        | Jest unit tests.                                          |
| `npm run test:coverage` | Same, with coverage. The 80% gate is enforced.          |
| `npm run test:e2e`    | Playwright E2E against the static `dist/` build.          |
| `npm run analyze`     | `ANALYZE=1 node scripts/bundle-analyzer.mjs`. Local use.  |
| `npm run analyze:ci`  | The CI gate. Fails if `dist/` ≥ 2 MB.                     |
| `npm run bench`       | Alias of `analyze:ci`, used by `BENCHMARK.md`.            |
| `npm run tag-v1`      | Tags the current commit as `v1.0.0` (run manually post-merge). |

## 7. Layering rules

These are the architectural invariants the codebase depends on. They are
enforced by `eslint` (`no-restricted-imports`).

- **Engine layer (`src/engine/**`)** is pure TypeScript. No `react`,
  `react-dom`, no imports from `src/ui/`, `src/hooks/`, or `src/app/`.
  It may import from `src/entities/**` and `src/constants/**`.
- **Systems layer (`src/systems/**`)** is pure TS. Allowed deps:
  `src/entities/**`, `src/types/**`, `src/constants/**`. Systems may
  publish events on `EventBus` but must not import from React, hooks,
  components, or the app shell.
- **UI layer (`src/ui/**`)** is React. It may import from any lower
  layer but never the other way around.
- **App shell (`src/app/**`)** is the only place that wires engine,
  systems, and UI together.

## 8. Bundle budget

The `tsc` build emits `dist/`. The CI gate
(`scripts/bundle-analyzer.mjs --max-mb 2`) fails the build if the
total reaches 2 MB. The default is locked at 2 MB; an emergency
override (`--max-mb 4`) is possible locally but the script will still
fail in CI unless the workflow is updated. See
`docs/vercel-export-check.md` for why we do not use Vercel's hosting
plumbing and treat the bundle gate as the v1.0.0 release signal.

How to keep the bundle small:

- **Tree-shake** — keep exports in `src/constants/**` and
  `src/entities/**` side-effect-free.
- **Don't bundle constants twice** — import from `@/constants/*` rather
  than re-declaring literal tables in components.
- **Watch the renderer** — palette tokens in `src/constants/palette.ts`
  are the single source of truth; do not paste hex literals into
  `src/engine/Renderer.ts`.
- **Run `npm run analyze` locally** before pushing. The folder-grouped
  table shows which layer is heaviest, so you can target the fix.

## 9. Release

The v1.0.0 tag is created **manually by a maintainer** after the merge
commit lands on `main`:

```bash
# After PR merge, on main, with a clean working tree:
npm run tag-v1
git push origin v1.0.0
```

The release signal is the green CI run (lint + type-check + tests +
build + bundle gate). See `docs/vercel-export-check.md` for why a
green bundle gate **is** the v1.0.0 release signal for this project.
