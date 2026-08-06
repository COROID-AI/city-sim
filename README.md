# City Time Period Timelapse

A greenfield, browser-based city simulation that timelapses through five eras:
**1945 → 1965 → 1985 → 2005 → 2025**.

This repository currently contains the **project foundation**: the Vite + React 18 +
TypeScript scaffold, the shared era/transition/audio/effects contracts that all
downstream modules plug into, a keyboard-accessible timeline slider, and a base
three.js (react-three-fiber) canvas with a lit block footprint.

## Stack

- [Vite](https://vite.dev) + React 18 + TypeScript
- [three](https://threejs.org) via [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber)
- [@react-three/drei](https://github.com/pmndrs/drei) (helpers, orbit controls)
- [@react-three/postprocessing](https://github.com/pmndrs/react-postprocessing) (planned effects)
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

## Audio

`src/audio/WebAudioManager.ts` implements the `AudioManager` contract with the
Web Audio API. It procedurally synthesizes per-era ambient beds (oscillators +
noise buffers — no external audio files), crossfades between beds on era
change, plays a synthesized time-shift transition SFX, and exposes volume +
mute. The context is created lazily on the first user gesture to respect
browser autoplay policies.

- `src/audio/synthesis.ts` — procedural per-era bed builders.
- `src/components/AudioManagerBridge.tsx` — wires era transitions to the
  manager and unlocks audio on the first gesture.
- `src/components/AudioControls.tsx` — volume slider + mute toggle in the header.

## Scene

`src/components/CityCanvas.tsx` renders the base R3F canvas with per-era lighting,
a block footprint, a camera, orbit controls, and a placeholder that stubs era
switching (logs pending transitions).
