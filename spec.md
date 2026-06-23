# City Sim — Project Specification

> Authored by **Coroid** within the **Dark Factory** autonomous build pipeline.

---

## 1. Project Goals

Build a **real-time, browser-based city simulation** rendered on HTML5 Canvas that:

1. Generates a **procedural city** (roads, buildings, citizens, vehicles) at startup.
2. Simulates a **living world**: citizens commute between home and work, traffic flows along roads, needs decay and regenerate on a schedule.
3. Renders at a **stable 60 FPS** in a modern browser using a custom Canvas 2D engine.
4. Presents a polished **React + Tailwind UI** (dashboard, minimap, time controls, city log, tooltips, loading screen) decoupled from the engine via an event bus.
5. Is **fully autonomous in origin**: specified, implemented, tested, and documented by AI agents with no hand-written boilerplate.

---

## 2. Scope

- **In scope:** simulation engine, rendering, procedural generation, UI overlay, unit + E2E tests, static export build, documentation, benchmarking templates.
- **Out of scope:** backend services, persistence/database, multiplayer, mobile-native packaging.

---

## 3. Technical Constraints

| Constraint            | Requirement                                              |
|-----------------------|----------------------------------------------------------|
| Framework             | Next.js 15+ App Router                                   |
| Language              | TypeScript 5 strict mode (zero `any`)                    |
| UI Library            | React 18+ (NOT React 19)                                 |
| Styling               | TailwindCSS 3 (classic `tailwind.config.ts`)             |
| Linting               | ESLint 9 flat config + Prettier                          |
| Unit Testing          | Jest 29 + ts-jest (jsdom) + Testing Library              |
| E2E Testing           | Playwright                                               |
| Build Output          | Static export (`output: 'export'`, `distDir: 'dist'`)    |
| Coverage Threshold    | ≥ 80% for `src/engine/**` and `src/systems/**`           |
| License               | MIT                                                      |

---

## 4. Architecture

ECS-like design:

- **GameLoop** — fixed-timestep driver (`requestAnimationFrame`).
- **World** — container for all entities and shared state.
- **Systems** — TimeSystem, MovementSystem, TrafficSystem, NeedSystem, CommuteSystem, ScheduleGenerator, BusinessHoursSystem, EventBus.
- **Entities** — Entity (base), Citizen, Vehicle, Road.
- **Engine** — Renderer, Camera, Lighting, Pathfinder, SpriteLoader, BenchmarkReporter.
- **UI** — Dashboard, MiniMap, TimeControls, CityLog, Tooltip, LoadingScreen.

---

## 5. Directory Structure

Per spec §5.2 / §9.1, the repository root must contain:

- `spec.md` — this specification.
- `plan.md` — the phased execution plan.
- `README.md` — setup & architecture documentation.
- `BENCHMARK.md` — build & quality benchmark template.
- `LICENSE` — MIT license.

Source lives under `src/` with colocated `.test.ts(x)` files per module (`src/engine`, `src/systems`, `src/entities`, `src/generation`, `src/ui`, `src/app`).

---

## 6. Benchmarking

Per spec §3.6 / §10.2, `BENCHMARK.md` records (as `TBD` placeholders, populated post-execution):

- AI profile (models, run ID)
- Total tokens (input/output/combined)
- Total cost (USD)
- Wall-clock build time
- Phase durations
- Test coverage
- **VCS** — Visual Code Similarity (0–100)
- **SDS** — Spec Drift Score (0–100)
- FPS stability (avg/min/max, 60s stable run)
- Notes

---

## 7. Success Criteria

1. `npm run build` produces a static export in `dist/` with zero TypeScript errors.
2. `npm test` passes with coverage ≥ 80% for `src/engine/**` and `src/systems/**`.
3. `npm run lint` passes with zero errors.
4. Playwright E2E confirms a stable 60-second simulation run with no console errors.
5. The simulation renders at a stable ~60 FPS.
6. The UI is responsive and the loading screen displays during asset initialization.
7. **Documentation** (`README.md`, `spec.md`, `plan.md`, `BENCHMARK.md`, `LICENSE`) is complete and open-source-ready.
8. **Benchmark template** (`BENCHMARK.md`) captures all required metrics with placeholder values.

---

## 8. Quality Metrics

| Metric                  | Target          |
|-------------------------|-----------------|
| TypeScript errors       | 0               |
| ESLint errors           | 0               |
| Unit test coverage      | ≥ 80% (engine/systems) |
| FPS                     | ~60 stable      |
| VCS                     | High (0–100)    |
| SDS                     | Low (0–100)     |
| Bundle (first-load JS)  | Minimize        |
