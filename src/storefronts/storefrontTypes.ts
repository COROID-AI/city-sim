/**
 * Storefronts & advertisements — shared types.
 *
 * These types describe every era-variant visual decision for the storefront
 * and advertisement layer. They are keyed off the foundation era registry
 * (`EraId`) and are intentionally self-contained so the module can be dropped
 * into any R3F canvas without depending on other modules.
 */

/** Signage rendering style per era. */
export type SignStyle =
  | 'handPainted' // 1945: painted lettering on plaster / wood
  | 'midCentury' // 1965: bold enamel signs with drop shadows
  | 'backlit' // 1985: glowing plastic light-box signs
  | 'lightBox' // 2005: digital-print light boxes
  | 'digital'; // 2025: dynamic LED / digital screens

/** Advertisement poster style per era. */
export type AdStyle =
  | 'sepia' // 1945: sepia-toned period posters
  | 'popArt' // 1965: Pop-art posters with halftone
  | 'eighties' // 1985: bold 80s gradients + neon accents
  | 'corporate' // 2005: clean corporate print ads
  | 'digitalLoop'; // 2025: animated digital ad loops

/** Awning treatment per era. */
export type AwningStyle = 'striped' | 'solid' | 'none';

/** All era-variant visual decisions for the storefronts + ads layer. */
export interface EraStorefrontConfig {
  /** Facade wall colors (one is picked per storefront). */
  facadePalette: string[];
  /** Glass window tint. */
  windowTint: string;
  /** Signage rendering style. */
  signStyle: SignStyle;
  /** Sign lettering colors (one picked per storefront). */
  signColors: string[];
  /** Advertisement poster style. */
  adStyle: AdStyle;
  /** Awning treatment. */
  awning: AwningStyle;
  /** Awning stripe colors. */
  awningColors: string[];
  /** Whether the era uses neon accents (1945 subtle, 1965+, 1985 more). */
  neon: boolean;
  /** Neon tube colors. */
  neonColors: string[];
  /** Base emissive intensity for signage when lit (night). */
  emissiveIntensity: number;
  /** Facade enamel gloss (1965 high). */
  metalness: number;
  /** Trim / door frame color. */
  trimColor: string;
  /** Font stack used for signage lettering. */
  signFontFamily: string;
  /** Font weight for signage lettering. */
  signFontWeight: string;
  /** Storefront business names to sample from. */
  storeNames: string[];
  /** Secondary sign lines to sample from (one picked per storefront). */
  subtexts: string[];
}

/** A single positioned storefront unit. */
export interface StorefrontSpec {
  id: number;
  /** World position of the unit center (x, z). */
  x: number;
  z: number;
  /** Y rotation so the facade faces the road. */
  rotationY: number;
  /** Facade width (world units). */
  width: number;
  /** Facade height (world units). */
  height: number;
  /** Business name shown on the sign. */
  name: string;
  /** Secondary sign line (or empty). */
  subtext: string;
  /** Facade color. */
  facadeColor: string;
  /** Sign lettering color. */
  signColor: string;
  /** Neon accent color (when the era uses neon). */
  neonColor: string;
  /** Awning stripe colors. */
  awningColors: [string, string];
  /** Poster variant index (drives poster art). */
  posterVariant: number;
  /** Deterministic grain seed for painted textures. */
  seed: number;
}

/** A standalone advertisement billboard. */
export interface BillboardSpec {
  id: number;
  x: number;
  z: number;
  rotationY: number;
  /** Facade color (used as poster background base). */
  facadeColor: string;
  /** Poster lettering color. */
  signColor: string;
  /** Poster accent color. */
  neonColor: string;
  /** Headline text on the poster. */
  name: string;
  /** Tagline text on the poster. */
  subtext: string;
  posterVariant: number;
  seed: number;
}

/** Minimal data any poster draw needs (satisfied by storefronts + billboards). */
export interface PosterSource {
  name: string;
  subtext: string;
  signColor: string;
  neonColor: string;
  facadeColor: string;
  posterVariant: number;
  seed: number;
}