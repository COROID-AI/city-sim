import * as THREE from 'three';
import type { EraRoadConfig } from './eraConfig';

/**
 * Procedural canvas-texture generator for the road surface.
 *
 * Draws the era-correct road: base asphalt/cobblestone color, worn patches
 * (1945), painted lane markings, an emerging bike lane (2005), and embedded
 * LED lane markers (2025). The canvas represents one full road segment whose
 * long axis (U) runs along X and whose width (V) runs along Z.
 */

const W = 1024;
const H = 512;

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Scatter subtle asphalt grain so the surface reads as real road. */
function drawGrain(
  ctx: CanvasRenderingContext2D,
  color: string,
  count: number,
): void {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1);
  }
}

/** Cobblestone grid (1945). */
function drawCobblestones(ctx: CanvasRenderingContext2D): void {
  const cols = 48;
  const rows = 20;
  const cw = W / cols;
  const ch = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const offset = (r % 2) * cw * 0.5;
      const x = c * cw + offset;
      const y = r * ch;
      const shade = 0.75 + Math.random() * 0.35;
      ctx.fillStyle = `rgba(${Math.round(120 * shade)},${Math.round(
        116 * shade,
      )},${Math.round(105 * shade)},1)`;
      ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
      ctx.strokeStyle = 'rgba(20,18,14,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
    }
  }
}

/** Worn patches / cracks (1945, 1985). */
function drawWornPatches(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * W;
    const y = H * 0.15 + Math.random() * H * 0.7;
    const r = 14 + Math.random() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(30,28,24,0.5)');
    g.addColorStop(1, 'rgba(30,28,24,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cracks
  ctx.strokeStyle = 'rgba(15,14,12,0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    let x = Math.random() * W;
    let y = H * 0.1 + Math.random() * H * 0.8;
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (Math.random() - 0.5) * 40;
      y += (Math.random() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Dashed center line + solid edge lines. */
function drawLaneMarkings(ctx: CanvasRenderingContext2D): void {
  // Center dashed line (yellow).
  ctx.fillStyle = '#d8c84a';
  const cy = H / 2;
  const dashW = 44;
  const dashGap = 36;
  for (let x = 0; x < W; x += dashW + dashGap) {
    ctx.fillRect(x, cy - 2, dashW, 4);
  }
  // Edge lines (white) near the road margins.
  ctx.fillStyle = '#e8e8e4';
  ctx.fillRect(0, H * 0.1, W, 3);
  ctx.fillRect(0, H * 0.9, W, 3);
}

/** Emerging bike lane stripe (2005, 2025) on the right side. */
function drawBikeLane(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#d8e8e4';
  const by = H * 0.76;
  const dashW = 26;
  const dashGap = 26;
  for (let x = 0; x < W; x += dashW + dashGap) {
    ctx.fillRect(x, by - 2, dashW, 4);
  }
}

/** Embedded LED lane markers (2025 smart road). */
function drawLedMarkers(ctx: CanvasRenderingContext2D): void {
  const cy = H / 2;
  for (let x = 40; x < W; x += 80) {
    ctx.fillStyle = '#7fd1ff';
    ctx.beginPath();
    ctx.arc(x, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createRoadTexture(config: EraRoadConfig): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas();

  // Base surface.
  ctx.fillStyle = config.baseColor;
  ctx.fillRect(0, 0, W, H);

  if (config.surface === 'cobblestone') {
    drawCobblestones(ctx);
  } else {
    drawGrain(ctx, 'rgba(255,255,255,0.05)', 900);
    drawGrain(ctx, 'rgba(0,0,0,0.12)', 700);
  }

  if (config.wornPatches) {
    drawWornPatches(ctx);
  }
  if (config.laneMarkings) {
    drawLaneMarkings(ctx);
  }
  if (config.bikeLane) {
    drawBikeLane(ctx);
  }
  if (config.ledMarkers) {
    drawLedMarkers(ctx);
  }

  return toTexture(canvas);
}