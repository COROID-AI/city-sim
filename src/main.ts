import "./styles.css";

import { createSfxEngine, type SfxEngine } from "./audio/sfx";
import { FixedStepLoop } from "./core/loop";
import {
  MAX_PIXEL_RATIO,
  createCityView,
  normalizeViewport,
  type CityView,
  type Viewport,
} from "./core/renderer";
import {
  createChronoCityScene,
  mountChronoCityUi,
  type ChronoCityScene,
  type ChronoCityUi,
} from "./scene/scene";

/**
 * Application entry point (loaded by `index.html` as a module).
 *
 * The shell is resolved here, the WebGL view is created here, and then the real
 * work is delegated to the composition root in `./scene/scene`: the block, its
 * systems, the transition driver, the post-processing pipeline, the navigation
 * rig and the timeline/HUD are all assembled there. This file only owns the
 * lifecycle - resolve, boot, resize, tear down - and the loading overlay.
 */

/** Ids of the shell roots owned by `index.html`. */
export const SHELL_SELECTORS = {
  canvas: "#city-canvas",
  timeline: "#timeline-root",
  hud: "#hud-root",
  loading: "#loading-root",
} as const;

/** Status node inside the loading root. */
export const LOADING_STATUS_SELECTOR = "[data-role='loading-status']";

export type LoadingState = "loading" | "ready" | "error";

export interface ShellRoots {
  readonly canvas: HTMLCanvasElement;
  readonly timelineRoot: HTMLElement;
  readonly hudRoot: HTMLElement;
  readonly loadingRoot: HTMLElement;
}

export interface ChronoCityApp {
  /** Shared fixed-step loop; the composed scene updates and renders in here. */
  readonly loop: FixedStepLoop;
  /** WebGL view, or `null` when the browser refused a WebGL context. */
  readonly view: CityView | null;
  /** Composed block, or `null` on the WebGL failure path. */
  readonly scene: ChronoCityScene | null;
  /** Mounted timeline + HUD, or `null` on the WebGL failure path. */
  readonly ui: ChronoCityUi | null;
  /** Audio engine owned by the app, or `null` on the WebGL failure path. */
  readonly sfx: SfxEngine | null;
  /** Stops the loop, drops listeners and releases GPU resources. */
  destroy(): void;
}

declare global {
  interface Window {
    /** Debug/verification handle published by the entry point. */
    __chronoCity?: ChronoCityApp;
  }
}

/** Resolves the required shell roots, or throws when the shell is incomplete. */
export function resolveShellRoots(root: ParentNode = document): ShellRoots {
  const canvas = root.querySelector(SHELL_SELECTORS.canvas);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`Chrono City shell is missing the WebGL canvas (${SHELL_SELECTORS.canvas}).`);
  }

  return {
    canvas,
    timelineRoot: requireElement(root, SHELL_SELECTORS.timeline),
    hudRoot: requireElement(root, SHELL_SELECTORS.hud),
    loadingRoot: requireElement(root, SHELL_SELECTORS.loading),
  };
}

/** Reads the current window size as a renderable viewport. */
export function readViewport(): Viewport {
  return normalizeViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio, MAX_PIXEL_RATIO);
}

/**
 * Boots Chrono City into `root`: builds the view, composes the block, mounts the
 * timeline and HUD, starts the render loop and reports readiness (or a WebGL
 * failure) through the loading root.
 */
export function bootstrap(root: ParentNode = document): ChronoCityApp {
  const roots = resolveShellRoots(root);
  const statusNode = roots.loadingRoot.querySelector<HTMLElement>(LOADING_STATUS_SELECTOR);

  const setStatus = (message: string, state: LoadingState): void => {
    roots.loadingRoot.dataset.state = state;
    roots.loadingRoot.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    roots.loadingRoot.hidden = state === "ready";
    if (statusNode) {
      statusNode.textContent = message;
    }
  };

  let view: CityView | null = null;
  let scene: ChronoCityScene | null = null;
  let ui: ChronoCityUi | null = null;
  let sfx: SfxEngine | null = null;
  let ready = false;
  let detachResize: () => void = () => {};

  try {
    const activeView = createCityView({ canvas: roots.canvas, viewport: readViewport() });
    view = activeView;

    // Keyboard navigation and camera hotkeys need a focusable surface.
    if (roots.canvas.tabIndex < 0) {
      roots.canvas.tabIndex = 0;
    }

    const engine = createSfxEngine();
    sfx = engine;

    const activeScene = createChronoCityScene({
      renderer: activeView.renderer,
      scene: activeView.scene,
      camera: activeView.camera,
      viewport: activeView.viewport,
      element: roots.canvas,
      sfx: engine,
    });
    scene = activeScene;

    ui = mountChronoCityUi(activeScene, {
      timeline: roots.timelineRoot,
      hud: roots.hudRoot,
    });

    const handleResize = (): void => {
      const viewport = readViewport();
      activeView.resize(viewport);
      activeScene.resize(viewport);
    };
    window.addEventListener("resize", handleResize);
    detachResize = () => window.removeEventListener("resize", handleResize);

    const loop = new FixedStepLoop({
      hooks: {
        // One fixed simulation step: the transition driver, every scene system
        // and the camera rig advance together.
        update: (delta) => activeScene.update(delta),
        // One draw per frame, through the cinematic post-processing chain.
        render: () => {
          activeScene.render();
          if (!ready) {
            ready = true;
            setStatus("Ready", "ready");
          }
        },
      },
    });

    loop.start();
    return {
      loop,
      view,
      scene,
      ui,
      sfx,
      destroy() {
        loop.stop();
        detachResize();
        ui?.dispose();
        activeScene.dispose();
        engine.dispose();
        activeView.dispose();
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    setStatus(`Chrono City needs WebGL 2 to render the city block (${reason})`, "error");
    console.error("[chrono-city] WebGL initialisation failed", error);
    // Keep the app handle shape intact so callers can still tear down uniformly.
    const idleLoop = new FixedStepLoop({ hooks: { update: () => {}, render: () => {} } });
    return {
      loop: idleLoop,
      view: null,
      scene: null,
      ui: null,
      sfx: null,
      destroy() {
        idleLoop.stop();
        detachResize();
      },
    };
  }
}

function requireElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Chrono City shell is missing ${selector}.`);
  }
  return element;
}

// `index.html` loads this module as the app entry: boot as soon as the shell is
// present. Guarded so importing the module (unit tests, tooling) stays inert.
if (typeof document !== "undefined" && document.querySelector(SHELL_SELECTORS.canvas)) {
  const app = bootstrap(document);
  if (typeof window !== "undefined") {
    // Published for browser probes and manual inspection; harmless otherwise.
    window.__chronoCity = app;
  }
}
