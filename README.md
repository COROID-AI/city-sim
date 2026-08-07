# City Time Period Timelapse

A browser-based 3D city-block timelapse that morphs a single city block through
five time periods: **1945 → 1965 → 1985 → 2005 → 2025**.

This repository is the **foundation scaffold**. It wires up the tooling, the
shared contracts downstream modules plug into, the timeline UI, and a base 3D
canvas that runs standalone.

## Stack

- **Vite 7** + **React 18** + **TypeScript** (strict)
- **Three.js** + **@react-three/fiber** + **@react-three/drei** +
  **@react-three/postprocessing**
- **zustand** for era/transition state
- **ESLint 9** (flat config) + **Prettier**

## Scripts

| Command                | Description                                |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start the Vite dev server                  |
| `npm run build`        | Type-check (`tsc --noEmit`) + production build |
| `npm run preview`      | Preview the production build               |
| `npm run lint`         | Run ESLint                                 |
| `npm run format`       | Format with Prettier                       |
| `npm run format:check` | Check formatting with Prettier             |
| `npm run typecheck`    | Run the TypeScript type-check only         |

## Shared contracts

All shared contracts live in [`src/contracts`](./src/contracts) and are
re-exported from the barrel [`src/contracts/index.ts`](./src/contracts/index.ts).
Downstream modules import from this single entry point.

- **`EraId`** — union type `'1945' | '1965' | '1985' | '2005' | '2025'`
  (`era.ts`).
- **Era registry** — `ERA_REGISTRY` maps each `EraId` to an `EraDescriptor`
  (`label`, `year`, `mood`, `lightingHints` placeholder) (`era.ts`).
- **`TransitionContext`** — cross-era morph context (`fromEra`, `toEra`,
  `progress` in `[0, 1]`, `durationMs`) (`transition.ts`).
- **`AudioManager`** — audio subsystem contract (`loadEraAmbience`,
  `stopEraAmbience`, `playTransitionSfx`, `setVolume`, `setMuted`) (`audio.ts`).
- **`EffectsConfig`** — post-processing settings keyed by era (`effects.ts`).

## State

The zustand store in [`src/state/useSimStore.ts`](./src/state/useSimStore.ts)
holds `currentEra` and an optional in-flight `transition`, and exposes
`requestTransition(toEra)` which the timeline slider calls on selection.

## App layout

- `src/components/TimelineSlider.tsx` — top timeline with exactly the five era
  options (keyboard-accessible radio group) wired to the store.
- `src/components/CityCanvas.tsx` — base R3F canvas with lighting, camera
  (`OrbitControls`), and the block footprint.
- `src/components/BlockFootprint.tsx` — empty lit block footprint (ground plane
  + placeholder block).
- `src/components/EraSwitcherStub.tsx` — placeholder that logs era switching /
  transitions so the app runs standalone. Real cross-era morphs are authored by
  later tasks against the shared contracts.
