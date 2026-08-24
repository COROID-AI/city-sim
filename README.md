# Café Time Period Timelapse

A standalone, browser-based 3D café interior that transforms across five eras —
**1945, 1965, 1985, 2005, 2025** — via a fixed timeline slider at the top of
the screen. Built with [three.js](https://threejs.org/) (r160 ES module build),
loaded directly as static files. No bundler, no framework.

![runtime](https://img.shields.io/badge/runtime-static%20ES%20modules-0d141b)

## Quick start

```bash
# 1) Serve the repo root over http (required — ES modules + import map)
npm start
# or: npm run start:python   (if python3 is available)
# or: npm run start:npx      (npx serve -l 8000 .)
```

Then open **http://127.0.0.1:8000** in a WebGL-capable browser.

`npm start` uses a zero-dependency Node static server (`scripts/serve.mjs`) so
it works even when `python3` is not installed on the host. It serves the
correct `text/javascript` MIME type for ES modules and resolves directory
requests to `index.html`.

## Controls

| Input | Action |
| --- | --- |
| **Timeline slider** (top) | Drag between 1945 / 1965 / 1985 / 2005 / 2025 |
| **Era buttons** (top) | Jump straight to a year |
| **Left-drag** on the scene | Orbit the camera |
| **Scroll / middle-drag** | Zoom |
| **Right-drag** | Pan |
| **Arrow keys** (canvas focused) | Pan (OrbitControls keyboard mode) |
| **Hover** a hotspot | Info card with a period note |
| **Click** a hotspot | Pin / unpin the info card |
| **Esc** | Dismiss a pinned info card |
| **Camera preset buttons** (top-right) | Composed viewpoints: Counter, Tables, Music, Menu/Arcade |
| **Mute / Vol** (top bar) | Toggle or adjust the ambient sound + music |

## The five eras

Each era is a fully furnished period café interior sharing one architectural
shell (floor, walls, windows, door, counter run). Every era transforms all nine
audit categories — furniture & decor, coffee & brewing equipment, menu &
prices, music source, posters & ads, tableware, signage & lighting, counter
tech, and patron outfits / hairstyles / gadgets.

- **1945 — Post-war Café**: warm tungsten, heavy oak tables, Thonet bentwood
  chairs, a hand-pulled lever espresso machine, a hand-crank cash register, a
  walnut valve wireless set, war-bond posters and a ration notice, 7¢ coffee.
- **1965 — Mid-Century Espresso Bar**: chrome-and-bakelite espresso bar,
  round-key electric register, chrome-and-glass jukebox with 45s, plastic
  letterboard menu (15¢ coffee), sputnik pendant, travel posters, swing-era
  patrons with beehives and skinny suits.
- **1985 — Neon Café**: black-and-chrome + pastel neon, boxy chrome espresso
  with a digital keypad, drip-brew tower, early electronic POS with green
  segment display, twin-cassette boombox, backlit lightbox menu (55¢ coffee),
  arcade cabinet + CRT static TV, Members-Only jackets, Walkman, pager.
- **2005 — Early Wi-Fi Café**: stainless E61 semi-auto espresso, touchscreen
  POS with card swipe, beige CRT iMac order station, white click-wheel iPod in
  a speaker dock with CDs for sale, $1.50 coffee menu, bootcut jeans, flip
  phones, chunky earbuds, early laptops.
- **2025 — Contemporary Café**: multi-boiler espresso with touchscreen,
  pour-over station (gooseneck kettle + V60s + scale), batch brewer into
  double-wall carafes, iPad POS with contactless tap-to-pay, smart speaker +
  wireless-charging phone, minimal $4.50 flat-white menu, QR table ordering,
  communal oak slab table, LED pendants, oversized fits and smartwatches.

## Verification

- `npm run check` — parses every file under `src/`; must pass before any task
  is considered done.
- Open the page and check the console for the r160 assertion and
  `[cafe] era switched to <year>` on every slider move.
- Orbit / zoom / pan with the mouse; the camera stays above the floor and
  inside the café volume.
- See **docs/FINAL-QA.md** for the full 5-eras × 9-categories walkthrough
  matrix, the defects found and fixed, and known limitations (including that
  the music is synthesized period-styled audio, not licensed recordings).

## Structure

```
index.html              # fullscreen canvas, timeline slider (fixed top), era HUD,
                        # camera presets, WebGL fallback, info-card surface
src/
  main.js               # boots renderer/camera/lights/OrbitControls + r160 assertion
  ui.js                 # info cards, camera presets, reduced-motion, keyboard access
  eras/
    registry.js         # shared era registry: registerEra(id, module), switchTo(year)
    placeholder.js      # temporary "UNDER CONSTRUCTION" era for the remaining years
    1945/ 1965/ 1985/ 2005/ 2025/   # per-era interior modules
  audio/
    engine.js           # single WebAudio engine (crossfade, mute/volume, era beds)
    eras/               # per-era synthesized period-styled music profiles
    sfx/                # procedural ambient SFX
  world/
    shell.js            # permanent café shell: floor/walls/ceiling, windows, door,
                        # counter run, kitchen passthrough, interior light rig
    animation/
      timelapse.js      # era transition controller (choreographed ~2.5s)
      audio.js          # adapter from the timelapse to the single audio engine
    render.js           # cross-era render policy (ACESFilmic, shadow map, budget)
public/js/three/        # three.js r160 module build (pinned, committed)
scripts/
  check.js              # `npm run check` implementation
  serve.mjs             # `npm start` zero-dependency Node static server
```

> The pinned `public/js/three/build/three.module.js` is committed (not ignored)
> so a fresh clone boots without a network fetch.