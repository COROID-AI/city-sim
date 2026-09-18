/**
 * Coroid HUD — the always-on interface layer.
 *
 * This module owns three things and imports nothing but the read-only state
 * contract (`src/sim/state.ts` types), so it renders live, replayed and fixture
 * state identically:
 *
 *  1. **Readings** — pure functions that turn a frozen `GameState` snapshot into
 *     the numbers the interface shows (`readBudget`, `readInvariants`,
 *     `readLaneOccupancy`, `readClock`, `readPlanPhases`, `readPhase`). Panels,
 *     tutorials, scripted acceptance and tests all share these definitions.
 *  2. **Top overlay and objective banner** — translucent holographic readouts
 *     with stable `data-hud` hooks (`budget`, `invariants`, `credits`,
 *     `reputation`, `clock`, `phase`, `lane-occupancy`, `objective`, …) that
 *     tutorials and acceptance scripts target instead of brittle selectors.
 *  3. **Event-log terminal** — appends mission events as readable lines with a
 *     timestamp and a provenance chip, keeping the newest line in view.
 *
 * Contract rules this module obeys:
 *  - nothing here mutates state: `update(state)` renders a snapshot, and player
 *    actions are raised through `onIntent` for the input router and flow layer;
 *  - every dynamic value element carries a `data-hud` attribute;
 *  - the live region (`data-hud="live"`) is the single `aria-live` channel the
 *    whole interface announces through;
 *  - `src/ui/panels.ts` builds on the readings and the provenance chip exported
 *    here (one-way dependency: panels → hud).
 */

import type { DeepReadonly, DomainEvent, GameState, LaneKind, TaskStatus } from '../sim/state';

/** Read-only state view every interface module renders from. */
export type HudState = DeepReadonly<GameState>;

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Floating point slack when comparing a measured value against its target. */
const EPSILON = 1e-9;

/** Budget fraction at (and below) which the HUD raises the low-context alarm. */
export const LOW_BUDGET_THRESHOLD = 0.15;

/** Resolve the document to create elements in, with a readable failure. */
export function resolveDocument(doc?: Document): Document {
  const resolved = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!resolved) {
    throw new Error('[coroid] the HUD needs a DOM; render it in a browser or under happy-dom');
  }
  return resolved;
}

/** Typed element factory: className, `data-hud` hook, text content, parent. */
export interface HudElementOptions {
  className?: string;
  /** Value of the stable `data-hud` hook. */
  hud?: string;
  text?: string;
  /** Parent to append the new element to. */
  parent?: Element;
}

export function createHudElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: HudElementOptions = {},
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.hud) element.dataset.hud = options.hud;
  if (options.text !== undefined) element.textContent = options.text;
  options.parent?.append(element);
  return element;
}

/** Remove every child without touching the element itself. */
export function clearElement(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** Simulated clock: `mm:ss`, or `h:mm:ss` past the hour. */
export function formatSimClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Grouped integer for counters: `4,960`. */
export function formatInteger(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Compact quantity for the context budget: `164.6k`, `1.2M`, `840`. */
export function formatTokens(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}k`;
  return Math.round(safe).toString();
}

/** Percentage label: `formatPercent(0.584)` → `58%`. */
export function formatPercent(fraction: number, digits = 0): string {
  return `${(clamp01(Number.isFinite(fraction) ? fraction : 0) * 100).toFixed(digits)}%`;
}

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where a line of mission history came from.
 *
 * The event log renders this as a coloured chip *plus* its text label, so the
 * provenance of every line survives monochrome and screen-reader reading.
 */
export type ProvenanceKind = 'user_requirement' | 'repository_observation' | 'architect_choice';

/** Canonical provenance order, used for legends and acceptance scripts. */
export const PROVENANCE_KINDS: readonly ProvenanceKind[] = [
  'user_requirement',
  'repository_observation',
  'architect_choice',
];

/** Human labels for the provenance chips (never colour alone). */
export const PROVENANCE_LABELS: Readonly<Record<ProvenanceKind, string>> = {
  user_requirement: 'user requirement',
  repository_observation: 'repo observation',
  architect_choice: 'architect choice',
};

/** Longer explanations, shown as the chip tooltip. */
export const PROVENANCE_DESCRIPTIONS: Readonly<Record<ProvenanceKind, string>> = {
  user_requirement: 'Fixed by the brief the mission answers.',
  repository_observation: 'Measured from the repository while the mission ran.',
  architect_choice: 'Decided by the plan and the orchestration around it.',
};

export function isProvenanceKind(value: string): value is ProvenanceKind {
  return (PROVENANCE_KINDS as readonly string[]).includes(value);
}

/**
 * Provenance of a domain event.
 *
 *  - `user_requirement` — the brief and the limits it fixes: `mission/started`,
 *    `economy/deadline`;
 *  - `architect_choice` — how the architect chose to run the mission:
 *    `mission/status`, every `plan/*` and every `lane/*` event;
 *  - `repository_observation` — what the repository actually showed: every
 *    `verification/*`, `quality/*` and the credit/context movements.
 */
export function provenanceForEvent(event: DomainEvent): ProvenanceKind {
  switch (event.type) {
    case 'mission/started':
    case 'economy/deadline':
      return 'user_requirement';
    case 'mission/status':
    case 'plan/task-registered':
    case 'plan/task-updated':
    case 'lane/registered':
    case 'lane/queued':
    case 'lane/assigned':
    case 'lane/released':
      return 'architect_choice';
    default:
      return 'repository_observation';
  }
}

/** Build the provenance chip element (coloured chip + readable label). */
export function createProvenanceChip(
  doc: Document,
  kind: ProvenanceKind,
  hudKey = 'provenance',
): HTMLElement {
  const chip = createHudElement(doc, 'span', {
    className: `hud-provenance hud-provenance--${kind.replace(/_/g, '-')}`,
    hud: hudKey,
  });
  chip.dataset.provenance = kind;
  chip.textContent = PROVENANCE_LABELS[kind];
  chip.title = PROVENANCE_DESCRIPTIONS[kind];
  return chip;
}

/* -------------------------------------------------------------------------- */
/* Readings                                                                   */
/* -------------------------------------------------------------------------- */

export interface BudgetReading {
  readonly spent: number;
  readonly budget: number;
  readonly remaining: number;
  /** 0..1 share of the budget still available — what the depletion bar shows. */
  readonly remainingFraction: number;
  /** 0..1 share already spent. */
  readonly spentFraction: number;
  /** True once less than {@link LOW_BUDGET_THRESHOLD} of the budget is left. */
  readonly depleted: boolean;
  /** `61.2k / 200.0k` */
  readonly label: string;
  /** `138.8k left` */
  readonly remainingLabel: string;
}

/** Context budget: how much of the mission's token allowance is left. */
export function readBudget(state: HudState): BudgetReading {
  const budget = Math.max(0, state.economy.contextBudget);
  const spent = Math.max(0, state.economy.contextSpent);
  const remaining = Math.max(0, budget - spent);
  const remainingFraction = budget === 0 ? 0 : clamp01(remaining / budget);
  return {
    spent,
    budget,
    remaining,
    remainingFraction,
    spentFraction: budget === 0 ? 1 : clamp01(spent / budget),
    depleted: remainingFraction <= LOW_BUDGET_THRESHOLD,
    label: `${formatTokens(spent)} / ${formatTokens(budget)}`,
    remainingLabel: `${formatTokens(remaining)} left`,
  };
}

export interface InvariantReading {
  /** Invariants that currently hold (metric value at or above its target). */
  readonly held: number;
  readonly total: number;
  readonly pending: number;
  readonly ratio: number;
  readonly heldIds: readonly string[];
  /** `3/5` */
  readonly label: string;
}

/**
 * Final-invariant counter: how many quality metrics currently hold.
 *
 * A metric is a release invariant once its measured value reaches its declared
 * target; that is the same rule the quality constellation draws with, expressed
 * on the state contract alone.
 */
export function readInvariants(state: HudState): InvariantReading {
  const metrics = state.quality.order.flatMap((id) => {
    const metric = state.quality.metrics[id];
    return metric ? [metric] : [];
  });
  const heldIds = metrics
    .filter((metric) =>
      metric.target <= 0 ? metric.value >= 1 - EPSILON : metric.value >= metric.target - EPSILON,
    )
    .map((metric) => metric.id);
  const held = heldIds.length;
  const total = metrics.length;
  return {
    held,
    total,
    pending: total - held,
    ratio: total === 0 ? 0 : clamp01(held / total),
    heldIds,
    label: `${held}/${total}`,
  };
}

export interface ClockReading {
  readonly elapsedMs: number;
  readonly deadlineMs: number;
  readonly remainingMs: number;
  readonly expired: boolean;
  /** 0..1 share of the deadline consumed. */
  readonly progress: number;
  /** `01:30` */
  readonly elapsedLabel: string;
  /** `t+01:30` */
  readonly elapsedClock: string;
  /** `43:30 left` */
  readonly remainingLabel: string;
}

/** Simulated clock and deadline for the overlay. */
export function readClock(state: HudState): ClockReading {
  const elapsedMs = Math.max(0, state.mission.elapsedMs);
  const deadlineMs = Math.max(0, state.economy.deadlineMs);
  const remainingMs = Math.max(0, deadlineMs - elapsedMs);
  return {
    elapsedMs,
    deadlineMs,
    remainingMs,
    expired: deadlineMs > 0 && elapsedMs >= deadlineMs,
    progress: deadlineMs === 0 ? 0 : clamp01(elapsedMs / deadlineMs),
    elapsedLabel: formatSimClock(elapsedMs),
    elapsedClock: `t+${formatSimClock(elapsedMs)}`,
    remainingLabel: `${formatSimClock(remainingMs)} left`,
  };
}

export interface LaneOccupancyReadout {
  readonly id: string;
  readonly label: string;
  readonly kind: LaneKind;
  readonly activeTaskId: string | null;
  readonly queued: number;
  readonly capacity: number;
  readonly busy: boolean;
  /** Agents on the lane (one active plus everything queued). */
  readonly agents: number;
  /** `2/4` — agents against lane capacity. */
  readonly countLabel: string;
}

export interface LaneOccupancyReading {
  readonly lanes: readonly LaneOccupancyReadout[];
  readonly busy: number;
  readonly total: number;
  readonly queued: number;
  /** `3/5 lanes busy` */
  readonly label: string;
}

/** Lane occupancy: which lanes are crewed and how much work is waiting. */
export function readLaneOccupancy(state: HudState): LaneOccupancyReading {
  const lanes = state.lanes.order.flatMap((id) => {
    const lane = state.lanes.lanes[id];
    if (!lane) return [];
    const agents = (lane.activeTaskId ? 1 : 0) + lane.queue.length;
    return [
      {
        id: lane.id,
        label: lane.label,
        kind: lane.kind,
        activeTaskId: lane.activeTaskId,
        queued: lane.queue.length,
        capacity: lane.capacity,
        busy: lane.activeTaskId !== null,
        agents,
        countLabel: `${agents}/${Math.max(lane.capacity, 1)}`,
      },
    ];
  });
  const busy = lanes.filter((lane) => lane.busy).length;
  const total = lanes.length;
  return {
    lanes,
    busy,
    total,
    queued: lanes.reduce((sum, lane) => sum + lane.queued, 0),
    label: `${busy}/${total} lanes busy`,
  };
}

/* -------------------------------------------------------------------------- */
/* Plan outline and phases                                                    */
/* -------------------------------------------------------------------------- */

/** One row of the plan outline: a task plus where it sits in the phase stack. */
export interface PlanOutlineRow {
  readonly id: string;
  readonly title: string;
  readonly laneId: string;
  readonly laneLabel: string;
  readonly status: TaskStatus;
  readonly progress: number;
  /** Zero-based dependency depth (longest path from a root task). */
  readonly depth: number;
  /** One-based player-facing phase number. */
  readonly phase: number;
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
}

/** One dependency layer of the plan. */
export interface PlanPhaseReading {
  readonly index: number;
  readonly id: string;
  /** `Phase 3` */
  readonly label: string;
  /** Lane labels involved in the phase, e.g. `Build · Verification`. */
  readonly caption: string;
  readonly taskIds: readonly string[];
  readonly running: number;
  readonly passed: number;
  readonly blocked: number;
}

export interface PhaseReading {
  /** One-based phase number, or 0 when the plan is empty. */
  readonly index: number;
  readonly count: number;
  readonly id: string;
  /** `Phase 3 of 5` */
  readonly label: string;
  readonly caption: string;
  readonly taskIds: readonly string[];
  readonly passed: number;
  readonly running: number;
}

const laneLabelOf = (state: HudState, laneId: string): string =>
  state.lanes.lanes[laneId]?.label ?? laneId;

/**
 * Plan rows in plan order, each tagged with its dependency depth.
 *
 * Layering is the longest path from a root task, computed here on the frozen
 * plan slice so the HUD needs no orchestrator: every task depends only on tasks
 * in earlier phases, and unknown dependencies simply contribute no depth.
 */
export function readPlanOutline(state: HudState): readonly PlanOutlineRow[] {
  const depthById = new Map<string, number>();
  const computing = new Set<string>();

  const depthOf = (taskId: string): number => {
    const known = depthById.get(taskId);
    if (known !== undefined) return known;
    // Cycle guard: a task that (transitively) depends on itself is depth 0.
    if (computing.has(taskId)) return 0;
    computing.add(taskId);
    const task = state.plan.tasks[taskId];
    const dependencies = task?.dependencies ?? [];
    let depth = 0;
    for (const dependency of dependencies) {
      if (!state.plan.tasks[dependency]) continue;
      depth = Math.max(depth, depthOf(dependency) + 1);
    }
    computing.delete(taskId);
    depthById.set(taskId, depth);
    return depth;
  };

  const dependents = new Map<string, string[]>();
  for (const id of state.plan.order) {
    const task = state.plan.tasks[id];
    if (!task) continue;
    for (const dependency of task.dependencies) {
      const list = dependents.get(dependency);
      if (list) list.push(id);
      else dependents.set(dependency, [id]);
    }
  }

  return state.plan.order.flatMap((id) => {
    const task = state.plan.tasks[id];
    if (!task) return [];
    const depth = depthOf(id);
    return [
      {
        id: task.id,
        title: task.title,
        laneId: task.laneId,
        laneLabel: laneLabelOf(state, task.laneId),
        status: task.status,
        progress: clamp01(task.progress),
        depth,
        phase: depth + 1,
        dependencies: [...task.dependencies],
        dependents: [...(dependents.get(id) ?? [])],
      },
    ];
  });
}

/** Plan rows grouped into dependency phases, in phase then plan order. */
export function readPlanPhases(state: HudState): readonly PlanPhaseReading[] {
  const rows = readPlanOutline(state);
  const byDepth = new Map<number, { taskIds: string[]; laneLabels: Set<string>; running: number; passed: number; blocked: number }>();

  for (const row of rows) {
    let bucket = byDepth.get(row.depth);
    if (!bucket) {
      bucket = { taskIds: [], laneLabels: new Set(), running: 0, passed: 0, blocked: 0 };
      byDepth.set(row.depth, bucket);
    }
    bucket.taskIds.push(row.id);
    bucket.laneLabels.add(row.laneLabel);
    if (row.status === 'running') bucket.running += 1;
    if (row.status === 'passed') bucket.passed += 1;
    if (row.status === 'blocked') bucket.blocked += 1;
  }

  return [...byDepth.keys()]
    .sort((a, b) => a - b)
    .map((depth) => {
      const bucket = byDepth.get(depth);
      return {
        index: depth,
        id: `phase-${depth}`,
        label: `Phase ${depth + 1}`,
        caption: [...(bucket?.laneLabels ?? [])].join(' · '),
        taskIds: [...(bucket?.taskIds ?? [])],
        running: bucket?.running ?? 0,
        passed: bucket?.passed ?? 0,
        blocked: bucket?.blocked ?? 0,
      };
    });
}

/**
 * The phase the mission is working in: the earliest phase that still has work
 * open, falling back to the last phase (and to an empty reading for an empty
 * plan). This is what the overlay's `data-hud="phase"` value reports.
 */
export function readPhase(state: HudState): PhaseReading {
  const phases = readPlanPhases(state);
  const last = phases[phases.length - 1];
  if (!last) {
    return {
      index: 0,
      count: 0,
      id: 'phase-none',
      label: 'No plan registered',
      caption: '—',
      taskIds: [],
      passed: 0,
      running: 0,
    };
  }
  const current =
    phases.find((phase) =>
      phase.taskIds.some((taskId) => state.plan.tasks[taskId]?.status !== 'passed'),
    ) ?? last;
  return {
    index: current.index + 1,
    count: phases.length,
    id: current.id,
    label: `${current.label} of ${phases.length}`,
    caption: current.caption,
    taskIds: current.taskIds,
    passed: current.passed,
    running: current.running,
  };
}

/* -------------------------------------------------------------------------- */
/* Event log terminal                                                         */
/* -------------------------------------------------------------------------- */

/** One rendered log line: timestamp, provenance, source event and text. */
export interface EventLogEntry {
  readonly id: string;
  readonly atMs: number;
  readonly source: string;
  readonly provenance: ProvenanceKind;
  readonly text: string;
}

/** Readable one-line description of a domain event. */
export function describeEventText(event: DomainEvent): string {
  switch (event.type) {
    case 'mission/started':
      return 'Mission started';
    case 'mission/status':
      return `Mission status → ${event.status}`;
    case 'plan/task-registered':
      return `Task "${event.task.title}" registered on ${event.task.laneId}`;
    case 'plan/task-updated': {
      const parts: string[] = [];
      if (event.status) parts.push(event.status);
      if (typeof event.progress === 'number') parts.push(formatPercent(event.progress));
      return `Task ${event.taskId} → ${parts.length > 0 ? parts.join(' · ') : 'updated'}`;
    }
    case 'lane/registered':
      return `Lane ${event.lane.label} registered · ${event.lane.kind} · capacity ${event.lane.capacity ?? 1}`;
    case 'lane/queued':
      return `Task ${event.taskId} queued on ${event.laneId}`;
    case 'lane/assigned':
      return `Agent dispatched to ${event.taskId} on ${event.laneId}`;
    case 'lane/released':
      return `${event.taskId} released from ${event.laneId}`;
    case 'verification/gate-registered':
      return `Gate ${event.gate.name} registered on ${event.gate.laneId}`;
    case 'verification/run':
      return `Gate ${event.gateId} → ${event.status} · ${formatPercent(event.coverage)} coverage`;
    case 'quality/measured':
      return `Metric ${event.metric.label} measured ${event.metric.value.toFixed(2)} against target ${event.metric.target}`;
    case 'quality/finding':
      return `Finding [${event.finding.severity}] ${event.finding.summary}`;
    case 'economy/spend':
      return `Spent ${formatInteger(event.credits)} credits · ${formatTokens(event.contextTokens)} context`;
    case 'economy/reward':
      return `Earned ${formatInteger(event.credits)} credits · +${event.reputation} reputation`;
    case 'economy/deadline':
      return `Deadline set to ${formatSimClock(event.deadlineMs)}`;
    default: {
      const fallback: { type: string } = event;
      return fallback.type;
    }
  }
}

/** Complete log line for a domain event. */
export function logEntryFor(event: DomainEvent, id: string): EventLogEntry {
  return {
    id,
    atMs: event.at,
    source: event.type,
    provenance: provenanceForEvent(event),
    text: describeEventText(event),
  };
}

export interface EventLogOptions {
  doc?: Document;
  /** Maximum rendered lines; older lines are dropped. Defaults to 64. */
  limit?: number;
  /** Shown while the log is empty. */
  emptyText?: string;
}

export interface EventLogHandle {
  /** Whole terminal panel (`data-hud="event-log"`), including its header. */
  readonly element: HTMLElement;
  /** The `<ol>` the lines live in (`data-hud="event-log-lines"`). */
  readonly lines: HTMLElement;
  readonly entries: readonly EventLogEntry[];
  readonly limit: number;
  /** True while no line has been appended. */
  readonly empty: boolean;
  append(entry: EventLogEntry): EventLogEntry;
  appendEvent(event: DomainEvent): EventLogEntry;
  setEntries(entries: readonly EventLogEntry[]): void;
  clear(): void;
  dispose(): void;
}

/**
 * Event-log terminal.
 *
 * Lines are appended at the bottom, the newest one is marked
 * (`data-hud-line="latest"`) and the list is scrolled to the end after every
 * append, so the newest line is always the one on screen. Only the newest
 * `limit` lines are kept, which bounds the DOM and keeps the tail visible even
 * when the mission streams events for hours.
 */
export function createEventLog(options: EventLogOptions = {}): EventLogHandle {
  const doc = resolveDocument(options.doc);
  const limit = Math.max(1, options.limit ?? 64);
  const emptyText = options.emptyText ?? 'Awaiting the first domain event…';

  const element = createHudElement(doc, 'section', {
    className: 'hud-log',
    hud: 'event-log',
  });
  element.setAttribute('aria-label', 'Mission event log');
  const head = createHudElement(doc, 'header', { className: 'hud-log__head', parent: element });
  createHudElement(doc, 'span', { className: 'hud-log__title', text: 'Event log', parent: head });
  const count = createHudElement(doc, 'span', {
    className: 'hud-log__count hud-num',
    hud: 'log-count',
    text: '0',
    parent: head,
  });
  const lines = createHudElement(doc, 'ol', {
    className: 'hud-log__lines',
    hud: 'event-log-lines',
    parent: element,
  });
  // The terminal is decorative for assistive tech: the aria-live region owned by
  // the overlay carries announcements so a busy log cannot flood the reader.
  lines.setAttribute('aria-live', 'off');

  const entries: EventLogEntry[] = [];
  const nodes: HTMLElement[] = [];
  let placeholder: HTMLElement | null = null;

  const updatePlaceholder = (): void => {
    if (entries.length > 0) {
      placeholder?.remove();
      placeholder = null;
      return;
    }
    if (placeholder) return;
    placeholder = createHudElement(doc, 'li', {
      className: 'hud-log__empty',
      hud: 'log-empty',
      text: emptyText,
      parent: lines,
    });
  };

  const markLatest = (): void => {
    const previous = nodes[nodes.length - 2];
    if (previous) {
      delete previous.dataset.hudLine;
      previous.classList.remove('is-latest');
    }
    const latest = nodes[nodes.length - 1];
    if (latest) {
      latest.dataset.hudLine = 'latest';
      latest.classList.add('is-latest');
    }
  };

  const pinToNewest = (): void => {
    element.scrollTop = element.scrollHeight;
    lines.scrollTop = lines.scrollHeight;
  };

  const append = (entry: EventLogEntry): EventLogEntry => {
    const line = createHudElement(doc, 'li', {
      className: 'hud-log__line',
      hud: 'log-line',
      parent: lines,
    });
    line.dataset.provenance = entry.provenance;
    line.dataset.source = entry.source;
    const time = createHudElement(doc, 'time', {
      className: 'hud-log__time hud-num',
      hud: 'log-time',
      text: `t+${formatSimClock(entry.atMs)}`,
      parent: line,
    });
    time.setAttribute('datetime', `${Math.max(0, Math.round(entry.atMs))}ms`);
    line.append(createProvenanceChip(doc, entry.provenance, 'log-provenance'));
    createHudElement(doc, 'span', {
      className: 'hud-log__text',
      hud: 'log-text',
      text: entry.text,
      parent: line,
    });

    entries.push(entry);
    nodes.push(line);
    while (entries.length > limit) {
      entries.shift();
      nodes.shift()?.remove();
    }
    count.textContent = String(entries.length);
    updatePlaceholder();
    markLatest();
    pinToNewest();
    return entry;
  };

  let counter = 0;
  updatePlaceholder();

  return {
    element,
    lines,
    get entries(): readonly EventLogEntry[] {
      return entries;
    },
    limit,
    get empty(): boolean {
      return entries.length === 0;
    },
    append,
    appendEvent(event: DomainEvent): EventLogEntry {
      counter += 1;
      return append(logEntryFor(event, `log-${counter}`));
    },
    setEntries(next: readonly EventLogEntry[]): void {
      elementsReset();
      for (const entry of next) append(entry);
    },
    clear(): void {
      elementsReset();
      updatePlaceholder();
      pinToNewest();
    },
    dispose(): void {
      element.remove();
    },
  };

  function elementsReset(): void {
    entries.length = 0;
    for (const node of nodes) node.remove();
    nodes.length = 0;
    count.textContent = '0';
  }
}

/* -------------------------------------------------------------------------- */
/* Objective banner                                                           */
/* -------------------------------------------------------------------------- */

/** What changed on the banner, so the page can announce it. */
export interface ObjectiveChange {
  readonly kind: 'objective' | 'status';
  readonly previous: string;
  readonly next: string;
  readonly state: HudState;
}

export interface ObjectiveBannerOptions {
  doc?: Document;
  /** Called whenever the objective or the mission status changes. */
  onObjectiveChange?(change: ObjectiveChange): void;
}

export interface ObjectiveBannerHandle {
  readonly element: HTMLElement;
  /** Last snapshot rendered, or `null` before the first update. */
  readonly state: HudState | null;
  update(state: HudState): void;
  dispose(): void;
}

/** Objective banner: what Coroid is shipping, and how far it has got. */
export function createObjectiveBanner(options: ObjectiveBannerOptions = {}): ObjectiveBannerHandle {
  const doc = resolveDocument(options.doc);
  const element = createHudElement(doc, 'section', {
    className: 'hud-banner',
    hud: 'banner',
  });
  element.setAttribute('aria-label', 'Mission objective');

  const eyebrow = createHudElement(doc, 'p', { className: 'hud-banner__eyebrow', parent: element });
  createHudElement(doc, 'span', { className: 'hud-banner__kicker', text: 'Objective', parent: eyebrow });
  const status = createHudElement(doc, 'span', {
    className: 'hud-status hud-num',
    hud: 'mission-status',
    text: 'bootstrapping',
    parent: eyebrow,
  });
  const objective = createHudElement(doc, 'p', {
    className: 'hud-banner__objective',
    hud: 'objective',
    parent: element,
  });
  const meter = createHudElement(doc, 'div', {
    className: 'hud-meter hud-meter--wide',
    hud: 'mission-progress',
    parent: element,
  });
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-label', 'Mission progress');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  const meterFill = createHudElement(doc, 'span', {
    className: 'hud-meter__fill',
    hud: 'mission-progress-fill',
    parent: meter,
  });
  const progressLabel = createHudElement(doc, 'span', {
    className: 'hud-progress-label hud-num',
    hud: 'mission-progress-label',
    text: '0% shipped',
    parent: element,
  });

  let current: HudState | null = null;

  return {
    element,
    get state(): HudState | null {
      return current;
    },
    update(state: HudState): void {
      const previous = current;
      current = state;
      status.textContent = state.mission.status;
      status.dataset.status = state.mission.status;
      objective.textContent = state.mission.objective;
      const percent = clamp01(state.mission.progress) * 100;
      meterFill.style.width = `${percent.toFixed(1)}%`;
      meter.setAttribute('aria-valuenow', percent.toFixed(0));
      progressLabel.textContent = `${percent.toFixed(0)}% shipped`;

      if (!previous) return;
      const changes: ObjectiveChange[] = [];
      if (previous.mission.objective !== state.mission.objective) {
        changes.push({
          kind: 'objective',
          previous: previous.mission.objective,
          next: state.mission.objective,
          state,
        });
      }
      if (previous.mission.status !== state.mission.status) {
        changes.push({
          kind: 'status',
          previous: previous.mission.status,
          next: state.mission.status,
          state,
        });
      }
      for (const change of changes) options.onObjectiveChange?.(change);
    },
    dispose(): void {
      element.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Top overlay                                                                */
/* -------------------------------------------------------------------------- */

/** Panels the HUD can ask the flow layer to open. */
export type HudPanelAction = 'inspector' | 'outline' | 'report' | 'codex';

/** Player intent raised by a HUD affordance; the flow layer decides its meaning. */
export interface HudIntent {
  readonly type: 'panel';
  readonly panel: HudPanelAction;
}

export interface HudOverlayOptions {
  doc?: Document;
  /** Mount point for the interface layer. Defaults to `document.body`. */
  host?: HTMLElement;
  /** Maximum event-log lines. Defaults to 64. */
  logLimit?: number;
  /** Initial log lines (replayed mission history). */
  initialLog?: readonly EventLogEntry[];
  /** Raised when a HUD affordance is activated. */
  onIntent?(intent: HudIntent): void;
}

export interface HudOverlayHandle {
  /** Fixed interface layer holding the overlay, banner, terminal and live region. */
  readonly root: HTMLElement;
  /** The top overlay itself (`data-hud="overlay"`). */
  readonly overlay: HTMLElement;
  readonly banner: ObjectiveBannerHandle;
  readonly log: EventLogHandle;
  /** Single aria-live channel every announcement goes through. */
  readonly liveRegion: HTMLElement;
  readonly state: HudState | null;
  update(state: HudState): void;
  /** Append a domain event to the terminal. */
  pushEvent(event: DomainEvent): EventLogEntry;
  /** Announce a message through the live region. */
  announce(message: string): void;
  /** Look up a stable `data-hud` hook. */
  query(hudKey: string): HTMLElement | null;
  queryAll(hudKey: string): HTMLElement[];
  dispose(): void;
}

interface OverlayReadout {
  readonly key: string;
  readonly label: string;
  readonly hudValue: string;
  readonly withMeter?: boolean;
}

const READOUTS: readonly OverlayReadout[] = [
  { key: 'context', label: 'Context budget', hudValue: 'budget', withMeter: true },
  { key: 'invariants', label: 'Final invariants', hudValue: 'invariants' },
  { key: 'credits', label: 'Credits', hudValue: 'credits' },
  { key: 'reputation', label: 'Reputation', hudValue: 'reputation', withMeter: true },
  { key: 'clock', label: 'Sim clock', hudValue: 'clock' },
  { key: 'phase', label: 'Phase', hudValue: 'phase' },
];

/**
 * The top overlay: context budget with its depletion bar, the final-invariant
 * counter, credits and reputation, the sim clock, the current phase and lane
 * occupancy, plus the buttons that open the modal panels.
 *
 * `update(state)` renders a snapshot; nothing here mutates state.
 */
export function createHudOverlay(options: HudOverlayOptions = {}): HudOverlayHandle {
  const doc = resolveDocument(options.doc);
  const host = options.host ?? (doc.body as HTMLElement | null);
  if (!host) {
    throw new Error('[coroid] the HUD overlay needs a host element to mount into');
  }

  const root = createHudElement(doc, 'div', { className: 'hud-root', hud: 'root' });
  const overlay = createHudElement(doc, 'section', {
    className: 'hud-overlay',
    hud: 'overlay',
    parent: root,
  });
  overlay.setAttribute('aria-label', 'Factory status');

  const brand = createHudElement(doc, 'div', { className: 'hud-overlay__brand', parent: overlay });
  createHudElement(doc, 'p', { className: 'hud-brand__mark', text: 'COROID', parent: brand });
  const brandMeta = createHudElement(doc, 'p', { className: 'hud-brand__meta', parent: brand });
  createHudElement(doc, 'span', {
    className: 'hud-brand__mission',
    hud: 'codename',
    text: 'COROID',
    parent: brandMeta,
  });
  createHudElement(doc, 'span', { className: 'hud-brand__sep', text: '·', parent: brandMeta });
  createHudElement(doc, 'span', {
    className: 'hud-brand__codename',
    hud: 'mission-id',
    text: 'awaiting mission',
    parent: brandMeta,
  });

  const readouts = createHudElement(doc, 'ul', {
    className: 'hud-overlay__readouts',
    hud: 'readouts',
    parent: overlay,
  });

  interface ReadoutNodes {
    readonly value: HTMLElement;
    readonly meta: HTMLElement;
    readonly meter: HTMLElement | null;
    readonly meterFill: HTMLElement | null;
  }
  const readoutNodes = new Map<string, ReadoutNodes>();

  for (const readout of READOUTS) {
    const item = createHudElement(doc, 'li', {
      className: 'hud-readout',
      hud: `readout-${readout.key}`,
      parent: readouts,
    });
    createHudElement(doc, 'span', {
      className: 'hud-readout__key',
      text: readout.label,
      parent: item,
    });
    const value = createHudElement(doc, 'span', {
      className: 'hud-readout__value hud-num',
      hud: readout.hudValue,
      text: '—',
      parent: item,
    });
    let meter: HTMLElement | null = null;
    let meterFill: HTMLElement | null = null;
    if (readout.withMeter) {
      meter = createHudElement(doc, 'span', {
        className: 'hud-meter',
        hud: `${readout.hudValue}-bar`,
        parent: item,
      });
      meter.setAttribute('role', 'progressbar');
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      meterFill = createHudElement(doc, 'span', {
        className: 'hud-meter__fill',
        hud: `${readout.hudValue}-fill`,
        parent: meter,
      });
    }
    const meta = createHudElement(doc, 'span', {
      className: 'hud-readout__meta',
      hud: `${readout.hudValue}-meta`,
      text: '',
      parent: item,
    });
    readoutNodes.set(readout.key, { value, meta, meter, meterFill });
  }

  const laneStrip = createHudElement(doc, 'div', {
    className: 'hud-overlay__lanes',
    hud: 'lane-occupancy',
    parent: overlay,
  });
  laneStrip.setAttribute('aria-label', 'Lane occupancy');
  const laneNodes = new Map<string, HTMLElement>();

  const actions = createHudElement(doc, 'div', {
    className: 'hud-overlay__actions',
    parent: overlay,
  });
  actions.setAttribute('role', 'toolbar');
  actions.setAttribute('aria-label', 'Interface panels');
  const ACTION_BUTTONS: readonly { action: HudPanelAction; label: string; hint: string }[] = [
    { action: 'inspector', label: 'Inspector', hint: 'Task inspector (I)' },
    { action: 'outline', label: 'Plan', hint: 'Plan outline (O)' },
    { action: 'report', label: 'Verify', hint: 'Verification report (V)' },
    { action: 'codex', label: 'Codex', hint: 'Codex (C)' },
  ];
  for (const button of ACTION_BUTTONS) {
    const control = createHudElement(doc, 'button', {
      className: 'hud-button',
      hud: `action-${button.action}`,
      text: button.label,
      parent: actions,
    });
    control.type = 'button';
    control.dataset.action = button.action;
    control.title = button.hint;
    control.addEventListener('click', () => {
      options.onIntent?.({ type: 'panel', panel: button.action });
    });
  }

  const banner = createObjectiveBanner({
    doc,
    onObjectiveChange: (change) => {
      if (change.kind === 'objective') {
        announce(`Objective updated: ${change.next}`);
      } else {
        announce(`Mission ${change.next}`);
      }
    },
  });
  root.append(banner.element);

  const log = createEventLog({ doc, limit: options.logLimit });
  root.append(log.element);
  if (options.initialLog) log.setEntries(options.initialLog);

  const liveRegion = createHudElement(doc, 'div', {
    className: 'hud-live',
    hud: 'live',
    parent: root,
  });
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');

  host.append(root);

  let current: HudState | null = null;

  function announce(message: string): void {
    liveRegion.textContent = message;
    liveRegion.dataset.message = message;
  }

  function renderLanes(state: HudState): void {
    const reading = readLaneOccupancy(state);
    for (const [id, node] of [...laneNodes]) {
      if (reading.lanes.some((lane) => lane.id === id)) continue;
      node.remove();
      laneNodes.delete(id);
    }
    for (const lane of reading.lanes) {
      let chip = laneNodes.get(lane.id);
      if (!chip) {
        chip = createHudElement(doc, 'span', {
          className: 'hud-lane',
          hud: 'lane',
          parent: laneStrip,
        });
        chip.dataset.laneId = lane.id;
        createHudElement(doc, 'span', { className: 'hud-lane__name', parent: chip });
        createHudElement(doc, 'span', {
          className: 'hud-lane__count hud-num',
          hud: 'lane-count',
          parent: chip,
        });
        laneNodes.set(lane.id, chip);
      }
      chip.dataset.kind = lane.kind;
      chip.dataset.busy = lane.busy ? 'true' : 'false';
      chip.title = `${lane.label} · ${lane.agents} agents · capacity ${lane.capacity}`;
      const name = chip.querySelector<HTMLElement>('.hud-lane__name');
      const count = chip.querySelector<HTMLElement>('.hud-lane__count');
      if (name) name.textContent = lane.label;
      if (count) count.textContent = `${lane.agents}/${Math.max(lane.capacity, 1)}`;
    }
  }

  return {
    root,
    overlay,
    banner,
    log,
    liveRegion,
    get state(): HudState | null {
      return current;
    },
    announce,
    update(state: HudState): void {
      const previous = current;
      current = state;

      const codename = overlay.querySelector<HTMLElement>('[data-hud="codename"]');
      if (codename) codename.textContent = state.mission.codename;
      const mission = overlay.querySelector<HTMLElement>('[data-hud="mission-id"]');
      if (mission) mission.textContent = state.mission.id;

      const budget = readBudget(state);
      const invariants = readInvariants(state);
      const occupancy = readLaneOccupancy(state);
      const clock = readClock(state);
      const phase = readPhase(state);

      const setReadout = (
        key: string,
        value: string,
        meta: string,
        percent: number | null,
        ariaLabel: string,
      ): void => {
        const nodes = readoutNodes.get(key);
        if (!nodes) return;
        nodes.value.textContent = value;
        nodes.meta.textContent = meta;
        if (nodes.meter && nodes.meterFill && percent !== null) {
          nodes.meterFill.style.width = `${(clamp01(percent) * 100).toFixed(1)}%`;
          nodes.meter.setAttribute('aria-valuenow', (clamp01(percent) * 100).toFixed(0));
          nodes.meter.setAttribute('aria-label', ariaLabel);
        }
      };

      setReadout(
        'context',
        budget.label,
        budget.remainingLabel,
        budget.remainingFraction,
        `Context budget remaining: ${budget.remainingLabel}`,
      );
      setReadout(
        'invariants',
        invariants.label,
        `${invariants.pending} pending`,
        null,
        'Final invariants held',
      );
      setReadout(
        'credits',
        formatInteger(state.economy.credits),
        `${formatInteger(state.economy.creditsPerSecond)} cr/s`,
        null,
        'Credits',
      );
      setReadout(
        'reputation',
        Math.round(state.economy.reputation).toString(),
        'of 100',
        clamp01(state.economy.reputation / 100),
        `Reputation ${Math.round(state.economy.reputation)} of 100`,
      );
      setReadout('clock', clock.elapsedClock, clock.remainingLabel, null, 'Simulated clock');
      setReadout(
        'phase',
        phase.count === 0 ? phase.label : `${phase.label} · ${phase.caption}`,
        `${phase.passed}/${phase.taskIds.length} passed · ${phase.running} running`,
        null,
        'Current plan phase',
      );

      laneStrip.dataset.busy = String(occupancy.busy);
      laneStrip.dataset.total = String(occupancy.total);
      laneStrip.title = occupancy.label;
      renderLanes(state);

      banner.update(state);

      if (!previous) return;
      const beforeInvariants = readInvariants(previous);
      if (beforeInvariants.held !== invariants.held) {
        const settled = invariants.held > beforeInvariants.held;
        announce(
          settled
            ? `Invariant settled: ${invariants.held} of ${invariants.total} hold`
            : `Invariant lost: ${invariants.held} of ${invariants.total} hold`,
        );
      }
      const beforeBudget = readBudget(previous);
      if (!beforeBudget.depleted && budget.depleted) {
        announce(`Context budget low: ${formatPercent(budget.remainingFraction)} remaining`);
      }
      const beforeGates = countFailedGates(previous);
      const gates = countFailedGates(state);
      if (gates > beforeGates) {
        announce(`Verification alarm: ${gates} gate${gates === 1 ? '' : 's'} failing`);
      }
    },
    pushEvent(event: DomainEvent): EventLogEntry {
      return log.appendEvent(event);
    },
    query(hudKey: string): HTMLElement | null {
      return root.querySelector<HTMLElement>(`[data-hud="${hudKey}"]`);
    },
    queryAll(hudKey: string): HTMLElement[] {
      return [...root.querySelectorAll<HTMLElement>(`[data-hud="${hudKey}"]`)];
    },
    dispose(): void {
      banner.dispose();
      log.dispose();
      root.remove();
    },
  };
}

function countFailedGates(state: HudState): number {
  return state.verification.order.filter(
    (gateId) => state.verification.gates[gateId]?.status === 'failed',
  ).length;
}
