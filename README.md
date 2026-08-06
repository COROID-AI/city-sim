# City Time Period Timelapse

A greenfield, browser-based city simulation that timelapses through five eras:
**1945 → 1965 → 1985 → 2005 → 2025**.

The app composes every content module — buildings, vehicles, storefronts & ads,
pedestrians, and the street/environment — into one main scene around the block
footprint, together with post-processing effects and the procedural audio
manager. Selecting an era on the timeline plays a cinematic morph: the whole
city transforms in front of your eyes, with crossfaded geometry, blended
lighting/sky, blended effects, a transition SFX and crossfaded ambience.

## Stack

- [Vite](https://vite.dev) + React 18 + TypeScript
- [three](https://threejs.org) via [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber)
- [@react-three/drei](https://github.com/pmndrs/drei) (helpers, orbit controls)
- [@react-three/postprocessing](https://github.com/pmndrs/react-postprocessing) (bloom, AO, vignette, noise, color grade)
- [zustand](https://github.com/pmndrs/zustand) (era state)
- ESLint + Prettier (dev tooling)

## Scripts

| Command                | Description                     |
| ---------------------- | ------------------------------- |
| `npm run dev`          | Start the Vite dev server       |
| `npm run build`        | Type-check and production build |
| `npm run preview`      | Preview the production build    |
| `npm run lint`         | Run ESLint                      |
| `npm run format`       | Format all files with Prettier  |
| `npm run format:check` | Check formatting with Prettier  |

## Shared contracts

Downstream modules import from `src/contracts` (barrel: `src/contracts/index.ts`).

- **`EraId`** — union type `'1945' | '1965' | '1985' | '2005' | '2025'` (`src/contracts/era.ts`)
- **Era registry** — `ERA_REGISTRY` maps every `EraId` to an `EraDescriptor`
  (label, year, mood, lighting hints).
- **`TransitionContext`** — `{ fromEra, toEra, progress (0..1), durationMs }` for
  cross-era morphs (`src/contracts/transition.ts`).
- **`AudioManager`** — interface for era ambience, transition SFX, volume, and
  mute (`src/contracts/audio.ts`).
- **`EffectsConfig`** — per-era post-processing settings (`src/contracts/effects.ts`).

## State

`src/store/useEraStore.ts` holds `currentEra` and a pending `transition` request.
The timeline slider writes selections to this store; the scene reads from it.
`src/store/useAudioStore.ts` holds the UI-facing volume + mute state.

## Content modules

Each module is a self-contained R3F layer keyed off the shared era registry and
exposed through its own barrel:

| Module            | Source                            | Renders                                                  |
| ----------------- | --------------------------------- | -------------------------------------------------------- |
| Buildings         | `src/buildings`                   | Era-correct block composition (form, materials, windows) |
| Vehicles          | `src/vehicles`                    | Era fleet driving looping paths around the block         |
| Storefronts & ads | `src/storefronts`                 | Era signage, awnings, neon, posters, billboards          |
| Pedestrians       | `src/pedestrians`                 | Sidewalk crowd with per-era density, outfits, gait       |
| Street & env      | `src/street`                      | Road, furniture, procedural sky, lighting mood           |
| Effects           | `src/effects/EffectsPipeline.tsx` | Bloom, AO, vignette, noise, color grade per era          |
| Audio             | `src/audio/WebAudioManager.ts`    | Procedural ambience beds + synthesized transition SFX    |

## Scene & era-transition orchestration

`src/components/CityCanvas.tsx` composes every module into the main scene.

`src/transitions/TransitionManager.tsx` is the orchestrator. When the timeline
slider requests an era change it drives a `TransitionContext`
(`fromEra → toEra`, `progress` 0..1 over `durationMs`) from the era store's
pending request and publishes it through React context:

- `src/transitions/EraCrossfade.tsx` crossfades the era-variant layers
  (buildings, vehicles, storefronts/ads, pedestrians) — the outgoing era
  dissolves out while the incoming era emerges, and material opacity/shadow
  state is restored afterwards.
- `src/transitions/BlendedStreetEnvironment.tsx` blends the sky, lighting rig
  and road surface continuously while crossfading era-specific street
  furniture.
- `src/transitions/blend.ts` provides the lerp helpers (colors, vectors,
  numbers).
- Lighting/sky mood and background/fog colors interpolate between eras.
- `EffectsPipeline` interpolates the per-era effects config during a morph.
- The manager triggers the transition SFX and crossfades the ambience beds
  through the shared audio manager in lock step with the visuals.

`src/components/AudioManagerBridge.tsx` unlocks audio on the first user gesture
and fades in the current era's bed; the transition manager drives every
subsequent era change.

## Loading state

`src/App.tsx` shows a small loading indicator over the stage until the canvas
reports its first painted frame (`onReady`), so era swaps never pop against an
empty scene.
