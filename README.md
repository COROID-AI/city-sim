# City Sim — Coroid · Dark Factory

> A real-time, browser-based city simulation rendered on HTML5 Canvas. Built end-to-end by **Coroid** inside the **Dark Factory** autonomous build pipeline — from specification to deployable static bundle with zero hand-written UI boilerplate.

![City Sim hero render](public/assets/hero.png)

_City Sim generates a living procedural city — citizens commute, traffic flows, needs decay and regenerate, and a day/night lighting cycle sweeps across an isometric-style map — all at a stable 60 FPS in the browser._

---

## 📑 Table of Contents

- [About](#about)
- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Benchmarking](#benchmarking)
- [License](#license)

---

## About

**City Sim** is a greenfield Next.js + TypeScript application that simulates a procedural city in real time using a custom Canvas 2D engine. It was produced by **Coroid**, the AI agent orchestrator of the **Dark Factory** build system, as a demonstration of fully autonomous specification → implementation → verification → deployment.

The simulation features an ECS-like architecture: a fixed-timestep `GameLoop` drives a `World` of entities through a pipeline of `Systems` (time, movement, traffic, needs, commute, scheduling), and a `Renderer` paints sprites, lighting, and particle effects to a single `<canvas>`. The UI layer (dashboard, minimap, time controls, city log, tooltips, loading screen) is React + Tailwind, decoupled from the engine via an `EventBus`.

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10

### Install

```bash
npm install
```

### Develop

Start the Next.js dev server (hot reload at `http://localhost:3000`):

```bash
npm run dev
```

### Build

Produce a static export into `dist/` (configured via `output: 'export'`):

```bash
npm run build
```

### Test

Run the Jest unit-test suite:

```bash
npm test
```

With coverage report:

```bash
npm run test:coverage
```

### Lint

```bash
npm run lint
```

### End-to-End (Playwright)

```bash
npm run e2e
```

---

## Architecture Overview

City Sim follows an **ECS-like (Entity–Component–System)** design with a clear separation between the simulation engine and the React UI shell.

```
┌──────────────────────────────────────────────────────────┐
│                        React UI                          │
│   Dashboard · MiniMap · TimeControls · CityLog · Tooltip │
│                       LoadingScreen                      │
└───────────────▲──────────────────────────┬──────────────┘
                │ EventBus (pub/sub)       │ React state
┌───────────────┴──────────────────────────▼──────────────┐
│                      Game Loop                           │
│            fixed-timestep (requestAnimationFrame)        │
└───────────────▲──────────────────────────┬──────────────┘
                │ tick(dt)                 │ render(ctx)
┌───────────────┴──────────┐   ┌────────────▼─────────────┐
│       Systems            │   │        Renderer          │
│ Time · Movement · Traffic│   │  sprites · lighting ·    │
│ Need · Commute · Schedule│   │  particles · camera      │
└───────────────▲──────────┘   └────────────▲─────────────┘
                │ mutates                    │ reads
┌───────────────┴────────────────────────────┴─────────────┐
│                        World                             │
│     Entities: Citizen · Vehicle · Road · Entity(base)    │
│            Components: position, needs, schedule, route   │
└──────────────────────────────────────────────────────────┘
```

**Data flow:**

1. The **GameLoop** advances the simulation on a fixed timestep and invokes each **System** in order.
2. **Systems** read and mutate **Entities** inside the **World** (citizens move, vehicles route through traffic, needs decay over time).
3. The **Renderer** reads the current **World** state and draws sprites, dynamic lighting, and particle effects to the canvas, transformed by the **Camera** (pan + lerp).
4. State changes are broadcast over the **EventBus** so the React UI can react without coupling to engine internals.

---

## Tech Stack

| Layer            | Technology                                         |
 |------------------|----------------------------------------------------|
| Framework        | Next.js 15.5 (App Router, static export)           |
| Language         | TypeScript 5.7 (strict, zero `any`)               |
| UI Library       | React 18.3                                         |
| Styling          | TailwindCSS 3.4 + PostCSS + Autoprefixer           |
| Rendering        | HTML5 Canvas 2D (custom engine)                    |
| Unit Testing     | Jest 29 + ts-jest + Testing Library                |
| E2E Testing      | Playwright 1.50                                    |
| Linting          | ESLint 9 (flat config) + Prettier                  |
| Build Target     | Static export → `dist/`                            |

---

## Project Structure

```
city-sim/
├── public/
│   └── assets/
│       ├── hero.png              # Screenshot / hero render
│       └── sprites/              # Sprite atlas assets
├── src/
│   ├── app/                      # Next.js App Router pages & layout
│   ├── config/                   # App & engine configuration
│   ├── constants/                # Simulation & render constants
│   ├── engine/                   # Core simulation engine
│   │   ├── Renderer.ts
│   │   ├── GameLoop.ts
│   │   ├── Camera.ts
│   │   ├── Lighting.ts
│   │   ├── Pathfinder.ts
│   │   ├── World.ts
│   │   ├── SpriteLoader.ts
│   │   └── BenchmarkReporter.ts
│   ├── entities/                 # Entity definitions
│   │   ├── Entity.ts             # Base class
│   │   ├── Citizen.ts
│   │   ├── Vehicle.ts
│   │   └── Road.ts
│   ├── systems/                  # Simulation systems
│   │   ├── TimeSystem.ts
│   │   ├── MovementSystem.ts
│   │   ├── TrafficSystem.ts
│   │   ├── NeedSystem.ts
│   │   ├── CommuteSystem.ts
│   │   ├── EventBus.ts
│   │   ├── ScheduleGenerator.ts
│   │   └── BusinessHoursSystem.ts
│   ├── generation/               # Procedural generation (names, city)
│   ├── ui/                       # React UI components
│   │   ├── Dashboard.tsx
│   │   ├── MiniMap.tsx
│   │   ├── TimeControls.tsx
│   │   ├── CityLog.tsx
│   │   ├── Tooltip.tsx
│   │   └── LoadingScreen.tsx
│   └── __tests__/                # Jest unit tests (colocated by domain)
│       ├── engine/
│       ├── entities/
│       ├── systems/
│       ├── generation/
│       ├── ui/
│       └── e2e/                  # Playwright specs
├── BENCHMARK.md                  # Build & quality benchmark template
├── spec.md                       # Project specification
├── plan.md                       # 8-phase execution plan
├── LICENSE                       # MIT
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
├── postcss.config.mjs
└── eslint.config.mjs
```

---

## Testing

- **Unit tests** — Jest + ts-jest in a jsdom environment. Each engine, system, entity, and UI module ships a colocated `.test.ts(x)` file. Coverage threshold ≥ 80% is enforced for `src/engine/**` and `src/systems/**`.
- **E2E tests** — Playwright drives a headless browser against the dev server, asserting a stable 60-second simulation run with no console errors.

```bash
npm test            # unit suite
npm run test:coverage
npm run e2e         # Playwright
```

---

## Benchmarking

Build-time and quality metrics are recorded in [`BENCHMARK.md`](BENCHMARK.md). The template is populated post-execution (and by CI instrumentation) with values for AI profile, token usage, cost, wall-clock build time, phase durations, test coverage, **VCS** (Visual Code Similarity, 0–100), **SDS** (Spec Drift Score, 0–100), and FPS stability.

---

## License

Released under the [MIT License](LICENSE). Copyright © COROID-AI.
