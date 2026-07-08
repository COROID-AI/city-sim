import type { CameraBounds } from './camera.js';
import * as THREE from 'three';

const MINIMAP_SIZE = 168;
const MINIMAP_PAD = 16;

const MINIMAP_STYLES = `
.minimap-root {
  position: fixed;
  right: ${MINIMAP_PAD}px;
  bottom: ${MINIMAP_PAD}px;
  z-index: 10;
  width: ${MINIMAP_SIZE}px;
  height: ${MINIMAP_SIZE}px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(120,170,230,0.28);
  background: radial-gradient(circle at 50% 40%, #1a2436, #0a0f18);
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}
.minimap-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.minimap-label {
  position: absolute;
  top: 6px;
  left: 8px;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(180,210,255,0.7);
  pointer-events: none;
  text-shadow: 0 1px 3px rgba(0,0,0,0.7);
}
.minimap-frustum {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 9px;
  color: rgba(180,210,255,0.55);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 3px rgba(0,0,0,0.7);
}
`;

interface MinimapBuilding {
  nx: number;
  nz: number;
  nw: number;
  nd: number;
}

// footprint echoes of scene BUILDING_SPECS (normalized at draw time)
const MINIMAP_BUILDINGS: { x: number; z: number; w: number; d: number }[] = [
  { x: -22, z: -16, w: 10, d: 10 },
  { x: -8, z: -18, w: 8, d: 12 },
  { x: 6, z: -16, w: 12, d: 10 },
  { x: 22, z: -18, w: 9, d: 9 },
  { x: -24, z: 0, w: 8, d: 14 },
  { x: -10, z: 2, w: 11, d: 11 },
  { x: 8, z: 0, w: 10, d: 13 },
  { x: 22, z: 2, w: 9, d: 11 },
  { x: -20, z: 16, w: 12, d: 9 },
  { x: -4, z: 18, w: 9, d: 9 },
  { x: 10, z: 16, w: 11, d: 10 },
  { x: 24, z: 18, w: 8, d: 12 },
  { x: 0, z: -30, w: 6, d: 6 },
  { x: -32, z: -8, w: 7, d: 7 },
  { x: 32, z: -8, w: 7, d: 7 },
  // Additional buildings
  { x: -32, z: 16, w: 7, d: 7 },
  { x: 28, z: 12, w: 8, d: 8 },
  { x: -16, z: -30, w: 9, d: 9 },
  { x: 18, z: -32, w: 10, d: 10 },
  { x: -26, z: -26, w: 9, d: 9 },
  { x: 26, z: -26, w: 9, d: 9 },
  { x: 0, z: 30, w: 11, d: 11 },
  { x: -32, z: 28, w: 7, d: 7 },
  { x: 32, z: 28, w: 7, d: 7 },
];

export class Minimap {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private styleEl: HTMLStyleElement;
  private frustumEl: HTMLDivElement;
  private buildings: MinimapBuilding[];
  private bounds: CameraBounds;
  private dpr: number;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = MINIMAP_STYLES;
    document.head.appendChild(this.styleEl);

    this.bounds = { minX: -38, maxX: 38, minZ: -38, maxZ: 38 };

    this.root = document.createElement('div');
    this.root.className = 'minimap-root';

    const label = document.createElement('div');
    label.className = 'minimap-label';
    label.textContent = 'District';
    this.root.appendChild(label);

    this.frustumEl = document.createElement('div');
    this.frustumEl.className = 'minimap-frustum';
    this.root.appendChild(this.frustumEl);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = MINIMAP_SIZE * this.dpr;
    this.canvas.height = MINIMAP_SIZE * this.dpr;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.root.appendChild(this.canvas);
    document.body.appendChild(this.root);

    this.buildings = MINIMAP_BUILDINGS.map((b) => ({
      nx: (b.x - this.bounds.minX) / (this.bounds.maxX - this.bounds.minX),
      nz: (b.z - this.bounds.minZ) / (this.bounds.maxZ - this.bounds.minZ),
      nw: b.w / (this.bounds.maxX - this.bounds.minX),
      nd: b.d / (this.bounds.maxZ - this.bounds.minZ),
    }));
  }

  update(camera: THREE.PerspectiveCamera, worldBounds: CameraBounds): void {
    this.bounds = worldBounds;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // roads: cross through center
    ctx.strokeStyle = 'rgba(120,150,190,0.35)';
    ctx.lineWidth = Math.max(2, W * 0.018);
    ctx.beginPath();
    ctx.moveTo(W * 0.5, 0);
    ctx.lineTo(W * 0.5, H);
    ctx.moveTo(0, H * 0.5);
    ctx.lineTo(W, H * 0.5);
    ctx.stroke();

    // secondary roads
    ctx.strokeStyle = 'rgba(110,140,180,0.18)';
    ctx.lineWidth = Math.max(1, W * 0.008);
    ctx.beginPath();
    ctx.moveTo(W * 0.25, 0); ctx.lineTo(W * 0.25, H);
    ctx.moveTo(W * 0.75, 0); ctx.lineTo(W * 0.75, H);
    ctx.moveTo(0, H * 0.25); ctx.lineTo(W, H * 0.25);
    ctx.moveTo(0, H * 0.75); ctx.lineTo(W, H * 0.75);
    ctx.stroke();

    // buildings
    ctx.fillStyle = 'rgba(150,185,235,0.55)';
    for (const b of this.buildings) {
      const px = b.nx * W;
      const py = b.nz * H;
      const pw = Math.max(3, b.nw * W);
      const ph = Math.max(3, b.nd * H);
      ctx.fillRect(px - pw / 2, py - ph / 2, pw, ph);
    }

    // camera position + view frustum cone
    const pos = camera.position;
    const cx = ((pos.x - this.bounds.minX) / (this.bounds.maxX - this.bounds.minX)) * W;
    const cz = ((pos.z - this.bounds.minZ) / (this.bounds.maxZ - this.bounds.minZ)) * H;

    const target = new THREE.Vector3();
    camera.getWorldDirection(target);
    const yaw = Math.atan2(target.x, target.z);

    // frustum width based on fov + distance to target plane
    const dist = pos.length();
    const halfFov = (camera.fov * Math.PI / 180) * 0.5;
    const halfSpan = Math.tan(halfFov) * Math.min(dist, 60);
    const spanPx = (halfSpan / (this.bounds.maxX - this.bounds.minX)) * W;

    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);
    const perpX = -dirZ;
    const perpZ = dirX;
    const lookLen = Math.min(W, H) * 0.28;

    const tipX = cx + dirX * lookLen;
    const tipZ = cz + dirZ * lookLen;
    const blX = cx - perpX * spanPx;
    const blZ = cz - perpZ * spanPx;
    const brX = cx + perpX * spanPx;
    const brZ = cz + perpZ * spanPx;

    ctx.fillStyle = 'rgba(120,200,255,0.16)';
    ctx.strokeStyle = 'rgba(140,215,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cz);
    ctx.lineTo(blX, blZ);
    ctx.lineTo(tipX, tipZ);
    ctx.lineTo(brX, brZ);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // camera dot
    ctx.fillStyle = '#8fe0ff';
    ctx.beginPath();
    ctx.arc(cx, cz, Math.max(3, W * 0.022), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    this.frustumEl.textContent = `${Math.round(pos.x)},${Math.round(pos.z)}`;
  }

  dispose(): void {
    this.styleEl.remove();
    this.root.remove();
  }
}
