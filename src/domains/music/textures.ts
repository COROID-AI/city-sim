/**
 * Procedural texture pipeline for the café's music playback devices.
 *
 * Every dial face, cabinet veneer, grille cloth, badge, record label, tape label
 * and speaker cone in this domain is painted here, pixel by pixel, from code —
 * no image, font or audio file is ever fetched. A single RGBA raster feeds two
 * backends:
 *
 *  - **canvas** — when a DOM canvas (or an injected {@link CanvasFactory}) is
 *    available the raster is blitted with `putImageData` and wrapped in a
 *    `CanvasTexture`, which is the browser path.
 *  - **data** — when no canvas exists (headless kernels and the node test
 *    suite) the same bytes become a `DataTexture`.
 *
 * Both backends consume identical bytes, so a headless test can assert real
 * pixel content of a 1945 dial or a 1985 grille weave, and the browser shows
 * the same fabric.
 *
 * Text (station names, model plates, cassette labels, "now playing" lines) is
 * drawn with a code-defined 5x7 bitmap font, so no web font is requested and the
 * lettering stays crisp under the inspector's close-up framing.
 *
 * Every painter is seeded (`createSeededRandom`) so an era's textures are byte
 * for byte reproducible across runs.
 */

import * as THREE from 'three';
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

/** Multiplies a colour by `factor` (1 keeps it, 0.5 darkens by half). */
export function shade(color: Rgb, factor: number): Rgb {
  return {
    r: clampByte(color.r * factor),
    g: clampByte(color.g * factor),
    b: clampByte(color.b * factor),
  };
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
/* Raster                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tiny RGBA raster with the primitives the device painters need. `blend`,
 * `fillRect`, `disc` and `ring` wrap at the texture edges, so veneers and
 * grille weaves tile seamlessly under `RepeatWrapping`.
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

  /** Draws a straight line (wrapping: painters use it for tiling grain). */
  line(x0: number, y0: number, x1: number, y1: number, color: Rgb, alpha = 1, thickness = 1): this {
    const steps = Math.max(Math.abs(Math.round(x1 - x0)), Math.abs(Math.round(y1 - y0)), 1);
    const span = Math.max(Math.trunc(thickness), 1);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      for (let offset = 0; offset < span; offset += 1) this.blend(x, y + offset, color, alpha);
    }
    return this;
  }

  /** Filled circle, wrapping at the edges. */
  disc(cx: number, cy: number, radius: number, color: Rgb, alpha = 1): this {
    const span = Math.max(Math.round(radius), 0);
    for (let dy = -span; dy <= span; dy += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        if (dx * dx + dy * dy <= span * span) {
          this.blend(cx + dx, cy + dy, color, alpha);
        }
      }
    }
    return this;
  }

  /** Ring outline of `thickness` pixels, wrapping at the edges. */
  ring(cx: number, cy: number, radius: number, thickness: number, color: Rgb, alpha = 1): this {
    const outer = Math.max(Math.round(radius), 1);
    const inner = Math.max(outer - Math.max(Math.trunc(thickness), 1), 0);
    for (let dy = -outer; dy <= outer; dy += 1) {
      for (let dx = -outer; dx <= outer; dx += 1) {
        const distance = dx * dx + dy * dy;
        if (distance <= outer * outer && distance >= inner * inner) {
          this.blend(cx + dx, cy + dy, color, alpha);
        }
      }
    }
    return this;
  }

  /** Rectangle outline. */
  rectOutline(x: number, y: number, width: number, height: number, thickness: number, color: Rgb, alpha = 1): this {
    const span = Math.max(Math.trunc(thickness), 1);
    this.fillRect(x, y, width, span, color, alpha);
    this.fillRect(x, y + height - span, width, span, color, alpha);
    this.fillRect(x, y, span, height, color, alpha);
    this.fillRect(x + width - span, y, span, height, color, alpha);
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

  /** Diagonal glossy sweep across the surface (glass, polished plastic). */
  sheen(alpha: number, color: Rgb = { r: 255, g: 255, b: 255 }): this {
    const width = this.width;
    const height = this.height;
    const band = Math.max(Math.round((width + height) * 0.14), 2);
    const centre = Math.round((width + height) * 0.42);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const distance = Math.abs(x + y - centre);
        if (distance >= band) continue;
        const falloff = 1 - distance / band;
        this.blend(x, y, color, alpha * falloff * falloff);
      }
    }
    return this;
  }

  /** Darkens the edges, as an aged cabinet does around its corners. */
  vignette(amount: number): this {
    const width = this.width;
    const height = this.height;
    const black: Rgb = { r: 0, g: 0, b: 0 };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const nx = (x / Math.max(width - 1, 1)) * 2 - 1;
        const ny = (y / Math.max(height - 1, 1)) * 2 - 1;
        const distance = Math.min(Math.sqrt(nx * nx + ny * ny), 1);
        this.blend(x, y, black, amount * distance * distance);
      }
    }
    return this;
  }
}

/* -------------------------------------------------------------------------- */
/* Code-defined bitmap font                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 5x7 bitmap font. Each glyph is seven rows of five cells, joined with `/`.
 * Only the characters the device graphics need are defined; anything else is
 * skipped by {@link drawMusicText} (which keeps the advance honest).
 */
export const MUSIC_FONT_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  A: '01110/10001/10001/11111/10001/10001/10001',
  B: '11110/10001/10001/11110/10001/10001/11110',
  C: '01110/10001/10000/10000/10000/10001/01110',
  D: '11110/10001/10001/10001/10001/10001/11110',
  E: '11111/10000/10000/11110/10000/10000/11111',
  F: '11111/10000/10000/11110/10000/10000/10000',
  G: '01110/10001/10000/10111/10001/10001/01111',
  H: '10001/10001/10001/11111/10001/10001/10001',
  I: '11111/00100/00100/00100/00100/00100/11111',
  J: '00111/00010/00010/00010/00010/10010/01100',
  K: '10001/10010/10100/11000/10100/10010/10001',
  L: '10000/10000/10000/10000/10000/10000/11111',
  M: '10001/11011/10101/10101/10001/10001/10001',
  N: '10001/11001/10101/10011/10001/10001/10001',
  O: '01110/10001/10001/10001/10001/10001/01110',
  P: '11110/10001/10001/11110/10000/10000/10000',
  Q: '01110/10001/10001/10001/10101/10011/01111',
  R: '11110/10001/10001/11110/10100/10010/10001',
  S: '01111/10000/10000/01110/00001/00001/11110',
  T: '11111/00100/00100/00100/00100/00100/00100',
  U: '10001/10001/10001/10001/10001/10001/01110',
  V: '10001/10001/10001/10001/10001/01010/00100',
  W: '10001/10001/10001/10101/10101/11011/10001',
  X: '10001/10001/01010/00100/01010/10001/10001',
  Y: '10001/10001/01010/00100/00100/00100/00100',
  Z: '11111/00001/00010/00100/01000/10000/11111',
  '0': '01110/10001/10011/10101/11001/10001/01110',
  '1': '00100/01100/00100/00100/00100/00100/01110',
  '2': '01110/10001/00001/00110/01000/10000/11111',
  '3': '11110/00001/00001/01110/00001/00001/11110',
  '4': '00010/00110/01010/10010/11111/00010/00010',
  '5': '11111/10000/11110/00001/00001/10001/01110',
  '6': '01110/10000/10000/11110/10001/10001/01110',
  '7': '11111/00001/00010/00100/01000/01000/01000',
  '8': '01110/10001/10001/01110/10001/10001/01110',
  '9': '01110/10001/10001/01111/00001/00001/01110',
  ' ': '00000/00000/00000/00000/00000/00000/00000',
  '-': '00000/00000/00000/11111/00000/00000/00000',
  '.': '00000/00000/00000/00000/00000/01100/01100',
  ',': '00000/00000/00000/00000/01100/01100/00100',
  '/': '00001/00010/00010/00100/01000/01000/10000',
  ':': '00000/01100/01100/00000/01100/01100/00000',
  "'": '00100/00100/00000/00000/00000/00000/00000',
  '#': '01010/01010/11111/01010/11111/01010/01010',
  '+': '00000/00100/00100/11111/00100/00100/00000',
  '&': '01100/10010/10010/01100/10101/10010/01101',
  '(': '00010/00100/01000/01000/01000/00100/00010',
  ')': '01000/00100/00010/00010/00010/00100/01000',
  '*': '00000/01010/00100/11111/00100/01010/00000',
  '=': '00000/00000/11111/00000/11111/00000/00000',
  '!': '00100/00100/00100/00100/00100/00000/00100',
});

/** Width of one glyph cell in pixels. */
export const MUSIC_GLYPH_WIDTH = 5;
/** Height of one glyph cell row in pixels. */
export const MUSIC_GLYPH_HEIGHT = 7;
/** Gap between glyphs, in unscaled pixels. */
export const MUSIC_GLYPH_SPACING = 1;

function glyphRows(character: string): readonly string[] | null {
  const glyph = MUSIC_FONT_GLYPHS[character.toUpperCase()];
  if (glyph === undefined) return null;
  const rows = glyph.split('/');
  return rows.length === MUSIC_GLYPH_HEIGHT ? rows : null;
}

/** Width in pixels {@link drawMusicText} will advance for `text`. */
export function measureMusicText(text: string, scale = 1): number {
  const step = Math.max(Math.trunc(scale), 1);
  if (text.length === 0) return 0;
  return text.length * (MUSIC_GLYPH_WIDTH + MUSIC_GLYPH_SPACING) * step - MUSIC_GLYPH_SPACING * step;
}

/**
 * Draws `text` into `raster` with the bitmap font, returning the advance width.
 * Lowercase is folded to uppercase; undefined characters advance without ink.
 */
export function drawMusicText(
  raster: Raster,
  text: string,
  x: number,
  y: number,
  color: Rgb,
  scale = 1,
  alpha = 1,
): number {
  const step = Math.max(Math.trunc(scale), 1);
  let cursor = Math.round(x);
  for (const character of text) {
    const rows = glyphRows(character);
    if (rows !== null) {
      for (let row = 0; row < rows.length; row += 1) {
        const line = rows[row] ?? '';
        for (let column = 0; column < line.length; column += 1) {
          if (line[column] !== '1') continue;
          raster.fillRect(
            cursor + column * step,
            Math.round(y) + row * step,
            step,
            step,
            color,
            alpha,
          );
        }
      }
    }
    cursor += (MUSIC_GLYPH_WIDTH + MUSIC_GLYPH_SPACING) * step;
  }
  return cursor - Math.round(x);
}

/** Draws text centred on `centreX`. */
export function drawMusicTextCentered(
  raster: Raster,
  text: string,
  centreX: number,
  y: number,
  color: Rgb,
  scale = 1,
  alpha = 1,
): void {
  drawMusicText(raster, text, centreX - measureMusicText(text, scale) / 2, y, color, scale, alpha);
}

/* -------------------------------------------------------------------------- */
/* Texture vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/** Surface a device painter can produce. */
export type MusicTextureKind =
  | 'veneer'
  | 'bakelite'
  | 'rexine'
  | 'plastic'
  | 'aluminium'
  | 'painted-steel'
  | 'grille-cloth'
  | 'fabric-wrap'
  | 'dial-glass'
  | 'dial-led'
  | 'display'
  | 'badge'
  | 'speaker-cone'
  | 'record-label'
  | 'tape-label'
  | 'cable-braid'
  | 'keypad'
  | 'dust-film';

export const MUSIC_TEXTURE_KINDS = [
  'veneer',
  'bakelite',
  'rexine',
  'plastic',
  'aluminium',
  'painted-steel',
  'grille-cloth',
  'fabric-wrap',
  'dial-glass',
  'dial-led',
  'display',
  'badge',
  'speaker-cone',
  'record-label',
  'tape-label',
  'cable-braid',
  'keypad',
  'dust-film',
] as const satisfies readonly MusicTextureKind[];

/** Author facing painter request. */
export interface MusicTextureStyle {
  readonly kind: MusicTextureKind;
  /** Body colour. */
  readonly base: string;
  /** Pattern colour (weave, ticks, label ink). */
  readonly accent: string;
  /** Seam / grout / shadow colour. */
  readonly detail?: string;
  /** Sheen / highlight colour. */
  readonly highlight?: string;
  /** Primary lettering colour. */
  readonly text?: string;
  /** Secondary lettering colour. */
  readonly subText?: string;
  /** Lettering this surface carries (badges, screen titles, tape labels). */
  readonly lines?: readonly string[];
  /** Feature density 1..16 (grain lines, weave rows, speckles). */
  readonly scale?: number;
  /** Overall feature strength 0..1. */
  readonly contrast?: number;
  /** Explicit paint seed; defaults to a hash of the style. */
  readonly seed?: number;
  /** UV repetition of the finished texture (defaults to `[1, 1]`). */
  readonly repeat?: readonly [number, number];
  /** Square texture resolution in pixels. */
  readonly size?: number;
}

/** Default square resolution. Small on purpose: these are painted in code. */
export const DEFAULT_MUSIC_TEXTURE_SIZE = 96;

/** Every texture this module creates is named with this prefix. */
export const MUSIC_TEXTURE_PREFIX = 'music:';

/** Canvas factory used to reach the browser's 2D backend. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/**
 * Default factory: a DOM canvas when the document exists, otherwise `null`,
 * which makes {@link createMusicTexture} fall back to a `DataTexture`.
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
export interface MusicTexture {
  readonly key: string;
  readonly kind: MusicTextureKind;
  readonly width: number;
  readonly height: number;
  /** Which backend produced the texture. */
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  /** The 2D canvas when the canvas backend was used, otherwise `null`. */
  readonly canvas: HTMLCanvasElement | null;
}

export interface MusicTextureOptions {
  /** Texture key, used for `texture.name` (`music:<key>`). Defaults to the kind. */
  readonly key?: string;
  readonly canvasFactory?: CanvasFactory;
  /** Overrides the square resolution with an explicit height. */
  readonly height?: number;
  readonly anisotropy?: number;
}

/* -------------------------------------------------------------------------- */
/* Painters                                                                   */
/* -------------------------------------------------------------------------- */

interface PainterContext {
  readonly raster: Raster;
  readonly base: Rgb;
  readonly accent: Rgb;
  readonly detail: Rgb;
  readonly highlight: Rgb;
  readonly text: Rgb;
  readonly subText: Rgb;
  readonly lines: readonly string[];
  readonly scale: number;
  readonly contrast: number;
  readonly random: () => number;
}

type Painter = (context: PainterContext) => void;

/** Long wandering lines along the horizontal axis (wood grain, brushed metal). */
function grainLines(context: PainterContext, count: number, alpha: readonly [number, number], tone: (t: number) => Rgb): void {
  const { raster, random } = context;
  for (let index = 0; index < count; index += 1) {
    const lane = random() * raster.height;
    const amplitude = raster.height * (0.02 + random() * 0.06);
    const frequency = 1 + random() * 3;
    const phase = random() * Math.PI * 2;
    const color = tone(random());
    const strength = alpha[0] + random() * (alpha[1] - alpha[0]);
    const thickness = random() > 0.82 ? 2 : 1;
    for (let x = 0; x < raster.width; x += 1) {
      const t = x / Math.max(raster.width - 1, 1);
      const y = lane + Math.sin(t * Math.PI * 2 * frequency + phase) * amplitude;
      for (let step = 0; step < thickness; step += 1) {
        raster.blend(x, Math.round(y) + step, color, strength);
      }
    }
  }
}

/** Scattered granules or chips. */
function speckle(context: PainterContext, count: number, radius: readonly [number, number], alpha: readonly [number, number], tone: (t: number) => Rgb): void {
  const { raster, random } = context;
  for (let index = 0; index < count; index += 1) {
    const x = random() * raster.width;
    const y = random() * raster.height;
    const size = radius[0] + random() * (radius[1] - radius[0]);
    const strength = alpha[0] + random() * (alpha[1] - alpha[0]);
    raster.disc(x, y, size, tone(random()), strength);
  }
}

/** Pebbled leathercloth: each cell lit from the upper left, shadowed below. */
function pebble(context: PainterContext, count: number, radius: number): void {
  const { raster, random, base, highlight, detail } = context;
  for (let index = 0; index < count; index += 1) {
    const x = Math.round(random() * raster.width);
    const y = Math.round(random() * raster.height);
    const size = radius * (0.6 + random() * 0.8);
    raster.disc(x, y, size, mixRgb(base, detail, 0.45), 0.55);
    raster.disc(x - size * 0.35, y - size * 0.35, size * 0.5, mixRgb(base, highlight, 0.5), 0.35);
  }
}

/** Woven cloth: warp and weft threads with slubs and a little moiré. */
function weave(context: PainterContext, rows: number, columns: number, slubs: number): void {
  const { raster, random, base, accent, detail, highlight } = context;
  const rowStep = Math.max(raster.height / Math.max(rows, 1), 1);
  const columnStep = Math.max(raster.width / Math.max(columns, 1), 1);
  // Weft (horizontal) threads first, then the warp crossing over them.
  for (let y = 0; y < raster.height; y += rowStep) {
    const tone = random() > 0.5 ? mixRgb(base, accent, 0.35) : base;
    raster.fillRect(0, Math.round(y), raster.width, Math.max(Math.round(rowStep * 0.55), 1), tone, 0.85);
    raster.fillRect(0, Math.round(y + rowStep * 0.55), raster.width, 1, mixRgb(base, detail, 0.6), 0.4);
  }
  for (let x = 0; x < raster.width; x += columnStep) {
    const width = Math.max(Math.round(columnStep * 0.42), 1);
    for (let y = 0; y < raster.height; y += 1) {
      const over = Math.floor(y / Math.max(rowStep, 1)) % 2 === 0;
      const tone = over ? mixRgb(base, highlight, 0.25) : mixRgb(base, accent, 0.5);
      raster.fillRect(Math.round(x), y, width, 1, tone, over ? 0.55 : 0.3);
    }
  }
  for (let index = 0; index < slubs; index += 1) {
    const x = random() * raster.width;
    const y = random() * raster.height;
    raster.line(x, y, x + 2 + random() * 5, y + (random() - 0.5) * 2, mixRgb(base, highlight, 0.5), 0.5);
  }
}

/** Diagonal over/under braid, as a vintage cloth-covered flex is woven. */
function braid(context: PainterContext): void {
  const { raster, base, accent, highlight } = context;
  const step = 6;
  for (let y = 0; y < raster.height; y += step) {
    for (let x = 0; x < raster.width; x += step) {
      const over = ((x + y) / step) % 2 === 0;
      raster.line(x, y + step, x + step, y, over ? mixRgb(base, highlight, 0.35) : mixRgb(base, accent, 0.6), over ? 0.75 : 0.5, 2);
    }
  }
  raster.noise(context.random, context.contrast * 0.12);
}

const PAINTERS: Readonly<Record<MusicTextureKind, Painter>> = {
  /* Cabinet joinery: growth bands, long grain, pores and a knot or two. */
  veneer: (context) => {
    const { raster, base, accent, detail, highlight, scale, random, contrast } = context;
    raster.fill(base);
    const bands = Math.max(Math.round(scale), 2);
    const bandHeight = raster.height / bands;
    for (let index = 0; index < bands; index += 1) {
      const tone = mixRgb(base, random() > 0.5 ? accent : detail, 0.12 + random() * 0.2);
      raster.fillRect(0, Math.round(index * bandHeight), raster.width, Math.ceil(bandHeight), tone, 0.5);
    }
    grainLines(context, Math.round(10 + scale * 2), [0.08, 0.3], (t) => mixRgb(base, t > 0.6 ? detail : accent, 0.5));
    // Pores: short dark dashes along the grain.
    for (let index = 0; index < 40 + scale * 4; index += 1) {
      const x = random() * raster.width;
      const y = random() * raster.height;
      raster.line(x, y, x + 2 + random() * 6, y + (random() - 0.5) * 0.6, mixRgb(base, detail, 0.75), 0.28);
    }
    // A cathedral knot.
    const knotX = random() * raster.width;
    const knotY = random() * raster.height;
    for (let index = 3; index >= 1; index -= 1) {
      raster.ring(knotX, knotY, index * 3, 1, mixRgb(base, detail, 0.6), 0.22);
    }
    raster.disc(knotX, knotY, 1.6, mixRgb(base, accent, 0.7), 0.7);
    raster.sheen(0.06 + contrast * 0.05, highlight);
    raster.vignette(0.08);
  },

  /* Early plastics: mottled swirl over a fine polish. */
  bakelite: (context) => {
    const { raster, base, accent, detail, highlight, random, contrast } = context;
    raster.fill(base);
    for (let index = 0; index < 90; index += 1) {
      const x = random() * raster.width;
      const y = random() * raster.height;
      const radius = 2 + random() * 7;
      raster.disc(x, y, radius, mixRgb(base, random() > 0.5 ? detail : accent, 0.35), 0.22);
    }
    grainLines(context, 14, [0.05, 0.16], (t) => mixRgb(base, t > 0.5 ? highlight : detail, 0.5));
    speckle(context, 260, [0.4, 1.1], [0.06, 0.2], () => mixRgb(base, detail, 0.7));
    raster.sheen(0.1 + contrast * 0.08, highlight);
  },

  /* Leathercloth: pebble grain with a seam every so often. */
  rexine: (context) => {
    const { raster, base, detail, accent } = context;
    raster.fill(base);
    pebble(context, 420, 1.5);
    raster.line(0, 4, raster.width, 4, mixRgb(base, detail, 0.7), 0.3);
    raster.line(0, raster.height - 5, raster.width, raster.height - 5, mixRgb(base, accent, 0.6), 0.25);
    raster.vignette(0.1);
  },

  /* Moulded thermoset: bloom-free sheen, a mould flow line and screw bosses. */
  plastic: (context) => {
    const { raster, base, accent, detail, highlight, random } = context;
    raster.fill(base);
    speckle(context, 320, [0.3, 0.9], [0.04, 0.14], () => mixRgb(base, detail, 0.6));
    for (let index = 0; index < 6; index += 1) {
      const x = random() * raster.width;
      raster.line(x, 0, x + 8, raster.height, mixRgb(base, highlight, 0.35), 0.08);
    }
    raster.fillRect(0, raster.height - 3, raster.width, 1, mixRgb(base, accent, 0.5), 0.35);
    raster.sheen(0.12, highlight);
  },

  /* Brushed aluminium with a perforation grid. */
  aluminium: (context) => {
    const { raster, base, accent, detail, highlight, random, scale } = context;
    raster.fill(base);
    for (let index = 0; index < 220; index += 1) {
      const y = Math.round(random() * raster.height);
      const tone = random() > 0.5 ? highlight : detail;
      raster.fillRect(0, y, raster.width, 1, tone, 0.06 + random() * 0.12);
    }
    const spacing = Math.max(7 - Math.round(scale / 3), 3);
    for (let y = spacing; y < raster.height; y += spacing) {
      for (let x = spacing; x < raster.width; x += spacing) {
        raster.disc(x, y, 1, mixRgb(base, detail, 0.8), 0.5);
        raster.disc(x - 0.6, y - 0.6, 0.5, mixRgb(base, highlight, 0.6), 0.4);
      }
    }
    raster.line(0, 0, raster.width, 0, accent, 0.3);
  },

  /* Enamelled or powder-coated steel with chips and wear. */
  'painted-steel': (context) => {
    const { raster, base, accent, detail, highlight, random } = context;
    raster.fill(base);
    for (let index = 0; index < 12; index += 1) {
      const x = random() * raster.width;
      const y = random() * raster.height;
      raster.disc(x, y, 1 + random() * 2.4, mixRgb(base, detail, 0.75), 0.4);
      raster.disc(x + 1, y + 1, 1 + random(), mixRgb(base, highlight, 0.6), 0.25);
    }
    speckle(context, 200, [0.3, 0.8], [0.05, 0.16], () => mixRgb(base, detail, 0.5));
    raster.fillRect(0, raster.height - 2, raster.width, 2, mixRgb(base, accent, 0.4), 0.3);
    raster.sheen(0.08, highlight);
  },

  /* Speaker cloth: the loom detail the inspector sees when zoomed in. */
  'grille-cloth': (context) => {
    const { raster, base, detail, highlight, scale, random } = context;
    raster.fill(mixRgb(base, detail, 0.35));
    weave(context, Math.max(Math.round(scale * 3), 6), Math.max(Math.round(scale * 3), 6), 24);
    raster.noise(random, 0.1);
    raster.sheen(0.05, highlight);
  },

  /* Modern speaker wrap: a fine knit with diagonal stitches. */
  'fabric-wrap': (context) => {
    const { raster, base, accent, detail, highlight, random } = context;
    raster.fill(base);
    const step = 4;
    for (let y = 0; y < raster.height; y += step) {
      for (let x = 0; x < raster.width; x += step) {
        const offset = (y / step) % 2 === 0 ? 0 : step / 2;
        raster.line(x + offset, y, x + offset + step / 2, y + step, mixRgb(base, highlight, 0.4), 0.35);
        raster.line(x + offset + step / 2, y, x + offset + step, y + step, mixRgb(base, detail, 0.5), 0.3);
      }
    }
    speckle(context, 160, [0.3, 0.8], [0.05, 0.12], () => mixRgb(base, accent, 0.5));
    raster.noise(random, 0.05);
  },

  /* Illuminated dial glass: scale, station names, needle shadow and dust. */
  'dial-glass': (context) => {
    const { raster, base, accent, detail, highlight, text, subText, lines } = context;
    raster.fill(base);
    // Warm aged glass with a soft top wash.
    for (let y = 0; y < raster.height; y += 1) {
      raster.fillRect(0, y, raster.width, 1, mixRgb(base, highlight, 0.15 * (1 - y / raster.height)), 0.25);
    }
    const baseline = Math.round(raster.height * 0.68);
    raster.line(0, baseline, raster.width, baseline, detail, 0.6);
    const ticks = 21;
    for (let index = 0; index < ticks; index += 1) {
      const x = Math.round((index / (ticks - 1)) * (raster.width - 1));
      const major = index % 5 === 0;
      raster.fillRect(x, baseline - (major ? 6 : 3), 1, major ? 6 : 3, detail, major ? 0.85 : 0.5);
    }
    // Station names along the band, as a 1940s dial carried.
    const stations = lines.length > 0 ? lines : ['HOME', 'FORCES', 'LIGHT', 'BBC', 'THIRD', 'WORLD'];
    stations.forEach((name, index) => {
      const x = (index / stations.length) * raster.width + 2;
      drawMusicText(raster, name, x, Math.round(raster.height * 0.3), index % 2 === 0 ? text : subText, 1, 0.9);
    });
    drawMusicText(raster, lines[0] ?? 'MUSIC', 3, 3, accent, 1, 0.85);
    // Dial lamp bloom behind the glass.
    raster.disc(raster.width * 0.5, raster.height * 0.22, raster.width * 0.34, highlight, 0.08);
    // Dust specks and a hairline scratch.
    speckle(context, 60, [0.3, 0.8], [0.05, 0.18], () => detail);
    raster.line(raster.width * 0.2, 0, raster.width * 0.28, raster.height, highlight, 0.08);
    raster.sheen(0.1, highlight);
    raster.vignette(0.14);
  },

  /* LED bar display: dark glass with lit segments and a glow bloom. */
  'dial-led': (context) => {
    const { raster, accent, base, detail, highlight, random } = context;
    raster.fill(shade(base, 0.35));
    const bars = 12;
    const width = raster.width / bars;
    for (let index = 0; index < bars; index += 1) {
      const lit = index >= 2 && index <= 8;
      raster.fillRect(index * width + 1, 4, Math.max(width - 2, 1), raster.height * 0.62, lit ? accent : detail, lit ? 0.9 : 0.25);
    }
    raster.disc(raster.width * 0.5, raster.height * 0.35, raster.width * 0.42, accent, 0.12);
    raster.line(0, raster.height * 0.75, raster.width, raster.height * 0.75, mixRgb(base, highlight, 0.5), 0.4);
    speckle(context, 40, [0.3, 0.7], [0.04, 0.12], () => highlight);
    raster.noise(random, 0.06);
  },

  /* Screen: gradient backdrop, title / artist text, progress bar, glow. */
  display: (context) => {
    const { raster, base, accent, detail, highlight, text, subText, lines } = context;
    for (let y = 0; y < raster.height; y += 1) {
      raster.fillRect(0, y, raster.width, 1, mixRgb(shade(base, 0.5), accent, 0.25 + 0.5 * (y / raster.height)), 0.9);
    }
    const headline = lines[0] ?? 'NOW PLAYING';
    const title = lines[1] ?? 'SIDE A';
    const detailLine = lines[2] ?? 'TRACK 04';
    const emphasis = raster.width >= 128 ? 2 : 1;
    drawMusicText(raster, headline, 4, Math.round(raster.height * 0.14), mixRgb(text, highlight, 0.3), emphasis, 0.95);
    drawMusicText(raster, title, 4, Math.round(raster.height * 0.42), text, emphasis, 0.9);
    drawMusicText(raster, detailLine, 4, Math.round(raster.height * 0.6), subText, 1, 0.85);
    raster.fillRect(0, raster.height - 3, raster.width, 2, detail, 0.5);
    raster.fillRect(0, raster.height - 3, raster.width * 0.62, 2, accent, 0.95);
    raster.sheen(0.14, highlight);
    raster.vignette(0.2);
  },

  /* Model plate: brushed metal, border, brand and model lettering, screws. */
  badge: (context) => {
    const { raster, base, accent, detail, highlight, text, subText, lines, random } = context;
    raster.fill(base);
    for (let index = 0; index < 60; index += 1) {
      const y = Math.round(random() * raster.height);
      raster.fillRect(0, y, raster.width, 1, random() > 0.5 ? highlight : detail, 0.07);
    }
    raster.rectOutline(1, 1, raster.width - 2, raster.height - 2, 1, detail, 0.8);
    raster.rectOutline(3, 3, raster.width - 6, raster.height - 6, 1, mixRgb(detail, accent, 0.4), 0.5);
    const title = lines[0] ?? 'BRAND';
    const subtitle = lines[1];
    const emphasis = raster.width >= 128 ? 2 : 1;
    drawMusicTextCentered(raster, title, raster.width / 2, Math.round(raster.height * 0.12), text, emphasis, 1);
    if (subtitle !== undefined) {
      drawMusicTextCentered(raster, subtitle, raster.width / 2, Math.round(raster.height * 0.58), subText, 1, 0.95);
    }
    raster.disc(3, 3, 1, detail, 0.8);
    raster.disc(raster.width - 4, 3, 1, detail, 0.8);
    raster.disc(3, raster.height - 4, 1, detail, 0.8);
    raster.disc(raster.width - 4, raster.height - 4, 1, detail, 0.8);
    raster.sheen(0.16, highlight);
  },

  /* Speaker cone: paper, concentric rings, radial creases and a dust cap. */
  'speaker-cone': (context) => {
    const { raster, base, accent, detail, highlight, random } = context;
    raster.fill(shade(base, 0.5));
    const cx = raster.width / 2;
    const cy = raster.height / 2;
    const outer = Math.min(cx, cy) - 1;
    for (let index = 0; index < 6; index += 1) {
      raster.ring(cx, cy, outer * (0.45 + index * 0.1), 1, mixRgb(base, detail, 0.5), 0.28);
    }
    for (let index = 0; index < 26; index += 1) {
      const angle = (index / 26) * Math.PI * 2 + random() * 0.08;
      raster.line(
        cx + Math.cos(angle) * outer * 0.3,
        cy + Math.sin(angle) * outer * 0.3,
        cx + Math.cos(angle) * outer * 0.92,
        cy + Math.sin(angle) * outer * 0.92,
        mixRgb(base, highlight, 0.35),
        0.12,
      );
    }
    raster.disc(cx, cy, outer * 0.3, mixRgb(base, accent, 0.35), 0.85);
    raster.disc(cx - outer * 0.08, cy - outer * 0.08, outer * 0.16, mixRgb(base, highlight, 0.55), 0.4);
    raster.ring(cx, cy, outer, 2, detail, 0.85);
    raster.ring(cx, cy, outer * 0.94, 1, mixRgb(base, highlight, 0.4), 0.3);
    raster.noise(random, 0.08);
  },

  /* Vinyl: fine grooves, coloured label, spindle hole, worn lead-in. */
  'record-label': (context) => {
    const { raster, base, accent, detail, text, random } = context;
    raster.fill(shade(base, 0.25));
    const cx = raster.width / 2;
    const cy = raster.height / 2;
    const outer = Math.min(cx, cy) - 1;
    for (let radius = 2; radius < outer; radius += 1) {
      raster.ring(cx, cy, radius, 1, random() > 0.5 ? shade(base, 0.05) : shade(base, 0.55), 0.35);
    }
    raster.disc(cx, cy, outer * 0.42, accent, 0.95);
    raster.ring(cx, cy, outer * 0.42, 1, detail, 0.6);
    drawMusicTextCentered(raster, '78 RPM', cx, cy - 7, text, 1, 0.9);
    drawMusicTextCentered(raster, 'SIDE A', cx, cy + 2, text, 1, 0.85);
    raster.disc(cx, cy, 2, shade(base, 0.2), 1);
    raster.sheen(0.1);
  },

  /* Cassette or tape label: shell, window, spool holes, written title. */
  'tape-label': (context) => {
    const { raster, base, accent, detail, highlight, text, subText, lines } = context;
    raster.fill(base);
    raster.rectOutline(1, 1, raster.width - 2, raster.height - 2, 1, detail, 0.8);
    raster.fillRect(3, 3, raster.width - 6, Math.round(raster.height * 0.5), mixRgb(base, highlight, 0.35), 0.6);
    drawMusicText(raster, lines[0] ?? 'MIX TAPE', 4, 5, text, 1, 0.9);
    raster.line(4, raster.height * 0.34, raster.width - 5, raster.height * 0.34, detail, 0.4);
    raster.line(4, raster.height * 0.46, raster.width - 8, raster.height * 0.46, detail, 0.35);
    const windowY = Math.round(raster.height * 0.62);
    raster.fillRect(4, windowY, raster.width - 8, Math.round(raster.height * 0.3), shade(base, 0.45), 0.9);
    raster.disc(raster.width * 0.34, windowY + raster.height * 0.15, 3, accent, 0.9);
    raster.disc(raster.width * 0.66, windowY + raster.height * 0.15, 3, accent, 0.9);
    drawMusicText(raster, 'A', 4, raster.height - 8, subText, 1, 0.8);
    speckle(context, 30, [0.3, 0.7], [0.04, 0.1], () => detail);
  },

  /* Cloth-covered flex: braid over a rubber core. */
  'cable-braid': (context) => {
    const { base, detail } = context;
    context.raster.fill(mixRgb(base, detail, 0.4));
    braid(context);
    context.raster.vignette(0.25);
  },

  /* Selector keypad: chrome buttons with stamped legends. */
  keypad: (context) => {
    const { raster, base, detail, highlight, text, random } = context;
    raster.fill(shade(base, 0.6));
    const columns = 4;
    const rows = 3;
    const cellW = raster.width / columns;
    const cellH = raster.height / rows;
    let label = 1;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const cx = column * cellW + cellW / 2;
        const cy = row * cellH + cellH / 2;
        raster.disc(cx, cy, Math.min(cellW, cellH) * 0.36, mixRgb(base, highlight, 0.45), 1);
        raster.ring(cx, cy, Math.min(cellW, cellH) * 0.36, 1, detail, 0.8);
        drawMusicTextCentered(raster, String(label), cx, cy - 3, text, 1, 0.95);
        label = label === 9 ? 0 : label + 1;
      }
    }
    raster.noise(random, 0.06);
  },

  /* Aged sheen: dust, fingerprints and a wiped streak (alpha decal). */
  'dust-film': (context) => {
    const { raster, base, detail, highlight, random } = context;
    raster.clear();
    for (let y = 0; y < raster.height; y += 1) {
      for (let x = 0; x < raster.width; x += 1) {
        const falloff = 1 - Math.abs(x / raster.width - 0.5) * 1.4;
        raster.blend(x, y, mixRgb(base, detail, 0.4), Math.max(falloff, 0) * 0.16);
      }
    }
    speckle(context, 90, [0.3, 1.2], [0.05, 0.25], () => detail);
    raster.line(0, raster.height * 0.6, raster.width, raster.height * 0.55, mixRgb(base, highlight, 0.8), 0.14, 2);
    raster.noise(random, 0.08);
  },
};

/** Every painter, exported for tooling and tests. */
export const MUSIC_TEXTURE_PAINTERS: Readonly<Record<MusicTextureKind, Painter>> = PAINTERS;

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MUSIC_TEXTURE_SIZE;
  return Math.min(Math.max(Math.trunc(value), 8), 512);
}

function resolveStyle(style: MusicTextureStyle): {
  base: Rgb;
  accent: Rgb;
  detail: Rgb;
  highlight: Rgb;
  text: Rgb;
  subText: Rgb;
} {
  const base = parseColor(style.base);
  const accent = parseColor(style.accent);
  return {
    base,
    accent,
    detail: style.detail ? parseColor(style.detail) : shade(base, 0.5),
    highlight: style.highlight ? parseColor(style.highlight) : shade(base, 1.45),
    text: style.text ? parseColor(style.text) : shade(base, 1.8),
    subText: style.subText ? parseColor(style.subText) : shade(accent, 1.35),
  };
}

/** Paints `style` into a fresh raster (used by the tests to compare eras). */
export function paintMusicSurface(style: MusicTextureStyle & { size?: number }): Raster {
  const size = clampSize(style.size ?? DEFAULT_MUSIC_TEXTURE_SIZE);
  const raster = new Raster(size, size);
  const palette = resolveStyle(style);
  const seed =
    style.seed ?? (hashString(`${style.kind}|${style.base}|${style.accent}`) ^ 0x9e3779b9);
  PAINTERS[style.kind]({
    raster,
    ...palette,
    lines: style.lines ?? [],
    scale: Math.min(Math.max(style.scale ?? 4, 1), 16),
    contrast: Math.min(Math.max(style.contrast ?? 0.6, 0), 1),
    random: createSeededRandom(seed),
  });
  return raster;
}

function applyTextureSettings(
  texture: THREE.Texture,
  key: string,
  style: MusicTextureStyle,
  options: MusicTextureOptions,
  source: 'canvas' | 'data',
): void {
  const repeat = style.repeat ?? [1, 1];
  texture.name = `${MUSIC_TEXTURE_PREFIX}${key}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    Number.isFinite(repeat[0]) ? repeat[0] : 1,
    Number.isFinite(repeat[1]) ? repeat[1] : 1,
  );
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (options.anisotropy !== undefined && Number.isFinite(options.anisotropy)) {
    texture.anisotropy = Math.max(Math.trunc(options.anisotropy), 1);
  }
  texture.needsUpdate = true;
  texture.userData = {
    music: { key, kind: style.kind, procedural: true, source },
  };
}

/**
 * Paints `style` and returns it as a texture. Uses the canvas backend when
 * `options.canvasFactory` (or the DOM) provides one, otherwise a `DataTexture`.
 */
export function createMusicTexture(
  style: MusicTextureStyle,
  options: MusicTextureOptions = {},
): MusicTexture {
  const width = clampSize(style.size ?? DEFAULT_MUSIC_TEXTURE_SIZE);
  const height = clampSize(options.height ?? width);
  const pixels = paintMusicSurface({ ...style, size: width });
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
export function isMusicTexture(texture: THREE.Texture): boolean {
  return (
    (texture instanceof THREE.DataTexture || texture instanceof THREE.CanvasTexture) &&
    texture.name.startsWith(MUSIC_TEXTURE_PREFIX)
  );
}

/** Disposes every texture in `textures` (safe to call twice). */
export function disposeMusicTextures(textures: Iterable<THREE.Texture>): number {
  const seen = new Set<THREE.Texture>();
  let count = 0;
  for (const texture of textures) {
    if (seen.has(texture)) continue;
    seen.add(texture);
    texture.dispose();
    count += 1;
  }
  return count;
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
