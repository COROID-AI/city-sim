/**
 * Coroid interface panels: task inspector, plan outline, verification report and
 * codex.
 *
 * The panels are modal dialogs over the hologram. They read a frozen
 * `GameState` snapshot (plus the execution-contract data the flow layer hands
 * in) and never mutate anything: a player action becomes a callback
 * (`onIntent`) or an announcement (`announce`), never a state write.
 *
 * What each panel shows:
 *  - **inspector** — the selected task: read set, write set, checks, criteria,
 *    source claims (each claim carrying its provenance chip) and the findings
 *    raised against it;
 *  - **outline** — the plan grouped into dependency phases, with each task's
 *    lane, status and progress; activating a row selects the task and opens the
 *    inspector;
 *  - **report** — verification gates, pass rate, quality metrics and findings;
 *  - **codex** — every concept the mission uses (mission, lanes, gates, metrics,
 *    economy), derived from the snapshot so it always matches what is on screen.
 *
 * Accessibility contract:
 *  - each panel is a `dialog` (`aria-modal`, labelled by its heading) opened at
 *    most one at a time;
 *  - focus is trapped inside the open panel (Tab/Shift+Tab cycle, arrow keys and
 *    Home/End walk the rows) and restored to the opener when it closes;
 *  - Escape always closes;
 *  - opening, closing and switching tasks announce through the live region the
 *    HUD owns (`announce`), so screen-reader users hear what changed.
 *
 * Dependency direction: panels → hud (`src/ui/hud.ts`). The HUD never imports
 * panels.
 */

import type { DeepReadonly, GameState, LaneKind, QualityFinding, TaskStatus } from '../sim/state';

import {
  clearElement,
  createHudElement,
  createProvenanceChip,
  formatInteger,
  formatPercent,
  readBudget,
  readClock,
  readInvariants,
  readLaneOccupancy,
  readPlanOutline,
  readPlanPhases,
  readPhase,
  resolveDocument,
  type HudState,
  type PlanOutlineRow,
  type ProvenanceKind,
} from './hud';

/* -------------------------------------------------------------------------- */
/* Panel kinds                                                                */
/* -------------------------------------------------------------------------- */

export type PanelKind = 'inspector' | 'outline' | 'report' | 'codex';

/** Canonical panel order (used by toolbars, hotkey help and tests). */
export const PANEL_KINDS: readonly PanelKind[] = ['inspector', 'outline', 'report', 'codex'];

/** Heading shown for each panel. */
export const PANEL_TITLES: Readonly<Record<PanelKind, string>> = {
  inspector: 'Task inspector',
  outline: 'Plan outline',
  report: 'Verification report',
  codex: 'Codex',
};

/* -------------------------------------------------------------------------- */
/* Focus management                                                           */
/* -------------------------------------------------------------------------- */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Duck-typed focusable check; avoids cross-realm `instanceof` traps. */
function asFocusable(value: Element | null | undefined): HTMLElement | null {
  if (!value) return null;
  const candidate = value as HTMLElement;
  return typeof candidate.focus === 'function' ? candidate : null;
}

/** Every focusable element inside `container` that is not inside a hidden node. */
export function listFocusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hasAttribute('disabled') && element.closest('[hidden]') === null,
  );
}

export interface FocusTrap {
  readonly active: boolean;
  /** Element focus returns to on `deactivate()`. */
  readonly restoreTarget: HTMLElement | null;
  /** Start trapping. Pass an explicit restore target to survive panel switches. */
  activate(restoreTarget?: HTMLElement | null): void;
  /** Stop trapping and restore focus to the element that opened the panel. */
  deactivate(): void;
  /** Move focus by `delta` through the focusables, wrapping at the ends. */
  moveFocus(delta: number): boolean;
}

/**
 * Keyboard focus trap for a modal panel.
 *
 * The trap owns two behaviours the acceptance criteria ask for: Tab and
 * Shift+Tab cycle inside the panel, and closing returns focus to whatever had
 * it before the panel opened. It is deliberately DOM-only — the host below
 * drives it from keyboard events.
 */
export function createFocusTrap(container: HTMLElement, doc: Document): FocusTrap {
  let active = false;
  let restoreTarget: HTMLElement | null = null;

  return {
    get active(): boolean {
      return active;
    },
    get restoreTarget(): HTMLElement | null {
      return restoreTarget;
    },
    activate(explicit?: HTMLElement | null): void {
      if (active) return;
      restoreTarget = explicit !== undefined ? explicit : asFocusable(doc.activeElement);
      active = true;
    },
    deactivate(): void {
      if (!active) return;
      active = false;
      const target = restoreTarget;
      restoreTarget = null;
      if (target && target.isConnected) target.focus();
    },
    moveFocus(delta: number): boolean {
      const focusable = listFocusable(container);
      if (focusable.length === 0) return false;
      const current = focusable.indexOf(asFocusable(doc.activeElement) ?? focusable[0]!);
      const index =
        current < 0
          ? delta > 0
            ? 0
            : focusable.length - 1
          : (current + delta + focusable.length) % focusable.length;
      focusable[index]?.focus();
      return true;
    },
  };
}

/** Move focus between a flat list of items (outline rows, codex entries). */
function moveListFocus(
  container: HTMLElement,
  selector: string,
  delta: number | 'first' | 'last',
  doc: Document,
): boolean {
  const items = [...container.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) return false;
  if (delta === 'first' || delta === 'last') {
    items[delta === 'first' ? 0 : items.length - 1]?.focus();
    return true;
  }
  const active = asFocusable(doc.activeElement);
  const current = active ? items.indexOf(active) : -1;
  const index =
    current < 0
      ? delta > 0
        ? 0
        : items.length - 1
      : (current + delta + items.length) % items.length;
  items[index]?.focus();
  return true;
}

/* -------------------------------------------------------------------------- */
/* Execution-contract views                                                   */
/* -------------------------------------------------------------------------- */

/** One declared check, as the inspector shows it. */
export interface TaskCheckView {
  readonly id: string;
  /** `build` | `typecheck` | `test` | `composition`, or any runner label. */
  readonly kind: string;
  /** What going green means, in reviewer language. */
  readonly assertion: string;
  /** File a repair objective would point at. */
  readonly targetFile?: string;
  /** Evidence the check produces (`command`, `browser`, `visual`, `screenshot`). */
  readonly evidence?: string;
  /** `passed` | `failed` | `running` | `pending`. */
  readonly status?: 'passed' | 'failed' | 'running' | 'pending';
  /** Runner detail: failing test, error code, log tail. */
  readonly detail?: string;
}

/** One criterion a task must satisfy, as the inspector shows it. */
export interface TaskCriterionView {
  readonly key: string;
  readonly label: string;
  /** `milestone` | `final_invariant` | `superseded`. */
  readonly lifecycle?: 'milestone' | 'final_invariant' | 'superseded';
  readonly requiredEvidence?: string;
  readonly satisfiedByCheckIds?: readonly string[];
  /** Where the criterion came from; rendered as a provenance chip. */
  readonly provenance?: ProvenanceKind;
}

/** One source claim: an assertion plus where it came from. */
export interface SourceClaimView {
  readonly id?: string;
  readonly statement: string;
  readonly authority: ProvenanceKind;
}

/** The execution contract the inspector renders for one task. */
export interface TaskContractView {
  readonly readSet?: readonly string[];
  readonly writeSet?: readonly string[];
  readonly checks?: readonly TaskCheckView[];
  readonly criteria?: readonly TaskCriterionView[];
  readonly claims?: readonly SourceClaimView[];
}

/** Execution contracts keyed by task id. */
export type TaskContractMap = Readonly<Record<string, TaskContractView>>;

/* -------------------------------------------------------------------------- */
/* Codex concepts                                                             */
/* -------------------------------------------------------------------------- */

export type CodexCategory = 'mission' | 'lane' | 'verification' | 'quality' | 'economy';

/** What each lane kind does, in the codex's voice. */
export const LANE_KIND_DEFINITIONS: Readonly<Record<LaneKind, string>> = {
  discovery:
    'Discovery lanes read the brief, the repository and the constraints before anyone writes code.',
  build: 'Build lanes write and refactor product code, strictly inside their declared write sets.',
  verify: 'Verification lanes run the checks that must go green before work is trusted.',
  integrate: 'Integration lanes merge finished work and settle conflicts between lanes.',
  observe: 'Observability lanes watch telemetry, cost and quality once the work has shipped.',
};

/** One codex entry: the vocabulary the mission is built from. */
export interface CodexConcept {
  readonly id: string;
  readonly term: string;
  readonly definition: string;
  readonly category: CodexCategory;
  /**
   * Where the concept itself came from: the brief, the plan, or what the
   * repository showed. Rendered as a provenance chip, like the event log.
   */
  readonly provenance: ProvenanceKind;
}

/**
 * Every concept the current mission uses, derived from the snapshot.
 *
 * The core entries explain what Coroid is; then every registered lane, gate and
 * quality metric becomes an entry of its own, so the codex can never drift from
 * what the overlay and the gates are showing. `extra` entries replace derived
 * entries with the same id and are appended in the order given.
 */
export function createCodexConcepts(
  state: HudState,
  extra: readonly CodexConcept[] = [],
): readonly CodexConcept[] {
  const budget = readBudget(state);
  const invariants = readInvariants(state);
  const clock = readClock(state);
  const occupancy = readLaneOccupancy(state);
  const phase = readPhase(state);
  const outline = readPlanOutline(state);

  const derived: CodexConcept[] = [
    {
      id: 'concept-coroid',
      term: 'Coroid',
      category: 'mission',
      provenance: 'user_requirement',
      definition:
        'Coroid is an autonomous software factory: agent lanes plan, build, verify and ship work while the holographic floor reports every move.',
    },
    {
      id: 'concept-mission',
      term: `Mission ${state.mission.codename}`,
      category: 'mission',
      provenance: 'user_requirement',
      definition: `${state.mission.objective} Currently ${state.mission.status} at ${formatPercent(
        state.mission.progress,
      )} with ${outline.length} planned tasks.`,
    },
    {
      id: 'concept-agent-lane',
      term: 'Agent lane',
      category: 'lane',
      provenance: 'architect_choice',
      definition: `A lane carries tasks of one kind and reports its own occupancy: ${occupancy.label}, ${occupancy.queued} queued.`,
    },
    {
      id: 'concept-phase',
      term: 'Phase',
      category: 'mission',
      provenance: 'architect_choice',
      definition: `The plan is layered so every task depends only on earlier phases. Work is in ${phase.label}${
        phase.caption ? ` (${phase.caption})` : ''
      }, with ${readPlanPhases(state).length} phases in total.`,
    },
    {
      id: 'concept-provenance',
      term: 'Provenance tag',
      category: 'mission',
      provenance: 'user_requirement',
      definition:
        'Every line of the event log carries where it came from — a user requirement, a repository observation or an architect choice — as a chip and a label, never colour alone.',
    },
    {
      id: 'concept-context-budget',
      term: 'Context budget',
      category: 'economy',
      provenance: 'user_requirement',
      definition: `${budget.label} tokens consumed; ${budget.remainingLabel}. The depletion bar on the overlay is this value.`,
    },
    {
      id: 'concept-credits',
      term: 'Credits',
      category: 'economy',
      provenance: 'architect_choice',
      definition: `${formatInteger(state.economy.credits)} credits in the vault, earned at ${formatInteger(
        state.economy.creditsPerSecond,
      )} per second while lanes are busy.`,
    },
    {
      id: 'concept-reputation',
      term: 'Reputation',
      category: 'economy',
      provenance: 'architect_choice',
      definition: `Reputation stands at ${Math.round(state.economy.reputation)} of 100; it moves with the rewards the factory earns.`,
    },
    {
      id: 'concept-sim-clock',
      term: 'Sim clock',
      category: 'mission',
      provenance: 'architect_choice',
      definition: `${clock.elapsedClock} of the ${formatInteger(clock.deadlineMs)} ms deadline; ${clock.remainingLabel}. Everything the simulation does is timestamped on this clock.`,
    },
    {
      id: 'concept-invariant',
      term: 'Final invariant',
      category: 'quality',
      provenance: 'repository_observation',
      definition: `A quality metric whose measured value has reached its target must hold before the mission ships. ${invariants.label} hold right now.`,
    },
    {
      id: 'concept-event-log',
      term: 'Event log',
      category: 'mission',
      provenance: 'repository_observation',
      definition:
        'The terminal streams every domain event the factory reduces, newest line first in view, each tagged with its provenance.',
    },
  ];

  const lanes = state.lanes.order.flatMap((laneId) => {
    const lane = state.lanes.lanes[laneId];
    if (!lane) return [];
    const readout = occupancy.lanes.find((entry) => entry.id === laneId);
    return [
      {
        id: `lane:${lane.id}`,
        term: `${lane.label} lane`,
        category: 'lane' as CodexCategory,
        provenance: 'architect_choice' as ProvenanceKind,
        definition: `${LANE_KIND_DEFINITIONS[lane.kind]} ${readout?.agents ?? 0} of ${
          lane.capacity
        } agents are committed, ${lane.queue.length} waiting.`,
      },
    ];
  });

  const gates = state.verification.order.flatMap((gateId) => {
    const gate = state.verification.gates[gateId];
    if (!gate) return [];
    return [
      {
        id: `gate:${gate.id}`,
        term: `${gate.name} gate`,
        category: 'verification' as CodexCategory,
        provenance: 'repository_observation' as ProvenanceKind,
        definition: `${gate.status} at ${formatPercent(gate.coverage)} coverage after ${
          gate.attempts
        } attempt${gate.attempts === 1 ? '' : 's'}${
          gate.lastRunAtMs === null ? ', never run' : `, last run t+${Math.round(gate.lastRunAtMs)}ms`
        }.`,
      },
    ];
  });

  const metrics = state.quality.order.flatMap((metricId) => {
    const metric = state.quality.metrics[metricId];
    if (!metric) return [];
    const held = invariants.heldIds.includes(metric.id);
    return [
      {
        id: `metric:${metric.id}`,
        term: metric.label,
        category: 'quality' as CodexCategory,
        provenance: 'repository_observation' as ProvenanceKind,
        definition: `Measured ${metric.value.toFixed(2)} against a target of ${metric.target} (weight ${metric.weight}) — ${
          held ? 'invariant holds' : 'still short of target'
        }.`,
      },
    ];
  });

  const settledGates = state.verification.order.flatMap((gateId) => {
    const gate = state.verification.gates[gateId];
    return gate ? [gate] : [];
  });
  const passRate: CodexConcept = {
    id: 'concept-pass-rate',
    term: 'Pass rate',
    category: 'verification',
    provenance: 'repository_observation',
    definition: `${settledGates.filter((gate) => gate.status === 'passed').length} of ${
      settledGates.length
    } registered gates have passed; the settled pass rate is ${formatPercent(
      state.verification.passRate,
    )}.`,
  };
  const qualityScore: CodexConcept = {
    id: 'concept-quality-score',
    term: 'Quality score',
    category: 'quality',
    provenance: 'repository_observation',
    definition: `Weighted quality score ${state.quality.score.toFixed(2)}, from ${
      state.quality.order.length
    } measured metrics and ${state.quality.findings.length} open findings.`,
  };

  const all = [...derived, ...lanes, ...gates, ...metrics, passRate, qualityScore];
  const byId = new Map<string, CodexConcept>();
  for (const concept of all) byId.set(concept.id, concept);
  const order: string[] = all.map((concept) => concept.id);
  for (const concept of extra) {
    if (!byId.has(concept.id)) order.push(concept.id);
    byId.set(concept.id, concept);
  }
  return order.flatMap((id) => {
    const concept = byId.get(id);
    return concept ? [concept] : [];
  });
}

/* -------------------------------------------------------------------------- */
/* Panel host                                                                 */
/* -------------------------------------------------------------------------- */

/** What a panel asked the flow layer to do. */
export interface PanelIntent {
  readonly type: 'panel-opened' | 'panel-closed' | 'task-selected';
  readonly panel: PanelKind;
  readonly taskId?: string;
}

export interface PanelHostOptions {
  doc?: Document;
  /** Mount point for the panel layer. Defaults to `document.body`. */
  host?: HTMLElement;
  /** Execution contracts the inspector renders. */
  contracts?: TaskContractMap;
  /** Extra codex concepts merged over the mission-derived ones. */
  concepts?: readonly CodexConcept[];
  /** Announcer; the page wires this to the HUD's live region. */
  announce?(message: string): void;
  /** Player intents: opening, closing and selecting. */
  onIntent?(intent: PanelIntent): void;
  /** Task selected on mount. Defaults to the first running task. */
  initialTaskId?: string | null;
}

export interface PanelHost {
  /** The panel layer (`.hud-panel-layer`). */
  readonly root: HTMLElement;
  readonly open: PanelKind | null;
  readonly selectedTaskId: string | null;
  readonly state: HudState | null;
  panelElement(kind: PanelKind): HTMLElement;
  isOpen(kind: PanelKind): boolean;
  openPanel(kind: PanelKind): void;
  closePanel(): void;
  togglePanel(kind: PanelKind): void;
  selectTask(taskId: string | null): void;
  update(state: HudState): void;
  /** Handle a keyboard event; returns true when the host consumed it. */
  handleKey(event: KeyboardEvent): boolean;
  dispose(): void;
}

interface PanelParts {
  readonly kind: PanelKind;
  readonly element: HTMLElement;
  readonly title: HTMLElement;
  readonly subtitle: HTMLElement;
  readonly body: HTMLElement;
  readonly trap: FocusTrap;
}

const OUTLINE_ROW_SELECTOR = '.hud-outline__row';
const CODEX_ENTRY_SELECTOR = '.hud-codex__entry';

/** Find the first running task in plan order (the inspector's default subject). */
function firstRunningTaskId(state: HudState): string | null {
  const running = state.plan.order.find((id) => state.plan.tasks[id]?.status === 'running');
  return running ?? state.plan.order[0] ?? null;
}

function statusChip(doc: Document, status: TaskStatus | string, hudKey = 'status'): HTMLElement {
  const chip = createHudElement(doc, 'span', {
    className: 'hud-chip',
    hud: hudKey,
    text: status,
  });
  chip.dataset.status = status;
  return chip;
}

function lifecycleChip(doc: Document, lifecycle: string): HTMLElement {
  const chip = createHudElement(doc, 'span', {
    className: 'hud-chip',
    hud: 'criterion-lifecycle',
    text: lifecycle.replace(/_/g, ' '),
  });
  chip.dataset.lifecycle = lifecycle;
  return chip;
}

function severityChip(doc: Document, severity: string): HTMLElement {
  const chip = createHudElement(doc, 'span', {
    className: 'hud-chip',
    hud: 'finding-severity',
    text: severity,
  });
  chip.dataset.severity = severity;
  return chip;
}

function textEl(
  doc: Document,
  tag: 'p' | 'span' | 'h3' | 'h4' | 'li' | 'dd' | 'dt',
  className: string,
  text: string,
  hud?: string,
): HTMLElement {
  const element = createHudElement(doc, tag, { className, hud, text });
  return element;
}

function section(
  doc: Document,
  title: string,
  hud: string,
  parent: HTMLElement,
): HTMLElement {
  const wrapper = createHudElement(doc, 'section', {
    className: 'hud-panel__section',
    hud,
    parent,
  });
  createHudElement(doc, 'h2', { className: 'hud-panel__section-title', text: title, parent: wrapper });
  return wrapper;
}

function emptyNote(doc: Document, text: string, parent: HTMLElement): HTMLElement {
  return createHudElement(doc, 'p', { className: 'hud-panel__empty', text, parent });
}

function pathList(
  doc: Document,
  paths: readonly string[] | undefined,
  hud: string,
  emptyText: string,
  parent: HTMLElement,
): void {
  if (!paths || paths.length === 0) {
    emptyNote(doc, emptyText, parent);
    return;
  }
  const list = createHudElement(doc, 'ul', { className: 'hud-list', hud, parent });
  for (const path of paths) {
    createHudElement(doc, 'li', { text: path, parent: list });
  }
}

function meter(
  doc: Document,
  fraction: number,
  hud: string,
  ariaLabel: string,
  parent: HTMLElement,
): void {
  const track = createHudElement(doc, 'span', { className: 'hud-meter', hud, parent });
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', ariaLabel);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const percent = Math.max(0, Math.min(1, fraction)) * 100;
  track.setAttribute('aria-valuenow', percent.toFixed(0));
  const fill = createHudElement(doc, 'span', { className: 'hud-meter__fill', parent: track });
  fill.style.width = `${percent.toFixed(1)}%`;
}

/**
 * Mount the panel layer.
 *
 * One dialog is open at a time; `update(state)` re-renders the open panel only
 * when its content signature changed, which keeps focus (and therefore keyboard
 * navigation) stable while the mission streams events underneath.
 */
export function createPanelHost(options: PanelHostOptions = {}): PanelHost {
  const doc = resolveDocument(options.doc);
  const host = options.host ?? (doc.body as HTMLElement | null);
  if (!host) {
    throw new Error('[coroid] the panel layer needs a host element to mount into');
  }

  const root = createHudElement(doc, 'div', { className: 'hud-panel-layer', hud: 'panel-layer' });
  host.append(root);

  const backdrop = createHudElement(doc, 'button', {
    className: 'hud-panel-backdrop',
    hud: 'panel-backdrop',
    parent: root,
  });
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Close panel');
  backdrop.hidden = true;
  backdrop.addEventListener('click', () => closePanel());

  const parts = new Map<PanelKind, PanelParts>();
  const signatures = new Map<PanelKind, string>();
  for (const kind of PANEL_KINDS) {
    const element = createHudElement(doc, 'section', {
      className: `hud-panel hud-panel--${kind}`,
      parent: root,
    });
    element.dataset.panel = kind;
    element.dataset.hud = `panel-${kind}`;
    element.id = `hud-panel-${kind}`;
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.tabIndex = -1;
    element.hidden = true;

    const header = createHudElement(doc, 'header', { className: 'hud-panel__header', parent: element });
    const titles = createHudElement(doc, 'div', { className: 'hud-panel__titles', parent: header });
    createHudElement(doc, 'span', {
      className: 'hud-panel__kicker',
      text: PANEL_TITLES[kind],
      parent: titles,
    });
    const titleId = `${element.id}-title`;
    const title = createHudElement(doc, 'h2', {
      className: 'hud-panel__title',
      hud: `${kind}-title`,
      parent: titles,
    });
    title.id = titleId;
    const subtitle = createHudElement(doc, 'p', {
      className: 'hud-panel__subtitle',
      hud: `${kind}-subtitle`,
      parent: titles,
    });
    element.setAttribute('aria-labelledby', titleId);

    const close = createHudElement(doc, 'button', {
      className: 'hud-button hud-panel__close',
      hud: 'close-panel',
      text: 'Close',
      parent: header,
    });
    close.type = 'button';
    close.dataset.panelClose = kind;
    close.setAttribute('aria-label', `Close ${PANEL_TITLES[kind].toLowerCase()}`);
    close.addEventListener('click', () => closePanel());

    const body = createHudElement(doc, 'div', {
      className: 'hud-panel__body',
      hud: `${kind}-body`,
      parent: element,
    });

    parts.set(kind, {
      kind,
      element,
      title,
      subtitle,
      body,
      trap: createFocusTrap(element, doc),
    });
  }

  let open: PanelKind | null = null;
  let opener: HTMLElement | null = null;
  let state: HudState | null = null;
  let selectedTaskId: string | null = options.initialTaskId ?? null;
  let concepts: readonly CodexConcept[] = options.concepts ?? [];

  const announce = (message: string): void => {
    options.announce?.(message);
  };

  const emit = (intent: PanelIntent): void => {
    options.onIntent?.(intent);
  };

  function partsOf(kind: PanelKind): PanelParts {
    const found = parts.get(kind);
    if (!found) throw new Error(`[coroid] unknown panel "${kind}"`);
    return found;
  }

  function signatureOf(kind: PanelKind, current: HudState): string {
    if (kind === 'inspector') {
      const task = selectedTaskId ? current.plan.tasks[selectedTaskId] : undefined;
      const findings = selectedTaskId
        ? current.quality.findings.filter((finding) => finding.taskId === selectedTaskId).length
        : 0;
      return [
        selectedTaskId ?? 'none',
        task?.status ?? 'missing',
        task?.progress.toFixed(3) ?? '0',
        String(findings),
      ].join('|');
    }
    if (kind === 'outline') {
      return `${selectedTaskId ?? 'none'}#${current.plan.order
        .map((id) => {
          const task = current.plan.tasks[id];
          return task ? `${id}:${task.status}:${task.progress.toFixed(2)}` : `${id}:missing`;
        })
        .join(',')}`;
    }
    if (kind === 'report') {
      return [
        ...current.verification.order.map((id) => `${id}:${current.verification.gates[id]?.status ?? 'missing'}:${(current.verification.gates[id]?.coverage ?? 0).toFixed(2)}`),
        ...current.quality.order.map((id) => `${id}:${(current.quality.metrics[id]?.value ?? 0).toFixed(3)}`),
        String(current.quality.findings.length),
        current.quality.score.toFixed(3),
      ].join('|');
    }
    return `${current.mission.codename}|${current.mission.objective}|${current.mission.status}|${current.quality.score.toFixed(3)}|${
      current.quality.order.length
    }|${current.lanes.order.length}|${current.verification.order.length}|${concepts.length}`;
  }

  function renderInspector(current: HudState, part: PanelParts): void {
    const body = part.body;
    clearElement(body);
    const taskId = selectedTaskId;
    const task = taskId ? current.plan.tasks[taskId] : undefined;
    const contract: TaskContractView = (taskId ? options.contracts?.[taskId] : undefined) ?? {};

    if (!task) {
      part.title.textContent = 'No task selected';
      part.subtitle.textContent = 'Choose a task in the plan outline.';
      emptyNote(doc, 'Select a task with the plan outline (O) to inspect its contract.', body);
      return;
    }

    const laneLabel = current.lanes.lanes[task.laneId]?.label ?? task.laneId;
    const phase = readPhase(current);
    const row = readPlanOutline(current).find((candidate) => candidate.id === task.id);
    part.title.textContent = task.title;
    part.subtitle.textContent = `${task.id} · ${laneLabel} · ${task.status}`;

    const facts = createHudElement(doc, 'dl', {
      className: 'hud-facts',
      hud: 'inspector-facts',
      parent: body,
    });
    const addFact = (term: string, value: string, hud: string): void => {
      createHudElement(doc, 'dt', { text: term, parent: facts });
      createHudElement(doc, 'dd', { hud, text: value, parent: facts });
    };
    addFact('Task', task.id, 'inspector-task-id');
    addFact('Status', `${task.status} · ${formatPercent(task.progress)}`, 'inspector-progress');
    addFact('Lane', laneLabel, 'inspector-lane');
    addFact(
      'Phase',
      phase.count === 0 ? phase.label : `Phase ${row?.phase ?? phase.index} of ${phase.count}`,
      'inspector-phase',
    );
    addFact(
      'Depends on',
      task.dependencies.length > 0 ? task.dependencies.join(', ') : 'nothing',
      'inspector-dependencies',
    );
    addFact('Blocks', row?.dependents.join(', ') || 'nothing', 'inspector-dependents');

    const findings = current.quality.findings.filter((finding) => finding.taskId === task.id);
    if (findings.length > 0) {
      const wrap = section(doc, `Findings (${findings.length})`, 'inspector-section-findings', body);
      for (const finding of findings) renderFinding(doc, finding, wrap);
    }

    const readSection = section(
      doc,
      `Read set (${contract.readSet?.length ?? 0})`,
      'inspector-section-readset',
      body,
    );
    pathList(
      doc,
      contract.readSet,
      'inspector-readset',
      'No read set declared for this task.',
      readSection,
    );

    const writeSection = section(
      doc,
      `Write set (${contract.writeSet?.length ?? 0})`,
      'inspector-section-writeset',
      body,
    );
    pathList(
      doc,
      contract.writeSet,
      'inspector-writeset',
      'No write set declared for this task.',
      writeSection,
    );

    const checks = contract.checks ?? [];
    const checkSection = section(
      doc,
      `Checks (${checks.length})`,
      'inspector-section-checks',
      body,
    );
    if (checks.length === 0) emptyNote(doc, 'No checks declared for this task.', checkSection);
    for (const check of checks) {
      const card = createHudElement(doc, 'article', {
        className: 'hud-card',
        hud: 'inspector-check',
        parent: checkSection,
      });
      card.dataset.checkId = check.id;
      const head = createHudElement(doc, 'div', { className: 'hud-card__head', parent: card });
      const kind = createHudElement(doc, 'span', {
        className: 'hud-chip',
        hud: 'check-kind',
        text: check.kind,
        parent: head,
      });
      kind.dataset.kind = check.kind;
      head.append(statusChip(doc, check.status ?? 'pending', 'check-status'));
      if (check.evidence) {
        createHudElement(doc, 'span', {
          className: 'hud-chip',
          hud: 'check-evidence',
          text: check.evidence,
          parent: head,
        });
      }
      card.append(textEl(doc, 'h3', 'hud-card__title', check.assertion, 'check-assertion'));      if (check.targetFile) {
        card.append(textEl(doc, 'p', 'hud-card__note', `target: ${check.targetFile}`, 'check-target'));
      }
      if (check.detail) {
        card.append(textEl(doc, 'p', 'hud-card__note', check.detail, 'check-detail'));
      }
    }

    const criteria = contract.criteria ?? [];
    const criterionSection = section(
      doc,
      `Criteria (${criteria.length})`,
      'inspector-section-criteria',
      body,
    );
    if (criteria.length === 0) emptyNote(doc, 'No criteria declared for this task.', criterionSection);
    for (const criterion of criteria) {
      const card = createHudElement(doc, 'article', {
        className: 'hud-card',
        hud: 'inspector-criterion',
        parent: criterionSection,
      });
      card.dataset.criterionKey = criterion.key;
      const head = createHudElement(doc, 'div', { className: 'hud-card__head', parent: card });
      head.append(lifecycleChip(doc, criterion.lifecycle ?? 'milestone'));
      if (criterion.provenance) {
        head.append(createProvenanceChip(doc, criterion.provenance, 'criterion-provenance'));
      }
      card.append(textEl(doc, 'h3', 'hud-card__title', criterion.label, 'criterion-label'));
      card.append(
        textEl(
          doc,
          'p',
          'hud-card__note',
          criterion.requiredEvidence
            ? `requires ${criterion.requiredEvidence} evidence`
            : 'no evidence requirement recorded',
          'criterion-evidence',
        ),
      );
      if (criterion.satisfiedByCheckIds && criterion.satisfiedByCheckIds.length > 0) {
        card.append(
          textEl(
            doc,
            'p',
            'hud-card__note',
            `satisfied by ${criterion.satisfiedByCheckIds.join(', ')}`,
            'criterion-satisfied-by',
          ),
        );
      }
    }

    const claims = contract.claims ?? [];
    const claimSection = section(
      doc,
      `Source claims (${claims.length})`,
      'inspector-section-claims',
      body,
    );
    if (claims.length === 0) emptyNote(doc, 'No source claims recorded for this task.', claimSection);
    for (const claim of claims) {
      const card = createHudElement(doc, 'article', {
        className: 'hud-card',
        hud: 'inspector-claim',
        parent: claimSection,
      });
      if (claim.id) card.dataset.claimId = claim.id;
      const head = createHudElement(doc, 'div', { className: 'hud-card__head', parent: card });
      head.append(createProvenanceChip(doc, claim.authority, 'claim-provenance'));
      card.append(textEl(doc, 'p', 'hud-card__note', claim.statement, 'claim-statement'));
    }
  }

  function renderFinding(owner: Document, finding: QualityFinding, parent: HTMLElement): void {
    const card = createHudElement(owner, 'article', {
      className: 'hud-card',
      hud: 'report-finding',
      parent,
    });
    card.dataset.findingId = finding.id;
    const head = createHudElement(owner, 'div', { className: 'hud-card__head', parent: card });
    head.append(severityChip(owner, finding.severity));
    card.append(textEl(owner, 'p', 'hud-card__note', finding.summary, 'finding-summary'));
  }

  function renderOutline(current: HudState, part: PanelParts): void {
    const body = part.body;
    clearElement(body);
    const phases = readPlanPhases(current);
    const rows = readPlanOutline(current);
    part.title.textContent = `Plan outline · ${rows.length} tasks`;
    part.subtitle.textContent =
      phases.length === 0
        ? 'No plan registered for this mission.'
        : `${phases.length} phases · ${rows.filter((row) => row.status === 'passed').length} passed`;

    if (rows.length === 0) {
      emptyNote(doc, 'This mission has no registered tasks yet.', body);
      return;
    }

    for (const phase of phases) {
      const group = createHudElement(doc, 'section', {
        className: 'hud-phase',
        hud: 'outline-phase',
        parent: body,
      });
      group.dataset.phase = String(phase.index);
      const head = createHudElement(doc, 'div', { className: 'hud-phase__head', parent: group });
      createHudElement(doc, 'span', {
        className: 'hud-phase__label',
        hud: 'phase-label',
        text: `${phase.label} · ${phase.caption || 'unassigned'}`,
        parent: head,
      });
      createHudElement(doc, 'span', {
        className: 'hud-phase__count hud-num',
        hud: 'phase-count',
        text: `${phase.passed}/${phase.taskIds.length} passed`,
        parent: head,
      });
      for (const taskId of phase.taskIds) {
        const row = rows.find((candidate) => candidate.id === taskId);
        if (!row) continue;
        group.append(outlineRow(row));
      }
    }
  }

  function outlineRow(row: PlanOutlineRow): HTMLElement {
    const button = createHudElement(doc, 'button', {
      className: 'hud-outline__row',
      hud: 'outline-row',
    });
    button.type = 'button';
    button.dataset.taskId = row.id;
    if (row.id === selectedTaskId) button.setAttribute('aria-current', 'true');
    createHudElement(doc, 'span', {
      className: 'hud-outline__title',
      hud: 'outline-task-title',
      text: row.title,
      parent: button,
    });
    const meta = createHudElement(doc, 'span', { className: 'hud-outline__meta', parent: button });
    createHudElement(doc, 'span', { text: row.laneLabel, parent: meta });
    meta.append(statusChip(doc, row.status, 'outline-status'));
    createHudElement(doc, 'span', {
      className: 'hud-outline__progress hud-num',
      hud: 'outline-progress',
      text: formatPercent(row.progress),
      parent: meta,
    });
    button.addEventListener('click', () => activateTask(row.id));
    return button;
  }

  function renderReport(current: HudState, part: PanelParts): void {
    const body = part.body;
    clearElement(body);
    const invariants = readInvariants(current);
    const budget = readBudget(current);
    const clock = readClock(current);
    const occupancy = readLaneOccupancy(current);
    const gates = current.verification.order.flatMap((id) => {
      const gate = current.verification.gates[id];
      return gate ? [gate] : [];
    });

    part.title.textContent = 'Verification report';
    part.subtitle.textContent = `${gates.filter((gate) => gate.status === 'passed').length}/${
      gates.length
    } gates passed · quality ${current.quality.score.toFixed(2)}`;

    const facts = createHudElement(doc, 'dl', {
      className: 'hud-facts',
      hud: 'report-facts',
      parent: body,
    });
    const addFact = (term: string, value: string, hud: string): void => {
      createHudElement(doc, 'dt', { text: term, parent: facts });
      createHudElement(doc, 'dd', { hud, text: value, parent: facts });
    };
    addFact('Pass rate', formatPercent(current.verification.passRate), 'report-pass-rate');
    addFact('Quality score', current.quality.score.toFixed(2), 'report-quality-score');
    addFact('Invariants', `${invariants.label} hold`, 'report-invariants');
    addFact('Context', `${budget.label} · ${budget.remainingLabel}`, 'report-budget');
    addFact('Credits', formatInteger(current.economy.credits), 'report-credits');
    addFact('Reputation', `${Math.round(current.economy.reputation)}/100`, 'report-reputation');
    addFact('Clock', `${clock.elapsedClock} · ${clock.remainingLabel}`, 'report-clock');
    addFact('Lanes', occupancy.label, 'report-lanes');

    const gateSection = section(doc, `Gates (${gates.length})`, 'report-section-gates', body);
    if (gates.length === 0) emptyNote(doc, 'No verification gates registered.', gateSection);
    for (const gate of gates) {
      const card = createHudElement(doc, 'article', {
        className: 'hud-card',
        hud: 'report-gate',
        parent: gateSection,
      });
      card.dataset.gateId = gate.id;
      const head = createHudElement(doc, 'div', { className: 'hud-card__head', parent: card });
      createHudElement(doc, 'h3', {
        className: 'hud-card__title',
        hud: 'gate-name',
        text: gate.name,
        parent: head,
      });
      head.append(statusChip(doc, gate.status, 'gate-status'));
      createHudElement(doc, 'span', {
        className: 'hud-chip',
        hud: 'gate-lane',
        text: current.lanes.lanes[gate.laneId]?.label ?? gate.laneId,
        parent: head,
      });
      card.append(
        textEl(
          doc,
          'p',
          'hud-card__note',
          `${formatPercent(gate.coverage)} coverage · ${gate.attempts} attempt${
            gate.attempts === 1 ? '' : 's'
          }${
            gate.lastRunAtMs === null ? ' · never run' : ` · last run t+${Math.round(gate.lastRunAtMs)}ms`
          }`,
          'gate-detail',
        ),
      );
      meter(doc, gate.coverage, 'gate-coverage', `${gate.name} coverage`, card);
    }

    const metrics = current.quality.order.flatMap((id) => {
      const metric = current.quality.metrics[id];
      return metric ? [metric] : [];
    });
    const metricSection = section(doc, `Metrics (${metrics.length})`, 'report-section-metrics', body);
    if (metrics.length === 0) emptyNote(doc, 'No quality metrics measured.', metricSection);
    for (const metric of metrics) {
      const held = invariants.heldIds.includes(metric.id);
      const card = createHudElement(doc, 'article', {
        className: 'hud-card',
        hud: 'report-metric',
        parent: metricSection,
      });
      card.dataset.metricId = metric.id;
      const head = createHudElement(doc, 'div', { className: 'hud-card__head', parent: card });
      createHudElement(doc, 'h3', {
        className: 'hud-card__title',
        hud: 'metric-label',
        text: metric.label,
        parent: head,
      });
      const chip = createHudElement(doc, 'span', {
        className: 'hud-chip',
        hud: 'metric-state',
        text: held ? 'invariant holds' : 'below target',
        parent: head,
      });
      chip.dataset.lifecycle = held ? 'final_invariant' : 'milestone';
      card.append(
        textEl(
          doc,
          'p',
          'hud-card__note',
          `${metric.value.toFixed(2)} / ${metric.target} target · weight ${metric.weight}`,
          'metric-value',
        ),
      );
      meter(
        doc,
        metric.target === 0 ? 0 : metric.value / metric.target,
        'metric-progress',
        `${metric.label} against target`,
        card,
      );
    }

    const findingsSection = section(
      doc,
      `Findings (${current.quality.findings.length})`,
      'report-section-findings',
      body,
    );
    if (current.quality.findings.length === 0) {
      emptyNote(doc, 'No findings: nothing is currently failing review.', findingsSection);
    }
    for (const finding of current.quality.findings) {
      const card = createHudElement(doc, 'article', {
        className: 'hud-card',
        hud: 'report-finding',
        parent: findingsSection,
      });
      card.dataset.findingId = finding.id;
      const head = createHudElement(doc, 'div', { className: 'hud-card__head', parent: card });
      head.append(severityChip(doc, finding.severity));
      if (finding.taskId) {
        createHudElement(doc, 'span', {
          className: 'hud-chip',
          hud: 'finding-task',
          text: current.plan.tasks[finding.taskId]?.title ?? finding.taskId,
          parent: head,
        });
      }
      card.append(textEl(doc, 'p', 'hud-card__note', finding.summary, 'finding-summary'));
    }
  }

  function renderCodex(current: HudState, part: PanelParts): void {
    const body = part.body;
    clearElement(body);
    concepts = createCodexConcepts(current, options.concepts ?? []);
    part.title.textContent = 'Codex';
    part.subtitle.textContent = `${concepts.length} concepts · mission, lanes, gates, metrics and economy`;

    for (const concept of concepts) {
      const entry = createHudElement(doc, 'article', {
        className: 'hud-codex__entry',
        hud: 'codex-entry',
        parent: body,
      });
      entry.dataset.conceptId = concept.id;
      entry.dataset.category = concept.category;
      entry.tabIndex = 0;
      const head = createHudElement(doc, 'div', { className: 'hud-codex__meta', parent: entry });
      createHudElement(doc, 'h3', {
        className: 'hud-codex__term',
        hud: 'codex-term',
        text: concept.term,
        parent: head,
      });
      const category = createHudElement(doc, 'span', {
        className: 'hud-chip',
        hud: 'codex-category',
        text: concept.category,
        parent: head,
      });
      category.dataset.category = concept.category;
      head.append(createProvenanceChip(doc, concept.provenance, 'codex-provenance'));
      createHudElement(doc, 'p', {
        className: 'hud-codex__definition',
        hud: 'codex-definition',
        text: concept.definition,
        parent: entry,
      });
    }
  }

  /**
   * Where the keyboard was, in terms the panel can find again after a re-render:
   * the task or concept under the cursor, or else the focusable's position.
   */
  interface FocusMemory {
    readonly selector: string | null;
    readonly index: number;
  }

  function rememberFocus(part: PanelParts): FocusMemory {
    const active = asFocusable(doc.activeElement);
    if (!active || !part.element.contains(active)) return { selector: null, index: -1 };
    if (active.dataset.taskId) return { selector: `[data-task-id="${active.dataset.taskId}"]`, index: -1 };
    if (active.dataset.conceptId) {
      return { selector: `[data-concept-id="${active.dataset.conceptId}"]`, index: -1 };
    }
    return { selector: null, index: listFocusable(part.element).indexOf(active) };
  }

  /** Put focus back where it was, so streaming updates never move the cursor. */
  function restoreFocus(part: PanelParts, memory: FocusMemory): void {
    if (memory.selector) {
      part.element.querySelector<HTMLElement>(memory.selector)?.focus();
      return;
    }
    if (memory.index < 0) return;
    const focusable = listFocusable(part.element);
    focusable[Math.min(memory.index, focusable.length - 1)]?.focus();
  }

  function renderOpenPanel(): void {
    if (!open || !state) return;
    const part = partsOf(open);
    const signature = signatureOf(open, state);
    if (signatures.get(open) === signature) return;
    signatures.set(open, signature);
    const memory = rememberFocus(part);
    if (open === 'inspector') renderInspector(state, part);
    else if (open === 'outline') renderOutline(state, part);
    else if (open === 'report') renderReport(state, part);
    else renderCodex(state, part);
    restoreFocus(part, memory);
  }

  function ensureSelection(current: HudState): void {
    if (selectedTaskId && current.plan.tasks[selectedTaskId]) return;
    selectedTaskId = firstRunningTaskId(current);
  }

  function openPanel(kind: PanelKind): void {
    if (open === kind) return;
    const previous = open;
    if (previous) {
      partsOf(previous).trap.deactivate();
      partsOf(previous).element.hidden = true;
      partsOf(previous).trap.activate(opener);
    } else {
      opener = asFocusable(doc.activeElement);
    }
    open = kind;
    const part = partsOf(kind);
    part.element.hidden = false;
    backdrop.hidden = false;
    part.trap.activate(opener);
    signatures.delete(kind);
    renderOpenPanel();
    part.element.focus();
    announce(`${PANEL_TITLES[kind]} opened`);
    emit({ type: 'panel-opened', panel: kind });
  }

  function closePanel(): void {
    if (!open) return;
    const closing = open;
    const part = partsOf(closing);
    open = null;
    part.element.hidden = true;
    backdrop.hidden = true;
    part.trap.deactivate();
    opener = null;
    announce(`${PANEL_TITLES[closing]} closed`);
    emit({ type: 'panel-closed', panel: closing });
  }

  function activateTask(taskId: string): void {
    selectTask(taskId);
    openPanel('inspector');
  }

  function selectTask(taskId: string | null): void {
    if (taskId === selectedTaskId) return;
    selectedTaskId = taskId;
    signatures.delete('inspector');
    signatures.delete('outline');
    renderOpenPanel();
    const task = taskId && state ? state.plan.tasks[taskId] : undefined;
    if (task) announce(`Inspector showing ${task.title}`);
    emit({ type: 'task-selected', panel: 'inspector', ...(taskId ? { taskId } : {}) });
  }

  return {
    root,
    get open(): PanelKind | null {
      return open;
    },
    get selectedTaskId(): string | null {
      return selectedTaskId;
    },
    get state(): HudState | null {
      return state;
    },
    panelElement(kind: PanelKind): HTMLElement {
      return partsOf(kind).element;
    },
    isOpen(kind: PanelKind): boolean {
      return open === kind;
    },
    openPanel,
    closePanel,
    togglePanel(kind: PanelKind): void {
      if (open === kind) closePanel();
      else openPanel(kind);
    },
    selectTask,
    update(next: HudState): void {
      state = next;
      // Keep a subject for the inspector even when the plan changes under it.
      if (selectedTaskId === null || !next.plan.tasks[selectedTaskId]) ensureSelection(next);
      renderOpenPanel();
    },
    handleKey(event: KeyboardEvent): boolean {
      if (event.key === 'Escape') {
        if (!open) return false;
        event.preventDefault();
        event.stopPropagation();
        closePanel();
        return true;
      }
      if (!open) return false;
      const part = partsOf(open);
      if (event.key === 'Tab') {
        event.preventDefault();
        part.trap.moveFocus(event.shiftKey ? -1 : 1);
        return true;
      }
      if (open === 'outline' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        moveListFocus(part.body, OUTLINE_ROW_SELECTOR, event.key === 'ArrowDown' ? 1 : -1, doc);
        return true;
      }
      if (open === 'codex') {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveListFocus(part.body, CODEX_ENTRY_SELECTOR, event.key === 'ArrowDown' ? 1 : -1, doc);
          return true;
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          moveListFocus(part.body, CODEX_ENTRY_SELECTOR, event.key === 'Home' ? 'first' : 'last', doc);
          return true;
        }
      }
      return false;
    },
    dispose(): void {
      for (const part of parts.values()) {
        if (part.trap.active) part.trap.deactivate();
        part.element.remove();
      }
      parts.clear();
      backdrop.remove();
      root.remove();
      open = null;
    },
  };
}

/** Read-only view of a snapshot's plan, for callers that pass state around. */
export type PanelStateView = DeepReadonly<GameState>;
