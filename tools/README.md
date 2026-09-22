# Dev-only verification harness

These scripts exist to verify the single-file deliverable `rocket-launch.html`. **They are not part
of the product.** The product must keep rendering identically when `tools/` and `vendor/` are
deleted: it references nothing but the pinned Three.js CDN ES module, generates every texture with
canvas 2D at runtime and holds no relative asset, style or script reference.

```bash
node tools/verify.mjs             # one command: static gate + browser gate + canvas readback gate
node tools/verify-static.mjs      # deterministic structure/self-containment/contract gate
node tools/verify-browser.mjs     # headless-Chromium render + frame-analysis gate
node tools/check-canvas-readback.mjs   # canvas pixel-evidence gate (real readback at every phase)
node tools/verify-browser.mjs --quick      # 5 checkpoints instead of the full matrix
node tools/verify-browser.mjs --mirror     # force the local-mirror mode (skip the CDN probe)
node tools/verify-browser.mjs --cdn        # force the CDN mode (skip the reachability probe)
node tools/check-canvas-readback.mjs --quick   # 3 phases instead of the full matrix
node tools/serve.mjs              # dependency-free static server for live/browser probes
```

The root `package.json` is a thin, dependency-free wrapper around exactly those commands (no build
step, no install, no runtime dependency — the product is still the single HTML file):

```bash
npm run dev            # = node tools/serve.mjs   (loopback static server, PORT honoured)
npm start              # same
npm run verify         # static gate + full browser gate
npm run verify:static  # static gate only
npm run verify:browser # browser gate only
npm run verify:readback # canvas pixel-evidence gate only
npm test               # same as npm run verify (non-zero exit on any failure)
```

## `tools/serve.mjs` — runnable entry point for live verification

`rocket-launch.html` is delivered as a `file://` page, but automated live verification (browser
probes that must screenshot AC-linked states, CDP sessions, `http://` captures) needs an origin to
load, and the environment ships no server (no Python, and `npx` would need the network). This script
closes that capability gap with Node builtins only:

* serves the repository root read-only, `127.0.0.1` only (never `0.0.0.0`/`::`);
* `/` resolves to `/rocket-launch.html`; query strings pass through, so the page hooks work over
  HTTP exactly as they do over `file://` (`http://127.0.0.1:PORT/rocket-launch.html?t0=8&nofx=1`);
* honours `PORT` (the port owned by the verification harness) and `--port/--root/--host`;
* `no-store` responses, path-traversal safe, 404 for unknown paths, 405 for non-GET/HEAD;
* prints `ROCKET_SERVE_READY http://127.0.0.1:PORT/rocket-launch.html`, the readiness line a probe
  can wait for, and exits on SIGINT/SIGTERM.

### Live functional + screenshot evidence

Because the page is now servable, live acceptance evidence can be captured against the real
deliverable and bound to acceptance criteria instead of being re-derived by hand:

1. start the server (`npm run dev`, or `node tools/serve.mjs` in a harness-managed port);
2. open the ready URL in a real browser and record the AC-linked states — baseline `PRELAUNCH`
   (`?t0=0.5`), `IGNITION` (`?t0=4.5`), `THRUST_RAMP` (`?t0=8`), `CLAMP_RELEASE` (`?t0=9.3`),
   `LIFTOFF` (`?t0=12`), `ASCENT` (`?t0=18`), `CLOUD_LAYER` (`?t0=30`), `HIGH_ALTITUDE` (`?t0=45`),
   the post-processing bypass (`?nofx=1`) and the reduced quality path (`?q=low`);
3. assert against the live `data-rd-*` diagnostics and the captured frames (the same thresholds the
   browser gate uses), so both the functional evidence (live state) and the screenshot evidence
   (captured frames at 800x450 and 1024x576) come from one probe run;
4. keep the `file://` route as the primary product surface: the server must never be required for
   the page to work, and `tools/verify-static.mjs` fails if the product references `tools/`.

### AC-linked probe plan (both evidence kinds per criterion)

Acceptance evidence is only credited per criterion when a state is reached **by an AC-linked
interaction** (live functional evidence) *and* a screenshot of that same state name is captured
(screenshot evidence). Capture one probe run per phase, each carrying an action whose `criteriaRefs`
name the criteria it proves and a matching screenshot intent at 800x450 **and** 1024x576 (the
coverage criterion needs both sizes):

| `readinessPath` | phase | state name | `criteriaRefs` |
| --- | --- | --- | --- |
| `/rocket-launch.html?t0=0.5` | PRELAUNCH | `prelaunch-pad-clamps-closed` | AC-1, AC-3, AC-4, AC-5, AC-12, AC-19 |
| `/rocket-launch.html?t0=0.5` | PRELAUNCH | `prelaunch-drift-wisps` | AC-2, AC-6, AC-18 |
| `/rocket-launch.html?t0=8` | THRUST_RAMP | `engine-thrust-ramp-fire-smoke-dust` | AC-4, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-18, AC-20 |
| `/rocket-launch.html?t0=9.6` | CLAMP_RELEASE | `clamp-arms-release-before-liftoff` | AC-5, AC-6, AC-12, AC-13 |
| `/rocket-launch.html?t0=12` | LIFTOFF | `liftoff-long-attached-plume` | AC-4, AC-6, AC-9, AC-13, AC-14, AC-15 |
| `/rocket-launch.html?t0=30` | CLOUD_LAYER | `ascent-cloud-layer-horizon` | AC-4, AC-6, AC-9, AC-15, AC-16, AC-17, AC-19 |
| `/rocket-launch.html?t0=45` | HIGH_ALTITUDE | `high-altitude-horizon-and-clouds` | AC-4, AC-14, AC-16, AC-18, AC-19, AC-20 |

Use the canvas as the locator for every action, keep the retained frames (`tmp/verify/*.png` from
the gates plus the probe captures), and report the live `data-rd-*` state of each state next to its
frame. A phase captured without an AC-linked action, or an action without a screenshot of its own
state name, counts as neither kind of evidence.

Both use Node builtins only (`node:fs`, `node:zlib`, `node:http`, `node:https`,
`node:child_process`, `node:path`, `node:url`) — no install step, no package manager, no framework.
`chromium` must be on `PATH` (or set `CHROMIUM=/path/to/chromium`).

## `tools/check-canvas-readback.mjs` — canvas pixel-evidence gate

Acceptance evidence for this product is *pixel* evidence, and pixel evidence only exists if the page's
canvas can actually be read back. A WebGL canvas created without `preserveDrawingBuffer` hands a
**blank** buffer to every canvas-level read (`canvas.toDataURL()`, `ctx.drawImage(canvas, …)`,
`getImageData`) once the frame callback has returned, so canvas-based sampling cannot conclude
anything about the frame and reports "inconclusive: no blank / non-blank conclusion" instead of
usable live functional or screenshot evidence. `rocket-launch.html` therefore creates its renderer
with `preserveDrawingBuffer: true` (a one-line renderer option; it does not change the rendered
image), and this gate proves the consequence at every phase of the launch.

It drives the real `file://` deliverable through the Chrome DevTools Protocol over the WebSocket
built into Node 21+ (`WebSocket`) — still no dependency, no install, no package manager — waits for
the page's own `rd-ready=1`, then:

* reads the frame back through both the 2D-canvas path (`drawImage` + `getImageData`) and the page's
  own PNG encoder (`canvas.toDataURL('image/png')`);
* samples twice, 400 ms apart, and computes the inter-sample luma difference, so a frozen, detached
  or blank buffer cannot pass;
* asserts non-blank readback (every sampled pixel non-zero), mean luma inside the bright-daylight
  window, luma variance above the flat-frame floor, an encoded PNG far larger than a blank canvas
  image, the expected phase and an empty `rd-error`;
* writes `tmp/verify/readback-<phase>.png` (the frame the canvas itself produced) and
  `tmp/verify/readback-evidence.json`, which maps every acceptance criterion covered by the matrix
  to the phase's live `data-rd-*` runtime state **and** its retained canvas frame — i.e. the same
  live functional + screenshot evidence pairing the browser gate emits, obtained from the canvas.

Phase matrix (each phase runs the deliverable at `?t0=<seconds>`, plus the `?nofx=1` / `?q=low`
variants and the isolated-copy run): `prelaunch` 0.5, `ignition` 4.5, `thrust-ramp` 8,
`clamp-release` 9.6, `liftoff` 12, `cloud-layer` 30, `high-altitude` 45, `nofx`, `quality-low`,
`coverage-800` (t0 0.5 at 800x450) and `coverage-1024` (t0 30 at 1024x576, which also assert that the
reported canvas CSS rect equals the reported viewport, i.e. edge-to-edge coverage), `isolated`. Exit
code is non-zero with a readable failure list when any phase fails. If the runtime
has no chromium binary or no global `WebSocket`, or if the page never boots at all (the pinned CDN
module unreachable offline), the gate prints an explicit `ENVIRONMENT-LIMITED` line and exits 0
rather than claiming a pass — the static and browser gates stay authoritative.

## Internal render scale (`[CAP:RENDER_SCALE]`) — what makes canvas sampling conclude

Canvas-level pixel evidence costs a full copy of the drawing buffer: the bigger the backing store,
the longer every `toDataURL()` / `drawImage()` / `getImageData()` read stalls the renderer (chromium
logs `GPU stall due to ReadPixels` for each one). On a software rasteriser — SwiftShader in this
runtime, which is exactly what automated probes use — a full-viewport backing store made those reads
slow enough that a probe could not reach a blank/non-blank conclusion at all and reported
*"Canvas pixel sampling was inconclusive … use the retained screenshot or vision evidence"* for the
near-ground phases (pre-launch, ignition, thrust ramp, clamp release, the `?nofx=1` bypass), instead
of the reliable pixel evidence the airborne phases produced.

`rocket-launch.html` therefore caps the *internal* render scale, never the visible scene:

* the canvas CSS box is still the viewport (edge to edge, no margins, unchanged by this lever) and
  the browser upscales the drawing buffer to it;
* a software rasteriser (SwiftShader / llvmpipe / softpipe / swrast / "software rasterizer", read
  through `WEBGL_debug_renderer_info`) starts on the largest ladder rung whose backing store stays
  inside `BUDGET.canvasPixels` (160 000 px), i.e. 0.65 at 800x450 and 0.5 at 1024x576, and is pinned
  there (`minRenderScale() === maxRenderScale()`);
* a hardware renderer starts at **full resolution** (rung 1) and only the adaptive ladder in
  `[CAP:QUALITY_SCALE]` moves it — one rung down after three frames that miss 25 fps, one rung back
  up after ~2 s of 50 fps-or-better headroom, never below `BUDGET.renderScaleFloor` (0.5);
* nothing is removed from the scene by this lever (geometry, materials, lights, shadow map, clouds
  and every particle system keep rendering), so composition, colour, brightness and the rocket's
  prominence are unaffected — the static and browser gates assert exactly those properties, and the
  canvas readback gate now prints the live `scale=` per phase next to its pixel statistics.

The effect is measurable in this runtime: the same phases that reported `sampleReliability:
inconclusive` at scale 1.0 (pre-launch 450 kB canvas PNG, thrust ramp, clamp release, `?nofx=1`) read
back as `sampleReliability: reliable` with `evidenceStatus: complete` and **no limitations** at the
budgeted scale, at both evidence viewports. `data-rd-scale` / `__ROCKET_DIAG__.renderScale` publish
the live value, and both dev gates assert it stays inside `[0.4, 1]`.

## `tools/verify-static.mjs` — authoritative structural gate

No browser, no network. It asserts:

* exactly one product HTML file in the repository root (`rocket-launch.html`);
* exactly one external reference and that it is the pinned Three.js ES-module CDN URL — no other
  `http(s)`/protocol-relative URL, no `data:image` base64 blob, no `<script src>`, no `<link>`, no
  CSS `@import`, no dynamic `import()`, and no reference to `tools/` or `vendor/`;
* the fullscreen CSS contract (`html, body { margin/padding 0; width/height 100%; overflow hidden }`
  and a fixed, full-bleed `canvas#scene`);
* the body contains exactly one element — the canvas — and no visible text (the module lives in
  `<head>`, so the body really does contain nothing else);
* the extracted inline module parses (`node --check tmp/verify/extracted.mjs`);
* all 52 `[CAP:NAME]` capability markers are present, each attached to a non-trivial section;
* the complete `data-rd-*` diagnostics contract is assigned every frame, the `ROCKET_BOOT_OK` marker
  and the `window.onerror` / `unhandledrejection` capture exist, `window.__ROCKET_DIAG__` is
  populated, and the `?t0`, `?nofx`, `?q` hooks are parsed with a bounded fixed-step warm-up;
* the documented performance budgets (`BUDGET`) exist and stay inside their limits, the frame loop
  clamps its delta, and `Math.random()` is never used (deterministic seeded RNGs only);
* the adaptive render scale is present and bounded: the ladder exists, `setRenderScale` clamps
  between `minRenderScale()` and the viewport-derived ceiling, software rasterisers start on a
  budgeted rung while hardware renderers keep full resolution, and the ladder can step downwards.

Exit code is non-zero with a readable failure list when any check fails.

## `tools/verify-browser.mjs` — render gate

Resolves the Chromium binary, probes CDN reachability, then picks a mode:

| mode | when | what it proves |
| --- | --- | --- |
| `cdn` | the pinned CDN URL answers with 200 | the real `file://` page imports the real CDN module and renders |
| `mirror` | no network, but `vendor/three.module.js` exists (auto-fetched opportunistically when the network is available) | the same page renders with the CDN URL rewritten in a temporary copy served by a local `node:http` server |
| `skip` | no network and no mirror | **nothing** — prints an explicit `ENVIRONMENT-LIMITED` report and exits 0 with the static gate authoritative |

A checkpoint is never silently passed: `skip` mode says so loudly, and every executed checkpoint is
verified against the real page.

`--mirror` forces the mirror branch even when the CDN is reachable, which is how the fallback path
itself is exercised; `--cdn` fails loudly instead of falling back.

### Chromium flags

```
--headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader --use-angle=swiftshader
--hide-scrollbars --force-device-scale-factor=1 --window-size=W,H --virtual-time-budget=N
--screenshot=<png> --dump-dom --enable-logging=stderr --v=0
```

`--screenshot` and `--dump-dom` run in the same invocation: the DOM dump carries the live
`data-rd-*` diagnostics after the virtual-time budget, the PNG carries the frame. Chromium's exit
code stays 0 even when the page throws, so the gate parses stderr for `Uncaught` / shader errors and
requires the `ROCKET_BOOT_OK` console marker instead of trusting the exit status.

Headless virtual time delivers only about one animation frame per simulated second, so the timeline
is jumped with `?t0=<seconds>`, which performs a bounded fixed-step warm-up (`dt = 1/60`, capped at
60 s) before the first rendered frame. After that warm-up the page keeps animating while chromium
drains the virtual-time budget, so the timestamp the diagnostics are read at is `t0` plus a drift of
roughly 0.2-0.35 s (three or four frames of the page's 0.1 s delta clamp). The checkpoint `t0`
values are chosen so that the *observed* time — not `t0` — falls inside the window each checkpoint
measures; `clamp-release` is the tightest case, because the clamps must be fully open before the
vehicle's altitude leaves the pad at t = 10 s, which leaves only a 0.9 s release ramp to sample.
The page-reported layout viewport is also shorter than
`--window-size`, which is why edge-to-edge coverage is asserted from `data-rd-rect` versus
`data-rd-inner` **and** from the captured frame's border pixels, never from the window size.

### Checkpoint matrix

| id | `t0` | expected phase |
| --- | --- | --- |
| `prelaunch` | 0.5 | PRELAUNCH |
| `ignition` | 4.5 | IGNITION |
| `thrust-ramp` | 8.0 | THRUST_RAMP |
| `clamp-release` | 9.3 | CLAMP_RELEASE (observed ~9.5-9.65 s, mid ramp: `0.2 < clamp < 1`) |
| `liftoff` | 12.0 | LIFTOFF |
| `ascent-18` / `ascent-20` | 18.0 / 20.0 | ASCENT (monotonic altitude, increasing speed, plume change) |
| `ascent-20-progress` | 20.0 with a longer virtual-time budget | two frames at the same `t0` differ (animation really advances) |
| `cloud-layer` | 30.0 | CLOUD_LAYER |
| `high-altitude` | 45.0 | HIGH_ALTITUDE |
| `coverage-800` / `coverage-1024` | 0.5 / 30.0 at 800x450 and 1024x576 | edge-to-edge coverage at two window sizes |
| `nofx` | 8.0 with `?nofx=1` | the post-processing bypass path renders bright frames with no errors |
| `quality-low` | 8.0 with `?q=low` | the adaptive-quality path lowers particle caps / shadows / dpr without errors |
| `isolated` | 4.5 from a copy outside the repository | the page has no relative dependency on the repository layout |

### What is asserted

Per checkpoint: boot marker + no `Uncaught`/shader errors + `rd-error` empty, the expected phase, the
canvas CSS rect equal to the reported viewport, mean luma / saturation / unique-colour count /
largest-uniform-region fraction thresholds, zero page-background border pixels, blue-sky reading in
the upper frame at pre-launch, the rocket's projected screen rect inside the central region above the
prominence threshold, the live internal render scale (`rd-scale` inside `[0.4, 1]`), and every
performance budget reported by `rd-draw`, `rd-tri`, `rd-smoke`, `rd-sparks`, `rd-debris`.

Across checkpoints: the exact phase order with thrust starting at zero and rising, vibration and the
engine light ramping from zero, clamps closed → open before the altitude leaves the pad, monotonic
altitude with increasing vertical speed and no horizontal drift, the plume attached and changing
length, smoke/dust counts growing by roughly an order of magnitude with radius and height spreading,
sparks/embers/debris active, vegetation and loose props reacting, camera height following the rocket,
cloud bands reached, visual density and measurable frame-to-frame progress.

### Artifacts

Everything is written to `tmp/verify/` (git-ignored):

* `<checkpoint-id>.png` — captured frames (kept for inspection),
* `report.json` — mode, per-checkpoint timing/phase and the failure list,
* `evidence.json` — acceptance-criterion evidence map: for every criterion the executed checkpoints
  that evidence it, each with the live `data-rd-*` runtime state (live functional evidence) and the
  retained frame path (screenshot evidence), so a live run is citable per criterion,
* `extracted.mjs` — the module extracted by the static gate, used for `node --check`,
* `isolated/` — temporary copy used for the isolation checkpoint (removed on pass),
* `mirror.html` — the rewritten temp copy used in mirror mode.

### PNG analysis

`tools/lib/png.mjs` is a dependency-free PNG decoder (IHDR parse, `zlib.inflateSync`, unfilter types
0–4, colour types 0/2/4/6) plus the frame statistics the gate thresholds rest on: mean luma, mean
saturation, unique quantised colours, largest uniform region, per-edge border coverage, blue-sky
reading, near-white flame-core ratio, normalised-region statistics and inter-frame difference.
