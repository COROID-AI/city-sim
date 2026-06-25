# Benchmark — City Sim (Coroid · Dark Factory)

> This document is a **template**. All values are `TBD` placeholders to be populated post-execution and by CI benchmark instrumentation (see the downstream _GitHub Actions CI, bundle-size analysis, and benchmark instrumentation_ task). Metrics follow spec §10.2.

_Last updated: TBD_

---

## 1. AI Profile

| Field              | Value   |
|--------------------|---------|
| Orchestrator       | Coroid  |
| Pipeline           | Dark Factory |
| Architect model    | TBD     |
| Developer model    | TBD     |
| QA model           | TBD     |
| Reviewer model     | TBD     |
| Run ID             | TBD     |
| Date               | TBD     |

---

## 2. Token Usage

| Metric                  | Value |
|-------------------------|-------|
| Total tokens (input)    | TBD   |
| Total tokens (output)   | TBD   |
| Total tokens (combined) | TBD   |
| Tokens / source line    | TBD   |

---

## 3. Cost

| Metric                | Value |
|-----------------------|-------|
| Total cost (USD)      | TBD   |
| Cost / source line    | TBD   |
| Cost / test           | TBD   |

---

## 4. Build Time

| Metric                          | Value |
|---------------------------------|-------|
| Wall-clock build time (total)   | TBD   |
| Wall-clock build time (build)   | TBD   |
| `npm install` duration          | TBD   |
| `npm run build` duration        | TBD   |
| `npm test` duration             | TBD   |
| `npm run e2e` duration          | TBD   |

---

## 5. Phase Durations

| Phase | Name                                   | Duration | Status |
|-------|----------------------------------------|----------|--------|
| 1     | Scaffold & Configuration               | TBD      | TBD    |
| 2     | Engine Core                            | TBD      | TBD    |
| 3     | Systems & Entities                     | TBD      | TBD    |
| 4     | Rendering & Sprites                    | TBD      | TBD    |
| 5     | UI & Interaction                       | TBD      | TBD    |
| 6     | Testing & QA                           | TBD      | TBD    |
| 7     | Polish & Effects                       | TBD      | TBD    |
| 8     | Documentation, Benchmarking & Deploy   | TBD      | TBD    |

---

## 6. Test Coverage

| Metric                          | Value |
|---------------------------------|-------|
| Statement coverage (%)          | TBD   |
| Branch coverage (%)             | TBD   |
| Function coverage (%)           | TBD   |
| Line coverage (%)               | TBD   |
| `src/engine/**` coverage (%)    | TBD   |
| `src/systems/**` coverage (%)   | TBD   |
| Coverage threshold (required)   | ≥ 80% |
| Unit tests passed / total       | TBD   |
| E2E tests passed / total        | TBD   |

---

## 7. Quality Scores

| Metric                                  | Value | Scale  |
|-----------------------------------------|-------|--------|
| VCS — Visual Code Similarity            | TBD   | 0–100  |
| SDS — Spec Drift Score                  | TBD   | 0–100  |
| Lint errors                             | TBD   | count  |
| Lint warnings                           | TBD   | count  |
| TypeScript errors (`tsc --noEmit`)      | TBD   | count  |

> **VCS** (0–100): higher is better — measures how closely the rendered output matches the reference visual target.
> **SDS** (0–100): lower is better — measures drift between the implemented code and the original specification.

---

## 8. FPS Stability

| Metric                          | Value |
|---------------------------------|-------|
| Target FPS                      | 60    |
| Average FPS (60s run)           | TBD   |
| Min FPS (60s run)               | TBD   |
| Max FPS (60s run)               | TBD   |
| 1% low FPS                      | TBD   |
| Frame drops (60s run)           | TBD   |
| Stable 60s run (Pass/Fail)      | TBD   |

---

## 9. Bundle Size

| Metric                          | Value |
|---------------------------------|-------|
| Total static export size        | TBD   |
| Largest JS chunk (KB)           | TBD   |
| First-load JS (KB)              | TBD   |

---

## 10. Notes

| Category | Notes |
|----------|-------|
| General  | TBD   |
| Risks    | TBD   |
| Deviations from spec | TBD |
| Follow-ups | TBD |

---

_All values marked `TBD` are placeholders. Populate manually after execution or via CI benchmark instrumentation._
