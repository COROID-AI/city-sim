/**
 * Chrono City — inspectable info card.
 *
 * The DOM panel a click opens: it shows the resolved name and blurb for one
 * inspectable object **in one era**, plus the year badge and where the copy
 * came from. The card owns no year state of its own — the caller hands in the
 * active `EraId` (or swaps it with `setEra()`), and the card re-resolves
 * through the injected resolver. That keeps it a pure view of
 * `(objectId, EraId)` and lets the era-transition integration task re-render an
 * open card as the year slider moves without the card ever reading the live
 * timeline.
 *
 * The card is created inside the scene context's overlay root so it sits above
 * the WebGL canvas, and every element carries a `data-chrono-info-card*`
 * attribute so browser harnesses can assert on it without guessing at markup.
 *
 * Lifecycle:
 *   create    → `createInfoCard()` / `new InfoCard({ resolve })`.
 *   consume   → `show(objectId, era)`, `setEra(era)`, `hide()`, `isOpen`.
 *   integrate → the interaction layer builds one card per app and shows it when
 *               the picking controller reports a click.
 */

import type { EraId } from '../core/eraContracts';
import type { CopySource, ResolvedInspectableCopy } from './inspectionRegistry';

export const INFO_CARD_VERSION = 1;

/** Attribute marking the card element itself. */
export const INFO_CARD_ATTRIBUTE = 'data-chrono-info-card';

/**
 * Stable query hooks for Playwright/harness code, so specs never depend on
 * class names or DOM depth.
 */
export const INFO_CARD_SELECTORS = Object.freeze({
  card: `[${INFO_CARD_ATTRIBUTE}]`,
  era: '[data-chrono-info-card-era]',
  name: '[data-chrono-info-card-name]',
  blurb: '[data-chrono-info-card-blurb]',
  meta: '[data-chrono-info-card-meta]',
  close: '[data-chrono-info-card-close]',
});

/** Resolves copy for an object in an era; the interaction layer injects the registry. */
export type CopyResolver = (objectId: string, era: EraId) => ResolvedInspectableCopy | null;

export interface InfoCardOptions {
  /** Element the card is appended to. Defaults to `[data-chrono-overlay]`, then `<body>`. */
  readonly root?: HTMLElement;
  /** Document override (defaults to the root's owner document). */
  readonly document?: Document;
  /** Registry-backed resolution; without it the card can only render given resolutions. */
  readonly resolve?: CopyResolver;
  /** Extra class name for skinning. */
  readonly className?: string;
  /** Small kicker above the name. Defaults to `Inspecting`. */
  readonly caption?: string;
  /** Show the close button. Defaults to `true`. */
  readonly closable?: boolean;
  /** Close on `Escape` while open. Defaults to `true`. */
  readonly closeOnEscape?: boolean;
  /** Called after the user closes the card (close button or `Escape`). */
  readonly onClose?: () => void;
}

/** Human-readable provenance shown in the card footer. */
const SOURCE_LABELS: Readonly<Record<CopySource, string>> = Object.freeze({
  era: 'era copy',
  fallback: 'fallback copy',
  'nearest-era': 'nearest era',
  label: 'name only',
});

let cardSequence = 0;

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  documentRef: Document,
  tag: K,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = documentRef.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function resolveDocument(options: InfoCardOptions): Document {
  if (options.document) return options.document;
  if (options.root?.ownerDocument) return options.root.ownerDocument;
  if (typeof document !== 'undefined') return document;
  throw new Error('createInfoCard() needs a DOM document.');
}

function resolveRoot(documentRef: Document, provided?: HTMLElement): HTMLElement {
  if (provided) return provided;
  const existing = documentRef.querySelector<HTMLElement>('[data-chrono-overlay]');
  if (existing) return existing;
  if (documentRef.body) return documentRef.body;
  throw new Error('createInfoCard() needs an overlay root or a document body.');
}

/**
 * The info card panel. Every mutation goes through `render()`, so the DOM is a
 * direct projection of the last resolved copy.
 */
export class InfoCard {
  readonly version = INFO_CARD_VERSION;

  /** Root panel element (`<aside>`). */
  readonly element: HTMLElement;
  /** Year badge element. */
  readonly eraElement: HTMLElement;
  /** Name element. */
  readonly nameElement: HTMLElement;
  /** Blurb element. */
  readonly blurbElement: HTMLElement;
  /** Footer provenance element. */
  readonly metaElement: HTMLElement;
  /** Close button, or `null` when the card is not closable. */
  readonly closeButton: HTMLButtonElement | null;

  private readonly root: HTMLElement;
  private readonly resolver: CopyResolver | null;
  private readonly onCloseCallback: (() => void) | undefined;
  private readonly closesOnEscape: boolean;
  private resolution: ResolvedInspectableCopy | null = null;
  private openState = false;
  private disposedState = false;
  private readonly handleEscape: (event: KeyboardEvent) => void;

  constructor(options: InfoCardOptions = {}) {
    const documentRef = resolveDocument(options);
    this.root = resolveRoot(documentRef, options.root);
    this.resolver = options.resolve ?? null;
    this.onCloseCallback = options.onClose;
    this.closesOnEscape = options.closeOnEscape ?? true;

    cardSequence += 1;
    const nameId = `chrono-info-card-name-${cardSequence}`;
    const blurbId = `chrono-info-card-blurb-${cardSequence}`;

    const element = createElement(documentRef, 'aside', {
      [INFO_CARD_ATTRIBUTE]: '',
      class: ['chrono-info-card', 'chrono-panel', options.className]
        .filter(Boolean)
        .join(' '),
      role: 'dialog',
      'aria-labelledby': nameId,
      'aria-describedby': blurbId,
      'data-chrono-info-card-state': 'closed',
    });
    element.hidden = true;
    applyStyles(element, {
      position: 'absolute',
      left: '24px',
      bottom: '24px',
      minWidth: '260px',
      maxWidth: '360px',
      padding: '16px 18px',
      borderRadius: '14px',
      background: 'rgba(6, 12, 22, 0.78)',
      border: '1px solid rgba(111, 211, 255, 0.28)',
      boxShadow: '0 18px 42px rgba(2, 6, 14, 0.55)',
      backdropFilter: 'blur(12px)',
      color: 'var(--chrono-ink, #e8eef7)',
      pointerEvents: 'auto',
      transition: 'opacity 140ms ease, transform 140ms ease',
    });

    const header = createElement(documentRef, 'header');
    applyStyles(header, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '8px',
    });

    const caption = createElement(documentRef, 'span', { class: 'chrono-label' });
    caption.textContent = options.caption ?? 'Inspecting';
    applyStyles(caption, {
      fontSize: '10px',
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: 'var(--chrono-muted, rgba(232, 238, 247, 0.62))',
    });

    const era = createElement(documentRef, 'span', {
      class: 'chrono-info-card__era',
      'data-chrono-info-card-era': '',
    });
    applyStyles(era, {
      fontSize: '12px',
      fontWeight: '600',
      padding: '2px 8px',
      borderRadius: '999px',
      background: 'rgba(111, 211, 255, 0.14)',
      color: 'var(--chrono-accent, #6fd3ff)',
      fontVariantNumeric: 'tabular-nums',
    });

    header.appendChild(caption);
    header.appendChild(era);

    if (options.closable ?? true) {
      const close = createElement(documentRef, 'button', {
        type: 'button',
        'data-chrono-info-card-close': '',
        'aria-label': 'Close info card',
      });
      close.textContent = '\u00d7';
      applyStyles(close, {
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        fontSize: '18px',
        lineHeight: '1',
        padding: '2px 6px',
        cursor: 'pointer',
      });
      close.addEventListener('click', () => {
        this.close();
      });
      header.appendChild(close);
      this.closeButton = close;
    } else {
      this.closeButton = null;
    }

    const name = createElement(documentRef, 'h2', {
      id: nameId,
      class: 'chrono-info-card__name',
      'data-chrono-info-card-name': '',
    });
    applyStyles(name, { margin: '0 0 6px', fontSize: '18px', fontWeight: '600' });

    const blurb = createElement(documentRef, 'p', {
      id: blurbId,
      class: 'chrono-info-card__blurb',
      'data-chrono-info-card-blurb': '',
    });
    applyStyles(blurb, {
      margin: '0',
      fontSize: '13px',
      lineHeight: '1.5',
      color: 'rgba(232, 238, 247, 0.78)',
    });

    const meta = createElement(documentRef, 'footer', {
      class: 'chrono-info-card__meta',
      'data-chrono-info-card-meta': '',
    });
    applyStyles(meta, {
      marginTop: '10px',
      fontSize: '11px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'rgba(232, 238, 247, 0.45)',
    });

    element.appendChild(header);
    element.appendChild(name);
    element.appendChild(blurb);
    element.appendChild(meta);
    this.root.appendChild(element);

    this.element = element;
    this.eraElement = era;
    this.nameElement = name;
    this.blurbElement = blurb;
    this.metaElement = meta;

    this.handleEscape = (event: KeyboardEvent) => {
      if (!this.openState || !this.closesOnEscape) return;
      if (event.key === 'Escape') this.close();
    };
    if (this.closesOnEscape && typeof documentRef.addEventListener === 'function') {
      documentRef.addEventListener('keydown', this.handleEscape);
    }
  }

  /** `true` while the card is visible. */
  get isOpen(): boolean {
    return this.openState;
  }

  /** Id of the object currently shown, or `null` when closed. */
  get objectId(): string | null {
    return this.resolution?.objectId ?? null;
  }

  /** Era the visible copy was resolved for, or `null` when closed. */
  get era(): EraId | null {
    return this.resolution?.era ?? null;
  }

  /** Last resolved copy, or `null` while closed. */
  get currentResolution(): ResolvedInspectableCopy | null {
    return this.resolution;
  }

  /**
   * Resolves `(objectId, era)` through the injected resolver, renders it and
   * opens the card. Returns the resolution that was rendered, or `null` when
   * the object is unknown (in which case the card closes).
   */
  show(objectId: string, era: EraId): ResolvedInspectableCopy | null {
    if (this.disposedState || !this.resolver) return null;
    const resolution = this.resolver(objectId, era);
    if (!resolution) {
      this.hide();
      return null;
    }
    this.render(resolution);
    this.open();
    return resolution;
  }

  /**
   * Re-resolves the open card for a new era — the call the era-transition
   * integration task makes on every year change. Closed cards stay closed.
   */
  setEra(era: EraId): ResolvedInspectableCopy | null {
    if (this.disposedState || !this.resolution || !this.resolver) return null;
    const objectId = this.resolution.objectId;
    const resolution = this.resolver(objectId, era);
    if (!resolution) {
      this.hide();
      return null;
    }
    this.render(resolution);
    return resolution;
  }

  /** Renders a resolution (or clears the text when `null`) without opening. */
  render(resolution: ResolvedInspectableCopy | null): void {
    if (this.disposedState) return;
    if (!resolution) {
      this.clearContent();
      return;
    }

    this.resolution = resolution;
    this.eraElement.textContent = resolution.era;
    this.nameElement.textContent = resolution.name;
    this.blurbElement.textContent = resolution.blurb;
    this.metaElement.textContent = `${resolution.objectId} · ${SOURCE_LABELS[resolution.source]}`;
    this.element.dataset.chronoObjectId = resolution.objectId;
    this.element.dataset.chronoCopySource = resolution.source;
    this.element.dataset.chronoSourceEra = resolution.sourceEra ?? '';
    this.element.setAttribute(
      'aria-label',
      `${resolution.name} in ${resolution.era}`,
    );
  }

  /** Makes the card visible without changing the copy. */
  open(): void {
    if (this.disposedState) return;
    this.openState = true;
    this.element.hidden = false;
    this.element.dataset.chronoInfoCardState = 'open';
  }

  /** Hides the card programmatically; does not run the `onClose` callback. */
  hide(): void {
    if (this.disposedState) return;
    this.openState = false;
    this.element.hidden = true;
    this.element.dataset.chronoInfoCardState = 'closed';
    // A closed card never keeps stale copy around for a harness to read.
    this.clearContent();
  }

  /** User-initiated close: hides the card and notifies `onClose`. */
  close(): void {
    const wasOpen = this.openState;
    this.hide();
    if (wasOpen) this.onCloseCallback?.();
  }

  /** Removes the card and its listeners. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    if (this.closesOnEscape) {
      const documentRef = this.element.ownerDocument;
      if (typeof documentRef?.removeEventListener === 'function') {
        documentRef.removeEventListener('keydown', this.handleEscape);
      }
    }
    this.element.remove();
    this.openState = false;
    this.resolution = null;
  }

  /** Blanks the rendered copy; the card keeps its open/closed state. */
  private clearContent(): void {
    this.resolution = null;
    this.eraElement.textContent = '';
    this.nameElement.textContent = '';
    this.blurbElement.textContent = '';
    this.metaElement.textContent = '';
    delete this.element.dataset.chronoCopySource;
    delete this.element.dataset.chronoSourceEra;
    delete this.element.dataset.chronoObjectId;
    this.element.removeAttribute('aria-label');
  }
}

/** Creates an info card (the `create` half of the lifecycle). */
export function createInfoCard(options: InfoCardOptions = {}): InfoCard {
  return new InfoCard(options);
}
