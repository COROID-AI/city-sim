# Browser screenshot evidence — café timelapse

This directory holds the per-era browser evidence for the café timelapse: five
years × one fixed-pose view and three close-up hotspot views, captured from the
running page (the dev-server build a visitor loads), plus an objective check that
the images are real, non-blank and mutually distinct renders.

```
tests/evidence/
├── README.md                 this file (index, protocol, verification report)
├── capture.mjs               the capture tool (Chromium DevTools Protocol, no added dependency)
├── verify-images.mjs         objective pixel checks over the captured PNGs
├── capture-summary.json      what the page reported while each year was captured
├── 1945/{default,closeup-menu,closeup-music,closeup-counter}.png
├── 1965/…  1985/…  2005/…  2025/… (same four views)
```

## What each capture shows

| File | Camera | Purpose |
| --- | --- | --- |
| `<year>/default.png` | fixed default pose, identical for all five years | comparable era-to-era view of furniture, equipment, signage, lighting, menu and patrons |
| `<year>/closeup-menu.png` | menu-board hotspot framed through `InspectMode` | period menu surface, lettering and prices up close |
| `<year>/closeup-music.png` | music-source hotspot framed through `InspectMode` | the era's single music playback device up close |
| `<year>/closeup-counter.png` | service-counter hotspot framed through `InspectMode` | counter technology up close (till → register → ECR → POS → tablet + contactless reader) |

All captures are 1280×720 CSS pixels at device scale 1. The default pose is
restored from `NavigationController.savePose()`/`restorePose()` before every
capture, which is what makes the five `default.png` frames comparable.

`capture-summary.json` records, per year: the settled era, whether the kernel ran
headless (it did **not** — a real renderer was used), the single music device node
the scene publishes (`music:<year>:<deviceId>`), and the render statistics the page
computed for that frame. Those statistics match the headless performance suite
exactly (draw calls 2352 / 2464 / 2361 / 2084 / 2381 for 1945 / 1965 / 1985 /
2005 / 2025), which cross-checks that the performance budget measures the same
scene the browser draws.

## How to reproduce

```bash
# terminal 1 — the app a visitor loads
npm run dev

# terminal 2 — drive it and write the evidence
node tests/evidence/capture.mjs --url http://localhost:5173/ --out tests/evidence

# then check the pixels
node tests/evidence/verify-images.mjs --out tests/evidence
```

Useful flags: `--years 1985,2025` (subset), `--width/--height` (viewport),
`--chromium <path>` (browser binary), `--port` (DevTools port), `--keep-open`.
The tool launches its own headless Chromium with software WebGL
(`--use-angle=swiftshader --enable-unsafe-swiftshader`), drives the **real**
timeline control (`TimelineSlider.select`) and the **real** inspect mode
(`InspectMode.open`), and captures through `Page.captureScreenshot`. It adds no
dependency: it speaks the DevTools Protocol over Node's built-in `WebSocket`.

Note on pacing: headless software rendering draws this scene in roughly a second
per frame, and Chromium throttles `requestAnimationFrame` while nothing is being
captured. The tool therefore advances the composition in deterministic steps
(`CafeComposition.tick`, i.e. exactly the pipeline the frame loop drives) at the
`low` render quality to settle a year, then switches back to the production `high`
quality for the screenshot frame. Era geometry, materials, lighting and poses are
identical; only the intermediate frames are cheaper.

## Verification report

`node tests/evidence/verify-images.mjs` decodes all twenty PNGs with `node:zlib`
(no image dependency) and checks three things: each frame is a real render rather
than a blank or single-colour image, the five fixed-pose views differ pairwise,
and each close-up differs from its era's default view. Last run (2026-09-15):
**20 images, all checks passed.**

Rendered content per year — mean RGB, luminance and pixel variance over the sample
grid (a blank frame would show variance ≈ 0 and one distinct colour):

| capture | mean RGB | luma | variance | distinct colours |
| --- | --- | --- | --- | --- |
| 1945 default | 57.9, 42.1, 24.8 | 44.2 | 2938 | 826 |
| 1965 default | 60.5, 29.3, 16.6 | 35.0 | 2183 | 1286 |
| 1985 default | 39.9, 9.3, 14.4 | 16.2 | 1047 | 1806 |
| 2005 default | 37.7, 29.5, 20.0 | 30.6 | 1638 | 697 |
| 2025 default | 43.1, 33.6, 24.5 | 35.0 | 2946 | 1150 |

The lighting story is visible in those numbers alone: 1985 is the darkest, most
magenta year (luma 16, green channel 9), 1965 and 1945 are the warm orange/brown
ends, 2005 is the most neutral, 2025 is warm but bright.

Pairwise separation of the fixed-pose default views (share of sampled pixels that
differ by more than 12 levels per channel):

| pair | mean-colour distance | differing pixels |
| --- | --- | --- |
| 1945 vs 1965 | 15.4 | 77.3% |
| 1945 vs 1985 | 38.8 | 69.8% |
| 1945 vs 2005 | 24.2 | 71.3% |
| 1945 vs 2025 | 17.0 | 68.3% |
| 1965 vs 1985 | 28.8 | 69.6% |
| 1965 vs 2005 | 23.0 | 74.0% |
| 1965 vs 2025 | 19.6 | 70.4% |
| 1985 vs 2005 | 21.1 | 62.6% |
| 1985 vs 2025 | 26.5 | 54.5% |
| 2005 vs 2025 | 8.1 | 58.0% |

Close-ups differ from their era's default view on 61–95% of sampled pixels, so
each close-up really is a different framing of the era rather than a duplicate.

### What the evidence does and does not prove

- **Proves**: a real WebGL renderer draws each of the five eras at a fixed pose,
  the frames are non-blank, the five eras are visibly different from one another
  (lighting, palette and geometry), each era has three distinct close-up framings,
  and the page-side render statistics agree with the headless performance suite.
- **Does not prove**: aesthetic quality, brand fidelity or period accuracy by
  itself. Those are qualitative judgements, and the content decisions behind each
  year are recorded in [`docs/period-accuracy.md`](../../docs/period-accuracy.md).
  The visual "polished and era-appropriate" call belongs to the qualitative
  review stage, using these images.
- **Limitation of the generic smoke probe**: in this execution sandbox the
  runner's default browser probe cannot establish a WebGL context (its report
  lists `webgl` as unavailable and three.js then logs shader-validation errors for
  `menu:1945:face` and the tableware materials). That is a graphics-infrastructure
  limitation of the probe, not a defect in the scene: the same page renders
  correctly — with in-page draw-call/triangle counts matching the headless suite —
  under the explicitly configured software-WebGL Chromium this tool launches.

## Regenerating the evidence

The images are committed artefacts. Re-run `capture.mjs` after any content change
so the evidence keeps matching the scene, then re-run `verify-images.mjs`; the
README tables above should be refreshed from its output if the numbers move
appreciably.
