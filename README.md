# Coroid Time City — 3D Time-Period City Simulation

A browser-based 3D city simulation built with **Next.js 15**, **React Three Fiber**, and **TypeScript**. Travel through different historical eras and watch a procedurally generated city evolve across time periods with dynamic lighting, particles, post-processing bloom, ambient audio, and smooth year-transition animations.

![City Simulation](City-Sim-Coroid.png)

---

## Features

- **3D Procedural City** — buildings, roads, sidewalks, storefronts, pedestrians, and vehicles rendered with React Three Fiber
- **Time-Period Eras** — travel across historical eras (1900s → 2000s+) with distinct architectural styles, color palettes, and lighting themes
- **Year Transition Animations** — smooth animated transitions between eras with loading overlay and progress indication
- **Particle Effects** — era-adaptive atmospheric particles (snow, rain, dust, etc.)
- **Bloom Post-Processing** — emissive glow on windows, streetlights, and neon signage
- **Ambient Audio & SFX** — procedural Web Audio engine with era-specific ambient layers and transition sound effects
- **Interactive Controls** — timeline slider, audio controls, effects controls, and full 3D orbit/pan/zoom navigation
- **Static Export** — builds to a fully static site deployable to any CDN

---

## Quick Start

### Prerequisites

- Node.js 18.17+ (or 20+)
- npm 9+

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **"Enter Time City →"** to load the 3D scene.

### Production Build

```bash
npm run build
```

The static export is emitted to `dist/`. You can serve it with any static file server:

```bash
npx serve dist
```

---

## Usage

1. **Navigate to the city**: From the home page, click **"Enter Time City →"**.
2. **Explore the 3D scene**: 
   - **Left-drag** to rotate the camera
   - **Right-drag** to pan
   - **Scroll** to zoom in/out
3. **Change eras**: Use the **Timeline Slider** at the bottom of the screen to scrub through different time periods. Each era has unique building styles, colors, and lighting.
4. **Control audio**: Use the **Audio Controls** panel to mute/unmute and adjust volume. Audio unlocks on first user interaction (browser autoplay policy).
5. **Toggle effects**: Use the **Effects Controls** panel to enable/disable bloom and particle effects.
6. **Watch transitions**: When switching eras, a transition overlay appears with a loading indicator while the city morphs to the new time period.

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Next.js dev server (http://localhost:3000) |
| `npm run build` | Production build + static export to `dist/` |
| `npm run start` | Start the Next.js production server |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Run TypeScript compiler in no-emit mode |
| `npm run format` | Format all files with Prettier |
| `npm test` | Run Jest unit tests |
| `npm run test:watch` | Run Jest in watch mode |
| `npm run test:coverage` | Run Jest with coverage report |
| `npm run test:e2e` | Run Playwright E2E tests against the static build |

---

## Testing

### Unit Tests (Jest + React Testing Library)

```bash
npm test
```

Unit tests cover the Zustand stores (`yearStore`, `audioStore`), UI components (`TimelineSlider`, `AudioControls`), and utility functions. The test environment uses jsdom with a Web Audio API mock for audio module testing.

### E2E Tests (Playwright)

E2E tests run against the production static build. First build, then test:

```bash
npm run build
npm run test:e2e
```

The Playwright config (`playwright.config.ts`) automatically starts a static file server for `dist/` on port 4173. Tests verify:
- Home page loads and renders the entry link
- `/time-city` page loads and renders the scene container
- No uncaught page errors

---

## Architecture

```
city-sim/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout with global metadata
│   │   ├── page.tsx            # Home page with entry link
│   │   ├── globals.css         # Global Tailwind styles
│   │   └── time-city/
│   │       └── page.tsx       # Time City route — assembles all scene + UI components
│   ├── components/
│   │   ├── TimeCitySceneClient.tsx  # Dynamic import wrapper (ssr: false)
│   │   ├── TimeCityScene.tsx        # R3F Canvas + camera + controls
│   │   ├── Ground.tsx               # Ground plane
│   │   ├── Lighting.tsx             # Directional + ambient lighting rig
│   │   ├── Bloom.tsx                # Post-processing bloom effect
│   │   ├── TimelineSlider.tsx       # Era selection slider UI
│   │   ├── AudioControls.tsx        # Audio mute/volume UI
│   │   ├── AudioManager.tsx         # Headless audio controller (SFX + ambient)
│   │   ├── EffectsControls.tsx      # Bloom/particle toggle UI
│   │   ├── TransitionController.tsx # Headless year-transition rAF loop
│   │   ├── TransitionOverlay.tsx    # Loading + year info overlay during transitions
│   │   └── city/
│   │       ├── CityBlock.tsx        # Assembles all city elements
│   │       ├── Buildings.tsx        # Procedural buildings with era-adaptive styling
│   │       ├── Roads.tsx            # Road network
│   │       ├── Sidewalks.tsx        # Sidewalks along roads
│   │       ├── Storefronts.tsx      # Storefront signage
│   │       ├── Pedestrians.tsx      # Animated pedestrian dots
│   │       ├── Vehicles.tsx        # Animated vehicle rectangles
│   │       ├── Props.tsx           # Street props (lights, benches, etc.)
│   │       ├── Particles.tsx       # Era-adaptive particle systems
│   │       └── Sky.tsx             # Sky / atmosphere
│   ├── store/
│   │   ├── yearStore.ts            # Zustand store: current era, transition state
│   │   ├── audioStore.ts           # Zustand store: audio state
│   │   └── effectsStore.ts         # Zustand store: effects toggles
│   ├── config/
│   │   ├── years.ts                # Era definitions and metadata
│   │   ├── eraTheme.ts             # Per-era color palettes and lighting themes
│   │   ├── blockLayout.ts          # City block layout configuration
│   │   └── particleConfig.ts       # Particle system parameters per era
│   ├── audio/
│   │   └── AudioEngine.ts          # Web Audio API engine (procedural SFX + ambient)
│   └── utils/
│       ├── color.ts               # Color interpolation utilities
│       └── easing.ts              # Easing functions for animations
├── e2e/
│   ├── city-smoke.spec.ts         # Playwright E2E smoke tests
│   └── serve.mjs                  # Static file server for e2e tests
├── playwright.config.ts           # Playwright configuration
├── jest.config.mjs                # Jest configuration
├── jest.setup.ts                  # Jest test setup (jest-dom + AudioContext mock)
├── eslint.config.mjs              # ESLint flat config
├── next.config.js                 # Next.js config (static export)
├── tsconfig.json                  # TypeScript config (strict)
└── tailwind.config.ts             # TailwindCSS config
```

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, static export) |
| Language | TypeScript 5 (strict mode) |
| 3D Rendering | React Three Fiber + Three.js |
| Post-Processing | @react-three/postprocessing |
| State Management | Zustand |
| Styling | TailwindCSS 3 |
| Audio | Web Audio API (procedural, no assets) |
| Unit Testing | Jest + React Testing Library |
| E2E Testing | Playwright |
| Linting | ESLint 9 (flat config) + Prettier |

### Bundle Size

The `/time-city` route has a **First Load JS of ~110 kB** (well under the 500 kB budget). The heavy 3D scene is loaded via `next/dynamic` with `ssr: false`, so it only downloads when the user navigates to the route.

---

## License

UNLICENSED
