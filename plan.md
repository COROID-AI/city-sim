# City Sim — Execution Plan

> 8-phase autonomous build plan executed by **Coroid** inside the **Dark Factory** pipeline.

---

## Overview

This plan decomposes the City Sim specification ([spec.md](spec.md)) into eight sequential phases. Each phase produces verifiable artifacts and is gated by build, lint, and test checks before the next phase begins.

---

## Phase 1 — Scaffold & Configuration

**Goal:** Initialize the Next.js project, tooling, and directory structure.

- Next.js 15.5 + React 18.3 + TypeScript 5.7 strict.
- TailwindCSS 3.4 + PostCSS + Autoprefixer.
- ESLint 9 flat config + Prettier.
- Jest 29 + ts-jest + Testing Library; Playwright 1.50.
- `next.config.js` with `output: 'export'`, `distDir: 'dist'`.
- Path alias `@/` → `src/`.
- Establish `src/` tree: `app`, `config`, `constants`, `engine`, `entities`, `generation`, `systems`, `ui`, `__tests__`.

**Exit criteria:** `npm run build` and `npm run lint` pass on an empty-but-valid scaffold.

---

## Phase 2 — Engine Core

**Goal:** Implement the simulation engine foundation.

- `GameLoop` — fixed-timestep update/render loop.
- `World` — entity container and shared state.
- `Camera` — pan, zoom, and lerp smoothing.
- `Pathfinder` — road-network pathfinding for citizens/vehicles.
- `BenchmarkReporter` — captures FPS and timing telemetry.

**Exit criteria:** Engine modules unit-tested and passing.

---

## Phase 3 — Systems & Entities

**Goal:** Implement the simulation logic and entity types.

- Entities: `Entity` (base), `Citizen`, `Vehicle`, `Road`.
- Systems: `TimeSystem`, `MovementSystem`, `TrafficSystem`, `NeedSystem`, `CommuteSystem`, `ScheduleGenerator`, `BusinessHoursSystem`, `EventBus`.
- Procedural generation: city layout, name generation.

**Exit criteria:** Systems and entities unit-tested; coverage ≥ 80% for `src/systems/**`.

---

## Phase 4 — Rendering & Sprites

**Goal:** Implement the Canvas 2D renderer and asset pipeline.

- `Renderer` — sprite batching, draw ordering.
- `SpriteLoader` — async sprite atlas loading.
- `Lighting` — day/night cycle and dynamic lighting.
- Renderer optimizations (culling, batching).

**Exit criteria:** Renderer unit-tested; sprites load without errors.

---

## Phase 5 — UI & Interaction

**Goal:** Build the React + Tailwind UI overlay.

- `Dashboard`, `MiniMap`, `TimeControls`, `CityLog`, `Tooltip`, `LoadingScreen`.
- Decouple UI from engine via `EventBus`.
- Responsive layout.

**Exit criteria:** UI components unit-tested; responsive across breakpoints.

---

## Phase 6 — Testing & QA

**Goal:** Achieve full test coverage and E2E validation.

- Colocated `.test.ts(x)` per module.
- Coverage ≥ 80% for `src/engine/**` and `src/systems/**`.
- Playwright E2E: stable 60-second simulation run, no console errors.

**Exit criteria:** `npm test` and `npm run e2e` pass; coverage thresholds met.

---

## Phase 7 — Polish & Effects

**Goal:** Add camera lerp, particle effects, loading screen, and responsive CSS.

- Smooth camera interpolation.
- Particle effects (emissions, ambient).
- Loading screen during asset init.
- Responsive CSS / Tailwind tuning.

**Exit criteria:** Visual polish verified; FPS remains stable.

---

## Phase 8 — Documentation, Benchmarking & Deployment

**Goal:** Produce open-source-ready documentation and benchmarking templates.

- `README.md` — setup, architecture, tech stack, project structure, screenshot.
- `BENCHMARK.md` — template tables (AI profile, tokens, cost, build time, phases, coverage, VCS, SDS, FPS, notes).
- `LICENSE` — MIT (copyright COROID-AI).
- `spec.md` and `plan.md` artifacts in repo root.
- GitHub Actions CI, bundle-size analysis, and benchmark instrumentation.

**Exit criteria:** All five root documents present and valid; CI wired to populate `BENCHMARK.md`.

---

## Directory Structure (Target)

```
city-sim/
├── public/assets/{hero.png, sprites/}
├── src/{app, config, constants, engine, entities, generation, systems, ui, __tests__}
├── README.md
├── BENCHMARK.md
├── spec.md
├── plan.md
├── LICENSE
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
├── postcss.config.mjs
└── eslint.config.mjs
```

---

## Phase Summary

| Phase | Name                                 | Key Deliverable                  |
|-------|--------------------------------------|----------------------------------|
| 1     | Scaffold & Configuration             | Next.js + tooling scaffold       |
| 2     | Engine Core                          | GameLoop, World, Camera          |
| 3     | Systems & Entities                   | Simulation logic + entities      |
| 4     | Rendering & Sprites                  | Canvas renderer + sprite loader  |
| 5     | UI & Interaction                     | React UI overlay                 |
| 6     | Testing & QA                         | Coverage ≥ 80% + E2E             |
| 7     | Polish & Effects                     | Camera lerp, particles, loading  |
| 8     | Documentation, Benchmarking & Deploy | Docs, benchmarks, CI             |
