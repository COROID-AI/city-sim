# Final QA — Café Time Period Timelapse

Ship-gate walkthrough for the finished experience. This document records the
**5 eras × 9 categories** audit matrix, the defects found and fixed during the
final integration pass, and the known limitations.

---

## Walkthrough matrix (5 eras × 9 categories)

| Era | Furniture & decor | Coffee & brewing | Menu & prices | Music source | Posters & ads | Tableware | Signage & lighting | Counter tech | Patrons |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1945** | Heavy oak tables, Thonet bentwood chairs, lace/damask curtains, checkerboard linoleum | Manual lever espresso machine, wall-mounted grinder | Coffee 7¢ · pie 15¢ · milk 5¢ | Walnut valve wireless set on the counter | "Buy War Bonds", sugar-ration notice, Coca-Cola sign, V-E Day newspaper | White porcelain cups with gold rims, glass carafe | Brass pendants + sconces, warm tungsten | Hand-crank mechanical cash register | Suits, victory-roll hair, fedoras, reading the paper |
| **1965** | Teak tables, chrome splayed legs, molded chairs, area rug, string art, macramé | Chrome-and-bakelite espresso (glass dome + steam wands), sugar dispensers, cake stand | Letterboard: coffee 15¢ · espresso 20¢ · milkshakes 25¢ | Chrome-and-glass jukebox with 45s (5¢/3 plays) | 60s travel posters, instant-coffee ad, starburst clock | Pastel melamine mugs, milkshake glasses, ashtrays | Neon "OPEN" sign, sputnik pendant, café lamps | Electric round-key cash register with receipt printer | Slim suits, shift dresses, beehives, leather jacket, transistor radio |
| **1985** | Black laminate tables, chrome legs, black vinyl chairs, rubber plants, mirrored panel, Memphis mural | Boxy chrome espresso (digital keypad), drip tower with decanters, cookie jar | Backlit lightbox: coffee 55¢ · espresso 75¢ · cappuccino 85¢ | Silver twin-cassette boombox with VU meters | Gig flyers, Grand Opening poster, Employee of the Month, Coffee Talk board | Ceramic mugs, sugar dispensers, teabag caddies, Rubik's cube | Pink/teal neon strips, track spots, CRT static TV | Early electronic POS with green segment + dot-matrix display | Members-Only jackets, perms, shoulder pads, Walkman, pager, Polaroid |
| **2005** | Dark wood tables, iron legs, plush banquette, warm floor | Stainless E61 espresso with PID, pastry case | Daily Grind: coffee $1.50–$2.50, latte $2.25 | White click-wheel iPod in speaker dock, CDs for sale | Free Wi-Fi sign, community board, indie-night posters | White ceramic cups, paper to-go cups, travel mugs, glass bottles | Exposed-bulb pendants, halogen track | Touchscreen POS with card swipe, beige CRT iMac order station | Bootcut jeans, flip phones, digital cameras, early laptops, chunky earbuds |
| **2025** | Communal oak slab, marble-effect round tables, designer stools, living-wall shelf, monstera/pothos | Multi-boiler espresso (touchscreen), pour-over station (gooseneck/V60/scale), batch brewer | Minimal board: flat white $4.50–$5.50, cold brew $5, oat milk +50¢, QR ordering | Smartphone on wireless charger → smart speaker | Local-roaster posters, art prints, community shelf, chalk A-board | Double-wall glass / stoneware cups, keep-cups, matte black cutlery | Globe + linear LED pendants, brand decal | iPad POS with contactless tap-to-pay, tablet screens | Oversized fits, smartwatch, phone-gimbal, tote bag, earbuds case |

**Every cell is populated with real, visible, period-correct content.**

---

## Defects found & fixed during the ship gate

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **Critical — the pinned three.js r160 module build was missing** from the checkout (`public/js/three/lib/three.module.js` absent), so the app could not boot at all (import map 404). | Restored the pinned `three@0.160.0` module build from the npm registry, verified `REVISION = '160'`, and **committed it** with a `.gitignore` negation so a fresh clone boots offline. |
| 2 | **`npm start` depended on `python3`**, which is unavailable in the ship-gate runtime. | Added `scripts/serve.mjs`, a zero-dependency Node static server with correct `text/javascript` MIME for ES modules; `npm start` now uses it (kept `start:python` and `start:npx` as alternates). |
| 3 | **Two competing WebAudio engines** — `src/world/animation/audio.js` built its own node graph calling non-existent `AudioContext.createNoise()` and fought `src/audio/engine.js` for the same mute/volume keys. | Rewrote `src/world/animation/audio.js` as a thin adapter delegating to the single real engine (`audioEngine`), so era crossfades, mute/volume persistence, and panner updates stay in sync. |
| 4 | **Duplicate mute/volume handlers in `main.js`** — the top-bar handlers and the audio-panel handlers both toggled the same engine, so clicking Mute could net to no change. | Removed the duplicate top-bar-only handlers and kept one wired mute/volume path (`muteBtn`/`volumeSlider`). |
| 5 | **Era audio crossfade restarted mid-transition** — `applyYear()` called `audioEngine.switchEra()` directly while the timelapse controller also called `audio.setEra()` through the adapter. | Guarded both call sites (`if (audioEngine.currentEra !== year)`), so the crossfade starts once per era change. |
| 6 | **Missing acceptance-criteria UI** — no hover/click info cards, no camera presets, no WebGL-unavailable fallback, no `prefers-reduced-motion` wiring, no canvas keyboard focus. | Added `src/ui.js` (info cards via Raycaster, era-aware camera presets, keyboard access via OrbitControls `listenToKeyEvents`, WebGL fallback overlay, reduced-motion hook) and wired it into `main.js` + `index.html`. |
| 7 | **Duplicate `#audio-mute` / `#audio-volume` ids** in `index.html` (top bar + audio panel) — invalid HTML and ambiguous `getElementById`. | Removed the duplicate audio panel; added the camera-presets panel and the WebGL fallback overlay in its place. |

---

## Verification steps

1. **Clean-room run** — fresh clone/checkout, `npm run check` passes, `npm start`
   starts the static server, load the page cold with zero console errors.
2. **Era walkthrough** — visit all five years via slider and era buttons;
   verify every category cell above is visible and period-correct.
3. **Transitions + audio** — every era pair transitions smoothly; the era
   music bed crossfades in sync with the ~2.5 s timelapse; rapid mid-transition
   slider changes retarget cleanly (the timelapse controller finalizes the
   mid-state group and captures base opacities — no stuck or half-applied
   state).
4. **Inspection / UI** — slider, keyboard access (arrow keys pan on the
   canvas), hover/click info cards, and camera presets work in all five eras.
5. **Performance** — renderer.info is sampled each 60 frames and logged as
   `[render] era <year> | draw … | tri … | fps …` against a 60 fps target /
   45 fps floor. Confirm steady 60 fps per era and ≥45 fps during transitions
   on integrated graphics.
6. **Accessibility & robustness** — keyboard-only walkthrough (era buttons,
   slider, presets, mute/volume all focusable), audio-off walkthrough (mute
   works, WebAudio degrades to silent no-op), WebGL-unavailable shows the
   friendly fallback, `prefers-reduced-motion` shortens the transition
   (0.85 s simplified timeline via `setReducedMotion`).

---

## Known limitations

- **Music is synthesized period-styled audio, not licensed recordings.** All
  five era music beds are generated live with WebAudio (big-band swing for 1945,
  jukebox/record-drop for 1965, cassette/tape-hiss for 1965→1985 bed family,
  click-wheel for 2005, smart-chime/notification for 2025). They evoke the period feel
  without copyright exposure.
- **Procedural low-poly art** — every texture is drawn onto canvas at build time
  and every solid is a primitive mesh; there are no photoreal textures, baked
  geometry, or external image assets.
- **Performance instrumentation is diagnostic** — the 
  render budget report is intentionally non-mutating; it never changes an era's
  art direction.
- **Fog is era-local** — 1945 and 1985 set a scene fog on enter and clear it
  on exit; the shared ACESFilmic/exposure policy applies across all eras.