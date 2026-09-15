/**
 * Procedural menu-board lettering: stroke font, era layout and canvas painting.
 *
 * Nothing here is fetched. The board is drawn from three pure ingredients:
 *
 *  1. **A stroke font.** {@link GLYPH_PATHS} describes every letter, digit and
 *     symbol the boards need as polylines inside a unit em box (baseline `y = 0`,
 *     cap height `y = 1`). It is a vector font of the kind a signwriter or a
 *     letter-board fitter worked with — no font file, no `fillText`, no network.
 *  2. **A layout function.** {@link layoutMenuBoard} turns one era's
 *     {@link MenuBoardSpec} plus the board's {@link BoardForm} into a
 *     {@link BoardLayout}: fitted heading, section and item lines, and the
 *     {@link BoardDrawRun} set that defines the era's technique — hand-chalk
 *     strokes and smudges, applied vinyl letters, fluorescent letter-board
 *     tiles with a promo strip, backlit acrylic panel sections, or rotating
 *     digital screen panels, each with its own wear.
 *  3. **A painter.** {@link paintBoardFace} rasterises that run set into a
 *     procedural texture (canvas in the browser, data texture headless), so a
 *     year's board is assertable in a headless vitest run: every mark is real
 *     pixels produced from the layout, not a placeholder colour.
 *
 * Face space measures both axes in *board heights*: `x` runs `0..aspect`
 * (`width / height`), `y` runs `0..1`, origin bottom left. That keeps lettering
 * undistorted on a wide screen and a portrait slate alike.
 */

import * as THREE from 'three';
import { createSeededRandom } from '../../core/kernel';
import {
  runsOfKind,
  type BacklitPanelRun,
  type BoardDrawRun,
  type BoardForm,
  type BoardPanelEmphasis,
  type BoardSurfaceSpec,
  type ChalkSmudgeRun,
  type ChalkStrokeRun,
  type DigitalPanelRun,
  type FaceAlign,
  type FacePoint,
  type FaceRect,
  type FluorescentTileRun,
  type LetteringStyle,
  type MenuBoardKind,
  type MenuBoardSpec,
  type MenuLineItem,
  type MenuPanelSpec,
  type MenuPromo,
  type MenuRuleRun,
  type MenuTextKind,
  type MenuTextLine,
  type PromoStripRun,
  type TextTone,
  type VinylLetterRun,
  type WearKind,
  type WearRun,
} from './types';

/* -------------------------------------------------------------------------- */
/* Deterministic seeds                                                        */
/* -------------------------------------------------------------------------- */

/** Stable 32 bit FNV-1a hash of a string, used to seed every painter. */
export function boardHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Seed of one era's board: the same year always lays out the same way. */
export function menuBoardSeed(year: string, kind: MenuBoardKind): number {
  return boardHash(`menuboard:${year}:${kind}`) % 0x7fffffff;
}

/* -------------------------------------------------------------------------- */
/* Stroke font                                                               */
/* -------------------------------------------------------------------------- */

function poly(spec: string): readonly FacePoint[] {
  const points: FacePoint[] = [];
  for (const pair of spec.trim().split(/\s+/)) {
    const [rawX, rawY] = pair.split(',');
    points.push({ x: Number(rawX ?? 0), y: Number(rawY ?? 0) });
  }
  return Object.freeze(points);
}

/**
 * The block sans a signwriter would set a menu board in, as polylines inside a
 * baseline-anchored em box. Every glyph is drawn from one or more strokes, which
 * is what makes the 1945 board readable as *chalk*: the layout emits one chalk
 * run per stroke, so the wobble of a hand is visible per movement.
 */
const GLYPH_PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  A: ['0,0 0.31,1 0.62,0', '0.13,0.36 0.49,0.36'],
  B: ['0,0 0,1', '0,1 0.44,1 0.58,0.88 0.58,0.66 0.44,0.54 0,0.54', '0.44,0.54 0.6,0.42 0.6,0.14 0.44,0 0,0'],
  C: ['0.62,0.84 0.44,1 0.2,1 0,0.8 0,0.2 0.2,0 0.44,0 0.62,0.16'],
  D: ['0,0 0,1 0.36,1 0.6,0.78 0.6,0.22 0.36,0 0,0'],
  E: ['0.6,1 0,1 0,0 0.6,0', '0,0.54 0.44,0.54'],
  F: ['0.6,1 0,1 0,0', '0,0.54 0.42,0.54'],
  G: ['0.62,0.84 0.44,1 0.2,1 0,0.8 0,0.2 0.2,0 0.44,0 0.62,0.16 0.62,0.44 0.42,0.44'],
  H: ['0,0 0,1', '0.62,0 0.62,1', '0,0.54 0.62,0.54'],
  I: ['0.22,0 0.22,1', '0.04,1 0.4,1', '0.04,0 0.4,0'],
  J: ['0.5,1 0.5,0.18 0.34,0 0.14,0 0,0.16'],
  K: ['0,0 0,1', '0.6,1 0,0.42', '0.22,0.58 0.62,0'],
  L: ['0,1 0,0 0.58,0'],
  M: ['0,0 0,1 0.34,0.5 0.68,1 0.68,0'],
  N: ['0,0 0,1 0.62,0 0.62,1'],
  O: ['0,0.78 0,0.22 0.2,0 0.42,0 0.62,0.22 0.62,0.78 0.42,1 0.2,1 0,0.78'],
  P: ['0,0 0,1 0.44,1 0.62,0.86 0.62,0.66 0.44,0.52 0,0.52'],
  Q: ['0,0.78 0,0.22 0.2,0 0.42,0 0.62,0.22 0.62,0.78 0.42,1 0.2,1 0,0.78', '0.4,0.24 0.68,-0.08'],
  R: ['0,0 0,1 0.44,1 0.62,0.86 0.62,0.66 0.44,0.52 0,0.52', '0.3,0.52 0.62,0'],
  S: ['0.6,0.86 0.42,1 0.2,1 0.02,0.86 0.02,0.68 0.2,0.56 0.44,0.5 0.6,0.38 0.6,0.16 0.42,0 0.2,0 0.02,0.14'],
  T: ['0,1 0.62,1', '0.31,1 0.31,0'],
  U: ['0,1 0,0.2 0.2,0 0.42,0 0.62,0.2 0.62,1'],
  V: ['0,1 0.31,0 0.62,1'],
  W: ['0,1 0.17,0 0.34,0.62 0.51,0 0.68,1'],
  X: ['0,1 0.62,0', '0.62,1 0,0'],
  Y: ['0,1 0.31,0.5 0.62,1', '0.31,0.5 0.31,0'],
  Z: ['0,1 0.62,1 0,0 0.62,0'],
  '0': ['0,0.78 0,0.22 0.2,0 0.42,0 0.62,0.22 0.62,0.78 0.42,1 0.2,1 0,0.78', '0.16,0.2 0.46,0.8'],
  '1': ['0.12,0.78 0.32,1 0.32,0', '0.08,0 0.56,0'],
  '2': ['0,0.82 0.16,1 0.46,1 0.62,0.84 0.62,0.64 0,0.06 0,0 0.62,0'],
  '3': ['0,0.86 0.18,1 0.44,1 0.6,0.86 0.6,0.66 0.44,0.54 0.24,0.54', '0.44,0.54 0.6,0.42 0.6,0.16 0.42,0 0.18,0 0,0.14'],
  '4': ['0.46,0 0.46,1 0,0.3 0.64,0.3'],
  '5': ['0.58,1 0.06,1 0.02,0.56 0.24,0.62 0.46,0.6 0.62,0.44 0.62,0.18 0.44,0 0.2,0 0.02,0.12'],
  '6': ['0.58,0.9 0.4,1 0.2,1 0.02,0.78 0.02,0.22 0.22,0 0.42,0 0.6,0.18 0.6,0.4 0.42,0.56 0.2,0.56 0.04,0.42'],
  '7': ['0,1 0.62,1 0.24,0'],
  '8': ['0.31,0.54 0.1,0.68 0.1,0.86 0.28,1 0.44,1 0.58,0.86 0.58,0.68 0.38,0.54 0.2,0.54 0.04,0.4 0.04,0.16 0.22,0 0.44,0 0.62,0.16 0.62,0.4 0.31,0.54'],
  '9': ['0.06,0.1 0.24,0 0.44,0 0.62,0.22 0.62,0.78 0.42,1 0.22,1 0.04,0.82 0.04,0.6 0.22,0.44 0.44,0.44 0.6,0.58'],
  '.': ['0.06,0.03 0.14,0.03'],
  ',': ['0.12,0.05 0.06,-0.14'],
  '-': ['0.04,0.48 0.5,0.48'],
  '/': ['0.02,0 0.6,1'],
  '£': ['0.62,0.9 0.46,1 0.28,1 0.14,0.86 0.14,0', '0,0.5 0.44,0.5', '0.06,0 0.62,0'],
  '&': ['0.62,0.06 0.2,0.9 0.14,1 0.24,1 0.62,0.42 0.46,0.22 0.26,0.22 0.08,0.36 0.08,0.62 0.4,0.84'],
  '(': ['0.34,1.08 0.14,0.8 0.14,0.2 0.34,-0.08'],
  ')': ['0.06,1.08 0.26,0.8 0.26,0.2 0.06,-0.08'],
  '!': ['0.1,1 0.1,0.26', '0.1,0.04 0.1,0'],
  '?': ['0.02,0.84 0.16,1 0.44,1 0.6,0.86 0.6,0.68 0.42,0.52 0.3,0.44 0.3,0.26', '0.3,0.04 0.3,0'],
  ':': ['0.12,0.66 0.12,0.7', '0.12,0.14 0.12,0.18'],
  '·': ['0.1,0.5 0.18,0.5'],
  '+': ['0.06,0.5 0.54,0.5', '0.3,0.26 0.3,0.74'],
  '%': [
    '0.04,0 0.6,1',
    '0.06,0.86 0.1,0.94 0.18,0.94 0.22,0.86 0.18,0.78 0.1,0.78 0.06,0.86',
    '0.38,0.14 0.42,0.22 0.5,0.22 0.54,0.14 0.5,0.06 0.42,0.06 0.38,0.14',
  ],
  "'": ['0.1,1 0.08,0.84'],
  '*': ['0.3,0.62 0.3,1', '0.08,0.72 0.52,0.9', '0.52,0.72 0.08,0.9'],
  ' ': [],
});

/** Advance widths of the stroke font, in em. Unlisted glyphs use the default. */
const GLYPH_WIDTHS: Readonly<Record<string, number>> = Object.freeze({
  ' ': 0.36,
  I: 0.44,
  M: 0.8,
  W: 0.8,
  L: 0.66,
  J: 0.62,
  T: 0.68,
  E: 0.68,
  F: 0.66,
  S: 0.66,
  C: 0.68,
  G: 0.7,
  Q: 0.72,
  Z: 0.68,
  X: 0.68,
  Y: 0.68,
  V: 0.68,
  K: 0.68,
  '1': 0.62,
  '2': 0.68,
  '3': 0.66,
  '7': 0.66,
  '8': 0.68,
  '9': 0.68,
  '.': 0.3,
  ',': 0.3,
  '-': 0.58,
  '/': 0.62,
  '·': 0.36,
  ':': 0.28,
  '!': 0.28,
  '?': 0.66,
  "'": 0.26,
  '(': 0.4,
  ')': 0.4,
  '£': 0.74,
  '&': 0.76,
  '+': 0.62,
  '%': 0.7,
  '*': 0.62,
});

const DEFAULT_ADVANCE = 0.72;
const MISSING_GLYPH = Object.freeze([poly('0.06,0.1 0.56,0.9'), poly('0.56,0.1 0.06,0.9')]);

/** The parsed stroke font: one array of polylines per character. */
const PARSED_GLYPHS: ReadonlyMap<string, readonly (readonly FacePoint[])[]> = new Map(
  Object.entries(GLYPH_PATHS).map(([character, strokes]) => [
    character,
    Object.freeze(strokes.map((stroke) => poly(stroke))),
  ]),
);

/** Every character the font can set. */
export const BOARD_TEXT_ALPHABET: readonly string[] = Object.freeze(
  Object.keys(GLYPH_PATHS).sort(),
);

const SMART_CHARACTERS: Readonly<Record<string, string>> = Object.freeze({
  '’': "'",
  '‘': "'",
  '“': "'",
  '”': "'",
  '–': '-',
  '—': '-',
  '−': '-',
  '½': '1/2',
  '¼': '1/4',
  '×': 'X',
});

/**
 * Board lettering is set in capitals, the way a chalker, a vinyl fitter and a
 * letter-board fitter all worked. Typographic quotes and dashes are folded onto
 * the glyphs the font actually carries, and accented Latin is folded onto its
 * base letter (the period boards carried an unaccented block sans), so an era
 * spec can use real punctuation and real spellings without a missing glyph.
 */
export function normaliseBoardText(text: string): string {
  let output = '';
  for (const character of text) {
    const mapped = SMART_CHARACTERS[character];
    if (mapped !== undefined) {
      output += mapped;
      continue;
    }
    output += character.toUpperCase();
  }
  return output
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The stroke polylines of one character, in the unit em box. */
export function glyphStrokes(character: string): readonly (readonly FacePoint[])[] {
  const glyph = PARSED_GLYPHS.get(character);
  if (glyph) return glyph;
  return MISSING_GLYPH;
}

/** Advance width of one character, in em. */
export function glyphAdvance(character: string): number {
  return GLYPH_WIDTHS[character] ?? DEFAULT_ADVANCE;
}

/** Width of `text` at `size` (cap height) with `tracking` (em per gap). */
export function measureBoardText(text: string, size: number, tracking = 0): number {
  const characters = [...text];
  if (characters.length === 0) return 0;
  let width = 0;
  for (const character of characters) width += glyphAdvance(character) * size;
  return width + tracking * size * (characters.length - 1);
}

/** Largest size at which `text` still fits `maxWidth`, capped at `maxSize`. */
export function fitLetteringSize(
  text: string,
  maxWidth: number,
  tracking: number,
  maxSize: number,
): number {
  const unitWidth = measureBoardText(text, 1, tracking);
  if (unitWidth <= 0) return maxSize;
  const fitted = maxWidth / unitWidth;
  if (!Number.isFinite(fitted) || fitted <= 0) return Math.min(maxSize, 0.008);
  return Math.min(maxSize, fitted);
}

/** One positioned character of a line, ready to paint. */
export interface GlyphPlacement {
  readonly char: string;
  readonly charIndex: number;
  /** Left edge of the character's em box, on the line's baseline. */
  readonly origin: FacePoint;
  /** Centre of the character's em box. */
  readonly center: FacePoint;
  readonly size: number;
  readonly advance: number;
  /** Stroke polylines transformed into face space. */
  readonly strokes: readonly (readonly FacePoint[])[];
}

/** Left edge of a line of lettering, given its alignment. */
export function lineStart(line: MenuTextLine): FacePoint {
  const width = measureBoardText(normaliseBoardText(line.text), line.size, line.tracking);
  if (line.align === 'left') return { x: line.x, y: line.y };
  if (line.align === 'center') return { x: line.x - width / 2, y: line.y };
  return { x: line.x - width, y: line.y };
}

/** Expands a line of lettering into positioned glyphs in face space. */
export function placeLineGlyphs(line: MenuTextLine): readonly GlyphPlacement[] {
  const text = normaliseBoardText(line.text);
  const start = lineStart(line);
  const placements: GlyphPlacement[] = [];
  let cursor = start.x;
  let index = 0;
  for (const character of text) {
    const size = line.size;
    const advance = glyphAdvance(character);
    const strokes = glyphStrokes(character).map((stroke) =>
      stroke.map((point) => ({ x: cursor + point.x * size, y: line.y + point.y * size })),
    );
    placements.push({
      char: character,
      charIndex: index,
      origin: { x: cursor, y: line.y },
      center: { x: cursor + (advance * size) / 2, y: line.y + size / 2 },
      size,
      advance,
      strokes,
    });
    cursor += advance * size + line.tracking * size;
    index += 1;
  }
  return placements;
}

/** Stroke polylines of a single character placed at `center`, optionally rotated. */
export function glyphStrokesAt(
  character: string,
  center: FacePoint,
  size: number,
  rotation = 0,
): readonly (readonly FacePoint[])[] {
  const advance = glyphAdvance(character);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return glyphStrokes(character).map((stroke) =>
    stroke.map((point) => {
      const localX = (point.x - advance / 2) * size;
      const localY = (point.y - 0.5) * size;
      return {
        x: center.x + localX * cos - localY * sin,
        y: center.y + localX * sin + localY * cos,
      };
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Layout vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/** One menu column of the board, in face space. */
export interface BoardColumn {
  readonly id: string;
  readonly panelId: string;
  readonly index: number;
  readonly title: string;
  readonly emphasis: BoardPanelEmphasis;
  readonly rect: FaceRect;
  readonly itemIds: readonly string[];
  readonly lines: readonly MenuTextLine[];
  readonly rotationSeconds: number;
  readonly tone: TextTone;
}

/** One column panel run: a lit acrylic panel or a rotating screen panel. */
export type PanelRun = BacklitPanelRun | DigitalPanelRun;

/** The complete procedural layout of one era's board face. */
export interface BoardLayout {
  readonly year: string;
  readonly kind: MenuBoardKind;
  readonly lettering: LetteringStyle;
  /** Face aspect ratio (`width / height`), the visible `x` range of face space. */
  readonly aspect: number;
  /** Face size in metres. */
  readonly width: number;
  readonly height: number;
  readonly heading: MenuTextLine;
  readonly subheading: MenuTextLine;
  readonly footer: MenuTextLine;
  readonly columns: readonly BoardColumn[];
  /** The 1985 promo strip, when the era carries one. */
  readonly promo: PromoStripRun | null;
  /** Menu panels with an index (excludes the header and footer bands). */
  readonly panels: readonly PanelRun[];
  readonly runs: readonly BoardDrawRun[];
  /** Item ids actually set on the board, in panel order. */
  readonly itemIds: readonly string[];
  /** Content scale the layout finally settled on (`1` when it fitted first try). */
  readonly scale: number;
  readonly seed: number;
  readonly signature: string;
}

export interface BoardLayoutOptions {
  /** Overrides the deterministic era seed. */
  readonly seed?: number;
}

interface StyleMetrics {
  readonly tone: TextTone;
  readonly margin: number;
  readonly heading: number;
  readonly subheading: number;
  readonly section: number;
  readonly item: number;
  readonly price: number;
  readonly note: number;
  readonly footer: number;
  readonly gutter: number;
  readonly promoHeight: number;
  readonly tilePitch: number;
  readonly lineGap: number;
  /** Column width under which the price is set at its own size, not the name's. */
  readonly stacked: number;
}

function styleMetrics(lettering: LetteringStyle): StyleMetrics {
  switch (lettering) {
    case 'applied-vinyl':
      return {
        tone: 'vinyl',
        margin: 0.06,
        heading: 0.115,
        subheading: 0.042,
        section: 0.044,
        item: 0.05,
        price: 0.052,
        note: 0.024,
        footer: 0.021,
        gutter: 0.06,
        promoHeight: 0,
        tilePitch: 0,
        lineGap: 0.022,
        stacked: 0.3,
      };
    case 'fluorescent-tiles':
      return {
        tone: 'tile',
        margin: 0.055,
        heading: 0.09,
        subheading: 0.036,
        section: 0.04,
        item: 0.042,
        price: 0.044,
        note: 0.022,
        footer: 0.02,
        gutter: 0.055,
        promoHeight: 0.19,
        tilePitch: 0.032,
        lineGap: 0.02,
        stacked: 0.34,
      };
    case 'backlit-print':
      return {
        tone: 'print',
        margin: 0.045,
        heading: 0.095,
        subheading: 0.034,
        section: 0.038,
        item: 0.044,
        price: 0.044,
        note: 0.021,
        footer: 0.019,
        gutter: 0.05,
        promoHeight: 0,
        tilePitch: 0,
        lineGap: 0.018,
        stacked: 0.32,
      };
    case 'emissive-digital':
      return {
        tone: 'emissive',
        margin: 0.04,
        heading: 0.085,
        subheading: 0.032,
        section: 0.034,
        item: 0.04,
        price: 0.042,
        note: 0.019,
        footer: 0.017,
        gutter: 0.042,
        promoHeight: 0,
        tilePitch: 0,
        lineGap: 0.016,
        stacked: 0.34,
      };
    case 'hand-chalk':
    default:
      return {
        tone: 'chalk',
        margin: 0.07,
        heading: 0.11,
        subheading: 0.044,
        section: 0.048,
        item: 0.052,
        price: 0.052,
        note: 0.025,
        footer: 0.023,
        gutter: 0.055,
        promoHeight: 0,
        tilePitch: 0,
        lineGap: 0.024,
        stacked: 0.34,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Layout engine                                                              */
/* -------------------------------------------------------------------------- */

interface DraftLayout {
  readonly heading: MenuTextLine;
  readonly subheading: MenuTextLine;
  readonly footer: MenuTextLine;
  readonly columns: readonly BoardColumn[];
  readonly promoLines: readonly MenuTextLine[];
  readonly promoBounds: FaceRect | null;
  readonly headerBounds: FaceRect;
  readonly footerBounds: FaceRect;
  readonly ruleSpecs: readonly RuleSpec[];
  readonly scale: number;
  readonly fits: boolean;
}

interface RuleSpec {
  readonly from: FacePoint;
  readonly to: FacePoint;
  readonly weight: number;
  readonly kind: MenuTextKind;
}

function pushLine(
  lines: MenuTextLine[],
  spec: {
    id: string;
    text: string;
    tone: TextTone;
    kind: MenuTextKind;
    size: number;
    x: number;
    y: number;
    align: FaceAlign;
    itemId?: string;
    panelId?: string;
    substitute?: boolean;
    opacity?: number;
    tracking?: number;
    weight?: number;
  },
): MenuTextLine {
  const line: MenuTextLine = Object.freeze({
    id: spec.id,
    text: normaliseBoardText(spec.text),
    tone: spec.tone,
    kind: spec.kind,
    size: spec.size,
    x: spec.x,
    y: spec.y,
    align: spec.align,
    tracking: spec.tracking ?? 0.06,
    weight: spec.weight ?? (spec.kind === 'heading' ? 0.14 : 0.12),
    opacity: spec.opacity ?? 1,
    ...(spec.itemId !== undefined ? { itemId: spec.itemId } : {}),
    ...(spec.panelId !== undefined ? { panelId: spec.panelId } : {}),
    substitute: spec.substitute ?? false,
  });
  lines.push(line);
  return line;
}

function panelsOf(spec: MenuBoardSpec): readonly MenuPanelSpec[] {
  if (spec.panels.length > 0) return spec.panels;
  return spec.sections.map((section) => ({
    id: `panel-${section.id}`,
    title: section.label,
    sectionIds: [section.id],
  }));
}

function promoLine(
  spec: MenuBoardSpec,
  promo: MenuPromo,
  index: number,
  text: string,
  kind: MenuTextKind,
  size: number,
  x: number,
  y: number,
  align: FaceAlign,
): MenuTextLine {
  return {
    id: `promo:${spec.year}:${index}`,
    text: normaliseBoardText(text),
    tone: 'promo',
    kind,
    size,
    x,
    y,
    align,
    tracking: 0.06,
    weight: kind === 'price' ? 0.16 : 0.13,
    opacity: 1,
    substitute: false,
  };
}

function buildDraft(spec: MenuBoardSpec, form: BoardForm, scale: number): DraftLayout {
  const metrics = styleMetrics(spec.lettering);
  const aspect = form.width / form.height;
  const margin = metrics.margin;
  const contentLeft = margin;
  const contentRight = Math.max(aspect - margin, margin * 2);
  const contentWidth = contentRight - contentLeft;

  const headingSize = fitLetteringSize(spec.heading, contentWidth, 0.08, metrics.heading * scale);
  const subheadingSize = fitLetteringSize(spec.subheading, contentWidth, 0.1, metrics.subheading * scale);
  const footerSize = fitLetteringSize(spec.boardNote, contentWidth, 0.08, metrics.footer * scale);
  const sectionSize = metrics.section * scale;
  const itemSize = metrics.item * scale;
  const priceSize = metrics.price * scale;
  const noteSize = metrics.note * scale;

  const headingY = 1 - margin - headingSize * 0.92;
  const subheadingY = headingY - subheadingSize * 1.6;
  const headerBottom = subheadingY - subheadingSize * 0.7;
  const footerY = margin + footerSize * 0.4;
  const promoHeight = form.hasPromoStrip ? metrics.promoHeight * scale : 0;
  const promoBottom = footerY + footerSize * 1.7;
  const contentBottom = promoBottom + promoHeight + (promoHeight > 0 ? footerSize * 0.6 : 0);

  const lines: MenuTextLine[] = [];
  const heading = pushLine(lines, {
    id: 'line:heading',
    text: spec.heading,
    tone: metrics.tone,
    kind: 'heading',
    size: headingSize,
    x: (contentLeft + contentRight) / 2,
    y: headingY,
    align: 'center',
    tracking: 0.08,
    weight: 0.15,
  });
  const subheading = pushLine(lines, {
    id: 'line:subheading',
    text: spec.subheading,
    tone: metrics.tone,
    kind: 'subheading',
    size: subheadingSize,
    x: (contentLeft + contentRight) / 2,
    y: subheadingY,
    align: 'center',
    tracking: 0.1,
    opacity: 0.92,
  });
  const footer = pushLine(lines, {
    id: 'line:footer',
    text: spec.boardNote,
    tone: metrics.tone,
    kind: 'footer',
    size: footerSize,
    x: (contentLeft + contentRight) / 2,
    y: footerY,
    align: 'center',
    tracking: 0.08,
    opacity: 0.85,
  });

  const panels: MenuPanelSpec[] = [...panelsOf(spec)];
  const promo = spec.promo;
  const promoPanel = promo && spec.boardKind === 'digital-screen';
  if (promoPanel && promo) {
    // The 2025 screen rotates a feature panel in beside the menu panels.
    panels.push({
      id: promo.id,
      title: promo.headline,
      sectionIds: [],
      emphasis: 'promo',
      rotationSeconds: panels[0]?.rotationSeconds ?? 8,
    });
  }
  const ruleSpecs: RuleSpec[] = [];
  const columns: BoardColumn[] = [];
  const gutter = panels.length > 1 ? metrics.gutter : 0;
  const columnWidth = (contentWidth - gutter * (panels.length - 1)) / panels.length;
  let fits = headingSize + subheadingSize + footerSize < form.height;

  panels.forEach((panel, panelIndex) => {
    const columnLeft = contentLeft + panelIndex * (columnWidth + gutter);
    const columnRight = columnLeft + columnWidth;
    const rect: FaceRect = {
      x: columnLeft,
      y: contentBottom,
      width: columnWidth,
      height: Math.max(headerBottom - contentBottom, 0),
    };
    const columnLines: MenuTextLine[] = [];
    const columnItems: MenuLineItem[] = [];
    const pad = Math.min(0.02, columnWidth * 0.06);
    const titleSize = Math.min(sectionSize * 1.1, columnWidth * 0.5);
    let cursor = headerBottom - metrics.lineGap - titleSize;

    const title = pushLine(columnLines, {
      id: `line:panel:${panel.id}`,
      text: panel.title,
      tone: metrics.tone,
      kind: 'section',
      size: fitLetteringSize(panel.title, columnWidth - pad * 2, 0.08, titleSize),
      x: columnLeft + pad,
      y: cursor,
      align: 'left',
      tracking: 0.08,
      weight: 0.16,
      panelId: panel.id,
    });
    cursor = Math.min(cursor, title.y) - metrics.lineGap;

    // Descriptions are the first thing a board drops when a column is busy:
    // the notes, the substitute and the price are the detail a menu cannot do
    // without, so they always stay. The check runs in design units and compares
    // against the column's real height at the current scale.
    const densityItems = panel.sectionIds.flatMap((sectionId) =>
      spec.items.filter((item) => item.section === sectionId),
    );
    const available = Math.max(headerBottom - contentBottom, 0) * scale;
    const stackedRows = columnWidth < metrics.stacked;
    const designCost = (withDescriptions: boolean): number => {
      let total = title.size * 1.5 + metrics.lineGap * 2;
      total += panel.sectionIds.length * sectionSize * 2.1;
      for (const item of densityItems) {
        total += itemSize * 1.05 + metrics.lineGap;
        if (stackedRows) total += priceSize * 1.2;
        if (withDescriptions) total += Math.max(noteSize, itemSize * 0.62) * 1.25;
        if (item.note) total += noteSize * 1.4;
        if (item.substitute) total += noteSize * 1.55;
      }
      return total;
    };
    const withDescriptions = designCost(true) <= available;
    const multiSection = panel.sectionIds.length > 1;
    if (panel.sectionIds.length === 0 && promo) {
      // The feature panel of the digital screen: promotion, detail and price.
      const promoDetail = fitLetteringSize(promo.detail, columnWidth - pad * 2, 0.04, noteSize * 1.15);
      pushLine(columnLines, {
        id: `line:promo:detail:${promo.id}`,
        text: promo.detail,
        tone: 'promo',
        kind: 'promo',
        size: promoDetail,
        x: columnLeft + pad,
        y: cursor - promoDetail,
        align: 'left',
        tracking: 0.04,
        weight: 0.11,
        panelId: panel.id,
        opacity: 0.88,
      });
      cursor = cursor - promoDetail * 1.5;
      if (promo.price) {
        pushLine(columnLines, {
          id: `line:promo:price:${promo.id}`,
          text: promo.price.display,
          tone: 'promo',
          kind: 'price',
          size: fitLetteringSize(promo.price.display, columnWidth - pad * 2, 0.04, priceSize * 1.35),
          x: columnLeft + pad,
          y: cursor - priceSize,
          align: 'left',
          tracking: 0.04,
          weight: 0.17,
          panelId: panel.id,
        });
        cursor = cursor - priceSize * 1.6;
      }
      if (promo.badge) {
        pushLine(columnLines, {
          id: `line:promo:badge:${promo.id}`,
          text: `· ${promo.badge} ·`,
          tone: 'promo',
          kind: 'promo',
          size: fitLetteringSize(promo.badge, columnWidth - pad * 2, 0.1, sectionSize * 0.9),
          x: columnLeft + pad,
          y: cursor - sectionSize,
          align: 'left',
          tracking: 0.14,
          weight: 0.16,
          panelId: panel.id,
        });
      }
    }
    for (const sectionId of panel.sectionIds) {
      const section = spec.sections.find((entry) => entry.id === sectionId);
      if (!section) continue;
      if (multiSection) {
        const sectionLine = pushLine(columnLines, {
          id: `line:section:${panel.id}:${section.id}`,
          text: section.label,
          tone: metrics.tone,
          kind: 'section',
          size: fitLetteringSize(section.label, columnWidth - pad * 2, 0.08, sectionSize * 0.92),
          x: columnLeft + pad,
          y: cursor - sectionSize * 0.4,
          align: 'left',
          tracking: 0.08,
          weight: 0.15,
          panelId: panel.id,
        });
        cursor = Math.min(cursor, sectionLine.y) - metrics.lineGap;
      }
      const items = spec.items.filter((item) => item.section === section.id);
      for (const item of items) {
        columnItems.push(item);
        const text = normaliseBoardText(item.name);
        const priceText = item.price.display;
        // A narrow column sets the price under the dish, as a printed menu does;
        // a wide one runs the eye across with a dotted leader.
        const stacked = stackedRows;
        const priceUnits = measureBoardText(priceText, 1, 0.04);
        const priceColumn = Math.min(
          priceSize * (stacked ? 0.85 : 1),
          (columnWidth * (stacked ? 0.55 : 0.38)) / priceUnits,
        );
        const nameWidth = stacked
          ? columnWidth - pad * 2
          : columnWidth - priceColumn * priceUnits - pad * 3;
        const nameSize = fitLetteringSize(
          text,
          Math.max(nameWidth, columnWidth * (stacked ? 0.8 : 0.35)),
          0.05,
          itemSize,
        );
        const baseline = cursor - nameSize;
        pushLine(columnLines, {
          id: `line:item:${item.id}`,
          text,
          tone: metrics.tone,
          kind: 'item',
          size: nameSize,
          x: columnLeft + pad,
          y: baseline,
          align: 'left',
          tracking: 0.05,
          weight: 0.13,
          itemId: item.id,
          panelId: panel.id,
        });
        if (stacked) {
          pushLine(columnLines, {
            id: `line:price:${item.id}`,
            text: priceText,
            tone: metrics.tone,
            kind: 'price',
            size: priceColumn,
            x: columnRight - pad,
            y: baseline - priceColumn * 1.15,
            align: 'right',
            tracking: 0.04,
            weight: 0.16,
            itemId: item.id,
            panelId: panel.id,
          });
          cursor = baseline - priceColumn * 1.15;
        } else {
          pushLine(columnLines, {
            id: `line:price:${item.id}`,
            text: priceText,
            tone: metrics.tone,
            kind: 'price',
            size: priceColumn,
            x: columnRight - pad,
            y: baseline,
            align: 'right',
            tracking: 0.04,
            weight: 0.16,
            itemId: item.id,
            panelId: panel.id,
          });
          // The dotted leader a menu uses to run the eye from the dish to its price.
          const nameEnd = columnLeft + pad + measureBoardText(text, nameSize, 0.05);
          const priceStart = columnRight - pad - measureBoardText(priceText, priceColumn, 0.04);
          if (priceStart - nameEnd > columnWidth * 0.08) {
            ruleSpecs.push({
              from: { x: nameEnd + pad, y: baseline + nameSize * 0.3 },
              to: { x: priceStart - pad, y: baseline + nameSize * 0.3 },
              weight: nameSize * 0.06,
              kind: 'item',
            });
          }
          cursor = baseline;
        }

        if (withDescriptions) {
          const descriptionSize = fitLetteringSize(
            item.description,
            columnWidth - pad * 2,
            0.04,
            Math.max(noteSize, nameSize * 0.62),
          );
          pushLine(columnLines, {
            id: `line:desc:${item.id}`,
            text: item.description,
            tone: metrics.tone,
            kind: 'note',
            size: descriptionSize,
            x: columnLeft + pad,
            y: cursor - descriptionSize,
            align: 'left',
            tracking: 0.04,
            weight: 0.1,
            itemId: item.id,
            panelId: panel.id,
            opacity: 0.78,
          });
          cursor -= descriptionSize * 1.22;
        }

        if (item.note) {
          const note = fitLetteringSize(item.note, columnWidth - pad * 2, 0.04, noteSize * 0.95);
          pushLine(columnLines, {
            id: `line:note:${item.id}`,
            text: `· ${item.note}`,
            tone: metrics.tone,
            kind: 'note',
            size: note,
            x: columnLeft + pad,
            y: cursor - note,
            align: 'left',
            tracking: 0.04,
            weight: 0.1,
            itemId: item.id,
            panelId: panel.id,
            opacity: 0.66,
          });
          cursor -= note * 1.3;
        }

        if (item.substitute) {
          const substitute = item.substitute;
          const substituteSize = fitLetteringSize(
            `OR ${substitute.name} ${substitute.price.display}`,
            columnWidth - pad * 2,
            0.04,
            noteSize * 1.05,
          );
          pushLine(columnLines, {
            id: `line:substitute:${item.id}`,
            text: `OR ${substitute.name} ${substitute.price.display}`,
            tone: metrics.tone,
            kind: 'substitute',
            size: substituteSize,
            x: columnLeft + pad,
            y: cursor - substituteSize,
            align: 'left',
            tracking: 0.04,
            weight: 0.12,
            itemId: item.id,
            panelId: panel.id,
            substitute: true,
          });
          cursor -= substituteSize * 1.35;
        }

        cursor -= metrics.lineGap;
      }
      if (multiSection) cursor -= metrics.lineGap * 0.5;
    }

    const lowest = columnLines.reduce(
      (minimum, line) => Math.min(minimum, line.y - line.size * 0.28),
      headerBottom,
    );
    if (lowest < contentBottom - 1e-9) fits = false;

    columns.push({
      id: `column:${panel.id}`,
      panelId: panel.id,
      index: panelIndex,
      title: normaliseBoardText(panel.title),
      emphasis: panel.emphasis ?? 'standard',
      rect,
      itemIds: Object.freeze(columnItems.map((item) => item.id)),
      lines: Object.freeze(columnLines),
      rotationSeconds: panel.rotationSeconds ?? 0,
      tone: metrics.tone,
    });
  });

  let promoLines: MenuTextLine[] = [];
  let promoBounds: FaceRect | null = null;
  if (spec.promo && form.hasPromoStrip) {
    const band: FaceRect = {
      x: contentLeft,
      y: promoBottom,
      width: contentWidth,
      height: promoHeight,
    };
    promoBounds = band;
    const promo = spec.promo;
    const headlineSize = fitLetteringSize(promo.headline, contentWidth * 0.42, 0.08, sectionSize * 1.35);
    const detailSize = fitLetteringSize(promo.detail, contentWidth * 0.52, 0.04, noteSize * 1.1);
    promoLines = [
      promoLine(spec, promo, 0, promo.headline, 'promo', headlineSize, band.x + band.width * 0.03, band.y + band.height * 0.56, 'left'),
      promoLine(spec, promo, 1, promo.detail, 'promo', detailSize, band.x + band.width * 0.03, band.y + band.height * 0.2, 'left'),
    ];
    if (promo.badge) {
      promoLines.push(
        promoLine(spec, promo, 2, promo.badge, 'promo', fitLetteringSize(promo.badge, band.width * 0.16, 0.1, headlineSize * 0.8), band.x + band.width - band.width * 0.03, band.y + band.height * 0.5, 'right'),
      );
    }
    if (promo.price) {
      promoLines.push(
        promoLine(spec, promo, 3, promo.price.display, 'price', fitLetteringSize(promo.price.display, band.width * 0.24, 0.04, priceSize * 1.4), band.x + band.width - band.width * 0.03, band.y + band.height * 0.56, 'right'),
      );
    }
  }

  const headerBounds: FaceRect = {
    x: contentLeft,
    y: headerBottom,
    width: contentWidth,
    height: Math.max(headingY + headingSize * 1.1 - headerBottom, 0.02),
  };
  const footerBounds: FaceRect = {
    x: contentLeft,
    y: promoBottom - footerSize * 0.4,
    width: contentWidth,
    height: Math.max(footerY + footerSize * 1.1 - (promoBottom - footerSize * 0.4), 0.02),
  };

  // A ruled line under the heading and above the small print: chalked on the
  // slate, painted on the panel, printed on the acrylic. The letter board and
  // the screen have rails and panels instead, so they never emit rules.
  ruleSpecs.push(
    {
      from: { x: contentLeft + 0.02, y: headerBottom + 0.012 },
      to: { x: contentRight - 0.02, y: headerBottom + 0.012 },
      weight: headingSize * 0.06,
      kind: 'heading',
    },
    {
      from: { x: contentLeft + 0.02, y: promoBottom - footerSize * 0.15 },
      to: { x: contentRight - 0.02, y: promoBottom - footerSize * 0.15 },
      weight: footerSize * 0.1,
      kind: 'footer',
    },
  );

  return {
    heading,
    subheading,
    footer,
    columns,
    promoLines,
    promoBounds,
    headerBounds,
    footerBounds,
    ruleSpecs,
    scale,
    fits,
  };
}

/* -------------------------------------------------------------------------- */
/* Run emission                                                              */
/* -------------------------------------------------------------------------- */

function jitterStroke(
  stroke: readonly FacePoint[],
  amount: number,
  random: () => number,
): readonly FacePoint[] {
  const points: FacePoint[] = [];
  for (let index = 0; index < stroke.length; index += 1) {
    const point = stroke[index];
    if (!point) continue;
    points.push({
      x: point.x + (random() - 0.5) * amount,
      y: point.y + (random() - 0.5) * amount,
    });
    const next = stroke[index + 1];
    if (!next) continue;
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const length = Math.hypot(dx, dy);
    if (length > amount * 6) {
      // A long chalk movement bends under the hand: bulge it sideways.
      const mid = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
      const bulge = (random() - 0.5) * amount * 3;
      points.push({ x: mid.x - (dy / length) * bulge, y: mid.y + (dx / length) * bulge });
    }
  }
  return Object.freeze(points);
}

function chalkRuns(lines: readonly MenuTextLine[], random: () => number): BoardDrawRun[] {
  const runs: BoardDrawRun[] = [];
  for (const line of lines) {
    if (line.tone === 'promo') continue;
    for (const glyph of placeLineGlyphs(line)) {
      glyph.strokes.forEach((stroke, strokeIndex) => {
        const wobble = line.size * 0.022;
        const run: ChalkStrokeRun = {
          kind: 'chalk-stroke',
          id: `chalk:${line.id}:${glyph.charIndex}:${strokeIndex}`,
          lineId: line.id,
          char: glyph.char,
          charIndex: glyph.charIndex,
          strokeIndex,
          points: jitterStroke(stroke, wobble, random),
          weight: line.weight * line.size * 1.2,
          wobble,
          opacity: line.opacity,
        };
        runs.push(run);
      });
    }
  }
  return runs;
}

function smudgeRuns(
  layout: BoardLayoutLike,
  random: () => number,
  count: number,
): ChalkSmudgeRun[] {
  const runs: ChalkSmudgeRun[] = [];
  for (let index = 0; index < count; index += 1) {
    const radiusX = 0.03 + random() * 0.08;
    const radiusY = 0.02 + random() * 0.05;
    const drag = (random() - 0.5) * 0.1;
    // Keep the whole smudge on the slate: the layout never leaves the face.
    const marginX = radiusX + Math.abs(drag) + 0.01;
    const marginY = radiusY + 0.015;
    const spanX = Math.max(layout.aspect - marginX * 2, 0.01);
    const spanY = Math.max(1 - marginY * 2, 0.01);
    runs.push({
      kind: 'chalk-smudge',
      id: `smudge:${index}`,
      center: {
        x: marginX + random() * spanX,
        y: marginY + random() * spanY,
      },
      radiusX,
      radiusY,
      angle: (random() - 0.5) * 0.8,
      strength: 0.16 + random() * 0.3,
      drag,
    });
  }
  return runs;
}

interface BoardLayoutLike {
  readonly aspect: number;
}

function vinylRuns(lines: readonly MenuTextLine[], random: () => number): BoardDrawRun[] {
  const runs: BoardDrawRun[] = [];
  for (const line of lines) {
    if (line.tone === 'promo') continue;
    for (const glyph of placeLineGlyphs(line)) {
      const run: VinylLetterRun = {
        kind: 'vinyl-letter',
        id: `vinyl:${line.id}:${glyph.charIndex}`,
        lineId: line.id,
        char: glyph.char,
        charIndex: glyph.charIndex,
        center: glyph.center,
        size: line.size,
        rotation: (random() - 0.5) * (line.kind === 'heading' ? 0.008 : 0.022),
        tracking: line.tracking,
        bleed: line.size * 0.07,
        shadow: line.size * 0.1,
        opacity: line.opacity,
      };
      runs.push(run);
    }
  }
  return runs;
}

function snapToTile(
  point: FacePoint,
  pitch: number,
  aspect: number,
): { center: FacePoint; row: number; column: number } {
  const column = Math.max(0, Math.round((point.x - pitch / 2) / pitch));
  const row = Math.max(0, Math.round((point.y - pitch / 2) / pitch));
  const center: FacePoint = {
    x: Math.min(Math.max(column * pitch + pitch / 2, pitch * 0.6), aspect - pitch * 0.6),
    y: Math.min(Math.max(row * pitch + pitch / 2, pitch * 0.7), 1 - pitch * 0.7),
  };
  return { center, row, column };
}

function tileRuns(
  lines: readonly MenuTextLine[],
  random: () => number,
  pitch: number,
  aspect: number,
): BoardDrawRun[] {
  const runs: BoardDrawRun[] = [];
  for (const line of lines) {
    if (line.tone === 'promo') continue;
    for (const glyph of placeLineGlyphs(line)) {
      const snapped = snapToTile(glyph.center, pitch, aspect);
      const run: FluorescentTileRun = {
        kind: 'fluorescent-tile',
        id: `tile:${line.id}:${glyph.charIndex}:${snapped.row}:${snapped.column}`,
        lineId: line.id,
        char: glyph.char,
        charIndex: glyph.charIndex,
        center: snapped.center,
        size: pitch * 0.74,
        glow: line.kind === 'price' || line.kind === 'heading' ? 1 : 0.86,
        row: snapped.row,
        column: snapped.column,
        // A working letter board is always one tile short of a full set.
        missing: glyph.char !== ' ' && random() < 0.012,
      };
      runs.push(run);
    }
  }
  return runs;
}

function ruleRuns(specs: readonly RuleSpec[], tone: TextTone, random: () => number): BoardDrawRun[] {
  return specs.map((spec, index) => {
    const run: MenuRuleRun = {
      kind: 'menu-rule',
      id: `rule:${index}`,
      from: {
        x: spec.from.x,
        y: spec.from.y + (random() - 0.5) * spec.weight,
      },
      to: {
        x: spec.to.x,
        y: spec.to.y + (random() - 0.5) * spec.weight,
      },
      weight: spec.weight,
      tone,
      dotted: true,
      opacity: 0.62,
    };
    return run;
  });
}

function wearRun(
  kind: WearKind,
  index: number,
  center: FacePoint,
  radius: number,
  strength: number,
  angle: number,
  aspect: number,
  bounds?: FaceRect,
): WearRun {
  // Clamp the wear mark so the run never leaves the board face.
  const limit = Math.min(radius, Math.max(Math.min(aspect, 1) / 2 - 0.01, 0.01));
  return {
    kind: 'wear',
    id: `wear:${kind}:${index}`,
    wear: kind,
    center: {
      x: Math.min(Math.max(center.x, limit), Math.max(aspect - limit, limit)),
      y: Math.min(Math.max(center.y, limit), Math.max(1 - limit, limit)),
    },
    radius,
    angle,
    strength,
    ...(bounds !== undefined ? { bounds } : {}),
  };
}

function wearRuns(spec: MenuBoardSpec, form: BoardForm, random: () => number): BoardDrawRun[] {
  const aspect = form.width / form.height;
  const wear = spec.surface.wear;
  const runs: WearRun[] = [];
  const pick = (): FacePoint => ({
    x: 0.12 + random() * (aspect - 0.24),
    y: 0.14 + random() * 0.68,
  });
  const band = (width: number, height: number): FaceRect => {
    const point = pick();
    return {
      x: Math.min(Math.max(point.x - width / 2, 0.01), Math.max(aspect - width - 0.01, 0.01)),
      y: Math.min(Math.max(point.y - height / 2, 0.01), Math.max(1 - height - 0.01, 0.01)),
      width,
      height,
    };
  };

  switch (spec.boardKind) {
    case 'chalk-slate':
      runs.push(
        wearRun('chalk-dust', 0, { x: aspect * 0.5, y: 0.055 }, 0.09 + wear * 0.04, 0.5 * wear + 0.2, 0, aspect, {
          x: 0.05,
          y: 0.02,
          width: aspect - 0.1,
          height: 0.05,
        }),
        wearRun('chalk-ghost', 1, { x: aspect * 0.28, y: 0.34 }, 0.12, 0.34 * wear + 0.12, -0.05, aspect, {
          x: aspect * 0.1,
          y: 0.28,
          width: aspect * 0.36,
          height: 0.06,
        }),
        wearRun('coffee-ring', 2, { x: aspect * 0.82, y: 0.2 }, 0.045 + wear * 0.02, 0.36 * wear + 0.16, 0, aspect),
      );
      break;
    case 'painted-vinyl':
      runs.push(
        wearRun('paint-loss', 0, { x: aspect * 0.16, y: 0.82 }, 0.05, 0.4, 0.6, aspect, band(0.09, 0.07)),
        wearRun('paint-loss', 1, { x: aspect * 0.88, y: 0.16 }, 0.04, 0.32, -0.4, aspect, band(0.06, 0.05)),
        wearRun('sun-bleach', 2, { x: aspect * 0.62, y: 0.5 }, 0.2, 0.22 * wear + 0.1, 0, aspect, band(aspect * 0.44, 0.6)),
        wearRun('coffee-ring', 3, { x: aspect * 0.44, y: 0.1 }, 0.035, 0.24, 0, aspect),
      );
      break;
    case 'fluorescent-letterboard':
      runs.push(
        wearRun('missing-tile', 0, { x: aspect * 0.26, y: 0.66 }, 0.02, 0.9, 0, aspect),
        wearRun('missing-tile', 1, { x: aspect * 0.68, y: 0.34 }, 0.02, 0.9, 0, aspect),
        wearRun('sun-bleach', 2, { x: aspect * 0.5, y: 0.52 }, 0.18, 0.28 * wear + 0.12, 0, aspect, band(aspect * 0.5, 0.72)),
      );
      break;
    case 'backlit-acrylic':
      runs.push(
        wearRun('dead-led', 0, { x: aspect * 0.32, y: 0.14 }, 0.05, 0.75, 0, aspect, band(0.1, 0.04)),
        wearRun('dead-led', 1, { x: aspect * 0.74, y: 0.86 }, 0.045, 0.6, 0, aspect, band(0.08, 0.035)),
        wearRun('sun-bleach', 2, { x: aspect * 0.5, y: 0.5 }, 0.22, 0.24 * wear + 0.1, 0, aspect, band(aspect * 0.5, 0.8)),
      );
      break;
    case 'digital-screen':
    default:
      runs.push(
        wearRun('screen-ghost', 0, { x: aspect * 0.3, y: 0.44 }, 0.16, 0.3, 0.04, aspect, band(aspect * 0.3, 0.5)),
        wearRun('screen-ghost', 1, { x: aspect * 0.78, y: 0.38 }, 0.12, 0.24, -0.03, aspect, band(aspect * 0.22, 0.42)),
        wearRun('dead-led', 2, { x: aspect * 0.52, y: 0.06 }, 0.03, 0.5, 0, aspect, band(0.05, 0.025)),
      );
      break;
  }
  return runs;
}

function panelRuns(
  spec: MenuBoardSpec,
  draft: DraftLayout,
  kind: 'backlit' | 'digital',
  metrics: StyleMetrics,
): BoardDrawRun[] {
  const runs: BoardDrawRun[] = [];
  const headerLines = [draft.heading, draft.subheading];
  const footerLines = [draft.footer];
  const digital = kind === 'digital';

  const band = (
    id: string,
    index: number,
    panelId: string,
    title: string,
    emphasis: BoardPanelEmphasis,
    bounds: FaceRect,
    lines: readonly MenuTextLine[],
    itemIds: readonly string[],
    rotationSeconds: number,
  ): BacklitPanelRun | DigitalPanelRun => {
    if (digital) {
      const rotation = rotationSeconds > 0 ? rotationSeconds : 0;
      const run: DigitalPanelRun = {
        kind: 'digital-panel',
        id,
        panelId,
        index,
        title,
        emphasis,
        bounds,
        lines,
        itemIds,
        phase: rotation > 0 ? (index < 0 ? 0 : index / Math.max(draft.columns.length, 1)) : 0,
        rotationSeconds: rotation,
        luminance: emphasis === 'promo' ? 0.92 : emphasis === 'feature' ? 0.88 : 0.8,
        scanlines: 44,
      };
      return run;
    }
    const run: BacklitPanelRun = {
      kind: 'backlit-panel',
      id,
      panelId,
      index,
      title,
      emphasis,
      bounds,
      lines,
      itemIds,
      glow: emphasis === 'promo' ? 0.95 : 0.9,
      sheen: emphasis === 'promo' ? 0.6 : 0.48,
    };
    return run;
  };

  runs.push(
    band(
      `${kind}:header`,
      -1,
      'header',
      '',
      'standard',
      draft.headerBounds,
      headerLines,
      [],
      0,
    ),
  );
  for (const column of draft.columns) {
    runs.push(
      band(
        `${kind}:${column.panelId}`,
        column.index,
        column.panelId,
        column.title,
        column.emphasis,
        column.rect,
        column.lines,
        column.itemIds,
        column.rotationSeconds,
      ),
    );
  }
  runs.push(
    band(`${kind}:footer`, -1, 'footer', '', 'standard', draft.footerBounds, footerLines, [], 0),
  );
  return runs;
}

function emitRuns(
  spec: MenuBoardSpec,
  form: BoardForm,
  draft: DraftLayout,
  seed: number,
): BoardDrawRun[] {
  const metrics = styleMetrics(spec.lettering);
  const random = createSeededRandom(seed + 0x51ed);
  const aspect = form.width / form.height;
  const boardLines: MenuTextLine[] = [
    draft.heading,
    draft.subheading,
    draft.footer,
    ...draft.columns.flatMap((column) => column.lines),
  ];
  const layoutLike: BoardLayoutLike = { aspect };

  switch (spec.lettering) {
    case 'applied-vinyl': {
      const runs: BoardDrawRun[] = [
        ...vinylRuns(boardLines, random),
        ...ruleRuns(draft.ruleSpecs, metrics.tone, random),
        ...wearRuns(spec, form, random),
      ];
      return runs;
    }
    case 'fluorescent-tiles': {
      const runs: BoardDrawRun[] = [
        ...tileRuns(boardLines, random, metrics.tilePitch, aspect),
        ...wearRuns(spec, form, random),
      ];
      if (spec.promo && draft.promoBounds) {
        const promo = spec.promo;
        const strip: PromoStripRun = {
          kind: 'promo-strip',
          id: `promo-strip:${spec.year}`,
          bounds: draft.promoBounds,
          headline: normaliseBoardText(promo.headline),
          badge: promo.badge ? normaliseBoardText(promo.badge) : null,
          stripes: promo.stripes ?? ['#d81e5b', '#f7d002'],
          lines: draft.promoLines,
          glow: 0.92,
        };
        runs.push(strip);
      }
      return runs;
    }
    case 'backlit-print':
      return [
        ...panelRuns(spec, draft, 'backlit', metrics),
        ...ruleRuns(draft.ruleSpecs, metrics.tone, random),
        ...wearRuns(spec, form, random),
      ];
    case 'emissive-digital':
      return [...panelRuns(spec, draft, 'digital', metrics), ...wearRuns(spec, form, random)];
    case 'hand-chalk':
    default: {
      return [
        ...chalkRuns(boardLines, random),
        ...smudgeRuns(layoutLike, random, 5 + Math.round(spec.surface.wear * 4)),
        ...ruleRuns(draft.ruleSpecs, metrics.tone, random),
        ...wearRuns(spec, form, random),
      ];
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Layout entry point                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Turns one era's menu spec and board form into the board's procedural layout:
 * fitted lettering, menu columns and every draw run of the era's technique.
 * Pure and deterministic — the same spec and form always produce the same runs.
 */
export function layoutMenuBoard(
  spec: MenuBoardSpec,
  form: BoardForm,
  options: BoardLayoutOptions = {},
): BoardLayout {
  const seed = options.seed ?? menuBoardSeed(spec.year, form.kind);
  let scale = 1;
  let draft = buildDraft(spec, form, scale);
  for (let attempt = 0; attempt < 14 && !draft.fits; attempt += 1) {
    scale *= 0.9;
    draft = buildDraft(spec, form, scale);
  }

  const runs = emitRuns(spec, form, draft, seed);
  const panels = runsOfKind(runs, 'backlit-panel').filter((run) => run.index >= 0);
  const digitalPanels = runsOfKind(runs, 'digital-panel').filter((run) => run.index >= 0);
  const promo = runsOfKind(runs, 'promo-strip')[0] ?? null;
  const itemIds = draft.columns.flatMap((column) => column.itemIds);
  const aspect = form.width / form.height;

  const layout: BoardLayout = {
    year: spec.year,
    kind: form.kind,
    lettering: spec.lettering,
    aspect,
    width: form.width,
    height: form.height,
    heading: draft.heading,
    subheading: draft.subheading,
    footer: draft.footer,
    columns: draft.columns,
    promo,
    panels: Object.freeze([...panels, ...digitalPanels]),
    runs: Object.freeze(runs),
    itemIds: Object.freeze(itemIds),
    scale: draft.scale,
    seed,
    signature: '',
  };
  return Object.freeze({ ...layout, signature: boardLayoutSignature(layout) });
}

/** Stable fingerprint of a layout's run set: era identity for assertions. */
export function boardLayoutSignature(layout: BoardLayout): string {
  const parts: string[] = [`${layout.year}|${layout.kind}|${layout.lettering}|${layout.runs.length}`];
  for (const run of layout.runs) {
    const bounds = runBounds(run);
    parts.push(
      `${run.kind}:${run.id}:${bounds.x.toFixed(3)}:${bounds.y.toFixed(3)}:${bounds.width.toFixed(3)}:${bounds.height.toFixed(3)}`,
    );
  }
  return `${(boardHash(parts.join(';')) >>> 0).toString(16)}-${layout.runs.length}`;
}

/**
 * Compact human readable summary of one era's board layout — the artefact the
 * print style, chalk smudging, wear, promo and substitute-price detail can be
 * reviewed from without a GPU or a browser. `npx vitest run src/domains/menuboard`
 * prints one report per era.
 */
export function boardLayoutReport(layout: BoardLayout): string {
  const counts = new Map<string, number>();
  for (const run of layout.runs) counts.set(run.kind, (counts.get(run.kind) ?? 0) + 1);
  const runDetail = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${count}x ${kind}`)
    .join(', ');
  const lines = layout.columns.flatMap((column) => column.lines);
  const items = lines.filter((line) => line.kind === 'item');
  const prices = lines.filter((line) => line.kind === 'price');
  const notes = lines.filter((line) => line.kind === 'note');
  const substitutes = lines.filter((line) => line.substitute);
  const panels =
    layout.panels.length > 0
      ? layout.panels
          .map(
            (panel) =>
              `${panel.title || panel.panelId}${
                panel.kind === 'digital-panel' ? ` @${panel.rotationSeconds}s` : ' backlit'
              }`,
          )
          .join(' | ')
      : 'none (single surface)';
  return [
    `${layout.year} - ${layout.kind} board in ${layout.lettering} lettering`,
    `  face ${layout.aspect.toFixed(3)} heights wide, fitted at scale ${layout.scale.toFixed(3)}`,
    `  runs: ${runDetail}`,
    `  columns: ${layout.columns.map((column) => `${column.title}[${column.itemIds.length}]`).join(' | ')}`,
    `  menu: ${items.length} items, ${prices.length} prices, ${notes.length} notes, ${substitutes.length} substitute annotations${
      substitutes.length > 0 ? ` (${substitutes.map((line) => line.text).join('; ')})` : ''
    }`,
    `  panels: ${panels}`,
    layout.promo
      ? `  promo band: ${layout.promo.headline} - ${layout.promo.lines.map((line) => line.text).join(' / ')}`
      : '  promo band: none',
    `  wear: ${runsOfKind(layout.runs, 'wear').map((run) => run.wear).join(', ') || 'none'}`,
    `  sample: ${items[0]?.text ?? '-'} ${prices[0]?.text ?? '-'} (cap ${(items[0]?.size ?? 0).toFixed(3)} heights)`,
    `  signature: ${layout.signature}`,
  ].join('\n');
}

/** Bounding rectangle of one run, in face space. */
export function runBounds(run: BoardDrawRun): FaceRect {
  switch (run.kind) {
    case 'chalk-stroke': {
      return pointsBounds(run.points, run.weight);
    }
    case 'chalk-smudge': {
      return {
        x: run.center.x - run.radiusX,
        y: run.center.y - run.radiusY,
        width: run.radiusX * 2,
        height: run.radiusY * 2,
      };
    }
    case 'vinyl-letter': {
      const halfWidth = (glyphAdvance(run.char) * run.size) / 2;
      return {
        x: run.center.x - halfWidth,
        y: run.center.y - run.size / 2,
        width: halfWidth * 2,
        height: run.size,
      };
    }
    case 'fluorescent-tile': {
      return {
        x: run.center.x - run.size / 2,
        y: run.center.y - run.size / 2,
        width: run.size,
        height: run.size,
      };
    }
    case 'wear':
      return {
        x: run.center.x - run.radius,
        y: run.center.y - run.radius,
        width: run.radius * 2,
        height: run.radius * 2,
      };
    case 'menu-rule':
      return {
        x: Math.min(run.from.x, run.to.x),
        y: Math.min(run.from.y, run.to.y),
        width: Math.abs(run.to.x - run.from.x),
        height: Math.abs(run.to.y - run.from.y),
      };
    case 'promo-strip':
    case 'backlit-panel':
    case 'digital-panel':
      return run.bounds;
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function pointsBounds(points: readonly FacePoint[], weight: number): FaceRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: minX - weight,
    y: minY - weight,
    width: maxX - minX + weight * 2,
    height: maxY - minY + weight * 2,
  };
}

/** Union of every run's bounding rectangle, in face space. */
export function layoutRunBounds(layout: BoardLayout): FaceRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const run of layout.runs) {
    const bounds = runBounds(run);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/* -------------------------------------------------------------------------- */
/* Colours                                                                   */
/* -------------------------------------------------------------------------- */

/** A colour in 0..255 components. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const NAMED: Readonly<Record<string, number>> = Object.freeze({
  black: 0x000000,
  white: 0xffffff,
  grey: 0x808080,
  gray: 0x808080,
});

/** Parses `#rgb`, `#rrggbb` and a couple of CSS names into 0..255 components. */
export function parseColour(value: string): Rgb {
  const text = value.trim().toLowerCase();
  const named = NAMED[text];
  if (named !== undefined) {
    return { r: (named >> 16) & 0xff, g: (named >> 8) & 0xff, b: named & 0xff };
  }
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] ?? '0', 16) * 17,
        g: Number.parseInt(hex[1] ?? '0', 16) * 17,
        b: Number.parseInt(hex[2] ?? '0', 16) * 17,
      };
    }
    const parsed = Number.parseInt(hex.slice(0, 6), 16);
    if (Number.isFinite(parsed)) {
      return { r: (parsed >> 16) & 0xff, g: (parsed >> 8) & 0xff, b: parsed & 0xff };
    }
  }
  return { r: 128, g: 128, b: 128 };
}

/** Scales a colour's components by `factor`. */
export function scaleColour(colour: Rgb, factor: number): Rgb {
  const clamp = (value: number): number => Math.min(Math.max(Math.round(value), 0), 255);
  return { r: clamp(colour.r * factor), g: clamp(colour.g * factor), b: clamp(colour.b * factor) };
}

/** Blends two colours; `t` = 0 returns `a`, `t` = 1 returns `b`. */
export function mixColour(a: Rgb, b: Rgb, t: number): Rgb {
  const amount = Math.min(Math.max(t, 0), 1);
  const clamp = (value: number): number => Math.min(Math.max(Math.round(value), 0), 255);
  return {
    r: clamp(a.r + (b.r - a.r) * amount),
    g: clamp(a.g + (b.g - a.g) * amount),
    b: clamp(a.b + (b.b - a.b) * amount),
  };
}

/* -------------------------------------------------------------------------- */
/* Raster                                                                    */
/* -------------------------------------------------------------------------- */

/** An RGBA raster the board face is painted into. */
export class FaceRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = Math.max(Math.trunc(width), 1);
    this.height = Math.max(Math.trunc(height), 1);
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
  }

  /** Fills the whole raster with `colour`. */
  fill(colour: Rgb): void {
    for (let index = 0; index < this.data.length; index += 4) {
      this.data[index] = colour.r;
      this.data[index + 1] = colour.g;
      this.data[index + 2] = colour.b;
      this.data[index + 3] = 255;
    }
  }

  /** Reads one pixel. */
  sample(x: number, y: number): Rgb {
    const px = Math.min(Math.max(Math.trunc(x), 0), this.width - 1);
    const py = Math.min(Math.max(Math.trunc(y), 0), this.height - 1);
    const offset = (py * this.width + px) * 4;
    return {
      r: this.data[offset] ?? 0,
      g: this.data[offset + 1] ?? 0,
      b: this.data[offset + 2] ?? 0,
    };
  }

  /** Alpha blends `colour` into one pixel. */
  blend(x: number, y: number, colour: Rgb, alpha: number): void {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const amount = Math.min(Math.max(alpha, 0), 1);
    if (amount <= 0) return;
    const offset = (py * this.width + px) * 4;
    this.data[offset] = (this.data[offset] ?? 0) + (colour.r - (this.data[offset] ?? 0)) * amount;
    this.data[offset + 1] =
      (this.data[offset + 1] ?? 0) + (colour.g - (this.data[offset + 1] ?? 0)) * amount;
    this.data[offset + 2] =
      (this.data[offset + 2] ?? 0) + (colour.b - (this.data[offset + 2] ?? 0)) * amount;
  }

  /** Soft edged disc, used for every brush stroke in this module. */
  disc(cx: number, cy: number, radius: number, colour: Rgb, alpha: number, hardness = 0.6): void {
    const outer = Math.max(radius, 0.35);
    const from = Math.floor(cx - outer) - 1;
    const to = Math.ceil(cx + outer) + 1;
    const top = Math.floor(cy - outer) - 1;
    const bottom = Math.ceil(cy + outer) + 1;
    const inner = outer * Math.min(Math.max(hardness, 0), 0.98);
    for (let y = top; y <= bottom; y += 1) {
      for (let x = from; x <= to; x += 1) {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance > outer) continue;
        const falloff =
          distance <= inner ? 1 : 1 - (distance - inner) / Math.max(outer - inner, 0.0001);
        this.blend(x, y, colour, alpha * falloff);
      }
    }
  }

  /** Ellipse, optionally rotated, with a soft edge. */
  ellipse(
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
    angle: number,
    colour: Rgb,
    alpha: number,
    hardness = 0.2,
  ): void {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const extent = Math.max(radiusX, radiusY) + 2;
    const inner = Math.min(Math.max(hardness, 0), 0.98);
    for (let y = Math.floor(cy - extent); y <= Math.ceil(cy + extent); y += 1) {
      for (let x = Math.floor(cx - extent); x <= Math.ceil(cx + extent); x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;
        const distance = Math.hypot(localX / Math.max(radiusX, 0.001), localY / Math.max(radiusY, 0.001));
        if (distance > 1) continue;
        const falloff = distance <= inner ? 1 : 1 - (distance - inner) / Math.max(1 - inner, 0.0001);
        this.blend(x, y, colour, alpha * falloff);
      }
    }
  }

  /** Straight line drawn as a run of discs, the way a brush leaves paint. */
  line(
    from: { x: number; y: number },
    to: { x: number; y: number },
    width: number,
    colour: Rgb,
    alpha: number,
  ): void {
    const radius = Math.max(width / 2, 0.4);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(Math.ceil(length / Math.max(radius * 0.5, 0.35)), 1);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      this.disc(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, colour, alpha);
    }
  }

  /** Polyline in pixel space. */
  polyline(
    points: readonly { x: number; y: number }[],
    width: number,
    colour: Rgb,
    alpha: number,
  ): void {
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (!from || !to) continue;
      this.line(from, to, width, colour, alpha);
    }
  }

  /** Axis aligned rectangle in pixel space. */
  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    colour: Rgb,
    alpha: number,
  ): void {
    const from = { x, y };
    const to = { x: x + Math.max(width - 1, 0), y: y + Math.max(height - 1, 0) };
    this.line(from, { x: to.x, y: from.y }, 1.2, colour, alpha);
    this.line({ x: to.x, y: from.y }, to, 1.2, colour, alpha);
    this.line(to, { x: from.x, y: to.y }, 1.2, colour, alpha);
    this.line({ x: from.x, y: to.y }, from, 1.2, colour, alpha);
    if (width > 2 && height > 2) {
      for (let y2 = Math.ceil(y) + 1; y2 < y + height - 1; y2 += 1) {
        for (let x2 = Math.ceil(x) + 1; x2 < x + width - 1; x2 += 1) {
          this.blend(x2, y2, colour, alpha);
        }
      }
    }
  }

  /** Mean luminance of the raster, `0..1`. Used to compare lit and unlit eras. */
  meanLuminance(): number {
    let total = 0;
    let count = 0;
    for (let index = 0; index < this.data.length; index += 4) {
      const r = this.data[index] ?? 0;
      const g = this.data[index + 1] ?? 0;
      const b = this.data[index + 2] ?? 0;
      total += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      count += 1;
    }
    return count > 0 ? total / count : 0;
  }

  /** Fraction of pixels differing from `reference` by more than `tolerance`. */
  differingFraction(reference: Rgb, tolerance = 24): number {
    let differing = 0;
    let count = 0;
    for (let index = 0; index < this.data.length; index += 4) {
      const r = this.data[index] ?? 0;
      const g = this.data[index + 1] ?? 0;
      const b = this.data[index + 2] ?? 0;
      if (
        Math.abs(r - reference.r) > tolerance ||
        Math.abs(g - reference.g) > tolerance ||
        Math.abs(b - reference.b) > tolerance
      ) {
        differing += 1;
      }
      count += 1;
    }
    return count > 0 ? differing / count : 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Painting                                                                  */
/* -------------------------------------------------------------------------- */

/** Which of the board's two procedural maps is being painted. */
export type BoardFaceLayer = 'face' | 'glow';

interface PaintContext {
  readonly raster: FaceRaster;
  readonly layout: BoardLayout;
  readonly surface: BoardSurfaceSpec;
  readonly form: BoardForm;
  readonly layer: BoardFaceLayer;
  readonly random: () => number;
  readonly px: (x: number) => number;
  readonly py: (y: number) => number;
  readonly lx: (length: number) => number;
  readonly ly: (length: number) => number;
  readonly ink: Rgb;
  readonly inkAccent: Rgb;
  readonly glow: Rgb;
}

function layerColour(context: PaintContext, accent: boolean): Rgb {
  if (context.layer === 'glow') return context.glow;
  return accent ? context.inkAccent : context.ink;
}

function paintStroke(
  context: PaintContext,
  stroke: readonly FacePoint[],
  width: number,
  colour: Rgb,
  alpha: number,
): void {
  const points = stroke.map((point) => ({ x: context.px(point.x), y: context.py(point.y) }));
  context.raster.polyline(points, Math.max(width, 0.7), colour, alpha);
}

function paintGlyphStrokes(
  context: PaintContext,
  strokes: readonly (readonly FacePoint[])[],
  size: number,
  weight: number,
  colour: Rgb,
  alpha: number,
): void {
  const width = Math.max(context.ly(size * weight), 0.8);
  for (const stroke of strokes) paintStroke(context, stroke, width, colour, alpha);
}

function paintTextLine(context: PaintContext, line: MenuTextLine, colour: Rgb): void {
  for (const glyph of placeLineGlyphs(line)) {
    paintGlyphStrokes(
      context,
      glyph.strokes,
      line.size,
      line.weight,
      colour,
      line.opacity * (context.layer === 'glow' ? 0.9 : 1),
    );
  }
}

function paintBase(context: PaintContext): void {
  const { raster, surface, form, layout } = context;
  const face = parseColour(surface.face);
  const faceAccent = parseColour(surface.faceAccent);
  const faceShadow = parseColour(surface.faceShadow);
  const width = raster.width;
  const height = raster.height;

  switch (layout.kind) {
    case 'chalk-slate': {
      raster.fill(mixColour(face, faceShadow, 0.25));
      // Slate: fine mineral speckle plus the wipe marks of a wet cloth.
      for (let index = 0; index < width * height * 0.06; index += 1) {
        const x = context.random() * width;
        const y = context.random() * height;
        const tone = context.random() < 0.5 ? faceAccent : scaleColour(faceShadow, 0.8);
        raster.blend(x, y, tone, 0.06 + context.random() * 0.14);
      }
      const wipes = 26;
      for (let index = 0; index < wipes; index += 1) {
        const y = context.random() * height;
        const x = context.random() * width;
        raster.ellipse(x, y, 26 + context.random() * 60, 1.6 + context.random() * 3.4, 0, faceAccent, 0.05, 0.1);
      }
      // The bevel and the shadow the slate casts on the wall behind it.
      raster.rect(0, 0, width, Math.max(height * 0.02, 3), faceShadow, 0.35);
      raster.rect(0, height - Math.max(height * 0.015, 2), width, Math.max(height * 0.015, 2), faceShadow, 0.25);
      break;
    }
    case 'painted-vinyl': {
      raster.fill(face);
      // Coach paint: long vertical brush strokes and a painted border band.
      for (let index = 0; index < 90; index += 1) {
        const x = context.random() * width;
        raster.ellipse(x, height / 2, 1.1 + context.random() * 2.4, height * (0.3 + context.random() * 0.6), 0, faceAccent, 0.05, 0);
      }
      const band = Math.max(context.ly(form.frameWidth * 1.6), 4);
      raster.rect(0, 0, width, band, faceAccent, 0.9);
      raster.rect(0, height - band, width, band, faceAccent, 0.9);
      raster.rect(0, 0, band, height, faceAccent, 0.9);
      raster.rect(width - band, 0, band, height, faceAccent, 0.9);
      break;
    }
    case 'fluorescent-letterboard': {
      raster.fill(scaleColour(faceShadow, 0.55));
      // Black felt inside a white light box, with the tile rails showing through.
      for (let index = 0; index < 240; index += 1) {
        raster.blend(
          context.random() * width,
          context.random() * height,
          faceAccent,
          0.04 + context.random() * 0.05,
        );
      }
      for (const column of layout.columns) {
        const x = context.px(column.rect.x);
        const y = context.py(column.rect.y + column.rect.height);
        const w = context.lx(column.rect.width);
        const h = context.ly(column.rect.height);
        raster.rect(x, y, w, h, scaleColour(face, 0.7), 0.24);
      }
      const railPitch = Math.max(context.ly(0.032), 3);
      for (let y = railPitch; y < height; y += railPitch) {
        for (let x = 0; x < width; x += 1) raster.blend(x, y, faceShadow, 0.16);
      }
      break;
    }
    case 'backlit-acrylic': {
      raster.fill(mixColour(face, surface.faceAccent ? parseColour(surface.faceAccent) : face, 0.2));
      // Acrylic: a bright panel with a soft sheen running across it.
      const sheen = parseColour(surface.glow);
      for (let index = 0; index < 120; index += 1) {
        const t = context.random();
        raster.ellipse(
          width * (0.1 + t * 0.8),
          height * (0.1 + context.random() * 0.8),
          width * 0.16,
          height * 0.05,
          -0.5,
          sheen,
          0.05,
          0,
        );
      }
      break;
    }
    case 'digital-screen':
    default: {
      raster.fill(scaleColour(faceShadow, 0.35));
      const glass = parseColour(surface.glow);
      for (let index = 0; index < 160; index += 1) {
        raster.blend(
          context.random() * width,
          context.random() * height,
          glass,
          0.02 + context.random() * 0.03,
        );
      }
      // A screen is brightest in the middle and falls off towards the bezel.
      const cx = width / 2;
      const cy = height / 2;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const distance = Math.hypot((x - cx) / (width / 2), (y - cy) / (height / 2));
          raster.blend(x, y, scaleColour(glass, 0.4), Math.min(distance * 0.22, 0.3));
        }
      }
      break;
    }
  }
}

function paintPanels(context: PaintContext, runs: readonly PanelRun[]): void {
  const { raster } = context;
  const accent = layerColour(context, false);
  for (const panel of runs) {
    const x = context.px(panel.bounds.x);
    const y = context.py(panel.bounds.y + panel.bounds.height);
    const w = context.lx(panel.bounds.width);
    const h = context.ly(panel.bounds.height);
    if (context.layer === 'face' && panel.kind === 'digital-panel') {
      raster.rect(x, y, w, h, scaleColour(accent, 0.35), 0.5);
    }
    if (context.layer === 'face' && panel.kind === 'backlit-panel') {
      // Even backlighting: a soft wash with a slightly brighter centre.
      const wash = mixColour(accent, parseColour(context.surface.face), 0.72);
      raster.rect(x + 1, y + 1, w - 2, h - 2, wash, 0.32);
    }
    if (context.layer === 'glow') {
      const strength = panel.kind === 'digital-panel' ? panel.luminance : panel.glow;
      raster.rect(x, y, w, h, accent, 0.16 * strength);
    }
    for (const line of panel.lines) {
      paintTextLine(context, line, line.tone === 'promo' ? context.glow : layerColour(context, line.kind === 'price'));
    }
    if (panel.kind === 'digital-panel') {
      const scanPitch = Math.max(h / Math.max(panel.scanlines, 1), 1.4);
      for (let line = y; line < y + h; line += scanPitch) {
        for (let sx = x; sx < x + w; sx += 1) {
          raster.blend(sx, line, scaleColour(accent, 0.2), context.layer === 'glow' ? 0.06 : 0.1);
        }
      }
    }
  }
}

function paintTiles(context: PaintContext, tiles: readonly FluorescentTileRun[]): void {
  const { raster } = context;
  const glow = layerColour(context, false);
  for (const tile of tiles) {
    const cx = context.px(tile.center.x);
    const cy = context.py(tile.center.y);
    const size = context.ly(tile.size);
    if (tile.missing) {
      if (context.layer === 'face') {
        raster.rect(cx - size / 2, cy - size / 2, size, size, parseColour(context.surface.faceShadow), 0.85);
      }
      continue;
    }
    if (context.layer === 'face') {
      const chip = mixColour(glow, parseColour('#ffffff'), 0.35);
      raster.rect(cx - size / 2, cy - size / 2, size, size, chip, 0.55 + tile.glow * 0.3);
      const strokes = glyphStrokesAt(tile.char, tile.center, tile.size * 0.72, 0);
      paintGlyphStrokes(context, strokes, tile.size * 0.72, 0.2, parseColour(context.surface.faceShadow), 0.9);
    } else {
      raster.rect(cx - size / 2, cy - size / 2, size, size, glow, 0.35 * tile.glow + 0.12);
      const strokes = glyphStrokesAt(tile.char, tile.center, tile.size * 0.72, 0);
      paintGlyphStrokes(context, strokes, tile.size * 0.72, 0.22, glow, 0.3 * tile.glow);
    }
  }
}

function paintPromoStrip(context: PaintContext, strip: PromoStripRun): void {
  const { raster } = context;
  const x = context.px(strip.bounds.x);
  const y = context.py(strip.bounds.y + strip.bounds.height);
  const w = context.lx(strip.bounds.width);
  const h = context.ly(strip.bounds.height);
  const first = parseColour(strip.stripes[0]);
  const second = parseColour(strip.stripes[1]);
  if (context.layer === 'face') {
    raster.rect(x, y, w, h, scaleColour(first, 0.4), 0.75);
    const stripeCount = 7;
    for (let index = 0; index < stripeCount; index += 1) {
      const stripeWidth = w / (stripeCount * 2);
      raster.rect(x + index * stripeWidth * 2 + stripeWidth / 2, y, stripeWidth, h, index % 2 === 0 ? first : second, 0.5);
    }
  }
  const glowColour = context.layer === 'glow' ? context.glow : parseColour('#fff2c4');
  for (const line of strip.lines) {
    if (context.layout.lettering === 'fluorescent-tiles') {
      // The promo strip is made of the same tiles as the rest of the board.
      for (const glyph of placeLineGlyphs(line)) {
        const size = line.size;
        const cx = context.px(glyph.center.x);
        const cy = context.py(glyph.center.y);
        const chip = context.ly(size);
        if (context.layer === 'face') {
          raster.rect(cx - chip / 2, cy - chip / 2, chip, chip, glowColour, 0.85);
          paintGlyphStrokes(context, glyph.strokes, size, 0.2, scaleColour(first, 0.35), 0.9);
        } else {
          raster.rect(cx - chip / 2, cy - chip / 2, chip, chip, gloss(context, strip.glow), 0.4);
        }
      }
      continue;
    }
    paintTextLine(context, line, glowColour);
  }
  if (context.layer === 'glow') {
    for (let sy = y; sy < y + h; sy += 1) {
      for (let sx = x; sx < x + w; sx += 1) {
        raster.blend(sx, sy, context.glow, 0.08 * strip.glow);
      }
    }
  }
}

function gloss(context: PaintContext, strength: number): Rgb {
  return mixColour(context.glow, parseColour('#ffffff'), 1 - Math.min(Math.max(strength, 0), 1));
}

function paintWear(context: PaintContext, runs: readonly WearRun[]): void {
  const { raster } = context;
  const surface = context.surface;
  const face = parseColour(surface.face);
  const shadow = parseColour(surface.faceShadow);
  const accent = parseColour(surface.faceAccent);
  for (const run of runs) {
    const cx = context.px(run.center.x);
    const cy = context.py(run.center.y);
    const radius = Math.max(context.ly(run.radius), 1);
    switch (run.wear) {
      case 'chalk-dust': {
        raster.ellipse(cx, cy, context.lx(run.radius), context.ly(run.radius * 0.5), 0, mixColour(face, parseColour('#ffffff'), 0.6), 0.22 + run.strength * 0.2, 0.1);
        for (let index = 0; index < 120; index += 1) {
          raster.blend(cx + (context.random() - 0.5) * radius * 3, cy + (context.random() - 0.5) * radius, mixColour(face, parseColour('#ffffff'), 0.8), 0.12 + context.random() * 0.14);
        }
        break;
      }
      case 'chalk-ghost': {
        raster.ellipse(cx, cy, context.lx(run.radius), context.ly(run.radius * 0.22), run.angle, mixColour(face, parseColour('#ffffff'), 0.5), 0.14 + run.strength * 0.16, 0);
        break;
      }
      case 'coffee-ring': {
        raster.ellipse(cx, cy, radius, radius * 0.9, run.angle, parseColour('#4a2c15'), 0.16 + run.strength * 0.2, 0.62);
        raster.ellipse(cx, cy, radius * 0.86, radius * 0.78, run.angle, face, 0.2, 0.5);
        break;
      }
      case 'paint-loss': {
        raster.ellipse(cx, cy, radius, radius * 0.8, run.angle, shadow, 0.3 + run.strength * 0.3, 0.2);
        raster.ellipse(cx, cy, radius * 0.6, radius * 0.5, run.angle, face, 0.35, 0.4);
        break;
      }
      case 'sun-bleach': {
        const bounds = run.bounds;
        if (!bounds) break;
        const bx = context.px(bounds.x);
        const by = context.py(bounds.y + bounds.height);
        const bw = context.lx(bounds.width);
        const bh = context.ly(bounds.height);
        for (let index = 0; index < 900; index += 1) {
          raster.blend(bx + context.random() * bw, by + context.random() * bh, mixColour(face, parseColour('#ffffff'), 0.75), 0.05 + run.strength * 0.08);
        }
        break;
      }
      case 'missing-tile': {
        raster.rect(cx - radius, cy - radius, radius * 2, radius * 2, scaleColour(shadow, 0.4), 0.9);
        raster.rect(cx - radius, cy - radius, radius * 2, radius * 2, accent, 0.12);
        break;
      }
      case 'dead-led': {
        const bounds = run.bounds;
        if (!bounds) break;
        const bx = context.px(bounds.x);
        const by = context.py(bounds.y + bounds.height);
        const bw = context.lx(bounds.width);
        const bh = context.ly(bounds.height);
        raster.rect(bx, by, bw, bh, scaleColour(shadow, 0.5), 0.6 + run.strength * 0.3);
        break;
      }
      case 'screen-ghost':
      default: {
        const bounds = run.bounds;
        if (!bounds) break;
        const bx = context.px(bounds.x);
        const by = context.py(bounds.y + bounds.height);
        const bw = context.lx(bounds.width);
        const bh = context.ly(bounds.height);
        for (let index = 0; index < 4; index += 1) {
          raster.rect(
            bx + index * (bw * 0.08),
            by,
            bw * 0.7,
            bh,
            context.layer === 'glow' ? context.glow : mixColour(face, shadow, 0.5),
            context.layer === 'glow' ? 0.05 + run.strength * 0.06 : 0.08,
          );
        }
        break;
      }
    }
  }
}

export interface BoardPaintOptions {
  readonly layout: BoardLayout;
  readonly surface: BoardSurfaceSpec;
  readonly form: BoardForm;
  readonly layer: BoardFaceLayer;
  readonly width: number;
  readonly height: number;
  /** Overrides the layout's own seed for the painters' speckle. */
  readonly seed?: number;
}

/**
 * Paints one of the board's two maps. The `face` layer is the colour map —
 * slate, paint, felt, acrylic or glass with the era's lettering and wear. The
 * `glow` layer is the emissive map: only the parts of the board that actually
 * light up (1985 tiles and promo strip, 2005 backlighting, 2025 screen), with a
 * faint sheen for the unlit decades.
 */
export function paintBoardFace(options: BoardPaintOptions): FaceRaster {
  const { layout, surface, form, layer } = options;
  const width = Math.max(Math.trunc(options.width), 8);
  const height = Math.max(Math.trunc(options.height), 8);
  const raster = new FaceRaster(width, height);
  const scaleX = width / layout.aspect;
  const scaleY = height;
  const context: PaintContext = {
    raster,
    layout,
    surface,
    form,
    layer,
    random: createSeededRandom((options.seed ?? layout.seed) + (layer === 'glow' ? 977 : 0)),
    px: (x) => x * scaleX,
    py: (y) => (1 - y) * scaleY,
    lx: (length) => length * scaleX,
    ly: (length) => length * scaleY,
    ink: parseColour(surface.ink),
    inkAccent: parseColour(surface.inkAccent),
    glow: parseColour(surface.glow),
  };

  if (layer === 'face') {
    paintBase(context);
  } else {
    raster.fill({ r: 0, g: 0, b: 0 });
  }

  const panels = layout.panels;
  const chalkStrokes = runsOfKind(layout.runs, 'chalk-stroke');
  const vinylLetters = runsOfKind(layout.runs, 'vinyl-letter');
  const tiles = runsOfKind(layout.runs, 'fluorescent-tile');
  const smudges = runsOfKind(layout.runs, 'chalk-smudge');
  const rules = runsOfKind(layout.runs, 'menu-rule');
  const wear = runsOfKind(layout.runs, 'wear');
  const promos = runsOfKind(layout.runs, 'promo-strip');

  if (panels.length > 0) paintPanels(context, panels);
  if (tiles.length > 0) paintTiles(context, tiles);
  for (const strip of promos) paintPromoStrip(context, strip);

  if (chalkStrokes.length > 0) {
    for (const run of chalkStrokes) {
      paintStroke(
        context,
        run.points,
        context.ly(run.weight),
        layerColour(context, false),
        run.opacity * (layer === 'glow' ? 0.12 : 0.92),
      );
    }
  }
  if (vinylLetters.length > 0) {
    for (const run of vinylLetters) {
      const strokes = glyphStrokesAt(run.char, run.center, run.size, run.rotation);
      if (layer === 'face') {
        // Paint bleed and a cast shadow, then the crisp face of the letter.
        for (const stroke of strokes) {
          paintStroke(
            context,
            stroke.map((point) => ({ x: point.x + run.shadow * 0.6, y: point.y - run.shadow * 0.6 })),
            context.ly(run.size * 0.24 + run.bleed),
            scaleColour(context.ink, 0.4),
            0.28 * run.opacity,
          );
          paintStroke(
            context,
            stroke,
            context.ly(run.size * 0.2 + run.bleed),
            mixColour(context.ink, parseColour('#ffffff'), 0.35),
            0.35 * run.opacity,
          );
          paintStroke(context, stroke, context.ly(run.size * 0.17), context.ink, 0.95 * run.opacity);
        }
      } else {
        paintGlyphStrokes(context, strokes, run.size, 0.18, context.glow, 0.12 * run.opacity);
      }
    }
  }
  if (smudges.length > 0) {
    for (const run of smudges) {
      context.raster.ellipse(
        context.px(run.center.x),
        context.py(run.center.y),
        context.lx(run.radiusX),
        context.ly(run.radiusY),
        run.angle,
        mixColour(context.ink, parseColour(surface.face), 0.35),
        layer === 'glow' ? run.strength * 0.06 : run.strength * 0.32,
        0.05,
      );
      context.raster.ellipse(
        context.px(run.center.x + run.drag),
        context.py(run.center.y),
        context.lx(run.radiusX * 0.7),
        context.ly(run.radiusY * 0.7),
        run.angle,
        context.ink,
        layer === 'glow' ? run.strength * 0.04 : run.strength * 0.2,
        0.05,
      );
    }
  }
  if (rules.length > 0 && layer === 'face') {
    for (const run of rules) {
      const colour = layerColour(context, true);
      const from = { x: context.px(run.from.x), y: context.py(run.from.y) };
      const to = { x: context.px(run.to.x), y: context.py(run.to.y) };
      if (run.dotted) {
        const steps = Math.max(Math.round(Math.abs(to.x - from.x) / Math.max(context.lx(run.weight) * 5, 2)), 1);
        for (let step = 0; step < steps; step += 1) {
          const t0 = step / steps;
          const t1 = t0 + 0.55 / steps;
          context.raster.line(
            { x: from.x + (to.x - from.x) * t0, y: from.y },
            { x: from.x + (to.x - from.x) * t1, y: to.y },
            Math.max(context.ly(run.weight), 0.8),
            colour,
            run.opacity,
          );
        }
      } else {
        context.raster.line(from, to, Math.max(context.ly(run.weight), 0.8), colour, run.opacity);
      }
    }
  }
  if (wear.length > 0 && layer === 'face') paintWear(context, wear);

  return raster;
}

/* -------------------------------------------------------------------------- */
/* Procedural textures                                                       */
/* -------------------------------------------------------------------------- */

/** Height of a menu board texture in pixels; the width follows the aspect. */
export const MENU_BOARD_TEXTURE_HEIGHT = 512;

/** Every texture this module creates is named with this prefix. */
export const MENU_BOARD_TEXTURE_PREFIX = 'menu:';

/** Canvas factory used to reach the browser's 2D backend. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

/** Default factory: a DOM canvas when the document exists, otherwise `null`. */
export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** One painted board map plus how it was materialised. */
export interface BoardTexture {
  readonly key: string;
  readonly layer: BoardFaceLayer;
  readonly width: number;
  readonly height: number;
  readonly source: 'canvas' | 'data';
  readonly texture: THREE.Texture;
  readonly canvas: HTMLCanvasElement | null;
}

export interface BoardTextureOptions {
  readonly layout: BoardLayout;
  readonly surface: BoardSurfaceSpec;
  readonly form: BoardForm;
  readonly layer: BoardFaceLayer;
  /** Texture key, used for `texture.name` (`menu:<key>`). Defaults to the layer. */
  readonly key?: string;
  /** Texture height in pixels; defaults to {@link MENU_BOARD_TEXTURE_HEIGHT}. */
  readonly height?: number;
  readonly canvasFactory?: CanvasFactory;
  readonly seed?: number;
}

function flipRows(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const flipped = new Uint8ClampedArray(data.length);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row += 1) {
    const source = row * rowBytes;
    const target = (height - 1 - row) * rowBytes;
    flipped.set(data.subarray(source, source + rowBytes), target);
  }
  return flipped;
}

/**
 * Paints one of the board's maps into a three.js texture. The browser path
 * blits the raster into a 2D canvas and wraps it in a `CanvasTexture`; without a
 * canvas (headless vitest, the kernel's headless harness) the same bytes become
 * a `DataTexture`, so tests assert real pixel content either way.
 */
export function createMenuBoardTexture(options: BoardTextureOptions): BoardTexture {
  const textureHeight = Math.max(Math.round(options.height ?? MENU_BOARD_TEXTURE_HEIGHT), 32);
  const textureWidth = Math.max(Math.round(textureHeight * options.layout.aspect), 32);
  const raster = paintBoardFace({
    layout: options.layout,
    surface: options.surface,
    form: options.form,
    layer: options.layer,
    width: textureWidth,
    height: textureHeight,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });
  const key = options.key ?? options.layer;
  const canvas = (options.canvasFactory ?? defaultCanvasFactory)(textureWidth, textureHeight);
  if (canvas) {
    const context = canvas.getContext('2d');
    if (context) {
      const image = context.createImageData(textureWidth, textureHeight);
      image.data.set(raster.data);
      context.putImageData(image, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.name = `${MENU_BOARD_TEXTURE_PREFIX}${key}`;
      texture.colorSpace = options.layer === 'glow' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      return {
        key,
        layer: options.layer,
        width: textureWidth,
        height: textureHeight,
        source: 'canvas',
        texture,
        canvas,
      };
    }
  }
  const texture = new THREE.DataTexture(
    flipRows(raster.data, textureWidth, textureHeight),
    textureWidth,
    textureHeight,
    THREE.RGBAFormat,
  );
  texture.name = `${MENU_BOARD_TEXTURE_PREFIX}${key}`;
  texture.colorSpace = options.layer === 'glow' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return {
    key,
    layer: options.layer,
    width: textureWidth,
    height: textureHeight,
    source: 'data',
    texture,
    canvas: null,
  };
}

/** Releases one board texture. Safe to call more than once. */
export function disposeBoardTexture(texture: THREE.Texture): void {
  texture.dispose();
}
