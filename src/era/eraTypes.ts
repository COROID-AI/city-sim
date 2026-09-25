/**
 * Chrono City era contract.
 *
 * This file is the *single* import surface for era-aware code: every system,
 * UI panel and audio module reads the five-era descriptors through here, so the
 * era dataset (`ERAS`, `ERAS_BY_ID`) and its types can never drift apart.
 *
 * Deliberately free of scene, UI and audio imports: descriptors are pure
 * parameterized data (style ids, colours, counts, intensities) that procedural
 * generators consume, never baked geometry. The only external import is a
 * type-only three.js reference used to describe system handles; it is erased at
 * build time, so this module has no runtime dependency at all.
 */

import type { Group, Object3D } from "three";

/* -------------------------------------------------------------------------- */
/* Timeline identity                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The five eras the timeline slider exposes.
 *
 * The union is exhaustive by construction: adding an era means adding a member
 * here and a matching {@link EraConfig} entry to `ERAS` in `./eraData`.
 */
export type EraId = "1945" | "1965" | "1985" | "2005" | "2025";

/** Bus-level loudness profile of a soundscape, one gain per mixer bus. */
export interface SoundMixer {
  readonly ambience: number;
  readonly traffic: number;
  readonly music: number;
  readonly effects: number;
}

/** Population split used to seed pedestrian crowds. */
export interface AgeMix {
  readonly child: number;
  readonly adult: number;
  readonly senior: number;
}

/** Retail opening hours in 24h local time. */
export interface OpeningHours {
  readonly openHour: number;
  readonly closeHour: number;
}

/* -------------------------------------------------------------------------- */
/* Palette                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Per-era colour grade, as 24-bit `0xRRGGBB` integers.
 *
 * Generators use these for vertex colours, material tints and window emissives;
 * the post-processing grade and the HUD theme read the same values so the UI
 * always matches the block.
 */
export interface EraPalette {
  readonly sky: number;
  readonly skyHorizon: number;
  readonly fog: number;
  readonly sunlight: number;
  readonly ambient: number;
  readonly ground: number;
  readonly asphalt: number;
  readonly sidewalk: number;
  readonly facadePrimary: number;
  readonly facadeSecondary: number;
  readonly accent: number;
  readonly windowGlow: number;
  readonly uiAccent: number;
}

/* -------------------------------------------------------------------------- */
/* Buildings (architecture)                                                   */
/* -------------------------------------------------------------------------- */

/** Architecture language applied to the block's building massing. */
export type ArchitectureStyle =
  | "postwar-brick-masonry"
  | "art-deco-limestone"
  | "midcentury-curtain-wall"
  | "precast-concrete-slab"
  | "mirror-glass-tower"
  | "postmodern-trim-stone"
  | "blue-glass-office"
  | "brick-loft-revival"
  | "mass-timber-hybrid"
  | "adaptive-reuse-brick";

/** Roof treatment generated on top of each building mass. */
export type RoofStyle =
  | "flat-parapet"
  | "flat-mechanical"
  | "stepped-crown"
  | "flat-green-roof"
  | "solar-canopy";

/** Which part of the facade a material recipe targets. */
export type FacadeRole = "primary" | "secondary" | "trim" | "glazing";

/** Procedural material recipe; `id` doubles as the texture-key namespace. */
export interface MaterialSpec {
  readonly id: string;
  readonly role: FacadeRole;
  readonly color: number;
  /** 0..1 surface roughness consumed by the PBR material factory. */
  readonly roughness: number;
  /** 0..1 metalness consumed by the PBR material factory. */
  readonly metalness: number;
}

/** Window grid parameters for one era's facade generator. */
export interface WindowSpec {
  readonly columns: number;
  readonly rows: number;
  /** True when panes sit behind the facade plane (deep reveals). */
  readonly recessed: boolean;
  /** 0..1 emissive strength for after-dark window glow. */
  readonly glow: number;
}

/** Architecture descriptor: massing, facade and rooftop parameters. */
export interface BuildingDescriptor {
  readonly style: ArchitectureStyle;
  /** Secondary language used for corner lots and infill. */
  readonly secondaryStyle: ArchitectureStyle;
  readonly roofStyle: RoofStyle;
  readonly minFloors: number;
  readonly maxFloors: number;
  /** Storey height in metres. */
  readonly floorHeight: number;
  /** 0..1 share of the lot footprint the massing occupies. */
  readonly footprintFill: number;
  /** Number of stepped setbacks applied to taller masses. */
  readonly setbacks: number;
  /** Facade modules (bays) across a nominal 20 m frontage. */
  readonly facadeModules: number;
  readonly window: WindowSpec;
  /** 0..1 ornament density: cornices, banding, brackets. */
  readonly ornament: number;
  readonly rooftopDetails: readonly string[];
  readonly materials: readonly MaterialSpec[];
  /** 0..1 rate at which height tapers towards the block edge. */
  readonly heightFalloff: number;
}

/* -------------------------------------------------------------------------- */
/* Vehicles                                                                   */
/* -------------------------------------------------------------------------- */

/** Vehicle body classes the traffic generator can instance. */
export type VehicleClass =
  | "sedan"
  | "coupe"
  | "muscle-car"
  | "compact"
  | "hatchback"
  | "taxi"
  | "suv"
  | "van"
  | "delivery-van"
  | "truck"
  | "bus"
  | "streetcar"
  | "ev-hatchback"
  | "cargo-bike"
  | "motorcycle"
  | "bicycle";

/** Lamp technology; drives emissive colour, size and bloom weight. */
export type LightStyle =
  | "sealed-beam"
  | "single-red-lens"
  | "quad-halogen"
  | "triple-segment"
  | "halogen-quad"
  | "amber-wrap"
  | "hid-xenon-projector"
  | "led-bar"
  | "adaptive-pixel-led"
  | "animated-led-signature";

/** Wheel/tyre treatment; drives rim geometry and sidewall shading. */
export type WheelStyle =
  | "steel-bias-ply"
  | "whitewall-steel"
  | "alloy-radial"
  | "chrome-alloy"
  | "aero-carbon";

/** One vehicle class inside an era's traffic mix. */
export interface VehicleShare {
  readonly kind: VehicleClass;
  /** 0..1 share of the spawning pool; all shares in `mix` sum to 1. */
  readonly share: number;
  /** Typical cruise speed in metres per second. */
  readonly speed: number;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly bodyColor: number;
  readonly roofColor: number;
  /** Engine/propulsion recipe id consumed by the audio and FX layers. */
  readonly engineSound: string;
  /** 0..1 mechanical noise emitted at cruise. */
  readonly noise: number;
}

/** Traffic descriptor: composition, density and lighting technology. */
export interface VehicleDescriptor {
  readonly mix: readonly VehicleShare[];
  /** Active vehicles per 100 m of drivable street. */
  readonly density: number;
  readonly laneCount: number;
  /** Lane width in metres. */
  readonly laneWidth: number;
  /** Posted speed limit in metres per second. */
  readonly speedLimit: number;
  readonly wheels: WheelStyle;
  readonly headlight: LightStyle;
  readonly taillight: LightStyle;
  /** 0..1 chrome trim coverage on the body. */
  readonly chromeLevel: number;
  /** 0..1 share of the pool parked at the kerb rather than moving. */
  readonly parkingShare: number;
  readonly hornStyle: string;
  /** 0..1 noise floor of queued, stationary traffic. */
  readonly idlingNoise: number;
}

/* -------------------------------------------------------------------------- */
/* Storefronts (retail mix)                                                   */
/* -------------------------------------------------------------------------- */

/** Shop programme ids the ground-floor retail generator can lay out. */
export type StorefrontKind =
  | "grocer"
  | "butcher"
  | "pharmacy"
  | "hardware"
  | "diner"
  | "barber"
  | "tailor"
  | "laundromat"
  | "newsstand"
  | "department-store"
  | "record-shop"
  | "appliance-store"
  | "auto-showroom"
  | "bowling-alley"
  | "video-rental"
  | "arcade"
  | "electronics"
  | "pizza"
  | "photo-lab"
  | "sporting-goods"
  | "card-shop"
  | "coffee-bar"
  | "mobile-phone"
  | "internet-cafe"
  | "dvd-rental"
  | "convenience"
  | "fitness-studio"
  | "hair-salon"
  | "sandwich-bar"
  | "specialty-coffee"
  | "plant-shop"
  | "coworking"
  | "phone-repair"
  | "micro-bakery"
  | "bike-shop"
  | "thrift-resale"
  | "zero-waste-grocer"
  | "clinic";

/** Shopfront signage technique applied to each retail unit. */
export type SignStyle =
  | "painted-wall-lettering"
  | "hanging-shingle"
  | "neon-script"
  | "marquee-blade"
  | "backlit-panel"
  | "googie-arrow"
  | "channel-letter"
  | "pole-sign"
  | "vacuum-formed-backlit"
  | "neon-tube-outline"
  | "chrome-channel-letter"
  | "roof-mounted-pylon"
  | "internally-illuminated-box"
  | "banner-flag"
  | "window-vinyl"
  | "e-ink-panel"
  | "hand-painted-mural-wordmark"
  | "projected-light-scrim"
  | "led-strip-edge";

/** Commercial feel of the era, from cash-only to subscription retail. */
export type PriceTier =
  | "cash-only"
  | "fixed-price"
  | "discount-mall"
  | "chain-standardised"
  | "subscription-first";

/** Retail descriptor: mix, signage and opening behaviour. */
export interface StorefrontDescriptor {
  /** Ordered shop programmes; earlier entries get the best frontages. */
  readonly kinds: readonly StorefrontKind[];
  /** 0..1 share of available units that are trading (rest sit boarded). */
  readonly occupancy: number;
  readonly signStyles: readonly SignStyle[];
  readonly awning: boolean;
  readonly awningColors: readonly number[];
  /** 0..1 share of the frontage given to glazing. */
  readonly glassArea: number;
  readonly hours: OpeningHours;
  readonly priceTier: PriceTier;
  /** 0..1 emissive strength of the shop interior after dark. */
  readonly interiorGlow: number;
  /** Pedestrians queued per storefront at peak. */
  readonly queueDensity: number;
  readonly deliveryPattern: string;
}

/* -------------------------------------------------------------------------- */
/* Advertising                                                                */
/* -------------------------------------------------------------------------- */

/** Advertising media types the ad-placement system can build. */
export type AdMedium =
  | "painted-wall-bulletin"
  | "marquee-blade"
  | "war-bond-poster"
  | "transit-card"
  | "billboard-14x48"
  | "neon-sign"
  | "billboard-panel"
  | "backlit-plexiglass"
  | "bus-shelter-poster"
  | "street-furniture-lcd"
  | "bus-wrap"
  | "digital-kiosk"
  | "programmatic-led-screen"
  | "augmented-reality-overlay"
  | "carbon-negative-sponsorship-panel";

/** Advertising descriptor: media, density and visual intensity. */
export interface AdvertisingDescriptor {
  readonly media: readonly AdMedium[];
  /** Ad placements per 100 m of frontage. */
  readonly density: number;
  /** 0..1 share of placements that animate. */
  readonly animatedShare: number;
  /** 0..1 emissive brightness of signage. */
  readonly brightness: number;
  /** 0..1 colour saturation pushed into the ad textures. */
  readonly saturation: number;
  readonly typography: string;
  readonly copyThemes: readonly string[];
  /** Relative billboard panel size against the era-1 baseline of 1. */
  readonly billboardScale: number;
  /** Seconds between creative rotations (86400 = a static daily poster). */
  readonly messageRotationSeconds: number;
  readonly sponsorModel: string;
}

/* -------------------------------------------------------------------------- */
/* Pedestrians (outfits and crowd rules)                                      */
/* -------------------------------------------------------------------------- */

/** Body silhouette applied to each generated pedestrian. */
export type SilhouetteId =
  | "long-overcoat"
  | "a-line-knee"
  | "tunic-trousers"
  | "knickerbocker"
  | "shift-mini"
  | "slim-lapel-suit"
  | "sleeveless-a-line"
  | "dungaree"
  | "boxy-denim"
  | "oversized-shoulder-pad"
  | "leotard-legwarmers"
  | "belted-trench"
  | "low-rise-bootcut"
  | "baggy-athletic"
  | "untucked-shirt-trouser"
  | "cargo-utility"
  | "oversized-techwear"
  | "compression-knit"
  | "relaxed-single-breasted"
  | "repair-panelled-shell";

/** One outfit rule: who wears what, and with which accessories. */
export interface OutfitRule {
  readonly id: string;
  /** 0..1 share of the crowd wearing this rule; all rules sum to 1. */
  readonly share: number;
  /** Garment colours sampled per pedestrian. */
  readonly palette: readonly number[];
  readonly silhouette: SilhouetteId;
  readonly accessories: readonly string[];
  /** 0..1 body coverage: how much skin the outfit hides. */
  readonly coverage: number;
}

/** Pedestrian descriptor: wardrobe, density and street behaviour. */
export interface PedestrianDescriptor {
  readonly outfits: readonly OutfitRule[];
  /** Pedestrians per 100 m of sidewalk. */
  readonly density: number;
  /** Base walking speed in metres per second. */
  readonly walkSpeed: number;
  /** Animation stride multiplier against the rig baseline. */
  readonly strideScale: number;
  /** 0..1 share of pedestrians walking in groups. */
  readonly crowdRatio: number;
  readonly ageMix: AgeMix;
  /** 0..1 share holding a personal device. */
  readonly gadgetUse: number;
  /** 0..1 ambient chatter level for the voice layer. */
  readonly chatterLevel: number;
  readonly seasonalWear: string;
}

/* -------------------------------------------------------------------------- */
/* Environment (lighting, sky, street treatment)                              */
/* -------------------------------------------------------------------------- */

/** Sky/atmosphere model driving the lighting rig and gradient shader. */
export type SkyModel =
  | "sooted-overcast"
  | "clear-midcentury-noon"
  | "smoggy-dusk"
  | "cool-overcast-daylight"
  | "clean-high-key-daylight";

/** Pavement surface treatment of the carriageway. */
export type StreetSurface =
  | "cobblestone-patched"
  | "asphalt-seamed"
  | "asphalt-cracked"
  | "asphalt-resurfaced"
  | "permeable-asphalt";

/** Environment descriptor: lighting, atmosphere and street furniture. */
export interface EnvironmentDescriptor {
  readonly skyModel: SkyModel;
  /** Sun elevation above the horizon, in degrees. */
  readonly sunElevation: number;
  /** Sun azimuth, in degrees clockwise from north. */
  readonly sunAzimuth: number;
  /** Ambient illuminance in lux, used to scale the lighting rig. */
  readonly lux: number;
  /** Exponential-squared fog density. */
  readonly fogDensity: number;
  readonly fogColor: number;
  readonly streetSurface: StreetSurface;
  readonly laneMarkings: readonly string[];
  readonly sidewalkMaterial: string;
  readonly streetFurniture: readonly string[];
  readonly treeStyle: string;
  /** Trees per 100 m of sidewalk frontage. */
  readonly treeDensity: number;
  readonly utilityLines: boolean;
  readonly streetLightStyle: string;
  readonly weather: string;
  /** 0..1 air-quality index, 1 being pristine. */
  readonly airQuality: number;
}

/* -------------------------------------------------------------------------- */
/* Sound                                                                      */
/* -------------------------------------------------------------------------- */

/** Mixer bus a soundscape layer routes into. */
export type SoundLayerKind = "ambience" | "traffic" | "music" | "voice" | "mechanical" | "nature";

/** One procedural audio layer of an era's soundscape. */
export interface SoundLayer {
  readonly id: string;
  readonly kind: SoundLayerKind;
  /** 0..1 gain; all layer gains in a soundscape sum to 1. */
  readonly gain: number;
  readonly character: string;
}

/** Sound descriptor: layers, mix and musical identity. */
export interface SoundDescriptor {
  readonly soundscape: string;
  readonly ambience: string;
  readonly layers: readonly SoundLayer[];
  readonly mixer: SoundMixer;
  readonly musicStyle: string;
  /** Beats per minute of the era's music bed. */
  readonly musicTempo: number;
  /** Reverb time in seconds applied to the street bus. */
  readonly reverbSeconds: number;
  /** 0..1 traffic bus level before the mixer stage. */
  readonly trafficGain: number;
  readonly signatureCues: readonly string[];
  readonly listenerProfile: string;
}

/* -------------------------------------------------------------------------- */
/* Transition                                                                 */
/* -------------------------------------------------------------------------- */

/** Interpolation curve used while morphing between eras. */
export type TransitionEasing = "linear" | "ease-in-out" | "ease-out" | "spring";

/** Transition descriptor: how the block morphs *into* this era. */
export interface TransitionDescriptor {
  readonly durationMs: number;
  readonly easing: TransitionEasing;
  /** 0..1 share of the morph driven by crossfading instead of moving geometry. */
  readonly crossfade: number;
  readonly colorLerp: boolean;
  readonly morphStyle: string;
  readonly particleEffect: string;
  /** Camera dolly multiplier applied during the morph. */
  readonly cameraDolly: number;
  readonly stingerSound: string;
  /** Simulation seconds between morph steps for procedural systems. */
  readonly stepSeconds: number;
}

/* -------------------------------------------------------------------------- */
/* Era configuration                                                          */
/* -------------------------------------------------------------------------- */

/** The nine descriptor domains every era must define in full. */
export interface EraDomains {
  readonly palette: EraPalette;
  readonly buildings: BuildingDescriptor;
  readonly vehicles: VehicleDescriptor;
  readonly storefronts: StorefrontDescriptor;
  readonly advertising: AdvertisingDescriptor;
  readonly pedestrians: PedestrianDescriptor;
  readonly environment: EnvironmentDescriptor;
  readonly sound: SoundDescriptor;
  readonly transition: TransitionDescriptor;
}

/** Keys of {@link EraDomains}, in the canonical reporting order. */
export type EraDomainKey = keyof EraDomains;

/** Canonical domain order, so tests and UI panels iterate identically. */
export const ERA_DOMAIN_KEYS = [
  "palette",
  "buildings",
  "vehicles",
  "storefronts",
  "advertising",
  "pedestrians",
  "environment",
  "sound",
  "transition",
] as const satisfies readonly EraDomainKey[];

/**
 * Complete description of one timeline stop.
 *
 * `label` is what the timeline slider renders; `title` and `tagline` give the
 * HUD a human-readable caption without duplicating era knowledge in the UI.
 */
export interface EraConfig extends EraDomains {
  readonly id: EraId;
  /** Zero-based position on the timeline; mirrors `ERAS` order. */
  readonly index: number;
  readonly year: number;
  /** Short timeline label, e.g. `"1945"`. */
  readonly label: string;
  /** Display name of the period, e.g. `"Postwar Reconstruction"`. */
  readonly title: string;
  readonly tagline: string;
}

/* -------------------------------------------------------------------------- */
/* System contracts                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Per-frame context handed to every {@link SceneSystem}.
 *
 * `blend` is the transition progress in `[0, 1]` from `from` towards `era`;
 * `weights` is the same information spread over all five eras, which is what
 * morphing generators consume.
 */
export interface EraUpdateContext {
  readonly era: EraId;
  readonly from: EraId;
  readonly blend: number;
  readonly weights: Readonly<Record<EraId, number>>;
  /** Fixed-step delta in seconds. */
  readonly delta: number;
  /** Simulated seconds since the system was mounted. */
  readonly elapsed: number;
}

/**
 * Anything that can be re-parameterized for the active timeline stop.
 *
 * `blend` is 0 for "fully the previous era", 1 for "fully `era`". Implementors
 * must treat out-of-range input as clamped and must be idempotent for the same
 * `(era, blend)` pair.
 */
export interface EraAware {
  applyEra(era: EraId, blend: number): void;
}

/**
 * A composable unit of the city block.
 *
 * Scene assembly owns the lifecycle: it mounts `group` into the block, pumps
 * {@link update} from the shared fixed-step loop, raycasts {@link getPickables}
 * for click-to-inspect, and calls `dispose` on teardown.
 */
export interface SceneSystem {
  /** Optional stable id, used for pick attribution and debug overlays. */
  readonly id?: string;
  /** Root of every object the system owns; parented into the block on mount. */
  readonly group: Group;
  /** Per-frame update, driven by the shared fixed-step loop. */
  update(context: EraUpdateContext): void;
  /** Objects the picking layer may select, in priority order. */
  getPickables(): readonly Object3D[];
  /** Optional teardown for GPU resources and listeners. */
  dispose?(): void;
}

/** A scene system that also honours the era blend. */
export interface EraSceneSystem extends SceneSystem, EraAware {}

/* -------------------------------------------------------------------------- */
/* Dataset re-export                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The era dataset, re-exported so this file alone is the consumer surface.
 *
 * `./eraData` stays read-only for consumers: everything below is the frozen,
 * deterministic dataset plus the small pure helpers that operate on it.
 */
export {
  ERA_IDS,
  ERAS,
  ERAS_BY_ID,
  clampBlend,
  eraIndex,
  getEraConfig,
  resolveEraWeights,
} from "./eraData";
