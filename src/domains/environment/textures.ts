/**
 * Procedural surface textures for the café finishes and window dressing.
 *
 * Nothing in this module is downloaded: every finish, tile, awning stripe and
 * signage blade is painted here, pixel by pixel, by the painters in this file.
 * The same pixel buffer feeds two backends:
 *
 *  - **canvas** — when a DOM canvas is available (the browser build) the buffer
 *    is blitted with `putImageData` and wrapped in a `CanvasTexture`, so the GPU
 *    uploads an ordinary 2D canvas.
 *  - **data** — when no canvas exists (headless/node, the kernel's headless
 *    harness, tests) the same bytes become a `DataTexture`.
 *
 * Both paths are deterministic for a given {@link TextureStyle}: the painters
 * only use a seeded PRNG, so an era looks the same on every run and the tests
 * can assert real pixel content instead of a placeholder colour.
 *
 * Pixel vocabulary
 * ----------------
 * `base` is the body colour, `accent` the pattern colour, `detail` the grout /
 * seam colour and `highlight` the optional sheen colour. Painters tile
 * seamlessly (they wrap at the texture edges) because every finish is used with
 * `RepeatWrapping`.
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
/* Texture vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/** Painter used for a surface. */
export type TextureKind =
  | 'planks'
  | 'checker'
  | 'speckle'
  | 'stripes'
  | 'grid'
  | 'motif'
  | 'plain'
  | 'lettering';

/** Colour vocabulary of a procedural finish. */
export interface TexturePalette {
  /** Body colour. */
  readonly base: string;
  /** Pattern colour. */
  readonly accent: string;
  /** Grout, seam or line colour. Defaults to a darkened `base`. */
  readonly detail?: string;
  /** Sheen / highlight colour. Defaults to a lightened `base`. */
  readonly highlight?: string;
}

/** Sub-variant of the `grid` painter. */
export type GridVariant = 'tiles' | 'panels' | 'coffers';

/** Complete recipe for one procedural finish. */
export interface TextureStyle {
  readonly kind: TextureKind;
  readonly palette: TexturePalette;
  /** Pattern repetitions along one texture edge (default 4). */
  readonly scale?: number;
  /** Noise strength, 0..1 (default 0.16). */
  readonly contrast?: number;
  /** Pattern direction (default `'horizontal'`). */
  readonly orientation?: 'horizontal' | 'vertical';
  /** Sub-variant for the `grid` painter. */
  readonly variant?: GridVariant;
  /** UV repetition of the finished texture across the surface (default `[1, 1]`). */
  readonly repeat?: readonly [number, number];
  /** Square texture resolution in pixels (default {@link DEFAULT_TEXTURE_SIZE}). */
  readonly size?: number;
  /** `'pattern'` paints on a transparent base so the map can be masked. */
  readonly transparency?: 'none' | 'pattern';
  /** Explicit paint seed; defaults to a hash of kind + palette + scale. */
  readonly seed?: number;
}

/** Default square texture resolution. Small on purpose: these are procedural. */
export const DEFAULT_TEXTURE_SIZE = 128;

/** Signage blades are wide, so their lettering map is too. */
export const SIGNAGE_TEXTURE_WIDTH = 512;
export const SIGNAGE_TEXTURE_HEIGHT = 128;

/** Every texture this module creates is named with this prefix. */
export const FINISH_TEXTURE_PREFIX = 'env:';

/** Canvas factory used to reach the browser's 2D backend. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/**
 * Default factory: a DOM canvas when the document exists, otherwise `null`,
 * which makes {@link createFinishTexture} fall back to a `DataTexture`.
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
export interface FinishTexture {
  readonly key: string;
  readonly kind: TextureKind;
  readonly width: number;
  readonly height: number;
  /** Which backend produced the texture. */
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  /** The 2D canvas when the canvas backend was used, otherwise `null`. */
  readonly canvas: HTMLCanvasElement | null;
}

export interface FinishTextureOptions {
  /** Texture key, used for `texture.name` (`env:<key>`). Defaults to the kind. */
  readonly key?: string;
  readonly canvasFactory?: CanvasFactory;
  /** Overrides the square resolution with an explicit height. */
  readonly height?: number;
  readonly anisotropy?: number;
}

/* -------------------------------------------------------------------------- */
/* Pixel buffer                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Tiny RGBA raster with the handful of primitives the painters need. All
 * coordinates wrap, so patterns tile without seams.
 */
export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = Math.max(Math.trunc(width), 1);
    this.height = Math.max(Math.trunc(height), 1);
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
  }

  private offset(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  /** Wraps a coordinate into the buffer. */
  wrapX(x: number): number {
    const wrapped = x % this.width;
    return wrapped < 0 ? wrapped + this.width : wrapped;
  }

  wrapY(y: number): number {
    const wrapped = y % this.height;
    return wrapped < 0 ? wrapped + this.height : wrapped;
  }

  /** Sets a pixel, wrapping outside coordinates. */
  set(x: number, y: number, color: Rgb, alpha = 255): void {
    const index = this.offset(this.wrapX(Math.trunc(x)), this.wrapY(Math.trunc(y)));
    const data = this.data;
    data[index] = color.r;
    data[index + 1] = color.g;
    data[index + 2] = color.b;
    data[index + 3] = alpha;
  }

  /** Blends a pixel over the existing one. */
  blend(x: number, y: number, color: Rgb, amount: number): void {
    const index = this.offset(this.wrapX(Math.trunc(x)), this.wrapY(Math.trunc(y)));
    const data = this.data;
    const t = Math.min(Math.max(amount, 0), 1);
    data[index] = clampByte((data[index] ?? 0) + (color.r - (data[index] ?? 0)) * t);
    data[index + 1] = clampByte((data[index + 1] ?? 0) + (color.g - (data[index + 1] ?? 0)) * t);
    data[index + 2] = clampByte((data[index + 2] ?? 0) + (color.b - (data[index + 2] ?? 0)) * t);
    data[index + 3] = Math.max(data[index + 3] ?? 0, clampByte(255 * t));
  }

  /** Fills the whole buffer. */
  fill(color: Rgb, alpha = 255): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.set(x, y, color, alpha);
      }
    }
  }

  /** Fills a wrapped rectangle. */
  fillRect(x: number, y: number, width: number, height: number, color: Rgb, alpha = 255): void {
    const x0 = Math.trunc(x);
    const y0 = Math.trunc(y);
    const w = Math.max(Math.trunc(width), 0);
    const h = Math.max(Math.trunc(height), 0);
    for (let row = 0; row < h; row += 1) {
      for (let column = 0; column < w; column += 1) {
        this.set(x0 + column, y0 + row, color, alpha);
      }
    }
  }

  /** Draws a straight line (axis aligned or diagonal) with a thickness. */
  line(x0: number, y0: number, x1: number, y1: number, color: Rgb, thickness = 1): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const radius = Math.max(Math.trunc(thickness / 2), 0);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      this.fillRect(x - radius, y - radius, radius * 2 + 1, radius * 2 + 1, color);
    }
  }

  /** Vertical gradient from `top` to `bottom`. */
  verticalGradient(top: Rgb, bottom: Rgb, alpha = 255): void {
    for (let y = 0; y < this.height; y += 1) {
      const color = mixRgb(top, bottom, this.height === 1 ? 0 : y / (this.height - 1));
      for (let x = 0; x < this.width; x += 1) {
        this.set(x, y, color, alpha);
      }
    }
  }

  /** Multiplies each pixel by a small deterministic jitter in `±amount`. */
  noise(random: () => number, amount: number): void {
    const strength = Math.min(Math.max(amount, 0), 1);
    if (strength === 0) return;
    const data = this.data;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = this.offset(x, y);
        const factor = 1 + (random() * 2 - 1) * strength * 0.35;
        data[index] = clampByte((data[index] ?? 0) * factor);
        data[index + 1] = clampByte((data[index + 1] ?? 0) * factor);
        data[index + 2] = clampByte((data[index + 2] ?? 0) * factor);
      }
    }
  }

  /** Number of distinct RGBA values in the buffer (test/debug helper). */
  distinctColors(): number {
    const seen = new Set<number>();
    const data = this.data;
    for (let index = 0; index < data.length; index += 4) {
      seen.add(
        (((data[index] ?? 0) << 24) |
          ((data[index + 1] ?? 0) << 16) |
          ((data[index + 2] ?? 0) << 8) |
          (data[index + 3] ?? 0)) >>>
          0,
      );
    }
    return seen.size;
  }
}

/* -------------------------------------------------------------------------- */
/* 5x7 bitmap font                                                            */
/* -------------------------------------------------------------------------- */

/** Glyph bitmaps: 7 rows of 5 columns, `#` = ink. */
const FONT_5X7: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '....#', '....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '&': ['.##..', '#..#.', '#..#.', '.##..', '#.#.#', '#..#.', '.##.#'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
});

/** Width of one glyph cell (ink + spacing) in font pixels. */
export const FONT_GLYPH_WIDTH = 5;
export const FONT_GLYPH_HEIGHT = 7;

/** Width of `text` in pixels at `scale`, including a 1 pixel inter-glyph gap. */
export function measureText(text: string, scale: number, tracking = 1): number {
  const advance = (FONT_GLYPH_WIDTH + tracking) * scale;
  return Math.max(text.length * advance - tracking * scale, 0);
}

/** Draws `text` with the built-in bitmap font. Unknown glyphs render as blanks. */
export function drawText(
  pixels: PixelBuffer,
  text: string,
  options: {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly color: Rgb;
    readonly tracking?: number;
    readonly alpha?: number;
  },
): void {
  const scale = Math.max(Math.trunc(options.scale), 1);
  const tracking = options.tracking ?? 1;
  const alpha = options.alpha ?? 255;
  const advance = (FONT_GLYPH_WIDTH + tracking) * scale;
  const glyphs = text.toUpperCase().split('');
  glyphs.forEach((glyph, glyphIndex) => {
    const rows = FONT_5X7[glyph] ?? FONT_5X7[' '];
    if (!rows) return;
    rows.forEach((row, rowIndex) => {
      row.split('').forEach((cell, columnIndex) => {
        if (cell !== '#') return;
        const x = options.x + glyphIndex * advance + columnIndex * scale;
        const y = options.y + rowIndex * scale;
        pixels.fillRect(x, y, scale, scale, options.color, alpha);
      });
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Painters                                                                   */
/* -------------------------------------------------------------------------- */

type Painter = (
  pixels: PixelBuffer,
  palette: ResolvedPalette,
  style: TextureStyle,
  random: () => number,
) => void;

interface ResolvedPalette extends TexturePalette {
  readonly baseRgb: Rgb;
  readonly accentRgb: Rgb;
  readonly detailRgb: Rgb;
  readonly highlightRgb: Rgb;
}

function resolvePalette(palette: TexturePalette): ResolvedPalette {
  const baseRgb = parseColor(palette.base);
  const accentRgb = parseColor(palette.accent);
  const detailRgb = parseColor(palette.detail ?? '#000000');
  const highlightRgb = parseColor(palette.highlight ?? '#ffffff');
  return {
    ...palette,
    baseRgb,
    accentRgb,
    detailRgb: palette.detail ? detailRgb : shade(baseRgb, 0.62),
    highlightRgb: palette.highlight ? highlightRgb : mixRgb(baseRgb, highlightRgb, 0.28),
  };
}

const paintPlanks: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  const boardHeight = Math.max(Math.floor(pixels.height / scale), 2);
  pixels.fill(palette.baseRgb);
  for (let y = 0; y < pixels.height; y += boardHeight) {
    const tint = 1 + (random() * 2 - 1) * (style.contrast ?? 0.16) * 0.7;
    pixels.fillRect(0, y, pixels.width, boardHeight - 1, shade(palette.baseRgb, tint));
    // Grain streaks running along the board.
    const streaks = 2 + Math.floor(random() * 3);
    for (let streak = 0; streak < streaks; streak += 1) {
      const offset = 1 + Math.floor(random() * (boardHeight - 2));
      const startX = Math.floor(random() * pixels.width);
      const length = Math.floor(pixels.width * (0.4 + random() * 0.6));
      const tone = shade(palette.accentRgb, 0.75 + random() * 0.5);
      pixels.line(startX, y + offset, startX + length, y + offset, tone, 1);
    }
    // Seam between boards.
    pixels.fillRect(0, y + boardHeight - 1, pixels.width, 1, palette.detailRgb);
  }
  pixels.noise(random, style.contrast ?? 0.16);
};

const paintChecker: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  const cell = Math.max(Math.floor(pixels.width / scale), 2);
  pixels.fill(palette.baseRgb);
  for (let y = 0; y < pixels.height; y += cell) {
    for (let x = 0; x < pixels.width; x += cell) {
      const checker = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) === 0;
      const tint = 1 + (random() * 2 - 1) * (style.contrast ?? 0.12) * 0.5;
      pixels.fillRect(x, y, cell, cell, shade(checker ? palette.accentRgb : palette.baseRgb, tint));
      // Grout.
      pixels.fillRect(x, y, cell, 1, palette.detailRgb);
      pixels.fillRect(x, y, 1, cell, palette.detailRgb);
    }
  }
  pixels.noise(random, (style.contrast ?? 0.12) * 0.6);
};

const paintSpeckle: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 3, 1);
  const contrast = style.contrast ?? 0.2;
  pixels.fill(palette.baseRgb);
  const speckles = Math.floor(pixels.width * pixels.height * 0.012 * scale);
  for (let index = 0; index < speckles; index += 1) {
    const x = Math.floor(random() * pixels.width);
    const y = Math.floor(random() * pixels.height);
    const radius = 1 + Math.floor(random() * 2.4);
    const color = random() > 0.45 ? palette.accentRgb : palette.detailRgb;
    pixels.fillRect(x, y, radius, radius, mixRgb(palette.baseRgb, color, 0.45 + random() * 0.55));
  }
  pixels.noise(random, contrast);
};

const paintStripes: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 6, 1);
  const stripe = Math.max(Math.floor(pixels.width / (scale * 2)), 2);
  pixels.fill(palette.baseRgb);
  for (let x = 0; x < pixels.width; x += stripe * 2) {
    pixels.fillRect(x, 0, stripe, pixels.height, palette.accentRgb);
    pixels.fillRect(x + stripe, 0, 1, pixels.height, palette.detailRgb);
  }
  pixels.noise(random, (style.contrast ?? 0.1) * 0.6);
};

const paintGrid: Painter = (pixels, palette, style, random) => {
  const variant = style.variant ?? 'tiles';
  const scale = Math.max(style.scale ?? 4, 1);
  const cell = Math.max(Math.floor(pixels.width / scale), 3);
  pixels.fill(palette.detailRgb);
  for (let y = 0; y < pixels.height; y += cell) {
    for (let x = 0; x < pixels.width; x += cell) {
      const tint = 1 + (random() * 2 - 1) * (style.contrast ?? 0.12) * 0.5;
      const inset = variant === 'panels' ? 2 : 1;
      pixels.fillRect(x + 1, y + 1, cell - 2, cell - 2, shade(palette.baseRgb, tint));
      if (variant === 'coffers') {
        pixels.fillRect(x + inset, y + inset, cell - inset * 2, 1, palette.highlightRgb);
        pixels.fillRect(x + inset, y + inset, 1, cell - inset * 2, palette.highlightRgb);
        pixels.fillRect(x + cell - inset - 1, y + inset, 1, cell - inset * 2, palette.accentRgb);
        pixels.fillRect(x + inset, y + cell - inset - 1, cell - inset * 2, 1, palette.accentRgb);
      }
      if (variant === 'panels') {
        pixels.fillRect(x + 1, y + 1, cell - 2, 2, palette.accentRgb);
      }
    }
  }
  pixels.noise(random, (style.contrast ?? 0.12) * 0.5);
};

const paintMotif: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  const step = Math.max(Math.floor(pixels.width / scale), 4);
  const transparent = style.transparency === 'pattern';
  pixels.fill(palette.baseRgb, transparent ? 0 : 255);
  for (let y = 0; y < pixels.height; y += step) {
    for (let x = 0; x < pixels.width; x += step) {
      const centreX = x + Math.floor(step / 2);
      const centreY = y + Math.floor(step / 2);
      const radius = Math.max(Math.floor(step / 4), 1);
      const color = ((x / step + y / step) % 2 === 0) ? palette.accentRgb : palette.detailRgb;
      // A simple lattice flower: centre dot plus four petals.
      pixels.fillRect(centreX - radius, centreY - radius, radius * 2, radius * 2, color);
      pixels.fillRect(centreX - radius * 2, centreY - 1, radius * 2, 2, color);
      pixels.fillRect(centreX + radius, centreY - 1, radius * 2, 2, color);
      pixels.fillRect(centreX - 1, centreY - radius * 2, 2, radius * 2, color);
      pixels.fillRect(centreX - 1, centreY + radius, 2, radius * 2, color);
      if (transparent) {
        // Punch the gaps out so a scrim or lace reads as open weave.
        pixels.set(centreX, centreY, mixRgb(color, palette.highlightRgb, 0.5), 255);
      }
    }
  }
  if (!transparent) pixels.noise(random, (style.contrast ?? 0.1) * 0.5);
};

const paintPlain: Painter = (pixels, palette, style, random) => {
  const contrast = style.contrast ?? 0.08;
  pixels.verticalGradient(
    mixRgb(palette.baseRgb, palette.highlightRgb, 0.16),
    shade(palette.baseRgb, 0.94),
  );
  // A few broad tonal patches so flat paint still reads as a real surface.
  const patches = Math.max(Math.floor(pixels.width / 6), 4);
  for (let index = 0; index < patches; index += 1) {
    const x = Math.floor(random() * pixels.width);
    const y = Math.floor(random() * pixels.height);
    const size = Math.floor(pixels.width * (0.1 + random() * 0.25));
    const tone = random() > 0.5 ? palette.highlightRgb : palette.accentRgb;
    pixels.fillRect(x, y, size, Math.max(Math.floor(size / 3), 2), mixRgb(palette.baseRgb, tone, 0.25));
  }
  pixels.noise(random, contrast);
};

const PAINTERS: Readonly<Record<TextureKind, Painter | null>> = Object.freeze({
  planks: paintPlanks,
  checker: paintChecker,
  speckle: paintSpeckle,
  stripes: paintStripes,
  grid: paintGrid,
  motif: paintMotif,
  plain: paintPlain,
  lettering: null,
});

/** Paints one finish into a fresh pixel buffer. */
export function paintSurface(style: TextureStyle): PixelBuffer {
  const size = clampSize(style.size ?? DEFAULT_TEXTURE_SIZE);
  const pixels = new PixelBuffer(size, size);
  const palette = resolvePalette(style.palette);
  const seed =
    style.seed ??
    hashString(
      [
        style.kind,
        style.palette.base,
        style.palette.accent,
        style.palette.detail ?? '',
        String(style.scale ?? 4),
        style.variant ?? '',
        style.transparency ?? 'none',
      ].join('|'),
    );
  const random = createSeededRandom(seed);
  const painter = PAINTERS[style.kind];
  if (painter) {
    painter(pixels, palette, style, random);
  } else {
    pixels.fill(palette.baseRgb);
  }
  if ((style.orientation ?? 'horizontal') === 'vertical') {
    transposeBuffer(pixels);
  }
  return pixels;
}

function clampSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TEXTURE_SIZE;
  return Math.min(Math.max(Math.trunc(size), 32), 512);
}

/** Safe transpose that also handles non-square buffers. */
function transposeBuffer(pixels: PixelBuffer): void {
  const { width, height, data } = pixels;
  const copy = Uint8ClampedArray.from(data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = (x * height + y) * 4;
      data[to] = copy[from] ?? 0;
      data[to + 1] = copy[from + 1] ?? 0;
      data[to + 2] = copy[from + 2] ?? 0;
      data[to + 3] = copy[from + 3] ?? 0;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Texture creation                                                           */
/* -------------------------------------------------------------------------- */

function applyTextureSettings(
  texture: THREE.Texture,
  key: string,
  style: TextureStyle,
  options: FinishTextureOptions,
  source: 'canvas' | 'data',
): void {
  const repeat = style.repeat ?? [1, 1];
  texture.name = `${FINISH_TEXTURE_PREFIX}${key}`;
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
    environment: {
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
export function createFinishTexture(
  style: TextureStyle,
  options: FinishTextureOptions = {},
): FinishTexture {
  const width = clampSize(style.size ?? DEFAULT_TEXTURE_SIZE);
  const height = clampSize(options.height ?? width);
  const pixels = paintSurface({ ...style, size: width });
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
  // Data textures upload bottom-up; paint order is irrelevant for these
  // patterns (they tile seamlessly), so the default orientation is kept.
  applyTextureSettings(texture, key, style, options, 'data');
  return { key, kind: style.kind, width, height, source: 'data', texture, canvas: null };
}

export interface SignageTextureOptions extends FinishTextureOptions {
  /** Extra border drawn inside the blade, in pixels. */
  readonly border?: number;
  /** Rim colour of the blade. */
  readonly borderColor?: string;
}

/**
 * Paints an exterior signage blade: era blade colour, rim and the café's name
 * set in the built-in bitmap font (no web font, no network fetch).
 */
export function createSignageTexture(
  text: string,
  palette: TexturePalette,
  options: SignageTextureOptions = {},
): FinishTexture {
  const pixels = new PixelBuffer(SIGNAGE_TEXTURE_WIDTH, SIGNAGE_TEXTURE_HEIGHT);
  const resolved = resolvePalette(palette);
  pixels.fill(resolved.baseRgb);
  const border = Math.max(Math.trunc(options.border ?? 6), 0);
  if (border > 0) {
    const rim = parseColor(options.borderColor ?? palette.accent);
    pixels.fillRect(0, 0, pixels.width, border, rim);
    pixels.fillRect(0, pixels.height - border, pixels.width, border, rim);
    pixels.fillRect(0, 0, border, pixels.height, rim);
    pixels.fillRect(pixels.width - border, 0, border, pixels.height, rim);
  }
  const random = createSeededRandom(hashString(`${text}|${palette.base}|signage`));
  pixels.noise(random, 0.05);

  const maxWidth = pixels.width - border * 2 - 24;
  const maxHeight = pixels.height - border * 2 - 16;
  let scale = Math.max(Math.floor(maxHeight / FONT_GLYPH_HEIGHT), 1);
  while (scale > 1 && measureText(text, scale) > maxWidth) {
    scale -= 1;
  }
  const textWidth = measureText(text, scale);
  const x = Math.round((pixels.width - textWidth) / 2);
  const y = Math.round((pixels.height - FONT_GLYPH_HEIGHT * scale) / 2);
  drawText(pixels, text, { x, y, scale, color: resolved.accentRgb });
  // A soft halo so the lettering still reads against a dark blade.
  drawText(pixels, text, { x, y: y + 1, scale, color: mixRgb(resolved.accentRgb, resolved.baseRgb, 0.35), alpha: 120 });
  drawText(pixels, text, { x, y, scale, color: resolved.accentRgb });

  const style: TextureStyle = {
    kind: 'lettering',
    palette,
    size: SIGNAGE_TEXTURE_WIDTH,
  };
  const key = options.key ?? 'signage';

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = (options.canvasFactory ?? defaultCanvasFactory)(SIGNAGE_TEXTURE_WIDTH, SIGNAGE_TEXTURE_HEIGHT);
  } catch {
    canvas = null;
  }
  const context = canvas ? canvas.getContext('2d') : null;
  if (canvas && context) {
    const image = context.createImageData(SIGNAGE_TEXTURE_WIDTH, SIGNAGE_TEXTURE_HEIGHT);
    image.data.set(pixels.data);
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    applyTextureSettings(texture, key, style, options, 'canvas');
    return {
      key,
      kind: 'lettering',
      width: SIGNAGE_TEXTURE_WIDTH,
      height: SIGNAGE_TEXTURE_HEIGHT,
      source: 'canvas',
      texture,
      canvas,
    };
  }
  const texture = new THREE.DataTexture(
    pixels.data,
    SIGNAGE_TEXTURE_WIDTH,
    SIGNAGE_TEXTURE_HEIGHT,
    THREE.RGBAFormat,
  );
  applyTextureSettings(texture, key, style, options, 'data');
  return {
    key,
    kind: 'lettering',
    width: SIGNAGE_TEXTURE_WIDTH,
    height: SIGNAGE_TEXTURE_HEIGHT,
    source: 'data',
    texture,
    canvas: null,
  };
}

/** True when `texture` came from this module's procedural pipeline. */
export function isProceduralFinishTexture(texture: THREE.Texture): boolean {
  return (
    (texture instanceof THREE.DataTexture || texture instanceof THREE.CanvasTexture) &&
    texture.name.startsWith(FINISH_TEXTURE_PREFIX)
  );
}
