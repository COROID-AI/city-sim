# City Time Period Timelapse

A polished, high-detail 3D scene of a city block that evolves through time (1850 → 2035) as an interactive timelapse.

## Features

- **Timeline slider** across 10 era stops (Frontier Town → Neon Future) with era chips for one-click jumps, play/pause, and playback speed (0.5× / 1× / 2× / 4×).
- **High-detail 3D city**: ~37 buildings (instanced boxes with procedural window textures), street grid with sidewalks, central park with trees, street lamps, and labeled landmarks (Clock Tower, Exchange, Station House).
- **Era morphing**: buildings appear as their construction year arrives, heights and facade palettes shift continuously, and the lighting, sky, fog, bloom, and cloud palette interpolate between eras.
- **Day/night cycle**: a simulated clock drives sun/moon arcs, lamp glow, window emissive, and neon bloom (Bloom, Vignette, Noise post-processing via `@react-three/postprocessing`).
- **Navigation**: orbit controls (drag to look, scroll to zoom) with damping.
- **SFX**: procedural Web Audio — era-transition whoosh, scrub clicks, and an ambient wind loop tied to the day/night cycle. Audio unlocks on the first pointer/keydown gesture (browser autoplay policy compliant); a mute toggle is available.
- **Robustness**: WebGL-availability preflight with a graceful fallback banner, context-lost/restored handling, and `prefers-reduced-motion` support (no auto-timelapse and no orbit damping for reduced-motion users).
- **Performance**: per-frame scene state is driven imperatively through a zustand store (`useStore.subscribe` + `useFrame` reads) so playback and slider scrubbing never reconcile the 3D scene through React.

## Run

```bash
npm install
npm run dev      # dev server (http://localhost:5173)
npm run build    # type-check + production build (dist/)
npm run preview  # serve the production build
```

## Stack

- Vite 8 + React 19 + TypeScript
- three 0.185 + @react-three/fiber 9 + @react-three/drei 10 + @react-three/postprocessing 3 + postprocessing 6
- zustand for state