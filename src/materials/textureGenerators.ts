/**
 * Chrono City — era-agnostic procedural surface textures.
 *
 * This module turns a caller-supplied palette plus wear/scale parameters into a
 * `THREE.CanvasTexture` for every surface a city block needs: brick, stone,
 * stucco, corrugated metal, glass curtain wall, neon, asphalt, cobble, painted
 * signage and fabric. Nothing here knows about a year — content tasks decide
 * what a 1945 or a 2025 wall looks like by handing in a palette, so the same
 * library serves every era.
 *
 * Design notes
 * ------------
 *  - **The draw list is the source of truth.** Every generator paints through a
 *    `SurfacePainter`, which records each op as a readable string
 *    (`brick(#8f5a45@12,4 180x72 a=1)`) *and* rasterises it when a 2D context is
 *    available. Reviewers and tests assert on the ordered op list — mortar beds,
 *    grime streaks, panel seams, weave crossings — instead of pixel values. In a
 *    headless environment without a native canvas binding the texture is still a
 *    valid, correctly sized `CanvasTexture`; it simply reports
 *    `rasterized: false`.
 *  - **Deterministic.** All jitter comes from the supplied `RandomSource`, and
 *    `createSurfaceRandom()` derives a stable sub-stream from `(seed, key)`, so a
 *    parameter key reproduces the identical surface on every run — independent of
 *    how many draws other systems made from the shared context RNG first.
 *  - **Bounded and self-contained.** Resolutions are clamped to 256–1024 px, no
 *    binary assets and no network access; the canvas is built in memory and
 *    wraps by `repeat`.
 *
 * Lifecycle:
 *   create    → `generateSurfaceTexture()` builds canvas + `CanvasTexture`.
 *   consume   → `MaterialLibrary` (see `materialLibrary.ts`) caches and binds
 *               these textures to PBR materials.
 *   integrate → materials are applied to meshes; `dispose()` releases the GPU
 *               texture with the scene.
 */

import * as THREE from 'three';

import { DEFAULT_SEED, SeededRandom, type RandomSource } from '../core/sceneContext';

export const TEXTURE_GENERATORS_VERSION = 1;

/** Lowest canvas resolution a generator will honour, in pixels. */
export const MIN_TEXTURE_SIZE = 256;
/** Highest canvas resolution a generator will honour, in pixels. */
export const MAX_TEXTURE_SIZE = 1024;
/** Resolution used when a request does not specify one. */
export const DEFAULT_TEXTURE_SIZE = 512;
/** Wear/ageing used when a request does not specify one. */
export const DEFAULT_SURFACE_WEAR = 0.35;
/** Feature-density multiplier used when a request does not specify one. */
export const DEFAULT_SURFACE_SCALE = 1;
/** Lowest accepted feature-density multiplier. */
export const MIN_SURFACE_SCALE = 0.25;
/** Highest accepted feature-density multiplier. */
export const MAX_SURFACE_SCALE = 4;

/**
 * Every surface the library can generate.
 *
 * The ids are deliberately material-based rather than era-based: a 1965 diner
 * and a 2005 office tower can share `glassCurtainWall` with different palettes.
 */
export type SurfaceKind =
  | 'brick'
  | 'stone'
  | 'stucco'
  | 'corrugatedMetal'
  | 'glassCurtainWall'
  | 'neon'
  | 'asphalt'
  | 'cobble'
  | 'paintedSign'
  | 'fabric';

/** All surface kinds, in the order they are documented. */
export const SURFACE_KINDS: readonly SurfaceKind[] = [
  'brick',
  'stone',
  'stucco',
  'corrugatedMetal',
  'glassCurtainWall',
  'neon',
  'asphalt',
  'cobble',
  'paintedSign',
  'fabric',
];

/**
 * Surface colours handed in by the caller.
 *
 * Only `base` and `accent` are required; the remaining tones are derived from
 * them when omitted (joints darken the base, grime darkens the blend of both,
 * highlights lighten the base and the emissive falls back to the accent).
 */
export interface TexturePalette {
  /** Dominant surface colour. */
  readonly base: string;
  /** Secondary colour: brick variation, stone veining, panel tint, plaid. */
  readonly accent: string;
  /** Deepest tone: mortar, grout, joints, panel seams, sign backing. */
  readonly joint?: string;
  /** Dirt, rust, soot and weathering colour. */
  readonly grime?: string;
  /** Edges, reflections, sheen and bleached paint. */
  readonly highlight?: string;
  /** Emissive colour for neon tubes and lit signage; defaults to `accent`. */
  readonly emissive?: string;
}

/** A palette with every tone resolved to a `#rrggbb` string. */
export interface ResolvedTexturePalette {
  readonly base: string;
  readonly accent: string;
  readonly joint: string;
  readonly grime: string;
  readonly highlight: string;
  readonly emissive: string;
}

/** Caller-facing texture request. */
export interface TextureOptions {
  /** Which generator to run. */
  readonly surface: SurfaceKind;
  /** Colours for that generator. */
  readonly palette: TexturePalette;
  /** Square canvas resolution in px; clamped to `[256, 1024]`. Default `512`. */
  readonly size?: number;
  /** Texture tiling: a scalar or `[u, v]` pair, each clamped to `> 0`. Default `[1, 1]`. */
  readonly repeat?: number | readonly [number, number];
  /** Wear/ageing amount in `[0, 1]`. Default `0.35`. */
  readonly wear?: number;
  /** Feature-density multiplier in `[0.25, 4]`. Default `1`. */
  readonly scale?: number;
}

/** Texture request with every value clamped, defaulted and keyed. */
export interface ResolvedTextureOptions {
  readonly surface: SurfaceKind;
  readonly palette: ResolvedTexturePalette;
  readonly size: number;
  readonly repeat: readonly [number, number];
  readonly wear: number;
  readonly scale: number;
  /** Stable cache key for these (clamped) parameters. */
  readonly key: string;
}

/** A generated canvas plus the `CanvasTexture` that can be uploaded to WebGL. */
export interface GeneratedTexture {
  readonly surface: SurfaceKind;
  /** Stable cache key; identical to `ResolvedTextureOptions.key`. */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** The offscreen canvas the draw list was rasterised onto. */
  readonly canvas: HTMLCanvasElement;
  /** Texture already configured for `RepeatWrapping` + sRGB colour. */
  readonly texture: THREE.CanvasTexture;
  /** Ordered, human-readable record of every op the generator painted. */
  readonly drawCalls: readonly string[];
  /** `true` when a 2D context was available and the draw list was rasterised. */
  readonly rasterized: boolean;
  /** Releases the GPU texture; safe to call more than once. */
  dispose(): void;
}

/** A single surface generator. */
export type SurfaceDrawer = (
  painter: SurfacePainter,
  options: ResolvedTextureOptions,
  random: RandomSource,
) => void;

/* ------------------------------------------------------------------------- *
 * Colour helpers
 * ------------------------------------------------------------------------- */

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FUNCTIONAL_PATTERN = /^(rgb|rgba|hsl|hsla)\(/i;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampUnit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return clamp(value, 0, 1);
}

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Parses `#rgb` / `#rrggbb` (alpha ignored) into byte channels. */
export function parseHexColor(hex: string): Rgb {
  let value = hex.trim().replace(/^#/, '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((character) => character + character)
      .join('');
  }
  if (value.length === 8) value = value.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(value)) return { r: 255, g: 255, b: 255 };
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

/** Formats byte channels as a lowercase `#rrggbb` string. */
export function hexFromRgb(rgb: Rgb): string {
  const channel = (value: number): string =>
    Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** Blends two colours; `t` of `0` returns `a`, `1` returns `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const amount = clampUnit(t, 0);
  const left = parseHexColor(a);
  const right = parseHexColor(b);
  return hexFromRgb({
    r: left.r + (right.r - left.r) * amount,
    g: left.g + (right.g - left.g) * amount,
    b: left.b + (right.b - left.b) * amount,
  });
}

/** Darkens (`amount < 0`) or lightens (`amount > 0`) a colour by up to 100 %. */
export function shadeHex(hex: string, amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return hex;
  const clamped = clamp(amount, -1, 1);
  return mixHex(hex, clamped < 0 ? '#000000' : '#ffffff', Math.abs(clamped));
}

/**
 * Normalises any CSS colour three.js understands to lowercase `#rrggbb`.
 * Unparsable values fall back instead of silently becoming white.
 */
export function normalizeSurfaceColor(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  const isKnown =
    HEX_PATTERN.test(trimmed) ||
    FUNCTIONAL_PATTERN.test(trimmed) ||
    Object.prototype.hasOwnProperty.call(THREE.Color.NAMES, trimmed.toLowerCase());
  if (!isKnown) return fallback;
  const color = new THREE.Color();
  color.setStyle(trimmed);
  return `#${color.getHexString()}`;
}

/** Fills in the tones a caller left out. */
export function resolveTexturePalette(palette: TexturePalette): ResolvedTexturePalette {
  const base = normalizeSurfaceColor(palette.base, '#8f8f8f');
  const accent = normalizeSurfaceColor(palette.accent, base);
  return {
    base,
    accent,
    joint: normalizeSurfaceColor(palette.joint, shadeHex(base, -0.42)),
    grime: normalizeSurfaceColor(palette.grime, shadeHex(mixHex(base, accent, 0.3), -0.55)),
    highlight: normalizeSurfaceColor(palette.highlight, shadeHex(base, 0.3)),
    emissive: normalizeSurfaceColor(palette.emissive, accent),
  };
}

/* ------------------------------------------------------------------------- *
 * Parameter resolution
 * ------------------------------------------------------------------------- */

/** `true` when `value` is one of the ten known surface kinds. */
export function isSurfaceKind(value: unknown): value is SurfaceKind {
  return typeof value === 'string' && (SURFACE_KINDS as readonly string[]).includes(value);
}

function resolveSize(size: number | undefined): number {
  const requested = size === undefined || !Number.isFinite(size) ? DEFAULT_TEXTURE_SIZE : size;
  const bounded = clamp(Math.round(requested), MIN_TEXTURE_SIZE, MAX_TEXTURE_SIZE);
  // Snap to a multiple of four: keeps mip levels tidy without forcing POT.
  return Math.max(MIN_TEXTURE_SIZE, Math.round(bounded / 4) * 4);
}

function resolveRepeat(
  repeat: number | readonly [number, number] | undefined,
): readonly [number, number] {
  if (Array.isArray(repeat)) {
    const [u, v] = repeat as readonly [number, number];
    return [clamp(Number.isFinite(u) ? u : 1, 0.01, 64), clamp(Number.isFinite(v) ? v : 1, 0.01, 64)];
  }
  const scalar = typeof repeat === 'number' && Number.isFinite(repeat) ? repeat : 1;
  const bounded = clamp(scalar, 0.01, 64);
  return [bounded, bounded];
}

function resolveScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return DEFAULT_SURFACE_SCALE;
  return clamp(scale, MIN_SURFACE_SCALE, MAX_SURFACE_SCALE);
}

function paletteKey(palette: ResolvedTexturePalette): string {
  return [
    palette.base,
    palette.accent,
    palette.joint,
    palette.grime,
    palette.highlight,
    palette.emissive,
  ].join(',');
}

function keyFromResolved(options: Omit<ResolvedTextureOptions, 'key'>): string {
  const { surface, palette, size, repeat, wear, scale } = options;
  return [
    surface,
    `s${size}`,
    `r${round(repeat[0])}x${round(repeat[1])}`,
    `w${round(wear)}`,
    `k${round(scale)}`,
    paletteKey(palette),
  ].join('|');
}

/** Clamps and defaults a texture request; idempotent for already-resolved input. */
export function resolveTextureOptions(options: TextureOptions): ResolvedTextureOptions {
  const resolved = {
    surface: options.surface,
    palette: resolveTexturePalette(options.palette),
    size: resolveSize(options.size),
    repeat: resolveRepeat(options.repeat),
    wear: clampUnit(options.wear, DEFAULT_SURFACE_WEAR),
    scale: resolveScale(options.scale),
  };
  return { ...resolved, key: keyFromResolved(resolved) };
}

/**
 * Stable cache key for a request: two callers that describe the same surface
 * (even with differently ordered palette fields) share one GPU texture.
 */
export function textureKey(options: TextureOptions): string {
  return resolveTextureOptions(options).key;
}

/* ------------------------------------------------------------------------- *
 * Seeded randomness
 * ------------------------------------------------------------------------- */

/**
 * Derives the wear/noise seed for one texture key.
 *
 * The derivation forks a *fresh* stream from the shared seed instead of
 * consuming the live context stream. That keeps a texture identical across runs
 * no matter how many draws other systems already took from
 * `SceneContext.random` — the property the parameter-keyed cache depends on.
 */
export function surfaceRandomSeed(seed: number, key: string): number {
  return new SeededRandom(seed).fork(key).seed;
}

/** Builds the deterministic sub-stream used to generate one texture. */
export function createSurfaceRandom(
  source: RandomSource | number | undefined,
  key: string,
): SeededRandom {
  const seed = typeof source === 'number' ? source : (source?.seed ?? DEFAULT_SEED);
  return new SeededRandom(seed).fork(key);
}

/* ------------------------------------------------------------------------- *
 * Painter
 * ------------------------------------------------------------------------- */

/**
 * Records and (when possible) rasterises a surface draw list.
 *
 * Every method appends one entry to `drawCalls` before touching the canvas, so
 * the op list is complete even in environments without a 2D context.
 */
export class SurfacePainter {
  /** Ordered draw list; one human-readable entry per op. */
  readonly drawCalls: string[] = [];

  private readonly ctx: CanvasRenderingContext2D | null;
  private rasterOps = 0;

  constructor(ctx: CanvasRenderingContext2D | null) {
    this.ctx = ctx;
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }

  /** `true` when a 2D context is attached and ops are rasterised. */
  get canRasterize(): boolean {
    return this.ctx !== null;
  }

  /** Number of ops that reached the canvas. */
  get rasterizedOps(): number {
    return this.rasterOps;
  }

  /** Records a milestone with no drawing (e.g. a row header). */
  note(label: string, detail: string): void {
    this.drawCalls.push(`${label}(${detail})`);
  }

  /** Solid rectangle. */
  fill(
    label: string,
    style: string,
    x: number,
    y: number,
    width: number,
    height: number,
    alpha = 1,
  ): void {
    const w = Math.max(0.5, Math.abs(width));
    const h = Math.max(0.5, Math.abs(height));
    const a = clampUnit(alpha, 1);
    this.drawCalls.push(
      `${label}(${style}@${round(x, 2)},${round(y, 2)} ${round(w, 2)}x${round(h, 2)} a=${round(a, 2)})`,
    );
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = style;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    this.rasterOps += 1;
  }

  /** Rectangle filled with a two-stop linear gradient. */
  gradient(
    label: string,
    from: string,
    to: string,
    x: number,
    y: number,
    width: number,
    height: number,
    axis: 'vertical' | 'horizontal' = 'vertical',
    alpha = 1,
  ): void {
    const w = Math.max(0.5, Math.abs(width));
    const h = Math.max(0.5, Math.abs(height));
    const a = clampUnit(alpha, 1);
    this.drawCalls.push(
      `${label}(${from}>${to}@${round(x, 2)},${round(y, 2)} ${round(w, 2)}x${round(h, 2)} ${axis} a=${round(a, 2)})`,
    );
    const ctx = this.ctx;
    if (!ctx) return;
    const gradient =
      axis === 'vertical'
        ? ctx.createLinearGradient(0, y, 0, y + h)
        : ctx.createLinearGradient(x, 0, x + w, 0);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.globalAlpha = a;
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    this.rasterOps += 1;
  }

  /** Straight stroke, used for mortar joints, seams, cracks and threads. */
  line(
    label: string,
    style: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width = 1,
    alpha = 1,
  ): void {
    const w = Math.max(0.25, Math.abs(width));
    const a = clampUnit(alpha, 1);
    this.drawCalls.push(
      `${label}(${style}@${round(x1, 2)},${round(y1, 2)}>${round(x2, 2)},${round(y2, 2)} w=${round(w, 2)} a=${round(a, 2)})`,
    );
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.globalAlpha = a;
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.rasterOps += 1;
  }

  /** Filled circle: speckles, rivets, bolts, grit. */
  dot(label: string, style: string, x: number, y: number, radius: number, alpha = 1): void {
    const r = Math.max(0.25, Math.abs(radius));
    const a = clampUnit(alpha, 1);
    this.drawCalls.push(
      `${label}(${style}@${round(x, 2)},${round(y, 2)} r=${round(r, 2)} a=${round(a, 2)})`,
    );
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.rasterOps += 1;
  }

  /** Rotated ellipse: cobbles, rust patches, trowel patches, stains. */
  ellipse(
    label: string,
    style: string,
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation = 0,
    alpha = 1,
  ): void {
    const rx = Math.max(0.25, Math.abs(radiusX));
    const ry = Math.max(0.25, Math.abs(radiusY));
    const a = clampUnit(alpha, 1);
    this.drawCalls.push(
      `${label}(${style}@${round(x, 2)},${round(y, 2)} rx=${round(rx, 2)} ry=${round(ry, 2)} rot=${round(rotation)} a=${round(a, 2)})`,
    );
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.rasterOps += 1;
  }

  /** Stroked arc: trowel swirls and other curved tooling marks. */
  arc(
    label: string,
    style: string,
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    width = 1,
    alpha = 1,
  ): void {
    const r = Math.max(0.25, Math.abs(radius));
    const w = Math.max(0.25, Math.abs(width));
    const a = clampUnit(alpha, 1);
    this.drawCalls.push(
      `${label}(${style}@${round(x, 2)},${round(y, 2)} r=${round(r, 2)} ${round(startAngle)}..${round(endAngle)} w=${round(w, 2)} a=${round(a, 2)})`,
    );
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.globalAlpha = a;
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(x, y, r, startAngle, endAngle);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.rasterOps += 1;
  }
}

/* ------------------------------------------------------------------------- *
 * Shared drawing helpers
 * ------------------------------------------------------------------------- */

/** Deterministic integer-ish helper that keeps op counts independent of the seed. */
function count(base: number, scale: number): number {
  return Math.max(1, Math.round(base * scale));
}

/** Draws a jittered polyline — cracks, drips, frayed threads. */
function polyline(
  painter: SurfacePainter,
  label: string,
  style: string,
  random: RandomSource,
  startX: number,
  startY: number,
  segments: number,
  stepX: number,
  stepY: number,
  width: number,
  alpha: number,
): void {
  let x = startX;
  let y = startY;
  for (let index = 0; index < segments; index += 1) {
    const nextX = x + stepX * random.float(0.4, 1.6);
    const nextY = y + stepY * random.float(0.35, 1.65);
    painter.line(label, style, x, y, nextX, nextY, width, alpha);
    x = nextX;
    y = nextY;
  }
}

/* ------------------------------------------------------------------------- *
 * Generators
 * ------------------------------------------------------------------------- */

/**
 * Brick: mortar bed, offset courses, per-brick tone variation, top bevel and
 * bottom shadow per unit, chipped corners, vertical grime streaks, damp band.
 */
export const drawBrick: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const courses = clamp(Math.round(6 * scale), 4, 22);
  const brickHeight = size / courses;
  const brickWidth = brickHeight * random.float(1.85, 2.35);
  const columns = Math.ceil(size / brickWidth) + 1;
  const joint = Math.max(1.5, brickHeight * 0.11);
  const chips = count(6, scale) + Math.round(wear * 26);
  const streaks = count(14, scale) + Math.round(wear * 22);
  const blotches = count(3, scale) + Math.round(wear * 6);

  painter.note(
    'courses',
    `rows=${courses} columns=${columns} brick=${round(brickWidth, 2)}x${round(brickHeight, 2)} joint=${round(joint, 2)}`,
  );
  painter.fill('mortar-bed', palette.joint, 0, 0, size, size);

  for (let row = 0; row < courses; row += 1) {
    const y = row * brickHeight;
    const offset = row % 2 === 0 ? 0 : brickWidth / 2;
    painter.note('brick-row', `row=${row} y=${round(y, 2)} offset=${round(offset, 2)}`);
    for (let column = -1; column <= columns; column += 1) {
      const x = column * brickWidth + offset;
      const brickX = x + joint / 2;
      const brickY = y + joint / 2;
      const brickW = brickWidth - joint;
      const brickH = brickHeight - joint;
      const tone = shadeHex(
        mixHex(palette.base, palette.accent, random.float(0, 0.8)),
        random.float(-0.12, 0.12),
      );
      painter.fill('brick', tone, brickX, brickY, brickW, brickH);
      painter.fill(
        'brick-bevel',
        shadeHex(tone, 0.18),
        brickX,
        brickY,
        brickW,
        Math.max(1, brickH * 0.14),
        0.45,
      );
      painter.fill(
        'brick-shadow',
        shadeHex(tone, -0.28),
        brickX,
        brickY + brickH - Math.max(1, brickH * 0.16),
        brickW,
        Math.max(1, brickH * 0.16),
        0.45,
      );
    }
    painter.line('bed-joint', shadeHex(palette.joint, -0.2), 0, y, size, y, joint * 0.7, 0.5);
  }

  for (let index = 0; index < chips; index += 1) {
    painter.dot(
      'chip',
      palette.joint,
      random.float(0, size),
      random.float(0, size),
      random.float(1, 3.5) * (size / 512),
      random.float(0.4, 0.85),
    );
  }

  for (let index = 0; index < streaks; index += 1) {
    painter.fill(
      'grime-streak',
      palette.grime,
      random.float(0, size),
      random.float(0, size * 0.5),
      random.float(1, 4) * (size / 512),
      random.float(size * 0.12, size * 0.5),
      random.float(0.03, 0.13),
    );
  }

  for (let index = 0; index < blotches; index += 1) {
    painter.ellipse(
      'grime-blotch',
      palette.grime,
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.05, size * 0.18),
      random.float(size * 0.04, size * 0.14),
      random.float(0, Math.PI),
      random.float(0.06, 0.16),
    );
  }

  painter.gradient(
    'damp-band',
    'rgba(0,0,0,0)',
    palette.grime,
    0,
    size * 0.72,
    size,
    size * 0.28,
    'vertical',
    0.35,
  );
};

/**
 * Stone: ashlar courses of varied block widths, joint bed, bevels and shadows,
 * veining, speckle and pitting, weather staining, cracks and joint moss.
 */
export const drawStone: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const courses = clamp(Math.round(4.5 * scale), 3, 9);
  const courseHeight = size / courses;
  const joint = Math.max(2, courseHeight * 0.07);
  const stains = count(4, scale) + Math.round(wear * 8);
  const cracks = Math.round(wear * 6);

  painter.note(
    'courses',
    `rows=${courses} courseHeight=${round(courseHeight, 2)} joint=${round(joint, 2)}`,
  );
  painter.fill('joint-bed', palette.joint, 0, 0, size, size);

  for (let row = 0; row < courses; row += 1) {
    const y = row * courseHeight;
    let x = row % 2 === 0 ? 0 : -courseHeight * random.float(0.6, 1.4);
    painter.note('stone-course', `row=${row} y=${round(y, 2)} start=${round(x, 2)}`);
    while (x < size) {
      const blockWidth = Math.min(
        courseHeight * random.float(1.1, 2.6),
        size - x + courseHeight,
      );
      const blockX = x + joint / 2;
      const blockY = y + joint / 2;
      const blockW = blockWidth - joint;
      const blockH = courseHeight - joint;
      const tone = shadeHex(
        mixHex(palette.base, palette.accent, random.float(0, 0.7)),
        random.float(-0.14, 0.14),
      );
      painter.fill('stone-block', tone, blockX, blockY, blockW, blockH);
      painter.fill(
        'stone-highlight',
        shadeHex(tone, 0.2),
        blockX,
        blockY,
        blockW,
        Math.max(1, blockH * 0.1),
        0.35,
      );
      painter.fill(
        'stone-shadow',
        shadeHex(tone, -0.3),
        blockX,
        blockY + blockH - Math.max(1, blockH * 0.12),
        blockW,
        Math.max(1, blockH * 0.12),
        0.4,
      );

      const veins = random.int(1, 3);
      for (let vein = 0; vein < veins; vein += 1) {
        const veinX = blockX + blockW * random.float(0.1, 0.6);
        painter.line(
          'stone-vein',
          shadeHex(tone, random.float(-0.22, 0.28)),
          veinX,
          blockY + blockH * random.float(0, 0.3),
          veinX + blockW * random.float(0.15, 0.5),
          blockY + blockH * random.float(0.6, 1),
          random.float(0.6, 1.6),
          random.float(0.2, 0.45),
        );
      }

      const speckles = random.int(3, 8);
      for (let speckle = 0; speckle < speckles; speckle += 1) {
        painter.dot(
          'stone-speck',
          shadeHex(tone, random.float(-0.35, 0.35)),
          blockX + blockW * random.float(0, 1),
          blockY + blockH * random.float(0, 1),
          random.float(0.6, 2),
          random.float(0.2, 0.5),
        );
      }

      if (random.bool(0.25 * (0.3 + wear))) {
        painter.ellipse(
          'stone-pit',
          shadeHex(tone, -0.42),
          blockX + blockW * random.float(0.2, 0.8),
          blockY + blockH * random.float(0.2, 0.8),
          random.float(1.5, 4),
          random.float(1.2, 3),
          random.float(0, Math.PI),
          random.float(0.3, 0.6),
        );
      }

      x += blockWidth;
    }
    painter.line(
      'course-joint',
      shadeHex(palette.joint, -0.15),
      0,
      y,
      size,
      y,
      joint * 0.6,
      0.5,
    );
  }

  for (let index = 0; index < stains; index += 1) {
    painter.ellipse(
      'weather-stain',
      palette.grime,
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.06, size * 0.2),
      random.float(size * 0.05, size * 0.22),
      random.float(0, Math.PI),
      random.float(0.06, 0.18),
    );
  }

  for (let index = 0; index < cracks; index += 1) {
    polyline(
      painter,
      'stone-crack',
      shadeHex(palette.grime, -0.2),
      random,
      random.float(0, size),
      random.float(0, size * 0.4),
      random.int(3, 7),
      random.float(2, 10) * (random.bool() ? 1 : -1),
      random.float(4, 18),
      random.float(0.6, 1.6),
      random.float(0.25, 0.5),
    );
  }

  const moss = count(10, scale) + Math.round(wear * 20);
  for (let index = 0; index < moss; index += 1) {
    painter.dot(
      'joint-moss',
      palette.accent,
      random.float(0, size),
      random.float(0, size),
      random.float(1, 3.4),
      random.float(0.1, 0.3),
    );
  }

  painter.gradient(
    'grime-wash',
    'rgba(0,0,0,0)',
    palette.grime,
    0,
    size * 0.6,
    size,
    size * 0.4,
    'vertical',
    0.3,
  );
};

/**
 * Stucco: base coat, dashed trowel patches, curved trowel swirls, dense grain,
 * hairline cracks, water stains and a dirt band at the base.
 */
export const drawStucco: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const patches = count(36, scale);
  const swirls = count(9, scale);
  const grain = Math.round(700 * (size / 512) * (0.6 + wear * 0.4));
  const cracks = Math.round(2 + wear * 7);

  painter.fill('stucco-base', palette.base, 0, 0, size, size);

  for (let index = 0; index < patches; index += 1) {
    painter.ellipse(
      'trowel-patch',
      shadeHex(palette.base, random.float(-0.1, 0.1)),
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.04, size * 0.16),
      random.float(size * 0.03, size * 0.13),
      random.float(0, Math.PI),
      random.float(0.12, 0.3),
    );
  }

  for (let index = 0; index < swirls; index += 1) {
    const start = random.float(0, Math.PI * 2);
    painter.arc(
      'trowel-swirl',
      shadeHex(palette.base, random.float(-0.12, 0.12)),
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.06, size * 0.22),
      start,
      start + random.float(Math.PI * 0.3, Math.PI * 1.2),
      random.float(1.5, 4),
      random.float(0.1, 0.24),
    );
  }

  for (let index = 0; index < grain; index += 1) {
    painter.dot(
      'stucco-grain',
      shadeHex(palette.base, random.float(-0.18, 0.18)),
      random.float(0, size),
      random.float(0, size),
      random.float(0.5, 1.9),
      random.float(0.08, 0.32),
    );
  }

  for (let index = 0; index < cracks; index += 1) {
    polyline(
      painter,
      'hairline-crack',
      shadeHex(palette.grime, -0.25),
      random,
      random.float(0, size),
      random.float(0, size * 0.5),
      random.int(4, 9),
      random.float(1, 6) * (random.bool() ? 1 : -1),
      random.float(3, 14),
      random.float(0.5, 1.3),
      random.float(0.25, 0.5),
    );
  }

  const waterStains = count(2, scale) + Math.round(wear * 5);
  for (let index = 0; index < waterStains; index += 1) {
    painter.ellipse(
      'water-stain',
      palette.grime,
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.08, size * 0.24),
      random.float(size * 0.06, size * 0.2),
      random.float(0, Math.PI),
      random.float(0.05, 0.14),
    );
  }

  painter.gradient(
    'dirt-band',
    'rgba(0,0,0,0)',
    palette.grime,
    0,
    size * 0.66,
    size,
    size * 0.34,
    'vertical',
    0.3,
  );
};

/**
 * Corrugated metal: rib field with crest/valley shading, panel seams with
 * rivets, rust blooms and speckle, oxide streaks and dents.
 */
export const drawCorrugatedMetal: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const ribs = clamp(Math.round(10 * scale), 6, 26);
  const ribWidth = size / ribs;
  const seams = clamp(Math.round(2 * scale), 1, 4);
  const rust = count(3, scale) + Math.round(wear * 10);
  const streaks = count(8, scale) + Math.round(wear * 16);

  painter.fill('metal-base', palette.base, 0, 0, size, size);
  painter.note('corrugation', `ribs=${ribs} ribWidth=${round(ribWidth, 2)} seams=${seams}`);

  for (let index = 0; index < ribs; index += 1) {
    const x = index * ribWidth;
    painter.gradient(
      'rib',
      shadeHex(palette.base, 0.24),
      shadeHex(palette.base, -0.34),
      x,
      0,
      ribWidth,
      size,
      'horizontal',
    );
    painter.line(
      'rib-crest',
      shadeHex(palette.highlight, 0.1),
      x + ribWidth * 0.5,
      0,
      x + ribWidth * 0.5,
      size,
      Math.max(1, ribWidth * 0.08),
      0.45,
    );
    painter.line(
      'rib-valley',
      shadeHex(palette.base, -0.45),
      x + ribWidth * 0.05,
      0,
      x + ribWidth * 0.05,
      size,
      Math.max(1, ribWidth * 0.06),
      0.4,
    );
  }

  for (let seam = 0; seam < seams; seam += 1) {
    const y = (seam + 1) * (size / (seams + 1));
    const seamHeight = Math.max(2, size * 0.012);
    painter.fill('panel-seam', shadeHex(palette.base, -0.5), 0, y, size, seamHeight, 0.85);
    painter.line(
      'seam-highlight',
      shadeHex(palette.highlight, 0.05),
      0,
      y + seamHeight,
      size,
      y + seamHeight,
      Math.max(1, seamHeight * 0.4),
      0.3,
    );
    for (let rib = 0; rib < ribs; rib += 2) {
      painter.dot(
        'rivet',
        shadeHex(palette.highlight, random.float(-0.05, 0.15)),
        rib * ribWidth + ribWidth * 0.5,
        y + seamHeight * 0.5,
        Math.max(1, ribWidth * 0.09),
        random.float(0.5, 0.8),
      );
      painter.dot(
        'rivet-shadow',
        shadeHex(palette.base, -0.4),
        rib * ribWidth + ribWidth * 0.5 + 1,
        y + seamHeight * 0.5 + 1,
        Math.max(1, ribWidth * 0.09),
        0.35,
      );
    }
  }

  for (let index = 0; index < rust; index += 1) {
    const patchX = random.float(0, size);
    const patchY = random.float(0, size);
    painter.ellipse(
      'rust-patch',
      palette.grime,
      patchX,
      patchY,
      random.float(size * 0.03, size * 0.1),
      random.float(size * 0.02, size * 0.09),
      random.float(0, Math.PI),
      random.float(0.2, 0.5),
    );
    const speckles = random.int(4, 10);
    for (let speckle = 0; speckle < speckles; speckle += 1) {
      painter.dot(
        'rust-speckle',
        shadeHex(palette.grime, random.float(-0.2, 0.15)),
        patchX + random.float(-size * 0.08, size * 0.08),
        patchY + random.float(-size * 0.08, size * 0.08),
        random.float(0.6, 2.2),
        random.float(0.2, 0.55),
      );
    }
  }

  for (let index = 0; index < streaks; index += 1) {
    painter.fill(
      'oxide-streak',
      palette.grime,
      random.float(0, size),
      random.float(0, size * 0.6),
      random.float(1, 3.5) * (size / 512),
      random.float(size * 0.1, size * 0.4),
      random.float(0.03, 0.1),
    );
  }

  const dents = Math.round(2 + wear * 6);
  for (let index = 0; index < dents; index += 1) {
    const dentX = random.float(0, size);
    const dentY = random.float(0, size);
    const radius = random.float(size * 0.02, size * 0.06);
    painter.ellipse(
      'dent',
      shadeHex(palette.base, 0.16),
      dentX,
      dentY,
      radius,
      radius * random.float(0.5, 0.9),
      random.float(0, Math.PI),
      0.4,
    );
    painter.ellipse(
      'dent-shadow',
      shadeHex(palette.base, -0.4),
      dentX + radius * 0.3,
      dentY + radius * 0.35,
      radius,
      radius * random.float(0.4, 0.8),
      random.float(0, Math.PI),
      0.35,
    );
  }

  painter.gradient(
    'sky-sheen',
    palette.highlight,
    'rgba(0,0,0,0)',
    0,
    0,
    size,
    size * 0.3,
    'vertical',
    0.1,
  );
};

/**
 * Glass curtain wall: tinted panes with per-pane variation, reflection and
 * sheen gradients, spandrel bands, mullion grid with shading, sky wash, dust
 * bands, smudges and scratches.
 */
export const drawGlassCurtainWall: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const columns = clamp(Math.round(6 * scale), 3, 12);
  const rows = clamp(Math.round(8 * scale), 4, 16);
  const paneWidth = size / columns;
  const paneHeight = size / rows;
  const mullion = Math.max(2, Math.min(paneWidth, paneHeight) * 0.09);

  painter.fill('glazing-base', shadeHex(palette.base, -0.2), 0, 0, size, size);
  painter.note(
    'curtain-grid',
    `columns=${columns} rows=${rows} pane=${round(paneWidth, 2)}x${round(paneHeight, 2)} mullion=${round(mullion, 2)}`,
  );

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * paneWidth + mullion / 2;
      const y = row * paneHeight + mullion / 2;
      const width = paneWidth - mullion;
      const height = paneHeight - mullion;
      const tint = mixHex(palette.base, palette.accent, random.float(0, 0.45));
      painter.gradient(
        'pane-glass',
        shadeHex(tint, random.float(0.1, 0.24)),
        shadeHex(tint, random.float(-0.18, -0.04)),
        x,
        y,
        width,
        height,
        'vertical',
      );
      painter.gradient(
        'pane-reflection',
        palette.highlight,
        'rgba(0,0,0,0)',
        x,
        y,
        width,
        height * 0.5,
        'vertical',
        random.float(0.06, 0.18),
      );
      if (row % 3 === 2) {
        painter.fill('spandrel-band', shadeHex(tint, -0.4), x, y, width, height, 0.65);
      }
      painter.line('pane-edge', palette.highlight, x, y, x + width, y, 1, 0.18);
      painter.line('pane-edge', palette.highlight, x, y, x, y + height, 1, 0.14);
    }
  }

  for (let column = 0; column <= columns; column += 1) {
    const x = column * paneWidth;
    painter.line('mullion-v', palette.joint, x, 0, x, size, mullion, 1);
    painter.line(
      'mullion-shade',
      shadeHex(palette.joint, -0.4),
      x + mullion * 0.5,
      0,
      x + mullion * 0.5,
      size,
      Math.max(1, mullion * 0.3),
      0.5,
    );
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = row * paneHeight;
    painter.line('mullion-h', palette.joint, 0, y, size, y, mullion, 1);
    painter.line(
      'transom-shade',
      shadeHex(palette.joint, -0.4),
      0,
      y + mullion * 0.5,
      size,
      y + mullion * 0.5,
      Math.max(1, mullion * 0.3),
      0.5,
    );
  }

  painter.gradient(
    'sky-wash',
    palette.highlight,
    'rgba(0,0,0,0)',
    0,
    0,
    size,
    size * 0.62,
    'vertical',
    0.12,
  );

  const dustBands = count(2, scale) + Math.round(wear * 5);
  for (let index = 0; index < dustBands; index += 1) {
    const y = random.float(0, size);
    painter.gradient(
      'dust-band',
      'rgba(0,0,0,0)',
      palette.grime,
      0,
      y,
      size,
      random.float(size * 0.04, size * 0.12),
      'vertical',
      random.float(0.08, 0.2),
    );
  }

  const smudges = count(4, scale) + Math.round(wear * 8);
  for (let index = 0; index < smudges; index += 1) {
    painter.ellipse(
      'pane-smudge',
      palette.grime,
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.01, size * 0.05),
      random.float(size * 0.01, size * 0.05),
      random.float(0, Math.PI),
      random.float(0.04, 0.12),
    );
  }

  const scratches = Math.round(wear * 14);
  for (let index = 0; index < scratches; index += 1) {
    const x = random.float(0, size);
    const y = random.float(0, size);
    painter.line(
      'scratch',
      palette.highlight,
      x,
      y,
      x + random.float(-size * 0.08, size * 0.08),
      y + random.float(-size * 0.08, size * 0.08),
      random.float(0.5, 1.2),
      random.float(0.06, 0.18),
    );
  }
};

/**
 * Neon: dark backing plate with grime, painted panel frame, glow + core tube
 * strokes over a deterministic glyph layout, electrodes, brackets, a burnt-out
 * gap or two and a soft halo behind the sign.
 */
export const drawNeon: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const bars = clamp(Math.round(3 * scale), 2, 5);
  const coreWidth = Math.max(2, size * 0.014);
  const glowWidth = coreWidth * 3.2;
  const inset = size * 0.08;
  const topBand = size * 0.3;
  const bottomBand = size * 0.7;

  painter.fill('backing-plate', shadeHex(palette.base, -0.55), 0, 0, size, size);
  painter.note('tube-layout', `bars=${bars} core=${round(coreWidth, 2)} glow=${round(glowWidth, 2)}`);

  for (let index = 0; index < count(10, scale); index += 1) {
    painter.fill(
      'plate-grime',
      palette.grime,
      random.float(0, size),
      random.float(0, size),
      random.float(1, 4) * (size / 512),
      random.float(size * 0.05, size * 0.3),
      random.float(0.03, 0.1),
    );
  }

  painter.ellipse(
    'halo',
    palette.emissive,
    size / 2,
    size / 2,
    size * 0.42,
    size * 0.3,
    0,
    0.09,
  );

  const frameInset = size * 0.045;
  const frameWidth = Math.max(2, size * 0.014);
  const frameColor = shadeHex(palette.accent, -0.15);
  painter.line('panel-frame', frameColor, frameInset, frameInset, size - frameInset, frameInset, frameWidth, 0.9);
  painter.line('panel-frame', frameColor, size - frameInset, frameInset, size - frameInset, size - frameInset, frameWidth, 0.9);
  painter.line('panel-frame', frameColor, size - frameInset, size - frameInset, frameInset, size - frameInset, frameWidth, 0.9);
  painter.line('panel-frame', frameColor, frameInset, size - frameInset, frameInset, frameInset, frameWidth, 0.9);

  const barPositions: Array<{ x: number; top: number; bottom: number }> = [];
  const span = size - inset * 2;
  for (let bar = 0; bar < bars; bar += 1) {
    const x = inset + (span * (bar + 0.5)) / bars;
    const top = topBand + random.float(-size * 0.04, size * 0.04);
    const bottom = bottomBand + random.float(-size * 0.04, size * 0.04);
    barPositions.push({ x, top, bottom });
    painter.note('glyph-bar', `bar=${bar} x=${round(x, 2)} y=${round(top, 2)}..${round(bottom, 2)}`);
    painter.line('tube-glow', palette.emissive, x, top, x, bottom, glowWidth, 0.22);
    painter.line('tube-core', palette.highlight, x, top, x, bottom, coreWidth, 1);
    painter.dot('electrode', shadeHex(palette.emissive, 0.25), x, top, coreWidth * 1.6, 0.9);
    painter.dot('electrode', shadeHex(palette.emissive, 0.25), x, bottom, coreWidth * 1.6, 0.9);
    painter.dot('bracket', shadeHex(palette.base, -0.3), x, (top + bottom) / 2, coreWidth * 1.1, 0.85);
  }

  for (let bar = 0; bar + 1 < barPositions.length; bar += 1) {
    const left = barPositions[bar];
    const right = barPositions[bar + 1];
    if (!left || !right) continue;
    const y = random.float(topBand, bottomBand);
    painter.line('tube-glow', palette.emissive, left.x, y, right.x, y, glowWidth, 0.2);
    painter.line('tube-core', palette.highlight, left.x, y, right.x, y, coreWidth, 0.95);
  }

  const underline = size * 0.84;
  painter.line('underline-glow', palette.emissive, inset, underline, size - inset, underline, glowWidth, 0.2);
  painter.line('underline-core', palette.highlight, inset, underline, size - inset, underline, coreWidth, 0.95);

  const gaps = Math.round(wear * 5);
  for (let index = 0; index < gaps; index += 1) {
    const bar = barPositions[random.int(0, Math.max(0, barPositions.length - 1))];
    if (!bar) continue;
    painter.fill(
      'tube-gap',
      shadeHex(palette.base, -0.55),
      bar.x - coreWidth,
      random.float(bar.top, bar.bottom),
      coreWidth * 2,
      coreWidth * random.float(1.5, 3.5),
      0.9,
    );
  }

  painter.gradient(
    'plate-wash',
    'rgba(0,0,0,0)',
    palette.grime,
    0,
    size * 0.7,
    size,
    size * 0.3,
    'vertical',
    0.25,
  );
};

/**
 * Asphalt: base coat, dense aggregate speckle, worn patches, longitudinal and
 * branch cracks, a repair seam, faded paint dashes and tar blobs.
 */
export const drawAsphalt: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const aggregate = Math.round(900 * (size / 512) * (0.55 + wear * 0.45));
  const patches = count(2, scale) + Math.round(wear * 6);

  painter.fill('asphalt-base', palette.base, 0, 0, size, size);
  painter.note('aggregate', `speckles=${aggregate} wear=${round(wear, 2)}`);

  for (let index = 0; index < aggregate; index += 1) {
    painter.dot(
      'aggregate',
      shadeHex(palette.base, random.float(-0.25, 0.4)),
      random.float(0, size),
      random.float(0, size),
      random.float(0.5, 1.7) * (size / 512),
      random.float(0.18, 0.5),
    );
  }

  for (let index = 0; index < patches; index += 1) {
    const patchX = random.float(0, size);
    const patchY = random.float(0, size);
    painter.ellipse(
      'patch',
      shadeHex(palette.base, random.float(-0.2, 0.12)),
      patchX,
      patchY,
      random.float(size * 0.08, size * 0.22),
      random.float(size * 0.06, size * 0.18),
      random.float(0, Math.PI),
      0.5,
    );
    painter.ellipse(
      'patch-sheen',
      palette.highlight,
      patchX - size * 0.02,
      patchY - size * 0.02,
      random.float(size * 0.04, size * 0.12),
      random.float(size * 0.03, size * 0.1),
      random.float(0, Math.PI),
      0.05,
    );
  }

  const crackY = random.float(size * 0.3, size * 0.7);
  let crackX = 0;
  let crackY2 = crackY;
  for (let segment = 0; segment < 12; segment += 1) {
    const nextX = crackX + size / 12;
    const nextY = crackY2 + random.float(-size * 0.03, size * 0.03);
    painter.line(
      'crack',
      shadeHex(palette.base, 0.42),
      crackX,
      crackY2,
      nextX,
      nextY,
      random.float(0.8, 2),
      random.float(0.35, 0.65),
    );
    crackX = nextX;
    crackY2 = nextY;
  }

  const branches = 1 + Math.round(wear * 4);
  for (let index = 0; index < branches; index += 1) {
    polyline(
      painter,
      'crack-branch',
      shadeHex(palette.base, 0.35),
      random,
      random.float(0, size),
      crackY,
      random.int(3, 6),
      random.float(1, 6) * (random.bool() ? 1 : -1),
      random.float(3, 12),
      random.float(0.6, 1.4),
      random.float(0.25, 0.5),
    );
  }

  painter.line('repair-seam', shadeHex(palette.base, -0.25), 0, size * 0.5, size, size * 0.5, Math.max(2, size * 0.02), 0.6);
  painter.line('seam-bleed', palette.grime, 0, size * 0.5 + size * 0.012, size, size * 0.5 + size * 0.012, Math.max(1, size * 0.008), 0.35);

  for (let index = 0; index < count(3, scale); index += 1) {
    painter.fill(
      'paint-dash',
      palette.highlight,
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.1, size * 0.24),
      random.float(size * 0.015, size * 0.03),
      random.float(0.2, 0.5),
    );
  }

  const tarBlobs = count(2, scale) + Math.round(wear * 4);
  for (let index = 0; index < tarBlobs; index += 1) {
    painter.ellipse(
      'tar-blob',
      palette.joint,
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.02, size * 0.07),
      random.float(size * 0.02, size * 0.06),
      random.float(0, Math.PI),
      random.float(0.3, 0.7),
    );
  }

  painter.gradient(
    'tire-polish',
    'rgba(0,0,0,0)',
    palette.highlight,
    0,
    size * 0.2,
    size,
    size * 0.12,
    'vertical',
    0.08,
  );
  painter.gradient(
    'tire-polish',
    'rgba(0,0,0,0)',
    palette.highlight,
    0,
    size * 0.7,
    size,
    size * 0.12,
    'vertical',
    0.08,
  );
};

/**
 * Cobble: grit bed, staggered rows of rotated elliptical setts with crown and
 * shade per stone, joint grit, a polished wear band, puddles, moss and chips.
 */
export const drawCobble: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const rows = clamp(Math.round(7 * scale), 4, 16);
  const rowHeight = size / rows;
  const settWidth = rowHeight * 1.35;
  const columns = Math.ceil(size / settWidth) + 1;

  painter.fill('cobble-bed', palette.joint, 0, 0, size, size);
  painter.note('sett-layout', `rows=${rows} columns=${columns} sett=${round(settWidth, 2)}x${round(rowHeight, 2)}`);

  for (let row = 0; row < rows; row += 1) {
    const y = row * rowHeight + rowHeight / 2;
    const offset = row % 2 === 0 ? 0 : settWidth / 2;
    painter.note('cobble-row', `row=${row} y=${round(y, 2)} offset=${round(offset, 2)}`);
    for (let column = -1; column <= columns; column += 1) {
      const x = column * settWidth + offset + settWidth / 2;
      const radiusX = settWidth * 0.46 * random.float(0.86, 1.05);
      const radiusY = rowHeight * 0.42 * random.float(0.86, 1.05);
      const rotation = random.float(-0.28, 0.28);
      const tone = shadeHex(
        mixHex(palette.base, palette.accent, random.float(0, 0.65)),
        random.float(-0.12, 0.12),
      );
      painter.ellipse('cobble', tone, x, y, radiusX, radiusY, rotation);
      painter.ellipse(
        'cobble-crown',
        shadeHex(tone, 0.22),
        x - radiusX * 0.18,
        y - radiusY * 0.24,
        radiusX * 0.48,
        radiusY * 0.42,
        rotation,
        0.35,
      );
      painter.ellipse(
        'cobble-shade',
        shadeHex(tone, -0.34),
        x + radiusX * 0.16,
        y + radiusY * 0.26,
        radiusX * 0.54,
        radiusY * 0.4,
        rotation,
        0.3,
      );
      if (random.bool(0.2 * (0.3 + wear))) {
        painter.ellipse(
          'cobble-chip',
          shadeHex(palette.joint, -0.1),
          x + radiusX * random.float(-0.4, 0.4),
          y + radiusY * random.float(-0.4, 0.4),
          radiusX * random.float(0.1, 0.24),
          radiusY * random.float(0.1, 0.24),
          rotation,
          random.float(0.4, 0.7),
        );
      }
    }
  }

  const grit = Math.round(140 * (size / 512) * (0.4 + wear * 0.6));
  for (let index = 0; index < grit; index += 1) {
    painter.dot(
      'joint-grit',
      shadeHex(palette.joint, random.float(0.1, 0.45)),
      random.float(0, size),
      random.float(0, size),
      random.float(0.5, 1.6),
      random.float(0.15, 0.45),
    );
  }

  painter.gradient(
    'wear-polish',
    'rgba(0,0,0,0)',
    palette.highlight,
    0,
    size * 0.4,
    size,
    size * 0.18,
    'vertical',
    0.12,
  );

  const puddles = Math.round(1 + wear * 4);
  for (let index = 0; index < puddles; index += 1) {
    painter.ellipse(
      'puddle',
      shadeHex(palette.grime, -0.15),
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.06, size * 0.18),
      random.float(size * 0.04, size * 0.12),
      random.float(0, Math.PI),
      random.float(0.12, 0.28),
    );
  }

  const moss = Math.round(wear * 26);
  for (let index = 0; index < moss; index += 1) {
    painter.dot(
      'joint-moss',
      palette.accent,
      random.float(0, size),
      random.float(0, size),
      random.float(1, 3.6),
      random.float(0.12, 0.35),
    );
  }
};

/**
 * Painted signage: primed panel, sheen, double painted frame, glyph blocks with
 * shadows and brush strokes, flaked paint, fade wash, drips and corner bolts.
 */
export const drawPaintedSign: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const words = clamp(Math.round(2 * scale), 1, 4);
  const ruleWidth = Math.max(2, size * 0.016);

  painter.fill('sign-panel', palette.base, 0, 0, size, size);
  painter.gradient(
    'panel-sheen',
    palette.highlight,
    'rgba(0,0,0,0)',
    0,
    0,
    size,
    size * 0.45,
    'vertical',
    0.14,
  );
  painter.note('sign-layout', `words=${words} rule=${round(ruleWidth, 2)}`);

  const outerInset = size * 0.06;
  const innerInset = size * 0.1;
  const frameColor = shadeHex(palette.accent, -0.1);
  painter.line('panel-frame', frameColor, outerInset, outerInset, size - outerInset, outerInset, ruleWidth, 0.95);
  painter.line('panel-frame', frameColor, size - outerInset, outerInset, size - outerInset, size - outerInset, ruleWidth, 0.95);
  painter.line('panel-frame', frameColor, size - outerInset, size - outerInset, outerInset, size - outerInset, ruleWidth, 0.95);
  painter.line('panel-frame', frameColor, outerInset, size - outerInset, outerInset, outerInset, ruleWidth, 0.95);
  painter.line('inner-rule', shadeHex(palette.highlight, -0.1), innerInset, innerInset, size - innerInset, innerInset, ruleWidth * 0.4, 0.5);
  painter.line('inner-rule', shadeHex(palette.highlight, -0.1), innerInset, size - innerInset, size - innerInset, size - innerInset, ruleWidth * 0.4, 0.5);

  for (let word = 0; word < words; word += 1) {
    const glyphs = random.int(3, 6);
    const bandHeight = size * 0.16;
    const bandY = size * 0.26 + (word * size * 0.26);
    const glyphGap = size * 0.02;
    const glyphWidth = (size * 0.74 - glyphGap * (glyphs - 1)) / glyphs;
    painter.note('glyph-word', `word=${word} glyphs=${glyphs} y=${round(bandY, 2)}`);
    for (let glyph = 0; glyph < glyphs; glyph += 1) {
      const x = size * 0.13 + glyph * (glyphWidth + glyphGap);
      const tone = shadeHex(palette.accent, random.float(-0.12, 0.12));
      painter.fill('glyph-block', tone, x, bandY, glyphWidth, bandHeight);
      painter.fill(
        'glyph-shadow',
        shadeHex(tone, -0.35),
        x + glyphWidth * 0.08,
        bandY + bandHeight * 0.82,
        glyphWidth,
        bandHeight * 0.18,
        0.5,
      );
      painter.line(
        'brush-stroke',
        shadeHex(tone, random.float(-0.15, 0.2)),
        x,
        bandY + bandHeight * random.float(0.2, 0.8),
        x + glyphWidth,
        bandY + bandHeight * random.float(0.2, 0.8),
        random.float(0.6, 1.6),
        random.float(0.15, 0.35),
      );
    }
  }

  const chips = Math.round(8 + wear * 46);
  for (let index = 0; index < chips; index += 1) {
    painter.dot(
      'paint-chip',
      shadeHex(palette.joint, random.float(-0.1, 0.2)),
      random.float(0, size),
      random.float(0, size),
      random.float(0.6, 2.6) * (size / 512),
      random.float(0.25, 0.75),
    );
  }

  painter.gradient(
    'paint-fade',
    'rgba(0,0,0,0)',
    palette.grime,
    0,
    size * 0.68,
    size,
    size * 0.32,
    'vertical',
    0.22,
  );

  const drips = Math.round(wear * 12);
  for (let index = 0; index < drips; index += 1) {
    painter.fill(
      'paint-drip',
      palette.grime,
      random.float(0, size),
      random.float(0, size * 0.5),
      random.float(1, 3) * (size / 512),
      random.float(size * 0.08, size * 0.34),
      random.float(0.04, 0.12),
    );
  }

  const boltRadius = Math.max(1.5, size * 0.011);
  const boltInset = outerInset * 0.55;
  const boltPositions: Array<readonly [number, number]> = [
    [boltInset, boltInset],
    [size - boltInset, boltInset],
    [boltInset, size - boltInset],
    [size - boltInset, size - boltInset],
  ];
  for (const [x, y] of boltPositions) {
    painter.dot('bolt', shadeHex(palette.highlight, 0.05), x, y, boltRadius, 0.9);
    painter.dot('bolt-shade', shadeHex(palette.joint, -0.3), x + boltRadius * 0.4, y + boltRadius * 0.4, boltRadius * 0.7, 0.6);
  }
};

/**
 * Fabric: warp and weft threads with per-thread tone jitter, alternating
 * over/under weave shading, plaid bands, worn fray patches, loose threads and
 * grime washes.
 */
export const drawFabric: SurfaceDrawer = (painter, options, random) => {
  const { palette, size, wear, scale } = options;
  const threads = clamp(Math.round(22 * scale), 12, 46);
  const cell = size / threads;

  painter.fill('fabric-base', palette.base, 0, 0, size, size);
  painter.note('weave', `threads=${threads} cell=${round(cell, 2)}`);

  for (let index = 0; index <= threads; index += 1) {
    const x = index * cell + cell / 2;
    painter.line(
      'warp-thread',
      shadeHex(palette.base, random.float(-0.14, 0.14)),
      x,
      0,
      x,
      size,
      cell * 0.92,
      0.85,
    );
  }

  for (let index = 0; index <= threads; index += 1) {
    const y = index * cell + cell / 2;
    painter.line(
      'weft-thread',
      shadeHex(palette.base, random.float(-0.14, 0.14)),
      0,
      y,
      size,
      y,
      cell * 0.92,
      0.55,
    );
  }

  for (let row = 0; row <= threads; row += 1) {
    for (let column = 0; column <= threads; column += 1) {
      const x = column * cell;
      const y = row * cell;
      if ((row + column) % 2 === 0) {
        painter.fill('weave-shadow', shadeHex(palette.base, -0.32), x, y, cell, cell, 0.09);
      } else {
        painter.fill('weave-sheen', shadeHex(palette.base, 0.26), x, y, cell, cell, 0.05);
      }
    }
  }

  const bandHeight = cell * 1.6;
  for (let index = 0; index < 2; index += 1) {
    painter.fill(
      'plaid-band',
      palette.accent,
      0,
      size * (0.18 + index * 0.5),
      size,
      bandHeight,
      0.28,
    );
    painter.fill(
      'plaid-band',
      palette.accent,
      size * (0.22 + index * 0.5),
      0,
      bandHeight,
      size,
      0.24,
    );
    painter.line(
      'plaid-band-edge',
      shadeHex(palette.accent, -0.25),
      0,
      size * (0.18 + index * 0.5),
      size,
      size * (0.18 + index * 0.5),
      1,
      0.35,
    );
    painter.line(
      'plaid-band-edge',
      shadeHex(palette.accent, -0.25),
      size * (0.22 + index * 0.5),
      0,
      size * (0.22 + index * 0.5),
      size,
      1,
      0.3,
    );
  }

  const frays = count(2, scale) + Math.round(wear * 6);
  for (let index = 0; index < frays; index += 1) {
    painter.ellipse(
      'fray-patch',
      shadeHex(palette.base, 0.2),
      random.float(0, size),
      random.float(0, size),
      random.float(size * 0.03, size * 0.1),
      random.float(size * 0.03, size * 0.08),
      random.float(0, Math.PI),
      random.float(0.12, 0.3),
    );
  }

  const threadFray = Math.round(60 * (size / 512) * (0.3 + wear));
  for (let index = 0; index < threadFray; index += 1) {
    painter.dot(
      'thread-fray',
      shadeHex(palette.base, random.float(0.15, 0.4)),
      random.float(0, size),
      random.float(0, size),
      random.float(0.5, 1.4),
      random.float(0.15, 0.5),
    );
  }

  const looseThreads = Math.round(wear * 9);
  for (let index = 0; index < looseThreads; index += 1) {
    polyline(
      painter,
      'loose-thread',
      shadeHex(palette.base, 0.28),
      random,
      random.float(0, size),
      random.float(0, size),
      random.int(2, 4),
      random.float(1, 7) * (random.bool() ? 1 : -1),
      random.float(2, 9),
      random.float(0.5, 1.2),
      random.float(0.2, 0.45),
    );
  }

  const grimeWashes = 1 + Math.round(wear * 3);
  for (let index = 0; index < grimeWashes; index += 1) {
    painter.gradient(
      'grime-wash',
      'rgba(0,0,0,0)',
      palette.grime,
      0,
      random.float(size * 0.4, size * 0.8),
      size,
      random.float(size * 0.12, size * 0.3),
      'vertical',
      random.float(0.08, 0.2),
    );
  }
};

/** Registry of every surface generator, keyed by `SurfaceKind`. */
export const TEXTURE_GENERATORS: Readonly<Record<SurfaceKind, SurfaceDrawer>> = {
  brick: drawBrick,
  stone: drawStone,
  stucco: drawStucco,
  corrugatedMetal: drawCorrugatedMetal,
  glassCurtainWall: drawGlassCurtainWall,
  neon: drawNeon,
  asphalt: drawAsphalt,
  cobble: drawCobble,
  paintedSign: drawPaintedSign,
  fabric: drawFabric,
};

/* ------------------------------------------------------------------------- *
 * Generation
 * ------------------------------------------------------------------------- */

function createSurfaceCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error(
      'generateSurfaceTexture() needs a DOM document; run it in the browser or a DOM-capable test environment.',
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Builds the canvas + `CanvasTexture` for one surface.
 *
 * `random` may be an explicit `RandomSource` (used exactly as given, which is
 * how `MaterialLibrary` feeds in its per-key sub-stream) or a numeric seed, in
 * which case — like the default — the deterministic sub-stream for the
 * request's key is used, so the same request reproduces the same surface.
 */
export function generateSurfaceTexture(
  options: TextureOptions,
  random?: RandomSource | number,
): GeneratedTexture {
  if (!isSurfaceKind(options.surface)) {
    throw new RangeError(
      `Unknown surface "${String(options.surface)}"; expected one of ${SURFACE_KINDS.join(', ')}.`,
    );
  }

  const resolved = resolveTextureOptions(options);
  const stream = typeof random === 'number' || random === undefined
    ? createSurfaceRandom(random, resolved.key)
    : random;

  const canvas = createSurfaceCanvas(resolved.size, resolved.size);
  const context2d = canvas.getContext('2d');
  const painter = new SurfacePainter(context2d);

  painter.note(
    'surface',
    `kind=${resolved.surface} size=${resolved.size} wear=${round(resolved.wear)} scale=${round(resolved.scale)} repeat=${round(resolved.repeat[0])}x${round(resolved.repeat[1])}`,
  );
  TEXTURE_GENERATORS[resolved.surface](painter, resolved, stream);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `chrono-${resolved.surface}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(resolved.repeat[0], resolved.repeat[1]);
  texture.userData.chronoSurface = resolved.surface;
  texture.userData.chronoKey = resolved.key;
  texture.userData.chronoDrawCalls = painter.drawCalls.length;
  texture.needsUpdate = true;

  let disposed = false;
  return {
    surface: resolved.surface,
    key: resolved.key,
    width: canvas.width,
    height: canvas.height,
    canvas,
    texture,
    drawCalls: painter.drawCalls,
    rasterized: painter.canRasterize,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      texture.dispose();
    },
  };
}

/** Convenience wrapper: generate for an explicit surface id. */
export function generateTextureFor(
  surface: SurfaceKind,
  options: Omit<TextureOptions, 'surface'>,
  random?: RandomSource | number,
): GeneratedTexture {
  return generateSurfaceTexture({ ...options, surface }, random);
}
