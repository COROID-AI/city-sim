/**
 * Procedural tableware surfaces, material slots and the era material set.
 *
 * Every surface in the tableware domain is painted here, pixel by pixel: glazed
 * china and crazed utility ware, vitreous porcelain, speckled stoneware, clear
 * and tinted glass, printed paper and kraft corrugation, cardboard sleeves,
 * moulded plastic, stainless and plated cutlery, chipped enamel, chrome,
 * bakelite, bamboo, napkin weave, sugar, sauce and silicone. Nothing is fetched
 * — at build time or at runtime — so the module works offline, in a headless
 * node process and in the browser from the same bytes.
 *
 * The same raster feeds two backends, exactly mirroring the shell's and the
 * furniture's finish pipelines:
 *
 *  - **canvas** — when a DOM canvas (or an injected {@link CanvasFactory}) is
 *    available the raster is blitted with `putImageData` and wrapped in a
 *    `CanvasTexture`.
 *  - **data** — with no canvas (headless node, the composition suites) the bytes
 *    become a `DataTexture`.
 *
 * Both paths are deterministic: every painter draws from a seeded PRNG derived
 * from the style (kind, palette, scale, orientation, mark), so an era's table
 * looks identical on every run and tests can assert real pixel content. Pattern
 * painters wrap at the texture edges so finishes tile without seams; the mark
 * painter ({@link paintMark}) clips instead, so printed corner logos and sachet
 * lettering stay crisp.
 */

import * as THREE from 'three';
import { createSeededRandom } from '../../core/kernel';
import type { YearId } from '../../contracts/period';

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
  silver: 0xc0c0c0,
  gold: 0xd4af37,
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

/** Painter used for one tableware surface family. */
export type TablewareTextureKind =
  | 'glaze'
  | 'stoneware'
  | 'glass'
  | 'paper'
  | 'flute'
  | 'card'
  | 'plastic'
  | 'steel'
  | 'plated'
  | 'enamel'
  | 'chrome'
  | 'bakelite'
  | 'wood'
  | 'weave'
  | 'print'
  | 'granular'
  | 'rubber'
  | 'sauce';

/** Colour vocabulary of a tableware surface. */
export interface TablewareTexturePalette {
  /** Body colour of the material. */
  readonly base: string;
  /** Rim band, print, speckle or weave colour. */
  readonly accent: string;
  /** Craze, scratch, shadow or chip colour (defaults to a darkened `base`). */
  readonly detail?: string;
  /** Sheen, glaze highlight or porcelain bloom (defaults to a lightened `base`). */
  readonly highlight?: string;
}

/** Complete recipe for one procedural tableware finish. */
export interface TablewareTextureStyle {
  readonly kind: TablewareTextureKind;
  readonly palette: TablewareTexturePalette;
  /** Pattern repetitions along one texture edge (default 4). */
  readonly scale?: number;
  /** Noise strength, 0..1 (default 0.14). */
  readonly contrast?: number;
  /** Band direction (default `'horizontal'`). */
  readonly orientation?: 'horizontal' | 'vertical';
  /** UV repetition of the finished texture across a surface (default `[1, 1]`). */
  readonly repeat?: readonly [number, number];
  /** Square texture resolution in pixels (default {@link DEFAULT_TABLEWARE_TEXTURE_SIZE}). */
  readonly size?: number;
  /** Printed word or corner-logo lettering painted by the mark-aware painters. */
  readonly mark?: string;
  /** Explicit paint seed; defaults to a hash of the style. */
  readonly seed?: number;
}

/** Default square texture resolution. Small on purpose: these are procedural. */
export const DEFAULT_TABLEWARE_TEXTURE_SIZE = 128;

/** Every texture this module creates is named with this prefix. */
export const TABLEWARE_TEXTURE_PREFIX = 'tableware:';

/** Canvas factory used to reach the browser's 2D backend. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/**
 * Default factory: a DOM canvas when the document exists, otherwise `null`,
 * which makes {@link createTablewareTexture} fall back to a `DataTexture`.
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
export interface TablewareTexture {
  readonly key: string;
  readonly kind: TablewareTextureKind;
  readonly width: number;
  readonly height: number;
  /** Which backend produced the texture. */
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  /** The 2D canvas when the canvas backend was used, otherwise `null`. */
  readonly canvas: HTMLCanvasElement | null;
}

export interface TablewareTextureOptions {
  /** Texture key, used for `texture.name` (`tableware:<key>`). Defaults to the kind. */
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
  if (!Number.isFinite(value)) return DEFAULT_TABLEWARE_TEXTURE_SIZE;
  return Math.min(Math.max(Math.trunc(value), 8), 512);
}

/**
 * Tiny RGBA raster with the handful of primitives the painters need. `blend` and
 * every pattern helper wrap at the edges so finishes tile seamlessly; `pixel`
 * and `strokeLine` clip instead, which is what the printed marks need.
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

  private wrapIndex(x: number, y: number): number {
    const wrappedX = ((Math.trunc(x) % this.width) + this.width) % this.width;
    const wrappedY = ((Math.trunc(y) % this.height) + this.height) % this.height;
    return (wrappedY * this.width + wrappedX) * 4;
  }

  private clipIndex(x: number, y: number): number {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (px < 0 || px >= this.width || py < 0 || py >= this.height) return -1;
    return (py * this.width + px) * 4;
  }

  /** Alpha-blends `color` into the pixel at (`x`, `y`), wrapping at the edges. */
  blend(x: number, y: number, color: Rgb, alpha = 1): this {
    const amount = Math.min(Math.max(alpha, 0), 1);
    if (amount <= 0) return this;
    const offset = this.wrapIndex(x, y);
    const inverse = 1 - amount;
    const data = this.data;
    data[offset] = (data[offset] ?? 0) * inverse + color.r * amount;
    data[offset + 1] = (data[offset + 1] ?? 0) * inverse + color.g * amount;
    data[offset + 2] = (data[offset + 2] ?? 0) * inverse + color.b * amount;
    data[offset + 3] = (data[offset + 3] ?? 0) * inverse + 255 * amount;
    return this;
  }

  /** Alpha-blends `color` into the pixel at (`x`, `y`), clipping outside. */
  pixel(x: number, y: number, color: Rgb, alpha = 1): this {
    const amount = Math.min(Math.max(alpha, 0), 1);
    if (amount <= 0) return this;
    const offset = this.clipIndex(x, y);
    if (offset < 0) return this;
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
  fillWrap(x: number, y: number, width: number, height: number, color: Rgb, alpha = 1): this {
    const spanX = Math.max(Math.round(width), 0);
    const spanY = Math.max(Math.round(height), 0);
    for (let dy = 0; dy < spanY; dy += 1) {
      for (let dx = 0; dx < spanX; dx += 1) {
        this.blend(Math.round(x) + dx, Math.round(y) + dy, color, alpha);
      }
    }
    return this;
  }

  /** Draws a clipped line with a round nib of `thickness` pixels. */
  strokeLine(x0: number, y0: number, x1: number, y1: number, color: Rgb, alpha = 1, thickness = 1): this {
    const steps = Math.max(Math.abs(Math.round(x1 - x0)), Math.abs(Math.round(y1 - y0)), 1);
    const nib = Math.max(thickness / 2, 0.5);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (nib <= 0.5) {
        this.pixel(x, y, color, alpha);
        continue;
      }
      const span = Math.ceil(nib);
      for (let dx = -span; dx <= span; dx += 1) {
        for (let dy = -span; dy <= span; dy += 1) {
          if (dx * dx + dy * dy <= nib * nib) this.pixel(x + dx, y + dy, color, alpha);
        }
      }
    }
    return this;
  }

  /** Filled clipped disc. */
  disc(cx: number, cy: number, radius: number, color: Rgb, alpha = 1): this {
    const span = Math.max(Math.ceil(radius), 0);
    for (let dx = -span; dx <= span; dx += 1) {
      for (let dy = -span; dy <= span; dy += 1) {
        if (dx * dx + dy * dy <= radius * radius) this.pixel(cx + dx, cy + dy, color, alpha);
      }
    }
    return this;
  }

  /** Ring of `thickness` pixels at `radius`, drawn with wrapping. */
  ring(cx: number, cy: number, radius: number, thickness: number, color: Rgb, alpha = 1): this {
    const steps = Math.max(Math.round(radius * Math.PI * 2), 24);
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      this.disc(x, y, Math.max(thickness / 2, 0.5), color, alpha);
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
/* Lettering: a 5 x 7 stroked font for printed marks                          */
/* -------------------------------------------------------------------------- */

/**
 * Upper case glyphs on a 5 x 7 grid (origin top-left) as flat segment lists
 * `[x0, y0, x1, y1, ...]`. Small enough to stay in this file, legible at the
 * 2-4 pixel stroke widths the marks are painted at.
 */
const MARK_GLYPHS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  A: [0, 6, 2, 0, 2, 0, 4, 6, 1, 4, 3, 4],
  B: [0, 0, 0, 6, 0, 0, 3, 0, 3, 0, 4, 2, 4, 2, 3, 3, 3, 3, 0, 3, 0, 3, 3, 4, 3, 4, 4, 5, 4, 5, 3, 6, 3, 6, 0, 6],
  C: [4, 1, 3, 0, 3, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 5, 0, 5, 1, 6, 1, 6, 3, 6, 3, 6, 4, 5],
  D: [0, 0, 0, 6, 0, 0, 3, 0, 3, 0, 4, 1, 4, 1, 4, 5, 4, 5, 3, 6, 3, 6, 0, 6],
  E: [4, 0, 0, 0, 0, 0, 0, 6, 0, 6, 4, 6, 0, 3, 3, 3],
  F: [4, 0, 0, 0, 0, 0, 0, 6, 0, 3, 3, 3],
  G: [4, 1, 3, 0, 3, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 5, 0, 5, 1, 6, 1, 6, 3, 6, 3, 6, 4, 5, 4, 5, 4, 3, 4, 3, 2, 3],
  H: [0, 0, 0, 6, 4, 0, 4, 6, 0, 3, 4, 3],
  I: [1, 0, 3, 0, 2, 0, 2, 6, 1, 6, 3, 6],
  J: [3, 0, 3, 5, 3, 5, 2, 6, 2, 6, 1, 6, 1, 6, 0, 5],
  K: [0, 0, 0, 6, 4, 0, 0, 3, 0, 3, 4, 6],
  L: [0, 0, 0, 6, 0, 6, 4, 6],
  M: [0, 6, 0, 0, 0, 0, 2, 2, 2, 2, 4, 0, 4, 0, 4, 6],
  N: [0, 6, 0, 0, 0, 0, 4, 6, 4, 6, 4, 0],
  O: [1, 0, 3, 0, 3, 0, 4, 1, 4, 1, 4, 5, 4, 5, 3, 6, 3, 6, 1, 6, 1, 6, 0, 5, 0, 5, 0, 1, 0, 1, 1, 0],
  P: [0, 6, 0, 0, 0, 0, 3, 0, 3, 0, 4, 1, 4, 1, 4, 2, 4, 2, 3, 3, 3, 3, 0, 3],
  Q: [1, 0, 3, 0, 3, 0, 4, 1, 4, 1, 4, 5, 4, 5, 3, 6, 3, 6, 1, 6, 1, 6, 0, 5, 0, 5, 0, 1, 0, 1, 1, 0, 2, 4, 4, 6],
  R: [0, 6, 0, 0, 0, 0, 3, 0, 3, 0, 4, 1, 4, 1, 4, 2, 4, 2, 3, 3, 3, 3, 0, 3, 1, 3, 4, 6],
  S: [4, 1, 3, 0, 3, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 2, 1, 2, 3, 3, 3, 3, 4, 4, 4, 4, 3, 6, 3, 6, 1, 6, 1, 6, 0, 5],
  T: [0, 0, 4, 0, 2, 0, 2, 6],
  U: [0, 0, 0, 5, 0, 5, 1, 6, 1, 6, 3, 6, 3, 6, 4, 5, 4, 5, 4, 0],
  V: [0, 0, 2, 6, 2, 6, 4, 0],
  W: [0, 0, 1, 6, 1, 6, 2, 4, 2, 4, 3, 6, 3, 6, 4, 0],
  X: [0, 0, 4, 6, 4, 0, 0, 6],
  Y: [0, 0, 2, 3, 4, 0, 2, 3, 2, 3, 2, 6],
  Z: [0, 0, 4, 0, 4, 0, 0, 6, 0, 6, 4, 6],
  '0': [1, 0, 3, 0, 3, 0, 4, 1, 4, 1, 4, 5, 4, 5, 3, 6, 3, 6, 1, 6, 1, 6, 0, 5, 0, 5, 0, 1, 0, 1, 1, 0, 0, 5, 4, 1],
  '1': [1, 1, 2, 0, 2, 0, 2, 6, 1, 6, 3, 6],
  '2': [0, 1, 1, 0, 1, 0, 3, 0, 3, 0, 4, 1, 4, 1, 4, 2, 4, 2, 0, 6, 0, 6, 4, 6],
  '3': [0, 0, 4, 0, 4, 0, 2, 3, 2, 3, 4, 5, 4, 5, 3, 6, 3, 6, 1, 6, 1, 6, 0, 5],
  '4': [3, 6, 3, 0, 3, 0, 0, 4, 0, 4, 4, 4],
  '5': [4, 0, 0, 0, 0, 0, 0, 3, 0, 3, 3, 3, 3, 3, 4, 4, 4, 4, 3, 6, 3, 6, 1, 6, 1, 6, 0, 5],
  '6': [4, 1, 3, 0, 3, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 5, 0, 5, 1, 6, 1, 6, 3, 6, 3, 6, 4, 5, 4, 5, 3, 4, 3, 4, 0, 4],
  '7': [0, 0, 4, 0, 4, 0, 2, 6],
  '8': [1, 0, 3, 0, 3, 0, 4, 1, 4, 1, 3, 3, 3, 3, 1, 3, 1, 3, 0, 1, 0, 1, 1, 0, 1, 3, 3, 3, 3, 3, 4, 4, 4, 4, 3, 6, 3, 6, 1, 6, 1, 6, 0, 5, 0, 5, 1, 3],
  '9': [4, 1, 3, 0, 3, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 3, 1, 3, 4, 3, 4, 3, 4, 5, 4, 5, 3, 6, 3, 6, 1, 6, 1, 6, 0, 5],
  '-': [1, 3, 3, 3],
  '.': [2, 5, 2, 6],
  "'": [2, 0, 2, 2],
  ':': [2, 2, 2, 3, 2, 4, 2, 5],
  '/': [4, 0, 0, 6],
  '&': [4, 6, 1, 3, 1, 3, 2, 1, 2, 1, 3, 2, 3, 2, 0, 6, 0, 6, 2, 6, 2, 6, 3, 5],
  ' ': [],
});

/** Width in pixels of `text` painted at `scale`. */
export function markWidth(text: string, scale: number, tracking = 1): number {
  return Math.max(text.length * 6 - 1, 0) * scale * tracking;
}

export interface MarkOptions {
  readonly x: number;
  readonly y: number;
  /** Pixels per font unit (glyphs are 5 x 7 units). */
  readonly scale: number;
  readonly color: Rgb;
  readonly alpha?: number;
  /** Horizontal advance multiplier (default 1). */
  readonly tracking?: number;
}

/** Paints `text` with the stroked mark font, clipping at the raster edges. */
export function paintMark(raster: Raster, text: string, options: MarkOptions): void {
  const alpha = options.alpha ?? 1;
  const tracking = options.tracking ?? 1;
  const thickness = Math.max(options.scale * 0.8, 1);
  let cursor = options.x;
  for (const character of text.toUpperCase()) {
    const glyph = MARK_GLYPHS[character];
    if (glyph && glyph.length > 0) {
      for (let index = 0; index + 3 < glyph.length; index += 4) {
        raster.strokeLine(
          cursor + (glyph[index] ?? 0) * options.scale,
          options.y + (glyph[index + 1] ?? 0) * options.scale,
          cursor + (glyph[index + 2] ?? 0) * options.scale,
          options.y + (glyph[index + 3] ?? 0) * options.scale,
          options.color,
          alpha,
          thickness,
        );
      }
    }
    cursor += 6 * options.scale * tracking;
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
  /** Printed word; empty when the finish carries no mark. */
  readonly mark: string;
  readonly random: () => number;
}

type Painter = (context: PainterContext) => void;

interface Palette {
  readonly base: Rgb;
  readonly accent: Rgb;
  readonly detail: Rgb;
  readonly highlight: Rgb;
}

function resolvePalette(palette: TablewareTexturePalette): Palette {
  const base = parseColor(palette.base);
  const accent = parseColor(palette.accent);
  return {
    base,
    accent,
    detail: palette.detail ? parseColor(palette.detail) : shade(base, 0.6),
    highlight: palette.highlight ? parseColor(palette.highlight) : shade(base, 1.3),
  };
}

/** Fills the body of the raster before the detail is painted over it. */
function baseFill(context: PainterContext, alpha = 1): void {
  context.raster.fill(context.base, alpha);
}

/** Straight line that wraps at the edges, used by the tiling pattern painters. */
function lineWrap(
  raster: Raster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgb,
  alpha: number,
): void {
  const steps = Math.max(Math.abs(Math.round(x1 - x0)), Math.abs(Math.round(y1 - y0)), 1);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    raster.blend(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color, alpha);
  }
}

/** Evenly spaced tonal bands across (or along) the texture, wrapping at the edges. */
function bands(context: PainterContext, count: number, tone: (t: number) => Rgb, alpha: number): void {
  const { raster, vertical } = context;
  const along = vertical ? raster.width : raster.height;
  const span = along / Math.max(count, 1);
  for (let index = 0; index < count; index += 1) {
    const toneColor = tone(index / Math.max(count - 1, 1));
    const start = Math.round(index * span);
    for (let step = 0; step < Math.ceil(span); step += 1) {
      const offset = start + step;
      if (vertical) raster.fillWrap(offset, 0, 1, raster.height, toneColor, alpha);
      else raster.fillWrap(0, offset, raster.width, 1, toneColor, alpha);
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

/** Long wandering lines following the band direction (timber, wear, crazing). */
function grain(context: PainterContext, options: GrainOptions): void {
  const { raster, vertical, random, scale } = context;
  const along = vertical ? raster.height : raster.width;
  const across = vertical ? raster.width : raster.height;
  const thickness = Math.max(Math.trunc(options.thickness ?? 1), 1);
  const minFrequency = options.frequency?.[0] ?? 1;
  const maxFrequency = options.frequency?.[1] ?? 3;
  const lines = Math.max(Math.round(options.lines), 1);

  for (let index = 0; index < lines; index += 1) {
    const lane = random() * across;
    const amplitude = across * options.amplitude * (0.5 + random());
    const frequency = minFrequency + Math.floor(random() * (maxFrequency - minFrequency + 1));
    const phase = random() * Math.PI * 2;
    const tone = options.tone(random());
    const alpha = options.alpha[0] + random() * (options.alpha[1] - options.alpha[0]);
    const steps = Math.round(along * (1 + scale * 0.05));
    let previousAlong = 0;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const wobble = Math.sin(t * Math.PI * 2 * frequency + phase) * amplitude;
      const offset = lane + wobble;
      if (step > 0) {
        for (let thicknessIndex = 0; thicknessIndex < thickness; thicknessIndex += 1) {
          if (vertical) {
            lineWrap(raster, offset + thicknessIndex, previousAlong, offset + thicknessIndex, step, tone, alpha);
          } else {
            lineWrap(raster, previousAlong, offset + thicknessIndex, step, offset + thicknessIndex, tone, alpha);
          }
        }
      }
      previousAlong = step;
    }
  }
}

interface SpeckleOptions {
  readonly count: number;
  readonly radius: readonly [number, number];
  readonly alpha: readonly [number, number];
  readonly tone: (t: number) => Rgb;
  /** Draw square flecks instead of round granules. */
  readonly square?: boolean;
}

/** Scattered flecks, clay speckle, tarnish or granules. */
function speckle(context: PainterContext, options: SpeckleOptions): void {
  const { raster, random } = context;
  const count = Math.max(Math.round(options.count * (0.6 + context.scale / 8)), 1);
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
        if (square || dx * dx + dy * dy <= span * span) raster.blend(x + dx, y + dy, tone, alpha);
      }
    }
  }
}

/** Brushed streaks along one axis (stainless, plated and enamelled metal). */
function brushed(context: PainterContext, options: { streaks: number; alpha: readonly [number, number]; tone: (t: number) => Rgb }): void {
  const { raster, vertical, random } = context;
  const across = vertical ? raster.width : raster.height;
  const along = vertical ? raster.height : raster.width;
  for (let index = 0; index < options.streaks; index += 1) {
    const lane = Math.round(random() * across);
    const tone = options.tone(random());
    const alpha = options.alpha[0] + random() * (options.alpha[1] - options.alpha[0]);
    const length = Math.round(along * (0.25 + random() * 0.75));
    const start = Math.round(random() * along);
    for (let step = 0; step < length; step += 1) {
      const position = start + step;
      if (vertical) {
        raster.blend(lane, position, tone, alpha);
        if (random() < 0.4) raster.blend(lane + 1, position, tone, alpha * 0.6);
      } else {
        raster.blend(position, lane, tone, alpha);
        if (random() < 0.4) raster.blend(position, lane + 1, tone, alpha * 0.6);
      }
    }
  }
}

/** Vertical flutes of a corrugated wall: a ridge, a shadow and a slight glare. */
function flutes(context: PainterContext, options: { count: number; depth: number }): void {
  const { raster, random } = context;
  const count = Math.max(Math.round(options.count), 2);
  const span = raster.width / count;
  for (let index = 0; index < count; index += 1) {
    const start = index * span;
    const jitter = 0.85 + random() * 0.3;
    for (let dx = 0; dx < Math.ceil(span); dx += 1) {
      const t = dx / span;
      const ridge = Math.sin(t * Math.PI);
      const shadeTone = ridge < 0.5 ? context.detail : context.highlight;
      const alpha = (0.05 + Math.abs(ridge - 0.5) * options.depth) * jitter;
      for (let y = 0; y < raster.height; y += 1) {
        raster.blend(start + dx, y, shadeTone, Math.min(alpha, 0.5));
      }
    }
  }
}

/** Fine craze network of a glazed body. */
function crazing(context: PainterContext, options: { lines: number; tone: Rgb; alpha: number }): void {
  const { raster, random } = context;
  const lines = Math.max(Math.round(options.lines), 1);
  for (let index = 0; index < lines; index += 1) {
    let x = random() * raster.width;
    let y = random() * raster.height;
    const steps = 3 + Math.floor(random() * 5);
    for (let step = 0; step < steps; step += 1) {
      const nextX = x + (random() - 0.5) * 16;
      const nextY = y + (random() - 0.5) * 16;
      lineWrap(raster, x, y, nextX, nextY, options.tone, options.alpha);
      x = nextX;
      y = nextY;
    }
  }
}

/** Trapped bubbles and streaks inside a glass wall. */
function inclusions(context: PainterContext, options: { bubbles: number; streaks: number }): void {
  const { raster, random } = context;
  for (let index = 0; index < options.bubbles; index += 1) {
    const x = random() * raster.width;
    const y = random() * raster.height;
    const radius = 1 + random() * 2.4;
    raster.ring(x, y, radius, 1, context.highlight, 0.22 + random() * 0.2);
    raster.disc(x - radius * 0.3, y - radius * 0.3, Math.max(radius * 0.35, 0.5), context.highlight, 0.18);
  }
  for (let index = 0; index < options.streaks; index += 1) {
    const x = random() * raster.width;
    const y = random() * raster.height;
    const length = 8 + random() * 30;
    const angle = (random() - 0.5) * 0.6 + (context.vertical ? Math.PI / 2 : 0);
    lineWrap(
      raster,
      x,
      y,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
      context.highlight,
      0.08 + random() * 0.1,
    );
  }
}

interface LogoOptions {
  readonly text: string;
  /** Pixels per font unit. */
  readonly scale: number;
  readonly centerY: number;
  readonly color: Rgb;
  readonly alpha?: number;
  /** Draw the printed ring behind the word (default true). */
  readonly ring?: boolean;
}

/** Paints an era's printed corner logo: an optional ring plus its word. */
function logo(context: PainterContext, options: LogoOptions): void {
  const { raster } = context;
  const text = options.text.trim().toUpperCase();
  if (text.length === 0) return;
  const alpha = options.alpha ?? 0.85;
  const scale = Math.max(options.scale, 1);
  const width = markWidth(text, scale);
  const x = Math.max((raster.width - width) / 2, 1);
  if (options.ring !== false) {
    const radius = Math.max(scale * 4.5, 5);
    const centerY = options.centerY + scale * 3;
    raster.ring(raster.width / 2, centerY, radius, Math.max(scale * 0.6, 1), options.color, alpha * 0.45);
  }
  paintMark(raster, text, { x, y: options.centerY, scale, color: options.color, alpha });
}

/** Rows of tiny dashes that read as small print on sachets and cards. */
function smallPrint(context: PainterContext, options: { rows: number; tone: Rgb; alpha: number }): void {
  const { raster, random } = context;
  const rows = Math.max(Math.round(options.rows), 1);
  const rowHeight = raster.height * 0.55;
  for (let row = 0; row < rows; row += 1) {
    let x = raster.width * 0.16;
    const y = raster.height * 0.62 + (row / rows) * rowHeight;
    while (x < raster.width * 0.84) {
      const length = 2 + Math.round(random() * 5);
      for (let step = 0; step < length; step += 1) {
        raster.pixel(x + step, y, options.tone, options.alpha);
      }
      x += length + 2;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Painters                                                                   */
/* -------------------------------------------------------------------------- */

const PAINTERS: Readonly<Record<TablewareTextureKind, Painter>> = {
  /* Glazed china and porcelain: pooled glaze, a sheen bloom and fine crazing. */
  glaze: (context) => {
    baseFill(context);
    const { raster } = context;
    const edge = Math.max(Math.round(raster.height * 0.06), 1);
    raster.fillWrap(0, 0, raster.width, edge, context.highlight, 0.16);
    raster.fillWrap(0, raster.height - edge, raster.width, edge, context.highlight, 0.1);
    raster.disc(raster.width * 0.34, raster.height * 0.42, raster.width * 0.22, context.highlight, 0.06);
    crazing(context, {
      lines: Math.round(5 + context.scale * 2),
      tone: context.detail,
      alpha: 0.04 + context.contrast * 0.12,
    });
    if (context.mark) {
      logo(context, {
        text: context.mark,
        scale: Math.max(Math.round(raster.height / 34), 1),
        centerY: raster.height * 0.4,
        color: context.accent,
      });
    }
    raster.noise(context.random, 0.02 + context.contrast * 0.05);
  },

  /* Stoneware: throwing rings, a speckled clay body and a rolled rim shadow. */
  stoneware: (context) => {
    baseFill(context);
    bands(context, Math.max(Math.round(context.scale * 2), 3), (t) => mixRgb(context.base, t < 0.5 ? context.highlight : context.detail, 0.12), 0.12);
    speckle(context, {
      count: 34,
      radius: [0.5, 1.5],
      alpha: [0.12, 0.34],
      tone: (t) => mixRgb(context.base, t < 0.6 ? context.detail : context.highlight, 0.5),
    });
    grain(context, {
      lines: Math.round(context.scale * 2),
      amplitude: 0.006,
      alpha: [0.06, 0.14],
      frequency: [1, 2],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.detail : context.highlight, 0.3),
    });
    if (context.mark) {
      logo(context, {
        text: context.mark,
        scale: Math.max(Math.round(context.raster.height / 32), 1),
        centerY: context.raster.height * 0.4,
        color: context.accent,
        alpha: 0.8,
      });
    }
    context.raster.noise(context.random, 0.03 + context.contrast * 0.06);
  },

  /* Glass: a vertical glare, trapped bubbles and faint wiping streaks. */
  glass: (context) => {
    baseFill(context);
    const { raster } = context;
    raster.fillWrap(0, 0, Math.max(Math.round(raster.width * 0.22), 1), raster.height, context.highlight, 0.1);
    raster.fillWrap(Math.max(Math.round(raster.width * 0.62), 1), 0, Math.max(Math.round(raster.width * 0.14), 1), raster.height, context.highlight, 0.06);
    inclusions(context, { bubbles: Math.round(4 + context.scale), streaks: Math.round(context.scale * 1.4) });
    context.raster.noise(context.random, 0.02 + context.contrast * 0.04);
  },

  /* Printed paper: a warm body, a rolled rim shadow and the era's logo band. */
  paper: (context) => {
    baseFill(context);
    const { raster } = context;
    const rim = Math.max(Math.round(raster.height * 0.07), 1);
    raster.fillWrap(0, 0, raster.width, rim, context.detail, 0.18);
    raster.fillWrap(0, rim, raster.width, Math.max(Math.round(raster.height * 0.02), 1), context.highlight, 0.22);
    for (let index = 0; index < 90; index += 1) {
      const x = context.random() * raster.width;
      const y = context.random() * raster.height;
      const length = 2 + context.random() * 5;
      const angle = context.random() * Math.PI;
      lineWrap(
        raster,
        x,
        y,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
        context.random() < 0.5 ? context.detail : context.highlight,
        0.05,
      );
    }
    logo(context, {
      text: context.mark || 'CAFE',
      scale: Math.max(Math.round(raster.height / 26), 1),
      centerY: raster.height * 0.4,
      color: context.accent,
      alpha: 0.9,
    });
    raster.fillWrap(0, Math.round(raster.height * 0.82), raster.width, Math.max(Math.round(raster.height * 0.012), 1), context.accent, 0.35);
    raster.noise(context.random, 0.02 + context.contrast * 0.05);
  },

  /* Corrugated kraft: flute ridges, horizontal creases and a torn kraft edge. */
  flute: (context) => {
    baseFill(context);
    flutes(context, { count: Math.max(Math.round(context.scale * 5), 6), depth: 0.36 + context.contrast * 0.3 });
    const { raster } = context;
    raster.fillWrap(0, 0, raster.width, Math.max(Math.round(raster.height * 0.06), 1), context.detail, 0.14);
    bands(context, 3, (t) => mixRgb(context.base, t < 0.5 ? context.detail : context.highlight, 0.2), 0.07);
    raster.noise(context.random, 0.03);
  },

  /* Printed sleeve card: fibre, a rule and the sleeve's printed word. */
  card: (context) => {
    baseFill(context);
    const { raster } = context;
    for (let index = 0; index < 70; index += 1) {
      const x = context.random() * raster.width;
      const y = context.random() * raster.height;
      const length = 3 + context.random() * 7;
      lineWrap(raster, x, y, x + length, y + (context.random() - 0.5) * 3, context.detail, 0.06);
    }
    logo(context, {
      text: context.mark || 'CAFE',
      scale: Math.max(Math.round(raster.height / 28), 1),
      centerY: raster.height * 0.32,
      color: context.accent,
      alpha: 0.95,
    });
    raster.fillWrap(0, Math.round(raster.height * 0.62), raster.width, 1, context.accent, 0.3);
    raster.fillWrap(0, 0, raster.width, Math.max(Math.round(raster.height * 0.05), 1), context.highlight, 0.16);
    raster.noise(context.random, 0.02);
  },

  /* Moulded plastic: an even sheen, mould flow lines and micro scratches. */
  plastic: (context) => {
    baseFill(context);
    const { raster } = context;
    raster.fillWrap(0, Math.round(raster.height * 0.3), raster.width, Math.max(Math.round(raster.height * 0.16), 1), context.highlight, 0.12);
    grain(context, {
      lines: Math.round(context.scale * 2),
      amplitude: 0.004,
      alpha: [0.03, 0.07],
      tone: () => context.highlight,
    });
    for (let index = 0; index < 16; index += 1) {
      const x = context.random() * raster.width;
      const y = context.random() * raster.height;
      const angle = context.random() * Math.PI;
      lineWrap(raster, x, y, x + Math.cos(angle) * 9, y + Math.sin(angle) * 9, context.detail, 0.05);
    }
    raster.noise(context.random, 0.015 + context.contrast * 0.03);
  },

  /* Stainless steel: fine brush lines under a soft polish. */
  steel: (context) => {
    baseFill(context);
    brushed(context, {
      streaks: Math.round(70 + context.scale * 8),
      alpha: [0.04, 0.14],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.detail : context.highlight, 0.45),
    });
    const { raster } = context;
    for (let index = 0; index < 6; index += 1) {
      const x = context.random() * raster.width;
      const y = context.random() * raster.height;
      lineWrap(raster, x, y, x + 12 + context.random() * 14, y + (context.random() - 0.5) * 2, context.detail, 0.18);
    }
    raster.noise(context.random, 0.02);
  },

  /* Plated cutlery: bright polish, faint tarnish speckle, serving scratches. */
  plated: (context) => {
    baseFill(context);
    brushed(context, {
      streaks: Math.round(90 + context.scale * 6),
      alpha: [0.06, 0.2],
      tone: (t) => mixRgb(context.base, t < 0.4 ? context.detail : context.highlight, 0.55),
    });
    speckle(context, {
      count: 26,
      radius: [0.6, 1.6],
      alpha: [0.05, 0.16],
      tone: (t) => mixRgb(context.base, t < 0.7 ? context.detail : context.accent, 0.4),
    });
    grain(context, {
      lines: Math.round(context.scale * 2),
      amplitude: 0.005,
      alpha: [0.05, 0.12],
      tone: () => context.detail,
    });
    context.raster.noise(context.random, 0.02);
  },

  /* Enamel: a glossy coat with chipped edges showing the black beneath. */
  enamel: (context) => {
    baseFill(context);
    const { raster } = context;
    raster.fillWrap(0, 0, raster.width, Math.max(Math.round(raster.height * 0.08), 1), context.highlight, 0.14);
    for (let index = 0; index < 4; index += 1) {
      const x = context.random() * raster.width;
      const y = context.random() * raster.height;
      const radius = 1.4 + context.random() * 2.6;
      raster.disc(x, y, radius, shade(context.detail, 0.6), 0.75);
      raster.ring(x, y, radius + 0.6, 1, context.highlight, 0.35);
    }
    speckle(context, {
      count: 18,
      radius: [0.5, 1.2],
      alpha: [0.04, 0.12],
      tone: () => context.detail,
    });
    raster.noise(context.random, 0.02 + context.contrast * 0.04);
  },

  /* Chrome: hard anisotropic bands, the way a plated trim reflects a room. */
  chrome: (context) => {
    baseFill(context);
    bands(
      context,
      Math.max(Math.round(context.scale * 2), 4),
      (t) => (t < 0.5 ? mixRgb(context.base, context.highlight, 0.7) : mixRgb(context.base, context.detail, 0.6)),
      0.24,
    );
    brushed(context, {
      streaks: Math.round(40 + context.scale * 4),
      alpha: [0.03, 0.1],
      tone: () => context.highlight,
    });
    context.raster.noise(context.random, 0.015);
  },

  /* Bakelite: a mottled phenolic moulding with a moulded highlight. */
  bakelite: (context) => {
    baseFill(context);
    speckle(context, {
      count: 40,
      radius: [0.8, 2.6],
      alpha: [0.06, 0.2],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.detail : context.accent, 0.4),
    });
    const { raster } = context;
    raster.fillWrap(0, Math.round(raster.height * 0.22), raster.width, Math.max(Math.round(raster.height * 0.08), 1), context.highlight, 0.1);
    raster.noise(context.random, 0.03 + context.contrast * 0.05);
  },

  /* Timber: grain, a couple of knots and open pores (trays, caddies, tongs). */
  wood: (context) => {
    baseFill(context);
    bands(context, Math.max(Math.round(context.scale), 3), (t) => mixRgb(context.base, t < 0.5 ? context.detail : context.accent, 0.14), 0.3);
    grain(context, {
      lines: Math.round(context.scale * 3),
      amplitude: 0.014,
      alpha: [0.14, 0.34],
      frequency: [1, 3],
      tone: (t) => mixRgb(context.base, t < 0.72 ? context.detail : context.highlight, 0.36 + t * 0.4),
    });
    for (let index = 0; index < 2; index += 1) {
      const x = context.random() * context.raster.width;
      const y = context.random() * context.raster.height;
      context.raster.ring(x, y, 2.2, 1, context.detail, 0.32);
      context.raster.ring(x, y, 3.6, 1, context.detail, 0.2);
    }
    speckle(context, {
      count: 30,
      radius: [0.4, 1],
      alpha: [0.08, 0.2],
      tone: () => context.detail,
    });
    context.raster.noise(context.random, 0.02);
  },

  /* Napkin weave: over-and-under threads with a soft fold shadow. */
  weave: (context) => {
    baseFill(context);
    const { raster } = context;
    const cell = Math.max(Math.round(raster.width / Math.max(context.scale * 3, 6)), 2);
    for (let y = 0; y < raster.height; y += cell) {
      for (let x = 0; x < raster.width; x += cell) {
        const even = ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2;
        const tone = even ? context.highlight : context.detail;
        raster.fillWrap(x, y, cell - 1, cell - 1, tone, 0.1);
      }
    }
    grain(context, {
      lines: Math.round(context.scale * 2),
      amplitude: 0.004,
      alpha: [0.04, 0.1],
      tone: () => context.detail,
    });
    raster.fillWrap(0, Math.round(raster.height * 0.46), raster.width, Math.max(Math.round(raster.height * 0.08), 1), context.detail, 0.08);
    raster.noise(context.random, 0.02 + context.contrast * 0.04);
  },

  /* Printed paper label: a white ground, a ring logo and rows of small print. */
  print: (context) => {
    baseFill(context);
    const { raster } = context;
    logo(context, {
      text: context.mark || 'CAFE',
      scale: Math.max(Math.round(raster.height / 22), 1),
      centerY: raster.height * 0.24,
      color: context.accent,
      alpha: 0.95,
    });
    smallPrint(context, { rows: 2, tone: context.detail, alpha: 0.35 });
    raster.fillWrap(0, 0, raster.width, Math.max(Math.round(raster.height * 0.04), 1), context.accent, 0.4);
    raster.noise(context.random, 0.02);
  },

  /* Loose sugar: a heap of bright crystals with darker syrup shadows. */
  granular: (context) => {
    baseFill(context);
    speckle(context, {
      count: 120,
      radius: [0.6, 1.8],
      alpha: [0.2, 0.55],
      tone: (t) => mixRgb(context.base, t < 0.62 ? context.highlight : context.detail, 0.6),
      square: true,
    });
    context.raster.noise(context.random, 0.04);
  },

  /* Silicone and rubber: matte, fine-grained, with a soft sheen. */
  rubber: (context) => {
    baseFill(context);
    speckle(context, {
      count: 90,
      radius: [0.4, 1.1],
      alpha: [0.04, 0.14],
      tone: (t) => mixRgb(context.base, t < 0.5 ? context.detail : context.highlight, 0.4),
    });
    context.raster.fillWrap(0, Math.round(context.raster.height * 0.38), context.raster.width, Math.max(Math.round(context.raster.height * 0.1), 1), context.highlight, 0.07);
    context.raster.noise(context.random, 0.05);
  },

  /* Sauce and syrup: glossy swirls over a deep coloured body. */
  sauce: (context) => {
    baseFill(context);
    const { raster, random } = context;
    for (let index = 0; index < 4; index += 1) {
      const x = random() * raster.width;
      const y = random() * raster.height;
      lineWrap(raster, x, y, x + 18 + random() * 12, y + (random() - 0.5) * 6, context.highlight, 0.16);
    }
    raster.fillWrap(0, 0, raster.width, Math.max(Math.round(raster.height * 0.16), 1), context.highlight, 0.1);
    raster.fillWrap(0, raster.height - Math.max(Math.round(raster.height * 0.2), 1), raster.width, Math.round(raster.height * 0.2), context.detail, 0.16);
    raster.noise(context.random, 0.03);
  },
};

/* -------------------------------------------------------------------------- */
/* Public painting API                                                        */
/* -------------------------------------------------------------------------- */

/** Paints `style` into an RGBA raster (deterministic for a given style). */
export function paintTablewareSurface(style: TablewareTextureStyle): Raster {
  const size = clampSize(style.size ?? DEFAULT_TABLEWARE_TEXTURE_SIZE);
  const palette = resolvePalette(style.palette);
  const mark = (style.mark ?? '').trim();
  const random = createSeededRandom(
    style.seed ??
      hashString(
        `${style.kind}|${style.palette.base}|${style.palette.accent}|${style.scale ?? 4}|${style.orientation ?? 'horizontal'}|${mark}`,
      ),
  );
  const raster = new Raster(size, size);
  PAINTERS[style.kind]({
    raster,
    ...palette,
    scale: Math.min(Math.max(style.scale ?? 4, 1), 32),
    contrast: Math.min(Math.max(style.contrast ?? 0.14, 0), 1),
    vertical: style.orientation === 'vertical',
    mark,
    random,
  });
  return raster;
}

function applyTextureSettings(
  texture: THREE.Texture,
  key: string,
  style: TablewareTextureStyle,
  options: TablewareTextureOptions,
  source: 'canvas' | 'data',
): void {
  const repeat = style.repeat ?? [1, 1];
  texture.name = `${TABLEWARE_TEXTURE_PREFIX}${key}`;
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
    tableware: {
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
export function createTablewareTexture(
  style: TablewareTextureStyle,
  options: TablewareTextureOptions = {},
): TablewareTexture {
  const width = clampSize(style.size ?? DEFAULT_TABLEWARE_TEXTURE_SIZE);
  const height = clampSize(options.height ?? width);
  const pixels = paintTablewareSurface({ ...style, size: width });
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
  applyTextureSettings(texture, key, style, options, 'data');
  return { key, kind: style.kind, width, height, source: 'data', texture, canvas: null };
}

/** True when `texture` came from this module's procedural pipeline. */
export function isTablewareTexture(texture: THREE.Texture): boolean {
  return (
    (texture instanceof THREE.DataTexture || texture instanceof THREE.CanvasTexture) &&
    texture.name.startsWith(TABLEWARE_TEXTURE_PREFIX)
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

/* -------------------------------------------------------------------------- */
/* Material slots                                                             */
/* -------------------------------------------------------------------------- */

/** Every surface slot a tableware material set carries. */
export const TABLEWARE_MATERIAL_SLOTS = Object.freeze([
  'china',
  'chinaRim',
  'porcelain',
  'stoneware',
  'glass',
  'tintedGlass',
  'paper',
  'corrugated',
  'sleeve',
  'plastic',
  'steel',
  'plated',
  'enamel',
  'chrome',
  'bakelite',
  'wood',
  'napkin',
  'print',
  'sugar',
  'condiment',
  'brew',
  'rubber',
  'accent',
] as const);

/** Name of a tableware material slot. */
export type TablewareMaterialSlot = (typeof TABLEWARE_MATERIAL_SLOTS)[number];

/** True when `value` names a tableware material slot. */
export function isTablewareMaterialSlot(value: unknown): value is TablewareMaterialSlot {
  return typeof value === 'string' && (TABLEWARE_MATERIAL_SLOTS as readonly string[]).includes(value);
}

/** Canonical name of one tableware material (`tableware:<year>:<slot>`). */
export function tablewareMaterialName(year: YearId, slot: TablewareMaterialSlot): string {
  return `tableware:${year}:${slot}`;
}

/* -------------------------------------------------------------------------- */
/* Recipes and the era material set                                           */
/* -------------------------------------------------------------------------- */

/** One era's recipe for a single surface slot. */
export interface TablewareMaterialRecipe {
  /** Prose description of the finish, surfaced in diagnostics and hotspots. */
  readonly finish: string;
  readonly style: TablewareTextureStyle;
  readonly roughness: number;
  readonly metalness: number;
  readonly color?: string;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly side?: 'front' | 'back' | 'double';
  /** Overrides the material set's texture resolution for this slot. */
  readonly size?: number;
}

/** Optional extras accepted by {@link tablewareRecipe}. */
export interface TablewareRecipeOptions {
  readonly detail?: string;
  readonly highlight?: string;
  readonly scale?: number;
  readonly contrast?: number;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly repeat?: readonly [number, number];
  readonly size?: number;
  readonly color?: string;
  readonly side?: 'front' | 'back' | 'double';
  readonly transparent?: boolean;
  readonly opacity?: number;
  /** Printed word or corner logo painted into this slot's map. */
  readonly mark?: string;
}

/**
 * Builds one surface recipe. Era data files use this so each of the 23 slots
 * stays a single readable line while still carrying its full painter recipe.
 */
export function tablewareRecipe(
  finish: string,
  kind: TablewareTextureKind,
  base: string,
  accent: string,
  roughness: number,
  metalness: number,
  options: TablewareRecipeOptions = {},
): TablewareMaterialRecipe {
  return {
    finish,
    style: {
      kind,
      palette: { base, accent, detail: options.detail, highlight: options.highlight },
      scale: options.scale,
      contrast: options.contrast,
      orientation: options.orientation,
      repeat: options.repeat,
      size: options.size,
      mark: options.mark,
    },
    roughness,
    metalness,
    color: options.color,
    transparent: options.transparent,
    opacity: options.opacity,
    side: options.side,
    size: options.size,
  };
}

/**
 * The part of a tableware era spec a material set is built from. `TablewareSpec`
 * extends it, so a spec can be handed straight to
 * {@link createTablewareMaterialSet}.
 */
export interface TablewareMaterialSource {
  readonly year: YearId;
  /** Name of the era's tableware palette, e.g. `'Utility china and plated steel'`. */
  readonly paletteName: string;
  /** Identifier of the material set `applyPeriod` swaps in. */
  readonly materialSetId: string;
  readonly surfaces: Readonly<Record<TablewareMaterialSlot, TablewareMaterialRecipe>>;
}

/** A complete set of era materials for the tableware domain. */
export interface TablewareMaterialSet {
  /** `tableware-material-set:<year>:<spec-material-set-id>`. */
  readonly id: string;
  readonly year: YearId;
  readonly paletteName: string;
  readonly specMaterialSetId: string;
  readonly slots: Readonly<Record<TablewareMaterialSlot, THREE.Material>>;
  /** Every procedural texture the set owns. */
  readonly textures: readonly THREE.Texture[];
  readonly textureSource: 'canvas' | 'data' | 'mixed';
}

export interface TablewareMaterialSetOptions {
  /** Canvas factory used for the procedural maps (defaults to the DOM). */
  readonly canvasFactory?: CanvasFactory;
  /** Texture resolution override for every slot. */
  readonly textureSize?: number;
}

/** Reads one slot out of a set, typed as a standard material for mesh use. */
export function tablewareMaterial(
  set: TablewareMaterialSet,
  slot: TablewareMaterialSlot,
): THREE.MeshStandardMaterial {
  return set.slots[slot] as THREE.MeshStandardMaterial;
}

/** Every material in a set, in slot order. */
export function tablewareMaterialSetMaterials(set: TablewareMaterialSet): readonly THREE.Material[] {
  return TABLEWARE_MATERIAL_SLOTS.map((slot) => set.slots[slot]);
}

/** Deterministic signature of a set: identical for identical era material sets. */
export function tablewareMaterialSetSignature(set: TablewareMaterialSet): string {
  const parts = TABLEWARE_MATERIAL_SLOTS.map((slot) => {
    const material = set.slots[slot] as THREE.MeshStandardMaterial;
    const map = material.map;
    return `${slot}=${material.name}${map ? `:${map.name}` : ''}`;
  });
  return [set.id, ...parts].join('|');
}

interface BuildState {
  readonly source: TablewareMaterialSource;
  readonly canvasFactory: CanvasFactory | undefined;
  readonly textureSize: number | undefined;
  readonly textures: THREE.Texture[];
  readonly sources: Set<'canvas' | 'data'>;
}

function sideOf(side: TablewareMaterialRecipe['side']): THREE.Side {
  if (side === 'double') return THREE.DoubleSide;
  if (side === 'back') return THREE.BackSide;
  return THREE.FrontSide;
}

function buildSlot(state: BuildState, slot: TablewareMaterialSlot): THREE.Material {
  const recipe = state.source.surfaces[slot];
  if (!recipe) {
    throw new Error(`The ${state.source.year} tableware spec is missing the "${slot}" surface.`);
  }
  const textureSize = recipe.size ?? state.textureSize;
  const finish = createTablewareTexture(
    { ...recipe.style, size: textureSize ?? recipe.style.size },
    { key: `${state.source.year}:${slot}`, canvasFactory: state.canvasFactory },
  );
  state.textures.push(finish.texture);
  state.sources.add(finish.source);

  const material = new THREE.MeshStandardMaterial({
    name: tablewareMaterialName(state.source.year, slot),
    map: finish.texture,
    color: recipe.color ?? 0xffffff,
    roughness: Math.min(Math.max(recipe.roughness, 0), 1),
    metalness: Math.min(Math.max(recipe.metalness, 0), 1),
    side: sideOf(recipe.side),
    transparent: recipe.transparent ?? false,
    opacity: recipe.opacity ?? 1,
    emissive: recipe.emissive ?? 0x000000,
    emissiveIntensity: recipe.emissive ? (recipe.emissiveIntensity ?? 1) : 0,
  });
  material.userData = {
    tableware: {
      slot,
      year: state.source.year,
      materialSetId: state.source.materialSetId,
      paletteName: state.source.paletteName,
      finish: recipe.finish,
      textureKey: finish.texture.name,
      textureSource: finish.source,
      procedural: true,
    },
  };
  return material;
}

/** Builds an era's complete material set (procedural textures, no network). */
export function createTablewareMaterialSet(
  source: TablewareMaterialSource,
  options: TablewareMaterialSetOptions = {},
): TablewareMaterialSet {
  const state: BuildState = {
    source,
    canvasFactory: options.canvasFactory,
    textureSize: options.textureSize,
    textures: [],
    sources: new Set(),
  };

  const slots = {} as Record<TablewareMaterialSlot, THREE.Material>;
  for (const slot of TABLEWARE_MATERIAL_SLOTS) {
    slots[slot] = buildSlot(state, slot);
  }

  const textureSource: TablewareMaterialSet['textureSource'] =
    state.sources.size > 1 ? 'mixed' : state.sources.has('canvas') ? 'canvas' : 'data';

  return {
    id: `tableware-material-set:${source.year}:${source.materialSetId}`,
    year: source.year,
    paletteName: source.paletteName,
    specMaterialSetId: source.materialSetId,
    slots: Object.freeze(slots),
    textures: Object.freeze([...state.textures]),
    textureSource,
  };
}

/** Releases every material and texture of a set. Safe to call once per set. */
export function disposeTablewareMaterialSet(set: TablewareMaterialSet): void {
  for (const texture of set.textures) texture.dispose();
  for (const slot of TABLEWARE_MATERIAL_SLOTS) set.slots[slot].dispose();
}
