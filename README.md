# City Time Period Timelapse

A greenfield 3D city-sim that morphs a city block through five eras:
**1945, 1965, 1985, 2005, 2025**.

This repository is the **foundation scaffold** — it provides the shared
contracts, the era timeline UI, the base 3D canvas, and the global era store
that all downstream modules plug into.

## Stack

- **Vite + React 18 + TypeScript**
- **three** + **@react-three/fiber** (R3F) + **@react-three/drei**
  - **@react-three/postprocessing**
- **zustand** for shared era state
- **eslint** + **prettier** for dev tooling

## Scripts

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Start the Vite dev server                |
| `npm run build`        | Type-check (`tsc -b`) + production build |
| `npm run preview`      | Preview the production build             |
| `npm run lint`         | Run ESLint                               |
| `npm run format`       | Format all files with Prettier           |
| `npm run format:check` | Verify Prettier formatting               |

## Shared contracts

All contracts live in [`src/contracts`](src/contracts) and are re-exported
from `src/contracts/index.ts`:

- `EraId` — union `1945 | 1965 | 1985 | 2005 | 2025`
- `ERA_REGISTRY` — maps each `EraId` to an `EraDescriptor` (label, year, mood,
  lighting/palette hints)
- `TransitionContext` — cross-era morph descriptor (`fromEra`, `toEra`,
  `progress` 0..1, `durationMs`)
- `AudioManager` — audio ambience/SFX/volume/mute contract (with a no-op stub)
- `EffectsConfig` + `EFFECTS_BY_ERA` — post-processing settings keyed by era

## State

The zustand store in [`src/store/useEraStore.ts`](src/store/useEraStore.ts)
holds `currentEra` and a `transitionRequest`, plus actions to select an era and
clear a consumed transition.

## UI

- **TimelineSlider** — top timeline exposing exactly the five era options,
  keyboard-accessible (arrow keys, Home/End, Enter), writing selection to the
  shared store.
- **CityScene** — base R3F canvas with an empty lit block footprint, camera,
  orbit controls, and a transition stub that logs era switches so the app runs
  standalone.

## Storefronts & advertisements module

The self-contained module in [`src/modules/storefronts`](src/modules/storefronts)
renders era-correct storefronts and advertisements keyed off the foundation
`EraId` registry. It is intentionally _not_ wired into `CityScene` yet —
integration happens in a later phase.

- `StorefrontsAds` — the exported component. Accepts `era`, `isNight`,
  `includeLighting`, and `position`. Signage is authored via procedural
  geometry + canvas-generated textures (typography + logos) applied as `map`
  and `emissiveMap`; emissive intensity scales with day/night so the night
  glow reads clearly.
- Per-era content lives in `eraConfig.ts`: 1945 hand-painted signage, awnings,
  emerging neon, sepia posters; 1965 mid-century signage, glossy enamel,
  Pop-art posters; 1985 backlit plastic signs, fluorescent storefronts,
  neon/light-box ads; 2005 digital-print light boxes, vinyl banners, corporate
  signage; 2025 dynamic LED/digital signage, animated media facades, minimal
  signage, and digital ad loops.

### Standalone preview

Open `storefronts-preview.html` (dev server) to flip through all five eras and
toggle day/night in a dedicated canvas. This is a verification harness only.
