import * as THREE from 'three';
import type { RoadConfig } from './eraConfig';

/** Draw a rounded rectangle path (portable; avoids relying on ctx.roundRect). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Lay down a grid of slightly jittered, worn cobblestones. */
function drawCobblestone(ctx: CanvasRenderingContext2D, size: number) {
  const cols = 8;
  const rows = 6;
  const cell = size / cols;
  const rowH = size / rows;

  // Mortar base.
  ctx.fillStyle = '#3a3733';
  ctx.fillRect(0, 0, size, size);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      // Offset alternate rows for a running-bond cobble layout.
      const offset = r % 2 === 0 ? 0 : cell * 0.5;
      const x = c * cell + offset;
      const y = r * rowH;
      const shade = 150 + 26 * Math.sin(r * 2.7 + c * 4.1);
      const tint = Math.round(150 + 20 * Math.cos(c * 3.3 - r));
      ctx.fillStyle = `rgb(${Math.round(shade)}, ${Math.round(shade - 8)}, ${Math.round(tint - 26)})`;
      roundedRect(ctx, x + 3, y + 3, cell - 6, rowH - 6, 7);
      ctx.fill();
      // Stone highlight.
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundedRect(ctx, x + 5, y + 5, cell - 12, rowH * 0.3, 4);
      ctx.fill();
    }
  }

  // Worn / weathered patches.
  for (let i = 0; i < 26; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rad = 5 + Math.random() * 16;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Sprinkle subtle asphalt grain / noise over the base colour. */
function drawAsphaltNoise(
  ctx: CanvasRenderingContext2D,
  size: number,
  amount: number,
) {
  for (let i = 0; i < 4200; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    if (Math.random() < 0.5) {
      ctx.fillStyle = `rgba(0,0,0,${0.09 * amount})`;
    } else {
      ctx.fillStyle = `rgba(255,255,255,${0.06 * amount})`;
    }
    ctx.fillRect(x, y, 1.6, 1.6);
  }
}

/**
 * Generate a tiling procedural road-surface texture for the given era.
 *
 * The texture only encodes the surface (cobblestone / asphalt / smooth);
 * painted markings are drawn as separate meshes on top (see `RoadMarkings`).
 */
export function createRoadTexture(road: RoadConfig): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire a 2d canvas context for road texture');
  }

  ctx.fillStyle = road.baseColor;
  ctx.fillRect(0, 0, size, size);

  if (road.surface === 'cobblestone') {
    drawCobblestone(ctx, size);
  } else {
    drawAsphaltNoise(ctx, size, road.surface === 'smooth' ? 0.35 : 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(road.surface === 'cobblestone' ? 6 : 8, 2);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}