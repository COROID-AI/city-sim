# SOLAR SMASH

A 3D planetary-destruction browser game built with three.js. Orbit a living
planet, pick from six weapons, and tear it apart — every impact scars the
surface permanently until integrity hits zero and the core breaches,
shattering the world into drifting debris.

## Run

```sh
npm install        # installs three@0.185.x (exact-pinned) + esbuild
npm start          # http://localhost:3000
```

`npm install` also vendors the installed three build into `vendor/three/`
(see `scripts/vendor-three.mjs`) so the importmap always serves the exact
pinned version — no example-module imports exist anywhere, so addon path
drift across three releases cannot break the game.

## Controls

| Input | Action |
| --- | --- |
| Click / tap | Fire the selected weapon at that surface point |
| Hold | Sustain the laser beam (mind the heat gauge) |
| Drag | Orbit the planet · scroll/pinch to zoom |
| `1`–`6` | Missile · Laser · Asteroid · Nuke · Black Hole · Railgun |
| `Q` | Cycle quality tier (AUTO adapts to measured FPS) |
| `M` / `H` / `P`·`Esc` / `R` | Mute · help · pause · rebuild |

## Weapons

1. **Missile** — reliable warhead, medium crater.
2. **Laser** — held beam that scorches the crust; overheats if abused.
3. **Asteroid** — redirects a chondrite onto the target point. Big splash.
4. **Nuke** — slow descent, blinding flash, continent-scale scarring.
5. **Black Hole** — tears matter off the surface until it collapses.
6. **Railgun** — instant hypervelocity slug, deep penetration.

## Architecture

- `index.html` + `css/style.css` — HUD shell (dock, integrity/population panel, overlays).
- `js/config.js` — weapon tuning, quality tiers, copy.
- `js/main.js` — bootstrap, state machine, input, main loop.
- `js/planet.js` — procedural surface painting, custom shaders (day/night terminator, lava glow, clouds, atmosphere rim), molten-core finale.
- `js/decals.js` — impact decals composited onto equirect canvases in throttled batches (never redrawn per frame).
- `js/weapons.js` — projectiles, held laser with heat, black holes, hitscan railgun.
- `js/effects.js` — single pooled GPU particle system, shockwave rings, flashes, black-hole attractors.
- `js/postfx.js` — self-contained fullscreen-triangle bloom chain (bright pass → separable blur → tonemapped composite); tier-gated so LOW tier skips blur passes entirely.
- `js/quality.js` + `js/config.js` tiers — AUTO mode watches rolling FPS with hysteresis and steps DPR/bloom/particle budgets down (and back up) to hold frame rate on integrated/mobile GPUs.
- `js/audio.js` — fully procedural WebAudio; the context is created lazily inside a user-gesture-only `unlock()`, so autoplay policy can never break sound.
- `server.js` — zero-dependency static file server (`/healthz` included).

## Verify

```sh
npm run check      # esbuild bundle of js/main.js (catches syntax/import breaks)
```

Then `npm start` and load the page: the menu should show the spinning planet;
click ENGAGE and destroy responsibly.
