# CitySim

A standalone, browser-based 2D city simulation. The city runs in real time with
citizens, vehicles, companies, and a live economy — viewable in any browser with
zero build step, zero runtime dependencies, and zero network access.

## Run it

**Directly (no server):** open `index.html` in any modern browser via `file://`.
The simulation starts automatically on load — no start button, no install.

**Via the optional dev server (for convenience):**

```sh
node server.js          # binds 127.0.0.1, honors $PORT (default 8000)
```

## What you see

- A large tile city (96×96 tiles) with roads, parks, ponds, and 64+ buildings.
- 200 citizens following daily schedules: sleep → wake → commute → work →
  lunch → work → entertainment → home.
- 60 vehicles (cars, buses, trucks) driving the road network.
- Companies with employees, revenue, expenses, and profit history; the economy
  ticks every sim-hour and updates the city budget.
- A visible day/night cycle: ambient tint, glowing building windows, street
  lamps, and vehicle headlights after dark.
- Top overlay with population, employment rate, city time, and budget.
- A minimap showing the whole city with a live viewport rectangle; click or
  drag it to jump the camera.
- Click any citizen, vehicle, or building to open the inspector with rich,
  live-updating details.

## Controls

| Input | Action |
| --- | --- |
| Drag canvas | Pan the camera |
| Mouse wheel / `+` `-` | Zoom in / out (at cursor) |
| `WASD` / arrow keys | Pan |
| `Space` | Pause / resume |
| HUD buttons | Pause, 1×, 2×, 4× speed |
| Click canvas | Select entity (citizen / vehicle / building) |
| Click / drag minimap | Recenter camera |

## Pacing

At 1× speed one sim-hour takes 30 real seconds (a full day in 12 minutes).
The simulation starts at Day 1 07:00 with citizens already commuting and every
vehicle already moving, so the city is alive from the first frame. The 4× speed
setting accelerates a full day/night cycle to about 3 minutes.

## Architecture

Zero-build static site. Classic ordered `<script>` tags (never ES modules, so
`file://` loading works). Every module is an IIFE attaching to
`globalThis.CitySim`, so the exact same files run in Node's `vm` for tests.

```
index.html          entry point; auto-starts via js/main.js
css/style.css       layout and HUD styling
js/config.js        constants and tuning
js/utils.js         pure helpers (RNG, math, formatting)
js/city.js          tile grid generation
js/pathfinding.js   A* over the tile grid with LRU cache
js/buildings.js     building placement and definitions
js/companies.js     employers attached to buildings
js/citizens.js      citizen schedule state machine + movement
js/vehicles.js      cars / buses / trucks on the road network
js/economy.js       hourly budget and company accounting
js/sim.js           clock, pacing, hour-boundary hooks
js/camera.js        viewport math (pure)
js/renderer.js      canvas rendering (cached static layer + culling)
js/minimap.js       minimap + click-to-jump (single map<->world mapping)
js/hud.js           top overlay and speed controls
js/inspector.js     entity picking + detail panel
js/main.js          bootstrap, input wiring, RAF loop
server.js           dev-only static server (127.0.0.1, honors $PORT)
tests/run-tests.js  headless verification
```

Performance: the static city is pre-rendered once to an offscreen canvas and
blitted per frame; dynamic entities are culled to the viewport; the minimap
static layer is cached; pathfinding results are cached.

## Tests

```sh
node tests/run-tests.js
```

The harness vm-compiles every JS module (syntax gate), then loads the logic
modules and asserts world scale, movement at load, pathfinding validity,
citizen schedule cycles across a 30+ sim-hour fast-forward, hourly economy
ticks, day/night tint values, camera/minimap mapping round-trips, entity
picking, and `file://` compatibility.