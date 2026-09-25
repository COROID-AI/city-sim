/**
 * HUD layer.
 *
 * Owns every piece of chrome that is not the timeline: the year readout and era
 * caption, the drag/zoom hint pill, the help overlay (controls + per-era facts +
 * the five-era feature matrix), the focus-mode info card, the mute toggle, the
 * autoplay "enable sound" prompt, the loading overlay with progress and the
 * styled WebGL fallback / error surface.
 */

import { ERAS, allEras } from '../config/eras';
import type { Year } from '../config/types';
import type { FocusTarget, QualityTier } from '../state/store';

export interface HudElements {
  hintPill: HTMLElement;
  muteButton: HTMLElement;
  muteIcon: HTMLElement;
  helpButton: HTMLElement;
  helpOverlay: HTMLElement;
  helpClose: HTMLElement;
  helpEraYear: HTMLElement;
  helpEraTitle: HTMLElement;
  helpFacts: HTMLElement;
  eraMatrixBody: HTMLElement;
  yearReadout: HTMLElement;
  eraTitle: HTMLElement;
  eraTagline: HTMLElement;
  transitionProgress: HTMLElement;
  transitionProgressFill: HTMLElement;
  infoCard: HTMLElement;
  infoKind: HTMLElement;
  infoTitle: HTMLElement;
  infoDetail: HTMLElement;
  infoPeriod: HTMLElement;
  infoClose: HTMLElement;
  infoReset: HTMLElement;
  audioPrompt: HTMLElement;
  fpsReadout: HTMLElement;
  loadingOverlay: HTMLElement;
  loadingFill: HTMLElement;
  loadingMessage: HTMLElement;
  loadingPct: HTMLElement;
  fallback: HTMLElement;
  fallbackMessage: HTMLElement;
}

export interface HudCallbacks {
  onToggleMute(): void;
  onToggleHelp(open: boolean): void;
  onCloseFocus(): void;
  onEnableAudio(): void;
  onToggleFps(): void;
}

function requireElement(doc: Document, id: string): HTMLElement {
  const element = doc.getElementById(id);
  if (!element) throw new Error(`Chrono City HUD is missing the #${id} element`);
  return element;
}

/** Query every HUD element up front so failures surface immediately. */
export function queryHudElements(doc: Document = document): HudElements {
  return {
    hintPill: requireElement(doc, 'hint-pill'),
    muteButton: requireElement(doc, 'mute-button'),
    muteIcon: requireElement(doc, 'mute-icon'),
    helpButton: requireElement(doc, 'help-button'),
    helpOverlay: requireElement(doc, 'help-overlay'),
    helpClose: requireElement(doc, 'help-close'),
    helpEraYear: requireElement(doc, 'help-era-year'),
    helpEraTitle: requireElement(doc, 'help-era-title'),
    helpFacts: requireElement(doc, 'help-facts'),
    eraMatrixBody: requireElement(doc, 'era-matrix-body'),
    yearReadout: requireElement(doc, 'year-readout'),
    eraTitle: requireElement(doc, 'era-title'),
    eraTagline: requireElement(doc, 'era-tagline'),
    transitionProgress: requireElement(doc, 'transition-progress'),
    transitionProgressFill: requireElement(doc, 'transition-progress-fill'),
    infoCard: requireElement(doc, 'info-card'),
    infoKind: requireElement(doc, 'info-kind'),
    infoTitle: requireElement(doc, 'info-title'),
    infoDetail: requireElement(doc, 'info-detail'),
    infoPeriod: requireElement(doc, 'info-period'),
    infoClose: requireElement(doc, 'info-close'),
    infoReset: requireElement(doc, 'info-reset'),
    audioPrompt: requireElement(doc, 'audio-prompt'),
    fpsReadout: requireElement(doc, 'fps-readout'),
    loadingOverlay: requireElement(doc, 'loading-overlay'),
    loadingFill: requireElement(doc, 'loading-fill'),
    loadingMessage: requireElement(doc, 'loading-message'),
    loadingPct: requireElement(doc, 'loading-pct'),
    fallback: requireElement(doc, 'fallback'),
    fallbackMessage: requireElement(doc, 'fallback-message'),
  };
}

/** Compact feature summary for the help overlay's five-era matrix. */
function summarise(year: Year): { buildings: string; vehicles: string; signage: string; sound: string } {
  const era = ERAS[year];
  const kinds = Array.from(new Set(era.vehicles.map((vehicle) => vehicle.kind))).slice(0, 4).join(', ');
  const formats = Array.from(
    new Set([...era.storefronts.map((storefront) => storefront.signFormat), ...era.advertisements.map((ad) => ad.format)]),
  ).join(', ');
  return {
    buildings: `${era.architecture.minFloors}-${era.architecture.maxFloors} storeys · ${era.architecture.styles.slice(0, 3).join(', ')}`,
    vehicles: kinds,
    signage: formats,
    sound: `${era.audio.music.motif} · ${era.audio.engineProfile}`,
  };
}

export class Hud {
  private readonly elements: HudElements;
  private readonly callbacks: HudCallbacks;
  private readonly detach: Array<() => void> = [];
  private helpOpen = false;
  private fpsVisible = false;
  private currentYear: Year = 1945;

  constructor(elements: HudElements, callbacks: HudCallbacks) {
    this.elements = elements;
    this.callbacks = callbacks;
    this.buildEraMatrix();
    this.bind();
    this.elements.helpOverlay.hidden = true;
    this.elements.infoCard.hidden = true;
    this.elements.transitionProgress.hidden = true;
  }

  /* ---------------------------------------------------------- mutations -- */

  setEra(year: Year): void {
    this.currentYear = year;
    const era = ERAS[year];
    this.elements.yearReadout.textContent = String(year);
    this.elements.eraTitle.textContent = era.title.split('·')[1]?.trim() ?? era.title;
    this.elements.eraTagline.textContent = era.tagline;
    this.elements.helpEraYear.textContent = String(year);
    this.elements.helpEraTitle.textContent = era.title;
    this.elements.helpFacts.replaceChildren(
      ...era.facts.map((fact) => {
        const item = document.createElement('li');
        item.textContent = fact;
        return item;
      }),
    );
    for (const row of Array.from(this.elements.eraMatrixBody.querySelectorAll('tr'))) {
      row.classList.toggle('active', row.dataset.year === String(year));
    }
  }

  setMuted(muted: boolean): void {
    this.elements.muteButton.setAttribute('aria-pressed', String(muted));
    this.elements.muteButton.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.elements.muteIcon.textContent = muted ? '✕' : '♪';
  }

  setFocus(target: FocusTarget | null): void {
    if (!target) {
      this.elements.infoCard.hidden = true;
      return;
    }
    this.elements.infoKind.textContent = target.kind;
    this.elements.infoTitle.textContent = target.label;
    this.elements.infoDetail.textContent = target.detail;
    this.elements.infoPeriod.textContent = target.period;
    this.elements.infoCard.hidden = false;
  }

  setHelp(open: boolean): void {
    this.helpOpen = open;
    this.elements.helpOverlay.hidden = !open;
    this.elements.helpButton.setAttribute('aria-pressed', String(open));
    // The help panel is a modal dialog: take the rest of the HUD out of both the
    // visual stacking order and the accessibility tree while it is open.
    const root = this.elements.helpOverlay.ownerDocument?.body;
    if (root) root.classList.toggle('help-open', open);
    if (open) this.setEra(this.currentYear);
  }

  get isHelpOpen(): boolean {
    return this.helpOpen;
  }

  setSoundPromptVisible(visible: boolean): void {
    this.elements.audioPrompt.hidden = !visible;
  }

  setLoading(active: boolean, progress: number, message?: string): void {
    const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    this.elements.loadingFill.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
    this.elements.loadingPct.textContent = `${pct}%`;
    if (message) this.elements.loadingMessage.textContent = message;
    this.elements.loadingOverlay.classList.toggle('hidden', !active);
    this.elements.loadingOverlay.hidden = false;
    if (!active) {
      const overlay = this.elements.loadingOverlay;
      window.setTimeout(() => {
        if (overlay.classList.contains('hidden')) overlay.hidden = true;
      }, 600);
    }
  }

  setTransitionProgress(progress: number | null): void {
    if (progress === null) {
      this.elements.transitionProgress.hidden = true;
      return;
    }
    this.elements.transitionProgress.hidden = false;
    this.elements.transitionProgressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
  }

  setFps(fps: number, tier: QualityTier, visible = this.fpsVisible): void {
    this.fpsVisible = visible;
    this.elements.fpsReadout.hidden = !visible;
    this.elements.fpsReadout.textContent = `${Math.round(fps)} fps · ${tier}`;
  }

  showFallback(message: string): void {
    this.elements.fallbackMessage.textContent = message;
    this.elements.fallback.hidden = false;
    this.elements.loadingOverlay.hidden = true;
  }

  hint(text: string): void {
    this.elements.hintPill.textContent = text;
  }

  dimHint(dimmed: boolean): void {
    this.elements.hintPill.classList.toggle('dimmed', dimmed);
  }

  /* ------------------------------------------------------------ private -- */

  private buildEraMatrix(): void {
    const rows = allEras().map((era) => {
      const summary = summarise(era.year);
      const row = document.createElement('tr');
      row.dataset.year = String(era.year);
      const cells = [String(era.year), summary.buildings, summary.vehicles, summary.signage, summary.sound];
      for (const [index, text] of cells.entries()) {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        cell.textContent = text;
        row.appendChild(cell);
      }
      return row;
    });
    this.elements.eraMatrixBody.replaceChildren(...rows);
  }

  private bind(): void {
    const { elements, callbacks } = this;
    const on = <K extends keyof HTMLElementEventMap>(
      element: HTMLElement,
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
    ): void => {
      element.addEventListener(type, handler);
      this.detach.push(() => element.removeEventListener(type, handler));
    };

    on(elements.muteButton, 'click', () => {
      callbacks.onToggleMute();
    });
    on(elements.helpButton, 'click', () => {
      callbacks.onToggleHelp(!this.helpOpen);
    });
    on(elements.helpClose, 'click', () => {
      callbacks.onToggleHelp(false);
    });
    on(elements.helpOverlay, 'click', (event) => {
      if (event.target === elements.helpOverlay) callbacks.onToggleHelp(false);
    });
    on(elements.infoClose, 'click', () => callbacks.onCloseFocus());
    on(elements.infoReset, 'click', () => callbacks.onCloseFocus());
    on(elements.audioPrompt, 'click', () => callbacks.onEnableAudio());
    on(elements.hintPill, 'click', () => callbacks.onToggleHelp(true));
    on(elements.fpsReadout, 'click', () => callbacks.onToggleFps());
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
  }
}
