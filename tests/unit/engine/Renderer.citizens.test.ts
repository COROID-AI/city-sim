/**
 * Citizen-rendering tests for src/engine/Renderer.ts.
 *
 * Stubs ctx with all required methods + createRadialGradient. Builds
 * a world with citizens at known tiles. Calls drawCitizens; asserts
 * per-citizen method-call counts and that no hex literal appears in
 * the Renderer source.
 */

import { Renderer } from '@/engine/Renderer';
import { DEFAULT_PALETTE } from '@/engine/palette';
import { World } from '@/engine/World';
import { createCitizen, type Citizen } from '@/entities/Citizen';
import type { Citizen as CitizenType } from '@/engine/types';
import type { RendererContext } from '@/engine/Renderer';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface RendererGradientStub {
  addColorStop(offset: number, color: string): void;
}

class FakeCanvasContext implements RendererContext {
  fillCalls: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
  strokeCalls: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
  saveCount = 0;
  restoreCount = 0;
  currentFillStyle = '';
  currentStrokeStyle = '';
  currentGlobalAlpha = 1;
  private smoothing = true;
  stateStack: Array<{ fillStyle: string; strokeStyle: string; globalAlpha: number }> = [];
  radialGradientCalls: Array<{
    x0: number; y0: number; r0: number; x1: number; y1: number; r1: number;
    stops: Array<{ offset: number; color: string }>;
  }> = [];

  save(): void {
    this.saveCount++;
    this.stateStack.push({
      fillStyle: this.currentFillStyle,
      strokeStyle: this.currentStrokeStyle,
      globalAlpha: this.currentGlobalAlpha,
    });
  }
  restore(): void {
    this.restoreCount++;
    const top = this.stateStack.pop();
    if (top) {
      this.currentFillStyle = top.fillStyle;
      this.currentStrokeStyle = top.strokeStyle;
      this.currentGlobalAlpha = top.globalAlpha;
    }
  }
  translate(): void {/* noop */}
  scale(): void {/* noop */}
  clearRect(): void {/* noop */}
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillCalls.push({ x, y, w, h, style: this.currentFillStyle });
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.strokeCalls.push({ x, y, w, h, style: this.currentStrokeStyle });
  }
  beginPath(): void {/* noop */}
  rect(): void {/* noop */}
  fill(): void {/* noop */}
  stroke(): void {/* noop */}
  drawImage(): void {/* noop */}
  set fillStyle(v: string) { this.currentFillStyle = v; }
  get fillStyle(): string { return this.currentFillStyle; }
  set strokeStyle(v: string) { this.currentStrokeStyle = v; }
  get strokeStyle(): string { return this.currentStrokeStyle; }
  set globalAlpha(v: number) { this.currentGlobalAlpha = v; }
  get globalAlpha(): number { return this.currentGlobalAlpha; }
  set imageSmoothingEnabled(v: boolean) { this.smoothing = v; }
  get imageSmoothingEnabled(): boolean { return this.smoothing; }
  createRadialGradient(
    x0: number, y0: number, r0: number, x1: number, y1: number, r1: number,
  ): RendererGradientStub {
    const stops: Array<{ offset: number; color: string }> = [];
    this.radialGradientCalls.push({ x0, y0, r0, x1, y1, r1, stops });
    return { addColorStop(offset, color) { stops.push({ offset, color }); } };
  }
}

function makeWorld(citizens: Citizen[]): World {
  const w = new World({ width: 32, height: 32 });
  for (const c of citizens) w.addCitizen(c);
  return w;
}

describe('Renderer.drawCitizens', () => {
  test('renders one halo + one body + one outline per on-screen citizen (day)', () => {
    const ctx = new FakeCanvasContext();
    const c1 = createCitizen({ id: 'c1', position: { x: 5, y: 5 } });
    const c2 = createCitizen({ id: 'c2', position: { x: 6, y: 7 } });
    c2.state = 'commuting';
    const world = makeWorld([c1, c2]);
    const r = new Renderer();
    r.drawCitizens(ctx, world, { minX: 0, minY: 0, maxX: 32, maxY: 32 }, 12);
    // Body fills: 2 (one per citizen).
    const bodyFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.citizenBody);
    expect(bodyFills.length).toBe(2);
    // Outline strokes: 2.
    expect(ctx.strokeCalls.length).toBe(2);
    // Halo gradients: 2 (one per distinct (state, alpha) tuple — the
    // two citizens have different states so each gets its own).
    expect(ctx.radialGradientCalls.length).toBe(2);
    // Halo squares: 2 (one fillRect per citizen, sized 2*haloRadius).
    const haloRadius = DEFAULT_PALETTE.citizenHaloRadius;
    const haloSize = haloRadius * 2;
    const haloFills = ctx.fillCalls.filter(
      (c) => Math.abs(c.w - haloSize) < 1e-6 && Math.abs(c.h - haloSize) < 1e-6,
    );
    expect(haloFills.length).toBe(2);
  });

  test('omits the flashlight dot during the day', () => {
    const ctx = new FakeCanvasContext();
    const c = createCitizen({ id: 'c1', position: { x: 5, y: 5 } });
    const world = makeWorld([c]);
    new Renderer().drawCitizens(ctx, world, { minX: 0, minY: 0, maxX: 32, maxY: 32 }, 12);
    const flashlightFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.citizenFlashlight);
    expect(flashlightFills.length).toBe(0);
  });

  test('stamps a flashlight dot at night (hour < 6)', () => {
    const ctx = new FakeCanvasContext();
    const c = createCitizen({ id: 'c1', position: { x: 5, y: 5 } });
    const world = makeWorld([c]);
    new Renderer().drawCitizens(ctx, world, { minX: 0, minY: 0, maxX: 32, maxY: 32 }, 3);
    const flashlightFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.citizenFlashlight);
    expect(flashlightFills.length).toBe(1);
  });

  test('stamps a flashlight dot at night (hour > 20)', () => {
    const ctx = new FakeCanvasContext();
    const c = createCitizen({ id: 'c1', position: { x: 5, y: 5 } });
    const world = makeWorld([c]);
    new Renderer().drawCitizens(ctx, world, { minX: 0, minY: 0, maxX: 32, maxY: 32 }, 22);
    const flashlightFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.citizenFlashlight);
    expect(flashlightFills.length).toBe(1);
  });

  test('does NOT stamp a flashlight dot at the inclusive boundary (hour = 6)', () => {
    const ctx = new FakeCanvasContext();
    const c = createCitizen({ id: 'c1', position: { x: 5, y: 5 } });
    const world = makeWorld([c]);
    new Renderer().drawCitizens(ctx, world, { minX: 0, minY: 0, maxX: 32, maxY: 32 }, 6);
    const flashlightFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.citizenFlashlight);
    expect(flashlightFills.length).toBe(0);
  });

  test('does NOT stamp a flashlight dot at the inclusive boundary (hour = 20)', () => {
    const ctx = new FakeCanvasContext();
    const c = createCitizen({ id: 'c1', position: { x: 5, y: 5 } });
    const world = makeWorld([c]);
    new Renderer().drawCitizens(ctx, world, { minX: 0, minY: 0, maxX: 32, maxY: 32 }, 20);
    const flashlightFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.citizenFlashlight);
    expect(flashlightFills.length).toBe(0);
  });

  test('culls off-screen citizens', () => {
    const ctx = new FakeCanvasContext();
    const c1 = createCitizen({ id: 'c1', position: { x: 5, y: 5 } });
    const c2 = createCitizen({ id: 'c2', position: { x: 50, y: 50 } });
    const world = makeWorld([c1, c2]);
    new Renderer().drawCitizens(ctx, world, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 12);
    const bodyFills = ctx.fillCalls.filter((c) => c.style === DEFAULT_PALETTE.citizenBody);
    expect(bodyFills.length).toBe(1);
  });

  test('uses the activity-coloured halo for each citizen state', () => {
    const ctx = new FakeCanvasContext();
    const idle = createCitizen({ id: 'idle', position: { x: 1, y: 1 } });
    const commute = createCitizen({ id: 'commute', position: { x: 2, y: 1 } });
    commute.state = 'commuting';
    const work = createCitizen({ id: 'work', position: { x: 3, y: 1 } });
    work.state = 'working';
    const shop = createCitizen({ id: 'shop', position: { x: 4, y: 1 } });
    shop.state = 'shopping';
    const leis = createCitizen({ id: 'leis', position: { x: 5, y: 1 } });
    leis.state = 'leisure';
    const rest = createCitizen({ id: 'rest', position: { x: 6, y: 1 } });
    rest.state = 'resting';
    const world = makeWorld([idle, commute, work, shop, leis, rest]);
    new Renderer().drawCitizens(ctx, world, { minX: 0, minY: 0, maxX: 32, maxY: 32 }, 12);
    // Each halo colour should appear in at least one gradient stop.
    const allStops = ctx.radialGradientCalls.flatMap((g) => g.stops.map((s) => s.color));
    expect(allStops.some((s) => s.startsWith('rgba') || s === DEFAULT_PALETTE.citizenHaloIdle)).toBe(true);
    // The 5 distinct state colours (plus idle) should each show up
    // as the first stop of at least one gradient.
    const uniqueFirstStops = new Set(
      ctx.radialGradientCalls.map((g) => g.stops[0]?.color ?? ''),
    );
    expect(uniqueFirstStops.size).toBeGreaterThanOrEqual(5);
  });

  test('Renderer source contains no hex color literals', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'engine', 'Renderer.ts'),
      'utf8',
    );
    // Look for any `#[0-9a-fA-F]{3,8}` literal — must not exist in
    // the renderer source. All colors flow through the palette.
    const matches = src.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(matches ?? []).toEqual([]);
  });
});
