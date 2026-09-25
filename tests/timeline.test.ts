import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ERAS, ERAS_BY_ID, ERA_IDS, type EraId } from "../src/era/eraTypes";
import { HUD_SELECTORS, createHud as createHudDirect } from "../src/ui/hud";
import {
  HELP_ITEMS,
  HUD_ROOT_SELECTOR,
  TIMELINE_ROOT_SELECTOR,
  TIMELINE_SELECTORS,
  createHud,
  createTimeline,
  createTimelineStops,
  type HelpToggleEvent,
  type Hud,
  type HudOptions,
  type InfoCardDismissEvent,
  type MuteToggleEvent,
  type Timeline,
  type TimelineChangeEvent,
  type TimelineOptions,
} from "../src/ui/timeline";

/**
 * Composition tests for the top timeline slider and the HUD.
 *
 * Everything runs in the jsdom environment configured by `vitest.config.ts`:
 * the modules are exercised as real DOM, driven by real events, and wired to the
 * *real* era contract (`ERAS` through `src/era/eraTypes.ts`) rather than to
 * fixtures - so a drift between the slider's five stops and the era dataset
 * fails here.
 *
 * Only inputs a browser really produces are dispatched: `click`/`mousedown`/
 * `mousemove`/`mouseup`, pointer events, touch events and `keydown`. Geometry
 * that jsdom cannot compute (a rail rect) is stubbed explicitly, which also
 * documents the pixel-to-stop mapping the drag relies on.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relative: string): string {
  return readFileSync(resolve(repoRoot, relative), "utf8");
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

let container: HTMLElement;
let disposers: Array<() => void>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  disposers = [];
});

afterEach(() => {
  for (const dispose of disposers.reverse()) {
    dispose();
  }
  container.remove();
  document.querySelector(TIMELINE_ROOT_SELECTOR)?.remove();
  document.querySelector(HUD_ROOT_SELECTOR)?.remove();
});

function mountTimeline(
  options: Partial<TimelineOptions> = {},
): { timeline: Timeline; events: TimelineChangeEvent[] } {
  const events: TimelineChangeEvent[] = [];
  const timeline = createTimeline({
    container,
    onYearChange: (event) => events.push(event),
    ...options,
  });
  disposers.push(() => timeline.dispose());
  return { timeline, events };
}

function mountHud(options: Partial<HudOptions> = {}): {
  hud: Hud;
  muteEvents: MuteToggleEvent[];
  helpEvents: HelpToggleEvent[];
  dismissEvents: InfoCardDismissEvent[];
} {
  const muteEvents: MuteToggleEvent[] = [];
  const helpEvents: HelpToggleEvent[] = [];
  const dismissEvents: InfoCardDismissEvent[] = [];
  const hud = createHud({
    container,
    onMuteToggle: (event) => muteEvents.push(event),
    onHelpToggle: (event) => helpEvents.push(event),
    onInfoCardDismiss: (event) => dismissEvents.push(event),
    ...options,
  });
  disposers.push(() => hud.dispose());
  return { hud, muteEvents, helpEvents, dismissEvents };
}

/* -------------------------------------------------------------------------- */
/* Event helpers                                                              */
/* -------------------------------------------------------------------------- */

function mouse(type: string, clientX: number, detail = 1): MouseEvent {
  return new MouseEvent(type, { clientX, detail, bubbles: true, cancelable: true });
}

function click(target: HTMLElement, detail = 1): MouseEvent {
  const event = mouse("click", 0, detail);
  target.dispatchEvent(event);
  return event;
}

/**
 * Builds a pointer event, degrading to a `MouseEvent` when jsdom has no
 * `PointerEvent` constructor (the modules read `clientX` either way).
 */
function pointer(type: string, clientX: number, pointerType = "mouse"): Event {
  const PointerEventCtor = (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (typeof PointerEventCtor === "function") {
    const event = new PointerEventCtor(type, {
      clientX,
      pointerType,
      bubbles: true,
      cancelable: true,
    });
    return event;
  }
  const event = new MouseEvent(type, { clientX, detail: 1, bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

/** Builds a legacy touch event with one active point and a matching changed list. */
function touch(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX, clientY: 24 };
  const active = type === "touchend" || type === "touchcancel" ? [] : [point];
  Object.defineProperty(event, "touches", { value: active });
  Object.defineProperty(event, "changedTouches", { value: [point] });
  return event;
}

function pressKey(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Gives the rail a layout so drag maths can be asserted deterministically. */
function stubRailRect(timeline: Timeline, left: number, width: number): void {
  timeline.rail.getBoundingClientRect = () =>
    ({
      x: left,
      y: 0,
      left,
      top: 0,
      width,
      height: 56,
      right: left + width,
      bottom: 56,
      toJSON: () => ({}),
    }) as DOMRect;
}

function stopButton(timeline: Timeline, era: EraId): HTMLButtonElement {
  const button = timeline.stopButtons.find((candidate) => candidate.dataset.era === era);
  if (!button) {
    throw new Error(`No stop button rendered for era "${era}".`);
  }
  return button;
}

/* -------------------------------------------------------------------------- */
/* Stops derived from the era contract                                        */
/* -------------------------------------------------------------------------- */

describe("timeline stops derived from the era contract", () => {
  it("projects the real era dataset onto five ordered stops", () => {
    const stops = createTimelineStops();

    expect(stops).toHaveLength(5);
    expect(stops.map((stop) => stop.era)).toEqual([...ERA_IDS]);
    expect(stops.map((stop) => stop.label)).toEqual(ERA_IDS.map((id) => ERAS_BY_ID[id].label));
    expect(stops.map((stop) => stop.year)).toEqual([1945, 1965, 1985, 2005, 2025]);
    expect(stops.map((stop) => stop.index)).toEqual([0, 1, 2, 3, 4]);
    expect(stops.every((stop) => stop.title === ERAS_BY_ID[stop.era].title)).toBe(true);
    expect(stops.every((stop) => stop.tagline.length > 0)).toBe(true);
  });

  it("rejects datasets it cannot render", () => {
    expect(() => createTimelineStops([])).toThrow(/at least one era/);
    expect(() => createTimelineStops([ERAS[0], ERAS[0]])).toThrow(/Duplicate era/);
  });

  it("renders one stop per era and starts on the first era", () => {
    const { timeline } = mountTimeline();

    expect(timeline.stops).toHaveLength(ERAS.length);
    expect(timeline.stopButtons).toHaveLength(ERAS.length);
    expect(container.querySelectorAll(TIMELINE_SELECTORS.stop)).toHaveLength(ERAS.length);
    expect(timeline.era).toBe(ERAS[0].id);
  });
});

/* -------------------------------------------------------------------------- */
/* DOM structure and ARIA semantics                                           */
/* -------------------------------------------------------------------------- */

describe("timeline DOM structure and ARIA semantics", () => {
  it("renders five labelled stops, a playhead and the current-year readout", () => {
    const { timeline } = mountTimeline();

    expect(timeline.root).toBe(container.querySelector(TIMELINE_SELECTORS.panel));
    expect(timeline.thumb).toBe(container.querySelector(TIMELINE_SELECTORS.playhead));
    expect(timeline.rail.contains(container.querySelector(TIMELINE_SELECTORS.playhead))).toBe(true);

    const labels = Array.from(
      container.querySelectorAll<HTMLElement>(TIMELINE_SELECTORS.stopLabel),
      (node) => node.textContent,
    );
    expect(labels).toEqual([...ERA_IDS]);

    for (const stop of timeline.stops) {
      const button = stopButton(timeline, stop.era);
      expect(button.getAttribute("aria-label")).toBe(`${stop.label}: ${stop.title}`);
      expect(button.title).toBe(`${stop.label} — ${stop.title}`);
    }

    expect(container.querySelector(TIMELINE_SELECTORS.year)?.textContent).toBe(ERAS[0].label);
    expect(container.querySelector(TIMELINE_SELECTORS.eraName)?.textContent).toBe(ERAS[0].title);

    const current = container.querySelectorAll(`${TIMELINE_SELECTORS.stop}[aria-current="true"]`);
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(stopButton(timeline, ERAS[0].id));
  });

  it("exposes slider semantics with the value range of the era years", () => {
    const { timeline } = mountTimeline();
    const { thumb } = timeline;

    expect(thumb.getAttribute("role")).toBe("slider");
    expect(thumb.tabIndex).toBe(0);
    expect(thumb.getAttribute("aria-orientation")).toBe("horizontal");
    expect(thumb.getAttribute("aria-label")).toBe("Timelapse year");
    expect(thumb.getAttribute("aria-valuemin")).toBe("1945");
    expect(thumb.getAttribute("aria-valuemax")).toBe("2025");
    expect(thumb.getAttribute("aria-valuenow")).toBe("1945");
    expect(thumb.getAttribute("aria-valuetext")).toBe(`${ERAS[0].label} — ${ERAS[0].title}`);

    const describedBy = thumb.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(TIMELINE_SELECTORS.hint)?.id).toBe(describedBy);
  });

  it("mounts into the top-pinned shell root when no container is given", () => {
    const shell = document.createElement("div");
    shell.id = TIMELINE_ROOT_SELECTOR.slice(1);
    shell.className = "timeline-root";
    document.body.append(shell);

    const timeline = createTimeline();
    disposers.push(() => timeline.dispose());

    expect(shell.querySelector(TIMELINE_SELECTORS.panel)).toBe(timeline.root);
    expect(timeline.container).toBe(shell);
  });

  it("fails loudly when there is no container and no shell root", () => {
    expect(() => createTimeline()).toThrow(/timeline-root/);
  });

  it("moves the playhead and the rail fill onto the selected stop", () => {
    const { timeline } = mountTimeline();
    const fill = container.querySelector<HTMLElement>(TIMELINE_SELECTORS.fill);

    timeline.setEra("1985");
    expect(timeline.thumb.style.left).toBe("50%");
    expect(timeline.rail.style.getPropertyValue("--cc-timeline-progress")).toBe("50%");
    expect(fill?.style.width).not.toBe("0%");

    timeline.setEra("2025");
    expect(timeline.thumb.style.left).toBe("100%");

    timeline.setEra("1945");
    expect(timeline.thumb.style.left).toBe("0%");
    expect(timeline.rail.style.getPropertyValue("--cc-timeline-progress")).toBe("0%");
  });

  it("keeps the readout and ARIA state in sync with setEra", () => {
    const { timeline } = mountTimeline();

    expect(timeline.setEra("2005", "api")).toBe(true);
    expect(timeline.era).toBe("2005");
    expect(timeline.index).toBe(3);
    expect(container.querySelector(TIMELINE_SELECTORS.year)?.textContent).toBe("2005");
    expect(container.querySelector(TIMELINE_SELECTORS.eraName)?.textContent).toBe(
      ERAS_BY_ID["2005"].title,
    );
    expect(timeline.thumb.getAttribute("aria-valuenow")).toBe("2005");
    expect(timeline.thumb.getAttribute("aria-valuetext")).toBe(
      `2005 — ${ERAS_BY_ID["2005"].title}`,
    );
    expect(stopButton(timeline, "2005").dataset.state).toBe("active");
    expect(stopButton(timeline, "1945").dataset.state).toBe("idle");

    // Selecting the current era again is a no-op.
    expect(timeline.setEra("2005", "api")).toBe(false);
  });

  it("rejects an era that is not part of the timeline", () => {
    const { timeline } = mountTimeline();
    expect(() => timeline.setEra("1999" as EraId)).toThrow(/not on this timeline/);
    expect(() => createTimeline({ container, initialEra: "1999" as EraId })).toThrow(
      /not on this timeline/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Click, drag and touch interaction                                          */
/* -------------------------------------------------------------------------- */

describe("timeline click, drag and touch interaction", () => {
  it("selects a stop on click and emits the shared year-change event", () => {
    const { timeline, events } = mountTimeline();

    click(stopButton(timeline, "1985"));

    expect(events).toEqual([
      {
        era: "1985",
        index: 2,
        year: 1985,
        label: "1985",
        title: ERAS_BY_ID["1985"].title,
        tagline: ERAS_BY_ID["1985"].tagline,
        previousEra: "1945",
        previousIndex: 0,
        source: "click",
      },
    ]);
    expect(timeline.thumb.getAttribute("aria-valuenow")).toBe("1985");
    expect(container.querySelector(TIMELINE_SELECTORS.year)?.textContent).toBe("1985");

    // The same stop clicked twice reports one change, not two.
    click(stopButton(timeline, "1985"));
    expect(events).toHaveLength(1);
  });

  it("maps a press on the rail onto the nearest stop", () => {
    const { timeline, events } = mountTimeline();
    stubRailRect(timeline, 0, 400);

    const press = (clientX: number): void => {
      timeline.rail.dispatchEvent(mouse("mousedown", clientX));
      document.dispatchEvent(mouse("mouseup", clientX));
    };

    press(210);
    expect(timeline.era).toBe("1985");

    press(400);
    expect(timeline.era).toBe("2025");

    press(0);
    expect(timeline.era).toBe("1945");

    expect(events.map((event) => event.era)).toEqual(["1985", "2025", "1945"]);
    expect(events.every((event) => event.source === "click")).toBe(true);
  });

  it("scrubs while dragging with the mouse and reports one drag per stop change", () => {
    const { timeline, events } = mountTimeline();
    stubRailRect(timeline, 0, 400);

    timeline.rail.dispatchEvent(mouse("mousedown", 100));
    expect(timeline.dragging).toBe(true);
    expect(timeline.root.dataset.dragging).toBe("true");
    expect(timeline.era).toBe("1965");

    document.dispatchEvent(mouse("mousemove", 200));
    expect(timeline.era).toBe("1985");

    // Still inside the 1985 stop: no additional event.
    document.dispatchEvent(mouse("mousemove", 205));
    expect(events).toHaveLength(2);

    document.dispatchEvent(mouse("mousemove", 400));
    expect(timeline.era).toBe("2025");

    document.dispatchEvent(mouse("mouseup", 400));
    expect(timeline.dragging).toBe(false);
    expect(timeline.root.hasAttribute("data-dragging")).toBe(false);
    // A move after the gesture ended is ignored.
    document.dispatchEvent(mouse("mousemove", 0));
    expect(timeline.era).toBe("2025");

    expect(events.map((event) => event.source)).toEqual(["click", "drag", "drag"]);
    expect(events.map((event) => event.era)).toEqual(["1965", "1985", "2025"]);
  });

  it("drags with pointer events", () => {
    const { timeline, events } = mountTimeline();
    stubRailRect(timeline, 0, 400);

    timeline.rail.dispatchEvent(pointer("pointerdown", 400));
    expect(timeline.era).toBe("2025");
    expect(timeline.dragging).toBe(true);

    document.dispatchEvent(pointer("pointermove", 100));
    expect(timeline.era).toBe("1965");

    document.dispatchEvent(pointer("pointerup", 100));
    expect(timeline.dragging).toBe(false);
    expect(events.map((event) => event.source)).toEqual(["click", "drag"]);
  });

  it("drags with touch events", () => {
    const { timeline, events } = mountTimeline();
    stubRailRect(timeline, 0, 400);

    timeline.rail.dispatchEvent(touch("touchstart", 400));
    expect(timeline.era).toBe("2025");

    document.dispatchEvent(touch("touchmove", 200));
    expect(timeline.era).toBe("1985");

    document.dispatchEvent(touch("touchend", 200));
    expect(timeline.dragging).toBe(false);

    expect(events.map((event) => event.source)).toEqual(["click", "drag"]);
    expect(events.map((event) => event.era)).toEqual(["2025", "1985"]);
  });

  it("ignores the compatibility mouse event that follows a pointer press", () => {
    const { timeline, events } = mountTimeline();
    stubRailRect(timeline, 0, 400);

    timeline.rail.dispatchEvent(pointer("pointerdown", 400));
    // Real browsers replay the mouse sequence after pointer events: the second
    // press belongs to the same gesture and must not restart it.
    timeline.rail.dispatchEvent(mouse("mousedown", 0));

    expect(timeline.era).toBe("2025");
    expect(events).toHaveLength(1);

    document.dispatchEvent(pointer("pointerup", 400));
    expect(timeline.dragging).toBe(false);
  });

  it("survives a press in a DOM without layout", () => {
    const { timeline, events } = mountTimeline();

    // jsdom reports a zero-width rect; the slider must degrade instead of
    // guessing a stop from unusable geometry.
    expect(timeline.rail.getBoundingClientRect().width).toBe(0);
    expect(() => timeline.rail.dispatchEvent(mouse("mousedown", 120))).not.toThrow();
    document.dispatchEvent(mouse("mouseup", 120));

    expect(timeline.era).toBe("1945");
    expect(events).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Keyboard operability                                                       */
/* -------------------------------------------------------------------------- */

describe("timeline keyboard operability", () => {
  it("focuses the slider thumb through the handle", () => {
    const { timeline } = mountTimeline();
    timeline.focus();
    expect(document.activeElement).toBe(timeline.thumb);
  });

  it("steps one stop per arrow press and stops at the ends", () => {
    const { timeline, events } = mountTimeline();

    pressKey(timeline.thumb, "ArrowRight");
    expect(timeline.era).toBe("1965");
    pressKey(timeline.thumb, "ArrowRight");
    pressKey(timeline.thumb, "ArrowRight");
    pressKey(timeline.thumb, "ArrowRight");
    expect(timeline.era).toBe("2025");

    pressKey(timeline.thumb, "ArrowRight");
    expect(timeline.era).toBe("2025");
    expect(events).toHaveLength(4);

    pressKey(timeline.thumb, "ArrowLeft");
    expect(timeline.era).toBe("2005");
    pressKey(timeline.thumb, "ArrowDown");
    expect(timeline.era).toBe("1985");
    pressKey(timeline.thumb, "ArrowUp");
    expect(timeline.era).toBe("2005");

    expect(events.every((event) => event.source === "keyboard")).toBe(true);
  });

  it("jumps to the ends with Home and End", () => {
    const { timeline, events } = mountTimeline();

    pressKey(timeline.thumb, "End");
    expect(timeline.era).toBe("2025");
    expect(timeline.thumb.getAttribute("aria-valuenow")).toBe("2025");

    pressKey(timeline.thumb, "Home");
    expect(timeline.era).toBe("1945");

    expect(events.map((event) => event.era)).toEqual(["2025", "1945"]);
  });

  it("jumps to a stop with the digit keys", () => {
    const { timeline, events } = mountTimeline();

    pressKey(timeline.thumb, "3");
    expect(timeline.era).toBe("1985");
    pressKey(timeline.thumb, "5");
    expect(timeline.era).toBe("2025");

    pressKey(timeline.thumb, "6");
    pressKey(timeline.thumb, "0");
    expect(timeline.era).toBe("2025");
    expect(events).toHaveLength(2);
  });

  it("claims only the keys it handles", () => {
    const { timeline } = mountTimeline();

    expect(pressKey(timeline.thumb, "ArrowRight").defaultPrevented).toBe(true);
    expect(pressKey(timeline.thumb, "End").defaultPrevented).toBe(true);
    expect(pressKey(timeline.thumb, "Tab").defaultPrevented).toBe(false);
    expect(pressKey(timeline.thumb, "a").defaultPrevented).toBe(false);
  });

  it("leaves modified keys to the browser", () => {
    const { timeline, events } = mountTimeline();

    const event = pressKey(timeline.thumb, "ArrowRight", { metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(timeline.era).toBe("1945");
    expect(events).toEqual([]);
  });

  it("works from the stop buttons as well as from the thumb", () => {
    const { timeline, events } = mountTimeline();
    const button = stopButton(timeline, "2005");
    button.focus();
    expect(document.activeElement).toBe(button);

    // Focusing a stop only moves focus; the arrow key steps from the active era.
    pressKey(button, "ArrowRight");
    expect(timeline.era).toBe("1965");
    expect(events).toEqual([
      expect.objectContaining({ era: "1965", previousEra: "1945", source: "keyboard" }),
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Announcements and listeners                                                */
/* -------------------------------------------------------------------------- */

describe("timeline announcements and listeners", () => {
  it("announces era changes through a polite live region", () => {
    const { timeline } = mountTimeline();
    const announcer = container.querySelector(TIMELINE_SELECTORS.announcer);

    expect(announcer?.getAttribute("role")).toBe("status");
    expect(announcer?.getAttribute("aria-live")).toBe("polite");
    expect(announcer?.textContent).toBe("");

    pressKey(timeline.thumb, "End");
    expect(announcer?.textContent).toBe(`2025, ${ERAS_BY_ID["2025"].title}`);
  });

  it("notifies every subscriber and isolates a throwing listener", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { timeline, events } = mountTimeline();
    const seen: TimelineChangeEvent[] = [];

    timeline.subscribe(() => {
      throw new Error("listener exploded");
    });
    const unsubscribe = timeline.subscribe((event) => seen.push(event));

    pressKey(timeline.thumb, "ArrowRight");

    expect(events.map((event) => event.era)).toEqual(["1965"]);
    expect(seen.map((event) => event.era)).toEqual(["1965"]);
    expect(errorSpy).toHaveBeenCalled();
    unsubscribe();

    pressKey(timeline.thumb, "ArrowRight");
    expect(seen).toHaveLength(1);
    expect(events).toHaveLength(2);
  });

  it("detaches cleanly on dispose", () => {
    const { timeline, events } = mountTimeline();

    timeline.dispose();
    expect(container.querySelector(TIMELINE_SELECTORS.panel)).toBeNull();

    // Idempotent, and inert afterwards: no throw, no further events.
    expect(() => timeline.dispose()).not.toThrow();
    expect(() => pressKey(timeline.thumb, "End")).not.toThrow();
    expect(timeline.setEra("1965", "api")).toBe(false);
    expect(timeline.era).toBe("1945");
    expect(events).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* HUD                                                                        */
/* -------------------------------------------------------------------------- */

describe("HUD readouts, sound toggle, help and inspection slot", () => {
  it("renders the era readout, the sound toggle and the hidden overlays", () => {
    const { hud } = mountHud();
    const helpPanel = container.querySelector<HTMLElement>(HUD_SELECTORS.helpPanel);
    const infoCard = container.querySelector<HTMLElement>(HUD_SELECTORS.infoCard);
    const mute = container.querySelector<HTMLButtonElement>(HUD_SELECTORS.mute);

    expect(hud.root).toBe(container.querySelector(HUD_SELECTORS.panel));
    expect(container.querySelector(HUD_SELECTORS.year)?.textContent).toBe(ERAS[0].label);
    expect(container.querySelector(HUD_SELECTORS.eraName)?.textContent).toBe(ERAS[0].title);
    expect(container.querySelector(HUD_SELECTORS.tagline)?.textContent).toBe(ERAS[0].tagline);

    expect(mute?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(HUD_SELECTORS.muteLabel)?.textContent).toBe("Sound on");
    expect(container.querySelector<HTMLButtonElement>(HUD_SELECTORS.help)?.ariaExpanded).toBe(
      "false",
    );
    expect(helpPanel?.hidden).toBe(true);
    expect(infoCard?.hidden).toBe(true);
    expect(hud.infoCardVisible).toBe(false);
    expect(hud.helpVisible).toBe(false);
  });

  it("updates the readouts from the era contract by id or descriptor", () => {
    const { hud } = mountHud();

    hud.setEra("2025");
    expect(hud.era).toBe("2025");
    expect(container.querySelector(HUD_SELECTORS.year)?.textContent).toBe("2025");
    expect(container.querySelector(HUD_SELECTORS.eraName)?.textContent).toBe(
      ERAS_BY_ID["2025"].title,
    );
    expect(container.querySelector(HUD_SELECTORS.tagline)?.textContent).toBe(
      ERAS_BY_ID["2025"].tagline,
    );

    hud.setEra(ERAS_BY_ID["1965"]);
    expect(container.querySelector(HUD_SELECTORS.year)?.textContent).toBe("1965");

    expect(() => hud.setEra("1999" as EraId)).toThrow(/Unknown Chrono City era/);
  });

  it("emits onMuteToggle for every state change", () => {
    const { hud, muteEvents } = mountHud();
    const mute = container.querySelector<HTMLButtonElement>(HUD_SELECTORS.mute);

    click(mute as HTMLElement);
    expect(muteEvents).toEqual([{ muted: true, source: "ui" }]);
    expect(hud.muted).toBe(true);
    expect(mute?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(HUD_SELECTORS.muteLabel)?.textContent).toBe("Sound muted");

    click(mute as HTMLElement);
    expect(muteEvents).toEqual([
      { muted: true, source: "ui" },
      { muted: false, source: "ui" },
    ]);

    hud.setMuted(true, "api");
    expect(muteEvents.at(-1)).toEqual({ muted: true, source: "api" });
    expect(hud.toggleMuted("api")).toBe(false);
    expect(muteEvents.at(-1)).toEqual({ muted: false, source: "api" });

    // Setting the state it already has reports nothing.
    hud.setMuted(false, "api");
    expect(muteEvents).toHaveLength(4);
  });

  it("reveals the controls help overlay and closes it again", () => {
    const { hud, helpEvents } = mountHud();
    const helpButton = container.querySelector<HTMLButtonElement>(HUD_SELECTORS.help);
    const helpPanel = container.querySelector<HTMLElement>(HUD_SELECTORS.helpPanel);
    const helpList = container.querySelector<HTMLElement>(HUD_SELECTORS.helpList);

    expect(helpList?.querySelectorAll("dt")).toHaveLength(HELP_ITEMS.length);
    expect(helpList?.textContent).toContain("Drag the rail");
    expect(helpList?.textContent).toContain("Home and End jump");

    click(helpButton as HTMLElement);
    expect(hud.helpVisible).toBe(true);
    expect(helpPanel?.hidden).toBe(false);
    expect(helpButton?.getAttribute("aria-expanded")).toBe("true");
    expect(helpButton?.getAttribute("aria-controls")).toBe(helpPanel?.id);
    expect(document.activeElement).toBe(helpPanel);
    expect(helpEvents).toEqual([{ visible: true, source: "ui" }]);

    pressKey(helpPanel as HTMLElement, "Escape");
    expect(hud.helpVisible).toBe(false);
    expect(helpPanel?.hidden).toBe(true);
    expect(document.activeElement).toBe(helpButton);
    expect(helpEvents.at(-1)).toEqual({ visible: false, source: "ui" });

    expect(hud.toggleHelp(undefined, "api")).toBe(true);
    expect(helpEvents.at(-1)).toEqual({ visible: true, source: "api" });
    hud.hideHelp("api");
    expect(helpEvents.at(-1)).toEqual({ visible: false, source: "api" });
  });

  it("fills and clears the inspection card through its show/hide API", () => {
    const { hud, dismissEvents } = mountHud();
    const infoCard = container.querySelector<HTMLElement>(HUD_SELECTORS.infoCard);

    hud.showInfoCard({
      id: "lot-7",
      title: "Grand Hotel",
      subtitle: "Mirror glass tower · 18 floors",
      rows: [
        { label: "Built", value: "1985" },
        { label: "Use", value: "Office" },
      ],
      accent: 0x7fd7ff,
    });

    expect(hud.infoCardVisible).toBe(true);
    expect(infoCard?.hidden).toBe(false);
    expect(container.querySelector(HUD_SELECTORS.infoTitle)?.textContent).toBe("Grand Hotel");
    expect(container.querySelector(HUD_SELECTORS.infoSubtitle)?.textContent).toBe(
      "Mirror glass tower · 18 floors",
    );
    expect(infoCard?.style.getPropertyValue("--cc-info-accent")).toBe("#7fd7ff");
    const rows = container.querySelector(HUD_SELECTORS.infoRows);
    expect(Array.from(rows?.querySelectorAll("dt") ?? [], (node) => node.textContent)).toEqual([
      "Built",
      "Use",
    ]);
    expect(Array.from(rows?.querySelectorAll("dd") ?? [], (node) => node.textContent)).toEqual([
      "1985",
      "Office",
    ]);

    // Closing the card clears the slot without reporting a dismissal...
    hud.hideInfoCard();
    expect(hud.infoCardVisible).toBe(false);
    expect(infoCard?.hidden).toBe(true);
    expect(container.querySelector(HUD_SELECTORS.infoTitle)?.textContent).toBe("");
    expect(rows?.childElementCount).toBe(0);
    expect(dismissEvents).toEqual([]);

    // ...while the user closing it reports the object that was cleared.
    hud.showInfoCard({ id: "lot-7", title: "Grand Hotel" });
    expect(container.querySelector<HTMLElement>(HUD_SELECTORS.infoSubtitle)?.hidden).toBe(true);
    click(container.querySelector<HTMLElement>(HUD_SELECTORS.infoClose) as HTMLElement);
    expect(dismissEvents).toEqual([{ id: "lot-7" }]);
    expect(hud.infoCardVisible).toBe(false);

    hud.showInfoCard({ title: "Unnamed lot" });
    const close = container.querySelector<HTMLElement>(HUD_SELECTORS.infoClose) as HTMLElement;
    close.focus();
    pressKey(close, "Escape");
    expect(dismissEvents.at(-1)).toEqual({ id: null });
    expect(hud.infoCardVisible).toBe(false);
  });

  it("mounts into the hud shell root and detaches on dispose", () => {
    const shell = document.createElement("div");
    shell.id = HUD_ROOT_SELECTOR.slice(1);
    shell.className = "hud-root";
    document.body.append(shell);

    const hud = createHudDirect();
    expect(shell.querySelector(HUD_SELECTORS.panel)).toBe(hud.root);

    hud.dispose();
    expect(shell.querySelector(HUD_SELECTORS.panel)).toBeNull();
    expect(() => hud.dispose()).not.toThrow();
    expect(() => hud.setEra("1965")).toThrow(/disposed/);
  });
});

/* -------------------------------------------------------------------------- */
/* Composition with the live era contract                                     */
/* -------------------------------------------------------------------------- */

describe("timeline and HUD composed against the real era contract", () => {
  it("drives the HUD readouts from the timeline's own year-change events", () => {
    const { timeline, events } = mountTimeline();
    const { hud, muteEvents } = mountHud();

    // This is the wiring scene assembly owns: UI modules only meet through
    // callbacks, never through direct imports of each other's state.
    const unsubscribe = timeline.subscribe((event) => hud.setEra(event.era));
    disposers.push(unsubscribe);

    pressKey(timeline.thumb, "End");
    expect(events.at(-1)?.era).toBe("2025");
    expect(hud.era).toBe("2025");
    expect(container.querySelector(HUD_SELECTORS.year)?.textContent).toBe(
      ERAS_BY_ID["2025"].label,
    );
    expect(container.querySelector(HUD_SELECTORS.eraName)?.textContent).toBe(
      ERAS_BY_ID["2025"].title,
    );

    click(stopButton(timeline, "1945"));
    expect(hud.era).toBe("1945");
    expect(container.querySelector(HUD_SELECTORS.eraName)?.textContent).toBe(ERAS_BY_ID["1945"].title);

    click(container.querySelector<HTMLElement>(HUD_SELECTORS.mute) as HTMLElement);
    expect(muteEvents).toEqual([{ muted: true, source: "ui" }]);

    // Every stop of the slider still mirrors the contract, year for year.
    expect(timeline.stops.map((stop) => stop.label)).toEqual(ERAS.map((era) => era.label));
    expect(timeline.stops.map((stop) => stop.year)).toEqual(ERAS.map((era) => era.year));
  });
});

/* -------------------------------------------------------------------------- */
/* Module boundaries and styling contract                                     */
/* -------------------------------------------------------------------------- */

describe("UI module boundaries and styling contract", () => {
  it("keeps the UI modules free of scene, audio and three.js imports", () => {
    const forbidden = /from\s+["'][^"']*(three|scene|audio|core\/renderer)[^"']*["']/;
    const allowed = new Set(["../era/eraTypes", "./hud", "./hud.css"]);

    for (const relative of ["src/ui/timeline.ts", "src/ui/hud.ts"]) {
      const source = readSource(relative);
      expect(forbidden.test(source), `${relative} must not import rendering code`).toBe(false);

      const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(allowed.has(specifier), `${relative} imports unexpected "${specifier}"`).toBe(true);
      }
    }

    // Both surfaces share one chrome stylesheet, so the timeline pulls it in.
    expect(readSource("src/ui/timeline.ts")).toContain('import "./hud.css"');
  });

  it("styles the chrome with focus rings, a drag-safe rail and a contrast-safe scrim", () => {
    const css = readSource("src/ui/hud.css");

    expect(css).toMatch(/\.cc-timeline__playhead:focus-visible/);
    expect(css).toMatch(/\.cc-timeline__stop:focus-visible/);
    expect(css).toMatch(/\.cc-hud__button:focus-visible/);
    expect(css).toMatch(/\.cc-hud__info-close:focus-visible/);
    expect(css).toMatch(/outline:\s*2px solid/);
    expect(css).toMatch(/\.cc-timeline__rail\s*\{[^}]*touch-action:\s*none/);
    expect(css).toMatch(/backdrop-filter:\s*blur\(/);
    expect(css).toMatch(/--cc-chrome-surface:\s*rgba\(6,\s*11,\s*22/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });

  it("relies on the shell to pin the timeline overlay to the top edge", () => {
    const shellCss = readSource("src/styles.css");
    expect(shellCss).toMatch(/\.timeline-root\s*\{[^}]*position:\s*fixed;[^}]*top:\s*0;/);
  });
});
