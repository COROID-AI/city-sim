/**
 * Chrono City — era-agnostic PBR material factory.
 *
 * Every visible surface in the block is built here: content tasks describe a
 * surface (`brick`, `corrugatedMetal`, `neon`, …) plus the palette, roughness,
 * metalness, emissive and wear values that make it read as their era, and get
 * back a three.js `MeshStandardMaterial` bound to a procedurally generated
 * `CanvasTexture`. No binary assets, no network fetches, no per-era code paths.
 *
 * Guarantees
 * ----------
 *  - **Clamped inputs.** Roughness/metalness/opacity/wear land in `[0, 1]`,
 *    emissive intensity in `[0, 4]`, resolution in `[256, 1024]`, repeat in
 *    `[0.01, 64]` — a bad content value degrades instead of exploding.
 *  - **Cached by parameter key.** `textureKey()` / `materialKey()` ignore field
 *    order, so two props that describe the same surface share one GPU texture
 *    and one material instance.
 *  - **Seeded determinism.** Wear/noise is derived from the shared
 *    `SceneContext` RNG seed (forked per texture key, see
 *    `createSurfaceRandom`), so the same key always produces the same wear.
 *
 * Lifecycle:
 *   create    → `createMaterialLibrary()` / `new MaterialLibrary()`; pass the
 *               scene context (`createMaterialLibraryFromScene(context)`) so the
 *               library inherits its deterministic seed.
 *   consume   → `library.get(request)` for a ready PBR material,
 *               `library.getTexture(options)` for the raw canvas texture.
 *   integrate → assign materials to meshes; `library.dispose()` (or the whole
 *               scene teardown) releases every generated GPU texture.
 */

import * as THREE from 'three';

import { clamp01 } from '../core/eraContracts';
import { createSeededRng, type RandomSource, type SceneContext } from '../core/sceneContext';
import {
  DEFAULT_SURFACE_WEAR,
  SURFACE_KINDS,
  createSurfaceRandom,
  generateSurfaceTexture,
  isSurfaceKind,
  normalizeSurfaceColor,
  resolveTextureOptions,
  textureKey,
  type GeneratedTexture,
  type ResolvedTextureOptions,
  type SurfaceKind,
  type TextureOptions,
  type TexturePalette,
} from './textureGenerators';

export const MATERIAL_LIBRARY_VERSION = 1;

/** Highest emissive intensity a material will accept. */
export const MAX_EMISSIVE_INTENSITY = 4;
/** Lowest emissive intensity (fully unlit emissive). */
export const MIN_EMISSIVE_INTENSITY = 0;

/**
 * Per-surface material defaults, used for any value a request leaves out.
 * These are craft defaults (how brick or glass usually reads), not era content:
 * the palette and the caller's wear/roughness decide what a given year looks
 * like.
 */
export interface SurfaceMaterialDefaults {
  readonly roughness: number;
  readonly metalness: number;
  readonly emissiveIntensity: number;
  readonly repeat: readonly [number, number];
}

export const SURFACE_MATERIAL_DEFAULTS: Readonly<Record<SurfaceKind, SurfaceMaterialDefaults>> = {
  brick: { roughness: 0.95, metalness: 0, emissiveIntensity: 0, repeat: [2, 2] },
  stone: { roughness: 0.92, metalness: 0, emissiveIntensity: 0, repeat: [1.5, 1.5] },
  stucco: { roughness: 0.9, metalness: 0, emissiveIntensity: 0, repeat: [2, 2] },
  corrugatedMetal: { roughness: 0.42, metalness: 0.85, emissiveIntensity: 0, repeat: [2, 1] },
  glassCurtainWall: { roughness: 0.08, metalness: 0.35, emissiveIntensity: 0, repeat: [2, 3] },
  neon: { roughness: 0.35, metalness: 0.1, emissiveIntensity: 1.8, repeat: [1, 1] },
  asphalt: { roughness: 0.97, metalness: 0, emissiveIntensity: 0, repeat: [6, 6] },
  cobble: { roughness: 0.93, metalness: 0, emissiveIntensity: 0, repeat: [3, 3] },
  paintedSign: { roughness: 0.7, metalness: 0.04, emissiveIntensity: 0.25, repeat: [1, 1] },
  fabric: { roughness: 0.96, metalness: 0, emissiveIntensity: 0, repeat: [4, 4] },
};

/**
 * Request for one PBR material.
 *
 * Everything except `surface` and `palette` is optional: omitted parameters fall
 * back to `SURFACE_MATERIAL_DEFAULTS` and then to neutral defaults.
 */
export interface MaterialRequest {
  /** Which procedural surface to build. */
  readonly surface: SurfaceKind;
  /** Colours for that surface; `base` and `accent` are required. */
  readonly palette: TexturePalette;
  /** `0` = mirror-smooth, `1` = fully diffuse. Clamped. Default per surface. */
  readonly roughness?: number;
  /** `0` = dielectric, `1` = pure metal. Clamped. Default per surface. */
  readonly metalness?: number;
  /**
   * Emissive input:
   *  - a number multiplies the surface's default emissive intensity (`2` on
   *    neon doubles its glow), and
   *  - a colour string overrides the emissive colour (defaults to the palette's
   *    `emissive`, which itself defaults to `accent`).
   */
  readonly emissive?: number | string;
  /** Absolute emissive intensity; overrides the surface default. Clamped to `[0, 4]`. */
  readonly emissiveIntensity?: number;
  /** Wear/ageing amount in `[0, 1]`. Clamped. Default `0.35`. */
  readonly wear?: number;
  /** Feature-density multiplier in `[0.25, 4]`. Clamped. Default `1`. */
  readonly scale?: number;
  /** Texture tiling scalar or `[u, v]` pair. Clamped to `[0.01, 64]`. Default per surface. */
  readonly repeat?: number | readonly [number, number];
  /** Canvas resolution in px. Clamped to `[256, 1024]`. Default `512`. */
  readonly size?: number;
  /** Surface opacity in `[0, 1]`. Clamped. Default `1`. */
  readonly opacity?: number;
  /** Forces the transparent render pass; defaults to `opacity < 1`. */
  readonly transparent?: boolean;
  /** Face side. Default `THREE.FrontSide`. */
  readonly side?: THREE.Side;
  /** Optional debug name; defaults to `chrono-<surface>`. */
  readonly name?: string;
}

/** A request with every value clamped, defaulted and keyed. */
export interface ResolvedMaterialRequest {
  readonly surface: SurfaceKind;
  readonly roughness: number;
  readonly metalness: number;
  readonly emissive: string;
  readonly emissiveIntensity: number;
  readonly opacity: number;
  readonly transparent: boolean;
  readonly side: THREE.Side;
  readonly name: string;
  /** Fully resolved texture parameters backing this material. */
  readonly textureOptions: ResolvedTextureOptions;
  /** Stable cache key covering both the texture key and the PBR parameters. */
  readonly key: string;
}

/* ------------------------------------------------------------------------- *
 * Clamping helpers
 * ------------------------------------------------------------------------- */

function clampUnit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return clamp01(value);
}

function clampRange(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------------- *
 * Resolution
 * ------------------------------------------------------------------------- */

/**
 * Clamps and defaults a material request. Idempotent: resolving an already
 * resolved request returns the same values and key.
 */
export function resolveMaterialRequest(request: MaterialRequest): ResolvedMaterialRequest {
  if (!isSurfaceKind(request.surface)) {
    throw new RangeError(
      `Unknown surface "${String(request.surface)}"; expected one of ${SURFACE_KINDS.join(', ')}.`,
    );
  }

  const defaults = SURFACE_MATERIAL_DEFAULTS[request.surface];
  const textureOptions = resolveTextureOptions({
    surface: request.surface,
    palette: request.palette,
    size: request.size,
    repeat: request.repeat ?? defaults.repeat,
    wear: request.wear,
    scale: request.scale,
  });

  const palette = textureOptions.palette;
  let emissive = palette.emissive;
  let emissiveIntensity = request.emissiveIntensity ?? defaults.emissiveIntensity;

  if (typeof request.emissive === 'string') {
    emissive = normalizeSurfaceColor(request.emissive, palette.emissive);
  } else if (typeof request.emissive === 'number') {
    const multiplier = Number.isFinite(request.emissive) ? Math.max(0, request.emissive) : 1;
    emissiveIntensity = (request.emissiveIntensity ?? defaults.emissiveIntensity) * multiplier;
  }
  emissiveIntensity = clampRange(
    emissiveIntensity,
    defaults.emissiveIntensity,
    MIN_EMISSIVE_INTENSITY,
    MAX_EMISSIVE_INTENSITY,
  );

  const opacity = clampUnit(request.opacity, 1);
  const resolved: Omit<ResolvedMaterialRequest, 'key'> = {
    surface: request.surface,
    roughness: clampUnit(request.roughness, defaults.roughness),
    metalness: clampUnit(request.metalness, defaults.metalness),
    emissive,
    emissiveIntensity,
    opacity,
    transparent: request.transparent ?? opacity < 1,
    side: request.side ?? THREE.FrontSide,
    name: request.name ?? `chrono-${request.surface}`,
    textureOptions,
  };

  return { ...resolved, key: materialKeyFromResolved(resolved) };
}

function materialKeyFromResolved(resolved: Omit<ResolvedMaterialRequest, 'key'>): string {
  return [
    resolved.textureOptions.key,
    `ro${round(resolved.roughness)}`,
    `me${round(resolved.metalness)}`,
    `em${resolved.emissive}:${round(resolved.emissiveIntensity)}`,
    `op${round(resolved.opacity)}`,
    `tr${resolved.transparent ? 1 : 0}`,
    `sd${resolved.side}`,
    resolved.name,
  ].join('|');
}

/** Stable cache key for a material request (field order does not matter). */
export function materialKey(request: MaterialRequest): string {
  return resolveMaterialRequest(request).key;
}

/* ------------------------------------------------------------------------- *
 * Material factory
 * ------------------------------------------------------------------------- */

/** Builds the PBR material for an already-validated request + texture. */
export function createPbrMaterial(
  resolved: ResolvedMaterialRequest,
  texture: THREE.Texture,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: resolved.name,
    // The palette lives in the generated map, so the base colour stays white.
    color: 0xffffff,
    map: texture,
    roughness: resolved.roughness,
    metalness: resolved.metalness,
    emissive: new THREE.Color(resolved.emissive),
    emissiveIntensity: resolved.emissiveIntensity,
    emissiveMap: resolved.emissiveIntensity > 0 ? texture : null,
    opacity: resolved.opacity,
    transparent: resolved.transparent,
    side: resolved.side,
  });
  material.userData.chronoKey = resolved.key;
  material.userData.chronoSurface = resolved.surface;
  material.userData.chronoTextureKey = resolved.textureOptions.key;
  return material;
}

/**
 * One-shot factory for a single material.
 *
 * Handy for tests and tooling; scene code should prefer a `MaterialLibrary` so
 * repeated props reuse the same texture and material instances.
 */
export function createMaterial(
  request: MaterialRequest,
  random?: RandomSource | number,
): THREE.MeshStandardMaterial {
  const resolved = resolveMaterialRequest(request);
  const generated = generateSurfaceTexture(
    resolved.textureOptions,
    typeof random === 'number' || random === undefined
      ? createSurfaceRandom(random, resolved.textureOptions.key)
      : random,
  );
  return createPbrMaterial(resolved, generated.texture);
}

/* ------------------------------------------------------------------------- *
 * Library
 * ------------------------------------------------------------------------- */

/**
 * Seed source for a library: the shared `SceneContext.random`, any
 * `RandomSource`, a numeric seed, or a context-shaped object exposing `random`.
 */
export type MaterialLibraryRandomSource =
  | RandomSource
  | number
  | { readonly random: RandomSource }
  | null
  | undefined;

export interface MaterialLibraryOptions {
  /** Deterministic seed source; defaults to the app-wide `DEFAULT_SEED`. */
  readonly random?: MaterialLibraryRandomSource;
  /** Numeric seed used when `random` is omitted. */
  readonly seed?: number;
}

/** Read-only counters, useful for HUD/debug output and tests. */
export interface MaterialLibraryStats {
  readonly textures: number;
  readonly materials: number;
  readonly textureHits: number;
  readonly textureMisses: number;
  readonly materialHits: number;
  readonly materialMisses: number;
}

function isRandomSource(value: unknown): value is RandomSource {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RandomSource>;
  return (
    typeof candidate.seed === 'number' &&
    typeof candidate.next === 'function' &&
    typeof candidate.float === 'function' &&
    typeof candidate.int === 'function' &&
    typeof candidate.fork === 'function' &&
    typeof candidate.reset === 'function'
  );
}

function resolveRandomSource(options: MaterialLibraryOptions): RandomSource {
  const candidate: unknown = options.random;
  if (isRandomSource(candidate)) return candidate;
  if (candidate && typeof candidate === 'object') {
    const nested = (candidate as { random?: unknown }).random;
    if (isRandomSource(nested)) return nested;
  }
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return createSeededRng(candidate);
  if (typeof options.seed === 'number' && Number.isFinite(options.seed)) {
    return createSeededRng(options.seed);
  }
  return createSeededRng();
}

/**
 * Parameter-keyed cache of procedural textures and the PBR materials built on
 * them. One library per scene: content tasks ask for the surface they want and
 * get the shared instance, so a hundred brick facades upload one texture.
 */
export class MaterialLibrary {
  readonly version = MATERIAL_LIBRARY_VERSION;

  /** Seed inherited from the scene context; the root of texture determinism. */
  readonly seed: number;

  private readonly random: RandomSource;
  private readonly textureCache = new Map<string, GeneratedTexture>();
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial>();

  private textureHits = 0;
  private textureMisses = 0;
  private materialHits = 0;
  private materialMisses = 0;

  constructor(options: MaterialLibraryOptions = {}) {
    this.random = resolveRandomSource(options);
    this.seed = this.random.seed;
  }

  /** Resolves (clamps + defaults + keys) a request without generating anything. */
  resolve(request: MaterialRequest): ResolvedMaterialRequest {
    return resolveMaterialRequest(request);
  }

  /** Deterministic, order-independent sub-stream for one texture key. */
  surfaceRandom(key: string): ReturnType<typeof createSurfaceRandom> {
    return createSurfaceRandom(this.random, key);
  }

  /**
   * Returns the material for a request, generating (and caching) its texture on
   * first use. Repeated identical requests return the same instance.
   */
  get(request: MaterialRequest): THREE.MeshStandardMaterial {
    const resolved = resolveMaterialRequest(request);
    const cached = this.materialCache.get(resolved.key);
    if (cached) {
      this.materialHits += 1;
      return cached;
    }
    this.materialMisses += 1;
    const generated = this.getTexture(resolved.textureOptions);
    const material = createPbrMaterial(resolved, generated.texture);
    this.materialCache.set(resolved.key, material);
    return material;
  }

  /**
   * Returns the generated texture for a request. Identical (clamped) parameters
   * share one `CanvasTexture`, so the GPU upload happens once.
   */
  getTexture(options: TextureOptions): GeneratedTexture {
    const resolved = resolveTextureOptions(options);
    const cached = this.textureCache.get(resolved.key);
    if (cached) {
      this.textureHits += 1;
      return cached;
    }
    this.textureMisses += 1;
    const generated = generateSurfaceTexture(
      resolved,
      createSurfaceRandom(this.random, resolved.key),
    );
    this.textureCache.set(resolved.key, generated);
    return generated;
  }

  /** `true` when a material for this request (or key) is already cached. */
  has(request: MaterialRequest | string): boolean {
    if (typeof request === 'string') {
      return this.materialCache.has(request) || this.textureCache.has(request);
    }
    return this.materialCache.has(resolveMaterialRequest(request).key);
  }

  /** Cache keys of every generated texture. */
  textureKeys(): string[] {
    return [...this.textureCache.keys()];
  }

  /** Cache keys of every generated material. */
  materialKeys(): string[] {
    return [...this.materialCache.keys()];
  }

  get stats(): MaterialLibraryStats {
    return {
      textures: this.textureCache.size,
      materials: this.materialCache.size,
      textureHits: this.textureHits,
      textureMisses: this.textureMisses,
      materialHits: this.materialHits,
      materialMisses: this.materialMisses,
    };
  }

  /** Disposes the material for a key and removes it from the cache. */
  disposeMaterial(key: string): boolean {
    const material = this.materialCache.get(key);
    if (!material) return false;
    material.dispose();
    this.materialCache.delete(key);
    return true;
  }

  /** Disposes one texture (and any material built from it). */
  disposeTexture(key: string): boolean {
    const generated = this.textureCache.get(key);
    if (!generated) return false;
    for (const [materialCacheKey, material] of [...this.materialCache]) {
      if (material.userData.chronoTextureKey === key) {
        material.dispose();
        this.materialCache.delete(materialCacheKey);
      }
    }
    generated.dispose();
    this.textureCache.delete(key);
    return true;
  }

  /** Releases every cached material and texture. The library stays usable. */
  dispose(): void {
    for (const material of this.materialCache.values()) material.dispose();
    for (const generated of this.textureCache.values()) generated.dispose();
    this.materialCache.clear();
    this.textureCache.clear();
  }
}

/** Creates the scene's shared material library. */
export function createMaterialLibrary(options: MaterialLibraryOptions = {}): MaterialLibrary {
  return new MaterialLibrary(options);
}

/**
 * Creates a library wired to a live `SceneContext`, so every texture's wear
 * pattern derives from the context's seeded RNG.
 */
export function createMaterialLibraryFromScene(
  scene: Pick<SceneContext, 'random'>,
  options: Omit<MaterialLibraryOptions, 'random'> = {},
): MaterialLibrary {
  return new MaterialLibrary({ ...options, random: scene.random });
}

export { DEFAULT_SURFACE_WEAR, SURFACE_KINDS, createSurfaceRandom, generateSurfaceTexture, isSurfaceKind, textureKey };
export type { GeneratedTexture, ResolvedTextureOptions, SurfaceKind, TextureOptions, TexturePalette };
