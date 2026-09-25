/**
 * Chrono City HUD.
 *
 * The bottom-left readout surface, mounted into the `#hud-root` overlay declared
 * by `index.html`. Like the timeline it is a dependency-free DOM module that
 * talks to the app only through callbacks - no scene, audio or three.js import -
 * so it stays importable in Node/jsdom and mountable without a renderer.
 *
 * What it renders:
 *   - the current year, era name and era tagline, fed by {@link Hud.setEra};
 *   - a sound toggle that reports every change through `onMuteToggle`;
 *   - a controls help overlay that lists the timeline and picking shortcuts;
 *   - the click-to-inspect card slot, filled through {@link Hud.showInfoCard}
 *     with plain data (the UI never imports the picking layer).
 *
 * `src/ui/timeline.ts` re-exports this module; both import paths are valid.
 */

import { ERAS, getEraConfig, type EraConfig, type EraId } from "../era/eraTypes";
import "./hud.css";

/* -------------------------------------------------------------------------- */
/* Selectors                                                                  */
/* -------------------------------------------------------------------------- */

/** Id of the overlay root `index.html` reserves for the HUD. */
export const HUD_ROOT_SELECTOR = "#hud-root";

/** `data-role` hooks for every node the HUD renders, shared with DOM tests. */
export const HUD_SELECTORS = {
  panel: '[data-role="hud-panel"]',
  readout: '[data-role="hud-readout"]',
  year: '[data-role="hud-year"]',
  eraName: '[data-role="hud-era-name"]',
  tagline: '[data-role="hud-tagline"]',
  controls: '[data-role="hud-controls"]',
  mute: '[data-role="hud-mute"]',
  muteIcon: '[data-role="hud-mute-icon"]',
  muteLabel: '[data-role="hud-mute-label"]',
  help: '[data-role="hud-help"]',
  helpPanel: '[data-role="hud-help-panel"]',
  helpList: '[data-role="hud-help-list"]',
  infoCard: '[data-role="hud-info-card"]',
  infoTitle: '[data-role="hud-info-title"]',
  infoSubtitle: '[data-role="hud-info-subtitle"]',
  infoRows: '[data-role="hud-info-rows"]',
  infoClose: '[data-role="hud-info-close"]',
} as const;

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

/** Whether a state change came from a UI control or from the API. */
export type UiInputSource = "ui" | "api";

export interface MuteToggleEvent {
  readonly muted: boolean;
  readonly source: UiInputSource;
}

export interface HelpToggleEvent {
  readonly visible: boolean;
  readonly source: UiInputSource;
}

/** One labelled value of the inspection card. */
export interface InfoCardRow {
  readonly label: string;
  readonly value: string;
}

/** Plain-data description of an inspected object. */
export interface InfoCardContent {
  /** Stable id of the inspected object, echoed back on dismissal. */
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly rows?: readonly InfoCardRow[];
  /** Optional accent (24-bit colour or CSS colour) for the card frame. */
  readonly accent?: number | string;
}

export interface InfoCardDismissEvent {
  readonly id: string | null;
}

/** One keyboard/mouse hint shown by the help overlay. */
export interface HelpItem {
  readonly keys: string;
  readonly description: string;
}

/**
 * The control list the help overlay renders.
 *
 * Kept as data so the overlay, and any future onboarding panel, stay in sync
 * with the actual bindings of the timeline module.
 */
export const HELP_ITEMS: readonly HelpItem[] = [
  { keys: "Click / tap a year", description: "Jump straight to that stop on the timeline." },
  { keys: "Drag the rail", description: "Scrub between stops with a mouse or a finger." },
  {
    keys: "← / →",
    description: "Step one era at a time; Home and End jump to 1945 and 2025.",
  },
  { keys: "1 – 5", description: "Jump to the matching stop on the timeline." },
  { keys: "Click the block", description: "Inspect a building, vehicle or sign in this card." },
  { keys: "Sound", description: "Toggle the era soundscape with the Sound control below." },
];

export interface HudOptions {
  /** Mount point; defaults to {@link HUD_ROOT_SELECTOR} in the document. */
  readonly container?: HTMLElement;
  /** Era shown on mount; defaults to the first era of the contract. */
  readonly initialEra?: EraId;
  readonly muted?: boolean;
  readonly onMuteToggle?: (event: MuteToggleEvent) => void;
  readonly onHelpToggle?: (event: HelpToggleEvent) => void;
  /** Emitted when the *user* closes the inspection card. */
  readonly onInfoCardDismiss?: (event: InfoCardDismissEvent) => void;
}

/** Live handle returned by {@link createHud}. */
export interface Hud {
  /** Panel element appended to the container; removed again by `dispose`. */
  readonly root: HTMLElement;
  readonly container: HTMLElement;
  readonly era: EraId;
  readonly muted: boolean;
  readonly helpVisible: boolean;
  readonly infoCardVisible: boolean;
  /** Updates the year/era readouts; accepts an id or a descriptor. */
  setEra(era: EraId | EraConfig): void;
  /** Sets the sound state; a no-op when it already has that value. */
  setMuted(muted: boolean, source?: UiInputSource): void;
  /** Flips the sound state; returns the new state. */
  toggleMuted(source?: UiInputSource): boolean;
  showHelp(source?: UiInputSource): void;
  hideHelp(source?: UiInputSource): void;
  /** Shows or hides the help overlay; returns the resulting visibility. */
  toggleHelp(force?: boolean, source?: UiInputSource): boolean;
  /** Fills the inspection slot and reveals it. */
  showInfoCard(content: InfoCardContent): void;
  /** Clears and hides the inspection slot. */
  hideInfoCard(): void;
  /** Removes every listener and the panel element. Idempotent. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Static, self-contained SVG strings: no icon font, no network request, and no
 * user data ever reaches `innerHTML`.
 */
const ICON_SOUND_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/><path d="M17.6 6.9a7 7 0 0 1 0 10.2"/></svg>';
const ICON_SOUND_MUTED =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M15.4 9.6l5 4.8M20.4 9.6l-5 4.8"/></svg>';
const ICON_HELP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.1.9-1.1 1.7v.3"/><path d="M12 16.9h.01"/></svg>';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Renders a 24-bit integer (or a CSS colour string) as a CSS color value.
 *
 * Scene descriptors carry colours as `0xRRGGBB` numbers, so the UI needs a
 * single place to translate them.
 */
export function toCssColor(color: number | string): string {
  if (typeof color === "string") {
    return color;
  }
  const value = Math.max(0, Math.min(0xffffff, Math.round(color)));
  return `#${value.toString(16).padStart(6, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/** Per-instance suffix so several HUDs can coexist without id clashes. */
let instanceCounter = 0;

/** Builds the HUD and mounts it into `options.container` (or `#hud-root`). */
export function createHud(options: HudOptions = {}): Hud {
  const container = resolveContainer(options.container);
  const doc = container.ownerDocument;
  const helpId = `cc-hud-help-${(instanceCounter += 1)}`;
  const signals = new AbortController();

  let eraConfig: EraConfig = getEraConfig(options.initialEra ?? ERAS[0].id);
  let muted = options.muted ?? false;
  let helpVisible = false;
  let infoCardVisible = false;
  let infoCardId: string | null = null;
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

  const panel = node("div", "cc-hud", "hud-panel");

  const readout = node("div", "cc-hud__readout", "hud-readout");
  readout.setAttribute("role", "group");
  readout.setAttribute("aria-label", "Current era");
  const yearNode = node("p", "cc-hud__year", "hud-year");
  const eraNameNode = node("p", "cc-hud__era", "hud-era-name");
  const taglineNode = node("p", "cc-hud__tagline", "hud-tagline");
  readout.append(yearNode, eraNameNode, taglineNode);

  const controls = node("div", "cc-hud__controls", "hud-controls");
  const muteButton = node("button", "cc-hud__button", "hud-mute");
  muteButton.type = "button";
  const muteIcon = node("span", "cc-hud__icon", "hud-mute-icon");
  muteIcon.setAttribute("aria-hidden", "true");
  const muteLabel = node("span", "cc-hud__mute-label", "hud-mute-label");
  muteButton.append(muteIcon, muteLabel);

  const helpButton = node("button", "cc-hud__button", "hud-help");
  helpButton.type = "button";
  helpButton.setAttribute("aria-expanded", "false");
  helpButton.setAttribute("aria-controls", helpId);
  const helpIcon = node("span", "cc-hud__icon", "hud-help-icon");
  helpIcon.setAttribute("aria-hidden", "true");
  helpIcon.innerHTML = ICON_HELP;
  const helpLabel = node("span", "cc-hud__help-label");
  helpLabel.textContent = "Controls";
  helpButton.append(helpIcon, helpLabel);
  controls.append(muteButton, helpButton);

  const helpPanel = node("section", "cc-hud__help", "hud-help-panel");
  helpPanel.id = helpId;
  helpPanel.hidden = true;
  helpPanel.tabIndex = -1;
  helpPanel.setAttribute("role", "region");
  helpPanel.setAttribute("aria-label", "Controls and shortcuts");
  const helpTitle = node("h2", "cc-hud__help-title");
  helpTitle.textContent = "Controls";
  const helpList = node("dl", "cc-hud__help-list", "hud-help-list");
  for (const item of HELP_ITEMS) {
    const term = node("dt", "cc-hud__help-keys");
    term.textContent = item.keys;
    const description = node("dd", "cc-hud__help-text");
    description.textContent = item.description;
    helpList.append(term, description);
  }
  helpPanel.append(helpTitle, helpList);

  const infoCard = node("section", "cc-hud__info-card", "hud-info-card");
  infoCard.hidden = true;
  infoCard.setAttribute("aria-live", "polite");
  infoCard.setAttribute("aria-label", "Inspection result");
  const infoHead = node("header", "cc-hud__info-head");
  const infoTitle = node("h2", "cc-hud__info-title", "hud-info-title");
  const infoClose = node("button", "cc-hud__info-close", "hud-info-close");
  infoClose.type = "button";
  infoClose.setAttribute("aria-label", "Close inspection card");
  infoClose.textContent = "✕";
  infoHead.append(infoTitle, infoClose);
  const infoSubtitle = node("p", "cc-hud__info-subtitle", "hud-info-subtitle");
  infoSubtitle.hidden = true;
  const infoRows = node("dl", "cc-hud__info-rows", "hud-info-rows");
  infoCard.append(infoHead, infoSubtitle, infoRows);

  panel.append(readout, controls, helpPanel, infoCard);
  panel.dataset.help = "closed";
  panel.dataset.infoCard = "closed";
  container.append(panel);

  /* ---- state ----------------------------------------------------------- */

  function assertLive(): void {
    if (disposed) {
      throw new Error("This Chrono City HUD handle has been disposed.");
    }
  }

  function setEra(era: EraId | EraConfig): void {
    assertLive();
    eraConfig = typeof era === "string" ? getEraConfig(era) : era;
    yearNode.textContent = eraConfig.label;
    eraNameNode.textContent = eraConfig.title;
    taglineNode.textContent = eraConfig.tagline;
    panel.dataset.era = eraConfig.id;
  }

  function renderMute(): void {
    muteButton.setAttribute("aria-pressed", muted ? "true" : "false");
    muteLabel.textContent = muted ? "Sound muted" : "Sound on";
    muteIcon.innerHTML = muted ? ICON_SOUND_MUTED : ICON_SOUND_ON;
    panel.dataset.muted = muted ? "true" : "false";
  }

  function setMuted(next: boolean, source: UiInputSource = "api"): void {
    assertLive();
    if (next === muted) {
      return;
    }
    muted = next;
    renderMute();
    options.onMuteToggle?.({ muted, source });
  }

  function toggleMuted(source: UiInputSource = "api"): boolean {
    setMuted(!muted, source);
    return muted;
  }

  function setHelpVisible(next: boolean, source: UiInputSource = "api"): boolean {
    assertLive();
    if (next === helpVisible) {
      return helpVisible;
    }
    helpVisible = next;
    helpPanel.hidden = !next;
    helpButton.setAttribute("aria-expanded", next ? "true" : "false");
    panel.dataset.help = next ? "open" : "closed";

    if (next) {
      // Move focus into the overlay so Escape (and screen readers) reach it.
      helpPanel.focus({ preventScroll: true });
    } else if (source === "ui") {
      helpButton.focus({ preventScroll: true });
    }

    options.onHelpToggle?.({ visible: helpVisible, source });
    return helpVisible;
  }

  function showHelp(source: UiInputSource = "api"): void {
    setHelpVisible(true, source);
  }

  function hideHelp(source: UiInputSource = "api"): void {
    setHelpVisible(false, source);
  }

  function toggleHelp(force?: boolean, source: UiInputSource = "api"): boolean {
    return setHelpVisible(force ?? !helpVisible, source);
  }

  function showInfoCard(content: InfoCardContent): void {
    assertLive();
    infoCardId = content.id ?? null;
    infoTitle.textContent = content.title;

    if (content.subtitle) {
      infoSubtitle.textContent = content.subtitle;
      infoSubtitle.hidden = false;
    } else {
      infoSubtitle.textContent = "";
      infoSubtitle.hidden = true;
    }

    infoRows.replaceChildren(...buildRows(doc, content.rows ?? []));

    if (content.accent === undefined) {
      infoCard.style.removeProperty("--cc-info-accent");
    } else {
      infoCard.style.setProperty("--cc-info-accent", toCssColor(content.accent));
    }

    infoCard.hidden = false;
    infoCardVisible = true;
    panel.dataset.infoCard = "open";
  }

  function hideInfoCard(): void {
    assertLive();
    if (!infoCardVisible) {
      return;
    }
    infoCardVisible = false;
    infoCardId = null;
    infoCard.hidden = true;
    infoTitle.textContent = "";
    infoSubtitle.textContent = "";
    infoSubtitle.hidden = true;
    infoRows.replaceChildren();
    panel.dataset.infoCard = "closed";
  }

  /** User-driven close: hides the card and reports the object that was cleared. */
  function dismissInfoCard(): void {
    if (!infoCardVisible) {
      return;
    }
    const id = infoCardId;
    hideInfoCard();
    options.onInfoCardDismiss?.({ id });
  }

  /* ---- wiring ---------------------------------------------------------- */

  muteButton.addEventListener("click", () => toggleMuted("ui"), { signal: signals.signal });
  helpButton.addEventListener("click", () => toggleHelp(undefined, "ui"), { signal: signals.signal });
  helpPanel.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hideHelp("ui");
      }
    },
    { signal: signals.signal },
  );
  infoClose.addEventListener("click", dismissInfoCard, { signal: signals.signal });
  infoCard.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissInfoCard();
      }
    },
    { signal: signals.signal },
  );

  setEra(eraConfig);
  renderMute();

  /* ---- handle ---------------------------------------------------------- */

  return Object.freeze({
    root: panel,
    container,
    get era() {
      return eraConfig.id;
    },
    get muted() {
      return muted;
    },
    get helpVisible() {
      return helpVisible;
    },
    get infoCardVisible() {
      return infoCardVisible;
    },
    setEra,
    setMuted,
    toggleMuted,
    showHelp,
    hideHelp,
    toggleHelp,
    showInfoCard,
    hideInfoCard,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      signals.abort();
      panel.remove();
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Helper internals                                                           */
/* -------------------------------------------------------------------------- */

/** Builds the `<dt>`/`<dd>` pairs of the inspection card. */
function buildRows(doc: Document, rows: readonly InfoCardRow[]): readonly Node[] {
  const nodes: Node[] = [];
  for (const row of rows) {
    const term = doc.createElement("dt");
    term.textContent = row.label;
    const value = doc.createElement("dd");
    value.textContent = row.value;
    nodes.push(term, value);
  }
  return nodes;
}

/** Resolves the mount point, failing loudly when the shell is incomplete. */
function resolveContainer(container: HTMLElement | undefined): HTMLElement {
  if (container) {
    return container;
  }
  if (typeof document === "undefined") {
    throw new Error("createHud needs a container to mount into outside the browser.");
  }
  const root = document.querySelector<HTMLElement>(HUD_ROOT_SELECTOR);
  if (!root) {
    throw new Error(`createHud could not find ${HUD_ROOT_SELECTOR}; pass a container instead.`);
  }
  return root;
}
