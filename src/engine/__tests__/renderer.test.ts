/// <reference types="jest" />
import {
  PALETTE_FALLBACK,
  Renderer,
  buildingDepthKey,
  resolvePaletteColor,
  sortBuildingsForDraw,
  type RenderFrame,
  type RendererCanvas,
  type RendererContext2D,
} from '../index';
import { generateCity, type Building, type GeneratedCity } from '@/generation';
import { Camera, DEFAULT_CAMERA_CONFIG } from '../Camera';
import type { Lighting } from '@/systems';

function buildCity(seed: number): GeneratedCity {
  return generateCity({ seed, width: 32, height: 32 });
}

function makeFrame(city: GeneratedCity, w = 256, h = 256): RenderFrame {
  return {
    city,
    camera: makeCenteredCamera(city),
    viewWidth: w,
    viewHeight: h,
    cellSize: 16,
    paletteOverrides: { ...PALETTE_FALLBACK },
  };
}

function makeCenteredCamera(city: GeneratedCity): Camera {
  return new Camera({
    ...DEFAULT_CAMERA_CONFIG,
    minX: -Infinity,
    maxX: Infinity,
    minY: -Infinity,
    maxY: Infinity,
    initial: { x: city.width / 2, y: city.height / 2, zoom: 1 },
  });
}

function makeNoopContext(): RendererContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    fillRect: (): void => undefined,
    beginPath: (): void => undefined,
    moveTo: (): void => undefined,
    lineTo: (): void => undefined,
    stroke: (): void => undefined,
    save: (): void => undefined,
    restore: (): void => undefined,
  };
}

function makeCanvas(ctx: RendererContext2D, w = 256, h = 256): RendererCanvas {
  return {
    width: w,
    height: h,
    getContext: (k: '2d'): RendererContext2D | null => (k === '2d' ? ctx : null),
  };
}

function makeRecordingContext(): { ctx: RendererContext2D; calls: Array<{ x: number; y: number; w: number; h: number; fillStyle: string; layer: string }> } {
  const calls: Array<{ x: number; y: number; w: number; h: number; fillStyle: string; layer: string }> = [];
  const styleToLayer: Record<string, string> = {
    [PALETTE_FALLBACK.surface]: 'surface-fill',
    [PALETTE_FALLBACK.ground]: 'ground-tile',
    [PALETTE_FALLBACK.road]: 'road-tile',
    [PALETTE_FALLBACK.accent]: 'road-stripe',
    [PALETTE_FALLBACK.building]: 'building',
    [PALETTE_FALLBACK.warning]: 'building',
    [PALETTE_FALLBACK.citizen]: 'building',
  };
  const ctx: RendererContext2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: (x: number, y: number, w: number, h: number): void => {
      const style = String(ctx.fillStyle);
      const layer = styleToLayer[style] ?? 'lighting';
      calls.push({ x, y, w, h, fillStyle: style, layer });
    },
    beginPath: (): void => undefined,
    moveTo: (): void => undefined,
    lineTo: (): void => undefined,
    stroke: (): void => undefined,
    save: (): void => undefined,
    restore: (): void => undefined,
  };
  return { ctx, calls };
}

function makeAlphaRecordingContext(): RendererContext2D {
  const fillCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
  let styleChanges = 0;
  let ga = 1;
  let fs = '';
  const stack: number[] = [];
  const ctxObj = {
    strokeStyle: '',
    lineWidth: 1,
    get globalAlpha(): number { return ga; },
    set globalAlpha(v: number) { ga = v; },
    get fillStyle(): string { return fs; },
    set fillStyle(v: string) { fs = v; styleChanges++; },
    get fillCalls(): Array<{ x: number; y: number; w: number; h: number }> { return fillCalls; },
    get styleChanges(): number { return styleChanges; },
    fillRect: (x: number, y: number, w: number, h: number): void => { fillCalls.push({ x, y, w, h }); },
    beginPath: (): void => undefined,
    moveTo: (): void => undefined,
    lineTo: (): void => undefined,
    stroke: (): void => undefined,
    save: (): void => { stack.push(ga); },
    restore: (): void => { const v = stack.pop(); if (v !== undefined) ga = v; },
  };
  return ctxObj as unknown as RendererContext2D;
}

describe('Renderer.drawLightingOverlay', () => {
  test('is a no-op when frame.lighting is undefined', () => {
    const city = buildCity(11);
    const renderer = new Renderer(null);
    const ctx = makeAlphaRecordingContext();
    renderer.drawLightingOverlay(ctx, makeFrame(city));
    expect(ctx.fillCalls).toHaveLength(0);
    expect(ctx.globalAlpha).toBe(1);
  });

  test('skips fill when phaseAlpha is 0', () => {
    const city = buildCity(12);
    const renderer = new Renderer(null);
    const ctx = makeAlphaRecordingContext();
    const lighting: Lighting = {
      phase: 'day',
      phaseColor: { r: 1, g: 1, b: 1 },
      nextColor: { r: 1, g: 1, b: 1 },
      phaseAlpha: 0,
      overlayAlpha: 0,
      blended: { r: 1, g: 1, b: 1 },
    };
    renderer.drawLightingOverlay(ctx, { ...makeFrame(city), lighting });
    expect(ctx.fillCalls).toHaveLength(0);
    expect(ctx.globalAlpha).toBe(1);
  });

  test('paints a full-viewport tint with globalAlpha = phaseAlpha', () => {
    const city = buildCity(13);
    const renderer = new Renderer(null);
    const ctx = makeAlphaRecordingContext();
    const lighting: Lighting = {
      phase: 'dusk',
      phaseColor: { r: 1, g: 0.62, b: 0.42 },
      nextColor: { r: 0.12, g: 0.16, b: 0.32 },
      phaseAlpha: 0.5,
      overlayAlpha: 0.5,
      blended: { r: 0.56, g: 0.39, b: 0.37 },
    };
    const frame: RenderFrame = { ...makeFrame(city, 320, 200), lighting };
    renderer.drawLightingOverlay(ctx, frame);
    expect(ctx.fillCalls).toHaveLength(1);
    const call = ctx.fillCalls[0]!;
    expect(call.x).toBe(0);
    expect(call.y).toBe(0);
    expect(call.w).toBe(320);
    expect(call.h).toBe(200);
    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.fillStyle).toBe('rgb(143, 99, 94)');
  });

  test('uses phaseAlpha for the fill and a stable post-call globalAlpha', () => {
    const city = buildCity(14);
    const renderer = new Renderer(null);
    const ctx = makeAlphaRecordingContext();
    const lighting: Lighting = {
      phase: 'night',
      phaseColor: { r: 0.12, g: 0.16, b: 0.32 },
      nextColor: { r: 0.12, g: 0.16, b: 0.32 },
      phaseAlpha: 0.8,
      overlayAlpha: 0.8,
      blended: { r: 0.12, g: 0.16, b: 0.32 },
    };
    renderer.drawLightingOverlay(ctx, { ...makeFrame(city), lighting });
    // The overlay paints with phaseAlpha as globalAlpha and leaves
    // globalAlpha at phaseAlpha after the call (the caller is
    // responsible for resetting it between layers; the renderer does
    // not silently mutate the caller's alpha state on the no-op path).
    expect(ctx.globalAlpha).toBe(0.8);
    expect(ctx.fillCalls).toHaveLength(1);
  });
});

describe('Renderer.render (smoke)', () => {
  test('renders without throwing for a small city', () => {
    const city = buildCity(20);
    const renderer = new Renderer(null);
    const ctx = makeNoopContext();
    expect((): void => renderer.render(makeCanvas(ctx), makeFrame(city))).not.toThrow();
  });

  test('produces deterministic call sequences for identical input', () => {
    const city = buildCity(21);
    const a = makeRecordingContext();
    const b = makeRecordingContext();
    const r1 = new Renderer(null);
    const r2 = new Renderer(null);
    r1.render(makeCanvas(a.ctx), makeFrame(city));
    r2.render(makeCanvas(b.ctx), makeFrame(city));
    expect(a.calls).toEqual(b.calls);
  });
});

describe('Renderer helpers', () => {
  test('buildingDepthKey is deterministic', () => {
    const city = buildCity(30);
    const b: Building = city.buildings[0]!;
    const k1 = buildingDepthKey(b, 0);
    const k2 = buildingDepthKey(b, 0);
    expect(k1.key).toBe(k2.key);
    expect(k1.index).toBe(0);
  });

  test('sortBuildingsForDraw returns back-to-front order', () => {
    const city = buildCity(31);
    const sorted = sortBuildingsForDraw(city);
    // Check that the sort key is monotonically non-decreasing.
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.key).toBeGreaterThanOrEqual(sorted[i - 1]!.key);
    }
  });

  test('resolvePaletteColor returns the override when set', () => {
    expect(resolvePaletteColor('ground', { override: '#abcdef' })).toBe('#abcdef');
  });
});
