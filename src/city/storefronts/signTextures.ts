/**
 * Chrono City — era signage typography and animated sign media.
 *
 * Every piece of lettering in the storefront band is painted here into a
 * `CanvasTexture`: shop fascias, awning valances, transom posters, billboards and
 * LED/video/holographic media faces. There are no font files, sprite sheets or
 * runtime image fetches anywhere in the pipeline.
 *
 * How a sign is built
 * -------------------
 *  1. the *substrate* comes from a `MaterialLibrary` surface generator
 *     (`paintedSign` for boards, enamel, newsprint and lightboxes, `neon` for
 *     tube beds and LED panels, `glassCurtainWall` for screens and holograms), so
 *     boards share the library's weathered, procedurally-noisy craft look;
 *  2. the substrate is drawn into a canvas whose aspect ratio *exactly* matches
 *     the sign face, so glyphs are never stretched;
 *  3. the era's authored lettering style — font stack, case, tracking and weight
 *     from `getEraDescriptor(era).typography` — is painted with per-character
 *     jitter, glow and period styling (hand-painted brush, gilded enamel, block,
 *     neon tube, pixel/LED, holographic shimmer);
 *  4. animated media bake 1–4 frames into the same texture as a cell grid, and
 *     `SignMaterialHandle` walks the frames / scrolls / flickers with pure UV and
 *     emissive changes — the animation cost of a screen is one `offset.set()`.
 *
 * Lifecycle:
 *   create    → `createSignTexture(spec, random)` for a face;
 *               `createSignMaterialHandle({ handle })` for a lit, animating face.
 *   consume   → content builders map the handle's texture onto their geometry and
 *               read `handle.layout` / `handle.letteredText` for HUD + audit.
 *   integrate → `StorefrontsApi` ticks every visible handle once per frame and
 *               disposes the textures it created (see `handle.dispose()`).
 */

import * as THREE from 'three';

import { assertEraId, clamp01, type EraId } from '../../core/eraContracts';
import type { RandomSource } from '../../core/sceneContext';
import { getEraDescriptor, type EraSignageCase } from '../../era/eraDescriptors';
import {
  createSurfaceRandom,
  generateSurfaceTexture,
  type SurfaceKind,
} from '../../materials/materialLibrary';

export const SIGN_TEXTURES_VERSION = 1;

/** Narrowest/longest edge a sign canvas may be sized to, in px. */
export const MIN_SIGN_EDGE_PX = 128;
export const MAX_SIGN_EDGE_PX = 1024;
/** Smallest sprite cell in a multi-frame atlas, in px. */
export const MIN_SIGN_CELL_PX = 24;
/** Most animation frames baked into one sign atlas. */
export const MAX_SIGN_FRAMES = 4;
/** Longest edge used when a spec does not ask for one. */
export const DEFAULT_SIGN_EDGE_PX = 512;
/**
 * Widest edge an atlas *substrate* is generated at. The substrate is tiled at
 * native scale, so a modest square keeps board grain 1:1 while spending a
 * fraction of the boot cost a full-size board texture would.
 */
export const MAX_SUBSTRATE_PX = 384;
/** Shortest substrate edge worth generating. */
export const MIN_SUBSTRATE_PX = 256;

/* ------------------------------------------------------------------------- *
 * Media technology
 * ------------------------------------------------------------------------- */

/**
 * The advertising technologies a sign face can be printed, painted or lit with.
 * Media — not eras — decide how a face is built, so 1965 neon and 1985 neon share
 * one code path while 1945 paint and 2025 LED do not.
 */
export type SignMedia =
  | 'painted'
  | 'enamel'
  | 'paper'
  | 'neon'
  | 'bulbMarquee'
  | 'backlit'
  | 'print'
  | 'video'
  | 'led'
  | 'hologram';

/** Every media id, in the order they are documented. */
export const SIGN_MEDIA: readonly SignMedia[] = Object.freeze([
  'painted',
  'enamel',
  'paper',
  'neon',
  'bulbMarquee',
  'backlit',
  'print',
  'video',
  'led',
  'hologram',
]);

/** `true` when `value` is one of the ten known sign media. */
export function isSignMedia(value: unknown): value is SignMedia {
  return typeof value === 'string' && (SIGN_MEDIA as readonly string[]).includes(value);
}

/**
 * How a sign face animates. Every mode is deliberately cheap: a baked frame
 * lookup (UV offset), an emissive breathe/flicker, or an opacity pulse — never a
 * canvas repaint.
 */
export type SignAnimation =
  | 'none'
  | 'flicker'
  | 'pulse'
  | 'chase'
  | 'rollFrames'
  | 'scroll'
  | 'shimmer';

/** Lettering treatment: what the glyphs are made of, not which font they use. */
export type LetteringStyle = 'brush' | 'gilded' | 'block' | 'tube' | 'pixel' | 'shimmer';

/** Craft defaults for one medium: substrate, lettering, glow and animation. */
export interface SignMediaDefaults {
  /** Which `MaterialLibrary` surface generator backs the face. */
  readonly surface: SurfaceKind;
  readonly lettering: LetteringStyle;
  readonly animation: SignAnimation;
  /** Animation cycles per second (or frames per second for frame modes). */
  readonly animationSpeed: number;
  /** Emissive intensity at full brightness; `0`–`2` reads best in-scene. */
  readonly emissiveIntensity: number;
  readonly opacity: number;
  /** Wear handed to the substrate generator. */
  readonly wear: number;
  /** Lettering halo, as a fraction of cap height. `0` = none. */
  readonly glow: number;
  /** Hand-painted irregularity (per-glyph jitter), as a fraction of cap height. */
  readonly jitter: number;
  /** Animation frames baked into the atlas (`1` = static). */
  readonly frames: number;
  readonly roughness: number;
  readonly metalness: number;
}

/** Per-medium craft defaults. Era content overrides palettes, not these. */
export const SIGN_MEDIA_DEFAULTS: Readonly<Record<SignMedia, SignMediaDefaults>> = Object.freeze({
  painted: {
    surface: 'paintedSign',
    lettering: 'brush',
    animation: 'none',
    animationSpeed: 0,
    emissiveIntensity: 0.2,
    opacity: 1,
    wear: 0.55,
    glow: 0.1,
    jitter: 0.5,
    frames: 1,
    roughness: 0.78,
    metalness: 0.04,
  },
  enamel: {
    surface: 'paintedSign',
    lettering: 'gilded',
    animation: 'none',
    animationSpeed: 0,
    emissiveIntensity: 0.34,
    opacity: 1,
    wear: 0.32,
    glow: 0.16,
    jitter: 0.22,
    frames: 1,
    roughness: 0.42,
    metalness: 0.18,
  },
  paper: {
    surface: 'paintedSign',
    lettering: 'block',
    animation: 'none',
    animationSpeed: 0,
    emissiveIntensity: 0.06,
    opacity: 1,
    wear: 0.72,
    glow: 0,
    jitter: 0.28,
    frames: 1,
    roughness: 0.92,
    metalness: 0,
  },
  neon: {
    surface: 'neon',
    lettering: 'tube',
    animation: 'flicker',
    animationSpeed: 7.5,
    emissiveIntensity: 1.7,
    opacity: 1,
    wear: 0.3,
    glow: 0.8,
    jitter: 0.06,
    frames: 1,
    roughness: 0.34,
    metalness: 0.1,
  },
  bulbMarquee: {
    surface: 'neon',
    lettering: 'block',
    animation: 'chase',
    animationSpeed: 4.5,
    emissiveIntensity: 1.45,
    opacity: 1,
    wear: 0.22,
    glow: 0.38,
    jitter: 0.05,
    frames: 2,
    roughness: 0.4,
    metalness: 0.15,
  },
  backlit: {
    surface: 'paintedSign',
    lettering: 'block',
    animation: 'pulse',
    animationSpeed: 0.55,
    emissiveIntensity: 1.05,
    opacity: 1,
    wear: 0.16,
    glow: 0.3,
    jitter: 0.03,
    frames: 1,
    roughness: 0.24,
    metalness: 0.06,
  },
  print: {
    surface: 'paintedSign',
    lettering: 'block',
    animation: 'none',
    animationSpeed: 0,
    emissiveIntensity: 0.1,
    opacity: 1,
    wear: 0.14,
    glow: 0,
    jitter: 0.02,
    frames: 1,
    roughness: 0.5,
    metalness: 0,
  },
  video: {
    surface: 'glassCurtainWall',
    lettering: 'block',
    animation: 'rollFrames',
    animationSpeed: 3.2,
    emissiveIntensity: 1.4,
    opacity: 1,
    wear: 0.04,
    glow: 0.22,
    jitter: 0,
    frames: 4,
    roughness: 0.18,
    metalness: 0.1,
  },
  led: {
    surface: 'neon',
    lettering: 'pixel',
    animation: 'scroll',
    animationSpeed: 0.24,
    emissiveIntensity: 1.85,
    opacity: 1,
    wear: 0.05,
    glow: 0.5,
    jitter: 0,
    frames: 1,
    roughness: 0.3,
    metalness: 0.06,
  },
  hologram: {
    surface: 'glassCurtainWall',
    lettering: 'shimmer',
    animation: 'shimmer',
    animationSpeed: 0.32,
    emissiveIntensity: 1.6,
    opacity: 0.86,
    wear: 0.02,
    glow: 0.65,
    jitter: 0,
    frames: 2,
    roughness: 0.12,
    metalness: 0.22,
  },
});

/** Craft defaults for one medium, or the `painted` defaults for unknown input. */
export function signMediaDefaults(media: SignMedia): SignMediaDefaults {
  return SIGN_MEDIA_DEFAULTS[media] ?? SIGN_MEDIA_DEFAULTS.painted;
}

/* ------------------------------------------------------------------------- *
 * Lettering style
 * ------------------------------------------------------------------------- */

/** Colours one sign face is painted with. All values are CSS colour strings. */
export interface SignPalette {
  /** Board / backing colour; also the substrate's base tone. */
  readonly board: string;
  /** Lettering colour. */
  readonly ink: string;
  /** Halo and emissive colour. */
  readonly glow: string;
  /** Frame, rule and mounting trim colour. */
  readonly trim?: string;
}

/** Role a text block plays on a face; the role picks the glyph size. */
export type SignTextRole = 'title' | 'subtitle' | 'tagline' | 'price' | 'list';

/** One line (or short block) of lettering inside a sign face. */
export interface SignTextBlock {
  readonly text: string;
  readonly role?: SignTextRole;
  /** Explicit size override, as a fraction of the face height. */
  readonly scale?: number;
}

/** The era's authored lettering treatment, read from the era descriptors. */
export interface EraLettering {
  readonly fontStack: string;
  readonly bodyFontStack: string;
  readonly signageCase: EraSignageCase;
  readonly letterSpacingEm: number;
  readonly weight: number;
  /** Free-form description of the era's signage style, for HUD/docs. */
  readonly style: string;
  /** Era slogans, used as advertising copy by the ad factory. */
  readonly slogans: readonly string[];
}

/** Reads the era's typography + signage descriptors for lettering. */
export function eraLettering(era: EraId | string): EraLettering {
  const descriptor = getEraDescriptor(era);
  return Object.freeze({
    fontStack: descriptor.typography.displayFont,
    bodyFontStack: descriptor.typography.bodyFont,
    signageCase: descriptor.typography.signageCase,
    letterSpacingEm: descriptor.typography.letterSpacingEm,
    weight: descriptor.typography.headingWeight,
    style: descriptor.signage.style,
    slogans: Object.freeze([...descriptor.signage.slogans]),
  });
}

/** Applies an era's authored case rule to a piece of sign lettering. */
export function transformSignCase(text: string, signageCase: EraSignageCase): string {
  switch (signageCase) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    default:
      return text;
  }
}

/** Default glyph size per role, as a fraction of the face height. */
export const SIGN_ROLE_SCALE: Readonly<Record<SignTextRole, number>> = Object.freeze({
  title: 0.42,
  subtitle: 0.2,
  tagline: 0.16,
  price: 0.19,
  list: 0.13,
});

/* ------------------------------------------------------------------------- *
 * Face layout
 * ------------------------------------------------------------------------- */

/** One laid-out lettering row inside a face cell. */
export interface SignRow {
  readonly text: string;
  readonly role: SignTextRole;
  /** Cap height in px. */
  readonly px: number;
  /** Baseline distance from the cell's top edge, in px. */
  readonly baseline: number;
  readonly align: 'left' | 'center';
  readonly lettering: LetteringStyle;
}

/** A laid-out face: where every row of lettering lands, in px. */
export interface SignFaceLayout {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly rows: readonly SignRow[];
  readonly fontStack: string;
  /** Largest row's cap height, in px. */
  readonly capPx: number;
}

/** Lays out one face's rows inside a cell of the given size. */
export function layoutSignFace(
  blocks: readonly SignTextBlock[],
  options: {
    readonly cellWidth: number;
    readonly cellHeight: number;
    readonly fontStack: string;
    readonly signageCase: EraSignageCase;
    readonly lettering: LetteringStyle;
  },
): SignFaceLayout {
  const usable = blocks.filter((block) => block.text.trim().length > 0);
  const wanted: Array<{ text: string; role: SignTextRole; px: number; align: 'left' | 'center' }> = [];

  for (const block of usable) {
    const role: SignTextRole = block.role ?? 'title';
    const scale = block.scale ?? SIGN_ROLE_SCALE[role];
    const px = Math.max(7, options.cellHeight * clamp01(scale));
    wanted.push({
      text: transformSignCase(block.text.trim(), options.signageCase),
      role,
      px,
      align: role === 'list' ? 'left' : 'center',
    });
  }

  const lineHeight = 1.26;
  let total = wanted.reduce((sum, row) => sum + row.px * lineHeight, 0);
  const budget = options.cellHeight * 0.86;
  const shrink = total > budget && total > 0 ? budget / total : 1;
  if (shrink < 1) {
    for (const row of wanted) row.px *= shrink;
    total = budget;
  }

  const rows: SignRow[] = [];
  let cursor = (options.cellHeight - total) / 2;
  for (const row of wanted) {
    const advance = row.px * lineHeight;
    rows.push(
      Object.freeze({
        text: row.text,
        role: row.role,
        px: row.px,
        baseline: cursor + row.px * 0.82,
        align: row.align,
        lettering: options.lettering,
      }),
    );
    cursor += advance;
  }

  const capPx = rows.reduce((max, row) => Math.max(max, row.px), 0);
  return Object.freeze({
    cellWidth: options.cellWidth,
    cellHeight: options.cellHeight,
    rows: Object.freeze(rows),
    fontStack: options.fontStack,
    capPx,
  });
}

/** The plain text of a face after the era's case rule, joined for audit/HUD. */
export function signFaceText(
  blocks: readonly SignTextBlock[],
  signageCase: EraSignageCase,
): string {
  return blocks
    .map((block) => transformSignCase(block.text.trim(), signageCase))
    .filter((text) => text.length > 0)
    .join(' | ');
}

/* ------------------------------------------------------------------------- *
 * Texture spec + handle
 * ------------------------------------------------------------------------- */

/** Everything needed to paint one sign face (or a short animation loop). */
export interface SignFaceSpec {
  readonly era: EraId;
  readonly media: SignMedia;
  readonly palette: SignPalette;
  /** Frame 0's lettering. */
  readonly blocks: readonly SignTextBlock[];
  /** Extra animation frames (video reels, chasing marquees, holograms). */
  readonly alternates?: readonly (readonly SignTextBlock[])[];
  /** Real-world face size in metres; fixes the atlas aspect ratio. */
  readonly widthMeters: number;
  readonly heightMeters: number;
  /** Longest canvas edge in px. Defaults to `DEFAULT_SIGN_EDGE_PX`. */
  readonly longEdge?: number;
  /** Stable cache/determinism key. Derived from the content when omitted. */
  readonly key?: string;
  /** Painted frame line around the face. Defaults to `true`. */
  readonly border?: boolean;
  /** Overrides the medium's substrate wear. */
  readonly wear?: number;
  /** Free-form note carried into `handle.userData` and draw calls. */
  readonly note?: string;
}

/** The built canvas + texture of one sign face. */
export interface SignTextureHandle {
  readonly version: number;
  readonly era: EraId;
  readonly media: SignMedia;
  readonly key: string;
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly width: number;
  readonly height: number;
  /** Animation frames baked into the atlas (`1` = static). */
  readonly frames: number;
  /** Atlas grid (frames tile along `columns` when the face is tall). */
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** Aspect ratio the canvas was fitted to (`width / height` in metres). */
  readonly aspect: number;
  /** Per-frame laid-out faces. */
  readonly layouts: readonly SignFaceLayout[];
  /** Lettered text painted for each frame, in paint order. */
  readonly letteredText: readonly string[];
  /** Human-readable record of every op painted onto the canvas. */
  readonly drawCalls: readonly string[];
  /** Era lettering treatment used for this face. */
  readonly lettering: EraLettering;
  readonly rasterized: boolean;
  /** `[u, v]` UV offset that samples frame `frame`. */
  frameUv(frame: number): readonly [number, number];
  /** UV repeat the face's sampler must use. */
  readonly repeat: readonly [number, number];
  dispose(): void;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error(
      'createSignTexture() needs a DOM document; run it in the browser or a DOM-capable test environment.',
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/** Cheap deterministic hash in `[0, 1)` — used for hand-painted jitter and flicker. */
export function signNoise(value: number): number {
  const raw = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return raw - Math.floor(raw);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/* ------------------------------------------------------------------------- *
 * Lettering painter
 * ------------------------------------------------------------------------- */

interface LetteringRun {
  readonly text: string;
  readonly fontStack: string;
  readonly px: number;
  readonly weight: number;
  readonly ink: string;
  readonly glow: string;
  readonly lettering: LetteringStyle;
  readonly letterSpacing: number;
  readonly jitter: number;
  readonly align: 'left' | 'center';
  readonly baseline: number;
  readonly cellWidth: number;
}

function inkWithAlpha(color: string, alpha: number): string {
  const value = clamp01(alpha);
  if (value >= 0.999) return color;
  const trimmed = color.startsWith('#') ? color.slice(1) : color;
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    return `rgba(0, 0, 0, ${value.toFixed(3)})`;
  }
  const full =
    trimmed.length === 3
      ? trimmed
          .split('')
          .map((character) => character + character)
          .join('')
      : trimmed;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${value.toFixed(3)})`;
}

/** Measures one run of text with per-glyph tracking applied. */
function measureRun(
  ctx: CanvasRenderingContext2D,
  run: LetteringRun,
  font: string,
): { advances: number[]; total: number; spacing: number } {
  ctx.font = font;
  const advances = Array.from(run.text, (character) => ctx.measureText(character).width);
  const spacing = run.px * run.letterSpacing;
  const total =
    advances.reduce((sum, advance) => sum + advance, 0) + spacing * Math.max(0, advances.length - 1);
  return { advances, total, spacing };
}

/** Human-readable record of one lettering op, drawn or not. */
function describeLettering(run: LetteringRun, px: number): string {
  const family = run.fontStack.split(',')[0]?.replace(/"/g, '') ?? 'sans';
  return `lettering("${run.text}" font=${family} px=${px.toFixed(1)} ink=${run.ink} glow=${run.glow} style=${run.lettering} jitter=${(px * run.jitter).toFixed(2)})`;
}

/**
 * Shrinks the run until it fits the cell, then draws one glyph at a time.
 *
 * `ctx` may be `null` (a headless DOM without a 2D canvas implementation): the
 * op is still recorded in the draw list, which keeps the audit trail complete
 * and lets the layout be verified without a rasteriser.
 */
function paintLettering(
  ctx: CanvasRenderingContext2D | null,
  run: LetteringRun,
  random: RandomSource,
  drawCalls: string[],
): void {
  if (run.text.length === 0 || run.px <= 1) return;

  if (!ctx) {
    drawCalls.push(describeLettering(run, run.px));
    return;
  }

  let px = run.px;
  let font = `${run.weight} ${px.toFixed(2)}px ${run.fontStack}`;
  let measured = measureRun(ctx, run, font);
  const maxWidth = run.cellWidth * 0.88;
  let guard = 0;
  while (measured.total > maxWidth && px > 6 && guard < 6) {
    px = Math.max(6, px * (maxWidth / measured.total));
    font = `${run.weight} ${px.toFixed(2)}px ${run.fontStack}`;
    measured = measureRun(ctx, run, font);
    guard += 1;
  }

  const jitterPx = px * run.jitter;
  const startX =
    run.align === 'center'
      ? (run.cellWidth - measured.total) / 2
      : run.cellWidth * 0.14;

  drawCalls.push(describeLettering(run, px));

  const core = run.lettering === 'shimmer' ? '#ffffff' : run.glow;

  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (run.lettering === 'pixel') {
    // LED panels: render small, then blit with smoothing off for blocky glyphs.
    const scale = Math.max(2, Math.round(px / 6));
    const lowWidth = Math.max(4, Math.ceil(measured.total / scale) + 2);
    const lowHeight = Math.max(4, Math.ceil(px * 1.6 / scale) + 2);
    const low = createCanvas(lowWidth, lowHeight);
    const lowCtx = low.getContext('2d');
    if (lowCtx) {
      lowCtx.font = `${run.weight} ${Math.max(4, px / scale).toFixed(2)}px ${run.fontStack}`;
      lowCtx.textBaseline = 'alphabetic';
      lowCtx.fillStyle = run.glow;
      let cursor = 1;
      for (let index = 0; index < run.text.length; index += 1) {
        lowCtx.fillText(run.text[index] as string, cursor, lowHeight - 2);
        cursor += (measured.advances[index] as number) / scale + measured.spacing / scale;
      }
    }
    ctx.globalAlpha = 1;
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      low,
      startX,
      run.baseline - px * 1.35,
      lowWidth * scale,
      lowHeight * scale,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
    ctx.restore();
    return;
  }

  let cursor = startX;
  for (let index = 0; index < run.text.length; index += 1) {
    const character = run.text[index] as string;
    const advance = measured.advances[index] as number;
    const wobbleX = (random.next() - 0.5) * jitterPx * 0.6;
    const wobbleY = (random.next() - 0.5) * jitterPx;
    const tilt = (random.next() - 0.5) * jitterPx * 0.012;
    const centerX = cursor + advance / 2 + wobbleX;

    ctx.save();
    ctx.translate(centerX, run.baseline + wobbleY * 0.35);
    ctx.rotate(tilt);
    ctx.textAlign = 'center';

    switch (run.lettering) {
      case 'tube': {
        // Neon: a rounded stroke for the tube body, then a bright core.
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = run.glow;
        ctx.shadowBlur = px * 1.05;
        ctx.strokeStyle = run.glow;
        ctx.lineWidth = px * 0.17;
        ctx.strokeText(character, 0, 0);
        ctx.shadowBlur = px * 0.4;
        ctx.strokeText(character, 0, 0);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = core;
        ctx.lineWidth = px * 0.07;
        ctx.strokeText(character, 0, 0);
        break;
      }
      case 'gilded': {
        // Enamel + gilding: flat ink, a pale bevel and a thin bright rule.
        ctx.fillStyle = run.ink;
        ctx.fillText(character, 0, 0);
        ctx.strokeStyle = inkWithAlpha(run.glow, 0.9);
        ctx.lineWidth = Math.max(0.6, px * 0.045);
        ctx.strokeText(character, -px * 0.02, -px * 0.02);
        ctx.fillStyle = inkWithAlpha(core, 0.5);
        ctx.fillText(character, -px * 0.03, -px * 0.05);
        break;
      }
      case 'shimmer': {
        // Hologram: vertical iridescent ramp plus bloom.
        const gradient = ctx.createLinearGradient(0, -px, 0, px * 0.3);
        gradient.addColorStop(0, inkWithAlpha(core, 0.45));
        gradient.addColorStop(0.55, run.ink);
        gradient.addColorStop(1, inkWithAlpha(run.glow, 0.85));
        ctx.shadowColor = run.glow;
        ctx.shadowBlur = px * 0.85;
        ctx.fillStyle = gradient;
        ctx.fillText(character, 0, 0);
        ctx.shadowBlur = 0;
        break;
      }
      case 'brush': {
        // Hand-painted: two overlapping wet passes with slightly different ink.
        ctx.fillStyle = run.ink;
        ctx.fillText(character, 0, 0);
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = inkWithAlpha(run.glow, 0.7);
        ctx.fillText(character, -px * 0.04, px * 0.05);
        ctx.globalAlpha = 1;
        break;
      }
      default: {
        // Blocked signwriting: solid face with an optional glow.
        if (run.glow && run.glow !== run.ink) {
          ctx.shadowColor = run.glow;
          ctx.shadowBlur = px * 0.35;
        }
        ctx.fillStyle = run.ink;
        ctx.fillText(character, 0, 0);
        ctx.shadowBlur = 0;
        break;
      }
    }

    ctx.restore();
    cursor += advance + measured.spacing;
  }

  ctx.restore();
}

/* ------------------------------------------------------------------------- *
 * Face decoration
 * ------------------------------------------------------------------------- */

function paintFrame(
  ctx: CanvasRenderingContext2D | null,
  width: number,
  height: number,
  palette: SignPalette,
  drawCalls: string[],
  insetRatio = 0.045,
): void {
  const inset = Math.max(1.5, Math.min(width, height) * insetRatio);
  const trim = palette.trim ?? palette.ink;
  drawCalls.push(`frame-line(trim=${trim} inset=${inset.toFixed(1)})`);
  if (!ctx) return;
  ctx.strokeStyle = inkWithAlpha(trim, 0.92);
  ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.035);
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
}

function paintBulbRow(
  ctx: CanvasRenderingContext2D | null,
  width: number,
  height: number,
  palette: SignPalette,
  round: number,
  count: number,
  drawCalls: string[],
): void {
  const radius = Math.max(1, height * 0.055);
  const y = (round === 0 ? 1 : -1) * (height / 2 - radius * 2.2) + height / 2;
  drawCalls.push(`bulbs(count=${count} r=${radius.toFixed(1)} y=${y.toFixed(1)})`);
  if (!ctx) return;
  ctx.fillStyle = palette.glow;
  for (let index = 0; index < count; index += 1) {
    const x = (width * (index + 0.5)) / count;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintScanlines(
  ctx: CanvasRenderingContext2D | null,
  width: number,
  height: number,
  color: string,
  count: number,
  drawCalls: string[],
): void {
  drawCalls.push(`scanlines(count=${count})`);
  if (!ctx) return;
  ctx.fillStyle = inkWithAlpha(color, 0.22);
  const step = height / count;
  for (let index = 0; index < count; index += 1) {
    ctx.fillRect(0, index * step, width, Math.max(0.6, step * 0.28));
  }
}

function paintShimmerBands(
  ctx: CanvasRenderingContext2D | null,
  width: number,
  height: number,
  palette: SignPalette,
  random: RandomSource,
  drawCalls: string[],
): void {
  const bands = 3 + Math.round(random.next() * 3);
  drawCalls.push(`shimmer-bands(count=${bands})`);
  if (!ctx) return;
  for (let index = 0; index < bands; index += 1) {
    const y = random.float(0.1, 0.9) * height;
    const bandHeight = random.float(0.02, 0.06) * height;
    const gradient = ctx.createLinearGradient(0, y, 0, y + bandHeight);
    gradient.addColorStop(0, inkWithAlpha(palette.glow, 0));
    gradient.addColorStop(0.5, inkWithAlpha(palette.glow, random.float(0.2, 0.45)));
    gradient.addColorStop(1, inkWithAlpha(palette.glow, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, width, bandHeight);
  }
}

/** Everything one sign face cell is painted from. */
interface SignCellPaint {
  /** `null` on a headless DOM: ops are still recorded, just not rasterised. */
  readonly ctx: CanvasRenderingContext2D | null;
  readonly spec: SignFaceSpec;
  readonly layout: SignFaceLayout;
  readonly grid: SignAtlasGrid;
  readonly frame: number;
  /** Lit media get a dark screen wash so the lettering reads at night. */
  readonly lit: boolean;
  readonly weight: number;
  readonly letterSpacing: number;
  readonly jitter: number;
  readonly stream: RandomSource;
  readonly drawCalls: string[];
}

/**
 * Paints one frame cell: screen wash or border, lettering, then the medium's own
 * decoration (bulb rows, scanlines, shimmer bands, LED matrix lines). Works with
 * or without a rasteriser so the draw-call audit stays complete headless.
 */
function paintSignCell(paint: SignCellPaint): void {
  const { ctx, spec, layout, grid, frame, lit, stream, drawCalls } = paint;

  if (lit) {
    if (ctx) {
      ctx.fillStyle = inkWithAlpha('#05060c', spec.media === 'hologram' ? 0.42 : 0.72);
      ctx.fillRect(0, 0, grid.cellWidth, grid.cellHeight);
    }
    drawCalls.push(
      `screen-wash(media=${spec.media} a=${spec.media === 'hologram' ? '0.42' : '0.72'})`,
    );
  } else if (frame === 0 && spec.border !== false) {
    paintFrame(ctx, grid.cellWidth, grid.cellHeight, spec.palette, drawCalls);
  }

  for (const signRow of layout.rows) {
    paintLettering(
      ctx,
      {
        text: signRow.text,
        fontStack: layout.fontStack,
        px: signRow.px,
        weight: paint.weight,
        ink: spec.palette.ink,
        glow: spec.palette.glow,
        lettering: signRow.lettering,
        letterSpacing: paint.letterSpacing,
        jitter: paint.jitter,
        align: signRow.align,
        baseline: signRow.baseline,
        cellWidth: grid.cellWidth,
      },
      stream,
      drawCalls,
    );
  }

  if (spec.media === 'bulbMarquee') {
    paintBulbRow(ctx, grid.cellWidth, grid.cellHeight, spec.palette, 0, 18, drawCalls);
    paintBulbRow(ctx, grid.cellWidth, grid.cellHeight, spec.palette, 1, 18, drawCalls);
  }
  if (spec.media === 'video') {
    paintScanlines(ctx, grid.cellWidth, grid.cellHeight, spec.palette.glow, 14, drawCalls);
  }
  if (spec.media === 'hologram') {
    paintShimmerBands(ctx, grid.cellWidth, grid.cellHeight, spec.palette, stream, drawCalls);
    drawCalls.push(`hologram-frame(index=${frame})`);
  }
  if (spec.media === 'led') {
    if (ctx) {
      ctx.fillStyle = inkWithAlpha('#000000', 0.35);
      const dot = Math.max(1, grid.cellHeight * 0.03);
      for (let y = 0; y < grid.cellHeight; y += dot * 2) {
        ctx.fillRect(0, y, grid.cellWidth, dot * 0.5);
      }
    }
    drawCalls.push('led-matrix-rows');
  }
}

/* ------------------------------------------------------------------------- *
 * Texture factory
 * ------------------------------------------------------------------------- */

/** Atlas geometry: how many frames fit along which axis for a given aspect. */
export interface SignAtlasGrid {
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
}

/** Fits an exact-aspect atlas for `frames` faces of the given face aspect. */
export function planSignAtlas(options: {
  readonly aspect: number;
  readonly frames: number;
  readonly longEdge: number;
}): SignAtlasGrid {
  // Very thin faces are real (an 11 m awning valance is 40:1); keep their true
  // aspect so their glyphs are squeezed by geometry, never by the texture.
  const aspect = clampNumber(options.aspect, 0.12, 64);
  const frames = Math.max(1, Math.min(MAX_SIGN_FRAMES, Math.round(options.frames)));
  const longEdge = Math.round(
    clampNumber(options.longEdge, MIN_SIGN_EDGE_PX, MAX_SIGN_EDGE_PX),
  );
  const wide = aspect >= 1;
  const columns = wide ? 1 : frames;
  const rows = wide ? frames : 1;

  let width = longEdge;
  let height = wide ? (longEdge * rows) / aspect : longEdge / (columns * aspect);
  let cellWidth = width / columns;
  let cellHeight = height / rows;

  // Keep cells legible and canvases inside the size cap, always scaling *both*
  // axes so a cell keeps the face's aspect ratio (glyphs must never stretch).
  const rescale = (factor: number): void => {
    width *= factor;
    height *= factor;
    cellWidth *= factor;
    cellHeight *= factor;
  };
  if (cellHeight < MIN_SIGN_CELL_PX) rescale(MIN_SIGN_CELL_PX / cellHeight);
  if (cellWidth < MIN_SIGN_CELL_PX) rescale(MIN_SIGN_CELL_PX / cellWidth);
  if (height > MAX_SIGN_EDGE_PX) rescale(MAX_SIGN_EDGE_PX / height);
  if (width > MAX_SIGN_EDGE_PX) rescale(MAX_SIGN_EDGE_PX / width);

  return Object.freeze({
    columns,
    rows,
    width: Math.round(width),
    height: Math.round(height),
    cellWidth: Math.round(cellWidth),
    cellHeight: Math.round(cellHeight),
  });
}

/** Derives a stable content key for a spec that does not carry one. */
export function signFaceKey(spec: SignFaceSpec): string {
  const lettering = eraLettering(spec.era);
  const faces = [spec.blocks, ...(spec.alternates ?? [])].map((blocks) =>
    signFaceText(blocks, lettering.signageCase),
  );
  return [
    spec.era,
    spec.media,
    spec.widthMeters.toFixed(2),
    spec.heightMeters.toFixed(2),
    spec.note ?? '',
    ...faces,
  ].join('|');
}

/**
 * Paints one era-appropriate sign face (plus any animation frames) and returns
 * the canvas texture the renderer uploads. The substrate comes from the shared
 * material library; the typography is drawn on top with the era's font stack.
 */
export function createSignTexture(
  spec: SignFaceSpec,
  random?: RandomSource | number,
): SignTextureHandle {
  const era = assertEraId(spec.era);
  if (!isSignMedia(spec.media)) {
    throw new RangeError(
      `Unknown sign media "${String(spec.media)}"; expected one of ${SIGN_MEDIA.join(', ')}.`,
    );
  }
  const widthMeters = Number.isFinite(spec.widthMeters) ? Math.abs(spec.widthMeters) : 1;
  const heightMeters = Number.isFinite(spec.heightMeters) ? Math.abs(spec.heightMeters) : 1;
  if (widthMeters <= 0 || heightMeters <= 0) {
    throw new RangeError('createSignTexture() needs positive face dimensions in metres.');
  }

  const defaults = signMediaDefaults(spec.media);
  const lettering = eraLettering(era);
  const aspect = widthMeters / heightMeters;
  const faces = [spec.blocks, ...(spec.alternates ?? [])]
    .slice(0, defaults.frames)
    .map((blocks) => blocks.filter((block) => block.text.trim().length > 0));
  if (faces.length === 0) faces.push([]);
  const frames = faces.length;

  const key = spec.key ?? signFaceKey(spec);
  const grid = planSignAtlas({
    aspect,
    frames,
    longEdge: spec.longEdge ?? DEFAULT_SIGN_EDGE_PX,
  });

  // 1. Substrate from the material library (no binary assets, seeded wear).
  const substrateSize = Math.round(
    clampNumber(
      Math.max(grid.width, grid.height) * 0.5,
      MIN_SUBSTRATE_PX,
      MAX_SUBSTRATE_PX,
    ),
  );
  const substrate = generateSurfaceTexture(
    {
      surface: defaults.surface,
      palette: {
        base: spec.palette.board,
        accent: spec.palette.ink,
        joint: spec.palette.trim ?? spec.palette.board,
        grime: spec.palette.trim ?? spec.palette.board,
        highlight: spec.palette.trim ?? spec.palette.ink,
        emissive: spec.palette.glow,
      },
      size: substrateSize,
      wear: clampNumber(spec.wear ?? defaults.wear, 0, 1),
      scale: 1,
      repeat: 1,
    },
    createSurfaceRandom(random, `${key}:substrate`),
  );

  // 2. Exact-aspect atlas canvas the face's UVs map onto.
  const canvas = createCanvas(grid.width, grid.height);
  const ctx = canvas.getContext('2d');
  const drawCalls: string[] = [
    `sign(era=${era} media=${spec.media} aspect=${aspect.toFixed(2)} grid=${grid.columns}x${grid.rows} cell=${grid.cellWidth}x${grid.cellHeight}${spec.note ? ` note=${spec.note}` : ''})`,
    `substrate(surface=${defaults.surface} size=${substrateSize} wear=${(spec.wear ?? defaults.wear).toFixed(2)})`,
  ];
  if (ctx) {
    // The substrate is square and the atlas rarely is, so it is tiled at native
    // scale: grain and wear stay 1:1 instead of smearing into streaks along a
    // ten-to-one fascia board or a forty-to-one awning valance.
    ctx.imageSmoothingEnabled = true;
    const tileSize = Math.max(MIN_SIGN_CELL_PX, substrate.width);
    const tilesX = Math.max(1, Math.ceil(grid.width / tileSize));
    const tilesY = Math.max(1, Math.ceil(grid.height / tileSize));
    for (let tileY = 0; tileY < tilesY; tileY += 1) {
      for (let tileX = 0; tileX < tilesX; tileX += 1) {
        ctx.drawImage(substrate.canvas, tileX * tileSize, tileY * tileSize);
      }
    }
    drawCalls.push(
      `substrate-tiles(${tilesX}x${tilesY} native=${tileSize})`,
    );
  }

  const stream = createSurfaceRandom(random, `${key}:lettering`);
  const layouts: SignFaceLayout[] = [];
  const letteredText: string[] = [];

  for (let frame = 0; frame < frames; frame += 1) {
    const blocks = faces[frame] as readonly SignTextBlock[];
    const column = frame % grid.columns;
    const row = Math.floor(frame / grid.columns);
    const cellX = column * grid.cellWidth;
    const cellY = row * grid.cellHeight;

    const layout = layoutSignFace(blocks, {
      cellWidth: grid.cellWidth,
      cellHeight: grid.cellHeight,
      fontStack: lettering.fontStack,
      signageCase: lettering.signageCase,
      lettering: defaults.lettering,
    });
    layouts.push(layout);
    letteredText.push(signFaceText(blocks, lettering.signageCase));

    const lit =
      defaults.emissiveIntensity >= 0.9 ||
      spec.media === 'video' ||
      spec.media === 'led' ||
      spec.media === 'hologram';
    if (ctx) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cellX, cellY, grid.cellWidth, grid.cellHeight);
      ctx.clip();
      ctx.translate(cellX, cellY);
    }
    paintSignCell({
      ctx,
      spec,
      layout,
      grid,
      frame,
      lit,
      weight: lettering.weight,
      letterSpacing: lettering.letterSpacingEm,
      jitter: defaults.jitter,
      stream,
      drawCalls,
    });
    if (ctx) ctx.restore();
  }

  // 3. The uploadable texture: one canvas, frame cells addressed by UV.
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `chrono-sign-${spec.media}-${era}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const repeat: readonly [number, number] = [1 / grid.columns, 1 / grid.rows];
  texture.repeat.set(repeat[0], repeat[1]);
  texture.userData.chronoSignKey = key;
  texture.userData.chronoSignMedia = spec.media;
  texture.userData.chronoSignEra = era;
  texture.userData.chronoSignFrames = frames;
  texture.userData.chronoSignText = letteredText.join(' | ');
  texture.needsUpdate = true;

  const frameUv = (frame: number): readonly [number, number] => {
    const index = Math.max(0, Math.min(frames - 1, Math.round(frame)));
    if (grid.columns > 1) return Object.freeze([index / grid.columns, 0] as const);
    // Canvas row 0 is the *top* of the image, which `flipY` maps to v = 1.
    return Object.freeze([0, (grid.rows - 1 - index) / grid.rows] as const);
  };
  texture.offset.set(frameUv(0)[0], frameUv(0)[1]);

  let disposed = false;
  return {
    version: SIGN_TEXTURES_VERSION,
    era,
    media: spec.media,
    key,
    canvas,
    texture,
    width: grid.width,
    height: grid.height,
    frames,
    columns: grid.columns,
    rows: grid.rows,
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
    aspect,
    layouts: Object.freeze(layouts),
    letteredText: Object.freeze(letteredText),
    drawCalls: Object.freeze(drawCalls),
    lettering,
    rasterized: ctx !== null,
    repeat,
    frameUv,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      texture.dispose();
      substrate.dispose();
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Animated, lit sign material
 * ------------------------------------------------------------------------- */

/** The animation state one material wrote on its last `advance()`. */
export interface SignAnimationState {
  readonly media: SignMedia;
  readonly animation: SignAnimation;
  readonly frame: number;
  /** Final UV offset applied to the texture. */
  readonly uv: readonly [number, number];
  readonly emissiveIntensity: number;
  readonly opacity: number;
  /** `0`–`1` brightness wave, exposed for HUD/highlight use. */
  readonly pulse: number;
}

/** A lit, animating sign face: texture + material + its frame-clock animation. */
export interface SignMaterialHandle {
  readonly id: string;
  readonly era: EraId;
  readonly media: SignMedia;
  readonly animation: SignAnimation;
  readonly animationSpeed: number;
  readonly texture: SignTextureHandle;
  readonly material: THREE.MeshStandardMaterial;
  readonly baseEmissiveIntensity: number;
  readonly baseOpacity: number;
  readonly state: SignAnimationState;
  /** `true` while this face animates (media with a non-static animation). */
  readonly animated: boolean;
  /** Applies one frame of animation; pure in `elapsedSeconds`. */
  advance(elapsedSeconds: number, deltaSeconds?: number): SignAnimationState;
  /** Restores the base look (used when a variant is hidden). */
  reset(): void;
  dispose(): void;
}

export interface SignMaterialOptions {
  readonly id: string;
  readonly handle: SignTextureHandle;
  /** Multiplies the medium's default emissive intensity (HUD dimming, etc.). */
  readonly emissiveScale?: number;
  /** Overrides the medium's default opacity. */
  readonly opacity?: number;
  readonly transparent?: boolean;
  readonly side?: THREE.Side;
  readonly depthWrite?: boolean;
  readonly name?: string;
}

class AnimatedSignMaterial implements SignMaterialHandle {
  readonly id: string;
  readonly era: EraId;
  readonly media: SignMedia;
  readonly animation: SignAnimation;
  readonly animationSpeed: number;
  readonly texture: SignTextureHandle;
  readonly material: THREE.MeshStandardMaterial;
  readonly baseEmissiveIntensity: number;
  readonly baseOpacity: number;

  private current: SignAnimationState;
  private disposed = false;

  constructor(options: SignMaterialOptions) {
    const defaults = signMediaDefaults(options.handle.media);
    this.id = options.id;
    this.era = options.handle.era;
    this.media = options.handle.media;
    this.animation = defaults.animation;
    this.animationSpeed = defaults.animationSpeed;
    this.texture = options.handle;
    this.baseEmissiveIntensity = Math.max(
      0,
      defaults.emissiveIntensity * (options.emissiveScale ?? 1),
    );
    this.baseOpacity = clamp01(options.opacity ?? defaults.opacity);

    this.material = new THREE.MeshStandardMaterial({
      name: options.name ?? `chrono-sign-${this.media}-${this.id}`,
      color: 0xffffff,
      map: options.handle.texture,
      emissive: new THREE.Color('#ffffff'),
      emissiveMap: options.handle.texture,
      emissiveIntensity: this.baseEmissiveIntensity,
      roughness: defaults.roughness,
      metalness: defaults.metalness,
      opacity: this.baseOpacity,
      transparent: options.transparent ?? this.baseOpacity < 0.999,
      side: options.side ?? THREE.FrontSide,
      depthWrite: options.depthWrite ?? true,
    });
    this.material.userData.chronoSignId = this.id;
    this.material.userData.chronoSignMedia = this.media;
    this.current = Object.freeze({
      media: this.media,
      animation: this.animation,
      frame: 0,
      uv: Object.freeze([0, 0] as const),
      emissiveIntensity: this.baseEmissiveIntensity,
      opacity: this.baseOpacity,
      pulse: 0,
    });
  }

  get state(): SignAnimationState {
    return this.current;
  }

  get animated(): boolean {
    return this.animation !== 'none' && !this.disposed;
  }

  advance(elapsedSeconds: number, _deltaSeconds = 0): SignAnimationState {
    if (this.disposed) return this.current;
    const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
    const phase = elapsed * this.animationSpeed;
    const frames = Math.max(1, this.texture.frames);
    let frame = 0;
    let du = 0;
    let dv = 0;
    let emissive = this.baseEmissiveIntensity;
    let opacity = this.baseOpacity;
    let pulse = 0;

    switch (this.animation) {
      case 'flicker': {
        // Neon: a fast shimmer plus occasional dropouts, like a tired tube.
        const step = Math.floor(phase * 3);
        const dropout = signNoise(step) < 0.08 ? 0.32 : 1;
        pulse = 0.8 + 0.2 * Math.sin(phase * 2.1);
        emissive = this.baseEmissiveIntensity * pulse * dropout;
        break;
      }
      case 'pulse': {
        // Backlit lightboxes breathe slowly with the mains hum.
        pulse = 0.87 + 0.13 * Math.sin(phase * Math.PI * 2);
        emissive = this.baseEmissiveIntensity * pulse;
        break;
      }
      case 'chase': {
        // Bulb marquee: alternate bulb rows on and off.
        frame = Math.floor(phase) % frames;
        pulse = frame === 0 ? 1 : 0.72;
        emissive = this.baseEmissiveIntensity * pulse;
        break;
      }
      case 'rollFrames': {
        // Video ad: walk the baked reel at a fixed frame rate.
        frame = Math.floor(phase) % frames;
        pulse = frame / Math.max(1, frames - 1);
        emissive = this.baseEmissiveIntensity * (0.9 + 0.1 * Math.sin(phase * 2.4));
        break;
      }
      case 'scroll': {
        // LED ribbon: one continuous UV walk, no repaint.
        du = fract(phase);
        pulse = 0.95 + 0.05 * Math.sin(phase * 9);
        emissive = this.baseEmissiveIntensity * pulse;
        break;
      }
      case 'shimmer': {
        // Hologram: a slow vertical sweep with a soft opacity breath.
        frame = Math.floor(phase) % frames;
        dv = fract(phase);
        pulse = 0.6 + 0.4 * Math.abs(Math.sin(phase * Math.PI));
        emissive = this.baseEmissiveIntensity * (0.88 + 0.24 * pulse);
        opacity = clamp01(this.baseOpacity * (0.82 + 0.18 * pulse));
        break;
      }
      default: {
        emissive = this.baseEmissiveIntensity;
        break;
      }
    }

    const base = this.texture.frameUv(frame);
    const uv: readonly [number, number] = Object.freeze([
      fract(base[0] + du),
      fract(base[1] + dv),
    ] as const);

    this.texture.texture.offset.set(uv[0], uv[1]);
    this.material.emissiveIntensity = emissive;
    if (opacity !== this.material.opacity) this.material.opacity = opacity;
    this.material.transparent = opacity < 0.999;

    this.current = Object.freeze({
      media: this.media,
      animation: this.animation,
      frame,
      uv,
      emissiveIntensity: emissive,
      opacity,
      pulse,
    });
    return this.current;
  }

  reset(): void {
    if (this.disposed) return;
    const base = this.texture.frameUv(0);
    this.texture.texture.offset.set(base[0], base[1]);
    this.material.emissiveIntensity = this.baseEmissiveIntensity;
    this.material.opacity = this.baseOpacity;
    this.material.transparent = this.baseOpacity < 0.999;
    this.current = Object.freeze({
      media: this.media,
      animation: this.animation,
      frame: 0,
      uv: Object.freeze([base[0], base[1]] as const),
      emissiveIntensity: this.baseEmissiveIntensity,
      opacity: this.baseOpacity,
      pulse: 0,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.texture.dispose();
  }
}

/** Builds the lit material (and frame-clock animation) for one sign face. */
export function createSignMaterialHandle(options: SignMaterialOptions): SignMaterialHandle {
  return new AnimatedSignMaterial(options);
}
