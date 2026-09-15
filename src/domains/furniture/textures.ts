/**
 * Procedural furniture surfaces.
 *
 * Every era material in the furniture domain is painted here, pixel by pixel:
 * wood grain (oak, beech, walnut, reclaimed pine), laminate, melamine, vinyl and
 * leatherette, wool and moquette fabric weave, cane webbing, cork, linoleum,
 * worn metal and chrome, glass, terrazzo, stone, painted joinery, printed
 * magazine covers and foliage. Nothing is fetched — at build time or at runtime
 * — so the module works offline, in a headless node process and in the browser
 * from the same bytes.
 *
 * The same raster feeds two backends, exactly mirroring the shell's finish
 * pipeline:
 *
 *  - **canvas** — when a DOM canvas (or an injected {@link CanvasFactory}) is
 *    available the raster is blitted with `putImageData` and wrapped in a
 *    `CanvasTexture`.
 *  - **data** — with no canvas (headless node, the composition tests) the bytes
 *    become a `DataTexture`.
 *
 * Both paths are deterministic: every painter draws from a seeded PRNG derived
 * from the style (kind, palette, scale, orientation), so an era's material set
 * looks identical on every run and tests can assert real pixel content. Painters
 * wrap at the texture edges so finishes tile without seams under
 * `RepeatWrapping`.
 */

import * as THREE from 'three';
import { createSeededRandom } from '../../core/kernel';

/* -------------------------------------------------------------------------- */
/* Colour vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/** A colour in 0..255 components. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const NAMED_COLORS: Readonly<Record<string, number>> = Object.freeze({
  black: 0x000000,
  white: 0xffffff,
  grey: 0x808080,
  gray: 0x808080,
});

function clampByte(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

/** Parses `#rgb`, `#rrggbb`, `rgb(r,g,b)` and a few CSS names. */
export function parseColor(value: string): Rgb {
  const input = value.trim().toLowerCase();
  const named = NAMED_COLORS[input];
  if (named !== undefined) {
    return { r: (named >> 16) & 0xff, g: (named >> 8) & 0xff, b: named & 0xff };
  }
  if (input.startsWith('#')) {
    const hex = input.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex[0] ?? '0', 16);
      const g = Number.parseInt(hex[1] ?? '0', 16);
      const b = Number.parseInt(hex[2] ?? '0', 16);
      return { r: r * 17, g: g * 17, b: b * 17 };
    }
    if (hex.length === 6) {
      const parsed = Number.parseInt(hex, 16);
      if (Number.isFinite(parsed)) {
        return { r: (parsed >> 16) & 0xff, g: (parsed >> 8) & 0xff, b: parsed & 0xff };
      }
    }
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(input);
  if (rgb) {
    return {
      r: clampByte(Number(rgb[1] ?? 0)),
      g: clampByte(Number(rgb[2] ?? 0)),
      b: clampByte(Number(rgb[3] ?? 0)),
    };
  }
  return { r: 128, g: 128, b: 128 };
}

/** Multiplies a colour by `factor` (`1` keeps it, `0.5` darkens by half). */
export function shade(color: Rgb, factor: number): Rgb {
  return { r: clampByte(color.r * factor), g: clampByte(color.g * factor), b: clampByte(color.b * factor) };
}

/** Blends two colours; `t` = 0 returns `a`, `t` = 1 returns `b`. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const amount = Math.min(Math.max(t, 0), 1);
  return {
    r: clampByte(a.r + (b.r - a.r) * amount),
    g: clampByte(a.g + (b.g - a.g) * amount),
    b: clampByte(a.b + (b.b - a.b) * amount),
  };
}

/** Stable 32 bit hash of a string (FNV-1a), used to seed the painters. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Style vocabulary                                                           */
/* -------------------------------------------------------------------------- */

/** Painter used for one furniture surface family. */
export type FurnitureTextureKind =
  | 'wood-grain'
  | 'laminate'
  | 'vinyl'
  | 'fabric-weave'
  | 'cane'
  | 'cork'
  | 'linoleum'
  | 'worn-metal'
  | 'chrome'
  | 'glass'
  | 'paint'
  | 'terrazzo'
  | 'stone'
  | 'print'
  | 'foliage';

/** Colour vocabulary of a furniture surface. */
export interface FurnitureTexturePalette {
  /** Body colour of the material. */
  readonly base: string;
  /** Grain, pattern or stitch colour. */
  readonly accent: string;
  /** Seam, grout or shadow colour (defaults to a darkened `base`). */
  readonly detail?: string;
  /** Sheen, chip or highlight colour (defaults to a lightened `base`). */
  readonly highlight?: string;
}

/** Complete recipe for one procedural furniture finish. */
export interface FurnitureTextureStyle {
  readonly kind: FurnitureTextureKind;
  readonly palette: FurnitureTexturePalette;
  /** Pattern repetitions along one texture edge (default 4). */
  readonly scale?: number;
  /** Noise strength, 0..1 (default 0.16). */
  readonly contrast?: number;
  /** Grain direction (default `'horizontal'`). */
  readonly orientation?: 'horizontal' | 'vertical';
  /** UV repetition of the finished texture across a surface (default `[1, 1]`). */
  readonly repeat?: readonly [number, number];
  /** Square texture resolution in pixels (default {@link DEFAULT_FURNITURE_TEXTURE_SIZE}). */
  readonly size?: number;
  /** `'pattern'` skips the body fill so a finish can be layered as a decal. */
  readonly transparency?: 'none' | 'pattern';
  /** Explicit paint seed; defaults to a hash of the style. */
  readonly seed?: number;
}

/** Default square texture resolution. Small on purpose: these are procedural. */
export const DEFAULT_FURNITURE_TEXTURE_SIZE = 128;

/** Every texture this module creates is named with this prefix. */
export const FURNITURE_TEXTURE_PREFIX = 'furniture:';

/** Canvas factory used to reach the browser's 2D backend. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/**
 * Default factory: a DOM canvas when the document exists, otherwise `null`,
 * which makes {@link createFurnitureTexture} fall back to a `DataTexture`.
 */
export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** A finished procedural texture plus how it was materialised. */
export interface FurnitureTexture {
  readonly key: string;
  readonly kind: FurnitureTextureKind;
  readonly width: number;
  readonly height: number;
  /** Which backend produced the texture. */
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  /** The 2D canvas when the canvas backend was used, otherwise `null`. */
  readonly canvas: HTMLCanvasElement | null;
}

export interface FurnitureTextureOptions {
  /** Texture key, used for `texture.name` (`furniture:<key>`). Defaults to the kind. */
  readonly key?: string;
  readonly canvasFactory?: CanvasFactory;
  /** Overrides the square resolution with an explicit height. */
  readonly height?: number;
  readonly anisotropy?: number;
}

/* -------------------------------------------------------------------------- */
/* Raster                                                                     */
/* -------------------------------------------------------------------------- */

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FURNITURE_TEXTURE_SIZE;
  return Math.min(Math.max(Math.trunc(value), 8), 512);
}

/**
 * Tiny RGBA raster with the handful of primitives the painters need. All
 * coordinates wrap, so patterns tile seamlessly.
 */
export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = Math.max(Math.trunc(width), 1);
    this.height = Math.max(Math.trunc(height), 1);
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
  }

  private offset(x: number, y: number): number {
    const wrappedX = ((Math.trunc(x) % this.width) + this.width) % this.width;
    const wrappedY = ((Math.trunc(y) % this.height) + this.height) % this.height;
    return (wrappedY * this.width + wrappedX) * 4;
  }

  /** Alpha-blends `color` into the pixel at (`x`, `y`), wrapping at the edges. */
  blend(x: number, y: number, color: Rgb, alpha = 1): this {
    const amount = Math.min(Math.max(alpha, 0), 1);
    if (amount <= 0) return this;
    const offset = this.offset(x, y);
    const inverse = 1 - amount;
    const data = this.data;
    data[offset] = (data[offset] ?? 0) * inverse + color.r * amount;
    data[offset + 1] = (data[offset + 1] ?? 0) * inverse + color.g * amount;
    data[offset + 2] = (data[offset + 2] ?? 0) * inverse + color.b * amount;
    data[offset + 3] = (data[offset + 3] ?? 0) * inverse + 255 * amount;
    return this;
  }

  /** Fills the whole raster (replacing whatever was there). */
  fill(color: Rgb, alpha = 1): this {
    const amount = Math.min(Math.max(alpha, 0), 1);
    const data = this.data;
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = 255 * amount;
    }
    return this;
  }

  /** Empties the raster to fully transparent black. */
  clear(): this {
    this.data.fill(0);
    return this;
  }

  /** Fills an axis aligned rectangle, wrapping at the edges. */
  fillRect(x: number, y: number, width: number, height: number, color: Rgb, alpha = 1): this {
    const spanX = Math.max(Math.round(width), 0);
    const spanY = Math.max(Math.round(height), 0);
    for (let dy = 0; dy < spanY; dy += 1) {
      for (let dx = 0; dx < spanX; dx += 1) {
        this.blend(Math.round(x) + dx, Math.round(y) + dy, color, alpha);
      }
    }
    return this;
  }

  /** Draws a straight line (no wrapping: painters use it for local detail). */
  line(x0: number, y0: number, x1: number, y1: number, color: Rgb, alpha = 1): this {
    const steps = Math.max(Math.abs(Math.round(x1 - x0)), Math.abs(Math.round(y1 - y0)), 1);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      this.blend(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color, alpha);
    }
    return this;
  }

  /** Adds per-pixel tonal noise; `amount` is 0..1. */
  noise(random: () => number, amount: number): this {
    const strength = Math.min(Math.max(amount, 0), 1) * 255;
    if (strength <= 0) return this;
    const data = this.data;
    for (let offset = 0; offset < data.length; offset += 4) {
      const shift = (random() - 0.5) * strength;
      data[offset] = (data[offset] ?? 0) + shift;
      data[offset + 1] = (data[offset + 1] ?? 0) + shift;
      data[offset + 2] = (data[offset + 2] ?? 0) + shift;
    }
    return this;
  }
}

/* -------------------------------------------------------------------------- */
/* Painter toolkit                                                            */
/* -------------------------------------------------------------------------- */

interface PainterContext {
  readonly raster: Raster;
  readonly base: Rgb;
  readonly accent: Rgb;
  readonly detail: Rgb;
  readonly highlight: Rgb;
  readonly scale: number;
  readonly contrast: number;
  readonly vertical: boolean;
  readonly transparentBase: boolean;
  readonly random: () => number;
}

type Painter = (context: PainterContext) => void;

interface Palette {
  readonly base: Rgb;
  readonly accent: Rgb;
  readonly detail: Rgb;
  readonly highlight: Rgb;
}

function resolvePalette(palette: FurnitureTexturePalette): Palette {
  const base = parseColor(palette.base);
  const accent = parseColor(palette.accent);
  return {
    base,
    accent,
    detail: palette.detail ? parseColor(palette.detail) : shade(base, 0.55),
    highlight: palette.highlight ? parseColor(palette.highlight) : shade(base, 1.35),
  };
}

/** Fills the body of the raster unless the style asked for a pattern decal. */
function baseFill(context: PainterContext, alpha = 1): void {
  if (context.transparentBase) return;
  context.raster.fill(context.base, alpha);
}

/** Paints one tonal band, across or along the grain direction. */
function paintBand(context: PainterContext, start: number, size: number, tone: Rgb, alpha: number): void {
  const { raster, vertical } = context;
  const along = vertical ? raster.height : raster.width;
  const from = Math.round(start);
  const to = Math.round(start + size);
  for (let offset = from; offset < to; offset += 1) {
    for (let step = 0; step < along; step += 1) {
      if (vertical) raster.blend(offset, step, tone, alpha);
      else raster.blend(step, offset, tone, alpha);
    }
  }
}

interface GrainOptions {
  readonly lines: number;
  /** Wobble amplitude as a fraction of the texture edge. */
  readonly amplitude: number;
  readonly thickness?: number;
  readonly alpha: readonly [number, number];
  readonly frequency?: readonly [number, number];
  readonly tone: (t: number) => Rgb;
}

/** Long wandering lines following the grain direction (wood, stone, linoleum). */
function grain(context: PainterContext, options: GrainOptions): void {
  const { raster, vertical, random, scale } = context;
  const along = vertical ? raster.height : raster.width;
  const across = vertical ? raster.width : raster.height;
  const thickness = Math.max(Math.trunc(options.thickness ?? 1), 1);
  const minFrequency = options.frequency?.[0] ?? 1;
  const maxFrequency = options.frequency?.[1] ?? 4;
  const lines = Math.max(Math.round(options.lines), 1);

  for (let index = 0; index < lines; index += 1) {
    const lane = random() * across;
    const amplitude = across * options.amplitude * (0.5 + random());
    const frequency = minFrequency + Math.floor(random() * (maxFrequency - minFrequency + 1));
    const phase = random() * Math.PI * 2;
    const tone = options.tone(random());
    const alpha = options.alpha[0] + random() * (options.alpha[1] - options.alpha[0]);
    const steps = Math.round(along * (1 + scale * 0.05));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const wobble = Math.sin(t * Math.PI * 2 * frequency + phase) * amplitude;
      const offset = Math.round(lane + wobble);
      for (let thicknessIndex = 0; thicknessIndex < thickness; thicknessIndex += 1) {
        if (vertical) raster.blend(offset + thicknessIndex, step, tone, alpha);
        else raster.blend(step, offset + thicknessIndex, tone, alpha);
      }
    }
  }
}

interface SpeckleOptions {
  readonly count: number;
  readonly radius: readonly [number, number];
  readonly alpha: readonly [number, number];
  readonly tone: (t: number) => Rgb;
  /** Draw square chips (terrazzo) instead of round granules (cork). */
  readonly square?: boolean;
}

/** Scattered granules, speckle or aggregate chips. */
function speckle(context: PainterContext, options: SpeckleOptions): void {
  const { raster, random } = context;
  const count = Math.max(Math.round(options.count * (0.5 + context.scale / 6)), 1);
  for (let index = 0; index < count; index += 1) {
    const x = random() * raster.width;
    const y = random() * raster.height;
    const radius = options.radius[0] + random() * (options.radius[1] - options.radius[0]);
    const tone = options.tone(random());
    const alpha = options.alpha[0] + random() * (options.alpha[1] - options.alpha[0]);
    const span = Math.max(Math.round(radius), 1);
    const square = options.square === true;
    for (let dx = -span; dx <= span; dx += 1) {
      for (let dy = -span; dy <= span; dy += 1) {
        if (square || dx * dx + dy * dy <= span * span) {
          raster.blend(x + dx, y + dy, tone, alpha);
        }
      }
    }
  }
}

/** Brushed streaks along one axis (worn metal, chrome, painted steel). */
function brushed(context: PainterContext, options: { streaks: number; alpha: readonly [number, number]; tone: (t: number) => Rgb }): void {
  const { raster, vertical, random } = context;
  const across = vertical ? raster.width : raster.height;
  const along = vertical ? raster.height : raster.width;
  for (let index = 0; index < options.streaks; index += 1) {
    const lane = Math.round(random() * across);
    const tone = options.tone(random());
    const alpha = options.alpha[0] + random() * (options.alpha[1] - options.alpha[0]);
    const length = Math.round(along * (0.2 + random() * 0.8));
    const start = Math.round(random() * along);
    for (let step = 0; step < length; step += 1) {
      const position = start + step;
      if (vertical) raster.blend(lane, position, tone, alpha);
      else raster.blend(position, lane, tone, alpha);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Painters                                                                   */
/* -------------------------------------------------------------------------- */

const PAINTERS: Readonly<Record<FurnitureTextureKind, Painter>> = {
  /* Wood: growth bands, long grain, pores and the odd knot. */
  'wood-grain': (context) => {
    baseFill(context);
    const bands = Math.max(Math.round(context.scale), 2);
    const across = context.vertical ? context.raster.width : context.raster.height;
    const bandSize = across / bands;
    for (let index = 0; index < bands; index += 1) {
      const tone = mixRgb(
        context.base,
        context.random() < 0.5 ? context.accent : context.highlight,
        0.05 + context.random() * 0.14,
      );
      paintBand(context, index * bandSize, bandSize, tone, 0.5);
    }
    grain(context, {
      lines: Math.round(context.scale * 3),
      amplitude: 0.012,
      alpha: [0.16, 0.4],
      frequency: [1, 3],
      tone: (t) => mixRgb(context.base, t < 0.72 ? context.accent : context.detail, 0.3 + t * 0.45),
    });
    grain(context, {
      lines: Math.max(Math.round(context.scale * 0.5), 1),
      amplitude: 0.03,
      thickness: 2,
      alpha: [0.12, 0.26],
      frequency: [1, 2],
      tone: (t) => mixRgb(context.detail, context.accent, t * 0.35),
    });
    // Pores: short dashes broken along the grain.
    const pores = Math.round(context.scale * 6);
    for (let index = 0; index < pores; index += 1) {
      const x = context.random() * context.raster.width;
      const y = context.random() * context.raster.height;
      const length = 1 + Math.round(context.random() * 3);
      const tone = mixRgb(context.base, context.detail, 0.45 + context.random() * 0.4);
      for (let step = 0; step < length; step += 1) {
        if (context.vertical) context.raster.blend(x, y + step, tone, 0.3);
        else context.raster.blend(x + step, y, tone, 0.3);
      }
    }
    // Knots: two tight rings of darker fibre.
    const knots = context.random() < 0.5 ? 1 : 2;
    for (let index = 0; index < knots; index += 1) {
      const x = context.random() * context.raster.width;
      const y = context.random() * context.raster.height;
      speckle(context, { count: 3, radius: [1, 2.2], alpha: [0.3, 0.5], tone: () => context.detail });
      for (let ring = 1; ring <= 3; ring += 1) {
        const radius = ring * 1.6;
        for (let step = 0; step < 24; step += 1) {
          const angle = (step / 24) * Math.PI * 2;
          context.raster.blend(
            x + Math.cos(angle) * radius,
            y + Math.sin(angle) * radius,
            mixRgb(context.detail, context.accent, 0.3),
            0.34,
          );
        }
      }
    }
    context.raster.noise(context.random, context.contrast * 0.1);
  },

  /* Laminate: matt body, fine speckle, faint seams at the sheet edges. */
  laminate: (context) => {
    baseFill(context);
    speckle(context, {
      count: 210,
      radius: [0.4, 1],
      alpha: [0.06, 0.2],
      tone: (t) => mixRgb(context.base, t < 0.6 ? context.accent : context.highlight, 0.4 + t * 0.5),
    });
    const seams = Math.max(Math.round(context.scale / 2), 1);
    for (let index = 0; index < seams; index += 1) {
      const position = Math.round((context.raster.width / seams) * index);
      for (let step = 0; step < context.raster.height; step += 1) {
        context.raster.blend(position, step, context.detail, 0.18);
        context.raster.blend(position + 1, step, context.highlight, 0.12);
      }
    }
    context.raster.noise(context.random, context.contrast * 0.08);
  },

  /* Vinyl / leatherette: pebbled grain with a soft sheen. */
  vinyl: (context) => {
    baseFill(context);
    speckle(context, {
      count: 420,
      radius: [0.5, 1.4],
      alpha: [0.1, 0.26],
      tone: (t) => mixRgb(context.base, t < 0.55 ? context.detail : context.highlight, 0.3 + t * 0.4),
    });
    brushed(context, {
      streaks: Math.round(context.scale * 4),
      alpha: [0.04, 0.12],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.highlight : context.detail, 0.35),
    });
    // Stitch lines read as upholstery seams on booth backs and benches.
    const stitches = Math.max(Math.round(context.scale / 2), 1);
    for (let index = 0; index < stitches; index += 1) {
      const lane = Math.round((context.raster.height / stitches) * index);
      for (let step = 0; step < context.raster.width; step += 2) {
        context.raster.blend(step, lane, context.detail, 0.22);
      }
    }
    context.raster.noise(context.random, context.contrast * 0.09);
  },

  /* Wool / moquette: plain over-under weave with slubs. */
  'fabric-weave': (context) => {
    baseFill(context);
    const raster = context.raster;
    const cell = Math.max(Math.round(raster.width / (context.scale * 3)), 1);
    const warp = mixRgb(context.base, context.accent, 0.42);
    const weft = mixRgb(context.base, context.accent, 0.16);
    for (let y = 0; y < raster.height; y += cell) {
      for (let x = 0; x < raster.width; x += cell) {
        const light = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        raster.fillRect(x, y, cell, cell, light ? warp : weft, 0.55);
        raster.fillRect(x, y, cell, 1, light ? context.highlight : context.detail, 0.18);
        raster.fillRect(x, y, 1, cell, light ? context.detail : context.highlight, 0.16);
      }
    }
    // Slubs: thicker yarn crossings.
    for (let index = 0; index < Math.round(context.scale * 8); index += 1) {
      const x = context.random() * raster.width;
      const y = context.random() * raster.height;
      const tone = mixRgb(context.base, context.random() < 0.5 ? context.highlight : context.detail, 0.45);
      raster.fillRect(x, y, cell * 2, cell, tone, 0.3);
    }
    raster.noise(context.random, context.contrast * 0.12);
  },

  /* Cane webbing: strands crossing over a dark background. */
  cane: (context) => {
    baseFill(context, 0.35);
    const raster = context.raster;
    const cell = Math.max(Math.round(raster.width / (context.scale * 2)), 2);
    for (let y = 0; y < raster.height; y += cell) {
      for (let x = 0; x < raster.width; x += cell) {
        const hole = mixRgb(context.detail, context.base, 0.12);
        raster.fillRect(x + 1, y + 1, cell - 2, cell - 2, hole, 0.9);
      }
    }
    const strand = mixRgb(context.base, context.highlight, 0.45);
    for (let y = 0; y < raster.height; y += cell) {
      raster.fillRect(0, y, raster.width, Math.max(cell / 3, 1), strand, 0.75);
    }
    for (let x = 0; x < raster.width; x += cell) {
      raster.fillRect(x, 0, Math.max(cell / 3, 1), raster.height, mixRgb(strand, context.base, 0.3), 0.6);
    }
    raster.noise(context.random, context.contrast * 0.16);
  },

  /* Cork: pressed granules in warm browns. */
  cork: (context) => {
    baseFill(context);
    speckle(context, {
      count: 150,
      radius: [1, 2.6],
      alpha: [0.3, 0.6],
      tone: (t) => (t < 0.4 ? mixRgb(context.accent, context.detail, 0.4) : t < 0.8 ? context.highlight : context.detail),
    });
    speckle(context, {
      count: 260,
      radius: [0.4, 1],
      alpha: [0.2, 0.4],
      tone: () => mixRgb(context.accent, context.base, 0.4),
    });
    context.raster.noise(context.random, context.contrast * 0.14);
  },

  /* Linoleum: marbled body with printed veining. */
  linoleum: (context) => {
    baseFill(context);
    grain(context, {
      lines: Math.round(context.scale * 2),
      amplitude: 0.05,
      thickness: 3,
      alpha: [0.1, 0.24],
      frequency: [2, 5],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.detail : context.highlight, 0.4),
    });
    speckle(context, {
      count: 240,
      radius: [0.4, 1.2],
      alpha: [0.08, 0.22],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.accent : context.detail, 0.5),
    });
    context.raster.noise(context.random, context.contrast * 0.2);
  },

  /* Worn metal: brushed steel with scuffs, patches and scratches. */
  'worn-metal': (context) => {
    baseFill(context);
    brushed(context, {
      streaks: Math.round(context.scale * 14),
      alpha: [0.03, 0.14],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.highlight : context.detail, 0.45),
    });
    for (let index = 0; index < Math.max(Math.round(context.scale / 2), 2); index += 1) {
      const x = context.random() * context.raster.width;
      const y = context.random() * context.raster.height;
      const width = 4 + context.random() * 18;
      const height = 2 + context.random() * 8;
      context.raster.fillRect(
        x,
        y,
        width,
        height,
        mixRgb(context.base, context.random() < 0.5 ? context.highlight : context.detail, 0.3),
        0.16,
      );
    }
    for (let index = 0; index < Math.round(context.scale * 3); index += 1) {
      const x = context.random() * context.raster.width;
      const y = context.random() * context.raster.height;
      const length = 3 + context.random() * 20;
      context.raster.line(
        x,
        y,
        context.vertical ? x : x + length,
        context.vertical ? y + length : y,
        context.highlight,
        0.24,
      );
    }
    context.raster.noise(context.random, context.contrast * 0.12);
  },

  /* Chrome: a soft vertical reflection profile with brushed micro-lines. */
  chrome: (context) => {
    const raster = context.raster;
    const dark = mixRgb(context.base, context.detail, 0.75);
    const bright = mixRgb(context.base, context.highlight, 0.9);
    for (let y = 0; y < raster.height; y += 1) {
      const t = y / raster.height;
      // Two bright bands: the horizon reflection and the floor bounce.
      const horizon = Math.exp(-((t - 0.34) ** 2) / 0.006);
      const bounce = Math.exp(-((t - 0.78) ** 2) / 0.02);
      const tone = mixRgb(dark, bright, Math.min(horizon * 0.95 + bounce * 0.5 + 0.12, 1));
      for (let x = 0; x < raster.width; x += 1) {
        raster.blend(x, y, tone, 1);
      }
    }
    brushed(context, {
      streaks: Math.round(context.scale * 10),
      alpha: [0.02, 0.1],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.highlight : context.detail, 0.5),
    });
    raster.noise(context.random, context.contrast * 0.05);
  },

  /* Glass: only the tint and the sheen bands; the body stays transparent. */
  glass: (context) => {
    const raster = context.raster;
    if (!context.transparentBase) raster.fill(context.base, 0.12);
    const bands = Math.max(Math.round(context.scale), 2);
    for (let index = 0; index < bands; index += 1) {
      const start = (context.random() * raster.width * 2) - raster.width;
      const width = 2 + context.random() * 10;
      for (let step = -raster.height; step < raster.width; step += 1) {
        for (let offset = 0; offset < width; offset += 1) {
          raster.blend(step + offset, step, context.highlight, 0.16);
        }
      }
      void start;
    }
    raster.noise(context.random, context.contrast * 0.05);
  },

  /* Paint: brush-dragged body with chipped edges. */
  paint: (context) => {
    baseFill(context);
    brushed(context, {
      streaks: Math.round(context.scale * 12),
      alpha: [0.03, 0.1],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.highlight : context.detail, 0.4),
    });
    for (let index = 0; index < Math.round(context.scale * 1.5); index += 1) {
      const x = context.random() * context.raster.width;
      const y = context.random() * context.raster.height;
      speckle(context, { count: 1, radius: [0.6, 1.8], alpha: [0.16, 0.34], tone: () => mixRgb(context.base, context.accent, 0.5), square: true });
      void x;
      void y;
    }
    context.raster.noise(context.random, context.contrast * 0.12);
  },

  /* Terrazzo: light matrix full of angular chips. */
  terrazzo: (context) => {
    baseFill(context);
    speckle(context, {
      count: 120,
      radius: [1, 3],
      alpha: [0.5, 0.9],
      square: true,
      tone: (t) => {
        if (t < 0.33) return context.accent;
        if (t < 0.66) return context.detail;
        return context.highlight;
      },
    });
    speckle(context, {
      count: 200,
      radius: [0.4, 1],
      alpha: [0.25, 0.5],
      square: true,
      tone: () => mixRgb(context.base, context.accent, 0.6),
    });
    context.raster.noise(context.random, context.contrast * 0.08);
  },

  /* Stone: marble / granite matrix with veining. */
  stone: (context) => {
    baseFill(context);
    grain(context, {
      lines: Math.max(Math.round(context.scale), 2),
      amplitude: 0.09,
      thickness: 2,
      alpha: [0.14, 0.34],
      frequency: [1, 3],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.accent : context.detail, 0.5),
    });
    speckle(context, {
      count: 220,
      radius: [0.4, 1.1],
      alpha: [0.07, 0.2],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.detail : context.highlight, 0.55),
    });
    context.raster.noise(context.random, context.contrast * 0.14);
  },

  /* Print: the cover of a magazine or the panel of a menu card. */
  print: (context) => {
    baseFill(context, 0.96);
    const raster = context.raster;
    const coverHeight = raster.height * 0.44;
    raster.fillRect(raster.width * 0.1, raster.height * 0.08, raster.width * 0.8, coverHeight, context.accent, 0.85);
    raster.fillRect(raster.width * 0.1, raster.height * 0.08 + coverHeight * 0.62, raster.width * 0.8, coverHeight * 0.38, mixRgb(context.accent, context.detail, 0.5), 0.7);
    const titleLines = 2;
    for (let index = 0; index < titleLines; index += 1) {
      raster.fillRect(
        raster.width * 0.14,
        raster.height * 0.1 + index * (coverHeight * 0.24),
        raster.width * (0.2 + context.random() * 0.45),
        Math.max(raster.height * 0.035, 1),
        context.highlight,
        0.85,
      );
    }
    const textTop = raster.height * 0.58;
    const rows = 9;
    for (let row = 0; row < rows; row += 1) {
      const y = textTop + row * (raster.height * 0.042);
      let x = raster.width * 0.12;
      const rowWidth = raster.width * (0.4 + context.random() * 0.5);
      while (x < raster.width * 0.12 + rowWidth) {
        const wordWidth = raster.width * (0.05 + context.random() * 0.12);
        raster.fillRect(x, y, wordWidth, Math.max(raster.height * 0.014, 1), context.detail, 0.6);
        x += wordWidth + raster.width * 0.03;
      }
    }
    raster.noise(context.random, context.contrast * 0.06);
  },

  /* Foliage: overlapping leaf blades in two greens. */
  foliage: (context) => {
    const raster = context.raster;
    raster.fill(context.base, 0.9);
    const blades = Math.round(context.scale * 26);
    for (let index = 0; index < blades; index += 1) {
      const x = context.random() * raster.width;
      const y = context.random() * raster.height;
      const length = 3 + context.random() * (raster.width * 0.16);
      const angle = context.random() * Math.PI * 2;
      const tone = mixRgb(context.base, context.random() < 0.5 ? context.accent : context.highlight, 0.35 + context.random() * 0.5);
      raster.line(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, tone, 0.5);
      raster.line(x, y + 1, x + Math.cos(angle) * length, y + 1 + Math.sin(angle) * length, mixRgb(tone, context.detail, 0.4), 0.3);
    }
    // A central vein, so a leaf face still reads as foliage.
    raster.line(raster.width * 0.5, 0, raster.width * 0.5, raster.height, mixRgb(context.highlight, context.base, 0.3), 0.3);
    raster.noise(context.random, context.contrast * 0.16);
  },
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Paints `style` into an RGBA raster (deterministic for a given style). */
export function paintFurnitureSurface(style: FurnitureTextureStyle): Raster {
  const size = clampSize(style.size ?? DEFAULT_FURNITURE_TEXTURE_SIZE);
  const palette = resolvePalette(style.palette);
  const random = createSeededRandom(
    style.seed ??
      hashString(
        `${style.kind}|${style.palette.base}|${style.palette.accent}|${style.scale ?? 4}|${style.orientation ?? 'horizontal'}`,
      ),
  );
  const raster = new Raster(size, size);
  const painter = PAINTERS[style.kind];
  painter({
    raster,
    ...palette,
    scale: Math.min(Math.max(style.scale ?? 4, 1), 32),
    contrast: Math.min(Math.max(style.contrast ?? 0.16, 0), 1),
    vertical: style.orientation === 'vertical',
    transparentBase: style.transparency === 'pattern',
    random,
  });
  return raster;
}

function applyTextureSettings(
  texture: THREE.Texture,
  key: string,
  style: FurnitureTextureStyle,
  options: FurnitureTextureOptions,
  source: 'canvas' | 'data',
): void {
  const repeat = style.repeat ?? [1, 1];
  texture.name = `${FURNITURE_TEXTURE_PREFIX}${key}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(Number.isFinite(repeat[0]) ? repeat[0] : 1, Number.isFinite(repeat[1]) ? repeat[1] : 1);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (options.anisotropy !== undefined && Number.isFinite(options.anisotropy)) {
    texture.anisotropy = Math.max(Math.trunc(options.anisotropy), 1);
  }
  texture.needsUpdate = true;
  texture.userData = {
    furniture: {
      key,
      kind: style.kind,
      procedural: true,
      source,
    },
  };
}

/**
 * Paints `style` and returns it as a texture. Uses the canvas backend when
 * `options.canvasFactory` (or the DOM) provides one, otherwise a `DataTexture`.
 */
export function createFurnitureTexture(
  style: FurnitureTextureStyle,
  options: FurnitureTextureOptions = {},
): FurnitureTexture {
  const width = clampSize(style.size ?? DEFAULT_FURNITURE_TEXTURE_SIZE);
  const height = clampSize(options.height ?? width);
  const pixels = paintFurnitureSurface({ ...style, size: width });
  const key = options.key ?? style.kind;
  const factory = options.canvasFactory ?? defaultCanvasFactory;

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = factory(width, height);
  } catch {
    canvas = null;
  }
  const context = canvas ? canvas.getContext('2d') : null;

  if (canvas && context) {
    const image = context.createImageData(width, height);
    image.data.set(pixels.data);
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    applyTextureSettings(texture, key, style, options, 'canvas');
    return { key, kind: style.kind, width, height, source: 'canvas', texture, canvas };
  }

  const texture = new THREE.DataTexture(pixels.data, width, height, THREE.RGBAFormat);
  // Data textures upload bottom-up; these patterns tile, so the default
  // orientation is kept (matching the shell's finish pipeline).
  applyTextureSettings(texture, key, style, options, 'data');
  return { key, kind: style.kind, width, height, source: 'data', texture, canvas: null };
}

/** True when `texture` came from this module's procedural pipeline. */
export function isFurnitureTexture(texture: THREE.Texture): boolean {
  return (
    (texture instanceof THREE.DataTexture || texture instanceof THREE.CanvasTexture) &&
    texture.name.startsWith(FURNITURE_TEXTURE_PREFIX)
  );
}

/** Number of distinct 32 bit pixel values in a raster (used by the tests). */
export function distinctPixelColors(raster: Raster): number {
  const seen = new Set<number>();
  const data = raster.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    seen.add(
      (((data[offset] ?? 0) << 24) |
        ((data[offset + 1] ?? 0) << 16) |
        ((data[offset + 2] ?? 0) << 8) |
        (data[offset + 3] ?? 0)) >>>
        0,
    );
  }
  return seen.size;
}
