# QA Checklist — City Time Period Timelapse

Final QA & performance pass across all 5 eras and transitions.

## 1. Scope

This pass verifies the integrated scene across the five eras (1945, 1965, 1985,
2005, 2025), that transitions morph every element category smoothly with SFX and
ambience crossfades, that frame rate meets the desktop target with a graceful
degradation path, and that the production build is clean.

**Constraint honored:** no intended era content was changed. Only a
correctness/performance gap (missing quality toggle) was addressed and
limitations are documented.

## 2. Change made in this pass

- **Quality toggle (High / Low)** — the `Effects` component already supported a
  `quality` prop (`'high' | 'low'`) that disables the heavy screen-space
  ambient-occlusion (SSAO) pass on `'low'`, but it was **not wired to any UI** and
  `Scene` always rendered at `'high'`. This pass:
  - Threads `quality` from `App` → `Scene` → `Effects`.
  - Adds a Quality toggle button in the app header (defaults to **High**).
  - Adds the toggle styles to `index.css`.
  - Result: on weaker devices the user can drop to Low quality, which removes the
    SSAO pass — the dominant post-processing cost — so the scene degrades
    gracefully instead of dropping frames.

## 3. Per-era element verification matrix

Every era renders all required element categories. The scene composes five
self-contained layers per era inside `CityLayer` (`StreetEnvironment`,
`Buildings`, `StorefrontsAds`, `Vehicles`, `Pedestrians`).

| Era  | Buildings | Vehicles | Storefronts / Ads | Pedestrian outfits | Street / Environment |
|------|-----------|----------|-------------------|--------------------|----------------------|
| 1945 | Walk-ups, pitched roofs, fire escapes, instanced windows | Vintage sedans/trucks, fenders | Hand-painted signage, period posters | Period, muted outfits | Cobblestone, lamp posts, wires, muted sepia day sky, warm grade |
| 1965 | Mid-century blocks, chrome trim | Chrome sedans, wagons, muscle cars | Neon-lit storefronts, awnings | Bright mid-century outfits | Asphalt, mid-century furniture, bright pastel sky, balanced grade |
| 1985 | Neon-era towers | Neon hatchbacks, aero sedans, sport coupes | Neon/backlit signage, strong bloom | Bold neon outfits | Night neon mood, hazy high-contrast grade, strong bloom |
| 2005 | Mixed-use with storefront glazing, cladding panels | SUVs, crossovers, minivans | Digital/backlit screens | Sleek metallic outfits | Clean day sky, smart-road markings, cool grade |
| 2025 | Glass towers, greenery, LED media facades | EV crossovers, ride-share, robo-taxis | LED/digital media facades | Modern outfits | Smart road, sensors, drone, crisp AO, cool punchy grade |

## 4. Transitions

- **Morph:** `TransitionManager` drives a 900 ms ease-in-out-cubic crossfade.
  While active, **both** eras render and crossfade (outgoing fades out, incoming
  fades in) so the whole city morphs rather than popping. Buildings, vehicles,
  storefronts/ads, pedestrians, and environment all participate via
  `CrossfadeLayer`, which fades materials (preserving base opacity), swaps the
  custom shader sky at the midpoint, and fades light intensity.
- **SFX + ambience crossfade:** `AudioBridge` plays a transition SFX and
  crossfades the destination era's ambient bed via `WebAudioManager` on every
  era change. Audio is unlocked on the first user gesture (autoplay policy).
- **Grade crossfade:** `Effects` lerps the per-era post-processing grade
  (brightness/contrast/saturation/temperature/bloom/vignette/AO) across the
  transition.
- **Both directions:** the transition is symmetric (`fromEra`/`toEra`), so
  forward (1945→2025) and reverse (2025→1945) morphs both run the same
  crossfade path.

## 5. Performance

- **Target:** 60 fps on desktop.
- **Instancing / draw-call hygiene (already present):**
  - Buildings render windows as `InstancedMesh` per facade (single draw call per
    facade regardless of window count).
  - Vehicles use one `InstancedMesh` per style.
  - Pedestrians use one `InstancedMesh` per outfit scheme.
  - Shared merged geometry is built once per style/scheme and disposed on
    unmount.
- **Shadow cost:** single directional light at 1024×1024 shadow map; ground and
  buildings receive shadows. Acceptable for the desktop target.
- **Graceful degradation (added this pass):** the **Quality toggle** drops the
  SSAO pass on `'low'`, the main screen-space cost, for weaker devices.

## 6. Production build

- `npm run build` = `tsc && vite build`; `npm run lint` = ESLint with
  `--max-warnings 0`.
- **Verification status:** the execution-runner sandbox was unavailable during
  this pass (exec runner returned 403 on `exec_command` and the dev-server smoke
  check; the workspace pod failed to start). As a result the build/lint could
  **not** be re-run here. The changes are small, type-consistent, and use
  existing exported types (`EffectsQuality` from `src/effects`), but the build
  and lint should be re-run in a healthy environment before sign-off.

## 7. Known limitations

1. **Screenshot evidence pending:** per-era screenshots could not be captured in
   this pass because the dev-server smoke-check / browser harness was
   unavailable (exec runner 403). The intended evidence set is one screenshot
   per era (5 total) plus a transition mid-frame, at desktop and mobile
   viewports.
2. **Automated build/lint not re-run** in this pass for the same infra reason
   (see §6). Re-run `npm run build` and `npm run lint` before final sign-off.
3. **Quality toggle controls SSAO only.** It does not currently reduce shadow-map
   resolution, instance counts, or the bloom pass. If profiling on low-end
   hardware shows further hotspots, those are additional levers.
4. **Procedural audio** is synthesized (no external assets); ambience is
   therefore a stylized bed, not field recordings.

## 8. Recommended manual QA steps (when a browser is available)

1. Open the app; confirm the loading overlay fades and the 1945 city renders.
2. Click each timeline era (1945 → 1965 → 1985 → 2005 → 2025) and back; confirm
   every category morphs smoothly and the ambience/SFX crossfades.
3. Toggle Quality to Low and confirm SSAO is removed and frame rate improves on
   a weaker device, with no crash.
4. Capture one screenshot per era and one transition mid-frame as evidence.
5. Run `npm run build` and `npm run lint`; confirm zero TypeScript and lint
   errors.
