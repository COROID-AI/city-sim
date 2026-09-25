/**
 * Chrono City era dataset: one complete descriptor block per timeline stop.
 *
 * Every value here is deterministic, parameterized data — style ids, colours,
 * counts, gains and intensities — that the procedural generators consume.
 * Nothing in this file reads the clock, a random source or an asset, so the
 * same `ERAS` value is produced on every import and unit tests stay stable.
 *
 * Consumers must import this data through `./eraTypes`, which re-exports it as
 * the era-contract surface; this module is read-only for every consumer.
 */

import type {
  EraConfig,
  EraId,
  EraPalette,
} from "./eraTypes";

/** Canonical chronological era order; mirrors the timeline slider. */
export const ERA_IDS = ["1945", "1965", "1985", "2005", "2025"] as const satisfies readonly EraId[];

/* -------------------------------------------------------------------------- */
/* Palette                                                                    */
/* -------------------------------------------------------------------------- */

/** 1945: sooted, low-saturation masonry under a hazy overcast sky. */
const PALETTE_1945: EraPalette = {
  sky: 0x93a1ad,
  skyHorizon: 0xc9bfa4,
  fog: 0xb3ac97,
  sunlight: 0xffe9c4,
  ambient: 0x6a7180,
  ground: 0x4c4636,
  asphalt: 0x3a3833,
  sidewalk: 0x8b8574,
  facadePrimary: 0x8b6a4d,
  facadeSecondary: 0xb9a98b,
  accent: 0x7c2f22,
  windowGlow: 0xffd489,
  uiAccent: 0xd9a54d,
};

/** 1965: optimistic midcentury daylight with saturated advertising accents. */
const PALETTE_1965: EraPalette = {
  sky: 0x6fb3d9,
  skyHorizon: 0xd8e6ee,
  fog: 0xb9c6cc,
  sunlight: 0xfff4d9,
  ambient: 0x7b8697,
  ground: 0x53594a,
  asphalt: 0x40413d,
  sidewalk: 0x9d9a8c,
  facadePrimary: 0xd8d2c4,
  facadeSecondary: 0x6e8fa6,
  accent: 0xe0562f,
  windowGlow: 0xfff0b0,
  uiAccent: 0xf0a63c,
};

/** 1985: smoggy dusk where neon and sodium light do the colour work. */
const PALETTE_1985: EraPalette = {
  sky: 0x243a5e,
  skyHorizon: 0xd06a63,
  fog: 0x4a3f5c,
  sunlight: 0xffc48a,
  ambient: 0x5a4a72,
  ground: 0x3a3444,
  asphalt: 0x2f2c3a,
  sidewalk: 0x6e6878,
  facadePrimary: 0x7fa8bd,
  facadeSecondary: 0xc46a94,
  accent: 0x2ad4d4,
  windowGlow: 0x8ff0ff,
  uiAccent: 0xff5fc8,
};

/** 2005: cool, slightly washed office daylight with chrome-blue accents. */
const PALETTE_2005: EraPalette = {
  sky: 0x7f9dc4,
  skyHorizon: 0xd7dfe9,
  fog: 0xb6c0cd,
  sunlight: 0xfff6e2,
  ambient: 0x8f98a6,
  ground: 0x4b4f52,
  asphalt: 0x3c3f42,
  sidewalk: 0xa3a6a8,
  facadePrimary: 0xa8b3bf,
  facadeSecondary: 0x5f7285,
  accent: 0x2f8fd8,
  windowGlow: 0xdff1ff,
  uiAccent: 0x63b6ff,
};

/** 2025: clean high-key daylight with pale timber and green accents. */
const PALETTE_2025: EraPalette = {
  sky: 0x8ec9e8,
  skyHorizon: 0xe8f1ee,
  fog: 0xc6d5d1,
  sunlight: 0xfff7ea,
  ambient: 0x93a29c,
  ground: 0x4f5a4c,
  asphalt: 0x3a3f3d,
  sidewalk: 0xb0b5ae,
  facadePrimary: 0xcbb894,
  facadeSecondary: 0x7f9a86,
  accent: 0x54d69a,
  windowGlow: 0xf2ffe6,
  uiAccent: 0x62e0a8,
};

/* -------------------------------------------------------------------------- */
/* Era blocks                                                                 */
/* -------------------------------------------------------------------------- */

/** 1945 — postwar reconstruction: low brick masonry, rationed retail. */
const ERA_1945: EraConfig = {
  id: "1945",
  index: 0,
  year: 1945,
  label: "1945",
  title: "Postwar Reconstruction",
  tagline: "Brick, kerosene light and rationed shopfronts on repaired streets.",
  palette: PALETTE_1945,
  buildings: {
    style: "postwar-brick-masonry",
    secondaryStyle: "art-deco-limestone",
    roofStyle: "flat-parapet",
    minFloors: 2,
    maxFloors: 9,
    floorHeight: 3.7,
    footprintFill: 0.78,
    setbacks: 1,
    facadeModules: 4,
    window: { columns: 4, rows: 6, recessed: true, glow: 0.22 },
    ornament: 0.7,
    rooftopDetails: ["water-tower", "brick-chimney", "painted-roof-sign", "fire-escape"],
    materials: [
      { id: "clay-brick", role: "primary", color: 0x8b6a4d, roughness: 0.92, metalness: 0.02 },
      { id: "cast-stone", role: "trim", color: 0xc7bda6, roughness: 0.78, metalness: 0.03 },
      { id: "steel-sash-glazing", role: "glazing", color: 0x6f7d84, roughness: 0.35, metalness: 0.18 },
    ],
    heightFalloff: 0.3,
  },
  vehicles: {
    mix: [
      { kind: "sedan", share: 0.26, speed: 9.4, length: 4.6, width: 1.8, height: 1.6, bodyColor: 0x2f3a34, roofColor: 0x232b27, engineSound: "flathead-six", noise: 0.5 },
      { kind: "coupe", share: 0.08, speed: 10.6, length: 4.4, width: 1.75, height: 1.5, bodyColor: 0x5a2b26, roofColor: 0x3d1d1a, engineSound: "v8-sidevalve", noise: 0.55 },
      { kind: "delivery-van", share: 0.14, speed: 7.8, length: 5.0, width: 1.95, height: 2.2, bodyColor: 0x4a4f43, roofColor: 0x363a30, engineSound: "inline-four", noise: 0.6 },
      { kind: "truck", share: 0.16, speed: 6.7, length: 7.2, width: 2.3, height: 2.6, bodyColor: 0x39413a, roofColor: 0x2b312c, engineSound: "diesel-inline-six", noise: 0.72 },
      { kind: "streetcar", share: 0.18, speed: 5.0, length: 10.5, width: 2.4, height: 3.2, bodyColor: 0x6b5a3c, roofColor: 0x4d402a, engineSound: "traction-motor", noise: 0.45 },
      { kind: "bus", share: 0.12, speed: 6.1, length: 9.0, width: 2.5, height: 3.0, bodyColor: 0x5c4a2e, roofColor: 0x413420, engineSound: "petrol-six", noise: 0.62 },
      { kind: "bicycle", share: 0.06, speed: 3.3, length: 1.8, width: 0.6, height: 1.2, bodyColor: 0x2b2b2b, roofColor: 0x1f1f1f, engineSound: "human-powered", noise: 0.05 },
    ],
    density: 6.5,
    laneCount: 2,
    laneWidth: 3.2,
    speedLimit: 8.3,
    wheels: "steel-bias-ply",
    headlight: "sealed-beam",
    taillight: "single-red-lens",
    chromeLevel: 0.35,
    parkingShare: 0.45,
    hornStyle: "klaxon-bulb",
    idlingNoise: 0.3,
  },
  storefronts: {
    kinds: ["grocer", "butcher", "pharmacy", "hardware", "diner", "barber", "tailor", "laundromat", "newsstand"],
    occupancy: 0.72,
    signStyles: ["painted-wall-lettering", "hanging-shingle", "neon-script", "marquee-blade"],
    awning: true,
    awningColors: [0x7c2f22, 0x2f4a3f, 0x3a3f4a],
    glassArea: 0.3,
    hours: { openHour: 7, closeHour: 18 },
    priceTier: "cash-only",
    interiorGlow: 0.25,
    queueDensity: 0.35,
    deliveryPattern: "curbside-handcart",
  },
  advertising: {
    media: ["painted-wall-bulletin", "marquee-blade", "war-bond-poster", "transit-card"],
    density: 0.8,
    animatedShare: 0,
    brightness: 0.35,
    saturation: 0.4,
    typography: "hand-lettered-gothic",
    copyThemes: ["victory-bonds", "rationing-notices", "soap-serials"],
    billboardScale: 0.8,
    messageRotationSeconds: 86400,
    sponsorModel: "local-merchant",
  },
  pedestrians: {
    outfits: [
      { id: "rationing-wool-coat", share: 0.36, palette: [0x4b4a44, 0x6b5b45, 0x3a3f4a, 0x7c6a55], silhouette: "long-overcoat", accessories: ["fedora", "leather-gloves", "canvas-satchel"], coverage: 0.93 },
      { id: "utility-house-dress", share: 0.3, palette: [0x8d7c67, 0x5b4a3f, 0xa89a80, 0x6f5d52], silhouette: "a-line-knee", accessories: ["head-scarf", "ration-book-bag", "oxford-shoes"], coverage: 0.86 },
      { id: "enlisted-service-uniform", share: 0.18, palette: [0x4a5a48, 0x39463a, 0x8a7f5f, 0x2f3a33], silhouette: "tunic-trousers", accessories: ["peaked-cap", "canvas-duffel", "dog-tags"], coverage: 0.96 },
      { id: "child-short-trousers", share: 0.16, palette: [0x6f6a52, 0x8a4a3a, 0x4a5560, 0xb0a082], silhouette: "knickerbocker", accessories: ["flat-cap", "satchel", "leather-boots"], coverage: 0.82 },
    ],
    density: 5.5,
    walkSpeed: 1.25,
    strideScale: 0.95,
    crowdRatio: 0.25,
    ageMix: { child: 0.22, adult: 0.62, senior: 0.16 },
    gadgetUse: 0,
    chatterLevel: 0.45,
    seasonalWear: "wool-and-leather",
  },
  environment: {
    skyModel: "sooted-overcast",
    sunElevation: 28,
    sunAzimuth: 210,
    lux: 18000,
    fogDensity: 0.028,
    fogColor: 0xb3ac97,
    streetSurface: "cobblestone-patched",
    laneMarkings: ["hand-painted-center-line"],
    sidewalkMaterial: "cast-concrete-slab",
    streetFurniture: ["cast-iron-lamp-post", "horse-trough", "telephone-booth-wood", "fire-hydrant", "newsstand"],
    treeStyle: "whip-saplings",
    treeDensity: 0.35,
    utilityLines: true,
    streetLightStyle: "incandescent-mantle",
    weather: "overcast-drizzle",
    airQuality: 0.45,
  },
  sound: {
    soundscape: "radio-era-street",
    ambience: "inner-city-hum",
    layers: [
      { id: "street-murmur", kind: "ambience", gain: 0.22, character: "low-crowd-murmur" },
      { id: "tram-and-handcart", kind: "mechanical", gain: 0.2, character: "iron-wheel-and-bell" },
      { id: "petrol-idle", kind: "traffic", gain: 0.18, character: "unmuffled-four-stroke" },
      { id: "wireless-ballad", kind: "music", gain: 0.16, character: "mono-wireless-ballad" },
      { id: "hawker-calls", kind: "voice", gain: 0.14, character: "street-hawker-shouts" },
      { id: "sparrows", kind: "nature", gain: 0.1, character: "sparrow-flock" },
    ],
    mixer: { ambience: 0.3, traffic: 0.28, music: 0.22, effects: 0.2 },
    musicStyle: "big-band-wireless",
    musicTempo: 92,
    reverbSeconds: 0.4,
    trafficGain: 0.5,
    signatureCues: ["wireless-news-bulletin", "streetcar-bell", "steam-whistle"],
    listenerProfile: "mono-valve-radio",
  },
  transition: {
    durationMs: 2400,
    easing: "ease-in-out",
    crossfade: 0.35,
    colorLerp: true,
    morphStyle: "vapour-dissolve",
    particleEffect: "dust-and-paper",
    cameraDolly: 0.6,
    stingerSound: "radio-static-swell",
    stepSeconds: 0.8,
  },
};

/** 1965 — midcentury optimism: curtain-wall slabs and boulevard traffic. */
const ERA_1965: EraConfig = {
  id: "1965",
  index: 1,
  year: 1965,
  label: "1965",
  title: "Midcentury Boom",
  tagline: "Curtain-wall offices, chrome boulevards and brand-new appliance shops.",
  palette: PALETTE_1965,
  buildings: {
    style: "midcentury-curtain-wall",
    secondaryStyle: "precast-concrete-slab",
    roofStyle: "flat-mechanical",
    minFloors: 4,
    maxFloors: 16,
    floorHeight: 3.4,
    footprintFill: 0.7,
    setbacks: 2,
    facadeModules: 6,
    window: { columns: 6, rows: 8, recessed: false, glow: 0.4 },
    ornament: 0.45,
    rooftopDetails: ["hvac-package-units", "helipad-marker", "anodised-spandrel", "roof-cafeteria-rail"],
    materials: [
      { id: "precast-concrete", role: "primary", color: 0xd8d2c4, roughness: 0.85, metalness: 0.02 },
      { id: "anodised-aluminium", role: "secondary", color: 0xb8bec4, roughness: 0.38, metalness: 0.55 },
      { id: "gold-tinted-glass", role: "glazing", color: 0xc9a15c, roughness: 0.18, metalness: 0.35 },
    ],
    heightFalloff: 0.45,
  },
  vehicles: {
    mix: [
      { kind: "sedan", share: 0.3, speed: 13.3, length: 5.2, width: 1.95, height: 1.55, bodyColor: 0x2f6f8f, roofColor: 0x24566f, engineSound: "v8-overhead-valve", noise: 0.45 },
      { kind: "coupe", share: 0.06, speed: 15.3, length: 4.9, width: 1.9, height: 1.4, bodyColor: 0x8f2f2a, roofColor: 0x631f1c, engineSound: "v8-overhead-valve", noise: 0.5 },
      { kind: "muscle-car", share: 0.1, speed: 17.2, length: 5.0, width: 1.95, height: 1.35, bodyColor: 0xbf7a1f, roofColor: 0x8a5514, engineSound: "big-block-v8", noise: 0.62 },
      { kind: "taxi", share: 0.06, speed: 12.2, length: 5.3, width: 2.0, height: 1.6, bodyColor: 0xd8a51f, roofColor: 0x9b7613, engineSound: "inline-six", noise: 0.45 },
      { kind: "delivery-van", share: 0.1, speed: 11.1, length: 5.4, width: 2.1, height: 2.2, bodyColor: 0x5f8f6a, roofColor: 0x44684c, engineSound: "inline-six", noise: 0.5 },
      { kind: "truck", share: 0.12, speed: 8.9, length: 8.4, width: 2.4, height: 3.0, bodyColor: 0x44708f, roofColor: 0x325269, engineSound: "diesel-v8", noise: 0.68 },
      { kind: "bus", share: 0.14, speed: 7.8, length: 11.0, width: 2.6, height: 3.1, bodyColor: 0x4f8f7a, roofColor: 0x3a6759, engineSound: "diesel-inline-six", noise: 0.58 },
      { kind: "streetcar", share: 0.06, speed: 5.6, length: 12.0, width: 2.5, height: 3.3, bodyColor: 0xb04a2f, roofColor: 0x7f3522, engineSound: "traction-motor", noise: 0.4 },
      { kind: "motorcycle", share: 0.04, speed: 14.4, length: 2.2, width: 0.8, height: 1.3, bodyColor: 0x2b2b2b, roofColor: 0x1f1f1f, engineSound: "twin-parallel", noise: 0.5 },
      { kind: "bicycle", share: 0.02, speed: 3.9, length: 1.8, width: 0.6, height: 1.2, bodyColor: 0x356b8f, roofColor: 0x274f6b, engineSound: "human-powered", noise: 0.05 },
    ],
    density: 9.5,
    laneCount: 4,
    laneWidth: 3.4,
    speedLimit: 11.1,
    wheels: "whitewall-steel",
    headlight: "quad-halogen",
    taillight: "triple-segment",
    chromeLevel: 0.7,
    parkingShare: 0.4,
    hornStyle: "electric-dual-tone",
    idlingNoise: 0.45,
  },
  storefronts: {
    kinds: ["department-store", "record-shop", "diner", "grocer", "appliance-store", "pharmacy", "auto-showroom", "bowling-alley", "barber"],
    occupancy: 0.85,
    signStyles: ["backlit-panel", "googie-arrow", "channel-letter", "pole-sign"],
    awning: true,
    awningColors: [0xe0562f, 0xf0a63c, 0x2f7fbf],
    glassArea: 0.55,
    hours: { openHour: 8, closeHour: 21 },
    priceTier: "fixed-price",
    interiorGlow: 0.5,
    queueDensity: 0.45,
    deliveryPattern: "rear-alley-freight",
  },
  advertising: {
    media: ["billboard-14x48", "painted-wall-bulletin", "neon-sign", "transit-card"],
    density: 1.6,
    animatedShare: 0.08,
    brightness: 0.5,
    saturation: 0.65,
    typography: "swiss-grotesk-lowercase",
    copyThemes: ["new-car-models", "television-sets", "airline-travel"],
    billboardScale: 1,
    messageRotationSeconds: 43200,
    sponsorModel: "national-brand-sponsorship",
  },
  pedestrians: {
    outfits: [
      { id: "mod-minidress", share: 0.28, palette: [0xe0562f, 0xf0a63c, 0x2f7fbf, 0xd8d4cb], silhouette: "shift-mini", accessories: ["patterned-headscarf", "oversized-sunglasses", "patent-bag"], coverage: 0.62 },
      { id: "ivy-league-suit", share: 0.26, palette: [0x2f3a4a, 0x6f7480, 0x8a7f5f, 0xdfe3e6], silhouette: "slim-lapel-suit", accessories: ["skinny-tie", "wingtip-shoes", "attache-case"], coverage: 0.88 },
      { id: "shift-dress-print", share: 0.24, palette: [0xbf5f8f, 0x8fbf7f, 0xf0d24a, 0x4f8fbf], silhouette: "sleeveless-a-line", accessories: ["beaded-necklace", "ballet-flats", "clutch-bag"], coverage: 0.68 },
      { id: "workwear-overalls", share: 0.22, palette: [0x4f6f8f, 0x8f7a4a, 0x5f5f5f, 0xc2c7cc], silhouette: "dungaree", accessories: ["peaked-cap", "lunch-pail", "steel-toe-boots"], coverage: 0.9 },
    ],
    density: 9,
    walkSpeed: 1.35,
    strideScale: 1,
    crowdRatio: 0.35,
    ageMix: { child: 0.26, adult: 0.6, senior: 0.14 },
    gadgetUse: 0.03,
    chatterLevel: 0.55,
    seasonalWear: "crisp-cotton-raincoats",
  },
  environment: {
    skyModel: "clear-midcentury-noon",
    sunElevation: 52,
    sunAzimuth: 180,
    lux: 68000,
    fogDensity: 0.012,
    fogColor: 0xb9c6cc,
    streetSurface: "asphalt-seamed",
    laneMarkings: ["double-yellow-center", "crosswalk-bars"],
    sidewalkMaterial: "brushed-concrete",
    streetFurniture: ["gooseneck-streetlight", "bus-shelter-glass", "parking-meter", "cigarette-vending-kiosk", "slat-bench"],
    treeStyle: "mature-elm-canopy",
    treeDensity: 0.7,
    utilityLines: true,
    streetLightStyle: "mercury-vapour",
    weather: "bright-hazy-sun",
    airQuality: 0.35,
  },
  sound: {
    soundscape: "midcentury-boulevard",
    ambience: "wide-boulevard-air",
    layers: [
      { id: "boulevard-murmur", kind: "ambience", gain: 0.2, character: "open-air-chatter" },
      { id: "v8-traffic", kind: "traffic", gain: 0.24, character: "v8-low-rev-cruise" },
      { id: "surf-guitar", kind: "music", gain: 0.18, character: "twangy-electric-guitar" },
      { id: "transistor-pop", kind: "music", gain: 0.12, character: "portable-transistor-radio" },
      { id: "construction-drill", kind: "mechanical", gain: 0.16, character: "pneumatic-drill-burst" },
      { id: "pigeons", kind: "nature", gain: 0.1, character: "pigeon-wing-clatter" },
    ],
    mixer: { ambience: 0.26, traffic: 0.34, music: 0.24, effects: 0.16 },
    musicStyle: "surf-rock-and-motown",
    musicTempo: 118,
    reverbSeconds: 0.55,
    trafficGain: 0.62,
    signatureCues: ["car-radio-jingle", "crosswalk-relay-click", "newsreel-trumpet"],
    listenerProfile: "stereo-transistor-set",
  },
  transition: {
    durationMs: 2000,
    easing: "ease-out",
    crossfade: 0.42,
    colorLerp: true,
    morphStyle: "sunbleach-flash",
    particleEffect: "confetti-and-chrome",
    cameraDolly: 0.8,
    stingerSound: "vinyl-needle-drop",
    stepSeconds: 0.7,
  },
};

/** 1985 — analog downtown: mirror glass, neon and sodium haze. */
const ERA_1985: EraConfig = {
  id: "1985",
  index: 2,
  year: 1985,
  label: "1985",
  title: "Analog Downtown",
  tagline: "Mirror glass, neon signage and a street that never quite cools down.",
  palette: PALETTE_1985,
  buildings: {
    style: "mirror-glass-tower",
    secondaryStyle: "postmodern-trim-stone",
    roofStyle: "stepped-crown",
    minFloors: 6,
    maxFloors: 30,
    floorHeight: 3.6,
    footprintFill: 0.62,
    setbacks: 3,
    facadeModules: 8,
    window: { columns: 8, rows: 12, recessed: true, glow: 0.62 },
    ornament: 0.55,
    rooftopDetails: ["satellite-dish", "neon-crown-ring", "cooling-towers", "antenna-mast"],
    materials: [
      { id: "polished-granite", role: "primary", color: 0x6b5f70, roughness: 0.3, metalness: 0.2 },
      { id: "mirror-glass", role: "glazing", color: 0x7fa8bd, roughness: 0.12, metalness: 0.72 },
      { id: "neon-tube-trim", role: "trim", color: 0xff5fc8, roughness: 0.4, metalness: 0.05 },
    ],
    heightFalloff: 0.6,
  },
  vehicles: {
    mix: [
      { kind: "sedan", share: 0.22, speed: 14.4, length: 4.8, width: 1.85, height: 1.5, bodyColor: 0x8a3f52, roofColor: 0x662e3d, engineSound: "turbo-four", noise: 0.4 },
      { kind: "compact", share: 0.16, speed: 12.8, length: 4.1, width: 1.7, height: 1.45, bodyColor: 0x4f7f9f, roofColor: 0x3a5f78, engineSound: "economy-four", noise: 0.35 },
      { kind: "hatchback", share: 0.1, speed: 13.3, length: 3.9, width: 1.68, height: 1.5, bodyColor: 0xc2c7cc, roofColor: 0x9198a0, engineSound: "economy-four", noise: 0.35 },
      { kind: "muscle-car", share: 0.08, speed: 18.3, length: 4.9, width: 1.9, height: 1.35, bodyColor: 0x1f1f24, roofColor: 0x141418, engineSound: "fuel-injected-v8", noise: 0.7 },
      { kind: "taxi", share: 0.06, speed: 13.9, length: 4.9, width: 1.9, height: 1.55, bodyColor: 0xe0c22f, roofColor: 0xa38f1f, engineSound: "diesel-four", noise: 0.45 },
      { kind: "delivery-van", share: 0.08, speed: 12.2, length: 5.2, width: 2.05, height: 2.15, bodyColor: 0xd8d4cb, roofColor: 0xa39f96, engineSound: "diesel-four", noise: 0.5 },
      { kind: "truck", share: 0.1, speed: 9.4, length: 9.0, width: 2.45, height: 3.1, bodyColor: 0x6f7480, roofColor: 0x52565f, engineSound: "diesel-inline-six", noise: 0.7 },
      { kind: "bus", share: 0.1, speed: 8.3, length: 11.5, width: 2.6, height: 3.15, bodyColor: 0xdd5a2b, roofColor: 0xa4441f, engineSound: "diesel-inline-six", noise: 0.6 },
      { kind: "motorcycle", share: 0.05, speed: 16.7, length: 2.2, width: 0.85, height: 1.3, bodyColor: 0x2a2a3a, roofColor: 0x1d1d29, engineSound: "inline-four", noise: 0.55 },
      { kind: "bicycle", share: 0.05, speed: 4.2, length: 1.8, width: 0.6, height: 1.2, bodyColor: 0x2f6f4f, roofColor: 0x224f39, engineSound: "human-powered", noise: 0.06 },
    ],
    density: 12,
    laneCount: 4,
    laneWidth: 3.5,
    speedLimit: 12.5,
    wheels: "alloy-radial",
    headlight: "halogen-quad",
    taillight: "amber-wrap",
    chromeLevel: 0.45,
    parkingShare: 0.35,
    hornStyle: "harsh-electric-horn",
    idlingNoise: 0.55,
  },
  storefronts: {
    kinds: ["record-shop", "video-rental", "arcade", "electronics", "pizza", "department-store", "photo-lab", "sporting-goods", "card-shop"],
    occupancy: 0.78,
    signStyles: ["vacuum-formed-backlit", "neon-tube-outline", "chrome-channel-letter", "roof-mounted-pylon"],
    awning: false,
    awningColors: [0xff5fc8, 0x2ad4d4, 0xffd24a],
    glassArea: 0.62,
    hours: { openHour: 9, closeHour: 22 },
    priceTier: "discount-mall",
    interiorGlow: 0.68,
    queueDensity: 0.5,
    deliveryPattern: "roll-up-shutter-drop",
  },
  advertising: {
    media: ["billboard-panel", "neon-sign", "backlit-plexiglass", "bus-shelter-poster"],
    density: 2.6,
    animatedShare: 0.35,
    brightness: 0.85,
    saturation: 0.9,
    typography: "chrome-italic-display",
    copyThemes: ["home-video", "sneaker-launch", "long-distance-calling"],
    billboardScale: 1.25,
    messageRotationSeconds: 10800,
    sponsorModel: "network-ad-buy",
  },
  pedestrians: {
    outfits: [
      { id: "denim-jacket", share: 0.26, palette: [0x2f4f7f, 0x8f9aa6, 0xc23f5f, 0xe0e4dd], silhouette: "boxy-denim", accessories: ["walkman", "high-top-sneakers", "bum-bag"], coverage: 0.8 },
      { id: "power-suit", share: 0.24, palette: [0x1f2430, 0x6b5f70, 0xc2a15f, 0xdfe3e6], silhouette: "oversized-shoulder-pad", accessories: ["briefcase", "brick-mobile-phone", "court-shoes"], coverage: 0.9 },
      { id: "neon-activewear", share: 0.3, palette: [0xff5fc8, 0x2ad4d4, 0xffd24a, 0x2b2f3a], silhouette: "leotard-legwarmers", accessories: ["sweatband", "fanny-pack", "windbreaker"], coverage: 0.7 },
      { id: "belted-trench-coat", share: 0.2, palette: [0x8f8375, 0x4a4f52, 0x6b5b45, 0xb0a082], silhouette: "belted-trench", accessories: ["shoulder-pad-blazer", "rain-hat", "leather-gloves"], coverage: 0.92 },
    ],
    density: 10.5,
    walkSpeed: 1.45,
    strideScale: 1.05,
    crowdRatio: 0.45,
    ageMix: { child: 0.2, adult: 0.63, senior: 0.17 },
    gadgetUse: 0.12,
    chatterLevel: 0.6,
    seasonalWear: "layered-denim-and-neon",
  },
  environment: {
    skyModel: "smoggy-dusk",
    sunElevation: 14,
    sunAzimuth: 250,
    lux: 4200,
    fogDensity: 0.035,
    fogColor: 0x4a3f5c,
    streetSurface: "asphalt-cracked",
    laneMarkings: ["double-yellow-center", "bike-lane-edge-line", "crosswalk-bars"],
    sidewalkMaterial: "aggregate-exposed-concrete",
    streetFurniture: ["sodium-streetlight", "newspaper-box-row", "glass-phone-booth", "painted-fire-hydrant", "steel-bench"],
    treeStyle: "pruned-honey-locust",
    treeDensity: 0.45,
    utilityLines: true,
    streetLightStyle: "high-pressure-sodium",
    weather: "humid-summer-haze",
    airQuality: 0.2,
  },
  sound: {
    soundscape: "analog-downtown",
    ambience: "dense-neon-downtown",
    layers: [
      { id: "downtown-crowd", kind: "ambience", gain: 0.2, character: "dense-footfall-crowd" },
      { id: "turbo-traffic", kind: "traffic", gain: 0.22, character: "muffled-turbo-traffic" },
      { id: "synthesizer-track", kind: "music", gain: 0.2, character: "analog-synth-arpeggio" },
      { id: "boombox-bleed", kind: "music", gain: 0.14, character: "boombox-hip-hop-bleed" },
      { id: "arcade-cabinet", kind: "mechanical", gain: 0.14, character: "arcade-cabinet-chirps" },
      { id: "subway-rumble", kind: "ambience", gain: 0.1, character: "subway-rumble-through-grate" },
    ],
    mixer: { ambience: 0.22, traffic: 0.3, music: 0.3, effects: 0.18 },
    musicStyle: "synth-pop-and-early-hip-hop",
    musicTempo: 126,
    reverbSeconds: 0.7,
    trafficGain: 0.6,
    signatureCues: ["walkman-click", "traffic-light-buzzer", "arcade-attract-mode"],
    listenerProfile: "fm-stereo-boombox",
  },
  transition: {
    durationMs: 1500,
    easing: "ease-in-out",
    crossfade: 0.5,
    colorLerp: true,
    morphStyle: "scanline-warp",
    particleEffect: "neon-spark-trail",
    cameraDolly: 1,
    stingerSound: "synth-riser",
    stepSeconds: 0.55,
  },
};

/** 2005 — early digital: blue glass, chain retail and phone chatter. */
const ERA_2005: EraConfig = {
  id: "2005",
  index: 3,
  year: 2005,
  label: "2005",
  title: "Early Digital",
  tagline: "Blue glass towers, chain coffee and screens on every hoarding.",
  palette: PALETTE_2005,
  buildings: {
    style: "blue-glass-office",
    secondaryStyle: "brick-loft-revival",
    roofStyle: "flat-green-roof",
    minFloors: 3,
    maxFloors: 40,
    floorHeight: 3.8,
    footprintFill: 0.58,
    setbacks: 2,
    facadeModules: 7,
    window: { columns: 7, rows: 14, recessed: false, glow: 0.5 },
    ornament: 0.3,
    rooftopDetails: ["green-roof-tray", "solar-hot-water", "telecom-array", "billboard-truss"],
    materials: [
      { id: "brick-loft-revival", role: "primary", color: 0x9c6b52, roughness: 0.9, metalness: 0.02 },
      { id: "painted-steel-panel", role: "secondary", color: 0x8b939c, roughness: 0.5, metalness: 0.4 },
      { id: "blue-silver-glass", role: "glazing", color: 0xa8b3bf, roughness: 0.1, metalness: 0.8 },
    ],
    heightFalloff: 0.5,
  },
  vehicles: {
    mix: [
      { kind: "sedan", share: 0.18, speed: 15.6, length: 4.9, width: 1.9, height: 1.5, bodyColor: 0x3b4a63, roofColor: 0x2c3849, engineSound: "v6-24v", noise: 0.3 },
      { kind: "compact", share: 0.14, speed: 14.4, length: 4.3, width: 1.78, height: 1.55, bodyColor: 0xb8bcc4, roofColor: 0x8a8d94, engineSound: "inline-four", noise: 0.3 },
      { kind: "hatchback", share: 0.1, speed: 13.9, length: 4.1, width: 1.75, height: 1.55, bodyColor: 0xd6b23a, roofColor: 0xa1862a, engineSound: "inline-four", noise: 0.3 },
      { kind: "suv", share: 0.2, speed: 15, length: 5.0, width: 2.0, height: 1.9, bodyColor: 0x2f4f3f, roofColor: 0x223b2f, engineSound: "v8-derivative", noise: 0.5 },
      { kind: "van", share: 0.1, speed: 13.9, length: 5.4, width: 2.05, height: 2.25, bodyColor: 0xa8adb4, roofColor: 0x7d828a, engineSound: "v6", noise: 0.45 },
      { kind: "delivery-van", share: 0.06, speed: 13.3, length: 5.6, width: 2.1, height: 2.3, bodyColor: 0xdfe3e6, roofColor: 0xa9adb0, engineSound: "diesel-v6", noise: 0.5 },
      { kind: "truck", share: 0.08, speed: 10, length: 9.6, width: 2.5, height: 3.2, bodyColor: 0x5c6470, roofColor: 0x444a54, engineSound: "diesel-inline-six", noise: 0.66 },
      { kind: "taxi", share: 0.04, speed: 15, length: 5.0, width: 1.95, height: 1.55, bodyColor: 0xe8c33a, roofColor: 0xae922b, engineSound: "v6", noise: 0.42 },
      { kind: "bus", share: 0.06, speed: 8.9, length: 12.0, width: 2.6, height: 3.2, bodyColor: 0x4f7fb8, roofColor: 0x3a5f8a, engineSound: "diesel-hybrid", noise: 0.5 },
      { kind: "bicycle", share: 0.04, speed: 4.4, length: 1.8, width: 0.62, height: 1.25, bodyColor: 0x3f6f5f, roofColor: 0x2f5346, engineSound: "human-powered", noise: 0.06 },
    ],
    density: 13.5,
    laneCount: 4,
    laneWidth: 3.6,
    speedLimit: 10.6,
    wheels: "chrome-alloy",
    headlight: "hid-xenon-projector",
    taillight: "led-bar",
    chromeLevel: 0.5,
    parkingShare: 0.4,
    hornStyle: "two-tone-electric",
    idlingNoise: 0.42,
  },
  storefronts: {
    kinds: ["coffee-bar", "mobile-phone", "internet-cafe", "dvd-rental", "convenience", "fitness-studio", "hair-salon", "electronics", "sandwich-bar"],
    occupancy: 0.8,
    signStyles: ["internally-illuminated-box", "channel-letter", "banner-flag", "window-vinyl"],
    awning: false,
    awningColors: [0x2f8fd8, 0xd8d4cb, 0x8f2f2a],
    glassArea: 0.7,
    hours: { openHour: 6, closeHour: 23 },
    priceTier: "chain-standardised",
    interiorGlow: 0.55,
    queueDensity: 0.4,
    deliveryPattern: "loading-dock-pallet",
  },
  advertising: {
    media: ["street-furniture-lcd", "billboard-panel", "bus-wrap", "digital-kiosk"],
    density: 3.1,
    animatedShare: 0.55,
    brightness: 0.7,
    saturation: 0.6,
    typography: "condensed-humanist-sans",
    copyThemes: ["contract-plans", "reality-tv", "mp3-players"],
    billboardScale: 1.1,
    messageRotationSeconds: 900,
    sponsorModel: "media-agency-placement",
  },
  pedestrians: {
    outfits: [
      { id: "low-rise-denim", share: 0.28, palette: [0x4f6f9f, 0xdfe3e6, 0xc26f5f, 0x8f9aa6], silhouette: "low-rise-bootcut", accessories: ["flip-phone", "trucker-cap", "canvas-sneakers"], coverage: 0.72 },
      { id: "hoodie-track-pants", share: 0.26, palette: [0x2f3a4a, 0x8f2f2a, 0x5f6f7f, 0xc2c7cc], silhouette: "baggy-athletic", accessories: ["mp3-player", "earbuds", "running-shoes"], coverage: 0.82 },
      { id: "business-casual", share: 0.24, palette: [0x5f6f7f, 0xb8bcc4, 0x8a7f5f, 0x3a3f4a], silhouette: "untucked-shirt-trouser", accessories: ["pager", "laptop-bag", "loafers"], coverage: 0.85 },
      { id: "cargo-shorts", share: 0.22, palette: [0x8f7a4a, 0x6f8f6a, 0xd8d4cb, 0x4a5560], silhouette: "cargo-utility", accessories: ["digital-camera", "lanyard", "sport-sandals"], coverage: 0.7 },
    ],
    density: 11.5,
    walkSpeed: 1.4,
    strideScale: 1.02,
    crowdRatio: 0.4,
    ageMix: { child: 0.21, adult: 0.64, senior: 0.15 },
    gadgetUse: 0.45,
    chatterLevel: 0.5,
    seasonalWear: "layered-cotton-hoodies",
  },
  environment: {
    skyModel: "cool-overcast-daylight",
    sunElevation: 40,
    sunAzimuth: 160,
    lux: 52000,
    fogDensity: 0.016,
    fogColor: 0xb6c0cd,
    streetSurface: "asphalt-resurfaced",
    laneMarkings: ["thermoplastic-dash", "crosswalk-ladder", "bike-box-stencil"],
    sidewalkMaterial: "stamped-brick-pavers",
    streetFurniture: ["metal-halide-streetlight", "bus-shelter-lcd", "parking-pay-station", "bollard-row", "recycling-bin"],
    treeStyle: "crape-myrtle-planters",
    treeDensity: 0.6,
    utilityLines: false,
    streetLightStyle: "metal-halide",
    weather: "cool-clear-afternoon",
    airQuality: 0.4,
  },
  sound: {
    soundscape: "early-digital-plaza",
    ambience: "air-conditioned-plaza-hum",
    layers: [
      { id: "plaza-hum", kind: "ambience", gain: 0.18, character: "hvac-and-chatter-hum" },
      { id: "hybrid-traffic", kind: "traffic", gain: 0.2, character: "muted-busy-traffic" },
      { id: "ringtone-pop", kind: "music", gain: 0.16, character: "polyphonic-ringtone-chorus" },
      { id: "earbud-bleed", kind: "music", gain: 0.14, character: "compressed-mp3-bleed" },
      { id: "scanner-beeps", kind: "mechanical", gain: 0.16, character: "checkout-scanner-beeps" },
      { id: "mobile-chatter", kind: "voice", gain: 0.16, character: "hands-free-phone-chatter" },
    ],
    mixer: { ambience: 0.24, traffic: 0.26, music: 0.28, effects: 0.22 },
    musicStyle: "pop-punk-and-crunk-radio",
    musicTempo: 104,
    reverbSeconds: 0.5,
    trafficGain: 0.55,
    signatureCues: ["flip-phone-snap", "subway-turnstile-beep", "camera-shutter-chirp"],
    listenerProfile: "early-mp3-earbuds",
  },
  transition: {
    durationMs: 1100,
    easing: "ease-out",
    crossfade: 0.58,
    colorLerp: true,
    morphStyle: "digital-glitch-cut",
    particleEffect: "pixel-shard-burst",
    cameraDolly: 1.2,
    stingerSound: "modem-handshake",
    stepSeconds: 0.4,
  },
};

/** 2025 — soft-electric city: mass timber, adaptive LEDs and quiet traffic. */
const ERA_2025: EraConfig = {
  id: "2025",
  index: 4,
  year: 2025,
  label: "2025",
  title: "Soft-Electric Now",
  tagline: "Timber hybrid towers, cargo bikes and street trees over cool quiet asphalt.",
  palette: PALETTE_2025,
  buildings: {
    style: "mass-timber-hybrid",
    secondaryStyle: "adaptive-reuse-brick",
    roofStyle: "solar-canopy",
    minFloors: 3,
    maxFloors: 34,
    floorHeight: 4.1,
    footprintFill: 0.54,
    setbacks: 3,
    facadeModules: 5,
    window: { columns: 5, rows: 16, recessed: true, glow: 0.35 },
    ornament: 0.22,
    rooftopDetails: ["solar-canopy", "wind-cowl", "roof-garden-rail", "drone-pad"],
    materials: [
      { id: "cross-laminated-timber", role: "primary", color: 0xcbb894, roughness: 0.72, metalness: 0.01 },
      { id: "recycled-aluminium", role: "secondary", color: 0x9aa39c, roughness: 0.45, metalness: 0.5 },
      { id: "low-iron-triple-glazing", role: "glazing", color: 0xbcd6cf, roughness: 0.08, metalness: 0.22 },
    ],
    heightFalloff: 0.4,
  },
  vehicles: {
    mix: [
      { kind: "ev-hatchback", share: 0.14, speed: 13.9, length: 4.2, width: 1.8, height: 1.55, bodyColor: 0xb8e4d0, roofColor: 0x8fb5a3, engineSound: "dual-motor-electric", noise: 0.12 },
      { kind: "compact", share: 0.08, speed: 13.3, length: 4.3, width: 1.8, height: 1.55, bodyColor: 0x8f9aa6, roofColor: 0x6d757f, engineSound: "mild-hybrid-four", noise: 0.18 },
      { kind: "sedan", share: 0.06, speed: 15, length: 4.9, width: 1.9, height: 1.5, bodyColor: 0x4a5f7a, roofColor: 0x37485c, engineSound: "electric-sedan", noise: 0.15 },
      { kind: "suv", share: 0.16, speed: 14.4, length: 5.0, width: 2.0, height: 1.85, bodyColor: 0x35504a, roofColor: 0x263a36, engineSound: "electric-crossover", noise: 0.16 },
      { kind: "van", share: 0.12, speed: 12.2, length: 5.4, width: 2.05, height: 2.2, bodyColor: 0xe0e4dd, roofColor: 0xaeb2ac, engineSound: "electric-van", noise: 0.2 },
      { kind: "delivery-van", share: 0.1, speed: 11.1, length: 5.8, width: 2.15, height: 2.35, bodyColor: 0x5fa88f, roofColor: 0x46806c, engineSound: "electric-delivery", noise: 0.2 },
      { kind: "cargo-bike", share: 0.08, speed: 5, length: 2.6, width: 0.85, height: 1.7, bodyColor: 0x2f7f6f, roofColor: 0x235f53, engineSound: "pedal-assist", noise: 0.04 },
      { kind: "bicycle", share: 0.1, speed: 4.7, length: 1.85, width: 0.62, height: 1.25, bodyColor: 0x356b5f, roofColor: 0x274f46, engineSound: "human-powered", noise: 0.04 },
      { kind: "motorcycle", share: 0.04, speed: 15.3, length: 2.2, width: 0.85, height: 1.3, bodyColor: 0x2b2f3a, roofColor: 0x1f222a, engineSound: "electric-scooter", noise: 0.18 },
      { kind: "bus", share: 0.12, speed: 9.4, length: 12.5, width: 2.6, height: 3.25, bodyColor: 0x4fa8c8, roofColor: 0x3a7e97, engineSound: "electric-bus", noise: 0.22 },
    ],
    density: 10,
    laneCount: 4,
    laneWidth: 3.6,
    speedLimit: 8.3,
    wheels: "aero-carbon",
    headlight: "adaptive-pixel-led",
    taillight: "animated-led-signature",
    chromeLevel: 0.2,
    parkingShare: 0.3,
    hornStyle: "pedestrian-aware-chime",
    idlingNoise: 0.08,
  },
  storefronts: {
    kinds: ["specialty-coffee", "plant-shop", "coworking", "phone-repair", "micro-bakery", "bike-shop", "thrift-resale", "zero-waste-grocer", "clinic"],
    occupancy: 0.88,
    signStyles: ["e-ink-panel", "hand-painted-mural-wordmark", "projected-light-scrim", "led-strip-edge"],
    awning: true,
    awningColors: [0x54d69a, 0xcbb894, 0x4a8f7f],
    glassArea: 0.78,
    hours: { openHour: 7, closeHour: 22 },
    priceTier: "subscription-first",
    interiorGlow: 0.4,
    queueDensity: 0.3,
    deliveryPattern: "cargo-bike-curbside",
  },
  advertising: {
    media: ["programmatic-led-screen", "digital-kiosk", "augmented-reality-overlay", "carbon-negative-sponsorship-panel"],
    density: 2.2,
    animatedShare: 0.8,
    brightness: 0.55,
    saturation: 0.45,
    typography: "variable-mono-hybrid",
    copyThemes: ["climate-pledges", "streaming-bundles", "ev-charging-plans"],
    billboardScale: 0.9,
    messageRotationSeconds: 12,
    sponsorModel: "programmatic-auction",
  },
  pedestrians: {
    outfits: [
      { id: "streetwear-layers", share: 0.3, palette: [0x2b2f3a, 0x54d69a, 0xcbb894, 0xe0e4dd], silhouette: "oversized-techwear", accessories: ["bone-conduction-earbuds", "crossbody-sling", "chunky-trainers"], coverage: 0.8 },
      { id: "athleisure-set", share: 0.26, palette: [0x7fb8a8, 0x9aa39c, 0xdfe6e0, 0x35504a], silhouette: "compression-knit", accessories: ["smartwatch", "insulated-bottle", "running-vest"], coverage: 0.74 },
      { id: "minimal-tailoring", share: 0.24, palette: [0x3a3f4a, 0xd8d4cb, 0x6b5b45, 0xb0a082], silhouette: "relaxed-single-breasted", accessories: ["sustainable-tote", "wireless-charger", "derby-shoes"], coverage: 0.88 },
      { id: "upcycled-outdoor", share: 0.2, palette: [0xa85f2f, 0x4f6f5f, 0xcbb894, 0x8f9aa6], silhouette: "repair-panelled-shell", accessories: ["solar-daypack", "e-bike-helmet", "trail-sneakers"], coverage: 0.9 },
    ],
    density: 9.8,
    walkSpeed: 1.42,
    strideScale: 1,
    crowdRatio: 0.38,
    ageMix: { child: 0.19, adult: 0.65, senior: 0.16 },
    gadgetUse: 0.82,
    chatterLevel: 0.38,
    seasonalWear: "breathable-technical-layers",
  },
  environment: {
    skyModel: "clean-high-key-daylight",
    sunElevation: 46,
    sunAzimuth: 145,
    lux: 72000,
    fogDensity: 0.008,
    fogColor: 0xc6d5d1,
    streetSurface: "permeable-asphalt",
    laneMarkings: ["solar-reflective-dash", "crosswalk-haptic-strip", "bike-boulevard-green-lane"],
    sidewalkMaterial: "permeable-clay-pavers",
    streetFurniture: ["adaptive-led-streetlight", "solar-bus-shelter-lcd", "ev-charging-bollard", "bioswale-planter", "solar-public-bench"],
    treeStyle: "bioswale-native-grove",
    treeDensity: 0.85,
    utilityLines: false,
    streetLightStyle: "adaptive-led",
    weather: "bright-clean-breeze",
    airQuality: 0.82,
  },
  sound: {
    soundscape: "mesh-soft-city",
    ambience: "quiet-electric-street",
    layers: [
      { id: "soft-street-hum", kind: "ambience", gain: 0.2, character: "quiet-pedestrian-hum" },
      { id: "ev-whisper", kind: "traffic", gain: 0.18, character: "silent-ev-tyre-hiss" },
      { id: "ambient-electronic", kind: "music", gain: 0.18, character: "sparse-ambient-electronic" },
      { id: "podcast-bleed", kind: "voice", gain: 0.14, character: "podcast-headphone-bleed" },
      { id: "cargo-bike-bell", kind: "mechanical", gain: 0.14, character: "bicycle-bell-and-hub" },
      { id: "urban-birdsong", kind: "nature", gain: 0.16, character: "urban-birdsong-layer" },
    ],
    mixer: { ambience: 0.3, traffic: 0.18, music: 0.28, effects: 0.24 },
    musicStyle: "ambient-electronic-and-global-bass",
    musicTempo: 96,
    reverbSeconds: 0.9,
    trafficGain: 0.32,
    signatureCues: ["contactless-payment-chime", "e-scooter-chirp", "ev-approach-whistle"],
    listenerProfile: "spatial-audio-headphones",
  },
  transition: {
    durationMs: 850,
    easing: "spring",
    crossfade: 0.66,
    colorLerp: true,
    morphStyle: "mesh-morph-bloom",
    particleEffect: "pollen-light-motes",
    cameraDolly: 1.4,
    stingerSound: "ambient-shimmer-swell",
    stepSeconds: 0.3,
  },
};

/* -------------------------------------------------------------------------- */
/* Dataset                                                                    */
/* -------------------------------------------------------------------------- */

/** The five era descriptors in chronological timeline order. */
export const ERAS: readonly EraConfig[] = deepFreeze<EraConfig[]>([
  ERA_1945,
  ERA_1965,
  ERA_1985,
  ERA_2005,
  ERA_2025,
]);

/** Era lookup by id, built from {@link ERAS} so both views cannot diverge. */
export const ERAS_BY_ID: Readonly<Record<EraId, EraConfig>> = deepFreeze(indexById(ERAS));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Clamps a transition blend to the valid `[0, 1]` range.
 *
 * `NaN` (a slider that has not been touched yet) resolves to 0, `±Infinity` to
 * the nearest bound, so callers can pass raw input without guarding first.
 */
export function clampBlend(blend: number): number {
  if (Number.isNaN(blend)) {
    return 0;
  }
  return blend <= 0 ? 0 : blend >= 1 ? 1 : blend;
}

/** Returns the descriptor for `era`, throwing on an unknown id. */
export function getEraConfig(era: EraId): EraConfig {
  const config: EraConfig | undefined = ERAS_BY_ID[era];
  if (!config) {
    throw new Error(`Unknown Chrono City era "${String(era)}".`);
  }
  return config;
}

/** Zero-based timeline position of `era`; the inverse of `ERAS[index]`. */
export function eraIndex(era: EraId): number {
  return getEraConfig(era).index;
}

/**
 * Spreads a transition into per-era weights.
 *
 * `blend` is the progress from `from` towards `to` and is clamped to `[0, 1]`,
 * so the returned weights always sum to 1 and morphing generators can simply
 * lerp their parameters by weight.
 */
export function resolveEraWeights(
  from: EraId,
  to: EraId,
  blend: number,
): Readonly<Record<EraId, number>> {
  const progress = clampBlend(blend);
  const weights = {} as Record<EraId, number>;
  for (const id of ERA_IDS) {
    weights[id] = 0;
  }

  if (from === to) {
    weights[from] = 1;
    return deepFreeze(weights);
  }

  weights[from] = 1 - progress;
  weights[to] = progress;
  return deepFreeze(weights);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Recursively freezes a value so the dataset cannot be mutated at runtime.
 *
 * The types are already `readonly`; this guard makes that promise hold for
 * plain JavaScript consumers and for tests that try to dirty the data.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Builds the id → era lookup table from the ordered dataset. */
function indexById(eras: readonly EraConfig[]): Record<EraId, EraConfig> {
  const byId = {} as Record<EraId, EraConfig>;
  for (const era of eras) {
    byId[era.id] = era;
  }
  return byId;
}
