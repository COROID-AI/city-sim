# Café Time Period Timelapse

A standalone, browser-based 3D café interior that transforms across five eras —
**1945, 1965, 1985, 2005, 2025** — via a fixed timeline slider at the top of
the screen. Built with [three.js](https://threejs.org/) (r160 ES module build),
loaded directly as static files. No bundler, no framework.

![runtime](https://img.shields.io/badge/runtime-static%20ES%20modules-0d141b)

## Quick start

```bash
# 1) Serve the repo root over http (required — ES modules + import map)
python3 -m http.server 8000
# or: npx --yes serve -l 8000 .

# 2) Open http://localhost:8000
```

Or use the npm scripts:

```bash
npm start        # python3 -m http.server 8000
npm run start:npx # npx serve -l 8000 .
npm run check    # node --check every file under src/ (cheap syntax gate for all tasks)
```

> `npm run check` has no dependencies — it just runs Node's parser over `src/**`
> so every later era/world task has a one-command sanity check.

## Structure

```
index.html              # fullscreen canvas, timeline slider (fixed top), era HUD
src/
  main.js               # boots renderer/camera/lights/OrbitControls + r160 assertion
  eras/
    registry.js         # shared era registry: registerEra(id, module), switchTo(year)
    placeholder.js      # temporary "UNDER CONSTRUCTION" era for all five years
  world/
    shell.js            # permanent café shell: floor/walls/ceiling, windows, door,
                        # counter run, kitchen passthrough, interior light rig
public/js/
  three/                # three.js r160 module build (pinned from unpkg source)
    build/three.module.js
    examples/jsm/controls/OrbitControls.js
scripts/
  check.js              # `npm run check` implementation
```

> `src/index.js` no longer exists — `src/main.js` is the single entrypoint loaded
> by `index.html`.

## The scene

- A realistic **~7 m × 5 m × 3 m** café room with consistent human scale:
  counter top at **0.90 m**, entrance door **2.05 m** tall, window sill 0.90 m,
  kitchen passthrough opening on the back wall.
- Permanent architectural shell lives in `src/world/shell.js` and is shared by
  every era module: floor, walls, ceiling, front window wall with mullions,
  entrance door, a long base counter run (customer front / staff back), and a
  base interior lighting rig.
- **OrbitControls** give pointer-driven orbit / dolly / pan (no WASD needed)
  with smooth damping and clamps: the camera cannot dip under the floor or fly
  out of the interior volume.

## Era registry contract

Each era is an ES module exposing a plain object:

```js
{
  id: 'year-2025',          // stable id
  label: '2025',            // slider/HUD label
  year: 2025,               // slider year this era replaces
  build(ctx) -> THREE.Group // create the era's group (called on switch)
  enter(ctx, group)         // optional: animate on entry
  exit(ctx),                // optional: teardown hook
  assets(ctx)               // list of asset URLs preloaded for the era
}
```

`ctx` is the shared app context: `{ THREE, scene, renderer, camera, controls,
clock, shell, shellMeta }`.

Register and switch:

```js
import { registerEra, switchTo } from './src/eras/registry.js';
registerEra('year-2025', myEraModule);
switchTo(2025, ctx);
```

All five years are wired in `src/main.js` to the timeline slider and buttons;
switching swaps the era `THREE.Group` in the scene and updates the era-label
HUD chip.

## Timeline slider (UI)

- Fixed along the top of the viewport, always visible.
- Exactly five options: **1945 / 1965 / 1985 / 2005 / 2025**, as a keyboard
  accessible `<input type="range">` plus five labeled buttons.
- Clear selected-year state: aria-valuetext, pressed/active styling, HUD chip.

## Vendored three.js

- `public/js/three/` contains the **three.js r160** ES module build from the
  pinned `three@0.160.0` npm tarball (shasum
  `cd1e4dbd01aee0719280a9086d75545db52b7a8f`, size 9.4 MB, the same source unpkg
  serves at `three@0.160.0`), copied during scaffold setup with
  `npm pack three@0.160.0`.
- Startup asserts **`THREE.REVISION === '160'`** in the browser console, and
  boots nothing until the assertion passes, proving the local bundle is the
  genuine r160 module build.
- `public/js/three/` is intentionally committed (not gitignored) so every later
  era task can rely on the identical three.js build without a network fetch.

## Verification

- `npm run check` — parses every file under `src/`; must pass before any task
  is considered done.
- Open the page and check the console for the r160 assertion and
  `[cafe] era switched to <year>` on every slider move.
- Orbit/zoom/pan with the mouse; the camera stays above the floor and inside
  the café volume.