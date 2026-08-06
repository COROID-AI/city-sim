/**
 * Canvas-generated signage & advertisement textures.
 *
 * Every sign and poster is drawn procedurally onto an offscreen 2D canvas and
 * wrapped in a `THREE.CanvasTexture`. The drawing functions are era-specific:
 * hand-painted lettering, mid-century enamel, glowing backlit plastic,
 * digital-print light boxes, dynamic LED screens, and each poster style.
 *
 * Textures are deterministic for a given spec (grain is seeded), so the same
 * storefront always renders the same signage.
 */
import * as THREE from 'three';
import type { EraStorefrontConfig, PosterSource, StorefrontSpec } from './storefrontTypes';

/** Common canvas sizes for signage. */
export const SIGN_W = 512;
export const SIGN_H = 128;
/** Common canvas sizes for poster advertisements. */
export const POSTER_W = 256;
export const POSTER_H = 360;

/** Primitive spec shared by every canvas draw. */
export interface SignSpec {
  width: number;
  height: number;
  text: string;
  subtext?: string;
  fontFamily: string;
  fontWeight?: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  borderColor?: string;
  accentColor?: string;
  letterSpacing?: number;
  seed?: number;
}

/** Create an offscreen canvas of the given size. */
export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Wrap a canvas in a `THREE.CanvasTexture` ready for a material. */
export function canvasToTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Deterministic PRNG (mulberry32) for reproducible texture grain. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw centered text (with optional per-glyph letter spacing). */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  align: CanvasTextAlign = 'center',
  letterSpacing = 0,
): void {
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (letterSpacing <= 0) {
    ctx.fillText(text, x, y);
    return;
  }
  const widths = Array.from(text).map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + letterSpacing * (text.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  Array.from(text).forEach((ch, i) => {
    ctx.fillText(ch, cx, y);
    cx += widths[i] + letterSpacing;
  });
}

/** Draw text with a soft neon glow (multiple blurred strokes). */
function drawNeonText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  glowStrength: number,
): void {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = glowStrength; i > 0; i--) {
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = color;
    ctx.lineWidth = i * 2;
    ctx.strokeText(text, x, y);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.strokeText(text, x, y);
}

/** Faint deterministic grain overlay (aged / painted surfaces). */
function paintGrain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const rand = mulberry32(seed);
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#000000' : '#ffffff';
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.restore();
}

/** 1945: hand-painted lettering on a plaster/wood panel. */
function drawHandPaintedSign(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, textColor, backgroundColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Slight vertical brush streaks.
  const rand = mulberry32((seed ?? 1) ^ 0x9e3779b9);
  ctx.save();
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 46; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#000000' : '#ffffff';
    ctx.fillRect(rand() * width, rand() * height, 1 + rand() * 2, height * 0.6);
  }
  ctx.restore();

  // Distressed inner border.
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, width - 12, height - 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  const font = `${fontWeight ?? '700'} ${fontSize}px ${fontFamily}`;
  drawText(ctx, text, width / 2, subtext ? height * 0.38 : height / 2, font, textColor, 'center', 2);
  if (subtext) {
    drawText(ctx, subtext, width / 2, height * 0.74, `${fontWeight ?? '700'} ${fontSize * 0.42}px ${fontFamily}`, 'rgba(0,0,0,0.65)');
  }
  paintGrain(ctx, width, height, seed ?? 1);
  return c;
}

/** 1965: bold mid-century enamel sign with a drop shadow. */
function drawMidCenturySign(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, textColor, backgroundColor, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Glossy enamel sheen.
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Bold frame.
  ctx.fillStyle = accentColor ?? 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, 0, width, 8);
  ctx.fillRect(0, height - 8, width, 8);
  ctx.fillRect(0, 0, 8, height);
  ctx.fillRect(width - 8, 0, 8, height);

  const font = `${fontWeight ?? '900'} ${fontSize}px ${fontFamily}`;
  // Drop shadow.
  drawText(ctx, text, width / 2 + 3, (subtext ? height * 0.38 : height / 2) + 3, font, 'rgba(0,0,0,0.4)');
  drawText(ctx, text, width / 2, subtext ? height * 0.38 : height / 2, font, textColor);
  if (subtext) {
    drawText(ctx, subtext, width / 2, height * 0.76, `${fontWeight ?? '900'} ${fontSize * 0.44}px ${fontFamily}`, 'rgba(0,0,0,0.7)');
  }
  paintGrain(ctx, width, height, seed ?? 2);
  return c;
}

/** 1985: glowing backlit plastic sign with a gradient glow. */
function drawBacklitSign(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, textColor, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  const base = accentColor ?? '#1f3a8a';
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, base);
  grad.addColorStop(0.5, '#0d1428');
  grad.addColorStop(1, base);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Inner glow frame.
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, width - 10, height - 10);

  const font = `${fontWeight ?? '700'} ${fontSize}px ${fontFamily}`;
  drawNeonText(ctx, text, width / 2, subtext ? height * 0.38 : height / 2, font, textColor, 6);
  if (subtext) {
    drawNeonText(ctx, subtext, width / 2, height * 0.76, `${fontWeight ?? '700'} ${fontSize * 0.44}px ${fontFamily}`, textColor, 4);
  }
  paintGrain(ctx, width, height, seed ?? 3);
  return c;
}

/** 2005: digital-print light box with a clean, bright face. */
function drawLightBoxSign(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, textColor, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#e6ecf2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Thin metal frame.
  ctx.fillStyle = '#9aa0a6';
  ctx.fillRect(0, 0, width, 5);
  ctx.fillRect(0, height - 5, width, 5);
  ctx.fillRect(0, 0, 5, height);
  ctx.fillRect(width - 5, 0, 5, height);

  const font = `${fontWeight ?? '700'} ${fontSize}px ${fontFamily}`;
  drawText(ctx, text, width / 2, subtext ? height * 0.38 : height / 2, font, textColor);
  if (subtext) {
    drawText(ctx, subtext, width / 2, height * 0.76, `${fontWeight ?? '700'} ${fontSize * 0.44}px ${fontFamily}`, accentColor ?? '#a8322a');
  }
  paintGrain(ctx, width, height, seed ?? 4);
  return c;
}

/** 2025: minimal digital LED screen. */
function drawDigitalSign(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, textColor, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#06090f';
  ctx.fillRect(0, 0, width, height);

  // Minimal bezel.
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, width - 4, height - 4);

  const font = `${fontWeight ?? '400'} ${fontSize}px ${fontFamily}`;
  drawText(ctx, text, width / 2, subtext ? height * 0.4 : height / 2, font, textColor);
  if (subtext) {
    drawText(ctx, subtext, width / 2, height * 0.78, `${fontWeight ?? '400'} ${fontSize * 0.4}px ${fontFamily}`, accentColor ?? '#4ae3ff');
  }
  paintGrain(ctx, width, height, seed ?? 5);
  return c;
}

/** 1945: sepia-toned period poster with geometric illustration. */
function drawSepiaPoster(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, textColor, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#e6d8bd';
  ctx.fillRect(0, 0, width, height);

  // Sepia vignette.
  const vg = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(60,40,20,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, width, height);

  // Geometric period illustration (sunburst + arch).
  ctx.fillStyle = accentColor ?? '#8a6a3a';
  ctx.beginPath();
  ctx.arc(width / 2, height * 0.42, height * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c8a878';
  ctx.beginPath();
  ctx.arc(width / 2, height * 0.42, height * 0.14, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#5a4630';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  const font = `${fontWeight ?? '700'} ${fontSize}px ${fontFamily}`;
  drawText(ctx, text, width / 2, height * 0.12, font, textColor);
  drawText(ctx, subtext ?? '', width / 2, height * 0.86, `${fontWeight ?? '700'} ${fontSize * 0.5}px ${fontFamily}`, '#5a4630');
  paintGrain(ctx, width, height, seed ?? 6);
  return c;
}

/** 1965: Pop-art poster with halftone dots and bold color. */
function drawPopArtPoster(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, textColor, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = accentColor ?? '#ffd23e';
  ctx.fillRect(0, 0, width, height);

  // Halftone dot field.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  const step = 14;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      ctx.beginPath();
      ctx.arc(x + step / 2, y + step / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Pop burst.
  ctx.fillStyle = textColor;
  ctx.beginPath();
  ctx.arc(width / 2, height * 0.5, height * 0.3, 0, Math.PI * 2);
  ctx.fill();

  const font = `${fontWeight ?? '900'} ${fontSize}px ${fontFamily}`;
  drawText(ctx, text, width / 2, height * 0.5, font, accentColor ?? '#ffd23e');
  drawText(ctx, subtext ?? '', width / 2, height * 0.9, `${fontWeight ?? '900'} ${fontSize * 0.5}px ${fontFamily}`, '#000000');
  paintGrain(ctx, width, height, seed ?? 7);
  return c;
}

/** 1985: bold 80s poster with neon gradient and chrome accents. */
function drawEightiesPoster(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, textColor, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#2a1a5e');
  grad.addColorStop(0.5, '#a8328a');
  grad.addColorStop(1, '#1f3a8a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Neon grid.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let y = 0; y < height; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let x = 0; x < width; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  const font = `${fontWeight ?? '700'} ${fontSize}px ${fontFamily}`;
  drawNeonText(ctx, text, width / 2, height * 0.4, font, textColor, 7);
  drawNeonText(ctx, subtext ?? '', width / 2, height * 0.82, `${fontWeight ?? '700'} ${fontSize * 0.5}px ${fontFamily}`, accentColor ?? '#4ae3ff', 5);
  paintGrain(ctx, width, height, seed ?? 8);
  return c;
}

/** 2005: clean corporate print advertisement. */
function drawCorporatePoster(spec: SignSpec): HTMLCanvasElement {
  const { width, height, text, subtext, fontFamily, fontWeight, fontSize, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, width, height);

  // Product block.
  ctx.fillStyle = accentColor ?? '#1f5f8a';
  ctx.fillRect(width * 0.2, height * 0.22, width * 0.6, height * 0.32);

  // Tagline bar.
  ctx.fillStyle = '#2e3a45';
  ctx.fillRect(0, height * 0.78, width, height * 0.22);

  const font = `${fontWeight ?? '700'} ${fontSize}px ${fontFamily}`;
  drawText(ctx, text, width / 2, height * 0.12, font, '#2e3a45');
  drawText(ctx, subtext ?? '', width / 2, height * 0.88, `${fontWeight ?? '700'} ${fontSize * 0.55}px ${fontFamily}`, '#ffffff');
  paintGrain(ctx, width, height, seed ?? 9);
  return c;
}

/** 2025: dynamic digital ad loop — one animated frame. */
export function drawDigitalAdFrame(
  variant: number,
  timeMs: number,
  spec: SignSpec,
): HTMLCanvasElement {
  const { width, height, fontFamily, fontWeight, fontSize, textColor, accentColor, seed } = spec;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#0a0e16';
  ctx.fillRect(0, 0, width, height);

  const messages = ['BUY MORE', 'SALE NOW', 'NEW DROP', '24/7 LIVE', 'JOIN US'];
  const frame = Math.floor(timeMs / 1600) % messages.length;
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 220);

  // Animated accent bar.
  const barX = (timeMs / 40) % (width + 40) - 20;
  ctx.fillStyle = accentColor ?? '#4ae3ff';
  ctx.globalAlpha = 0.7;
  ctx.fillRect(barX, height * 0.3, 26, height * 0.4);
  ctx.globalAlpha = 1;

  const font = `${fontWeight ?? '400'} ${fontSize}px ${fontFamily}`;
  drawText(ctx, messages[frame], width / 2, height * 0.42, font, textColor);
  drawText(
    ctx,
    `V${variant + 1} · ${Math.round(pulse * 100)}%`,
    width / 2,
    height * 0.82,
    `${fontWeight ?? '400'} ${fontSize * 0.4}px ${fontFamily}`,
    accentColor ?? '#4ae3ff',
  );
  paintGrain(ctx, width, height, seed ?? 10);
  return c;
}

/** Build the sign canvas for a storefront based on its era sign style. */
export function buildSignCanvas(config: EraStorefrontConfig, spec: StorefrontSpec): HTMLCanvasElement {
  const base: SignSpec = {
    width: SIGN_W,
    height: SIGN_H,
    text: spec.name,
    subtext: spec.subtext,
    fontFamily: config.signFontFamily,
    fontWeight: config.signFontWeight,
    fontSize: 62,
    textColor: spec.signColor,
    backgroundColor: spec.facadeColor,
    accentColor: spec.neonColor,
    letterSpacing: 2,
    seed: spec.seed,
  };
  switch (config.signStyle) {
    case 'handPainted':
      return drawHandPaintedSign(base);
    case 'midCentury':
      return drawMidCenturySign(base);
    case 'backlit':
      return drawBacklitSign(base);
    case 'lightBox':
      return drawLightBoxSign(base);
    case 'digital':
      return drawDigitalSign(base);
  }
}

/** Build the static poster canvas based on its era ad style. */
export function buildPosterCanvas(config: EraStorefrontConfig, spec: PosterSource): HTMLCanvasElement {
  const base: SignSpec = {
    width: POSTER_W,
    height: POSTER_H,
    text: spec.name,
    subtext: spec.subtext,
    fontFamily: config.signFontFamily,
    fontWeight: config.signFontWeight,
    fontSize: 44,
    textColor: spec.signColor,
    backgroundColor: spec.facadeColor,
    accentColor: spec.neonColor,
    seed: spec.seed,
  };
  switch (config.adStyle) {
    case 'sepia':
      return drawSepiaPoster(base);
    case 'popArt':
      return drawPopArtPoster(base);
    case 'eighties':
      return drawEightiesPoster(base);
    case 'corporate':
      return drawCorporatePoster(base);
    case 'digitalLoop':
      // Static fallback frame; the live component animates this style.
      return drawDigitalAdFrame(spec.posterVariant, 0, base);
  }
}