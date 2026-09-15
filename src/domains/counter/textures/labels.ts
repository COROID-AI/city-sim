/**
 * Counter-domain procedural surfaces — every finish, printed label, paper tape,
 * display face and screen the counter-tech props are dressed in.
 *
 * Nothing here is fetched: device housings, receipt tape, handwritten dockets,
 * key legends, LED faces, CRT menus, tablet screens, QR cards, card plastic and
 * printed signage are all painted pixel by pixel into a small {@link Raster} and
 * uploaded as a `CanvasTexture` in the browser, or as a `DataTexture` when there
 * is no DOM (the headless test suite). Both backends receive the *same* pixels,
 * so an era's counter looks identical in the browser and in node.
 *
 * The module also owns the counter's material vocabulary:
 *
 *  - {@link COUNTER_MATERIAL_SLOTS} — the surfaces an era material set carries
 *    (`wood`, `enamel`, `steel`, `led`, `screen`, `receiptPaper`, ...),
 *  - {@link COUNTER_SURFACE_DEFAULTS} — the default recipe of every slot,
 *  - {@link createCounterMaterialSet} — the era set, built from the era data
 *    files' per-slot overrides merged over those defaults, and
 *  - {@link counterBoxMesh} / {@link counterCylinderMesh} /
 *    {@link counterFaceMesh} — the three primitives the prop builders assemble
 *    their housings from, so every prop file stays a description of an object
 *    rather than a pile of three.js bookkeeping.
 *
 * Determinism: painters are pure functions of their {@link CounterTextureStyle}
 * and seed, so re-applying an era always reproduces the same paper, the same
 * printed prices and the same screen content.
 */

import * as THREE from 'three';
import { createSeededRandom } from '../../../core/kernel';
import type { YearId } from '../../../contracts/period';

/* -------------------------------------------------------------------------- */
/* Colour helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Straight 8 bit RGB triple. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parses `#rgb` / `#rrggbb` / `rgb(r,g,b)` into an {@link Rgb}. */
export function parseCounterColor(value: string, fallback: Rgb = { r: 255, g: 255, b: 255 }): Rgb {
  const text = value.trim();
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex[0] ?? '0', 16);
      const g = Number.parseInt(hex[1] ?? '0', 16);
      const b = Number.parseInt(hex[2] ?? '0', 16);
      if ([r, g, b].every((part) => Number.isFinite(part))) {
        return { r: r * 17, g: g * 17, b: b * 17 };
      }
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].every((part) => Number.isFinite(part))) return { r, g, b };
    }
  }
  const match = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(text);
  if (match) {
    return {
      r: Number.parseInt(match[1] ?? '0', 10),
      g: Number.parseInt(match[2] ?? '0', 10),
      b: Number.parseInt(match[3] ?? '0', 10),
    };
  }
  return fallback;
}

/** Linear blend between two colours (`t` is clamped to `[0, 1]`). */
export function mixCounterColor(a: Rgb, b: Rgb, t: number): Rgb {
  const amount = Math.min(Math.max(t, 0), 1);
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

/** Lightens (`amount > 0`) or darkens (`amount < 0`) a colour. */
export function shadeCounterColor(color: Rgb, amount: number): Rgb {
  const target: Rgb = { r: amount >= 0 ? 255 : 0, g: amount >= 0 ? 255 : 0, b: amount >= 0 ? 255 : 0 };
  return mixCounterColor(color, target, Math.abs(amount));
}

/** Stable 32 bit hash of a string, used to seed every procedural painter. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

/* -------------------------------------------------------------------------- */
/* Fonts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Compact 3×5 bitmap alphabet for every printed mark the counter carries:
 * price tickets, key legends, register plates, receipt lines and tap notices.
 * Glyph rows are written as strings so the shapes stay readable in source.
 */
export const COUNTER_FONT_3X5: Readonly<Record<string, readonly string[]>> = Object.freeze({
  A: ['111', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '111', '100', '111'],
  F: ['111', '100', '111', '100', '100'],
  G: ['111', '100', '101', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '111'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '101', '101', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '001'],
  R: ['111', '101', '111', '110', '101'],
  S: ['111', '100', '111', '001', '111'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ' ': ['000', '000', '000', '000', '000'],
  '.': ['000', '000', '000', '000', '010'],
  ',': ['000', '000', '000', '010', '010'],
  '-': ['000', '000', '111', '000', '000'],
  ':': ['000', '010', '000', '010', '000'],
  '/': ['001', '001', '010', '100', '100'],
  '+': ['000', '010', '111', '010', '000'],
  '#': ['101', '111', '101', '111', '101'],
  '£': ['011', '100', '111', '100', '011'],
  '$': ['111', '110', '111', '011', '111'],
  '%': ['101', '001', '010', '100', '101'],
  '!': ['010', '010', '010', '000', '010'],
  '?': ['111', '001', '011', '000', '010'],
  "'": ['010', '010', '000', '000', '000'],
  '(': ['001', '010', '010', '010', '001'],
  ')': ['100', '010', '010', '010', '100'],
  '*': ['000', '101', '010', '101', '000'],
  '=': ['000', '111', '000', '111', '000'],
});

/** Glyph box of {@link COUNTER_FONT_3X5}, in font pixels. */
export const COUNTER_FONT_WIDTH = 3;
export const COUNTER_FONT_HEIGHT = 5;
/** Blank columns between glyphs, in font pixels. */
export const COUNTER_FONT_TRACKING = 1;

/* -------------------------------------------------------------------------- */
/* Raster                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tiny RGBA raster with the handful of primitives the painters need. Everything
 * clips inside the raster (device faces and paper are not tiles), and colours
 * are written with an alpha so wear, glass and screens can blend.
 */
export class CounterRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = Math.max(Math.trunc(width), 1);
    this.height = Math.max(Math.trunc(height), 1);
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
  }

  private offset(x: number, y: number): number {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (px < 0 || px >= this.width || py < 0 || py >= this.height) return -1;
    return (py * this.width + px) * 4;
  }

  /** Alpha-blends `color` into one pixel; out-of-range coordinates clip. */
  blend(x: number, y: number, color: Rgb, alpha = 1): this {
    const amount = Math.min(Math.max(alpha, 0), 1);
    if (amount <= 0) return this;
    const offset = this.offset(x, y);
    if (offset < 0) return this;
    const data = this.data;
    const inverse = 1 - amount;
    data[offset] = clampByte((data[offset] ?? 0) * inverse + color.r * amount);
    data[offset + 1] = clampByte((data[offset + 1] ?? 0) * inverse + color.g * amount);
    data[offset + 2] = clampByte((data[offset + 2] ?? 0) * inverse + color.b * amount);
    data[offset + 3] = clampByte((data[offset + 3] ?? 0) * inverse + 255 * amount);
    return this;
  }

  /** Paints a rectangle (`x`, `y` is the top left corner). */
  rect(x: number, y: number, width: number, height: number, color: Rgb, alpha = 1): this {
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        this.blend(x + column, y + row, color, alpha);
      }
    }
    return this;
  }

  /** Paints a rectangle outline `thickness` pixels thick. */
  frame(x: number, y: number, width: number, height: number, thickness: number, color: Rgb, alpha = 1): this {
    this.rect(x, y, width, thickness, color, alpha);
    this.rect(x, y + height - thickness, width, thickness, color, alpha);
    this.rect(x, y, thickness, height, color, alpha);
    this.rect(x + width - thickness, y, thickness, height, color, alpha);
    return this;
  }

  /** Paints every pixel of the raster with `color`. */
  fill(color: Rgb, alpha = 1): this {
    return this.rect(0, 0, this.width, this.height, color, alpha);
  }

  /** Vertical gradient from `from` (top) to `to` (bottom). */
  verticalGradient(from: Rgb, to: Rgb): this {
    for (let y = 0; y < this.height; y += 1) {
      const amount = this.height === 1 ? 0 : y / (this.height - 1);
      this.rect(0, y, this.width, 1, mixCounterColor(from, to, amount));
    }
    return this;
  }

  /** Deterministic speckle field, used for wear, grain and brushed finishes. */
  speckle(count: number, color: Rgb, seed: number, alpha = 0.16, length = 1): this {
    const random = createSeededRandom(seed >>> 0);
    const total = Math.max(Math.trunc(count), 0);
    for (let index = 0; index < total; index += 1) {
      const x = Math.floor(random() * this.width);
      const y = Math.floor(random() * this.height);
      this.rect(x, y, Math.max(Math.round(length * (0.5 + random())), 1), 1, color, alpha);
    }
    return this;
  }

  /** Directional brush lines, used for steel, brass, chrome and timber grain. */
  grain(lines: number, color: Rgb, seed: number, orientation: 'horizontal' | 'vertical', alpha = 0.12): this {
    const random = createSeededRandom(seed >>> 0);
    const total = Math.max(Math.trunc(lines), 0);
    for (let index = 0; index < total; index += 1) {
      const amount = 0.25 + random() * 0.75;
      const position = Math.floor(random() * (orientation === 'horizontal' ? this.height : this.width));
      const thickness = random() > 0.85 ? 2 : 1;
      if (orientation === 'horizontal') {
        this.rect(0, position, this.width, thickness, color, alpha * amount);
      } else {
        this.rect(position, 0, thickness, this.height, color, alpha * amount);
      }
    }
    return this;
  }

  /** Width in pixels {@link drawText} will occupy for `value`. */
  textWidth(value: string, scale = 1, tracking = COUNTER_FONT_TRACKING): number {
    if (value.length === 0) return 0;
    return value.length * (COUNTER_FONT_WIDTH + tracking) * scale - tracking * scale;
  }

  /** Draws one 3×5 line of {@link COUNTER_FONT_3X5} type. */
  drawText(
    value: string,
    x: number,
    y: number,
    color: Rgb,
    options: { readonly scale?: number; readonly align?: 'left' | 'center' | 'right'; readonly tracking?: number } = {},
  ): number {
    const scale = Math.max(Math.trunc(options.scale ?? 1), 1);
    const tracking = options.tracking ?? COUNTER_FONT_TRACKING;
    const width = this.textWidth(value, scale, tracking);
    const align = options.align ?? 'left';
    let cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    const text = value.toUpperCase();
    for (let index = 0; index < text.length; index += 1) {
      const glyph = COUNTER_FONT_3X5[text[index] ?? ' '] ?? COUNTER_FONT_3X5[' '];
      if (glyph) {
        for (let row = 0; row < COUNTER_FONT_HEIGHT; row += 1) {
          const bits = glyph[row] ?? '000';
          for (let column = 0; column < COUNTER_FONT_WIDTH; column += 1) {
            if (bits[column] === '1') this.rect(cursor + column * scale, y + row * scale, scale, scale, color);
          }
        }
      }
      cursor += (COUNTER_FONT_WIDTH + tracking) * scale;
    }
    return width;
  }

  /** Draws several lines of type, `lineHeight` pixels apart. */
  drawLines(
    lines: readonly string[],
    x: number,
    y: number,
    lineHeight: number,
    color: Rgb,
    options: { readonly scale?: number; readonly align?: 'left' | 'center' | 'right' } = {},
  ): this {
    lines.forEach((line, index) => {
      this.drawText(line, x, y + index * lineHeight, color, options);
    });
    return this;
  }

  /** Draws `value` in seven-segment style (the LED faces of the 1985 till). */
  drawSegments(
    value: string,
    x: number,
    y: number,
    color: Rgb,
    options: { readonly cell?: number; readonly align?: 'left' | 'center' | 'right'; readonly off?: Rgb | null } = {},
  ): number {
    const cell = Math.max(Math.trunc(options.cell ?? 4), 2);
    const digitWidth = cell * 3;
    const gap = cell;
    const advance = digitWidth + gap;
    const width = value.length === 0 ? 0 : value.length * advance - gap;
    const align = options.align ?? 'left';
    let cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    const segments: Readonly<Record<string, readonly string[]>> = COUNTER_SEGMENTS;
    for (let index = 0; index < value.length; index += 1) {
      const glyphSegments = segments[value[index] ?? ''] ?? [];
      for (let row = 0; row < 5; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          const off: Rgb | null = options.off ?? null;
          const on = glyphSegments.includes(segmentAt(row, column));
          if (off) this.rect(cursor + column * cell, y + row * cell, cell, cell, off, 0.22);
          if (on) this.rect(cursor + column * cell, y + row * cell, cell, cell, color);
        }
      }
      cursor += advance;
    }
    return width;
  }
}

/** Seven-segment masks on a 3×5 grid, one entry per lit cell. */
const COUNTER_SEGMENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
  'E': ['a', 'd', 'e', 'f', 'g'],
  'r': ['e', 'g'],
  ' ': [],
});

function segmentAt(row: number, column: number): string {
  if (row === 0 && column === 1) return 'a';
  if (row === 4 && column === 1) return 'd';
  if (row === 2 && column === 1) return 'g';
  if (column === 0 && row === 1) return 'f';
  if (column === 2 && row === 1) return 'b';
  if (column === 0 && row === 3) return 'e';
  if (column === 2 && row === 3) return 'c';
  return 'x';
}

/* -------------------------------------------------------------------------- */
/* Texture vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/** Every procedural surface the counter paints. */
export type CounterTextureKind =
  | 'wood-till'
  | 'enamel-plate'
  | 'bakelite'
  | 'steel-drawer'
  | 'chrome'
  | 'brass'
  | 'glass-jar'
  | 'led-face'
  | 'key-legend'
  | 'crt-screen'
  | 'tablet-screen'
  | 'card-plastic'
  | 'pinpad-face'
  | 'contactless-pad'
  | 'qr-code'
  | 'receipt-paper'
  | 'docket-paper'
  | 'ledger-paper'
  | 'printed-label'
  | 'printer-shell'
  | 'rubber-cable'
  | 'painted-shelf'
  | 'coin-felt'
  | 'scanner-shell';

/** Default square resolution of a counter surface. Small on purpose. */
export const DEFAULT_COUNTER_TEXTURE_SIZE = 128;

/** Every texture this module creates is named with this prefix. */
export const COUNTER_TEXTURE_PREFIX = 'counter:';

/** Ordered list of painters, handy for diagnostics and tests. */
export const COUNTER_TEXTURE_KINDS: readonly CounterTextureKind[] = Object.freeze([
  'wood-till',
  'enamel-plate',
  'bakelite',
  'steel-drawer',
  'chrome',
  'brass',
  'glass-jar',
  'led-face',
  'key-legend',
  'crt-screen',
  'tablet-screen',
  'card-plastic',
  'pinpad-face',
  'contactless-pad',
  'qr-code',
  'receipt-paper',
  'docket-paper',
  'ledger-paper',
  'printed-label',
  'printer-shell',
  'rubber-cable',
  'painted-shelf',
  'coin-felt',
  'scanner-shell',
]);

/** One painted surface: how it is drawn and what it is drawn in. */
export interface CounterTextureStyle {
  readonly kind: CounterTextureKind;
  /** Body colour of the surface. */
  readonly base: string;
  /** Secondary colour: trim, wear, printed bands, screen chrome. */
  readonly accent: string;
  /** Colour of printed type and lit segments. */
  readonly ink: string;
  /** Pattern repetitions across the surface. */
  readonly scale?: number;
  /** Square resolution in pixels. */
  readonly size?: number;
  readonly orientation?: 'horizontal' | 'vertical';
  /** Short printed mark (device name, card logo, shelf header). */
  readonly mark?: string;
  /** Big printed value (price, LED total). */
  readonly text?: string;
  /** Printed lines (receipt items, ledger entries, screen menus). */
  readonly lines?: readonly string[];
  /** Explicit paint seed; defaults to a hash of the kind. */
  readonly seed?: number;
}

/* -------------------------------------------------------------------------- */
/* Painters                                                                   */
/* -------------------------------------------------------------------------- */

function styleSeed(style: CounterTextureStyle): number {
  return (style.seed ?? hashString(`${style.kind}:${style.base}:${style.accent}`)) >>> 0;
}

function body(raster: CounterRaster, style: CounterTextureStyle, base: Rgb, accent: Rgb, ink: Rgb, size: number): void {
  raster.fill(base);
  switch (style.kind) {
    case 'wood-till': {
      const planks = Math.max(Math.trunc(style.scale ?? 3), 1);
      const pitch = Math.max(Math.floor(size / planks), 4);
      for (let index = 0; index <= planks; index += 1) {
        raster.rect(0, index * pitch - 1, size, 2, shadeCounterColor(base, -0.42));
      }
      raster.grain(size * 1.4, shadeCounterColor(base, -0.22), styleSeed(style), 'horizontal', 0.14);
      raster.grain(size * 0.5, shadeCounterColor(base, 0.16), styleSeed(style) + 7, 'horizontal', 0.1);
      raster.speckle(size * 0.3, shadeCounterColor(base, -0.5), styleSeed(style) + 11, 0.2);
      break;
    }
    case 'enamel-plate': {
      raster.speckle(size * 2.2, accent, styleSeed(style), 0.12);
      raster.speckle(size * 0.6, shadeCounterColor(base, -0.3), styleSeed(style) + 3, 0.25);
      raster.frame(0, 0, size, size, 2, shadeCounterColor(base, 0.25), 0.5);
      break;
    }
    case 'bakelite': {
      raster.verticalGradient(mixCounterColor(base, { r: 255, g: 255, b: 255 }, 0.12), shadeCounterColor(base, -0.25));
      raster.speckle(size * 1.6, shadeCounterColor(base, 0.2), styleSeed(style), 0.1, 2);
      raster.speckle(size * 0.5, shadeCounterColor(base, -0.4), styleSeed(style) + 5, 0.22, 3);
      break;
    }
    case 'steel-drawer': {
      raster.verticalGradient(lighten(base, 0.12), darken(base, 0.16));
      raster.grain(size * 2.6, shadeCounterColor(base, 0.3), styleSeed(style), 'horizontal', 0.1);
      raster.grain(size * 0.6, shadeCounterColor(base, -0.45), styleSeed(style) + 9, 'horizontal', 0.14);
      break;
    }
    case 'chrome': {
      raster.verticalGradient(lighten(base, 0.35), darken(base, 0.22));
      raster.speckle(size * 0.8, shadeCounterColor(base, -0.6), styleSeed(style), 0.2, 2);
      raster.rect(0, Math.floor(size * 0.22), size, 1, lighten(base, 0.6), 0.7);
      break;
    }
    case 'brass': {
      raster.verticalGradient(lighten(base, 0.18), darken(base, 0.3));
      raster.grain(size * 2, shadeCounterColor(base, 0.28), styleSeed(style), 'horizontal', 0.14);
      raster.speckle(size * 0.5, shadeCounterColor(base, -0.5), styleSeed(style) + 13, 0.18);
      break;
    }
    case 'glass-jar': {
      raster.fill(shadeCounterColor(base, 0.55), 0.9);
      raster.rect(0, 0, Math.floor(size * 0.22), size, lighten(base, 0.55), 0.5);
      raster.rect(Math.floor(size * 0.62), 0, Math.max(Math.floor(size * 0.1), 2), size, lighten(base, 0.4), 0.35);
      raster.frame(0, 0, size, size, 2, darken(base, 0.3), 0.5);
      break;
    }
    case 'led-face': {
      raster.fill(base);
      raster.rect(2, 2, size - 4, size - 4, darken(base, 0.45), 0.7);
      const cell = Math.max(Math.floor((size - 12) / 12), 3);
      raster.drawSegments(style.text ?? '00.00', size / 2, Math.max(Math.floor((size - 5 * cell) / 2), 4), ink, {
        cell,
        align: 'center',
        off: shadeCounterColor(ink, -0.6),
      });
      raster.rect(4, 4, size - 8, 1, accent, 0.5);
      break;
    }
    case 'key-legend': {
      raster.fill(base);
      const keys = (style.text ?? '1234567890').split('');
      const columns = 5;
      const gap = Math.max(Math.floor(size * 0.04), 2);
      const keyWidth = Math.floor((size - gap * (columns + 1)) / columns);
      const keyHeight = Math.floor(keyWidth * 0.85);
      keys.forEach((key, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = gap + column * (keyWidth + gap);
        const y = gap + row * (keyHeight + gap);
        if (y + keyHeight > size - gap) return;
        raster.rect(x, y, keyWidth, keyHeight, shadeCounterColor(base, 0.2), 0.9);
        raster.frame(x, y, keyWidth, keyHeight, 1, darken(base, 0.4), 0.8);
        raster.drawText(key, x + keyWidth / 2, y + Math.max(Math.floor((keyHeight - 5) / 2), 1), ink, {
          align: 'center',
        });
      });
      break;
    }
    case 'crt-screen': {
      raster.fill(base);
      const inset = Math.max(Math.floor(size * 0.06), 3);
      raster.rect(inset, inset, size - inset * 2, size - inset * 2, darken(accent, 0.05));
      const scale = Math.max(Math.trunc(size / 96), 1);
      raster.drawText(style.mark ?? 'TILL', inset * 2, inset * 2, ink, { scale });
      raster.rect(inset * 2, inset * 2 + 8 * scale, size - inset * 4, 1, ink, 0.5);
      const lines = style.lines ?? [];
      lines.slice(0, 6).forEach((line, index) => {
        raster.drawText(line, inset * 2, inset * 2 + (12 + index * 8) * scale, ink, { scale });
      });
      for (let y = inset; y < size - inset; y += 3) raster.rect(inset, y, size - inset * 2, 1, { r: 0, g: 0, b: 0 }, 0.16);
      break;
    }
    case 'tablet-screen': {
      raster.fill(base);
      const scale = Math.max(Math.trunc(size / 96), 1);
      raster.rect(0, 0, size, 12 * scale, accent, 0.85);
      raster.drawText(style.mark ?? 'ORDER', 3 * scale, 3 * scale, ink, { scale });
      const lines = style.lines ?? [];
      lines.slice(0, 5).forEach((line, index) => {
        const y = (18 + index * 10) * scale;
        raster.rect(3 * scale, y - 2 * scale, size - 6 * scale, 8 * scale, shadeCounterColor(base, 0.06), 0.9);
        raster.drawText(line, 5 * scale, y, ink, { scale });
      });
      raster.rect(0, size - 10 * scale, size, 10 * scale, accent, 0.9);
      raster.drawText('TAP TO PAY', size / 2, size - 8 * scale, ink, { scale, align: 'center' });
      break;
    }
    case 'card-plastic': {
      raster.verticalGradient(lighten(base, 0.1), darken(base, 0.12));
      raster.rect(0, Math.floor(size * 0.62), size, Math.max(Math.floor(size * 0.14), 4), darken(base, 0.55), 0.9);
      raster.drawText(style.mark ?? 'CARD', Math.floor(size * 0.08), Math.floor(size * 0.16), ink, {
        scale: Math.max(Math.trunc(size / 96), 1),
      });
      raster.rect(Math.floor(size * 0.08), Math.floor(size * 0.34), Math.floor(size * 0.16), Math.floor(size * 0.12), accent, 0.9);
      break;
    }
    case 'pinpad-face': {
      raster.fill(base);
      const scale = Math.max(Math.trunc(size / 96), 1);
      raster.rect(4 * scale, 3 * scale, size - 8 * scale, 12 * scale, darken(base, 0.5));
      raster.drawText(style.text ?? 'ENTER', 6 * scale, 6 * scale, ink, { scale });
      raster.drawText(style.mark ?? 'PIN', size - 6 * scale, 6 * scale, ink, { scale, align: 'right' });
      const keys = '123456789 0'.split('');
      const gap = 2 * scale;
      const keyWidth = Math.floor((size - gap * 6) / 3);
      const keyHeight = Math.floor((size - 26 * scale) / 4);
      keys.forEach((key, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const x = gap * 2 + column * (keyWidth + gap);
        const y = 20 * scale + row * (keyHeight + gap);
        if (y + keyHeight > size - gap) return;
        raster.rect(x, y, keyWidth, keyHeight, shadeCounterColor(base, 0.16), 0.95);
        raster.frame(x, y, keyWidth, keyHeight, 1, darken(base, 0.4), 0.7);
        raster.drawText(key, x + keyWidth / 2, y + Math.max(Math.floor((keyHeight - 5 * scale) / 2), 1), ink, {
          scale,
          align: 'center',
        });
      });
      break;
    }
    case 'contactless-pad': {
      raster.fill(base);
      raster.frame(1, 1, size - 2, size - 2, 1, accent, 0.65);
      const centre = size / 2;
      const radius = size * 0.2;
      raster.rect(centre - radius, centre - radius * 1.6, radius * 2, radius * 2.2, accent, 0.85);
      for (let ring = 1; ring <= 3; ring += 1) {
        const spread = radius * (0.7 + ring * 0.42);
        for (let step = 0; step < 24; step += 1) {
          const angle = -Math.PI / 3 + (step / 23) * (Math.PI * 2 / 3);
          raster.blend(centre + Math.cos(angle) * spread - size * 0.22, centre + Math.sin(angle) * spread, ink, 0.8);
        }
      }
      raster.drawText(style.mark ?? 'TAP', centre, size - 12, ink, {
        scale: Math.max(Math.trunc(size / 64), 1),
        align: 'center',
      });
      break;
    }
    case 'qr-code': {
      raster.fill(base);
      const modules = 21;
      const margin = Math.max(Math.floor(size * 0.08), 4);
      const cell = Math.max(Math.floor((size - margin * 2) / modules), 2);
      const random = createSeededRandom(styleSeed(style));
      const finder = (x: number, y: number): boolean => {
        const corners: readonly (readonly [number, number])[] = [
          [0, 0],
          [modules - 7, 0],
          [0, modules - 7],
        ];
        for (const [cornerX, cornerY] of corners) {
          const dx = x - cornerX;
          const dy = y - cornerY;
          if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
            const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
            return ring !== 2;
          }
        }
        if (y === 6 && x >= 8 && x < 13) return x % 2 === 0;
        if (x === 6 && y >= 8 && y < 13) return y % 2 === 0;
        return random() > 0.48;
      };
      for (let y = 0; y < modules; y += 1) {
        for (let x = 0; x < modules; x += 1) {
          if (finder(x, y)) raster.rect(margin + x * cell, margin + y * cell, cell, cell, accent);
        }
      }
      raster.drawText(style.mark ?? 'SCAN TO ORDER', size / 2, size - margin + 1, ink, {
        scale: Math.max(Math.trunc(size / 64), 1),
        align: 'center',
      });
      break;
    }
    case 'receipt-paper': {
      raster.fill(base);
      const scale = Math.max(Math.trunc(size / 96), 1);
      raster.drawText(style.mark ?? 'TILL', size / 2, 4 * scale, ink, { scale, align: 'center' });
      raster.rect(4, 12 * scale, size - 8, 1, ink, 0.6);
      (style.lines ?? []).slice(0, 7).forEach((line, index) => {
        raster.drawText(line, 4, (15 + index * 7) * scale, ink, { scale });
      });
      raster.rect(4, size - 6 * scale, size - 8, 1, ink, 0.6);
      raster.drawText(style.text ?? 'TOTAL', size / 2, size - 5 * scale, ink, { scale, align: 'center' });
      break;
    }
    case 'docket-paper': {
      raster.fill(base);
      const scale = Math.max(Math.trunc(size / 96), 1);
      raster.rect(0, 0, size, 3, shadeCounterColor(base, -0.12), 0.8);
      raster.drawText(style.mark ?? 'ORDER', 4, 5 * scale, ink, { scale });
      for (let row = 0; row < 6; row += 1) {
        const y = (16 + row * 12) * scale;
        raster.rect(4, y + 8 * scale, size - 8, 1, shadeCounterColor(base, -0.25), 0.7);
        const random = createSeededRandom(styleSeed(style) + row * 31);
        let cursor = 5;
        while (cursor < size - 8) {
          const run = 2 + Math.floor(random() * 5);
          raster.rect(cursor, y + 2 * scale + Math.floor(random() * 2), run, scale, ink, 0.55 + random() * 0.3);
          cursor += run + 2 + Math.floor(random() * 2);
        }
      }
      break;
    }
    case 'ledger-paper': {
      raster.fill(base);
      const scale = Math.max(Math.trunc(size / 96), 1);
      raster.rect(6, 0, 1, size, accent, 0.7);
      for (let row = 0; row < 9; row += 1) {
        raster.rect(0, 8 + row * 12 * scale, size, 1, accent, 0.35);
      }
      (style.lines ?? []).slice(0, 8).forEach((line, index) => {
        raster.drawText(line, 10, 10 + index * 12 * scale, ink, { scale });
      });
      break;
    }
    case 'printed-label': {
      raster.fill(base);
      const scale = Math.max(Math.trunc(size / 96), 1);
      raster.frame(3, 3, size - 6, size - 6, 1, accent, 0.8);
      raster.drawText(style.mark ?? 'HALLAM', size / 2, 10 * scale, ink, { scale, align: 'center' });
      raster.rect(8, 11 + 7 * scale, size - 16, 1, accent, 0.7);
      raster.drawText(style.text ?? 'COFFEE 3d', size / 2, size / 2 + 4 * scale, ink, {
        scale,
        align: 'center',
      });
      const lines = style.lines ?? [];
      lines.slice(0, 2).forEach((line, index) => {
        raster.drawText(line, size / 2, size - (18 - index * 9) * scale, ink, { scale, align: 'center' });
      });
      break;
    }
    case 'printer-shell': {
      raster.fill(base);
      raster.speckle(size * 1.2, shadeCounterColor(base, -0.3), styleSeed(style), 0.14);
      raster.verticalGradient(lighten(base, 0.08), darken(base, 0.18));
      raster.rect(Math.floor(size * 0.12), Math.floor(size * 0.2), Math.floor(size * 0.76), Math.max(Math.floor(size * 0.05), 2), darken(base, 0.6));
      for (let index = 0; index < 4; index += 1) {
        raster.rect(
          Math.floor(size * 0.2),
          Math.floor(size * (0.5 + index * 0.08)),
          Math.floor(size * 0.6),
          1,
          darken(base, 0.5),
          0.7,
        );
      }
      raster.rect(Math.floor(size * 0.82), Math.floor(size * 0.3), 3, 3, accent, 0.9);
      break;
    }
    case 'rubber-cable': {
      raster.fill(base);
      for (let index = 0; index < size; index += 4) {
        raster.rect(0, index, size, 2, shadeCounterColor(base, 0.22), 0.5);
      }
      raster.grain(size * 0.6, shadeCounterColor(base, -0.4), styleSeed(style), 'horizontal', 0.2);
      break;
    }
    case 'painted-shelf': {
      raster.fill(base);
      raster.speckle(size * 1.4, shadeCounterColor(base, -0.22), styleSeed(style), 0.12, 2);
      raster.verticalGradient(lighten(base, 0.06), darken(base, 0.14));
      raster.rect(0, Math.floor(size * 0.5), size, 1, darken(base, 0.35), 0.6);
      break;
    }
    case 'coin-felt': {
      raster.fill(base);
      raster.speckle(size * 5, shadeCounterColor(base, 0.35), styleSeed(style), 0.16);
      raster.frame(0, 0, size, size, Math.max(Math.floor(size * 0.05), 2), accent, 0.55);
      break;
    }
    case 'scanner-shell': {
      raster.fill(base);
      raster.verticalGradient(lighten(base, 0.1), darken(base, 0.24));
      raster.rect(Math.floor(size * 0.14), Math.floor(size * 0.42), Math.floor(size * 0.72), Math.floor(size * 0.2), accent, 0.9);
      for (let index = 0; index < 14; index += 1) {
        const x = Math.floor(size * 0.16) + index * Math.max(Math.floor(size * 0.045), 2);
        if (x > size - 6) break;
        raster.rect(x, Math.floor(size * 0.44), 1, Math.floor(size * 0.16), ink, 0.85);
      }
      raster.rect(Math.floor(size * 0.3), Math.floor(size * 0.72), Math.floor(size * 0.4), 1, darken(base, 0.4), 0.6);
      break;
    }
    default: {
      raster.speckle(size, shadeCounterColor(base, -0.2), styleSeed(style), 0.12);
      break;
    }
  }
}

function lighten(color: Rgb, amount: number): Rgb {
  return mixCounterColor(color, { r: 255, g: 255, b: 255 }, amount);
}

function darken(color: Rgb, amount: number): Rgb {
  return mixCounterColor(color, { r: 0, g: 0, b: 0 }, amount);
}

/** Paints one counter surface into a fresh raster (pure, deterministic). */
export function paintCounterSurface(style: CounterTextureStyle): CounterRaster {
  const size = clampCounterTextureSize(style.size ?? DEFAULT_COUNTER_TEXTURE_SIZE);
  const raster = new CounterRaster(size, size);
  const base = parseCounterColor(style.base);
  const accent = parseCounterColor(style.accent, base);
  const ink = parseCounterColor(style.ink, { r: 20, g: 20, b: 20 });
  body(raster, { ...style, size }, base, accent, ink, size);
  return raster;
}

/** Clamps a texture resolution into the range the painters support. */
export function clampCounterTextureSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_COUNTER_TEXTURE_SIZE;
  return Math.min(Math.max(Math.trunc(value), 16), 512);
}

/** Number of distinct 32 bit pixel values in a raster (used by tests). */
export function distinctCounterPixelColors(raster: CounterRaster): number {
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
/* Textures                                                                   */
/* -------------------------------------------------------------------------- */

/** Browser 2D canvas factory; `null` makes the pipeline fall back to data. */
export type CounterCanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/**
 * Default factory: a DOM canvas when a document exists, otherwise `null`, which
 * makes {@link createCounterTexture} fall back to a `DataTexture`. Both paths
 * receive identical pixels, so node suites still exercise the painters.
 */
export const defaultCounterCanvasFactory: CounterCanvasFactory = (width, height) => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** A finished procedural counter surface plus how it was materialised. */
export interface CounterTexture {
  readonly key: string;
  readonly kind: CounterTextureKind;
  readonly width: number;
  readonly height: number;
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  readonly canvas: HTMLCanvasElement | null;
}

export interface CounterTextureOptions {
  readonly key?: string;
  readonly canvasFactory?: CounterCanvasFactory;
  readonly height?: number;
  /** Overrides the style's repeat (`[1, 1]` by default). */
  readonly repeat?: readonly [number, number];
}

function applyCounterTextureSettings(
  texture: THREE.Texture,
  key: string,
  style: CounterTextureStyle,
  options: CounterTextureOptions,
  source: 'canvas' | 'data',
): void {
  texture.name = `${COUNTER_TEXTURE_PREFIX}${key}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const repeat = options.repeat ?? [1, 1];
  texture.repeat.set(repeat[0], repeat[1]);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  texture.userData = {
    counter: { key, kind: style.kind, procedural: true, source },
  };
}

/** Paints `style` and returns it as a texture (canvas when available, else data). */
export function createCounterTexture(
  style: CounterTextureStyle,
  options: CounterTextureOptions = {},
): CounterTexture {
  const size = clampCounterTextureSize(style.size ?? DEFAULT_COUNTER_TEXTURE_SIZE);
  const height = clampCounterTextureSize(options.height ?? size);
  const pixels = paintCounterSurface({ ...style, size });
  const key = options.key ?? style.kind;
  const factory = options.canvasFactory ?? defaultCounterCanvasFactory;

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = factory(size, height);
  } catch {
    canvas = null;
  }
  const context = canvas ? canvas.getContext('2d') : null;
  if (canvas && context) {
    const image = context.createImageData(size, height);
    image.data.set(pixels.data);
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    applyCounterTextureSettings(texture, key, style, options, 'canvas');
    return { key, kind: style.kind, width: size, height, source: 'canvas', texture, canvas };
  }

  const texture = new THREE.DataTexture(pixels.data, size, height, THREE.RGBAFormat);
  applyCounterTextureSettings(texture, key, style, options, 'data');
  return { key, kind: style.kind, width: size, height, source: 'data', texture, canvas: null };
}

/** True when `texture` came from this module's procedural pipeline. */
export function isCounterTexture(texture: THREE.Texture): boolean {
  return (
    (texture instanceof THREE.DataTexture || texture instanceof THREE.CanvasTexture) &&
    texture.name.startsWith(COUNTER_TEXTURE_PREFIX)
  );
}

/* -------------------------------------------------------------------------- */
/* Material slots                                                             */
/* -------------------------------------------------------------------------- */

/** Every surface slot a counter material set carries. */
export const COUNTER_MATERIAL_SLOTS = Object.freeze([
  'wood',
  'enamel',
  'bakelite',
  'steel',
  'chrome',
  'brass',
  'glass',
  'led',
  'keyface',
  'screen',
  'tabletScreen',
  'card',
  'pinpad',
  'contactless',
  'qr',
  'receiptPaper',
  'docketPaper',
  'ledgerPaper',
  'label',
  'printerShell',
  'rubber',
  'shelfPaint',
  'felt',
  'scannerShell',
] as const);

/** Name of a counter material slot. */
export type CounterMaterialSlot = (typeof COUNTER_MATERIAL_SLOTS)[number];

/** True when `value` names a counter material slot. */
export function isCounterMaterialSlot(value: unknown): value is CounterMaterialSlot {
  return typeof value === 'string' && (COUNTER_MATERIAL_SLOTS as readonly string[]).includes(value);
}

/** Canonical material name of a slot (`counter:1985:bakelite`). */
export function counterMaterialName(year: YearId, slot: CounterMaterialSlot): string {
  return `counter:${year}:${slot}`;
}

/* -------------------------------------------------------------------------- */
/* Recipes and the era material set                                           */
/* -------------------------------------------------------------------------- */

/** One era's recipe for a single surface slot. */
export interface CounterSurfaceRecipe {
  /** Prose description of the finish, surfaced in diagnostics. */
  readonly finish: string;
  readonly style: CounterTextureStyle;
  readonly roughness: number;
  readonly metalness: number;
  /** Material tint multiplied over the map. */
  readonly color?: string;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly side?: 'front' | 'back' | 'double';
  /** Overrides the material set's texture resolution for this slot. */
  readonly size?: number;
}

/** Per-era override of one slot: only the fields the era changes. */
export interface CounterSurfaceOverride {
  readonly finish?: string;
  readonly style?: Partial<CounterTextureStyle>;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly color?: string;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly side?: 'front' | 'back' | 'double';
  readonly size?: number;
}

/** Everything {@link createCounterMaterialSet} needs from an era spec. */
export interface CounterSurfaceSource {
  readonly year: YearId;
  readonly paletteName: string;
  readonly materialSetId: string;
  readonly surfaces?: Partial<Readonly<Record<CounterMaterialSlot, CounterSurfaceOverride>>>;
}

/** Neutral fallback finish, used when a slot has no default of its own. */
const PLAIN_FINISH: CounterSurfaceRecipe = Object.freeze({
  finish: 'plain painted surface',
  style: Object.freeze({ kind: 'painted-shelf', base: '#c9c3b6', accent: '#8d8478', ink: '#2a2622' }),
  roughness: 0.7,
  metalness: 0.05,
});

/**
 * Default recipe of every slot. Eras override the slots they dress differently,
 * which keeps the era data files to the details that actually differ between
 * 1945 and 2025.
 */
export const COUNTER_SURFACE_DEFAULTS: Readonly<Record<CounterMaterialSlot, CounterSurfaceRecipe>> = Object.freeze({
  wood: Object.freeze({
    finish: 'oiled hardwood',
    style: Object.freeze({ kind: 'wood-till', base: '#6b4a2c', accent: '#3d2a19', ink: '#2a1d12', scale: 3 }),
    roughness: 0.62,
    metalness: 0.02,
  }),
  enamel: Object.freeze({
    finish: 'stoved enamel',
    style: Object.freeze({ kind: 'enamel-plate', base: '#d8d2c0', accent: '#8d8677', ink: '#3b3730' }),
    roughness: 0.35,
    metalness: 0.08,
  }),
  bakelite: Object.freeze({
    finish: 'polished bakelite',
    style: Object.freeze({ kind: 'bakelite', base: '#3a2f28', accent: '#6a5a4a', ink: '#1a1512' }),
    roughness: 0.28,
    metalness: 0.05,
  }),
  steel: Object.freeze({
    finish: 'brushed steel',
    style: Object.freeze({ kind: 'steel-drawer', base: '#9aa0a4', accent: '#6d7276', ink: '#3a3e41' }),
    roughness: 0.42,
    metalness: 0.72,
  }),
  chrome: Object.freeze({
    finish: 'polished chrome',
    style: Object.freeze({ kind: 'chrome', base: '#e4e8ea', accent: '#9aa2a8', ink: '#5a6266' }),
    roughness: 0.14,
    metalness: 0.95,
  }),
  brass: Object.freeze({
    finish: 'lacquered brass',
    style: Object.freeze({ kind: 'brass', base: '#c69a44', accent: '#8a6520', ink: '#5a4212' }),
    roughness: 0.28,
    metalness: 0.88,
  }),
  glass: Object.freeze({
    finish: 'moulded glass',
    style: Object.freeze({ kind: 'glass-jar', base: '#cfe0e2', accent: '#8fb0b4', ink: '#5c7a7e' }),
    roughness: 0.08,
    metalness: 0.02,
    transparent: true,
    opacity: 0.55,
  }),
  led: Object.freeze({
    finish: 'LED display face',
    style: Object.freeze({ kind: 'led-face', base: '#16181a', accent: '#3a3f42', ink: '#ff4a2f' }),
    roughness: 0.22,
    metalness: 0.1,
    emissive: '#ff2a12',
    emissiveIntensity: 1,
  }),
  keyface: Object.freeze({
    finish: 'printed key bank',
    style: Object.freeze({ kind: 'key-legend', base: '#cbc4b2', accent: '#8a8271', ink: '#332f28' }),
    roughness: 0.5,
    metalness: 0.12,
  }),
  screen: Object.freeze({
    finish: 'phosphor screen',
    style: Object.freeze({ kind: 'crt-screen', base: '#5d5a52', accent: '#101a12', ink: '#bfe6a8' }),
    roughness: 0.3,
    metalness: 0.05,
    emissive: '#8fbf72',
    emissiveIntensity: 0.9,
  }),
  tabletScreen: Object.freeze({
    finish: 'backlit glass screen',
    style: Object.freeze({ kind: 'tablet-screen', base: '#1d2226', accent: '#2f6f6a', ink: '#eef3f2' }),
    roughness: 0.12,
    metalness: 0.04,
    emissive: '#8fb8c4',
    emissiveIntensity: 1.1,
  }),
  card: Object.freeze({
    finish: 'printed card plastic',
    style: Object.freeze({ kind: 'card-plastic', base: '#2c4468', accent: '#d9c98a', ink: '#f2f0e6' }),
    roughness: 0.32,
    metalness: 0.06,
  }),
  pinpad: Object.freeze({
    finish: 'PIN pad face',
    style: Object.freeze({ kind: 'pinpad-face', base: '#5a5f63', accent: '#2c3033', ink: '#e6e9ea' }),
    roughness: 0.45,
    metalness: 0.16,
  }),
  contactless: Object.freeze({
    finish: 'contactless reader pad',
    style: Object.freeze({ kind: 'contactless-pad', base: '#f1f2ef', accent: '#5d6360', ink: '#3d4341' }),
    roughness: 0.3,
    metalness: 0.08,
  }),
  qr: Object.freeze({
    finish: 'printed QR card',
    style: Object.freeze({ kind: 'qr-code', base: '#f6f5f0', accent: '#23282a', ink: '#4a504e' }),
    roughness: 0.55,
    metalness: 0.02,
  }),
  receiptPaper: Object.freeze({
    finish: 'roll paper tape',
    style: Object.freeze({
      kind: 'receipt-paper',
      base: '#f4f1e6',
      accent: '#d9d3c2',
      ink: '#3f3a33',
      mark: 'TILL',
      lines: [],
    }),
    roughness: 0.85,
    metalness: 0,
    side: 'double',
  }),
  docketPaper: Object.freeze({
    finish: 'handwritten docket pad',
    style: Object.freeze({
      kind: 'docket-paper',
      base: '#efe4c8',
      accent: '#c9b892',
      ink: '#3a3128',
      mark: 'ORDER',
    }),
    roughness: 0.88,
    metalness: 0,
    side: 'double',
  }),
  ledgerPaper: Object.freeze({
    finish: 'ruled day book',
    style: Object.freeze({
      kind: 'ledger-paper',
      base: '#e8e4d2',
      accent: '#a8b4c0',
      ink: '#3b3a33',
    }),
    roughness: 0.86,
    metalness: 0,
  }),
  label: Object.freeze({
    finish: 'printed plate',
    style: Object.freeze({
      kind: 'printed-label',
      base: '#e7dfc6',
      accent: '#8a7b5c',
      ink: '#332c20',
      mark: 'HALLAM',
      text: 'COFFEE 3d',
    }),
    roughness: 0.66,
    metalness: 0.04,
    side: 'double',
  }),
  printerShell: Object.freeze({
    finish: 'moulded printer casing',
    style: Object.freeze({ kind: 'printer-shell', base: '#cfc7b4', accent: '#5f5a50', ink: '#3b3730' }),
    roughness: 0.44,
    metalness: 0.08,
  }),
  rubber: Object.freeze({
    finish: 'rubber-sheathed cable',
    style: Object.freeze({ kind: 'rubber-cable', base: '#2c2a28', accent: '#4a4744', ink: '#151413' }),
    roughness: 0.72,
    metalness: 0.03,
  }),
  shelfPaint: Object.freeze({
    finish: 'painted steel shelf',
    style: Object.freeze({ kind: 'painted-shelf', base: '#8f948f', accent: '#5d6260', ink: '#333735' }),
    roughness: 0.5,
    metalness: 0.35,
  }),
  felt: Object.freeze({
    finish: 'felt-lined compartment',
    style: Object.freeze({ kind: 'coin-felt', base: '#4a2f2c', accent: '#8d6a4a', ink: '#2b1c1a', size: 64 }),
    roughness: 0.95,
    metalness: 0,
  }),
  scannerShell: Object.freeze({
    finish: 'moulded scanner shell',
    style: Object.freeze({ kind: 'scanner-shell', base: '#3b3a38', accent: '#12110f', ink: '#e8e6e0' }),
    roughness: 0.38,
    metalness: 0.12,
  }),
});

/** Merges an era's slot overrides over {@link COUNTER_SURFACE_DEFAULTS}. */
export function counterSurfaces(
  source: CounterSurfaceSource,
): Readonly<Record<CounterMaterialSlot, CounterSurfaceRecipe>> {
  const overrides = source.surfaces ?? {};
  const merged = {} as Record<CounterMaterialSlot, CounterSurfaceRecipe>;
  for (const slot of COUNTER_MATERIAL_SLOTS) {
    const base = COUNTER_SURFACE_DEFAULTS[slot] ?? PLAIN_FINISH;
    const override = overrides[slot];
    merged[slot] = override
      ? {
          finish: override.finish ?? base.finish,
          style: { ...base.style, ...(override.style ?? {}) },
          roughness: override.roughness ?? base.roughness,
          metalness: override.metalness ?? base.metalness,
          color: override.color ?? base.color,
          emissive: override.emissive ?? base.emissive,
          emissiveIntensity: override.emissiveIntensity ?? base.emissiveIntensity,
          transparent: override.transparent ?? base.transparent,
          opacity: override.opacity ?? base.opacity,
          side: override.side ?? base.side,
          size: override.size ?? base.size,
        }
      : base;
  }
  return Object.freeze(merged);
}

/* -------------------------------------------------------------------------- */
/* Material set                                                               */
/* -------------------------------------------------------------------------- */

/** One era's complete counter material set. */
export interface CounterMaterialSet {
  readonly id: string;
  readonly year: YearId;
  readonly paletteName: string;
  readonly specMaterialSetId: string;
  readonly slots: Readonly<Record<CounterMaterialSlot, THREE.MeshStandardMaterial>>;
  /** Every procedural texture the set owns. */
  readonly textures: readonly THREE.Texture[];
  readonly textureSource: 'canvas' | 'data' | 'mixed';
}

export interface CounterMaterialSetOptions {
  readonly canvasFactory?: CounterCanvasFactory;
  /** Texture resolution override for every slot. */
  readonly textureSize?: number;
}

/** Reads one slot out of a set, typed as a standard material for mesh use. */
export function counterMaterial(
  set: CounterMaterialSet,
  slot: CounterMaterialSlot,
): THREE.MeshStandardMaterial {
  return set.slots[slot];
}

/** Every material in a set, in slot order. */
export function counterMaterialSetMaterials(set: CounterMaterialSet): readonly THREE.Material[] {
  return COUNTER_MATERIAL_SLOTS.map((slot) => set.slots[slot]);
}

/** Deterministic signature of a set: identical for identical era sets. */
export function counterMaterialSetSignature(set: CounterMaterialSet): string {
  return [
    set.id,
    ...COUNTER_MATERIAL_SLOTS.map((slot) => {
      const material = set.slots[slot];
      return `${slot}=${material.name}${material.map ? `:${material.map.name}` : ''}`;
    }),
  ].join('|');
}

function sideOf(side: CounterSurfaceRecipe['side']): THREE.Side {
  if (side === 'double') return THREE.DoubleSide;
  if (side === 'back') return THREE.BackSide;
  return THREE.FrontSide;
}

/** Builds an era's complete material set (procedural textures, no network). */
export function createCounterMaterialSet(
  source: CounterSurfaceSource,
  options: CounterMaterialSetOptions = {},
): CounterMaterialSet {
  const surfaces = counterSurfaces(source);
  const slots = {} as Record<CounterMaterialSlot, THREE.MeshStandardMaterial>;
  const textures: THREE.Texture[] = [];
  const sources = new Set<'canvas' | 'data'>();

  for (const slot of COUNTER_MATERIAL_SLOTS) {
    const recipe = surfaces[slot];
    const finish = createCounterTexture(
      { ...recipe.style, size: recipe.size ?? options.textureSize ?? recipe.style.size },
      { key: `${source.year}:${slot}`, canvasFactory: options.canvasFactory },
    );
    textures.push(finish.texture);
    sources.add(finish.source);

    const material = new THREE.MeshStandardMaterial({
      name: counterMaterialName(source.year, slot),
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
      counter: {
        slot,
        year: source.year,
        materialSetId: source.materialSetId,
        paletteName: source.paletteName,
        finish: recipe.finish,
        textureKey: finish.texture.name,
        textureSource: finish.source,
        procedural: true,
      },
    };
    slots[slot] = material;
  }

  const textureSource: CounterMaterialSet['textureSource'] =
    sources.size > 1 ? 'mixed' : sources.has('canvas') ? 'canvas' : 'data';

  return {
    id: `counter-material-set:${source.year}:${source.materialSetId}`,
    year: source.year,
    paletteName: source.paletteName,
    specMaterialSetId: source.materialSetId,
    slots: Object.freeze(slots),
    textures: Object.freeze(textures),
    textureSource,
  };
}

/** Releases every material and texture of a set. Safe to call more than once. */
export function disposeCounterMaterialSet(set: CounterMaterialSet): void {
  for (const texture of set.textures) texture.dispose();
  for (const slot of COUNTER_MATERIAL_SLOTS) set.slots[slot].dispose();
}

/** Overrides applied to a cloned, animatable face material. */
export interface CounterFaceMaterialOverrides {
  readonly color?: string | number;
  readonly emissive?: string | number;
  readonly emissiveIntensity?: number;
  readonly map?: THREE.Texture | null;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly side?: 'front' | 'back' | 'double';
}

/**
 * Clones a slot material so a lit face (LED, screen, status lamp, tape) can be
 * animated on its own without disturbing the shared set. The clone keeps the
 * set's map unless `overrides.map` replaces it, which is how the receipt tape
 * gets a privately scrolling paper texture.
 */
export function counterFaceMaterial(
  set: CounterMaterialSet,
  slot: CounterMaterialSlot,
  overrides: CounterFaceMaterialOverrides = {},
): THREE.MeshStandardMaterial {
  const clone = counterMaterial(set, slot).clone();
  clone.name = `${set.slots[slot].name}:face`;
  if (overrides.color !== undefined) clone.color = new THREE.Color(overrides.color);
  if (overrides.emissive !== undefined) clone.emissive = new THREE.Color(overrides.emissive);
  if (overrides.emissiveIntensity !== undefined) clone.emissiveIntensity = overrides.emissiveIntensity;
  if (overrides.map !== undefined) clone.map = overrides.map;
  if (overrides.transparent !== undefined) clone.transparent = overrides.transparent;
  if (overrides.opacity !== undefined) clone.opacity = overrides.opacity;
  if (overrides.side !== undefined) clone.side = sideOf(overrides.side);
  return clone;
}

/** Clones a slot's map so a prop can scroll or wrap it privately. */
export function counterPrivateMap(
  set: CounterMaterialSet,
  slot: CounterMaterialSlot,
  repeat: readonly [number, number] = [1, 1],
): THREE.Texture | null {
  const map = counterMaterial(set, slot).map;
  if (!map) return null;
  const clone = map.clone();
  clone.name = `${map.name}:private`;
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeat[0], repeat[1]);
  clone.needsUpdate = true;
  return clone;
}

/* -------------------------------------------------------------------------- */
/* Mesh primitives                                                            */
/* -------------------------------------------------------------------------- */

/** Size of a prop part in metres, in the prop's own local frame. */
export type CounterSize3 = readonly [x: number, y: number, z: number];

export interface CounterMeshOptions {
  readonly position?: readonly [x: number, y: number, z: number];
  readonly rotation?: readonly [x: number, y: number, z: number];
}

/** Box part of a counter prop. */
export function counterBoxMesh(
  set: CounterMaterialSet,
  slot: CounterMaterialSlot,
  size: CounterSize3,
  name: string,
  options: CounterMeshOptions = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), counterMaterial(set, slot));
  mesh.name = name;
  if (options.position) mesh.position.set(options.position[0], options.position[1], options.position[2]);
  if (options.rotation) mesh.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
  return mesh;
}

export interface CounterCylinderOptions extends CounterMeshOptions {
  readonly radius: number;
  readonly height: number;
  readonly radialSegments?: number;
  readonly radiusTop?: number;
}

/** Cylinder part of a counter prop (bells, jars, rolls, poles, pens, cranks). */
export function counterCylinderMesh(
  set: CounterMaterialSet,
  slot: CounterMaterialSlot,
  options: CounterCylinderOptions,
): THREE.Mesh {
  const radialSegments = Math.max(Math.trunc(options.radialSegments ?? 12), 3);
  const geometry = new THREE.CylinderGeometry(
    options.radiusTop ?? options.radius,
    options.radius,
    options.height,
    radialSegments,
  );
  const mesh = new THREE.Mesh(geometry, counterMaterial(set, slot));
  if (options.position) mesh.position.set(options.position[0], options.position[1], options.position[2]);
  if (options.rotation) mesh.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
  return mesh;
}

/** Flat face part: screens, printed plates, cards, labels, paper. */
export function counterFaceMesh(
  set: CounterMaterialSet,
  slot: CounterMaterialSlot,
  size: readonly [width: number, height: number],
  name: string,
  options: CounterMeshOptions = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), counterMaterial(set, slot));
  mesh.name = name;
  if (options.position) mesh.position.set(options.position[0], options.position[1], options.position[2]);
  if (options.rotation) mesh.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
  return mesh;
}
