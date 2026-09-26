/**
 * The performance badge — the adaptive governor's own readout on the HUD.
 *
 * What it is
 * ----------
 * A small, always-on readout that shows the measured frame rate and the active
 * adaptive quality tier, plus the stress control acceptance drives to force
 * sustained over-budget windows inside the composed game.
 *
 * Where it attaches
 * -----------------
 * It locates the HUD's overlay through its stable **DOM attribute**
 * (`[data-hud="overlay"]`, falling back to `[data-hud="root"]`), never through
 * the HUD module's API: the badge is a sibling of the interface layers, so the
 * HUD can change its internals without touching this file, and this file can be
 * composed into a run without a HUD at all (the fallback host is the page body).
 *
 * Input safety
 * ------------
 * The badge is a passive surface. Its container is `pointer-events: none`, so it
 * never intercepts a gesture meant for the canvas, the plan graph or the HUD;
 * only the stress button opts back in (`pointer-events: auto`) — an explicit
 * control has to be clickable.
 *
 * Styling
 * -------
 * The badge carries its own scoped stylesheet, which it injects once and removes
 * on dispose. It never edits `styles/hud.css` (HUD internals), and every rule
 * reads the HUD's own custom properties with a literal fallback, so it renders
 * in the interface's visual language wherever it is mounted — including the perf
 * preview page, which does not load the HUD stylesheet at all.
 */

import type { GameSystem, SystemUpdate } from '../game/systems';
import type { AppliedQualitySettings } from '../render/qualityTiers';

/* -------------------------------------------------------------------------- */
/* Contract                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Stable `data-hud` hooks the badge reads and publishes.
 *
 * `stress-toggle` is the acceptance hook: activating it (pointer, keyboard or
 * `click()`) engages the governor's stress rig, which is how the running game is
 * driven into sustained over-budget windows without a separate preview page.
 */
export const PERF_HUD_KEYS = {
  badge: 'perf-badge',
  fps: 'perf-fps',
  tier: 'perf-tier',
  median: 'perf-median',
  p95: 'perf-p95',
  verdict: 'perf-budget',
  mode: 'perf-mode',
  stress: 'stress-toggle',
} as const;

/** Stable HUD attributes the badge mounts into, most specific first. */
export const PERF_ANCHOR_KEYS = ['overlay', 'root'] as const;

/** Document attribute marking the badge's own stylesheet. */
export const PERF_STYLE_ATTRIBUTE = 'data-coroid-perf-badge';

/** Fixed steps between readout refreshes at the shipped cadence (~100 ms). */
export const PERF_UPDATE_EVERY_STEPS = 6;

/**
 * The slice of the governor the badge consumes.
 *
 * Declared structurally so the badge never imports the governor's system type —
 * the same way it reaches the HUD through a DOM attribute rather than a module
 * handle.
 */
export interface PerfBadgeQualitySource {
  readonly tier: string;
  readonly stats: {
    readonly fps: number;
    readonly medianMs: number;
    readonly p95Ms: number;
    readonly samples: number;
    readonly window: number;
    readonly budgetMs: number;
    readonly overBudget: boolean;
    readonly budgetHeld: boolean;
  };
  readonly stressActive: boolean;
  /** Whether the tier is pinned rather than adaptive. */
  readonly holding: boolean;
  readonly applied: AppliedQualitySettings;
  setStress(active: boolean): unknown;
}

export interface PerfBadgeOptions {
  /** Document to build in. Defaults to the ambient `document`. */
  doc?: Document;
  /** Fallback mount point when the HUD anchors are absent. */
  host?: HTMLElement | null;
  /** The governor this badge reads, and whose stress rig its button drives. */
  quality: PerfBadgeQualitySource;
  /** Render the stress control. Defaults to `true`. */
  stressControl?: boolean;
}

export interface PerfBadgeHandle {
  /** Badge root (`data-hud="perf-badge"`); `pointer-events: none`. */
  readonly root: HTMLElement;
  /** HUD element the badge mounted into, or `null` when it used the fallback. */
  /** HUD element the badge mounted into, or `null` when it used the fallback. */
  readonly anchor: HTMLElement | null;
  readonly fps: HTMLElement;
  readonly tier: HTMLElement;
  readonly median: HTMLElement;
  readonly p95: HTMLElement;
  /** Budget verdict chip (`data-hud="perf-budget"`): MEASURING / INSIDE / OVER. */
  readonly verdict: HTMLElement;
  /** Adaptive-mode chip (`data-hud="perf-mode"`): AUTO or HELD. */
  readonly mode: HTMLElement;
  readonly stressButton: HTMLButtonElement | null;
  /** Readout refreshes that actually changed the DOM. */
  readonly rendered: number;
  /** Read the governor and repaint the readout. Allocation-free when idle. */
  update(): void;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

/** Scoped badge stylesheet; reads the HUD's custom properties with fallbacks. */
export const PERF_BADGE_STYLES = `
.hud-perf {
  position: absolute;
  top: calc(100% + 0.55rem);
  right: 0;
  display: grid;
  gap: 0.32rem;
  min-width: 14.5rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--hud-panel-line, rgba(53, 240, 255, 0.3));
  border-radius: var(--hud-radius, 0.55rem);
  background: var(--hud-panel, rgba(7, 16, 32, 0.86));
  background-image: var(--hud-scan, none);
  backdrop-filter: blur(8px);
  box-shadow: var(--hud-shadow, 0 1.1rem 2.6rem rgba(2, 6, 14, 0.55));
  color: var(--hud-ink, #e8f7ff);
  font-family: var(--coroid-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-variant-numeric: tabular-nums;
  /* The badge is a readout, never a gesture target. */
  pointer-events: none;
  user-select: none;
}

.hud-perf__head {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.hud-perf__label {
  font-size: 0.66rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--hud-muted, #9fbdcd);
}

.hud-perf__value {
  font-size: 1.05rem;
  line-height: 1.1;
}

.hud-perf__unit {
  font-size: 0.66rem;
  letter-spacing: 0.18em;
  color: var(--hud-muted, #9fbdcd);
}

.hud-perf__tier {
  margin-left: auto;
  padding: 0.1rem 0.42rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--hud-cyan, #35f0ff);
}

.hud-perf[data-tier='minimal'] .hud-perf__tier {
  color: var(--hud-alarm, #ff5c7a);
}

.hud-perf[data-tier='boosted'] .hud-perf__tier {
  color: var(--hud-ok, #59ff9b);
}

.hud-perf__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.6rem;
  font-size: 0.68rem;
  color: var(--hud-muted, #9fbdcd);
}

.hud-perf__meta[data-over-budget='true'] {
  color: var(--hud-amber, #ffc15c);
}

.hud-perf__verdict {
  justify-self: start;
  padding: 0.1rem 0.42rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.66rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--hud-muted, #9fbdcd);
}

.hud-perf__verdict[data-verdict='held'] {
  color: var(--hud-ok, #59ff9b);
}

.hud-perf__verdict[data-verdict='over'] {
  color: var(--hud-alarm, #ff5c7a);
}

.hud-perf__mode {
  padding: 0.1rem 0.42rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.66rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--hud-muted, #9fbdcd);
}

.hud-perf__mode[data-hold='true'] {
  color: var(--hud-amber, #ffc15c);
}

.hud-perf__stress {
  justify-self: start;
  padding: 0.24rem 0.55rem;
  border: 1px solid rgba(184, 233, 245, 0.34);
  border-radius: 0.35rem;
  background: rgba(4, 10, 20, 0.72);
  color: var(--hud-ink, #e8f7ff);
  font: inherit;
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  cursor: pointer;
  /* The only interactive part of the badge, so the only part that takes input. */
  pointer-events: auto;
}

.hud-perf__stress:hover {
  border-color: var(--hud-cyan, #35f0ff);
}

.hud-perf__stress[aria-pressed='true'] {
  border-color: var(--hud-magenta, #ff4fd8);
  color: var(--hud-magenta, #ff4fd8);
}

.hud-perf__stress:focus-visible {
  outline: 2px solid var(--hud-cyan, #35f0ff);
  outline-offset: 2px;
}
`;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function resolveDocument(doc?: Document): Document | null {
  if (doc) return doc;
  return typeof document === 'undefined' ? null : document;
}

/** Find the HUD anchor through its stable attribute, or `null` when there is none. */
export function resolvePerfAnchor(doc: Document): HTMLElement | null {
  for (const key of PERF_ANCHOR_KEYS) {
    const anchor = doc.querySelector<HTMLElement>(`[data-hud="${key}"]`);
    if (anchor) return anchor;
  }
  return null;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: {
    className?: string;
    hud?: string;
    text?: string;
    parent?: HTMLElement;
  } = {},
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.hud) element.setAttribute('data-hud', options.hud);
  if (options.text !== undefined) element.textContent = options.text;
  options.parent?.append(element);
  return element;
}

/** Ensure the badge's scoped stylesheet exists exactly once in the document. */
function installStyles(doc: Document): HTMLStyleElement | null {
  const head = doc.head ?? null;
  if (!head) return null;
  const existing = head.querySelector<HTMLStyleElement>(`style[${PERF_STYLE_ATTRIBUTE}]`);
  if (existing) return null;
  const style = doc.createElement('style');
  style.setAttribute(PERF_STYLE_ATTRIBUTE, 'true');
  style.textContent = PERF_BADGE_STYLES;
  head.append(style);
  return style;
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Build the badge and mount it on the HUD overlay anchor.
 *
 * The handle owns the elements it created, the stylesheet it injected and the
 * button listener: `dispose()` removes all three and is idempotent.
 */
export function createPerfBadge(options: PerfBadgeOptions): PerfBadgeHandle {
  const doc = resolveDocument(options.doc);
  if (!doc) {
    throw new Error('[coroid] the perf badge needs a document to mount into');
  }

  const anchor = resolvePerfAnchor(doc);
  const mount = anchor ?? options.host ?? (doc.body as HTMLElement | null);
  if (!mount) {
    throw new Error('[coroid] the perf badge needs a mount point');
  }

  const style = installStyles(doc);

  const root = createElement(doc, 'div', { className: 'hud-perf', hud: PERF_HUD_KEYS.badge });
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'off');
  root.setAttribute('aria-label', 'Render performance');
  root.dataset.tier = options.quality.tier;
  // Inline as well as declared: the gesture contract must hold even if the
  // scoped stylesheet is stripped by a host that owns its own CSS.
  root.style.pointerEvents = 'none';

  const head = createElement(doc, 'div', { className: 'hud-perf__head', parent: root });
  createElement(doc, 'span', { className: 'hud-perf__label', text: 'PERF', parent: head });
  const fps = createElement(doc, 'span', {
    className: 'hud-perf__value',
    hud: PERF_HUD_KEYS.fps,
    text: '—',
    parent: head,
  });
  createElement(doc, 'span', { className: 'hud-perf__unit', text: 'FPS', parent: head });
  const tier = createElement(doc, 'span', {
    className: 'hud-perf__tier',
    hud: PERF_HUD_KEYS.tier,
    text: options.quality.tier.toUpperCase(),
    parent: head,
  });
  const mode = createElement(doc, 'span', {
    className: 'hud-perf__mode',
    hud: PERF_HUD_KEYS.mode,
    text: options.quality.holding ? 'HELD' : 'AUTO',
    parent: head,
  });
  mode.dataset.hold = options.quality.holding ? 'true' : 'false';

  const meta = createElement(doc, 'div', { className: 'hud-perf__meta', parent: root });
  const median = createElement(doc, 'span', {
    hud: PERF_HUD_KEYS.median,
    text: 'median — ms',
    parent: meta,
  });
  const p95 = createElement(doc, 'span', {
    hud: PERF_HUD_KEYS.p95,
    text: 'p95 — ms',
    parent: meta,
  });
  const verdict = createElement(doc, 'span', {
    className: 'hud-perf__verdict',
    hud: PERF_HUD_KEYS.verdict,
    text: 'MEASURING',
    parent: meta,
  });
  verdict.dataset.verdict = 'measuring';

  let stressButton: HTMLButtonElement | null = null;
  let onStressClick: (() => void) | null = null;
  if (options.stressControl !== false) {
    stressButton = createElement(doc, 'button', {
      className: 'hud-perf__stress',
      hud: PERF_HUD_KEYS.stress,
      parent: root,
    });
    stressButton.type = 'button';
    stressButton.textContent = 'STRESS';
    stressButton.setAttribute('aria-pressed', 'false');
    stressButton.title = 'Force sustained load and watch the tier downgrade';
    stressButton.style.pointerEvents = 'auto';
    stressButton.dataset.stress = 'off';
    onStressClick = (): void => {
      options.quality.setStress(!options.quality.stressActive);
      update();
    };
    stressButton.addEventListener('click', onStressClick);
  }

  mount.append(root);

  let rendered = 0;
  let lastFps = '';
  let lastTier = '';
  let lastMedian = '';
  let lastP95 = '';
  let lastStress = false;
  let lastOverBudget = false;
  let lastVerdict = '';
  let lastMode = '';
  let disposed = false;

  function update(): void {
    if (disposed) return;
    const quality = options.quality;
    const stats = quality.stats;
    const nextTier = quality.tier;
    // The readout carries the tier's own budget so the numbers can be read
    // against it — `median 41.2 / 33.3 ms ✗` is a budget the tier is missing.
    const budgetMs = stats.budgetMs;
    const nextFps = stats.samples > 0 ? String(Math.round(stats.fps)) : '—';
    const nextMedian =
      stats.samples > 0
        ? `median ${stats.medianMs.toFixed(1)} / ${budgetMs.toFixed(1)} ms ${stats.medianMs <= budgetMs ? '✓' : '✗'}`
        : 'median — ms';
    const nextP95 =
      stats.samples > 0
        ? `p95 ${stats.p95Ms.toFixed(1)} / ${(budgetMs * 2).toFixed(1)} ms ${stats.p95Ms <= budgetMs * 2 ? '✓' : '✗'}`
        : 'p95 — ms';
    const nextStress = quality.stressActive;
    const nextOverBudget = stats.overBudget;

    if (nextFps !== lastFps) {
      fps.textContent = nextFps;
      lastFps = nextFps;
      rendered += 1;
    }
    if (nextTier !== lastTier) {
      tier.textContent = nextTier.toUpperCase();
      root.dataset.tier = nextTier;
      lastTier = nextTier;
      rendered += 1;
    }
    if (nextMedian !== lastMedian) {
      median.textContent = nextMedian;
      lastMedian = nextMedian;
      rendered += 1;
    }
    if (nextP95 !== lastP95) {
      p95.textContent = nextP95;
      lastP95 = nextP95;
      rendered += 1;
    }
    if (nextOverBudget !== lastOverBudget) {
      meta.dataset.overBudget = nextOverBudget ? 'true' : 'false';
      meta.dataset.budgetHeld = stats.budgetHeld ? 'true' : 'false';
      lastOverBudget = nextOverBudget;
      rendered += 1;
    }
    const nextVerdict =
      stats.samples <= 0 ? 'MEASURING' : stats.budgetHeld ? 'INSIDE BUDGET' : 'OVER BUDGET';
    if (nextVerdict !== lastVerdict) {
      verdict.textContent = nextVerdict;
      verdict.dataset.verdict =
        stats.samples <= 0 ? 'measuring' : stats.budgetHeld ? 'held' : 'over';
      lastVerdict = nextVerdict;
      rendered += 1;
    }
    const nextMode = quality.holding ? 'HELD' : 'AUTO';
    if (nextMode !== lastMode) {
      mode.textContent = nextMode;
      mode.dataset.hold = quality.holding ? 'true' : 'false';
      root.dataset.hold = quality.holding ? 'true' : 'false';
      lastMode = nextMode;
      rendered += 1;
    }
    if (stressButton && nextStress !== lastStress) {
      stressButton.setAttribute('aria-pressed', nextStress ? 'true' : 'false');
      stressButton.textContent = nextStress ? 'STRESS ON' : 'STRESS';
      stressButton.dataset.stress = nextStress ? 'on' : 'off';
      lastStress = nextStress;
      rendered += 1;
    }
  }

  update();

  return {
    root,
    anchor,
    fps,
    tier,
    median,
    p95,
    verdict,
    mode,
    stressButton,
    get rendered() {
      return rendered;
    },
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (stressButton && onStressClick) {
        stressButton.removeEventListener('click', onStressClick);
      }
      onStressClick = null;
      stressButton = null;
      root.remove();
      style?.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Game system                                                                */
/* -------------------------------------------------------------------------- */

export interface PerfBadgeSystemOptions extends PerfBadgeOptions {
  /** System id. Defaults to `ui/perf-badge`. */
  id?: string;
  /** Fixed steps between refreshes. Defaults to `PERF_UPDATE_EVERY_STEPS`. */
  updateEverySteps?: number;
}

/** The badge as a composable game system. */
export interface PerfBadgeSystem extends GameSystem {
  readonly badge: PerfBadgeHandle | null;
  /** Refreshes serviced since attach. */
  readonly updates: number;
  /** Repaint now, whatever the cadence says. */
  refresh(): void;
}

/**
 * Compose the badge as a game system.
 *
 * Register it after the HUD (so `[data-hud="overlay"]` exists) and after the
 * governor (so its state is live). Without a DOM the system attaches inert, so
 * headless runs compose the same registry without special-casing.
 */
export function createPerfBadgeSystem(options: PerfBadgeSystemOptions): PerfBadgeSystem {
  const every = Math.max(1, Math.floor(options.updateEverySteps ?? PERF_UPDATE_EVERY_STEPS));
  let badge: PerfBadgeHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let updates = 0;

  /** Source that also subscribes to tier changes, when the governor offers it. */
  const source = options.quality as PerfBadgeQualitySource & {
    subscribe?(listener: () => void): () => void;
  };

  return {
    id: options.id ?? 'ui/perf-badge',
    get badge() {
      return badge;
    },
    get updates() {
      return updates;
    },
    refresh(): void {
      badge?.update();
    },
    attach(): void {
      if (typeof document === 'undefined' && !options.doc) return;
      badge = createPerfBadge(options);
      // A tier change repaints immediately instead of waiting for the cadence.
      unsubscribe = source.subscribe ? source.subscribe(() => badge?.update()) : null;
    },
    update(update: SystemUpdate): void {
      if (!badge) return;
      if ((update.step - 1) % every !== 0) return;
      updates += 1;
      badge.update();
    },
    dispose(): void {
      unsubscribe?.();
      unsubscribe = null;
      badge?.dispose();
      badge = null;
    },
  };
}
