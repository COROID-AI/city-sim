# Benchmark

A reproducible snapshot of the city-sim project's performance and size
characteristics at v1.0.0. The numbers below are filled in by maintainers
as the project evolves; the **gates** are enforced in CI.

## 1. Environment

- Node.js: 20.x
- TypeScript: 5.4.x
- OS: Ubuntu 22.04 (CI runner)
- Flags: `tsc -p tsconfig.json` (release build, no source maps)

## 2. Build size (CI gate)

The `tsc` build emits `dist/`. The bundle analyzer
(`scripts/bundle-analyzer.mjs --max-mb 2`) fails CI if the total is
≥ 2 MB. This is the **release signal** for v1.0.0.

| Gate | Limit  | Source                                 |
| ---- | ------ | -------------------------------------- |
| `dist/` total | **≤ 2.0 MB** | `scripts/bundle-analyzer.mjs` |

To reproduce locally:

```bash
npm ci
npm run build
npm run bench
```

## 3. Unit-test coverage (CI gate)

Jest enforces an 80% lines / functions / statements gate and a 70%
branches gate, plus per-file floors for the four systems with
dedicated tests.

| Suite | Gate |
| ----- | ---- |
| `global` | lines ≥ 80, functions ≥ 80, statements ≥ 80, branches ≥ 70 |
| `src/systems/EconomySystem.ts` | lines ≥ 80 |
| `src/systems/TimeSystem.ts`     | lines ≥ 80 |
| `src/systems/EventBus.ts`       | lines ≥ 80 |
| `src/systems/NeedSystem.ts`     | lines ≥ 80 |

## 4. Determinism check

The seeded PRNG (`src/generation/random.ts`, mulberry32) must produce
identical city layouts for identical seeds. The check is a unit test
under `tests/unit/generation/` that compares two generations of the
same seed byte-for-byte.

| Property | Gate |
| -------- | ---- |
| Same seed → same tile grid | exact match |
| Same seed → same citizen assignments | exact match |
| Same seed → same road graph edges | exact match |

## 5. Time to first frame (TTFF)

A headless Playwright run against the static `dist/` build measures
how long it takes from `goto` to the first rendered frame.

| Scenario | Target |
| -------- | ------ |
| Cold load, default seed | ≤ 1.5 s |
| Warm load (cached)      | ≤ 0.5 s |

## 6. Simulation tick budget

A single tick of the simulation (TimeSystem + Economy + Traffic +
Need + EventBus dispatch) must complete inside a frame budget on a
modest machine.

| Tick size | Budget |
| --------- | ------ |
| 100 citizens, 25 buildings, 1× speed | ≤ 8 ms |
| 1 000 citizens, 250 buildings, 1× speed | ≤ 16 ms |

## 7. Reproducing locally

```bash
# Build + size gate
npm ci
npm run build
npm run bench

# Unit + coverage
npm run test:coverage

# E2E + TTFF
npm run test:e2e:install
npm run test:e2e
```

Record the results in the table below. New rows go on top so the
latest run is the first thing a reader sees.

| Date | Commit | `dist/` total | Tick (100 / 1 000) | TTFF | Notes |
| ---- | ------ | ------------- | ------------------ | ---- | ----- |
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
