/**
 * Procedural signage artwork and fixture surfaces for the café timelapse.
 *
 * Every pixel the signage and lighting domain shows is painted here, in code: no
 * web font, no image file, no SVG, no HDRI and no remote request at build or
 * runtime. The domain needs legible lettering and believable sign hardware in
 * five eras, so this module provides:
 *
 *  - {@link SignageSurface} — a small RGBA raster with the primitives signage
 *    needs (rectangles, gradients, circles, polygons, stains, grain, glow) plus a
 *    built-in 5x7 bitmap font with a few lowercase glyphs the price strips use.
 *  - {@link paintSignFace} — one painter per era style: hand-painted boards,
 *    painted glass, applied vinyl, enamel panels, illuminated panels, plastic
 *    light boxes, coloured acrylic, cheap price strips, printed window graphics,
 *    internally lit channel letters, LED edge-lit panels, backlit logos and
 *    QR-style window decals.
 *  - {@link paintFixtureFace}, {@link paintShaftTexture} and
 *    {@link paintGlowTexture} — the lit surfaces, volumetric shafts and halos of
 *    the era's fixtures.
 *  - {@link createSignageTexture} — materialises a raster as a DOM
 *    `CanvasTexture` when a canvas is available (browser) and as a `DataTexture`
 *    otherwise (headless kernel, node tests), plus {@link SignageResources},
 *    which tracks every geometry, material and texture a build owns so an era
 *    change releases them again.
 *
 * Everything is deterministic for a given request — the painters only use the
 * seeded PRNG of `../../core/kernel` — so an era looks identical on every run
 * and the tests can assert real artwork content instead of placeholder colour.
 */

import * as THREE from 'three';
import { yearToNumber, type YearId } from '../../contracts/period';
import { createSeededRandom } from '../../core/kernel';

/* -------------------------------------------------------------------------- */
/* Colours                                                                    */
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
  transparent: 0x000000,
});

function clampByte(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

/** Clamps to `[0, 1]`, tolerating `NaN`. */
export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

/** Parses `#rgb`, `#rrggbb`, `rgb(r,g,b)` and a few CSS colour names. */
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

/** Blends two colours; `t` = 0 returns `a`, `t` = 1 returns `b`. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const amount = clamp01(t);
  return {
    r: clampByte(a.r + (b.r - a.r) * amount),
    g: clampByte(a.g + (b.g - a.g) * amount),
    b: clampByte(a.b + (b.b - a.b) * amount),
  };
}

/** Multiplies a colour by `factor` (1 keeps it, 0.5 darkens by half). */
export function shadeRgb(color: Rgb, factor: number): Rgb {
  return { r: clampByte(color.r * factor), g: clampByte(color.g * factor), b: clampByte(color.b * factor) };
}

/** Perceptual luminance in `[0, 1]` (WCAG coefficients). */
export function relativeLuminance(color: Rgb): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

/** WCAG contrast ratio between two colours (1 = identical, 21 = black/white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** Packed `0xrrggbb` integer of a colour, ready for three.js. */
export function rgbToInt(color: Rgb): number {
  return (clampByte(color.r) << 16) | (clampByte(color.g) << 8) | clampByte(color.b);
}

/** `#rrggbb` string of a colour. */
export function rgbToHex(color: Rgb): string {
  return `#${rgbToInt(color).toString(16).padStart(6, '0')}`;
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

/** Copies an RGBA buffer flipping it top-to-bottom (data textures upload bottom-up). */
export function flipRows(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const stride = width * 4;
  const flipped = new Uint8ClampedArray(data.length);
  for (let row = 0; row < height; row += 1) {
    const source = row * stride;
    const target = (height - 1 - row) * stride;
    flipped.set(data.subarray(source, source + stride), target);
  }
  return flipped;
}

/* -------------------------------------------------------------------------- */
/* Bitmap font                                                                */
/* -------------------------------------------------------------------------- */

/** Width of one glyph cell, in font pixels. */
export const GLYPH_WIDTH = 5;

/** Height of one glyph cell, in font pixels. */
export const GLYPH_HEIGHT = 7;

/**
 * 5x7 uppercase/numeral bitmap font. Each row is a bit mask where the highest
 * bit (16) is the leftmost column, so a glyph is a tiny 5x7 image that scales by
 * whole pixels and never depends on a system font. `d` and `p` are provided in
 * lowercase because the eras' pre-decimal and decimal price strips need them.
 */
const GLYPHS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 12, 12, 8],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '&': [12, 18, 20, 8, 21, 18, 13],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4],
  "'": [4, 4, 0, 0, 0, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '/': [1, 2, 2, 4, 8, 8, 16],
  ':': [0, 12, 12, 0, 0, 12, 12],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '#': [10, 10, 31, 10, 31, 10, 10],
  '*': [0, 10, 4, 31, 4, 10, 0],
  '=': [0, 0, 31, 0, 31, 0, 0],
  '%': [17, 2, 4, 8, 16, 17, 0],
  '"': [10, 10, 0, 0, 0, 0, 0],
  $: [4, 15, 20, 14, 5, 30, 4],
  '£': [6, 9, 8, 28, 8, 8, 31],
  d: [1, 1, 13, 19, 17, 19, 13],
  p: [0, 0, 30, 17, 17, 30, 16],
  ' ': [0, 0, 0, 0, 0, 0, 0],
});

function glyphFor(character: string): readonly number[] | undefined {
  const direct = GLYPHS[character];
  if (direct) return direct;
  return GLYPHS[character.toUpperCase()];
}

/** Options for {@link SignageSurface.drawText}. */
export interface TextOptions {
  readonly color: Rgb;
  /** Integer whole-pixel scale of the 5x7 glyph cell. */
  readonly scale?: number;
  /** Extra space between glyph cells, in font pixels. */
  readonly letterSpacing?: number;
  readonly alpha?: number;
  readonly bold?: boolean;
}

/** A point in surface pixel space. */
export interface SurfacePoint {
  readonly x: number;
  readonly y: number;
}

/* -------------------------------------------------------------------------- */
/* Raster surface                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Tight RGBA raster with the primitives signage artwork is composed from.
 * Coordinates outside the surface are clipped (sign faces do not tile) and every
 * paint call is deterministic.
 */
export class SignageSurface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, background: Rgb = { r: 0, g: 0, b: 0 }, alpha = 255) {
    this.width = Math.max(1, Math.trunc(width));
    this.height = Math.max(1, Math.trunc(height));
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
    this.clear(background, alpha);
  }

  /** Fills the whole raster with `color` at `alpha`, overwriting what was there. */
  clear(color: Rgb, alpha = 255): void {
    const data = this.data;
    const red = clampByte(color.r);
    const green = clampByte(color.g);
    const blue = clampByte(color.b);
    const coverage = clampByte(alpha);
    for (let index = 0; index < data.length; index += 4) {
      data[index] = red;
      data[index + 1] = green;
      data[index + 2] = blue;
      data[index + 3] = coverage;
    }
  }

  /** Source-over blend of `color` into one pixel. */
  blendPixel(x: number, y: number, color: Rgb, alpha: number): void {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const sourceAlpha = Math.min(Math.max(alpha, 0), 255) / 255;
    if (sourceAlpha <= 0) return;
    const data = this.data;
    const index = (py * this.width + px) * 4;
    const destAlpha = (data[index + 3] ?? 0) / 255;
    const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
    if (outAlpha <= 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      return;
    }
    const destWeight = destAlpha * (1 - sourceAlpha);
    data[index] = clampByte((color.r * sourceAlpha + (data[index] ?? 0) * destWeight) / outAlpha);
    data[index + 1] = clampByte((color.g * sourceAlpha + (data[index + 1] ?? 0) * destWeight) / outAlpha);
    data[index + 2] = clampByte((color.b * sourceAlpha + (data[index + 2] ?? 0) * destWeight) / outAlpha);
    data[index + 3] = clampByte(outAlpha * 255);
  }

  /** Alpha coverage of one pixel in `[0, 1]`. */
  coverage(x: number, y: number): number {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return 0;
    return (this.data[(py * this.width + px) * 4 + 3] ?? 0) / 255;
  }

  /** Fills an axis aligned rectangle. */
  fillRect(x: number, y: number, width: number, height: number, color: Rgb, alpha = 255): void {
    const startX = Math.round(x);
    const startY = Math.round(y);
    const endX = Math.round(x + width);
    const endY = Math.round(y + height);
    for (let py = startY; py < endY; py += 1) {
      for (let px = startX; px < endX; px += 1) {
        this.blendPixel(px, py, color, alpha);
      }
    }
  }

  /** Draws a rectangle outline, inside the given box. */
  strokeRect(x: number, y: number, width: number, height: number, thickness: number, color: Rgb, alpha = 255): void {
    const t = Math.max(1, Math.round(thickness));
    this.fillRect(x, y, width, t, color, alpha);
    this.fillRect(x, y + height - t, width, t, color, alpha);
    this.fillRect(x, y + t, t, height - t * 2, color, alpha);
    this.fillRect(x + width - t, y + t, t, height - t * 2, color, alpha);
  }

  /** Filled circle with an optional soft edge in pixels. */
  fillCircle(cx: number, cy: number, radius: number, color: Rgb, alpha = 255, softness = 0): void {
    const outer = Math.max(radius, 0.5);
    const inner = Math.max(outer - Math.max(softness, 0), 0);
    const startX = Math.max(0, Math.floor(cx - outer - 1));
    const endX = Math.min(this.width - 1, Math.ceil(cx + outer + 1));
    const startY = Math.max(0, Math.floor(cy - outer - 1));
    const endY = Math.min(this.height - 1, Math.ceil(cy + outer + 1));
    for (let py = startY; py <= endY; py += 1) {
      for (let px = startX; px <= endX; px += 1) {
        const distance = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
        if (distance > outer) continue;
        const edge = outer - inner <= 0 ? 1 : clamp01((outer - distance) / (outer - inner));
        this.blendPixel(px, py, color, alpha * edge);
      }
    }
  }

  /** Vertical gradient fill, top colour to bottom colour. */
  fillVerticalGradient(x: number, y: number, width: number, height: number, top: Rgb, bottom: Rgb, alpha = 255): void {
    const rows = Math.max(1, Math.round(height));
    for (let row = 0; row < rows; row += 1) {
      const t = rows === 1 ? 0 : row / (rows - 1);
      this.fillRect(x, y + row, width, 1, mixRgb(top, bottom, t), alpha);
    }
  }

  /** Radial gradient from `center` outwards to `edge`, additive in colour. */
  fillRadialGradient(cx: number, cy: number, radius: number, center: Rgb, edge: Rgb, alpha = 255): void {
    const outer = Math.max(radius, 0.5);
    const startX = Math.max(0, Math.floor(cx - outer));
    const endX = Math.min(this.width - 1, Math.ceil(cx + outer));
    const startY = Math.max(0, Math.floor(cy - outer));
    const endY = Math.min(this.height - 1, Math.ceil(cy + outer));
    for (let py = startY; py <= endY; py += 1) {
      for (let px = startX; px <= endX; px += 1) {
        const distance = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
        if (distance > outer) continue;
        this.blendPixel(px, py, mixRgb(center, edge, clamp01(distance / outer)), alpha);
      }
    }
  }

  /** Even-odd scanline polygon fill (used for glass reflections and graphics). */
  fillPolygon(points: readonly SurfacePoint[], color: Rgb, alpha = 255): void {
    if (points.length < 3) return;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const startY = Math.max(0, Math.floor(minY));
    const endY = Math.min(this.height - 1, Math.ceil(maxY));
    const crossings: number[] = [];
    for (let y = startY; y <= endY; y += 1) {
      crossings.length = 0;
      const scan = y + 0.5;
      for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        if (!a || !b) continue;
        const intersects = (a.y <= scan && b.y > scan) || (b.y <= scan && a.y > scan);
        if (!intersects) continue;
        const span = b.y - a.y;
        const t = span === 0 ? 0 : (scan - a.y) / span;
        crossings.push(a.x + t * (b.x - a.x));
      }
      crossings.sort((left, right) => left - right);
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const from = crossings[index] ?? 0;
        const to = crossings[index + 1] ?? 0;
        this.fillRect(from, y, Math.max(to - from, 0), 1, color, alpha);
      }
    }
  }

  /** Deterministic per-pixel grain, `amount` being the maximum ± shift. */
  grain(x: number, y: number, width: number, height: number, amount: number, random: () => number): void {
    const startX = Math.max(0, Math.round(x));
    const startY = Math.max(0, Math.round(y));
    const endX = Math.min(this.width, Math.round(x + width));
    const endY = Math.min(this.height, Math.round(y + height));
    const data = this.data;
    for (let py = startY; py < endY; py += 1) {
      for (let px = startX; px < endX; px += 1) {
        const index = (py * this.width + px) * 4;
        if ((data[index + 3] ?? 0) === 0) continue;
        const delta = (random() * 2 - 1) * amount;
        data[index] = clampByte((data[index] ?? 0) + delta);
        data[index + 1] = clampByte((data[index + 1] ?? 0) + delta * 0.9);
        data[index + 2] = clampByte((data[index + 2] ?? 0) + delta * 0.8);
      }
    }
  }

  /** Soft patina blotches, as aged paint and worn plastic need. */
  stains(count: number, minRadius: number, maxRadius: number, color: Rgb, maxAlpha: number, random: () => number): void {
    for (let index = 0; index < count; index += 1) {
      const radius = minRadius + random() * Math.max(maxRadius - minRadius, 0);
      const cx = random() * this.width;
      const cy = random() * this.height;
      this.fillCircle(cx, cy, radius, color, maxAlpha * (0.4 + random() * 0.6), radius * 0.7);
    }
  }

  /** Short scratches and chips, for the wear a real sign collects. */
  scratches(count: number, color: Rgb, maxAlpha: number, random: () => number): void {
    for (let index = 0; index < count; index += 1) {
      const x = random() * this.width;
      const y = random() * this.height;
      const length = 4 + random() * this.width * 0.2;
      const slant = (random() - 0.5) * 3;
      for (let step = 0; step < length; step += 1) {
        this.blendPixel(x + step, y + step * slant, color, maxAlpha * (0.5 + random() * 0.5));
      }
    }
  }

  /** Horizontal stripes, used for the diffuser texture of fluorescent tubes. */
  stripes(x: number, y: number, width: number, height: number, spacing: number, color: Rgb, alpha: number): void {
    const step = Math.max(1, Math.round(spacing));
    for (let py = Math.round(y); py < Math.round(y + height); py += step) {
      this.fillRect(x, py, width, 1, color, alpha);
    }
  }

  /** Draws one glyph at integer pixel scale. */
  drawGlyph(
    glyph: readonly number[],
    x: number,
    y: number,
    scale: number,
    color: Rgb,
    alpha: number,
    bold: boolean,
  ): void {
    const size = Math.max(1, Math.trunc(scale));
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const bits = glyph[row] ?? 0;
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        const mask = 1 << (GLYPH_WIDTH - 1 - column);
        if ((bits & mask) === 0) continue;
        const px = x + column * size;
        const py = y + row * size;
        this.fillRect(px, py, size, size, color, alpha);
        if (bold) this.fillRect(px + size, py, Math.max(1, Math.floor(size / 2)), size, color, alpha);
      }
    }
  }

  /** Advance width of `text` at `scale`, in pixels. */
  measureText(text: string, scale: number, letterSpacing = 1): number {
    const count = text.length;
    if (count === 0) return 0;
    const size = Math.max(1, Math.trunc(scale));
    const spacing = Math.max(Math.round(letterSpacing), 0) * size;
    return count * (GLYPH_WIDTH * size + spacing) - spacing;
  }

  /** Draws `text` with the built-in font, returning the advance width in pixels. */
  drawText(text: string, x: number, y: number, options: TextOptions): number {
    const scale = Math.max(1, Math.trunc(options.scale ?? 1));
    const spacing = Math.max(Math.round((options.letterSpacing ?? 1) * scale), 0);
    const alpha = options.alpha ?? 255;
    const bold = options.bold === true;
    let cursor = Math.round(x);
    const start = cursor;
    for (const character of text) {
      const glyph = glyphFor(character);
      if (glyph) this.drawGlyph(glyph, cursor, Math.round(y), scale, options.color, alpha, bold);
      cursor += GLYPH_WIDTH * scale + spacing;
    }
    return cursor - start - spacing;
  }

  /**
   * Bakes a soft halo around the existing artwork by box-blurring the alpha
   * channel and adding `color` back in. This is the bloom-free glow the signage
   * needs: the light is in the texture, not in a post-processing pass.
   */
  glow(color: Rgb, radius = 4, strength = 0.6): void {
    const { width, height } = this;
    const source = new Float32Array(width * height);
    for (let index = 0; index < width * height; index += 1) {
      source[index] = (this.data[index * 4 + 3] ?? 0) / 255;
    }
    const blurred = boxBlur(boxBlur(source, width, height, radius), width, height, radius);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = blurred[y * width + x] ?? 0;
        if (value <= 0.02) continue;
        this.blendPixel(x, y, color, clampByte(value * strength * 255));
      }
    }
  }

  /** True when any pixel is less than fully opaque. */
  hasTransparency(): boolean {
    for (let index = 3; index < this.data.length; index += 4) {
      if ((this.data[index] ?? 255) < 250) return true;
    }
    return false;
  }
}

/** Separable box blur over a single channel, used by {@link SignageSurface.glow}. */
function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const clampedRadius = Math.max(1, Math.trunc(radius));
  const window = clampedRadius * 2 + 1;
  const horizontal = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let offset = -clampedRadius; offset <= clampedRadius; offset += 1) {
      sum += source[row + Math.min(Math.max(offset, 0), width - 1)] ?? 0;
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / window;
      const leaving = row + Math.min(Math.max(x - clampedRadius, 0), width - 1);
      const entering = row + Math.min(Math.max(x + clampedRadius + 1, 0), width - 1);
      sum += (source[entering] ?? 0) - (source[leaving] ?? 0);
    }
  }
  const vertical = new Float32Array(source.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let offset = -clampedRadius; offset <= clampedRadius; offset += 1) {
      sum += horizontal[Math.min(Math.max(offset, 0), height - 1) * width + x] ?? 0;
    }
    for (let y = 0; y < height; y += 1) {
      vertical[y * width + x] = sum / window;
      const leaving = Math.min(Math.max(y - clampedRadius, 0), height - 1) * width + x;
      const entering = Math.min(Math.max(y + clampedRadius + 1, 0), height - 1) * width + x;
      sum += (horizontal[entering] ?? 0) - (horizontal[leaving] ?? 0);
    }
  }
  return vertical;
}

/* -------------------------------------------------------------------------- */
/* Texture materialisation                                                    */
/* -------------------------------------------------------------------------- */

/** Canvas factory used to reach the browser's 2D backend. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/** DOM canvas when available, otherwise `null` (which selects `DataTexture`). */
export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** Every texture this domain creates is named with this prefix. */
export const SIGNAGE_TEXTURE_PREFIX = 'signage:';

/** Largest edge of any procedural signage texture, so options cannot explode memory. */
export const SIGNAGE_TEXTURE_MAX_SIZE = 1024;

/** Default paint resolution of a sign face, in pixels per metre. */
export const DEFAULT_SIGN_PIXELS_PER_METRE = 256;

/** Which part of the signage rig a texture belongs to. */
export type SignageTextureKind = 'sign' | 'fixture' | 'shaft' | 'glow';

/** A painted texture plus how it was materialised. */
export interface SignageTexture {
  readonly key: string;
  readonly kind: SignageTextureKind;
  readonly width: number;
  readonly height: number;
  /** Which backend produced the texture. */
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  /** The 2D canvas when the canvas backend was used, otherwise `null`. */
  readonly canvas: HTMLCanvasElement | null;
  /** Whether the painted artwork has translucent pixels. */
  readonly transparent: boolean;
}

export interface SignageTextureOptions {
  readonly key: string;
  readonly kind: SignageTextureKind;
  readonly canvasFactory?: CanvasFactory;
  readonly anisotropy?: number;
  readonly repeat?: readonly [number, number];
}

function clampTextureEdge(value: number): number {
  const size = Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.min(Math.max(size, 4), SIGNAGE_TEXTURE_MAX_SIZE);
}

/**
 * Turns a painted surface into a texture. The canvas backend is used when a
 * canvas (the browser DOM or an injected factory) is available, otherwise a
 * `DataTexture`. No remote image, font or artwork is ever requested.
 */
export function createSignageTexture(surface: SignageSurface, options: SignageTextureOptions): SignageTexture {
  const width = surface.width;
  const height = surface.height;
  const transparent = surface.hasTransparency();
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = (options.canvasFactory ?? defaultCanvasFactory)(width, height);
  } catch {
    canvas = null;
  }
  const context = canvas ? canvas.getContext('2d') : null;

  if (canvas && context) {
    const image = context.createImageData(width, height);
    image.data.set(surface.data);
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    applyTextureSettings(texture, `${SIGNAGE_TEXTURE_PREFIX}${options.key}`, options, 'canvas');
    return { key: options.key, kind: options.kind, width, height, source: 'canvas', texture, canvas, transparent };
  }

  // Data textures upload bottom-up, so the rows are pre-flipped: the lettering
  // reads upright whichever backend produced it.
  const texture = new THREE.DataTexture(flipRows(surface.data, width, height), width, height, THREE.RGBAFormat);
  applyTextureSettings(texture, `${SIGNAGE_TEXTURE_PREFIX}${options.key}`, options, 'data');
  return { key: options.key, kind: options.kind, width, height, source: 'data', texture, canvas: null, transparent };
}

function applyTextureSettings(
  texture: THREE.Texture,
  name: string,
  options: SignageTextureOptions,
  source: 'canvas' | 'data',
): void {
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(options.repeat[0], 0.01), Math.max(options.repeat[1], 0.01));
  }
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  if (options.anisotropy !== undefined && Number.isFinite(options.anisotropy)) {
    texture.anisotropy = Math.max(Math.trunc(options.anisotropy), 1);
  }
  texture.userData = { signage: { key: options.key, kind: options.kind, procedural: true, source } };
  texture.needsUpdate = true;
}

/** True when `texture` came from this domain's procedural pipeline. */
export function isProceduralSignageTexture(texture: THREE.Texture): boolean {
  return (
    (texture instanceof THREE.DataTexture || texture instanceof THREE.CanvasTexture) &&
    texture.name.startsWith(SIGNAGE_TEXTURE_PREFIX)
  );
}

/* -------------------------------------------------------------------------- */
/* Resource tracking                                                          */
/* -------------------------------------------------------------------------- */

/** Live GPU resource counts of one signage build. */
export interface SignageResourceCounts {
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly surfaces: number;
}

/**
 * Owns every geometry, material and texture a build created. The module makes
 * one per build and disposes it when the era changes (or on `dispose()`), which
 * is what keeps repeated timeline scrubbing from leaking GPU memory.
 */
export class SignageResources {
  private readonly geometrySet = new Set<THREE.BufferGeometry>();
  private readonly materialSet = new Set<THREE.Material>();
  private readonly textureSet = new Set<THREE.Texture>();
  private readonly surfaceSet = new Set<SignageSurface>();

  ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometrySet.add(geometry);
    return geometry;
  }

  ownMaterial<T extends THREE.Material>(material: T): T {
    this.materialSet.add(material);
    return material;
  }

  ownTexture<T extends THREE.Texture>(texture: T): T {
    this.textureSet.add(texture);
    return texture;
  }

  ownSurface<T extends SignageSurface>(surface: T): T {
    this.surfaceSet.add(surface);
    return surface;
  }

  get counts(): SignageResourceCounts {
    return {
      geometries: this.geometrySet.size,
      materials: this.materialSet.size,
      textures: this.textureSet.size,
      surfaces: this.surfaceSet.size,
    };
  }

  /** Snapshot of the live objects, for diagnostics and the tests. */
  snapshot(): {
    readonly geometries: readonly THREE.BufferGeometry[];
    readonly materials: readonly THREE.Material[];
    readonly textures: readonly THREE.Texture[];
  } {
    return {
      geometries: [...this.geometrySet],
      materials: [...this.materialSet],
      textures: [...this.textureSet],
    };
  }

  /** Disposes everything and returns the counts that were released. */
  dispose(): SignageResourceCounts {
    const released = this.counts;
    for (const geometry of this.geometrySet) geometry.dispose();
    for (const material of this.materialSet) material.dispose();
    for (const texture of this.textureSet) texture.dispose();
    this.geometrySet.clear();
    this.materialSet.clear();
    this.textureSet.clear();
    this.surfaceSet.clear();
    return released;
  }
}

/**
 * Bounded cache of painted faces. Painting a sign is the most expensive step of
 * a rebuild and the artwork is deterministic per request, so scrubbing the
 * timeline back and forth reuses the bytes instead of repainting them.
 */
export class SignageSurfaceCache {
  private readonly entries = new Map<string, SignageSurface>();

  constructor(private readonly limit = 32) {}

  get(key: string): SignageSurface | undefined {
    const found = this.entries.get(key);
    if (found) {
      this.entries.delete(key);
      this.entries.set(key, found);
    }
    return found;
  }

  set(key: string, surface: SignageSurface): SignageSurface {
    this.entries.set(key, surface);
    while (this.entries.size > Math.max(this.limit, 1)) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return surface;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

/* -------------------------------------------------------------------------- */
/* Sign artwork                                                               */
/* -------------------------------------------------------------------------- */

/** Every lettering style the five eras use. */
export type SignStyleId =
  | 'painted-board'
  | 'painted-glass'
  | 'vinyl-letters'
  | 'enamel-panel'
  | 'illuminated-panel'
  | 'light-box'
  | 'coloured-acrylic'
  | 'price-strip'
  | 'printed-vinyl'
  | 'channel-letters'
  | 'edge-lit-panel'
  | 'backlit-logo'
  | 'qr-decal';

/** Every style, in a stable order (used by tests and diagnostics). */
export const SIGN_STYLE_IDS: readonly SignStyleId[] = Object.freeze([
  'painted-board',
  'painted-glass',
  'vinyl-letters',
  'enamel-panel',
  'illuminated-panel',
  'light-box',
  'coloured-acrylic',
  'price-strip',
  'printed-vinyl',
  'channel-letters',
  'edge-lit-panel',
  'backlit-logo',
  'qr-decal',
]);

/** Everything a painter needs to draw one sign face. */
export interface SignFaceRequest {
  readonly year: YearId;
  readonly signId: string;
  readonly style: SignStyleId;
  readonly text: string;
  readonly secondaryText?: string;
  readonly baseColor: string;
  readonly letterColor: string;
  readonly glowColor: string;
  readonly backlit: boolean;
  /** Physical width of the sign face, in metres. */
  readonly width: number;
  /** Physical height of the sign face, in metres. */
  readonly height: number;
  /** Paint resolution, in pixels per metre. */
  readonly pixelsPerMetre?: number;
  readonly seed: number;
}

type SignPainter = (surface: SignageSurface, request: SignFaceRequest, random: () => number) => void;

/** Pixel size of a sign face painted at `pixelsPerMetre`, clamped to a sane edge. */
export function signFacePixels(
  widthMetres: number,
  heightMetres: number,
  pixelsPerMetre = DEFAULT_SIGN_PIXELS_PER_METRE,
): { readonly width: number; readonly height: number } {
  const safeWidth = Number.isFinite(widthMetres) && widthMetres > 0 ? widthMetres : 1;
  const safeHeight = Number.isFinite(heightMetres) && heightMetres > 0 ? heightMetres : 0.5;
  const density = Number.isFinite(pixelsPerMetre) && pixelsPerMetre > 0 ? pixelsPerMetre : DEFAULT_SIGN_PIXELS_PER_METRE;
  return {
    width: clampTextureEdge(Math.round(safeWidth * density)),
    height: clampTextureEdge(Math.round(safeHeight * density)),
  };
}

function fitTextScale(text: string, maxWidth: number, maxHeight: number, letterSpacing: number): number {
  const count = Math.max(text.length, 1);
  const cell = GLYPH_WIDTH + Math.max(letterSpacing, 0);
  const byWidth = Math.floor(maxWidth / (count * cell));
  const byHeight = Math.floor(maxHeight / GLYPH_HEIGHT);
  return Math.max(1, Math.min(Math.max(byWidth, 1), Math.max(byHeight, 1), 32));
}

interface CentredTextOptions {
  readonly alpha?: number;
  readonly spacing?: number;
  readonly bold?: boolean;
}

/** Draws `text` centred on `centreX`, returning the painted width in pixels. */
function drawCentred(
  surface: SignageSurface,
  text: string,
  centreX: number,
  top: number,
  maxWidth: number,
  maxHeight: number,
  color: Rgb,
  options: CentredTextOptions = {},
): number {
  if (text.length === 0) return 0;
  const spacing = options.spacing ?? 1;
  const scale = fitTextScale(text, maxWidth, maxHeight, spacing);
  const width = surface.measureText(text, scale, spacing);
  surface.drawText(text, centreX - width / 2, top, {
    scale,
    letterSpacing: spacing,
    color,
    alpha: options.alpha ?? 255,
    bold: options.bold ?? false,
  });
  return width;
}

/** Painters use the era to decide how worn a sign is allowed to look. */
function eraWear(year: YearId): number {
  const value = yearToNumber(year);
  // Earlier signs are chipped and hand-made; later ones are printed and clean.
  const t = clamp01((value - 1945) / 80);
  return 1 - t * 0.75;
}

function paintPaintedBoard(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, shadeRgb(base, 1.14), shadeRgb(base, 0.76));
  surface.grain(0, 0, surface.width, surface.height, 10, random);
  for (let index = 0; index < 6; index += 1) {
    surface.fillRect(0, Math.round(random() * surface.height), surface.width, 1, shadeRgb(base, 1.3), 16);
  }
  const frame = Math.max(2, Math.round(surface.height * 0.045));
  surface.strokeRect(1, 1, surface.width - 2, surface.height - 2, frame, shadeRgb(base, 0.55), 210);
  drawCentred(
    surface,
    request.text,
    surface.width / 2,
    surface.height * 0.14,
    surface.width * 0.84,
    surface.height * 0.46,
    letter,
    { bold: true },
  );
  if (request.secondaryText) {
    drawCentred(
      surface,
      request.secondaryText,
      surface.width / 2,
      surface.height * 0.66,
      surface.width * 0.62,
      surface.height * 0.22,
      mixRgb(letter, shadeRgb(base, 0.7), 0.3),
    );
  }
  const wear = eraWear(request.year);
  surface.stains(Math.round(3 + wear * 4), 1, surface.height * 0.14, shadeRgb(base, 0.6), 60, random);
  surface.scratches(Math.round(wear * 6), shadeRgb(base, 1.5), 40, random);
  if (request.backlit) surface.glow(parseColor(request.glowColor), 4, 0.22);
}

function paintPaintedGlass(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  const glow = parseColor(request.glowColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, shadeRgb(base, 1.35), shadeRgb(base, 0.8));
  // Two raking reflections: painted glass on a shopfront always catches light.
  const streak = surface.width * 0.16;
  for (let index = 0; index < 3; index += 1) {
    const x = surface.width * (0.1 + index * 0.32);
    surface.fillPolygon(
      [
        { x, y: 0 },
        { x: x + streak, y: 0 },
        { x: x + streak * 0.45, y: surface.height },
        { x: x - streak * 0.55, y: surface.height },
      ],
      { r: 235, g: 240, b: 245 },
      26,
    );
  }
  surface.grain(0, 0, surface.width, surface.height, 5, random);
  drawCentred(
    surface,
    request.text,
    surface.width / 2,
    surface.height * 0.18,
    surface.width * 0.82,
    surface.height * 0.4,
    shadeRgb(letter, 0.75),
    { bold: true },
  );
  drawCentred(
    surface,
    request.text,
    surface.width / 2,
    surface.height * 0.18,
    surface.width * 0.82,
    surface.height * 0.4,
    letter,
    { bold: true },
  );
  if (request.secondaryText) {
    drawCentred(
      surface,
      request.secondaryText,
      surface.width / 2,
      surface.height * 0.68,
      surface.width * 0.6,
      surface.height * 0.18,
      glow,
      { alpha: 220 },
    );
  }
  surface.glow(glow, 3, 0.3);
  surface.stains(2, 1, surface.height * 0.1, { r: 20, g: 26, b: 24 }, 40, random);
  surface.scratches(Math.round(eraWear(request.year) * 4), { r: 220, g: 226, b: 230 }, 30, random);
}

function paintVinylLetters(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const letter = parseColor(request.letterColor);
  // Cut-vinyl on glass: transparent ground, crisp letters, a thin cut edge.
  surface.clear({ r: 0, g: 0, b: 0 }, 0);
  drawCentred(
    surface,
    request.text,
    surface.width / 2,
    surface.height * 0.24,
    surface.width * 0.86,
    surface.height * 0.34,
    shadeRgb(letter, 0.35),
    { bold: true },
  );
  drawCentred(
    surface,
    request.text,
    surface.width / 2 - 1,
    surface.height * 0.24,
    surface.width * 0.86,
    surface.height * 0.34,
    letter,
    { bold: true },
  );
  surface.fillRect(surface.width * 0.14, surface.height * 0.66, surface.width * 0.72, Math.max(1, Math.round(surface.height * 0.02)), letter, 210);
  if (request.secondaryText) {
    drawCentred(
      surface,
      request.secondaryText,
      surface.width / 2,
      surface.height * 0.72,
      surface.width * 0.6,
      surface.height * 0.16,
      mixRgb(letter, parseColor(request.glowColor), 0.35),
    );
  }
  surface.grain(0, 0, surface.width, surface.height, 3, random);
}

function paintEnamelPanel(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, shadeRgb(base, 1.08), shadeRgb(base, 0.86));
  surface.grain(0, 0, surface.width, surface.height, 6, random);
  const rim = Math.max(2, Math.round(surface.height * 0.05));
  surface.strokeRect(1, 1, surface.width - 2, surface.height - 2, rim, shadeRgb(base, 1.7), 200);
  surface.strokeRect(1 + rim, 1 + rim, surface.width - 2 - rim * 2, surface.height - 2 - rim * 2, 1, shadeRgb(base, 0.5), 160);
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.2, surface.width * 0.84, surface.height * 0.42, letter, {
    bold: true,
  });
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, surface.height * 0.68, surface.width * 0.62, surface.height * 0.2, shadeRgb(letter, 0.85));
  }
  surface.stains(2, 1, surface.height * 0.1, { r: 40, g: 30, b: 24 }, 40, random);
}

function paintIlluminatedPanel(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  const glow = parseColor(request.glowColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, shadeRgb(base, 1.02), shadeRgb(base, 0.78));
  // An evenly lit opal panel: a hot strip along the middle behind the vinyl.
  surface.fillRect(0, surface.height * 0.22, surface.width, surface.height * 0.56, glow, 60);
  surface.fillRect(0, surface.height * 0.34, surface.width, surface.height * 0.32, { r: 255, g: 250, b: 236 }, 70);
  surface.grain(0, 0, surface.width, surface.height, 5, random);
  const frame = Math.max(2, Math.round(surface.height * 0.06));
  surface.strokeRect(1, 1, surface.width - 2, surface.height - 2, frame, shadeRgb(base, 0.45), 220);
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.22, surface.width * 0.8, surface.height * 0.44, letter, {
    bold: true,
  });
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, surface.height * 0.7, surface.width * 0.56, surface.height * 0.18, shadeRgb(letter, 0.9));
  }
  surface.stains(2, 1, surface.height * 0.09, shadeRgb(base, 0.5), 30, random);
}

function paintLightBox(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  const glow = parseColor(request.glowColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, shadeRgb(base, 1.25), shadeRgb(base, 0.7));
  surface.fillRadialGradient(surface.width / 2, surface.height * 0.52, surface.width * 0.55, glow, base, 90);
  surface.grain(0, 0, surface.width, surface.height, 5, random);
  // Perspex sweep and box rails.
  surface.fillPolygon(
    [
      { x: surface.width * 0.6, y: 0 },
      { x: surface.width * 0.78, y: 0 },
      { x: surface.width * 0.42, y: surface.height },
      { x: surface.width * 0.24, y: surface.height },
    ],
    { r: 255, g: 255, b: 255 },
    34,
  );
  const rail = Math.max(2, Math.round(surface.height * 0.07));
  surface.fillRect(0, 0, surface.width, rail, shadeRgb(base, 0.55), 230);
  surface.fillRect(0, surface.height - rail, surface.width, rail, shadeRgb(base, 0.45), 230);
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.26, surface.width * 0.8, surface.height * 0.4, letter, {
    bold: true,
  });
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, surface.height * 0.68, surface.width * 0.55, surface.height * 0.18, mixRgb(letter, glow, 0.5));
  }
  surface.glow(glow, 5, 0.35);
}

function paintColouredAcrylic(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  const glow = parseColor(request.glowColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, mixRgb(base, { r: 255, g: 255, b: 255 }, 0.18), shadeRgb(base, 0.72));
  // Acrylic lights from the edge: bright rebound along the border.
  const edge = Math.max(2, Math.round(surface.height * 0.08));
  surface.fillRect(0, 0, surface.width, edge, mixRgb(base, glow, 0.6), 150);
  surface.fillRect(0, surface.height - edge, surface.width, edge, mixRgb(base, glow, 0.35), 120);
  surface.fillRect(0, 0, edge, surface.height, mixRgb(base, glow, 0.5), 110);
  surface.fillRect(surface.width - edge, 0, edge, surface.height, mixRgb(base, glow, 0.5), 110);
  surface.grain(0, 0, surface.width, surface.height, 4, random);
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.28, surface.width * 0.78, surface.height * 0.38, letter, {
    bold: true,
  });
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, surface.height * 0.7, surface.width * 0.58, surface.height * 0.16, mixRgb(letter, glow, 0.4));
  }
  surface.glow(glow, 4, 0.28);
}

function paintPriceStrip(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, shadeRgb(base, 1.12), shadeRgb(base, 0.84));
  // Cheap channel strip: tick marks along the top, uneven print, a dent.
  const ticks = Math.max(4, Math.round(surface.width / 24));
  for (let index = 0; index < ticks; index += 1) {
    surface.fillRect((index + 0.5) * (surface.width / ticks), 0, Math.max(1, Math.round(surface.height * 0.05)), surface.height * 0.16, shadeRgb(base, 0.6), 170);
  }
  surface.fillRect(0, surface.height - Math.max(2, Math.round(surface.height * 0.06)), surface.width, Math.max(2, Math.round(surface.height * 0.06)), shadeRgb(base, 0.7), 140);
  surface.grain(0, 0, surface.width, surface.height, 8, random);
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.22, surface.width * 0.88, surface.height * 0.42, letter, { bold: true });
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, surface.height * 0.68, surface.width * 0.7, surface.height * 0.2, letter, { alpha: 230 });
  }
  surface.fillRect(surface.width * 0.62, surface.height * 0.84, surface.width * 0.3, 1, shadeRgb(base, 0.55), 120);
  surface.stains(1, 1, surface.height * 0.12, shadeRgb(base, 0.5), 40, random);
}

function paintPrintedVinyl(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  // A printed window graphic: white margin, halftone art band, headline.
  surface.fillRect(0, 0, surface.width, surface.height, base, 255);
  const margin = Math.max(2, Math.round(surface.width * 0.05));
  surface.strokeRect(0, 0, surface.width, surface.height, margin, shadeRgb(base, 0.85), 190);
  const bandTop = Math.round(surface.height * 0.1);
  const bandHeight = Math.round(surface.height * 0.44);
  surface.fillRect(margin, bandTop, surface.width - margin * 2, bandHeight, { r: 32, g: 26, b: 22 }, 255);
  const dots = Math.round((surface.width * bandHeight) / 90);
  for (let index = 0; index < dots; index += 1) {
    const x = margin + random() * (surface.width - margin * 2);
    const y = bandTop + random() * bandHeight;
    const lift = 1 - (y - bandTop) / Math.max(bandHeight, 1);
    surface.fillCircle(x, y, 0.6 + random() * 1.8, mixRgb({ r: 60, g: 40, b: 30 }, { r: 235, g: 205, b: 160 }, lift), 90);
  }
  surface.fillCircle(surface.width * 0.52, bandTop + bandHeight * 0.52, bandHeight * 0.24, { r: 246, g: 240, b: 228 }, 235);
  surface.fillRect(surface.width * 0.44, bandTop + bandHeight * 0.3, surface.width * 0.16, bandHeight * 0.42, { r: 62, g: 40, b: 28 }, 230);
  drawCentred(surface, request.text, surface.width / 2, bandTop + bandHeight + surface.height * 0.04, surface.width * 0.88, surface.height * 0.16, letter, {
    bold: true,
  });
  if (request.secondaryText) {
    drawCentred(
      surface,
      request.secondaryText,
      surface.width / 2,
      bandTop + bandHeight + surface.height * 0.24,
      surface.width * 0.8,
      surface.height * 0.12,
      shadeRgb(letter, 1.1),
    );
  }
  const wear = eraWear(request.year);
  surface.stains(Math.round(1 + wear * 2), 1, surface.height * 0.05, shadeRgb(base, 0.7), 30, random);
}

function paintChannelLetters(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  const glow = parseColor(request.glowColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, shadeRgb(base, 1.2), shadeRgb(base, 0.7));
  surface.grain(0, 0, surface.width, surface.height, 4, random);
  // Internally lit channels: a wide dim halo under a crisp bright face.
  drawCentred(surface, request.text, surface.width / 2 + 1, surface.height * 0.27, surface.width * 0.82, surface.height * 0.4, shadeRgb(glow, 0.45), {
    bold: true,
  });
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.26, surface.width * 0.82, surface.height * 0.4, letter, { bold: true });
  // Standoff shadow so the letters read as solid channels.
  surface.fillRect(surface.width * 0.08, surface.height * 0.72, surface.width * 0.84, Math.max(1, Math.round(surface.height * 0.04)), shadeRgb(base, 0.5), 150);
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, surface.height * 0.76, surface.width * 0.6, surface.height * 0.16, mixRgb(letter, glow, 0.45));
  }
  surface.glow(glow, 6, 0.3);
}

function paintEdgeLitPanel(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  const glow = parseColor(request.glowColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, mixRgb(base, { r: 250, g: 248, b: 244 }, 0.82), mixRgb(base, { r: 226, g: 222, b: 214 }, 0.55));
  // LED tape behind the top and bottom edges washes the panel.
  const band = Math.max(3, Math.round(surface.height * 0.22));
  surface.fillVerticalGradient(0, 0, surface.width, band, mixRgb(glow, { r: 255, g: 255, b: 255 }, 0.5), { r: 0, g: 0, b: 0 }, 120);
  surface.fillVerticalGradient(0, surface.height - band, surface.width, band, { r: 0, g: 0, b: 0 }, mixRgb(glow, { r: 255, g: 255, b: 255 }, 0.45), 110);
  surface.grain(0, 0, surface.width, surface.height, 3, random);
  const frame = Math.max(2, Math.round(surface.height * 0.06));
  surface.strokeRect(0, 0, surface.width, surface.height, frame, mixRgb(base, { r: 240, g: 238, b: 232 }, 0.4), 200);
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.34, surface.width * 0.76, surface.height * 0.34, letter, { bold: true });
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, surface.height * 0.74, surface.width * 0.54, surface.height * 0.14, shadeRgb(letter, 0.9));
  }
  surface.glow(glow, 3, 0.22);
}

function paintBacklitLogo(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  const glow = parseColor(request.glowColor);
  surface.fillVerticalGradient(0, 0, surface.width, surface.height, shadeRgb(base, 0.55), shadeRgb(base, 0.32));
  surface.grain(0, 0, surface.width, surface.height, 3, random);
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.24, surface.width * 0.8, surface.height * 0.42, glow, { alpha: 200, bold: true });
  drawCentred(surface, request.text, surface.width / 2, surface.height * 0.23, surface.width * 0.8, surface.height * 0.42, letter, { bold: true });
  surface.glow(glow, 6, 0.4);
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, surface.height * 0.74, surface.width * 0.6, surface.height * 0.14, mixRgb(letter, glow, 0.6));
  }
  const rail = Math.max(1, Math.round(surface.height * 0.04));
  surface.fillRect(0, surface.height - rail, surface.width, rail, shadeRgb(base, 0.6), 190);
}

function paintQrDecal(surface: SignageSurface, request: SignFaceRequest, random: () => number): void {
  const base = parseColor(request.baseColor);
  const letter = parseColor(request.letterColor);
  // A decal on glass: the matrix and its caption are the only opaque ink.
  surface.clear({ r: 0, g: 0, b: 0 }, 0);
  const modules = 21;
  const quiet = 2;
  const cell = Math.max(1, Math.floor(surface.width / (modules + quiet * 2)));
  const originX = Math.round((surface.width - cell * (modules + quiet * 2)) / 2) + cell * quiet;
  const originY = Math.round(surface.height * 0.08) + cell * quiet;
  const dark = shadeRgb(letter, 0.9);
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      const finder =
        (row < 7 && column < 7) || (row < 7 && column >= modules - 7) || (row >= modules - 7 && column < 7);
      let filled: boolean;
      if (finder) {
        const localRow = row < 7 ? row : row - (modules - 7);
        const localColumn = column < 7 ? column : column - (modules - 7);
        const ring = localRow === 0 || localRow === 6 || localColumn === 0 || localColumn === 6;
        const core = localRow >= 2 && localRow <= 4 && localColumn >= 2 && localColumn <= 4;
        filled = ring || core;
      } else {
        filled = random() > 0.52;
      }
      if (!filled) continue;
      surface.fillRect(originX + column * cell, originY + row * cell, cell, cell, dark, 255);
    }
  }
  const captionTop = originY + modules * cell + cell;
  const captionHeight = Math.max(4, Math.round(surface.height * 0.12));
  surface.fillRect(originX - cell, captionTop, cell * (modules + 2), captionHeight, base, 235);
  drawCentred(surface, request.text, surface.width / 2, captionTop + 1, surface.width * 0.9, captionHeight - 2, letter, { bold: true });
  if (request.secondaryText) {
    drawCentred(surface, request.secondaryText, surface.width / 2, captionTop + captionHeight + 1, surface.width * 0.8, Math.max(surface.height * 0.08, 6), shadeRgb(letter, 0.8));
  }
}

const SIGN_PAINTERS: Readonly<Record<SignStyleId, SignPainter>> = Object.freeze({
  'painted-board': paintPaintedBoard,
  'painted-glass': paintPaintedGlass,
  'vinyl-letters': paintVinylLetters,
  'enamel-panel': paintEnamelPanel,
  'illuminated-panel': paintIlluminatedPanel,
  'light-box': paintLightBox,
  'coloured-acrylic': paintColouredAcrylic,
  'price-strip': paintPriceStrip,
  'printed-vinyl': paintPrintedVinyl,
  'channel-letters': paintChannelLetters,
  'edge-lit-panel': paintEdgeLitPanel,
  'backlit-logo': paintBacklitLogo,
  'qr-decal': paintQrDecal,
});

/** Paints one sign face with the painter for its era style. */
export function paintSignFace(request: SignFaceRequest): SignageSurface {
  const pixels = signFacePixels(request.width, request.height, request.pixelsPerMetre);
  const surface = new SignageSurface(pixels.width, pixels.height);
  const random = createSeededRandom(request.seed);
  const painter = SIGN_PAINTERS[request.style];
  painter(surface, request, random);
  return surface;
}

/* -------------------------------------------------------------------------- */
/* Fixture surfaces                                                           */
/* -------------------------------------------------------------------------- */

/** Which lit part of a fixture a texture belongs to. */
export type FixtureFaceKind = 'tube' | 'diffuser' | 'led-strip' | 'neon' | 'filament';

/**
 * Paints the emissive face of a fixture: a fluorescent tube sleeve, an opal
 * diffuser, an LED tape run, a neon tube or the warm filament of a bare bulb.
 */
export function paintFixtureFace(kind: FixtureFaceKind, colorHex: string, seed = 1): SignageSurface {
  const color = parseColor(colorHex);
  const random = createSeededRandom(seed);
  switch (kind) {
    case 'tube': {
      const surface = new SignageSurface(256, 32, shadeRgb(color, 0.4));
      surface.fillVerticalGradient(0, 0, 256, 32, shadeRgb(color, 0.5), shadeRgb(color, 0.5));
      surface.fillRect(0, 8, 256, 16, mixRgb(color, { r: 255, g: 255, b: 255 }, 0.55), 255);
      surface.stripes(0, 0, 256, 32, 4, shadeRgb(color, 0.7), 40);
      surface.fillVerticalGradient(0, 0, 256, 8, shadeRgb(color, 0.35), shadeRgb(color, 0.6), 150);
      surface.fillVerticalGradient(0, 24, 256, 8, shadeRgb(color, 0.6), shadeRgb(color, 0.35), 150);
      surface.fillRect(0, 0, 6, 32, shadeRgb(color, 0.3), 200);
      surface.fillRect(250, 0, 6, 32, shadeRgb(color, 0.3), 200);
      surface.grain(0, 0, 256, 32, 4, random);
      return surface;
    }
    case 'diffuser': {
      const surface = new SignageSurface(64, 64, shadeRgb(color, 0.45));
      surface.fillRadialGradient(32, 32, 34, mixRgb(color, { r: 255, g: 255, b: 255 }, 0.7), shadeRgb(color, 0.55), 255);
      surface.grain(0, 0, 64, 64, 5, random);
      return surface;
    }
    case 'led-strip': {
      const surface = new SignageSurface(256, 16, shadeRgb(color, 0.35));
      surface.fillRect(0, 0, 256, 16, shadeRgb(color, 0.45), 255);
      for (let x = 4; x < 256; x += 8) {
        surface.fillCircle(x, 8, 2.4, mixRgb(color, { r: 255, g: 255, b: 255 }, 0.6), 255, 1.4);
      }
      surface.grain(0, 0, 256, 16, 3, random);
      return surface;
    }
    case 'neon': {
      const surface = new SignageSurface(256, 32, { r: 0, g: 0, b: 0 }, 0);
      surface.fillRect(0, 12, 256, 8, mixRgb(color, { r: 255, g: 255, b: 255 }, 0.5), 255);
      surface.fillVerticalGradient(0, 8, 256, 16, color, color, 110);
      surface.fillRect(0, 14, 256, 4, { r: 255, g: 255, b: 255 }, 210);
      surface.glow(color, 4, 0.5);
      return surface;
    }
    case 'filament': {
      const surface = new SignageSurface(64, 64, { r: 0, g: 0, b: 0 }, 0);
      surface.fillRadialGradient(32, 32, 30, mixRgb(color, { r: 255, g: 250, b: 230 }, 0.6), color, 180);
      for (let index = 0; index < 5; index += 1) {
        surface.fillRect(20 + index * 6, 22, 2, 20, mixRgb(color, { r: 255, g: 244, b: 214 }, 0.75), 220);
      }
      surface.glow(color, 5, 0.5);
      return surface;
    }
  }
}

/**
 * Paints the cone texture of a volumetric light shaft: opaque at the apex,
 * fading towards the base and around the circumference. The gradient is baked
 * into the texture so the shaft needs no shader of its own.
 */
export function paintShaftTexture(colorHex: string, seed = 1): SignageSurface {
  const color = parseColor(colorHex);
  const width = 64;
  const height = 128;
  const surface = new SignageSurface(width, height, { r: 0, g: 0, b: 0 }, 0);
  const random = createSeededRandom(seed);
  for (let y = 0; y < height; y += 1) {
    // v = 0 at the cone base, v = 1 at the apex (three.js cylinder mapping).
    const v = y / (height - 1);
    const axial = Math.pow(v, 1.6);
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);
      const edge = Math.sin(Math.PI * u);
      const alpha = clampByte(axial * Math.pow(edge, 0.8) * 150);
      if (alpha <= 0) continue;
      surface.blendPixel(x, y, mixRgb(color, { r: 255, g: 255, b: 255 }, axial * 0.35), alpha);
    }
  }
  surface.grain(0, 0, width, height, 6, random);
  return surface;
}

/** Paints the soft radial halo used behind backlit signs and fixture bulbs. */
export function paintGlowTexture(colorHex: string, seed = 1): SignageSurface {
  const color = parseColor(colorHex);
  const size = 64;
  const surface = new SignageSurface(size, size, { r: 0, g: 0, b: 0 }, 0);
  const random = createSeededRandom(seed);
  surface.fillRadialGradient(size / 2, size / 2, size / 2, mixRgb(color, { r: 255, g: 255, b: 255 }, 0.55), color, 190);
  surface.fillRadialGradient(size / 2, size / 2, size * 0.28, { r: 255, g: 255, b: 255 }, mixRgb(color, { r: 255, g: 255, b: 255 }, 0.4), 170);
  surface.grain(0, 0, size, size, 5, random);
  return surface;
}
