/**
 * Boot entry point for the browser build.
 *
 * Importing this module starts the city simulation immediately (no start
 * button, no user interaction): it creates the `SimClock` and
 * `SimulationEngine`, then drives them from a `requestAnimationFrame` render
 * loop. Later tasks replace the placeholder debug drawing with the real city
 * renderer while keeping this self-starting contract.
 */

import './style.css';

import { SimClock } from './sim/clock';
import { SimulationEngine } from './sim/engine';
import type { DayPhase } from './sim/types';

/** Hour a fresh city starts at, so the first minutes already show daylight. */
export const DEFAULT_START_HOUR = 6;

const FALLBACK_VIEWPORT_WIDTH = 1280;
const FALLBACK_VIEWPORT_HEIGHT = 720;
/** Largest real-time slice fed to the engine, so tab switches do not burst. */
const MAX_FRAME_DELTA_MS = 250;
const FALLBACK_FRAME_MS = 16;

/** Sky colours per day/night phase: [zenith, horizon]. */
const PHASE_SKY: Record<DayPhase, readonly [string, string]> = {
  night: ['#05070f', '#141d38'],
  dawn: ['#1b2145', '#8a5570'],
  morning: ['#4d86bd', '#c7ddec'],
  day: ['#3f83cd', '#d3e8f6'],
  evening: ['#252a54', '#d2714f'],
};

export interface BootOptions {
  /** Document used to resolve/create the canvas. Defaults to the global one. */
  document?: Document;
  /** Canvas to render into. Defaults to `#city-canvas`, then a fresh canvas. */
  canvas?: HTMLCanvasElement | null;
  /** Sim speed multiplier (1 = one sim-minute per real second, one day in 24 min). */
  speed?: number;
  /** Set to false to create the engine without starting the render loop. */
  autoStart?: boolean;
}

/** Live handle to the running simulation, also exposed as `window.__citySim`. */
export interface CitySimHandle {
  readonly engine: SimulationEngine;
  readonly clock: SimClock;
  readonly canvas: HTMLCanvasElement;
  /** Frames drawn since boot. */
  readonly frames: number;
  /** Stops the render loop and disposes the engine. Idempotent. */
  stop(): void;
}

declare global {
  interface Window {
    /** Set while the simulation is running; handy for smoke checks in devtools. */
    __citySim?: CitySimHandle;
  }
}

let activeHandle: CitySimHandle | null = null;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function requestFrame(callback: (timestamp: number) => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(nowMs()), FALLBACK_FRAME_MS) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

function resolveCanvas(targetDocument: Document, provided: HTMLCanvasElement | null): HTMLCanvasElement {
  if (provided) {
    return provided;
  }
  const existing = targetDocument.getElementById('city-canvas');
  if (existing && existing.tagName === 'CANVAS') {
    return existing as HTMLCanvasElement;
  }
  const canvas = targetDocument.createElement('canvas');
  canvas.id = 'city-canvas';
  const host = targetDocument.getElementById('app') ?? targetDocument.body;
  host.appendChild(canvas);
  return canvas;
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const viewportWidth =
    typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : FALLBACK_VIEWPORT_WIDTH;
  const viewportHeight =
    typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : FALLBACK_VIEWPORT_HEIGHT;
  const ratio =
    typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  const pixelWidth = Math.max(320, Math.floor(viewportWidth * ratio));
  const pixelHeight = Math.max(240, Math.floor(viewportHeight * ratio));
  if (canvas.width !== pixelWidth) {
    canvas.width = pixelWidth;
  }
  if (canvas.height !== pixelHeight) {
    canvas.height = pixelHeight;
  }
}

/** Placeholder debug frame: phase sky, a travelling sun/moon and the sim clock. */
function drawFrame(
  context: CanvasRenderingContext2D | null,
  canvas: HTMLCanvasElement,
  clock: SimClock,
  engine: SimulationEngine,
): void {
  resizeCanvas(canvas);
  if (!context) {
    return;
  }
  const width = canvas.width;
  const height = canvas.height;
  const [zenith, horizon] = PHASE_SKY[clock.phase];

  context.save();
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, zenith);
  sky.addColorStop(1, horizon);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const groundTop = height * 0.74;
  context.fillStyle = 'rgba(8, 12, 22, 0.62)';
  context.fillRect(0, groundTop, width, height - groundTop);

  context.beginPath();
  context.arc(width * clock.dayProgress, groundTop * 0.55, 14, 0, Math.PI * 2);
  context.fillStyle = clock.phase === 'night' ? '#e8eefb' : '#ffd479';
  context.fill();

  context.font = '600 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillStyle = '#ffffff';
  context.fillText(`${clock.formatDayTime()}  ·  ${clock.phase}`, 16, 16);
  context.fillStyle = 'rgba(255, 255, 255, 0.72)';
  context.fillText(`tick ${engine.tickCount}  ·  speed x${engine.speed}`, 16, 36);
  context.restore();
}

/**
 * Creates the engine and (by default) starts the render loop right away.
 * Throws when no Document is available, so headless callers must pass one.
 */
export function bootCitySim(options: BootOptions = {}): CitySimHandle {
  const targetDocument =
    options.document ?? (typeof document === 'undefined' ? undefined : document);
  if (!targetDocument) {
    throw new Error('bootCitySim() needs a Document; pass options.document outside a browser.');
  }

  const canvas = resolveCanvas(targetDocument, options.canvas ?? null);
  const context = get2dContext(canvas);
  const clock = new SimClock({ startHour: DEFAULT_START_HOUR });
  const engine = new SimulationEngine({
    clock,
    minutesPerTick: 1,
    ticksPerSecond: 60,
    speed: options.speed ?? 1,
  });

  let frameHandle: number | null = null;
  let lastTimestamp: number | null = null;
  let frameCount = 0;
  let stopped = false;

  const frame = (timestamp: number): void => {
    if (stopped) {
      return;
    }
    const delta =
      lastTimestamp === null ? 0 : Math.min(MAX_FRAME_DELTA_MS, Math.max(0, timestamp - lastTimestamp));
    lastTimestamp = timestamp;
    engine.update(delta);
    drawFrame(context, canvas, clock, engine);
    frameCount += 1;
    frameHandle = requestFrame(frame);
  };

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    engine.dispose();
    if (activeHandle === handle) {
      activeHandle = null;
    }
    if (typeof window !== 'undefined' && window.__citySim === handle) {
      delete window.__citySim;
    }
  };

  const handle: CitySimHandle = {
    engine,
    clock,
    canvas,
    get frames() {
      return frameCount;
    },
    stop,
  };

  activeHandle = handle;
  if (options.autoStart !== false) {
    frameHandle = requestFrame(frame);
  }
  return handle;
}

/** Stops the handle created by the module-level auto boot, when there is one. */
export function stopCitySimulation(): void {
  activeHandle?.stop();
}

// Auto boot: loading the page is all it takes to start the simulation.
if (typeof document !== 'undefined') {
  const handle = bootCitySim({ document });
  if (typeof window !== 'undefined') {
    window.__citySim = handle;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeHandle?.stop();
  });
}
