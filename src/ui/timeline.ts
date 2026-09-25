/**
 * Chrono City top timeline slider.
 *
 * A dependency-free DOM module: it renders the five-stop timelapse transport
 * (1945 / 1965 / 1985 / 2005 / 2025) into the `#timeline-root` overlay declared
 * by `index.html`, and communicates with the rest of the app *exclusively*
 * through callbacks. No scene, audio or three.js import ever reaches this file,
 * so it stays mountable in jsdom and cannot couple the transport to rendering.
 *
 * Stops are derived from the era contract (`../era/eraTypes` re-exports `ERAS`),
 * so the slider can never disagree with the descriptors the scene systems use.
 *
 * Interaction:
 *   - click/tap a stop, or press and drag anywhere on the rail (pointer, mouse
 *     or touch) to scrub between stops;
 *   - keyboard (on the slider thumb or any stop inside the panel):
 *     ArrowLeft/ArrowDown and ArrowUp/ArrowRight step one stop, Home/End jump to
 *     the first/last stop, and the digits 1-5 jump straight to a stop.
 *
 * Every input path funnels through one state transition and emits the same
 * {@link TimelineChangeEvent} shape, so the era-transition driver subscribes
 * once (`onYearChange` or {@link Timeline.subscribe}) and never needs to know
 * which device produced the change.
 */

import { ERAS, type EraConfig, type EraId } from "../era/eraTypes";
import "./hud.css";

/* -------------------------------------------------------------------------- */
/* Selectors                                                                  */
/* -------------------------------------------------------------------------- */

/** Id of the overlay root `index.html` reserves for the top timeline. */
export const TIMELINE_ROOT_SELECTOR = "#timeline-root";

/** `data-role` hooks for every node the timeline renders, shared with DOM tests. */
export const TIMELINE_SELECTORS = {
  panel: '[data-role="timeline-panel"]',
  rail: '[data-role="timeline-rail"]',
  stops: '[data-role="timeline-stops"]',
  stop: '[data-role="timeline-stop"]',
  stopLabel: '[data-role="timeline-stop-label"]',
  playhead: '[data-role="timeline-playhead"]',
  fill: '[data-role="timeline-fill"]',
  year: '[data-role="timeline-year"]',
  eraName: '[data-role="timeline-era-name"]',
  hint: '[data-role="timeline-hint"]',
  announcer: '[data-role="timeline-announcer"]',
} as const;

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

/** Which input path produced a year change. */
export type TimelineChangeSource = "click" | "drag" | "keyboard" | "api";

/** One stop of the slider, projected from an {@link EraConfig}. */
export interface TimelineStop {
  readonly era: EraId;
  /** Zero-based position on the timeline, taken from the era contract. */
  readonly index: number;
  readonly year: number;
  /** Short timeline label rendered on the stop, e.g. `"1945"`. */
  readonly label: string;
  readonly title: string;
  readonly tagline: string;
}

/** Payload handed to every year-change listener. */
export interface TimelineChangeEvent extends TimelineStop {
  readonly previousEra: EraId;
  readonly previousIndex: number;
  readonly source: TimelineChangeSource;
}

export type TimelineChangeListener = (event: TimelineChangeEvent) => void;

export interface TimelineOptions {
  /** Mount point; defaults to {@link TIMELINE_ROOT_SELECTOR} in the document. */
  readonly container?: HTMLElement;
  /** Era descriptors to render; defaults to the contract dataset `ERAS`. */
  readonly eras?: readonly EraConfig[];
  /** Stop selected on mount; defaults to the first era. */
  readonly initialEra?: EraId;
  /** Convenience listener, equivalent to `subscribe`. */
  readonly onYearChange?: TimelineChangeListener;
}

/** Live handle returned by {@link createTimeline}. */
export interface Timeline {
  /** Panel element appended to the container; removed again by `dispose`. */
  readonly root: HTMLElement;
  readonly container: HTMLElement;
  /** Rail the pointer drag is measured against. */
  readonly rail: HTMLElement;
  /** Thumb carrying the ARIA slider semantics. */
  readonly thumb: HTMLElement;
  readonly stops: readonly TimelineStop[];
  readonly stopButtons: readonly HTMLButtonElement[];
  /** Currently selected era. */
  readonly era: EraId;
  /** Contract index of the selected era. */
  readonly index: number;
  readonly dragging: boolean;
  /** Selects `era`; returns `false` when it was already selected. */
  setEra(era: EraId, source?: TimelineChangeSource): boolean;
  /** Selects the stop at `index` (clamped); returns `false` when unchanged. */
  selectStop(index: number, source?: TimelineChangeSource): boolean;
  /** Registers a listener and returns its unsubscribe function. */
  subscribe(listener: TimelineChangeListener): () => void;
  /** Moves keyboard focus onto the slider thumb. */
  focus(): void;
  /** Removes every listener and the panel element. Idempotent. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Stop projection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Projects the era contract into slider stops.
 *
 * Kept pure and exported so the composition layer (and its tests) can assert the
 * slider against the real `ERAS` dataset without touching the DOM.
 */
export function createTimelineStops(eras: readonly EraConfig[] = ERAS): readonly TimelineStop[] {
  if (eras.length === 0) {
    throw new Error("createTimelineStops needs at least one era descriptor.");
  }

  const seen = new Set<EraId>();
  return eras.map((era) => {
    if (seen.has(era.id)) {
      throw new Error(`Duplicate era "${era.id}" in the timeline dataset.`);
    }
    seen.add(era.id);
    return {
      era: era.id,
      index: era.index,
      year: era.year,
      label: era.label,
      title: era.title,
      tagline: era.tagline,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/** Per-instance suffix so several timelines can coexist without id clashes. */
let instanceCounter = 0;

type DragOrigin = "pointer" | "mouse" | "touch";

/** Document-level listeners hoisted while a drag is in flight, per origin. */
const DRAG_MOVE_EVENTS: Readonly<Record<DragOrigin, readonly string[]>> = {
  pointer: ["pointermove"],
  mouse: ["mousemove"],
  touch: ["touchmove"],
};

const DRAG_END_EVENTS: Readonly<Record<DragOrigin, readonly string[]>> = {
  pointer: ["pointerup", "pointercancel"],
  mouse: ["mouseup"],
  touch: ["touchend", "touchcancel"],
};

/** One stop per arrow press, so keyboard stepping always equals stop stepping. */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};

/**
 * Builds the timeline slider and mounts it into `options.container`
 * (or `#timeline-root` when omitted).
 */
export function createTimeline(options: TimelineOptions = {}): Timeline {
  const container = resolveContainer(options.container);
  const doc = container.ownerDocument;
  const stops = createTimelineStops(options.eras ?? ERAS);
  const listeners = new Set<TimelineChangeListener>();
  const staticSignals = new AbortController();

  let position = resolveInitialPosition(stops, options.initialEra);
  let dragOrigin: DragOrigin | null = null;
  let dragSignals: AbortController | null = null;
  let disposed = false;

  /* ---- markup ----------------------------------------------------------- */

  function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    role?: string,
  ): HTMLElementTagNameMap[K] {
    const element = doc.createElement(tag);
    element.className = className;
    if (role) {
      element.dataset.role = role;
    }
    return element;
  }

  const panel = node("div", "cc-timeline", "timeline-panel");

  const bar = node("div", "cc-timeline__bar");
  const readout = node("p", "cc-timeline__readout");
  const yearNode = node("span", "cc-timeline__year", "timeline-year");
  const eraNameNode = node("span", "cc-timeline__era", "timeline-era-name");
  readout.append(yearNode, eraNameNode);

  const rail = node("div", "cc-timeline__rail", "timeline-rail");
  const line = node("span", "cc-timeline__line");
  line.setAttribute("aria-hidden", "true");
  const fill = node("span", "cc-timeline__fill", "timeline-fill");
  fill.setAttribute("aria-hidden", "true");

  const stopsList = node("ol", "cc-timeline__stops", "timeline-stops");
  const stopButtons: HTMLButtonElement[] = [];

  for (const [index, stop] of stops.entries()) {
    const item = node("li", "cc-timeline__stop-item");
    item.style.left = `${progressFor(index, stops.length)}%`;

    const button = node("button", "cc-timeline__stop", "timeline-stop");
    button.type = "button";
    button.dataset.era = stop.era;
    button.dataset.state = "idle";
    button.title = `${stop.label} — ${stop.title}`;
    button.setAttribute("aria-label", `${stop.label}: ${stop.title}`);

    const dot = node("span", "cc-timeline__dot");
    dot.setAttribute("aria-hidden", "true");
    const label = node("span", "cc-timeline__stop-label", "timeline-stop-label");
    label.textContent = stop.label;

    button.append(dot, label);
    item.append(button);
    stopsList.append(item);
    stopButtons.push(button);
  }

  const thumb = node("span", "cc-timeline__playhead", "timeline-playhead");
  thumb.tabIndex = 0;
  thumb.setAttribute("role", "slider");
  thumb.setAttribute("aria-label", "Timelapse year");
  thumb.setAttribute("aria-orientation", "horizontal");
  thumb.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Home End");
  thumb.setAttribute("aria-valuemin", String(stops[0].year));
  thumb.setAttribute("aria-valuemax", String(stops[stops.length - 1].year));

  const hintId = `cc-timeline-hint-${(instanceCounter += 1)}`;
  const hint = node("p", "cc-timeline__hint cc-visually-hidden", "timeline-hint");
  hint.id = hintId;
  hint.textContent =
    "Drag the rail, or press the arrow keys to step one era; Home and End jump to 1945 and 2025.";
  thumb.setAttribute("aria-describedby", hintId);

  const announcer = node("p", "cc-visually-hidden", "timeline-announcer");
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");

  rail.append(line, fill, stopsList, thumb);
  bar.append(readout, rail);
  panel.append(bar, hint, announcer);
  container.append(panel);

  /* ---- state ------------------------------------------------------------ */

  function valueText(stop: TimelineStop): string {
    return `${stop.label} — ${stop.title}`;
  }

  /** Pushes one stop into the DOM: playhead, readout, ARIA and stop states. */
  function applyStop(stop: TimelineStop, nextPosition: number): void {
    position = nextPosition;
    const percent = progressFor(nextPosition, stops.length);

    rail.style.setProperty("--cc-timeline-progress", `${percent}%`);
    thumb.style.left = `${percent}%`;
    thumb.setAttribute("aria-valuenow", String(stop.year));
    thumb.setAttribute("aria-valuetext", valueText(stop));

    yearNode.textContent = stop.label;
    eraNameNode.textContent = stop.title;
    panel.dataset.era = stop.era;

    for (const [index, button] of stopButtons.entries()) {
      const active = index === nextPosition;
      button.dataset.state = active ? "active" : "idle";
      button.setAttribute("aria-current", active ? "true" : "false");
    }
  }

  /** Single state transition shared by every input path. */
  function selectPosition(nextPosition: number, source: TimelineChangeSource): boolean {
    if (disposed) {
      return false;
    }
    const clamped = clampIndex(nextPosition, stops.length);
    if (clamped === position) {
      return false;
    }

    const previous = stops[position];
    const next = stops[clamped];
    applyStop(next, clamped);
    announcer.textContent = `${next.label}, ${next.title}`;
    emit(next, previous, source);
    return true;
  }

  function emit(next: TimelineStop, previous: TimelineStop, source: TimelineChangeSource): void {
    const event: TimelineChangeEvent = Object.freeze({
      ...next,
      previousEra: previous.era,
      previousIndex: previous.index,
      source,
    });
    const recipients = [...listeners];
    if (options.onYearChange) {
      recipients.unshift(options.onYearChange);
    }

    for (const listener of recipients) {
      try {
        listener(event);
      } catch (error) {
        // One misbehaving consumer must not break the transport for the others.
        console.error("[chrono-city] timeline listener threw", error);
      }
    }
  }

  /* ---- pointer, mouse and touch ---------------------------------------- */

  function stopButtonFor(target: EventTarget | null): HTMLButtonElement | null {
    if (!target || typeof (target as Element).closest !== "function") {
      return null;
    }
    const button = (target as Element).closest<HTMLButtonElement>(TIMELINE_SELECTORS.stop);
    return button && button.dataset.era ? button : null;
  }

  /** Exact hit first (works without layout), nearest stop by geometry second. */
  function activateFromTarget(
    target: EventTarget | null,
    clientX: number,
    source: TimelineChangeSource,
  ): boolean {
    const era = stopButtonFor(target)?.dataset.era as EraId | undefined;
    if (era) {
      return selectPosition(eraToPosition(era), source);
    }
    return selectFromClientX(clientX, source);
  }

  function selectFromClientX(clientX: number, source: TimelineChangeSource): boolean {
    const rect = rail.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) {
      // Headless DOM without layout: no geometry to map onto the stops.
      return false;
    }
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return selectPosition(Math.round(ratio * (stops.length - 1)), source);
  }

  function beginDrag(origin: DragOrigin, event: Event): void {
    if (disposed || dragOrigin !== null) {
      return;
    }
    const clientX = readClientX(event);
    if (clientX === null) {
      return;
    }

    // One gesture can surface as pointer + compatibility mouse/touch events; the
    // first origin to claim the drag owns it, which also keeps jsdom tests that
    // dispatch plain mouse or touch events working.
    dragOrigin = origin;
    dragSignals = new AbortController();
    const { signal } = dragSignals;
    for (const type of DRAG_MOVE_EVENTS[origin]) {
      doc.addEventListener(type, onDragMove, { signal, passive: false });
    }
    for (const type of DRAG_END_EVENTS[origin]) {
      doc.addEventListener(type, onDragEnd, { signal });
    }

    panel.dataset.dragging = "true";
    thumb.focus({ preventScroll: true });
    activateFromTarget(event.target, clientX, "click");
  }

  function onDragMove(event: Event): void {
    if (dragOrigin === null) {
      return;
    }
    const clientX = readClientX(event);
    if (clientX === null) {
      return;
    }
    if (dragOrigin === "touch" && event.cancelable) {
      event.preventDefault();
    }
    selectFromClientX(clientX, "drag");
  }

  function onDragEnd(): void {
    endDrag();
  }

  function endDrag(): void {
    if (dragOrigin === null) {
      return;
    }
    dragSignals?.abort();
    dragSignals = null;
    dragOrigin = null;
    panel.removeAttribute("data-dragging");
  }

  /* ---- keyboard -------------------------------------------------------- */

  function onKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }

    const step = KEY_STEPS[event.key];
    let target: number | null = null;

    if (step !== undefined) {
      target = position + step;
    } else if (event.key === "Home") {
      target = 0;
    } else if (event.key === "End") {
      target = stops.length - 1;
    } else if (/^[0-9]$/.test(event.key)) {
      const digit = Number.parseInt(event.key, 10);
      if (digit >= 1 && digit <= stops.length) {
        target = digit - 1;
      }
    }

    if (target === null) {
      return;
    }
    // Home/End would otherwise scroll the page under the fixed overlay.
    event.preventDefault();
    selectPosition(target, "keyboard");
  }

  /* ---- wiring ---------------------------------------------------------- */

  function eraToPosition(era: EraId): number {
    const index = stops.findIndex((stop) => stop.era === era);
    if (index < 0) {
      throw new Error(`The era "${era}" is not on this timeline.`);
    }
    return index;
  }

  function setEra(era: EraId, source: TimelineChangeSource = "api"): boolean {
    return selectPosition(eraToPosition(era), source);
  }

  applyStop(stops[position], position);

  panel.addEventListener("keydown", onKeyDown, { signal: staticSignals.signal });
  rail.addEventListener("pointerdown", (event) => beginDrag("pointer", event), {
    signal: staticSignals.signal,
  });
  rail.addEventListener("mousedown", (event) => beginDrag("mouse", event), {
    signal: staticSignals.signal,
  });
  rail.addEventListener("touchstart", (event) => beginDrag("touch", event), {
    signal: staticSignals.signal,
    passive: true,
  });
  // Assistive tech and keyboard users activate a stop button with a click event
  // that has no preceding pointer press, so stop clicks are handled explicitly.
  stopsList.addEventListener(
    "click",
    (event) => {
      const era = stopButtonFor(event.target)?.dataset.era as EraId | undefined;
      if (era) {
        setEra(era, "click");
      }
    },
    { signal: staticSignals.signal },
  );

  /* ---- handle ---------------------------------------------------------- */

  const handle: Timeline = Object.freeze({
    root: panel,
    container,
    rail,
    thumb,
    stops,
    stopButtons,
    get era() {
      return stops[position].era;
    },
    get index() {
      return stops[position].index;
    },
    get dragging() {
      return dragOrigin !== null;
    },
    setEra,
    selectStop(index: number, source: TimelineChangeSource = "api") {
      return selectPosition(index, source);
    },
    subscribe(listener: TimelineChangeListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    focus() {
      thumb.focus({ preventScroll: true });
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      staticSignals.abort();
      endDrag();
      listeners.clear();
      panel.remove();
    },
  });

  return handle;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Resolves the mount point, failing loudly when the shell is incomplete. */
function resolveContainer(container: HTMLElement | undefined): HTMLElement {
  if (container) {
    return container;
  }
  if (typeof document === "undefined") {
    throw new Error("createTimeline needs a container to mount into outside the browser.");
  }
  const root = document.querySelector<HTMLElement>(TIMELINE_ROOT_SELECTOR);
  if (!root) {
    throw new Error(
      `createTimeline could not find ${TIMELINE_ROOT_SELECTOR}; pass a container instead.`,
    );
  }
  return root;
}

function resolveInitialPosition(
  stops: readonly TimelineStop[],
  initialEra: EraId | undefined,
): number {
  if (!initialEra) {
    return 0;
  }
  const index = stops.findIndex((stop) => stop.era === initialEra);
  if (index < 0) {
    throw new Error(`The initial era "${initialEra}" is not on this timeline.`);
  }
  return index;
}

/** Percentage across the rail for the stop at `position` within `length` stops. */
function progressFor(position: number, length: number): number {
  if (length <= 1) {
    return 0;
  }
  return Number(((position / (length - 1)) * 100).toFixed(4));
}

function clampIndex(index: number, length: number): number {
  const value = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(value, 0), length - 1);
}

/**
 * Reads the horizontal pointer position from a pointer, mouse or touch event.
 *
 * Duck-typed on purpose: pointer events extend `MouseEvent`, while touch events
 * expose coordinates through their touch lists only.
 */
function readClientX(event: Event): number | null {
  const asMouse = event as MouseEvent;
  if (typeof asMouse.clientX === "number" && Number.isFinite(asMouse.clientX)) {
    return asMouse.clientX;
  }
  const asTouch = event as TouchEvent;
  const first = asTouch.touches?.[0] ?? asTouch.changedTouches?.[0];
  return first && Number.isFinite(first.clientX) ? first.clientX : null;
}

/* -------------------------------------------------------------------------- */
/* HUD re-export                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `src/ui/timeline.ts` is the single UI surface the composition layer imports:
 * the HUD lives in `./hud` and is re-exported here so scene assembly wires the
 * timeline, its readouts and its controls through one module.
 */
export { HUD_ROOT_SELECTOR, HUD_SELECTORS, HELP_ITEMS, createHud } from "./hud";
export type {
  HelpItem,
  HelpToggleEvent,
  Hud,
  HudOptions,
  InfoCardContent,
  InfoCardDismissEvent,
  InfoCardRow,
  MuteToggleEvent,
  UiInputSource,
} from "./hud";
