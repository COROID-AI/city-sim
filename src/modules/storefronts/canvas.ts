import * as THREE from 'three';
import { FONTS } from './fonts';
import type { AdStyle, LogoKind, SignStyle } from './eraConfig';

/**
 * Procedural canvas-texture generators for signage.
 *
 * All signage (typography + logos) is drawn onto 2D canvases and returned as
 * `THREE.CanvasTexture`s. Materials apply these as both `map` and
 * `emissiveMap`, so emissive intensity (day vs night) controls how strongly
 * the signage glows.
 */

/* ---------------------------------------------------------------------------
 * Color helpers
 * ------------------------------------------------------------------------- */

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const full =
    m.length === 3
      ? m
          .split('')
          .map((c) => c + c)
          .join('')
      : m;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lighten(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${clampByte(r + (255 - r) * amt)},${clampByte(
    g + (255 - g) * amt,
  )},${clampByte(b + (255 - b) * amt)})`;
}

function darken(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${clampByte(r * (1 - amt))},${clampByte(g * (1 - amt))},${clampByte(
    b * (1 - amt),
  )})`;
}

/* ---------------------------------------------------------------------------
 * Canvas plumbing
 * ------------------------------------------------------------------------- */

function makeCanvas(
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------------------------------------------------------------------
 * Drawing helpers
 * ------------------------------------------------------------------------- */

function drawCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  font: string,
  color: string,
  maxWidth: number,
): void {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy, maxWidth);
}

function drawScanlines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < h; y += 4) {
    ctx.fillRect(0, y, w, 1);
  }
}

/** Subtle worn/vignette treatment for 1940s hand-painted signs. */
function paintDistress(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    h * 0.3,
    w / 2,
    h / 2,
    w * 0.75,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 240; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`;
    ctx.fillRect(
      Math.random() * w,
      Math.random() * h,
      1 + Math.random() * 2,
      1 + Math.random() * 2,
    );
  }
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outer = s;
    const inner = s * 0.5;
    const a1 = (i * 72 - 90) * (Math.PI / 180);
    const a2 = (i * 72 + 36 - 90) * (Math.PI / 180);
    ctx.lineTo(Math.cos(a1) * outer, Math.sin(a1) * outer);
    ctx.lineTo(Math.cos(a2) * inner, Math.sin(a2) * inner);
  }
  ctx.closePath();
  ctx.fill();
}

function drawLogo(
  ctx: CanvasRenderingContext2D,
  kind: LogoKind,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const s = size / 2;
  switch (kind) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'star':
      drawStar(ctx, s, color);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(s * 0.2, -s);
      ctx.lineTo(-s * 0.6, s * 0.1);
      ctx.lineTo(-s * 0.1, s * 0.1);
      ctx.lineTo(-s * 0.2, s);
      ctx.lineTo(s * 0.6, -s * 0.1);
      ctx.lineTo(s * 0.1, -s * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'wave':
      ctx.lineWidth = size * 0.14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.5, -s * 0.9, 0, -s * 0.2);
      ctx.quadraticCurveTo(s * 0.5, s * 0.5, s, -s * 0.2);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

/** Choose the period font stack + weight for a sign style. */
export function fontForSignStyle(style: SignStyle): {
  family: string;
  weight: string;
} {
  switch (style) {
    case 'handPainted':
      return { family: FONTS.serif, weight: '700' };
    case 'midCentury':
      return { family: FONTS.boldSans, weight: '400' };
    case 'backlit':
      return { family: FONTS.condensed, weight: '700' };
    case 'digitalPrint':
      return { family: FONTS.cleanSans, weight: '700' };
    case 'led':
      return { family: FONTS.lightSans, weight: '300' };
  }
}

/* ---------------------------------------------------------------------------
 * Signage texture
 * ------------------------------------------------------------------------- */

export interface SignTextureConfig {
  text: string;
  subtext?: string;
  backgroundColor: string;
  textColor: string;
  accentColor?: string;
  borderColor?: string;
  fontFamily: string;
  fontWeight?: string;
  style: SignStyle;
  logo?: LogoKind;
  width?: number;
  height?: number;
}

export function createSignTexture(cfg: SignTextureConfig): THREE.CanvasTexture {
  const width = cfg.width ?? 512;
  const height = cfg.height ?? 160;
  const [canvas, ctx] = makeCanvas(width, height);
  const accent = cfg.accentColor ?? cfg.textColor;

  ctx.fillStyle = cfg.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  if (cfg.style === 'handPainted') {
    paintDistress(ctx, width, height);
  } else if (cfg.style === 'midCentury') {
    // Glossy enamel gradient + top highlight.
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, lighten(cfg.backgroundColor, 0.3));
    g.addColorStop(0.5, cfg.backgroundColor);
    g.addColorStop(1, darken(cfg.backgroundColor, 0.28));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(0, 0, width, height * 0.16);
  } else if (cfg.style === 'led') {
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, width, height);
    drawScanlines(ctx, width, height);
  }

  if (cfg.borderColor) {
    ctx.strokeStyle = cfg.borderColor;
    ctx.lineWidth = 8;
    ctx.strokeRect(7, 7, width - 14, height - 14);
  }

  const hasLogo = !!cfg.logo;
  const textCx = hasLogo ? width * 0.54 : width / 2;
  const fontSize = Math.floor(height * (cfg.subtext ? 0.4 : 0.52));
  const font = `${cfg.fontWeight ?? 'bold'} ${fontSize}px ${cfg.fontFamily}`;

  if (hasLogo) {
    drawLogo(ctx, cfg.logo!, width * 0.18, height / 2, height * 0.42, accent);
  }

  const glow = cfg.style === 'led' || cfg.style === 'backlit';
  if (glow) {
    ctx.save();
    ctx.shadowBlur = 14;
    ctx.shadowColor = cfg.textColor;
  }
  drawCentered(
    ctx,
    cfg.text,
    textCx,
    cfg.subtext ? height * 0.34 : height / 2,
    font,
    cfg.textColor,
    width * (hasLogo ? 0.72 : 0.92),
  );
  if (glow) ctx.restore();

  if (cfg.subtext) {
    drawCentered(
      ctx,
      cfg.subtext,
      textCx,
      height * 0.7,
      `${Math.floor(height * 0.2)}px ${cfg.fontFamily}`,
      accent,
      width * (hasLogo ? 0.72 : 0.9),
    );
  }

  return toTexture(canvas);
}

/* ---------------------------------------------------------------------------
 * Advertisement poster texture
 * ------------------------------------------------------------------------- */

export interface PosterTextureConfig {
  headline: string;
  subhead: string;
  cta: string;
  style: AdStyle;
  bg: string;
  fg: string;
  accent: string;
  width?: number;
  height?: number;
}

function drawHalftone(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
): void {
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = color;
  const gap = 16;
  for (let y = 0; y < h; y += gap) {
    for (let x = 0; x < w; x += gap) {
      ctx.beginPath();
      ctx.arc(
        x + gap / 2,
        y + gap / 2,
        3 + Math.sin(x + y) * 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.4;
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    ctx.rotate(Math.PI * (2 / rays));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius * 0.9, -radius * 0.12);
    ctx.lineTo(radius * 0.9, radius * 0.12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawNeonGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 2;
  const step = 48;
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDigitalBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
): void {
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = color;
  const bars = 6;
  const bw = w / (bars * 2 + 1);
  for (let i = 0; i < bars; i++) {
    const x = bw + i * (bw * 2);
    ctx.fillRect(x, 0, bw, h);
  }
  ctx.restore();
}

function drawCorporateStripe(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  const stripe = h * 0.06;
  ctx.fillRect(0, h * 0.06, w, stripe);
  ctx.fillRect(0, h * 0.88, w, stripe);
  ctx.restore();
}

/** Simple vintage illustration (sun + hills) for 1940s sepia posters. */
function drawSepiaArt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: string,
  fg: string,
): void {
  ctx.save();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.32, h * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.6);
  ctx.quadraticCurveTo(w * 0.25, h * 0.45, w * 0.5, h * 0.6);
  ctx.quadraticCurveTo(w * 0.75, h * 0.45, w, h * 0.6);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Sepia tone the whole poster (1940s). */
function applySepia(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    d[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
    d[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
    d[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
  }
  ctx.putImageData(img, 0, 0);
}

export function createPosterTexture(
  cfg: PosterTextureConfig,
): THREE.CanvasTexture {
  const width = cfg.width ?? 512;
  const height = cfg.height ?? 640;
  const [canvas, ctx] = makeCanvas(width, height);

  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, cfg.bg);
  g.addColorStop(1, darken(cfg.bg, 0.18));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  switch (cfg.style) {
    case 'sepia':
      drawSepiaArt(ctx, width, height, cfg.accent, cfg.fg);
      break;
    case 'popart':
      drawHalftone(ctx, width, height, cfg.accent);
      drawBurst(ctx, width / 2, height * 0.24, height * 0.42, cfg.accent);
      break;
    case 'neon80s':
      drawNeonGrid(ctx, width, height, cfg.accent);
      break;
    case 'digital':
      drawDigitalBars(ctx, width, height, cfg.accent);
      break;
    case 'corporate':
      drawCorporateStripe(ctx, width, height, cfg.accent);
      break;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const headlineFont = `900 ${Math.floor(height * 0.1)}px Impact, 'Arial Black', sans-serif`;
  if (cfg.style === 'neon80s') {
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = cfg.accent;
  }
  ctx.font = headlineFont;
  ctx.fillStyle = cfg.fg;
  ctx.fillText(cfg.headline, width / 2, height * 0.28, width * 0.9);
  if (cfg.style === 'neon80s') ctx.restore();

  ctx.font = `${Math.floor(height * 0.045)}px Arial, sans-serif`;
  ctx.fillStyle = cfg.fg;
  ctx.fillText(cfg.subhead, width / 2, height * 0.52, width * 0.9);

  ctx.font = `bold ${Math.floor(height * 0.04)}px Arial, sans-serif`;
  ctx.fillStyle = cfg.accent;
  ctx.fillText(cfg.cta, width / 2, height * 0.82, width * 0.9);

  ctx.strokeStyle = cfg.fg;
  ctx.lineWidth = 7;
  ctx.strokeRect(5, 5, width - 10, height - 10);

  if (cfg.style === 'sepia') applySepia(ctx, width, height);

  return toTexture(canvas);
}

/* ---------------------------------------------------------------------------
 * Awning texture
 * ------------------------------------------------------------------------- */

export function createAwningTexture(
  colors: [string, string],
  stripes = 14,
): THREE.CanvasTexture {
  const width = 512;
  const height = 128;
  const [canvas, ctx] = makeCanvas(width, height);
  const stripeW = width / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? colors[0] : colors[1];
    ctx.fillRect(i * stripeW, 0, stripeW, height);
  }
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  return toTexture(canvas);
}

/* ---------------------------------------------------------------------------
 * Neon texture
 * ------------------------------------------------------------------------- */

export function createNeonTexture(
  text: string,
  color: string,
): THREE.CanvasTexture {
  const width = 256;
  const height = 96;
  const [canvas, ctx] = makeCanvas(width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.shadowBlur = 12;
  ctx.shadowColor = color;
  drawCentered(
    ctx,
    text,
    width / 2,
    height / 2,
    `700 ${Math.floor(height * 0.7)}px Arial, sans-serif`,
    color,
    width * 0.95,
  );
  ctx.restore();
  return toTexture(canvas);
}

/* ---------------------------------------------------------------------------
 * Dynamic LED / digital screen frame
 * ------------------------------------------------------------------------- */

/** Draw one animated frame of a digital screen into an existing canvas. */
export function drawLedFrame(
  canvas: HTMLCanvasElement,
  lines: readonly [string, string, string],
  accent: string,
  secondary: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, w, h);
  drawScanlines(ctx, w, h);

  ctx.save();
  ctx.shadowBlur = 16;
  ctx.shadowColor = accent;
  drawCentered(
    ctx,
    lines[0],
    w / 2,
    h * 0.3,
    `700 ${Math.floor(h * 0.22)}px Arial, sans-serif`,
    accent,
    w * 0.94,
  );
  ctx.restore();

  drawCentered(
    ctx,
    lines[1],
    w / 2,
    h * 0.62,
    `${Math.floor(h * 0.11)}px Arial, sans-serif`,
    secondary,
    w * 0.9,
  );
  drawCentered(
    ctx,
    lines[2],
    w / 2,
    h * 0.88,
    `${Math.floor(h * 0.06)}px 'Courier New', monospace`,
    secondary,
    w * 0.9,
  );
}

export function createLedFrameTexture(
  lines: readonly [string, string, string],
  accent: string,
  secondary: string,
  width = 512,
  height = 288,
): THREE.CanvasTexture {
  const [canvas] = makeCanvas(width, height);
  drawLedFrame(canvas, lines, accent, secondary);
  return toTexture(canvas);
}
