/**
 * frame.js — draw orchestration.
 *
 * Each frame: clear to the ambient background, apply the camera transform,
 * draw the pre-rendered static day layer (crop to the visible world region),
 * draw the night glow layer at dusk/night, invoke the pluggable dynamic sprite
 * hook (citizens), then the dedicated vehicle layer (after buildings/citizens
 * so traffic is never hidden), then restore and apply the ambient lighting
 * tint across the whole screen (the final composite).
 */

import { CONFIG } from '../core/config.js';
import { Lighting, backgroundAt } from './dayNight.js';

export class FrameRenderer {
  constructor({ camera, world, staticLayer, nightLayer, config = CONFIG }) {
    this.camera = camera;
    this.world = world;
    this.config = config;
    this.staticLayer = staticLayer;
    this.nightLayer = nightLayer;
    this.worldPx = world.gridSize * world.tileSize;
    this.lighting = new Lighting({ simHour: 6, simDay: 1, dayPhase: 0.25 });
    this._dynamic = null;
    this._vehiclesDraw = null;
  }

  /**
   * Set the pluggable dynamic sprite callback. Phase 2 tasks fill this in to
   * draw citizens and vehicles. Signature: (ctx, camera, world, simTime).
   * @param {(ctx: CanvasRenderingContext2D, camera: object, world: object,
   *            simTime: object) => void} fn
   */
  setDynamicDraw(fn) {
    this._dynamic = fn || null;
  }

  /**
   * Set the dedicated vehicle layer callback, invoked inside the world
   * transform after citizens so vehicles are never hidden behind buildings.
   * Signature: (ctx, simTime).
   * @param {(ctx: CanvasRenderingContext2D,
   *            simTime: object) => void} fn
   */
  setVehiclesDraw(fn) {
    this._vehiclesDraw = fn || null;
  }

  /**
   * Render one frame.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width  Viewport width in CSS px.
   * @param {number} height Viewport height in CSS px.
   * @param {{simHour:number,simDay:number,dayPhase:number}} simTime
   */
  render(ctx, width, height, simTime) {
    this.lighting.update(simTime);
    this.camera.viewportWidth = width;
    this.camera.viewportHeight = height;

    // Clear to the ambient background so areas beyond the world read as sky.
    const bg = backgroundAt(simTime);
    ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
    ctx.fillRect(0, 0, width, height);

    const zoom = this.camera.zoom;
    const vw = width / zoom;
    const vh = height / zoom;
    const vx = this.camera.x - vw / 2;
    const vy = this.camera.y - vh / 2;

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // Static day layer (cropped to the visible region for per-frame speed).
    this._drawLayer(ctx, this.staticLayer, vx, vy, vw, vh);

    // Night glows at dusk and night.
    if (this.lighting.factor < 0.72 && this.nightLayer) {
      this._drawLayer(ctx, this.nightLayer, vx, vy, vw, vh);
    }

    // Pluggable dynamic sprites (citizens).
    if (this._dynamic) {
      this._dynamic(ctx, this.camera, this.world, simTime);
    }

    // Dedicated vehicle layer after buildings + citizens (culling handled by
    // the entity draw implementation via the camera viewport).
    if (this._vehiclesDraw) {
      this._vehiclesDraw(ctx, simTime);
    }

    ctx.restore();

    // Ambient lighting tint across the whole screen.
    this.lighting.apply(ctx, width, height);
  }

  /** Draw only the visible slice of a pre-rendered world-aligned layer. */
  _drawLayer(ctx, layer, vx, vy, vw, vh) {
    const wp = this.worldPx;
    const sx = Math.max(0, vx);
    const sy = Math.max(0, vy);
    const ex = Math.min(wp, vx + vw);
    const ey = Math.min(wp, vy + vh);
    const sw = ex - sx;
    const sh = ey - sy;
    if (sw <= 0 || sh <= 0) return;
    // Source and destination are the same world rect; the active camera
    // transform maps the destination into screen space.
    ctx.drawImage(layer, sx, sy, sw, sh, sx, sy, sw, sh);
  }
}