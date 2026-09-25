import "./styles.css";

import { FixedStepLoop } from "./core/loop";
import {
  MAX_PIXEL_RATIO,
  createCityView,
  normalizeViewport,
  type CityView,
  type Viewport,
} from "./core/renderer";

/**
 * Application entry point (loaded by `index.html` as a module).
 *
 * Deliberately thin: resolve the shell roots declared in `index.html`, build
 * the WebGL view, wire it to the shared fixed-step loop and resize handling, and
 * drive the loading overlay. Scene composition, navigation and UI systems are
 * layered on top without restructuring this file.
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
  /** Shared fixed-step loop; later systems hook their updates in here. */
  readonly loop: FixedStepLoop;
  /** WebGL view, or `null` when the browser refused a WebGL context. */
  readonly view: CityView | null;
  /** Stops the loop, drops listeners and releases GPU resources. */
  destroy(): void;
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
 * Boots Chrono City into `root`: builds the view, starts the render loop and
 * reports readiness (or a WebGL failure) through the loading root.
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
  let ready = false;
  let detachResize: () => void = () => {};

  try {
    const activeView = createCityView({ canvas: roots.canvas, viewport: readViewport() });
    view = activeView;

    const handleResize = (): void => {
      activeView.resize(readViewport());
    };
    window.addEventListener("resize", handleResize);
    detachResize = () => window.removeEventListener("resize", handleResize);

    const loop = new FixedStepLoop({
      hooks: {
        update: (delta) => activeView.update(delta),
        render: () => {
          activeView.render();
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
      destroy() {
        loop.stop();
        detachResize();
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
  bootstrap(document);
}
