/**
 * `cafe-inspect-overlay` — the close-up inspection surface.
 *
 * When the visitor frames a hotspot, the navigation controller turns the camera
 * towards it; this module shows *what* is being looked at: the hotspot label,
 * the era caption for the year the timeline is showing, the hotspot description
 * and a return control that restores the previous viewpoint.
 *
 * Design contract
 * ---------------
 * - **Two pieces, one behaviour.** {@link InspectOverlay} owns the DOM (markup,
 *   styling, focus, the return control). {@link InspectMode} owns the
 *   interaction: it frames a registered hotspot through the navigation
 *   controller, resolves the caption through the hotspot registry and drives the
 *   overlay, so the runnable page only has to call `inspectMode.open(id)`.
 * - **Era captions come from the registry.** This module never authors era
 *   content; it asks `HotspotRegistry.resolveEraCaption` for the selected
 *   {@link YearId}, which falls back to the hotspot's neutral description, so a
 *   hotspot without a note for that year never renders empty text.
 * - **Clear of the timeline.** The overlay layer is a full-viewport,
 *   click-through fixed layer whose content is inset by a reserved top band
 *   ({@link INSPECT_TIMELINE_CLEARANCE_PX}), and the panel itself is anchored to
 *   the bottom-left. The top timeline slider can therefore never be covered.
 * - **Keyboard reachable.** Showing the overlay moves focus to the return
 *   control (`Enter`/`Space` return immediately), `Escape` returns from
 *   anywhere, and hiding restores the focus that was taken.
 * - **Screen-reader labelled.** The panel is a labelled `role="region"` whose
 *   label is the hotspot name and whose description is the era line, caption and
 *   description; the caption is a polite live region, so moving the timeline
 *   announces the new era text.
 * - **Reduced motion.** The rise/fade flourish is disabled when the visitor
 *   prefers reduced motion (media query *and* an explicit
 *   {@link InspectOverlay.setReducedMotion} switch). Returning is never animated.
 * - **No network.** Styles are injected inline from a system font stack; nothing
 *   is fetched.
 * - **Disposable.** {@link InspectOverlay.dispose} removes the DOM, the injected
 *   styles and every listener; {@link InspectMode.dispose} restores the camera
 *   viewpoint and drops its wiring.
 */

import { DEFAULT_YEAR_ID, isYearId, type YearId } from '../../contracts/period';
import type {
  EraNoteSource,
  HotspotFramingTarget,
  HotspotRegistry,
} from '../../core/hotspots';

/* -------------------------------------------------------------------------- */
/* Public constants                                                           */
/* -------------------------------------------------------------------------- */

/** Removes a previously registered listener. Safe to call more than once. */
export type Unsubscribe = () => void;

/** Attribute marking the injected `<style>` element. */
export const INSPECT_OVERLAY_STYLE_ATTRIBUTE = 'data-inspect-styles';

/** Value of {@link INSPECT_OVERLAY_STYLE_ATTRIBUTE} identifying this overlay. */
export const INSPECT_OVERLAY_STYLE_ID = 'cafe-inspect-overlay';

/**
 * Height of the reserved top band the overlay keeps clear for the timeline
 * slider. The overlay layer is padded by this much and its panel sits at the
 * bottom of the viewport, so the slider is never covered.
 *
 * The slider's own top chrome measures roughly 120px (10px panel padding, a
 * ~32px readout row, a 2px gap and the 64px track area, plus 12px bottom
 * padding), so 136px leaves the whole control — and its drop shadow — clear.
 */
export const INSPECT_TIMELINE_CLEARANCE_PX = 136;

/** Accessible name of the return control and of the inspection region. */
export const INSPECT_RETURN_LABEL = 'Return to the room';

/** Visible hint beside the return control. */
export const INSPECT_RETURN_HINT = 'Esc';

/** Font stack for the chrome: no webfont, no remote asset. */
export const INSPECT_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** `data-part` hooks, so tests, QA and the composition root can query the chrome. */
export const INSPECT_OVERLAY_PARTS = Object.freeze({
  root: 'inspect-overlay',
  panel: 'inspect-panel',
  label: 'inspect-label',
  era: 'inspect-era',
  eraCaption: 'inspect-era-caption',
  description: 'inspect-description',
  returnButton: 'inspect-return',
  returnHint: 'inspect-return-hint',
} as const);

/**
 * The overlay stylesheet, injected inline. System fonts only: the page makes no
 * extra request, exactly like the timeline slider's chrome.
 */
export const INSPECT_OVERLAY_CSS = `
[data-part='inspect-overlay'] {
  position: fixed;
  inset: 0;
  z-index: 30;
  pointer-events: none;
  padding-top: var(--cafe-inspect-timeline-clearance, ${INSPECT_TIMELINE_CLEARANCE_PX}px);
  font-family: ${INSPECT_FONT_STACK};
  color: #f7f1e8;
  -webkit-font-smoothing: antialiased;
}
[data-part='inspect-overlay'][data-visible='false'] { display: none; }
[data-part='inspect-panel'] {
  position: absolute;
  left: 24px;
  bottom: 24px;
  max-width: min(26rem, 46vw);
  margin: 0;
  padding: 18px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(22, 17, 13, 0.86);
  border: 1px solid rgba(247, 241, 232, 0.18);
  border-radius: 14px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  animation: cafe-inspect-rise 260ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
[data-part='inspect-overlay'][data-reduced-motion='true'] [data-part='inspect-panel'] { animation: none; }
[data-part='inspect-label'] {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0.01em;
}
[data-part='inspect-era'] {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #e8c9a0;
}
[data-part='inspect-era-caption'] {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.45;
  color: #f4ead9;
}
[data-part='inspect-description'] {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.4;
  color: rgba(244, 234, 217, 0.74);
}
[data-part='inspect-return'] {
  align-self: flex-start;
  margin-top: 8px;
  padding: 8px 14px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  color: #1b1410;
  background: #f0d9b5;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}
[data-part='inspect-return']:hover { background: #f8e8cd; }
[data-part='inspect-return']:focus-visible { outline: 3px solid #a8d4ff; outline-offset: 2px; }
[data-part='inspect-return-hint'] {
  margin-left: 8px;
  font-size: 0.72rem;
  font-weight: 500;
  opacity: 0.66;
}
@keyframes cafe-inspect-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-part='inspect-panel'] { animation: none !important; }
}
`;

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** What the overlay renders for one focused hotspot and one era. */
export interface InspectOverlayContent {
  /** Hotspot id (also mirrored onto the layer as a data attribute). */
  readonly id: string;
  /** Hotspot label; becomes the region's accessible name. */
  readonly label: string;
  /** Optional longer explanation; omitted content is hidden, never blank. */
  readonly description: string;
  /** Year the timeline is showing. */
  readonly year: YearId;
  /** Era caption text; falls back to the description when no note exists. */
  readonly caption: string;
  /** Where {@link InspectOverlayContent.caption} came from. */
  readonly captionSource: EraNoteSource;
}

/** What asked the overlay to return to the previous viewpoint. */
export type InspectReturnSource = 'control' | 'escape' | 'programmatic';

/** Payload handed to return listeners. */
export interface InspectReturnDetail {
  readonly hotspotId: string;
  readonly year: YearId;
  readonly source: InspectReturnSource;
}

/** Construction options for {@link InspectOverlay}. */
export interface InspectOverlayOptions {
  /**
   * Element the layer is appended to. Omit to mount into the document body;
   * pass `null` to keep the overlay detached until {@link InspectOverlay.mount}.
   */
  readonly container?: Element | null;
  /** Document that owns the overlay; defaults to the ambient `document`. */
  readonly ownerDocument?: Document | null;
  /** Explicit reduced-motion state, overriding the media query probe. */
  readonly reducedMotion?: boolean;
  /** Custom reduced-motion probe; defaults to a `matchMedia` lookup. */
  readonly prefersReducedMotion?: () => boolean;
  /** Reserved top band, in pixels; defaults to {@link INSPECT_TIMELINE_CLEARANCE_PX}. */
  readonly timelineClearancePx?: number;
  /** Convenience listener invoked when the visitor asks to return. */
  readonly onReturn?: (detail: InspectReturnDetail) => void;
}

/** One injected stylesheet per document, reference counted per overlay. */
interface StyleLease {
  readonly element: HTMLStyleElement;
  refs: number;
}

const styleLeases = new WeakMap<Document, StyleLease>();

function acquireStyles(doc: Document): StyleLease {
  const existing = styleLeases.get(doc);
  if (existing) {
    existing.refs += 1;
    return existing;
  }
  const element = doc.createElement('style');
  element.setAttribute(INSPECT_OVERLAY_STYLE_ATTRIBUTE, INSPECT_OVERLAY_STYLE_ID);
  element.textContent = INSPECT_OVERLAY_CSS;
  const parent = doc.head ?? doc.documentElement ?? doc.body;
  parent?.appendChild(element);
  const lease: StyleLease = { element, refs: 1 };
  styleLeases.set(doc, lease);
  return lease;
}

function releaseStyles(doc: Document, lease: StyleLease): void {
  lease.refs -= 1;
  if (lease.refs > 0) return;
  lease.element.remove();
  styleLeases.delete(doc);
}

function detectReducedMotion(): boolean {
  const scope = globalThis as unknown as {
    matchMedia?: (query: string) => { matches?: boolean };
  };
  if (typeof scope.matchMedia !== 'function') return false;
  try {
    return scope.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function createPart<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  part: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.setAttribute('data-part', part);
  return element;
}

/** Guarantees the caption is never empty, whatever the caller handed over. */
function resolveCaptionText(content: InspectOverlayContent): string {
  const caption = content.caption.trim().length > 0 ? content.caption : content.description;
  return caption.trim().length > 0 ? caption : content.label;
}

let overlayInstanceCount = 0;

/* -------------------------------------------------------------------------- */
/* Overlay                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The inspect-mode overlay markup. Construct one per composed page, `show` it
 * with {@link InspectOverlayContent} when a hotspot is framed, and `dispose` it
 * to remove every node, style and listener again.
 */
export class InspectOverlay {
  /** Full-viewport, click-through layer that carries the inspection panel. */
  readonly element: HTMLDivElement;

  /** The panel itself (bottom-left, clear of the top timeline slider). */
  readonly panel: HTMLElement;

  /** The return control: the overlay's keyboard affordance. */
  readonly returnButton: HTMLButtonElement;

  private readonly doc: Document;
  private readonly styles: StyleLease;
  private readonly labelEl: HTMLElement;
  private readonly eraEl: HTMLElement;
  private readonly captionEl: HTMLElement;
  private readonly descriptionEl: HTMLElement;
  private readonly onReturnOption: ((detail: InspectReturnDetail) => void) | null;
  private readonly clearancePx: number;
  private readonly reducedMotionProbe: () => boolean;

  private readonly returnListeners = new Set<(detail: InspectReturnDetail) => void>();
  private readonly handleReturnClick = (): void => {
    this.requestReturn('control');
  };
  private readonly handleKeyDown = (event: Event): void => {
    if (!this.visibleState) return;
    const keyboard = event as KeyboardEvent;
    if (keyboard.key !== 'Escape' && keyboard.key !== 'Esc') return;
    keyboard.preventDefault?.();
    this.requestReturn('escape');
  };

  private visibleState = false;
  private contentState: InspectOverlayContent | null = null;
  private reducedMotionState: boolean;
  private escapeAttached = false;
  private buttonAttached = false;
  private previousFocus: Element | null = null;
  private isDisposed = false;

  constructor(options: InspectOverlayOptions = {}) {
    const doc =
      options.ownerDocument ?? (typeof document === 'undefined' ? null : document);
    if (!doc) {
      throw new Error(
        'InspectOverlay needs a DOM document: pass `ownerDocument` when no ambient document exists.',
      );
    }
    this.doc = doc;
    this.styles = acquireStyles(doc);
    this.clearancePx = Math.max(
      Math.round(options.timelineClearancePx ?? INSPECT_TIMELINE_CLEARANCE_PX),
      0,
    );
    this.onReturnOption = options.onReturn ?? null;
    this.reducedMotionProbe = options.prefersReducedMotion ?? detectReducedMotion;
    this.reducedMotionState = options.reducedMotion ?? this.reducedMotionProbe() === true;

    overlayInstanceCount += 1;
    const suffix = `${overlayInstanceCount}`;

    this.element = createPart(doc, 'div', INSPECT_OVERLAY_PARTS.root);
    this.element.setAttribute('data-visible', 'false');
    this.element.setAttribute('data-timeline-clearance-px', String(this.clearancePx));
    this.element.style.setProperty('--cafe-inspect-timeline-clearance', `${this.clearancePx}px`);

    this.panel = createPart(doc, 'section', INSPECT_OVERLAY_PARTS.panel);
    this.panel.setAttribute('role', 'region');

    this.labelEl = createPart(doc, 'h2', INSPECT_OVERLAY_PARTS.label);
    this.labelEl.id = `cafe-inspect-label-${suffix}`;

    this.eraEl = createPart(doc, 'p', INSPECT_OVERLAY_PARTS.era);
    this.eraEl.id = `cafe-inspect-era-${suffix}`;

    this.captionEl = createPart(doc, 'p', INSPECT_OVERLAY_PARTS.eraCaption);
    this.captionEl.id = `cafe-inspect-caption-${suffix}`;
    this.captionEl.setAttribute('aria-live', 'polite');

    this.descriptionEl = createPart(doc, 'p', INSPECT_OVERLAY_PARTS.description);
    this.descriptionEl.id = `cafe-inspect-description-${suffix}`;

    this.returnButton = createPart(doc, 'button', INSPECT_OVERLAY_PARTS.returnButton);
    this.returnButton.type = 'button';
    this.returnButton.setAttribute('aria-label', INSPECT_RETURN_LABEL);
    this.returnButton.setAttribute('aria-keyshortcuts', 'Escape');
    const buttonText = doc.createElement('span');
    buttonText.textContent = INSPECT_RETURN_LABEL;
    const hint = createPart(doc, 'span', INSPECT_OVERLAY_PARTS.returnHint);
    hint.textContent = INSPECT_RETURN_HINT;
    hint.setAttribute('aria-hidden', 'true');
    this.returnButton.append(buttonText, hint);
    this.returnButton.addEventListener('click', this.handleReturnClick);
    this.buttonAttached = true;

    this.panel.setAttribute('aria-labelledby', this.labelEl.id);
    this.panel.append(this.labelEl, this.eraEl, this.captionEl, this.descriptionEl, this.returnButton);
    this.element.appendChild(this.panel);
    this.setReducedMotion(this.reducedMotionState);

    if (options.container !== null) {
      this.mount(options.container);
    }
  }

  /* -- state ------------------------------------------------------------- */

  /** True while the overlay is presenting a hotspot. */
  get visible(): boolean {
    return this.visibleState;
  }

  /** Content currently presented (kept after {@link hide} for diagnostics). */
  get content(): InspectOverlayContent | null {
    return this.contentState;
  }

  /** Id of the hotspot being presented, or `null` before the first `show`. */
  get hotspotId(): string | null {
    return this.contentState?.id ?? null;
  }

  /** True while the layer is attached to the document. */
  get mounted(): boolean {
    return this.element.isConnected;
  }

  /** Reserved top band, in pixels. */
  get timelineClearancePx(): number {
    return this.clearancePx;
  }

  /** True once {@link dispose} has run. */
  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Listener ownership, handy for lifecycle assertions. */
  getListenerStats(): { readonly button: number; readonly document: number; readonly return: number; readonly total: number } {
    const button = this.buttonAttached ? 1 : 0;
    const documentListeners = this.escapeAttached ? 1 : 0;
    const returned = this.returnListeners.size;
    return { button, document: documentListeners, return: returned, total: button + documentListeners + returned };
  }

  /* -- lifecycle --------------------------------------------------------- */

  /** Appends the layer to `container` (or the document body). Idempotent. */
  mount(container?: Element | null): void {
    if (this.isDisposed) {
      throw new Error('Cannot mount a disposed InspectOverlay.');
    }
    const parent = container ?? this.doc.body ?? this.doc.documentElement;
    if (!parent) {
      throw new Error('InspectOverlay cannot mount: the document has no body.');
    }
    if (this.element.parentNode !== parent) parent.appendChild(this.element);
  }

  /* -- content ----------------------------------------------------------- */

  /** Presents `content` and moves focus to the return control. */
  show(content: InspectOverlayContent): void {
    if (this.isDisposed) {
      throw new Error('Cannot show a hotspot on a disposed InspectOverlay.');
    }
    this.mount();
    this.contentState = content;
    this.applyContent(content);
    this.element.setAttribute('data-visible', 'true');
    this.visibleState = true;
    this.attachEscape();

    const active = this.doc.activeElement;
    if (active && active !== this.returnButton && !this.element.contains(active)) {
      this.previousFocus = active;
    }
    try {
      this.returnButton.focus({ preventScroll: true });
    } catch {
      // Focus is best effort: a detached or hidden document must not break show().
    }
  }

  /** Re-renders the era line and caption, e.g. when the timeline moves. */
  setEra(year: YearId, caption: string, captionSource: EraNoteSource): void {
    if (this.isDisposed) {
      throw new Error('Cannot update a disposed InspectOverlay.');
    }
    const content = this.contentState;
    if (content) this.contentState = { ...content, year, caption, captionSource };
    const current = this.contentState;
    if (!current) return;
    this.eraEl.textContent = current.year;
    this.captionEl.textContent = resolveCaptionText(current);
    this.panel.setAttribute('data-year', current.year);
    this.panel.setAttribute('data-caption-source', current.captionSource);
  }

  /** Hides the overlay and restores the focus it took. */
  hide(): void {
    if (this.isDisposed) return;
    this.visibleState = false;
    this.element.setAttribute('data-visible', 'false');
    this.detachEscape();
    const previous = this.previousFocus;
    if (previous && previous !== this.returnButton && !this.element.contains(previous)) {
      try {
        (previous as HTMLElement).focus?.({ preventScroll: true });
      } catch {
        // Restoring focus is best effort.
      }
    }
    // Never leave focus on a control that is now hidden: when nothing external
    // could take it back (or the browser refused), blur out of the overlay.
    const active = this.doc.activeElement;
    if (active && this.element.contains(active)) {
      try {
        (active as HTMLElement).blur?.();
      } catch {
        // Blurring is best effort too.
      }
    }
  }

  /** Applies the reduced-motion preference to the overlay transitions. */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotionState = reduced;
    this.element.setAttribute('data-reduced-motion', reduced ? 'true' : 'false');
  }

  /** True when the overlay currently suppresses its transition. */
  get reducedMotion(): boolean {
    return this.reducedMotionState;
  }

  /** True when `node` is part of the overlay. */
  contains(node: Node | null): boolean {
    return node !== null && this.element.contains(node);
  }

  /* -- return control ---------------------------------------------------- */

  /**
   * Subscribes to return requests (the control, `Escape` or
   * {@link requestReturn}). The listener is expected to leave inspect mode.
   */
  onReturn(listener: (detail: InspectReturnDetail) => void): Unsubscribe {
    this.returnListeners.add(listener);
    return () => {
      this.returnListeners.delete(listener);
    };
  }

  /** Asks listeners to return to the previous viewpoint. */
  requestReturn(source: InspectReturnSource = 'programmatic'): void {
    const content = this.contentState;
    if (!content) return;
    const detail: InspectReturnDetail = { hotspotId: content.id, year: content.year, source };
    this.onReturnOption?.(detail);
    for (const listener of [...this.returnListeners]) listener(detail);
  }

  /* -- teardown ---------------------------------------------------------- */

  /**
   * Removes the layer, the injected stylesheet and every listener. Idempotent:
   * app-composition may tear the scene down unconditionally.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.visibleState = false;
    this.detachEscape();
    this.returnButton.removeEventListener('click', this.handleReturnClick);
    this.buttonAttached = false;
    this.returnListeners.clear();
    this.element.remove();
    this.contentState = null;
    this.previousFocus = null;
    releaseStyles(this.doc, this.styles);
  }

  /* -- internals --------------------------------------------------------- */

  private applyContent(content: InspectOverlayContent): void {
    this.labelEl.textContent = content.label;
    this.eraEl.textContent = content.year;
    this.captionEl.textContent = resolveCaptionText(content);
    this.descriptionEl.textContent = content.description;
    this.descriptionEl.hidden = content.description.trim().length === 0;
    this.element.setAttribute('data-hotspot-id', content.id);
    this.panel.setAttribute('data-year', content.year);
    this.panel.setAttribute('data-caption-source', content.captionSource);

    const describedBy = [this.eraEl.id, this.captionEl.id];
    if (content.description.trim().length > 0) describedBy.push(this.descriptionEl.id);
    this.panel.setAttribute('aria-describedby', describedBy.join(' '));
  }

  private attachEscape(): void {
    if (this.escapeAttached) return;
    this.doc.addEventListener('keydown', this.handleKeyDown);
    this.escapeAttached = true;
  }

  private detachEscape(): void {
    if (!this.escapeAttached) return;
    this.doc.removeEventListener('keydown', this.handleKeyDown);
    this.escapeAttached = false;
  }
}

/** Convenience constructor mirroring the class API. */
export function createInspectOverlay(options: InspectOverlayOptions = {}): InspectOverlay {
  return new InspectOverlay(options);
}

/* -------------------------------------------------------------------------- */
/* Inspect mode                                                               */
/* -------------------------------------------------------------------------- */

/** Snapshot of the inspect-mode state, handed to change listeners. */
export interface InspectModeState {
  /** Framed hotspot id, or `null` outside inspect mode. */
  readonly hotspotId: string | null;
  /** Year the era caption resolves against. */
  readonly year: YearId;
  /** Caption currently presented, or `null` outside inspect mode. */
  readonly caption: string | null;
  /** Provenance of {@link InspectModeState.caption}. */
  readonly captionSource: EraNoteSource | null;
  /** Camera distance the navigation controller actually used. */
  readonly framingDistance: number | null;
}

/** Construction options for {@link InspectMode}. */
export interface InspectModeOptions {
  /** Registry the framed hotspots come from. */
  readonly registry: HotspotRegistry;
  /** Camera authority, normally the scene's `NavigationController`. */
  readonly navigation: HotspotFramingTarget;
  /** Overlay the close-up is presented through. */
  readonly overlay: InspectOverlay;
  /** Era the caption resolves against until the timeline says otherwise. */
  readonly year?: YearId;
  /** Convenience listener invoked on every state change. */
  readonly onChange?: (state: InspectModeState) => void;
}

/**
 * Ties the three pieces of close-up viewing together: frame the hotspot through
 * the navigation controller, resolve its era caption through the registry and
 * present both through the overlay — then put the visitor back exactly where
 * they were when the return control, `Escape` or `close()` is used.
 *
 * Outward dependencies only: the mode reads the registry, drives the overlay and
 * delegates camera work to navigation. It owns no scene content and no era data.
 */
export class InspectMode {
  private readonly registry: HotspotRegistry;
  private readonly navigation: HotspotFramingTarget;
  private readonly overlay: InspectOverlay;
  private readonly listeners = new Set<(state: InspectModeState) => void>();
  private readonly onChangeOption: ((state: InspectModeState) => void) | null;
  private readonly unsubscribeReturn: Unsubscribe;

  private activeIdState: string | null = null;
  private yearState: YearId;
  private captionState: string | null = null;
  private captionSourceState: EraNoteSource | null = null;
  private distanceState: number | null = null;
  private isDisposed = false;

  constructor(options: InspectModeOptions) {
    this.registry = options.registry;
    this.navigation = options.navigation;
    this.overlay = options.overlay;
    this.yearState = options.year ?? DEFAULT_YEAR_ID;
    this.onChangeOption = options.onChange ?? null;
    this.unsubscribeReturn = this.overlay.onReturn(() => {
      this.close();
    });
  }

  /* -- state ------------------------------------------------------------- */

  /** True while a hotspot is framed and presented. */
  get isOpen(): boolean {
    return this.activeIdState !== null;
  }

  /** Id of the framed hotspot, or `null`. */
  get hotspotId(): string | null {
    return this.activeIdState;
  }

  /** Camera distance used by the last successful framing. */
  get framingDistance(): number | null {
    return this.distanceState;
  }

  /** Era the caption resolves against. */
  get year(): YearId {
    return this.yearState;
  }

  /** Current inspect-mode state. */
  get state(): InspectModeState {
    return {
      hotspotId: this.activeIdState,
      year: this.yearState,
      caption: this.captionState,
      captionSource: this.captionSourceState,
      framingDistance: this.distanceState,
    };
  }

  /** Subscribes to state changes. Returns an unsubscribe function. */
  onDidChange(listener: (state: InspectModeState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* -- interaction -------------------------------------------------------- */

  /**
   * Frames and presents the registered hotspot `id`. Framing is idempotent: a
   * second call for the same hotspot re-frames it at the same distance without
   * disturbing the archived viewpoint.
   */
  open(id: string, year?: YearId): InspectModeState {
    this.assertUsable();
    const targetYear = year ?? this.yearState;
    const record = this.registry.require(id);
    const distance = this.registry.frame(this.navigation, record.id);
    const resolution = this.registry.resolveEraCaption(record.id, targetYear);

    this.activeIdState = record.id;
    this.yearState = targetYear;
    this.captionState = resolution.text;
    this.captionSourceState = resolution.source;
    this.distanceState = distance;

    this.overlay.show({
      id: record.id,
      label: record.label,
      description: record.description,
      year: targetYear,
      caption: resolution.text,
      captionSource: resolution.source,
    });

    return this.emit();
  }

  /** Frames `id`, or leaves inspect mode when it is already the framed hotspot. */
  toggle(id: string, year?: YearId): InspectModeState {
    this.assertUsable();
    if (this.activeIdState === id) {
      this.close();
      return this.state;
    }
    return this.open(id, year);
  }

  /** Leaves inspect mode, restoring the archived camera pose. */
  close(): boolean {
    if (this.isDisposed) return false;
    if (this.activeIdState === null) return false;
    const restored = this.navigation.exitInspect();
    this.activeIdState = null;
    this.captionState = null;
    this.captionSourceState = null;
    this.distanceState = null;
    this.overlay.hide();
    this.emit();
    return restored;
  }

  /** Points the era caption at `year`, re-resolving it when a hotspot is framed. */
  setYear(year: YearId): InspectModeState {
    this.assertUsable();
    if (!isYearId(year)) {
      throw new Error(`Inspect mode needs a known era year (received "${String(year)}").`);
    }
    this.yearState = year;
    if (this.activeIdState !== null) {
      const resolution = this.registry.resolveEraCaption(this.activeIdState, year);
      this.captionState = resolution.text;
      this.captionSourceState = resolution.source;
      this.overlay.setEra(year, resolution.text, resolution.source);
    }
    return this.emit();
  }

  /** Forwards the reduced-motion preference to the overlay chrome. */
  setReducedMotion(reduced: boolean): void {
    this.overlay.setReducedMotion(reduced);
  }

  /**
   * Releases the inspect-mode wiring: returns to the archived viewpoint, drops
   * the overlay subscription and listeners. The overlay itself is disposed by
   * whoever created it.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.close();
    this.unsubscribeReturn();
    this.listeners.clear();
    this.isDisposed = true;
  }

  /* -- internals --------------------------------------------------------- */

  private assertUsable(): void {
    if (this.isDisposed) {
      throw new Error('InspectMode has been disposed.');
    }
  }

  private emit(): InspectModeState {
    const state = this.state;
    this.onChangeOption?.(state);
    for (const listener of [...this.listeners]) listener(state);
    return state;
  }
}

/** Convenience constructor mirroring the class API. */
export function createInspectMode(options: InspectModeOptions): InspectMode {
  return new InspectMode(options);
}
