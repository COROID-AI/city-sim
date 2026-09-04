# Coroid — 30s Promo Video

A fully procedural, cinematic 30-second promo for **Coroid (coroid.ai)**, rendered
at **1920×1080 @ 30fps (900 frames)** with NumPy + Pillow and encoded to MP4 with
FFmpeg. No stock footage, no external assets — every frame is generated from code.

## The video

Six choreographed scenes flow together with cinematic crossfades, a color grade
(vignette + film grain) and letterbox bars for a premium, studio-produced feel:

| Time     | Scene      | Story beat                          |
|----------|------------|-------------------------------------|
| 0.0–4.6  | **Cosmos** | "The intelligence behind everything" — nebula, starfield, energy orb |
| 4.6–9.6  | **Network** | "One platform. Every system." — live neural hub & data grid |
| 9.6–14.6 | **Data**   | "See what's invisible" — data streams, animated bar chart, HUD |
| 14.6–19.6| **Control**| "Command your world" — rotating HUD rings, core, satellites |
| 19.6–24.6| **Impact** | "Built for what matters" — energy surge, expanding rings, sparks |
| 24.6–30.0| **Logo**   | COROID lockup, tagline, coroid.ai CTA |

## Quick start

```bash
# 1. Create a virtualenv and install dependencies (numpy, Pillow, imageio-ffmpeg)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Render all 900 frames and encode the MP4 (~5 min)
.venv/bin/python promo/render.py
# -> dist/coroid_promo_30s.mp4
```

Or use the npm wrapper:

```bash
npm run setup    # create venv + install deps
npm run render   # produce dist/coroid_promo_30s.mp4
npm test         # smoke-render + verify output metadata
```

## Verification

```bash
npm run smoke    # render sample frames twice, assert determinism -> dist/frame_hashes.json
npm run verify   # probe MP4 (duration 30s, 1920x1080) + determinism + deps
```

## Layout

```
promo/                 renderer package
  common.py            design system: palette, easing, frame buffer, blending
  effects.py           orbs, glows, sparkles, data streams, particles
  typography.py        gradient/glow text, HUD, motion-graphic primitives
  scenes.py            6 scene renderers + registry
  render.py            orchestrator: renders 900 frames -> pipes to ffmpeg
  fonts/               bundled Montserrat, Space Grotesk, JetBrains Mono, etc.
scripts/
  smoke_render.py      determinism smoke test
  verify_output.js     QA metadata verification
dist/                  output artifacts (coroid_promo_30s.mp4, frame_hashes.json)
```