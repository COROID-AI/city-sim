/* Decal compositing onto the planet's equirect textures.
 *
 * Addresses the handoff finding that compositing decals every frame causes
 * hitches: impacts are QUEUED as tiny stamp descriptors, never repainting the
 * whole canvas. flush() runs at most once every MIN_INTERVAL ms (coalescing
 * whatever accumulated — e.g. a full second of laser ticks becomes one
 * upload), touches only the canvases actually dirtied, and flips
 * texture.needsUpdate exactly once per texture per upload. Steady-state cost
 * is zero when nothing is hitting the planet.
 */

import * as THREE from 'three';

const MIN_INTERVAL = 50;      // ms between texture uploads while under fire
const MAX_QUEUE = 260;        // drop oldest beyond this (throttle safety valve)

export class DecalPainter {
  constructor(width, height, maxAnisotropy) {
    this.w = width;
    this.h = height;

    this.albedoCanvas = document.createElement('canvas');
    this.albedoCanvas.width = width;
    this.albedoCanvas.height = height;
    this.actx = this.albedoCanvas.getContext('2d', { willReadFrequently: true });

    this.lavaCanvas = document.createElement('canvas');
    this.lavaCanvas.width = width;
    this.lavaCanvas.height = height;
    this.lvctx = this.lavaCanvas.getContext('2d', { willReadFrequently: true });
    this.lvctx.fillStyle = '#000';
    this.lvctx.fillRect(0, 0, width, height);

    this.albedoTex = new THREE.CanvasTexture(this.albedoCanvas);
    this.albedoTex.colorSpace = THREE.SRGBColorSpace;
    this.lavaTex = new THREE.CanvasTexture(this.lavaCanvas);
    if (maxAnisotropy) {
      this.albedoTex.anisotropy = Math.min(8, maxAnisotropy);
      this.lavaTex.anisotropy = Math.min(4, maxAnisotropy);
    }

    this.queue = [];
    this.dirtyAlbedo = false;
    this.dirtyLava = false;
    this.lastFlush = -1e9;
  }

  /* One-time procedural surface painting. fn draws the base map; the lava map
   * is reset to black. Uploads immediately. */
  paintBase(fn) {
    fn(this.actx, this.w, this.h);
    this.lvctx.fillStyle = '#000';
    this.lvctx.fillRect(0, 0, this.w, this.h);
    this.dirtyAlbedo = true;
    this.dirtyLava = true;
    this.flush(performance.now(), true);
  }

  /* dir: UNIT vector in the planet's LOCAL frame (rotation-independent).
   * radiusDeg: angular radius of the scar on the sphere. */
  addImpact(dir, radiusDeg, char, lava) {
    const theta = Math.acos(Math.max(-1, Math.min(1, dir.y))); // 0=north pole
    let u = Math.atan2(dir.z, -dir.x) / (Math.PI * 2);
    u -= Math.floor(u);
    const cx = u * this.w;
    const cy = (theta / Math.PI) * this.h;

    const a = Math.max(0.5, radiusDeg) * Math.PI / 180;
    const sinT = Math.max(Math.sin(theta), 0.22);
    const rx = Math.min((a / (Math.PI * 2)) * this.w / sinT, this.w / 2);
    const ry = Math.max(2, (a / Math.PI) * this.h);

    this._push(cx, cy, rx, ry, char, lava);
    if (cx - rx < 0) this._push(cx + this.w, cy, rx, ry, char, lava);
    if (cx + rx > this.w) this._push(cx - this.w, cy, rx, ry, char, lava);
  }

  _push(cx, cy, rx, ry, char, lava) {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({ cx, cy, rx, ry, char, lava });
  }

  /* now: performance.now(); force bypasses throttling (rebuild, one-shot). */
  flush(now, force = false) {
    if (this.queue.length === 0 && !this.dirtyAlbedo && !this.dirtyLava) return;
    if (!force && now - this.lastFlush < MIN_INTERVAL) return;
    this.lastFlush = now;

    for (const s of this.queue) {
      if (s.char > 0) { this._stampAlbedo(s); this.dirtyAlbedo = true; }
      if (s.lava > 0) { this._stampLava(s); this.dirtyLava = true; }
    }
    this.queue.length = 0;

    if (this.dirtyAlbedo) { this.albedoTex.needsUpdate = true; this.dirtyAlbedo = false; }
    if (this.dirtyLava) { this.lavaTex.needsUpdate = true; this.dirtyLava = false; }
  }

  _stamp(ctx, s, stops) {
    ctx.save();
    ctx.translate(s.cx, s.cy);
    ctx.scale(Math.max(s.rx / s.ry, 0.05), 1); // latitude stretch for equirect
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.ry);
    for (const [t, c] of stops) g.addColorStop(t, c);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, s.ry, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _stampAlbedo(s) {
    this._stamp(this.actx, s, [
      [0.00, `rgba(10,6,4,${(0.95 * s.char).toFixed(3)})`],
      [0.45, `rgba(28,16,10,${(0.62 * s.char).toFixed(3)})`],
      [0.80, `rgba(46,26,14,${(0.25 * s.char).toFixed(3)})`],
      [1.00, 'rgba(46,26,14,0)']
    ]);
  }

  _stampLava(s) {
    this._stamp(this.lvctx, s, [
      [0.00, `rgba(255,236,170,${Math.min(1, s.lava).toFixed(3)})`],
      [0.22, `rgba(255,150,44,${(0.92 * s.lava).toFixed(3)})`],
      [0.55, `rgba(214,58,12,${(0.55 * s.lava).toFixed(3)})`],
      [1.00, 'rgba(120,20,4,0)']
    ]);
  }
}
