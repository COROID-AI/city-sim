/**
 * Chrono City — first-run control hints.
 *
 * The "here is how you drive this" card a visitor sees exactly once: orbit and
 * walk the block, click a fixture to inspect it, and scrub the timeline. It is
 * a corner panel (never a modal) so the intro flythrough and the city stay
 * visible behind it, and its dismissal is persisted, so a reload does not nag
 * the visitor a second time.
 *
 * Nothing here touches the scene: the card is passive DOM, which is why it can
 * be unit-tested against jsdom and why `TourApi` can mount it on the same
 * overlay root the HUD uses.
 *
 * Lifecycle:
 *   create    → `createOnboardingHints()` / `new OnboardingHints(options)`.
 *   consume   → `shouldShow()`, `show()`, `dismiss(reason)`, `reset()`,
 *               `snapshot()`.
 *   integrate → `TourApi` mounts one card, shows it on the first run and
 *               dismisses it on the first real input.
 *
 * Persistence is deliberately storage-agnostic: the card talks to a tiny
 * `OnboardingStorage` interface (localStorage by default, an in-memory map in
 * hosts without one), so a blocked or full `localStorage` degrades to
 * "shows again next session" instead of throwing.
 */

export const ONBOARDING_HINTS_VERSION = 1;

/** Where the "already seen it" flag lives. */
export const ONBOARDING_STORAGE_KEY = 'chrono-city:onboarding-hints:v1';

/** Root attribute marking the hint card (and its parts). */
export const ONBOARDING_ATTRIBUTE = 'data-chrono-hints';

/** Stable query hooks so browser specs never depend on class names. */
export const ONBOARDING_SELECTORS = Object.freeze({
  root: `[${ONBOARDING_ATTRIBUTE}="root"]`,
  card: `[${ONBOARDING_ATTRIBUTE}="card"]`,
  title: `[${ONBOARDING_ATTRIBUTE}="title"]`,
  section: `[${ONBOARDING_ATTRIBUTE}="section"]`,
  item: `[${ONBOARDING_ATTRIBUTE}="item"]`,
  keys: `[${ONBOARDING_ATTRIBUTE}="keys"]`,
  action: `[${ONBOARDING_ATTRIBUTE}="action"]`,
  dismiss: `[${ONBOARDING_ATTRIBUTE}="dismiss"]`,
  note: `[${ONBOARDING_ATTRIBUTE}="note"]`,
});

/** Default panel heading. */
export const ONBOARDING_TITLE = 'Welcome to Chrono City';

/** Default one-line lead-in, shown above the control list. */
export const ONBOARDING_LEAD =
  'Five eras of one city block. Fly in, then take the controls — anything you touch ends the tour instantly.';

/** Default dismissal button label. */
export const ONBOARDING_DISMISS_LABEL = 'Got it — let me explore';

/** Why the card went away; recorded so the dismissal is auditable. */
export type OnboardingDismissReason = 'user' | 'input' | 'timeout' | 'programmatic';

/* ------------------------------------------------------------------------- *
 * Content
 * ------------------------------------------------------------------------- */

/** One keyboard / pointer affordance: the keys, plus what they do. */
export interface ControlHint {
  readonly id: string;
  readonly keys: readonly string[];
  readonly action: string;
}

/** A titled group of affordances. */
export interface OnboardingSection {
  readonly id: string;
  readonly title: string;
  readonly hints: readonly ControlHint[];
}

/**
 * The first-run cheat sheet: navigation, inspection and the timeline. Kept to
 * the affordances a newcomer needs in the first minute; the HUD's help overlay
 * (`H`) remains the full reference.
 */
export function defaultOnboardingSections(): readonly OnboardingSection[] {
  return Object.freeze([
    {
      id: 'move',
      title: 'Move',
      hints: [
        { id: 'orbit', keys: ['Drag'], action: 'Orbit around the block' },
        { id: 'zoom', keys: ['Wheel', 'Pinch'], action: 'Zoom in and out' },
        { id: 'look', keys: ['Drag'], action: 'Look around in walk mode' },
        { id: 'walk', keys: ['W', 'A', 'S', 'D', 'Shift'], action: 'Walk the block, shift to run' },
        { id: 'mode', keys: ['F'], action: 'Swap between orbit and first-person walk' },
      ],
    },
    {
      id: 'inspect',
      title: 'Inspect',
      hints: [
        { id: 'hover', keys: ['Hover'], action: 'Highlight what you are pointing at' },
        { id: 'click', keys: ['Click'], action: 'Open an info card for that fixture' },
      ],
    },
    {
      id: 'time',
      title: 'Travel through time',
      hints: [
        { id: 'slider', keys: ['Click', 'Drag'], action: 'Pick 1945 · 1965 · 1985 · 2005 · 2025 up top' },
        { id: 'keys', keys: ['←', '→'], action: 'Step one year from the slider' },
        { id: 'tour', keys: ['T'], action: 'Start or stop the automatic time-tour' },
      ],
    },
    {
      id: 'extras',
      title: 'Sound & help',
      hints: [
        { id: 'help', keys: ['H'], action: 'Show the full controls' },
        { id: 'mute', keys: ['M'], action: 'Mute or unmute the city' },
      ],
    },
  ]);
}

/** Total number of hints across every section (used by the snapshot). */
export function countHints(sections: readonly OnboardingSection[]): number {
  return sections.reduce((total, section) => total + section.hints.length, 0);
}

/* ------------------------------------------------------------------------- *
 * Storage
 * ------------------------------------------------------------------------- */

/** The slice of the Web Storage API the card needs. */
export interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The persisted "have they seen this?" record. */
export interface OnboardingRecord {
  readonly version: number;
  readonly showCount: number;
  readonly shownAt: number;
  readonly dismissed: boolean;
  readonly dismissedAt: number | null;
  readonly reason: OnboardingDismissReason | null;
}

/** A plain in-memory store: the fallback, and what tests use for isolation. */
export function createMemoryStorage(): OnboardingStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/**
 * The host's `localStorage`, or `null` when the environment blocks it (private
 * mode, disabled storage, sandboxed iframes). Never throws.
 */
export function resolveHostStorage(): OnboardingStorage | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Decodes a stored record; malformed or foreign payloads read as "never seen". */
export function readOnboardingRecord(
  storage: OnboardingStorage | null,
  key: string = ONBOARDING_STORAGE_KEY,
): OnboardingRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Partial<OnboardingRecord>;
    if (record.version !== ONBOARDING_HINTS_VERSION) return null;
    return {
      version: ONBOARDING_HINTS_VERSION,
      showCount: Number.isFinite(record.showCount) ? Number(record.showCount) : 0,
      shownAt: Number.isFinite(record.shownAt) ? Number(record.shownAt) : 0,
      dismissed: record.dismissed === true,
      dismissedAt: Number.isFinite(record.dismissedAt) ? Number(record.dismissedAt) : null,
      reason: typeof record.reason === 'string' ? (record.reason as OnboardingDismissReason) : null,
    };
  } catch {
    return null;
  }
}

/** Writes a record back; returns `false` when the host refused to persist it. */
export function writeOnboardingRecord(
  storage: OnboardingStorage | null,
  record: OnboardingRecord,
  key: string = ONBOARDING_STORAGE_KEY,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Forgets a record (used by `reset()` and by tests). */
export function clearOnboardingRecord(
  storage: OnboardingStorage | null,
  key: string = ONBOARDING_STORAGE_KEY,
): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* A host that refuses to delete is a host we simply cannot reset. */
  }
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

function resolveDocument(options: OnboardingHintsOptions): Document {
  if (options.document) return options.document;
  if (options.root?.ownerDocument) return options.root.ownerDocument;
  if (typeof document !== 'undefined') return document;
  throw new Error('createOnboardingHints() needs a DOM document.');
}

function resolveRoot(documentRef: Document, provided?: HTMLElement | null): HTMLElement {
  if (provided) return provided;
  const existing = documentRef.querySelector<HTMLElement>('[data-chrono-overlay]');
  if (existing) return existing;
  if (documentRef.body) return documentRef.body;
  throw new Error('createOnboardingHints() needs an overlay root or a document body.');
}

/**
 * Inline styling keeps the card self-contained: the tour layer adds no
 * stylesheet and inherits the shell tokens declared in `src/app.css`.
 */
const CARD_CSS = [
  'box-sizing:border-box',
  'width:min(360px,calc(100vw - 36px))',
  'max-height:min(78vh,560px)',
  'overflow:auto',
  'padding:18px 20px 16px',
  'border-radius:16px',
  'border:1px solid rgba(111,211,255,0.28)',
  'background:rgba(6,12,22,0.82)',
  'color:var(--chrono-ink,#e8eef7)',
  "font:400 12px/1.5 'Inter','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif",
  'box-shadow:0 22px 56px rgba(2,6,16,0.6)',
  'backdrop-filter:blur(14px)',
  'pointer-events:auto',
  'animation:chrono-onboarding-in 420ms ease-out both',
].join(';');

const ROOT_CSS = [
  'position:absolute',
  'left:22px',
  'bottom:22px',
  'z-index:14',
  'pointer-events:none',
].join(';');

/** One-time keyframes for the reveal, injected once per document. */
const REVEAL_KEYFRAMES = `@keyframes chrono-onboarding-in {
  from { opacity: 0; transform: translate3d(0, 14px, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}`;

function ensureRevealStyles(documentRef: Document, styleId: string): void {
  if (documentRef.getElementById(styleId)) return;
  const style = documentRef.createElement('style');
  style.id = styleId;
  style.textContent = REVEAL_KEYFRAMES;
  (documentRef.head ?? documentRef.body)?.appendChild(style);
}

/* ------------------------------------------------------------------------- *
 * OnboardingHints
 * ------------------------------------------------------------------------- */

/** Flat, serialisable view of the card, for tests and browser harnesses. */
export interface OnboardingSnapshot {
  readonly version: number;
  readonly visible: boolean;
  readonly dismissed: boolean;
  readonly wasShown: boolean;
  readonly showCount: number;
  readonly reason: OnboardingDismissReason | null;
  /** `true` when the flag really reached persistent storage. */
  readonly persisted: boolean;
  readonly hintCount: number;
}

export interface OnboardingHintsOptions {
  /** Element the card is appended to. Defaults to `[data-chrono-overlay]`, then `<body>`. */
  readonly root?: HTMLElement | null;
  readonly document?: Document | null;
  /** Hint groups to render. Defaults to `defaultOnboardingSections()`. */
  readonly sections?: readonly OnboardingSection[];
  readonly title?: string;
  readonly lead?: string;
  readonly note?: string;
  readonly dismissLabel?: string;
  /**
   * Storage to remember the dismissal in. Defaults to the host's
   * `localStorage`, then an in-memory map. Pass `null` to never persist.
   */
  readonly storage?: OnboardingStorage | null;
  readonly storageKey?: string;
  /** Write the flag to storage. Defaults to `true`. */
  readonly persist?: boolean;
  /** How many times the card may ever appear. Defaults to `1` ("first run"). */
  readonly maxShows?: number;
  /** Show during construction when the visitor has not seen it. Defaults to `false`. */
  readonly autoShow?: boolean;
  /** Auto-dismiss after this many milliseconds; `0` (the default) keeps it up. */
  readonly autoDismissMs?: number;
  /** Dismiss as soon as the visitor interacts anywhere. Defaults to `true`. */
  readonly dismissOnInput?: boolean;
  /** Called when the card becomes visible. */
  readonly onShow?: () => void;
  /** Called when the card is dismissed, with the reason. */
  readonly onDismiss?: (reason: OnboardingDismissReason) => void;
}

/**
 * The first-run control card. One instance owns one DOM subtree plus one
 * persisted flag; everything else is read through `snapshot()`.
 */
export class OnboardingHints {
  readonly version = ONBOARDING_HINTS_VERSION;

  /** Root element (`<div>`); visibility is toggled with `hidden`. */
  readonly root: HTMLElement;
  /** The glassy card itself. */
  readonly card: HTMLElement;
  /** Heading element. */
  readonly titleElement: HTMLElement;
  /** Dismissal button. */
  readonly dismissButton: HTMLButtonElement;

  private readonly documentRef: Document;
  private readonly sectionsList: readonly OnboardingSection[];
  private readonly storage: OnboardingStorage | null;
  private readonly storageKey: string;
  private readonly maxShows: number;
  private readonly autoDismissMs: number;
  private readonly dismissOnInput: boolean;
  private readonly onShowCallback: (() => void) | undefined;
  private readonly onDismissCallback: ((reason: OnboardingDismissReason) => void) | undefined;

  private record: OnboardingRecord | null;
  private visibleState = false;
  private persistedState = false;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private disposedState = false;

  constructor(options: OnboardingHintsOptions = {}) {
    this.documentRef = resolveDocument(options);
    this.sectionsList = options.sections ?? defaultOnboardingSections();
    this.storageKey = options.storageKey ?? ONBOARDING_STORAGE_KEY;
    const persist = options.persist ?? true;
    this.storage = persist ? (options.storage === undefined ? resolveHostStorage() : options.storage) : null;
    this.maxShows = Math.max(1, Math.floor(options.maxShows ?? 1));
    this.autoDismissMs = Math.max(0, options.autoDismissMs ?? 0);
    this.dismissOnInput = options.dismissOnInput ?? true;
    this.onShowCallback = options.onShow;
    this.onDismissCallback = options.onDismiss;
    this.record = readOnboardingRecord(this.storage, this.storageKey);

    ensureRevealStyles(this.documentRef, 'chrono-onboarding-keyframes');

    const root = createElement(this.documentRef, 'div', 'chrono-onboarding', {
      [ONBOARDING_ATTRIBUTE]: 'root',
      'data-chrono-hints-state': 'hidden',
      hidden: '',
    });
    root.style.cssText = ROOT_CSS;

    const card = createElement(this.documentRef, 'div', 'chrono-onboarding__card chrono-panel', {
      [ONBOARDING_ATTRIBUTE]: 'card',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-label': options.title ?? ONBOARDING_TITLE,
    });
    card.style.cssText = CARD_CSS;

    const title = createElement(this.documentRef, 'h2', 'chrono-onboarding__title', {
      [ONBOARDING_ATTRIBUTE]: 'title',
    });
    title.textContent = options.title ?? ONBOARDING_TITLE;
    title.style.cssText =
      'margin:0 0 6px;font-size:15px;font-weight:600;letter-spacing:0.01em;color:var(--chrono-accent,#6fd3ff)';
    card.appendChild(title);

    const lead = createElement(this.documentRef, 'p', 'chrono-onboarding__lead', {
      'data-chrono-hints-lead': 'true',
    });
    lead.textContent = options.lead ?? ONBOARDING_LEAD;
    lead.style.cssText = 'margin:0 0 12px;color:var(--chrono-muted,rgba(232,238,247,0.66))';
    card.appendChild(lead);

    for (const section of this.sectionsList) {
      card.appendChild(this.buildSection(section));
    }

    const note = createElement(this.documentRef, 'p', 'chrono-onboarding__note', {
      [ONBOARDING_ATTRIBUTE]: 'note',
    });
    note.textContent = options.note ?? 'Press H any time for the full controls.';
    note.style.cssText =
      'margin:12px 0 0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--chrono-muted,rgba(232,238,247,0.5))';
    card.appendChild(note);

    const footer = createElement(this.documentRef, 'div', 'chrono-onboarding__footer');
    footer.style.cssText = 'margin-top:14px;display:flex;justify-content:flex-end';
    const dismiss = createElement(this.documentRef, 'button', 'chrono-onboarding__dismiss', {
      type: 'button',
      [ONBOARDING_ATTRIBUTE]: 'dismiss',
    });
    dismiss.textContent = options.dismissLabel ?? ONBOARDING_DISMISS_LABEL;
    dismiss.style.cssText = [
      'padding:9px 16px',
      'border-radius:999px',
      'border:1px solid rgba(111,211,255,0.42)',
      'background:rgba(111,211,255,0.14)',
      'color:inherit',
      'font:600 11px/1 inherit',
      'letter-spacing:0.1em',
      'text-transform:uppercase',
      'cursor:pointer',
    ].join(';');
    dismiss.addEventListener('click', this.handleDismissClick);
    footer.appendChild(dismiss);
    card.appendChild(footer);

    root.appendChild(card);
    resolveRoot(this.documentRef, options.root).appendChild(root);

    this.root = root;
    this.card = card;
    this.titleElement = title;
    this.dismissButton = dismiss;

    this.documentRef.addEventListener('keydown', this.handleKeyDown, true);
    if (this.dismissOnInput) {
      this.documentRef.addEventListener('pointerdown', this.handleInput, true);
      this.documentRef.addEventListener('touchstart', this.handleInput, true);
    }
    this.syncDomState();

    if (options.autoShow ?? false) this.show();
  }

  /* ---------------- state ---------------- */

  /** `true` while the card is on screen. */
  get isVisible(): boolean {
    return this.visibleState;
  }

  /** `true` once the visitor has dismissed it (this session or a past one). */
  get isDismissed(): boolean {
    return this.record?.dismissed === true;
  }

  /** `true` when the card has ever been displayed to this visitor. */
  get wasShown(): boolean {
    return (this.record?.showCount ?? 0) > 0;
  }

  /** How many times it has been displayed. */
  get showCount(): number {
    return this.record?.showCount ?? 0;
  }

  /** Reason recorded for the last dismissal, if any. */
  get dismissalReason(): OnboardingDismissReason | null {
    return this.record?.reason ?? null;
  }

  get sections(): readonly OnboardingSection[] {
    return this.sectionsList;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /**
   * `true` when this visitor should still be shown the card: never seen it, or
   * seen fewer times than `maxShows`, and not already dismissed.
   */
  shouldShow(): boolean {
    const record = this.record;
    if (!record) return true;
    if (record.dismissed) return false;
    return record.showCount < this.maxShows;
  }

  /* ---------------- lifecycle ---------------- */

  /** Displays the card. Returns `false` when it should not (or cannot) show. */
  show(): boolean {
    if (this.disposedState) return false;
    if (this.visibleState) return true;
    if (!this.shouldShow()) return false;

    const now = Date.now();
    const next: OnboardingRecord = {
      version: ONBOARDING_HINTS_VERSION,
      showCount: (this.record?.showCount ?? 0) + 1,
      shownAt: now,
      dismissed: false,
      dismissedAt: null,
      reason: null,
    };
    this.persistedState = writeOnboardingRecord(this.storage, next, this.storageKey);
    this.record = next;

    this.visibleState = true;
    this.root.hidden = false;
    this.syncDomState();
    if (this.autoDismissMs > 0) {
      this.autoDismissTimer = setTimeout(() => this.dismiss('timeout'), this.autoDismissMs);
    }
    try {
      this.onShowCallback?.();
    } catch (error) {
      console.warn('[chrono-city] onboarding: onShow callback failed', error);
    }
    return true;
  }

  /**
   * Hides the card and persists the dismissal, so the next reload stays quiet.
   * Returns `false` when there was nothing to dismiss.
   */
  dismiss(reason: OnboardingDismissReason = 'user'): boolean {
    if (this.disposedState) return false;
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }

    const wasVisible = this.visibleState;
    const alreadyDismissed = this.record?.dismissed === true;
    this.visibleState = false;
    this.root.hidden = true;

    const next: OnboardingRecord = {
      version: ONBOARDING_HINTS_VERSION,
      showCount: this.record?.showCount ?? 0,
      shownAt: this.record?.shownAt ?? Date.now(),
      dismissed: true,
      dismissedAt: Date.now(),
      reason,
    };
    this.persistedState = writeOnboardingRecord(this.storage, next, this.storageKey);
    this.record = next;
    this.syncDomState();

    if (!wasVisible && alreadyDismissed) return false;
    try {
      this.onDismissCallback?.(reason);
    } catch (error) {
      console.warn('[chrono-city] onboarding: onDismiss callback failed', error);
    }
    return true;
  }

  /** Forgets the persisted flag and hides the card, so it can show again. */
  reset(): void {
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    clearOnboardingRecord(this.storage, this.storageKey);
    this.record = null;
    this.persistedState = false;
    this.visibleState = false;
    this.root.hidden = true;
    this.syncDomState();
  }

  /** Removes listeners and the element. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    this.documentRef.removeEventListener('keydown', this.handleKeyDown, true);
    this.documentRef.removeEventListener('pointerdown', this.handleInput, true);
    this.documentRef.removeEventListener('touchstart', this.handleInput, true);
    this.dismissButton.removeEventListener('click', this.handleDismissClick);
    this.root.remove();
  }

  /** Flat view of the card for tests and browser harnesses. */
  snapshot(): OnboardingSnapshot {
    return {
      version: ONBOARDING_HINTS_VERSION,
      visible: this.visibleState,
      dismissed: this.isDismissed,
      wasShown: this.wasShown,
      showCount: this.showCount,
      reason: this.dismissalReason,
      persisted: this.persistedState,
      hintCount: countHints(this.sectionsList),
    };
  }

  /* ---------------- internals ---------------- */

  private buildSection(section: OnboardingSection): HTMLElement {
    const element = createElement(this.documentRef, 'section', 'chrono-onboarding__section', {
      [ONBOARDING_ATTRIBUTE]: 'section',
      'data-chrono-hints-section': section.id,
    });
    element.style.cssText = 'margin-top:10px';

    const heading = createElement(this.documentRef, 'h3', 'chrono-onboarding__section-title');
    heading.textContent = section.title;
    heading.style.cssText =
      'margin:0 0 6px;font-size:10px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:var(--chrono-muted,rgba(232,238,247,0.55))';
    element.appendChild(heading);

    for (const hint of section.hints) {
      const row = createElement(this.documentRef, 'div', 'chrono-onboarding__item', {
        [ONBOARDING_ATTRIBUTE]: 'item',
      });
      row.style.cssText = 'display:flex;align-items:baseline;gap:10px;padding:2px 0';

      const keys = createElement(this.documentRef, 'span', 'chrono-onboarding__keys', {
        [ONBOARDING_ATTRIBUTE]: 'keys',
      });
      keys.style.cssText = 'display:flex;gap:4px;flex:0 0 auto';
      for (const key of hint.keys) {
        const chip = createElement(this.documentRef, 'kbd', 'chrono-onboarding__key');
        chip.textContent = key;
        chip.style.cssText = [
          'min-width:18px',
          'padding:2px 6px',
          'border-radius:6px',
          'border:1px solid rgba(111,211,255,0.24)',
          'background:rgba(111,211,255,0.08)',
          'font:600 10px/1.4 inherit',
          'text-align:center',
        ].join(';');
        keys.appendChild(chip);
      }

      const action = createElement(this.documentRef, 'span', 'chrono-onboarding__action', {
        [ONBOARDING_ATTRIBUTE]: 'action',
      });
      action.textContent = hint.action;
      action.style.cssText = 'color:var(--chrono-ink,#e8eef7)';

      row.appendChild(keys);
      row.appendChild(action);
      element.appendChild(row);
    }
    return element;
  }

  /** `dataset`/attribute mirrors so Playwright can assert state without classes. */
  private syncDomState(): void {
    const state = this.visibleState ? 'visible' : this.isDismissed ? 'dismissed' : 'hidden';
    this.root.dataset.chronoHintsState = state;
    const root = this.documentRef.documentElement;
    if (root) root.dataset.chronoHints = state;
  }

  /** `true` when the event belongs to the card itself (dismiss, not gameplay input). */
  private isOwnTarget(target: EventTarget | null): boolean {
    if (typeof Node === 'undefined' || !(target instanceof Node)) return false;
    return this.root.contains(target);
  }

  private readonly handleDismissClick = (): void => {
    this.dismiss('user');
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.visibleState) return;
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.dismiss('user');
  };

  private readonly handleInput = (event: Event): void => {
    if (!this.visibleState) return;
    if (this.isOwnTarget(event.target)) return;
    this.dismiss('input');
  };
}

/** Creates the first-run hint card (`create` half of the lifecycle). */
export function createOnboardingHints(options: OnboardingHintsOptions = {}): OnboardingHints {
  return new OnboardingHints(options);
}
