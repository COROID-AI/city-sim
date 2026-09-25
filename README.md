# Chrono City

**One city block, five decades — 1945 · 1965 · 1985 · 2005 · 2025.**

Chrono City is a browser-rendered, fully procedural 3D city block. A timeline slider pinned to
the top of the screen lets you pick any of five years, and the entire block transforms in front of
your eyes: buildings, skyline, vehicles, storefronts, advertising, street furniture, the outfits of
the pedestrians, the colour grade, the weather-light and the whole soundscape move together into
that decade.

Everything is generated at runtime — parametric three.js geometry, canvas-texture artwork and
synthesised Web Audio. There are **no image, model or audio assets**, no runtime downloads and no
network calls.

> This project supersedes the earlier *2D city simulation* work order in this repository (minimap,
> live economy, citizen schedules). None of those features are implemented here; the authoritative
> brief is the 3D timelapse city block described above.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173 — the scene starts rendering immediately
```

Production build and local preview:

```bash
npm run build      # static bundle in dist/
npm run preview    # serve the built bundle
```

The app boots straight into the live scene: no click is required, and the timeline is already
playable while the five era layers are still being assembled behind the loading overlay.

---

## Controls

| Input | Action |
| --- | --- |
| **Left-drag** on the scene | Orbit the camera around the block (damped) |
| **Scroll / pinch** | Zoom in and out (clamped between 26 and 320 units) |
| **Right-drag or Shift-drag** | Pan the view laterally (clamped to the block) |
| **Click** a building / vehicle / pedestrian / prop / sign | Fly to it and open an era-aware info card |
| **Esc** or **E** | Close the info card and return to the overview |
| **1** – **5** | Jump straight to 1945 / 1965 / 1985 / 2005 / 2025 |
| **←** **→** (also **Home** / **End**) | Step through the timeline stops |
| **Drag the timeline handle** | Scrub continuously between neighbouring decades, snapping on release |
| **Click a timeline stop** | Select that year with the full staged transformation |
| **M** | Mute / unmute all sound |
| **H** | Toggle the help panel (controls, per-era facts, five-era matrix) |
| **F** | Toggle the frame-rate / quality readout |

The slider exposes full accessibility semantics (`role="slider"` with `aria-valuenow`, `aria-valuemin`,
`aria-valuemax` and a descriptive `aria-valuetext`). Audio cannot start until the browser allows a
user gesture, so a persistent **Enable sound** pill appears until the first interaction.

---

## The five decades

| | 1945 | 1965 | 1985 | 2005 | 2025 |
| --- | --- | --- | --- | --- | --- |
| **Buildings** | Art-deco setbacks, brick walk-ups, brownstones, fire escapes, rooftop water towers | Mid-century slabs and stucco, rooftop billboards, AC condensers | Glass-and-steel infill, ribbon windows, satellite dishes | Glass towers, curtain-wall glazing, setback crowns | Curtain-wall towers, roof gardens, solar arrays, LED-wrapped facades |
| **Vehicles** | Rounded sedans, checker cabs, flatbed trucks, **streetcars on rails**, city buses, delivery bicycles | V8 muscle cars, station wagons, compacts, cruisers | Boxy sedans, conversion vans, first hatchbacks, box trucks | Full-size SUVs, fleet sedans, low-floor buses, medallion taxis | EVs, robotaxis, cargo e-bikes, shared e-scooters, electric articulated buses |
| **Storefronts** | Harlan's Grocery, Victory Diner, Miller & Sons Hardware… | Galaxy Diner, Atomic Records, Sunbeam Salon… | Video Vault, Neon Noodle House, Cassette Corner… | Pixel Palace Games, Bean There Coffee, Northgate Pharmacy… | Nimbus Coffee Lab, Vertex Athletics, Solstice Plant Shop… |
| **Advertising** | Painted brick war-bond and rationing ads, posters | Neon tube boards and painted panels | Arcade neon, scrolling tickers, rooftop billboards | LED boards, billboards, neon | LED media facades, LED boards, scrolling tickers |
| **Outfits** | Fedoras, overcoats, wide-lapel suits, day-dresses | Pillbox hats, slim suits, mod dresses, backpacks | Denim, leather, bell-bottoms, shoulder pads, headbands | Hoodies, flip phones, messenger bags, athleisure | Tech-wear, hoodies, helmets, phones in hand |
| **Street furniture** | Incandescent globes, telegraph poles and wires, tram rails, newsstands | Swan-neck lamps, trolley poles, tram rails | Sodium cobra heads, bus shelters, newspaper boxes | Slim LED lamps, shelters, bike racks | Organic LED rings, protected bike lane, bike racks, planters |
| **Sound** | Streetcar bell, crowd murmur, pigeons, coal-hauler drone, distant siren + jazz walking bass | V8 drone, shopper murmur, neon buzz, transistor radio + surf | Six-cylinder traffic, arcade buzz, sirens + synth arpeggio | SUV drone, condenser hum, ring tones + downtempo | EV hum, LED driver buzz, cargo-bike whir + lo-fi |
| **Grade** | Warm, hazy, heavy film grain, strong vignette | Bright, saturated, light grain | Cool magenta dusk, punchy saturation, strong bloom | Clean daylight, mild grain | Crisp cool daylight, minimal grain, strong bloom |

Each year is a complete, self-contained content definition in `src/config/eras.ts` — the storefront
names, ad copy, vehicle archetypes, outfit swatches, ambience layers and palettes are all mutually
distinct between the five decades, and the automated tests enforce that.

---

## How the transformation works

Five complete era layers are generated at boot (`src/world/cityBlock.ts`), each split into
independently swappable category groups: `roads`, `buildings`, `vehicles`, `storefronts`,
`advertisements`, `pedestrians`, `props`, `sky`.

When you pick a year, `src/era/transition.ts` runs a ~1 s staged hand-over: categories swap in
sequence (vehicles → storefronts → ads → buildings → pedestrians → props → roads → sky) with the
incoming group rising and settling into place, **never more than two categories mid-swap at once** —
that is the mitigation for cross-fade depth-sorting artefacts, and whole-scene transparency is never
used. Meanwhile the colour grade, fog colour/density and sky palette are lerped continuously, the
camera takes a small micro-dolly, a short warm bloom flash plays, and the audio engine fires an
era whoosh and rebuilds the ambience bed for the new decade.

While you *drag* the handle the two neighbouring decades are blended live by drag weight, and on
release the scene snaps to the nearest stop.

SFX are fully synthesised (`src/audio/audioEngine.ts`): per-era ambience beds (filtered noise,
murmur, hum, buzz, siren, bells, birds), engine-profile pass-by swooshes panned by screen position,
UI click ticks, an era-change whoosh, and a tiny beat sequencer for the music beds. Everything runs
through a compressor → master gain chain with a mute toggle, and the engine degrades silently when
Web Audio is unavailable.

---

## Project layout

```
index.html               app shell: canvas, timeline bar, HUD, overlays, fallback
src/
  main.ts                boot: WebGL check, staged layer build, wiring, render loop
  styles.css             dark-glass HUD styling (era accent driven by a CSS variable)
  config/types.ts        era content contracts, scene-category and layer types
  config/eras.ts         the five complete era definitions
  state/store.ts         tiny observable app state + URL-hash deep links
  core/rng.ts            seeded deterministic PRNG
  core/engine.ts         renderer, light rig, frame loop, adaptive quality, context loss
  core/postfx.ts         bloom + per-era grade / grain / vignette shader stack
  core/cameraControls.ts damped orbit / zoom / pan / fly-to camera
  world/textures.ts      procedural canvas textures + cached material library
  world/roads.ts         street grid, kerbs, crosswalks, rails, bike lane, surface wear
  world/buildings.ts     parametric facade generator (32 buildings per era)
  world/vehicles.ts      parametric vehicle fleet builder
  world/pedestrians.ts   era-outfit pedestrian figure builder
  world/props.ts         street furniture per era
  world/signage.ts       storefront + advertising content specs and meshes
  world/sky.ts           gradient dome, sun, clouds, stars, birds, banner plane
  world/cityBlock.ts     assembles a complete era layer
  sim/traffic.ts         lane graph, signalised intersection, brake / indicator lights
  sim/crowds.ts          sidewalk routes, walk cycles, crosswalk gating
  sim/animation.ts       steam, flutter, flicker, tickers, birds, camera drift
  ui/timelineModel.ts    pure slider maths (mapping, snapping, keyboard, ARIA)
  ui/timeline.ts         the top-of-screen slider
  ui/hud.ts              readouts, help overlay, info card, loading and fallback
  era/transition.ts      the staged era transformation controller
  audio/eraAudio.ts      declarative per-era sound parameters
  audio/audioEngine.ts   Web Audio synthesis graph
tests/                   vitest suites (headless, node environment)
```

---

## Verification

```bash
npm run typecheck   # tsc --noEmit, strict
npm test            # vitest run — era data, content distinctness, slider maths,
                    # transition blending, era-layer scene graphs, camera behaviour, audio
npm run build       # production bundle
```

The test suite is deliberately headless: it builds real three.js scene graphs for all five decades
(asserting building / vehicle / pedestrian / prop / advertisement counts, period-specific elements
and seeded determinism), drives the camera with synthetic input, steps the transition controller
with manual ticks, and exercises the audio engine against an injected fake `AudioContext`. WebGL
rendering itself is verified by running `npm run dev` and looking at it.

### Notes for reviewers

* **Autoplay policy** — sound only starts after a gesture; the "Enable sound" pill stays visible
  until then (and disappears permanently once unlocked).
* **Performance** — `devicePixelRatio` is capped, geometries and materials are shared per era layer,
  windows are instanced, and quality steps down automatically (pixel ratio + bloom) if the frame
  rate stays below 40 fps for a few seconds.
* **Reduced motion** — with `prefers-reduced-motion: reduce`, era transitions resolve in ~140 ms
  instead of ~1 s.
* **No WebGL** — a styled fallback panel explains the requirement instead of showing a blank page.
