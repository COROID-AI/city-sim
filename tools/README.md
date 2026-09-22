# Dev-only verification harness

These scripts exist to verify the single-file deliverable `rocket-launch.html`. **They are not part
of the product.** The product must keep rendering identically when `tools/` and `vendor/` are
deleted: it references nothing but the pinned Three.js CDN ES module, generates every texture with
canvas 2D at runtime and holds no relative asset, style or script reference.

```bash
node tools/verify-static.mjs      # deterministic structure/self-containment/contract gate
node tools/verify-browser.mjs     # headless-Chromium render + frame-analysis gate
node tools/verify-browser.mjs --quick      # 5 checkpoints instead of the full matrix
node tools/verify-browser.mjs --mirror     # force the local-mirror mode (skip the CDN probe)
node tools/verify-browser.mjs --cdn        # force the CDN mode (skip the reachability probe)
```

Both use Node builtins only (`node:fs`, `node:zlib`, `node:http`, `node:https`,
`node:child_process`, `node:path`, `node:url`) — no install step, no package manager, no framework.
`chromium` must be on `PATH` (or set `CHROMIUM=/path/to/chromium`).

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
* all 51 `[CAP:NAME]` capability markers are present, each attached to a non-trivial section;
* the complete `data-rd-*` diagnostics contract is assigned every frame, the `ROCKET_BOOT_OK` marker
  and the `window.onerror` / `unhandledrejection` capture exist, `window.__ROCKET_DIAG__` is
  populated, and the `?t0`, `?nofx`, `?q` hooks are parsed with a bounded fixed-step warm-up;
* the documented performance budgets (`BUDGET`) exist and stay inside their limits, the frame loop
  clamps its delta, and `Math.random()` is never used (deterministic seeded RNGs only).

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
60 s) before the first rendered frame. The page-reported layout viewport is also shorter than
`--window-size`, which is why edge-to-edge coverage is asserted from `data-rd-rect` versus
`data-rd-inner` **and** from the captured frame's border pixels, never from the window size.

### Checkpoint matrix

| id | `t0` | expected phase |
| --- | --- | --- |
| `prelaunch` | 0.5 | PRELAUNCH |
| `ignition` | 4.5 | IGNITION |
| `thrust-ramp` | 8.0 | THRUST_RAMP |
| `clamp-release` | 9.6 | CLAMP_RELEASE |
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
prominence threshold, and every performance budget reported by `rd-draw`, `rd-tri`, `rd-smoke`,
`rd-sparks`, `rd-debris`.

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
* `extracted.mjs` — the module extracted by the static gate, used for `node --check`,
* `isolated/` — temporary copy used for the isolation checkpoint (removed on pass),
* `mirror.html` — the rewritten temp copy used in mirror mode.

### PNG analysis

`tools/lib/png.mjs` is a dependency-free PNG decoder (IHDR parse, `zlib.inflateSync`, unfilter types
0–4, colour types 0/2/4/6) plus the frame statistics the gate thresholds rest on: mean luma, mean
saturation, unique quantised colours, largest uniform region, per-edge border coverage, blue-sky
reading, near-white flame-core ratio, normalised-region statistics and inter-frame difference.
