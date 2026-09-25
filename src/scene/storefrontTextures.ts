/**
 * Canvas texture recipes for the era storefront system.
 *
 * Every shop sign, awning, price board, window poster and decal in
 * `src/scene/storefronts.ts` is painted at runtime: this module owns the
 * *recipe* (canvas size, typography, colours, decoration list) and the
 * rasterizers that turn a recipe into pixels, so the app never ships an image
 * asset.
 *
 * Two deliberate separations keep the system verifiable without a GPU or a
 * browser:
 *
 * 1. **Recipes are pure data.** `planSignageRecipe` and friends derive every
 *    canvas size, font string, tracking value and decoration from the era
 *    descriptor, so tests can inspect era typography, awnings, price boards
 *    and decals headlessly (see `tests/storefronts.test.ts`).
 * 2. **Rasterizing needs a real 2D context.** `StorefrontTextureLibrary`
 *    resolves a surface through an injectable {@link CanvasSurfaceFactory},
 *    paints when a context exists, and otherwise still registers the texture
 *    (blank canvas, or a tinted data texture when there is no DOM at all) so
 *    material wiring, reference counting and disposal behave identically in
 *    every environment.
 *
 * The painters only touch {@link PAINT_SURFACE_METHODS}, which is what lets the
 * tests drive the full painting path with a recording stub instead of a real
 * canvas implementation.
 */

import * as THREE from "three";

import type { EraConfig, EraId, PriceTier, SignStyle } from "../era/eraTypes";

/* -------------------------------------------------------------------------- */
/* Colour helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Clamps `value` into `[0, 1]`, mapping non-finite input to `0`. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** Formats a 24-bit `0xRRGGBB` integer as a CSS colour string. */
export function cssColor(color: number, alpha = 1): string {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  return alpha >= 1
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${clamp01(alpha)})`;
}

/** Linear interpolation between two 24-bit colours, used by the era morph. */
export function mixHex(from: number, to: number, blend: number): number {
  const t = clamp01(blend);
  const channel = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** Lightens (`amount > 0`) or darkens (`amount < 0`) a 24-bit colour. */
export function shadeHex(color: number, amount: number): number {
  return amount >= 0 ? mixHex(color, 0xffffff, amount) : mixHex(color, 0x000000, -amount);
}

/** Picks a readable ink for `background`, favouring the light engraving tone. */
export function contrastingInk(background: number, dark = 0x14161a, light = 0xf6f2e8): number {
  const luminance = (
    0.2126 * ((background >> 16) & 0xff)
    + 0.7152 * ((background >> 8) & 0xff)
    + 0.0722 * (background & 0xff)
  ) / 255;
  return luminance > 0.58 ? dark : light;
}

/* -------------------------------------------------------------------------- */
/* Era typography                                                             */
/* -------------------------------------------------------------------------- */

/** How a period renders and lights its shop lettering. */
export type PaintFinish = "painted" | "backlit" | "neon" | "moulded" | "printed" | "e-ink";

/**
 * Period typography and lettering treatment.
 *
 * `family` is always a system font stack: canvas text is rasterized from fonts
 * the browser already has, which keeps the whole system asset-free. `tracking`
 * is letter spacing as a fraction of the font size and is applied per glyph by
 * {@link paintTrackedText}, because `letterSpacing` is not portable canvas API.
 */
export interface EraTypography {
  readonly id: string;
  readonly family: string;
  readonly weight: number;
  readonly uppercase: boolean;
  readonly tracking: number;
  readonly slant: "upright" | "italic";
  readonly finish: PaintFinish;
  /** Outline width as a fraction of the font size (0 = flat fill). */
  readonly outlineRatio: number;
  /** Share of the era's sign glow applied to the lettering itself. */
  readonly glowRatio: number;
  /** Tagline size as a fraction of the brand size. */
  readonly taglineRatio: number;
  readonly note: string;
}

/**
 * Typography per timeline stop.
 *
 * 1945 hand-paints wide-tracked serif capitals on brick; 1965 backlights
 * slanted googie sans capitals; 1985 pushes heavy condensed neon; 2005 switches
 * to flush chain-standardised moulded panels; 2025 uses quiet low-contrast
 * geometric text on e-ink panels.
 */
export const ERA_TYPOGRAPHY: Readonly<Record<EraId, EraTypography>> = {
  "1945": {
    id: "postwar-hand-painted-serif",
    family: "Georgia, 'Times New Roman', 'Nimbus Roman', serif",
    weight: 700,
    uppercase: true,
    tracking: 0.16,
    slant: "upright",
    finish: "painted",
    outlineRatio: 0.07,
    glowRatio: 0,
    taglineRatio: 0.34,
    note: "Hand-painted serif capitals with wide brush tracking and a dark outline.",
  },
  "1965": {
    id: "googie-italic-sans",
    family: "'Trebuchet MS', 'Gill Sans MT', Verdana, sans-serif",
    weight: 600,
    uppercase: true,
    tracking: 0.1,
    slant: "italic",
    finish: "backlit",
    outlineRatio: 0.05,
    glowRatio: 0.3,
    taglineRatio: 0.36,
    note: "Slanted optimistic sans capitals on a backlit plastic panel.",
  },
  "1985": {
    id: "neon-display-sans",
    family: "'Impact', 'Arial Black', 'Franklin Gothic Heavy', sans-serif",
    weight: 800,
    uppercase: true,
    tracking: 0.05,
    slant: "upright",
    finish: "neon",
    outlineRatio: 0.12,
    glowRatio: 0.85,
    taglineRatio: 0.3,
    note: "Heavy condensed display capitals inside a glowing neon tube outline.",
  },
  "2005": {
    id: "chain-standard-sans",
    family: "Helvetica, Arial, 'Liberation Sans', sans-serif",
    weight: 600,
    uppercase: false,
    tracking: 0.015,
    slant: "upright",
    finish: "moulded",
    outlineRatio: 0.04,
    glowRatio: 0.4,
    taglineRatio: 0.4,
    note: "Neutral corporate sans with flush moulded channel letters.",
  },
  "2025": {
    id: "editorial-geometric-sans",
    family: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
    weight: 400,
    uppercase: false,
    tracking: 0,
    slant: "upright",
    finish: "e-ink",
    outlineRatio: 0,
    glowRatio: 0.18,
    taglineRatio: 0.44,
    note: "Light geometric sentence case with no tracking, printed on an e-ink panel.",
  },
};

/** Typography descriptor for `era`. */
export function typographyFor(era: EraId): EraTypography {
  return ERA_TYPOGRAPHY[era];
}

/** Resolves a canvas `font` string, e.g. `italic 600 42px Helvetica, Arial`. */
export function canvasFont(typography: EraTypography, sizePx: number): string {
  const slant = typography.slant === "italic" ? "italic " : "";
  return `${slant}${typography.weight} ${Math.max(1, Math.round(sizePx))}px ${typography.family}`;
}

/** Letter spacing in pixels for a given font size. */
export function trackingPx(typography: EraTypography, sizePx: number): number {
  return Math.round(typography.tracking * sizePx * 100) / 100;
}

/** Applies the era's capitalisation rule to free text. */
export function displayText(typography: EraTypography, text: string): string {
  return typography.uppercase ? text.toUpperCase() : text;
}

/**
 * Picks the largest font size at which `text` still fits `canvasWidth`.
 *
 * The estimate uses a conservative per-glyph advance so the painter never has
 * to re-flow or clip; tests assert that every planned sign fits its canvas.
 */
export function fitFontSize(
  canvasWidth: number,
  text: string,
  typography: EraTypography,
  nominalSizePx: number,
  fill = 0.9,
): number {
  const glyphs = Math.max(1, Array.from(text).length);
  const units = glyphs * 0.58 + Math.max(0, glyphs - 1) * typography.tracking;
  const fitted = (canvasWidth * fill) / units;
  return Math.max(8, Math.round(Math.min(nominalSizePx, fitted)));
}

/**
 * Splits a long brand into balanced lines so signage stays legible.
 *
 * Never drops a word: if the greedy wrap produces more lines than `maxLines`,
 * the overflow is folded back into the last line and the painter's fit
 * calculation shrinks the type instead.
 */
export function splitSignLines(text: string, perLine: number, maxLines: number): readonly string[] {
  const glyphs = Array.from(text);
  if (glyphs.length <= perLine || maxLines <= 1) {
    return [text];
  }
  const words = text.split(" ").filter((word) => word.length > 0);
  if (words.length < 2) {
    return [text];
  }
  const target = Math.max(perLine, Math.ceil(glyphs.length / maxLines));
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (current.length === 0 || candidate.length <= target) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  while (lines.length > maxLines) {
    const overflow = lines.pop()!;
    lines[lines.length - 1] = `${lines[lines.length - 1]!} ${overflow}`;
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/* Sign structures                                                            */
/* -------------------------------------------------------------------------- */

/** Physical build of a shop sign, derived from the era's sign technique. */
export type SignStructure =
  | "painted-panel"
  | "backlit-box"
  | "channel-letters"
  | "neon-tube-outline"
  | "blade-marquee"
  | "banner-flag"
  | "vinyl-band"
  | "e-ink-panel"
  | "projected-scrim";

/** Mapping from the era contract's signage technique to a buildable structure. */
export const SIGN_STRUCTURES_BY_STYLE: Readonly<Record<SignStyle, SignStructure>> = {
  "painted-wall-lettering": "painted-panel",
  "hanging-shingle": "painted-panel",
  "neon-script": "neon-tube-outline",
  "marquee-blade": "blade-marquee",
  "backlit-panel": "backlit-box",
  "googie-arrow": "blade-marquee",
  "channel-letter": "channel-letters",
  "pole-sign": "blade-marquee",
  "vacuum-formed-backlit": "backlit-box",
  "neon-tube-outline": "neon-tube-outline",
  "chrome-channel-letter": "channel-letters",
  "roof-mounted-pylon": "blade-marquee",
  "internally-illuminated-box": "backlit-box",
  "banner-flag": "banner-flag",
  "window-vinyl": "vinyl-band",
  "e-ink-panel": "e-ink-panel",
  "hand-painted-mural-wordmark": "painted-panel",
  "projected-light-scrim": "projected-scrim",
  "led-strip-edge": "e-ink-panel",
};

/** Sign structure for an era sign technique. */
export function signStructureFor(style: SignStyle): SignStructure {
  return SIGN_STRUCTURES_BY_STYLE[style];
}

/** Base emissive strength of a sign structure, before era wear is applied. */
export const SIGN_STRUCTURE_GLOW: Readonly<Record<SignStructure, number>> = {
  "painted-panel": 0.08,
  "backlit-box": 0.9,
  "channel-letters": 0.55,
  "neon-tube-outline": 1,
  "blade-marquee": 0.72,
  "banner-flag": 0.12,
  "vinyl-band": 0.2,
  "e-ink-panel": 0.34,
  "projected-scrim": 0.6,
};

/* -------------------------------------------------------------------------- */
/* Texture slots                                                              */
/* -------------------------------------------------------------------------- */

/** Every canvas texture a storefront variant can own. */
export type StorefrontTextureSlot =
  | "transom-sign"
  | "hanging-sign"
  | "projecting-sign"
  | "awning"
  | "price-board"
  | "window-glass"
  | "window-poster"
  | "glass-vinyl"
  | "door-decal"
  | "kick-band"
  | "wear";

/** Canvas dimensions in pixels for each slot; fixed so textures stay shareable. */
export const TEXTURE_SLOT_SIZES: Readonly<Record<StorefrontTextureSlot, TextureCanvasSize>> = {
  "transom-sign": { width: 512, height: 128 },
  "hanging-sign": { width: 256, height: 256 },
  "projecting-sign": { width: 256, height: 384 },
  awning: { width: 128, height: 128 },
  "price-board": { width: 192, height: 256 },
  "window-glass": { width: 512, height: 256 },
  "window-poster": { width: 256, height: 192 },
  "glass-vinyl": { width: 256, height: 128 },
  "door-decal": { width: 192, height: 96 },
  "kick-band": { width: 256, height: 64 },
  wear: { width: 256, height: 128 },
};

/** Canvas dimensions in pixels. */
export interface TextureCanvasSize {
  readonly width: number;
  readonly height: number;
}

/* -------------------------------------------------------------------------- */
/* Signage recipes                                                            */
/* -------------------------------------------------------------------------- */

/** Decorative element drawn on a sign, in canvas pixels. */
export interface SignDecoration {
  readonly kind:
    | "bulb-row"
    | "neon-tube"
    | "arrow"
    | "speed-lines"
    | "greek-key"
    | "led-strip"
    | "sunburst"
    | "leaf"
    | "cup";
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Border treatment drawn around a sign panel. */
export interface SignFrame {
  readonly inset: number;
  readonly width: number;
  readonly style: "rule" | "bulbs" | "neon-tube" | "flush";
}

/** Complete painting recipe for one shop sign. */
export interface SignageRecipe {
  readonly id: string;
  readonly era: EraId;
  readonly slot: "transom-sign" | "hanging-sign" | "projecting-sign";
  readonly brand: string;
  readonly tagline: string;
  readonly lines: readonly string[];
  readonly signStyle: SignStyle;
  readonly structure: SignStructure;
  readonly typographyId: string;
  readonly font: string;
  readonly taglineFont: string;
  readonly fontSizePx: number;
  readonly taglineFontSizePx: number;
  readonly tracking: number;
  readonly ink: string;
  readonly panel: string;
  readonly accent: string;
  readonly outlineInk: string;
  readonly outlineWidth: number;
  readonly panelAlpha: number;
  readonly glow: number;
  readonly canvas: TextureCanvasSize;
  readonly frame: SignFrame;
  readonly decorations: readonly SignDecoration[];
}

export interface SignageRecipeInput {
  readonly id: string;
  readonly era: EraConfig;
  readonly slot: "transom-sign" | "hanging-sign" | "projecting-sign";
  readonly brand: string;
  readonly tagline: string;
  readonly signStyle: SignStyle;
}

/** Derives a signage recipe from the era descriptor and the shop identity. */
export function planSignageRecipe(input: SignageRecipeInput): SignageRecipe {
  const { era, slot } = input;
  const typography = typographyFor(era.id);
  const canvas = TEXTURE_SLOT_SIZES[slot];
  const structure = signStructureFor(input.signStyle);
  const panelBase = structure === "painted-panel" || structure === "vinyl-band"
    ? shadeHex(era.palette.facadeSecondary, 0.06)
    : shadeHex(era.palette.facadePrimary, -0.24);
  const ink = contrastingInk(panelBase, 0x14161a, shadeHex(era.palette.accent, 0.15));
  const displayBrand = displayText(typography, input.brand);
  const lines = splitSignLines(displayBrand, slot === "transom-sign" ? 15 : 8, slot === "transom-sign" ? 2 : 3);
  const longest = lines.reduce((best, line) => (line.length > best.length ? line : best), "");
  const nominal = Math.round(canvas.height * (slot === "transom-sign" ? 0.5 : 0.26) * (lines.length > 1 ? 0.8 : 1));
  const fontSizePx = fitFontSize(canvas.width, longest, typography, nominal, slot === "transom-sign" ? 0.9 : 0.82);
  const taglineFontSizePx = Math.max(8, Math.round(fontSizePx * typography.taglineRatio));
  const glow = SIGN_STRUCTURE_GLOW[structure];
  const outlineWidth = Math.round(typography.outlineRatio * fontSizePx);

  return {
    id: input.id,
    era: era.id,
    slot,
    brand: input.brand,
    tagline: displayText(typography, input.tagline),
    lines,
    signStyle: input.signStyle,
    structure,
    typographyId: typography.id,
    font: canvasFont(typography, fontSizePx),
    taglineFont: canvasFont(typography, taglineFontSizePx),
    fontSizePx,
    taglineFontSizePx,
    tracking: trackingPx(typography, fontSizePx),
    ink: cssColor(ink),
    panel: cssColor(panelBase, structure === "projected-scrim" ? 0.18 : 1),
    accent: cssColor(era.palette.accent),
    outlineInk: cssColor(shadeHex(ink, -0.55)),
    outlineWidth,
    panelAlpha: structure === "projected-scrim" ? 0.18 : 1,
    glow,
    canvas,
    frame: signFrameFor(structure, canvas),
    decorations: signDecorations(structure, era, canvas),
  };
}

function signFrameFor(structure: SignStructure, canvas: TextureCanvasSize): SignFrame {
  switch (structure) {
    case "painted-panel":
      return { inset: 6, width: 3, style: "rule" };
    case "backlit-box":
      return { inset: 5, width: 5, style: "flush" };
    case "channel-letters":
      return { inset: 8, width: 5, style: "rule" };
    case "neon-tube-outline":
      return { inset: 10, width: 6, style: "neon-tube" };
    case "blade-marquee":
      return { inset: Math.round(canvas.height * 0.1), width: 6, style: "bulbs" };
    case "banner-flag":
      return { inset: 3, width: 2, style: "rule" };
    case "vinyl-band":
      return { inset: 2, width: 2, style: "flush" };
    case "e-ink-panel":
      return { inset: 7, width: 3, style: "flush" };
    case "projected-scrim":
      return { inset: 0, width: 0, style: "flush" };
  }
}

function signDecorations(structure: SignStructure, era: EraConfig, canvas: TextureCanvasSize): readonly SignDecoration[] {
  const accent = cssColor(era.palette.accent);
  const ui = cssColor(era.palette.uiAccent);
  const width = canvas.width;
  const height = canvas.height;
  switch (structure) {
    case "painted-panel":
      return era.id === "2025"
        ? [
            { kind: "leaf", color: accent, x: width * 0.06, y: height * 0.5, width: height * 0.3, height: height * 0.34 },
            { kind: "led-strip", color: ui, x: width * 0.08, y: height * 0.82, width: width * 0.84, height: Math.max(2, height * 0.035) },
          ]
        : [
            { kind: "greek-key", color: accent, x: 0, y: height * 0.84, width, height: Math.max(3, height * 0.08) },
            { kind: "greek-key", color: accent, x: 0, y: height * 0.06, width, height: Math.max(3, height * 0.06) },
          ];
    case "backlit-box":
      return [
        { kind: "bulb-row", color: cssColor(era.palette.sunlight, 0.9), x: width * 0.05, y: height * 0.9, width: width * 0.9, height: height * 0.12 },
        { kind: "sunburst", color: ui, x: width * 0.02, y: height * 0.46, width: height * 0.4, height: height * 0.42 },
      ];
    case "channel-letters":
      return [
        { kind: "led-strip", color: ui, x: width * 0.08, y: height * 0.86, width: width * 0.84, height: Math.max(2, height * 0.04) },
        { kind: "cup", color: accent, x: width * 0.9, y: height * 0.5, width: height * 0.26, height: height * 0.3 },
      ];
    case "neon-tube-outline":
      return [
        { kind: "neon-tube", color: accent, x: width * 0.03, y: height * 0.08, width: width * 0.94, height: height * 0.84 },
        { kind: "speed-lines", color: ui, x: width * 0.04, y: height * 0.18, width: width * 0.22, height: height * 0.14 },
      ];
    case "blade-marquee":
      return [
        { kind: "arrow", color: accent, x: width * 0.86, y: height * 0.5, width: width * 0.12, height: height * 0.3 },
        { kind: "bulb-row", color: cssColor(era.palette.sunlight, 0.95), x: width * 0.04, y: height * 0.12, width: width * 0.92, height: height * 0.1 },
      ];
    case "banner-flag":
      return [{ kind: "speed-lines", color: accent, x: width * 0.04, y: height * 0.8, width: width * 0.3, height: height * 0.12 }];
    case "vinyl-band":
      return [{ kind: "led-strip", color: ui, x: width * 0.04, y: height * 0.78, width: width * 0.92, height: Math.max(2, height * 0.05) }];
    case "e-ink-panel":
      return era.id === "2025"
        ? [{ kind: "leaf", color: cssColor(era.palette.uiAccent), x: width * 0.06, y: height * 0.5, width: height * 0.26, height: height * 0.3 }]
        : [{ kind: "led-strip", color: ui, x: width * 0.03, y: height * 0.88, width: width * 0.94, height: Math.max(2, height * 0.05) }];
    case "projected-scrim":
      return [
        { kind: "sunburst", color: accent, x: width * 0.06, y: height * 0.5, width: height * 0.6, height: height * 0.6 },
        { kind: "speed-lines", color: ui, x: width * 0.6, y: height * 0.2, width: width * 0.34, height: height * 0.2 },
      ];
  }
}

/* -------------------------------------------------------------------------- */
/* Awning recipes                                                             */
/* -------------------------------------------------------------------------- */

/** Physical awning build for an era. */
export type AwningKind = "fabric-striped" | "rigid-canopy" | "marquee-blade";

/** Fabric/canopy surface pattern. */
export type AwningPattern = "vertical-stripes" | "wide-bands" | "solid-canopy" | "gradient-bands" | "solar-scrim";

/** Valance (front flap) treatment; only `scalloped` carries scallops. */
export type ValanceKind = "scalloped" | "straight" | "tube-lit" | "flush-led";

export interface AwningRecipe {
  readonly id: string;
  readonly era: EraId;
  readonly kind: AwningKind;
  readonly pattern: AwningPattern;
  readonly valanceKind: ValanceKind;
  readonly canvas: TextureCanvasSize;
  readonly base: string;
  readonly stripe: string;
  readonly baseHex: number;
  readonly stripeHex: number;
  readonly trim: string;
  readonly trimSecondary: string;
  readonly stripeCount: number;
  readonly text: string;
  readonly font: string;
  readonly typographyId: string;
  readonly wear: number;
  readonly lightColor: string;
}

export interface AwningRecipeInput {
  readonly id: string;
  readonly era: EraConfig;
  readonly pattern: AwningPattern;
  readonly text: string;
  readonly wear: number;
}

/** Awning structure the era supports: fabric awning, 1985 blade, 2005 rigid canopy. */
export function awningKindFor(era: EraConfig): AwningKind {
  if (era.storefronts.awning) {
    return "fabric-striped";
  }
  return era.id === "1985" ? "marquee-blade" : "rigid-canopy";
}

/** Valance treatment implied by the awning structure. */
export function valanceKindFor(kind: AwningKind): ValanceKind {
  return kind === "fabric-striped" ? "scalloped" : kind === "marquee-blade" ? "tube-lit" : "flush-led";
}

/** Derives the striped/scrimmed awning surface recipe from the era descriptor. */
export function planAwningRecipe(input: AwningRecipeInput): AwningRecipe {
  const { era } = input;
  const kind = awningKindFor(era);
  const typography = typographyFor(era.id);
  const colors = era.storefronts.awningColors;
  const baseHex = colors[0] ?? era.palette.facadeSecondary;
  const stripeHex = colors[1] ?? era.palette.accent;
  const trimHex = colors[2] ?? era.palette.uiAccent;
  const canvas = TEXTURE_SLOT_SIZES.awning;
  const text = displayText(typography, input.text);
  const fontSizePx = fitFontSize(canvas.width, text, typography, Math.round(canvas.height * 0.22), 0.86);

  return {
    id: input.id,
    era: era.id,
    kind,
    pattern: input.pattern,
    valanceKind: valanceKindFor(kind),
    canvas,
    base: cssColor(baseHex),
    stripe: cssColor(stripeHex),
    baseHex,
    stripeHex,
    trim: cssColor(trimHex),
    trimSecondary: cssColor(shadeHex(trimHex, -0.3)),
    stripeCount: input.pattern === "wide-bands" ? 4 : 8,
    text,
    font: canvasFont(typography, fontSizePx),
    typographyId: typography.id,
    wear: clamp01(input.wear),
    lightColor: cssColor(era.palette.windowGlow),
  };
}

/* -------------------------------------------------------------------------- */
/* Window display recipes                                                     */
/* -------------------------------------------------------------------------- */

export interface WindowGlassRecipe {
  readonly id: string;
  readonly era: EraId;
  readonly canvas: TextureCanvasSize;
  readonly glass: string;
  readonly sheen: string;
  readonly backdrop: string;
  readonly ink: string;
  readonly accent: string;
  readonly font: string;
  readonly typographyId: string;
  readonly hoursLabel: string;
  readonly priceTier: PriceTier;
  readonly poster: string;
  readonly reflections: number;
  readonly frost: number;
  readonly glow: number;
}

export interface WindowGlassRecipeInput {
  readonly id: string;
  readonly era: EraConfig;
  readonly poster: string;
  readonly glow: number;
}

/** Derives the glazing recipe: hours lettering, reflections, frost and glow. */
export function planWindowGlassRecipe(input: WindowGlassRecipeInput): WindowGlassRecipe {
  const { era } = input;
  const hours = era.storefronts.hours;
  const glassHex = mixHex(era.palette.windowGlow, era.palette.facadePrimary, 0.35);
  const typography = typographyFor(era.id);
  return {
    id: input.id,
    era: era.id,
    canvas: TEXTURE_SLOT_SIZES["window-glass"],
    glass: cssColor(glassHex, 0.42),
    sheen: cssColor(era.palette.skyHorizon, 0.5),
    backdrop: cssColor(shadeHex(era.palette.windowGlow, -0.5)),
    ink: cssColor(contrastingInk(glassHex, 0x101418, era.palette.accent)),
    accent: cssColor(era.palette.accent),
    font: canvasFont(typography, Math.round(TEXTURE_SLOT_SIZES["window-glass"].height * 0.075)),
    typographyId: typography.id,
    hoursLabel: `OPEN ${formatHour(hours.openHour)}-${formatHour(hours.closeHour)}`,
    priceTier: era.storefronts.priceTier,
    poster: displayText(typography, input.poster),
    reflections: era.storefronts.glassArea > 0.6 ? 4 : 2,
    frost: clamp01(1 - era.storefronts.glassArea) * 0.6,
    glow: clamp01(input.glow),
  };
}

/** Formats an opening hour as 12h clock text, e.g. `7am`, `9pm`. */
export function formatHour(hour: number): string {
  const normalized = ((Math.round(hour) % 24) + 24) % 24;
  const suffix = normalized < 12 ? "am" : "pm";
  const display = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${display}${suffix}`;
}

/* -------------------------------------------------------------------------- */
/* Price boards, posters and decals                                           */
/* -------------------------------------------------------------------------- */

export interface PriceBoardLine {
  readonly label: string;
  readonly price: string;
}

export interface PriceBoardRecipe {
  readonly id: string;
  readonly era: EraId;
  readonly canvas: TextureCanvasSize;
  readonly title: string;
  readonly lines: readonly PriceBoardLine[];
  readonly panel: string;
  readonly ink: string;
  readonly accent: string;
  readonly font: string;
  readonly titleFont: string;
  readonly typographyId: string;
  readonly priceTier: PriceTier;
  readonly chalk: boolean;
}

export interface PriceBoardRecipeInput {
  readonly id: string;
  readonly era: EraConfig;
  readonly title: string;
  readonly lines: readonly PriceBoardLine[];
}

/** Period price board: chalk slate in 1945, lightbox in 1985, e-ink in 2025. */
export function planPriceBoardRecipe(input: PriceBoardRecipeInput): PriceBoardRecipe {
  const { era } = input;
  const typography = typographyFor(era.id);
  const chalk = era.id === "1945" || era.id === "1965";
  const panelHex = chalk ? 0x24282a : shadeHex(era.palette.facadePrimary, -0.1);
  const canvas = TEXTURE_SLOT_SIZES["price-board"];
  const fontSizePx = fitFontSize(canvas.width, `00 ${input.lines[0]?.label ?? "item"}`, typography, Math.round(canvas.height * 0.1), 0.82);
  return {
    id: input.id,
    era: era.id,
    canvas,
    title: displayText(typography, input.title),
    lines: input.lines,
    panel: cssColor(panelHex, 0.94),
    ink: chalk ? cssColor(0xe9e6da) : cssColor(contrastingInk(panelHex)),
    accent: cssColor(era.palette.accent),
    font: canvasFont(typography, fontSizePx),
    titleFont: canvasFont(typography, Math.round(fontSizePx * 1.25)),
    typographyId: typography.id,
    priceTier: era.storefronts.priceTier,
    chalk,
  };
}

export interface PosterRecipe {
  readonly id: string;
  readonly era: EraId;
  readonly canvas: TextureCanvasSize;
  readonly headline: string;
  readonly subline: string;
  readonly panel: string;
  readonly ink: string;
  readonly accent: string;
  readonly font: string;
  readonly headlineFont: string;
  readonly typographyId: string;
  readonly border: boolean;
}

export interface PosterRecipeInput {
  readonly id: string;
  readonly era: EraConfig;
  readonly headline: string;
  readonly subline: string;
}

/** In-window printed poster: the era's cheapest way to shout at the sidewalk. */
export function planPosterRecipe(input: PosterRecipeInput): PosterRecipe {
  const { era } = input;
  const typography = typographyFor(era.id);
  const canvas = TEXTURE_SLOT_SIZES["window-poster"];
  const headline = displayText(typography, input.headline);
  const subline = displayText(typography, input.subline);
  const panelHex = era.id === "1985" ? shadeHex(era.palette.accent, 0.35) : shadeHex(era.palette.facadeSecondary, 0.28);
  const headlineSize = fitFontSize(canvas.width, headline, typography, Math.round(canvas.height * 0.24), 0.84);
  const sublineSize = Math.max(8, Math.round(headlineSize * 0.55));
  return {
    id: input.id,
    era: era.id,
    canvas,
    headline,
    subline,
    panel: cssColor(panelHex, 0.96),
    ink: cssColor(contrastingInk(panelHex)),
    accent: cssColor(era.palette.accent),
    font: canvasFont(typography, sublineSize),
    headlineFont: canvasFont(typography, headlineSize),
    typographyId: typography.id,
    border: !typography.uppercase,
  };
}

export type DecalKind =
  | "open-sign"
  | "hours-decal"
  | "payment-logos"
  | "vinyl-band"
  | "soap-sign"
  | "coffee-ring"
  | "leaf-badge"
  | "sale-burst"
  | "token-sticker"
  | "price-flash"
  | "est-band"
  | "vinyl-graphic";

export type DecalPlacement = "glass" | "door" | "kick-plate";

export interface DecalRecipe {
  readonly id: string;
  readonly era: EraId;
  readonly kind: DecalKind;
  readonly placement: DecalPlacement;
  readonly canvas: TextureCanvasSize;
  readonly text: string;
  readonly subtext: string;
  readonly ink: string;
  readonly panel: string;
  readonly accent: string;
  readonly font: string;
  readonly typographyId: string;
  readonly opacity: number;
  readonly wear: number;
  readonly badge: "rect" | "circle" | "burst" | "band";
}

export interface DecalRecipeInput {
  readonly id: string;
  readonly era: EraConfig;
  readonly kind: DecalKind;
  readonly placement: DecalPlacement;
  readonly text: string;
  readonly subtext?: string;
  readonly wear: number;
}

/** Storefront decal: glass vinyl, door hours plate, kicked band or price flash. */
export function planDecalRecipe(input: DecalRecipeInput): DecalRecipe {
  const { era, kind } = input;
  const typography = typographyFor(era.id);
  const canvas = kind === "est-band"
    ? TEXTURE_SLOT_SIZES["kick-band"]
    : input.placement === "door"
      ? TEXTURE_SLOT_SIZES["door-decal"]
      : TEXTURE_SLOT_SIZES["glass-vinyl"];
  const text = displayText(typography, input.text);
  const subtext = displayText(typography, input.subtext ?? "");
  const badge: DecalRecipe["badge"] = kind === "coffee-ring" || kind === "leaf-badge" || kind === "token-sticker"
    ? "circle"
    : kind === "sale-burst"
      ? "burst"
      : kind === "vinyl-band" || kind === "est-band" || kind === "payment-logos"
        ? "band"
        : "rect";
  const panelHex = badge === "circle" || badge === "burst"
    ? era.palette.accent
    : shadeHex(era.palette.facadeSecondary, 0.3);
  const fontSizePx = fitFontSize(canvas.width, text, typography, Math.round(canvas.height * 0.34), badge === "circle" ? 0.6 : 0.88);
  return {
    id: input.id,
    era: era.id,
    kind,
    placement: input.placement,
    canvas,
    text,
    subtext,
    ink: cssColor(contrastingInk(panelHex)),
    panel: cssColor(panelHex, 0.94),
    accent: cssColor(era.palette.uiAccent),
    font: canvasFont(typography, fontSizePx),
    typographyId: typography.id,
    opacity: kind === "vinyl-band" || kind === "est-band" ? 0.85 : clamp01(0.95 - input.wear * 0.25),
    wear: clamp01(input.wear),
    badge,
  };
}

/* -------------------------------------------------------------------------- */
/* Wear / material accents                                                    */
/* -------------------------------------------------------------------------- */

export type WearLabel = "soot-stained" | "weathered" | "sun-faded" | "well-kept" | "pristine";

export interface WearRecipe {
  readonly id: string;
  readonly era: EraId;
  readonly canvas: TextureCanvasSize;
  readonly level: number;
  readonly label: WearLabel;
  readonly streaks: number;
  readonly chips: number;
  readonly streakColor: string;
  readonly patinaColor: string;
  readonly soot: string;
  readonly gloss: number;
  readonly accentTrim: number;
}

export interface WearRecipeInput {
  readonly id: string;
  readonly era: EraConfig;
  readonly level: number;
}

/** Worn vs new material accent recipe: soot streaks, chipped paint, clean gloss. */
export function planWearRecipe(input: WearRecipeInput): WearRecipe {
  const { era } = input;
  const level = clamp01(input.level);
  const label: WearLabel = level >= 0.65
    ? "soot-stained"
    : level >= 0.45
      ? "weathered"
      : level >= 0.28
        ? "sun-faded"
        : level >= 0.16
          ? "well-kept"
          : "pristine";
  return {
    id: input.id,
    era: era.id,
    canvas: TEXTURE_SLOT_SIZES.wear,
    level,
    label,
    streaks: Math.round(level * 14),
    chips: Math.round(Math.max(0, level - 0.25) * 18),
    streakColor: cssColor(shadeHex(era.palette.facadeSecondary, -0.6), 0.32),
    patinaColor: cssColor(era.palette.accent, 0.18),
    soot: cssColor(shadeHex(era.palette.ground, -0.3), 0.4),
    gloss: clamp01(1 - level),
    accentTrim: clamp01(1 - level) * 0.9,
  };
}

/* -------------------------------------------------------------------------- */
/* Paint surface plumbing                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Exactly the canvas API the storefront painters touch.
 *
 * Tests assert their recording stub implements this list, which is what keeps
 * the paint path verified without a real canvas implementation.
 */
export const PAINT_SURFACE_METHODS = [
  "save",
  "restore",
  "beginPath",
  "closePath",
  "moveTo",
  "lineTo",
  "arc",
  "rect",
  "fill",
  "stroke",
  "fillRect",
  "strokeRect",
  "fillText",
  "strokeText",
  "measureText",
  "setLineDash",
  "createLinearGradient",
  "createRadialGradient",
] as const;

/** A paintable surface plus the image `THREE.CanvasTexture` should consume. */
export interface CanvasSurface {
  /** Element handed to `THREE.CanvasTexture`; `null` when the environment has no DOM. */
  readonly image: HTMLCanvasElement | null;
  readonly width: number;
  readonly height: number;
  getContext(type: "2d"): CanvasRenderingContext2D | null;
}

/** Creates a paintable surface of the requested pixel size. */
export type CanvasSurfaceFactory = (width: number, height: number) => CanvasSurface;

/**
 * Default surface factory: a real canvas element from the DOM.
 *
 * With `document` available the surface always carries an image even when the
 * browser refuses a 2D context, so the material graph is unchanged; without a
 * DOM the library falls back to small data textures.
 */
export const defaultCanvasFactory: CanvasSurfaceFactory = (width, height) => {
  if (typeof document === "undefined") {
    return { image: null, width, height, getContext: () => null };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return {
    image: canvas,
    width,
    height,
    getContext: (type) => canvas.getContext(type),
  };
};

/* -------------------------------------------------------------------------- */
/* Paint report                                                               */
/* -------------------------------------------------------------------------- */

/** Evidence of what a rasterizer actually drew, independent of the context. */
export interface PaintReport {
  readonly recipeId: string;
  readonly shapes: number;
  readonly glyphs: number;
  readonly labels: readonly string[];
  readonly fonts: readonly string[];
}

class PaintLedger {
  shapes = 0;
  glyphs = 0;
  readonly labels: string[] = [];
  readonly fonts: string[] = [];

  constructor(private readonly recipeId: string) {}

  shape(count = 1): void {
    this.shapes += count;
  }

  label(text: string, font: string): void {
    if (text.length > 0) {
      this.labels.push(text);
      this.fonts.push(font);
    }
  }

  snapshot(): PaintReport {
    return {
      recipeId: this.recipeId,
      shapes: this.shapes,
      glyphs: this.glyphs,
      labels: [...this.labels],
      fonts: [...this.fonts],
    };
  }
}

/** Empty report, used when no 2D context exists in the environment. */
export function emptyPaintReport(recipeId: string): PaintReport {
  return { recipeId, shapes: 0, glyphs: 0, labels: [], fonts: [] };
}

interface TrackedTextOptions {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly tracking: number;
  readonly align: "left" | "center" | "right";
  readonly ink: string;
  readonly outlineInk: string;
  readonly outlineWidth: number;
  readonly glowColor: string;
  readonly glowBlur: number;
}

/**
 * Draws text one glyph at a time so period letter tracking is rasterized.
 *
 * Returns the total advance width so callers can stack taglines precisely.
 */
function paintTrackedText(ctx: CanvasRenderingContext2D, ledger: PaintLedger, options: TrackedTextOptions): number {
  const glyphs = Array.from(options.text);
  if (glyphs.length === 0) {
    return 0;
  }
  ctx.save();
  ctx.font = options.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + options.tracking * Math.max(0, glyphs.length - 1);
  let cursor = options.align === "left" ? options.x : options.align === "center" ? options.x - total / 2 : options.x - total;
  ctx.fillStyle = options.ink;
  ctx.strokeStyle = options.outlineInk;
  ctx.lineWidth = options.outlineWidth;
  ctx.lineJoin = "round";
  ctx.shadowColor = options.glowBlur > 0 ? options.glowColor : "transparent";
  ctx.shadowBlur = options.glowBlur;
  for (const [index, glyph] of glyphs.entries()) {
    const width = widths[index] ?? 0;
    const center = cursor + width / 2;
    if (options.outlineWidth > 0) {
      ctx.strokeText(glyph, center, options.y);
      ledger.shape();
    }
    ctx.fillText(glyph, center, options.y);
    ledger.shape();
    cursor += width + options.tracking;
  }
  ctx.restore();
  ledger.glyphs += glyphs.length;
  ledger.label(options.text, options.font);
  return total;
}

/* -------------------------------------------------------------------------- */
/* Rasterizers                                                                */
/* -------------------------------------------------------------------------- */

/** Rasterizes a signage recipe. */
export function paintSignageRecipe(ctx: CanvasRenderingContext2D, recipe: SignageRecipe): PaintReport {
  const ledger = new PaintLedger(recipe.id);
  const { width, height } = recipe.canvas;
  ctx.save();
  ctx.fillStyle = recipe.panel;
  ctx.fillRect(0, 0, width, height);
  ledger.shape();

  const sheen = ctx.createLinearGradient(0, 0, 0, height);
  sheen.addColorStop(0, cssColor(0xffffff, 0.16 + recipe.glow * 0.24));
  sheen.addColorStop(1, cssColor(0x000000, 0.18));
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);
  ledger.shape();

  for (const decoration of recipe.decorations) {
    paintDecoration(ctx, ledger, decoration);
  }
  paintSignFrame(ctx, ledger, recipe.frame, recipe.accent, width, height);

  const glowBlur = Math.round(recipe.glow * recipe.fontSizePx * 0.55);
  const lineHeight = height / (recipe.lines.length + 1);
  for (const [index, line] of recipe.lines.entries()) {
    paintTrackedText(ctx, ledger, {
      text: line,
      x: width / 2,
      y: lineHeight * (index + 0.85),
      font: recipe.font,
      tracking: recipe.tracking,
      align: "center",
      ink: recipe.ink,
      outlineInk: recipe.outlineInk,
      outlineWidth: recipe.outlineWidth,
      glowColor: recipe.accent,
      glowBlur,
    });
  }

  paintTrackedText(ctx, ledger, {
    text: recipe.tagline,
    x: width / 2,
    y: height - recipe.taglineFontSizePx * 0.9,
    font: recipe.taglineFont,
    tracking: recipe.tracking * 0.6,
    align: "center",
    ink: recipe.ink,
    outlineInk: recipe.outlineInk,
    outlineWidth: 0,
    glowColor: recipe.accent,
    glowBlur: Math.round(glowBlur * 0.4),
  });

  ctx.restore();
  return ledger.snapshot();
}

function paintDecoration(ctx: CanvasRenderingContext2D, ledger: PaintLedger, decoration: SignDecoration): void {
  ctx.save();
  ctx.fillStyle = decoration.color;
  ctx.strokeStyle = decoration.color;
  ctx.lineWidth = Math.max(1, Math.round(decoration.height * 0.16));
  switch (decoration.kind) {
    case "bulb-row": {
      const radius = Math.max(1.5, decoration.height * 0.4);
      const count = Math.max(3, Math.round(decoration.width / (radius * 2.8)));
      const step = decoration.width / count;
      for (let index = 0; index < count; index += 1) {
        ctx.beginPath();
        ctx.arc(decoration.x + (index + 0.5) * step, decoration.y, radius * (index % 2 === 0 ? 1 : 0.72), 0, Math.PI * 2);
        ctx.fill();
        ledger.shape();
      }
      break;
    }
    case "neon-tube": {
      ctx.beginPath();
      ctx.rect(decoration.x, decoration.y, decoration.width, decoration.height);
      ctx.stroke();
      ledger.shape();
      ctx.beginPath();
      ctx.rect(decoration.x + 4, decoration.y + 4, Math.max(1, decoration.width - 8), Math.max(1, decoration.height - 8));
      ctx.stroke();
      ledger.shape();
      break;
    }
    case "arrow": {
      const half = decoration.height / 2;
      ctx.beginPath();
      ctx.moveTo(decoration.x, decoration.y - half);
      ctx.lineTo(decoration.x + decoration.width, decoration.y);
      ctx.lineTo(decoration.x, decoration.y + half);
      ctx.closePath();
      ctx.fill();
      ledger.shape();
      break;
    }
    case "speed-lines": {
      const lines = 3;
      for (let index = 0; index < lines; index += 1) {
        const y = decoration.y + (index * decoration.height) / lines;
        ctx.beginPath();
        ctx.moveTo(decoration.x, y);
        ctx.lineTo(decoration.x + decoration.width * (1 - index * 0.18), y);
        ctx.stroke();
        ledger.shape();
      }
      break;
    }
    case "greek-key": {
      ctx.fillRect(decoration.x, decoration.y, decoration.width, decoration.height);
      ctx.setLineDash([decoration.height, decoration.height]);
      ctx.fillStyle = cssColor(0x000000, 0.45);
      ctx.fillRect(decoration.x, decoration.y, decoration.width, decoration.height * 0.4);
      ctx.setLineDash([]);
      ledger.shape(2);
      break;
    }
    case "led-strip": {
      ctx.fillRect(decoration.x, decoration.y, decoration.width, decoration.height);
      ledger.shape();
      break;
    }
    case "sunburst": {
      const rays = 9;
      const cx = decoration.x + decoration.width / 2;
      const cy = decoration.y + decoration.height / 2;
      const radius = decoration.height / 2;
      for (let index = 0; index < rays; index += 1) {
        const angle = (index * Math.PI * 2) / rays;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.stroke();
        ledger.shape();
      }
      break;
    }
    case "leaf": {
      ctx.beginPath();
      ctx.arc(decoration.x + decoration.width / 2, decoration.y, decoration.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cssColor(0x000000, 0.25);
      ctx.fillRect(decoration.x + decoration.width / 2, decoration.y, Math.max(1, decoration.width * 0.06), decoration.height * 0.4);
      ledger.shape(2);
      break;
    }
    case "cup": {
      ctx.beginPath();
      ctx.rect(decoration.x, decoration.y - decoration.height / 2, decoration.width, decoration.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(decoration.x + decoration.width, decoration.y, decoration.width * 0.3, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ledger.shape(2);
      break;
    }
  }
  ctx.restore();
}

function paintSignFrame(
  ctx: CanvasRenderingContext2D,
  ledger: PaintLedger,
  frame: SignFrame,
  accent: string,
  width: number,
  height: number,
): void {
  if (frame.width <= 0) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = frame.width;
  ctx.setLineDash(frame.style === "bulbs" ? [frame.width * 3, frame.width * 2] : []);
  ctx.strokeRect(frame.inset, frame.inset, width - frame.inset * 2, height - frame.inset * 2);
  ledger.shape();
  ctx.setLineDash([]);
  ctx.restore();
}

/** Rasterizes an awning surface: stripes, bands, scrim cells and valance text. */
export function paintAwningRecipe(ctx: CanvasRenderingContext2D, recipe: AwningRecipe): PaintReport {
  const ledger = new PaintLedger(recipe.id);
  const { width, height } = recipe.canvas;
  ctx.save();
  ctx.fillStyle = recipe.base;
  ctx.fillRect(0, 0, width, height);
  ledger.shape();

  switch (recipe.pattern) {
    case "vertical-stripes": {
      const step = width / recipe.stripeCount;
      ctx.fillStyle = recipe.stripe;
      for (let index = 0; index < recipe.stripeCount; index += 2) {
        ctx.fillRect(index * step, 0, step, height);
        ledger.shape();
      }
      break;
    }
    case "wide-bands": {
      const bandHeight = height / recipe.stripeCount;
      for (let index = 0; index < recipe.stripeCount; index += 1) {
        ctx.fillStyle = index % 2 === 0 ? recipe.stripe : recipe.trim;
        ctx.fillRect(0, index * bandHeight, width, bandHeight * 0.5);
        ledger.shape();
      }
      break;
    }
    case "gradient-bands": {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, recipe.base);
      gradient.addColorStop(0.5, recipe.stripe);
      gradient.addColorStop(1, recipe.trim);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ledger.shape();
      break;
    }
    case "solar-scrim": {
      const cells = 6;
      const cellWidth = width / cells;
      const cellHeight = height / Math.round(cells * 0.75);
      for (let row = 0; row < Math.round(cells * 0.75); row += 1) {
        for (let column = 0; column < cells; column += 1) {
          ctx.fillStyle = (row + column) % 3 === 0 ? recipe.trim : recipe.stripe;
          ctx.fillRect(column * cellWidth + 1, row * cellHeight + 1, cellWidth - 2, cellHeight - 2);
          ledger.shape();
        }
      }
      break;
    }
    case "solid-canopy": {
      ctx.fillStyle = recipe.trim;
      ctx.fillRect(0, height * 0.4, width, height * 0.2);
      ledger.shape();
      break;
    }
  }

  // Period edge trim: tube-lit and LED valances get a lit strip, fabric gets a scallop band.
  switch (recipe.valanceKind) {
    case "scalloped": {
      const scallops = 6;
      const radius = width / (scallops * 2);
      ctx.fillStyle = recipe.trim;
      for (let index = 0; index < scallops; index += 1) {
        ctx.beginPath();
        ctx.arc(radius + index * radius * 2, height - radius * 0.6, radius * 0.8, Math.PI, 0);
        ctx.fill();
        ledger.shape();
      }
      break;
    }
    case "tube-lit":
    case "flush-led": {
      ctx.fillStyle = recipe.lightColor;
      ctx.globalAlpha = recipe.valanceKind === "tube-lit" ? 0.9 : 0.65;
      ctx.fillRect(0, height * 0.88, width, Math.max(2, height * 0.06));
      ctx.globalAlpha = 1;
      ledger.shape();
      break;
    }
    case "straight": {
      ctx.fillStyle = recipe.trimSecondary;
      ctx.fillRect(0, height * 0.9, width, Math.max(2, height * 0.08));
      ledger.shape();
      break;
    }
  }

  paintTrackedText(ctx, ledger, {
    text: recipe.text,
    x: width / 2,
    y: height * 0.34,
    font: recipe.font,
    tracking: 1,
    align: "center",
    ink: cssColor(0xffffff, 0.92),
    outlineInk: cssColor(0x000000, 0.5),
    outlineWidth: 2,
    glowColor: recipe.lightColor,
    glowBlur: 0,
  });

  if (recipe.wear > 0.25) {
    ctx.fillStyle = cssColor(0x000000, recipe.wear * 0.22);
    for (let index = 0; index < Math.round(recipe.wear * 8); index += 1) {
      const x = (width / 8) * index;
      ctx.fillRect(x, 0, Math.max(1, width * 0.015), height);
      ledger.shape();
    }
  }
  ctx.restore();
  return ledger.snapshot();
}

/** Rasterizes the glazing: sheen, reflections, frost, hours lettering and poster tag. */
export function paintWindowGlassRecipe(ctx: CanvasRenderingContext2D, recipe: WindowGlassRecipe): PaintReport {
  const ledger = new PaintLedger(recipe.id);
  const { width, height } = recipe.canvas;
  ctx.save();

  ctx.fillStyle = recipe.backdrop;
  ctx.fillRect(0, 0, width, height);
  ledger.shape();

  const glow = ctx.createRadialGradient(width * 0.5, height * 0.62, height * 0.1, width * 0.5, height * 0.62, height * 1.1);
  glow.addColorStop(0, cssColor(0xffffff, 0.18 + recipe.glow * 0.5));
  glow.addColorStop(1, cssColor(0x000000, 0.45));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ledger.shape();

  ctx.fillStyle = recipe.glass;
  ctx.fillRect(0, 0, width, height);
  ledger.shape();

  if (recipe.frost > 0.05) {
    ctx.fillStyle = cssColor(0xffffff, recipe.frost * 0.5);
    ctx.fillRect(0, 0, width, height * 0.22);
    ledger.shape();
  }

  ctx.strokeStyle = recipe.sheen;
  ctx.lineWidth = Math.max(2, height * 0.03);
  for (let index = 0; index < recipe.reflections; index += 1) {
    const x = (width / recipe.reflections) * index + width * 0.04;
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x + width * 0.12, 0);
    ctx.stroke();
    ledger.shape();
  }

  paintTrackedText(ctx, ledger, {
    text: recipe.hoursLabel,
    x: width * 0.5,
    y: height * 0.88,
    font: recipe.font,
    tracking: 1,
    align: "center",
    ink: recipe.ink,
    outlineInk: cssColor(0x000000, 0.4),
    outlineWidth: 1,
    glowColor: recipe.accent,
    glowBlur: recipe.glow * 6,
  });

  if (recipe.poster.length > 0) {
    paintTrackedText(ctx, ledger, {
      text: recipe.poster,
      x: width * 0.5,
      y: height * 0.18,
      font: recipe.font,
      tracking: 1,
      align: "center",
      ink: recipe.accent,
      outlineInk: cssColor(0x000000, 0.4),
      outlineWidth: 1,
      glowColor: recipe.accent,
      glowBlur: 0,
    });
  }

  ctx.restore();
  return ledger.snapshot();
}

/** Rasterizes a price board with ruled rows and dotted leaders. */
export function paintPriceBoardRecipe(ctx: CanvasRenderingContext2D, recipe: PriceBoardRecipe): PaintReport {
  const ledger = new PaintLedger(recipe.id);
  const { width, height } = recipe.canvas;
  ctx.save();
  ctx.fillStyle = recipe.panel;
  ctx.fillRect(0, 0, width, height);
  ledger.shape();

  ctx.strokeStyle = recipe.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(4, 4, width - 8, height - 8);
  ledger.shape();

  paintTrackedText(ctx, ledger, {
    text: recipe.title,
    x: width / 2,
    y: height * 0.12,
    font: recipe.titleFont,
    tracking: 1,
    align: "center",
    ink: recipe.ink,
    outlineInk: recipe.ink,
    outlineWidth: 0,
    glowColor: recipe.accent,
    glowBlur: 0,
  });

  const rowHeight = height * 0.72 / Math.max(1, recipe.lines.length);
  for (const [index, line] of recipe.lines.entries()) {
    const y = height * 0.22 + rowHeight * (index + 0.5);
    paintTrackedText(ctx, ledger, {
      text: line.label,
      x: width * 0.08,
      y,
      font: recipe.font,
      tracking: 0.5,
      align: "left",
      ink: recipe.ink,
      outlineInk: recipe.ink,
      outlineWidth: 0,
      glowColor: recipe.accent,
      glowBlur: 0,
    });
    paintTrackedText(ctx, ledger, {
      text: line.price,
      x: width * 0.92,
      y,
      font: recipe.font,
      tracking: 0.5,
      align: "right",
      ink: recipe.ink,
      outlineInk: recipe.ink,
      outlineWidth: 0,
      glowColor: recipe.accent,
      glowBlur: 0,
    });
    ctx.strokeStyle = recipe.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(width * 0.1, y + rowHeight * 0.3);
    ctx.lineTo(width * 0.9, y + rowHeight * 0.3);
    ctx.stroke();
    ledger.shape();
  }
  ctx.setLineDash([]);
  ctx.restore();
  return ledger.snapshot();
}

/** Rasterizes an in-window poster. */
export function paintPosterRecipe(ctx: CanvasRenderingContext2D, recipe: PosterRecipe): PaintReport {
  const ledger = new PaintLedger(recipe.id);
  const { width, height } = recipe.canvas;
  ctx.save();
  ctx.fillStyle = recipe.panel;
  ctx.fillRect(0, 0, width, height);
  ledger.shape();
  if (recipe.border) {
    ctx.strokeStyle = recipe.accent;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.strokeRect(6, 6, width - 12, height - 12);
    ledger.shape();
  }
  ctx.fillStyle = recipe.accent;
  ctx.fillRect(0, height * 0.2, width, Math.max(3, height * 0.03));
  ledger.shape();
  paintTrackedText(ctx, ledger, {
    text: recipe.headline,
    x: width / 2,
    y: height * 0.52,
    font: recipe.headlineFont,
    tracking: 1,
    align: "center",
    ink: recipe.ink,
    outlineInk: cssColor(0x000000, 0.35),
    outlineWidth: 1,
    glowColor: recipe.accent,
    glowBlur: 0,
  });
  paintTrackedText(ctx, ledger, {
    text: recipe.subline,
    x: width / 2,
    y: height * 0.78,
    font: recipe.font,
    tracking: 1,
    align: "center",
    ink: recipe.ink,
    outlineInk: recipe.ink,
    outlineWidth: 0,
    glowColor: recipe.accent,
    glowBlur: 0,
  });
  ctx.restore();
  return ledger.snapshot();
}

/** Rasterizes a vinyl decal in one of four badge shapes. */
export function paintDecalRecipe(ctx: CanvasRenderingContext2D, recipe: DecalRecipe): PaintReport {
  const ledger = new PaintLedger(recipe.id);
  const { width, height } = recipe.canvas;
  ctx.save();
  ctx.fillStyle = recipe.panel;

  switch (recipe.badge) {
    case "rect": {
      ctx.fillRect(width * 0.04, height * 0.12, width * 0.92, height * 0.76);
      ledger.shape();
      break;
    }
    case "circle": {
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ledger.shape();
      break;
    }
    case "burst": {
      const points = 12;
      const outer = Math.min(width, height) * 0.48;
      ctx.beginPath();
      for (let index = 0; index < points * 2; index += 1) {
        const angle = (index * Math.PI) / points;
        const radius = index % 2 === 0 ? outer : outer * 0.62;
        const x = width * 0.5 + Math.cos(angle) * radius;
        const y = height * 0.5 + Math.sin(angle) * radius;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.fill();
      ledger.shape();
      break;
    }
    case "band": {
      ctx.fillRect(0, height * 0.24, width, height * 0.52);
      ledger.shape();
      break;
    }
  }

  ctx.globalAlpha = recipe.opacity;
  paintTrackedText(ctx, ledger, {
    text: recipe.text,
    x: width / 2,
    y: recipe.subtext.length > 0 ? height * 0.44 : height * 0.5,
    font: recipe.font,
    tracking: 1,
    align: "center",
    ink: recipe.ink,
    outlineInk: cssColor(0x000000, 0.35),
    outlineWidth: 1,
    glowColor: recipe.accent,
    glowBlur: 0,
  });
  if (recipe.subtext.length > 0) {
    paintTrackedText(ctx, ledger, {
      text: recipe.subtext,
      x: width / 2,
      y: height * 0.68,
      font: recipe.font,
      tracking: 1,
      align: "center",
      ink: recipe.ink,
      outlineInk: recipe.ink,
      outlineWidth: 0,
      glowColor: recipe.accent,
      glowBlur: 0,
    });
  }
  ctx.globalAlpha = 1;

  if (recipe.wear > 0.3) {
    ctx.fillStyle = cssColor(0x000000, recipe.wear * 0.25);
    ctx.fillRect(0, height * 0.82, width, height * 0.18);
    ledger.shape();
  }
  ctx.restore();
  return ledger.snapshot();
}

/** Rasterizes the worn/new material overlay painted across a facade. */
export function paintWearRecipe(ctx: CanvasRenderingContext2D, recipe: WearRecipe): PaintReport {
  const ledger = new PaintLedger(recipe.id);
  const { width, height } = recipe.canvas;
  ctx.save();
  ctx.fillStyle = recipe.soot;
  ctx.fillRect(0, height * (1 - recipe.level), width, height * recipe.level);
  ledger.shape();

  ctx.strokeStyle = recipe.streakColor;
  ctx.lineWidth = Math.max(1, height * 0.02);
  for (let index = 0; index < recipe.streaks; index += 1) {
    const x = ((index + 0.5) * width) / Math.max(1, recipe.streaks);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + width * 0.02, height * (0.4 + recipe.level * 0.5));
    ctx.stroke();
    ledger.shape();
  }

  ctx.fillStyle = recipe.patinaColor;
  for (let index = 0; index < recipe.chips; index += 1) {
    const x = ((index * 37) % width);
    const y = (index * 53) % height;
    ctx.fillRect(x, y, Math.max(1, width * 0.01), Math.max(1, height * 0.03));
    ledger.shape();
  }

  if (recipe.gloss > 0.4) {
    const gloss = ctx.createLinearGradient(0, 0, width, 0);
    gloss.addColorStop(0, cssColor(0xffffff, 0));
    gloss.addColorStop(0.5, cssColor(0xffffff, recipe.gloss * 0.28));
    gloss.addColorStop(1, cssColor(0xffffff, 0));
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, width, height);
    ledger.shape();
  }
  ctx.restore();
  return ledger.snapshot();
}

/* -------------------------------------------------------------------------- */
/* Texture library                                                            */
/* -------------------------------------------------------------------------- */

/** A live texture plus the recipe and paint evidence behind it. */
export interface PaintedTexture {
  readonly recipeId: string;
  readonly slot: StorefrontTextureSlot;
  readonly texture: THREE.Texture;
  /** Logical recipe size; equals `texture.image` size whenever a canvas exists. */
  readonly width: number;
  readonly height: number;
  readonly repeat: readonly [number, number];
  /** True when a 2D context was available and the recipe was actually drawn. */
  readonly rasterized: boolean;
  readonly paint: PaintReport;
}

/** Everything the library needs to materialise one texture. */
export interface TexturePaintPlan {
  readonly recipeId: string;
  readonly slot: StorefrontTextureSlot;
  readonly width: number;
  readonly height: number;
  readonly repeat?: readonly [number, number];
  readonly fallbackColor: number;
  readonly paint: (ctx: CanvasRenderingContext2D) => PaintReport;
}

export interface StorefrontTextureLibraryOptions {
  readonly canvasFactory?: CanvasSurfaceFactory;
  readonly anisotropy?: number;
}

export interface TextureLibraryStats {
  readonly created: number;
  readonly reused: number;
  readonly disposed: number;
  readonly live: number;
}

type ContextProbeState = "unknown" | "supported" | "unsupported";
let contextProbe: ContextProbeState = "unknown";

/**
 * Resolves a 2D context once per process.
 *
 * Headless DOM implementations expose the canvas API without a rasterizer;
 * caching the first negative answer keeps the fallback cheap and stops every
 * later texture from re-probing a context that cannot exist.
 */
function resolveContext(surface: CanvasSurface): CanvasRenderingContext2D | null {
  if (contextProbe === "unsupported") {
    return null;
  }
  try {
    const ctx = surface.getContext("2d");
    contextProbe = ctx ? "supported" : "unsupported";
    return ctx;
  } catch {
    contextProbe = "unsupported";
    return null;
  }
}

function tintedDataTexture(color: number): THREE.DataTexture {
  const data = new Uint8Array([
    (color >> 16) & 0xff,
    (color >> 8) & 0xff,
    color & 0xff,
    255,
  ]);
  const texture = new THREE.DataTexture(data, 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Reference-counted cache of painted textures.
 *
 * Storefronts of the same programme share the same signage, awning, poster and
 * decal recipes, so the cache key is the recipe id: twenty lots cost one canvas
 * per recipe per era instead of twenty. Variants `acquire` on build and
 * `release` on disposal, and a texture is only disposed when the last holder
 * lets go — which is exactly what the era morph needs when it drops the
 * outgoing shop identity.
 */
export class StorefrontTextureLibrary {
  private readonly entries = new Map<string, { texture: PaintedTexture; refs: number }>();
  private readonly canvasFactory: CanvasSurfaceFactory;
  private readonly anisotropy: number;
  private createdCount = 0;
  private reusedCount = 0;
  private disposedCount = 0;

  constructor(options: StorefrontTextureLibraryOptions = {}) {
    this.canvasFactory = options.canvasFactory ?? defaultCanvasFactory;
    this.anisotropy = options.anisotropy ?? 4;
  }

  /** Returns the shared texture for `plan`, painting it on first use. */
  acquire(plan: TexturePaintPlan): PaintedTexture {
    const existing = this.entries.get(plan.recipeId);
    if (existing) {
      existing.refs += 1;
      this.reusedCount += 1;
      return existing.texture;
    }

    const surface = this.canvasFactory(plan.width, plan.height);
    const ctx = resolveContext(surface);
    const paint = ctx ? plan.paint(ctx) : emptyPaintReport(plan.recipeId);
    const texture = surface.image ? new THREE.CanvasTexture(surface.image) : tintedDataTexture(plan.fallbackColor);
    const repeat: readonly [number, number] = plan.repeat ?? [1, 1];
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.anisotropy = this.anisotropy;
    texture.name = `storefront:${plan.slot}:${plan.recipeId}`;
    texture.needsUpdate = true;

    const record: PaintedTexture = {
      recipeId: plan.recipeId,
      slot: plan.slot,
      texture,
      width: plan.width,
      height: plan.height,
      repeat,
      rasterized: ctx !== null && surface.image !== null,
      paint,
    };
    this.entries.set(plan.recipeId, { texture: record, refs: 1 });
    this.createdCount += 1;
    return record;
  }

  /** Drops one reference, disposing the texture when the last holder leaves. */
  release(texture: PaintedTexture): void {
    const entry = this.entries.get(texture.recipeId);
    if (!entry) {
      return;
    }
    entry.refs -= 1;
    if (entry.refs > 0) {
      return;
    }
    entry.texture.texture.dispose();
    this.entries.delete(texture.recipeId);
    this.disposedCount += 1;
  }

  /** Disposes every texture still held, used on system teardown. */
  disposeAll(): void {
    for (const entry of this.entries.values()) {
      entry.texture.texture.dispose();
      this.disposedCount += 1;
    }
    this.entries.clear();
  }

  get stats(): TextureLibraryStats {
    return {
      created: this.createdCount,
      reused: this.reusedCount,
      disposed: this.disposedCount,
      live: this.entries.size,
    };
  }
}
