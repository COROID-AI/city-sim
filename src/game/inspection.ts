/**
 * Mission inspection rig — the deterministic control and readout surface for the
 * composed game.
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 * The lifecycle the mission plays is fast (mission one ships in ≈1.4 s of wall
 * clock at the shipped defaults) and several phases last a single fixed step, so
 * at a low frame rate the `Plan`, `Verify` and `Repair` *screens* cannot be
 * caught from the auto-playing arc alone. The rig gives the shipped game a
 * deterministic way to walk that lifecycle — and to verify the presentation
 * guarantees that depend on it — without changing the runtime, the registry or
 * the simulation:
 *
 *  - `[data-hud="lifecycle-phase"]` reports the mission phase as a first-class
 *    readout (text + `data-phase`), so every lifecycle screen has a stable hook
 *    even when the phase lasts one fixed step;
 *  - `[data-hud="inspection-next-phase"]` resumes the mission and holds it at the
 *    next phase change; `[data-hud="inspection-step"]` advances exactly one fixed
 *    step; `[data-hud="inspection-hold"]` makes every phase change pause;
 *  - `[data-hud="inspection-approve"]` acknowledges the human approval gate on the
 *    guided arc (`/?guided=1` composes the mission with `autoStart` and
 *    `autoApprove` off);
 *  - `[data-hud="reduced-motion-toggle"]` is a host-independent motion
 *    preference: it turns the camera rig's idle drift off, suppresses the audio
 *    bus's motion voices and stops CSS animation, while
 *    `[data-hud="motion-state"]` and `[data-hud="camera-pose"]` report the
 *    result;
 *  - `[data-hud="budget-check"]` runs the *shipped* fidelity governor over the
 *    documented mission-load cost model and reports the settled tier, its median
 *    and p95 frame times and whether the tier's budget held
 *    (`[data-hud="budget-check-verdict"]`).
 *
 * Everything here is additive: it reads the mission, the camera rig, the audio
 * bus and the governor through small ports, emits no domain events and never
 * mutates simulation state. `src/game/Game.ts` and the registry are untouched.
 *
 * Without a DOM the system attaches inert, so the same composition runs in Node.
 */

import {
  createAdaptiveQuality,
  QUALITY_WINDOW_SIZE,
  resolveTierSettings,
  STRESS_INSTANCE_CAPACITY,
  type QualityTier,
} from '../render/qualityTiers';
import type { MissionOutcome, MissionPhase } from './flow';
import type { GameSystem, SystemContext, SystemUpdate } from './systems';

/* -------------------------------------------------------------------------- */
/* Stable hooks                                                               */
/* -------------------------------------------------------------------------- */

/** Stable `data-hud` hooks the inspection rig exposes. */
export const INSPECTION_HUD_KEYS = {
  /** The whole rig (`<section>`). */
  root: 'inspection',
  /** Lifecycle phase readout: text + `data-phase`. */
  phase: 'lifecycle-phase',
  /** Run-state readout: `paused` / `running`, mirrored in `data-paused`. */
  phaseState: 'lifecycle-state',
  /** Resume and hold at the next phase change. */
  nextPhase: 'inspection-next-phase',
  /** Advance exactly one fixed simulation step. */
  step: 'inspection-step',
  /** Acknowledge what the mission waits on and run it to the release. */
  play: 'inspection-play',
  /** Acknowledge the human approval gate. */
  approve: 'inspection-approve',
  /** Pause at every phase change. */
  hold: 'inspection-hold',
  /** Link into the guided arc (`?guided=1`). */
  guidedLink: 'guided-link',
  /** Motion preference toggle. */
  motionToggle: 'reduced-motion-toggle',
  /** Motion readout: `reduced` / `full`, mirrored in `data-reduced-motion`. */
  motionState: 'motion-state',
  /** Camera pose readout, mirrored in `data-pose` at full precision. */
  cameraPose: 'camera-pose',
  /** Run the closed-loop fidelity self-test. */
  budgetCheck: 'budget-check',
  /** Self-test verdict: `pass` / `fail`, mirrored in `data-verdict`. */
  budgetVerdict: 'budget-check-verdict',
  /** Tier the self-test settled on. */
  budgetTier: 'budget-check-tier',
  /** Settled median frame time against the tier target. */
  budgetMedian: 'budget-check-median',
  /** Settled p95 frame time against the tier ceiling. */
  budgetP95: 'budget-check-p95',
} as const;

/** Attribute marking the rig's scoped stylesheet. */
export const INSPECTION_STYLE_ATTRIBUTE = 'data-coroid-inspection';

/** Root attribute the motion toggle sets, so the reduced-motion CSS applies. */
export const INSPECTION_MOTION_ATTRIBUTE = 'data-coroid-motion';

/**
 * Scoped stylesheet. Deliberately self-contained: the rig must be readable and
 * clickable even when a host owns its own CSS, so the interactive parts carry
 * `pointer-events: auto` inline as well.
 */
export const INSPECTION_STYLES = `
.hud-inspect {
  /* Pinned to the free bottom-right corner: the banner owns the top centre, the
     event terminal the bottom left, and both would otherwise swallow the rig's
     clicks. Below the modal panel layer (z-index 20), so a panel still covers it. */
  position: fixed;
  right: 1.1rem;
  bottom: 1.1rem;
  z-index: 12;
  display: grid;
  gap: 0.34rem;
  padding: 0.5rem 0.62rem;
  max-width: 21rem;
  border: 1px solid rgba(184, 233, 245, 0.22);
  border-radius: 0.5rem;
  background: rgba(4, 10, 20, 0.74);
  color: var(--hud-muted, #9fbdcd);
  /* 0.7rem keeps every functional label at the 11px legibility floor. */
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  pointer-events: auto;
}

.hud-inspect__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.32rem 0.5rem;
}

.hud-inspect__label {
  color: var(--hud-cyan, #35f0ff);
}

.hud-inspect__value {
  color: var(--hud-ink, #e8f7ff);
}

.hud-inspect__value[data-phase='repair'] {
  color: var(--hud-alarm, #ff5c7a);
}

.hud-inspect__value[data-phase='release'] {
  color: var(--hud-ok, #59ff9b);
}

.hud-inspect__value[data-verdict='pass'] {
  color: var(--hud-ok, #59ff9b);
}

.hud-inspect__value[data-verdict='fail'] {
  color: var(--hud-alarm, #ff5c7a);
}

.hud-inspect button {
  padding: 0.22rem 0.5rem;
  border: 1px solid rgba(184, 233, 245, 0.34);
  border-radius: 0.3rem;
  background: rgba(4, 10, 20, 0.72);
  color: var(--hud-ink, #e8f7ff);
  font: inherit;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  cursor: pointer;
  pointer-events: auto;
}

.hud-inspect button:hover {
  border-color: var(--hud-cyan, #35f0ff);
}

.hud-inspect button[aria-pressed='true'] {
  border-color: var(--hud-magenta, #ff4fd8);
  color: var(--hud-magenta, #ff4fd8);
}

.hud-inspect button:focus-visible,
.hud-inspect a:focus-visible {
  outline: 2px solid var(--hud-cyan, #35f0ff);
  outline-offset: 2px;
}

.hud-inspect a {
  color: var(--hud-ink, #e8f7ff);
  text-decoration-color: var(--hud-cyan, #35f0ff);
  pointer-events: auto;
}

/* The motion preference applies to the DOM the same way the media query does. */
:root[${INSPECTION_MOTION_ATTRIBUTE}='reduced'] *,
:root[${INSPECTION_MOTION_ATTRIBUTE}='reduced'] *::before,
:root[${INSPECTION_MOTION_ATTRIBUTE}='reduced'] *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
}
`;

/* -------------------------------------------------------------------------- */
/* Fidelity self-test                                                         */
/* -------------------------------------------------------------------------- */

/** Modelled extra work a full mission load adds to every frame, milliseconds. */
export const MISSION_LOAD_MS = 20;
/** Fixed step the self-test models. */
export const BUDGET_CHECK_STEP_MS = 1000 / 60;
/** Frames the self-test feeds the governor before it reads the window. */
export const BUDGET_CHECK_FRAMES = 480;

export interface BudgetCheckOptions {
  /** Tier the run starts from. Defaults to `calm`. */
  load?: number;
  /** Extra work per frame. Defaults to {@link MISSION_LOAD_MS}. */
  tier?: QualityTier;
  stepMs?: number;
  frames?: number;
  window?: number;
  /** Instances the governed field draws at the starting tier. Defaults to 0. */
  instances?: number;
  minTier?: QualityTier;
  maxTier?: QualityTier;
}

export interface BudgetCheckResult {
  /** `pass` when the settled tier's own budget held. */
  readonly verdict: 'pass' | 'fail';
  readonly startTier: QualityTier;
  /** Tier the governor settled on. */
  readonly tier: QualityTier;
  readonly medianMs: number;
  readonly p95Ms: number;
  /** The settled tier's median target. */
  readonly budgetMs: number;
  /** The settled tier's p95 ceiling (2× target). */
  readonly ceilingMs: number;
  readonly frames: number;
  /** Tier changes the governor made while the run played. */
  readonly downgrades: number;
  readonly loadMs: number;
  readonly stepMs: number;
}

/**
 * Cost of one frame of a tier under the documented mission load.
 *
 * This is the model `docs/ACCEPTANCE.md` §4 specifies: cost rises with the four
 * settings a tier writes — pixel ratio, the post chain, shadows and instances —
 * on top of the simulation step the runtime already spends.
 */
export function missionLoadFrameMs(
  tier: QualityTier,
  loadMs: number,
  stepMs: number,
  instances = 0,
): number {
  const settings = resolveTierSettings(tier);
  const fill = settings.pixelRatio * settings.pixelRatio;
  const postFactor = settings.post ? 1 : 0.4;
  const shadowFactor = settings.shadows ? 1.3 : 1;
  const instanceFactor = 1 + Math.max(0, instances) / STRESS_INSTANCE_CAPACITY;
  return stepMs + Math.max(0, loadMs) * fill * postFactor * shadowFactor * instanceFactor;
}

/**
 * Run the mission-load closed loop through the shipped governor.
 *
 * The governor is the same `createAdaptiveQuality` controller the game composes,
 * fed the documented cost model, so the tier it settles on and the budget it is
 * judged against are the shipped ones. The verdict is the shipped statistics
 * record's own `budgetHeld`: median inside the tier target **and** p95 inside
 * its 2× ceiling.
 */
export function runMissionLoadBudgetCheck(options: BudgetCheckOptions = {}): BudgetCheckResult {
  const loadMs = options.load ?? MISSION_LOAD_MS;
  const stepMs = options.stepMs ?? BUDGET_CHECK_STEP_MS;
  const frames = Math.max(1, Math.floor(options.frames ?? BUDGET_CHECK_FRAMES));
  const instances = Math.max(0, options.instances ?? 0);
  const startTier = options.tier ?? 'calm';

  const adaptive = createAdaptiveQuality({
    tier: startTier,
    window: options.window ?? QUALITY_WINDOW_SIZE,
    minTier: options.minTier ?? 'minimal',
    maxTier: options.maxTier ?? 'boosted',
    allowUpgrade: true,
  });

  for (let frame = 0; frame < frames; frame += 1) {
    adaptive.observe(missionLoadFrameMs(adaptive.tier, loadMs, stepMs, instances));
  }

  const stats = adaptive.stats;
  const tier = adaptive.tier;
  const settings = resolveTierSettings(tier);
  const samples = stats.samples;
  const medianMs = samples > 0 ? stats.medianMs : Number.NaN;
  const p95Ms = samples > 0 ? stats.p95Ms : Number.NaN;
  const verdict: BudgetCheckResult['verdict'] =
    samples > 0 && stats.budgetHeld ? 'pass' : 'fail';

  return {
    verdict,
    startTier,
    tier,
    medianMs,
    p95Ms,
    budgetMs: settings.budget.targetMs,
    ceilingMs: settings.budget.ceilingMs,
    frames,
    downgrades: adaptive.changes,
    loadMs,
    stepMs,
  };
}

/* -------------------------------------------------------------------------- */
/* Ports                                                                      */
/* -------------------------------------------------------------------------- */

/** The slice of the mission system the rig drives. */
export interface InspectionMissionPort {
  readonly phase: MissionPhase | null;
  readonly flow: { readonly paused: boolean } | null;
  /** `running` until the mission wins or loses; the rig holds on the terminal. */
  readonly outcome: MissionOutcome | null;
  start(): boolean;
  approve(): boolean;
  setPaused(paused: boolean): void;
}

/** The slice of the camera rig the rig reads and configures. */
export interface InspectionCameraPort {
  readonly pose: {
    readonly azimuth: number;
    readonly polar: number;
    readonly distance: number;
    readonly fov: number;
    readonly focus: { readonly x: number; readonly y: number; readonly z: number };
  };
  setDrift(enabled: boolean): void;
}

/** The slice of the audio bus the rig reads and configures. */
export interface InspectionAudioPort {
  readonly reducedMotion: boolean;
  setReducedMotion(reducedMotion: boolean): void;
}

/** The slice of the fidelity governor the rig reads. */
export interface InspectionQualityPort {
  readonly tier: QualityTier;
  readonly applied: { readonly instanceCount: number };
}

/* -------------------------------------------------------------------------- */
/* Readout                                                                    */
/* -------------------------------------------------------------------------- */

export interface InspectionReadout {
  readonly phase: MissionPhase | null;
  readonly paused: boolean;
  readonly holding: boolean;
  readonly reducedMotion: boolean;
  readonly guided: boolean;
  readonly cameraPose: string | null;
  readonly budget: BudgetCheckResult | null;
}

/** Full-precision pose string, so two reads can be compared bit for bit. */
export function formatCameraPose(pose: InspectionCameraPort['pose']): string {
  return [
    pose.azimuth,
    pose.polar,
    pose.distance,
    pose.fov,
    pose.focus.x,
    pose.focus.y,
    pose.focus.z,
  ]
    .map((value) => `${value}`)
    .join(',');
}

export interface InspectionIntent {
  readonly type:
    | 'next-phase'
    | 'step'
    | 'play'
    | 'approve'
    | 'toggle-hold'
    | 'toggle-reduced-motion'
    | 'budget-check';
}

/* -------------------------------------------------------------------------- */
/* DOM                                                                        */
/* -------------------------------------------------------------------------- */

export interface InspectionControlsOptions {
  doc?: Document;
  /** Mount point. Defaults to the HUD root, then the overlay, then `body`. */
  host?: HTMLElement | null;
  guided?: boolean;
  reducedMotion?: boolean;
  onIntent(intent: InspectionIntent): void;
}

export interface InspectionControlsHandle {
  readonly root: HTMLElement;
  readonly phase: HTMLElement;
  readonly phaseState: HTMLElement;
  readonly motion: HTMLElement;
  readonly pose: HTMLElement;
  readonly budgetVerdict: HTMLElement;
  readonly budgetTier: HTMLElement;
  readonly budgetMedian: HTMLElement;
  readonly budgetP95: HTMLElement;
  readonly nextPhaseButton: HTMLButtonElement;
  readonly stepButton: HTMLButtonElement;
  readonly playButton: HTMLButtonElement;
  readonly approveButton: HTMLButtonElement;
  readonly holdButton: HTMLButtonElement;
  readonly motionButton: HTMLButtonElement;
  readonly budgetButton: HTMLButtonElement;
  /** Repaints serviced since creation. */
  readonly rendered: number;
  render(readout: InspectionReadout): void;
  /** Redraw the motion toggle without a full readout. */
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

function resolveDocument(doc?: Document): Document | null {
  if (doc) return doc;
  return typeof document === 'undefined' ? null : document;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: {
    className?: string;
    hud?: string;
    text?: string;
    title?: string;
    parent?: HTMLElement;
  } = {},
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.hud) element.setAttribute('data-hud', options.hud);
  if (options.text !== undefined) element.textContent = options.text;
  if (options.title) element.title = options.title;
  options.parent?.append(element);
  return element;
}

/** Ensure the rig's scoped stylesheet exists exactly once in the document. */
function installStyles(doc: Document): HTMLStyleElement | null {
  const head = doc.head ?? null;
  if (!head) return null;
  const existing = head.querySelector<HTMLStyleElement>(`style[${INSPECTION_STYLE_ATTRIBUTE}]`);
  if (existing) return null;
  const style = doc.createElement('style');
  style.setAttribute(INSPECTION_STYLE_ATTRIBUTE, 'true');
  style.textContent = INSPECTION_STYLES;
  head.append(style);
  return style;
}

/**
 * Find the rig's mount point.
 *
 * The HUD *root* is preferred: it fills the viewport without a transform, so the
 * rig's `position: fixed` lands where the stylesheet says instead of being
 * re-anchored to the overlay's own transform. The overlay is the fallback (older
 * hosts), then the explicit host, then `body`.
 */
export function resolveInspectionAnchor(
  doc: Document,
  host?: HTMLElement | null,
): HTMLElement | null {
  const root = doc.querySelector<HTMLElement>('[data-hud="root"]');
  if (root) return root;
  const overlay = doc.querySelector<HTMLElement>('[data-hud="overlay"]');
  if (overlay) return overlay;
  if (host) return host;
  return (doc.body as HTMLElement | null) ?? null;
}

/**
 * Build the inspection strip.
 *
 * The handle owns every element it creates, the stylesheet it injected and the
 * listeners it bound: `dispose()` removes all of them and is idempotent.
 */
export function createInspectionControls(
  options: InspectionControlsOptions,
): InspectionControlsHandle {
  const doc = resolveDocument(options.doc);
  if (!doc) {
    throw new Error('[coroid] the inspection rig needs a document to mount into');
  }
  const mount = resolveInspectionAnchor(doc, options.host);
  if (!mount) {
    throw new Error('[coroid] the inspection rig needs a mount point');
  }

  const style = installStyles(doc);

  const root = createElement(doc, 'section', {
    className: 'hud-inspect',
    hud: INSPECTION_HUD_KEYS.root,
  });
  root.setAttribute('aria-label', 'Mission inspection');
  root.style.pointerEvents = 'auto';

  const phaseRow = createElement(doc, 'div', { className: 'hud-inspect__row', parent: root });
  createElement(doc, 'span', {
    className: 'hud-inspect__label',
    text: 'Phase',
    parent: phaseRow,
  });
  const phase = createElement(doc, 'span', {
    className: 'hud-inspect__value',
    hud: INSPECTION_HUD_KEYS.phase,
    text: 'Phase briefing',
    parent: phaseRow,
  });
  phase.dataset.phase = 'brief';
  const phaseState = createElement(doc, 'span', {
    hud: INSPECTION_HUD_KEYS.phaseState,
    text: 'Run state running',
    parent: phaseRow,
  });
  phaseState.dataset.paused = 'false';

  const controlRow = createElement(doc, 'div', { className: 'hud-inspect__row', parent: root });
  const nextPhaseButton = createElement(doc, 'button', {
    hud: INSPECTION_HUD_KEYS.nextPhase,
    text: 'Next phase',
    title: 'Play the mission forward and hold it at the next lifecycle phase',
    parent: controlRow,
  });
  nextPhaseButton.type = 'button';
  const stepButton = createElement(doc, 'button', {
    hud: INSPECTION_HUD_KEYS.step,
    text: 'Step one step',
    title: 'Advance exactly one fixed simulation step and pause again',
    parent: controlRow,
  });
  stepButton.type = 'button';
  const playButton = createElement(doc, 'button', {
    hud: INSPECTION_HUD_KEYS.play,
    text: 'Play mission',
    title: 'Acknowledge what the mission waits on and run it to the release',
    parent: controlRow,
  });
  playButton.type = 'button';
  const approveButton = createElement(doc, 'button', {
    hud: INSPECTION_HUD_KEYS.approve,
    text: 'Approve plan',
    title: 'Acknowledge the plan approval gate',
    parent: controlRow,
  });
  approveButton.type = 'button';
  const holdButton = createElement(doc, 'button', {
    hud: INSPECTION_HUD_KEYS.hold,
    text: 'Hold phases',
    title: 'Pause the mission at every lifecycle phase change',
    parent: controlRow,
  });
  holdButton.type = 'button';
  holdButton.setAttribute('aria-pressed', 'false');
  holdButton.dataset.hold = 'off';

  const guidedRow = createElement(doc, 'div', { className: 'hud-inspect__row', parent: root });
  const guidedLink = createElement(doc, 'a', {
    hud: INSPECTION_HUD_KEYS.guidedLink,
    text: options.guided ? 'Auto run' : 'Guided replay',
    parent: guidedRow,
  });
  guidedLink.setAttribute('href', options.guided ? './' : '?guided=1');
  guidedLink.title = options.guided
    ? 'Reload the auto-playing mission'
    : 'Reload with the human-gated mission arc and phase holds';
  createElement(doc, 'span', {
    text: options.guided ? 'human-gated arc' : 'auto-playing arc',
    parent: guidedRow,
  });

  const motionRow = createElement(doc, 'div', { className: 'hud-inspect__row', parent: root });
  const motionButton = createElement(doc, 'button', {
    hud: INSPECTION_HUD_KEYS.motionToggle,
    text: 'Reduce motion',
    title: 'Suppress the camera drift, audio motion voices and CSS animation',
    parent: motionRow,
  });
  motionButton.type = 'button';
  motionButton.setAttribute('aria-pressed', options.reducedMotion ? 'true' : 'false');
  const motion = createElement(doc, 'span', {
    className: 'hud-inspect__value',
    hud: INSPECTION_HUD_KEYS.motionState,
    text: `Motion ${options.reducedMotion ? 'reduced' : 'full'}`,
    parent: motionRow,
  });
  motion.dataset.reducedMotion = options.reducedMotion ? 'true' : 'false';

  const poseRow = createElement(doc, 'div', { className: 'hud-inspect__row', parent: root });
  const pose = createElement(doc, 'span', {
    hud: INSPECTION_HUD_KEYS.cameraPose,
    text: 'Pose —',
    parent: poseRow,
  });
  pose.dataset.pose = '';

  const budgetRow = createElement(doc, 'div', { className: 'hud-inspect__row', parent: root });
  const budgetButton = createElement(doc, 'button', {
    hud: INSPECTION_HUD_KEYS.budgetCheck,
    text: 'Run budget check',
    title: 'Run the shipped governor over the mission-load cost model',
    parent: budgetRow,
  });
  budgetButton.type = 'button';
  const budgetVerdict = createElement(doc, 'span', {
    className: 'hud-inspect__value',
    hud: INSPECTION_HUD_KEYS.budgetVerdict,
    text: 'Frame budget not run',
    parent: budgetRow,
  });
  budgetVerdict.dataset.verdict = 'unrun';
  const budgetTier = createElement(doc, 'span', {
    hud: INSPECTION_HUD_KEYS.budgetTier,
    text: 'tier —',
    parent: budgetRow,
  });
  budgetTier.dataset.tier = '';
  const budgetMedian = createElement(doc, 'span', {
    hud: INSPECTION_HUD_KEYS.budgetMedian,
    text: 'Median — ms',
    parent: budgetRow,
  });
  budgetMedian.dataset.medianMs = '';
  const budgetP95 = createElement(doc, 'span', {
    hud: INSPECTION_HUD_KEYS.budgetP95,
    text: 'P95 — ms',
    parent: budgetRow,
  });
  budgetP95.dataset.p95Ms = '';

  const listeners: { element: HTMLElement; type: string; handler: EventListener }[] = [];
  function bind(element: HTMLElement, intent: InspectionIntent['type']): void {
    const handler: EventListener = () => {
      options.onIntent({ type: intent });
    };
    element.addEventListener('click', handler);
    listeners.push({ element, type: 'click', handler });
  }
  bind(nextPhaseButton, 'next-phase');
  bind(stepButton, 'step');
  bind(playButton, 'play');
  bind(approveButton, 'approve');
  bind(holdButton, 'toggle-hold');
  bind(motionButton, 'toggle-reduced-motion');
  bind(budgetButton, 'budget-check');

  mount.append(root);

  let rendered = 0;
  let lastPhase = '';
  let lastPaused: boolean | null = null;
  let lastPose = '';
  let lastMotion = '';
  let lastHolding: boolean | null = null;
  let lastVerdict = '';
  let lastBudgetTier = '';
  let lastMedian = '';
  let lastP95 = '';
  let disposed = false;

  function setReducedMotion(reducedMotion: boolean): void {
    if (disposed) return;
    motionButton.setAttribute('aria-pressed', reducedMotion ? 'true' : 'false');
    motion.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }

  function render(readout: InspectionReadout): void {
    if (disposed) return;
    const phaseKey = readout.phase ?? 'none';
    if (phaseKey !== lastPhase) {
      phase.textContent = `Phase ${phaseKey}`;
      phase.dataset.phase = phaseKey;
      lastPhase = phaseKey;
      rendered += 1;
    }
    if (readout.paused !== lastPaused) {
      phaseState.textContent = `Run state ${readout.paused ? 'paused' : 'running'}`;
      phaseState.dataset.paused = readout.paused ? 'true' : 'false';
      lastPaused = readout.paused;
      rendered += 1;
    }
    if (readout.holding !== lastHolding) {
      holdButton.setAttribute('aria-pressed', readout.holding ? 'true' : 'false');
      holdButton.dataset.hold = readout.holding ? 'on' : 'off';
      holdButton.textContent = readout.holding ? 'Holding phases' : 'Hold phases';
      lastHolding = readout.holding;
      rendered += 1;
    }
    const motionKey = readout.reducedMotion ? 'reduced' : 'full';
    if (motionKey !== lastMotion) {
      setReducedMotion(readout.reducedMotion);
      motion.textContent = `Motion ${motionKey}`;
      lastMotion = motionKey;
      rendered += 1;
    }
    const poseKey = readout.cameraPose ?? '';
    if (poseKey !== lastPose) {
      pose.dataset.pose = poseKey;
      pose.textContent = poseKey ? `Pose ${poseKey}` : 'Pose —';
      lastPose = poseKey;
      rendered += 1;
    }
    renderBudget(readout.budget);
  }

  function renderBudget(budget: BudgetCheckResult | null): void {
    if (disposed) return;
    if (!budget) {
      if (lastVerdict !== 'unrun') {
        budgetVerdict.textContent = 'Frame budget not run';
        budgetVerdict.dataset.verdict = 'unrun';
        budgetTier.textContent = 'tier —';
        budgetTier.dataset.tier = '';
        budgetMedian.textContent = 'Median — ms';
        budgetMedian.dataset.medianMs = '';
        budgetP95.textContent = 'P95 — ms';
        budgetP95.dataset.p95Ms = '';
        lastVerdict = 'unrun';
        lastBudgetTier = '';
        lastMedian = '';
        lastP95 = '';
        rendered += 1;
      }
      return;
    }
    if (budget.verdict !== lastVerdict) {
      budgetVerdict.textContent =
        budget.verdict === 'pass' ? 'Frame budget held' : 'Frame budget missed';
      budgetVerdict.dataset.verdict = budget.verdict;
      lastVerdict = budget.verdict;
      rendered += 1;
    }
    if (budget.tier !== lastBudgetTier) {
      budgetTier.textContent = `tier ${budget.tier}`;
      budgetTier.dataset.tier = budget.tier;
      lastBudgetTier = budget.tier;
      rendered += 1;
    }
    const median = `${budget.medianMs.toFixed(1)} / ${budget.budgetMs.toFixed(1)} ms`;
    if (median !== lastMedian) {
      budgetMedian.textContent = `Median ${median}`;
      budgetMedian.dataset.medianMs = budget.medianMs.toFixed(1);
      budgetMedian.dataset.budgetMs = budget.budgetMs.toFixed(1);
      lastMedian = median;
      rendered += 1;
    }
    const p95 = `${budget.p95Ms.toFixed(1)} / ${budget.ceilingMs.toFixed(1)} ms`;
    if (p95 !== lastP95) {
      budgetP95.textContent = `P95 ${p95}`;
      budgetP95.dataset.p95Ms = budget.p95Ms.toFixed(1);
      budgetP95.dataset.ceilingMs = budget.ceilingMs.toFixed(1);
      lastP95 = p95;
      rendered += 1;
    }
  }

  return {
    root,
    phase,
    phaseState,
    motion,
    pose,
    budgetVerdict,
    budgetTier,
    budgetMedian,
    budgetP95,
    nextPhaseButton,
    stepButton,
    playButton,
    approveButton,
    holdButton,
    motionButton,
    budgetButton,
    get rendered() {
      return rendered;
    },
    render,
    setReducedMotion,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const listener of listeners) {
        listener.element.removeEventListener(listener.type, listener.handler);
      }
      listeners.length = 0;
      root.remove();
      style?.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Game system                                                                */
/* -------------------------------------------------------------------------- */

export interface InspectionSystemOptions {
  /** System id. Defaults to `ui/inspection`. */
  id?: string;
  doc?: Document;
  /** Mount point. Defaults to the HUD root. */
  host?: HTMLElement | null;
  mission: () => InspectionMissionPort | null;
  camera?: () => InspectionCameraPort | null;
  audio?: () => InspectionAudioPort | null;
  quality?: () => InspectionQualityPort | null;
  /** Hold every phase change from the start (the guided arc). */
  guided?: boolean;
  /** Start with motion-like layers suppressed. Defaults to `false`. */
  reducedMotion?: boolean;
  /**
   * Tier the self-test starts from. Defaults to the shipped default (`calm`), so
   * the check demonstrates the downgrade the criterion describes on every host.
   */
  budgetTier?: QualityTier;
  /** Modelled load the self-test feeds the governor. */
  budgetLoadMs?: number;
  budgetStepMs?: number;
  budgetFrames?: number;
}

export interface InspectionSystem extends GameSystem {
  readonly id: string;
  readonly controls: InspectionControlsHandle | null;
  readonly phase: MissionPhase | null;
  readonly holding: boolean;
  readonly reducedMotion: boolean;
  readonly cameraPose: string | null;
  readonly budget: BudgetCheckResult | null;
  /** Resume the mission and hold it at the next phase change. */
  nextPhase(): boolean;
  /** Advance exactly one fixed step and pause again. */
  step(): boolean;
  /** Acknowledge what the mission waits on and run it to the release. */
  play(): boolean;
  /** Acknowledge the approval gate. */
  approve(): boolean;
  setHolding(holding: boolean): boolean;
  setReducedMotion(reducedMotion: boolean): void;
  /** Run the closed-loop fidelity self-test and publish it on the readout. */
  runBudgetCheck(): BudgetCheckResult;
}

/** Fixed steps an armed "next phase" may run before it pauses anyway. */
export const NEXT_PHASE_STEP_CAP = 600;

/**
 * Compose the inspection rig as a game system.
 *
 * Register it after the governor and the perf badge: it reads the mission, the
 * camera rig, the audio bus and the governor, all of which exist by then.
 * Without a DOM it still tracks the mission and answers every control call, so
 * headless runs compose the same list.
 */
export function createInspectionSystem(options: InspectionSystemOptions): InspectionSystem {
  const doc = options.doc ?? resolveDocument();
  let controls: InspectionControlsHandle | null = null;

  let lastPhase: MissionPhase | null = null;
  let holding = options.guided === true;
  let reducedMotion = options.reducedMotion === true;
  let stepBudget = 0;
  let awaiting = false;
  let awaitingPhase: MissionPhase | null = null;
  let awaitSteps = 0;
  let awaitingRelease = false;
  let budget: BudgetCheckResult | null = null;
  let disposed = false;

  function mission(): InspectionMissionPort | null {
    return options.mission();
  }

  function poseString(): string | null {
    const camera = options.camera?.() ?? null;
    return camera ? formatCameraPose(camera.pose) : null;
  }

  function applyReducedMotion(reduced: boolean): void {
    options.camera?.()?.setDrift(!reduced);
    options.audio?.()?.setReducedMotion(reduced);
    if (doc) doc.documentElement.setAttribute(INSPECTION_MOTION_ATTRIBUTE, reduced ? 'reduced' : 'full');
    controls?.setReducedMotion(reduced);
  }

  function readout(): InspectionReadout {
    const port = mission();
    return {
      phase: port?.phase ?? null,
      paused: port?.flow?.paused ?? true,
      holding,
      reducedMotion: options.audio?.()?.reducedMotion ?? reducedMotion,
      guided: options.guided === true,
      cameraPose: poseString(),
      budget,
    };
  }

  function render(): void {
    controls?.render(readout());
  }

  const system: InspectionSystem = {
    id: options.id ?? 'ui/inspection',
    get controls() {
      return controls;
    },
    get phase() {
      return mission()?.phase ?? null;
    },
    get holding() {
      return holding;
    },
    get reducedMotion() {
      return options.audio?.()?.reducedMotion ?? reducedMotion;
    },
    get cameraPose() {
      return poseString();
    },
    get budget() {
      return budget;
    },
    nextPhase(): boolean {
      const port = mission();
      if (!port) return false;
      if (port.phase === 'brief') {
        // `start()` decomposes the request and lands on the approval gate in one
        // call, so there is no phase change left to wait for: hold right there.
        port.start();
        port.setPaused(true);
        render();
        return true;
      }
      stepBudget = 0;
      awaitingRelease = false;
      awaiting = true;
      awaitingPhase = port.phase;
      awaitSteps = 0;
      port.setPaused(false);
      render();
      return true;
    },
    step(): boolean {
      const port = mission();
      if (!port) return false;
      awaiting = false;
      awaitingRelease = false;
      stepBudget += 1;
      port.setPaused(false);
      return true;
    },
    play(): boolean {
      const port = mission();
      if (!port) return false;
      // Acknowledge whatever the mission is waiting on — the brief, then the
      // approval gate — and run the shipped arc to its release, holding there.
      if (port.phase === 'brief') port.start();
      if (port.phase === 'approve') port.approve();
      holding = false;
      awaiting = false;
      stepBudget = 0;
      awaitingRelease = true;
      port.setPaused(false);
      render();
      return true;
    },
    approve(): boolean {
      const port = mission();
      if (!port) return false;
      awaitingRelease = false;
      const approved = port.approve();
      if (holding) port.setPaused(true);
      render();
      return approved;
    },
    setHolding(next: boolean): boolean {
      const value = next === true;
      if (value === holding) return holding;
      if (!value) awaitingRelease = false;
      holding = value;
      render();
      return holding;
    },
    setReducedMotion(next: boolean): void {
      reducedMotion = next === true;
      applyReducedMotion(reducedMotion);
      render();
    },
    runBudgetCheck(): BudgetCheckResult {
      const quality = options.quality?.() ?? null;
      const result = runMissionLoadBudgetCheck({
        ...(options.budgetTier ? { tier: options.budgetTier } : {}),
        load: options.budgetLoadMs,
        stepMs: options.budgetStepMs,
        frames: options.budgetFrames,
        instances: quality?.applied.instanceCount ?? 0,
      });
      budget = result;
      render();
      return result;
    },
    attach(_context: SystemContext): void {
      if (disposed) return;
      // Before the first step the phase is whatever the mission already reports,
      // so a paused run renders its phase immediately.
      lastPhase = mission()?.phase ?? null;
      applyReducedMotion(reducedMotion);
      if (doc) {
        controls = createInspectionControls({
          doc,
          ...(options.host ? { host: options.host } : {}),
          guided: options.guided === true,
          reducedMotion,
          onIntent: (intent) => {
            switch (intent.type) {
              case 'next-phase':
                system.nextPhase();
                break;
              case 'step':
                system.step();
                break;
              case 'play':
                system.play();
                break;
              case 'approve':
                system.approve();
                break;
              case 'toggle-hold':
                system.setHolding(!holding);
                break;
              case 'toggle-reduced-motion':
                system.setReducedMotion(!system.reducedMotion);
                break;
              case 'budget-check':
                system.runBudgetCheck();
                break;
            }
            render();
          },
        });
      }
      render();
    },
    update(_update: SystemUpdate): void {
      if (disposed) return;
      const port = mission();
      const phase = port?.phase ?? null;

      if (port) {
        if (stepBudget > 0) {
          // The mission has already advanced this step: spend the budget and
          // re-pause, which makes one click exactly one fixed step.
          stepBudget -= 1;
          if (stepBudget === 0) port.setPaused(true);
        }
        if (awaiting) {
          awaitSteps += 1;
          if (phase !== awaitingPhase || awaitSteps >= NEXT_PHASE_STEP_CAP) {
            awaiting = false;
            port.setPaused(true);
          }
        }
        if (awaitingRelease && (phase === 'release' || port.outcome !== 'running')) {
          // The arc is over: hold the release screen for whoever asked to watch it.
          awaitingRelease = false;
          port.setPaused(true);
        }
        if (phase !== lastPhase) {
          lastPhase = phase;
          if (holding) port.setPaused(true);
        }
      }

      render();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      controls?.dispose();
      controls = null;
      budget = null;
      awaiting = false;
      awaitingRelease = false;
      stepBudget = 0;
    },
  };

  return system;
}

/* -------------------------------------------------------------------------- */
/* Read-model helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Whether the readout says the run is currently paused. */
export function isInspectionPaused(system: InspectionSystem): boolean {
  return system.controls ? system.controls.phaseState.dataset.paused === 'true' : false;
}
