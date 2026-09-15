/**
 * Procedural poster artwork — every pixel is painted here, nothing is fetched.
 *
 * The poster domain owns the café's wall artwork: framed one-sheets, pinned
 * notices, taped handbills and unframed pasted sheets for 1945, 1965, 1985, 2005
 * and 2025. All of it is generated locally:
 *
 *  - {@link PosterSurface} is a small RGBA raster with the primitives poster art
 *    needs (rectangles, gradients, discs, rings, polygons, wedges, glows, lines,
 *    creases, stains, torn corners) plus a built-in bitmap font with era
 *    typographic variants (condensed, display, outline, neon, script,
 *    typewriter, grotesque, news, stencil). No web font, no image, no SVG.
 *  - {@link paintPosterFace} composes one poster face from a layout painter and
 *    a motif painter, then applies print-colour drift and wall/counter wear.
 *  - {@link createPosterFaceTexture}, {@link createHardwareTexture},
 *    {@link createWallWearTexture} and {@link createFrameGrainTexture} turn those
 *    rasters into textures. The same bytes feed two backends: a DOM 2D canvas
 *    (`putImageData` + `CanvasTexture`) in the browser, and a `DataTexture`
 *    when no canvas exists (headless kernel, node test runs).
 *
 * Both backends are aligned: the data path pre-flips its rows so a poster reads
 * upright whichever backend produced it, which posters need and tiling finishes
 * do not.
 *
 * Everything is deterministic for a given request — the painters only use the
 * seeded PRNG of `../../core/kernel` — so an era looks the same on every run and
 * the tests can assert real artwork content instead of placeholder colours.
 */

import * as THREE from 'three';
import { createSeededRandom } from '../../core/kernel';
import type { YearId } from '../../contracts/period';

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
/* Raster surface                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Tiny RGBA raster with the primitives poster artwork is composed from.
 * Coordinates outside the surface are clipped (posters do not tile), and every
 * paint call is deterministic.
 */
export class PosterSurface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, background?: Rgb, alpha = 255) {
    this.width = Math.max(Math.trunc(width), 1);
    this.height = Math.max(Math.trunc(height), 1);
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
    if (background) this.fill(background, alpha);
  }

  private index(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /* -- pixels --------------------------------------------------------------- */

  /** Erases the whole surface (alpha 0). */
  clear(): void {
    this.data.fill(0);
  }

  /** Fills the surface with `color`. */
  fill(color: Rgb, alpha = 255): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.set(x, y, color, alpha);
      }
    }
  }

  /** Opaque write. */
  set(x: number, y: number, color: Rgb, alpha = 255): void {
    if (!this.inside(x, y)) return;
    const index = this.index(x, y);
    this.data[index] = color.r;
    this.data[index + 1] = color.g;
    this.data[index + 2] = color.b;
    this.data[index + 3] = clampByte(alpha);
  }

  /** Source-over blend of `color` at `coverage` (0..1). */
  blend(x: number, y: number, color: Rgb, coverage: number): void {
    if (!this.inside(x, y)) return;
    const amount = clamp01(coverage);
    if (amount <= 0) return;
    const index = this.index(x, y);
    const data = this.data;
    const existing = (data[index + 3] ?? 0) / 255;
    const outAlpha = amount + existing * (1 - amount);
    if (outAlpha <= 0) return;
    const keep = (existing * (1 - amount)) / outAlpha;
    const add = amount / outAlpha;
    data[index] = clampByte((data[index] ?? 0) * keep + color.r * add);
    data[index + 1] = clampByte((data[index + 1] ?? 0) * keep + color.g * add);
    data[index + 2] = clampByte((data[index + 2] ?? 0) * keep + color.b * add);
    data[index + 3] = clampByte(outAlpha * 255);
  }

  sample(x: number, y: number): Rgb {
    if (!this.inside(x, y)) return { r: 0, g: 0, b: 0 };
    const index = this.index(x, y);
    return { r: this.data[index] ?? 0, g: this.data[index + 1] ?? 0, b: this.data[index + 2] ?? 0 };
  }

  alphaAt(x: number, y: number): number {
    return this.inside(x, y) ? (this.data[this.index(x, y) + 3] ?? 0) : 0;
  }

  /* -- shapes --------------------------------------------------------------- */

  /** Fills a rectangle, clipped to the surface. */
  fillRect(x: number, y: number, width: number, height: number, color: Rgb, alpha = 255): void {
    const x0 = Math.trunc(x);
    const y0 = Math.trunc(y);
    const x1 = Math.trunc(x + width);
    const y1 = Math.trunc(y + height);
    for (let row = Math.max(y0, 0); row < Math.min(y1, this.height); row += 1) {
      for (let column = Math.max(x0, 0); column < Math.min(x1, this.width); column += 1) {
        this.set(column, row, color, alpha);
      }
    }
  }

  /** Blends a rectangle over what is already there. */
  blendRect(x: number, y: number, width: number, height: number, color: Rgb, coverage: number): void {
    const x0 = Math.trunc(x);
    const y0 = Math.trunc(y);
    const x1 = Math.trunc(x + width);
    const y1 = Math.trunc(y + height);
    for (let row = Math.max(y0, 0); row < Math.min(y1, this.height); row += 1) {
      for (let column = Math.max(x0, 0); column < Math.min(x1, this.width); column += 1) {
        this.blend(column, row, color, coverage);
      }
    }
  }

  /** Vertical linear gradient inside a rectangle. */
  verticalGradient(
    x: number,
    y: number,
    width: number,
    height: number,
    top: Rgb,
    bottom: Rgb,
    alpha = 255,
  ): void {
    const rows = Math.max(Math.trunc(height), 1);
    for (let step = 0; step < rows; step += 1) {
      const t = rows === 1 ? 0 : step / (rows - 1);
      const color = mixRgb(top, bottom, t);
      this.fillRect(x, y + step, width, 1, color, alpha);
    }
  }

  /** Soft radial glow — neon tubes, sunbursts, photographic fall-off. */
  glow(cx: number, cy: number, radius: number, color: Rgb, strength: number, alpha = 255): void {
    const r = Math.max(radius, 0.5);
    const coverageScale = clamp01(strength) * (alpha / 255);
    const x0 = Math.max(Math.floor(cx - r), 0);
    const x1 = Math.min(Math.ceil(cx + r), this.width - 1);
    const y0 = Math.max(Math.floor(cy - r), 0);
    const y1 = Math.min(Math.ceil(cy + r), this.height - 1);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const distance = Math.hypot(x - cx, y - cy) / r;
        if (distance >= 1) continue;
        const falloff = (1 - distance) ** 2;
        this.blend(x, y, color, falloff * coverageScale);
      }
    }
  }

  /** Thick line between two points. */
  line(x0: number, y0: number, x1: number, y1: number, color: Rgb, thickness = 1, alpha = 255): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const size = Math.max(Math.trunc(thickness), 1);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      this.fillRect(x - Math.floor(size / 2), y - Math.floor(size / 2), size, size, color, alpha);
    }
  }

  /** Rectangle outline of `thickness` pixels. */
  strokeRect(x: number, y: number, width: number, height: number, color: Rgb, thickness = 1, alpha = 255): void {
    const t = Math.max(Math.trunc(thickness), 1);
    this.fillRect(x, y, width, t, color, alpha);
    this.fillRect(x, y + height - t, width, t, color, alpha);
    this.fillRect(x, y, t, height, color, alpha);
    this.fillRect(x + width - t, y, t, height, color, alpha);
  }

  /** Filled circle with an antialiased rim. */
  disc(cx: number, cy: number, radius: number, color: Rgb, alpha = 255): void {
    const r = Math.max(radius, 0);
    const x0 = Math.max(Math.floor(cx - r - 1), 0);
    const x1 = Math.min(Math.ceil(cx + r + 1), this.width - 1);
    const y0 = Math.max(Math.floor(cy - r - 1), 0);
    const y1 = Math.min(Math.ceil(cy + r + 1), this.height - 1);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const coverage = r + 0.5 - Math.hypot(x - cx, y - cy);
        if (coverage <= 0) continue;
        this.blend(x, y, color, Math.min(coverage, 1) * (alpha / 255));
      }
    }
  }

  /** Circle outline (rings, reels, wheels, clock faces). */
  ring(cx: number, cy: number, radius: number, thickness: number, color: Rgb, alpha = 255): void {
    const r = Math.max(radius, 0);
    const half = Math.max(thickness, 1) / 2;
    const x0 = Math.max(Math.floor(cx - r - half - 1), 0);
    const x1 = Math.min(Math.ceil(cx + r + half + 1), this.width - 1);
    const y0 = Math.max(Math.floor(cy - r - half - 1), 0);
    const y1 = Math.min(Math.ceil(cy + r + half + 1), this.height - 1);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const coverage = half + 0.5 - Math.abs(Math.hypot(x - cx, y - cy) - r);
        if (coverage <= 0) continue;
        this.blend(x, y, color, Math.min(coverage, 1) * (alpha / 255));
      }
    }
  }

  /** Even-odd filled polygon (silhouettes, banners, flags, framing devices). */
  polygon(points: readonly (readonly [number, number])[], color: Rgb, alpha = 255): void {
    if (points.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
    }
    const y0 = Math.max(Math.floor(minY), 0);
    const y1 = Math.min(Math.ceil(maxY), this.height - 1);
    for (let y = y0; y <= y1; y += 1) {
      const crossings: number[] = [];
      for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        if (!a || !b) continue;
        const [ax, ay] = a;
        const [bx, by] = b;
        if (ay === by) continue;
        const scanY = y + 0.5;
        if ((scanY >= Math.min(ay, by) && scanY < Math.max(ay, by))) {
          crossings.push(ax + ((scanY - ay) / (by - ay)) * (bx - ax));
        }
      }
      crossings.sort((left, right) => left - right);
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const from = Math.max(Math.floor(crossings[index] ?? 0), 0);
        const to = Math.min(Math.ceil(crossings[index + 1] ?? 0), this.width - 1);
        for (let x = from; x <= to; x += 1) {
          this.blend(x, y, color, alpha / 255);
        }
      }
    }
  }

  /** Pie wedge / light beam / sunburst ray, centred on `(cx, cy)`. */
  wedge(
    cx: number,
    cy: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    color: Rgb,
    alpha = 255,
  ): void {
    const r = Math.max(radius, 0);
    const x0 = Math.max(Math.floor(cx - r - 1), 0);
    const x1 = Math.min(Math.ceil(cx + r + 1), this.width - 1);
    const y0 = Math.max(Math.floor(cy - r - 1), 0);
    const y1 = Math.min(Math.ceil(cy + r + 1), this.height - 1);
    const coverageScale = alpha / 255;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance > r + 0.5) continue;
        let angle = Math.atan2(y - cy, x - cx);
        if (angle < 0) angle += Math.PI * 2;
        let start = startAngle % (Math.PI * 2);
        let end = endAngle % (Math.PI * 2);
        if (start < 0) start += Math.PI * 2;
        if (end < 0) end += Math.PI * 2;
        const inRange = start <= end ? angle >= start && angle <= end : angle >= start || angle <= end;
        if (!inRange) continue;
        const radiusCoverage = Math.min(r + 0.5 - distance, 1);
        this.blend(x, y, color, clamp01(radiusCoverage) * coverageScale);
      }
    }
  }

  /* -- print and wear ------------------------------------------------------- */

  /** Deterministic luminance jitter (paper tooth, halftone speckle). */
  grain(random: () => number, amount: number): void {
    const strength = clamp01(amount);
    if (strength <= 0) return;
    const data = this.data;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = this.index(x, y);
        const factor = 1 + (random() * 2 - 1) * strength * 0.35;
        data[index] = clampByte((data[index] ?? 0) * factor);
        data[index + 1] = clampByte((data[index + 1] ?? 0) * factor);
        data[index + 2] = clampByte((data[index + 2] ?? 0) * factor);
      }
    }
  }

  /** One 3x3 box blur — the ink spread (dot gain) of a wet print. */
  boxBlur(): void {
    const source = new Uint8ClampedArray(this.data);
    const width = this.width;
    const height = this.height;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            const index = (sy * width + sx) * 4;
            r += source[index] ?? 0;
            g += source[index + 1] ?? 0;
            b += source[index + 2] ?? 0;
            a += source[index + 3] ?? 0;
            count += 1;
          }
        }
        const index = this.index(x, y);
        this.data[index] = clampByte(r / count);
        this.data[index + 1] = clampByte(g / count);
        this.data[index + 2] = clampByte(b / count);
        this.data[index + 3] = clampByte(a / count);
      }
    }
  }

  /**
   * Offset colour channels, the way a two-pass press drifts between runs.
   * Red is pulled one way, blue the other, both blended in by `amount`.
   */
  misregister(dx: number, dy: number, amount: number): void {
    const strength = clamp01(amount);
    if (strength <= 0) return;
    const source = new Uint8ClampedArray(this.data);
    const sample = (x: number, y: number): Rgb => {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return { r: 0, g: 0, b: 0 };
      const index = (y * this.width + x) * 4;
      return { r: source[index] ?? 0, g: source[index + 1] ?? 0, b: source[index + 2] ?? 0 };
    };
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const red = sample(x + Math.round(dx), y + Math.round(dy));
        const blue = sample(x - Math.round(dx), y - Math.round(dy));
        const index = this.index(x, y);
        this.data[index] = clampByte((this.data[index] ?? 0) * (1 - strength) + red.r * strength);
        this.data[index + 2] = clampByte((this.data[index + 2] ?? 0) * (1 - strength) + blue.b * strength);
      }
    }
  }

  /** Washes the print toward `color` — sun fade, yellowing, colour cast. */
  tint(color: Rgb, amount: number, mode: 'uniform' | 'top' | 'bottom' | 'edges' = 'uniform'): void {
    const strength = clamp01(amount);
    if (strength <= 0) return;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        let factor = 1;
        if (mode === 'top') {
          factor = 1 - (y / Math.max(this.height - 1, 1)) * 0.6;
        } else if (mode === 'bottom') {
          factor = 0.4 + (y / Math.max(this.height - 1, 1)) * 0.6;
        } else if (mode === 'edges') {
          const dx = Math.abs(x - this.width / 2) / (this.width / 2);
          const dy = Math.abs(y - this.height / 2) / (this.height / 2);
          factor = clamp01(Math.max(dx, dy) - 0.55) / 0.45;
          if (factor <= 0) continue;
        }
        this.blend(x, y, color, strength * clamp01(factor));
      }
    }
  }

  /** Soft-edged dark vignette, the way framed prints darken at the mount. */
  vignette(color: Rgb, amount: number): void {
    const strength = clamp01(amount);
    if (strength <= 0) return;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const maxDistance = Math.hypot(cx, cy);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const distance = Math.hypot(x - cx, y - cy) / maxDistance;
        const falloff = clamp01((distance - 0.55) / 0.45);
        if (falloff <= 0) continue;
        this.blend(x, y, color, falloff ** 2 * strength);
      }
    }
  }

  /** Random stains: damp blotches, drink rings, tobacco smoke yellowing. */
  stains(random: () => number, count: number, color: Rgb, amount: number): void {
    const strength = clamp01(amount);
    const blobs = Math.max(Math.trunc(count), 0);
    for (let index = 0; index < blobs; index += 1) {
      const cx = random() * this.width;
      const cy = random() * this.height;
      const radius = (0.04 + random() * 0.16) * Math.min(this.width, this.height);
      const local = strength * (0.5 + random() * 0.6);
      this.glow(cx, cy, radius, color, local, 210);
      if (random() > 0.6) {
        this.ring(cx, cy, radius * 0.72, 1 + random() * 2, shadeRgb(color, 0.75), clampByte(120 * strength));
      }
    }
  }

  /** Press creases and fold lines (posters that were rolled or folded). */
  creases(random: () => number, count: number, amount: number): void {
    const strength = clamp01(amount);
    const folds = Math.max(Math.trunc(count), 0);
    for (let index = 0; index < folds; index += 1) {
      const vertical = random() > 0.5;
      const position = Math.round((vertical ? this.width : this.height) * (0.2 + random() * 0.6));
      const dark = shadeRgb({ r: 40, g: 34, b: 28 }, 1);
      if (vertical) {
        this.blendRect(position, 0, 1, this.height, dark, strength * 0.5);
        this.blendRect(position + 1, 0, 1, this.height, { r: 255, g: 250, b: 236 }, strength * 0.28);
      } else {
        this.blendRect(0, position, this.width, 1, dark, strength * 0.5);
        this.blendRect(0, position + 1, this.width, 1, { r: 255, g: 250, b: 236 }, strength * 0.28);
      }
      if (random() > 0.5) {
        const length = (vertical ? this.height : this.width) * (0.15 + random() * 0.3);
        const start = random() * ((vertical ? this.height : this.width) - length);
        const offset = Math.round((vertical ? this.width : this.height) * (0.3 + random() * 0.4));
        if (vertical) {
          this.line(position, start, position, start + length, { r: 58, g: 48, b: 38 }, 1, clampByte(90 * strength));
        } else {
          this.line(start, position, start + length, position, { r: 58, g: 48, b: 38 }, 1, clampByte(90 * strength));
        }
        if (vertical) {
          this.line(offset, start, offset, start + length, { r: 226, g: 216, b: 196 }, 1, clampByte(70 * strength));
        } else {
          this.line(start, offset, start + length, offset, { r: 226, g: 216, b: 196 }, 1, clampByte(70 * strength));
        }
      }
    }
  }

  /** Abraded, dirt-darkened border and knocked corners. */
  edgeWear(random: () => number, amount: number, paper: Rgb): void {
    const strength = clamp01(amount);
    if (strength <= 0) return;
    const band = Math.max(Math.round(Math.min(this.width, this.height) * 0.035 * (0.5 + strength)), 2);
    const dirt = mixRgb(paper, { r: 86, g: 68, b: 44 }, 0.55);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const distance = Math.min(x, y, this.width - 1 - x, this.height - 1 - y);
        if (distance >= band) continue;
        const falloff = (1 - distance / band) ** 1.6;
        const speckle = 0.55 + random() * 0.45;
        this.blend(x, y, dirt, falloff * strength * 0.55 * speckle);
      }
    }
    const chips = Math.round(2 + strength * 5);
    for (let index = 0; index < chips; index += 1) {
      const onWidth = random() > 0.5;
      const edge = random() > 0.5 ? 0 : 1;
      const size = 2 + Math.round(random() * 4 * strength);
      if (onWidth) {
        this.blendRect(random() * this.width, edge === 0 ? 0 : this.height - size, size, size, dirt, 0.7 * strength);
      } else {
        this.blendRect(edge === 0 ? 0 : this.width - size, random() * this.height, size, size, dirt, 0.7 * strength);
      }
    }
  }

  /**
   * Tears one corner away. The corner is erased, so a mounted sheet shows the
   * wall through the missing paper exactly as a real one would.
   */
  tornCorner(random: () => number, corner: 'tl' | 'tr' | 'bl' | 'br', size: number, paper: Rgb): void {
    const extent = Math.max(Math.round(size), 2);
    const left = corner === 'tl' || corner === 'bl';
    const top = corner === 'tl' || corner === 'tr';
    const jitter = 0.6 + random() * 0.8;
    for (let step = 0; step < extent; step += 1) {
      const span = Math.round((extent - step) * jitter);
      const y = top ? step : this.height - 1 - step;
      const x = left ? step : this.width - 1 - step;
      for (let run = 0; run < span; run += 1) {
        const px = left ? x + run : x - run;
        this.set(px, y, paper, 0);
      }
    }
    // A grubby fringe along the tear so the paper still reads as aged.
    const fringe = mixRgb(paper, { r: 120, g: 96, b: 62 }, 0.45);
    for (let step = 0; step < extent; step += 1) {
      const y = top ? step : this.height - 1 - step;
      const x = left ? step + Math.round((extent - step) * jitter) : this.width - 1 - step - Math.round((extent - step) * jitter);
      this.blend(x, y, fringe, 0.5);
    }
  }

  /* -- diagnostics ---------------------------------------------------------- */

  /** Number of distinct RGBA values (artwork richness, used by the tests). */
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

  /** Mean colour of the surface. */
  averageColor(): Rgb {
    let r = 0;
    let g = 0;
    let b = 0;
    const count = this.width * this.height;
    for (let index = 0; index < this.data.length; index += 4) {
      r += this.data[index] ?? 0;
      g += this.data[index + 1] ?? 0;
      b += this.data[index + 2] ?? 0;
    }
    return { r: clampByte(r / count), g: clampByte(g / count), b: clampByte(b / count) };
  }

  /** Fraction of pixels that differ from `reference` by more than `tolerance`. */
  coverRatio(reference: Rgb, tolerance = 24): number {
    let covered = 0;
    const count = this.width * this.height;
    for (let index = 0; index < this.data.length; index += 4) {
      const distance = Math.max(
        Math.abs((this.data[index] ?? 0) - reference.r),
        Math.abs((this.data[index + 1] ?? 0) - reference.g),
        Math.abs((this.data[index + 2] ?? 0) - reference.b),
      );
      if (distance > tolerance) covered += 1;
    }
    return covered / count;
  }

  /** Mean per-channel distance from `reference` (print colour drift measurement). */
  channelDrift(reference: Rgb): number {
    let total = 0;
    for (let index = 0; index < this.data.length; index += 4) {
      total +=
        Math.abs((this.data[index] ?? 0) - reference.r) +
        Math.abs((this.data[index + 1] ?? 0) - reference.g) +
        Math.abs((this.data[index + 2] ?? 0) - reference.b);
    }
    return total / ((this.data.length / 4) * 3);
  }
}

/* -------------------------------------------------------------------------- */
/* Bitmap font and typographic variants                                       */
/* -------------------------------------------------------------------------- */

/** Glyph bitmaps: 7 rows of 5 columns, `#` = ink. No web font is ever loaded. */
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
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '%': ['#...#', '#..#.', '...#.', '..#..', '.#...', '#..#.', '#...#'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
});

/** Font cell size in font pixels (before `scale`). */
export const FONT_GLYPH_WIDTH = 5;
export const FONT_GLYPH_HEIGHT = 7;

/** Typographic flavour of an era's lettering. */
export type FontStyleId =
  | 'condensed'
  | 'display'
  | 'bold'
  | 'outline'
  | 'neon'
  | 'script'
  | 'typewriter'
  | 'grotesque'
  | 'news'
  | 'stencil';

interface FontMetrics {
  /** Horizontal glyph squeeze. */
  readonly xScale: number;
  /** Default inter-glyph gap, in font pixels. */
  readonly tracking: number;
  readonly bold: boolean;
  /** Italic lean in font pixels per row. */
  readonly slant: number;
  /** Slab serifs at cap height and baseline. */
  readonly serif: boolean;
  /** Per-glyph ink dropout (military stencil). */
  readonly stencil: boolean;
  /** Deterministic press jitter. */
  readonly jitter: boolean;
}

const FONT_STYLES: Readonly<Record<FontStyleId, FontMetrics>> = Object.freeze({
  condensed: { xScale: 0.74, tracking: 1, bold: true, slant: 0, serif: false, stencil: false, jitter: false },
  display: { xScale: 1.05, tracking: 1, bold: true, slant: 0, serif: false, stencil: false, jitter: false },
  bold: { xScale: 1, tracking: 1, bold: true, slant: 0, serif: false, stencil: false, jitter: false },
  outline: { xScale: 1.02, tracking: 1, bold: false, slant: 0, serif: false, stencil: false, jitter: false },
  neon: { xScale: 0.92, tracking: 2, bold: true, slant: 0, serif: false, stencil: false, jitter: false },
  script: { xScale: 0.9, tracking: 0, bold: false, slant: 1, serif: true, stencil: false, jitter: false },
  typewriter: { xScale: 1, tracking: 2, bold: false, slant: 0, serif: true, stencil: false, jitter: true },
  grotesque: { xScale: 1, tracking: 1, bold: false, slant: 0, serif: false, stencil: false, jitter: false },
  news: { xScale: 0.86, tracking: 1, bold: true, slant: 0, serif: true, stencil: false, jitter: false },
  stencil: { xScale: 1.02, tracking: 2, bold: true, slant: 0, serif: false, stencil: true, jitter: false },
});

/** Metrics of one typographic variant. */
export function fontMetrics(style: FontStyleId): FontMetrics {
  return FONT_STYLES[style];
}

/** Options for {@link drawPosterText} and {@link measurePosterText}. */
export interface TextOptions {
  /** Glyph size in pixels (the 7 pixel cell is multiplied by this). */
  readonly scale: number;
  readonly color: Rgb;
  readonly style?: FontStyleId;
  /** Overrides the style's default inter-glyph gap. */
  readonly tracking?: number;
  readonly align?: 'left' | 'center' | 'right';
  readonly alpha?: number;
  /** Shrinks the type until it fits this width. */
  readonly maxWidth?: number;
  /** Second ink pass that outlines the glyphs. */
  readonly outline?: Rgb;
  /** Halo colour; used by the neon variant. */
  readonly glow?: Rgb;
}

function glyphRows(glyph: string): readonly string[] {
  return FONT_5X7[glyph] ?? FONT_5X7[' '] ?? [];
}

function glyphInk(glyph: string, column: number, row: number): boolean {
  const rows = glyphRows(glyph);
  return (rows[row] ?? '')[column] === '#';
}

function textWidthOf(text: string, scale: number, style: FontStyleId, tracking: number): number {
  const metrics = FONT_STYLES[style];
  const advance = (FONT_GLYPH_WIDTH * metrics.xScale + tracking) * scale;
  return Math.max(text.length * advance - tracking * scale, 0);
}

/** Width in pixels of `text` at the given scale and variant. */
export function measurePosterText(
  text: string,
  options: Pick<TextOptions, 'scale' | 'style' | 'tracking'>,
): number {
  const style = options.style ?? 'grotesque';
  const metrics = FONT_STYLES[style];
  return textWidthOf(text, Math.max(Math.trunc(options.scale), 1), style, options.tracking ?? metrics.tracking);
}

/** Largest scale at or below `baseScale` at which `text` fits `maxWidth`. */
export function fitTextScale(
  text: string,
  maxWidth: number,
  baseScale: number,
  options: Pick<TextOptions, 'style' | 'tracking'> = {},
): number {
  let scale = Math.max(Math.trunc(baseScale), 1);
  while (scale > 1 && measurePosterText(text, { ...options, scale }) > maxWidth) {
    scale -= 1;
  }
  return scale;
}

/**
 * Draws `text` with the built-in bitmap font, applying the era typographic
 * variant. Returns the width actually painted, so callers can centre or rule
 * under it.
 */
export function drawPosterText(surface: PosterSurface, text: string, x: number, y: number, options: TextOptions): number {
  const style = options.style ?? 'grotesque';
  const metrics = FONT_STYLES[style];
  const tracking = options.tracking ?? metrics.tracking;
  const scale = fitTextScale(
    text,
    options.maxWidth ?? Number.POSITIVE_INFINITY,
    options.scale,
    { style, tracking },
  );
  const advance = (FONT_GLYPH_WIDTH * metrics.xScale + tracking) * scale;
  const total = Math.max(textWidthOf(text, scale, style, tracking), 1);
  const startX =
    options.align === 'center' ? x - total / 2 : options.align === 'right' ? x - total : x;
  const alpha = options.alpha ?? 255;
  const cellWidth = Math.max(Math.round(metrics.xScale * scale), 1);
  const glyphs = text.toUpperCase().split('');
  const outline = options.outline;
  const glow = options.glow;

  glyphs.forEach((glyph, glyphIndex) => {
    if (glyph === ' ') return;
    const originX = startX + glyphIndex * advance;
    const jitterX = metrics.jitter ? (hashString(`${text}:${glyphIndex}`) % 3) - 1 : 0;
    const jitterY = metrics.jitter ? ((hashString(`${glyph}:${glyphIndex}`) >>> 4) % 3) - 1 : 0;

    const cellAt = (column: number, row: number): { x: number; y: number } => {
      let cellX = originX + column * metrics.xScale * scale + jitterX;
      cellX += metrics.slant * (FONT_GLYPH_HEIGHT - 1 - row) * scale;
      return { x: Math.round(cellX), y: Math.round(y + row * scale + jitterY) };
    };

    const paintGlyph = (color: Rgb, coverage: number, offsetX = 0, offsetY = 0, thick = 0): void => {
      for (let row = 0; row < FONT_GLYPH_HEIGHT; row += 1) {
        for (let column = 0; column < FONT_GLYPH_WIDTH; column += 1) {
          if (!glyphInk(glyph, column, row)) continue;
          if (metrics.stencil && row === 3 && column > 0 && column < FONT_GLYPH_WIDTH - 1) continue;
          const cell = cellAt(column, row);
          const width = cellWidth + thick;
          const height = scale + thick;
          if (metrics.serif && (row === 0 || row === FONT_GLYPH_HEIGHT - 1)) {
            surface.blendRect(cell.x - 1 + offsetX, cell.y + offsetY, width + 2, height, color, coverage);
          } else {
            surface.blendRect(cell.x + offsetX, cell.y + offsetY, width, height, color, coverage);
          }
        }
      }
    };

    if (glow) {
      for (const [dx, dy] of [
        [-2, 0],
        [2, 0],
        [0, -2],
        [0, 2],
        [-1, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
      ] as const) {
        paintGlyph(glow, (alpha / 255) * 0.22, dx, dy, 1);
      }
    }

    paintGlyph(options.color, alpha / 255, 0, 0, metrics.bold ? 1 : 0);

    if (outline) {
      for (let row = 0; row < FONT_GLYPH_HEIGHT; row += 1) {
        for (let column = 0; column < FONT_GLYPH_WIDTH; column += 1) {
          if (glyphInk(glyph, column, row)) continue;
          const touching =
            glyphInk(glyph, column - 1, row) ||
            glyphInk(glyph, column + 1, row) ||
            glyphInk(glyph, column, row - 1) ||
            glyphInk(glyph, column, row + 1);
          if (!touching) continue;
          const cell = cellAt(column, row);
          surface.blendRect(cell.x, cell.y, cellWidth, scale, outline, alpha / 255);
        }
      }
    }
  });

  return total;
}

/** A rectangle in surface pixels: where a motif or a text block may paint. */
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Draws a paragraph, one line per entry, returning the block height. */
export function drawTextBlock(
  surface: PosterSurface,
  lines: readonly string[],
  options: {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly color: Rgb;
    readonly style: FontStyleId;
    readonly tracking: number;
    readonly align?: 'left' | 'center' | 'right';
    readonly alpha?: number;
    readonly maxWidth?: number;
    readonly lineHeight?: number;
  },
): number {
  const lineHeight = options.lineHeight ?? Math.round(options.scale * (FONT_GLYPH_HEIGHT + 3));
  lines.forEach((line, index) => {
    drawPosterText(surface, line, options.x, options.y + index * lineHeight, {
      scale: options.scale,
      color: options.color,
      style: options.style,
      tracking: options.tracking,
      align: options.align,
      alpha: options.alpha,
      maxWidth: options.maxWidth,
    });
  });
  return lines.length * lineHeight;
}

/** Measured height of a text block, in pixels. */
export function textBlockHeight(lineCount: number, scale: number, lineHeight?: number): number {
  return lineCount * (lineHeight ?? Math.round(scale * (FONT_GLYPH_HEIGHT + 3)));
}

/* -------------------------------------------------------------------------- */
/* Artwork vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/** Print palette of one poster. Values are CSS colour strings. */
export interface PosterPalette {
  readonly paper: string;
  readonly ink: string;
  readonly accent: string;
  readonly secondary: string;
  readonly highlight: string;
  readonly badge?: string;
}

/** {@link PosterPalette} resolved to bytes. */
export interface ResolvedPalette {
  readonly paper: Rgb;
  readonly ink: Rgb;
  readonly accent: Rgb;
  readonly secondary: Rgb;
  readonly highlight: Rgb;
  readonly badge: Rgb;
}

/** Resolves a poster palette. */
export function resolvePalette(palette: PosterPalette): ResolvedPalette {
  return {
    paper: parseColor(palette.paper),
    ink: parseColor(palette.ink),
    accent: parseColor(palette.accent),
    secondary: parseColor(palette.secondary),
    highlight: parseColor(palette.highlight),
    badge: parseColor(palette.badge ?? palette.accent),
  };
}

/** Era typography: which variants the era's art department had. */
export interface PosterTypography {
  readonly display: FontStyleId;
  readonly body: FontStyleId;
  readonly displayTracking: number;
  readonly bodyTracking: number;
  /** Multiplier applied to the layout's headline scale. */
  readonly titleScale: number;
  /** Body copy scale in pixels. */
  readonly bodyScale: number;
  readonly align: 'left' | 'center';
  readonly ruleStyle: 'none' | 'thin' | 'thick' | 'double';
}

/** The era's printing plant: ink spread, register drift, fade and cast. */
export interface PosterPrintRecipe {
  /** Halftone ink spread, 0..1. */
  readonly dotGain: number;
  /** Channel offset in pixels (0 for a digital press). */
  readonly misregistration: number;
  /** Fade toward {@link colourCast}, 0..1. */
  readonly fade: number;
  readonly colourCast: string;
}

/** Composition of one poster face. */
export type PosterLayoutId =
  | 'letterpress-notice'
  | 'ration-block'
  | 'billboard-stack'
  | 'testimonial'
  | 'travel-poster'
  | 'neon-brand'
  | 'cinema-one-sheet'
  | 'film-marquee'
  | 'telecom-grid'
  | 'web-banner'
  | 'social-square'
  | 'sustainability-panel'
  | 'local-art-print';

/** Illustration of one poster face. */
export type PosterMotifId =
  | 'ration-book'
  | 'grain-sack'
  | 'steam-mug'
  | 'victory-laurel'
  | 'megaphone'
  | 'milk-churn'
  | 'searchlight-sky'
  | 'tin-can'
  | 'soda-fountain'
  | 'straw-glass'
  | 'cigarette-pack'
  | 'smoke-curl'
  | 'locomotive'
  | 'seaside-pier'
  | 'aeroplane'
  | 'jukebox'
  | 'neon-chevron'
  | 'cassette-tape'
  | 'film-reel'
  | 'star-premiere'
  | 'vhs-tape'
  | 'pixel-grid'
  | 'clock-tower'
  | 'sprocket-strip'
  | 'film-strip'
  | 'projector-beam'
  | 'signal-bars'
  | 'router-lights'
  | 'browser-window'
  | 'envelope-pixel'
  | 'ticket-stub'
  | 'handset-grid'
  | 'hand-heart'
  | 'qr-code'
  | 'leaf-cycle'
  | 'recycle-loop'
  | 'geometric-print'
  | 'riso-cup'
  | 'bicycle';

/** Fields every poster shares, whatever the era or the mount. */
export interface PosterArtwork {
  readonly id: string;
  /** Short label for diagnostics and the hotspot list. */
  readonly title: string;
  readonly layout: PosterLayoutId;
  readonly motif: PosterMotifId;
  readonly palette: PosterPalette;
  readonly headline: string;
  readonly subhead?: string;
  readonly body: readonly string[];
  readonly badge?: string;
  readonly footer?: string;
  /** Wall and counter wear, 0..1. */
  readonly wear: number;
  /** Extra sun fade on top of the era's print recipe, 0..1. */
  readonly fade: number;
}

/** One poster face, ready to paint. */
export interface PosterFaceRequest extends PosterArtwork {
  readonly year: YearId;
  readonly typography: PosterTypography;
  readonly print: PosterPrintRecipe;
  /** Physical width / height of the sheet. */
  readonly aspect: number;
}

/* -------------------------------------------------------------------------- */
/* Texture materialisation                                                    */
/* -------------------------------------------------------------------------- */

/** Canvas factory used to reach the browser's 2D backend. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/**
 * Default factory: a DOM canvas when the document exists, otherwise `null`,
 * which makes {@link createPosterTexture} fall back to a `DataTexture`.
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

/** Every texture this module creates is named with this prefix. */
export const POSTER_TEXTURE_PREFIX = 'poster:';

/** Default pixel height of a painted poster face. */
export const POSTER_FACE_TEXTURE_HEIGHT = 384;

/** Upper bound for any procedural poster texture, so a bad option cannot explode memory. */
export const POSTER_TEXTURE_MAX_SIZE = 1024;

/** Which part of the poster assembly a texture belongs to. */
export type PosterTextureKind = 'face' | 'hardware' | 'wear' | 'frame';

/** A painted texture plus how it was materialised. */
export interface PosterTexture {
  readonly key: string;
  readonly kind: PosterTextureKind;
  readonly width: number;
  readonly height: number;
  /** Which backend produced the texture. */
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  /** The 2D canvas when the canvas backend was used, otherwise `null`. */
  readonly canvas: HTMLCanvasElement | null;
}

export interface PosterTextureOptions {
  /** Texture key, used as the texture name prefix (`poster:<key>`). */
  readonly key: string;
  readonly kind: PosterTextureKind;
  readonly canvasFactory?: CanvasFactory;
  /** UV repetition for tiling frame grains. */
  readonly repeat?: readonly [number, number];
  readonly anisotropy?: number;
}

function clampTextureSize(value: number): number {
  const size = Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.min(Math.max(size, 8), POSTER_TEXTURE_MAX_SIZE);
}

/**
 * Turns a painted surface into a texture. Uses the canvas backend when a canvas
 * (browser DOM or an injected factory) is available, otherwise a `DataTexture`.
 * No remote image, font or artwork is ever requested.
 */
export function createPosterTexture(surface: PosterSurface, options: PosterTextureOptions): PosterTexture {
  const width = surface.width;
  const height = surface.height;
  const key = options.key;
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
    applyTextureSettings(texture, `${POSTER_TEXTURE_PREFIX}${key}`, options, 'canvas');
    return { key, kind: options.kind, width, height, source: 'canvas', texture, canvas };
  }

  // Data textures upload bottom-up, so the rows are pre-flipped: the artwork
  // reads upright whichever backend produced it.
  const texture = new THREE.DataTexture(flipRows(surface.data, width, height), width, height, THREE.RGBAFormat);
  applyTextureSettings(texture, `${POSTER_TEXTURE_PREFIX}${key}`, options, 'data');
  return { key, kind: options.kind, width, height, source: 'data', texture, canvas: null };
}

function applyTextureSettings(
  texture: THREE.Texture,
  name: string,
  options: PosterTextureOptions,
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
  texture.userData = { poster: { key: options.key, kind: options.kind, procedural: true, source } };
  texture.needsUpdate = true;
}

/** True when `texture` came from this module's procedural pipeline. */
export function isProceduralPosterTexture(texture: THREE.Texture): boolean {
  return (
    (texture instanceof THREE.DataTexture || texture instanceof THREE.CanvasTexture) &&
    texture.name.startsWith(POSTER_TEXTURE_PREFIX)
  );
}

/* -------------------------------------------------------------------------- */
/* Resource tracking                                                          */
/* -------------------------------------------------------------------------- */

/** Live GPU resource counts of one poster assembly. */
export interface PosterResourceCounts {
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly surfaces: number;
}

/**
 * Owns every geometry, material and texture a poster build created. The module
 * creates one per build, hands it to the assembly code and disposes it when the
 * era changes, which is what keeps repeated timeline moves from leaking.
 */
export class PosterResources {
  private readonly geometrySet = new Set<THREE.BufferGeometry>();
  private readonly materialSet = new Set<THREE.Material>();
  private readonly textureSet = new Set<THREE.Texture>();
  private readonly surfaceSet = new Set<PosterSurface>();

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

  ownSurface<T extends PosterSurface>(surface: T): T {
    this.surfaceSet.add(surface);
    return surface;
  }

  get counts(): PosterResourceCounts {
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
  dispose(): PosterResourceCounts {
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
 * Bounded cache of painted faces. Painting a one-sheet is the most expensive
 * step of a rebuild, and the artwork is deterministic per request, so moving the
 * timeline back and forth reuses the bytes instead of repainting them.
 */
export class PosterSurfaceCache {
  private readonly entries = new Map<string, PosterSurface>();

  constructor(private readonly limit = 24) {}

  private keyOf(request: PosterFaceRequest, height: number): string {
    return `${request.year}:${request.id}:${height}:${request.wear.toFixed(2)}`;
  }

  get(request: PosterFaceRequest, height: number): PosterSurface | undefined {
    const key = this.keyOf(request, height);
    const found = this.entries.get(key);
    if (found) {
      this.entries.delete(key);
      this.entries.set(key, found);
    }
    return found;
  }

  set(request: PosterFaceRequest, height: number, surface: PosterSurface): PosterSurface {
    const key = this.keyOf(request, height);
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

/** Pixel size of a poster face with the given physical aspect ratio. */
export function posterFaceSize(aspect: number, height = POSTER_FACE_TEXTURE_HEIGHT): { width: number; height: number } {
  const safeHeight = clampTextureSize(height);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.7;
  return { width: clampTextureSize(Math.round(safeHeight * safeAspect)), height: safeHeight };
}

/* -------------------------------------------------------------------------- */
/* Painters                                                                   */
/* -------------------------------------------------------------------------- */

/** Where a motif paints, and the ink it paints with. */
export interface MotifContext {
  readonly surface: PosterSurface;
  readonly box: LayoutBox;
  readonly palette: ResolvedPalette;
  readonly random: () => number;
  readonly year: YearId;
}

/** Paints one poster illustration inside a box. */
export type MotifPainter = (context: MotifContext) => void;

/** Small centred caption used inside the motifs. */
function motifLabel(
  surface: PosterSurface,
  text: string,
  cx: number,
  y: number,
  scale: number,
  color: Rgb,
  style: FontStyleId = 'bold',
): void {
  drawPosterText(surface, text, cx, y, { scale, color, style, align: 'center', tracking: 1 });
}

/** Rotates `(x, y)` around `(cx, cy)`. */
function rotate(x: number, y: number, cx: number, cy: number, angle: number): readonly [number, number] {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Triangular arrow head pointing along `angle`. */
function arrowHead(
  tipX: number,
  tipY: number,
  size: number,
  angle: number,
): readonly (readonly [number, number])[] {
  const back = size * 1.4;
  const spread = size * 0.62;
  const left = rotate(tipX - back, tipY - spread, tipX, tipY, angle);
  const right = rotate(tipX - back, tipY + spread, tipX, tipY, angle);
  return [[tipX, tipY], left, right];
}

/** Vertical sine wave, sampled as line segments. */
function wave(
  surface: PosterSurface,
  x: number,
  fromY: number,
  toY: number,
  amplitude: number,
  color: Rgb,
  thickness: number,
  alpha = 255,
): void {
  const steps = Math.max(Math.round(Math.abs(toY - fromY) / 3), 2);
  let previousX = x + Math.sin(0) * amplitude;
  let previousY = fromY;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const y = fromY + (toY - fromY) * t;
    const px = x + Math.sin(t * Math.PI * 3) * amplitude;
    surface.line(previousX, previousY, px, y, color, thickness, alpha);
    previousX = px;
    previousY = y;
  }
}

/** Every poster illustration this module can paint. */
export const MOTIF_PAINTERS: Readonly<Record<PosterMotifId, MotifPainter>> = Object.freeze({
  'ration-book': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const bookW = b.width * 0.68;
    const bookH = b.height * 0.9;
    const x = cx - bookW / 2;
    const y = b.y + b.height / 2 - bookH / 2;
    s.fillRect(x - 3, y - 3, bookW + 6, bookH + 6, shadeRgb(p.paper, 0.72));
    s.fillRect(x, y, bookW, bookH, p.paper);
    s.fillRect(x, y, bookW, bookH * 0.18, p.accent);
    motifLabel(s, 'RATION BOOK', cx, y + bookH * 0.045, Math.max(1, Math.round(bookH * 0.07)), p.paper, 'stencil');
    const columns = 4;
    const rows = 4;
    const cellW = (bookW * 0.86) / columns;
    const cellH = (bookH * 0.7) / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const cellX = x + bookW * 0.07 + column * cellW;
        const cellY = y + bookH * 0.24 + row * cellH;
        s.strokeRect(cellX, cellY, cellW - 2, cellH - 2, mixRgb(p.ink, p.paper, 0.25), 1);
        if ((row + column) % 3 === 0) {
          s.line(cellX + 2, cellY + 2, cellX + cellW - 4, cellY + cellH - 4, p.ink, 1, 150);
        }
      }
    }
  },
  'grain-sack': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const width = b.width * 0.62;
    const height = b.height * 0.92;
    const baseY = b.y + b.height;
    s.polygon(
      [
        [cx - width / 2, baseY],
        [cx - width * 0.36, b.y + height * 0.24],
        [cx, b.y + height * 0.12],
        [cx + width * 0.36, b.y + height * 0.24],
        [cx + width / 2, baseY],
      ],
      p.accent,
    );
    s.fillRect(cx - width * 0.2, b.y + height * 0.06, width * 0.4, height * 0.12, shadeRgb(p.accent, 0.72));
    s.fillRect(cx - width * 0.46, b.y + height * 0.4, width * 0.92, height * 0.22, p.highlight);
    motifLabel(s, 'GRAIN', cx, b.y + height * 0.44, Math.max(1, Math.round(height * 0.1)), p.ink, 'stencil');
    s.line(cx - width * 0.42, baseY - 2, cx + width * 0.42, baseY - 2, shadeRgb(p.accent, 0.6), 2);
  },
  'steam-mug': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const cupW = b.width * 0.52;
    const cupH = b.height * 0.46;
    const top = b.y + b.height * 0.42;
    s.polygon(
      [
        [cx - cupW / 2, top],
        [cx + cupW / 2, top],
        [cx + cupW * 0.36, top + cupH],
        [cx - cupW * 0.36, top + cupH],
      ],
      p.accent,
    );
    s.fillRect(cx - cupW * 0.6, top + cupH - 3, cupW * 1.2, 4, shadeRgb(p.accent, 0.7));
    s.ring(cx + cupW * 0.56, top + cupH * 0.36, cupH * 0.26, 3, p.accent);
    s.fillRect(cx - cupW * 0.44, top + 4, cupW * 0.88, 4, p.highlight);
    for (const offset of [-0.16, 0, 0.16]) {
      wave(s, cx + cupW * offset, top - 4, b.y + b.height * 0.08, 4, mixRgb(p.ink, p.paper, 0.45), 2, 190);
    }
  },
  'victory-laurel': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const radius = Math.min(b.width, b.height) * 0.42;
    s.ring(cx, cy, radius, 2, p.secondary);
    for (let step = 0; step < 18; step += 1) {
      const angle = Math.PI * 0.25 + (step / 17) * Math.PI * 1.5;
      const [leafX, leafY] = rotate(cx, cy - radius, cx, cy, angle);
      s.disc(leafX, leafY, Math.max(2, radius * 0.11), p.secondary);
    }
    s.polygon(
      [
        [cx, cy - radius * 0.6],
        [cx + radius * 0.2, cy - radius * 0.1],
        [cx + radius * 0.62, cy - radius * 0.1],
        [cx + radius * 0.26, cy + radius * 0.2],
        [cx + radius * 0.4, cy + radius * 0.62],
        [cx, cy + radius * 0.34],
        [cx - radius * 0.4, cy + radius * 0.62],
        [cx - radius * 0.26, cy + radius * 0.2],
        [cx - radius * 0.62, cy - radius * 0.1],
        [cx - radius * 0.2, cy - radius * 0.1],
      ],
      p.accent,
    );
  },
  megaphone: ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const length = b.width * 0.66;
    const flare = b.height * 0.36;
    const left = cx - length / 2;
    const right = cx + length / 2;
    s.polygon(
      [
        [left, cy - b.height * 0.1],
        [right, cy - flare / 2],
        [right, cy + flare / 2],
        [left, cy + b.height * 0.1],
      ],
      p.accent,
    );
    s.fillRect(left - b.width * 0.14, cy - b.height * 0.11, b.width * 0.16, b.height * 0.22, shadeRgb(p.accent, 0.72));
    for (let step = 1; step <= 3; step += 1) {
      s.ring(right + step * b.width * 0.09, cy, b.width * 0.05 * step, 2, p.secondary, 190);
    }
    s.line(cx - length * 0.1, cy + flare * 0.4, cx + length * 0.16, b.y + b.height, shadeRgb(p.accent, 0.66), 4);
  },
  'milk-churn': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const bodyW = b.width * 0.46;
    const bodyH = b.height * 0.66;
    const top = b.y + b.height * 0.22;
    s.polygon(
      [
        [cx - bodyW * 0.36, top],
        [cx + bodyW * 0.36, top],
        [cx + bodyW / 2, top + bodyH],
        [cx - bodyW / 2, top + bodyH],
      ],
      p.secondary,
    );
    s.fillRect(cx - bodyW * 0.46, top - bodyH * 0.12, bodyW * 0.92, bodyH * 0.12, shadeRgb(p.secondary, 0.78));
    s.ring(cx, top + bodyH * 0.3, bodyW * 0.3, 3, p.paper);
    motifLabel(s, 'MILK', cx, top + bodyH * 0.52, Math.max(1, Math.round(bodyH * 0.12)), p.paper, 'stencil');
    s.fillRect(cx - bodyW * 0.6, top + bodyH, bodyW * 1.2, 4, shadeRgb(p.secondary, 0.62));
  },
  'searchlight-sky': ({ surface: s, box: b, palette: p, random }) => {
    const { x, y, width, height } = b;
    s.verticalGradient(x, y, width, height, shadeRgb(p.ink, 0.55), p.ink);
    s.disc(x + width * 0.78, y + height * 0.24, Math.min(width, height) * 0.09, p.highlight);
    for (const lean of [-0.5, 0.1, 0.62]) {
      s.wedge(x + width * 0.18, y + height, height * 1.5, -Math.PI / 2 + lean - 0.1, -Math.PI / 2 + lean + 0.1, p.highlight, 90);
    }
    for (let index = 0; index < 6; index += 1) {
      const buildingW = width * (0.08 + random() * 0.06);
      s.fillRect(x + index * (width / 6), y + height * (0.6 + random() * 0.18), buildingW, height * 0.4, shadeRgb(p.ink, 0.4));
    }
    s.fillRect(x, y + height - 3, width, 3, shadeRgb(p.ink, 0.3));
  },
  'tin-can': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const canW = b.width * 0.44;
    const canH = b.height * 0.72;
    const top = b.y + b.height * 0.16;
    s.fillRect(cx - canW / 2, top, canW, canH, p.secondary);
    s.disc(cx, top, canW / 2, shadeRgb(p.secondary, 0.82));
    s.fillRect(cx - canW / 2, top + canH * 0.32, canW, canH * 0.3, p.highlight);
    motifLabel(s, 'SOUP', cx, top + canH * 0.38, Math.max(1, Math.round(canH * 0.12)), p.ink, 'bold');
    for (let step = 0; step < 3; step += 1) {
      s.disc(cx + (step - 1) * canW * 0.22, top + canH * 0.78, canW * 0.06, p.accent);
    }
    s.fillRect(cx + canW * 0.28, top + 4, 3, canH - 8, shadeRgb(p.secondary, 1.4));
  },
  'soda-fountain': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const glassW = b.width * 0.4;
    const glassH = b.height * 0.52;
    const top = b.y + b.height * 0.24;
    s.polygon(
      [
        [cx - glassW / 2, top],
        [cx + glassW / 2, top],
        [cx + glassW * 0.22, top + glassH],
        [cx - glassW * 0.22, top + glassH],
      ],
      p.highlight,
    );
    s.fillRect(cx - glassW * 0.42, top + glassH * 0.3, glassW * 0.84, glassH * 0.6, p.accent, 200);
    for (let step = 0; step < 4; step += 1) {
      s.disc(cx + (step - 1.5) * glassW * 0.18, top + glassH * 0.16, glassW * 0.16, p.paper);
    }
    s.line(cx + glassW * 0.2, top - b.height * 0.14, cx + glassW * 0.34, top + glassH * 0.5, p.secondary, 4);
    for (let step = 0; step < 8; step += 1) {
      s.disc(cx + (step % 3 - 1) * glassW * 0.3, top + glassH * (0.3 + (step % 5) * 0.12), 2, p.paper);
    }
    s.fillRect(cx - glassW * 0.5, top + glassH, glassW, 5, shadeRgb(p.highlight, 0.7));
  },
  'straw-glass': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const glassW = b.width * 0.34;
    const glassH = b.height * 0.76;
    const top = b.y + b.height * 0.12;
    s.fillRect(cx - glassW / 2, top, glassW, glassH, p.paper, 210);
    s.fillRect(cx - glassW / 2 + 3, top + glassH * 0.36, glassW - 6, glassH * 0.6, p.accent, 220);
    for (let step = 0; step < 3; step += 1) {
      s.fillRect(cx - glassW * 0.34, top + glassH * (0.42 + step * 0.14), glassW * 0.28, glassH * 0.1, p.highlight);
      s.fillRect(cx + glassW * 0.06, top + glassH * (0.46 + step * 0.14), glassW * 0.28, glassH * 0.1, p.highlight);
    }
    s.line(cx + glassW * 0.16, top - glassH * 0.1, cx + glassW * 0.34, top + glassH * 1.05, p.secondary, 5);
    s.strokeRect(cx - glassW / 2, top, glassW, glassH, mixRgb(p.ink, p.paper, 0.4), 2);
    s.disc(cx, top + glassH * 0.16, glassW * 0.3, p.paper);
  },
  'cigarette-pack': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const packW = b.width * 0.62;
    const packH = b.height * 0.5;
    const x = cx - packW / 2;
    const y = b.y + b.height * 0.24;
    s.fillRect(x - 2, y - 2, packW + 4, packH + 4, shadeRgb(p.paper, 0.7));
    s.fillRect(x, y, packW, packH, p.accent);
    s.fillRect(x + packW * 0.06, y + packH * 0.16, packW * 0.88, packH * 0.34, p.paper);
    motifLabel(s, 'PLAIN LEAF', cx, y + packH * 0.2, Math.max(1, Math.round(packH * 0.09)), p.ink, 'bold');
    s.fillRect(x, y + packH * 0.62, packW, packH * 0.08, p.highlight);
    motifLabel(s, 'TWENTY', cx, y + packH * 0.72, Math.max(1, Math.round(packH * 0.1)), p.paper, 'stencil');
  },
  'smoke-curl': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const baseY = b.y + b.height * 0.86;
    s.polygon(
      [
        [cx - b.width * 0.12, baseY],
        [cx + b.width * 0.12, baseY],
        [cx + b.width * 0.2, baseY - b.height * 0.18],
        [cx - b.width * 0.2, baseY - b.height * 0.18],
      ],
      p.paper,
    );
    s.fillRect(cx - b.width * 0.2, baseY - b.height * 0.2, b.width * 0.4, b.height * 0.05, p.accent);
    for (const offset of [-0.22, 0, 0.24]) {
      wave(s, cx + b.width * offset, baseY - b.height * 0.24, b.y + b.height * 0.06, b.width * 0.07, mixRgb(p.paper, p.highlight, 0.4), 4, 200);
      wave(s, cx + b.width * offset, baseY - b.height * 0.24, b.y + b.height * 0.06, b.width * 0.07, p.paper, 2, 240);
    }
    s.glow(cx, baseY - b.height * 0.2, b.width * 0.4, p.highlight, 0.25);
  },
  locomotive: ({ surface: s, box: b, palette: p }) => {
    const { x, y, width, height } = b;
    const baseY = y + height * 0.78;
    s.polygon(
      [
        [x - width * 0.02, baseY],
        [x + width * 0.66, baseY],
        [x + width * 0.8, baseY - height * 0.2],
        [x + width * 0.98, baseY - height * 0.22],
        [x + width * 0.78, baseY - height * 0.52],
        [x + width * 0.5, baseY - height * 0.5],
        [x + width * 0.46, baseY - height * 0.34],
        [x + width * 0.08, baseY - height * 0.36],
      ],
      p.ink,
    );
    s.fillRect(x + width * 0.52, baseY - height * 0.62, width * 0.24, height * 0.16, p.ink);
    for (let step = 0; step < 3; step += 1) {
      s.disc(x + width * (0.14 + step * 0.18), baseY - height * 0.24, height * 0.1, p.accent);
      s.ring(x + width * (0.14 + step * 0.18), baseY - height * 0.24, height * 0.1, 2, p.paper);
    }
    s.fillRect(x - width * 0.04, baseY, width * 1.06, 3, p.ink);
    for (let step = 0; step < 4; step += 1) {
      s.disc(x - width * (0.06 + step * 0.08), y + height * (0.22 + step * 0.08), height * (0.06 - step * 0.01), p.paper, 210);
    }
  },
  'seaside-pier': ({ surface: s, box: b, palette: p }) => {
    const { x, y, width, height } = b;
    s.disc(x + width * 0.72, y + height * 0.24, Math.min(width, height) * 0.16, p.highlight);
    s.glow(x + width * 0.72, y + height * 0.24, Math.min(width, height) * 0.3, p.highlight, 0.4);
    for (let step = 0; step < 4; step += 1) {
      s.fillRect(x, y + height * (0.56 + step * 0.1), width, height * 0.04, step % 2 === 0 ? p.secondary : shadeRgb(p.secondary, 0.8));
    }
    s.fillRect(x + width * 0.08, y + height * 0.52, width * 0.84, height * 0.06, shadeRgb(p.ink, 1.2));
    for (let step = 0; step < 5; step += 1) {
      s.line(
        x + width * (0.14 + step * 0.18),
        y + height * 0.58,
        x + width * (0.14 + step * 0.18),
        y + height * 0.88,
        shadeRgb(p.ink, 1.1),
        3,
      );
    }
    s.fillRect(x + width * 0.04, y + height * 0.44, width * 0.92, height * 0.1, p.accent);
  },
  aeroplane: ({ surface: s, box: b, palette: p }) => {
    const { x, y, width, height } = b;
    const cy = y + height * 0.46;
    s.polygon(
      [
        [x + width * 0.04, cy],
        [x + width * 0.3, cy - height * 0.05],
        [x + width * 0.96, cy - height * 0.04],
        [x + width * 0.96, cy + height * 0.04],
        [x + width * 0.3, cy + height * 0.05],
      ],
      p.ink,
    );
    s.polygon(
      [
        [x + width * 0.42, cy],
        [x + width * 0.62, cy - height * 0.3],
        [x + width * 0.76, cy - height * 0.3],
        [x + width * 0.62, cy],
      ],
      shadeRgb(p.ink, 1.3),
    );
    s.polygon(
      [
        [x + width * 0.42, cy],
        [x + width * 0.56, cy + height * 0.24],
        [x + width * 0.66, cy + height * 0.24],
        [x + width * 0.62, cy],
      ],
      shadeRgb(p.ink, 1.15),
    );
    for (let step = 0; step < 6; step += 1) {
      s.disc(x + width * (0.36 + step * 0.08), cy - height * 0.01, 2, p.paper);
    }
    for (let step = 0; step < 3; step += 1) {
      s.fillRect(x - width * (0.02 + step * 0.06), cy + height * (0.14 + step * 0.05), width * 0.2, 2, p.paper, 190);
    }
  },
  jukebox: ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const bodyW = b.width * 0.56;
    const bodyH = b.height * 0.8;
    const top = b.y + b.height * 0.14;
    s.polygon(
      [
        [cx - bodyW / 2, top + bodyH],
        [cx - bodyW / 2, top + bodyH * 0.32],
        [cx - bodyW * 0.3, top],
        [cx + bodyW * 0.3, top],
        [cx + bodyW / 2, top + bodyH * 0.32],
        [cx + bodyW / 2, top + bodyH],
      ],
      p.secondary,
    );
    s.wedge(cx, top + bodyH * 0.3, bodyW * 0.42, Math.PI, Math.PI * 2, p.highlight, 220);
    s.disc(cx, top + bodyH * 0.62, bodyW * 0.14, p.ink);
    s.ring(cx, top + bodyH * 0.62, bodyW * 0.14, 2, p.highlight);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        s.disc(
          cx - bodyW * 0.22 + column * bodyW * 0.22,
          top + bodyH * (0.34 + row * 0.09),
          2,
          p.paper,
        );
      }
    }
    s.glow(cx, top + bodyH * 0.3, bodyW * 0.6, p.highlight, 0.35);
  },
  'neon-chevron': ({ surface: s, box: b, palette: p, year }) => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const span = b.width * 0.78;
    const strength = year === '1985' ? 0.55 : 0.3;
    for (let step = 2; step >= 0; step -= 1) {
      const inset = step * b.height * 0.16;
      const half = span / 2 - step * b.width * 0.06;
      const thickness = 5 + step;
      s.glow(cx, cy - inset * 0.4, half, p.accent, strength);
      s.line(cx - half, cy - b.height * 0.24 + inset * 0.4, cx, cy + b.height * 0.16 - inset * 0.3, p.accent, thickness, 235);
      s.line(cx + half, cy - b.height * 0.24 + inset * 0.4, cx, cy + b.height * 0.16 - inset * 0.3, p.accent, thickness, 235);
    }
    s.glow(cx, cy, span * 0.5, p.secondary, strength * 0.7);
  },
  'cassette-tape': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const caseW = b.width * 0.76;
    const caseH = b.height * 0.46;
    const x = cx - caseW / 2;
    const y = b.y + b.height * 0.3;
    s.fillRect(x - 2, y - 2, caseW + 4, caseH + 4, shadeRgb(p.paper, 0.65));
    s.fillRect(x, y, caseW, caseH, p.ink);
    s.fillRect(x + caseW * 0.08, y + caseH * 0.18, caseW * 0.84, caseH * 0.4, p.paper, 230);
    for (const offset of [-0.2, 0.2]) {
      s.disc(cx + caseW * offset, y + caseH * 0.38, caseH * 0.16, p.accent);
      s.ring(cx + caseW * offset, y + caseH * 0.38, caseH * 0.16, 2, p.ink);
    }
    s.fillRect(x + caseW * 0.08, y + caseH * 0.7, caseW * 0.84, caseH * 0.2, p.secondary);
    motifLabel(s, 'CHROME 90', cx, y + caseH * 0.73, Math.max(1, Math.round(caseH * 0.14)), p.ink, 'stencil');
  },
  'film-reel': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const radius = Math.min(b.width, b.height) * 0.44;
    s.disc(cx, cy, radius, p.ink);
    s.ring(cx, cy, radius, 3, p.paper);
    for (let step = 0; step < 8; step += 1) {
      const angle = (step / 8) * Math.PI * 2;
      const [holeX, holeY] = rotate(cx, cy - radius * 0.66, cx, cy, angle);
      s.disc(holeX, holeY, radius * 0.14, p.paper);
    }
    s.disc(cx, cy, radius * 0.2, p.accent);
    s.ring(cx, cy, radius * 0.2, 2, p.paper);
    s.disc(cx, cy, radius * 0.08, p.ink);
  },
  'star-premiere': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const radius = Math.min(b.width, b.height) * 0.46;
    for (let step = 0; step < 12; step += 1) {
      const angle = (step / 12) * Math.PI * 2;
      s.wedge(cx, cy, radius * 1.2, angle, angle + 0.16, p.highlight, 150);
    }
    const points: [number, number][] = [];
    for (let step = 0; step < 10; step += 1) {
      const angle = -Math.PI / 2 + (step / 10) * Math.PI * 2;
      const reach = step % 2 === 0 ? radius : radius * 0.44;
      points.push([cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach]);
    }
    s.polygon(points, p.accent);
    s.glow(cx, cy, radius * 1.4, p.accent, 0.4);
    for (let step = 0; step < 10; step += 1) {
      const angle = (step / 10) * Math.PI * 2 + 0.3;
      s.disc(cx + Math.cos(angle) * radius * 1.35, cy + Math.sin(angle) * radius * 1.3, 2, p.paper);
    }
  },
  'vhs-tape': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const caseW = b.width * 0.78;
    const caseH = b.height * 0.42;
    const x = cx - caseW / 2;
    const y = b.y + b.height * 0.32;
    s.fillRect(x, y, caseW, caseH, p.ink);
    s.strokeRect(x, y, caseW, caseH, shadeRgb(p.ink, 1.6), 2);
    s.fillRect(x + caseW * 0.06, y + caseH * 0.12, caseW * 0.46, caseH * 0.5, p.paper);
    for (const offset of [0.64, 0.82]) {
      s.disc(x + caseW * offset, y + caseH * 0.4, caseH * 0.14, p.accent);
      s.ring(x + caseW * offset, y + caseH * 0.4, caseH * 0.14, 2, p.paper);
    }
    motifLabel(s, 'SP 120', x + caseW * 0.29, y + caseH * 0.16, Math.max(1, Math.round(caseH * 0.16)), p.ink, 'stencil');
    s.fillRect(x + caseW * 0.06, y + caseH * 0.72, caseW * 0.88, caseH * 0.16, p.secondary);
  },
  'pixel-grid': ({ surface: s, box: b, palette: p }) => {
    const pattern = [
      '############',
      '#..........#',
      '#..........#',
      '#..#....#..#',
      '#.###..###.#',
      '#..######..#',
      '#...####...#',
      '#....##....#',
      '#..........#',
      '#..........#',
      '############',
    ];
    const cell = Math.min(b.width / 12, b.height / pattern.length) * 0.92;
    const originX = b.x + b.width / 2 - (cell * 12) / 2;
    const originY = b.y + b.height / 2 - (cell * pattern.length) / 2;
    pattern.forEach((row, rowIndex) => {
      row.split('').forEach((cellValue, columnIndex) => {
        const filled = cellValue === '#';
        s.fillRect(
          originX + columnIndex * cell,
          originY + rowIndex * cell,
          cell - 1,
          cell - 1,
          filled ? p.accent : shadeRgb(p.ink, 1.2),
        );
      });
    });
    s.glow(b.x + b.width / 2, b.y + b.height / 2, b.width * 0.5, p.accent, 0.3);
  },
  'clock-tower': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const towerW = b.width * 0.34;
    const baseY = b.y + b.height * 0.94;
    const towerTop = b.y + b.height * 0.3;
    s.fillRect(cx - towerW / 2, towerTop, towerW, baseY - towerTop, p.ink);
    s.polygon(
      [
        [cx - towerW * 0.7, towerTop],
        [cx, towerTop - b.height * 0.2],
        [cx + towerW * 0.7, towerTop],
      ],
      p.accent,
    );
    s.disc(cx, towerTop + b.height * 0.14, towerW * 0.34, p.paper);
    s.ring(cx, towerTop + b.height * 0.14, towerW * 0.34, 2, p.ink);
    s.line(cx, towerTop + b.height * 0.14, cx, towerTop + b.height * 0.04, p.ink, 2);
    s.line(cx, towerTop + b.height * 0.14, cx + towerW * 0.18, towerTop + b.height * 0.18, p.ink, 2);
    for (let step = 0; step < 3; step += 1) {
      s.fillRect(cx - towerW * 0.16, towerTop + b.height * (0.32 + step * 0.16), towerW * 0.32, b.height * 0.06, p.secondary, 220);
    }
    s.glow(cx, towerTop + b.height * 0.14, towerW * 0.8, p.highlight, 0.25);
  },
  'sprocket-strip': ({ surface: s, box: b, palette: p }) => {
    const stripW = Math.min(b.width * 0.5, b.height * 0.34);
    const x = b.x + b.width / 2 - stripW / 2;
    s.fillRect(x, b.y, stripW, b.height, p.ink);
    for (let step = 0; step < 9; step += 1) {
      const y = b.y + (step / 9) * b.height + 3;
      s.fillRect(x + stripW * 0.14, y, stripW * 0.14, 5, p.paper);
      s.fillRect(x + stripW * 0.72, y, stripW * 0.14, 5, p.paper);
    }
    for (let step = 0; step < 3; step += 1) {
      const y = b.y + b.height * (0.08 + step * 0.31);
      s.fillRect(x + stripW * 0.34, y, stripW * 0.32, b.height * 0.24, step === 1 ? p.accent : p.secondary);
    }
  },
  'film-strip': ({ surface: s, box: b, palette: p }) => {
    const stripH = Math.min(b.height * 0.68, b.width * 0.34);
    const y = b.y + b.height / 2 - stripH / 2;
    s.fillRect(b.x, y, b.width, stripH, p.ink);
    for (let step = 0; step < 6; step += 1) {
      const frameX = b.x + (step / 6) * b.width + 4;
      s.fillRect(frameX, y + stripH * 0.2, b.width / 6 - 8, stripH * 0.6, step === 2 ? p.accent : p.secondary);
    }
    for (let step = 0; step < 12; step += 1) {
      const holeX = b.x + (step / 12) * b.width + 3;
      s.fillRect(holeX, y + 3, 5, 4, p.paper);
      s.fillRect(holeX, y + stripH - 7, 5, 4, p.paper);
    }
    s.glow(b.x + b.width * 0.42, y + stripH / 2, b.width * 0.3, p.highlight, 0.25);
  },
  'projector-beam': ({ surface: s, box: b, palette: p, random }) => {
    const { x, y, width, height } = b;
    const cy = y + height / 2;
    s.fillRect(x, cy - height * 0.16, width * 0.18, height * 0.32, p.ink);
    s.disc(x + width * 0.2, cy, height * 0.13, p.secondary);
    s.ring(x + width * 0.2, cy, height * 0.13, 2, p.ink);
    s.wedge(x + width * 0.22, cy, width * 0.78, -0.36, 0.36, p.paper, 130);
    for (let step = 0; step < 14; step += 1) {
      s.disc(x + width * (0.3 + random() * 0.66), cy + (random() - 0.5) * height * 0.5, 1.5, p.paper, 220);
    }
    s.fillRect(x, cy + height * 0.16, width * 0.2, height * 0.04, p.ink);
  },
  'signal-bars': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const baseY = b.y + b.height * 0.82;
    for (let step = 0; step < 5; step += 1) {
      const barH = b.height * (0.14 + step * 0.14);
      const barW = b.width * 0.13;
      const barX = cx - b.width * 0.4 + step * barW * 1.14;
      s.fillRect(barX, baseY - barH, barW, barH, step < 4 ? p.secondary : p.accent);
    }
    for (let step = 1; step <= 3; step += 1) {
      s.ring(cx, baseY - b.height * 0.1, b.width * 0.1 * step, 2, p.accent, 190);
    }
    s.fillRect(b.x, baseY, b.width, 3, p.ink);
  },
  'router-lights': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const bodyW = b.width * 0.72;
    const bodyH = b.height * 0.26;
    const x = cx - bodyW / 2;
    const y = b.y + b.height * 0.56;
    s.fillRect(x, y, bodyW, bodyH, p.ink);
    s.strokeRect(x, y, bodyW, bodyH, shadeRgb(p.ink, 1.7), 2);
    for (let step = 0; step < 6; step += 1) {
      s.disc(x + bodyW * (0.12 + step * 0.15), y + bodyH * 0.6, bodyH * 0.14, step < 4 ? p.accent : p.secondary);
    }
    s.line(x + bodyW * 0.3, y, x + bodyW * 0.2, y - b.height * 0.3, p.ink, 3);
    s.line(x + bodyW * 0.7, y, x + bodyW * 0.8, y - b.height * 0.3, p.ink, 3);
    for (let step = 1; step <= 3; step += 1) {
      s.ring(x + bodyW * 0.5, y - b.height * 0.3, b.width * 0.08 * step, 2, p.secondary, 170);
    }
  },
  'browser-window': ({ surface: s, box: b, palette: p }) => {
    const { x, y, width, height } = b;
    s.fillRect(x, y, width, height, p.paper);
    s.strokeRect(x, y, width, height, p.ink, 2);
    s.fillRect(x, y, width, height * 0.14, p.secondary);
    for (let step = 0; step < 3; step += 1) {
      s.disc(x + width * (0.05 + step * 0.05), y + height * 0.07, height * 0.02, p.paper);
    }
    s.fillRect(x + width * 0.18, y + height * 0.17, width * 0.74, height * 0.1, shadeRgb(p.paper, 0.9));
    s.fillRect(x + width * 0.2, y + height * 0.2, width * 0.5, height * 0.03, p.ink);
    for (let step = 0; step < 4; step += 1) {
      s.fillRect(x + width * 0.08, y + height * (0.36 + step * 0.13), width * (0.6 - step * 0.08), height * 0.05, p.ink, 200);
    }
    s.polygon(
      [
        [x + width * 0.64, y + height * 0.5],
        [x + width * 0.86, y + height * 0.58],
        [x + width * 0.72, y + height * 0.62],
        [x + width * 0.76, y + height * 0.82],
        [x + width * 0.68, y + height * 0.84],
        [x + width * 0.64, y + height * 0.63],
        [x + width * 0.56, y + height * 0.7],
      ],
      p.accent,
    );
  },
  'envelope-pixel': ({ surface: s, box: b, palette: p }) => {
    const { x, y, width, height } = b;
    const envW = width * 0.66;
    const envH = height * 0.46;
    const left = x + width / 2 - envW / 2;
    const top = y + height / 2 - envH / 2;
    s.fillRect(left, top, envW, envH, p.paper);
    s.strokeRect(left, top, envW, envH, p.ink, 2);
    s.line(left, top, left + envW / 2, top + envH * 0.6, p.ink, 2);
    s.line(left + envW, top, left + envW / 2, top + envH * 0.6, p.ink, 2);
    s.fillRect(left + envW * 0.62, top + envH * 0.12, envW * 0.3, envH * 0.24, p.accent);
    motifLabel(s, 'AT', left + envW * 0.77, top + envH * 0.16, Math.max(1, Math.round(envH * 0.16)), p.paper, 'bold');
    for (let step = 0; step < 3; step += 1) {
      s.line(left + envW * (0.12 + step * 0.14), top + envH * 0.82, left + envW * 0.34, top + envH * 0.82, p.ink, 2, 190);
    }
  },
  'ticket-stub': ({ surface: s, box: b, palette: p }) => {
    const { x, y, width, height } = b;
    const stubW = width * 0.86;
    const stubH = height * 0.4;
    const left = x + width / 2 - stubW / 2;
    const top = y + height / 2 - stubH / 2;
    s.fillRect(left, top, stubW, stubH, p.paper);
    s.strokeRect(left, top, stubW, stubH, p.ink, 2);
    const tearX = left + stubW * 0.68;
    for (let step = 0; step < stubH; step += 6) {
      s.fillRect(tearX, top + step, 2, 3, p.ink);
    }
    motifLabel(s, 'ADMIT ONE', left + stubW * 0.32, top + stubH * 0.28, Math.max(1, Math.round(stubH * 0.18)), p.ink, 'stencil');
    motifLabel(s, '11', tearX + (stubW * 0.32) / 2, top + stubH * 0.28, Math.max(1, Math.round(stubH * 0.26)), p.accent, 'bold');
    s.fillRect(left, top + stubH * 0.72, stubW, stubH * 0.18, p.secondary);
  },
  'handset-grid': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const bodyW = b.width * 0.36;
    const bodyH = b.height * 0.78;
    const x = cx - bodyW / 2;
    const y = b.y + b.height * 0.14;
    s.polygon(
      [
        [x + bodyW * 0.1, y],
        [x + bodyW * 0.9, y],
        [x + bodyW, y + bodyH * 0.08],
        [x + bodyW, y + bodyH],
        [x, y + bodyH],
        [x, y + bodyH * 0.08],
      ],
      p.ink,
    );
    s.fillRect(x + bodyW * 0.14, y + bodyH * 0.1, bodyW * 0.72, bodyH * 0.26, p.paper);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        s.disc(
          x + bodyW * (0.26 + column * 0.24),
          y + bodyH * (0.48 + row * 0.12),
          2.5,
          p.paper,
        );
      }
    }
    s.line(cx, y, cx + bodyW * 0.3, b.y + b.height * 0.02, p.ink, 3);
  },
  'hand-heart': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height * 0.44;
    const size = Math.min(b.width, b.height) * 0.36;
    const points: [number, number][] = [];
    for (let step = 0; step <= 40; step += 1) {
      const t = (step / 40) * Math.PI * 2;
      const hx = 16 * Math.sin(t) ** 3;
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      points.push([cx + (hx / 16) * size, cy - (hy / 16) * size]);
    }
    s.polygon(points, p.accent);
    s.ring(cx, b.y + b.height * 0.86, size * 0.9, size * 0.28, p.secondary, 220);
    s.glow(cx, cy, size * 1.4, p.highlight, 0.3);
  },
  'qr-code': ({ surface: s, box: b, palette: p, random }) => {
    const modules = 15;
    const cell = Math.min(b.width, b.height) / (modules + 2);
    const originX = b.x + b.width / 2 - (cell * modules) / 2;
    const originY = b.y + b.height / 2 - (cell * modules) / 2;
    s.fillRect(originX - cell / 2, originY - cell / 2, cell * (modules + 1), cell * (modules + 1), p.paper);
    const inFinder = (column: number, row: number): boolean =>
      (column < 5 && row < 5) || (column > modules - 6 && row < 5) || (column < 5 && row > modules - 6);
    for (let row = 0; row < modules; row += 1) {
      for (let column = 0; column < modules; column += 1) {
        if (inFinder(column, row)) continue;
        if (random() > 0.52) {
          s.fillRect(originX + column * cell, originY + row * cell, cell * 0.92, cell * 0.92, p.ink);
        }
      }
    }
    for (const [cornerX, cornerY] of [
      [0, 0],
      [modules - 5, 0],
      [0, modules - 5],
    ] as const) {
      const x = originX + cornerX * cell;
      const y = originY + cornerY * cell;
      s.fillRect(x, y, cell * 5, cell * 5, p.ink);
      s.fillRect(x + cell, y + cell, cell * 3, cell * 3, p.paper);
      s.fillRect(x + cell * 2, y + cell * 2, cell, cell, p.ink);
    }
  },
  'leaf-cycle': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const radius = Math.min(b.width, b.height) * 0.34;
    s.polygon(
      [
        [cx, cy - radius],
        [cx + radius * 0.7, cy],
        [cx, cy + radius * 0.9],
        [cx - radius * 0.7, cy],
      ],
      p.secondary,
    );
    s.line(cx, cy - radius * 0.9, cx, cy + radius * 0.8, p.paper, 2, 220);
    for (let step = 0; step < 4; step += 1) {
      const y = cy - radius * 0.5 + step * radius * 0.4;
      s.line(cx, y, cx + radius * 0.42, y - radius * 0.22, p.paper, 1, 200);
      s.line(cx, y, cx - radius * 0.42, y - radius * 0.22, p.paper, 1, 200);
    }
    s.ring(cx, cy, radius * 1.25, 3, p.accent, 230);
    s.polygon(arrowHead(cx + radius * 1.25, cy - radius * 0.1, radius * 0.22, Math.PI / 2), p.accent);
  },
  'recycle-loop': ({ surface: s, box: b, palette: p }) => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const radius = Math.min(b.width, b.height) * 0.3;
    for (let step = 0; step < 3; step += 1) {
      const start = -Math.PI / 2 + step * ((Math.PI * 2) / 3);
      const end = start + ((Math.PI * 2) / 3) * 0.72;
      const steps = 14;
      let previous: readonly [number, number] = [cx + Math.cos(start) * radius, cy + Math.sin(start) * radius];
      for (let index = 1; index <= steps; index += 1) {
        const angle = start + ((end - start) * index) / steps;
        const point: readonly [number, number] = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
        s.line(previous[0], previous[1], point[0], point[1], p.accent, 5);
        previous = point;
      }
      s.polygon(arrowHead(previous[0], previous[1], radius * 0.34, end + Math.PI / 2), p.accent);
    }
    s.disc(cx, cy, radius * 0.42, p.secondary);
  },
  'geometric-print': ({ surface: s, box: b, palette: p }) => {
    const { x, y, width, height } = b;
    s.fillRect(x + width * 0.08, y + height * 0.14, width * 0.44, height * 0.46, p.secondary);
    s.wedge(x + width * 0.66, y + height * 0.34, Math.min(width, height) * 0.26, Math.PI * 0.5, Math.PI * 1.5, p.accent);
    s.disc(x + width * 0.36, y + height * 0.74, Math.min(width, height) * 0.17, p.ink, 230);
    s.polygon(
      [
        [x + width * 0.58, y + height * 0.92],
        [x + width * 0.78, y + height * 0.56],
        [x + width * 0.96, y + height * 0.92],
      ],
      p.highlight,
    );
    s.ring(x + width * 0.36, y + height * 0.74, Math.min(width, height) * 0.24, 2, p.accent, 200);
  },
  'riso-cup': ({ surface: s, box: b, palette: p, random }) => {
    const cx = b.x + b.width / 2;
    const cupW = b.width * 0.56;
    const cupH = b.height * 0.5;
    const top = b.y + b.height * 0.3;
    const shape: readonly (readonly [number, number])[] = [
      [cx - cupW / 2, top],
      [cx + cupW / 2, top],
      [cx + cupW * 0.34, top + cupH],
      [cx - cupW * 0.34, top + cupH],
    ];
    s.polygon(shape, p.secondary);
    const shift = 4;
    s.polygon(shape.map(([px, py]) => [px + shift, py + shift] as const), p.accent, 235);
    s.ring(cx + cupW * 0.62 + shift, top + cupH * 0.36 + shift, cupH * 0.22, 5, p.accent, 220);
    s.fillRect(cx - cupW * 0.58, top + cupH + 2, cupW * 1.16, 5, p.secondary, 230);
    for (let step = 0; step < 26; step += 1) {
      s.disc(b.x + random() * b.width, b.y + random() * b.height, 1 + random() * 1.6, p.ink, 90);
    }
  },
  bicycle: ({ surface: s, box: b, palette: p }) => {
    const { x, y, width, height } = b;
    const wheelRadius = Math.min(width * 0.2, height * 0.24);
    const baseY = y + height * 0.74;
    const rearX = x + width * 0.24;
    const frontX = x + width * 0.76;
    for (const wheelX of [rearX, frontX]) {
      s.ring(wheelX, baseY, wheelRadius, 4, p.ink);
      s.ring(wheelX, baseY, wheelRadius * 0.16, 4, p.ink);
      for (let step = 0; step < 6; step += 1) {
        const angle = (step / 6) * Math.PI * 2;
        s.line(wheelX, baseY, wheelX + Math.cos(angle) * wheelRadius, baseY + Math.sin(angle) * wheelRadius, p.secondary, 1);
      }
    }
    s.line(rearX, baseY, x + width * 0.5, y + height * 0.44, p.accent, 4);
    s.line(x + width * 0.5, y + height * 0.44, frontX, baseY, p.accent, 4);
    s.line(rearX, baseY, x + width * 0.42, baseY, p.accent, 4);
    s.line(x + width * 0.42, baseY, x + width * 0.5, y + height * 0.44, p.accent, 4);
    s.line(x + width * 0.5, y + height * 0.44, x + width * 0.44, y + height * 0.34, p.accent, 4);
    s.line(x + width * 0.44, y + height * 0.34, x + width * 0.52, y + height * 0.34, p.ink, 5);
    s.line(frontX, baseY, x + width * 0.66, y + height * 0.34, p.accent, 4);
    s.line(x + width * 0.6, y + height * 0.3, x + width * 0.72, y + height * 0.3, p.ink, 4);
  },
});

/** What a layout composes, and the ink it composes with. */
export interface LayoutContext {
  readonly surface: PosterSurface;
  readonly request: PosterFaceRequest;
  readonly palette: ResolvedPalette;
  readonly random: () => number;
}

/** Composes one poster face inside the surface. */
export type LayoutPainter = (context: LayoutContext) => void;

/** Paints the requested motif into a box. */
function motifInto(context: LayoutContext, box: LayoutBox): void {
  MOTIF_PAINTERS[context.request.motif]({
    surface: context.surface,
    box,
    palette: context.palette,
    random: context.random,
    year: context.request.year,
  });
}

/** Paper tooth: grain plus a little storage mottling. */
function paperTooth(surface: PosterSurface, palette: ResolvedPalette, random: () => number, amount = 0.05): void {
  surface.grain(random, amount);
  surface.stains(random, 2, mixRgb(palette.paper, { r: 118, g: 96, b: 64 }, 0.5), 0.05);
}

/** Horizontal rule block; returns the height it consumed. */
function rule(
  surface: PosterSurface,
  x: number,
  y: number,
  width: number,
  color: Rgb,
  thickness: number,
  style: PosterTypography['ruleStyle'],
): number {
  const weight = Math.max(Math.trunc(thickness), 1);
  if (style === 'none') return 0;
  if (style === 'double') {
    surface.fillRect(x, y, width, weight, color);
    surface.fillRect(x, y + weight * 3, width, weight, color);
    return weight * 4;
  }
  const height = style === 'thick' ? weight * 3 : weight;
  surface.fillRect(x, y, width, height, color);
  return height;
}

/** Letterpress crop marks, the way a printed sheet is trimmed. */
function registerMarks(surface: PosterSurface, palette: ResolvedPalette): void {
  const margin = Math.round(Math.min(surface.width, surface.height) * 0.035);
  const size = Math.max(3, Math.round(margin * 0.6));
  const color = mixRgb(palette.ink, palette.paper, 0.55);
  const corners: readonly (readonly [number, number])[] = [
    [margin, margin],
    [surface.width - margin, margin],
    [margin, surface.height - margin],
    [surface.width - margin, surface.height - margin],
  ];
  for (const [cx, cy] of corners) {
    surface.fillRect(cx - size, cy, size * 2, 1, color);
    surface.fillRect(cx, cy - size, 1, size * 2, color);
  }
}

/** Roundel / price tag badge. */
function roundel(
  surface: PosterSurface,
  cx: number,
  cy: number,
  radius: number,
  text: string,
  palette: ResolvedPalette,
): void {
  surface.disc(cx, cy, radius, palette.badge);
  surface.ring(cx, cy, radius, Math.max(2, Math.round(radius * 0.12)), palette.paper, 220);
  const scale = fitTextScale(text, radius * 1.5, Math.max(2, Math.round(radius * 0.5)), { style: 'display', tracking: 1 });
  drawPosterText(surface, text, cx, cy - (FONT_GLYPH_HEIGHT * scale) / 2, {
    scale,
    color: palette.ink,
    style: 'display',
    align: 'center',
    maxWidth: radius * 1.6,
  });
}

/** Headline size that fits `maxWidth`, with the height it will occupy. */
function headlineFit(
  context: LayoutContext,
  text: string,
  maxWidth: number,
  baseScale: number,
): { scale: number; height: number } {
  const typography = context.request.typography;
  const scale = fitTextScale(text, maxWidth, baseScale, {
    style: typography.display,
    tracking: typography.displayTracking,
  });
  return { scale, height: FONT_GLYPH_HEIGHT * scale };
}

/** Body copy size that fits `maxWidth`, with the height of the whole block. */
function bodyFit(
  context: LayoutContext,
  lines: readonly string[],
  maxWidth: number,
  baseScale: number,
): { scale: number; height: number } {
  const typography = context.request.typography;
  let scale = Math.max(Math.trunc(baseScale), 1);
  for (const line of lines) {
    scale = Math.min(
      scale,
      fitTextScale(line, maxWidth, baseScale, {
        style: typography.body,
        tracking: typography.bodyTracking,
      }),
    );
  }
  return { scale, height: textBlockHeight(lines.length, scale) };
}

/** Every poster composition this module can paint. */
export const LAYOUT_PAINTERS: Readonly<Record<PosterLayoutId, LayoutPainter>> = Object.freeze({
  /* 1945 — a letterpress civic notice: double rule, masthead, notice body. */
  'letterpress-notice': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.07);
    registerMarks(s, p);
    const m = Math.round(Math.min(w, h) * 0.08);
    s.strokeRect(m, m, w - m * 2, h - m * 2, p.ink, 2);
    s.strokeRect(m + 5, m + 5, w - (m + 5) * 2, h - (m + 5) * 2, p.ink, 1);
    const inner: LayoutBox = { x: m + 12, y: m + 12, width: w - (m + 12) * 2, height: h - (m + 12) * 2 };
    const center = inner.x + inner.width / 2;
    let y = inner.y + 2;
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, inner.width, Math.round(h / 24));
    drawPosterText(s, q.headline, center, y, {
      scale: head.scale,
      color: p.ink,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
    });
    y += head.height + Math.round(h * 0.015);
    if (q.subhead) {
      const sub = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], inner.width, q.typography.bodyScale);
      drawPosterText(s, q.subhead, center, y, {
        scale: sub.scale,
        color: p.accent,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += sub.height;
    }
    y += Math.round(h * 0.02);
    y += rule(s, inner.x, y, inner.width, p.ink, 1, q.typography.ruleStyle);
    y += Math.round(h * 0.03);
    const motifHeight = Math.round(inner.height * 0.34);
    motifInto({ surface: s, request: q, palette: p, random }, { x: inner.x, y, width: inner.width, height: motifHeight });
    y += motifHeight + Math.round(h * 0.035);
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, inner.width, q.typography.bodyScale);
    const bodyY = Math.min(y, inner.y + inner.height - body.height - Math.round(h * 0.09));
    drawTextBlock(s, q.body, {
      x: center,
      y: bodyY,
      scale: body.scale,
      color: p.ink,
      style: q.typography.body,
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.footer) {
      drawPosterText(s, q.footer, center, inner.y + inner.height - Math.round(h * 0.055), {
        scale: Math.max(1, body.scale - 1),
        color: p.secondary,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: inner.width,
      });
    }
    if (q.badge) {
      const badgeW = Math.round(inner.width * 0.44);
      const badgeH = Math.round(h * 0.07);
      const badgeX = inner.x + inner.width - badgeW;
      const badgeY = inner.y + inner.height - badgeH - 2;
      s.strokeRect(badgeX, badgeY, badgeW, badgeH, p.accent, 2);
      drawPosterText(s, q.badge, badgeX + badgeW / 2, badgeY + Math.round(badgeH * 0.2), {
        scale: Math.max(1, Math.round(badgeH * 0.5)),
        color: p.accent,
        style: 'stencil',
        tracking: 1,
        align: 'center',
        maxWidth: badgeW - 6,
      });
    }
  },

  /* 1945 — a rationing block: inverted band, coupon artwork, points roundel. */
  'ration-block': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.08);
    const bandHeight = Math.round(h * 0.19);
    s.fillRect(0, 0, w, bandHeight, p.accent);
    s.fillRect(0, bandHeight, w, 3, p.ink);
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 16, Math.round(bandHeight / 11));
    drawPosterText(s, q.headline, w / 2, Math.round(bandHeight * 0.18), {
      scale: head.scale,
      color: p.paper,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
    });
    let y = bandHeight + Math.round(h * 0.05);
    if (q.subhead) {
      const sub = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], w - 24, q.typography.bodyScale);
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.ink,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += sub.height + Math.round(h * 0.02);
    }
    const motifHeight = Math.round(h * 0.3);
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.12, y, width: w * 0.76, height: motifHeight });
    y += motifHeight + Math.round(h * 0.03);
    rule(s, w * 0.1, y, w * 0.8, p.ink, 1, q.typography.ruleStyle);
    y += Math.round(h * 0.03);
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, w - 28, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: w / 2,
      y,
      scale: body.scale,
      color: p.ink,
      style: q.typography.body,
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.badge) {
      roundel(s, w - Math.round(w * 0.19), h - Math.round(h * 0.14), Math.round(Math.min(w, h) * 0.11), q.badge, p);
    }
    if (q.footer) {
      drawPosterText(s, q.footer, Math.round(w * 0.06), h - Math.round(h * 0.06), {
        scale: Math.max(1, body.scale - 1),
        color: p.secondary,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        maxWidth: w * 0.6,
      });
    }
  },

  /* 1965 — a soda billboard: colour band, wavy rule, frosted-glass artwork. */
  'billboard-stack': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.04);
    const bandHeight = Math.round(h * 0.26);
    s.verticalGradient(0, 0, w, bandHeight, p.accent, mixRgb(p.accent, p.highlight, 0.45));
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 12, Math.round(bandHeight / 8));
    drawPosterText(s, q.headline, w / 2, Math.round(bandHeight * 0.22), {
      scale: head.scale,
      color: p.paper,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
      outline: p.ink,
    });
    let y = bandHeight;
    for (let step = 0; step < w; step += 2) {
      const waveY = y + Math.round(Math.sin((step / w) * Math.PI * 4) * Math.round(h * 0.012));
      s.fillRect(step, waveY, 2, 3, p.secondary);
    }
    y += Math.round(h * 0.05);
    const motifHeight = Math.round(h * 0.34);
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.14, y, width: w * 0.72, height: motifHeight });
    y += motifHeight + Math.round(h * 0.035);
    if (q.subhead) {
      const sub = headlineFit({ surface: s, request: q, palette: p, random }, q.subhead, w - 20, Math.round(h / 30));
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.secondary,
        style: q.typography.display,
        tracking: q.typography.displayTracking,
        align: 'center',
      });
      y += sub.height + Math.round(h * 0.02);
    }
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, w * 0.66, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: Math.round(w * 0.07),
      y: Math.min(y, h - body.height - Math.round(h * 0.06)),
      scale: body.scale,
      color: p.ink,
      style: q.typography.body,
      tracking: q.typography.bodyTracking,
    });
    if (q.badge) {
      roundel(s, w - Math.round(w * 0.17), Math.round(h * 0.79), Math.round(Math.min(w, h) * 0.115), q.badge, p);
    }
    if (q.footer) {
      s.fillRect(0, h - Math.round(h * 0.06), w, Math.round(h * 0.06), p.ink);
      drawPosterText(s, q.footer, w / 2, h - Math.round(h * 0.045), {
        scale: Math.max(1, body.scale - 1),
        color: p.paper,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: w - 12,
      });
    }
  },

  /* 1965 — a tobacco testimonial: portrait, quote and small print. */
  testimonial: ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.04);
    s.fillRect(0, 0, w, Math.round(h * 0.08), p.ink);
    drawPosterText(s, q.title.toUpperCase(), w / 2, Math.round(h * 0.02), {
      scale: Math.max(1, Math.round(h * 0.035)),
      color: p.highlight,
      style: 'typewriter',
      tracking: 2,
      align: 'center',
      maxWidth: w - 12,
    });
    const colonnade = w * 0.4;
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.06, y: h * 0.12, width: colonnade, height: h * 0.4 });
    const textX = w * 0.5;
    const textWidth = w * 0.44;
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, textWidth, Math.round(h / 22));
    drawPosterText(s, q.headline, textX + textWidth / 2, Math.round(h * 0.14), {
      scale: head.scale,
      color: p.ink,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
    });
    let y = Math.round(h * 0.14) + head.height + Math.round(h * 0.03);
    if (q.subhead) {
      s.disc(textX - 4, y - 2, 3, p.accent);
      s.disc(textX + 4, y - 2, 3, p.accent);
      const quote = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], textWidth, q.typography.bodyScale + 1);
      drawTextBlock(s, [q.subhead], {
        x: textX + textWidth / 2,
        y,
        scale: quote.scale,
        color: p.accent,
        style: 'script',
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += quote.height + Math.round(h * 0.02);
    }
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, textWidth, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: textX + textWidth / 2,
      y,
      scale: body.scale,
      color: p.ink,
      style: q.typography.body,
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    const bandY = h - Math.round(h * 0.14);
    s.fillRect(0, bandY, w, Math.round(h * 0.1), p.secondary);
    drawPosterText(s, q.footer ?? q.title.toUpperCase(), w / 2, bandY + Math.round(h * 0.02), {
      scale: Math.max(2, Math.round(h * 0.045)),
      color: p.paper,
      style: 'display',
      tracking: 3,
      align: 'center',
      maxWidth: w - 16,
    });
    if (q.badge) {
      drawPosterText(s, q.badge, w / 2, h - Math.round(h * 0.032), {
        scale: Math.max(1, body.scale - 1),
        color: p.ink,
        style: 'typewriter',
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: w - 16,
      });
    }
  },

  /* 1965 — a travel poster: sky field, horizon, slogan band. */
  'travel-poster': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.verticalGradient(0, 0, w, h, p.highlight, p.paper);
    s.glow(w * 0.7, h * 0.22, Math.min(w, h) * 0.3, p.accent, 0.55);
    s.disc(w * 0.7, h * 0.22, Math.min(w, h) * 0.11, p.accent);
    const artworkBottom = Math.round(h * 0.62);
    motifInto({ surface: s, request: q, palette: p, random }, { x: 0, y: Math.round(h * 0.3), width: w, height: artworkBottom - Math.round(h * 0.3) });
    s.fillRect(0, artworkBottom, w, Math.round(h * 0.19), p.ink);
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 14, Math.round(h / 16));
    drawPosterText(s, q.headline, w / 2, artworkBottom + Math.round(h * 0.025), {
      scale: head.scale,
      color: p.paper,
      style: q.typography.display,
      tracking: q.typography.displayTracking + 1,
      align: 'center',
    });
    let y = artworkBottom + Math.round(h * 0.025) + head.height + Math.round(h * 0.015);
    if (q.subhead) {
      const sub = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], w - 20, q.typography.bodyScale + 1);
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.highlight,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += sub.height;
    }
    const footerY = h - Math.round(h * 0.19);
    s.fillRect(0, footerY, w, Math.round(h * 0.19), p.accent);
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, w - 20, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: w / 2,
      y: footerY + Math.round(h * 0.03),
      scale: body.scale,
      color: p.paper,
      style: q.typography.body,
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.footer) {
      drawPosterText(s, q.footer, w / 2, h - Math.round(h * 0.045), {
        scale: Math.max(1, body.scale - 1),
        color: p.paper,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: w - 16,
      });
    }
  },

  /* 1985 — a neon brand poster: dark stock, glowing outline lettering. */
  'neon-brand': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    s.verticalGradient(0, 0, w, h, shadeRgb(p.paper, 1.35), p.paper);
    paperTooth(s, p, random, 0.05);
    s.glow(w / 2, h * 0.34, Math.min(w, h) * 0.5, p.accent, 0.45);
    const motifHeight = Math.round(h * 0.34);
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.1, y: Math.round(h * 0.12), width: w * 0.8, height: motifHeight });
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 16, Math.round(h / 13));
    const headY = Math.round(h * 0.14) + motifHeight;
    drawPosterText(s, q.headline, w / 2, headY, {
      scale: head.scale,
      color: p.highlight,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
      glow: p.accent,
      outline: p.secondary,
    });
    let y = headY + head.height + Math.round(h * 0.03);
    const chromeY = y;
    for (let step = 0; step < 3; step += 1) {
      s.fillRect(Math.round(w * 0.12), chromeY + step * 3, Math.round(w * 0.76), 1, mixRgb(p.highlight, p.secondary, step / 3));
    }
    y += Math.round(h * 0.04);
    if (q.subhead) {
      const sub = headlineFit({ surface: s, request: q, palette: p, random }, q.subhead, w - 24, Math.round(h / 30));
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.secondary,
        style: q.typography.display,
        tracking: q.typography.displayTracking + 1,
        align: 'center',
        glow: p.secondary,
      });
      y += sub.height + Math.round(h * 0.02);
    }
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, w - 26, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: w / 2,
      y,
      scale: body.scale,
      color: mixRgb(p.highlight, p.paper, 0.25),
      style: 'typewriter',
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.badge) {
      const badgeW = Math.round(w * 0.5);
      s.strokeRect(w / 2 - badgeW / 2, h - Math.round(h * 0.1), badgeW, Math.round(h * 0.06), p.accent, 2);
      drawPosterText(s, q.badge, w / 2, h - Math.round(h * 0.085), {
        scale: Math.max(1, Math.round(h * 0.03)),
        color: p.accent,
        style: 'neon',
        tracking: 2,
        align: 'center',
        glow: p.accent,
        maxWidth: badgeW - 8,
      });
    }
    if (q.footer) {
      drawPosterText(s, q.footer, w / 2, h - Math.round(h * 0.035), {
        scale: Math.max(1, body.scale - 1),
        color: p.secondary,
        style: 'typewriter',
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: w - 12,
      });
    }
  },

  /* 1985 — a cinema one-sheet: starburst title card and a credit block. */
  'cinema-one-sheet': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    s.verticalGradient(0, 0, w, Math.round(h * 0.6), shadeRgb(p.paper, 1.6), p.paper);
    const motifHeight = Math.round(h * 0.42);
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.12, y: Math.round(h * 0.06), width: w * 0.76, height: motifHeight });
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 12, Math.round(h / 12));
    const headY = Math.round(h * 0.08) + motifHeight;
    drawPosterText(s, q.headline, w / 2, headY, {
      scale: head.scale,
      color: p.highlight,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
      glow: p.accent,
    });
    let y = headY + head.height + Math.round(h * 0.015);
    if (q.subhead) {
      const sub = headlineFit({ surface: s, request: q, palette: p, random }, q.subhead, w - 16, Math.round(h / 34));
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.secondary,
        style: q.typography.display,
        tracking: q.typography.displayTracking + 1,
        align: 'center',
      });
      y += sub.height + Math.round(h * 0.015);
    }
    const creditsY = h - Math.round(h * 0.24);
    s.fillRect(Math.round(w * 0.08), creditsY, Math.round(w * 0.84), 1, mixRgb(p.highlight, p.paper, 0.5));
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, w * 0.8, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: w / 2,
      y: creditsY + Math.round(h * 0.02),
      scale: body.scale,
      color: mixRgb(p.highlight, p.paper, 0.3),
      style: 'typewriter',
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.badge) {
      const size = Math.round(h * 0.075);
      s.fillRect(Math.round(w * 0.5) + size, h - Math.round(h * 0.075) - size, size, size, p.accent);
      drawPosterText(s, q.badge, Math.round(w * 0.5) + size * 1.5, h - Math.round(h * 0.075) - size + Math.round(size * 0.2), {
        scale: Math.max(1, Math.round(size * 0.5)),
        color: p.paper,
        style: 'bold',
        align: 'center',
        maxWidth: size - 4,
      });
    }
    if (q.footer) {
      drawPosterText(s, q.footer, w / 2, h - Math.round(h * 0.05), {
        scale: Math.max(1, body.scale - 1),
        color: p.secondary,
        style: 'typewriter',
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: w - 12,
      });
    }
  },

  /* 2005 — a film marquee: letterbox bands and widely tracked title type. */
  'film-marquee': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.ink);
    const bandHeight = Math.round(h * 0.1);
    s.fillRect(0, 0, w, bandHeight, shadeRgb(p.paper, 0.4));
    s.fillRect(0, h - bandHeight, w, bandHeight, shadeRgb(p.paper, 0.4));
    const motifHeight = Math.round(h * 0.26);
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.08, y: bandHeight + Math.round(h * 0.06), width: w * 0.84, height: motifHeight });
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 14, Math.round(h / 11));
    const headY = bandHeight + Math.round(h * 0.06) + motifHeight + Math.round(h * 0.04);
    drawPosterText(s, q.headline, w / 2, headY, {
      scale: head.scale,
      color: p.paper,
      style: q.typography.display,
      tracking: q.typography.displayTracking + 2,
      align: 'center',
      outline: p.accent,
    });
    let y = headY + head.height + Math.round(h * 0.03);
    if (q.subhead) {
      const sub = headlineFit({ surface: s, request: q, palette: p, random }, q.subhead, w - 18, Math.round(h / 32));
      s.fillRect(Math.round(w * 0.14), y - 2, Math.round(w * 0.72), Math.round(h * 0.035), p.accent);
      drawPosterText(s, q.subhead, w / 2, y + Math.round(h * 0.005), {
        scale: sub.scale,
        color: p.paper,
        style: 'bold',
        tracking: q.typography.displayTracking,
        align: 'center',
        maxWidth: w * 0.66,
      });
      y += Math.round(h * 0.055);
    }
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, w - 20, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: w / 2,
      y: Math.min(y, h - bandHeight - body.height - Math.round(h * 0.02)),
      scale: body.scale,
      color: shadeRgb(p.paper, 0.82),
      style: 'typewriter',
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.footer) {
      drawPosterText(s, q.footer, w / 2, h - bandHeight + Math.round(h * 0.03), {
        scale: Math.max(1, Math.round(h * 0.028)),
        color: p.secondary,
        style: 'bold',
        tracking: q.typography.displayTracking + 2,
        align: 'center',
        maxWidth: w - 12,
      });
    }
  },

  /* 2005 — a telecom tariff: signal artwork over a spec grid. */
  'telecom-grid': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.03);
    const motifHeight = Math.round(h * 0.3);
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.16, y: Math.round(h * 0.08), width: w * 0.68, height: motifHeight });
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 16, Math.round(h / 15));
    const headY = Math.round(h * 0.08) + motifHeight + Math.round(h * 0.03);
    drawPosterText(s, q.headline, w / 2, headY, {
      scale: head.scale,
      color: p.ink,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
    });
    let y = headY + head.height + Math.round(h * 0.02);
    if (q.subhead) {
      const sub = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], w - 20, q.typography.bodyScale + 1);
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.secondary,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += sub.height + Math.round(h * 0.02);
    }
    const gridTop = y + Math.round(h * 0.02);
    const cellHeight = Math.round(h * 0.075);
    const cellWidth = Math.round(w * 0.42);
    const bodyScale = Math.max(1, Math.round(q.typography.bodyScale));
    q.body.forEach((line, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const cellX = Math.round(w * 0.06) + column * (cellWidth + Math.round(w * 0.04));
      const cellY = gridTop + row * (cellHeight + Math.round(h * 0.015));
      s.fillRect(cellX, cellY, cellWidth, cellHeight, mixRgb(p.paper, p.secondary, 0.12));
      s.fillRect(cellX, cellY, 3, cellHeight, p.secondary);
      drawPosterText(s, line, cellX + 8, cellY + Math.round(cellHeight * 0.28), {
        scale: fitTextScale(line, cellWidth - 14, bodyScale, { style: q.typography.body, tracking: q.typography.bodyTracking }),
        color: p.ink,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
      });
    });
    if (q.badge) {
      s.polygon(
        [
          [0, h - Math.round(h * 0.09)],
          [w, h - Math.round(h * 0.09)],
          [w, h],
          [0, h],
        ],
        p.ink,
      );
      drawPosterText(s, q.badge, w / 2, h - Math.round(h * 0.075), {
        scale: Math.max(2, Math.round(h * 0.045)),
        color: p.highlight,
        style: 'display',
        tracking: 2,
        align: 'center',
        maxWidth: w - 16,
      });
    }
    if (q.footer) {
      drawPosterText(s, q.footer, w / 2, h - Math.round(h * 0.032), {
        scale: Math.max(1, bodyScale - 1),
        color: q.badge ? p.paper : p.secondary,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: w - 14,
      });
    }
  },

  /* 2005 — an early-web banner: window chrome, url bar and a click button. */
  'web-banner': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.03);
    s.strokeRect(1, 1, w - 2, h - 2, p.ink, 2);
    s.fillRect(0, 0, w, Math.round(h * 0.09), p.secondary);
    for (let step = 0; step < 3; step += 1) {
      s.disc(w * (0.04 + step * 0.045), h * 0.045, Math.round(h * 0.014), p.paper);
    }
    drawPosterText(s, 'CORNER-CAFE.NET', w / 2, Math.round(h * 0.025), {
      scale: Math.max(1, Math.round(h * 0.03)),
      color: p.paper,
      style: 'typewriter',
      tracking: 2,
      align: 'center',
      maxWidth: w * 0.5,
    });
    const motifHeight = Math.round(h * 0.24);
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.3, y: Math.round(h * 0.6), width: w * 0.4, height: motifHeight });
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 16, Math.round(h / 14));
    drawPosterText(s, q.headline, w / 2, Math.round(h * 0.14), {
      scale: head.scale,
      color: p.ink,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
    });
    let y = Math.round(h * 0.14) + head.height + Math.round(h * 0.02);
    if (q.subhead) {
      const sub = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], w - 20, q.typography.bodyScale);
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.secondary,
        style: 'typewriter',
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += sub.height + Math.round(h * 0.02);
    }
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, w - 24, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: w / 2,
      y,
      scale: body.scale,
      color: p.ink,
      style: q.typography.body,
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.badge) {
      const buttonW = Math.round(w * 0.46);
      const buttonH = Math.round(h * 0.07);
      const buttonX = Math.round((w - buttonW) / 2);
      const buttonY = Math.round(h * 0.51);
      s.fillRect(buttonX + 2, buttonY + 2, buttonW, buttonH, mixRgb(p.ink, p.paper, 0.6));
      s.fillRect(buttonX, buttonY, buttonW, buttonH, p.accent);
      s.strokeRect(buttonX, buttonY, buttonW, buttonH, p.ink, 2);
      drawPosterText(s, q.badge, buttonX + buttonW / 2, buttonY + Math.round(buttonH * 0.24), {
        scale: fitTextScale(q.badge, buttonW - 10, Math.max(1, Math.round(buttonH * 0.42)), { style: 'bold', tracking: 2 }),
        color: p.paper,
        style: 'bold',
        tracking: 2,
        align: 'center',
      });
    }
    if (q.footer) {
      s.fillRect(0, h - Math.round(h * 0.07), w, Math.round(h * 0.07), mixRgb(p.paper, p.ink, 0.12));
      drawPosterText(s, q.footer, w / 2, h - Math.round(h * 0.055), {
        scale: Math.max(1, Math.round(h * 0.026)),
        color: p.ink,
        style: 'typewriter',
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: w - 14,
      });
    }
  },

  /* 2025 — a social poster: generous margins and one plain statement. */
  'social-square': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.03);
    const margin = Math.round(Math.min(w, h) * 0.12);
    const innerWidth = w - margin * 2;
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, innerWidth, Math.round(h / 16));
    const headHeight = head.height * Math.min(Math.max(Math.ceil(q.headline.length / 18), 1), 2);
    let y = Math.round(h * 0.16);
    const words = q.headline.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measurePosterText(candidate, { scale: head.scale, style: q.typography.display, tracking: q.typography.displayTracking }) > innerWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    drawTextBlock(s, lines.slice(0, 4), {
      x: w / 2,
      y,
      scale: head.scale,
      color: p.ink,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
      lineHeight: Math.round(head.height * 1.15),
    });
    y += Math.max(headHeight, lines.length * Math.round(head.height * 1.15)) + Math.round(h * 0.03);
    rule(s, margin, y, innerWidth, p.ink, 1, q.typography.ruleStyle);
    y += Math.round(h * 0.05);
    const motifHeight = Math.round(h * 0.22);
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.3, y, width: w * 0.4, height: motifHeight });
    y += motifHeight + Math.round(h * 0.03);
    if (q.subhead) {
      const sub = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], innerWidth, q.typography.bodyScale + 1);
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.accent,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += sub.height + Math.round(h * 0.01);
    }
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, innerWidth, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: w / 2,
      y,
      scale: body.scale,
      color: mixRgb(p.ink, p.paper, 0.2),
      style: q.typography.body,
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.footer) {
      drawPosterText(s, q.footer, w / 2, h - margin + Math.round(h * 0.02), {
        scale: Math.max(1, body.scale - 1),
        color: p.secondary,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
        maxWidth: innerWidth,
      });
    }
    if (q.badge) {
      drawPosterText(s, q.badge, w / 2, h - Math.round(h * 0.07), {
        scale: Math.max(1, Math.round(h * 0.028)),
        color: p.accent,
        style: 'bold',
        tracking: q.typography.displayTracking + 2,
        align: 'center',
        maxWidth: innerWidth,
      });
    }
  },

  /* 2025 — a sustainability panel: split field, bulleted claims, stamp. */
  'sustainability-panel': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.04);
    const fieldHeight = Math.round(h * 0.42);
    s.fillRect(0, 0, w, fieldHeight, mixRgb(p.secondary, p.paper, 0.72));
    motifInto({ surface: s, request: q, palette: p, random }, { x: w * 0.22, y: Math.round(fieldHeight * 0.1), width: w * 0.56, height: fieldHeight * 0.8 });
    let y = fieldHeight + Math.round(h * 0.04);
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, w - 20, Math.round(h / 17));
    drawPosterText(s, q.headline, w / 2, y, {
      scale: head.scale,
      color: p.ink,
      style: q.typography.display,
      tracking: q.typography.displayTracking,
      align: 'center',
    });
    y += head.height + Math.round(h * 0.02);
    if (q.subhead) {
      const sub = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], w - 24, q.typography.bodyScale + 1);
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.accent,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += sub.height + Math.round(h * 0.025);
    }
    const bulletScale = Math.max(1, Math.min(q.typography.bodyScale, 3));
    const lineHeight = Math.round(bulletScale * (FONT_GLYPH_HEIGHT + 4));
    q.body.forEach((line, index) => {
      const lineY = y + index * lineHeight;
      s.polygon(
        [
          [w * 0.1 + bulletScale, lineY],
          [w * 0.1 + bulletScale * 2, lineY + bulletScale * 2],
          [w * 0.1, lineY + bulletScale * 1.4],
        ],
        p.secondary,
      );
      drawPosterText(s, line, w * 0.1 + bulletScale * 3, lineY, {
        scale: bulletScale,
        color: p.ink,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        maxWidth: w * 0.8,
      });
    });
    const stampRadius = Math.round(Math.min(w, h) * 0.11);
    const stampX = w - stampRadius - Math.round(w * 0.07);
    const stampY = h - stampRadius - Math.round(h * 0.05);
    s.ring(stampX, stampY, stampRadius, 2, p.secondary, 220);
    s.ring(stampX, stampY, stampRadius - 4, 1, p.secondary, 160);
    drawPosterText(s, q.badge ?? 'CERTIFIED', stampX, stampY - Math.round(stampRadius * 0.22), {
      scale: fitTextScale(q.badge ?? 'CERTIFIED', stampRadius * 1.5, Math.max(1, Math.round(stampRadius * 0.42)), { style: 'bold', tracking: 1 }),
      color: p.secondary,
      style: 'bold',
      tracking: 1,
      align: 'center',
    });
    if (q.footer) {
      drawPosterText(s, q.footer, Math.round(w * 0.08), h - Math.round(h * 0.055), {
        scale: Math.max(1, bulletScale - 1),
        color: mixRgb(p.ink, p.paper, 0.35),
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        maxWidth: w * 0.5,
      });
    }
  },

  /* 2025 — a local-art print: wide margins, artwork, artist credit. */
  'local-art-print': ({ surface: s, request: q, palette: p, random }) => {
    const { width: w, height: h } = s;
    s.fill(p.paper);
    paperTooth(s, p, random, 0.06);
    const margin = Math.round(Math.min(w, h) * 0.13);
    const innerWidth = w - margin * 2;
    const motifTop = Math.round(h * 0.16);
    const motifHeight = Math.round(h * 0.48);
    motifInto({ surface: s, request: q, palette: p, random }, { x: margin, y: motifTop, width: innerWidth, height: motifHeight });
    const titleY = motifTop + motifHeight + Math.round(h * 0.06);
    const head = headlineFit({ surface: s, request: q, palette: p, random }, q.headline, innerWidth, Math.round(h / 22));
    drawPosterText(s, q.headline, w / 2, titleY, {
      scale: head.scale,
      color: p.ink,
      style: q.typography.display,
      tracking: q.typography.displayTracking + 2,
      align: 'center',
      maxWidth: innerWidth,
    });
    let y = titleY + head.height + Math.round(h * 0.02);
    if (q.subhead) {
      const sub = bodyFit({ surface: s, request: q, palette: p, random }, [q.subhead], innerWidth, q.typography.bodyScale);
      drawPosterText(s, q.subhead, w / 2, y, {
        scale: sub.scale,
        color: p.secondary,
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        align: 'center',
      });
      y += sub.height + Math.round(h * 0.02);
    }
    rule(s, margin, y, innerWidth, p.ink, 1, q.typography.ruleStyle);
    y += Math.round(h * 0.03);
    const body = bodyFit({ surface: s, request: q, palette: p, random }, q.body, innerWidth, q.typography.bodyScale);
    drawTextBlock(s, q.body, {
      x: w / 2,
      y,
      scale: body.scale,
      color: p.ink,
      style: q.typography.body,
      tracking: q.typography.bodyTracking,
      align: 'center',
    });
    if (q.badge) {
      drawPosterText(s, q.badge, w - margin, h - Math.round(h * 0.07), {
        scale: Math.max(1, body.scale - 1),
        color: p.accent,
        style: 'typewriter',
        tracking: q.typography.bodyTracking,
        align: 'right',
        maxWidth: innerWidth / 2,
      });
    }
    if (q.footer) {
      drawPosterText(s, q.footer, margin, h - Math.round(h * 0.07), {
        scale: Math.max(1, body.scale - 1),
        color: mixRgb(p.ink, p.paper, 0.4),
        style: q.typography.body,
        tracking: q.typography.bodyTracking,
        maxWidth: innerWidth / 1.6,
      });
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Face composition                                                           */
/* -------------------------------------------------------------------------- */

/** Deterministic seed of one poster face (id + era, never the wall clock). */
export function posterFaceSeed(request: PosterFaceRequest): number {
  return (hashString(`${request.year}:${request.id}`) ^ 0x9e3779b9) >>> 0;
}

/** Which corner of a worn sheet tore away. */
export function posterTornCorner(request: PosterFaceRequest): 'tl' | 'tr' | 'bl' | 'br' {
  const corners = ['tl', 'tr', 'bl', 'br'] as const;
  return corners[hashString(`${request.id}:corner`) % corners.length] ?? 'br';
}

/** Era printing plant: ink spread, register drift, colour cast and sun fade. */
export function applyPrintDrift(
  surface: PosterSurface,
  print: PosterPrintRecipe,
  extraFade: number,
  palette: ResolvedPalette,
): void {
  const cast = parseColor(print.colourCast);
  if (print.dotGain > 0) {
    surface.boxBlur();
    surface.tint(mixRgb(palette.ink, cast, 0.6), print.dotGain * 0.16);
  }
  const shift = Math.max(Math.round(print.misregistration), 0);
  if (shift > 0) {
    surface.misregister(shift, Math.max(Math.round(shift / 2), 1), clamp01(0.3 + print.misregistration * 0.12));
  }
  const fade = clamp01(print.fade + extraFade);
  if (fade > 0) {
    surface.tint(cast, fade * 0.4, 'top');
    surface.tint(cast, fade * 0.22, 'uniform');
  }
}

/** Wall and counter wear: creases, stains, abraded edges and a torn corner. */
export function applyWear(
  surface: PosterSurface,
  wear: number,
  palette: ResolvedPalette,
  random: () => number,
  corner: 'tl' | 'tr' | 'bl' | 'br',
): void {
  const strength = clamp01(wear);
  if (strength <= 0.02) return;
  surface.grain(random, 0.03 + strength * 0.05);
  surface.creases(random, Math.round(strength * 4), 0.12 + strength * 0.2);
  surface.stains(
    random,
    Math.round(1 + strength * 3),
    mixRgb(palette.paper, { r: 96, g: 74, b: 46 }, 0.6),
    0.05 + strength * 0.15,
  );
  surface.edgeWear(random, strength, palette.paper);
  surface.vignette(mixRgb(palette.ink, palette.paper, 0.2), strength * 0.2);
  if (strength > 0.55) {
    surface.tornCorner(random, corner, Math.round(Math.min(surface.width, surface.height) * (0.05 + strength * 0.06)), palette.paper);
  }
}

/** Paints one complete poster face: layout, print drift, then wear. */
export function paintPosterFace(request: PosterFaceRequest, options: { readonly height?: number } = {}): PosterSurface {
  const size = posterFaceSize(request.aspect, options.height ?? POSTER_FACE_TEXTURE_HEIGHT);
  const palette = resolvePalette(request.palette);
  const random = createSeededRandom(posterFaceSeed(request));
  const surface = new PosterSurface(size.width, size.height);
  LAYOUT_PAINTERS[request.layout]({ surface, request, palette, random });
  applyPrintDrift(surface, request.print, request.fade, palette);
  applyWear(surface, request.wear, palette, random, posterTornCorner(request));
  return surface;
}

export interface PosterFaceTextureOptions {
  readonly canvasFactory?: CanvasFactory;
  /** Face resolution in pixels (default {@link POSTER_FACE_TEXTURE_HEIGHT}). */
  readonly height?: number;
  readonly anisotropy?: number;
  /** Shared surface cache, so a timeline move back and forth does not repaint. */
  readonly cache?: PosterSurfaceCache;
}

export interface PosterFaceTexture extends PosterTexture {
  /** The painted raster the texture was materialised from. */
  readonly surface: PosterSurface;
}

/** Paints (or reuses) one poster face and materialises it as a texture. */
export function createPosterFaceTexture(
  request: PosterFaceRequest,
  options: PosterFaceTextureOptions = {},
): PosterFaceTexture {
  const height = options.height ?? POSTER_FACE_TEXTURE_HEIGHT;
  const cached = options.cache?.get(request, height);
  const surface = cached ?? options.cache?.set(request, height, paintPosterFace(request, { height })) ?? paintPosterFace(request, { height });
  const texture = createPosterTexture(surface, {
    key: `face:${request.year}:${request.id}`,
    kind: 'face',
    canvasFactory: options.canvasFactory,
    anisotropy: options.anisotropy,
  });
  return { ...texture, surface };
}

/* -------------------------------------------------------------------------- */
/* Mounting hardware, wall wear and frame grain                               */
/* -------------------------------------------------------------------------- */

/** Metal or plastic fitting used to hang a sheet. */
export type HardwareTextureKind =
  | 'steel-pin'
  | 'brass-pin'
  | 'plastic-pin'
  | 'nail'
  | 'cup-hook'
  | 'tape-aged'
  | 'tape-clear'
  | 'bulldog-clip'
  | 'putty-dab';

/** Pixel size of each hardware fitting. */
export const HARDWARE_TEXTURE_SIZE: Readonly<Record<HardwareTextureKind, readonly [number, number]>> = Object.freeze({
  'steel-pin': [24, 24],
  'brass-pin': [24, 24],
  'plastic-pin': [24, 24],
  nail: [18, 18],
  'cup-hook': [24, 32],
  'tape-aged': [72, 30],
  'tape-clear': [72, 30],
  'bulldog-clip': [34, 46],
  'putty-dab': [22, 22],
});

/** Mark left on the wall by a mount. */
export type WallWearTextureKind =
  | 'ghost'
  | 'pin-holes'
  | 'tape-residue'
  | 'scuff'
  | 'damp-patch'
  | 'sheet-shadow';

/** Frame surface grain. */
export type FrameGrainKind =
  | 'wood-grain'
  | 'chipped-paint'
  | 'chrome-streak'
  | 'brushed-steel'
  | 'lacquer'
  | 'printed-board'
  | 'oak-veneer'
  | 'card-stock';

/** Ink used to paint a frame grain. */
export interface FrameGrainPalette {
  readonly base: string;
  readonly accent: string;
  readonly highlight: string;
}

function hardwareSurface(kind: HardwareTextureKind, random: () => number): PosterSurface {
  const [width, height] = HARDWARE_TEXTURE_SIZE[kind];
  const surface = new PosterSurface(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.28;

  switch (kind) {
    case 'steel-pin':
    case 'brass-pin':
    case 'plastic-pin': {
      const head =
        kind === 'steel-pin'
          ? { r: 168, g: 174, b: 182 }
          : kind === 'brass-pin'
            ? { r: 196, g: 160, b: 78 }
            : { r: 190, g: 68, b: 62 };
      surface.disc(cx + 1, cy + 1.5, radius * 1.05, { r: 28, g: 24, b: 20 }, 90);
      surface.disc(cx, cy, radius, head);
      surface.disc(cx - radius * 0.3, cy - radius * 0.32, radius * 0.34, mixRgb(head, { r: 255, g: 255, b: 255 }, 0.65));
      surface.ring(cx, cy, radius, 1, shadeRgb(head, 0.55), 200);
      break;
    }
    case 'nail': {
      surface.disc(cx + 1, cy + 1, radius * 1.1, { r: 26, g: 22, b: 18 }, 100);
      surface.disc(cx, cy, radius * 0.9, { r: 96, g: 92, b: 86 });
      surface.ring(cx - radius * 0.25, cy - radius * 0.25, radius * 0.28, 1, { r: 196, g: 192, b: 186 }, 210);
      break;
    }
    case 'cup-hook': {
      const metal = { r: 134, g: 138, b: 142 };
      surface.disc(cx, cy - height * 0.28, radius * 0.7, metal);
      surface.ring(cx, cy + height * 0.06, radius * 0.95, 3, metal, 235);
      surface.line(cx, cy - height * 0.24, cx, cy - height * 0.04, metal, 3);
      surface.disc(cx - radius * 0.25, cy - height * 0.32, radius * 0.24, { r: 226, g: 230, b: 234 }, 220);
      break;
    }
    case 'tape-aged':
    case 'tape-clear': {
      const aged = kind === 'tape-aged';
      const base = aged ? { r: 214, g: 190, b: 138 } : { r: 232, g: 236, b: 238 };
      const alpha = aged ? 168 : 96;
      surface.fillRect(1, 2, width - 2, height - 4, base, alpha);
      surface.fillRect(0, 0, width, 2, shadeRgb(base, 0.72), aged ? 150 : 70);
      surface.fillRect(0, height - 2, width, 2, shadeRgb(base, 0.72), aged ? 150 : 70);
      for (let step = 0; step < width; step += 4) {
        surface.blendRect(step, 2, 1, height - 4, mixRgb(base, { r: 255, g: 255, b: 255 }, 0.4), (aged ? 90 : 130) / 255);
      }
      for (let step = 0; step < 4; step += 1) {
        const jag = 1 + Math.round(random() * 3);
        surface.set(step % 2 === 0 ? step : width - 1 - step, 0, base, 0);
        surface.set(step % 2 === 0 ? step : width - 1 - step, 1, base, 0);
        surface.set(step, height - 1 - (step % 2), base, 0);
        surface.set(width - 1 - step, height - 2 + (step % 2), base, 0);
        if (jag === 4) surface.blendRect(step, 2, 1, height - 4, { r: 120, g: 104, b: 78 }, 0.25);
      }
      break;
    }
    case 'bulldog-clip': {
      const metal = { r: 150, g: 154, b: 158 };
      surface.fillRect(width * 0.14, height * 0.28, width * 0.72, height * 0.2, metal);
      surface.fillRect(width * 0.14, height * 0.62, width * 0.72, height * 0.2, metal);
      surface.ring(cx, height * 0.52, width * 0.2, 3, shadeRgb(metal, 0.75), 240);
      surface.fillRect(width * 0.14, height * 0.28, width * 0.72, 2, mixRgb(metal, { r: 255, g: 255, b: 255 }, 0.6), 220);
      break;
    }
    case 'putty-dab': {
      const putty = { r: 176, g: 178, b: 168 };
      surface.disc(cx, cy, radius * 1.1, putty, 225);
      surface.disc(cx - radius * 0.3, cy - radius * 0.3, radius * 0.5, mixRgb(putty, { r: 255, g: 255, b: 255 }, 0.35), 220);
      surface.disc(cx + radius * 0.4, cy + radius * 0.42, radius * 0.34, shadeRgb(putty, 0.82), 200);
      break;
    }
  }
  return surface;
}

/** Paints one mounting fitting (pin, tape strip, clip, hook, putty dab). */
export function createHardwareTexture(
  kind: HardwareTextureKind,
  options: { readonly canvasFactory?: CanvasFactory; readonly key?: string; readonly seed?: number } = {},
): PosterTexture {
  const random = createSeededRandom(hashString(`hardware:${kind}:${options.seed ?? 0}`));
  const surface = hardwareSurface(kind, random);
  return createPosterTexture(surface, {
    key: options.key ?? `hardware:${kind}`,
    kind: 'hardware',
    canvasFactory: options.canvasFactory,
  });
}

function wallWearSurface(
  kind: WallWearTextureKind,
  width: number,
  height: number,
  random: () => number,
  paper: Rgb,
): PosterSurface {
  const surface = new PosterSurface(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const dirt = mixRgb(paper, { r: 84, g: 66, b: 44 }, 0.62);
  const grime = mixRgb(paper, { r: 60, g: 52, b: 44 }, 0.5);

  switch (kind) {
    case 'ghost': {
      // The sheet that used to hang here: a bleached rectangle, a dirt halo and
      // the tiny holes the pins left behind.
      surface.fill(paper, 0);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const distance = Math.min(x, y, width - 1 - x, height - 1 - y);
          const exposure = clamp01((distance - 6) / 14);
          const tone = mixRgb(grime, mixRgb(dirt, paper, 0.35), exposure);
          const coverageScale = (1 - exposure) * 0.5 + 0.08;
          surface.blend(x, y, tone, coverageScale * (0.7 + random() * 0.3));
        }
      }
      surface.ring(cx, cy, Math.min(width, height) * 0.42, 2, dirt, 90);
      for (const [px, py] of [
        [width * 0.2, height * 0.08],
        [width * 0.8, height * 0.08],
        [width * 0.2, height * 0.92],
        [width * 0.8, height * 0.92],
      ] as const) {
        surface.disc(px, py, 2, shadeRgb(dirt, 0.5), 190);
        surface.ring(px, py, 4, 1, dirt, 80);
      }
      for (let step = 0; step < 14; step += 1) {
        const streakX = random() * width;
        surface.blendRect(streakX, 3, 1 + random() * 2, height - 6, grime, 0.12 + random() * 0.18);
      }
      break;
    }
    case 'pin-holes': {
      surface.fill(paper, 0);
      surface.blendRect(0, 0, width, height, grime, 0.25);
      for (let step = 0; step < 4; step += 1) {
        const px = step % 2 === 0 ? width * 0.22 : width * 0.78;
        const py = step < 2 ? height * 0.2 : height * 0.8;
        surface.disc(px + random() * 2, py + random() * 2, 2.2, shadeRgb(dirt, 0.42), 235);
        surface.ring(px, py, 4.5, 1, dirt, 110);
        surface.line(px + 3, py, px + 3 + random() * 10, py + 4 + random() * 8, dirt, 1, 90);
      }
      break;
    }
    case 'tape-residue': {
      surface.fill(paper, 0);
      for (const offset of [-0.28, 0.28]) {
        const barX = cx + width * offset - width * 0.16;
        surface.blendRect(barX, height * 0.18, width * 0.32, height * 0.64, { r: 232, g: 214, b: 172 }, 0.32);
        surface.blendRect(barX, height * 0.18, width * 0.32, 2, dirt, 0.4);
        surface.blendRect(barX, height * 0.8, width * 0.32, 2, dirt, 0.4);
        for (let step = 0; step < 10; step += 1) {
          surface.blend(barX + random() * width * 0.32, height * (0.2 + random() * 0.6), dirt, 0.2);
        }
      }
      break;
    }
    case 'scuff': {
      surface.fill(paper, 0);
      for (let step = 0; step < 12; step += 1) {
        const y = random() * height;
        const length = width * (0.2 + random() * 0.6);
        const x = random() * (width - length);
        surface.blendRect(x, y, length, 1 + random() * 2, grime, 0.2 + random() * 0.3);
      }
      surface.blendRect(0, 0, width, height * 0.1, dirt, 0.18);
      break;
    }
    case 'damp-patch': {
      surface.fill(paper, 0);
      const radius = Math.min(width, height) * 0.42;
      surface.glow(cx, cy, radius, { r: 118, g: 104, b: 74 }, 0.55, 220);
      surface.ring(cx, cy, radius * 0.86, 2, mixRgb(dirt, { r: 96, g: 78, b: 48 }, 0.5), 150);
      surface.ring(cx, cy, radius * 0.6, 1, dirt, 110);
      for (let step = 0; step < 10; step += 1) {
        surface.blend(cx + (random() - 0.5) * radius * 1.6, cy + (random() - 0.5) * radius * 1.6, grime, 0.2);
      }
      break;
    }
    case 'sheet-shadow': {
      surface.fill(paper, 0);
      const inset = Math.max(Math.round(Math.min(width, height) * 0.04), 2);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const distance = Math.min(x, y, width - 1 - x, height - 1 - y);
          const falloff = clamp01(1 - distance / (inset * 2.4));
          const lift = clamp01(x / width) * 0.35 + clamp01(y / height) * 0.35;
          surface.blend(x, y, { r: 18, g: 14, b: 10 }, falloff * (0.42 + lift));
        }
      }
      break;
    }
  }
  return surface;
}

/**
 * Paints one wall-wear decal. Decals are RGBA: the alpha channel is what makes a
 * faded rectangle, a tape mark or a torn corner read against the wall.
 */
export function createWallWearTexture(
  kind: WallWearTextureKind,
  options: {
    readonly canvasFactory?: CanvasFactory;
    readonly key?: string;
    readonly seed?: number;
    readonly paper?: string;
    readonly width?: number;
    readonly height?: number;
  } = {},
): PosterTexture {
  const defaults: Readonly<Record<WallWearTextureKind, readonly [number, number]>> = {
    ghost: [176, 240],
    'pin-holes': [72, 96],
    'tape-residue': [88, 58],
    scuff: [128, 64],
    'damp-patch': [144, 144],
    'sheet-shadow': [168, 232],
  };
  const fallback = defaults[kind];
  const width = clampTextureSize(options.width ?? fallback[0]);
  const height = clampTextureSize(options.height ?? fallback[1]);
  const random = createSeededRandom(hashString(`wear:${kind}:${options.seed ?? 0}`));
  const surface = wallWearSurface(kind, width, height, random, parseColor(options.paper ?? '#cfc6b8'));
  return createPosterTexture(surface, {
    key: options.key ?? `wear:${kind}`,
    kind: 'wear',
    canvasFactory: options.canvasFactory,
  });
}

function frameGrainSurface(kind: FrameGrainKind, palette: FrameGrainPalette, random: () => number): PosterSurface {
  const size = 64;
  const surface = new PosterSurface(size, size);
  const base = parseColor(palette.base);
  const accent = parseColor(palette.accent);
  const highlight = parseColor(palette.highlight);
  surface.fill(base);

  switch (kind) {
    case 'wood-grain':
    case 'oak-veneer': {
      for (let step = 0; step < 26; step += 1) {
        const x = random() * size;
        const tone = mixRgb(base, random() > 0.5 ? accent : highlight, 0.25 + random() * 0.4);
        surface.blendRect(x, 0, 1 + random() * 2, size, tone, 0.35);
      }
      if (kind === 'oak-veneer') {
        for (let step = 0; step < 3; step += 1) {
          surface.ring(random() * size, random() * size, 3 + random() * 4, 2, accent, 120);
        }
      }
      break;
    }
    case 'chipped-paint': {
      surface.fill(mixRgb(base, highlight, 0.15));
      for (let step = 0; step < 18; step += 1) {
        const chipW = 2 + random() * 7;
        const chipH = 2 + random() * 5;
        surface.fillRect(random() * size, random() * size, chipW, chipH, mixRgb(accent, base, 0.25));
        surface.fillRect(random() * size, random() * size, chipW * 0.6, chipH * 0.6, shadeRgb(base, 0.82));
      }
      break;
    }
    case 'chrome-streak':
    case 'brushed-steel': {
      const vertical = kind === 'brushed-steel';
      surface.verticalGradient(0, 0, size, size, mixRgb(base, highlight, 0.4), mixRgb(base, accent, 0.4));
      for (let step = 0; step < 60; step += 1) {
        const tone = mixRgb(highlight, accent, random());
        if (vertical) {
          surface.blendRect(0, random() * size, size, 1, tone, 0.18 + random() * 0.22);
        } else {
          surface.blendRect(random() * size, 0, 1, size, tone, 0.18 + random() * 0.22);
        }
      }
      break;
    }
    case 'lacquer': {
      surface.fill(mixRgb(base, { r: 12, g: 12, b: 16 }, 0.35));
      surface.blendRect(0, 0, size, size * 0.18, highlight, 0.16);
      surface.blendRect(0, size * 0.72, size, size * 0.28, accent, 0.12);
      surface.glow(size * 0.3, size * 0.24, size * 0.5, highlight, 0.2);
      break;
    }
    case 'printed-board': {
      surface.fill(base);
      for (let step = 0; step < 6; step += 1) {
        surface.fillRect(0, step * (size / 6), size, size / 12, mixRgb(accent, highlight, step / 6));
      }
      surface.fillRect(0, 0, size, 2, highlight, 220);
      surface.fillRect(0, size - 2, size, 2, accent, 220);
      break;
    }
    case 'card-stock': {
      surface.fill(base);
      for (let step = 0; step < 30; step += 1) {
        surface.blend(random() * size, random() * size, accent, 0.12 + random() * 0.2);
      }
      surface.grain(random, 0.08);
      break;
    }
  }
  return surface;
}

/** Paints a tiling frame grain for one frame finish. */
export function createFrameGrainTexture(
  kind: FrameGrainKind,
  palette: FrameGrainPalette,
  options: { readonly canvasFactory?: CanvasFactory; readonly key?: string; readonly repeat?: readonly [number, number] } = {},
): PosterTexture {
  const random = createSeededRandom(hashString(`frame:${kind}:${palette.base}`));
  const surface = frameGrainSurface(kind, palette, random);
  return createPosterTexture(surface, {
    key: options.key ?? `frame:${kind}`,
    kind: 'frame',
    canvasFactory: options.canvasFactory,
    repeat: options.repeat ?? [1, 1],
  });
}
