/**
 * Chrono City - era content contracts.
 *
 * Everything that changes between 1945, 1965, 1985, 2005 and 2025 is described
 * declaratively by an {@link EraDefinition}. The world generators, the
 * transition controller, the HUD and the audio engine all consume the same
 * object, which keeps the five eras consistent and makes the whole content
 * model unit-testable without a browser.
 */

import type * as THREE from 'three';

/** The five selectable years, in timeline order. */
export type Year = 1945 | 1965 | 1985 | 2005 | 2025;

/** Ordered list of every selectable year (source of truth for the slider). */
export const YEARS: readonly Year[] = [1945, 1965, 1985, 2005, 2025] as const;

/** Hex colour string, e.g. `#ff8800`. */
export type Hex = string;

export function isYear(value: unknown): value is Year {
  return typeof value === 'number' && (YEARS as readonly number[]).includes(value);
}

/* ------------------------------------------------------------------ sky ---- */

/** Era sky dome, fog and light-rig description. */
export interface SkyPalette {
  /** Zenith colour of the sky gradient. */
  skyTop: Hex;
  /** Horizon colour of the sky gradient. */
  skyBottom: Hex;
  /** Exponential fog colour. */
  fog: Hex;
  /** Exponential fog density (kept small; the city is ~200 units across). */
  fogDensity: number;
  /** Key light colour. */
  sun: Hex;
  /** Directional light position (relative to the block centre). */
  sunPosition: [number, number, number];
  /** Key light intensity. */
  sunIntensity: number;
  /** Ambient light colour. */
  ambient: Hex;
  ambientIntensity: number;
  /** Hemisphere light colours. */
  hemiSky: Hex;
  hemiGround: Hex;
  hemiIntensity: number;
  /** Extra horizon glow colour used for the sunset bloom band. */
  horizon: Hex;
  /** 0 = overcast, 1 = hard shadows with a crisp sun disc. */
  clarity: number;
}

/* ---------------------------------------------------------------- grade ---- */

/** Post-processing grade: colour lift, saturation, film grain, bloom, vignette. */
export interface GradeSpec {
  /** Additive black lift, 0..0.12. */
  lift: number;
  /** Saturation multiplier, 0..2. */
  saturation: number;
  /** Display gamma, 0.8..1.3. */
  gamma: number;
  /** -1 cold, 0 neutral, +1 warm. */
  temperature: number;
  /** Film grain amount, 0..1 (1945 is the grainiest). */
  grain: number;
  /** Vignette strength, 0..1. */
  vignette: number;
  /** Bloom strength for emissive signage, 0..2. */
  bloom: number;
}

/* ----------------------------------------------------------- buildings ---- */

export type FacadeStyle =
  | 'art-deco'
  | 'brick'
  | 'brownstone'
  | 'stucco'
  | 'mid-century'
  | 'concrete'
  | 'glass-steel'
  | 'glass-tower';

export type WindowStyle = 'sash' | 'awning' | 'ribbon' | 'punched' | 'curtain-wall';

/** Silhouette and facade-detail parameters for the building generator. */
export interface ArchitectureSpec {
  /** Facade styles sampled across the block. */
  styles: FacadeStyle[];
  /** Facade base colours sampled across the block. */
  facadeColors: Hex[];
  /** Storey count range (a storey is {@link STOREY_HEIGHT} metres). */
  minFloors: number;
  maxFloors: number;
  windowStyle: WindowStyle;
  /** Stepped art-deco / modern setback massing on tall buildings. */
  setbacks: boolean;
  /** Rooftop water towers (1945/1965). */
  waterTowers: boolean;
  /** Cast-iron fire escapes down the facade (1945/1965). */
  fireEscapes: boolean;
  /** Rooftop air-conditioning condensers. */
  roofAc: boolean;
  /** Rooftop antenna masts. */
  antennas: boolean;
  /** Rooftop satellite dishes (1985+). */
  satelliteDishes: boolean;
  /** Rooftop billboard frames. */
  roofBillboards: boolean;
  /** Share of the facade that is glazed, 0..1. */
  glassRatio: number;
}

/** Height of a single storey in world units (metres). */
export const STOREY_HEIGHT = 3.4;

/* ------------------------------------------------------------ vehicles ---- */

export type VehicleType =
  | 'sedan'
  | 'taxi'
  | 'truck'
  | 'streetcar'
  | 'bus'
  | 'bicycle'
  | 'muscle-car'
  | 'station-wagon'
  | 'compact'
  | 'van'
  | 'hatchback'
  | 'suv'
  | 'ev'
  | 'rideshare'
  | 'cargo-bike'
  | 'scooter';

/** One era vehicle archetype; the generator spawns {@link count} of them. */
export interface VehicleSpec {
  id: string;
  kind: VehicleType;
  label: string;
  /** Instances placed in the era layer (parked + moving). */
  count: number;
  length: number;
  width: number;
  height: number;
  body: Hex;
  accent: Hex;
  /** 0..1 share of the instances that cruise the lane graph. */
  movingRatio: number;
  /** Engine tone base frequency in Hz, used by the pass-by synthesis. */
  engineHz: number;
}

/* --------------------------------------------------------- storefronts ---- */

export type SignFormat =
  | 'painted'
  | 'neon'
  | 'ticker'
  | 'led'
  | 'poster'
  | 'billboard'
  | 'media-facade';

export interface StorefrontSpec {
  id: string;
  name: string;
  category: string;
  /** Awning / fascia colour. */
  awning: Hex;
  /** Copy painted into the shop window / on the fascia. */
  display: string;
  signFormat: SignFormat;
  signColor: Hex;
  /** Window glass tint. */
  glassTint: Hex;
}

/* ------------------------------------------------------ advertisements ---- */

export interface AdSpec {
  id: string;
  copy: string;
  format: SignFormat;
  colors: Hex[];
  placement: 'wall' | 'rooftop' | 'facade' | 'storefront' | 'freestanding';
  /** Emissive ads feed the bloom pass (neon / ticker / LED). */
  emissive: boolean;
  /** Scrolling copy (tickers / media facades). */
  scrolling: boolean;
}

/* ------------------------------------------------------------- outfits ---- */

export type OutfitAccessory =
  | 'fedora'
  | 'pillbox-hat'
  | 'hat'
  | 'day-dress'
  | 'suit'
  | 'overcoat'
  | 'bell-bottoms'
  | 'shoulder-pads'
  | 'denim-jacket'
  | 'hoodie'
  | 'phone'
  | 'backpack'
  | 'sunglasses'
  | 'headband'
  | 'helmet'
  | 'scarf'
  | 'none';

export type OutfitSilhouette =
  | 'long-coat'
  | 'fitted-dress'
  | 'wide-lapel-suit'
  | 'bell-bottom'
  | 'athletic'
  | 'techwear';

/** One pedestrian outfit: body colours, headwear and a period accessory. */
export interface OutfitSpec {
  id: string;
  label: string;
  /** [ torso, legs, accent ] - the swatch triple asserted unique per era. */
  colors: [Hex, Hex, Hex];
  skin: Hex;
  accessory: OutfitAccessory;
  accessoryColor: Hex;
  /** Where the coat/dress hem sits, 0..1 of the body height. */
  hem: number;
  silhouette: OutfitSilhouette;
}

/* --------------------------------------------------------------- props ---- */

export type LampStyle =
  | 'incandescent-globe'
  | 'swan-neck'
  | 'sodium-cobra'
  | 'led-slim'
  | 'led-organic';

export type TransitMode = 'streetcar' | 'trolleybus' | 'bus' | 'electric-bus';

/** Street-furniture and roadway furniture flags. */
export interface PropsSpec {
  lampStyle: LampStyle;
  lampColor: Hex;
  transit: TransitMode;
  /** Wooden telephone poles with drooping wires. */
  telephonePoles: boolean;
  /** Embedded tram rails in the roadway. */
  tramRails: boolean;
  /** Painted protected bike lane. */
  bikeLane: boolean;
  newsstands: boolean;
  newspaperBoxes: boolean;
  busStopShelter: boolean;
  hydrantColor: Hex;
  benches: number;
  planters: number;
}

/* --------------------------------------------------------------- audio ---- */

export type AmbienceKind =
  | 'noise'
  | 'tone'
  | 'bell'
  | 'murmur'
  | 'birds'
  | 'buzz'
  | 'siren'
  | 'hum';

/** One synthesised ambience layer of an era soundscape. */
export interface AmbienceLayer {
  id: string;
  kind: AmbienceKind;
  label: string;
  /** Linear gain, 0..1. */
  gain: number;
  /** Filter corner frequency in Hz. */
  filterHz: number;
  /** Resonance of the layer filter. */
  q?: number;
}

export type MusicMotif = 'jazz' | 'surf' | 'synth' | 'downtempo' | 'lofi';

export interface MusicSpec {
  motif: MusicMotif;
  /** Beats per minute. */
  tempo: number;
  /** Root note frequency in Hz. */
  root: number;
  gain: number;
}

export type EngineProfile = 'trolley' | 'v8' | 'six-cylinder' | 'v6' | 'electric';

export interface AudioSpec {
  /** At least four ambience layers per era. */
  ambience: AmbienceLayer[];
  engineProfile: EngineProfile;
  /** Base frequency of the era engine tone, in Hz. */
  engineBaseHz: number;
  music: MusicSpec;
  /** Character tag for the era-change whoosh. */
  transition: string;
  /** Streetcar / trolley bell layer is exclusive to the early eras. */
  streetcarBell: boolean;
}

/* --------------------------------------------------------- era wrapper ---- */

export interface EraDefinition {
  year: Year;
  /** Short era name shown in the HUD. */
  title: string;
  tagline: string;
  /** Period facts surfaced by the help overlay. */
  facts: string[];
  palette: SkyPalette;
  grade: GradeSpec;
  architecture: ArchitectureSpec;
  vehicles: VehicleSpec[];
  storefronts: StorefrontSpec[];
  advertisements: AdSpec[];
  outfits: OutfitSpec[];
  props: PropsSpec;
  audio: AudioSpec;
  /** Copy towed by the banner plane. */
  bannerText: string;
  /** Number of circling birds. */
  birds: number;
  /** Cruise speed multiplier for traffic (1945 is slow, 2025 is quick). */
  trafficSpeed: number;
  /** Crowd walk speed multiplier. */
  crowdPace: number;
}

/* ---------------------------------------------------------- scene graph ---- */

/** Category buckets of an era layer; each one is swapped independently. */
export type SceneCategory =
  | 'roads'
  | 'buildings'
  | 'vehicles'
  | 'storefronts'
  | 'advertisements'
  | 'pedestrians'
  | 'props'
  | 'sky';

/** The order the transition controller stages category swaps in. */
export const CATEGORY_ORDER: readonly SceneCategory[] = [
  'vehicles',
  'storefronts',
  'advertisements',
  'buildings',
  'pedestrians',
  'props',
  'roads',
  'sky',
] as const;

export type SceneCategories = Record<SceneCategory, THREE.Group>;

/** Counts asserted by the integration tests. */
export interface EraCounts {
  buildings: number;
  vehicles: number;
  movingVehicles: number;
  pedestrians: number;
  storefronts: number;
  advertisements: number;
  propCategories: number;
  props: number;
}

/** A fully generated era: one three.js group tree plus simulation hooks. */
export interface EraLayer {
  year: Year;
  definition: EraDefinition;
  group: THREE.Group;
  categories: SceneCategories;
  counts: EraCounts;
  /** Emissive meshes that feed the bloom pass. */
  emissives: THREE.Mesh[];
  /** Period-specific element tags, e.g. `tram-rails`, `ev`, `led-media-facade`. */
  periodElements: string[];
  /** Audio descriptor ids of the era soundscape. */
  ambienceTags: string[];
  /** Per-frame simulation (traffic, crowds, ambience animation). */
  update(dt: number): void;
  dispose(): void;
}
