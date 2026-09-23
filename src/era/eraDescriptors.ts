/**
 * Chrono City — era descriptor tables.
 *
 * The single authored source of truth for *what each era looks, sounds and
 * feels like*. Every era-driven system (streetscape, vehicles, pedestrians,
 * signage, lighting, sound) reads its parameters from here instead of
 * hard-coding a year, which is what lets one transition runtime blend the whole
 * block coherently.
 *
 * Five tables are authored: 1945, 1965, 1985, 2005 and 2025. Each one carries:
 *   * `palette`      — sky/ground/road/facade/emissive colours
 *   * `fog`          — fog colour, mode and range
 *   * `lighting`     — sun, ambient, hemisphere and exposure mood
 *   * `typography`   — display/body font stacks and signage lettering
 *   * `architecture` — building style, massing, materials and roof character
 *   * `vehicles`     — body shapes, colours, chrome ratio and traffic mix
 *   * `fashion`      — pedestrian silhouettes, colour palette and formality
 *   * `signage`      — advertising density, lighting technology and slogans
 *   * `soundscapeId` — stable id (plus a small mood record) for the audio task
 *
 * The tables are pure data: no rendering, no meshes, no textures. The only code
 * in this module is lookup plus numeric blending, so a blendable can resolve a
 * continuous in-between descriptor while a tween runs.
 *
 * Lifecycle:
 *   create    → the frozen tables and their types are created here.
 *   consume   → systems call `getEraDescriptor()` and read fields read-only.
 *   integrate → `TimelineRuntime` drives `resolveEraBlend(from, to, progress)`
 *               so blendables interpolate the authored values per frame.
 */

import {
  assertEraId,
  clamp01,
  isEraId,
  type EraDescriptor,
  type EraId,
} from '../core/eraContracts';

export const ERA_DESCRIPTORS_VERSION = 1;

/* ------------------------------------------------------------------------- *
 * Section shapes
 * ------------------------------------------------------------------------- */

/** Case treatment applied to signage and advertising lettering. */
export type EraSignageCase = 'upper' | 'mixed' | 'lower';

/** Fog falloff model an era prefers. */
export type EraFogMode = 'linear' | 'exponential';

/** The road-user classes the traffic mix is expressed in. */
export type EraVehicleClass = 'car' | 'truck' | 'bus' | 'bicycle' | 'tram';

/** Canonical order of the traffic-mix keys. */
export const ERA_VEHICLE_CLASSES: readonly EraVehicleClass[] = Object.freeze([
  'car',
  'truck',
  'bus',
  'bicycle',
  'tram',
]);

/** Relative share of each road-user class; every era's mix sums to `1`. */
export type EraVehicleMix = Readonly<Record<EraVehicleClass, number>>;

/** Colours are authored as sRGB hex integers (`0xRRGGBB`) so Three.js can use them directly. */
export interface EraColorPalette {
  /** Upper-sky gradient colour. */
  readonly sky: number;
  /** Horizon / haze band colour. */
  readonly skyHorizon: number;
  /** Ground plane fill outside the block. */
  readonly ground: number;
  /** Road surface. */
  readonly asphalt: number;
  /** Sidewalk paving. */
  readonly sidewalk: number;
  /** Dominant facade material colour. */
  readonly buildingPrimary: number;
  /** Secondary facade / trim colour. */
  readonly buildingSecondary: number;
  /** Ambient fill colour used by the lighting rig. */
  readonly ambient: number;
  /** Emissive colour of lit shopfronts and signs. */
  readonly emissive: number;
  /** Accent colours for doors, awnings, paintwork and props. */
  readonly accents: readonly number[];
  /** Short working note for the content tasks. */
  readonly notes: string;
}

export interface EraFogDescriptor {
  readonly color: number;
  readonly mode: EraFogMode;
  /** Near distance for linear fog (metres); ignored by exponential fog. */
  readonly near: number;
  /** Far distance for linear fog (metres); ignored by exponential fog. */
  readonly far: number;
  /** Density for exponential fog; ignored by linear fog. */
  readonly density: number;
  readonly notes: string;
}

export interface EraLightingMood {
  /** Human-readable mood label for the HUD and documentation. */
  readonly mood: string;
  readonly sunColor: number;
  readonly sunIntensity: number;
  /** Sun elevation above the horizon, in degrees. */
  readonly sunElevationDeg: number;
  /** Sun compass azimuth, in degrees (0 = north, clockwise). */
  readonly sunAzimuthDeg: number;
  readonly ambientColor: number;
  readonly ambientIntensity: number;
  readonly hemisphereSkyColor: number;
  readonly hemisphereGroundColor: number;
  readonly exposure: number;
  readonly contrast: number;
  readonly notes: string;
}

export interface EraTypography {
  /** CSS font stack for headings and shopfront lettering. */
  readonly displayFont: string;
  /** CSS font stack for HUD body copy. */
  readonly bodyFont: string;
  readonly letterSpacingEm: number;
  readonly headingWeight: number;
  readonly signageCase: EraSignageCase;
  readonly notes: string;
}

export interface EraArchitectureStyle {
  readonly style: string;
  readonly storeysMin: number;
  readonly storeysMax: number;
  /** 0 = mirror smooth, 1 = sooty and rough. */
  readonly facadeRoughness: number;
  /** Share of facade area taken by glazing. */
  readonly windowRatio: number;
  readonly roofStyle: string;
  readonly materials: readonly string[];
  readonly notes: string;
}

export interface EraVehicleStyle {
  readonly style: string;
  readonly bodyShapes: readonly string[];
  readonly dominantColors: readonly number[];
  /** 0 = body-coloured bumpers, 1 = fully chromed brightwork. */
  readonly chromeRatio: number;
  readonly topSpeedKph: number;
  readonly mix: EraVehicleMix;
  readonly notes: string;
}

export interface EraFashionStyle {
  readonly style: string;
  readonly palette: readonly number[];
  /** Probability a given pedestrian wears a hat. */
  readonly hats: number;
  /** Probability a pedestrian wears formal outerwear. */
  readonly formalRatio: number;
  readonly silhouettes: readonly string[];
  readonly notes: string;
}

export interface EraSignageStyle {
  readonly style: string;
  /** 0 = blank facades, 1 = every surface sells something. */
  readonly adDensity: number;
  readonly neonRatio: number;
  readonly backlitRatio: number;
  readonly billboardRatio: number;
  readonly slogans: readonly string[];
  readonly notes: string;
}

export interface EraSoundscapeDescriptor {
  /** Stable id the audio task keys its beds off. */
  readonly id: string;
  readonly mood: string;
  readonly musicBed: string;
  readonly ambience: readonly string[];
  /** Relative mix level in `[0, 1]`. */
  readonly loudness: number;
}

/**
 * The complete authored description of one era: the shared `EraDescriptor`
 * identity plus every visual/audio parameter a system can consume.
 */
export interface EraTimelineDescriptor extends EraDescriptor {
  readonly keywords: readonly string[];
  readonly palette: EraColorPalette;
  readonly fog: EraFogDescriptor;
  readonly lighting: EraLightingMood;
  readonly typography: EraTypography;
  readonly architecture: EraArchitectureStyle;
  readonly vehicles: EraVehicleStyle;
  readonly fashion: EraFashionStyle;
  readonly signage: EraSignageStyle;
  /** Stable soundscape id; always equal to `soundscape.id`. */
  readonly soundscapeId: string;
  readonly soundscape: EraSoundscapeDescriptor;
}

/* ------------------------------------------------------------------------- *
 * Authored tables
 * ------------------------------------------------------------------------- */

/** 1945 — post-war reconstruction: soot, rationing and warm incandescent light. */
const ERA_1945: EraTimelineDescriptor = {
  id: '1945',
  year: 1945,
  label: 'Post-war Reconstruction',
  description:
    'Soot-stained brick walk-ups, hand-painted shopfronts and sparse wartime traffic under an overcast sky.',
  keywords: ['reconstruction', 'utility', 'brick', 'rationing', 'analog radio'],
  palette: {
    sky: 0x9fb3c8,
    skyHorizon: 0xcdbfa8,
    ground: 0x4a4238,
    asphalt: 0x35322e,
    sidewalk: 0xb0a894,
    buildingPrimary: 0x8a6f5a,
    buildingSecondary: 0x6f6455,
    ambient: 0x4a5461,
    emissive: 0xffd9a0,
    accents: [0x7d2f2a, 0x2f4a5a, 0x8a7a4a],
    notes: 'Warm incandescent pools against cool overcast shadow; almost no saturated colour.',
  },
  fog: {
    color: 0xb8b3a6,
    mode: 'linear',
    near: 40,
    far: 320,
    density: 0.0055,
    notes: 'Coal-smoke haze closes the block in; the far towers are barely readable.',
  },
  lighting: {
    mood: 'overcast post-war daylight, cold sky and warm interiors',
    sunColor: 0xffe6c2,
    sunIntensity: 0.9,
    sunElevationDeg: 38,
    sunAzimuthDeg: 210,
    ambientColor: 0x5a6472,
    ambientIntensity: 0.55,
    hemisphereSkyColor: 0x9fb3c8,
    hemisphereGroundColor: 0x4a4238,
    exposure: 0.95,
    contrast: 0.85,
    notes: 'Low-key natural light; shop windows and street lamps carry the only warm sources.',
  },
  typography: {
    displayFont: '"Playfair Display", "Times New Roman", Georgia, serif',
    bodyFont: '"Courier New", Courier, monospace',
    letterSpacingEm: 0.02,
    headingWeight: 700,
    signageCase: 'mixed',
    notes: 'Hand-painted serif and gilded block letters, irregular baseline and wear.',
  },
  architecture: {
    style: 'soot-stained brick walk-ups with stone lintels and fire escapes',
    storeysMin: 3,
    storeysMax: 6,
    facadeRoughness: 0.92,
    windowRatio: 0.22,
    roofStyle: 'flat tar roof with parapet, water tanks and pigeon coops',
    materials: ['soot brick', 'limestone', 'painted timber', 'cast iron'],
    notes: 'Narrow frontages, deep cornices, patched masonry and improvised shop awnings.',
  },
  vehicles: {
    style: 'late pre-war saloons and rationed flatbed trucks',
    bodyShapes: ['rounded-fender saloon', 'delivery van', 'flatbed truck', 'trolley bus'],
    dominantColors: [0x2f3b45, 0x4a4436, 0x6b2f2b, 0x1f1f22],
    chromeRatio: 0.35,
    topSpeedKph: 90,
    mix: { car: 0.55, truck: 0.2, bus: 0.15, bicycle: 0.08, tram: 0.02 },
    notes: 'Tall narrow cabins, separate fenders, muted military surplus paintwork.',
  },
  fashion: {
    style: 'utility tailoring, wide-brim hats and muted wool coats',
    palette: [0x4a4436, 0x6b6255, 0x2f3b45, 0x7d2f2a, 0x8a7a4a],
    hats: 0.78,
    formalRatio: 0.7,
    silhouettes: [
      'wide-shoulder overcoat',
      'A-line midi skirt',
      'flat cap and boiler suit',
      'nurse uniform',
    ],
    notes: 'Strict shoulders, knee-length hems, austerity fabric and visible repair patches.',
  },
  signage: {
    style: 'hand-painted enamel and gilded shopfront lettering',
    adDensity: 0.25,
    neonRatio: 0.02,
    backlitRatio: 0.1,
    billboardRatio: 0.05,
    slogans: ['RATION BOOKS HERE', 'FRESH BREAD DAILY', 'REBUILD WITH US', 'SAVE FUEL — TAKE THE BUS'],
    notes: 'Painted directly onto brick and timber; newsprint posters pasted on hoardings.',
  },
  soundscapeId: 'soundscape-1945-postwar',
  soundscape: {
    id: 'soundscape-1945-postwar',
    mood: 'sparse, analog and close-miked',
    musicBed: 'mono AM radio crooners and brass',
    ambience: ['occasional pre-war engine', 'hand bell', 'distant steam whistle', 'street hawker'],
    loudness: 0.6,
  },
};

/** 1965 — the boom: chrome, pastel concrete and confident daylight. */
const ERA_1965: EraTimelineDescriptor = {
  id: '1965',
  year: 1965,
  label: 'Mid-century Boom',
  description:
    'Chrome-laden sedans, pastel curtain-wall slabs and geometric neon under bright optimistic daylight.',
  keywords: ['boom', 'chrome', 'googie', 'pastel', 'tail-fin'],
  palette: {
    sky: 0x9dc6e8,
    skyHorizon: 0xf0d9b0,
    ground: 0x5b5646,
    asphalt: 0x3b3b3b,
    sidewalk: 0xc9c4b4,
    buildingPrimary: 0xd9d2c4,
    buildingSecondary: 0x8fa9a0,
    ambient: 0x6f7f8c,
    emissive: 0xfff0c0,
    accents: [0xe0662f, 0xe8c547, 0x2f8f83, 0xc0392b],
    notes: 'Sun-bleached pastels against turquoise and orange accents; terrazzo and stainless.',
  },
  fog: {
    color: 0xcfd9e2,
    mode: 'linear',
    near: 60,
    far: 520,
    density: 0.0032,
    notes: 'Clean bright haze; the skyline reads far down the avenue.',
  },
  lighting: {
    mood: 'bright confident daylight with strong blue bounce',
    sunColor: 0xfff2d5,
    sunIntensity: 1.35,
    sunElevationDeg: 52,
    sunAzimuthDeg: 160,
    ambientColor: 0x76839a,
    ambientIntensity: 0.6,
    hemisphereSkyColor: 0x9dc6e8,
    hemisphereGroundColor: 0x5b5646,
    exposure: 1.05,
    contrast: 0.95,
    notes: 'High sun, crisp shadows, glossy reflections on chrome and tinted glass.',
  },
  typography: {
    displayFont: '"Futura", "Century Gothic", "Helvetica Neue", Arial, sans-serif',
    bodyFont: '"Helvetica", "Arial", sans-serif',
    letterSpacingEm: 0.06,
    headingWeight: 600,
    signageCase: 'upper',
    notes: 'Geometric sans with wide tracking, capitalised fascia signs in stainless channel.',
  },
  architecture: {
    style: 'curtain-wall glass towers over pastel concrete slabs',
    storeysMin: 4,
    storeysMax: 18,
    facadeRoughness: 0.35,
    windowRatio: 0.45,
    roofStyle: 'flat slab with roof plant, sign gantry and helipad markings',
    materials: ['tinted glass', 'anodised aluminium', 'pastel concrete', 'terrazzo'],
    notes: 'Horizontal banding, floating canopies, mosaic tile and geometric screens.',
  },
  vehicles: {
    style: 'chrome-laden tail-fin saloons and city buses',
    bodyShapes: ['tail-fin saloon', 'compact runabout', 'double-decker bus', 'panel van'],
    dominantColors: [0x2f6fa8, 0xc74c3c, 0xf0efe6, 0x2f8f6f, 0xe0a83c],
    chromeRatio: 0.8,
    topSpeedKph: 130,
    mix: { car: 0.62, truck: 0.12, bus: 0.14, bicycle: 0.1, tram: 0.02 },
    notes: 'Two-tone paint, wraparound windscreens, whitewall tyres and heavy brightwork.',
  },
  fashion: {
    style: 'boxy suits, shift dresses and bouffant hair',
    palette: [0xe8c547, 0x2f8f83, 0xc0392b, 0xf0efe6, 0x6b5b8a],
    hats: 0.4,
    formalRatio: 0.5,
    silhouettes: ['slim-lapel suit', 'mod shift dress', 'trench coat', 'pillbox hat'],
    notes: 'Slim lapels, short hems, patterned knits and matching hat-and-glove sets.',
  },
  signage: {
    style: 'exposed neon tubes and backlit plastic fascia on stainless steel',
    adDensity: 0.45,
    neonRatio: 0.45,
    backlitRatio: 0.55,
    billboardRatio: 0.2,
    slogans: ['DRIVE THE NEW AGE', 'CITY MOTORS — CHROME & POWER', 'THE FUTURE IS BRIGHT', 'SODA — ICE COLD'],
    notes: 'Roof-top neon spectacles, arrow signs and painted wall advertising.',
  },
  soundscapeId: 'soundscape-1965-boom',
  soundscape: {
    id: 'soundscape-1965-boom',
    mood: 'brass-laced optimism with AM jingles',
    musicBed: 'surf-rock and crooner AM radio',
    ambience: ['V8 idle', 'typewriter', 'cheerful bus bell', 'construction riveter'],
    loudness: 0.72,
  },
};

/** 1985 — neon downtown: wet asphalt, magenta/cyan and synth-pop. */
const ERA_1985: EraTimelineDescriptor = {
  id: '1985',
  year: 1985,
  label: 'Neon Downtown',
  description:
    'Mirror-glass towers, wedge sports cars and saturated neon signage on rain-slick streets after dusk.',
  keywords: ['neon', 'postmodern', 'synth', 'chrome', 'nightlife'],
  palette: {
    sky: 0x2b1f4a,
    skyHorizon: 0xff5f8d,
    ground: 0x1c1a26,
    asphalt: 0x24242c,
    sidewalk: 0x4a4a56,
    buildingPrimary: 0x3c3550,
    buildingSecondary: 0x24404f,
    ambient: 0x3a2a5c,
    emissive: 0xff2ea6,
    accents: [0xff3e8e, 0x00e5ff, 0xffc400, 0x7c3aed],
    notes: 'Deep violet night base with magenta and cyan emissive signage dominating.',
  },
  fog: {
    color: 0x3a2350,
    mode: 'exponential',
    near: 30,
    far: 260,
    density: 0.0068,
    notes: 'Coloured damp haze picks up the neon and blooms the far end of the street.',
  },
  lighting: {
    mood: 'neon dusk with heavy bloom and deep contrast',
    sunColor: 0xff7ab0,
    sunIntensity: 0.35,
    sunElevationDeg: 6,
    sunAzimuthDeg: 265,
    ambientColor: 0x4c2a6e,
    ambientIntensity: 0.7,
    hemisphereSkyColor: 0x2b1f4a,
    hemisphereGroundColor: 0x1c1a26,
    exposure: 1.25,
    contrast: 1.15,
    notes: 'Signage and sodium street lamps light the block; sky is a residual glow.',
  },
  typography: {
    displayFont: '"Broadway", "Bauhaus 93", Impact, "Arial Black", sans-serif',
    bodyFont: '"Helvetica Neue", "Arial Narrow", Arial, sans-serif',
    letterSpacingEm: 0.01,
    headingWeight: 800,
    signageCase: 'upper',
    notes: 'Condensed italic chrome, outsized neon tubes and pixel-matrix tickers.',
  },
  architecture: {
    style: 'postmodern mirror-glass towers with pastel stucco infill',
    storeysMin: 2,
    storeysMax: 28,
    facadeRoughness: 0.18,
    windowRatio: 0.62,
    roofStyle: 'stepped mirror parapets with rooftop neon and satellite dishes',
    materials: ['mirror glass', 'neon tube', 'pink stucco', 'brushed steel', 'checker tile'],
    notes: 'Faceted reflective curtain walls, fake arch motifs and maze-pattern paving.',
  },
  vehicles: {
    style: 'wedge sports cars and boxy sedans',
    bodyShapes: ['wedge sports coupe', 'boxy sedan', 'minivan', 'articulated bus'],
    dominantColors: [0x141418, 0xc0c6cf, 0xd81e5b, 0x1f6fd8, 0xe8e2d0],
    chromeRatio: 0.25,
    topSpeedKph: 180,
    mix: { car: 0.6, truck: 0.12, bus: 0.14, bicycle: 0.09, tram: 0.05 },
    notes: 'Black plastic trim, pop-up lights, digital clusters and turbo badging.',
  },
  fashion: {
    style: 'power suits, acid denim and big hair',
    palette: [0xd81e5b, 0x00e5ff, 0x141418, 0x7c3aed, 0xe8e2d0],
    hats: 0.15,
    formalRatio: 0.35,
    silhouettes: ['shoulder-padded blazer', 'acid-wash denim', 'track jacket', 'leather biker'],
    notes: 'Oversized shoulders, tapered trousers, neon outerwear and leg warmers.',
  },
  signage: {
    style: 'neon tubes, chasing bulb marquees and sprayed street art',
    adDensity: 0.85,
    neonRatio: 0.9,
    backlitRatio: 0.5,
    billboardRatio: 0.45,
    slogans: ['NEON NIGHTS EVERY NIGHT', 'VIDEO ARCADE — OPEN LATE', 'BUY NOW, PAY LATER', 'FM 88 STEREO'],
    notes: 'Layered tubes on every fascia, animated marquees and poster-plastered alley walls.',
  },
  soundscapeId: 'soundscape-1985-neon',
  soundscape: {
    id: 'soundscape-1985-neon',
    mood: 'synth pads, arcade chimes and wet night traffic',
    musicBed: 'FM synth-pop',
    ambience: ['arcade cabinet', 'saxophone busker', 'squealing brakes', 'distant siren'],
    loudness: 0.85,
  },
};

/** 2005 — the digital turn: glass-and-steel calm with cold screens. */
const ERA_2005: EraTimelineDescriptor = {
  id: '2005',
  year: 2005,
  label: 'Digital Turn',
  description:
    'Blue-green glazing, rounded commuter cars and backlit lightbox advertising in a businesslike daytime city.',
  keywords: ['digital', 'glass', 'corporate', 'lightbox', 'commuter'],
  palette: {
    sky: 0xa9c7de,
    skyHorizon: 0xe6e2d8,
    ground: 0x55565a,
    asphalt: 0x3a3d42,
    sidewalk: 0x9d9a92,
    buildingPrimary: 0xc6c9cd,
    buildingSecondary: 0x5f7f96,
    ambient: 0x6e7780,
    emissive: 0xbfe3ff,
    accents: [0x2f6fd0, 0xd94f3d, 0x2f8f6f, 0xd0a02f],
    notes: 'Neutral greys against blue-green glazing; cold LED and LCD emissive accents.',
  },
  fog: {
    color: 0xc3ced8,
    mode: 'linear',
    near: 80,
    far: 700,
    density: 0.0024,
    notes: 'Thin urban haze; long clean sightlines down the block.',
  },
  lighting: {
    mood: 'crisp clear daylight with cool glass bounce',
    sunColor: 0xfff6e6,
    sunIntensity: 1.1,
    sunElevationDeg: 44,
    sunAzimuthDeg: 195,
    ambientColor: 0x6e7f96,
    ambientIntensity: 0.65,
    hemisphereSkyColor: 0xa9c7de,
    hemisphereGroundColor: 0x55565a,
    exposure: 1.0,
    contrast: 1.05,
    notes: 'Even commercial wash, mild specular sparkle on mullions and vehicle clear-coat.',
  },
  typography: {
    displayFont: '"Myriad Pro", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    bodyFont: '"Verdana", "Tahoma", Geneva, sans-serif',
    letterSpacingEm: 0.02,
    headingWeight: 600,
    signageCase: 'mixed',
    notes: 'Gradient webfont-era logos, glass-and-chrome channel letters, blue brand accents.',
  },
  architecture: {
    style: 'glass-and-steel towers with precast panels and mixed-use podiums',
    storeysMin: 3,
    storeysMax: 24,
    facadeRoughness: 0.25,
    windowRatio: 0.58,
    roofStyle: 'flat with rooftop HVAC plant, telecom masts and railing roofs',
    materials: ['blue-green glazing', 'precast panel', 'metal cladding', 'granite paving'],
    notes: 'Regular grids, spandrel bands, glass canopies and disciplined shopfront updates.',
  },
  vehicles: {
    style: 'bubble-body sedans, SUVs and early hybrids',
    bodyShapes: ['rounded sedan', 'SUV', 'city bus', 'delivery van'],
    dominantColors: [0xc8ccd2, 0x27313c, 0x7f8b96, 0xb03a34, 0x2f5fa8],
    chromeRatio: 0.1,
    topSpeedKph: 190,
    mix: { car: 0.66, truck: 0.12, bus: 0.08, bicycle: 0.12, tram: 0.02 },
    notes: 'Clear-lens headlamps, colour-coded bumpers, alloy wheels and satellite radio whips.',
  },
  fashion: {
    style: 'low-rise denim, branded tees and hoodies',
    palette: [0x2f6fd0, 0x27313c, 0x9d9a92, 0xd94f3d, 0xb9c7cf],
    hats: 0.08,
    formalRatio: 0.22,
    silhouettes: ['layered tee and hoodie', 'bootcut jeans', 'puffer jacket', 'tracksuit'],
    notes: 'Logo-heavy casualwear, sneakers, messenger bags and Bluetooth earpieces.',
  },
  signage: {
    style: 'backlit lightboxes, LED tickers and early flat screens',
    adDensity: 0.7,
    neonRatio: 0.25,
    backlitRatio: 0.85,
    billboardRatio: 0.5,
    slogans: ['UNLIMITED MINUTES', 'CONNECT AT 3G SPEED', 'BIG BOX SAVINGS', 'EVERY DAY LOW PRICES'],
    notes: 'Uniform white lightboxes, blue corporate fascia and bus-shelter poster frames.',
  },
  soundscapeId: 'soundscape-2005-digital',
  soundscape: {
    id: 'soundscape-2005-digital',
    mood: 'compressed pop, ringtones and hybrid traffic hum',
    musicBed: 'nu-disco and R&B radio',
    ambience: ['monophonic ringtone', 'bus announcement', 'keyboard clicks', 'distant jackhammer'],
    loudness: 0.78,
  },
};

/** 2025 — contemporary city: timber, EVs, LED and quiet surfaces. */
const ERA_2025: EraTimelineDescriptor = {
  id: '2025',
  year: 2025,
  label: 'Contemporary City',
  description:
    'Mass-timber mixed-use blocks, quiet electric traffic, cargo bikes and programmable LED advertising.',
  keywords: ['contemporary', 'timber', 'electric', 'green roof', 'LED'],
  palette: {
    sky: 0x9fc4e6,
    skyHorizon: 0xf2e3cd,
    ground: 0x5c5f5a,
    asphalt: 0x40444a,
    sidewalk: 0xb9b7ae,
    buildingPrimary: 0xd7d5cf,
    buildingSecondary: 0x4f6b63,
    ambient: 0x76817f,
    emissive: 0xd9f2ff,
    accents: [0x2f7f6f, 0xd0a94f, 0x3f6fd8, 0xb8452f],
    notes: 'Warm timber and planting green against neutral paving; cool LED emissive accents.',
  },
  fog: {
    color: 0xc9d5dd,
    mode: 'linear',
    near: 90,
    far: 850,
    density: 0.0019,
    notes: 'Very light haze; the cleanest air of the five eras and the longest sightline.',
  },
  lighting: {
    mood: 'clear daylight with soft global bounce and generous reflected fill',
    sunColor: 0xfff8ec,
    sunIntensity: 1.25,
    sunElevationDeg: 48,
    sunAzimuthDeg: 180,
    ambientColor: 0x76818a,
    ambientIntensity: 0.62,
    hemisphereSkyColor: 0x9fc4e6,
    hemisphereGroundColor: 0x5c5f5a,
    exposure: 1.05,
    contrast: 1.0,
    notes: 'Balanced exposure, soft contact shadows, warm timber glow and clean glazing.',
  },
  typography: {
    displayFont: '"Inter", "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
    bodyFont: '"Inter", "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
    letterSpacingEm: 0.0,
    headingWeight: 500,
    signageCase: 'mixed',
    notes: 'Flat minimal sans, generous whitespace and animated pixel-matrix LED copy.',
  },
  architecture: {
    style: 'mass-timber and glass mixed-use with green roofs and solar canopies',
    storeysMin: 4,
    storeysMax: 32,
    facadeRoughness: 0.3,
    windowRatio: 0.66,
    roofStyle: 'green roof terraces with solar arrays, wind cowls and bee hotels',
    materials: ['mass timber', 'low-iron glazing', 'recycled aluminium', 'living facade'],
    notes: 'Deep reveals, planted balconies, passive shading fins and ground-floor bike rooms.',
  },
  vehicles: {
    style: 'quiet electric crossovers, cargo bikes and autonomous shuttles',
    bodyShapes: ['EV crossover', 'autonomous shuttle', 'cargo bike', 'electric bus'],
    dominantColors: [0xe8eaea, 0x2a2f36, 0x4f7f6f, 0x3a6fd8, 0xc7c9c4],
    chromeRatio: 0.05,
    topSpeedKph: 200,
    mix: { car: 0.5, truck: 0.1, bus: 0.08, bicycle: 0.28, tram: 0.04 },
    notes: 'Sealed grilles, flush handles, aero wheels, acoustic shielding and light strips.',
  },
  fashion: {
    style: 'athleisure, technical outerwear and vintage remix',
    palette: [0x2f7f6f, 0xd0a94f, 0x2a2f36, 0xb8452f, 0xe8eaea],
    hats: 0.12,
    formalRatio: 0.2,
    silhouettes: [
      'oversized technical shell',
      'wide-leg utility trousers',
      'knit sweater and cap',
      'sneaker-led streetwear',
    ],
    notes: 'Relaxed technical fabric, recycled knits, tote bags and layered streetwear.',
  },
  signage: {
    style: 'programmatic LED screens, projections and AR-anchored overlays',
    adDensity: 0.6,
    neonRatio: 0.2,
    backlitRatio: 0.4,
    billboardRatio: 0.35,
    slogans: [
      'STREAM ANYWHERE',
      'CARBON NEUTRAL BY DESIGN',
      'ORDER AHEAD — PICK UP IN STORE',
      'RIDE SHARE, GO ELECTRIC',
    ],
    notes: 'Animated LED fascia, transparent screens and small tactile wayfinding plates.',
  },
  soundscapeId: 'soundscape-2025-contemporary',
  soundscape: {
    id: 'soundscape-2025-contemporary',
    mood: 'quiet electric hum and airy ambience',
    musicBed: 'lo-fi streaming playlist',
    ambience: ['electric drivetrain whine', 'cargo-bike bell', 'park fountain', 'bird calls'],
    loudness: 0.55,
  },
};

/** Deeply freezes an authored table so consumers can never mutate shared data. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
}

/**
 * The five era tables, keyed by `EraId` and deeply frozen. `ERA_IDS` remains the
 * ordering authority; this record only guarantees the lookup.
 */
export const ERA_DESCRIPTORS: Readonly<Record<EraId, EraTimelineDescriptor>> = deepFreeze({
  '1945': ERA_1945,
  '1965': ERA_1965,
  '1985': ERA_1985,
  '2005': ERA_2005,
  '2025': ERA_2025,
} satisfies Record<EraId, EraTimelineDescriptor>);

/* ------------------------------------------------------------------------- *
 * Lookup
 * ------------------------------------------------------------------------- */

/** Looks a table up by id; throws a `RangeError` for unknown ids. */
export function getEraDescriptor(era: EraId | string): EraTimelineDescriptor {
  return ERA_DESCRIPTORS[assertEraId(era)];
}

/** Safe lookup for untrusted input (`null` instead of throwing). */
export function tryGetEraDescriptor(value: unknown): EraTimelineDescriptor | null {
  return isEraId(value) ? ERA_DESCRIPTORS[value] : null;
}

/* ------------------------------------------------------------------------- *
 * Blending
 * ------------------------------------------------------------------------- */

function lerpNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Snaps discrete values (strings, arrays, ids) to whichever era is closer. */
function pickValue<T>(from: T, to: T, t: number): T {
  return t < 0.5 ? from : to;
}

/**
 * Channel-wise blend of two `0xRRGGBB` colours. Progress is clamped, so
 * `0` returns `from` and `1` returns `to` exactly.
 */
export function blendEraColor(from: number, to: number, progress: number): number {
  const t = clamp01(progress);
  if (t <= 0) return from;
  if (t >= 1) return to;
  const mixed =
    (Math.round(lerpNumber((from >> 16) & 0xff, (to >> 16) & 0xff, t)) << 16) |
    (Math.round(lerpNumber((from >> 8) & 0xff, (to >> 8) & 0xff, t)) << 8) |
    Math.round(lerpNumber(from & 0xff, to & 0xff, t));
  return mixed >>> 0;
}

function blendPalette(from: EraColorPalette, to: EraColorPalette, t: number): EraColorPalette {
  return {
    sky: blendEraColor(from.sky, to.sky, t),
    skyHorizon: blendEraColor(from.skyHorizon, to.skyHorizon, t),
    ground: blendEraColor(from.ground, to.ground, t),
    asphalt: blendEraColor(from.asphalt, to.asphalt, t),
    sidewalk: blendEraColor(from.sidewalk, to.sidewalk, t),
    buildingPrimary: blendEraColor(from.buildingPrimary, to.buildingPrimary, t),
    buildingSecondary: blendEraColor(from.buildingSecondary, to.buildingSecondary, t),
    ambient: blendEraColor(from.ambient, to.ambient, t),
    emissive: blendEraColor(from.emissive, to.emissive, t),
    accents: pickValue(from.accents, to.accents, t),
    notes: pickValue(from.notes, to.notes, t),
  };
}

function blendFog(from: EraFogDescriptor, to: EraFogDescriptor, t: number): EraFogDescriptor {
  return {
    color: blendEraColor(from.color, to.color, t),
    mode: pickValue(from.mode, to.mode, t),
    near: lerpNumber(from.near, to.near, t),
    far: lerpNumber(from.far, to.far, t),
    density: lerpNumber(from.density, to.density, t),
    notes: pickValue(from.notes, to.notes, t),
  };
}

function blendLighting(from: EraLightingMood, to: EraLightingMood, t: number): EraLightingMood {
  return {
    mood: pickValue(from.mood, to.mood, t),
    sunColor: blendEraColor(from.sunColor, to.sunColor, t),
    sunIntensity: lerpNumber(from.sunIntensity, to.sunIntensity, t),
    sunElevationDeg: lerpNumber(from.sunElevationDeg, to.sunElevationDeg, t),
    sunAzimuthDeg: lerpNumber(from.sunAzimuthDeg, to.sunAzimuthDeg, t),
    ambientColor: blendEraColor(from.ambientColor, to.ambientColor, t),
    ambientIntensity: lerpNumber(from.ambientIntensity, to.ambientIntensity, t),
    hemisphereSkyColor: blendEraColor(from.hemisphereSkyColor, to.hemisphereSkyColor, t),
    hemisphereGroundColor: blendEraColor(from.hemisphereGroundColor, to.hemisphereGroundColor, t),
    exposure: lerpNumber(from.exposure, to.exposure, t),
    contrast: lerpNumber(from.contrast, to.contrast, t),
    notes: pickValue(from.notes, to.notes, t),
  };
}

function blendTypography(from: EraTypography, to: EraTypography, t: number): EraTypography {
  return {
    displayFont: pickValue(from.displayFont, to.displayFont, t),
    bodyFont: pickValue(from.bodyFont, to.bodyFont, t),
    letterSpacingEm: lerpNumber(from.letterSpacingEm, to.letterSpacingEm, t),
    headingWeight: Math.round(lerpNumber(from.headingWeight, to.headingWeight, t)),
    signageCase: pickValue(from.signageCase, to.signageCase, t),
    notes: pickValue(from.notes, to.notes, t),
  };
}

function blendArchitecture(
  from: EraArchitectureStyle,
  to: EraArchitectureStyle,
  t: number,
): EraArchitectureStyle {
  return {
    style: pickValue(from.style, to.style, t),
    storeysMin: Math.round(lerpNumber(from.storeysMin, to.storeysMin, t)),
    storeysMax: Math.round(lerpNumber(from.storeysMax, to.storeysMax, t)),
    facadeRoughness: lerpNumber(from.facadeRoughness, to.facadeRoughness, t),
    windowRatio: lerpNumber(from.windowRatio, to.windowRatio, t),
    roofStyle: pickValue(from.roofStyle, to.roofStyle, t),
    materials: pickValue(from.materials, to.materials, t),
    notes: pickValue(from.notes, to.notes, t),
  };
}

function blendVehicleMix(from: EraVehicleMix, to: EraVehicleMix, t: number): EraVehicleMix {
  const mix = {} as Record<EraVehicleClass, number>;
  for (const vehicleClass of ERA_VEHICLE_CLASSES) {
    mix[vehicleClass] = lerpNumber(from[vehicleClass], to[vehicleClass], t);
  }
  return mix;
}

function blendVehicles(from: EraVehicleStyle, to: EraVehicleStyle, t: number): EraVehicleStyle {
  return {
    style: pickValue(from.style, to.style, t),
    bodyShapes: pickValue(from.bodyShapes, to.bodyShapes, t),
    dominantColors: pickValue(from.dominantColors, to.dominantColors, t),
    chromeRatio: lerpNumber(from.chromeRatio, to.chromeRatio, t),
    topSpeedKph: Math.round(lerpNumber(from.topSpeedKph, to.topSpeedKph, t)),
    mix: blendVehicleMix(from.mix, to.mix, t),
    notes: pickValue(from.notes, to.notes, t),
  };
}

function blendFashion(from: EraFashionStyle, to: EraFashionStyle, t: number): EraFashionStyle {
  return {
    style: pickValue(from.style, to.style, t),
    palette: pickValue(from.palette, to.palette, t),
    hats: lerpNumber(from.hats, to.hats, t),
    formalRatio: lerpNumber(from.formalRatio, to.formalRatio, t),
    silhouettes: pickValue(from.silhouettes, to.silhouettes, t),
    notes: pickValue(from.notes, to.notes, t),
  };
}

function blendSignage(from: EraSignageStyle, to: EraSignageStyle, t: number): EraSignageStyle {
  return {
    style: pickValue(from.style, to.style, t),
    adDensity: lerpNumber(from.adDensity, to.adDensity, t),
    neonRatio: lerpNumber(from.neonRatio, to.neonRatio, t),
    backlitRatio: lerpNumber(from.backlitRatio, to.backlitRatio, t),
    billboardRatio: lerpNumber(from.billboardRatio, to.billboardRatio, t),
    slogans: pickValue(from.slogans, to.slogans, t),
    notes: pickValue(from.notes, to.notes, t),
  };
}

function blendSoundscape(
  from: EraSoundscapeDescriptor,
  to: EraSoundscapeDescriptor,
  t: number,
): EraSoundscapeDescriptor {
  return {
    id: pickValue(from.id, to.id, t),
    mood: pickValue(from.mood, to.mood, t),
    musicBed: pickValue(from.musicBed, to.musicBed, t),
    ambience: pickValue(from.ambience, to.ambience, t),
    loudness: lerpNumber(from.loudness, to.loudness, t),
  };
}

/**
 * Resolves the descriptor for a point *between* two eras.
 *
 * Continuous values (colours, fog range, sun angles, intensities, ratios, mix
 * shares and the numeric year) are interpolated; discrete values (styles, font
 * stacks, slogans, materials, soundscape ids) snap to whichever era is nearer.
 *
 * The result is a fresh, unfrozen working copy so blendables can adjust it
 * before applying it to their own objects. `progress <= 0` returns the `from`
 * table and `progress >= 1` returns the `to` table unchanged.
 */
export function resolveEraBlend(from: EraId, to: EraId, progress: number): EraTimelineDescriptor {
  const t = clamp01(progress);
  const source = getEraDescriptor(from);
  if (from === to || t >= 1) return to === from ? source : getEraDescriptor(to);
  if (t <= 0) return source;
  const target = getEraDescriptor(to);
  const nearer = t < 0.5 ? source : target;

  return {
    id: nearer.id,
    year: Math.round(lerpNumber(source.year, target.year, t)),
    label: nearer.label,
    description: nearer.description,
    keywords: nearer.keywords,
    palette: blendPalette(source.palette, target.palette, t),
    fog: blendFog(source.fog, target.fog, t),
    lighting: blendLighting(source.lighting, target.lighting, t),
    typography: blendTypography(source.typography, target.typography, t),
    architecture: blendArchitecture(source.architecture, target.architecture, t),
    vehicles: blendVehicles(source.vehicles, target.vehicles, t),
    fashion: blendFashion(source.fashion, target.fashion, t),
    signage: blendSignage(source.signage, target.signage, t),
    soundscapeId: nearer.soundscapeId,
    soundscape: blendSoundscape(source.soundscape, target.soundscape, t),
  };
}

/**
 * Convenience aggregate, mirroring the `EraContracts` / `BlockLayout` style so a
 * consumer can reach the whole descriptor surface from one import.
 */
export const EraDescriptors = Object.freeze({
  version: ERA_DESCRIPTORS_VERSION,
  all: ERA_DESCRIPTORS,
  get: getEraDescriptor,
  tryGet: tryGetEraDescriptor,
  blend: resolveEraBlend,
  blendColor: blendEraColor,
  vehicleClasses: ERA_VEHICLE_CLASSES,
});
