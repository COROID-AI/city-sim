# Cross-era render-quality audit

**Scope:** shared render settings plus era-local wall/floor dressing offsets.
The animation system (`src/world/animation/`) and audio system (`src/audio/`)
were intentionally not modified.

## Shared fixes applied

- **Color pipeline:** `src/world/render.js` is the single policy source. The
  renderer uses `THREE.ACESFilmicToneMapping`, exposure `1.0`, white point
  `4.0`, and `THREE.SRGBColorSpace` for every era. `src/main.js` applies it
  before the first frame.
- **Shadows:** the shell's directional key light uses one shared 2048×2048
  PCF soft-shadow configuration with a room-sized orthographic frustum
  (`left/right/top/bottom = ±8`, `near = 0.5`, `far = 20`). This avoids each
  era inventing different bias/frustum values. The shell remains the owner of
  the shared light rig.
- **Performance instrumentation:** `renderer.info` is sampled every 60
  frames. The report includes draw calls, triangles, and measured FPS against
  the audit budget of 150 draw calls, 500k triangles, 60 FPS target, and 45 FPS
  floor. The report is intentionally diagnostic: it does not silently change
  an era's art direction.
- **Z-fighting convention:** wall dressing must sit in front of the interior
  wall face, using a small 0.04 m standoff (the shared policy's
  `wallStandoff`). Existing era wall mounts use the corresponding side of the
  wall and retain their original visual scale and orientation.

## Per-era findings and fixes

| Era | Findings | Fixes applied | Follow-up |
| --- | --- | --- | --- |
| **1945** | War-era posters, menu, signs, photo, and newspaper were mounted very close to shell wall planes. The era uses warm tungsten lighting and dark wood, so shadow/contrast inspection is especially important. | Current wall dress is documented for close inspection; shared ACESFilmic/exposure and shadow policy now apply. | Browser screenshot and renderer.info capture still required once the vendored three.js build is restored. |
| **1965** | Back-wall instant-ad/menu/clock and side-wall travel/sunburst/string-art mounts were at or behind wall faces, risking flicker when orbiting close. | Back-wall mounts use `z = -2.46`; side-wall mounts use `x = ±3.46`; shared policy keeps the offset consistent. | Capture a close orbit pass around the jukebox, posters, and letterboard. |
| **1985** | Neon-era wall planes, mirror, murals, posters, and lightbox use many close stacked surfaces; this is the highest visual-risk era for competing emissive and unlit-looking surfaces. | Shared ACESFilmic policy prevents neon highlights from crushing the room; existing wall geometry remains intentionally separate to preserve the timelapse staging. | Measure draw calls/FPS and inspect the mirror, arcade, menu lightbox, and side posters on integrated graphics. |
| **2005** | Back-wall menu/Wi-Fi signs were mounted too close to the wall face; warm neutral floor and signs need close inspection. | Menu backing/signs use a forward wall offset (`z = -2.46` / `-2.44`); front-facing signs use `z = 2.46`. | Browser screenshot and renderer.info capture still required once the vendored build is restored. |
| **2025** | Menu, brand decal, notice shelf, and side-wall posters were embedded or nearly coplanar with the shell. Transparent glass/plants also need a close pass. | Menu/decal use `z = -2.46`; side mounts use `x = ±3.46`; notice shelf uses `x = -3.46`. | Verify transparent pastry/glass ordering and measure the integrated-GPU baseline. |

## Material and mood review

All five era modules use lit `MeshStandardMaterial` families for solid scenic
surfaces, with emissive materials reserved for period-appropriate bulbs,
neon, screens, and LEDs. Material helpers keep roughness in practical ranges:
matte/wood families are generally `0.4–0.98`, while chrome/glass families
use lower roughness and higher metalness/transparency. The palette progression
reads as warm post-war tungsten (1945), terracotta/mint mid-century (1965),
pink/teal neon (1985), warm neutral early-Wi-Fi (2005), and daylight Japandi
oak/sage (2025). This is an evolution rather than a single neutralized grade.

## Performance baseline status

The application now reports live per-era values through `renderer.info`, but a
numeric five-era baseline could not be captured in this workspace: the pinned
`public/js/three/lib/three.module.js` file referenced by the import map is
not present in the checkout, and no browser/WebGL runner is available here.
Consequently, the 150-draw-call / 500k-triangle / 60-FPS acceptance gate is
**not claimed as measured**. No geometry was merged or instanced speculatively;
that would alter the object-level timelapse staging and cannot be justified
without measurements. If a future capture exceeds budget, use instancing or
merging only in shared/static helper groups whose animation behavior has been
reviewed, then record before/after `renderer.info` values here.

## Remaining follow-ups

1. Restore or provide the pinned three.js r160 build expected by
   `index.html` and the source imports.
2. Run the scene in a browser on integrated graphics, switch through all five
   years, and record renderer.info draw calls/triangles plus sustained FPS.
3. Capture close-up screenshots of posters, menus, decals, floor dressings,
   transparent glass, and emissive fixtures. Confirm no visible flicker,
   shadow acne, peter-panning, washed highlights, or crushed darks.
4. If any era exceeds budget, reduce repeated static geometry with shared
   instancing/merging helpers without changing its art direction or animation
   ownership boundary.
