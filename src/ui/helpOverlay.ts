/**
 * Chrono City — controls help overlay.
 *
 * The panel behind the HUD's "?" button: a compact, glassy cheat-sheet for the
 * timeline, the camera rig and the sound controls. It is a passive view — it
 * owns no scene state — and it deliberately stays a *corner panel* rather than
 * a full-screen modal so the timeline slider and the city stay usable while it
 * is open (the acceptance criterion is explicit about that).
 *
 * Lifecycle:
 *   create    → `createHelpOverlay()` / `new HelpOverlay(options)`.
 *   consume   → `open()` / `close()` / `toggle()` / `setNavigationMode()`.
 *   integrate → `HudApi` mounts one overlay, flips it from the HUD button and
 *               keeps the navigation section in step with `NavigationRig.mode`.
 */

export const HELP_OVERLAY_VERSION = 1;

/** Root attribute marking the help overlay (and its sections). */
export const HELP_ATTRIBUTE = 'data-chrono-help';

/** Stable query hooks so browser specs never depend on class names. */
export const HELP_SELECTORS = Object.freeze({
  root: `[${HELP_ATTRIBUTE}="root"]`,
  section: `[${HELP_ATTRIBUTE}="section"]`,
  item: `[${HELP_ATTRIBUTE}="item"]`,
  keys: `[${HELP_ATTRIBUTE}="keys"]`,
  action: `[${HELP_ATTRIBUTE}="action"]`,
  close: `[${HELP_ATTRIBUTE}="close"]`,
  title: `[${HELP_ATTRIBUTE}="title"]`,
});

/** One keyboard/mouse affordance: the keys plus what they do. */
export interface HelpItem {
  readonly keys: readonly string[];
  readonly action: string;
}

/** A titled group of affordances. */
export interface HelpSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly HelpItem[];
}

export interface HelpOverlayOptions {
  /** Element the overlay is appended to. Defaults to `[data-chrono-overlay]`. */
  readonly root?: HTMLElement;
  readonly document?: Document;
  /** Section table. Defaults to `defaultHelpSections()`. */
  readonly sections?: readonly HelpSection[];
  /** Panel heading. Defaults to `Controls`. */
  readonly title?: string;
  /** Start open instead of hidden. Defaults to `false`. */
  readonly open?: boolean;
  /** Called whenever the overlay opens or closes. */
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * The default cheat-sheet. `mode` mirrors `NavigationRig.mode` so the copy
 * describes the controls that are actually live (`F` walks, or returns to orbit).
 */
export function defaultHelpSections(mode = 'orbit'): readonly HelpSection[] {
  const walking = mode === 'walk';
  return Object.freeze([
    {
      id: 'timeline',
      title: 'Timeline',
      items: [
        { keys: ['Click', 'Tab'], action: 'Focus the slider and pick a year stop' },
        { keys: ['Drag'], action: 'Scrub across years and snap to a stop' },
        { keys: ['←', '→'], action: 'Step one year from the focused slider' },
        { keys: ['Home', 'End'], action: 'Jump to 1945 or 2025' },
        { keys: ['Enter', 'Space'], action: 'Re-announce the active era' },
      ],
    },
    {
      id: 'navigation',
      title: 'Camera',
      items: [
        { keys: ['Drag'], action: 'Orbit the city block' },
        { keys: ['Wheel'], action: 'Zoom in and out' },
        { keys: ['F'], action: walking ? 'Return to the orbit view' : 'Enter first-person walk mode' },
        { keys: ['W', 'A', 'S', 'D'], action: 'Walk the block (walk mode)' },
      ],
    },
    {
      id: 'sound',
      title: 'Sound & HUD',
      items: [
        { keys: ['H'], action: 'Show or hide this panel' },
        { keys: ['M'], action: 'Mute or unmute the experience' },
        { keys: ['Esc'], action: 'Close this panel' },
        { keys: ['🔊'], action: 'Unlock audio on the first gesture' },
      ],
    },
  ]);
}

/* ------------------------------------------------------------------------- *
 * DOM helpers
 * ------------------------------------------------------------------------- */

function createElement<K extends keyof HTMLElementTagNameMap>(
  documentRef: Document,
  tag: K,
  className?: string,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function resolveDocument(options: HelpOverlayOptions): Document {
  if (options.document) return options.document;
  if (options.root?.ownerDocument) return options.root.ownerDocument;
  if (typeof document !== 'undefined') return document;
  throw new Error('createHelpOverlay() needs a DOM document.');
}

function resolveRoot(documentRef: Document, provided?: HTMLElement): HTMLElement {
  if (provided) return provided;
  const existing = documentRef.querySelector<HTMLElement>('[data-chrono-overlay]');
  if (existing) return existing;
  if (documentRef.body) return documentRef.body;
  throw new Error('createHelpOverlay() needs an overlay root or a document body.');
}

/* ------------------------------------------------------------------------- *
 * HelpOverlay
 * ------------------------------------------------------------------------- */

/** The controls cheat-sheet panel. */
export class HelpOverlay {
  readonly version = HELP_OVERLAY_VERSION;

  /** Root element (`<aside>`), always present; visibility is toggled with `hidden`. */
  readonly root: HTMLElement;
  /** The glassy panel itself. */
  readonly panel: HTMLElement;
  /** Heading element. */
  readonly titleElement: HTMLElement;
  /** Close button. */
  readonly closeButton: HTMLButtonElement;

  private readonly documentRef: Document;
  private readonly onOpenChange: ((open: boolean) => void) | undefined;
  private sectionsList: readonly HelpSection[];
  private sectionsContainer: HTMLElement | null = null;
  private openState = false;
  private disposedState = false;
  private restoreFocus: HTMLElement | null = null;

  constructor(options: HelpOverlayOptions = {}) {
    this.documentRef = resolveDocument(options);
    this.onOpenChange = options.onOpenChange;
    this.sectionsList = options.sections ?? defaultHelpSections();

    const root = createElement(this.documentRef, 'aside', 'chrono-help', {
      [HELP_ATTRIBUTE]: 'root',
      'aria-hidden': 'true',
      hidden: '',
    });
    Object.assign(root.style, {
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const panel = createElement(this.documentRef, 'div', 'chrono-help__panel chrono-panel', {
      [HELP_ATTRIBUTE]: 'panel',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-label': options.title ?? 'Controls',
    });
    Object.assign(panel.style, {
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const header = createElement(this.documentRef, 'header', 'chrono-help__header');
    const title = createElement(this.documentRef, 'h2', 'chrono-help__title', {
      [HELP_ATTRIBUTE]: 'title',
    });
    title.textContent = options.title ?? 'Controls';

    const close = createElement(this.documentRef, 'button', 'chrono-help__close', {
      type: 'button',
      [HELP_ATTRIBUTE]: 'close',
      'aria-label': 'Close controls help',
    });
    close.textContent = '✕';
    close.addEventListener('click', this.handleClose);

    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    this.sectionsContainer = createElement(this.documentRef, 'div', 'chrono-help__sections');
    panel.appendChild(this.sectionsContainer);
    this.renderSections();

    const hint = createElement(this.documentRef, 'p', 'chrono-help__hint');
    hint.textContent = 'Press H to hide · Esc to close';
    panel.appendChild(hint);

    root.appendChild(panel);
    resolveRoot(this.documentRef, options.root).appendChild(root);

    this.root = root;
    this.panel = panel;
    this.titleElement = title;
    this.closeButton = close;

    this.documentRef.addEventListener('keydown', this.handleKeyDown);
    if (options.open) this.open();
  }

  /** `true` while the panel is visible. */
  get isOpen(): boolean {
    return this.openState;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Section table currently rendered. */
  get sections(): readonly HelpSection[] {
    return this.sectionsList;
  }

  /** Shows the panel and moves focus to its close button. */
  open(): void {
    if (this.disposedState || this.openState) return;
    this.openState = true;
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.dataset.chronoHelpState = 'open';
    const active = this.documentRef.activeElement;
    this.restoreFocus = active instanceof HTMLElement ? active : null;
    try {
      this.closeButton.focus({ preventScroll: true });
    } catch {
      this.closeButton.focus();
    }
    this.onOpenChange?.(true);
  }

  /** Hides the panel and restores the previously focused element. */
  close(): void {
    if (this.disposedState || !this.openState) return;
    this.openState = false;
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.dataset.chronoHelpState = 'closed';
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore && restore.isConnected !== false) {
      try {
        restore.focus({ preventScroll: true });
      } catch {
        restore.focus();
      }
    }
    this.onOpenChange?.(false);
  }

  /** Flips the panel; returns the new open state. */
  toggle(): boolean {
    if (this.openState) this.close();
    else this.open();
    return this.openState;
  }

  /**
   * Replaces the section table. Navigation copy follows the rig mode, so the
   * caller re-renders when the mode changes.
   */
  setSections(sections: readonly HelpSection[]): void {
    this.sectionsList = sections;
    this.renderSections();
  }

  /** Re-renders the navigation section for the live rig mode. */
  setNavigationMode(mode: string): void {
    if (this.root.dataset.chronoHelpMode === mode) return;
    this.root.dataset.chronoHelpMode = mode;
    this.setSections(defaultHelpSections(mode));
  }

  /** Removes listeners and the root element. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.documentRef.removeEventListener('keydown', this.handleKeyDown);
    this.closeButton.removeEventListener('click', this.handleClose);
    this.root.remove();
  }

  /* ---------------- internals ---------------- */

  private renderSections(): void {
    const container = this.sectionsContainer;
    if (!container) return;
    container.textContent = '';
    for (const section of this.sectionsList) {
      const element = createElement(this.documentRef, 'section', 'chrono-help__section', {
        [HELP_ATTRIBUTE]: 'section',
        'data-chrono-help-section': section.id,
      });
      const heading = createElement(this.documentRef, 'h3', 'chrono-help__section-title');
      heading.textContent = section.title;
      element.appendChild(heading);

      for (const item of section.items) {
        const row = createElement(this.documentRef, 'div', 'chrono-help__item', {
          [HELP_ATTRIBUTE]: 'item',
        });
        const keys = createElement(this.documentRef, 'span', 'chrono-help__keys', {
          [HELP_ATTRIBUTE]: 'keys',
        });
        for (const key of item.keys) {
          const chip = createElement(this.documentRef, 'kbd', 'chrono-help__key');
          chip.textContent = key;
          keys.appendChild(chip);
        }
        const action = createElement(this.documentRef, 'span', 'chrono-help__action', {
          [HELP_ATTRIBUTE]: 'action',
        });
        action.textContent = item.action;
        row.appendChild(keys);
        row.appendChild(action);
        element.appendChild(row);
      }
      container.appendChild(element);
    }
  }

  private readonly handleClose = (): void => {
    this.close();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.openState) return;
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.close();
  };
}

/** Creates one help overlay (`create` half of the lifecycle). */
export function createHelpOverlay(options: HelpOverlayOptions = {}): HelpOverlay {
  return new HelpOverlay(options);
}
