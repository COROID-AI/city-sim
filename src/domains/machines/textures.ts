/**
 * Procedural machine surfaces, panels and legends.
 *
 * Every finish the brewing domain wears is painted here, pixel by pixel:
 * vitreous enamel, hammered and crackled paint, brushed and satin stainless,
 * polished chrome, copper boiler cladding with its green patina, tarnished
 * brass, bakelite, cast iron, chrome-plated plastic, powder coat, wood, glass,
 * ceramic, rubber and granite — plus the *information* surfaces that make a
 * machine readable: clock-style dial faces with printed numerals, silk-screened
 * legend plates and brand decals, the 2005 LCD readout and the 2025 glass touch
 * panel with its setting rows. A transparent scuff/patina overlay carries the
 * era's wear on top of any of them.
 *
 * Nothing is fetched — at build time or at runtime — so the module works
 * offline, in a headless node process and in the browser from the same bytes.
 * The raster primitives, colour helpers and the 5×7 bitmap font are the ones the
 * room shell already publishes ({@link PixelBuffer}, {@link drawText}), so
 * machine legends read exactly like the shop's other lettering.
 *
 * Two backends, one raster: with a DOM canvas (or an injected
 * {@link CanvasFactory}) the pixels are blitted and wrapped in a
 * `CanvasTexture`; with no canvas the same bytes become a `DataTexture`. Both
 * paths are deterministic — every painter draws from a seeded PRNG derived from
 * the style — so an era's material set looks identical on every run and tests
 * can assert real pixel content.
 */

import * as THREE from 'three';
import { createSeededRandom } from '../../core/kernel';
import type { YearId } from '../../contracts/period';
import {
  FONT_GLYPH_WIDTH,
  PixelBuffer,
  defaultCanvasFactory,
  drawText,
  hashString,
  measureText,
  mixRgb,
  parseColor,
  shade,
  type CanvasFactory,
  type Rgb,
} from '../environment';

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** Canvas factory the finishes are drawn through (re-exported for consumers). */
export type { CanvasFactory, Rgb } from '../environment';

/** Every surface family a brewing machine or accessory is built from. */
export type MachineTextureKind =
  | 'enamel'
  | 'painted-steel'
  | 'crackle-paint'
  | 'stainless'
  | 'brushed-steel'
  | 'chrome'
  | 'copper'
  | 'brass'
  | 'bakelite'
  | 'cast-iron'
  | 'plastic'
  | 'powder-coat'
  | 'wood'
  | 'glass'
  | 'ceramic'
  | 'rubber'
  | 'granite'
  | 'dial-face'
  | 'legend'
  | 'lcd'
  | 'touch-panel'
  | 'wear';

/** Colour vocabulary of a machine surface. */
export interface MachineTexturePalette {
  /** Body colour of the material. */
  readonly base: string;
  /** Secondary colour: grain, patina, tick or ink colour. */
  readonly accent: string;
  /** Seam, shadow or engraving colour (defaults to a darkened `base`). */
  readonly detail?: string;
  /** Sheen, chip or highlight colour (defaults to a lightened `base`). */
  readonly highlight?: string;
}

/**
 * Lettering and readout content painted onto a legend, dial, LCD or touch
 * panel. Data files own the words; the painters own the letterform layout.
 */
export interface LegendSpec {
  /** Main legend line (`'PERCO'`, `'FAEMA'`, `'APPIA'`). */
  readonly title: string;
  /** Smaller line under the title (`'ESPRESSO'`, `'AUTOMATIC'`). */
  readonly subtitle?: string;
  /** Extra rows of small print, top to bottom. */
  readonly lines?: readonly string[];
  /** Readout digits for an LCD or touch panel (`'094'`, `'24'`, `'93'`). */
  readonly digits?: string;
  /** Ink colour of the title; defaults to the palette accent. */
  readonly ink?: string;
  /** Ink colour of the small print; defaults to the palette detail. */
  readonly smallInk?: string;
  /** Horizontal alignment of the block (default `'center'`). */
  readonly align?: 'left' | 'center';
}

/** Complete recipe for one procedural machine finish. */
export interface MachineTextureStyle {
  readonly kind: MachineTextureKind;
  readonly palette: MachineTexturePalette;
  /** Pattern repetitions along one texture edge (default 4). */
  readonly scale?: number;
  /** Noise strength, 0..1 (default 0.16). */
  readonly contrast?: number;
  /** Grain/gradient direction (default `'horizontal'`). */
  readonly orientation?: 'horizontal' | 'vertical';
  /** UV repetition of the finished texture across a surface (default `[1, 1]`). */
  readonly repeat?: readonly [number, number];
  /** Square texture resolution in pixels (default {@link DEFAULT_MACHINE_TEXTURE_SIZE}). */
  readonly size?: number;
  /** `'pattern'` skips the body fill so a finish can be layered as a decal. */
  readonly transparency?: 'none' | 'pattern';
  /** Wear strength baked into the finish, 0..1 (default 0). */
  readonly wear?: number;
  /** Explicit paint seed; defaults to a hash of the style. */
  readonly seed?: number;
  /** Lettering/readout content for `legend`, `dial-face`, `lcd`, `touch-panel`. */
  readonly legend?: LegendSpec;
  /** Needle position across a dial face's sweep, 0..1 (default 0.32). */
  readonly needle?: number;
  /** Tick count on a dial, vent/burner rows on a panel (default 10). */
  readonly grid?: number;
}

/** Default square texture resolution. Small on purpose: these are procedural. */
export const DEFAULT_MACHINE_TEXTURE_SIZE = 128;

/** Every texture this module creates is named with this prefix. */
export const MACHINE_TEXTURE_PREFIX = 'machine:';

/** A finished procedural texture plus how it was materialised. */
export interface MachineTexture {
  readonly key: string;
  readonly kind: MachineTextureKind;
  readonly width: number;
  readonly height: number;
  /** Which backend produced the texture. */
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  /** The 2D canvas when the canvas backend was used, otherwise `null`. */
  readonly canvas: HTMLCanvasElement | null;
}

export interface MachineTextureOptions {
  /** Texture key, used for `texture.name` (`machine:<key>`). Defaults to the kind. */
  readonly key?: string;
  readonly canvasFactory?: CanvasFactory;
  /** Overrides the square resolution with an explicit height. */
  readonly height?: number;
  readonly anisotropy?: number;
}

/* -------------------------------------------------------------------------- */
/* Painting primitives                                                        */
/* -------------------------------------------------------------------------- */

type Painter = (
  pixels: PixelBuffer,
  palette: ResolvedPalette,
  style: MachineTextureStyle,
  random: () => number,
) => void;

interface ResolvedPalette {
  readonly base: Rgb;
  readonly accent: Rgb;
  readonly detail: Rgb;
  readonly highlight: Rgb;
}

function resolvePalette(palette: MachineTexturePalette): ResolvedPalette {
  const base = parseColor(palette.base);
  const accent = parseColor(palette.accent);
  return {
    base,
    accent,
    detail: palette.detail ? parseColor(palette.detail) : shade(base, 0.62),
    highlight: palette.highlight ? parseColor(palette.highlight) : mixRgb(base, { r: 255, g: 255, b: 255 }, 0.28),
  };
}

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MACHINE_TEXTURE_SIZE;
  return Math.min(Math.max(Math.trunc(value), 8), 512);
}

/** Blends a straight line (alpha aware, wrapping like the buffer). */
function blendLine(
  pixels: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgb,
  alpha: number,
  thickness = 1,
): void {
  const steps = Math.max(Math.abs(Math.round(x1 - x0)), Math.abs(Math.round(y1 - y0)), 1);
  const radius = Math.max(Math.trunc(thickness / 2), 0);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        pixels.blend(x + dx, y + dy, color, alpha);
      }
    }
  }
}

/** Alpha-blended disc, used for gauge bezels, screw heads and lamps. */
function blendDisc(
  pixels: PixelBuffer,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
  alpha: number,
): void {
  const r = Math.max(Math.round(radius), 0);
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (Math.sqrt(dx * dx + dy * dy) > r) continue;
      pixels.blend(cx + dx, cy + dy, color, alpha);
    }
  }
}

/** Alpha-blended ring, used for gauge bezels and burner rings. */
function blendRing(
  pixels: PixelBuffer,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  color: Rgb,
  alpha: number,
): void {
  const outer = Math.max(Math.round(radius), 0);
  const inner = Math.max(outer - Math.max(Math.round(thickness), 1), 0);
  for (let dy = -outer; dy <= outer; dy += 1) {
    for (let dx = -outer; dx <= outer; dx += 1) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > outer || distance < inner) continue;
      pixels.blend(cx + dx, cy + dy, color, alpha);
    }
  }
}

/** Deterministic speckle field (cast iron pitting, granite, worn paint). */
function speckle(
  pixels: PixelBuffer,
  random: () => number,
  count: number,
  color: Rgb,
  alpha: number,
  maxRadius = 1,
): void {
  for (let index = 0; index < count; index += 1) {
    const x = Math.trunc(random() * pixels.width);
    const y = Math.trunc(random() * pixels.height);
    const radius = 1 + random() * maxRadius;
    blendDisc(pixels, x, y, radius, color, alpha * (0.5 + random() * 0.5));
  }
}

/** Scratches, chips, dents and stains: the era's accumulated wear. */
function paintWear(
  pixels: PixelBuffer,
  palette: ResolvedPalette,
  random: () => number,
  wear: number,
  scale: number,
): void {
  const strength = Math.min(Math.max(wear, 0), 1);
  if (strength <= 0) return;
  const scratches = Math.round(strength * scale * 4);
  for (let index = 0; index < scratches; index += 1) {
    const x = random() * pixels.width;
    const y = random() * pixels.height;
    const length = (2 + random() * 8) * scale * 0.5;
    const direction = random() < 0.5 ? 1 : -1;
    blendLine(
      pixels,
      x,
      y,
      x + length,
      y + length * 0.25 * direction,
      palette.highlight,
      0.08 + strength * 0.16,
    );
  }
  const chips = Math.round(strength * 6);
  for (let index = 0; index < chips; index += 1) {
    const x = random() * pixels.width;
    const y = random() * pixels.height;
    const radius = 1 + random() * (1 + strength * 2);
    blendDisc(pixels, x, y, radius, shade(palette.base, 0.45), 0.25 + strength * 0.4);
    blendRing(pixels, x, y, radius + 0.6, 1, palette.highlight, 0.18 * strength);
  }
  // Staining low on the panel: coffee, scale and steam condensate.
  const stains = Math.round(strength * 5);
  for (let index = 0; index < stains; index += 1) {
    const x = random() * pixels.width;
    const y = pixels.height * (0.55 + random() * 0.45);
    const radius = 1.5 + random() * (2 + strength * 3);
    blendDisc(pixels, x, y, radius, mixRgb(palette.detail, palette.accent, 0.4), 0.12 * strength);
  }
}

/* -------------------------------------------------------------------------- */
/* Painters                                                                   */
/* -------------------------------------------------------------------------- */

const paintEnamel: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.verticalGradient(mixRgb(palette.base, palette.highlight, 0.12), shade(palette.base, 0.88));
  // Vitreous crazing: fine cracks fanning out from the panel edges.
  const cracks = Math.round(scale * 1.5);
  for (let index = 0; index < cracks; index += 1) {
    const fromTop = random() < 0.5;
    const x = random() * pixels.width;
    const y = fromTop ? 0 : pixels.height;
    blendLine(pixels, x, y, x + (random() * 2 - 1) * 8, y + (fromTop ? 1 : -1) * (4 + random() * 10), palette.detail, 0.12);
  }
  pixels.noise(random, (style.contrast ?? 0.16) * 0.5);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintPaintedSteel: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.fill(palette.base);
  // Hammered finish: paired highlight and shadow dimples.
  const dimples = scale * 10;
  for (let index = 0; index < dimples; index += 1) {
    const x = random() * pixels.width;
    const y = random() * pixels.height;
    const radius = 1 + random() * 2;
    blendDisc(pixels, x, y, radius, palette.highlight, 0.18);
    blendDisc(pixels, x + 1, y + 1, radius, palette.detail, 0.14);
  }
  pixels.noise(random, (style.contrast ?? 0.16) * 0.6);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintCracklePaint: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.fill(palette.base);
  // Crackle: short dashes meeting at random angles, the signature of 1960s paint.
  const dashes = scale * 16;
  for (let index = 0; index < dashes; index += 1) {
    const x = random() * pixels.width;
    const y = random() * pixels.height;
    const angle = random() * Math.PI * 2;
    const length = 1 + random() * 4;
    blendLine(
      pixels,
      x,
      y,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
      palette.detail,
      0.16,
    );
  }
  pixels.noise(random, (style.contrast ?? 0.16) * 0.5);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintMetalGrain: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  const vertical = style.orientation === 'vertical';
  const contrast = style.contrast ?? 0.16;
  pixels.verticalGradient(
    vertical ? palette.base : mixRgb(palette.base, palette.highlight, 0.08),
    vertical ? palette.base : shade(palette.base, 0.9),
  );
  const lines = pixels.width * (vertical ? 1 : 1);
  for (let index = 0; index < lines; index += 1) {
    const offset = index / lines;
    const x = vertical ? offset * pixels.width : 0;
    const y = vertical ? 0 : offset * pixels.height;
    const tone = random();
    const color = tone < 0.5 ? palette.highlight : palette.detail;
    if (vertical) {
      blendLine(pixels, x, 0, x, pixels.height, color, contrast * (0.08 + random() * 0.18));
    } else {
      blendLine(pixels, 0, y, pixels.width, y, color, contrast * (0.08 + random() * 0.18));
    }
  }
  // Fingerprints and steam smears over the grain.
  for (let index = 0; index < scale; index += 1) {
    blendDisc(
      pixels,
      random() * pixels.width,
      random() * pixels.height,
      2 + random() * 4,
      palette.detail,
      0.05 + random() * 0.05,
    );
  }
  pixels.noise(random, contrast * 0.4);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintChrome: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  // Polished chrome: alternating mirror bands plus a horizon highlight.
  pixels.fill(palette.base);
  const bands = Math.max(Math.trunc(pixels.height / 8), 2);
  for (let band = 0; band < bands; band += 1) {
    const y = Math.round((band / bands) * pixels.height);
    const height = Math.max(Math.floor(pixels.height / bands), 1);
    const tone = band % 2 === 0 ? 0.5 + random() * 0.25 : 0.2 + random() * 0.18;
    pixels.fillRect(0, y, pixels.width, height, shade(palette.base, 0.7 + tone), 255);
  }
  blendLine(pixels, 0, Math.round(pixels.height * 0.35), pixels.width, Math.round(pixels.height * 0.35), palette.highlight, 0.5, 2);
  blendLine(pixels, 0, Math.round(pixels.height * 0.72), pixels.width, Math.round(pixels.height * 0.72), palette.detail, 0.3, 1);
  pixels.noise(random, 0.05);
  paintWear(pixels, palette, random, (style.wear ?? 0) * 0.6, scale);
};

const paintCopper: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.verticalGradient(mixRgb(palette.base, palette.highlight, 0.15), shade(palette.base, 0.82));
  // Patina: verdigris blotches where the boiler weeps.
  const blotches = 4 + Math.round(scale);
  for (let index = 0; index < blotches; index += 1) {
    const x = random() * pixels.width;
    const y = random() * pixels.height;
    const radius = 2 + random() * 5;
    blendDisc(pixels, x, y, radius, palette.accent, 0.22);
    blendRing(pixels, x, y, radius + 1, 1, shade(palette.accent, 0.7), 0.14);
  }
  for (let index = 0; index < scale * 3; index += 1) {
    blendLine(pixels, random() * pixels.width, 0, random() * pixels.width, pixels.height, palette.highlight, 0.08);
  }
  pixels.noise(random, (style.contrast ?? 0.16) * 0.5);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintBrass: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.verticalGradient(mixRgb(palette.base, palette.highlight, 0.22), shade(palette.base, 0.78));
  speckle(pixels, random, scale * 12, palette.detail, 0.12, 2);
  for (let index = 0; index < scale * 2; index += 1) {
    blendLine(pixels, random() * pixels.width, 0, random() * pixels.width, pixels.height, palette.highlight, 0.12);
  }
  pixels.noise(random, 0.1);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintBakelite: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.fill(palette.base);
  // Swirled phenolic marbling, the way 1950s knobs and handles look.
  const swirls = 6 + scale * 2;
  for (let index = 0; index < swirls; index += 1) {
    let x = random() * pixels.width;
    let y = random() * pixels.height;
    for (let step = 0; step < 10; step += 1) {
      const nextX = x + (random() * 2 - 1) * scale;
      const nextY = y + (random() * 2 - 1) * scale;
      blendLine(pixels, x, y, nextX, nextY, palette.accent, 0.1);
      x = nextX;
      y = nextY;
    }
  }
  pixels.noise(random, (style.contrast ?? 0.16) * 0.4);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintCastIron: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.fill(palette.base);
  speckle(pixels, random, scale * 24, palette.detail, 0.2, 2);
  speckle(pixels, random, scale * 10, palette.highlight, 0.1, 1);
  // Casting seam through the middle of the plate.
  blendLine(pixels, 0, pixels.height / 2, pixels.width, pixels.height / 2, palette.highlight, 0.14);
  pixels.noise(random, (style.contrast ?? 0.16) * 0.8);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintPlastic: Painter = (pixels, palette, style, random) => {
  pixels.verticalGradient(mixRgb(palette.base, palette.highlight, 0.1), shade(palette.base, 0.9));
  pixels.noise(random, (style.contrast ?? 0.16) * 0.3);
  paintWear(pixels, palette, random, style.wear ?? 0, Math.max(style.scale ?? 4, 1));
};

const paintPowderCoat: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.fill(palette.base);
  // Fine, entirely matte texture — no specular structure at all.
  speckle(pixels, random, scale * 40, palette.highlight, 0.05, 1);
  speckle(pixels, random, scale * 40, palette.detail, 0.05, 1);
  pixels.noise(random, (style.contrast ?? 0.16) * 0.7);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintWood: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.fill(palette.base);
  const boards = Math.max(Math.trunc(scale), 2);
  const boardHeight = Math.max(Math.floor(pixels.height / boards), 2);
  for (let y = 0; y < pixels.height; y += boardHeight) {
    pixels.fillRect(0, y, pixels.width, boardHeight - 1, shade(palette.base, 0.9 + random() * 0.2));
    for (let index = 0; index < 6; index += 1) {
      const grain = y + random() * boardHeight;
      blendLine(pixels, 0, grain, pixels.width, grain + (random() * 2 - 1) * 2, palette.detail, 0.1 + random() * 0.1);
    }
    blendLine(pixels, 0, y, pixels.width, y, palette.detail, 0.3);
  }
  pixels.noise(random, (style.contrast ?? 0.16) * 0.4);
  paintWear(pixels, palette, random, style.wear ?? 0, scale);
};

const paintGlass: Painter = (pixels, palette, style, random) => {
  pixels.fill(palette.base, 90);
  // Smeared highlights and the printed graduation of a sight glass or a tank.
  for (let index = 0; index < 6; index += 1) {
    const x = random() * pixels.width;
    blendLine(pixels, x, 0, x + (random() * 2 - 1) * 6, pixels.height, palette.highlight, 0.22, 2);
  }
  for (let index = 0; index <= 8; index += 1) {
    const y = Math.round((index / 8) * (pixels.height - 1));
    const width = index % 2 === 0 ? Math.round(pixels.width * 0.3) : Math.round(pixels.width * 0.18);
    blendLine(pixels, 2, y, 2 + width, y, palette.accent, 0.5);
  }
  pixels.noise(random, 0.04);
};

const paintCeramic: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.verticalGradient(mixRgb(palette.base, palette.highlight, 0.32), shade(palette.base, 0.94));
  speckle(pixels, random, scale * 6, palette.detail, 0.05, 1);
  blendLine(pixels, 0, 2, pixels.width, 2, palette.accent, 0.35, 2);
  pixels.noise(random, 0.03);
};

const paintRubber: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.fill(palette.base);
  speckle(pixels, random, scale * 30, palette.highlight, 0.06, 1);
  pixels.noise(random, (style.contrast ?? 0.16) * 0.6);
};

const paintGranite: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(style.scale ?? 4, 1);
  pixels.fill(palette.base);
  speckle(pixels, random, scale * 18, palette.highlight, 0.22, 2);
  speckle(pixels, random, scale * 18, palette.accent, 0.18, 2);
  speckle(pixels, random, scale * 24, palette.detail, 0.12, 1);
  pixels.noise(random, (style.contrast ?? 0.16) * 0.4);
  paintWear(pixels, palette, random, (style.wear ?? 0) * 0.4, scale);
};

/** Clock-style pressure gauge: bezel, printed scale, needle, glass glare. */
const paintDialFace: Painter = (pixels, palette, style, random) => {
  const scale = Math.max(Math.trunc(pixels.width / 128), 1);
  pixels.fill(palette.base);
  const cx = pixels.width / 2;
  const cy = pixels.height / 2;
  const outer = Math.min(pixels.width, pixels.height) * 0.44;
  blendDisc(pixels, cx, cy, outer, palette.highlight, 0.06);
  blendRing(pixels, cx, cy, outer, Math.max(2, 3 * scale), palette.detail, 0.85);
  const ticks = Math.max(Math.trunc(style.grid ?? 10), 4);
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  for (let index = 0; index <= ticks; index += 1) {
    const angle = start + (index / ticks) * sweep;
    const major = index % 5 === 0 || ticks <= 6;
    const inner = outer - (major ? 8 : 5) * scale;
    const width = major ? Math.max(2, 2 * scale) : Math.max(1, scale);
    blendLine(
      pixels,
      cx + Math.cos(angle) * inner,
      cy + Math.sin(angle) * inner,
      cx + Math.cos(angle) * (outer - 2 * scale),
      cy + Math.sin(angle) * (outer - 2 * scale),
      palette.accent,
      0.95,
      width,
    );
  }
  const legend = style.legend;
  if (legend) {
    const unit = legend.subtitle ?? '';
    if (unit.length > 0) {
      const textScale = Math.max(scale, 1);
      drawText(pixels, unit, {
        x: Math.round(cx - measureText(unit, textScale) / 2),
        y: Math.round(cy - 16 * textScale),
        scale: textScale,
        color: legend.smallInk ? parseColor(legend.smallInk) : palette.detail,
        alpha: 220,
      });
    }
  }
  // Needle.
  const needleAngle = start + Math.min(Math.max(style.needle ?? 0.32, 0), 1) * sweep;
  blendLine(pixels, cx, cy, cx + Math.cos(needleAngle) * (outer - 6 * scale), cy + Math.sin(needleAngle) * (outer - 6 * scale), palette.accent, 0.95, Math.max(2, 2 * scale));
  blendDisc(pixels, cx, cy, 3 * scale, palette.detail, 0.95);
  // Glass glare across the upper left quadrant.
  for (let index = 0; index < 6; index += 1) {
    blendLine(pixels, cx - outer * 0.7, cy - outer * 0.9 + index, cx + outer * 0.2, cy - outer * 0.1 + index, palette.highlight, 0.08);
  }
  pixels.noise(random, 0.03);
};

/** Silk-screened legend, brand decal or engraved plate. */
const paintLegend: Painter = (pixels, palette, style) => {
  const legend = style.legend ?? { title: '' };
  if (style.transparency !== 'pattern') pixels.fill(palette.base);
  else pixels.fill({ r: 0, g: 0, b: 0 }, 0);
  const ink = parseColor(legend.ink ?? '#ffffff');
  const smallInk = parseColor(legend.smallInk ?? (style.palette.detail ?? '#cccccc'));
  const titleScale = Math.max(Math.trunc(pixels.height / 40), 1);
  const smallScale = Math.max(titleScale - 1, 1);
  const lines: string[] = [];
  if (legend.subtitle) lines.push(legend.subtitle);
  if (legend.lines) lines.push(...legend.lines);
  const blockHeight =
    Math.max(measureText('', titleScale), 0) +
    (titleScale * 7) +
    lines.length * (smallScale * 7 + 2 * smallScale);
  let y = Math.round((pixels.height - blockHeight) / 2);
  const titleWidth = measureText(legend.title, titleScale);
  const titleX =
    legend.align === 'left' ? 6 : Math.round((pixels.width - titleWidth) / 2);
  drawText(pixels, legend.title, { x: titleX, y, scale: titleScale, color: ink, alpha: 255 });
  y += titleScale * 7 + titleScale * 2;
  // Rule under the wordmark.
  blendLine(pixels, titleX, y - Math.max(titleScale, 1), titleX + titleWidth, y - Math.max(titleScale, 1), ink, 0.5);
  for (const line of lines) {
    const width = measureText(line, smallScale);
    const x = legend.align === 'left' ? 6 : Math.round((pixels.width - width) / 2);
    drawText(pixels, line, { x, y, scale: smallScale, color: smallInk, alpha: 255 });
    y += smallScale * 7 + 2 * smallScale;
  }
  // Two screw heads holding the plate on.
  blendDisc(pixels, 4, 4, 2, smallInk, 0.6);
  blendDisc(pixels, pixels.width - 4, pixels.height - 4, 2, smallInk, 0.6);
};

/** 2005-era LCD readout: backlit digits plus a value bar. */
const paintLcd: Painter = (pixels, palette, style, random) => {
  const legend = style.legend ?? { title: '', digits: '00' };
  pixels.verticalGradient(shade(palette.base, 1.25), palette.base);
  // Pixel grid of a dot-matrix module.
  for (let y = 0; y < pixels.height; y += 3) {
    blendLine(pixels, 0, y, pixels.width, y, palette.detail, 0.18);
  }
  const digits = legend.digits ?? '00';
  const scale = Math.max(Math.trunc(pixels.height / 22), 2);
  const width = measureText(digits, scale);
  drawText(pixels, digits, {
    x: Math.round((pixels.width - width) / 2),
    y: Math.round(pixels.height * 0.22),
    scale,
    color: palette.highlight,
    alpha: 255,
  });
  const label = legend.title;
  if (label.length > 0) {
    const smallScale = Math.max(scale - 2, 1);
    const labelWidth = measureText(label, smallScale);
    drawText(pixels, label, {
      x: Math.round((pixels.width - labelWidth) / 2),
      y: Math.round(pixels.height * 0.68),
      scale: smallScale,
      color: palette.accent,
      alpha: 255,
    });
  }
  // Backlight bloom around the digits.
  for (let index = 0; index < 24; index += 1) {
    blendDisc(pixels, random() * pixels.width, random() * pixels.height, 2 + random() * 3, palette.highlight, 0.04);
  }
};

/** 2025-era glass touch panel: setting rows, icons and a setpoint bar. */
const paintTouchPanel: Painter = (pixels, palette, style, random) => {
  const legend = style.legend ?? { title: 'ESPRESSO' };
  pixels.verticalGradient(shade(palette.base, 1.3), shade(palette.base, 0.7));
  // Rounded slab outline.
  blendLine(pixels, 2, 2, pixels.width - 3, 2, palette.highlight, 0.6);
  blendLine(pixels, 2, pixels.height - 3, pixels.width - 3, pixels.height - 3, palette.highlight, 0.6);
  blendLine(pixels, 2, 2, 2, pixels.height - 3, palette.highlight, 0.6);
  blendLine(pixels, pixels.width - 3, 2, pixels.width - 3, pixels.height - 3, palette.highlight, 0.6);
  const rows: string[] = [legend.title, ...(legend.lines ?? [])];
  const scale = Math.max(Math.trunc(pixels.height / (rows.length * 9 + 6)), 1);
  const rowHeight = Math.max(scale * 7 + 3 * scale, 6);
  let y = Math.max(Math.round((pixels.height - rowHeight * rows.length) / 2), 3);
  for (const row of rows) {
    const width = measureText(row, scale);
    const x = Math.max(Math.round((pixels.width - width) / 2), 3);
    drawText(pixels, row, { x, y, scale, color: palette.highlight, alpha: 255 });
    // Active-row underline: the barista just selected this shot.
    blendLine(pixels, x, y + scale * 7 + 1, Math.min(x + width, pixels.width - 3), y + scale * 7 + 1, palette.accent, 0.85);
    y += rowHeight;
  }
  // Setpoint bar and status lamp.
  const barWidth = Math.round(pixels.width * (0.3 + (style.needle ?? 0.5) * 0.4));
  pixels.fillRect(4, pixels.height - 8, barWidth, 3, palette.accent, 255);
  blendDisc(pixels, pixels.width - 8, 8, 3, palette.accent, 0.9);
  for (let index = 0; index < 14; index += 1) {
    blendDisc(pixels, random() * pixels.width, random() * pixels.height, 1 + random() * 2, palette.highlight, 0.03);
  }
};

/** Transparent overlay of scuffs, chips and coffee staining. */
const paintWearOverlay: Painter = (pixels, palette, style, random) => {
  pixels.fill({ r: 0, g: 0, b: 0 }, 0);
  const wear = Math.min(Math.max(style.wear ?? 0.6, 0), 1);
  paintWear(pixels, palette, random, wear, Math.max(style.scale ?? 4, 1));
  speckle(pixels, random, Math.round(wear * 20), palette.detail, 0.12, 2);
};

const PAINTERS: Readonly<Record<MachineTextureKind, Painter>> = Object.freeze({
  enamel: paintEnamel,
  'painted-steel': paintPaintedSteel,
  'crackle-paint': paintCracklePaint,
  stainless: paintMetalGrain,
  'brushed-steel': paintMetalGrain,
  chrome: paintChrome,
  copper: paintCopper,
  brass: paintBrass,
  bakelite: paintBakelite,
  'cast-iron': paintCastIron,
  plastic: paintPlastic,
  'powder-coat': paintPowderCoat,
  wood: paintWood,
  glass: paintGlass,
  ceramic: paintCeramic,
  rubber: paintRubber,
  granite: paintGranite,
  'dial-face': paintDialFace,
  legend: paintLegend,
  lcd: paintLcd,
  'touch-panel': paintTouchPanel,
  wear: paintWearOverlay,
});

/** Every surface family this module can paint, in stable order. */
export const MACHINE_TEXTURE_KINDS: readonly MachineTextureKind[] = Object.freeze(
  Object.keys(PAINTERS) as MachineTextureKind[],
);

/** Paints one style into a pixel buffer (deterministic for a given style). */
export function paintMachineSurface(style: MachineTextureStyle): PixelBuffer {
  const size = clampSize(style.size ?? DEFAULT_MACHINE_TEXTURE_SIZE);
  const pixels = new PixelBuffer(size, size);
  const palette = resolvePalette(style.palette);
  const seed =
    style.seed ??
    hashString(
      [
        style.kind,
        style.palette.base,
        style.palette.accent,
        style.scale ?? 4,
        style.orientation ?? 'horizontal',
        style.wear ?? 0,
        style.needle ?? 0.32,
        style.grid ?? 10,
        style.legend?.title ?? '',
        style.legend?.digits ?? '',
      ].join('|'),
    );
  const random = createSeededRandom(seed);
  if (style.transparency !== 'pattern') {
    pixels.fill(palette.base);
  }
  const painter = PAINTERS[style.kind];
  painter(pixels, palette, { ...style, size }, random);
  return pixels;
}

function applyTextureSettings(
  texture: THREE.Texture,
  key: string,
  style: MachineTextureStyle,
  options: MachineTextureOptions,
  source: 'canvas' | 'data',
): void {
  texture.name = `${MACHINE_TEXTURE_PREFIX}${key}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const repeat = style.repeat ?? [1, 1];
  texture.repeat.set(repeat[0] ?? 1, repeat[1] ?? 1);
  texture.anisotropy = options.anisotropy ?? 4;
  texture.needsUpdate = true;
  texture.userData = { procedural: true, kind: style.kind, source };
}

/**
 * Paints `style` and returns it as a texture. Uses the canvas backend when
 * `options.canvasFactory` (or the DOM) provides one, otherwise a `DataTexture`.
 */
export function createMachineTexture(
  style: MachineTextureStyle,
  options: MachineTextureOptions = {},
): MachineTexture {
  const width = clampSize(style.size ?? DEFAULT_MACHINE_TEXTURE_SIZE);
  const height = clampSize(options.height ?? width);
  const pixels = paintMachineSurface({ ...style, size: width });
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
export function isMachineTexture(texture: THREE.Texture): boolean {
  return (
    (texture instanceof THREE.DataTexture || texture instanceof THREE.CanvasTexture) &&
    texture.name.startsWith(MACHINE_TEXTURE_PREFIX)
  );
}

/** Number of distinct RGBA values in a raster (used by the tests). */
export function distinctPixelColors(pixels: PixelBuffer): number {
  return pixels.distinctColors();
}

/* -------------------------------------------------------------------------- */
/* Material sets                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One surface in an era's material set. `id` is the handle the builders and the
 * era data use (`'body-enamel'`, `'trim-chrome'`, `'panel-legend'`), so a
 * machine can wear two different stainless tones without a name clash.
 */
export interface MachineMaterialRecipe {
  readonly id: string;
  readonly label: string;
  readonly kind: MachineTextureKind;
  readonly palette: MachineTexturePalette;
  readonly roughness: number;
  readonly metalness: number;
  readonly scale?: number;
  readonly contrast?: number;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly repeat?: readonly [number, number];
  readonly size?: number;
  readonly transparency?: 'none' | 'pattern';
  readonly wear?: number;
  readonly seed?: number;
  readonly legend?: LegendSpec;
  readonly needle?: number;
  readonly grid?: number;
  /** Emissive parts: pilot lamps, LCD glow, backlit touch keys. */
  readonly emissive?: {
    readonly color: string;
    readonly intensity: number;
    /** Reuse the surface map as the emissive map (readouts, backlit panels). */
    readonly map?: boolean;
  };
  readonly opacity?: number;
  readonly transparent?: boolean;
  readonly side?: 'front' | 'double';
  readonly flatShading?: boolean;
}

export interface MachineMaterialSet {
  readonly id: string;
  readonly year: YearId;
  readonly recipes: readonly MachineMaterialRecipe[];
  /** Materials by recipe id. */
  readonly materials: ReadonlyMap<string, THREE.MeshStandardMaterial>;
  /** Every texture the set allocated, in creation order. */
  readonly textures: readonly MachineTexture[];
  /** Stable hash of the recipes (id, kind, palette, finish, wear). */
  readonly signature: string;
}

export interface MachineMaterialSetInput {
  readonly id: string;
  readonly year: YearId;
  readonly recipes: readonly MachineMaterialRecipe[];
  readonly canvasFactory?: CanvasFactory;
  /** Overrides each recipe's resolution. */
  readonly textureSize?: number;
  readonly anisotropy?: number;
}

/**
 * Terse recipe builder for the era data files: label, surface family, base and
 * accent colour, then the finish's roughness/metalness and any extra style.
 */
export function machineRecipe(
  id: string,
  label: string,
  kind: MachineTextureKind,
  base: string,
  accent: string,
  roughness: number,
  metalness: number,
  extra: Omit<MachineMaterialRecipe, 'id' | 'label' | 'kind' | 'palette' | 'roughness' | 'metalness'> & {
    readonly detail?: string;
    readonly highlight?: string;
  } = {},
): MachineMaterialRecipe {
  const { detail, highlight, ...rest } = extra;
  return {
    id,
    label,
    kind,
    palette: { base, accent, detail, highlight },
    roughness,
    metalness,
    ...rest,
  };
}

/** Stable signature of a recipe list (used by diagnostics and the tests). */
export function machineMaterialSignature(recipes: readonly MachineMaterialRecipe[]): string {
  const parts = recipes.map((recipe) =>
    [
      recipe.id,
      recipe.kind,
      recipe.palette.base,
      recipe.palette.accent,
      recipe.palette.detail ?? '',
      recipe.palette.highlight ?? '',
      recipe.roughness.toFixed(3),
      recipe.metalness.toFixed(3),
      recipe.wear ?? 0,
      recipe.opacity ?? 1,
      recipe.transparent === true ? 't' : '-',
      recipe.legend?.title ?? '',
      recipe.legend?.digits ?? '',
    ].join(':'),
  );
  return hashString(parts.join('|')).toString(16).padStart(8, '0');
}

/** Builds every material an era needs, one procedural texture per recipe. */
export function createMachineMaterialSet(input: MachineMaterialSetInput): MachineMaterialSet {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const textures: MachineTexture[] = [];

  for (const recipe of input.recipes) {
    if (materials.has(recipe.id)) {
      throw new Error(`Machine material set "${input.id}" declares the surface id "${recipe.id}" twice.`);
    }
    const size = recipe.size ?? input.textureSize ?? DEFAULT_MACHINE_TEXTURE_SIZE;
    const texture = createMachineTexture(
      {
        kind: recipe.kind,
        palette: recipe.palette,
        scale: recipe.scale,
        contrast: recipe.contrast,
        orientation: recipe.orientation,
        repeat: recipe.repeat,
        size,
        transparency: recipe.transparency,
        wear: recipe.wear,
        seed: recipe.seed,
        legend: recipe.legend,
        needle: recipe.needle,
        grid: recipe.grid,
      },
      { key: `${input.year}:${recipe.id}`, canvasFactory: input.canvasFactory, anisotropy: input.anisotropy },
    );
    textures.push(texture);

    const material = new THREE.MeshStandardMaterial({
      name: `machine:${input.id}:${recipe.id}`,
      map: texture.texture,
      roughness: recipe.roughness,
      metalness: recipe.metalness,
      transparent: recipe.transparent ?? false,
      opacity: recipe.opacity ?? 1,
      flatShading: recipe.flatShading ?? false,
      side: recipe.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (recipe.emissive) {
      material.emissive = new THREE.Color(recipe.emissive.color);
      material.emissiveIntensity = recipe.emissive.intensity;
      if (recipe.emissive.map) material.emissiveMap = texture.texture;
    }
    if (recipe.transparency === 'pattern') {
      material.transparent = true;
      material.depthWrite = false;
    }
    materials.set(recipe.id, material);
  }

  return {
    id: input.id,
    year: input.year,
    recipes: Object.freeze([...input.recipes]),
    materials,
    textures: Object.freeze(textures),
    signature: `machine-set:${input.year}:${input.id}:${machineMaterialSignature(input.recipes)}`,
  };
}

/** Surface ids the set exposes, in recipe order. */
export function machineSurfaceIds(set: MachineMaterialSet): readonly string[] {
  return set.recipes.map((recipe) => recipe.id);
}

/** True when the set declares `id`. */
export function hasMachineSurface(set: MachineMaterialSet, id: string): boolean {
  return set.materials.has(id);
}

/** Material for `id`; throws when the era's data never declared it (a bug). */
export function machineSurface(set: MachineMaterialSet, id: string): THREE.MeshStandardMaterial {
  const material = set.materials.get(id);
  if (!material) {
    throw new Error(
      `Machine material set "${set.id}" has no surface "${id}". Declared: ${machineSurfaceIds(set).join(', ')}.`,
    );
  }
  return material;
}

/** Releases every material and texture of the set (safe to call twice). */
export function disposeMachineMaterialSet(set: MachineMaterialSet): void {
  for (const texture of set.textures) texture.texture.dispose();
  for (const material of set.materials.values()) material.dispose();
  (set.materials as Map<string, THREE.MeshStandardMaterial>).clear();
}

/** Meshes from this module can be recognised by their material's name. */
export function isMachineMaterial(material: THREE.Material): boolean {
  return material.name.startsWith('machine:');
}

/** FONT metric re-export so panel layout code can stay in one place. */
export const MACHINE_GLYPH_WIDTH = FONT_GLYPH_WIDTH;
