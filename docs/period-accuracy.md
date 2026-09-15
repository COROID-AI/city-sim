# Period accuracy — what each year shows, and why

This document records the content decisions behind the five eras of the café
timelapse (1945, 1965, 1985, 2005, 2025), domain by domain, together with the
stylisations and approximations that a reviewer should know about, the provenance
of the artwork, and the measured performance baseline.

It is written against the **live era specs the assembled scene reports** — the
same data the end-to-end suites assert (`tests/e2e/eras.spec.ts`) and the same
scene the browser evidence captures (`tests/evidence/README.md`) — so every claim
below can be re-checked by running the suites.

## Provenance (read this first)

- **Everything is original procedural artwork.** Posters, adverts, fascia blades,
  menu boards, packaging, nameplates and instrument panels are drawn at runtime by
  this project's own code, from geometric primitives and procedurally generated
  textures (canvas 2D canvases, seeded noise, gradients, generated type runs).
  There are **no photographs, no scanned artwork, no licensed brand assets and no
  third-party logos** anywhere in the scene.
- **The brand names are invented.** Names such as *Vale & Foster* (1945 wireless
  set), *Hallam No. 3* (1945 lever till), *Norvic 200* (1965 key register),
  *Cirra 85* (1985 electronic register), *Meridian Point* (2005 till system),
  *CounterTab* (2025 tablet POS), *PERCO 45 / MODEL 65 / GROUP 1 / AUTO 05 /
  TRE 3* (brewing machines) and the fascia letterings *THE BLUE BIRD / CAFE
  CONTINENTAL / CAFE MODERNE / CAFE VELO / CAFE ARBOUR* are invented for this
  project. They evoke the *class* of object an era had without reproducing a real
  manufacturer's identity, marks or trade dress.
- **The music is synthesised, not licensed.** Every era's programme
  (`valve-ensemble-1945`, `orchestral-pop-1965`, `synth-drive-1985`,
  `dock-pop-2005`, `stream-pop-2025`) is generated note-by-note by the project's
  Web Audio engine (`src/audio/`) from scale, chord, instrument and pattern
  descriptors. No recording, sample library or composition by anyone else is
  used; the pieces are original *approximations* of a period sound, deliberately
  written as era-appropriate pastiche rather than as imitations of specific songs.
- **The scene is a stylisation of a British café,** not a survey of any real
  interior. Sizes, counts and prices are plausible and internally consistent, not
  sourced measurements.

## How the eras are structured

Ten independent detail domains each own their per-era data and build their own
slice of the one room: environment (shell), furniture, machines, menu board,
posters, tableware, signage and lighting, counter technology, patrons and music.
The timeline slider selects a year; the transition engine swaps all ten domains in
place with a staggered choreography, so the room *transforms* rather than being
reloaded.

Two structural rules hold across every era and are asserted by the suites:

- **Exactly one music playback device** is present and visible per era
  (`music:<year>:<deviceId>` is the only `music:` node in the scene graph in every
  year).
- **The counter-technology tier matches the year.** 1945 is the last manual-lever
  tier; only 2025 has a contactless reader. `tests/e2e/eras.spec.ts` asserts the
  absence in earlier years and the presence in the owning year, per tier.

---

## 1945 — post-war austerity

*Palette: "Ration cream and oxblood"; the room is dim, warm and patched up
(signage colour temperature 2500 K, bare-bulb pendants).*

| Domain | Choice | Why |
| --- | --- | --- |
| Environment | Cream distemper on patched plaster, beaded matchboard dado, waxed linoleum over pine, lath-and-plaster ceiling with a cove and picture rail, steel-framed shopfront with a fanlight transom, lace nets with a shallow pelmet, hand-painted fascia blade | Materials that were *not* rationed and could be maintained by hand: distemper and lead paint rather than wallpaper, lino rather than carpet, a small-paned steel front |
| Furniture | Bentwood-cane chairs, one tubular-metal accent chair, fixed buttoned-cotton banquette, framed-deal booth with leatherette benches, painted timber counter stools, bentwood hall stand, painted rail with turned pegs, slanted timber magazine rack, round station clock, bakelite payphone, cream enamelled pedal bin, woven wool runner | Furniture stock that predates the war plus utility replacements; the payphone and station clock are the era's only "machines" in the room |
| Machines | Percolator urn (`PERCO 45`, `percolator`, no dose control — the basket is filled with a tin scoop), boil lamp and heat switch, sight tube, spigot; cast-iron wall grinder, enamelled stovetop kettle, sock-filter dripolator, enamelled milk jug | Espresso was not a British café norm in 1945: coffee was percolated in bulk and poured from an urn |
| Menu board | Hand-chalked slate in a stained oak frame, 12 items, pre-decimal sterling (`1d` … `6d`), substitutes printed for rationed goods, "RATIONS ARE SHORT" board note | Chalk on slate was the cheap, erasable board; pre-decimal money and rationing notices are the dated facts of the year |
| Music | Four-valve wooden wireless set (`wireless-1945`, *Vale & Foster* R4 Superhet) on a wall shelf, with a gramophone and its brass horn beside it as an accessory; programme `valve-ensemble-1945` (valve-like warmth, live-room reverb) | The valve wireless was furniture; the gramophone is the room's second machine but not a second *source* — the audio engine plays the wireless |
| Posters | Pinned newsprint notices: rationing ("Points and coupons", "Kitchen salvage"), civic notices ("Fuel target", "Victory bonds"), utility ("National milk bar", "The workers' cup"); condensed display type with heavy dot gain, misregistration, fading | Utility and civic print, pinned rather than framed, with the poor registration and paper fade of wartime economy printing |
| Tableware | Heavy white utility china cup with a cobalt rim line, pressed-glass tumblers, plated nickel-silver cutlery, thick glass ashtrays (smoking is period-correct), enamelled steel tray, lidded china sugar bowl, two-thirds pours | Utility china, plated cutlery and ashtrays on every table; a short pour is the rationing stylisation |
| Signage & lighting | Hand-painted fascia (`THE BLUE BIRD`), bare-bulb pendants, 2500 K, small lamp intensity, unlit blade | Lighting was functional and dim; illuminated signage was rare and mostly external |
| Counter technology | Manual lever till (`Hallam No. 3`), lever cash drawer, cash only, no display, cash-drawer/ledger/docket-pad/tip-jar inventory | The manual till with a bell and lever is the 1945 tier; nothing on the counter is electric |
| Patrons | 4 figures, density 0.42: barista with short back-and-sides; patrons with slick side-part, buzz cut, victory rolls and pin curls; gadgets limited to newspaper, cigarette and a thick ceramic cup | Wartime/hairstyle vocabulary and the absence of personal electronics; the density keeps the room sparse and quiet |

**Stylisations and approximations.** Utensils, coins, cigarettes and newspaper
pages are simplified solids with generated textures. Ration quantities and the
short pour are period *flavour*, not a real ration schedule. The gramophone's horn
and the wireless set's dial are gesture-level models, not accurate electromechanics.

---

## 1965 — espresso and chrome

*Palette: "Formica turquoise and custard"; brighter and more saturated than 1945
(signage colour temperature 3600 K).*

| Domain | Choice | Why |
| --- | --- | --- |
| Environment | Turquoise Formica and custard surfaces, checker floor, plain wall paint, suspended fibreboard tile ceiling, slim aluminium shopfront with wide unobstructed lights, venetian blinds, neon-trimmed plastic fascia (`CAFE CONTINENTAL`) | The post-austerity high street: plastics, aluminium, tile and suspended ceilings replace distemper and timber |
| Furniture | Vinyl diner chairs, ribbed-vinyl banquette and booth, chrome-vinyl stools, a tub-armchair pair, chrome magazine rack, round-dial clock, chrome payphone, swing bin, flatweave cotton rug | Tubular metal and wipe-clean vinyl are the era's café furniture signatures |
| Machines | Spring-lever espresso machine (`MODEL 65`, `lever-espresso`, lever-pull dosing) with boiler and brew gauges, electric doser grinder (`T60 DOSER`), chrome electric kettle, glass vacuum pot (silex), chrome milk pitcher, bakelite tamper | The lever machine marks the arrival of espresso culture in the British café |
| Menu board | Painted panel with applied vinyl lettering, 12 items, still pre-decimal (`5d` … `2/6`), instant coffee and Coca-Cola on the board, and a "SERVICE WITH A SMILE — TABLES WAITED ON" note | Hand-chalking gives way to painted panels and applied vinyl; decimalisation is still six years away |
| Music | Wall jukebox with a selector (`jukebox-1965`), record stack accessory; programme `orchestral-pop-1965` (orchestral pop with bright brass and a mid-band room) | The jukebox is *the* 1960s café music machine |
| Posters | Framed soda, tobacco and travel adverts ("Fizz up", "The modern filter", "The Riviera Express") in chrome-tube and printed-formica frames; coated cream stock, display type, low dot gain | Advertising becomes colour-printed and commercial; frames replace pins |
| Tableware | Narrow-rim turquoise ceramic cup, demitasse with a teal rim, slim stainless cutlery, stainless ashtrays, stainless waitress tray, loose sugar in a ceramic bowl, chrome napkin stand | Colour-coordinated ceramic ware, stainless service pieces and a proper espresso cup |
| Signage & lighting | Neon-trimmed plastic fascia, fluorescent tubes (4000 K so the machine's chrome reads), internally lit exterior panel, 3600 K overall | Fluorescent-and-neon shopfitting defined the mid-century high street |
| Counter technology | Mechanical key register (`Norvic 200`), spring cash drawer, cash only, a mechanical dial display, price card, docket pad | The key-driven register (bell, lever keys, printed dial) is the era's tier |
| Patrons | 4 figures, density 0.5: barista with a mop-top; patrons with mod bob, beehive, slick side-part; gadgets limited to a transistor radio, a compact cassette and a coffee cup | Mod and beehive hair, transistor radios and the brand-new compact cassette (1963) — gadgets are checked against their introduction year by the suite |

**Stylisations and approximations.** The jukebox's mechanism, the register's
internal escapement and the espresso machine's group hydraulics are suggested by
modelled externals only. "The Riviera Express" and the soda brands are invented
labels in a period idiom. The cassette in a 1965 café is at the very start of the
format's life, included as a dated touch rather than a commonplace.

---

## 1985 — high-street boom

*Palette: "Chrome, laminate and dusty rose"; the darkest, most saturated year
(signage colour temperature 3000 K, magenta/red cast).*

| Domain | Choice | Why |
| --- | --- | --- |
| Environment | Grey laminate, chrome and dusty rose, speckle floor, striped wall covering, textured acoustic tile soffit with a chrome lighting track, bronze-tinted glass in heavy aluminium frames, valance and blinds, red laminate blade with neon tube lettering (`CAFE MODERNE`) | The glossy, mirrored, track-lit high-street interior of the mid 1980s |
| Furniture | Stacking polypropylene chairs, chrome-moulded shell accent chair, moquette banquette, high-back vinyl booth, moulded-pad bench, moulded polypropylene stools, wire magazine rack, electric square clock, pushbutton wall phone, open steel bin, shag-pile rug | Moulded plastic and moquette at their 1980s peak; a wall phone and electric clock rather than a payphone |
| Machines | Semi-automatic group machine (`GROUP 1`, volumetric rocker keys), boiler gauge, doserless burr grinder, cordless plastic kettle, batch brewer with a glass carafe, counter knock box, stainless milk pitcher, nylon tamper | The semi-automatic with volumetric buttons is the 1980s café workhorse; batch brewing sits beside it |
| Menu board | Fluorescent letter-board in a light box, 14 items, decimal sterling (`30p` … `£1.45`), a lunchtime promo strip and "PRICES INCLUDE VAT AT 15%", cappuccino and jacket potatoes on the board | Slotted plastic tiles, fluorescent tubes behind felt and the 15% VAT rate are all dated 1980s facts |
| Music | Counter boombox with tape stacks (`boombox-1985`), slider controls, LED dial, rubber cable; programme `synth-drive-1985` (drum machine, synth bass, gated reverb) | The boombox replaced the jukebox in everyday cafés and ran on cassettes |
| Posters | Framed gloss-black and neon-tube posters: brand, cinema and video-rental artwork ("Neon nights", "Midnight Arcade", "Rent two get one free", "High score"); neon display type, heavy tracking | Neon-and-gloss advertising, cinema double bills and the video rental boom |
| Tableware | Thick oxblood stoneware mug printed with the house logo, printed logo tumbler, stainless cutlery with bakelite handles, moulded plastic ashtrays, plastic canteen tray, sugar sachets in a stoneware bowl, printed napkin dispenser | Branded chunky stoneware and moulded plastic service ware; sachets replace loose sugar |
| Signage & lighting | Plastic light-box sign, halogen downlights on a track, 3000 K, coloured acrylic and channel letters available | The illuminated plastic light box and halogen accent lighting are the era's signature |
| Counter technology | Electronic cash register (`Cirra 85`), LED display, cash-first with a steel drawer and plastic coin tray, price strip, cabling | The first electronic tier: LED display, keys and a till roll, but cash-only habits with card still rare |
| Patrons | 4 figures, density 0.58: barista with a mullet; patrons with big hair, perm curls, frosted tips and a shag cut; gadgets limited to a Walkman, a boombox, a compact cassette and a shoulder bag | 1980s hair vocabulary and the portable-music gadgets of the decade (the suite checks each gadget against its introduction year) |

**Stylisations and approximations.** The light box's fluorescent internals, the
boombox's tape transport and the ECR's printer are external gestures. Poster
artwork is generated layout, not real advertising. The 1985 patrons' boombox is a
*carried* gagdet; the room's single playback device is still the counter boombox
owned by the music domain.

---

## 2005 — coffee-shop chain years

*Palette: "Espresso brown and brushed steel"; the most neutral, evenly lit year
(signage colour temperature 4600 K).*

| Domain | Choice | Why |
| --- | --- | --- |
| Environment | Bleached oak, steel and chocolate leather, speckle floor, plain walls, exposed services under a boarded soffit, framed fixed glazing with a wide glass pivot door, frost film, illuminated channel letters on a steel bracket (`CAFE VELO`) | The branded, industrial-chic chain interior: exposed services, big glazing, internally lit lettering |
| Furniture | Plywood-shell chairs, mix-and-match loveseat, stitched-leather banquette, leather booth and bar stools, slim steel magazine rack, digital LED clock, card payphone, recycling station, jute flatweave rug | Contract furniture with leather and steel, plus the first recycling bin and a card-operated payphone |
| Machines | Super-automatic with digital dosing (`AUTO 05`), pump gauge and two ready lamps, on-demand flat-burr grinder, brushed-stainless electric kettle, thermostatic batch brewer, precision milk pitcher, ergonomic tamper, digital brew scale, stacked demitasses | The super-automatic that made chains possible: consistent digital doses instead of a barista's judgement |
| Menu board | Backlit acrylic panels on standoffs, 17 items, decimal sterling (`£1.35` … `£4.25`), latte/panini/smoothie vocabulary, an allergens note, Fairtrade tag | Frosted backlit acrylic and the modern coffee-shop menu (milks, panini, smoothies, allergens) are a 2005 fact |
| Music | iPod in a speaker dock (`ipod-dock-2005`) with click-wheel control and cable clutter; programme `dock-pop-2005` (bright compressed pop, small-room reverb) | The dock is the era's playback device: a personal library playing through one speaker |
| Posters | Framed aluminium-clip and lightbox posters: telecom, early-web and film artwork ("Talk more, pay less", "Always on broadband", "Internet café", "Free email setup"); grotesque display type | Telecom advertising, early-web promises and film posters in clip frames |
| Tableware | Printed paper cup in a sleeve, corrugated takeaway cup with a lid, stamped stainless cutlery, smoked-glass ashtrays, melamine tray, branded sugar sachet pot, paper dispenser | Paper takeaway cups and branded sachets: the takeaway-first counter |
| Signage & lighting | Internally lit channel letters, compact fluorescents (4700 K for a clean, cool white), light box and backlit logo styles | Channel letters and compact fluorescents give the bright, slightly cool chain look |
| Counter technology | POS terminal (`Meridian Point` till system, CRT display), PIN-pad card terminal, card-and-cash, card terminal on the counter | The point-of-sale terminal and chip-and-PIN pad: cards are normal, contactless is not yet |
| Patrons | 4 figures, density 0.64: barista with a textured crop; patrons with highlighted waves, frosted tips, messy bun, textured crop; gadgets limited to a flip phone, an MP3 player, wired earbuds and a laptop | Mid-2000s hair and the personal-electronics mix of the moment (flip phone + MP3 player + laptop) |

**Stylisations and approximations.** The POS terminal's screen content is a
generated graphic, not a real UI; the dock's click wheel and connector are
gestures. Poster copy is invented. Ashtrays remain in the scene as period detail
even though indoor smoking was being phased out across the mid-2000s; they are
modelled as clean, empty receptacles.

---

## 2025 — present day

*Palette: "Limewash, oak and cool concrete"; bright, warm-neutral, daylight-led
(signage colour temperature 3200 K, LED strip fixtures at 4000 K).*

| Domain | Choice | Why |
| --- | --- | --- |
| Environment | Limewash, oak and terrazzo, plank floor, plain walls, exposed sealed concrete soffit with linear pendants, full-height framed glazing with a slim transom, linen scrim, backlit brushed-brass blade on a rod bracket (`CAFE ARBOUR`) | Warm minimalism: natural materials, exposed concrete and daylight, signage as a small backlit blade |
| Furniture | Moulded-shell chairs, wool-bouclé banquette, reclaimed-timber booth and stools, a steel perch rail, reclaimed-oak communal tables (3 chairs per side, communal set true), ladder rack, digital panel clock, slim wall phone, segregated recycling, recycled-felt rug | Communal seating, reclaimed materials, segregation-at-source recycling and almost no fixed counter seating |
| Machines | Multi-group machine with a touch panel (`TRE 3`, recipe rows and a setpoint bar), single-dose flat-burr grinder, temperature-controlled gooseneck kettle, precision pour-over stand, calibrated pitcher, spring tamper, connected scale, stoneware cup stacks | Third-wave equipment: multi-group machine plus a manual brew bar, connected scales and single-dose grinding |
| Menu board | Emissive digital screen, slim bezel, 18 items, decimal sterling (`£2.60` … `£9.40`), rotating panels, seasonal special, oat/soy/almond note and allergen guidance | Emissive digital boards with rotating panels and allergen information are today's board |
| Music | Phone paired to a smart speaker (`phone-speaker-2025`) on the storefront ledge, with a phone stand and charging pad as accessories, touch controls and an LED ring; programme `stream-pop-2025` (streaming-pop palette, wide stereo, longer reverb) | Playback is a paired phone and a speaker: no physical library, only a charging cable |
| Posters | Pinned and framed social, sustainability and local-art notices ("All are welcome here", "Save our library", "Bring your own cup", "Roasted with renewables", "Cycle in"); grotesque display type, generous tracking, near-zero print fade | Community and sustainability notices, printed flat and pinned, plus magnets and recycled card |
| Tableware | Reusable cup with a silicone band, double-walled glass, refillable lidded cup, stoneware and reclaimed materials, glass jar with tongs for sugar, timber napkin stack, recycled-plastic tray | Reusables replace disposables; tongs and jars replace sachets |
| Signage & lighting | LED edge-lit panel, LED strip fixtures (4000 K), backlit logo, QR decal, price strip | LED everywhere; a QR decal and an edge-lit panel are the current signage facts |
| Counter technology | Tablet POS (`CounterTab`) on a stand with a contactless reader and a tap target (the only era with a contactless reader), contactless-first, QR card, tip jar, pickup shelf | Tablet POS plus contactless — and the tap-target animation that invites a tap — is the 2025 tier |
| Patrons | 4 figures, density 0.76 (the busiest era): barista with an undercut fade; patrons with curtain waves, top knot, soft curls; gadgets limited to a smartphone, over-ear headphones, wireless earbuds, a laptop and a reusable cup | Contemporary hair, phones and earbuds on every table, and the highest occupancy of the five eras |

**Stylisations and approximations.** The digital board's rotating panels are a
texture effect rather than a real UI; the QR decal encodes nothing. Phone, tablet
and earbud models are gesture-level silhouettes. Chair counts and table spacing
are plausible but not measured.

---

## Known cross-era stylisations

- **Scale and count.** Furniture counts, table spacing, patron counts (4 per era)
  and prop sizes are chosen for a readable composed scene, not from floor plans.
- **Patron figures.** Figures use one canonical rig scaled by stature, with
  interchangeable garments, hairs and gadgets; skin tones come from each era's
  small ramp, so faces are stylised rather than portraits.
- **Materials.** All surfaces are procedurally textured flat materials; wear,
  scuffs, dust, bloom and print fade are texture-level effects, not simulation.
- **Money.** Pre-decimal prices are written in period notation (`6d`, `1/3`,
  `2/6`) and normalised to decimal pence for comparison; the prices are plausible
  for a British café, not archival.
- **Audio.** The five programmes are original pastiche; the murmur bed is
  generated from an era density and a formant-filtered noise bed, not recorded
  conversation; machine sounds are synthesised one-shots.
- **One documented audio deviation.** The patrons domain pushes its era density
  into the ambience intensity (`setAmbienceIntensity(density)`), which is the
  wiring the interaction suite observes. However, each era change applies the era
  mix afterwards, and the mix's own `ambience.density` overwrites that intensity,
  so the *settled* murmur intensity equals the mix value (0.35 / 0.5 / 0.55 / 0.5
  / 0.45) rather than the patron density (0.42 / 0.5 / 0.58 / 0.64 / 0.76). The
  murmur is therefore era-appropriate but only loosely proportional to occupancy;
  the ordering of that push versus the mix application is reported upstream rather
  than patched here (this task owns verification only).
- **Render-order note.** Re-building an era in place can re-append a module's
  children in a different order; the node set, node count and render statistics are
  identical, and the end-to-end suite compares sorted node sets for exactly this
  reason.

## Performance baseline (headless node, measured)

Produced by `npx vitest run tests/perf/perfBudget.spec.ts --config
tests/perf/vitest.perf.config.ts`; the suite prints this table on every run and
fails if an era exceeds the caps below it.

| era | nodes | draw calls | triangles | geometries | materials | textures | lights | frame mean | frame p95 | switch scene | switch wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1945 | 1973 | 2352 | 150 564 | 1285 | 201 | 132 | 6 | 0.85 ms | 1.18 ms | (boot year) | 0.6 ms |
| 1965 | 2112 | 2464 | 156 170 | 1417 | 193 | 131 | 5 | 0.84 ms | 1.23 ms | 2.62 s | 3333 ms |
| 1985 | 1997 | 2361 | 123 290 | 1258 | 197 | 130 | 5 | 0.77 ms | 0.96 ms | 2.62 s | 2026 ms |
| 2005 | 1791 | 2084 | 106 634 | 1075 | 198 | 135 | 4 | 0.70 ms | 0.81 ms | 2.62 s | 1748 ms |
| 2025 | 1899 | 2381 | 131 308 | 1156 | 197 | 131 | 5 | 0.77 ms | 0.96 ms | 2.62 s | 1672 ms |
| **budget** | **2600** | **3200** | **210 000** | **1800** | **320** | **220** | **8** | **8 ms** | **20 ms** | **6 s** | **8000 ms** |

- The 1945 row's switch cost is the boot year: the first selection is a no-op, so
  the budget suite measures a real switch order (1965 → 1985 → 2005 → 2025 →
  1945) separately and asserts each one.
- **A full five-year cycle** costs 13.08 s of scene time and 4.6–8.7 s of wall
  clock (first cycle includes cold-start rebuilds), against budgets of 30 s and
  20 s, repeated three times with no growth.
- **Frame budget**: the per-frame pipeline (transition, audio and all ten modules)
  costs ~0.9 ms mean and ~1.2 ms p95 in the headless runtime, far inside the
  8 ms / 20 ms / 60 ms mean/p95/max caps.
- **Browser cross-check**: the page-side statistics captured in
  `tests/evidence/capture-summary.json` report the same draw calls (2352 / 2464 /
  2361 / 2084 / 2381) and triangles as the headless suite, so the recorded budget
  describes the scene the browser actually draws. GPU frame time in a browser is
  not asserted here (the suites must run without a GPU); the browser evidence and
  the runner's browser probe cover the visual side.

## Where each claim is verified

| Claim | Verification |
| --- | --- |
| Era inventories, one music device, era-exclusive tiers, menu pricing order, patron gadget legibility, no leftover eras after a cycle | `tests/e2e/eras.spec.ts` |
| Slider stops, transition completion and re-target, navigation/inspect, audio gesture gate and bus crossfade | `tests/e2e/interaction.spec.ts` |
| Draw calls, triangles, geometry/material/texture counts, frame time and switch/cycle durations within explicit budgets | `tests/perf/perfBudget.spec.ts` |
| Per-era screenshots at a fixed pose plus three close-ups, objectively checked for blankness and distinctness | `tests/evidence/` (`capture.mjs`, `verify-images.mjs`, `README.md`) |
