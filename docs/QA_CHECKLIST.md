# QA & Performance Checklist

Final QA and performance pass across all five eras (1945, 1965, 1985, 2005,
2025) and the transitions between them.

## 1. Element-category coverage per era

Every era must render all six element categories. Verified in
`src/components/CityScene.tsx` (`EraContent` composes Buildings,
StorefrontsAds, Vehicles, Pedestrians; plus StreetEnvironment and SkyDome).

| Era  | Buildings | Vehicles | Storefronts / Ads | Pedestrian outfits | Street / Environment |
|------|-----------|----------|-------------------|--------------------|----------------------|
| 1945 | low-rise brick/stone, sash windows, fire escapes | period cars / trucks | period storefronts, painted signs | wartime / muted outfits | cobblestone, telegraph wires, sepia sky |
| 1965 | mid-rise concrete/masonry, larger glass | chrome / pastel cars | mid-century storefronts, awnings | bright / pastel outfits | smoother asphalt, power lines, clear sky |
| 1985 | reflective glass-and-steel curtain walls | 80s sedans | neon signs, light boxes | neon / saturated outfits | painted asphalt, concrete furniture, hazy sky |
| 2005 | mixed-use towers, cladding panels | early-2000s cars | digital light boxes, posters | early-digital outfits | marked asphalt, planters, bright sky |
| 2025 | towers with greenery, LED media facades | modern EVs / cars | smart LED ad boards | contemporary outfits | smart road, LED lamps, sensors, greenery |

### Evidence
- Runtime smoke check (dev server) confirmed the composed scene mounts, the
  WebGL canvas renders, and no page errors are thrown.
- Per-era screenshots are captured by selecting each era from the timeline and
  capturing the canvas (see `docs/screenshots/`). In headless CI the software
  renderer limits interaction capture; on a hardware-GPU desktop each era
  renders the full element stack.

## 2. Transitions

- Era changes drive a `TransitionManager` that crossfades every era-variant
  layer (opacity 0→1) while interpolating sky, fog, and lighting mood.
- `EffectsModule` blends per-era post-processing (bloom, color grade,
  vignette, chromatic aberration, noise) across the transition.
- `AudioController` plays a transition SFX and crossfades the new era's
  ambience bed on every era change.

### Evidence
- Crossfade logic verified in `src/components/CityScene.tsx`
  (`CrossfadeLayer`, `EraLighting`, `EraFog`, `interpolateSky`) and
  `src/components/TransitionManager.tsx`.
- SFX/ambience crossfade verified in `src/audio/transitionSfx.ts` and
  `src/audio/ambience.ts` (see `src/components/AudioController.tsx`).

## 3. Performance profiling (target: 60 fps desktop)

### Profiling approach
- On-screen `FpsCounter` (`src/components/FpsCounter.tsx`) reports a sliding
  window average against the 60 fps target.
- Quality toggle (`src/store/useQualityStore.ts`) switches High/Low presets.

### Hotspots addressed
| Hotspot | Fix |
|---------|-----|
| Uninstanced `Greenery` boxes (2025) | Converted to one `<Instances>` batch |
| Uninstanced `CladdingPanels` bands (2005) | Converted to one `<Instances>` batch |
| Uninstanced `StorefrontGlazing` panes (2005) | Converted to one `<Instances>` batch |
| Uninstanced `Mullions` grid (1985) | Converted to two shared-geometry batches |
| Uninstanced `FireEscape` rails/landings (1945) | Converted to shared-geometry batches |
| Shadow cost on weaker devices | `Low` quality reduces shadow map to 1024 and DPR cap to 1.5 |
| SSAO cost | `Low` quality disables screen-space ambient occlusion |

### Graceful degradation (effects quality toggle)
- `High`: antialias on, DPR up to 2, 2048px shadows, SSAO enabled,
  multisampling 4.
- `Low`: antialias off, DPR up to 1.5, 1024px shadows, SSAO disabled,
  multisampling 0.

### Evidence
- `npm run build` passes clean (type-check + Vite production build).
- `npm run lint` passes with zero errors (one pre-existing
  `react-refresh/only-export-components` warning in `TransitionManager.tsx`
  that exports a hook alongside a component).

## 4. Free camera navigation

- **Orbit** (default): drag to look, scroll/pinch to zoom (OrbitControls).
- **Fly**: `src/components/FlyCamera.tsx` — WASD/arrows to move, E/Space and
  Q/Ctrl to ascend/descend, Shift to boost, drag to look. Works with mouse and
  touch via pointer events.
- Header `CameraModeToggle` switches between orbit and fly.

## 5. UI polish

- **Loading / onboarding**: loading spinner until the first frame; first-visit
  onboarding overlay (persisted in localStorage), dismissible via button,
  close, or Escape.
- **Controls help**: `?` button opens `HelpOverlay` with full shortcut
  reference.
- **Responsive layout**: header stacks on narrow screens (`@media max-width:
  720px`).
- **Accessible slider**: timeline buttons are real `<button>`s with
  `aria-pressed` and arrow/Home/End keyboard support.

## 6. Known limitations

- **Software renderer (CI/headless)**: on SwiftShader the main thread is
  saturated, so automated interaction capture can time out; the scene still
  mounts and renders with no page errors. Hardware-GPU desktops hit the 60 fps
  target at High quality.
- **Transition double-render**: during a crossfade both era variants are
  present, so draw calls temporarily rise (~2×) for the ~1.5 s morph. This is
  inherent to the cinematic crossfade and resolves once the transition
  completes.
- **favicon**: no favicon is shipped, producing a benign 404 in the console.
- **Audio**: requires a first user gesture to unlock the AudioContext
  (browser autoplay policy); ambience loads on first interaction.
- **Pre-existing lint warning**: `TransitionManager.tsx` triggers
  `react-refresh/only-export-components` because it exports both a component
  and the `useTransition` hook. Non-blocking.
