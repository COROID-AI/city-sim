import * as THREE from 'three';
import type { PosterStyle } from './eraConfig';

/** Create an offscreen canvas + 2d context of the given size. */
function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire a 2d canvas context for signage texture');
  }
  return { canvas, ctx };
}

/** Wrap a canvas into an sRGB CanvasTexture with decent anisotropy. */
function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Draw centred, word-wrapped text that fits within a box. A small font
 * shrink pass keeps long copy from overflowing the poster/sign panel.
 */
function drawFitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  font: string,
  color: string,
) {
  const words = text.split(/\s+/);
  let size = Number.parseInt(font.match(/(\d+)px/)?.[1] || '40', 10);

  const layout = (fs: number): string[] => {
    ctx.font = font.replace(/(\d+)px/, `${fs}px`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  let lines = layout(size);
  while (lines.length * size > maxH && size > 10) {
    size -= 2;
    lines = layout(size);
  }
  const lineHeight = maxH / lines.length;
  ctx.fillStyle = color;
  lines.forEach((l, i) => {
    ctx.fillText(l, x, y + (i - (lines.length - 1) / 2) * lineHeight);
  });
}

/** Options for drawing a storefront sign panel. */
export interface SignOptions {
  background: string;
  textColor: string;
  font: string;
  borderColor?: string;
  /** Neon treatment: dark panel, glowing text. */
  neon?: boolean;
  neonColor?: string;
  /** Backlit treatment: light translucent panel. */
  backlit?: boolean;
  /** Digital / LED treatment: dark panel with pixel-grid overlay. */
  digital?: boolean;
}

/**
 * Generate a canvas texture for a storefront sign.
 *
 * The texture is used as both `map` and `emissiveMap`, so bright regions
 * (neon text, lit backlit panels, LED text) self-illuminate while dark
 * backgrounds stay dark — making the signage read clearly in day and night.
 */
export function createSignTexture(text: string, opts: SignOptions): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);

  // Panel background.
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, w, h);

  if (opts.borderColor) {
    ctx.strokeStyle = opts.borderColor;
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, w - 10, h - 10);
  }

  // Neon glow (shadow pass) for the lettering.
  if (opts.neon && opts.neonColor) {
    ctx.shadowColor = opts.neonColor;
    ctx.shadowBlur = 26;
  }

  drawFitText(ctx, text, w / 2, h / 2 + 2, w - 40, h - 20, opts.font, opts.textColor);

  if (opts.neon) {
    // Second pass without blur for a crisp neon core.
    ctx.shadowBlur = 6;
    drawFitText(ctx, text, w / 2, h / 2 + 2, w - 40, h - 20, opts.font, opts.textColor);
  }

  if (opts.digital) {
    // Subtle LED pixel-grid overlay.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < h; y += 6) {
      for (let x = 0; x < w; x += 6) {
        if ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0) {
          ctx.fillRect(x + 1, y + 1, 3, 3);
        }
      }
    }
  }

  return toTexture(canvas);
}

/**
 * Generate a canvas texture for an era-correct advertisement poster or
 * digital screen panel.
 */
export function createPosterTexture(
  text: string,
  style: PosterStyle,
): THREE.CanvasTexture {
  const w = 256;
  const h = 340;
  const { canvas, ctx } = makeCanvas(w, h);

  if (style === 'sepia') {
    // 1945 — sepia-toned hand-printed poster with a sunburst motif.
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(90,70,40,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.4);
      ctx.lineTo(w / 2 + Math.cos(a) * w, h * 0.4 + Math.sin(a) * h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(90,70,40,0.35)';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.4, 44, 0, Math.PI * 2);
    ctx.fill();
    drawFitText(ctx, text, w / 2, h * 0.8, w - 24, 90, 'bold 46px Georgia, serif', '#3a2f22');
    const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(60,45,25,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (style === 'popart') {
    // 1965 — bold Pop-art poster with halftone dots.
    ctx.fillStyle = '#ffd319';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,77,109,0.5)';
    for (let y = 0; y < h; y += 14) {
      for (let x = 0; x < w; x += 14) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.4, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.4, 24, 0, Math.PI * 2);
    ctx.fill();
    drawFitText(ctx, text, w / 2, h * 0.8, w - 20, 80, 'bold 52px Impact, "Arial Black", sans-serif', '#111111');
  } else if (style === 'neon80s') {
    // 1985 — electric neon-80s poster with grid + glowing type.
    ctx.fillStyle = '#2b1440';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,229,255,0.3)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,45,149,0.6)';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.4, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,229,255,0.5)';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.4, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 20;
    drawFitText(ctx, text, w / 2, h * 0.8, w - 20, 70, 'bold 46px "Arial Black", Arial, sans-serif', '#00e5ff');
  } else if (style === 'digitalprint') {
    // 2005 — cool digital-print ad with a swoosh.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0d2b3a');
    g.addColorStop(1, '#1f5f7a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.3);
    ctx.quadraticCurveTo(w * 0.5, h * 0.1, w, h * 0.45);
    ctx.lineTo(w, h * 0.55);
    ctx.quadraticCurveTo(w * 0.5, h * 0.3, 0, h * 0.5);
    ctx.closePath();
    ctx.fill();
    drawFitText(ctx, text, w / 2, h * 0.78, w - 24, 80, 'bold 48px Arial, sans-serif', '#e8f6ff');
  } else {
    // 2025 — bright dynamic gradient screen with minimal type.
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#00c8ff');
    g.addColorStop(1, '#ff2d95');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.4, 30, 0, Math.PI * 2);
    ctx.fill();
    drawFitText(ctx, text, w / 2, h * 0.8, w - 24, 70, '300 44px "Helvetica Neue", Arial, sans-serif', '#ffffff');
  }

  return toTexture(canvas);
}

/** Options for drawing a small circular store logo disc. */
export interface LogoOptions {
  textColor: string;
  font: string;
  accent: string;
  background: string;
}

/** Generate a canvas texture for a circular store logo mark + wordmark. */
export function createLogoTexture(name: string, opts: LogoOptions): THREE.CanvasTexture {
  const s = 256;
  const { canvas, ctx } = makeCanvas(s, s);

  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, s, s);

  // Circular mark.
  ctx.fillStyle = opts.accent;
  ctx.beginPath();
  ctx.arc(s / 2, s * 0.34, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = opts.background;
  ctx.beginPath();
  ctx.arc(s / 2, s * 0.34, 30, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = 'bold 44px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.accent;
  ctx.fillText(name.charAt(0).toUpperCase() || 'S', s / 2, s * 0.34);

  // Wordmark.
  drawFitText(ctx, name, s / 2, s * 0.78, s - 20, 90, opts.font, opts.textColor);

  return toTexture(canvas);
}

/** Generate a striped canvas awning texture (1945). */
export function createAwningTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);

  const colors = ['#b03a2e', '#e8e0c8'];
  const stripes = 8;
  for (let i = 0; i < stripes; i += 1) {
    ctx.fillStyle = colors[i % 2];
    ctx.fillRect((w / stripes) * i, 0, w / stripes, h);
  }

  // Scalloped lower edge.
  ctx.fillStyle = '#b03a2e';
  ctx.fillRect(0, h - 16, w, 16);

  return toTexture(canvas);
}
