/**
 * Dev preview: the plan graph, the playing field of Coroid.
 *
 * The page composes the instanced task-node view (nodes, phase tier platforms
 * and dependency conduits), a deterministic show director and a pointer-driven
 * inspector on top of the shared preview harness, so one URL demonstrates
 * everything this module set delivers:
 *
 *  - task polyhedra standing on phase tier platforms, colour-, shape- and
 *    glyph-coded by status;
 *  - dependency conduits that stay dim until their upstream task completes, then
 *    light up and send an energy pulse toward the dependent task;
 *  - raycast picking: a click (mouse or touch) resolves to a task key and fills
 *    the inspector with that task's status, tier and dependencies.
 *
 * The director only emits domain events on the simulated clock the state already
 * carries, so the whole show is deterministic and replay-identical: nothing here
 * reads wall-clock time.
 */

import '../src/styles/base.css';

import { GridHelper, Group, LineBasicMaterial } from 'three';

import type { GameSystem } from '../src/game/systems';
import type { GameFrame } from '../src/game/Game';
import type { RenderAdapter } from '../src/render/renderer';
import {
  PLAN_GRAPH_STATUSES,
  TASK_STATUS_PALETTE,
  createPlanGraphSystem,
  type PlanGraphBounds,
  type PlanGraphView,
  type TaskNodePick,
  type TaskNodeSelection,
} from '../src/render/nodes';
import { createSampleState } from '../src/sim/fixtures';
import {
  makeDomainEvent,
  type DeepReadonly,
  type DomainEvent,
  type GameState,
  type TaskStatus,
} from '../src/sim/state';
import { mountGamePreview, type PreviewHarness } from './harness';

/* -------------------------------------------------------------------------- */
/* Show director                                                              */
/* -------------------------------------------------------------------------- */

export interface PlanGraphDirectorOptions {
  /** System id. Defaults to `preview/plan-graph-director`. */
  id?: string;
  /** Length of one loop of the failure/repair choreography, in simulated ms. */
  cycleMs?: number;
  /** Progress a running task gains per simulated millisecond. */
  progressPerMs?: number;
}

interface StatusStep {
  /** Offset into the show cycle at which the step fires. */
  readonly delayMs: number;
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly progress: number;
}

/**
 * The choreography: one loop of the floor's working life.
 *
 * Tasks fail (magenta-red hex prism, downstream conduits drop back to dim) and
 * are returned to their lanes (running, then passed, conduits light again), so
 * the dim → lit transition is visible in the first minute.
 */
const STATUS_STEPS: readonly StatusStep[] = [
  { delayMs: 3_000, taskId: 'task-lane-comets', status: 'failed', progress: 0.34 },
  { delayMs: 9_500, taskId: 'task-lane-comets', status: 'running', progress: 0.44 },
  { delayMs: 16_000, taskId: 'task-gates', status: 'failed', progress: 0.3 },
  { delayMs: 22_500, taskId: 'task-gates', status: 'running', progress: 0.48 },
  { delayMs: 30_000, taskId: 'task-constellation', status: 'failed', progress: 0.22 },
  { delayMs: 36_500, taskId: 'task-constellation', status: 'running', progress: 0.36 },
];

/**
 * Drive the fixture the way a real run behaves: work progresses, queued tasks
 * are promoted once their dependencies land, and the failure choreography above
 * loops on the state's own clock.
 */
export function createPlanGraphDirector(options: PlanGraphDirectorOptions = {}): GameSystem {
  const cycleMs = options.cycleMs ?? 46_000;
  // Slow enough to watch: a task climbs from "just started" to "passed" in
  // roughly six seconds of simulated time.
  const progressPerMs = options.progressPerMs ?? 0.00012;
  // The show runs on its own deterministic clock (the fixed-step delta the
  // runtime hands every system). The state clock only advances when events land
  // in it, so it cannot schedule the quiet parts of the loop.
  let localMs = 0;
  let lastPhase = 0;
  let cursor = -1;

  return {
    id: options.id ?? 'preview/plan-graph-director',
    attach(): void {
      // Nothing to attach: the director is pure state choreography.
    },
    update(update): void {
      const state = update.state;
      const context = update.context;
      localMs += Math.max(0, update.deltaMs);
      const at = state.mission.elapsedMs + Math.max(1, Math.round(update.deltaMs));
      const phase = ((localMs % cycleMs) + cycleMs) % cycleMs;
      if (phase < lastPhase) cursor = -1; // new loop of the show
      lastPhase = phase;

      // 1. Running work advances; finished work lands as passed.
      for (const taskId of state.plan.order) {
        const task = state.plan.tasks[taskId];
        if (!task || task.status !== 'running') continue;
        const progress = Math.min(1, task.progress + progressPerMs * update.deltaMs);
        context.events.emit(
          makeDomainEvent(
            'plan/task-updated',
            progress >= 1 ? { taskId, progress: 1, status: 'passed' } : { taskId, progress },
            at,
          ),
        );
      }

      // 2. Promote the next queued task whose dependencies have all landed.
      for (const taskId of state.plan.order) {
        const task = state.plan.tasks[taskId];
        if (!task || task.status !== 'pending') continue;
        const ready = task.dependencies.every(
          (dependency) => state.plan.tasks[dependency]?.status === 'passed',
        );
        if (!ready) continue;
        context.events.emit(makeDomainEvent('lane/assigned', { laneId: task.laneId, taskId }, at));
        break;
      }

      // 3. Failure and repair, exactly once per cycle step.
      let nextCursor = cursor;
      for (let index = cursor + 1; index < STATUS_STEPS.length; index += 1) {
        const step = STATUS_STEPS[index];
        if (!step || step.delayMs > phase) break;
        nextCursor = index;
      }
      if (nextCursor !== cursor) {
        for (let index = cursor + 1; index <= nextCursor; index += 1) {
          const step = STATUS_STEPS[index];
          if (!step) continue;
          context.events.emit(
            makeDomainEvent(
              'plan/task-updated',
              { taskId: step.taskId, status: step.status, progress: step.progress },
              at,
            ),
          );
        }
        cursor = nextCursor;
      }
    },
    dispose(): void {
      cursor = -1;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Camera, floor and HUD                                                      */
/* -------------------------------------------------------------------------- */

/** Footprint of the preview's emitter grid, in world units. */
export const FLOOR_SIZE = 84;

/** Slow orbit that keeps the whole tier tower and its conduits in frame. */
export function orbitPlanGraphCamera(
  adapter: RenderAdapter,
  bounds: PlanGraphBounds,
  elapsedMs: number,
): void {
  const seconds = elapsedMs / 1_000;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const angle = 0.95 + Math.sin(seconds * 0.05) * 0.5;
  const radius = Math.max(30, bounds.radius * 2.6 + bounds.maxY * 1.15);
  const camera = adapter.camera;
  camera.position.set(
    Math.cos(angle) * radius,
    centerY + 9 + Math.sin(seconds * 0.07) * 2.2,
    Math.sin(angle) * radius,
  );
  camera.lookAt(0, centerY, 0);
}

/**
 * Ground the hologram: a faint emitter grid so the platforms, nodes and conduits
 * read against the void. Owned by the page (the harness disposes it with the
 * scene).
 */
export function createPreviewFloor(adapter: RenderAdapter): Group {
  const root = new Group();
  root.name = 'plan-graph-floor';

  const grid = new GridHelper(FLOOR_SIZE, 48, 0x1f7f99, 0x0d3346);
  grid.position.y = 0.02;
  const gridMaterial = grid.material as LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.4;
  gridMaterial.depthWrite = false;

  const outer = new GridHelper(FLOOR_SIZE * 0.5, 24, 0x35f0ff, 0x116079);
  outer.position.y = 0.04;
  const outerMaterial = outer.material as LineBasicMaterial;
  outerMaterial.transparent = true;
  outerMaterial.opacity = 0.22;
  outerMaterial.depthWrite = false;

  root.add(grid, outer);
  adapter.scene.add(root);
  return root;
}

/** Header line for the page ticker: adapter, frame counter and mission clock. */
export function describeStatus(harness: PreviewHarness, frame: GameFrame): string {
  const state = harness.game.state;
  const seconds = Math.max(0, frame.elapsedMs) / 1_000;
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  const progress = (state.mission.progress * 100).toFixed(0).padStart(3);
  return `${harness.adapter.kind} · frame ${frame.frame} · plan ${progress}% · t+${mm}:${ss}`;
}

/** The live plan summary shown in the corner ticker. */
export function describePlanGraph(
  state: DeepReadonly<GameState>,
  view: PlanGraphView,
): string[] {
  const counts = PLAN_GRAPH_STATUSES.map((status) => {
    const used = view.nodes.filter((node) => node.active && node.status === status).length;
    return `${used} ${TASK_STATUS_PALETTE[status].label.toLowerCase()}`;
  });
  const tiers = view.tiers.map((tier) => `${tier.label}×${tier.taskIds.length}`).join(' · ');

  return [
    `nodes      ${view.count} across ${view.tiers.length} phase tiers`,
    `status     ${counts.join(' · ')}`,
    `conduits   ${view.edges.litCount}/${view.edges.count} lit · ${view.edges.pulsingCount} pulsing`,
    `tiers      ${tiers}`,
    `mission    ${state.mission.status} · ${(state.mission.progress * 100).toFixed(0)}% shipped`,
  ];
}

/**
 * The selected task key, as the inspector's headline.
 *
 * Kept separate from `inspectionText` so the page has one element whose text is
 * exactly the task key that picking returned.
 */
export function inspectionKey(selection: TaskNodeSelection | null): string {
  return selection ? selection.taskId : 'NO TASK SELECTED';
}

/** The inspector's readout for a selection. */
export function inspectionText(
  selection: TaskNodeSelection | null,
  state: DeepReadonly<GameState>,
): string {
  if (!selection) return 'click any task node to inspect it';
  const visual = TASK_STATUS_PALETTE[selection.status];
  const task = state.plan.tasks[selection.taskId];
  const dependencies = task && task.dependencies.length > 0 ? task.dependencies.join(', ') : 'none';
  const progress = task ? `${Math.round(task.progress * 100)}%` : 'n/a';
  const lane = task?.laneId ?? 'unassigned';
  return [
    `title      ${selection.title}`,
    `status     ${visual.label.toUpperCase()} (${visual.meaning})`,
    `tier       PHASE ${selection.tier + 1}`,
    `lane       ${lane}   progress ${progress}`,
    `depends on ${dependencies}`,
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

/** The slice of a running game the scenarios drive. */
export interface PlanGraphScenarioHost {
  readonly game: {
    readonly state: DeepReadonly<GameState>;
    emit(event: DomainEvent): void;
    commit(): number;
  };
  readonly view: PlanGraphView;
}

/** On-demand plan scenarios a browser verifier (or a human) can trigger. */
export interface PlanGraphScenarios {
  /** Fail a running task so the magenta-red alarm appears. Returns its key. */
  failTask(taskId?: string): string | null;
  /** Return every failed task to its lane. */
  repairTasks(): void;
  /** Retire a passed task as dim-violet history. Returns its key. */
  supersedeTask(taskId?: string): string | null;
  /** Drop every author-only visual override. */
  restoreTasks(): void;
}

/**
 * Build the on-demand scenarios.
 *
 * Kept independent of the DOM so tests can drive exactly what the preview
 * buttons drive; `wireScenarioButtons` only adds the click listeners.
 */
export function createPlanGraphScenarios(host: PlanGraphScenarioHost): PlanGraphScenarios {
  const game = host.game;
  const emitTaskUpdate = (taskId: string, status: TaskStatus, progress: number): void => {
    game.emit(
      makeDomainEvent(
        'plan/task-updated',
        { taskId, status, progress },
        game.state.mission.elapsedMs + 1,
      ),
    );
  };

  return {
    failTask(taskId?: string): string | null {
      const state = game.state;
      const target =
        taskId ??
        state.plan.order.find((id) => state.plan.tasks[id]?.status === 'running') ??
        null;
      if (!target) return null;
      const task = state.plan.tasks[target];
      emitTaskUpdate(target, 'failed', Math.max(0.05, (task?.progress ?? 0.4) * 0.5));
      host.view.clearStatusOverrides();
      game.commit();
      return target;
    },
    repairTasks(): void {
      const state = game.state;
      for (const taskId of state.plan.order) {
        if (state.plan.tasks[taskId]?.status !== 'failed') continue;
        emitTaskUpdate(taskId, 'running', 0.4);
      }
      game.commit();
    },
    supersedeTask(taskId?: string): string | null {
      const state = game.state;
      const target =
        taskId ??
        [...state.plan.order]
          .reverse()
          .find((id) => state.plan.tasks[id]?.status === 'passed') ??
        null;
      if (!target) return null;
      host.view.setStatusOverride(target, 'superseded');
      return target;
    },
    restoreTasks(): void {
      host.view.clearStatusOverrides();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Pointer selection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Select the task worth watching right now: work in flight first, then a
 * failure to inspect, then settled work, then anything at all.
 *
 * The preview calls this on its first frame so the inspector always opens on a
 * real task instead of an empty panel.
 */
export function selectBusiestTask(view: PlanGraphView): TaskNodeSelection | null {
  const nodes = view.nodes.filter((node) => node.active);
  const preferred =
    nodes.find((node) => node.status === 'running' || node.status === 'verifying') ??
    nodes.find((node) => node.status === 'failed') ??
    nodes.find((node) => node.status === 'passed') ??
    nodes[0];
  return preferred ? view.select(preferred.id) : null;
}

/** Pointer → task node resolution, for both mouse and touch input. */
export interface PlanGraphSelectionController {
  /** Resolve client coordinates to a task node and mark it selected. */
  selectAt(clientX: number, clientY: number): TaskNodePick | null;
  /** Attach mouse/touch listeners to a canvas. Returns a detach function. */
  wire(canvas: HTMLCanvasElement): () => void;
}

/**
 * Build the pointer selection controller.
 *
 * `canvas` is the element whose client rectangle defines the coordinate space.
 * `PointerEvent` and `Touch` both expose `clientX`/`clientY`, so both input
 * paths run through the same `pickFromPointer` call.
 */
export function createSelectionController(
  view: PlanGraphView,
  canvas: HTMLCanvasElement,
  onSelect?: (pick: TaskNodePick | null) => void,
): PlanGraphSelectionController {
  const selectAt = (clientX: number, clientY: number): TaskNodePick | null => {
    const rect = canvas.getBoundingClientRect();
    const pick = view.pickFromPointer(clientX, clientY, rect);
    // A click that misses the graph keeps the current selection: the inspector
    // is a readout, so it should never blink empty.
    if (pick) view.select(pick.taskId);
    onSelect?.(pick);
    return pick;
  };

  return {
    selectAt,
    wire(element: HTMLCanvasElement): () => void {
      const onPointerDown = (event: PointerEvent): void => {
        selectAt(event.clientX, event.clientY);
      };
      const onTouchStart = (event: TouchEvent): void => {
        const touch = event.touches[0] ?? event.changedTouches[0];
        if (touch) selectAt(touch.clientX, touch.clientY);
      };
      element.addEventListener('pointerdown', onPointerDown);
      element.addEventListener('touchstart', onTouchStart, { passive: true });
      return () => {
        element.removeEventListener('pointerdown', onPointerDown);
        element.removeEventListener('touchstart', onTouchStart);
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export interface PlanGraphPreviewHandle {
  readonly harness: PreviewHarness;
  readonly view: PlanGraphView;
  /** On-demand scenarios a browser verifier (or a human) can trigger. */
  readonly scenarios: PlanGraphScenarios;
  /** Resolve client coordinates (mouse or touch) to a selected node. */
  selectAt(clientX: number, clientY: number): TaskNodePick | null;
  /** Exactly the lines the page ticker shows. */
  summary(): string[];
  /** Exactly the inspector text for the current selection. */
  inspection(): string;
  /** Exactly the task key the inspector shows in its headline. */
  inspectedTaskId(): string;
}

export interface PlanGraphPreviewOptions {
  /** Host element. Defaults to `#plan-graph`. */
  host?: HTMLElement | null;
  /** Ticker element. Defaults to `#plan-graph-ticker`. */
  ticker?: HTMLElement | null;
  /** Inspector element. Defaults to `#plan-graph-inspector`. */
  inspector?: HTMLElement | null;
  /** Seed for the deterministic run. */
  seed?: number;
}

/** Hook the page's `data-coroid-scenario` buttons up to the scenarios. */
function wireScenarioButtons(document: Document, scenarios: PlanGraphScenarios): void {
  document
    .querySelector<HTMLButtonElement>('[data-coroid-scenario="fail-task"]')
    ?.addEventListener('click', () => {
      scenarios.failTask();
    });
  document
    .querySelector<HTMLButtonElement>('[data-coroid-scenario="repair-tasks"]')
    ?.addEventListener('click', () => {
      scenarios.repairTasks();
    });
  document
    .querySelector<HTMLButtonElement>('[data-coroid-scenario="supersede-task"]')
    ?.addEventListener('click', () => {
      scenarios.supersedeTask();
    });
  document
    .querySelector<HTMLButtonElement>('[data-coroid-scenario="restore-tasks"]')
    ?.addEventListener('click', () => {
      scenarios.restoreTasks();
    });
}

declare global {
  interface Window {
    /** Browser-verification handle for the plan-graph preview page. */
    coroidPlanGraph?: PlanGraphPreviewHandle;
  }
}

/** Mount the preview page: harness, plan graph, director, camera and inspector. */
export function bootPlanGraphPreview(
  options: PlanGraphPreviewOptions = {},
): PlanGraphPreviewHandle | null {
  if (typeof document === 'undefined') return null;
  const host = options.host ?? document.getElementById('plan-graph');
  if (!host) return null;
  const ticker =
    options.ticker === undefined ? document.getElementById('plan-graph-ticker') : options.ticker;
  const inspector =
    options.inspector === undefined
      ? document.getElementById('plan-graph-inspector')
      : options.inspector;
  // The inspector is split so the selected task key has an element of its own:
  // the page can be checked for the key picking returned without parsing prose.
  const inspectorKey =
    inspector?.querySelector<HTMLElement>('[data-coroid-inspector-key]') ?? null;
  const inspectorDetail =
    inspector?.querySelector<HTMLElement>('[data-coroid-inspector-detail]') ?? null;

  const system = createPlanGraphSystem({ id: 'preview/plan-graph' });

  const writeInspector = (): void => {
    const selection = system.view.selection;
    if (inspectorKey) inspectorKey.textContent = inspectionKey(selection);
    if (inspectorDetail) inspectorDetail.textContent = inspectionText(selection, mounted.game.state);
  };

  const mounted = mountGamePreview({
    container: host,
    adapter: 'auto',
    // The page provides its own HUD (ticker + inspector), so the harness's
    // small overlay stays out of the way.
    overlay: false,
    state: createSampleState({ seed: options.seed }),
    systems: [system, createPlanGraphDirector()],
    onFrame: (frame) => {
      orbitPlanGraphCamera(mounted.adapter, system.view.bounds, frame.elapsedMs);
      // The first frame can arrive before the first fixed step, so keep offering
      // a selection until one sticks: the inspector should never sit empty, and
      // a click that misses the graph keeps whatever is already selected.
      if (system.view.selectedTaskId === null) selectBusiestTask(system.view);
      if (ticker && (frame.frame === 1 || frame.frame % 15 === 0)) {
        ticker.textContent = [
          describeStatus(mounted, frame),
          ...describePlanGraph(mounted.game.state, system.view),
        ].join('\n');
      }
      if (frame.frame === 1 || frame.frame % 15 === 0) writeInspector();
    },
  });

  const controller = createSelectionController(system.view, mounted.canvas, () => {
    writeInspector();
  });

  const preview: PlanGraphPreviewHandle = {
    harness: mounted,
    view: system.view,
    scenarios: createPlanGraphScenarios({ game: mounted.game, view: system.view }),
    selectAt: (clientX, clientY) => controller.selectAt(clientX, clientY),
    summary: () => describePlanGraph(mounted.game.state, system.view),
    inspection: () => inspectionText(system.view.selection, mounted.game.state),
    inspectedTaskId: () => inspectionKey(system.view.selection),
  };

  createPreviewFloor(mounted.adapter);
  controller.wire(mounted.canvas);
  wireScenarioButtons(document, preview.scenarios);
  window.coroidPlanGraph = preview;
  return preview;
}

try {
  bootPlanGraphPreview();
} catch (error) {
  console.error('[coroid] failed to mount the plan-graph preview', error);
  const ticker = document.getElementById('plan-graph-ticker');
  if (ticker) {
    ticker.textContent =
      'Hologram offline — this browser could not provide a renderer for the plan graph.';
  }
}
