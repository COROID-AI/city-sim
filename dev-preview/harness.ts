/**
 * Shared dev-preview harness.
 *
 * Every preview page (the boot scene today, the lane comets, verification gates
 * and quality constellation later) mounts through this module so they all get
 * identical behaviour:
 *
 *  - one full-viewport canvas inside the host container;
 *  - a render adapter chosen by preference, with an automatic headless fallback
 *    so previews still boot on machines without WebGL (CI, containers);
 *  - a game wired to the system registry and a deterministic sample state;
 *  - resize wiring (window `resize` plus `ResizeObserver` when available);
 *  - a small monochrome HUD describing the live run, and clean teardown that
 *    disposes the game, the listeners and the DOM it created.
 */

import { createGame, type Game, type GameFrame } from '../src/game/Game';
import { systems as defaultSystems, type GameSystem } from '../src/game/systems';
import { createHeadlessAdapter } from '../src/render/headless';
import { createRenderAdapter, type RenderAdapter } from '../src/render/renderer';
import { createSampleState } from '../src/sim/fixtures';
import type { GameState } from '../src/sim/state';

export type PreviewAdapterPreference = 'auto' | 'webgl' | 'headless';

/** Small text HUD owned by the harness. */
export interface PreviewOverlayHandle {
  readonly element: HTMLElement;
  setStatus(text: string, kind?: 'info' | 'warn'): void;
  setLines(lines: readonly string[]): void;
  dispose(): void;
}

export interface PreviewHarnessOptions {
  /** Host element the canvas and HUD are mounted into. */
  container: HTMLElement;
  /** Adapter preference. `auto` prefers WebGL and falls back to headless. */
  adapter?: PreviewAdapterPreference;
  /** Systems to compose. Defaults to the live registry in `game/systems.ts`. */
  systems?: readonly GameSystem[];
  /** Starting state. Defaults to `createSampleState({ seed })`. */
  state?: GameState;
  /** Seed for the deterministic run. */
  seed?: number;
  /** Fixed simulation step in milliseconds. */
  stepMs?: number;
  /** Render the stats HUD. Defaults to `true`. */
  overlay?: boolean;
  /** Begin real-time playback immediately. Defaults to `true`. */
  autoStart?: boolean;
  /** Presentation-only draw hook, called once per rendered frame. */
  onFrame?(frame: GameFrame): void;
}

export interface PreviewHarness {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly adapter: RenderAdapter;
  readonly game: Game;
  readonly overlay: PreviewOverlayHandle | null;
  /** True when WebGL was unavailable and the headless adapter was used instead. */
  readonly usedHeadlessFallback: boolean;
  readonly disposed: boolean;
  /** Size the canvas/adapter to the current container box. */
  fit(): { width: number; height: number };
  start(): void;
  stop(): void;
  dispose(): void;
}

const CANVAS_SELECTOR = 'canvas[data-coroid-canvas]';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

function resolveSize(container: HTMLElement): { width: number; height: number } {
  const width =
    container.clientWidth ||
    (typeof window !== 'undefined' ? window.innerWidth : 0) ||
    DEFAULT_WIDTH;
  const height =
    container.clientHeight ||
    (typeof window !== 'undefined' ? window.innerHeight : 0) ||
    DEFAULT_HEIGHT;
  return { width, height };
}

/** Build the HUD element used by every preview page. */
export function createPreviewOverlay(container: HTMLElement): PreviewOverlayHandle {
  const element = document.createElement('div');
  element.className = 'preview-overlay';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');

  const status = document.createElement('div');
  status.className = 'preview-overlay__status';
  status.dataset.kind = 'info';
  const body = document.createElement('div');
  body.className = 'preview-overlay__lines';

  element.append(status, body);
  container.append(element);

  return {
    element,
    setStatus(text: string, kind: 'info' | 'warn' = 'info'): void {
      status.textContent = text;
      status.dataset.kind = kind;
    },
    setLines(lines: readonly string[]): void {
      body.textContent = lines.join('\n');
    },
    dispose(): void {
      element.remove();
    },
  };
}

/**
 * Mount a preview run into `container`.
 *
 * The returned harness is the only owner of the canvas, adapter, game and HUD:
 * `dispose()` releases all of them and is idempotent.
 */
export function mountGamePreview(options: PreviewHarnessOptions): PreviewHarness {
  if (typeof document === 'undefined') {
    throw new Error('[coroid] mountGamePreview requires a DOM; use createGame + createHeadlessAdapter in Node');
  }

  const container = options.container;
  const preference = options.adapter ?? 'auto';
  const size = resolveSize(container);

  const existing = container.querySelector<HTMLCanvasElement>(CANVAS_SELECTOR);
  const canvas = existing ?? document.createElement('canvas');
  if (!existing) {
    canvas.className = 'boot-canvas';
    canvas.dataset.coroidCanvas = 'true';
    canvas.setAttribute('aria-label', 'Coroid holographic factory floor');
    container.append(canvas);
  }

  let usedHeadlessFallback = false;
  let adapter: RenderAdapter;
  if (preference === 'headless') {
    adapter = createHeadlessAdapter({ width: size.width, height: size.height });
  } else {
    try {
      adapter = createRenderAdapter({
        canvas,
        width: size.width,
        height: size.height,
        antialias: true,
      });
    } catch (error) {
      if (preference === 'webgl') throw error;
      usedHeadlessFallback = true;
      console.warn('[coroid] WebGL unavailable, running the headless render adapter', error);
      adapter = createHeadlessAdapter({ width: size.width, height: size.height });
    }
  }

  let overlay: PreviewOverlayHandle | null = null;
  if (options.overlay !== false) {
    overlay = createPreviewOverlay(container);
  }

  let disposed = false;
  const state = options.state ?? createSampleState({ seed: options.seed });
  const seed = options.seed ?? state.seed;
  const systems = options.systems ?? defaultSystems;

  const game = createGame({
    adapter,
    systems,
    state,
    seed,
    stepMs: options.stepMs,
    onFrame: (frame) => {
      if (overlay && (frame.frame === 1 || frame.frame % 12 === 0)) {
        overlay.setLines(describeRun(game, frame));
      }
      options.onFrame?.(frame);
    },
  });

  const fit = (): { width: number; height: number } => {
    const next = resolveSize(container);
    adapter.resize(next.width, next.height);
    return next;
  };

  const onWindowResize = (): void => {
    fit();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }
  const observer =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          fit();
        })
      : null;
  observer?.observe(container);

  // Apply the initial framing immediately: the boot scene's first update draws
  // the camera where the layout expects it.
  fit();

  if (overlay) {
    overlay.setStatus(
      usedHeadlessFallback
        ? 'headless render adapter (WebGL unavailable)'
        : `${adapter.kind} render adapter online`,
      usedHeadlessFallback ? 'warn' : 'info',
    );
    overlay.setLines(['COROID // holographic factory', 'waiting for first frame…']);
  }

  if (options.autoStart !== false) {
    game.start();
  }

  return {
    container,
    canvas,
    adapter,
    game,
    overlay,
    usedHeadlessFallback,
    get disposed() {
      return disposed;
    },
    fit,
    start(): void {
      if (disposed) return;
      game.start();
    },
    stop(): void {
      game.stop();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      game.dispose();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onWindowResize);
      }
      observer?.disconnect();
      overlay?.dispose();
      canvas.remove();
    },
  };
}

/** Human-readable HUD lines for the current run. */
function describeRun(game: Game, frame: GameFrame): string[] {
  const state = game.state;
  const stats = game.stats;
  const seconds = frame.elapsedMs / 1000;
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  const activeLanes = Object.values(state.lanes.lanes).filter(
    (lane) => lane.activeTaskId !== null,
  ).length;
  const gates = Object.values(state.verification.gates);

  return [
    `COROID // ${state.mission.codename}`,
    `mission  ${state.mission.status}   ${(state.mission.progress * 100).toFixed(0).padStart(3)}%   t+${mm}:${ss}`,
    `lanes    ${activeLanes}/${state.lanes.order.length} active`,
    `gates    ${gates.filter((gate) => gate.status === 'passed').length}/${gates.length} passed`,
    `quality  ${state.quality.score.toFixed(2)}   findings ${state.quality.findings.length}`,
    `credits  ${Math.round(state.economy.credits)}   ctx ${Math.round(state.economy.contextSpent / 1000)}k/${Math.round(state.economy.contextBudget / 1000)}k   rep ${Math.round(state.economy.reputation)}`,
    `frame    ${frame.frame}   steps ${stats.steps}   systems ${frame.systems}`,
  ];
}
